"""Astra Character V1 production rig, animation library and glTF export.

Builds the approved LW-02B-R1 design, reduces it toward the real-time triangle
budget, then adds:
  - a ~60-bone skeleton with a glTF-conventional hierarchy,
  - smooth procedural vertex weights (no rigid limb pieces),
  - eleven facial morph targets including blink and speech-ready visemes,
  - fifteen animation clips,
  - a versioned local GLB export (astra-character-v1.glb).

Requires Blender 5.2 LTS with the bundled glTF 2.0 exporter. No add-ons, no
external textures, no simulation, no network access.

Usage:
  blender --background --factory-startup \
      --python scripts/blender/create_astra_rigged_v1.py -- [output_dir]

output_dir defaults to src/assets and receives astra-character-v1.glb plus the
editable astra-character-v1.blend. Evidence JSON is written to the same folder's
parent under test-results/lw02c/.
"""

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))

import astra_character_model as model  # noqa: E402

# Production detail multiplier: lower than the 1.0 review pass to fit the
# real-time triangle budget while keeping the approved silhouette.
model.DETAIL = 0.78

CHARACTER_VERSION = "v1"
GLB_NAME = f"astra-character-{CHARACTER_VERSION}.glb"
BLEND_NAME = f"astra-character-{CHARACTER_VERSION}.blend"

SIDE_NAMES = {"-1": ".R", "1": ".L"}


def output_paths():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    base = Path(args[0]) if args else Path("src/assets")
    base.mkdir(parents=True, exist_ok=True)
    repo_root = Path(__file__).resolve().parents[2]
    evidence = repo_root / "test-results" / "lw02c"
    evidence.mkdir(parents=True, exist_ok=True)
    return (base / GLB_NAME).resolve(), (base / BLEND_NAME).resolve(), evidence.resolve()


GLB_PATH, BLEND_PATH, EVIDENCE_DIR = output_paths()

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

# ---------------------------------------------------------------- skeleton

# (name, head, tail, parent, connected)
BONES = [
    ("root", (0, 0, 0.00), (0, 0, 0.06), None, False),
    ("hips", (0, 0, 0.94), (0, 0, 1.07), "root", False),
    ("spine_lower", (0, 0, 1.07), (0, 0, 1.17), "hips", True),
    ("spine_mid", (0, 0, 1.17), (0, 0, 1.25), "spine_lower", True),
    ("chest", (0, 0, 1.25), (0, 0, 1.35), "spine_mid", True),
    ("neck", (0, 0, 1.35), (0, 0, 1.45), "chest", True),
    ("head", (0, 0, 1.45), (0, 0, 1.61), "neck", True),
    ("head_top", (0, 0, 1.61), (0, 0, 1.78), "head", True),
]

FINGER_CHAINS = [
    ("index", (0.196, -0.036, 0.828), (0.199, -0.044, 0.796), (0.201, -0.050, 0.772), (0.202, -0.054, 0.754)),
    ("middle", (0.198, -0.036, 0.828), (0.201, -0.044, 0.795), (0.203, -0.050, 0.770), (0.204, -0.054, 0.752)),
    ("ring", (0.200, -0.036, 0.827), (0.203, -0.044, 0.793), (0.205, -0.050, 0.768), (0.206, -0.054, 0.751)),
    ("pinky", (0.202, -0.036, 0.825), (0.205, -0.044, 0.792), (0.207, -0.049, 0.770), (0.208, -0.052, 0.755)),
    ("thumb", (0.214, -0.038, 0.840), (0.232, -0.050, 0.822), (0.241, -0.058, 0.808), None),
]

for suffix, sign in ((".L", 1), (".R", -1)):
    BONES.extend(
        [
            (f"eye{suffix}", (sign * 0.0365, -0.058, 1.533), (sign * 0.0365, -0.104, 1.533), "head", False),
            (f"clavicle{suffix}", (sign * 0.030, 0.020, 1.322), (sign * 0.112, 0.012, 1.334), "chest", False),
            (f"shoulder{suffix}", (sign * 0.112, 0.012, 1.334), (sign * 0.148, 0.006, 1.334), f"clavicle{suffix}", True),
            (f"upperarm{suffix}", (sign * 0.148, 0.006, 1.334), (sign * 0.186, -0.006, 1.102), f"shoulder{suffix}", True),
            (f"lowerarm{suffix}", (sign * 0.186, -0.006, 1.102), (sign * 0.198, -0.032, 0.884), f"upperarm{suffix}", True),
            (f"hand{suffix}", (sign * 0.198, -0.032, 0.884), (sign * 0.201, -0.038, 0.818), f"lowerarm{suffix}", True),
            (f"thigh{suffix}", (sign * 0.087, 0.002, 0.945), (sign * 0.087, -0.010, 0.490), "hips", False),
            (f"shin{suffix}", (sign * 0.087, -0.010, 0.490), (sign * 0.086, -0.022, 0.165), f"thigh{suffix}", True),
            (f"foot{suffix}", (sign * 0.086, -0.022, 0.165), (sign * 0.086, -0.104, 0.062), f"shin{suffix}", True),
            (f"toe{suffix}", (sign * 0.086, -0.104, 0.062), (sign * 0.086, -0.186, 0.055), f"foot{suffix}", True),
        ]
    )
    for name, p0, p1, p2, p3 in FINGER_CHAINS:
        points = [(sign * p0[0], p0[1], p0[2]), (sign * p1[0], p1[1], p1[2]), (sign * p2[0], p2[1], p2[2])]
        if p3 is not None:
            points.append((sign * p3[0], p3[1], p3[2]))
        previous = f"hand{suffix}"
        for index in range(len(points) - 1):
            bone_name = f"{name}_{index + 1}{suffix}"
            BONES.append((bone_name, points[index], points[index + 1], previous, index == 0))
            previous = bone_name


def build_armature():
    armature_data = bpy.data.armatures.new("AstraV1Skeleton")
    arm = bpy.data.objects.new("AstraV1Rig", armature_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = armature_data.edit_bones
    for name, head, tail, parent, connected in BONES:
        bone = edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.roll = 0.0
        if parent:
            bone.parent = edit_bones[parent]
            bone.use_connect = connected
    bpy.ops.object.mode_set(mode="OBJECT")
    for pose_bone in arm.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
    return arm


# -------------------------------------------------------------- weighting


def point_segment_distance(point, start, end):
    segment = end - start
    length_squared = segment.length_squared
    if length_squared < 1e-12:
        return (point - start).length
    t = max(0.0, min(1.0, (point - start).dot(segment) / length_squared))
    return (point - (start + segment * t)).length


SPINE_CHAIN = ["hips", "spine_lower", "spine_mid", "chest", "neck"]
HEAD_CHAIN = ["head", "head_top"]
ARM_CHAIN = ["clavicle", "shoulder", "upperarm", "lowerarm", "hand"]
LEG_CHAIN = ["thigh", "shin", "foot", "toe"]
FINGER_CHAINS = ["index", "middle", "ring", "pinky", "thumb"]
# Only these exist mirrored; the spine, neck and head bones do not.
LATERAL_CHAINS = set(ARM_CHAIN + LEG_CHAIN + FINGER_CHAINS + ["eye"])


def allowed_bones_for(obj):
    """Region lock: a bone may only ever influence geometry in its own region.

    Pure inverse-distance weighting lets a hand bone reach the hip and a thigh
    bone reach the sleeve, which tears the mesh apart the moment either limb
    moves. Naming the permitted chain per object removes that class of failure.
    """
    name = obj.name
    chains = []

    def add(*groups):
        for group in groups:
            if isinstance(group, str):
                chains.append(group)
            else:
                chains.extend(group)

    if name.startswith("AstraFace"):
        add(SPINE_CHAIN[-2:], HEAD_CHAIN, ["eye"])
    elif name.startswith(("Head", "Neck", "Ear")):
        add(HEAD_CHAIN, ["neck"])
    elif name.startswith("Eyebrow"):
        add(HEAD_CHAIN, ["neck"])
    elif name.startswith("Hair"):
        add(HEAD_CHAIN, ["neck"])
    elif name.startswith(("Hand", "Finger", "Thumb")):
        fingers = [f"{chain}_{index}" for chain in FINGER_CHAINS for index in (1, 2, 3)]
        add(["hand"], *fingers)
    elif name.startswith(("Hoodie sleeve", "Sleeve cuff", "Sleeve elbow fold")):
        add(ARM_CHAIN, ["chest", "spine_mid"])
    elif name.startswith(("Hoodie", "Kangaroo", "Pocket", "Star", "Prominent", "Hood ", "Hood drawstring", "Drawstring")):
        add(SPINE_CHAIN, ["head"])
    elif name.startswith("Trouser hip blend"):
        add(["hips", "spine_lower"], ["thigh"])
    elif name.startswith(("Trouser leg", "Trouser cuff", "Trainer")):
        add(LEG_CHAIN, ["hips"])
    else:
        add(SPINE_CHAIN, ARM_CHAIN, LEG_CHAIN, HEAD_CHAIN)

    expanded = []
    for chain in chains:
        if chain in LATERAL_CHAINS:
            expanded.extend([f"{chain}.L", f"{chain}.R"])
        else:
            expanded.append(chain)
    return expanded


def assign_weights(obj, arm):
    """Smooth inverse-distance weights inside the object's permitted bone region."""
    rest = {bone.name: (arm.data.bones[bone.name].head_local.copy(), arm.data.bones[bone.name].tail_local.copy()) for bone in arm.data.bones}
    allowed = [name for name in allowed_bones_for(obj) if name in rest]
    if not allowed:
        allowed = ["hips"]
    lateral = {name for name in allowed if name.endswith(".L") or name.endswith(".R")}
    group_cache = {}

    for vertex in obj.data.vertices:
        # Vertices are in object-local space; weights must be computed against
        # armature space or every scaled primitive lands on the wrong bone.
        point = obj.matrix_world @ vertex.co
        side = ".L" if point.x >= -0.008 else ".R"
        scored = []
        for name in allowed:
            if name in lateral and not name.endswith(side):
                continue
            distance = point_segment_distance(point, *rest[name])
            scored.append((distance, name))
        scored.sort()
        weights = []
        total = 0.0
        for distance, name in scored[:3]:
            weight = math.exp(-((distance / 0.060) ** 2))
            if weight < 1e-3:
                continue
            weights.append((name, weight))
            total += weight
        if not weights:
            weights = [(scored[0][1], 1.0)]
            total = 1.0
        for name, weight in weights:
            group = group_cache.get(name)
            if group is None:
                group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                group_cache[name] = group
            group.add([vertex.index], weight / total, "REPLACE")


EYEBALL_PREFIXES = ("Eyeball", "Iris ", "Pupil ", "Eye glint")


def bind_object(obj, arm):
    rigid_to = None
    for prefix in EYEBALL_PREFIXES:
        if obj.name.startswith(prefix):
            rigid_to = "eye.L" if " -1" in obj.name or obj.name.endswith("1") else "eye.R"
            break
    if obj.name.startswith(("Eye white",)) is False and obj.name.startswith(EYEBALL_PREFIXES):
        pass
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if rigid_to:
        group = obj.vertex_groups.get(rigid_to) or obj.vertex_groups.new(name=rigid_to)
        group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    else:
        assign_weights(obj, arm)
    modifier = obj.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = arm
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()


# --------------------------------------------------------------- assembly


def face_object_group():
    return model.HEAD_OBJECTS + model.EXPRESSION_OBJECTS


def build_face_with_expression(expression):
    before = set(bpy.data.objects)
    model.build_head(expression)
    model.build_eyes(expression)
    created = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
    model.HEAD_OBJECTS.clear()
    model.EXPRESSION_OBJECTS.clear()
    created.sort(key=lambda obj: obj.name)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in created:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = created[0]
    bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = "AstraFace"
    merged.data.name = "AstraFaceMesh"
    return merged


def build_character_and_face(arm):
    model.build_torso()
    model.build_legs()
    model.build_hair()

    captured = {}
    face = None
    basis_positions = None
    for expression in ["neutral"] + model.MORPH_NAMES:
        merged = build_face_with_expression(expression)
        positions = [vertex.co.copy() for vertex in merged.data.vertices]
        if basis_positions is None:
            basis_positions = positions
            face = merged
        else:
            if len(positions) != len(basis_positions):
                raise RuntimeError(
                    f"expression {expression} produced {len(positions)} vertices, basis has {len(basis_positions)}"
                )
            captured[expression] = positions
            bpy.data.objects.remove(merged, do_unlink=True)

    face.shape_key_add(name="Basis", from_mix=False)
    for name in model.MORPH_NAMES:
        key = face.shape_key_add(name=name, from_mix=False)
        for index, co in enumerate(captured[name]):
            key.data[index].co = co
    key_blocks = face.data.shape_keys.key_blocks
    for name in model.MORPH_NAMES:
        key_blocks[name].slider_min = 0.0
        key_blocks[name].slider_max = 1.0

    model.build_arms("neutral")
    return face


def bind_everything(arm, face):
    for obj in list(bpy.data.objects):
        if obj.type == "MESH":
            bind_object(obj, arm)
    if face.name not in [obj.name for obj in bpy.data.objects]:
        bind_object(face, arm)


# ------------------------------------------------------------- animations


def world_axis_local(pb, axis):
    return (pb.bone.matrix_local.to_3x3().inverted() @ Vector(axis)).normalized()


def apply_pose(arm, pose):
    for name, (rx, ry, rz) in pose.items():
        pb = arm.pose.bones.get(name)
        if pb is None:
            raise KeyError(f"unknown bone {name}")
        q = Quaternion(world_axis_local(pb, (1, 0, 0)), rx)
        q = q @ Quaternion(world_axis_local(pb, (0, 1, 0)), ry)
        q = q @ Quaternion(world_axis_local(pb, (0, 0, 1)), rz)
        pb.rotation_quaternion = q


def reset_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
        pb.location = (0.0, 0.0, 0.0)


def key_bones(arm, names, frame):
    for name in names:
        pb = arm.pose.bones[name]
        pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def key_locations(arm, names, frame):
    for name in names:
        pb = arm.pose.bones[name]
        pb.keyframe_insert(data_path="location", frame=frame)


def author_clip(arm, name, keys, location_keys=None):
    """keys: list of (frame, pose). location_keys: optional (frame, {bone: (x,y,z)})."""
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    touched = set()
    for _, pose in keys:
        touched.update(pose.keys())
    for frame, pose in keys:
        reset_pose(arm)
        apply_pose(arm, pose)
        key_bones(arm, sorted(touched), frame)
    if location_keys:
        moved = set()
        for _, mapping in location_keys:
            moved.update(mapping.keys())
        reset_pose(arm)
        for frame, mapping in location_keys:
            for bone_name, offset in mapping.items():
                arm.pose.bones[bone_name].location = offset
            key_locations(arm, sorted(moved), frame)
    arm.animation_data.action = None
    return action.name


def sine(a, b, t):
    return a + (b - a) * t


def build_clips(arm, face):
    """Fifteen clips. World-axis rotation semantics: she faces -Y, up is +Z."""
    clips = {}

    # 1. idle_breathing ------------------------------------------------------
    keys = []
    for frame in (1, 16, 31, 46, 61):
        t = (frame - 1) / 60 * 2 * math.pi
        bob = math.sin(t)
        keys.append(
            (
                frame,
                {
                    "spine_mid": (bob * 0.020, 0, 0),
                    "chest": (bob * 0.028, 0, 0),
                    "neck": (-bob * 0.016, 0, 0),
                    "head": (-bob * 0.012, 0, 0),
                    "clavicle.L": (0, bob * 0.020, 0),
                    "clavicle.R": (0, -bob * 0.020, 0),
                    "shoulder.L": (0, bob * 0.030, 0),
                    "shoulder.R": (0, -bob * 0.030, 0),
                },
            )
        )
    clips["idle_breathing"] = author_clip(arm, "idle_breathing", keys)

    # 2. idle_weight_shift ---------------------------------------------------
    keys = []
    for frame in (1, 23, 46, 68, 91):
        t = (frame - 1) / 90 * 2 * math.pi
        shift = math.sin(t)
        keys.append(
            (
                frame,
                {
                    "hips": (0, 0, shift * 0.055),
                    "spine_lower": (0, 0, -shift * 0.030),
                    "spine_mid": (0, 0, -shift * 0.020),
                    "chest": (0, 0, -shift * 0.014),
                    "neck": (0, 0, -shift * 0.010),
                    "head": (0, shift * 0.050, -shift * 0.020),
                    "upperarm.L": (0, 0, -shift * 0.060),
                    "upperarm.R": (0, 0, shift * 0.060),
                    "lowerarm.L": (shift * 0.030, 0, 0),
                    "lowerarm.R": (-shift * 0.030, 0, 0),
                },
            )
        )
    clips["idle_weight_shift"] = author_clip(arm, "idle_weight_shift", keys)

    # 3. idle_look_around ----------------------------------------------------
    keys = []
    for frame in (1, 31, 61, 91, 121):
        t = (frame - 1) / 120 * 2 * math.pi
        yaw = math.sin(t)
        keys.append(
            (
                frame,
                {
                    "head": (yaw * 0.020, yaw * 0.300, -yaw * 0.060),
                    "neck": (0, yaw * 0.090, 0),
                    "chest": (0, yaw * 0.040, 0),
                    "eye.L": (0, yaw * 0.180, 0),
                    "eye.R": (0, yaw * 0.180, 0),
                    "clavicle.L": (0, 0, yaw * 0.030),
                    "clavicle.R": (0, 0, -yaw * 0.030),
                },
            )
        )
    clips["idle_look_around"] = author_clip(arm, "idle_look_around", keys)

    # 4. blink (shape-key driven) -------------------------------------------
    blink_key = face.data.shape_keys.key_blocks["blink"]
    face.data.shape_keys.animation_data_create()
    blink_action = bpy.data.actions.new("blink")
    face.data.shape_keys.animation_data.action = blink_action
    for frame, value in ((1, 0.0), (4, 1.0), (8, 0.0)):
        blink_key.value = value
        blink_key.keyframe_insert(data_path="value", frame=frame)
    # The action stays assigned: the glTF exporter only gathers morph animation
    # from shape keys whose action is still attached at export time.
    face.data.shape_keys.animation_data.action = blink_action
    blink_key.value = 0.0
    clips["blink"] = "blink"

    # 5. walk ---------------------------------------------------------------
    keys = []
    stride = 34
    for frame in range(1, stride + 2):
        t = (frame - 1) / stride * 2 * math.pi
        swing = math.sin(t)
        swing2 = math.sin(t + math.pi)
        bob = abs(math.sin(t)) * 2 - 1
        keys.append(
            (
                frame,
                {
                    "root": (0, swing * 0.070, 0),
                    "hips": (swing * 0.055, 0, swing * 0.030),
                    "spine_lower": (0, swing * 0.040, 0),
                    "chest": (0, -swing * 0.060, 0),
                    "neck": (0, -swing * 0.020, 0),
                    "head": (0, -swing * 0.030, 0),
                    "thigh.L": (swing * 0.62, 0, 0.020),
                    "shin.L": (max(0.0, -swing) * 0.95 + 0.06, 0, 0),
                    "foot.L": (max(0.0, -swing) * 0.35 - swing * 0.18, 0, 0),
                    "toe.L": (max(0.0, -swing) * 0.30, 0, 0),
                    "thigh.R": (swing2 * 0.62, 0, -0.020),
                    "shin.R": (max(0.0, -swing2) * 0.95 + 0.06, 0, 0),
                    "foot.R": (max(0.0, -swing2) * 0.35 - swing2 * 0.18, 0, 0),
                    "toe.R": (max(0.0, -swing2) * 0.30, 0, 0),
                    "upperarm.L": (swing2 * 0.46, 0, -0.06),
                    "lowerarm.L": (0.18 + max(0.0, swing2) * 0.30, 0, 0),
                    "upperarm.R": (swing * 0.46, 0, 0.06),
                    "lowerarm.R": (0.18 + max(0.0, swing) * 0.30, 0, 0),
                },
            )
        )
    clips["walk"] = author_clip(
        arm, "walk", keys, location_keys=[(1, {"hips": (0.0, 0.0, 0.0)}), (18, {"hips": (0.0, 0.0, bob * 0.022)}), (35, {"hips": (0.0, 0.0, 0.0)})]
    )

    # 6/7. turns -------------------------------------------------------------
    for name, sign in (("turn_left", 1), ("turn_right", -1)):
        keys = []
        for frame, angle in ((1, 0.0), (9, sign * 0.55), (17, sign * 1.05), (25, sign * 1.5708)):
            keys.append(
                (
                    frame,
                    {
                        "root": (0, 0, angle),
                        "spine_lower": (0, 0, -angle * 0.06),
                        "chest": (0, 0, -angle * 0.06),
                        "head": (0, 0, angle * 0.10),
                        "upperarm.L": (0, 0, -0.04),
                        "upperarm.R": (0, 0, 0.04),
                    },
                )
            )
        clips[name] = author_clip(arm, name, keys)

    # 8. wave ----------------------------------------------------------------
    keys = []
    for frame in range(1, 45):
        t = (frame - 1) / 44
        raise_t = min(1.0, t * 4.0)
        wave = math.sin(t * math.pi * 4.0) * raise_t
        keys.append(
            (
                frame,
                {
                    "shoulder.L": (0, 0, -0.30 * raise_t),
                    "upperarm.L": (-1.95 * raise_t, 0, -0.55 * raise_t),
                    "lowerarm.L": (0.35 * raise_t, 0, 0.90 * raise_t + wave * 0.35),
                    "hand.L": (0, 0, wave * 0.55),
                    "head": (0, -0.10 * raise_t, 0.08 * raise_t),
                    "neck": (0, -0.05 * raise_t, 0),
                    "chest": (0, 0, -0.04 * raise_t),
                    "spine_mid": (0, 0, 0.03 * raise_t),
                    "upperarm.R": (0, 0, 0.05 * raise_t),
                },
            )
        )
    clips["wave"] = author_clip(arm, "wave", keys)

    # 9/11. sit_down and stand_up -------------------------------------------
    SIT_HIP_Z = -0.470
    sit_keys = []
    for frame, amount in ((1, 0.0), (16, 0.45), (30, 0.85), (45, 1.0)):
        keys = (
            (sine(0.0, 1.42, amount), 0, 0.06 * amount),
            (sine(0.0, -1.38, amount), 0, 0),
            (0, sine(0.0, 0.16, amount), 0),
        )
        sit_keys.append(
            (
                frame,
                {
                    "thigh.L": keys[0],
                    "thigh.R": (keys[0][0], 0, -keys[0][2]),
                    "shin.L": (keys[1][0], 0, 0),
                    "shin.R": (keys[1][0], 0, 0),
                    "foot.L": (keys[2][0], 0, 0),
                    "foot.R": (keys[2][0], 0, 0),
                    "spine_lower": (sine(0.0, 0.12, amount), 0, 0),
                    "spine_mid": (sine(0.0, 0.10, amount), 0, 0),
                    "chest": (sine(0.0, 0.06, amount), 0, 0),
                    "upperarm.L": (sine(0.0, -0.55, amount), 0, -sine(0.0, 0.10, amount)),
                    "upperarm.R": (sine(0.0, -0.55, amount), 0, sine(0.0, 0.10, amount)),
                    "lowerarm.L": (sine(0.0, 0.85, amount), 0, 0),
                    "lowerarm.R": (sine(0.0, 0.85, amount), 0, 0),
                },
            )
        )
    clips["sit_down"] = author_clip(
        arm, "sit_down", sit_keys, location_keys=[(1, {"hips": (0, 0, 0)}), (45, {"hips": (0, 0, SIT_HIP_Z)})]
    )
    stand_keys = []
    for frame, amount in ((1, 1.0), (16, 0.55), (30, 0.15), (40, 0.0)):
        keys = (
            (sine(0.0, 1.42, amount), 0, 0.06 * amount),
            (sine(0.0, -1.38, amount), 0, 0),
            (sine(0.0, 0.16, amount), 0, 0),
        )
        stand_keys.append(
            (
                frame,
                {
                    "thigh.L": keys[0],
                    "thigh.R": (keys[0][0], 0, -keys[0][2]),
                    "shin.L": (keys[1][0], 0, 0),
                    "shin.R": (keys[1][0], 0, 0),
                    "foot.L": (keys[2][0], 0, 0),
                    "foot.R": (keys[2][0], 0, 0),
                    "spine_lower": (sine(0.0, 0.12, amount), 0, 0),
                    "chest": (sine(0.0, 0.06, amount), 0, 0),
                    "upperarm.L": (sine(0.0, -0.55, amount), 0, -sine(0.0, 0.10, amount)),
                    "upperarm.R": (sine(0.0, -0.55, amount), 0, sine(0.0, 0.10, amount)),
                    "lowerarm.L": (sine(0.0, 0.85, amount), 0, 0),
                    "lowerarm.R": (sine(0.0, 0.85, amount), 0, 0),
                },
            )
        )
    clips["stand_up"] = author_clip(
        arm, "stand_up", stand_keys, location_keys=[(1, {"hips": (0, 0, SIT_HIP_Z)}), (40, {"hips": (0, 0, 0)})]
    )

    # 10. seated_idle --------------------------------------------------------
    keys = []
    for frame in (1, 21, 41, 61):
        t = (frame - 1) / 60 * 2 * math.pi
        bob = math.sin(t)
        keys.append(
            (
                frame,
                {
                    "spine_mid": (bob * 0.020, 0, 0),
                    "chest": (bob * 0.026, 0, 0),
                    "neck": (-bob * 0.014, 0, 0),
                    "head": (-bob * 0.010, math.sin(t * 0.5) * 0.090, 0),
                    "shoulder.L": (0, bob * 0.020, 0),
                    "shoulder.R": (0, -bob * 0.020, 0),
                },
            )
        )
    clips["seated_idle"] = author_clip(
        arm, "seated_idle", keys, location_keys=[(1, {"hips": (0, 0, SIT_HIP_Z)})]
    )

    # 12. thinking -----------------------------------------------------------
    keys = []
    for frame in (1, 31, 61, 91):
        t = (frame - 1) / 90 * 2 * math.pi
        sway = math.sin(t)
        keys.append(
            (
                frame,
                {
                    "head": (sway * 0.090, sway * 0.110, -sway * 0.070),
                    "neck": (sway * 0.050, 0, 0),
                    "chest": (0, 0, -0.03),
                    "shoulder.R": (0, 0, 0.12 + sway * 0.04),
                    "upperarm.R": (0.30 + sway * 0.10, 0, 0.55),
                    "lowerarm.R": (1.75, 0, 0.35),
                    "upperarm.L": (0, 0, -0.05 - sway * 0.03),
                    "eye.L": (0, sway * 0.060, 0),
                    "eye.R": (0, sway * 0.060, 0),
                },
            )
        )
    clips["thinking"] = author_clip(arm, "thinking", keys)

    # 13. listening ----------------------------------------------------------
    keys = []
    for frame in (1, 31, 61):
        t = (frame - 1) / 60 * 2 * math.pi
        nod = math.sin(t)
        keys.append(
            (
                frame,
                {
                    "head": (nod * 0.045, 0, nod * 0.030),
                    "neck": (nod * 0.030, 0, 0),
                    "chest": (nod * 0.020, 0, 0),
                    "shoulder.L": (0, 0, -0.035 - nod * 0.015),
                    "shoulder.R": (0, 0, 0.035 + nod * 0.015),
                    "eye.L": (0, 0, 0),
                    "eye.R": (0, 0, 0),
                },
            )
        )
    clips["listening"] = author_clip(arm, "listening", keys)

    # 14. talking_gesture ----------------------------------------------------
    keys = []
    for frame in range(1, 61):
        t = (frame - 1) / 60 * 2 * math.pi
        gesture = math.sin(t)
        keys.append(
            (
                frame,
                {
                    "root": (0, gesture * 0.030, 0),
                    "spine_mid": (0, gesture * 0.040, 0),
                    "chest": (0, -gesture * 0.050, 0),
                    "neck": (0, gesture * 0.030, 0),
                    "head": (gesture * 0.060, -gesture * 0.120, gesture * 0.040),
                    "clavicle.L": (0, 0, -0.10 - gesture * 0.06),
                    "clavicle.R": (0, 0, 0.10 + gesture * 0.06),
                    "shoulder.L": (0, 0, -0.16 - gesture * 0.10),
                    "shoulder.R": (0, 0, 0.16 + gesture * 0.10),
                    "upperarm.L": (-0.55 - gesture * 0.30, 0, -0.62),
                    "lowerarm.L": (1.05 + gesture * 0.35, 0, 0.20),
                    "hand.L": (0, 0, gesture * 0.30),
                    "upperarm.R": (-0.50 + gesture * 0.30, 0, 0.62),
                    "lowerarm.R": (1.00 - gesture * 0.35, 0, -0.20),
                    "hand.R": (0, 0, -gesture * 0.30),
                },
            )
        )
    clips["talking_gesture"] = author_clip(arm, "talking_gesture", keys)

    # 15. happy_reaction -----------------------------------------------------
    keys = []
    for frame in range(1, 37):
        t = (frame - 1) / 36
        bounce = abs(math.sin(t * math.pi * 2.0)) * (1.0 - t)
        keys.append(
            (
                frame,
                {
                    "hips": (0, 0, -0.02 * bounce),
                    "spine_mid": (0, 0, 0.10 * (1 - t)),
                    "chest": (-0.10 * (1 - t), 0, 0),
                    "neck": (0.06 * (1 - t), 0, 0),
                    "head": (0.14 * (1 - t), 0, 0),
                    "clavicle.L": (0, 0, -0.14 * (1 - t)),
                    "clavicle.R": (0, 0, 0.14 * (1 - t)),
                    "shoulder.L": (0, 0, -0.22 * (1 - t)),
                    "shoulder.R": (0, 0, 0.22 * (1 - t)),
                    "upperarm.L": (-0.90 * (1 - t), 0, -0.45 * (1 - t)),
                    "lowerarm.L": (0.50 * (1 - t), 0, 0.55 * (1 - t)),
                    "upperarm.R": (-0.80 * (1 - t), 0, 0.45 * (1 - t)),
                    "lowerarm.R": (0.45 * (1 - t), 0, -0.55 * (1 - t)),
                },
            )
        )
    clips["happy_reaction"] = author_clip(
        arm, "happy_reaction", keys, location_keys=[(1, {"hips": (0, 0, 0)}), (10, {"hips": (0, 0, -0.045)}), (20, {"hips": (0, 0, 0)})]
    )
    return clips


# ------------------------------------------------------------------ export


def export_glb(arm, face):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.type == "MESH" or obj.type == "ARMATURE":
            obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_morph=True,
        export_morph_normal=True,
        export_morph_animation=True,
        export_skins=True,
        export_yup=True,
        export_materials="EXPORT",
        export_normals=True,
        export_tangents=False,
        export_optimize_animation_size=True,
    )


def mesh_statistics():
    triangles = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    return triangles


def build_preview_renders(arm, face):
    """Render four posed frames on the main scene so skinning is inspectable.

    Runs after the GLB export so the preview camera and lights are never
    included in the shipped asset.
    """
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 520
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    light = bpy.data.lights.new("Preview key", "AREA")
    light.energy = 150
    light.size = 2.4
    light_obj = bpy.data.objects.new("Preview key", light)
    scene.collection.objects.link(light_obj)
    light_obj.location = (-1.8, -2.6, 2.8)
    light_obj.rotation_euler = (Vector((0, 0, 1.1)) - light_obj.location).to_track_quat("-Z", "Y").to_euler()
    fill = bpy.data.lights.new("Preview fill", "AREA")
    fill.energy = 50
    fill.size = 1.8
    fill_obj = bpy.data.objects.new("Preview fill", fill)
    scene.collection.objects.link(fill_obj)
    fill_obj.location = (1.5, 1.9, 2.2)
    fill_obj.rotation_euler = (Vector((0, 0, 1.1)) - fill_obj.location).to_track_quat("-Z", "Y").to_euler()

    camera_data = bpy.data.cameras.new("Preview camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.1
    camera = bpy.data.objects.new("Preview camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (2.6, -3.6, 1.6)
    camera.rotation_euler = (Vector((0, 0, 0.95)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    poses = {
        "preview-neutral": ({}, "neutral"),
        "preview-wave": ({"shoulder.L": (0, 0, -0.30), "upperarm.L": (-1.95, 0, -0.55), "lowerarm.L": (0.35, 0, 0.90)}, "smile"),
        "preview-walk": ({"thigh.L": (0.62, 0, 0.02), "shin.L": (0.60, 0, 0), "thigh.R": (-0.62, 0, -0.02), "shin.R": (0.20, 0, 0), "upperarm.L": (-0.46, 0, -0.06), "upperarm.R": (0.46, 0, 0.06)}, "neutral"),
        "preview-sit": ({"thigh.L": (1.42, 0, 0.06), "thigh.R": (1.42, 0, -0.06), "shin.L": (-1.38, 0, 0), "shin.R": (-1.38, 0, 0)}, "happy"),
    }
    outputs = []
    for name, (pose, expression) in poses.items():
        reset_pose(arm)
        apply_pose(arm, pose)
        if name == "preview-sit":
            arm.pose.bones["hips"].location = (0.0, 0.0, -0.470)
        for key in face.data.shape_keys.key_blocks:
            key.value = 1.0 if key.name == expression else 0.0
        scene.frame_set(1)
        scene.render.filepath = str(EVIDENCE_DIR / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        for key in face.data.shape_keys.key_blocks:
            key.value = 0.0
        outputs.append(str(EVIDENCE_DIR / f"{name}.png"))
    reset_pose(arm)
    arm.pose.bones["hips"].location = (0.0, 0.0, 0.0)
    return outputs


def audit_skinning(arm):
    """Report vertices whose dominant bone is implausibly far away.

    Catches the class of bug where weights are computed in the wrong space and
    geometry stretches into spikes instead of failing loudly.
    """
    rest = {bone.name: (arm.data.bones[bone.name].head_local.copy(), arm.data.bones[bone.name].tail_local.copy()) for bone in arm.data.bones}
    worst = 0.0
    worst_where = ""
    unweighted = 0
    total = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for vertex in obj.data.vertices:
            total += 1
            if not vertex.groups:
                unweighted += 1
                continue
            best = max(vertex.groups, key=lambda g: g.weight)
            name = obj.vertex_groups[best.group].name
            if name not in rest:
                continue
            point = obj.matrix_world @ vertex.co
            distance = point_segment_distance(point, *rest[name])
            if distance > worst:
                worst = distance
                worst_where = f"{obj.name}:{name}"
    return {
        "vertices": total,
        "unweighted_vertices": unweighted,
        "worst_dominant_bone_distance_m": round(worst, 4),
        "worst_at": worst_where,
    }


def main():
    arm = build_armature()
    face = build_character_and_face(arm)
    bind_everything(arm, face)

    reset_pose(arm)
    bones = len(arm.data.bones)
    triangles = mesh_statistics()
    morphs = len(face.data.shape_keys.key_blocks) - 1 if face.data.shape_keys else 0

    clips = build_clips(arm, face)
    reset_pose(arm)
    audit = audit_skinning(arm)

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    export_glb(arm, face)
    previews = build_preview_renders(arm, face)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))

    stats = {
        "version": CHARACTER_VERSION,
        "bones": bones,
        "triangles": triangles,
        "objects": len([obj for obj in bpy.data.objects if obj.type == "MESH"]),
        "materials": len(bpy.data.materials),
        "morph_targets": morphs,
        "morph_names": [key.name for key in face.data.shape_keys.key_blocks if key.name != "Basis"],
        "clips": sorted(clips.keys()),
        "detail": model.DETAIL,
        "glb_bytes": GLB_PATH.stat().st_size if GLB_PATH.exists() else 0,
        "glb": GLB_PATH.name,
        "blend": BLEND_PATH.name,
        "bone_names": [bone.name for bone in arm.data.bones],
        "previews": [Path(path).name for path in previews],
        "skinning": audit,
    }
    stats["skinning"] = audit
    if audit["unweighted_vertices"] or audit["worst_dominant_bone_distance_m"] > 0.22:
        raise RuntimeError(f"skinning audit failed: {json.dumps(audit)}")
    (EVIDENCE_DIR / "rig-v1-stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print("ASTRA_V1_STATS " + json.dumps(stats))
    print("ASTRA_V1_COMPLETE")


main()