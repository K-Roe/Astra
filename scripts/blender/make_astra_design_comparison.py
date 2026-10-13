"""Build the LW-02A vs LW-02B design comparison sheet for human review.

Usage:
  blender --background --factory-startup --python scripts/blender/make_astra_design_comparison.py -- <before.png> <after.png> <output_dir>

The two character renders are placed side by side on unlit image planes with
caption text. The output is a single review PNG; it makes no claim about
approval and is labelled as awaiting Karl's decision.
"""

import sys
from pathlib import Path

import bpy

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(args) < 3:
    raise SystemExit("usage: make_astra_design_comparison.py <before.png> <after.png> <output_dir>")

BEFORE = Path(args[0]).resolve()
AFTER = Path(args[1]).resolve()
OUTPUT = Path(args[2]).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
DESTINATION = OUTPUT / "astra-lw02b-comparison-lw02a-vs-lw02b.png"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.world.color = (0.06, 0.045, 0.11)

PANEL_WIDTH = 1.0
PANEL_HEIGHT = 1.20
PANEL_Z = 0.10
GAP = 0.06


def image_panel(name, path, centre_x):
    texture = bpy.data.images.load(str(path))
    material = bpy.data.materials.new(f"{name} unlit")
    material.use_nodes = True
    tree = material.node_tree
    principled = tree.nodes.get("Principled BSDF")
    principled.inputs["Roughness"].default_value = 1.0
    for socket in ("Emission Color", "Emission"):
        if socket in principled.inputs:
            principled.inputs[socket].default_value = (1, 1, 1, 1)
            break
    if "Emission Strength" in principled.inputs:
        principled.inputs["Emission Strength"].default_value = 1.0
    texture_node = tree.nodes.new("ShaderNodeTexImage")
    texture_node.image = texture
    texture_node.interpolation = "Closest"
    tree.links.new(texture_node.outputs["Color"], principled.inputs["Base Color"])
    for socket in ("Emission Color", "Emission"):
        if socket in principled.inputs:
            tree.links.new(texture_node.outputs["Color"], principled.inputs[socket])
            break

    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(centre_x, 0.0, PANEL_Z))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (PANEL_WIDTH, 1.0, PANEL_HEIGHT)
    obj.rotation_euler = (1.5707963, 0.0, 0.0)
    obj.data.materials.append(material)
    return obj


def caption(name, body, centre_x, size, top_z):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.space_character = 1.05
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = (centre_x, -0.05, top_z)
    obj.rotation_euler = (1.5707963, 0.0, 0.0)
    material = bpy.data.materials.new(f"{name} ink")
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (0.92, 0.88, 1.0, 1)
    for socket in ("Emission Color", "Emission"):
        if socket in principled.inputs:
            principled.inputs[socket].default_value = (0.92, 0.88, 1.0, 1)
            break
    if "Emission Strength" in principled.inputs:
        principled.inputs["Emission Strength"].default_value = 1.0
    curve.materials.append(material)
    return obj


left_x = -(PANEL_WIDTH + GAP) / 2
right_x = (PANEL_WIDTH + GAP) / 2

image_panel("LW-02A blockout panel", BEFORE, left_x)
image_panel("LW-02B refined panel", AFTER, right_x)

caption(
    "LW-02A caption",
    "LW-02A blockout (superseded)\n~3.5 heads tall, oversized head,\nball-joint limbs, cylinder hands",
    left_x,
    0.028,
    -0.58,
)
caption(
    "LW-02B caption",
    "LW-02B refined design - AWAITING KARL'S APPROVAL\n1.70 m, 5.76 heads, lofted anatomy,\nreadable hands, loose updo, star hoodie",
    right_x,
    0.028,
    -0.58,
)
caption(
    "Header",
    "ASTRA CHARACTER DESIGN - LW-02A to LW-02B COMPARISON",
    0.0,
    0.034,
    0.745,
)

camera_data = bpy.data.cameras.new("Comparison camera")
camera = bpy.data.objects.new("Comparison camera", camera_data)
bpy.context.collection.objects.link(camera)
scene.camera = camera
camera_data.type = "ORTHO"
camera_data.ortho_scale = 2.32
camera.location = (0.0, -6.0, 0.0)
camera.rotation_euler = (1.5707963, 0.0, 0.0)

scene.render.resolution_x = 1600
scene.render.resolution_y = 1150
scene.render.resolution_percentage = 100
scene.render.filepath = str(DESTINATION)
bpy.ops.render.render(write_still=True)
print(f"ASTRA_LW02B_COMPARISON_OK {DESTINATION}")