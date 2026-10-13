# LW-02B Astra refined character specification

Status: **design proposal awaiting Karl's visual approval. Not accepted art, not a rig, not integrated.**
The application still renders the labelled procedural mannequin from LW-01. No GLB, armature, skin
weights, shape keys or animation clips exist anywhere in this project. LW-02B produced a better
*design* and a written *plan* for the asset; it deliberately produced no production asset.

## 1. What changed from LW-02A

| Aspect | LW-02A blockout | LW-02B refined design |
| --- | --- | --- |
| Overall height / proportion | ~3.5 heads, oversized head | 1.70 m, head unit 0.295 m, **5.76 heads** |
| Body construction | Stacked spheres and bevelled cylinders | Lofted elliptical sections per limb with smooth subdivision |
| Head | Large sphere with a scaled parent group | Elliptical skull loft with jaw taper, narrower cranium, wider cheekbone |
| Face | Flat ovals pasted on a sphere | Landmarks computed from the skull surface table, almond eye whites with raised lid lines, tapered brows, slim nose bridge, asymmetric mischievous smile |
| Hair | Solid helmet with lumps | Fitted cap hugging the skull, back layer, gathered loose updo at the crown's back edge, swept fringe clearing the brows, slim face framing set behind the cheek |
| Hands | Four straight cylinder fingers, no thumb, wrong fan axis | Palm plus knuckle pad, four relaxed three-part fingers fanned across the **width** axis, opposed two-part thumb |
| Torso | Ball torso | Sectioned torso with waist cinch, shoulder yoke, ribbed hem, collar, small hood, kangaroo pocket, drawstrings with aglets |
| Star emblem | Flat mesh floating off the chest | Flat mesh conformed to the chest ellipse with a darker edging star behind it |
| Trousers | Wide blocky segments | Sectioned legs with hip, thigh, knee, calf and ankle taper plus ribbed cuffs |
| Trainers | Two ellipsoids | Sectioned upper with toe box, separate sole slab, heel counter, tongue and laces |
| Geometry | not recorded | **32,588 triangles across 118 objects** (printed by the script) |

The LW-02A script and its five renders are preserved unchanged as the "before" record.

## 2. Proportion sheet (metres, character faces -Y, up +Z)

| Landmark | Height | Note |
| --- | --- | --- |
| Ground | 0.000 | Feet on z = 0 |
| Ankle / trouser cuff | 0.165 | |
| Knee | 0.490 | |
| Crotch | ~0.860 | 50.6% of height |
| Hip | 0.945 | Trouser top, half-width 0.098 |
| Waist | 1.115 | Narrowest torso ring |
| Bust | 1.235 | Star emblem centred at 1.268 |
| Shoulder | 1.342 | Shoulder half-width 0.160 |
| Neck | 1.335-1.420 | Radius ~0.050 |
| Chin | 1.395 | Head bottom |
| Mouth | 1.442 | |
| Nose base | 1.460 | |
| Eye centre | 1.536 | Eye spacing ±0.036 |
| Brow | 1.573 | |
| Crown | 1.690 | Top of skull; hair and updo reach ~1.726 |
| Total with hair | ~1.73 | |

Derived ratios: shoulder width 0.320 m ≈ 1.86 head widths (0.172 m); eye line at 45% of head height
above the chin; waist at 65.6% of height; crotch at 50.6%. These are stylised but anatomically
plausible and intentionally avoid both chibi and photoreal territory.

## 3. Palette

| Element | Linear RGB | Intent |
| --- | --- | --- |
| Hair | 0.38, 0.10, 0.66 | Vibrant violet, readable at compact size |
| Hoodie | 0.30, 0.13, 0.55 | Purple, slightly deeper than the hair |
| Hoodie lining / ribbing | 0.48, 0.30, 0.70 / 0.24, 0.10, 0.44 | Separation without new hues |
| Star emblem | 1.00, 0.76, 0.28 | Warm gold, the single high-contrast accent |
| Trousers | 0.070, 0.062, 0.100 | Charcoal plum, reads as dark from the front |
| Trainers | 0.58, 0.46, 0.76 | Lavender with darker panels and a mid sole |
| Skin | 0.90, 0.66, 0.56 | Warm peach, no subsurface realism |

Rendering uses EEVEE with a Standard view transform, one soft key, a violet rim and a weak face fill,
so review renders are comparable across runs.

## 4. Animation readiness — proposed skeleton

This is a **proposed** rig for a later approved phase. No armature exists yet. Names follow glTF
conventions so bones map directly to Three.js `Bone` nodes.

```
root                              world origin, character faces -Z in glTF export
└ hips
  ├ spine_lower
  │ └ spine_mid
  │   └ chest
  │     ├ neck
  │     │ └ head
  │     │   ├ head_top
  │     ├ clavicle.L / clavicle.R
  │     │ └ shoulder.L / shoulder.R
  │     │   └ upperarm.L / upperarm.R
  │     │     └ lowerarm.L / lowerarm.R
  │     │       └ hand.L / hand.R
  │     │         ├ thumb_01..02 .L/.R
  │     │         ├ index_01..03 .L/.R
  │     │         ├ middle_01..03 .L/.R
  │     │         ├ ring_01..03 .L/.R
  │     │         └ pinky_01..03 .L/.R
  │     ├ hood_ctrl                     secondary, baked clips only
  │     └ hair_bun_ctrl                 secondary, baked clips only
  ├ thigh.L / thigh.R
  │ └ shin.L / shin.R
  │   └ foot.L / foot.R
  │     └ toe.L / toe.R
```

Bone count ≈ 45. This covers every motion in the milestone list:

| Required motion | Bones used | Notes |
| --- | --- | --- |
| Walking | hips, thigh, shin, foot, toe, chest, upperarm | Cycle clip; no root motion, in-place with an external offset |
| Sitting | hips, thigh, shin, foot | `sit_down` / `sit_idle` / `stand_up`; needs a seat target in the room |
| Turning | hips, spine chain, chest, neck, head | In-place `turn_left`/`turn_right` plus head turns |
| Waving | shoulder, upperarm, lowerarm, hand, fingers | Upper-arm raise plus a forearm-driven wave; fingers relax |
| Pointing | upperarm, lowerarm, hand, index finger | Index-only finger curl |
| Picking up an object | hips, spine, chest, shoulder, upperarm, lowerarm, hand, fingers | Needs an object-relative target and a grasp pose |
| Head tilting | neck, head | `head_tilt_left/right`, clamped |
| Blinking | eyelid morph targets | Independent of head motion |
| Eye movement | eyeball bones `eye.L/R` | Gaze clamped to natural angles |
| Expression changes | brow, lid, cheek, jaw, mouth morph targets | See section 5 |
| Lip-sync (future) | jaw, lip corner, lip upper/lower morph targets | Not connected to any audio in LW-02B |
| Idle gestures/activities | full chain | Weight shift, shoulder roll, hair settle via baked clips |

No cloth, hair or rigid-body simulation is proposed. The hood, hem and updo move only through
animator-set secondary bones or baked clips.

## 5. Facial controls

Separate brows, lids/blink, eyeball gaze, cheeks, jaw and mouth so expressions and speech stay
independent.

**Shape keys (proposed, named for stability):**
`blink`, `blink_half`, `brow_neutral`, `brow_raised`, `brow_furrowed`, `smile_warm`,
`smile_mischief`, `mouth_open`, `mouth_wide`, `mouth_round`, `mouth_closed`, `lip_contact`,
`jaw_open`, `cheek_smile`, `cheek_squint`.

**Minimum expression set:** neutral, warm smile, mischievous smile (her default), curious,
thinking, concerned/error, delighted.

**Minimum mouth-shape set for later lip-sync:** closed/rest, open, wide, rounded, labial closure,
teeth/lip contact, plus two intermediates. Shapes must be named and tested before any speech
engine is connected. Fallback expressions must never imply listening or speaking while those
services are absent.

## 6. Blender to GLB export plan

1. **Source of truth:** the `.blend`, kept with texture sources, licence/provenance and exported
   `.glb` in one reviewed asset package outside runtime data and outside this repository's
   `test-results/` working copy.
2. **Authoring build:** the refined blockout is generated by
   `scripts/blender/create_astra_character_refined.py`. For the production asset this script becomes
   the proportion reference, not the mesh generator.
3. **Retopology and rigging:** quad retopology to a target of ≤ 30,000 triangles, two-bone weights
   for limbs with smooth falloff on the torso and head; armature from the section 4 skeleton.
4. **Export settings:** glTF 2.0 binary `.glb`; +Y up; apply modifiers; no linked libraries; UVs on
   the body and face; morph targets as blend shapes; named animation clips; Draco compression only
   if it can be decoded locally by three.js without a runtime download.
5. **Textures:** two 1024² atlases maximum. Embed or place beside the `.glb` inside the packaged
   application. **No remote textures and no runtime downloads.**
6. **Versioning:** `astra-character-<version>.glb` plus a manifest recording triangle count, clip
   list, morph-target list and bone count. The renderer keeps a deterministic fallback to the
   procedural mannequin if the asset is missing, malformed or fails validation.
7. **Validation before integration:** scale/orientation check, bounds check, material and clip
   review, and a measured performance run against the LW-02A baseline (30 fps target while Gemma
   generates).

Budgets remain **review targets, not acceptance claims:** ≤ 30,000 triangles, ≤ 2 × 1024² atlases,
≤ 20 MB packaged `.glb`, few draw calls. Re-evaluate on the RTX 3050 8 GB once a real skinned
asset exists; whole-GPU `nvidia-smi` cannot attribute VRAM to the scene.

## 7. Review evidence

Under `docs/review/lw02b/` (regenerate with the commands in `README.md`):

| File | View |
| --- | --- |
| `astra-lw02b-front.png` | Front, neutral standing |
| `astra-lw02b-left-side.png` | Character's left side |
| `astra-lw02b-back.png` | Back |
| `astra-lw02b-three-quarter.png` | Three-quarter, neutral |
| `astra-lw02b-waving.png` | Three-quarter, friendly waving pose |
| `astra-lw02b-room.png` | Neutral standing in a restrained echo of the application room |
| `astra-lw02b-comparison-lw02a-vs-lw02b.png` | LW-02A versus LW-02B side by side |

The editable blockout is written to ignored `test-results/lw02b/design/astra-lw02b-character.blend`.

## 8. Known weaknesses and open design questions for Karl

These are deliberate, and none of them is fixed without Karl's direction:

- The gathered updo reads as a compact knot from the front. It may want to be larger and looser, or
  moved fully to the back.
- The face framing locks read as a single purple strip beside the cheek in profile.
- The hood is a collar-down volume; it is not a raised hood and reads small from behind.
- Fingers are simple tapered capsules without knuckles or nails, and hold one relaxed pose.
- The shoe toe box is still somewhat blocky in profile.
- Materials are flat colour with no texture, so the star and hoodie have no fabric depth.
- Joints are smooth with no visible articulation, which flatters the silhouette but hides how the
  design behaves in motion.

Karl's decision should cover: overall proportions and head size, the updo shape, hood, hair framing,
hand and shoe detail, palette saturation, and whether the design is close enough to move to a
production rig. **Nothing in this document or the blockout may be described as approved until he
says so.**