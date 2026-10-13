"""LW-02A review-only Astra design blockout. No production mesh, weights or rig."""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def output_directory():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    folder = Path(args[0]) if args else Path("test-results/lw02a/design")
    folder.mkdir(parents=True, exist_ok=True)
    return folder.resolve()


OUTPUT = output_directory()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def material(name, rgb, roughness=0.8):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*rgb, 1)
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*rgb, 1)
    principled.inputs["Roughness"].default_value = roughness
    return result


skin = material("Warm peach skin", (0.82, 0.52, 0.45))
skin_light = material("Cheek blush", (0.91, 0.44, 0.47))
hair = material("Vivid violet hair", (0.26, 0.055, 0.49))
hair_light = material("Hair highlights", (0.44, 0.16, 0.67))
hoodie = material("Astra purple hoodie", (0.24, 0.10, 0.47))
hoodie_light = material("Hoodie folds", (0.38, 0.20, 0.60))
trousers = material("Charcoal plum trousers", (0.11, 0.10, 0.18))
trainers = material("Lavender trainers", (0.67, 0.56, 0.82))
soles = material("Trainer soles", (0.87, 0.79, 0.90))
eyes_white = material("Warm eye whites", (0.95, 0.88, 0.85))
iris = material("Deep plum irises", (0.16, 0.08, 0.24))
gold = material("Warm star emblem", (1.0, 0.69, 0.24))
mouth = material("Soft mouth", (0.40, 0.12, 0.22))
backdrop = material("Review backdrop", (0.10, 0.07, 0.17))


def ellipsoid(name, location, scale, surface, segments=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(surface)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def link_between(name, start, end, radius, surface, vertices=12):
    a, b = Vector(start), Vector(end)
    middle = (a + b) / 2
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length, location=middle)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(surface)
    bevel = obj.modifiers.new("Soft edge", "BEVEL")
    bevel.width = min(radius * 0.3, 0.05)
    bevel.segments = 2
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def curve(name, points, radius, surface):
    path = bpy.data.curves.new(name, "CURVE")
    path.dimensions = "3D"
    path.bevel_depth = radius
    path.bevel_resolution = 3
    spline = path.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for node, point in zip(spline.bezier_points, points):
        node.co = point
        node.handle_left_type = "AUTO"
        node.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, path)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(surface)
    return obj


def star_mesh():
    # Front of hoodie faces -Y. A shallow mesh reads clearly without texture cost.
    outer, inner = 0.20, 0.085
    vertices = [(0, -0.38, 1.88)]
    for index in range(10):
        angle = math.pi / 2 + index * math.pi / 5
        radius = outer if index % 2 == 0 else inner
        vertices.append((radius * math.cos(angle), -0.392, 1.88 + radius * math.sin(angle)))
    faces = [(0, index + 1, ((index + 1) % 10) + 1) for index in range(10)]
    mesh = bpy.data.meshes.new("Star emblem geometry")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(gold)
    obj = bpy.data.objects.new("Prominent hoodie star", mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def build_body():
    ellipsoid("Hoodie torso", (0, 0, 1.78), (0.53, 0.38, 0.65), hoodie)
    ellipsoid("Hood volume behind neck", (0, 0.19, 2.22), (0.43, 0.29, 0.31), hoodie_light)
    ellipsoid("Hoodie collar", (0, -0.02, 2.33), (0.29, 0.30, 0.11), hoodie_light)
    ellipsoid("Hoodie pocket", (0, -0.375, 1.49), (0.32, 0.05, 0.13), hoodie_light)
    star_mesh()
    for side in (-1, 1):
        x = side * 0.20
        ellipsoid(f"Trouser hip {side}", (x, 0, 1.17), (0.25, 0.27, 0.29), trousers)
        link_between(f"Thigh {side}", (x, 0, 1.12), (side * 0.23, -0.01, 0.64), 0.18, trousers)
        ellipsoid(f"Knee {side}", (side * 0.23, -0.01, 0.64), (0.18, 0.19, 0.17), trousers)
        link_between(f"Shin {side}", (side * 0.23, -0.01, 0.64), (side * 0.25, -0.015, 0.27), 0.15, trousers)
        ellipsoid(f"Trainer upper {side}", (side * 0.25, -0.12, 0.18), (0.23, 0.36, 0.16), trainers)
        ellipsoid(f"Trainer sole {side}", (side * 0.25, -0.13, 0.075), (0.25, 0.39, 0.06), soles)
        curve(f"Hood drawstring {side}", [(side * 0.13, -0.38, 2.25), (side * 0.15, -0.40, 2.05), (side * 0.15, -0.40, 1.97)], 0.015, soles)


def build_head():
    ellipsoid("Neck", (0, 0, 2.42), (0.18, 0.18, 0.20), skin)
    ellipsoid("Soft expressive face", (0, -0.03, 2.92), (0.43, 0.35, 0.54), skin, 32, 24)
    ellipsoid("Hair volume across back of head", (0, 0.25, 2.99), (0.43, 0.21, 0.47), hair, 32, 20)
    ellipsoid("Hair cap behind face", (0, 0.12, 3.20), (0.49, 0.34, 0.34), hair, 32, 20)
    ellipsoid("Loose updo bun", (0.11, 0.17, 3.54), (0.28, 0.27, 0.21), hair, 24, 16)
    ellipsoid("Bun highlight", (0.02, -0.03, 3.61), (0.13, 0.045, 0.06), hair_light)
    ellipsoid("Swept fringe", (-0.17, -0.25, 3.27), (0.31, 0.16, 0.16), hair)
    ellipsoid("Loose left lock", (-0.42, -0.13, 2.98), (0.10, 0.13, 0.29), hair)
    ellipsoid("Loose right lock", (0.43, -0.10, 3.03), (0.08, 0.11, 0.23), hair)
    curve("Flyaway hair strand", [(0.18, 0.17, 3.68), (0.37, 0.08, 3.83), (0.42, -0.03, 3.77)], 0.025, hair_light)
    for side in (-1, 1):
        ellipsoid(f"Eye white {side}", (side * 0.17, -0.356, 2.99), (0.12, 0.047, 0.14), eyes_white)
        ellipsoid(f"Iris {side}", (side * 0.16, -0.398, 2.99), (0.055, 0.028, 0.075), iris)
        ellipsoid(f"Eye glint {side}", (side * 0.14, -0.423, 3.025), (0.015, 0.012, 0.019), eyes_white)
        ellipsoid(f"Cheek blush {side}", (side * 0.26, -0.331, 2.76), (0.10, 0.022, 0.047), skin_light)
        curve(f"Eyebrow {side}", [(side * 0.085, -0.391, 3.20), (side * 0.17, -0.376, 3.23), (side * 0.27, -0.346, 3.18)], 0.021, hair)
    ellipsoid("Small nose", (0, -0.367, 2.82), (0.06, 0.06, 0.07), skin)
    curve("Mischievous smile", [(-0.14, -0.351, 2.68), (0, -0.385, 2.64), (0.16, -0.35, 2.69)], 0.018, mouth)


arm_objects = []


def build_arms(expressive=False):
    for obj in arm_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    arm_objects.clear()
    for side in (-1, 1):
        shoulder = (side * 0.55, 0, 2.50)
        if expressive and side == 1:
            elbow = (0.87, -0.09, 2.79)
            wrist = (0.95, -0.16, 3.42)
        else:
            elbow = (side * 0.69, -0.015, 2.08)
            wrist = (side * 0.73, -0.05, 1.64)
        arm_objects.append(ellipsoid(f"Sleeve shoulder {side}", shoulder, (0.22, 0.24, 0.26), hoodie))
        arm_objects.append(link_between(f"Upper sleeve {side}", shoulder, elbow, 0.17, hoodie))
        arm_objects.append(ellipsoid(f"Elbow cuff {side}", elbow, (0.16, 0.16, 0.16), hoodie_light))
        arm_objects.append(link_between(f"Forearm sleeve {side}", elbow, wrist, 0.14, hoodie))
        palm = Vector(wrist) + Vector((0, -0.01, 0.03 if expressive and side == 1 else -0.10))
        arm_objects.append(ellipsoid(f"Hand palm {side}", palm, (0.14, 0.08, 0.15), skin))
        for finger in range(4):
            offset = (finger - 1.5) * 0.065
            direction = 0.22 if expressive and side == 1 else -0.18
            start = palm + Vector((offset, -0.02, direction * 0.35))
            end = palm + Vector((offset * 1.35, -0.04, direction))
            arm_objects.append(link_between(f"Finger {side}-{finger}", start, end, 0.025, skin, 8))


existing = set(bpy.data.objects)
build_body()
body_parts = [obj for obj in bpy.data.objects if obj not in existing]
for obj in body_parts:
    name = obj.name
    if name.startswith("Trainer"):
        continue
    if name.startswith("Shin"):
        obj.location.z += 0.035
        obj.scale.z *= 1.2
    elif name.startswith("Knee"):
        obj.location.z += 0.08
    elif name.startswith("Thigh"):
        obj.location.z += 0.20
        obj.scale.z *= 1.5
    else:
        obj.location.z += 0.32

existing = set(bpy.data.objects)
build_head()
head_parts = [obj for obj in bpy.data.objects if obj not in existing]
head_root = bpy.data.objects.new("Design-only head proportion group", None)
bpy.context.collection.objects.link(head_root)
head_root.location = (0, 0, 2.92)
bpy.context.view_layer.update()
for obj in head_parts:
    obj.parent = head_root
    obj.matrix_parent_inverse = head_root.matrix_world.inverted()
head_root.scale = (0.84, 0.84, 0.84)
head_root.location.z += 0.32
build_arms()

bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
ground = bpy.context.object
ground.name = "Review floor"
ground.data.materials.append(backdrop)

world = bpy.context.scene.world
world.color = (0.1, 0.08, 0.16)


def area_light(name, location, energy, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    direction = Vector((0, 0, 1.8)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


area_light("Soft key", (-3, -5, 6), 520, 5)
area_light("Violet rim", (3, 2, 5), 360, 4)

camera_data = bpy.data.cameras.new("Review camera")
camera = bpy.data.objects.new("Review camera", camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera_data.type = "ORTHO"
camera_data.ortho_scale = 5.0

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 680
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX"
scene.render.filepath = str(OUTPUT / "astra-design-prototype-neutral-front.png")


def render_view(name, position, expressive=False):
    build_arms(expressive)
    camera.location = position
    direction = Vector((0, 0, 2.0)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(OUTPUT / f"astra-design-prototype-{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"ASTRA_LW02A_RENDER_OK {name} {scene.render.filepath}")


bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "astra-design-prototype-neutral.blend"))
render_view("neutral-front", (0, -9, 3.0))
render_view("neutral-side", (8.5, 0, 3.0))
render_view("neutral-back", (0, 9, 3.0))
render_view("neutral-three-quarter", (5.5, -7.5, 3.2))
render_view("expressive-wave", (5.5, -7.5, 3.2), expressive=True)
print("ASTRA_LW02A_COMPLETE")
