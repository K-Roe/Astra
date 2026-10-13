import * as THREE from 'three';
import { CHARACTER_MORPHS, LOOPING_CLIPS, ONE_SHOT_CLIPS, STATE_CLIP, STATE_EXPRESSION } from '../../shared/characterClips';
import type { CharacterMorph } from '../../shared/characterClips';
import {
  isAutonomous,
  isChatDriven,
  nextState,
  type CharacterEvent,
  type CharacterState,
} from '../../shared/characterStateMachine';
import { IdleScheduler, DEFAULT_IDLE_OPTIONS } from '../../shared/characterIdle';
import {
  DEFAULT_ROOM,
  angleDelta,
  isSeatApproach,
  nearestWaypoint,
  planPath,
  waypointById,
  type RoomLayout,
  type Vec2,
  type Waypoint,
} from '../../shared/characterNavigation';
import type { CharacterAsset } from './characterAsset';

export interface CharacterDiagnostics {
  readonly state: CharacterState;
  readonly clip: string | null;
  readonly destination: string | null;
  readonly waypoint: string;
  readonly position: { readonly x: number; readonly z: number };
  readonly morphInfluences: Readonly<Record<string, number>>;
  readonly transitions: number;
  readonly idleActivities: number;
  readonly blinkCount: number;
}

export interface CharacterControllerOptions {
  readonly layout?: RoomLayout;
  readonly walkSpeed?: number;
  readonly turnSpeed?: number;
  readonly random?: () => number;
  /**
   * Separate stream for the idle scheduler. Blinking also draws randomness, so
   * sharing one generator made the schedule depend on how often she blinked.
   */
  readonly idleRandom?: () => number;
  readonly now?: () => number;
}

const DEFAULT_WALK_SPEED = 0.62;
const DEFAULT_TURN_SPEED = 3.4;
/** She blinks on a natural irregular rhythm rather than a metronome. */
const BLINK_MIN_SECONDS = 2.6;
const BLINK_MAX_SECONDS = 6.4;
const BLINK_CLOSE_SECONDS = 0.07;
const BLINK_HOLD_SECONDS = 0.03;
const SEAT_SETTLE = 0.16;

/**
 * Drives Astra: animation playback, facial morphs, navigation, furniture
 * interactions and the idle scheduler.
 *
 * The high-level intention ("walk to the desk") is kept separate from the
 * low-level animation. Nothing outside this class issues renderer or OS
 * commands, and the local model never calls into it directly - chat lifecycle
 * events arrive through the React layer as plain events.
 */
export class CharacterController {
  private state: CharacterState = 'idle';
  private currentClip: THREE.AnimationAction | null = null;
  private currentClipName: string | null = null;
  private clipEndsAt = 0;

  private path: Waypoint[] = [];
  private pathIndex = 0;
  private destination: string | null = null;
  private seatId: string | null = null;

  private expression: CharacterMorph = STATE_EXPRESSION.idle;
  private morphWeights = new Map<string, number>();
  private nextBlinkAt = 2.5;
  private blinkStartedAt = 0;
  private blinking = false;

  private readonly scheduler: IdleScheduler;
  private readonly layout: RoomLayout;
  private readonly walkSpeed: number;
  private readonly turnSpeed: number;
  private readonly random: () => number;
  private readonly now: () => number;

  private transitions = 0;
  private idleActivities = 0;
  private blinkCount = 0;
  private disposed = false;

  constructor(
    private readonly asset: CharacterAsset,
    options: CharacterControllerOptions = {},
  ) {
    this.layout = options.layout ?? DEFAULT_ROOM;
    this.walkSpeed = options.walkSpeed ?? DEFAULT_WALK_SPEED;
    this.turnSpeed = options.turnSpeed ?? DEFAULT_TURN_SPEED;
    this.random = options.random ?? Math.random;
    // Must be a real clock: one-shot completion and blinking compare wall time.
    this.now = options.now ?? (() => performance.now() / 1000);
    const positions: Record<string, Vec2> = {};
    for (const waypoint of this.layout.waypoints) positions[waypoint.id] = waypoint.position;
    this.scheduler = new IdleScheduler({
      ...DEFAULT_IDLE_OPTIONS,
      destinations: this.layout.waypoints.filter((waypoint) => !isSeatApproach(waypoint.id)).map((waypoint) => waypoint.id),
      // Seats are offered separately: walking to one would sit her down, so
      // they must only appear in the pool for an explicit `sit`.
      seatDestinations: this.layout.waypoints.filter((waypoint) => isSeatApproach(waypoint.id)).map((waypoint) => waypoint.id),
      destinationPositions: positions,
      random: options.idleRandom ?? this.random,
    });

    const start = nearestWaypoint({ x: 0, z: 0 }, this.layout);
    this.asset.object.position.set(start.position.x, 0, start.position.z);
    this.asset.object.rotation.y = yawFromFacing(start.facing);
    this.waypoint = start.id;
    this.playClip(STATE_CLIP.idle, true);
    this.applyMorph(this.expression, 1);
    this.nextBlinkAt = this.random() * BLINK_MAX_SECONDS;
  }

  private waypoint: string;

  getState(): CharacterState {
    return this.state;
  }

  getSeat(): string | null {
    return this.seatId;
  }

  /** Public control surface used by the UI. */
  send(event: CharacterEvent): void {
    if (this.disposed) return;
    this.applyEvent(event);
  }

  setIdleEnabled(enabled: boolean): void {
    this.scheduler.setEnabled(enabled);
    if (enabled) return;
    // Stop where she is. Disabling idle activities must not make her walk:
    // if she is on a seat she still needs to stand up first.
    if (this.state === 'seated') {
      this.applyEvent('leave_seat');
      return;
    }
    this.clearPath();
    this.destination = null;
    this.enter('idle', this.state, 'go_to');
  }

  isIdleEnabled(): boolean {
    return this.scheduler.isEnabled();
  }

  /** Return to the middle of the room and face the user. */
  returnToCentre(): void {
    this.send('user_center');
    this.beginJourney('centre');
  }

  wave(): void {
    this.send('user_wave');
  }

  update(deltaSeconds: number): void {
    if (this.disposed) return;
    const clamped = Math.min(deltaSeconds, 0.1);
    this.asset.mixer.update(clamped);
    this.updateBlink(clamped);
    this.updateNavigation(clamped);
    this.updateIdleScheduler(clamped);
    this.updateOneShotCompletion();
  }

  dispose(): void {
    this.disposed = true;
    this.scheduler.reset();
    this.clearPath();
    this.asset.dispose();
  }

  getDiagnostics(): CharacterDiagnostics {
    const influences: Record<string, number> = {};
    for (const [name, weight] of this.morphWeights) influences[name] = Number(weight.toFixed(3));
    return {
      state: this.state,
      clip: this.currentClipName,
      destination: this.destination,
      waypoint: this.waypoint,
      position: { x: this.asset.object.position.x, z: this.asset.object.position.z },
      morphInfluences: influences,
      transitions: this.transitions,
      idleActivities: this.idleActivities,
      blinkCount: this.blinkCount,
    };
  }

  // ------------------------------------------------------------- internals

  private applyEvent(event: CharacterEvent): void {
    const previousState = this.state;
    const after = nextState(previousState, event);
    this.transitions += 1;
    if (after === previousState && event !== 'user_wave') return;
    this.enter(after, previousState, event);
  }

  private enter(state: CharacterState, previousState: CharacterState, event: CharacterEvent): void {
    this.state = state;

    switch (state) {
      case 'turning':
        // Only abandon the route if none was planned. beginJourney() enters
        // 'turning' *after* assigning the path, so clearing unconditionally
        // would delete the journey that was just planned.
        if (this.path.length === 0) this.clearPath();
        this.playClip(state === 'turning' ? STATE_CLIP.turning : STATE_CLIP.idle, false);
        break;
      case 'walking':
        this.playClip(STATE_CLIP.walking, true);
        break;
      case 'sitting_down':
        this.playClip(STATE_CLIP.sitting_down, false);
        this.snapToFacing(this.destination ?? this.waypoint);
        break;
      case 'standing_up':
        this.playClip(STATE_CLIP.standing_up, false);
        break;
      case 'seated':
        this.seatId = this.destination;
        this.playClip(STATE_CLIP.seated, true);
        break;
      case 'interacting':
        this.playClip(STATE_CLIP.interacting, true);
        break;
      case 'waving':
        this.playClip(STATE_CLIP.waving, false);
        break;
      case 'listening':
      case 'thinking':
      case 'speaking':
        // Chat has priority, but she keeps walking or sitting where she is so
        // the conversation never teleports her.
        if (isChatDriven(state) && previousState !== 'walking') this.clearPath();
        this.playClip(STATE_CLIP[state], true);
        break;
      case 'idle':
      default:
        this.playClip(STATE_CLIP.idle, true);
        if (event === 'chat_interrupted') this.returnToCentre();
        break;
    }
    this.applyMorph(STATE_EXPRESSION[state] ?? this.expression, 1);
  }

  private beginJourney(destination: string): void {
    const from = nearestWaypoint({ x: this.asset.object.position.x, z: this.asset.object.position.z }, this.layout);
    const route = planPath(from.id, destination, this.layout);
    if (!route || route.length === 0) {
      // 'go_to' rather than 'chat_interrupted': the latter would re-enter
      // returnToCentre and recurse if the centre is unreachable too.
      this.enter('idle', this.state, 'go_to');
      return;
    }
    this.destination = destination;
    this.path = route.slice(1);
    this.pathIndex = 0;
    this.waypoint = from.id;
    if (this.path.length === 0) {
      this.applyEvent('arrive');
      return;
    }
    this.enter('turning', this.state, 'go_to');
  }

  private clearPath(): void {
    this.path = [];
    this.pathIndex = 0;
    if (!isChatDriven(this.state)) this.destination = null;
  }

  private updateNavigation(deltaSeconds: number): void {
    if (this.state === 'turning') {
      const target = this.path[0];
      if (!target) {
        this.applyEvent('turn_done');
        return;
      }
      const reached = this.rotateToward(target.facing, deltaSeconds);
      if (reached) this.applyEvent('turn_done');
      return;
    }

    if (this.state === 'walking') {
      const target = this.path[this.pathIndex];
      if (!target) {
        this.finishWalk();
        return;
      }
      const position = this.asset.object.position;
      const dx = target.position.x - position.x;
      const dz = target.position.z - position.z;
      const remaining = Math.hypot(dx, dz);
      const step = this.walkSpeed * deltaSeconds;
      if (remaining <= step + 1e-4) {
        position.x = target.position.x;
        position.z = target.position.z;
        this.waypoint = target.id;
        this.pathIndex += 1;
        if (target.next && this.destination === target.next) {
          // Only the seat she is actually going to pulls her one step further.
          // Following every `next` link would drag her into a chair whenever
          // an unrelated route happened to pass the desk or the sofa.
          const onward = planPath(target.id, target.next, this.layout);
          if (onward && onward.length > 1) {
            this.path = onward.slice(1);
            this.pathIndex = 0;
            return;
          }
        }
        // More of the route remains: keep walking it. Treating every arrival
        // as the end of the walk stopped her at the first intermediate
        // waypoint, so she sat at the centre instead of reaching the desk.
        if (this.pathIndex < this.path.length) return;
        this.path = [];
        this.pathIndex = 0;
        this.finishWalk();
        return;
      }
      position.x += (dx / remaining) * step;
      position.z += (dz / remaining) * step;
      this.faceMovement(Math.atan2(dx, -dz), deltaSeconds);
      return;
    }

    if (this.state === 'sitting_down' && this.oneShotFinished()) this.applyEvent('sit_done');
    if (this.state === 'standing_up' && this.oneShotFinished()) {
      this.seatId = null;
      this.destination = null;
      this.applyEvent('stand_done');
      this.leaveSeatIfNeeded();
    }
  }

  private finishWalk(): void {
    if (this.destination && isSeatApproach(this.destination)) {
      this.waypoint = this.destination;
      this.snapToFacing(this.destination);
      this.applyEvent('sit_start');
      return;
    }
    if (this.destination && waypointById(this.destination, this.layout)) {
      this.waypoint = this.destination;
      this.snapToFacing(this.destination);
      this.applyEvent('activity');
      this.destination = null;
      return;
    }
    this.applyEvent('arrive');
  }

  private leaveSeatIfNeeded(): void {
    const centre = waypointById('centre', this.layout);
    if (!centre) return;
    this.beginJourney('centre');
  }

  private updateIdleScheduler(deltaSeconds: number): void {
    if (isChatDriven(this.state) || this.state === 'waving') {
      this.scheduler.reset();
      return;
    }
    const decision = this.scheduler.tick(deltaSeconds, {
      x: this.asset.object.position.x,
      z: this.asset.object.position.z,
    });
    if (!decision) return;
    this.idleActivities += 1;
    const activity = decision.activity;
    if (activity.kind === 'stay') {
      this.playClip(activity.clip, true);
      return;
    }
    if (this.state === 'seated') {
      if (activity.kind === 'sit' || activity.kind === 'interact') {
        this.playClip(STATE_CLIP.interacting, true);
        this.applyMorph('curious', 1);
        return;
      }
      // Anything that needs standing up ends the seated stretch.
      this.applyEvent('leave_seat');
      this.destination = activity.destination;
      return;
    }
    if (!isAutonomous(this.state) && this.state !== 'idle') return;
    this.destination = activity.destination;
    this.beginJourney(activity.destination);
  }

  private rotateToward(targetFacing: number, deltaSeconds: number): boolean {
    const current = this.currentFacing();
    const delta = angleDelta(current, targetFacing);
    const step = this.turnSpeed * deltaSeconds;
    if (Math.abs(delta) <= step) {
      this.asset.object.rotation.y = yawFromFacing(targetFacing);
      return true;
    }
    this.asset.object.rotation.y += Math.sign(delta) * step;
    return false;
  }

  private faceMovement(heading: number, deltaSeconds: number): void {
    // heading uses the same convention as the waypoint facings.
    this.rotateToward(heading, deltaSeconds);
  }

  private snapToFacing(waypointId: string): void {
    const waypoint = waypointById(waypointId, this.layout);
    if (waypoint) this.asset.object.rotation.y = yawFromFacing(waypoint.facing);
  }

  private currentFacing(): number {
    return Math.PI - this.asset.object.rotation.y;
  }

  private playClip(name: string, loop: boolean): void {
    const clip = this.asset.clips.get(name);
    if (!clip) return;
    const mixer = this.asset.mixer;
    const next = mixer.clipAction(clip);
    const previous = this.currentClip;
    if (previous && previous !== next) {
      next.reset();
      next.crossFadeFrom(previous, 0.22, false);
      next.play();
    } else {
      next.reset().play();
    }
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (loop || LOOPING_CLIPS.has(name as never)) next.setLoop(THREE.LoopRepeat, Infinity);
    else {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }
    this.currentClip = next;
    this.currentClipName = name;
    this.clipEndsAt = loop || LOOPING_CLIPS.has(name as never) ? Infinity : this.now() + clip.duration;
  }

  private oneShotFinished(): boolean {
    if (!ONE_SHOT_CLIPS.has(this.currentClipName as never)) return false;
    return this.now() >= this.clipEndsAt;
  }

  private updateOneShotCompletion(): void {
    // Completion is driven by the clip itself, not by stateHoldsClip: `waving`
    // holds its pose but still runs a one-shot `wave` clip that must finish.
    if (!this.oneShotFinished()) return;
    if (this.state === 'turning') this.applyEvent('turn_done');
    else if (this.state === 'waving') this.applyEvent('clip_finished');
  }

  private updateBlink(deltaSeconds: number): void {
    const time = this.now();
    if (!this.blinking && time >= this.nextBlinkAt) {
      this.blinking = true;
      this.blinkStartedAt = time;
      this.blinkCount += 1;
    }
    let value = 0;
    if (this.blinking) {
      const since = time - this.blinkStartedAt;
      if (since < BLINK_CLOSE_SECONDS) value = since / BLINK_CLOSE_SECONDS;
      else if (since < BLINK_CLOSE_SECONDS + BLINK_HOLD_SECONDS) value = 1;
      else if (since < BLINK_CLOSE_SECONDS + BLINK_HOLD_SECONDS + BLINK_CLOSE_SECONDS) {
        value = 1 - (since - BLINK_CLOSE_SECONDS - BLINK_HOLD_SECONDS) / BLINK_CLOSE_SECONDS;
      } else {
        this.blinking = false;
        value = 0;
        this.nextBlinkAt = time + BLINK_MIN_SECONDS + this.random() * (BLINK_MAX_SECONDS - BLINK_MIN_SECONDS);
      }
    }
    this.setMorph('blink', value);
    void deltaSeconds;
  }

  private applyMorph(name: CharacterMorph, weight: number): void {
    this.expression = name;
    for (const morph of CHARACTER_MORPHS) {
      if (morph === 'blink') continue;
      this.setMorph(morph, morph === name ? weight : 0);
    }
  }

  private setMorph(name: string, value: number): void {
    this.morphWeights.set(name, value);
    for (const entry of this.asset.morphMeshes) {
      const index = entry.indices.get(name);
      if (index === undefined) continue;
      const influences = entry.mesh.morphTargetInfluences;
      if (influences) influences[index] = value;
    }
  }
}

/**
 * Convert a navigation heading to an object yaw.
 *
 * Navigation headings are 0 = looking toward -Z, while the exported character
 * faces +Z, so the two differ by a half turn.
 */
export function yawFromFacing(facing: number): number {
  return Math.PI - facing;
}

export const CHARACTER_SEAT_EPSILON = SEAT_SETTLE;