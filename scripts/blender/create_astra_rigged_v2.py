"""Build an LW-03 *preview* character on the existing rig and clip pipeline.

The requested reference image was unavailable when this preview was authored.
Its silhouette follows the written brief; Karl must review the real renders
before it may replace V1 as the default. No external textures or downloads.
"""

import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import astra_character_model as model
import create_astra_rigged_v1 as rig


ellipsoid_v1 = model.ellipsoid


def ellipsoid_v2(name, location, scale, surface, segments=24, rings=16):
    # Keep the face topology identical for every morph expression while
    # avoiding separate pink cheek beads and protruding iris discs.
    if name.startswith("Cheek blush"):
        return None
    if name.startswith(("Iris ", "Iris colour", "Pupil ")):
        location = (location[0], location[1] - .0017, location[2])
        scale = (scale[0], .0031, scale[2])
    return ellipsoid_v1(name, location, scale, surface, segments, rings)


model.ellipsoid = ellipsoid_v2


def recolor(surface, rgb):
    surface.diffuse_color = (*rgb, 1)
    surface.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1)


recolor(model.hair, (0.27, 0.13, 0.095))
recolor(model.hair_deep, (0.15, 0.07, 0.06))
recolor(model.hair_light, (0.39, 0.23, 0.17))
recolor(model.hoodie, (0.035, 0.034, 0.048))
recolor(model.hoodie_fold, (0.022, 0.021, 0.032))
recolor(model.hoodie_light, (0.077, 0.069, 0.088))
recolor(model.trousers, (0.28, 0.10, 0.42))
recolor(model.trousers_fold, (0.18, 0.055, 0.31))
recolor(model.trainers, (0.035, 0.032, 0.044))
recolor(model.trainer_panel, (0.060, 0.054, 0.074))
recolor(model.soles, (0.025, 0.025, 0.031))
recolor(model.laces, (0.13, 0.12, 0.15))


def hair_v2():
    """Layered crown, gathered high ponytail and loose cheek-framing locks."""
    model.loft("Hair crown", [
        (Vector((0, 0.01, 1.57)), .10, .11),
        (Vector((0, 0.02, 1.64)), .105, .12),
        (Vector((0, 0.035, 1.70)), .087, .095),
        (Vector((0, 0.05, 1.735)), .035, .043),
    ], model.hair, sides=26, sub=1)
    model.loft("Hair back layers", [
        (Vector((0, .064, 1.39)), .068, .052),
        (Vector((0, .07, 1.50)), .095, .060),
        (Vector((0, .063, 1.62)), .10, .067),
    ], model.hair_deep, sides=22)
    model.ellipsoid("Hair ponytail tie", (0, .128, 1.69), (.043, .037, .027), model.hair_deep, 18, 12)
    # Offset masses break the tube silhouette. Their overlapping tips form
    # a deliberately irregular, loose ponytail rather than a rigid cylinder.
    for index, (x, y, tip, tint) in enumerate([
        (-.036, .137, 1.31, model.hair),
        (.020, .152, 1.20, model.hair_light),
        (.065, .137, 1.39, model.hair_deep),
        (-.070, .118, 1.43, model.hair_light),
    ]):
        model.loft(f"Hair ponytail layer {index}", [
            (Vector((x * .42, .128, 1.69)), .028, .026),
            (Vector((x, y, 1.61)), .043, .037),
            (Vector((x * 1.12, y + .012, 1.50)), .041, .033),
            (Vector((x * .75, y + .006, tip + .07)), .029, .024),
            (Vector((x * .56, y, tip)), .006, .006),
        ], tint, sides=14)
    for side in (-1, 1):
        model.loft(f"Hair framing wave {side}", [
            (Vector((side * .09, .002, 1.62)), .018, .018),
            (Vector((side * .105, -.014, 1.54)), .021, .019),
            (Vector((side * .093, -.02, 1.46)), .018, .015),
            (Vector((side * .111, .012, 1.39)), .012, .011),
            (Vector((side * .101, .015, 1.36)), .004, .004),
        ], model.hair, sides=12)
        model.strand(f"Hair loose flyaway {side}", [
            (side * .078, -.02, 1.62), (side * .124, -.04, 1.56),
            (side * .116, -.01, 1.49), (side * .128, .016, 1.43),
        ], [.009, .011, .007, .002], model.hair_light, sides=8)
    model.loft("Hair sweeping fringe", [
        (Vector((-.078, -.053, 1.608)), .018, .010),
        (Vector((-.035, -.091, 1.607)), .021, .012),
        (Vector((.015, -.102, 1.612)), .020, .011),
        (Vector((.078, -.065, 1.632)), .009, .006),
    ], model.hair, sides=14)


def torso_v2():
    model.build_torso_v1()
    # Remove V1's gold star so the black top reads as a quiet everyday outfit.
    for obj in list(model.PARTS):
        if obj.name.startswith(("Star emblem", "Prominent hoodie star", "Kangaroo pocket", "Pocket opening")):
            model.PARTS.remove(obj)
            model.bpy.data.objects.remove(obj, do_unlink=True)


def legs_v2():
    for side in (-1, 1):
        x = side * .086
        model.loft(f"Trouser hip blend {side}", [
            (Vector((x * .78, .005, 1.015)), .087, .095),
            (Vector((x, .002, .95)), .10, .106),
            (Vector((x, -.005, .83)), .093, .10),
        ], model.trousers, sides=20)
        model.loft(f"Trouser leg shorts {side}", [
            (Vector((x, -.005, .88)), .094, .10),
            (Vector((x, -.008, .795)), .085, .092),
            (Vector((x, -.010, .755)), .082, .089),
        ], model.trousers, sides=20)
        model.loft(f"Trouser cuff shorts {side}", [
            (Vector((x, -.010, .756)), .083, .090),
            (Vector((x, -.011, .77)), .085, .092),
        ], model.trousers_fold, sides=20)
        model.loft(f"Trouser leg bare skin {side}", [
            (Vector((x, -.010, .765)), .077, .083),
            (Vector((x, -.009, .62)), .069, .076),
            (Vector((x, -.012, .49)), .055, .062),
            (Vector((x, -.018, .38)), .058, .063),
            (Vector((x, -.020, .27)), .050, .054),
            (Vector((x, -.021, .205)), .047, .050),
        ], model.skin, sides=22, sub=1)
        model.loft(f"Trainer ankle boot {side}", [
            (Vector((x, -.020, .27)), .055, .056),
            (Vector((x, -.024, .22)), .059, .060),
            (Vector((x, -.024, .16)), .056, .056),
            (Vector((x, -.056, .105)), .062, .061),
            (Vector((x, -.13, .063)), .064, .05),
            (Vector((x, -.206, .052)), .042, .035),
        ], model.trainers, sides=20)
        model.loft(f"Trainer sole boot {side}", [
            (Vector((x, .036, .025)), .052, .018),
            (Vector((x, -.045, .019)), .064, .018),
            (Vector((x, -.14, .018)), .065, .017),
            (Vector((x, -.215, .027)), .039, .012),
        ], model.soles, sides=18, reference=(0, 0, 1))
        model.strand(f"Trainer seam boot {side}", [
            (x - .050, -.055, .18), (x - .051, -.078, .13),
            (x - .042, -.12, .095),
        ], .003, model.trainer_panel, sides=8)


model.build_torso_v1 = model.build_torso
model.build_torso = torso_v2
model.build_hair = hair_v2
model.build_legs = legs_v2

build_clips_v1 = rig.build_clips


def clips_v2(arm, face):
    clips = build_clips_v1(arm, face)
    # V1's thigh sign sends the legs backward through furniture. V2 rotates
    # them forward. Its seated loop also retains the legs and lowered hips.
    for name in ("sit_down", "stand_up", "seated_idle"):
        bpy.data.actions.remove(bpy.data.actions[clips[name]])

    def seat_pose(amount):
        return {"thigh.L": (-1.42 * amount, 0, .06 * amount),
                "thigh.R": (-1.42 * amount, 0, -.06 * amount),
                "shin.L": (1.38 * amount, 0, 0),
                "shin.R": (1.38 * amount, 0, 0),
                "spine_lower": (.10 * amount, 0, 0),
                "upperarm.L": (-.45 * amount, 0, -.10 * amount),
                "upperarm.R": (-.45 * amount, 0, .10 * amount),
                "lowerarm.L": (.60 * amount, 0, 0),
                "lowerarm.R": (.60 * amount, 0, 0)}

    clips["sit_down"] = rig.author_clip(arm, "sit_down", [
        (1, seat_pose(0)), (16, seat_pose(.45)), (30, seat_pose(.85)), (45, seat_pose(1)),
    ], location_keys=[(1, {"hips": (0, 0, 0)}), (45, {"hips": (0, 0, -.47)})])
    clips["stand_up"] = rig.author_clip(arm, "stand_up", [
        (1, seat_pose(1)), (16, seat_pose(.55)), (30, seat_pose(.15)), (40, seat_pose(0)),
    ], location_keys=[(1, {"hips": (0, 0, -.47)}), (40, {"hips": (0, 0, 0)})])
    sit = {"thigh.L": (-1.42, 0, .06), "thigh.R": (-1.42, 0, -.06),
           "shin.L": (1.38, 0, 0), "shin.R": (1.38, 0, 0)}
    clips["seated_idle"] = rig.author_clip(arm, "seated_idle", [
        (frame, {**sit, "chest": (math.sin((frame - 1) / 60 * math.tau) * .02, 0, 0),
                 "head": (0, math.sin((frame - 1) / 60 * math.tau) * .06, 0)})
        for frame in (1, 21, 41, 61)
    ], location_keys=[(1, {"hips": (0, 0, -.47)})])
    clips["sofa_relax"] = rig.author_clip(arm, "sofa_relax", [
        (frame, {**sit, "spine_lower": (-.10, 0, 0),
                 "head": (.04, math.sin((frame - 1) / 90 * math.tau) * .08, 0),
                 "upperarm.L": (-.35, 0, -.13), "upperarm.R": (-.35, 0, .13),
                 "lowerarm.L": (.55, 0, 0), "lowerarm.R": (.55, 0, 0)})
        for frame in (1, 31, 61, 91)
    ], location_keys=[(1, {"hips": (0, 0, -.47)})])
    clips["desk_work"] = rig.author_clip(arm, "desk_work", [
        (frame, {**sit, "spine_lower": (.09, 0, 0),
                 "head": (.08 + .025 * math.sin((frame - 1) / 60 * math.tau), 0, 0),
                 "upperarm.L": (-1.18, 0, -.18), "upperarm.R": (-1.18, 0, .18),
                 "lowerarm.L": (.34 + .06 * math.sin((frame - 1) / 15 * math.tau), 0, 0),
                 "lowerarm.R": (.34 - .06 * math.sin((frame - 1) / 15 * math.tau), 0, 0),
                 "hand.L": (.05 * math.sin((frame - 1) / 10 * math.tau), 0, 0),
                 "hand.R": (-.05 * math.sin((frame - 1) / 10 * math.tau), 0, 0)})
        for frame in range(1, 62, 5)
    ], location_keys=[(1, {"hips": (0, 0, -.47)})])
    clips["stretch"] = rig.author_clip(arm, "stretch", [
        (1, {"upperarm.L": (0, 0, 0), "upperarm.R": (0, 0, 0)}),
        (15, {"upperarm.L": (-2.1, 0, -.22), "upperarm.R": (-2.1, 0, .22),
              "lowerarm.L": (.10, 0, 0), "lowerarm.R": (.10, 0, 0),
              "spine_mid": (-.08, 0, 0), "head": (-.08, 0, 0)}),
        (35, {"upperarm.L": (-2.1, 0, -.22), "upperarm.R": (-2.1, 0, .22),
              "lowerarm.L": (.10, 0, 0), "lowerarm.R": (.10, 0, 0),
              "spine_mid": (-.08, 0, 0), "head": (-.08, 0, 0)}),
        (55, {"upperarm.L": (0, 0, 0), "upperarm.R": (0, 0, 0),
              "spine_mid": (0, 0, 0), "head": (0, 0, 0)}),
    ])
    return clips


rig.build_clips = clips_v2

render_previews_v1 = rig.build_preview_renders


def preview_v2(arm, face):
    files = render_previews_v1(arm, face)
    scene = bpy.context.scene
    camera = scene.camera
    rig.reset_pose(arm)
    rig.apply_pose(arm, {"thigh.L": (-1.42, 0, .06), "thigh.R": (-1.42, 0, -.06),
                         "shin.L": (1.38, 0, 0), "shin.R": (1.38, 0, 0)})
    arm.pose.bones["hips"].location = (0, 0, -.47)
    face.data.shape_keys.key_blocks["happy"].value = 1
    scene.render.filepath = str(rig.EVIDENCE_DIR / "preview-sit.png")
    bpy.ops.render.render(write_still=True)
    face.data.shape_keys.key_blocks["happy"].value = 0
    for name, location, scale, target in [
        ("preview-front", (0, -3.8, 1.15), 2.1, (0, 0, .9)),
        ("preview-side", (3.8, 0, 1.15), 2.1, (0, 0, .9)),
        ("preview-face", (0, -2.1, 1.57), .55, (0, 0, 1.55)),
    ]:
        rig.reset_pose(arm)
        camera.location = location
        camera.data.ortho_scale = scale
        camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(rig.EVIDENCE_DIR / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        files.append(scene.render.filepath)
    return files


rig.build_preview_renders = preview_v2
rig.CHARACTER_VERSION = "v2"
rig.GLB_NAME = "astra-character-v2.glb"
rig.BLEND_NAME = "astra-character-v2.blend"
output_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
asset_dir = Path(output_args[0]) if output_args else Path("src/assets")
asset_dir.mkdir(parents=True, exist_ok=True)
rig.GLB_PATH = (asset_dir / rig.GLB_NAME).resolve()
rig.BLEND_PATH = (asset_dir / rig.BLEND_NAME).resolve()
rig.EVIDENCE_DIR = (Path("test-results") / "lw03").resolve()
rig.EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)


if __name__ == "__main__":
    rig.main()
