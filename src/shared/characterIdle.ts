/**
 * Lightweight idle activity scheduler.
 *
 * Astra should feel alive between conversations, but this is a bounded local
 * scheduler over a fixed set of approved actions - not intelligence, not
 * boredom, and never a source of extra model calls. Pure logic with an
 * injected clock and random source so it is deterministic under test.
 */

export type IdleActivity =
  | { readonly kind: 'stay'; readonly clip: 'idle_look_around' | 'idle_weight_shift' | 'idle_breathing' }
  | { readonly kind: 'walk'; readonly destination: string }
  | { readonly kind: 'sit'; readonly destination: string }
  | { readonly kind: 'interact'; readonly destination: string };

export interface IdleSchedulerOptions {
  readonly enabled: boolean;
  /** Seconds between activity decisions. */
  readonly intervalSeconds: number;
  /** Probability a decision actually changes what she is doing. */
  readonly activityChance: number;
  /** Destinations the scheduler may choose, as waypoint ids. */
  readonly destinations: readonly string[];
  /** Seat waypoints used only for `sit`. Empty means sitting is unavailable. */
  readonly seatDestinations?: readonly string[];
  /** Floor positions for those destinations, used to prefer nearby choices. */
  readonly destinationPositions?: Readonly<Record<string, { readonly x: number; readonly z: number }>>;
  readonly random: () => number;
}

export const DEFAULT_IDLE_OPTIONS: Omit<IdleSchedulerOptions, 'random'> = {
  enabled: true,
  intervalSeconds: 14,
  activityChance: 0.55,
  destinations: ['desk_front', 'sofa_front', 'front_left', 'front_right', 'shelf_front', 'centre'],
};

export interface IdleDecision {
  readonly activity: IdleActivity;
  /** True when the scheduler deliberately did nothing. */
  readonly held: boolean;
}

/**
 * Stateful scheduler. It never repeats the previous activity, prefers to stay
 * where she is most of the time, and yields completely when disabled.
 */
export class IdleScheduler {
  private previous: IdleActivity | null = null;
  private remaining = 0;

  constructor(private options: IdleSchedulerOptions = { ...DEFAULT_IDLE_OPTIONS, random: Math.random }) {
    this.options = { ...options };
    // Wait a full interval before the first decision so she settles on launch
    // instead of immediately wandering off.
    this.remaining = this.options.intervalSeconds;
  }

  setEnabled(enabled: boolean): void {
    this.options = { ...this.options, enabled };
  }

  isEnabled(): boolean {
    return this.options.enabled;
  }

  getOptions(): Readonly<IdleSchedulerOptions> {
    return this.options;
  }

  /**
   * Forget the last activity and restart the waiting period. Resetting to a
   * zero timer would make her pick a new activity on the very next frame,
   * which is what happens straight after a wave or a chat reply.
   */
  reset(): void {
    this.previous = null;
    this.remaining = this.options.intervalSeconds;
  }

  /**
   * Advance by elapsed seconds. Returns a decision when one is due, otherwise
   * null so the caller can keep the current clip running untouched.
   */
  tick(deltaSeconds: number, _currentPosition: { readonly x: number; readonly z: number }): IdleDecision | null {
    if (!this.options.enabled) return null;
    this.remaining -= deltaSeconds;
    if (this.remaining > 0) return null;
    this.remaining = this.options.intervalSeconds;
    return this.decide(_currentPosition);
  }

  /** Force a decision now, ignoring the timer. */
  decide(currentPosition: { readonly x: number; readonly z: number }): IdleDecision {
    if (!this.options.enabled) {
      const hold: IdleDecision = { activity: { kind: 'stay', clip: 'idle_breathing' }, held: true };
      return hold;
    }
    if (this.options.random() >= this.options.activityChance) {
      const hold: IdleDecision = {
        activity: { kind: 'stay', clip: this.options.random() < 0.5 ? 'idle_look_around' : 'idle_weight_shift' },
        held: true,
      };
      return hold;
    }

    // Prefer somewhere nearby so she does not cross the room constantly.
    const roll = this.options.random();
    const kind: IdleActivity['kind'] = roll < 0.22
      ? 'stay'
      : roll < 0.42
        ? 'interact'
        : roll < 0.70
          ? 'walk'
          : 'sit';

    // Sitting needs an actual seat; walking and loitering use open floor.
    const pool = kind === 'sit' ? this.seatPool(currentPosition) : this.openPool(currentPosition);
    const pick = pool[Math.floor(this.options.random() * pool.length)] ?? 'centre';
    const activity: IdleActivity =
      kind === 'stay'
        ? { kind: 'stay', clip: 'idle_look_around' }
        : { kind, destination: pick };
    // Avoid an immediate repeat so she never appears to loop one behaviour.
    if (this.sameAsPrevious(activity)) {
      const alternative: IdleActivity = { kind: 'stay', clip: 'idle_weight_shift' };
      this.previous = alternative;
      return { activity: alternative, held: false };
    }
    this.previous = activity;
    return { activity, held: false };
  }

  /** Rank a destination list by proximity, usually limiting it to the nearest half. */
  private rank(ids: readonly string[], currentPosition: { readonly x: number; readonly z: number }): string[] {
    const ranked = ids
      .filter((id) => id !== 'centre')
      .map((id) => {
        const spot = this.options.destinationPositions?.[id];
        const range = spot ? Math.hypot(spot.x - currentPosition.x, spot.z - currentPosition.z) : 0;
        return { id, range };
      })
      .sort((a, b) => a.range - b.range);
    if (ranked.length === 0) return ['centre'];
    const nearbyCount = Math.max(1, Math.ceil(ranked.length / 2));
    return (this.options.random() < 0.65 ? ranked.slice(0, nearbyCount) : ranked).map((entry) => entry.id);
  }

  private openPool(currentPosition: { readonly x: number; readonly z: number }): string[] {
    return this.rank(this.options.destinations, currentPosition);
  }

  private seatPool(currentPosition: { readonly x: number; readonly z: number }): string[] {
    const seats = this.options.seatDestinations ?? [];
    // With no registered seats, fall back to open floor so a `sit` roll never
    // silently degrades into nothing.
    return seats.length > 0 ? this.rank(seats, currentPosition) : this.openPool(currentPosition);
  }

  private sameAsPrevious(activity: IdleActivity): boolean {
    if (!this.previous) return false;
    if (this.previous.kind !== activity.kind) return false;
    if (activity.kind === 'stay' && this.previous.kind === 'stay') return this.previous.clip === activity.clip;
    if ('destination' in activity && 'destination' in this.previous) return this.previous.destination === activity.destination;
    return false;
  }
}