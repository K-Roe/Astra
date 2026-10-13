"""Astra character model definition - the single source of truth for the design.

This module builds Astra's geometry from a shared skull landmark table and
facial displacement function. It contains NO scene, camera, lighting or
rendering, so the review renderer (create_astra_character_r1.py) and the rig
builder (create_astra_rigged_v1.py) can share exactly the same character.

Requires Blender 5.2 LTS. No add-ons, no external textures, no simulation.
"""

import bpy
import math
from mathutils import Vector

HEIGHT = 1.70
HEAD_BOTTOM = 1.3900
HEAD_TOP = 1.7020
HEAD_UNIT = HEAD_TOP - HEAD_BOTTOM

# Global geometry detail multiplier. 1.0 reproduces the reviewed LW-02B-R1
# design exactly; the production rig lowers it to fit the real-time triangle
# budget. Subdivision modifiers are skipped below 0.9 because they cost more
# than they buy at this scale.
DETAIL = 1.0


def detail_segments(value):
    return max(6, int(round(value * DETAIL)))

FACE = {
    "eye": 1.5330,
    "brow": 1.5680,
    "ear": 1.5250,
    "cheek": 1.5060,
    "nose_tip": 1.4790,
    "nose_root": 1.5520,
    "philtrum": 1.4655,
    "lip_line": 1.4415,
    "chin": 1.4060,
    "hairline": 1.6050,
}

# Smooth skull control rings: (z, half_width, half_depth, centre_depth)
SKULL = [
    (1.3900, 0.030, 0.040, -0.006),
    (1.4050, 0.048, 0.058, -0.005),
    (1.4250, 0.064, 0.076, -0.004),
    (1.4450, 0.074, 0.090, -0.002),
    (1.4700, 0.080, 0.098, -0.001),
    (1.5000, 0.086, 0.104, 0.000),
    (1.5350, 0.089, 0.107, 0.000),
    (1.5700, 0.088, 0.105, 0.001),
    (1.6050, 0.085, 0.101, 0.002),
    (1.6400, 0.079, 0.093, 0.004),
    (1.6700, 0.064, 0.076, 0.006),
    (1.6900, 0.040, 0.048, 0.007),
    (1.7020, 0.016, 0.020, 0.007),
]

EXPRESSIONS = {
    "neutral": {
        "socket": 0.0090,
        "brow_lift": 0.0,
        "brow_inner": 0.0,
        "lip_rise": 0.045,
        "lip_fullness": 1.0,
        "cheek_lift": 0.0016,
        "mouth_open": 0.0,
        "mouth_wide": 1.0,
        "lip_round": 1.0,
        "blink": 0.0,
    },
    "smile": {
        "socket": 0.0082,
        "brow_lift": 0.0035,
        "brow_inner": 0.0022,
        "lip_rise": 0.300,
        "lip_fullness": 1.30,
        "cheek_lift": 0.0048,
        "mouth_open": 0.0,
        "mouth_wide": 1.05,
        "lip_round": 1.0,
        "blink": 0.0,
    },
    "happy": {
        "socket": 0.0080,
        "brow_lift": 0.0060,
        "brow_inner": 0.0000,
        "lip_rise": 0.230,
        "lip_fullness": 1.20,
        "cheek_lift": 0.0052,
        "mouth_open": 0.0030,
        "mouth_wide": 1.15,
        "lip_round": 0.95,
        "blink": 0.0,
    },
    "curious": {
        "socket": 0.0094,
        "brow_lift": 0.0018,
        "brow_inner": -0.0030,
        "lip_rise": 0.090,
        "lip_fullness": 1.02,
        "cheek_lift": 0.0020,
        "mouth_open": 0.0012,
        "mouth_wide": 1.05,
        "lip_round": 1.0,
        "blink": 0.0,
    },
    "thinking": {
        "socket": 0.0086,
        "brow_lift": -0.0018,
        "brow_inner": 0.0050,
        "lip_rise": 0.010,
        "lip_fullness": 0.94,
        "cheek_lift": 0.0010,
        "mouth_open": 0.0000,
        "mouth_wide": 0.95,
        "lip_round": 1.05,
        "blink": 0.0,
    },
    "surprised": {
        "socket": 0.0072,
        "brow_lift": 0.0085,
        "brow_inner": 0.0030,
        "lip_rise": 0.060,
        "lip_fullness": 1.0,
        "cheek_lift": 0.0008,
        "mouth_open": 0.0068,
        "mouth_wide": 1.02,
        "lip_round": 0.88,
        "blink": 0.0,
    },
    "listening": {
        "socket": 0.0084,
        "brow_lift": 0.0030,
        "brow_inner": 0.0010,
        "lip_rise": 0.100,
        "lip_fullness": 1.05,
        "cheek_lift": 0.0024,
        "mouth_open": 0.0008,
        "mouth_wide": 1.06,
        "lip_round": 1.0,
        "blink": 0.0,
    },
    # Speech-ready visemes. No audio drives these yet; they exist so a future
    # lip-sync service can drive the same shape keys.
    "vis_aa": {
        "socket": 0.0090, "brow_lift": 0.0, "brow_inner": 0.0, "lip_rise": 0.030,
        "lip_fullness": 0.95, "cheek_lift": 0.0012, "mouth_open": 0.0078,
        "mouth_wide": 1.00, "lip_round": 0.92, "blink": 0.0,
    },
    "vis_ee": {
        "socket": 0.0090, "brow_lift": 0.0, "brow_inner": 0.0, "lip_rise": 0.060,
        "lip_fullness": 1.10, "cheek_lift": 0.0026, "mouth_open": 0.0016,
        "mouth_wide": 1.28, "lip_round": 0.90, "blink": 0.0,
    },
    "vis_oo": {
        "socket": 0.0090, "brow_lift": 0.0, "brow_inner": 0.0, "lip_rise": 0.040,
        "lip_fullness": 1.05, "cheek_lift": 0.0018, "mouth_open": 0.0044,
        "mouth_wide": 0.80, "lip_round": 1.30, "blink": 0.0,
    },
    "vis_ff": {
        "socket": 0.0090, "brow_lift": 0.0, "brow_inner": 0.0, "lip_rise": 0.100,
        "lip_fullness": 0.96, "cheek_lift": 0.0022, "mouth_open": 0.0006,
        "mouth_wide": 1.12, "lip_round": 0.95, "blink": 0.0,
    },
    "blink": {
        "socket": 0.0090, "brow_lift": 0.0, "brow_inner": 0.0, "lip_rise": 0.045,
        "lip_fullness": 1.0, "cheek_lift": 0.0016, "mouth_open": 0.0,
        "mouth_wide": 1.0, "lip_round": 1.0, "blink": 1.0,
    },
}

# Expressions exported as glTF morph targets. "neutral" is the basis mesh.
MORPH_NAMES = [
    "happy", "smile", "curious", "thinking", "surprised", "listening",
    "vis_aa", "vis_ee", "vis_oo", "vis_ff", "blink",
]


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

PARTS = []


# ---------------------------------------------------------------- materials


def material(name, rgb, roughness=0.7, specular=0.4, sheen=0.0, subsurface=0.0):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*rgb, 1)
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*rgb, 1)
    principled.inputs["Roughness"].default_value = roughness
    for socket, value in (("Specular IOR Level", specular), ("Sheen Weight", sheen), ("Subsurface Weight", subsurface)):
        if socket in principled.inputs:
            principled.inputs[socket].default_value = value
    if subsurface and "Subsurface Radius" in principled.inputs:
        principled.inputs["Subsurface Radius"].default_value = (0.010, 0.006, 0.004)
    return result


skin = material("Skin", (0.84, 0.58, 0.47), 0.54, 0.35, subsurface=0.14)
skin_soft = material("Skin soft detail", (0.80, 0.55, 0.46), 0.58, 0.3, subsurface=0.10)
skin_deep = material("Skin crease", (0.70, 0.44, 0.38), 0.62, 0.25)
blush = material("Cheek blush", (0.82, 0.42, 0.42), 0.75, 0.2)
lash = material("Lash line", (0.11, 0.05, 0.13), 0.55, 0.2)
eyes_white = material("Eye white", (0.90, 0.87, 0.86), 0.16, 0.6)
iris = material("Iris", (0.34, 0.15, 0.46), 0.18, 0.7)
iris_rim = material("Iris rim", (0.15, 0.05, 0.22), 0.2, 0.6)
pupil = material("Pupil", (0.04, 0.02, 0.06), 0.12, 0.8)
glint = material("Eye glint", (1.0, 1.0, 1.0), 0.05, 0.9)
lips = material("Lips", (0.46, 0.17, 0.22), 0.45, 0.35)
mouth_inner = material("Mouth interior", (0.28, 0.07, 0.12), 0.6, 0.2)
hair = material("Hair", (0.31, 0.08, 0.56), 0.42, 0.45, sheen=0.35)
hair_deep = material("Hair deeper tone", (0.20, 0.04, 0.39), 0.44, 0.45, sheen=0.3)
hair_light = material("Hair highlight", (0.48, 0.20, 0.70), 0.38, 0.45, sheen=0.45)
hoodie = material("Hoodie fabric", (0.26, 0.10, 0.47), 0.9, 0.2, sheen=0.35)
hoodie_fold = material("Hoodie fold", (0.18, 0.07, 0.35), 0.92, 0.18, sheen=0.3)
hoodie_light = material("Hoodie lining", (0.38, 0.22, 0.58), 0.9, 0.2, sheen=0.3)
trousers = material("Trousers", (0.062, 0.055, 0.092), 0.86, 0.22, sheen=0.2)
trousers_fold = material("Trouser fold", (0.045, 0.040, 0.070), 0.88, 0.2)
trainers = material("Trainers", (0.52, 0.40, 0.68), 0.72, 0.3)
trainer_panel = material("Trainer panels", (0.33, 0.22, 0.49), 0.7, 0.3)
soles = material("Trainer soles", (0.66, 0.61, 0.74), 0.6, 0.3)
laces = material("Laces", (0.97, 0.95, 1.0), 0.75, 0.2)
gold = material("Star emblem", (1.0, 0.76, 0.28), 0.3, 0.7)
gold_edge = material("Star edging", (0.66, 0.38, 0.09), 0.35, 0.5)
backdrop = material("Review backdrop", (0.075, 0.05, 0.13), 0.95)
room_wall = material("Room wall", (0.30, 0.21, 0.38), 0.95)
room_side = material("Room side wall", (0.23, 0.17, 0.32), 0.95)
room_floor = material("Room floor", (0.15, 0.11, 0.21), 0.9)
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
    """Skin a ring per spine point. Each entry is (center, radius_x, radius_y)."""
    sides = detail_segments(sides)
    if DETAIL < 0.9:
        sub = 0
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
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * len(points)
    return loft(name, [(Vector(point), radius, radius) for point, radius in zip(points, radii)], surface, sides=sides)


def ellipsoid(name, location, scale, surface, segments=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=detail_segments(segments), ring_count=detail_segments(rings), location=location
    )
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
    """Five-point emblem conformed to the chest ellipse."""
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


# ------------------------------------------------- sculpted head construction

def skull_profile(z):
    """Interpolate (half_width, half_depth, centre_depth) at height z."""
    rows = SKULL
    if z <= rows[0][0]:
        return rows[0][1], rows[0][2], rows[0][3]
    if z >= rows[-1][0]:
        return rows[-1][1], rows[-1][2], rows[-1][3]
    for index in range(len(rows) - 1):
        low, high = rows[index], rows[index + 1]
        if low[0] <= z <= high[0]:
            t = (z - low[0]) / (high[0] - low[0])
            return (
                low[1] + (high[1] - low[1]) * t,
                low[2] + (high[2] - low[2]) * t,
                low[3] + (high[3] - low[3]) * t,
            )
    return rows[-1][1], rows[-1][2], rows[-1][3]


def blob(x, z, x0, z0, sx, sz):
    return math.exp(-(((x - x0) ** 2) / (2 * sx * sx) + ((z - z0) ** 2) / (2 * sz * sz)))


def facial_displacement(x, z, e):
    """Radial offset applied to the skull surface: positive pushes outward."""
    ax = abs(x)
    d = 0.0

    # Eye sockets: a real depression so the eyeball sits inside the face.
    d -= e["socket"] * (blob(x, z, -0.0365, FACE["eye"], 0.0230, 0.0165) + blob(x, z, 0.0365, FACE["eye"], 0.0230, 0.0165))
    # Brow ridge: a gentle shelf above each socket, relaxed by default.
    brow_z = FACE["brow"] + e["brow_lift"] + e["brow_inner"] * (1.0 - min(1.0, ax / 0.030))
    d += 0.0032 * (blob(x, z, -0.0350, brow_z, 0.0270, 0.0115) + blob(x, z, 0.0350, brow_z, 0.0270, 0.0115))

    # Nose: a slim bridge that resolves into a soft, small stylised tip.
    d += 0.0034 * blob(ax, z, 0.0, 1.5200, 0.0105, 0.0165)
    d += 0.0098 * blob(ax, z, 0.0, FACE["nose_tip"], 0.0125, 0.0098)
    d += 0.0034 * blob(ax, z, 0.0128, FACE["nose_tip"] - 0.0018, 0.0072, 0.0078)
    d -= 0.0012 * blob(ax, z, 0.0, FACE["philtrum"], 0.0058, 0.0046)

    # Mouth: an integrated lip crease with upper and lower lip volume that rises
    # toward the corners, plus a soft crease at each corner when smiling.
    rise = e["lip_rise"]
    corner_z = FACE["lip_line"] + rise * ax * 2.2
    # The lips must straddle the seam: upper lip above it, lower lip below.
    d += 0.0026 * e["lip_fullness"] * blob(ax, z, 0.0, corner_z + 0.0042, 0.0150 * e["mouth_wide"], 0.0052)
    d += 0.0038 * e["lip_fullness"] * blob(ax, z, 0.0, corner_z - 0.0058, 0.0155 * e["mouth_wide"], 0.0062 * e["lip_round"])
    d -= 0.0013 * blob(ax, z, 0.0, corner_z, 0.0175 * e["mouth_wide"], 0.0028)
    d -= e["mouth_open"] * blob(ax, z, 0.0, corner_z - 0.0005, 0.0120, 0.0026)
    d -= 0.0035 * e["cheek_lift"] / 0.0042 * (
        blob(x, z, -0.0295, corner_z - 0.0015, 0.0080, 0.0075) + blob(x, z, 0.0295, corner_z - 0.0015, 0.0080, 0.0075)
    )
    d -= e["mouth_open"] * blob(ax, z, 0.0, corner_z - 0.0005, 0.0120, 0.0022)

    # Cheekbones, jaw softening and chin give the face its structure.
    d += 0.0030 * (blob(x, z, -0.0520, FACE["cheek"], 0.0250, 0.0210) + blob(x, z, 0.0520, FACE["cheek"], 0.0250, 0.0210))
    d += 0.0018 * (blob(x, z, -0.0575, 1.4520, 0.0200, 0.0190) + blob(x, z, 0.0575, 1.4520, 0.0200, 0.0190))
    d += 0.0032 * blob(ax, z, 0.0, FACE["chin"], 0.0200, 0.0130)
    return d


def face_surface_y(x, z, e):
    """Front surface y of the sculpted head at (x, z); -Y is forward."""
    rx, ry, cy = skull_profile(z)
    k = max(0.0, 1.0 - (x / rx) ** 2)
    base = cy - ry * math.sqrt(k)
    offset = facial_displacement(x, z, e)
    dy = -math.sqrt(k) if k > 0 else 0.0
    return base + offset * dy


HEAD_RING_COUNT = 34
HEAD_SIDES = 96


def head_mesh_size():
    """Ring and side counts for the current DETAIL; shape keys depend on this."""
    return max(18, int(HEAD_RING_COUNT * DETAIL)), max(56, int(HEAD_SIDES * DETAIL))


def head_vertex_positions(expression):
    """Deterministic vertex list for the sculpted head at a given expression.

    Extracted so morph targets can be authored from exactly the same maths that
    builds the basis mesh, with a guaranteed identical vertex order.
    """
    e = EXPRESSIONS[expression]
    ring_count, side_count = head_mesh_size()
    rings = []
    for step in range(ring_count):
        t = step / (ring_count - 1)
        z = HEAD_BOTTOM + t * (HEAD_TOP - HEAD_BOTTOM)
        # Denser sampling through the facial zone.
        if 0.10 < t < 0.62:
            z = HEAD_BOTTOM + (0.10 + (t - 0.10) / 0.52 * 0.52) * (HEAD_TOP - HEAD_BOTTOM)
        rx, ry, cy = skull_profile(z)
        ring = []
        for index in range(side_count):
            angle = 2 * math.pi * index / side_count
            x = rx * math.cos(angle)
            y = cy + ry * math.sin(angle)
            front = max(0.0, -math.sin(angle)) ** 1.2  # only shape the face hemisphere
            if front > 0.0:
                y += facial_displacement(x, z, e) * (-math.sin(angle)) * front
            ring.append((x, y, z))
        rings.append(ring)

    vertices = [vertex for ring in rings for vertex in ring]
    for end, ring_index in ((0, 0), (1, ring_count - 1)):
        vertices.append((0.0, SKULL[0][3] if end == 0 else SKULL[-1][3], HEAD_BOTTOM if end == 0 else HEAD_TOP))
    return vertices


def head_mesh_faces():
    ring_count, side_count = head_mesh_size()
    faces = []
    for step in range(ring_count - 1):
        for index in range(side_count):
            a = step * side_count + index
            b = step * side_count + (index + 1) % side_count
            faces.append((a, b, b + side_count, a + side_count))
    for end, ring_index in ((0, 0), (1, ring_count - 1)):
        centre_index = ring_count * side_count + end
        for index in range(side_count):
            a = ring_index * side_count + index
            b = ring_index * side_count + (index + 1) % side_count
            faces.append((centre_index, b, a) if end == 0 else (centre_index, a, b))
    return faces


def build_head(expression):
    """One continuous sculpted head: sockets, brows, nose, lips and chin are
    displaced into the skull surface rather than added as separate blobs."""
    mesh = bpy.data.meshes.new("Head mesh")
    mesh.from_pydata(head_vertex_positions(expression), [], head_mesh_faces())
    mesh.update()
    obj = bpy.data.objects.new("Head", mesh)
    bpy.context.collection.objects.link(obj)
    finish("Head", obj, skin)

    loft(
        "Neck",
        [
            (Vector((0, 0.016, 1.3200)), 0.052, 0.050),
            (Vector((0, 0.012, 1.3600)), 0.050, 0.048),
            (Vector((0, 0.006, 1.4000)), 0.052, 0.052),
            (Vector((0, 0.000, 1.4250)), 0.054, 0.056),
        ],
        skin,
        sides=20,
    )
    for side in (-1, 1):
        ellipsoid(f"Ear {side}", (side * 0.0855, 0.006, FACE["ear"]), (0.010, 0.018, 0.026), skin_soft, 16, 12)
    return obj


def eye_aperture(t, side, blink=0.0):
    """Almond opening: wider than tall, pointed at both corners. Blink closes it."""
    a, b = 0.0240, 0.0138 * (1.0 - 0.94 * blink)
    c, s = math.cos(t), math.sin(t)
    n = 2.6
    ex = math.copysign(abs(c) ** (2 / n), c)
    ez = math.copysign(abs(s) ** (2 / n), s)
    return side * 0.0365 + ex * a, FACE["eye"] + ez * b


EYE_RADIUS = 0.0158
LID_RADIUS = 0.0171


def build_eyes(expression):
    e = EXPRESSIONS[expression]
    blink = e["blink"]
    for side in (-1, 1):
        cx = side * 0.0365
        cz = FACE["eye"]
        surface = face_surface_y(cx, cz, e)
        centre_y = surface + 0.0042 - e["mouth_open"] * 0.0

        ellipsoid(f"Eyeball {side}", (cx, centre_y, cz), (EYE_RADIUS, EYE_RADIUS, EYE_RADIUS), eyes_white, 32, 20)

        def on_sphere(x, z, radius=LID_RADIUS):
            dx, dz = x - cx, z - cz
            inner = max(0.0, radius * radius - dx * dx - dz * dz)
            return centre_y - math.sqrt(inner)

        upper, lower = [], []
        steps = 14
        for index in range(steps + 1):
            t = math.pi * index / steps
            x, z = eye_aperture(t, side, blink)
            upper.append((x, on_sphere(x, z), z))
        for index in range(steps + 1):
            t = -math.pi * index / steps
            x, z = eye_aperture(t, side, blink)
            lower.append((x, on_sphere(x, z), z))

        strand(f"Upper eyelid {side}", upper, [0.0026 if 0 < i < steps else 0.0014 for i in range(steps + 1)], skin, sides=8)
        strand(f"Lower eyelid {side}", lower, [0.0020 if 0 < i < steps else 0.0010 for i in range(steps + 1)], skin_soft, sides=8)
        strand(
            f"Lash line {side}",
            [(x, y - 0.0016, z + 0.0008) for x, y, z in upper],
            [0.0018 if 0 < i < steps else 0.0009 for i in range(steps + 1)],
            lash,
            sides=6,
        )

        gaze = Vector((side * 0.0012, 0.0, -0.0020))
        # These must sit proud of the eyeball surface or they vanish inside it.
        ellipsoid(f"Iris {side}", (cx + gaze.x, centre_y - 0.0115, cz + gaze.z), (0.0110, 0.0110, 0.0110), iris_rim, 28, 18)
        ellipsoid(f"Iris colour {side}", (cx + gaze.x, centre_y - 0.0124, cz + gaze.z), (0.0097, 0.0097, 0.0097), iris, 28, 18)
        ellipsoid(f"Pupil {side}", (cx + gaze.x, centre_y - 0.0140, cz + gaze.z), (0.0050, 0.0050, 0.0050), pupil, 22, 16)
        ellipsoid(f"Eye glint {side}", (cx - side * 0.0044, centre_y - 0.0152, cz + 0.0062), (0.0026, 0.0026, 0.0026), glint, 12, 10)

        # Relaxed, gently arched brow sitting on the brow ridge.
        lift = e["brow_lift"] + e["brow_inner"] * (1.0 - min(1.0, 0.030 / 0.030))
        brow_path = [
            (cx - side * 0.0230, 0.0),
            (cx - side * 0.0060, 0.0042),
            (cx + side * 0.0120, 0.0030),
            (cx + side * 0.0235, -0.0018),
        ]
        brow = []
        for x, dz in brow_path:
            brow.append((x, face_surface_y(x, FACE["brow"] + dz + lift * 0.6, e) - 0.0016, FACE["brow"] + dz + lift))
        strand(f"Eyebrow {side}", brow, [0.0028, 0.0056, 0.0048, 0.0018], hair_deep, sides=8)
        strand(
            f"Eyebrow tail {side}",
            [brow[2], (cx + side * 0.0250, brow[-1][1] - 0.0006, brow[-1][2] - 0.0022)],
            [0.0026, 0.0008],
            hair_deep,
            sides=6,
        )

    # The mouth is a sculpted lip crease plus a thin lip line. The interior is
    # only exposed when the expression actually opens the mouth.
    # The mouth interior is always generated so every expression produces the same
    # vertex layout, which is what lets morph targets be authored by rebuilding.
    rise = e["lip_rise"]
    lip_line = []
    for x in (0.025, 0.018, 0.009, 0.0):
        z = FACE["lip_line"] + rise * x * 2.2
        lip_line.append((x, face_surface_y(x, z, e) + 0.0008, z))
        if x > 0:
            lip_line.append((-x, face_surface_y(-x, z, e) + 0.0008, z))
    lip_line.sort(key=lambda point: point[0])
    strand("Lip line", lip_line, 0.0009, lips, sides=6)
    ellipsoid(
        "Mouth interior",
        (0.0, face_surface_y(0.0, FACE["lip_line"], e) + 0.0040 - e["mouth_open"], FACE["lip_line"] - 0.0010),
        (0.0135, 0.0070, 0.0022 + e["mouth_open"] * 1.1),
        mouth_inner,
        20,
        12,
    )
    for side in (-1, 1):
        ellipsoid(f"Cheek blush {side}", (side * 0.0520, face_surface_y(side * 0.0520, FACE["cheek"] - 0.010, e) + 0.0018, FACE["cheek"] - 0.010), (0.0155, 0.0032, 0.0072), blush, 20, 12)


# ------------------------------------------------------------------- hair


def build_hair():
    """Overlapping soft masses: one full crown, a back layer, a clearly gathered
    bun behind the crown and a broad side-swept fringe. No strand simulation."""
    loft(
        "Hair crown mass",
        [
            (Vector((0, 0.010, 1.5820)), 0.096, 0.110),
            (Vector((0, 0.010, 1.6220)), 0.103, 0.119),
            (Vector((0, 0.016, 1.6600)), 0.100, 0.115),
            (Vector((0, 0.026, 1.6950)), 0.084, 0.097),
            (Vector((0, 0.036, 1.7180)), 0.056, 0.066),
            (Vector((0, 0.044, 1.7320)), 0.026, 0.032),
        ],
        hair,
        sides=26,
        sub=1,
    )
    loft(
        "Hair back layer",
        [
            (Vector((0, 0.046, 1.4320)), 0.078, 0.060),
            (Vector((0, 0.058, 1.4980)), 0.097, 0.068),
            (Vector((0, 0.060, 1.5600)), 0.101, 0.072),
            (Vector((0, 0.054, 1.6140)), 0.096, 0.066),
        ],
        hair,
        sides=24,
        sub=1,
    )
    # A clearly gathered bun: one mass plus a single twist that wraps it.
    loft(
        "Hair bun",
        [
            (Vector((0.026, 0.086, 1.6620)), 0.048, 0.042),
            (Vector((0.030, 0.098, 1.7000)), 0.062, 0.050),
            (Vector((0.032, 0.100, 1.7260)), 0.048, 0.036),
            (Vector((0.034, 0.098, 1.7440)), 0.022, 0.016),
        ],
        hair,
        sides=24,
        sub=1,
    )
    strand(
        "Hair bun twist",
        [(0.074, 0.062, 1.6820), (0.046, 0.128, 1.7120), (-0.014, 0.130, 1.7360), (-0.058, 0.090, 1.7120)],
        [0.013, 0.017, 0.015, 0.008],
        hair_light,
        sides=10,
    )
    strand(
        "Loose gathered lock",
        [(-0.060, 0.044, 1.6360), (-0.080, 0.080, 1.6640), (-0.068, 0.118, 1.6940)],
        [0.014, 0.012, 0.006],
        hair,
        sides=10,
    )

    # Side-swept fringe built as lofted BANDS across the forehead rather than
    # round tubes, which read as bars when they lie on a curved skull.
    loft(
        "Fringe band main",
        [
            (Vector((-0.078, -0.046, 1.5990)), 0.020, 0.010),
            (Vector((-0.056, -0.072, 1.5950)), 0.023, 0.011),
            (Vector((-0.022, -0.094, 1.5920)), 0.024, 0.011),
            (Vector((0.014, -0.098, 1.5930)), 0.024, 0.011),
            (Vector((0.048, -0.080, 1.5990)), 0.022, 0.010),
            (Vector((0.076, -0.050, 1.6110)), 0.017, 0.009),
        ],
        hair,
        sides=18,
    )
    loft(
        "Fringe band sweep",
        [
            (Vector((-0.074, -0.020, 1.6200)), 0.017, 0.009),
            (Vector((-0.040, -0.062, 1.6140)), 0.020, 0.010),
            (Vector((0.004, -0.090, 1.6100)), 0.021, 0.011),
            (Vector((0.048, -0.086, 1.6150)), 0.019, 0.010),
            (Vector((0.060, -0.070, 1.6120)), 0.013, 0.007),
        ],
        hair,
        sides=18,
    )
    strand(
        "Fringe accent lock",
        [(-0.060, -0.052, 1.5920), (-0.014, -0.100, 1.5720), (0.048, -0.108, 1.5720)],
        [0.011, 0.013, 0.005],
        hair_light,
        sides=8,
    )

    for side in (-1, 1):
        # Face framing: soft masses kept behind the cheek line so the profile
        # silhouette and the face stay readable.
        loft(
            f"Hair cheek framing {side}",
            [
                (Vector((side * 0.090, 0.020, 1.5900)), 0.020, 0.020),
                (Vector((side * 0.093, 0.006, 1.5400)), 0.022, 0.020),
                (Vector((side * 0.089, -0.006, 1.4880)), 0.019, 0.017),
                (Vector((side * 0.082, -0.008, 1.4400)), 0.012, 0.011),
                (Vector((side * 0.078, -0.002, 1.4100)), 0.005, 0.005),
            ],
            hair,
            sides=14,
        )
        loft(
            f"Hair temple sweep {side}",
            [
                (Vector((side * 0.090, 0.030, 1.5960)), 0.020, 0.018),
                (Vector((side * 0.099, 0.000, 1.5380)), 0.021, 0.018),
                (Vector((side * 0.095, 0.012, 1.4700)), 0.016, 0.014),
                (Vector((side * 0.089, 0.028, 1.4180)), 0.006, 0.006),
            ],
            hair_deep,
            sides=14,
        )
        strand(
            f"Hair side wisp {side}",
            [(side * 0.090, 0.042, 1.6080), (side * 0.104, 0.012, 1.5320), (side * 0.098, 0.030, 1.4540), (side * 0.090, 0.046, 1.4000)],
            [0.008, 0.010, 0.007, 0.003],
            hair_light,
            sides=8,
        )
    strand("Hair crown wisp", [(-0.040, 0.054, 1.7160), (-0.086, 0.038, 1.7340), (-0.100, 0.008, 1.7240)], [0.011, 0.008, 0.004], hair_light, sides=8)


# ------------------------------------------------------------ torso and legs


def build_torso():
    loft(
        "Hoodie torso",
        [
            (Vector((0, 0, 0.9180)), 0.150, 0.106),
            (Vector((0, 0, 0.9520)), 0.155, 0.109),
            (Vector((0, 0, 0.9950)), 0.148, 0.105),
            (Vector((0, 0, 1.0550)), 0.133, 0.098),
            (Vector((0, 0, 1.1150)), 0.120, 0.092),
            (Vector((0, 0, 1.1750)), 0.128, 0.099),
            (Vector((0, 0, 1.2350)), 0.146, 0.110),
            (Vector((0, 0, 1.2900)), 0.156, 0.103),
            (Vector((0, 0, 1.3300)), 0.159, 0.096),
            (Vector((0, 0, 1.3600)), 0.148, 0.089),
            (Vector((0, 0, 1.3950)), 0.098, 0.071),
        ],
        hoodie,
        sides=26,
        sub=1,
    )
    # Fuller collar-down hood, narrow enough to read as fabric between the
    # shoulders rather than a slab across the back.
    loft(
        "Hood volume",
        [
            (Vector((0, 0.046, 1.2680)), 0.084, 0.036),
            (Vector((0, 0.058, 1.3180)), 0.096, 0.048),
            (Vector((0, 0.062, 1.3680)), 0.092, 0.050),
            (Vector((0, 0.058, 1.4140)), 0.076, 0.042),
            (Vector((0, 0.048, 1.4520)), 0.042, 0.022),
        ],
        hoodie,
        sides=24,
        sub=1,
    )
    loft(
        "Hood rim",
        [
            (Vector((0, 0.014, 1.4180)), 0.090, 0.046),
            (Vector((0, 0.024, 1.4500)), 0.070, 0.034),
            (Vector((0, 0.040, 1.4620)), 0.042, 0.020),
        ],
        hoodie_light,
        sides=20,
    )
    loft(
        "Hoodie collar",
        [
            (Vector((0, -0.006, 1.3760)), 0.096, 0.070),
            (Vector((0, 0.004, 1.4120)), 0.102, 0.074),
            (Vector((0, 0.018, 1.4380)), 0.094, 0.066),
        ],
        hoodie_light,
        sides=24,
    )
    loft(
        "Hoodie hem ribbing",
        [
            (Vector((0, 0, 0.9040)), 0.148, 0.105),
            (Vector((0, 0, 0.9260)), 0.152, 0.108),
        ],
        hoodie,
        sides=26,
    )
    # Kangaroo pocket conformed to the torso surface instead of a floating blob.
    loft(
        "Kangaroo pocket",
        [
            (Vector((0, -0.0930, 1.0840)), 0.092, 0.006),
            (Vector((0, -0.0985, 1.0380)), 0.104, 0.007),
            (Vector((0, -0.0990, 0.9960)), 0.100, 0.006),
            (Vector((0, -0.0930, 0.9620)), 0.088, 0.005),
        ],
        hoodie_light,
        sides=20,
    )
    strand(
        "Pocket opening",
        [(-0.090, -0.097, 1.0740), (-0.040, -0.110, 1.0600), (0.040, -0.110, 1.0600), (0.090, -0.097, 1.0740)],
        0.0030,
        hoodie_fold,
        sides=8,
    )
    star("Star emblem edging", (0, 0, 1.2680), 0.0840, 0.0355, gold_edge, conform=(0.150, 0.1100), lift=0.0022)
    star("Prominent hoodie star", (0, 0, 1.2680), 0.0725, 0.0305, gold, conform=(0.150, 0.1100), lift=0.0052)

    for side in (-1, 1):
        strand(
            f"Hood drawstring {side}",
            [(side * 0.046, -0.072, 1.4120), (side * 0.058, -0.094, 1.3680), (side * 0.054, -0.096, 1.3280)],
            0.0034,
            hoodie_light,
            sides=8,
        )
        ellipsoid(f"Drawstring aglet {side}", (side * 0.054, -0.097, 1.3220), (0.0042, 0.0042, 0.0088), hoodie_fold, 12, 8)

    # Subtle sculpted folds: underarm, waist and hem, as shallow surface ridges.
    for side in (-1, 1):
        loft(
            f"Hoodie fold underarm {side}",
            [
                (Vector((side * 0.140, -0.030, 1.2900)), 0.006, 0.004),
                (Vector((side * 0.132, -0.056, 1.2300)), 0.007, 0.005),
                (Vector((side * 0.120, -0.062, 1.1750)), 0.006, 0.004),
            ],
            hoodie_fold,
            sides=10,
        )
        loft(
            f"Hoodie fold waist {side}",
            [
                (Vector((side * 0.104, -0.070, 1.1000)), 0.006, 0.004),
                (Vector((side * 0.082, -0.086, 1.0400)), 0.007, 0.005),
                (Vector((side * 0.058, -0.090, 0.9900)), 0.005, 0.004),
            ],
            hoodie_fold,
            sides=10,
        )


def build_legs():
    for side in (-1, 1):
        loft(
            f"Trouser leg {side}",
            [
                (Vector((side * 0.0800, 0.006, 0.9450)), 0.098, 0.110),
                (Vector((side * 0.0845, 0.002, 0.8700)), 0.095, 0.107),
                (Vector((side * 0.0870, -0.002, 0.7600)), 0.086, 0.100),
                (Vector((side * 0.0875, -0.006, 0.6300)), 0.073, 0.087),
                (Vector((side * 0.0860, -0.010, 0.4900)), 0.062, 0.073),
                (Vector((side * 0.0860, -0.016, 0.3900)), 0.069, 0.081),
                (Vector((side * 0.0860, -0.020, 0.2400)), 0.054, 0.062),
                (Vector((side * 0.0860, -0.022, 0.1650)), 0.047, 0.053),
            ],
            trousers,
            sides=22,
            sub=1,
        )
        loft(
            f"Trouser hip blend {side}",
            [
                (Vector((side * 0.0700, 0.008, 1.0200)), 0.086, 0.098),
                (Vector((side * 0.0770, 0.006, 0.9600)), 0.098, 0.110),
                (Vector((side * 0.0800, 0.004, 0.9050)), 0.096, 0.108),
            ],
            trousers,
            sides=20,
            sub=1,
        )
        loft(
            f"Trouser cuff {side}",
            [
                (Vector((side * 0.0860, -0.022, 0.1520)), 0.050, 0.056),
                (Vector((side * 0.0860, -0.022, 0.1800)), 0.049, 0.055),
            ],
            trousers_fold,
            sides=22,
        )
        x = side * 0.0860
        loft(
            f"Trainer upper {side}",
            [
                (Vector((x, 0.0120, 0.1540)), 0.047, 0.049),
                (Vector((x, -0.0460, 0.1000)), 0.055, 0.056),
                (Vector((x, -0.1040, 0.0640)), 0.057, 0.054),
                (Vector((x, -0.1600, 0.0520)), 0.052, 0.045),
                (Vector((x, -0.1960, 0.0500)), 0.036, 0.032),
                (Vector((x, -0.2120, 0.0520)), 0.018, 0.017),
            ],
            trainers,
            sides=18,
            reference=(0, 0, 1),
        )
        loft(
            f"Trainer sole {side}",
            [
                (Vector((x, 0.0480, 0.0215)), 0.044, 0.019),
                (Vector((x, -0.0300, 0.0180)), 0.057, 0.017),
                (Vector((x, -0.1300, 0.0170)), 0.058, 0.016),
                (Vector((x, -0.2050, 0.0225)), 0.045, 0.017),
                (Vector((x, -0.2220, 0.0290)), 0.026, 0.012),
            ],
            soles,
            sides=18,
            reference=(0, 0, 1),
        )
        loft(
            f"Trainer toe cap {side}",
            [
                (Vector((x, -0.1780, 0.0560)), 0.050, 0.040),
                (Vector((x, -0.2020, 0.0540)), 0.036, 0.031),
            ],
            trainer_panel,
            sides=18,
            reference=(0, 0, 1),
        )
        loft(
            f"Trainer heel counter {side}",
            [
                (Vector((x, 0.0500, 0.0580)), 0.045, 0.033),
                (Vector((x, 0.0180, 0.0790)), 0.049, 0.039),
                (Vector((x, -0.0120, 0.0790)), 0.048, 0.037),
            ],
            trainer_panel,
            sides=18,
            reference=(0, 0, 1),
        )
        ellipsoid(f"Trainer tongue {side}", (x, -0.0520, 0.1020), (0.033, 0.029, 0.018), trainer_panel, 16, 10)
        for index in range(3):
            strand(
                f"Trainer lace {side}-{index}",
                [(x - 0.030 + 0.030 * index, -0.0440, 0.1060), (x + 0.030 - 0.030 * index, -0.0860, 0.0850)],
                0.0034,
                laces,
                sides=6,
            )


# -------------------------------------------------------------------- arms

ARM_OBJECTS = []


def clear_group(objects):
    for obj in list(objects):
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
        except ReferenceError:
            pass
    objects.clear()


def build_hand(side, wrist, direction, spread):
    origin = Vector(wrist)
    axis = Vector(direction).normalized()
    palm = origin + axis * 0.028 + Vector((side * 0.003, 0.0, 0.0))
    ARM_OBJECTS.append(ellipsoid(f"Hand palm {side}", tuple(palm), (0.036, 0.021, 0.038), skin, 20, 14))
    ARM_OBJECTS.append(
        ellipsoid(f"Hand knuckle pad {side}", tuple(palm + axis * 0.025 + Vector((0, 0, 0.003))), (0.034, 0.020, 0.015), skin_soft, 16, 10)
    )
    lengths = (0.028, 0.019, 0.014)
    radii = (0.0104, 0.0094, 0.0078)
    for finger in range(4):
        lateral = side * (finger - 1.5) * 0.0150
        root = palm + Vector((lateral, 0.0, 0.0)) + axis * 0.025 + Vector((0.0, 0.0, 0.004 * (1.5 - abs(finger - 1.5))))
        curl = 0.38 + 0.34 * (finger in (0, 3))
        point = root
        for joint in range(3):
            tilt = axis + Vector((-lateral * 0.9, 0.0, -0.24 * curl - 0.08 * joint))
            nxt = point + tilt.normalized() * lengths[joint]
            ARM_OBJECTS.append(strand(f"Finger {side}-{finger}-{joint}", [tuple(point), tuple(nxt)], radii[joint], skin, sides=8))
            point = nxt
        ARM_OBJECTS.append(ellipsoid(f"Finger tip {side}-{finger}", tuple(point), (0.0074, 0.0074, 0.0074), skin, 12, 8))
    thumb_root = palm + Vector((side * 0.024, -0.004, -0.010))
    thumb_dir = (axis * 0.6 + Vector((side * 0.68, -0.20, -0.16))).normalized()
    thumb_mid = thumb_root + thumb_dir * 0.025
    thumb_tip = thumb_mid + (thumb_dir * 0.8 + Vector((0.0, -0.16, -0.12))).normalized() * 0.019
    ARM_OBJECTS.append(strand(f"Thumb {side}-0", [tuple(thumb_root), tuple(thumb_mid)], 0.0112, skin, sides=8))
    ARM_OBJECTS.append(strand(f"Thumb {side}-1", [tuple(thumb_mid), tuple(thumb_tip)], 0.0092, skin, sides=8))
    ARM_OBJECTS.append(ellipsoid(f"Thumb tip {side}", tuple(thumb_tip), (0.0080, 0.0080, 0.0080), skin, 12, 8))


def build_arms(pose="neutral"):
    clear_group(ARM_OBJECTS)
    for side in (-1, 1):
        shoulder = Vector((side * 0.1450, 0.000, 1.3320))
        if pose == "wave" and side == 1:
            elbow = Vector((0.2380, -0.0300, 1.3920))
            wrist = Vector((0.2500, -0.0760, 1.6120))
            direction = Vector((0.16, -0.12, 0.98))
            spread = 1.8
        else:
            elbow = Vector((side * 0.1860, -0.0060, 1.1020))
            wrist = Vector((side * 0.1980, -0.0320, 0.8840))
            direction = Vector((0.10, -0.24, -0.97))
            spread = 0.6

        # Natural shoulder slope: the deltoid merges into the torso yoke rather
        # than reading as a separate padded cap.
        ARM_OBJECTS.append(
            loft(
                f"Hoodie sleeve {side}",
                [
                    (Vector((side * 0.1270, 0.004, 1.3720)), 0.050, 0.052),
                    (Vector((side * 0.1420, 0.002, 1.3340)), 0.056, 0.058),
                    (shoulder.lerp(elbow, 0.22), 0.054, 0.056),
                    (shoulder.lerp(elbow, 0.55), 0.047, 0.049),
                    (shoulder.lerp(elbow, 0.85), 0.043, 0.044),
                    (elbow, 0.041, 0.042),
                    (elbow.lerp(wrist, 0.42), 0.038, 0.040),
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
                    (wrist + (wrist - elbow).normalized() * 0.014, 0.039, 0.040),
                    (wrist - (wrist - elbow).normalized() * 0.004, 0.036, 0.037),
                ],
                hoodie_fold,
                sides=20,
            )
        )
        ARM_OBJECTS.append(
            loft(
                f"Sleeve elbow fold {side}",
                [(elbow + Vector((side * 0.010, -0.030, 0.012)), 0.008, 0.005), (elbow + Vector((side * 0.006, -0.034, -0.020)), 0.006, 0.004)],
                hoodie_fold,
                sides=10,
            )
        )
        build_hand(side, wrist, direction, spread)


HEAD_OBJECTS = []
EXPRESSION_OBJECTS = []
HAIR_OBJECTS = []


def clear_head():
    clear_group(HEAD_OBJECTS)
    clear_group(EXPRESSION_OBJECTS)
    clear_group(HAIR_OBJECTS)


def build_character(expression="neutral"):
    clear_head()
    build_torso()
    build_legs()
    head = build_head(expression)
    HEAD_OBJECTS.append(head)
    before = set(bpy.data.objects)
    build_eyes(expression)
    EXPRESSION_OBJECTS.extend(obj for obj in bpy.data.objects if obj not in before and obj not in HEAD_OBJECTS)
    before = set(bpy.data.objects)
    build_hair()
    HAIR_OBJECTS.extend(obj for obj in bpy.data.objects if obj not in before)
    build_arms("neutral")




# ------------------------------------------------------------- diagnostics


def evaluate_mesh(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    return evaluated, mesh


def validate_and_report():
    """Check object naming, transforms, mesh integrity, normals and materials."""
    problems = []
    triangles = 0
    objects = 0
    materials = set()
    bounds = None

    seen = set()
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name.startswith("Review floor"):
            continue
        objects += 1
        if obj.name in seen:
            problems.append(f"duplicate object name: {obj.name}")
        seen.add(obj.name)
        if not obj.name.strip():
            problems.append("unnamed object")
        for value in list(obj.location) + list(obj.rotation_euler) + list(obj.scale):
            if math.isnan(value) or math.isinf(value):
                problems.append(f"non-finite transform on {obj.name}")
        if any(abs(s) < 1e-6 for s in obj.scale):
            problems.append(f"zero scale on {obj.name}")
        if len(obj.data.materials) == 0:
            problems.append(f"no material assigned: {obj.name}")
        else:
            materials.update(m.name for m in obj.data.materials)

        degenerate = sum(1 for poly in obj.data.polygons if poly.area < 1e-9)
        if degenerate:
            problems.append(f"{degenerate} degenerate faces on {obj.name}")

        positions = [tuple(round(c, 6) for c in v.co) for v in obj.data.vertices]
        duplicates = len(positions) - len(set(positions))
        if duplicates:
            problems.append(f"{duplicates} duplicate vertices on {obj.name}")

        centre = Vector((0, 0, 0))
        for corner in obj.data.polygons:
            centre += Vector(corner.center)
        centre /= max(1, len(obj.data.polygons))
        inward = sum(1 for poly in obj.data.polygons if poly.normal.dot(Vector(poly.center) - centre) < -0.2)
        if inward > len(obj.data.polygons) * 0.35:
            problems.append(f"{inward}/{len(obj.data.polygons)} polygons appear inverted on {obj.name}")

        evaluated, mesh = evaluate_mesh(obj)
        triangles += len(mesh.loop_triangles)
        for vertex in mesh.vertices:
            point = obj.matrix_world @ vertex.co
            if bounds is None:
                bounds = [list(point), list(point)]
            else:
                for axis in range(3):
                    bounds[0][axis] = min(bounds[0][axis], point[axis])
                    bounds[1][axis] = max(bounds[1][axis], point[axis])
        evaluated.to_mesh_clear()

    size = [bounds[1][i] - bounds[0][i] for i in range(3)] if bounds else [0, 0, 0]
    print(f"ASTRA_R1_GEOMETRY triangles={triangles} objects={objects} materials={len(materials)}")
    print(f"ASTRA_R1_DIMENSIONS width={size[0]:.4f} depth={size[1]:.4f} height={size[2]:.4f}")
    print(f"ASTRA_R1_VALIDATE problems={len(problems)}")
    for problem in problems:
        print(f"ASTRA_R1_VALIDATE_PROBLEM {problem}")
    return problems
