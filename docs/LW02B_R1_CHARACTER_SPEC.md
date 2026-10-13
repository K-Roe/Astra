# LW-02B-R1 Astra refined character specification

Status: **design proposal awaiting Karl's visual approval. Not accepted art, not a rig, not integrated.**
There is no armature, no skin weights, no facial shape keys, no animation clips and no GLB anywhere in
this project. The application still renders the labelled procedural mannequin from LW-01. This
document records what was built, what it measures, how it will and will not deform, and what must
happen next.

Supersedes `LW02B_CHARACTER_SPEC.md` for design direction; `LW02A_CHARACTER_SPEC.md` is historical.

## 1. What changed and why

LW-02B's core failure was structural, not stylistic: the face was **assembled from separate floating
primitives** — an eye-white ellipsoid, a lid ellipsoid, a nose tip ellipsoid, a lip strand — pasted onto
a smooth skull. No amount of shading or polish fixes that, because the features have no relationship
to the surface they sit on.

LW-02B-R1 rebuilds the head as **one continuous sculpted mesh**. A shared landmark table defines the
skull, and facial features are displaced into that skull:

| Feature | LW-02B | LW-02B-R1 |
| --- | --- | --- |
| Face construction | Separate blobs on a smooth ellipsoid | Single displaced mesh: sockets, brow ridge, nose, lips, cheekbones, jaw softening, chin, philtrum |
| Eye sockets | None — eyes sat on the surface | Real depressions (~9 mm) that the eyeballs sit inside |
| Eyes | Flattened ellipsoids, protruding | Spheres seated in sockets with a natural ~5 mm corneal bulge |
| Eyelids | Thin ellipsoid strips | Lids lofted along the eyeball aperture, wrapping it, plus a lash line |
| Irises/pupils | Separate small spheres | Placed proud of the eyeball surface (an early build buried them inside and they were invisible) |
| Nose | Bridge tube + tip ball, projecting far | Sculpted bridge resolving into a small soft tip with nostril wings |
| Mouth | Four loose pieces | Sculpted upper and lower lips **straddling** a seam, with a thin lip line |
| Eyebrows | Peaked arcs reading as startled | Relaxed asymmetric arch on the brow ridge, with a tail |
| Hair | Rounded helmet masses with stray spikes | Full crown, back layer, gathered bun with a twist, two lofted side-swept fringe bands |
| Shoulders | Ball deltoid caps reading as pads | Deltoid merged into the torso yoke |
| Hood | Bulky, backpack-like from behind | Narrow collar-down hood reading as fabric between the shoulders |
| Pocket | Protruding ellipsoid | Surface-conformed shallow band |
| Trainers | Thick clog-like soles | Thinner tapered sole with a rising toe |

Two genuine defects were found by inspecting renders and fixed: facial landmarks placed
independently of the skull surface, and irises/pupils positioned *inside* the eyeball so they were
invisible.

## 2. Geometry and material statistics

Reported by the script itself (`ASTRA_R1_GEOMETRY`, `ASTRA_R1_DIMENSIONS`, `ASTRA_R1_VALIDATE`):

| Metric | Value |
| --- | --- |
| Triangles | **40,232** |
| Objects | **129** |
| Materials | **24** |
| Bounding box | width 0.5184 m, depth 0.3696 m, height **1.7498 m** |
| Head unit | 0.3120 m (chin 1.3900 → crown 1.7020) |
| Implied stature | ≈ 5.6 heads (head slightly larger than LW-02B's 5.76, which reads friendlier) |
| Feet | on z = 0 |
| Validation problems | **0** |

**Render settings:** Blender 5.2.0 LTS, EEVEE, Standard view transform with no look, orthographic
review camera (ortho scale 2.05 full body, 0.62 close-up), 760×1000 full body / 760×760 face /
1000×760 room, 4-point area lighting (key 120, rim 60, face fill 26, bounce 12) identical across
every review render.

**Note on the triangle budget:** 40,232 exceeds the ≤ 30,000 production target recorded in the
LW-02B spec. That budget applies to a retopologised production asset, not to this blockout, and the
figure is inflated by the 34×96 sculpted head and the many small lofted detail pieces that
retopology would merge. It is reported honestly rather than presented as meeting the budget.

## 3. Materials

24 flat-colour materials, no textures. Skin uses subsurface weight 0.14 for soft dimensional
shading; hair and fabric carry sheen weight for a non-plastic response; eyes use low roughness.
Lighting is deliberately dimmer than LW-02B (key 190 → 120) because AgX-free Standard rendering was
washing the palette out.

## 4. Review renders

Under `docs/review/lw02b-r1/`. Regenerate all of them with:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup `
    --python scripts/blender/create_astra_character_r1.py
```

| File | View |
| --- | --- |
| `astra-front.png` | Full-body front, neutral |
| `astra-side.png` | Full-body side |
| `astra-back.png` | Full-body back |
| `astra-three-quarter.png` | Full-body three-quarter |
| `astra-face-front.png` | Close-up facial review |
| `astra-face-three-quarter.png` | Close-up facial review |
| `astra-smile.png` | Mischievous-smile expression |
| `astra-waving.png` | Raised-hand waving pose |
| `astra-comparison.png` | LW-02B versus LW-02B-R1, side by side |
| `astra-room-preview.png` | Standing in a restrained echo of the application room |

Editable source: ignored `test-results/lw02b-r1/design/astra-lw02b-r1-character.blend`, written by
the script. Blender source: `scripts/blender/create_astra_character_r1.py`.

## 5. Validation performed

The script runs an automated pass before rendering and reports `ASTRA_R1_VALIDATE problems=0`. It
checks, for every mesh object:

- unique, non-empty object names;
- finite location/rotation/scale values and no zero-scale objects;
- at least one material assigned per object;
- no degenerate (zero-area) faces;
- no duplicate vertices within 1e-6;
- no object whose polygons are predominantly inward-facing (inverted normals).

Limit, stated honestly: this is a **static integrity check, not a mesh-intersection test**. There is
no automated interpenetration or self-collision detection, and skinning behaviour cannot be tested
because no rig exists. Where geometry overlaps — hair masses over the skull, the fringe bands over
the forehead, the hood over the shoulders — that is intentional layering verified by eye.

## 6. Animation readiness

The bone hierarchy in `LW02B_CHARACTER_SPEC.md` §4 still applies: ~45 glTF-named bones covering
`hips → spine_lower → spine_mid → chest → neck → head`, clavicle/shoulder/upperarm/lowerarm/hand with
three phalanges per finger, thigh/shin/foot/toe, plus `hood_ctrl` and `hair_bun_ctrl` as secondary
bones for baked clips. Suitability per motion:

| Motion | Readiness | Note |
| --- | --- | --- |
| Walking | Good | Legs are single lofted sections with hip, thigh, knee, calf and ankle taper; the knee is the only high-curvature region |
| Turning | Good | Torso is a single section with a waist cinch that will read well under spine rotation |
| Sitting / standing | Good, needs a seat target | Hip blend merges trousers to torso cleanly |
| Waving | Good | Shoulder/upperarm/lowerarm/hand chain is cleanly separable; wrist rotation supported |
| Pointing | Good | Index finger is an independent three-segment chain |
| Picking up objects | Adequate | Thumb and index oppose well; the palm is a single ellipsoid so a grasp will read, but a dedicated thumb-root joint may be needed |
| Head tilting | Good | Neck is a separate lofted section |
| Eye movement / blinking | Good | Eyeballs are separate spheres; lids are separate wrap geometry that can be morphed or keyframed |
| Expressions | **Partial** | Only two expressions exist (neutral, mischievous smile) as displacement parameters. Real facial animation needs shape keys. |
| Lip-sync | **Not ready** | Requires mouth shape keys on a topology that currently has no mouth separation |
| Idle movements | Good | Weight shifts and shoulder rolls need no extra topology |

### Geometry likely to deform poorly

These need attention at retopology time — they are the honest weak points:

1. **The sculpted face is a single closed shell.** Displacing it for expressions is not possible
   without shape keys on a subdivided, eyelid-separated mesh. The eye region in particular must be
   separated into upper lid, lower lid and eyeball vertex groups before any blink or gaze animation.
2. **Overlapping hair masses** (crown, back layer, bun, two fringe bands, cheek framing, temple
   sweeps, wisps) are separate closed shells that intersect. Weighting them to a shared `hair_ctrl`
   bone will make the intersections visible as sliding seams during head turns. Either join and
   remesh the hair into one shell, or parent the masses rigidly to different secondary bones and
   accept no independent hair motion.
3. **Fingers are single tapered tubes** with no knuckle joints in the mesh. Curl animation will
   crease badly at the joints; each phalanx needs its own vertex group and ideally a bend loop.
4. **The star emblem is a flat n-gon** lying on the chest. It will not follow a deforming chest; it
   needs conforming to the torso surface at export.
5. **The hood and hoodie are separate shells.** If the hood should lift with the shoulders, its
   weights must be authored against the shoulder bones rather than the spine.
6. **The hand is one ellipsoid plus finger tubes** with no wrist seam, so wrist rotation will pinch.

### Recommended topology changes before rigging

- Retopologise to quads targeting ≤ 30,000 triangles; merge the 129 objects down to a small number
  of material groups.
- Split the face into `head`, `eyelid_upper.L/R`, `eyelid_lower.L/R` vertex groups around the aperture.
- Join and remesh the hair into one shell, or keep the masses as rigid children of `head` with a
  single `hair_ctrl` bone for settle motion.
- Add a wrist seam loop and two bend loops per finger.
- Conform the star emblem to the chest surface and merge it into the hoodie mesh group.
- Add vertex groups mirroring the §4 bone hierarchy before any weight painting.

## 7. Performance considerations

Not measured in the application, because the character is **not** in the application. Expected real-time
cost when it eventually is: the current procedural mannequin draws 37 calls / 4,860 triangles at
30 fps while Gemma generates. A production Astra at ≤ 30,000 triangles, one skinned body mesh plus
head, hair and eye groups, would be roughly 3–4× the triangle count and similar draw-call order
(10–20 calls with shared materials), which is comfortably within the RTX 3050 8 GB alongside Gemma
3 4B. Whole-GPU `nvidia-smi` cannot attribute VRAM to the scene, so no VRAM claim is made. Skinning
cost is the real unknown: vertex count, not triangle count, dominates GPU skinning time.

## 8. Known remaining weaknesses

Stated plainly so Karl can judge them:

- Materials are flat colour with no textures, so the star, hoodie and hair have no fabric or fibre depth.
- The mischievous smile is restrained — a closed-lip smirk, not a broad grin.
- The face is nearly symmetric; only the mouth corner rise is asymmetric.
- Fingers have no knuckles, nails or joints in the mesh.
- Overlapping hair masses show intersection seams from some angles.
- The cheek framing hair still reads as a distinct lock in profile.
- The bun is compact rather than generously loose.
- The star emblem is a flat mesh with no thickness.
- No rig, so none of the deformation risks above have been empirically confirmed.

## 9. Next step

Karl reviews `docs/review/lw02b-r1/`, starting with `astra-comparison.png`, `astra-face-front.png`
and `astra-face-three-quarter.png`. **Do not rig, export a GLB, integrate the character or begin
LW-02C without his approval.** If he approves the direction, the recommended next milestone is
LW-02C: retopologise to the production budget, add the vertex groups listed in §6, author the
proposed skeleton and morph targets, export a versioned local `.glb`, and measure it against the
30 fps scene baseline with the mannequin retained as a deterministic fallback.