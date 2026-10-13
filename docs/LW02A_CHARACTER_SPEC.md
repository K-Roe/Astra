# LW-02A Astra character design specification

Status: **historical. Superseded for design by `docs/LW02B_CHARACTER_SPEC.md` (LW-02B).** The
LW-02A blockout and its renders are preserved unchanged as the "before" record for the LW-02A to
LW-02B comparison. The procedural mannequin remains the application's working fallback, the design
still lacks Karl's approval, and no GLB or animation controller is integrated.

## Visual identity and proportion sheet

Design Astra as a young-adult stylised cartoon woman, roughly six to six-and-a-half head heights tall, with a stable upright silhouette and expressive rather than realistic anatomy. Use soft forms, a readable waist/hip transition and hands large enough to read a wave or point in the compact viewport. Avoid childlike four-head proportions, photoreal skin and exaggerated costume detail. Proposed palette: vivid violet hair, plum/purple hoodie, warm gold star, charcoal trousers, pale-soled casual trainers. Keep the star recognisable at compact size without a light-emitting material.

| View | Required landmarks and checks |
| --- | --- |
| Front | Loose purple updo, asymmetrical fringe, visible brows and eyes, friendly mischievous smile, centred hoodie star, separated arms/hands/legs and clear shoes. |
| Side | Face profile and nose, bun volume and stray locks, hood thickness, torso/hip depth, heel-to-toe trainer shape; no clipping through head or body. |
| Back | Full hair mass and bun, hoodie hood and seams, trouser silhouette and shoe heels. The character must still read as Astra without showing the star. |
| Three-quarter | Face, star, both hands and feet stay legible under room lighting and the desktop and compact cameras. |

Use one consistent scale in metres, with feet on the ground and local forward direction documented at export. The production artist should create orthographic front/side/back turnarounds from a single reference pose and one expressive pose before modelling details. Colour and fabric variation should survive low lighting and colour-blind contrast review. No existing assistant memories or biography are part of the asset.

## Proposed production asset and rig contract

Blender is the source of truth; export a versioned glTF 2.0 binary `.glb` for Three.js. Keep the editable `.blend`, texture sources, licence/provenance and exported GLB together in a reviewed asset package outside personal runtime data. Load the GLB from the local packaged application only. Avoid remote textures and runtime downloads. Validate scale, orientation, materials, clips, bounds and missing-resource fallback before replacing the mannequin. A GLB can carry skinned meshes, morph targets and named clips; the viewport should keep a deterministic fallback if loading fails.

Proposed skeleton: `root`/`hips`, lower and upper spine, chest, neck, head, left/right clavicle, upper arm, forearm and hand, thumb and finger chains, upper leg, lower leg, foot and toe. Include wrist rotation and enough finger joints for point, wave, grasp/hold and simple prop contact. Use consistent left/right naming and joint limits. Keep hair bun/fringe and hoodie drawstrings/hem on a few animator-controlled secondary bones or baked clips; no live cloth, hair or rigid-body simulation. The hood should not hide face controls or obstruct neck turns.

Facial controls should separate brows, lids/blink, eyeball gaze, cheeks, jaw and mouth. Minimum expression set: neutral, warm smile, mischievous smile, curious, thinking, concerned/error and delighted. Minimum mouth shapes for later lip-sync: closed/rest, open, wide, rounded, labial closure, teeth/lip contact and a few intermediate shapes; name and test shapes before any speech engine is connected. Eyes blink independently from head movement; gaze targets must clamp to natural angles. Fallback expressions must not imply listening or speaking while those services are absent.

Proposed clip set for a later approved phase: `idle_breath`, `blink`, `look_at`, `turn_head`, `wave`, `point`, `walk`, `sit_down`, `sit_idle`, `stand_up`, `reach`, `hold_book`, `read_book` and `error_recover`. Include start/end poses, loop flags, root-motion policy and cancellation points in clip metadata. Controller transitions should be explicit; no clip is implemented in LW-02A.

Initial **review budgets, not acceptance claims**: aim for at most ~30,000 character triangles, two 1024² or smaller texture atlases where materials need images, restrained transparent materials, and a packaged GLB around 20 MB or less. Share materials across parts and keep draw calls low enough to meet the measured 30 fps scene target while Gemma generates. Re-evaluate these budgets on Karl's RTX 3050 8 GB, Ryzen 5 5500 and 16 GB RAM after an actual skinned/animated GLB exists. GPU-wide `nvidia-smi` memory does not reveal the GLB's own allocation.

## LW-02A design prototype

`scripts/blender/create_astra_design_prototype.py` procedurally builds a **non-rigged design blockout** and renders five views using local Blender 5.2 EEVEE. It has the purple updo/fringe, face, star hoodie, full body, shoes and a waved pose. It does **not** have final adult proportions, skin weights, facial shape keys, animation clips, optimised geometry, GLB export or Karl's visual approval. The current front render reads somewhat toy-like because the head/eyes and rounded torso are large; Karl should decide how far to shift toward a six-head, young-adult silhouette before production modelling. The back hair/hood and finger shapes are also simplified. Those are design questions, not accepted final details.

Review the five `docs/review/lw02a/astra-design-prototype-*.png` images together. The generated editable `.blend` is at ignored `test-results/lw02a/design/astra-design-prototype-neutral.blend`; regenerate it with:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/blender/create_astra_design_prototype.py
```

Karl's visual decision should cover age/proportions, face and hair silhouette, star/hoodie shape, hands, shoes, palette and whether front/side/back/three-quarter match. Only an approved reference sheet should feed a later production rig. Keep the current mannequin until that later asset passes GLB, animation, camera, performance and fallback gates.
