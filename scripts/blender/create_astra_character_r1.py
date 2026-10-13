"""LW-02B-R1 Astra refined character: review renders.

The character geometry itself lives in astra_character_model.py; this script
only sets up the review scene, validates the model and writes the images.

Review-only design source. NOT the production asset: no armature, no skin
weights, no shape keys, no animation clips and no GLB. Karl approved the
design as Astra Character V1 in LW-02C; production rigging is produced by
create_astra_rigged_v1.py.

Requires Blender 5.2 LTS with EEVEE. Regenerate with:

  blender --background --factory-startup \
      --python scripts/blender/create_astra_character_r1.py -- [output_dir]

Usage: output_dir defaults to test-results/lw02b-r1/design.
"""

import bpy
import sys
from pathlib import Path
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))

from astra_character_model import (  # noqa: E402
    FACE,
    EXPRESSIONS,
    backdrop,
    box,
    build_character,
    build_arms,
    build_head,
    build_eyes,
    finish,
    ARM_OBJECTS,
    EXPRESSION_OBJECTS,
    HAIR_OBJECTS,
    HEAD_OBJECTS,
    PARTS,
    room_floor,
    room_furniture,
    room_rug,
    room_side,
    room_wall,
    validate_and_report,
)


def output_directory():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    folder = Path(args[0]) if args else Path("test-results/lw02b-r1/design")
    folder.mkdir(parents=True, exist_ok=True)
    return folder.resolve()


OUTPUT = output_directory()

# -------------------------------------------------------------- scene setup

bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
FLOOR = bpy.context.object
finish("Review floor", FLOOR, backdrop, smooth=False)

bpy.context.scene.world.color = (0.075, 0.055, 0.135)


def area_light(name, location, target, energy, size, colour=(1.0, 0.97, 1.0)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = colour
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def review_lighting():
    area_light("Key", (-1.9, -2.9, 2.9), (0, 0, 1.15), 120, 2.6)
    area_light("Rim", (2.0, 1.7, 2.6), (0, 0, 1.25), 60, 2.2, colour=(0.80, 0.72, 1.0))
    area_light("Face fill", (0.55, -2.1, 1.75), (0, 0, 1.50), 26, 1.5)
    area_light("Bounce", (0.2, -1.4, 0.35), (0, 0, 0.9), 12, 1.8, colour=(1.0, 0.92, 0.98))


review_lighting()

camera_data = bpy.data.cameras.new("Review camera")
camera = bpy.data.objects.new("Review camera", camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera_data.type = "ORTHO"
camera_data.ortho_scale = 2.05

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0


CURRENT_EXPRESSION = ["neutral"]


def render(name, position, target, ortho_scale=None, resolution=(760, 1000), pose="neutral", expression="neutral"):
    build_arms(pose)
    if expression != CURRENT_EXPRESSION[0]:
        build_head(expression)
        before = set(bpy.data.objects)
        build_eyes(expression)
        EXPRESSION_OBJECTS.extend(obj for obj in bpy.data.objects if obj not in before)
        CURRENT_EXPRESSION[0] = expression
    camera.location = position
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.ortho_scale = ortho_scale or camera_data.ortho_scale
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.filepath = str(OUTPUT / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"ASTRA_R1_RENDER_OK {name} {scene.render.filepath}")


build_character("neutral")
validate_and_report()
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "astra-lw02b-r1-character.blend"))
print("ASTRA_R1_BLEND_SAVED")

BODY_TARGET = (0.0, 0.0, 0.95)
render("astra-front", (0.0, -7.0, 1.50), BODY_TARGET)
render("astra-side", (7.0, 0.0, 1.50), BODY_TARGET)
render("astra-back", (0.0, 7.0, 1.50), BODY_TARGET)
render("astra-three-quarter", (4.2, -5.5, 1.62), BODY_TARGET)
render("astra-smile", (1.6, -5.4, 1.62), BODY_TARGET, expression="smile")
render("astra-waving", (4.2, -5.5, 1.62), BODY_TARGET, pose="wave")

camera_data.ortho_scale = 0.62
render("astra-face-front", (0.0, -6.0, 1.66), (0.0, 0.0, 1.52), ortho_scale=0.62, resolution=(760, 760))
render("astra-face-three-quarter", (2.3, -5.5, 1.72), (0.0, 0.0, 1.52), ortho_scale=0.62, resolution=(760, 760))
camera_data.ortho_scale = 2.05


# ------------------------------------------------------------- room preview


def build_room():
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT" or (obj.type == "MESH" and obj is not FLOOR):
            bpy.data.objects.remove(obj, do_unlink=True)
    PARTS.clear()
    ARM_OBJECTS.clear()
    HEAD_OBJECTS.clear()
    EXPRESSION_OBJECTS.clear()
    HAIR_OBJECTS.clear()

    box("Room back wall", (0, 1.35, 1.60), (5.0, 0.08, 3.20), room_wall)
    box("Room side wall", (-2.45, 0.0, 1.60), (0.08, 2.80, 3.20), room_side)
    box("Room rug", (0.10, -0.30, 0.005), (1.45, 1.05, 0.007), room_rug, bevel=0.004)
    box("Sofa base", (1.45, 0.55, 0.24), (0.62, 0.24, 0.24), room_furniture, bevel=0.03)
    box("Sofa back", (1.45, 0.76, 0.55), (0.62, 0.07, 0.34), room_furniture, bevel=0.03)
    box("Table top", (-1.05, 0.35, 0.36), (0.42, 0.30, 0.02), room_furniture, bevel=0.008)
    for dx, dy in ((-0.34, -0.24), (0.34, -0.24), (-0.34, 0.24), (0.34, 0.24)):
        box(f"Table leg {dx} {dy}", (-1.05 + dx, 0.35 + dy, 0.18), (0.015, 0.015, 0.18), room_furniture)

    build_character("neutral")
    area_light("Room key", (-1.5, -2.5, 2.9), (0, 0, 1.1), 200, 2.4)
    area_light("Room rim", (1.9, 1.3, 2.5), (0, 0, 1.2), 90, 2.0, colour=(0.80, 0.72, 1.0))
    area_light("Room fill", (0.4, -2.2, 1.6), (0, 0, 1.2), 45, 1.6)

    camera_data.type = "PERSP"
    camera_data.lens = 40
    camera.location = (0.95, -3.00, 1.52)
    camera.rotation_euler = (Vector((0, 0, 0.95)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 760
    scene.render.filepath = str(OUTPUT / "astra-room-preview.png")
    bpy.ops.render.render(write_still=True)
    print(f"ASTRA_R1_RENDER_OK room {scene.render.filepath}")


build_room()
print("ASTRA_R1_COMPLETE")