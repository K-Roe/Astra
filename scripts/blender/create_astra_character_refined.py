"""LW-02B review-only refined Astra character blockout.

Five-and-three-quarter-head-tall young-adult stylised woman built from lofted
anatomical sections. This is a design proposal awaiting Karl's visual approval.
It is NOT the production mesh: it carries no armature, skin weights, shape keys
or animation clips, and it is not integrated into the application.

Proportions are metres on a 1.70 m figure with a 0.295 m head unit (5.76 heads),
chosen so the silhouette reads friendly and capable rather than chibi or
realistic. The character faces -Y, up is +Z, her left side is +X.
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HEIGHT = 1.70
HEAD_UNIT = 0.295
HEADS_TALL = HEIGHT / HEAD_UNIT


def output_directory():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    folder = Path(args[0]) if args else Path("test-results/lw02b/design")
    folder.mkdir(parents=True, exist_ok=True)
    return folder.resolve()


OUTPUT = output_directory()

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

PARTS = []


# ---------------------------------------------------------------- materials


def material(name, rgb, roughness=0.7, specular=0.4):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*rgb, 1)
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*rgb, 1)
    principled.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in principled.inputs:
        principled.inputs["Specular IOR Level"].default_value = specular
    return result


skin = material("Warm peach skin", (0.90, 0.66, 0.56), 0.55)
skin_shadow = material("Soft skin shadow", (0.74, 0.48, 0.42), 0.65)
blush = material("Cheek blush", (0.93, 0.44, 0.46), 0.6)
hair = material("Vivid violet hair", (0.38, 0.10, 0.66), 0.42)
hair_light = material("Hair highlight strands", (0.58, 0.26, 0.80), 0.38)
hoodie = material("Astra purple hoodie", (0.30, 0.13, 0.55), 0.8)
hoodie_light = material("Hoodie lining", (0.48, 0.30, 0.70), 0.8)
hoodie_dark = material("Hoodie ribbing", (0.24, 0.10, 0.44), 0.85)
trousers = material("Charcoal plum trousers", (0.070, 0.062, 0.100), 0.76)
trainers = material("Lavender trainers", (0.58, 0.46, 0.76), 0.6)
trainer_panel = material("Trainer panels", (0.36, 0.24, 0.55), 0.6)
soles = material("Trainer soles", (0.68, 0.62, 0.75), 0.55)
laces = material("Shoe laces", (0.98, 0.95, 1.0), 0.7)
eyes_white = material("Warm eye whites", (0.99, 0.95, 0.93), 0.3)
iris = material("Deep plum irises", (0.26, 0.11, 0.38), 0.25)
pupil = material("Pupils", (0.07, 0.04, 0.10), 0.2)
glint = material("Eye glints", (1.0, 1.0, 1.0), 0.05)
gold = material("Warm star emblem", (1.0, 0.76, 0.28), 0.3, 0.7)
gold_edge = material("Star emblem edging", (0.68, 0.40, 0.10), 0.35, 0.5)
lips = material("Soft berry lips", (0.68, 0.26, 0.36), 0.45)
mouth_inner = material("Mouth interior", (0.32, 0.09, 0.17), 0.55)
backdrop = material("Review backdrop", (0.08, 0.055, 0.14), 0.9)
room_wall = material("Room wall", (0.30, 0.21, 0.38), 0.95)
room_side = material("Room side wall", (0.23, 0.17, 0.32), 0.95)
room_floor = material("Room floor", (0.16, 0.12, 0.23), 0.9)
room_rug = material("Room rug", (0.36, 0.26, 0.48), 0.95)
room_furniture = material("Room furniture", (0.21, 0.15, 0.30), 0.9)


# ------------------------------------------------------------ mesh builders


def finish(name, mesh_obj, surface, smooth=True):
    mesh_obj.name = name
    mesh_obj.data.materials.append(surface)
    if smooth and mesh_obj.type == "MESH":
        for polygon in mesh_obj.data.polygons:
            polygon.use_smooth = True
    PARTS.append(mesh_obj)
    return mesh_obj


def loft(name, spine, surface, sides=20, reference=(0.0, 1.0, 0.0), sub=0):
    """Skin a ring per spine point. Each spine entry is (center, radius_x, radius_y)."""
    count = len(spine)
    ref = Vector(reference)
    rings = []
    for index, (center, rx, ry) in enumerate(spine):
        point = Vector(center)
        if index == 0:
            tangent = spine[1][0] - point
        elif index == count - 1:
            tangent = point - spine[index - 1][0]
        else:
            tangent = spine[index + 1][0] - spine[index - 1][0]
        tangent.normalize()
        axis = ref if abs(tangent.dot(ref)) < 0.95 else Vector((1.0, 0.0, 0.0))
        side = axis.cross(tangent).normalized()
        up = tangent.cross(side).normalized()
        rings.append(
            [
                point + side * (rx * math.cos(2 * math.pi * step / sides)) + up * (ry * math.sin(2 * math.pi * step / sides))
                for step in range(sides)
            ]
        )

    vertices = [vertex for ring in rings for vertex in ring]
    faces = []
    for index in range(count - 1):
        for step in range(sides):
            a = index * sides + step
            b = index * sides + (step + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    for end, ring_index in ((0, 0), (1, count - 1)):
        centre_index = len(vertices)
        vertices.append(spine[ring_index][0])
        for step in range(sides):
            a = ring_index * sides + step
            b = ring_index * sides + (step + 1) % sides
            faces.append((centre_index, b, a) if end == 0 else (centre_index, a, b))

    mesh = bpy.data.meshes.new(f"{name} mesh")
    mesh.from_pydata([tuple(vertex) for vertex in vertices], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish(name, obj, surface)
    if sub:
        modifier = obj.modifiers.new("Polish subdivision", "SUBSURF")
        modifier.levels = sub
        modifier.render_levels = sub
    return obj


def strand(name, points, radii, surface, sides=10):
    """Tapered tube through a list of points; radii may be a scalar or per-point list."""
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * len(points)
    return loft(name, [(Vector(point), radius, radius) for point, radius in zip(points, radii)], surface, sides=sides)


def ellipsoid(name, location, scale, surface, segments=28, rings=18):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.scale = scale
    return finish(name, obj, surface)


def box(name, location, scale, surface, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.scale = scale
    if bevel:
        modifier = obj.modifiers.new("Soft edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return finish(name, obj, surface)


def star(name, centre, outer, inner, surface, conform, lift=0.0):
    """Five-point emblem on the chest, conforming to the torso surface ellipse."""
    x0, _, z0 = centre
    body_rx, body_ry = conform

    def chest_y(x):
        return -body_ry * math.sqrt(max(0.05, 1 - (x / body_rx) ** 2)) - lift

    vertices = [(x0, chest_y(x0), z0)]
    for index in range(10):
        angle = math.pi / 2 + index * math.pi / 5
        radius = outer if index % 2 == 0 else inner
        x = x0 + radius * math.cos(angle)
        vertices.append((x, chest_y(x), z0 + radius * math.sin(angle)))
    faces = [(0, index + 1, (index + 1) % 10 + 1) for index in range(10)]
    mesh = bpy.data.meshes.new(f"{name} mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(name, obj, surface, smooth=False)


# ------------------------------------------------------------------- figure
# Shared landmark table so facial features sit exactly on the head shell.

HEAD_RINGS = [
    (1.3950, 0.032, 0.042, -0.008),
    (1.4200, 0.056, 0.070, -0.006),
    (1.4550, 0.076, 0.092, -0.004),
    (1.5000, 0.087, 0.106, -0.002),
    (1.5400, 0.090, 0.110, 0.000),
    (1.5900, 0.088, 0.108, 0.002),
    (1.6350, 0.079, 0.095, 0.004),
    (1.6700, 0.060, 0.072, 0.006),
    (1.6900, 0.029, 0.035, 0.008),
]
FACE = {
    "eye": 1.5360,
    "brow": 1.5730,
    "ear": 1.5230,
    "blush": 1.4960,
    "nose": 1.4600,
    "mouth": 1.4420,
}


def head_surface_y(z, x=0.0):
    """Front surface of the head shell at height z, offset x."""
    rows = HEAD_RINGS
    for index in range(len(rows) - 1):
        low, high = rows[index], rows[index + 1]
        if low[0] <= z <= high[0]:
            span = high[0] - low[0]
            t = 0.0 if span == 0 else (z - low[0]) / span
            rx = low[1] + (high[1] - low[1]) * t
            ry = low[2] + (high[2] - low[2]) * t
            cy = low[3] + (high[3] - low[3]) * t
            return cy - ry * math.sqrt(max(0.0, 1 - (x / rx) ** 2))
    return rows[0][3] - rows[0][2] if z < rows[0][0] else rows[-1][3] - rows[-1][2]


def build_head():
    loft("Head", [(Vector((0, cy, z)), rx, ry) for z, rx, ry, cy in HEAD_RINGS], skin, sides=32, sub=1)
    loft(
        "Neck",
        [
            (Vector((0, 0.014, 1.3350)), 0.050, 0.048),
            (Vector((0, 0.010, 1.3800)), 0.048, 0.046),
            (Vector((0, 0.004, 1.4200)), 0.050, 0.050),
        ],
        skin,
        sides=20,
    )
    ellipsoid("Neck shadow", (0, 0.046, 1.3480), (0.044, 0.026, 0.040), skin_shadow)

    for side in (-1, 1):
        ellipsoid(f"Ear {side}", (side * 0.085, 0.010, FACE["ear"]), (0.011, 0.019, 0.026), skin)

        eye_z = FACE["eye"]
        eye_x = side * 0.036
        face_y = head_surface_y(eye_z, eye_x)
        ellipsoid(f"Eye white {side}", (eye_x, face_y + 0.0075, eye_z), (0.0250, 0.0120, 0.0180), eyes_white, 24, 14)
        ellipsoid(f"Iris {side}", (eye_x, face_y + 0.0005, eye_z - 0.0015), (0.0132, 0.0078, 0.0148), iris, 24, 14)
        ellipsoid(f"Pupil {side}", (eye_x, face_y - 0.0052, eye_z - 0.0015), (0.0062, 0.0046, 0.0072), pupil, 20, 12)
        ellipsoid(f"Eye glint {side}", (eye_x - side * 0.0045, face_y - 0.0084, eye_z + 0.0060), (0.0040, 0.0034, 0.0040), glint, 14, 10)
        ellipsoid(f"Lower lid {side}", (eye_x, face_y + 0.0030, eye_z - 0.0185), (0.0212, 0.0078, 0.0042), skin_shadow, 20, 10)
        strand(
            f"Upper lid {side}",
            [
                (side * 0.0140, head_surface_y(1.5420, side * 0.0140) - 0.0040, 1.5400),
                (eye_x, head_surface_y(1.5545, eye_x) - 0.0045, 1.5545),
                (side * 0.0595, head_surface_y(1.5425, side * 0.0595) - 0.0040, 1.5430),
            ],
            [0.0030, 0.0050, 0.0026],
            hair,
            sides=8,
        )
        strand(
            f"Eyebrow {side}",
            [
                (side * 0.0165, head_surface_y(FACE["brow"] - 0.004, side * 0.0165) - 0.0035, FACE["brow"] - 0.0040),
                (side * 0.0375, head_surface_y(FACE["brow"] + 0.004, side * 0.0375) - 0.0040, FACE["brow"] + 0.0045),
                (side * 0.0605, head_surface_y(FACE["brow"] - 0.002, side * 0.0605) - 0.0035, FACE["brow"] - 0.0020),
            ],
            [0.0055, 0.0074, 0.0034],
            hair,
            sides=8,
        )
        ellipsoid(
            f"Cheek blush {side}",
            (side * 0.0540, head_surface_y(FACE["blush"], side * 0.0540) + 0.0030, FACE["blush"]),
            (0.0225, 0.0060, 0.0105),
            blush,
            20,
            12,
        )

    strand(
        "Nose bridge",
        [
            (0.0, head_surface_y(1.5520, 0.0) + 0.0020, 1.5520),
            (0.0, head_surface_y(FACE["nose"] + 0.004, 0.0) - 0.0050, FACE["nose"] + 0.004),
        ],
        [0.0045, 0.0092],
        skin,
        sides=10,
    )
    ellipsoid("Nose tip", (0.0, head_surface_y(FACE["nose"], 0.0) - 0.0100, FACE["nose"]), (0.0125, 0.0128, 0.0100), skin, 20, 12)
    for side in (-1, 1):
        ellipsoid(
            f"Nostril {side}",
            (side * 0.0105, head_surface_y(FACE["nose"] - 0.003, side * 0.0105) - 0.0070, FACE["nose"] - 0.003),
            (0.0036, 0.0036, 0.0028),
            skin_shadow,
            12,
            8,
        )

    strand(
        "Smile line",
        [
            (-0.0310, head_surface_y(FACE["mouth"] + 0.005, -0.0310) - 0.0034, FACE["mouth"] + 0.0070),
            (-0.0115, head_surface_y(FACE["mouth"] - 0.006, -0.0115) - 0.0062, FACE["mouth"] - 0.0075),
            (0.0105, head_surface_y(FACE["mouth"] - 0.003, 0.0105) - 0.0058, FACE["mouth"] - 0.0020),
            (0.0315, head_surface_y(FACE["mouth"] + 0.012, 0.0300) - 0.0030, FACE["mouth"] + 0.0150),
        ],
        [0.0026, 0.0040, 0.0038, 0.0024],
        lips,
        sides=8,
    )
    ellipsoid("Mouth interior", (0.0, head_surface_y(FACE["mouth"], 0.0) + 0.0060, FACE["mouth"] - 0.0010), (0.0240, 0.0080, 0.0056), mouth_inner, 18, 10)
    ellipsoid("Lower lip", (0.0, head_surface_y(FACE["mouth"] - 0.012, 0.0) - 0.0035, FACE["mouth"] - 0.0130), (0.0195, 0.0072, 0.0058), lips, 18, 10)


def build_hair():
    # A fitted cap that hugs the skull: hair adds volume, not a helmet silhouette.
    loft(
        "Hair crown cap",
        [
            (Vector((0, 0.008, 1.5880)), 0.088, 0.106),
            (Vector((0, 0.008, 1.6350)), 0.093, 0.112),
            (Vector((0, 0.012, 1.6750)), 0.084, 0.100),
            (Vector((0, 0.020, 1.7050)), 0.060, 0.072),
            (Vector((0, 0.030, 1.7240)), 0.030, 0.038),
        ],
        hair,
        sides=28,
        sub=1,
    )
# Hair layer covering the back of the skull, kept clear of the cheek line.
    loft(
        "Hair back mass",
        [
            (Vector((0, 0.044, 1.4500)), 0.070, 0.048),
            (Vector((0, 0.054, 1.5100)), 0.088, 0.056),
            (Vector((0, 0.056, 1.5650)), 0.092, 0.058),
            (Vector((0, 0.050, 1.6100)), 0.086, 0.054),
        ],
        hair,
        sides=24,
        sub=1,
    )
    # Loose, slightly messy updo: a small gathered knot on the crown's back edge.
    loft(
        "Loose updo bun",
        [
            (Vector((0.026, 0.074, 1.6300)), 0.044, 0.034),
            (Vector((0.030, 0.086, 1.6680)), 0.054, 0.042),
            (Vector((0.034, 0.092, 1.7020)), 0.048, 0.036),
            (Vector((0.036, 0.092, 1.7260)), 0.024, 0.018),
        ],
        hair,
        sides=24,
        sub=1,
    )
    strand(
        "Bun wrap lock",
        [
            (0.072, 0.062, 1.6560),
            (0.050, 0.124, 1.6820),
            (-0.002, 0.124, 1.7000),
            (-0.040, 0.084, 1.6840),
            (-0.046, 0.042, 1.6540),
        ],
        [0.012, 0.016, 0.017, 0.014, 0.008],
        hair_light,
        sides=10,
    )
    strand(
        "Loose gathered strand",
        [(-0.058, 0.040, 1.6340), (-0.074, 0.074, 1.6580), (-0.062, 0.108, 1.6800)],
        [0.013, 0.011, 0.006],
        hair,
        sides=10,
    )

    # Fringe swept across the forehead, clearing the brows.
    fringe = [
        [(-0.0640, -0.0360, 1.6100), (-0.0520, -0.0860, 1.5960), (-0.0200, -0.1060, 1.5930), (0.0160, -0.1040, 1.6000)],
        [(-0.0180, -0.0620, 1.6220), (0.0000, -0.1100, 1.6090), (0.0280, -0.1070, 1.6060)],
        [(0.0300, -0.0580, 1.6180), (0.0520, -0.0940, 1.6040), (0.0700, -0.0800, 1.5950)],
    ]
    fringe_radii = [[0.014, 0.018, 0.017, 0.008], [0.015, 0.018, 0.009], [0.014, 0.017, 0.007]]
    for index, points in enumerate(fringe):
        strand(f"Fringe lock {index}", points, fringe_radii[index], hair, sides=10)

    for side in (-1, 1):
        # Slim face framing set behind the cheek so the profile stays readable.
        strand(
            f"Face framing lock {side}",
            [
                (side * 0.0840, 0.0080, 1.5980),
                (side * 0.0880, -0.0140, 1.5300),
                (side * 0.0850, -0.0240, 1.4700),
                (side * 0.0800, -0.0220, 1.4380),
            ],
            [0.011, 0.013, 0.010, 0.004],
            hair,
            sides=10,
        )
        strand(
            f"Loose side strand {side}",
            [
                (side * 0.0840, 0.0200, 1.5900),
                (side * 0.0940, -0.0020, 1.5150),
                (side * 0.0900, 0.0100, 1.4500),
                (side * 0.0800, 0.0220, 1.4050),
            ],
            [0.010, 0.012, 0.009, 0.004],
            hair_light,
            sides=10,
        )
    strand(
        "Loose side lock off the updo",
        [(0.050, 0.086, 1.6900), (0.084, 0.064, 1.7080), (0.096, 0.038, 1.6980)],
        [0.010, 0.007, 0.003],
        hair_light,
        sides=8,
    )


def build_torso():
    loft(
        "Hoodie torso",
        [
            (Vector((0, 0, 0.9180)), 0.152, 0.108),
            (Vector((0, 0, 0.9520)), 0.156, 0.110),
            (Vector((0, 0, 0.9950)), 0.149, 0.106),
            (Vector((0, 0, 1.0550)), 0.134, 0.099),
            (Vector((0, 0, 1.1150)), 0.121, 0.093),
            (Vector((0, 0, 1.1750)), 0.129, 0.100),
            (Vector((0, 0, 1.2350)), 0.147, 0.111),
            (Vector((0, 0, 1.2900)), 0.157, 0.104),
            (Vector((0, 0, 1.3300)), 0.160, 0.097),
            (Vector((0, 0, 1.3600)), 0.149, 0.090),
            (Vector((0, 0, 1.3950)), 0.099, 0.072),
        ],
        hoodie,
        sides=28,
        sub=1,
    )
    # Hood resting on the upper back, deliberately narrow so it never reads as a cape.
    loft(
        "Hood volume",
        [
            (Vector((0, 0.044, 1.2850)), 0.100, 0.036),
            (Vector((0, 0.052, 1.3250)), 0.108, 0.042),
            (Vector((0, 0.056, 1.3700)), 0.100, 0.042),
            (Vector((0, 0.054, 1.4080)), 0.078, 0.034),
            (Vector((0, 0.048, 1.4340)), 0.044, 0.020),
        ],
        hoodie,
        sides=24,
        sub=1,
    )
    loft(
        "Hood lining opening",
        [
            (Vector((0, 0.016, 1.4180)), 0.074, 0.038),
            (Vector((0, 0.026, 1.4480)), 0.058, 0.028),
        ],
        hoodie_light,
        sides=20,
    )
    loft(
        "Hoodie collar",
        [
            (Vector((0, -0.004, 1.3800)), 0.094, 0.070),
            (Vector((0, 0.006, 1.4180)), 0.100, 0.074),
            (Vector((0, 0.020, 1.4440)), 0.092, 0.066),
        ],
        hoodie_light,
        sides=24,
    )
    loft(
        "Hoodie hem ribbing",
        [
            (Vector((0, 0, 0.9060)), 0.150, 0.107),
            (Vector((0, 0, 0.9260)), 0.154, 0.109),
        ],
        hoodie_dark,
        sides=28,
    )
    ellipsoid("Kangaroo pocket", (0, -0.093, 1.0300), (0.104, 0.011, 0.046), hoodie_light, 24, 14)
    strand(
        "Pocket opening",
        [(-0.086, -0.096, 1.0680), (-0.038, -0.106, 1.0560), (0.038, -0.106, 1.0560), (0.086, -0.096, 1.0680)],
        0.0034,
        hoodie_dark,
        sides=8,
    )
    star("Star emblem edging", (0, 0, 1.2680), 0.0830, 0.0350, gold_edge, conform=(0.150, 0.1105), lift=0.0020)
    star("Prominent hoodie star", (0, 0, 1.2680), 0.0720, 0.0305, gold, conform=(0.150, 0.1105), lift=0.0050)

    for side in (-1, 1):
        strand(
            f"Hood drawstring {side}",
            [(side * 0.044, -0.074, 1.4180), (side * 0.056, -0.096, 1.3720), (side * 0.052, -0.098, 1.3300)],
            0.0034,
            hoodie_light,
            sides=8,
        )
        ellipsoid(f"Drawstring aglet {side}", (side * 0.052, -0.099, 1.3240), (0.0042, 0.0042, 0.0088), hoodie_dark, 12, 8)


def build_legs():
    for side in (-1, 1):
        loft(
            f"Trouser leg {side}",
            [
                (Vector((side * 0.0820, 0.004, 0.9450)), 0.098, 0.110),
                (Vector((side * 0.0855, 0.000, 0.8700)), 0.094, 0.106),
                (Vector((side * 0.0875, -0.004, 0.7600)), 0.085, 0.099),
                (Vector((side * 0.0880, -0.008, 0.6300)), 0.073, 0.087),
                (Vector((side * 0.0865, -0.010, 0.4900)), 0.063, 0.074),
                (Vector((side * 0.0865, -0.016, 0.3900)), 0.070, 0.082),
                (Vector((side * 0.0865, -0.020, 0.2400)), 0.055, 0.063),
                (Vector((side * 0.0865, -0.022, 0.1650)), 0.048, 0.054),
            ],
            trousers,
            sides=22,
            sub=1,
        )
        loft(
            f"Trouser cuff {side}",
            [
                (Vector((side * 0.0865, -0.022, 0.1520)), 0.050, 0.056),
                (Vector((side * 0.0865, -0.022, 0.1780)), 0.049, 0.055),
            ],
            hoodie_dark,
            sides=22,
        )
        x = side * 0.0865
        loft(
            f"Trainer upper {side}",
            [
                (Vector((x, 0.0100, 0.1520)), 0.046, 0.048),
                (Vector((x, -0.0500, 0.0940)), 0.053, 0.055),
                (Vector((x, -0.1080, 0.0600)), 0.055, 0.053),
                (Vector((x, -0.1680, 0.0495)), 0.048, 0.043),
                (Vector((x, -0.2080, 0.0470)), 0.029, 0.027),
            ],
            trainers,
            sides=18,
            reference=(0, 0, 1),
        )
        loft(
            f"Trainer sole {side}",
            [
                (Vector((x, 0.0450, 0.0240)), 0.044, 0.024),
                (Vector((x, -0.0300, 0.0200)), 0.056, 0.022),
                (Vector((x, -0.1300, 0.0185)), 0.058, 0.021),
                (Vector((x, -0.2120, 0.0220)), 0.040, 0.021),
            ],
            soles,
            sides=18,
            reference=(0, 0, 1),
        )
        loft(
            f"Trainer heel counter {side}",
            [
                (Vector((x, 0.0480, 0.0560)), 0.044, 0.032),
                (Vector((x, 0.0180, 0.0760)), 0.048, 0.038),
                (Vector((x, -0.0120, 0.0760)), 0.047, 0.036),
            ],
            trainer_panel,
            sides=18,
            reference=(0, 0, 1),
        )
        ellipsoid(f"Trainer tongue {side}", (x, -0.0560, 0.0960), (0.032, 0.028, 0.017), trainer_panel, 16, 10)
        for index in range(3):
            strand(
                f"Trainer lace {side}-{index}",
                [(x - 0.028 + 0.028 * index, -0.0480, 0.1000), (x + 0.028 - 0.028 * index, -0.0880, 0.0810)],
                0.0034,
                laces,
                sides=6,
            )


ARM_OBJECTS = []


def clear_arms():
    for obj in ARM_OBJECTS:
        bpy.data.objects.remove(obj, do_unlink=True)
    ARM_OBJECTS.clear()


def build_hand(side, wrist, direction, spread):
    """Small readable hand: palm, four relaxed three-part fingers and an opposed thumb.

    Fingers fan across the palm's width axis (X) so the hand reads from the front.
    """
    origin = Vector(wrist)
    axis = Vector(direction).normalized()
    palm_centre = origin + axis * 0.028 + Vector((side * 0.003, 0.0, 0.0))
    ARM_OBJECTS.append(ellipsoid(f"Hand palm {side}", tuple(palm_centre), (0.036, 0.021, 0.038), skin, 20, 14))
    ARM_OBJECTS.append(
        ellipsoid(f"Hand knuckle pad {side}", tuple(palm_centre + axis * 0.025 + Vector((0, 0, 0.003))), (0.034, 0.020, 0.015), skin, 16, 10)
    )

    lengths = (0.028, 0.019, 0.014)
    radii = (0.0104, 0.0094, 0.0078)
    for finger in range(4):
        lateral = side * (finger - 1.5) * 0.0150
        root = palm_centre + Vector((lateral, 0.0, 0.0)) + axis * 0.025 + Vector((0.0, 0.0, 0.004 * (1.5 - abs(finger - 1.5))))
        curl = 0.40 + 0.35 * (finger in (0, 3))
        point = root
        for joint in range(3):
            tilt = axis + Vector((-lateral * 0.9, 0.0, -0.26 * curl - 0.08 * joint))
            nxt = point + tilt.normalized() * lengths[joint]
            ARM_OBJECTS.append(strand(f"Finger {side}-{finger}-{joint}", [tuple(point), tuple(nxt)], radii[joint], skin, sides=8))
            point = nxt
        ARM_OBJECTS.append(ellipsoid(f"Finger tip {side}-{finger}", tuple(point), (0.0074, 0.0074, 0.0074), skin, 12, 8))

    thumb_root = palm_centre + Vector((side * 0.024, -0.004, -0.010))
    thumb_dir = (axis * 0.6 + Vector((side * 0.68, -0.20, -0.16))).normalized()
    thumb_mid = thumb_root + thumb_dir * 0.025
    thumb_tip = thumb_mid + (thumb_dir * 0.8 + Vector((0.0, -0.16, -0.12))).normalized() * 0.019
    ARM_OBJECTS.append(strand(f"Thumb {side}-0", [tuple(thumb_root), tuple(thumb_mid)], 0.0112, skin, sides=8))
    ARM_OBJECTS.append(strand(f"Thumb {side}-1", [tuple(thumb_mid), tuple(thumb_tip)], 0.0092, skin, sides=8))
    ARM_OBJECTS.append(ellipsoid(f"Thumb tip {side}", tuple(thumb_tip), (0.0080, 0.0080, 0.0080), skin, 12, 8))


def build_arms(pose="neutral"):
    clear_arms()
    for side in (-1, 1):
        shoulder = Vector((side * 0.1520, 0.000, 1.3420))
        if pose == "wave" and side == 1:
            elbow = Vector((0.2400, -0.0300, 1.3980))
            wrist = Vector((0.2520, -0.0780, 1.6180))
            direction = Vector((0.16, -0.12, 0.98))
            spread = 1.8
        else:
            elbow = Vector((side * 0.1880, -0.0060, 1.1080))
            wrist = Vector((side * 0.1990, -0.0340, 0.8880))
            direction = Vector((0.10, -0.24, -0.97))
            spread = 0.6

        ARM_OBJECTS.append(
            loft(
                f"Hoodie sleeve {side}",
                [
                    (shoulder, 0.062, 0.064),
                    (shoulder.lerp(elbow, 0.35) + Vector((side * 0.005, 0, 0)), 0.054, 0.056),
                    (shoulder.lerp(elbow, 0.75), 0.047, 0.049),
                    (elbow, 0.044, 0.045),
                    (elbow.lerp(wrist, 0.45), 0.040, 0.042),
                    (wrist, 0.035, 0.036),
                ],
                hoodie,
                sides=20,
                sub=1,
            )
        )
        ARM_OBJECTS.append(
            loft(
                f"Sleeve cuff {side}",
                [
                    (wrist + (wrist - elbow).normalized() * 0.012, 0.039, 0.040),
                    (wrist - (wrist - elbow).normalized() * 0.004, 0.036, 0.037),
                ],
                hoodie_dark,
                sides=20,
            )
        )
        build_hand(side, wrist, direction, spread)


# -------------------------------------------------------------- scene setup

bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
FLOOR = bpy.context.object
finish("Review floor", FLOOR, backdrop, smooth=False)

world = bpy.context.scene.world
world.color = (0.08, 0.06, 0.14)


def area_light(name, location, energy, size, colour=(1.0, 0.97, 1.0)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = colour
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, 1.15)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


area_light("Soft key", (-2.2, -3.4, 3.6), 190, 3.2)
area_light("Violet rim", (2.4, 1.8, 3.2), 90, 2.6, colour=(0.82, 0.74, 1.0))
area_light("Face fill", (0.6, -2.4, 2.0), 50, 1.8)

camera_data = bpy.data.cameras.new("Review camera")
camera = bpy.data.objects.new("Review camera", camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera_data.type = "ORTHO"
camera_data.ortho_scale = 2.05

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 760
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0


def build_character():
    build_torso()
    build_head()
    build_hair()
    build_legs()
    build_arms("neutral")


build_character()


def geometry_report():
    triangles = 0
    count = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name == "Review floor":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
        count += 1
    return triangles, count


TRIANGLES, OBJECTS = geometry_report()
print(
    f"ASTRA_LW02B_GEOMETRY triangles={TRIANGLES} objects={OBJECTS} "
    f"height={HEIGHT} head_unit={HEAD_UNIT:.4f} heads_tall={HEADS_TALL:.2f}"
)

bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "astra-lw02b-character.blend"))


def render_view(name, position, pose="neutral", target=0.95):
    build_arms(pose)
    camera.location = position
    camera.rotation_euler = (Vector((0, 0, target)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(OUTPUT / f"astra-lw02b-{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"ASTRA_LW02B_RENDER_OK {name} {scene.render.filepath}")


render_view("front", (0.0, -7.0, 1.50))
render_view("left-side", (7.0, 0.0, 1.50))
render_view("back", (0.0, 7.0, 1.50))
render_view("three-quarter", (4.2, -5.5, 1.66))
render_view("waving", (4.2, -5.5, 1.66), pose="wave")


# ------------------------------------------------------- in-room turnaround

def build_room():
    """A restrained echo of the application's procedural room for scale review."""
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT" or (obj.type == "MESH" and obj is not FLOOR):
            bpy.data.objects.remove(obj, do_unlink=True)
    PARTS.clear()
    ARM_OBJECTS.clear()

    box("Room back wall", (0, 1.35, 1.60), (5.0, 0.08, 3.20), room_wall)
    box("Room side wall", (-2.45, 0.0, 1.60), (0.08, 2.80, 3.20), room_side)
    box("Room rug", (0.10, -0.30, 0.005), (1.45, 1.05, 0.007), room_rug, bevel=0.004)
    box("Sofa base", (1.45, 0.55, 0.24), (0.62, 0.24, 0.24), room_furniture, bevel=0.03)
    box("Sofa back", (1.45, 0.76, 0.55), (0.62, 0.07, 0.34), room_furniture, bevel=0.03)
    box("Table top", (-1.05, 0.35, 0.36), (0.42, 0.30, 0.02), room_furniture, bevel=0.008)
    for dx, dy in ((-0.34, -0.24), (0.34, -0.24), (-0.34, 0.24), (0.34, 0.24)):
        box(f"Table leg {dx} {dy}", (-1.05 + dx, 0.35 + dy, 0.18), (0.015, 0.015, 0.18), room_furniture)

    build_character()
    area_light("Room key", (-1.6, -2.6, 3.0), 220, 2.6)
    area_light("Room rim", (2.0, 1.4, 2.6), 120, 2.2, colour=(0.82, 0.74, 1.0))

    camera_data.type = "PERSP"
    camera_data.lens = 40
    camera.location = (0.95, -3.05, 1.55)
    camera.rotation_euler = (Vector((0, 0, 0.95)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 760
    scene.render.filepath = str(OUTPUT / "astra-lw02b-room.png")
    bpy.ops.render.render(write_still=True)
    print(f"ASTRA_LW02B_RENDER_OK room {scene.render.filepath}")


build_room()
print("ASTRA_LW02B_COMPLETE")