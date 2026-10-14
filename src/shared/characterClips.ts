/**
 * Astra character asset contract.
 *
 * These names are the stable API between the Blender rig, the exported GLB and
 * the renderer. A future character version must keep providing every clip and
 * morph listed here, or the controller must degrade deliberately rather than
 * silently break.
 */

export const CHARACTER_ASSET_VERSION = 'v1';

/** Animation clips baked in Blender and exported to the GLB. */
export const CHARACTER_CLIPS = [
  'idle_breathing',
  'idle_weight_shift',
  'idle_look_around',
  'blink',
  'walk',
  'turn_left',
  'turn_right',
  'wave',
  'sit_down',
  'seated_idle',
  'stand_up',
  'thinking',
  'listening',
  'talking_gesture',
  'happy_reaction',
] as const;

export type CharacterClip = (typeof CHARACTER_CLIPS)[number];

/** Refuse an incomplete GLB before its controller can enter a stuck one-shot. */
export function missingRequiredCharacterClips(names: Iterable<string>): CharacterClip[] {
  const available = new Set(names);
  return CHARACTER_CLIPS.filter((name) => !available.has(name));
}

/** Morph targets driving the face. `vis_*` are speech-ready shapes. */
export const CHARACTER_MORPHS = [
  'happy',
  'smile',
  'curious',
  'thinking',
  'surprised',
  'listening',
  'vis_aa',
  'vis_ee',
  'vis_oo',
  'vis_ff',
  'blink',
] as const;

export type CharacterMorph = (typeof CHARACTER_MORPHS)[number];

/** Clips that loop seamlessly while the state persists. */
export const LOOPING_CLIPS: ReadonlySet<CharacterClip> = new Set([
  'idle_breathing',
  'idle_weight_shift',
  'idle_look_around',
  'seated_idle',
  'thinking',
  'listening',
  'talking_gesture',
  'walk',
]);

/** Clips that play once and then report completion. */
export const ONE_SHOT_CLIPS: ReadonlySet<CharacterClip> = new Set([
  'turn_left',
  'turn_right',
  'wave',
  'sit_down',
  'stand_up',
  'happy_reaction',
  'blink',
]);

/** Default clip used by each animation state. */
export const STATE_CLIP: Readonly<Record<string, CharacterClip>> = {
  idle: 'idle_breathing',
  walking: 'walk',
  turning: 'turn_left',
  sitting_down: 'sit_down',
  seated: 'seated_idle',
  standing_up: 'stand_up',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'talking_gesture',
  waving: 'wave',
  interacting: 'idle_weight_shift',
};

/** Default facial expression per state. */
export const STATE_EXPRESSION: Readonly<Record<string, CharacterMorph>> = {
  idle: 'smile',
  walking: 'smile',
  turning: 'curious',
  sitting_down: 'smile',
  seated: 'smile',
  standing_up: 'smile',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'happy',
  waving: 'happy',
  interacting: 'curious',
};
