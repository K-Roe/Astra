"""Build the LW-03 *preview* character on the existing rig and clip pipeline.

Authored against Karl's approved reference image `Astra.png` (2026-10-14),
which was inspected directly before this file was written. The reference shows
a brunette high messy ponytail with a large crown, loose face-framing strands,
a black off-shoulder cropped top with thin straps, purple shorts and black
mid-calf boots. V1 stays untouched as the rollback default until Karl approves
these renders. No external textures, models or downloads.
"""

import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import astra_character_model as model
import create_astra_rigged_v1 as rig

loft = model.loft
strand = model.strand
ellipsoid = model.ellipsoid
# A slightly smaller eyeball keeps the sclera from showing past the lids at
# three-quarter angles, which is what made the previous preview stare.
model.EYE_RADIUS = 0.0149
model.LID_RADIUS = 0.0162


def recolor(surface, rgb, roughness=None):
    """Retint an existing material rather than building a second one."""
    principled = surface.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = (*rgb, 1)
    surface.diffuse_color = (*rgb, 1)
    if roughness is not None:
        principled.inputs["Roughness"].default_value = roughness
        # A little sheen is what separates fabric from painted plastic.
        if "Sheen Weight" in principled.inputs:
            principled.inputs["Sheen Weight"].default_value = 0.25


# ---------------------------------------------------------------- materials
# Brunette, not the V1 purple. Three tones so layered shapes stay readable.
recolor(model.hair, (0.102, 0.058, 0.042), 0.38)
recolor(model.hair_deep, (0.052, 0.030, 0.024), 0.42)
recolor(model.hair_light, (0.185, 0.112, 0.078), 0.34)
# Black off-shoulder top.
recolor(model.hoodie, (0.0225, 0.0225, 0.0295), 0.72)
recolor(model.hoodie_fold, (0.0135, 0.0135, 0.0180), 0.78)
recolor(model.hoodie_light, (0.0400, 0.0400, 0.0505), 0.68)
# Purple shorts: the reference is a saturated violet with a slight sheen.
recolor(model.trousers, (0.235, 0.062, 0.430), 0.46)
recolor(model.trousers_fold, (0.140, 0.035, 0.285), 0.52)
# Black ankle-to-mid-calf boots.
recolor(model.trainers, (0.0195, 0.0190, 0.0245), 0.44)
recolor(model.trainer_panel, (0.0320, 0.0310, 0.0390), 0.40)
recolor(model.soles, (0.0150, 0.0150, 0.0185), 0.55)
recolor(model.laces, (0.085, 0.082, 0.095), 0.6)

# The reference hair tie is a small dusty band, not a bright blob.
hair_tie = model.material("Hair tie", (0.34, 0.13, 0.31), 0.6, 0.25)


# --------------------------------------------------------------------- hair
def ponytail_strand(index, x_offset, y_offset, sway, length, radius, tint, sides=12):
    """One wavy length of hair gathered at the tie.

    The reference ponytail is long, loose and irregular: several overlapping
    lengths of different length and curl, not one tube. Each is swept from the
    tie backwards and downwards with a slow S so the mass reads as loose hair.
    """
    steps = 7
    spine = []
    for step in range(steps + 1):
        t = step / steps
        z = 1.700 - length * t
        # Rises slightly clear of the crown, then falls away behind the back.
        y = 0.108 + y_offset + 0.075 * math.sin(t * 2.0) + 0.075 * t
        x = x_offset * (0.55 + 0.85 * t) + sway * math.sin(t * 3.4 + index * 0.7)
        thickness = radius * (1.0 - 0.62 * t ** 1.5)
        spine.append((Vector((x, y, z)), thickness, thickness * 0.90))
    spine[-1] = (spine[-1][0], 0.004, 0.004)
    return loft(f"Hair ponytail length {index}", spine, tint, sides=sides)


def hair_v2():
    """Crown volume, gathered high ponytail and soft face-framing strands.

    Reference notes: the hair follows the shape of the skull rather than
    ballooning above it, the ponytail is gathered high with real volume above
    and behind the crown, the hairline is covered by swept fringe rather than
    ending in a visible cap edge, and long strands frame the face.
    """
    # Crown: hugs the skull, wider than it is tall, and closes at the back.
    loft("Hair crown mass", [
        (Vector((0, 0.014, 1.4420)), 0.086, 0.082),
        (Vector((0, 0.010, 1.5020)), 0.099, 0.092),
        (Vector((0, 0.006, 1.5620)), 0.104, 0.096),
        (Vector((0, 0.004, 1.6220)), 0.103, 0.093),
        (Vector((0, 0.010, 1.6720)), 0.094, 0.084),
        (Vector((0, 0.020, 1.7060)), 0.070, 0.062),
        (Vector((0, 0.032, 1.7280)), 0.036, 0.032),
    ], model.hair, sides=30, sub=1)
    # Back and side masses that run down behind the ears, hiding the join.
    loft("Hair back mass", [
        (Vector((0, 0.050, 1.3860)), 0.080, 0.068),
        (Vector((0, 0.064, 1.4460)), 0.104, 0.082),
        (Vector((0, 0.070, 1.5120)), 0.114, 0.088),
        (Vector((0, 0.066, 1.5820)), 0.108, 0.082),
    ], model.hair, sides=26, sub=1)
    loft("Hair back shadow", [
        (Vector((0, 0.074, 1.4160)), 0.066, 0.056),
        (Vector((0, 0.086, 1.4900)), 0.084, 0.066),
        (Vector((0, 0.088, 1.5600)), 0.080, 0.062),
    ], model.hair_deep, sides=22)

    # Gathered tie, then the ponytail itself. One continuous mass carries the
    # silhouette; the separate lengths on top of it only add strand texture, so
    # the tail reads as hair rather than a bundle of tubes.
    loft("Hair ponytail tie", [
        (Vector((0, 0.094, 1.6680)), 0.040, 0.030),
        (Vector((0, 0.104, 1.6900)), 0.042, 0.031),
        (Vector((0, 0.102, 1.7080)), 0.032, 0.024),
    ], hair_tie, sides=20)
    loft("Hair ponytail mass", [
        (Vector((0.000, 0.106, 1.6900)), 0.058, 0.054),
        (Vector((0.006, 0.132, 1.6400)), 0.070, 0.064),
        (Vector((-0.008, 0.156, 1.5500)), 0.072, 0.064),
        (Vector((0.010, 0.174, 1.4500)), 0.066, 0.056),
        (Vector((-0.006, 0.182, 1.3400)), 0.054, 0.044),
        (Vector((0.008, 0.178, 1.2300)), 0.038, 0.030),
        (Vector((0.000, 0.166, 1.1300)), 0.020, 0.016),
        (Vector((0.000, 0.158, 1.0700)), 0.006, 0.005),
    ], model.hair, sides=22, sub=1)
    ponytail_strand(0, 0.000, 0.028, 0.000, 0.700, 0.028, model.hair_light, sides=12)
    ponytail_strand(1, -0.030, 0.036, 0.018, 0.620, 0.022, model.hair, sides=12)
    ponytail_strand(2, 0.028, 0.034, -0.020, 0.640, 0.021, model.hair_deep, sides=12)
    ponytail_strand(3, -0.044, 0.014, 0.022, 0.540, 0.017, model.hair, sides=10)
    ponytail_strand(4, 0.042, 0.016, -0.024, 0.560, 0.016, model.hair, sides=10)
    ponytail_strand(5, 0.004, 0.050, 0.008, 0.600, 0.016, model.hair_light, sides=10)

    for side in (-1, 1):
        # Face-framing strands stay outside the cheek line and behind the
        # temple. Crossing the face was the single worst artefact of the last
        # preview, so these are pulled back and outward.
        loft(f"Hair face framing {side}", [
            (Vector((side * 0.084, 0.022, 1.6220)), 0.024, 0.022),
            (Vector((side * 0.104, 0.006, 1.5560)), 0.026, 0.023),
            (Vector((side * 0.112, 0.010, 1.4740)), 0.023, 0.020),
            (Vector((side * 0.108, 0.024, 1.4000)), 0.017, 0.014),
            (Vector((side * 0.098, 0.036, 1.3380)), 0.008, 0.006),
            (Vector((side * 0.090, 0.044, 1.3000)), 0.004, 0.003),
        ], model.hair, sides=14)
        loft(f"Hair temple volume {side}", [
            (Vector((side * 0.082, 0.034, 1.6040)), 0.022, 0.020),
            (Vector((side * 0.094, 0.014, 1.5400)), 0.023, 0.020),
            (Vector((side * 0.092, 0.032, 1.4620)), 0.017, 0.015),
            (Vector((side * 0.086, 0.048, 1.4020)), 0.006, 0.005),
        ], model.hair_deep, sides=12)
        strand(f"Hair loose strand {side}", [
            (side * 0.070, 0.006, 1.6320),
            (side * 0.124, -0.020, 1.5480),
            (side * 0.118, 0.014, 1.4560),
            (side * 0.130, 0.042, 1.3660),
            (side * 0.118, 0.066, 1.3000),
        ], [0.008, 0.010, 0.007, 0.004, 0.002], model.hair_light, sides=8)
        # Shoulder-length lengths that fall forward over the collarbones.
        strand(f"Hair shoulder fall {side}", [
            (side * 0.066, 0.048, 1.5800),
            (side * 0.098, 0.026, 1.4720),
            (side * 0.090, -0.008, 1.3560),
            (side * 0.074, -0.024, 1.2520),
        ], [0.012, 0.013, 0.009, 0.004], model.hair, sides=10)

    # Swept fringe bands. They are set back against the skull and overlap the
    # crown's front edge, so there is no visible hairline seam and no bright
    # band across the forehead.
    loft("Fringe band main", [
        (Vector((-0.098, 0.024, 1.6660)), 0.028, 0.016),
        (Vector((-0.086, -0.020, 1.6280)), 0.030, 0.017),
        (Vector((-0.058, -0.052, 1.6040)), 0.031, 0.017),
        (Vector((-0.022, -0.074, 1.5960)), 0.032, 0.017),
        (Vector((0.016, -0.082, 1.5970)), 0.032, 0.017),
        (Vector((0.056, -0.066, 1.6050)), 0.028, 0.015),
        (Vector((0.090, -0.024, 1.6320)), 0.022, 0.012),
    ], model.hair, sides=22, sub=1)
    loft("Fringe band sweep", [
        (Vector((-0.086, 0.040, 1.6820)), 0.024, 0.014),
        (Vector((-0.048, -0.006, 1.6400)), 0.027, 0.015),
        (Vector((0.002, -0.052, 1.6120)), 0.028, 0.016),
        (Vector((0.050, -0.048, 1.6160)), 0.025, 0.014),
        (Vector((0.070, -0.026, 1.6220)), 0.017, 0.010),
    ], model.hair, sides=20, sub=1)
    loft("Fringe side sweep", [
        (Vector((-0.096, 0.018, 1.6260)), 0.020, 0.012),
        (Vector((-0.090, -0.014, 1.6120)), 0.023, 0.014),
        (Vector((-0.068, -0.036, 1.5940)), 0.019, 0.011),
        (Vector((-0.044, -0.030, 1.5760)), 0.009, 0.005),
    ], model.hair, sides=14, sub=1)
    strand("Fringe accent lock", [
        (-0.058, -0.026, 1.6120), (-0.014, -0.078, 1.5820), (0.046, -0.088, 1.5800),
    ], [0.013, 0.015, 0.005], model.hair_light, sides=8)
    # A soft crown wisp at the back only: a wisp over the brow reads as a horn.
    strand("Crown wisp", [
        (-0.052, 0.052, 1.6780), (-0.094, 0.044, 1.6960), (-0.108, 0.020, 1.6760),
    ], [0.010, 0.008, 0.004], model.hair_light, sides=8)


# --------------------------------------------------------------- face detail
# V1's pink cheek beads read as stickers at render scale, so they are dropped
# and the blush is left to the skin material. The eyeball is also very slightly
# smaller, which keeps the sclera from showing past the lids at three-quarter
# angles instead of leaving her with a permanent wide-eyed stare.
build_eyes_v1 = model.build_eyes


def build_eyes_v2(expression):
    model.EYE_RADIUS = 0.0149
    model.LID_RADIUS = 0.0162
    ellipsoid = model.ellipsoid

    def without_blush(name, location, scale, surface, segments=24, rings=16):
        if name.startswith("Cheek blush"):
            return None
        return ellipsoid(name, location, scale, surface, segments, rings)

    model.ellipsoid = without_blush
    try:
        build_eyes_v1(expression)
    finally:
        model.ellipsoid = ellipsoid
    e = model.EXPRESSIONS[expression]
    blink = e["blink"]
    for side in (-1, 1):
        cx = side * 0.0365
        cz = model.FACE["eye"]
        surface = model.face_surface_y(cx, cz, e)
        centre_y = surface + 0.0042
        # Iris rim: a thin ring just outside the coloured disc.
        rim = []
        for step in range(17):
            angle = math.tau * step / 16
            rim.append((
                cx + math.cos(angle) * 0.0108,
                centre_y - 0.0110,
                cz + math.sin(angle) * 0.0108,
            ))
        strand(f"Iris rim ring {side}", rim, 0.0013, model.iris_rim, sides=6)
        # Upper lid crease, sitting above the lash line on the brow side.
        crease = []
        for index in range(9):
            t = math.pi * (0.12 + 0.76 * index / 8)
            x, z = model.eye_aperture(t, side, blink)
            crease.append((x, model.face_surface_y(x, z + 0.0075, e) - 0.0012, z + 0.0075))
        strand(f"Upper lid crease {side}", crease, 0.0013, model.skin_soft, sides=6)
        # A slightly longer lash at the outer corner, as in the reference.
        t = 0.0
        x, z = model.eye_aperture(t, side, blink)
        strand(f"Outer lash {side}", [
            (x, centre_y - 0.0122, z + 0.0016),
            (x + side * 0.0060, centre_y - 0.0128, z + 0.0030),
            (x + side * 0.0098, centre_y - 0.0126, z + 0.0052),
        ], [0.0016, 0.0010, 0.0004], model.lash, sides=6)


model.build_eyes = build_eyes_v2

# The eye aperture is deliberately left at V1's almond proportions. Opening it
# was tried for the reference's larger anime eyes and rejected: the V1 iris
# size then reads as a small pupil floating in an oversized almond, which is
# worse than the narrower, correctly proportioned eye.


# ------------------------------------------------------------------ clothing
def torso_v2():
    """Black off-shoulder cropped top over bare shoulders, as in the reference.

    The V1 torso was a closed hoodie tube up to the neck with a hood on top.
    The reference shows the neckline sitting below the shoulders, thin straps
    over each shoulder, and the fabric ending above the waist, so the garment
    is rebuilt: a skin neck and shoulder yoke, a cropped bodice that stops
    under the collarbone, straps and dropped-shoulder sleeves.
    """
    # Bare neck, collarbone and shoulder line: the top sits below all of it.
    # The neck is a slim column, so it must not be as wide as the chest.
    loft("Neck and shoulder yoke", [
        (Vector((0, 0.004, 1.2400)), 0.062, 0.056),
        (Vector((0, 0.006, 1.3000)), 0.055, 0.050),
        (Vector((0, 0.008, 1.3520)), 0.050, 0.046),
        (Vector((0, 0.010, 1.4020)), 0.048, 0.046),
        (Vector((0, 0.010, 1.4480)), 0.045, 0.045),
    ], model.skin, sides=24, sub=1)
    for side in (-1, 1):
        # Trapezius and collarbone slope, flattened front to back so the
        # shoulders read as a body rather than two round pads.
        loft(f"Shoulder yoke {side}", [
            (Vector((side * 0.026, 0.004, 1.4040)), 0.030, 0.030),
            (Vector((side * 0.070, 0.002, 1.3820)), 0.034, 0.030),
            (Vector((side * 0.114, -0.002, 1.3520)), 0.032, 0.028),
            (Vector((side * 0.142, -0.006, 1.3300)), 0.026, 0.024),
            (Vector((side * 0.152, -0.008, 1.3060)), 0.016, 0.015),
        ], model.skin, sides=18, sub=1, reference=(0, 0, 1))

    # Cropped bodice: narrower than the shoulders so the neckline reads.
    loft("Off shoulder bodice", [
        (Vector((0, 0.000, 0.9260)), 0.140, 0.100),
        (Vector((0, 0.000, 0.9700)), 0.142, 0.102),
        (Vector((0, 0.000, 1.0300)), 0.136, 0.098),
        (Vector((0, 0.000, 1.0900)), 0.130, 0.094),
        (Vector((0, 0.000, 1.1480)), 0.126, 0.090),
        (Vector((0, 0.000, 1.1880)), 0.128, 0.086),
        (Vector((0, 0.002, 1.2140)), 0.122, 0.078),
    ], model.hoodie, sides=28, sub=1)
    # Neckline band: the top edge that sits across the chest and back.
    loft("Off shoulder neckline", [
        (Vector((0, -0.052, 1.2040)), 0.116, 0.018),
        (Vector((0, -0.026, 1.2140)), 0.126, 0.020),
        (Vector((0, 0.018, 1.2080)), 0.128, 0.020),
        (Vector((0, 0.054, 1.1920)), 0.116, 0.018),
    ], model.hoodie_light, sides=26)
    # Cropped hem with a slight gather so it reads as soft fabric.
    loft("Top hem", [
        (Vector((0, 0.000, 0.9080)), 0.138, 0.099),
        (Vector((0, 0.000, 0.9340)), 0.143, 0.102),
    ], model.hoodie_fold, sides=26)

    for side in (-1, 1):
        # Thin straps over each shoulder, front to back.
        loft(f"Top strap {side}", [
            (Vector((side * 0.050, -0.058, 1.2020)), 0.013, 0.008),
            (Vector((side * 0.066, -0.038, 1.2800)), 0.011, 0.007),
            (Vector((side * 0.072, 0.000, 1.3220)), 0.011, 0.007),
            (Vector((side * 0.066, 0.038, 1.2760)), 0.012, 0.008),
            (Vector((side * 0.050, 0.058, 1.1960)), 0.013, 0.008),
        ], model.hoodie, sides=10)
        # Side and underbust seams.
        strand(f"Top side seam {side}", [
            (side * 0.132, -0.030, 1.2100),
            (side * 0.136, -0.048, 1.1100),
            (side * 0.132, -0.046, 1.0100),
            (side * 0.126, -0.028, 0.9300),
        ], 0.0032, model.hoodie_fold, sides=8)
        loft(f"Top fold underbust {side}", [
            (Vector((side * 0.104, -0.062, 1.1300)), 0.008, 0.005),
            (Vector((side * 0.086, -0.082, 1.0700)), 0.009, 0.006),
            (Vector((side * 0.062, -0.086, 1.0100)), 0.007, 0.004),
        ], model.hoodie_fold, sides=10)
        loft(f"Top fold waist {side}", [
            (Vector((side * 0.098, -0.070, 1.0100)), 0.007, 0.005),
            (Vector((side * 0.074, -0.086, 0.9560)), 0.008, 0.005),
        ], model.hoodie_fold, sides=10)
    # Soft gathers at the centre front, where a loose top bunches.
    strand("Top gather front", [
        (-0.030, -0.094, 1.1500), (0.000, -0.098, 1.1120), (0.030, -0.094, 1.1500),
    ], 0.0028, model.hoodie_fold, sides=6)


def arms_v2(pose="neutral"):
    """Sleeves that start below the shoulder, leaving bare skin above."""
    model.clear_group(model.ARM_OBJECTS)
    for side in (-1, 1):
        shoulder = Vector((side * 0.1450, 0.000, 1.3320))
        elbow = Vector((side * 0.1860, -0.0060, 1.1020))
        if pose == "wave" and side == 1:
            elbow = Vector((0.2380, -0.0300, 1.3920))
            wrist = Vector((0.2500, -0.0760, 1.6120))
        else:
            wrist = Vector((side * 0.1980, -0.0320, 0.8840))
        # The reference shows a bare upper arm: skin first, then the sleeve
        # pushed down to mid-bicep.
        upper = shoulder.lerp(elbow, 0.46)
        model.ARM_OBJECTS.append(loft(f"Arm skin {side}", [
            (shoulder + Vector((side * 0.004, -0.002, 0.006)), 0.040, 0.041),
            (shoulder.lerp(elbow, 0.24), 0.036, 0.037),
            (upper, 0.033, 0.034),
        ], model.skin, sides=18, sub=1))
        model.ARM_OBJECTS.append(loft(f"Hoodie sleeve {side}", [
            (upper + Vector((side * 0.001, 0.001, 0.010)), 0.046, 0.047),
            (upper.lerp(elbow, 0.55), 0.042, 0.044),
            (upper.lerp(elbow, 0.95), 0.039, 0.041),
            (elbow, 0.037, 0.038),
            (elbow.lerp(wrist, 0.42), 0.035, 0.037),
            (wrist, 0.033, 0.034),
        ], model.hoodie, sides=20, sub=1))
        model.ARM_OBJECTS.append(loft(f"Sleeve cuff {side}", [
            (wrist + (wrist - elbow).normalized() * 0.016, 0.037, 0.038),
            (wrist - (wrist - elbow).normalized() * 0.004, 0.034, 0.035),
        ], model.hoodie_fold, sides=20))
        model.ARM_OBJECTS.append(loft(f"Sleeve elbow fold {side}", [
            (elbow + Vector((side * 0.010, -0.030, 0.012)), 0.008, 0.005),
            (elbow + Vector((side * 0.006, -0.034, -0.020)), 0.006, 0.004),
        ], model.hoodie_fold, sides=10))
        # A loose sleeve gathers slightly at the forearm.
        model.ARM_OBJECTS.append(loft(f"Sleeve gather {side}", [
            (elbow.lerp(wrist, 0.30) + Vector((side * 0.006, -0.012, 0.004)), 0.040, 0.041),
            (elbow.lerp(wrist, 0.46) + Vector((side * 0.004, -0.014, 0.002)), 0.036, 0.037),
        ], model.hoodie_fold, sides=16))
        hand_v2(side, wrist, Vector((0.10, -0.24, -0.97)))


def hand_v2(side, wrist, direction):
    """A hand with one continuous tapered finger instead of visible segments.

    V1 built each finger from three straight strands and separate tip beads,
    which read as a row of cylinders. Each finger here is a single loft with a
    continuous taper and curl, so the silhouette closes.
    """
    origin = Vector(wrist)
    axis = Vector(direction).normalized()
    palm = origin + axis * 0.028 + Vector((side * 0.003, 0.0, 0.0))
    model.ARM_OBJECTS.append(ellipsoid(f"Hand palm {side}", tuple(palm), (0.036, 0.021, 0.037), model.skin, 20, 14))
    model.ARM_OBJECTS.append(
        ellipsoid(f"Hand knuckle pad {side}", tuple(palm + axis * 0.024 + Vector((0, 0, 0.003))), (0.033, 0.019, 0.014), model.skin_soft, 16, 10)
    )
    lengths = (0.030, 0.021, 0.015)
    base_radius = (0.0104, 0.0095, 0.0080)
    for finger in range(4):
        lateral = side * (finger - 1.5) * 0.0152
        root = palm + Vector((lateral, 0.0, 0.0)) + axis * 0.024 + Vector((0.0, 0.0, 0.004 * (1.5 - abs(finger - 1.5))))
        curl = 0.34 + 0.30 * (finger in (0, 3))
        # One smooth spine: three phalanges that curve progressively.
        spine = []
        total = sum(lengths)
        travelled = 0.0
        steps = 9
        for step in range(steps + 1):
            t = step / steps
            # Arc length along the finger, used to interpolate phalanges.
            target = t * total
            point = root.copy()
            direction_now = (axis + Vector((-lateral * 0.75, 0.0, -0.30 * curl))).normalized()
            remaining = target
            for joint, length in enumerate(lengths):
                step_length = min(length, remaining)
                point = point + direction_now * step_length
                remaining -= step_length
                bend = 0.16 * curl * (joint + 1)
                direction_now = Vector((direction_now.x, direction_now.y, direction_now.z - bend)).normalized()
                if remaining <= 1e-6:
                    break
            radius = 0.0
            for joint, length in enumerate(lengths):
                start = sum(lengths[:joint])
                local = min(max((target - start) / length, 0.0), 1.0)
                if joint == len(lengths) - 1 or target <= start + length:
                    radius = base_radius[joint] * (1.0 - 0.30 * local)
                    break
            spine.append((point, max(radius, 0.0035), max(radius, 0.0032)))
        model.ARM_OBJECTS.append(loft(f"Finger {side}-{finger}", spine, model.skin, sides=10))
        tip = spine[-1][0]
        model.ARM_OBJECTS.append(ellipsoid(f"Finger tip {side}-{finger}", tuple(tip), (0.0058, 0.0058, 0.0058), model.skin, 12, 8))
        # A shallow knuckle crease so the finger is not a smooth cone.
        model.ARM_OBJECTS.append(loft(f"Knuckle crease {side}-{finger}", [
            (root + (spine[2][0] - root) * 0.30, base_radius[0] * 0.98, base_radius[0] * 0.98),
            (root + (spine[3][0] - root) * 0.34, base_radius[0] * 0.92, base_radius[0] * 0.92),
        ], model.skin_soft, sides=10))
    thumb_root = palm + Vector((side * 0.024, -0.004, -0.010))
    thumb_dir = (axis * 0.6 + Vector((side * 0.68, -0.20, -0.16))).normalized()
    model.ARM_OBJECTS.append(strand(f"Thumb {side}-0", [tuple(thumb_root), tuple(thumb_root + thumb_dir * 0.026)], 0.0110, model.skin, sides=10))
    thumb_mid = thumb_root + thumb_dir * 0.026
    thumb_tip = thumb_mid + (thumb_dir * 0.75 + Vector((0.0, -0.20, -0.14))).normalized() * 0.021
    model.ARM_OBJECTS.append(strand(f"Thumb {side}-1", [tuple(thumb_mid), tuple(thumb_tip)], 0.0088, model.skin, sides=10))
    model.ARM_OBJECTS.append(ellipsoid(f"Thumb tip {side}", tuple(thumb_tip), (0.0068, 0.0068, 0.0068), model.skin, 12, 8))


def legs_v2():
    """Purple shorts over bare legs and black mid-calf boots."""
    for side in (-1, 1):
        x = side * .086
        loft(f"Trouser hip blend {side}", [
            (Vector((x * .78, 0.005, 1.0150)), 0.087, 0.095),
            (Vector((x, 0.002, 0.9500)), 0.100, 0.106),
            (Vector((x, -0.005, 0.8300)), 0.093, 0.100),
        ], model.trousers, sides=20)
        # Shorts end high on the thigh, as in the reference.
        loft(f"Trouser leg shorts {side}", [
            (Vector((x, -0.005, 0.8800)), 0.094, 0.100),
            (Vector((x, -0.008, 0.7900)), 0.086, 0.093),
            (Vector((x, -0.010, 0.7180)), 0.083, 0.090),
        ], model.trousers, sides=20)
        loft(f"Trouser cuff shorts {side}", [
            (Vector((x, -0.010, 0.7140)), 0.084, 0.091),
            (Vector((x, -0.011, 0.7340)), 0.086, 0.093),
        ], model.trousers_fold, sides=20)
        loft(f"Trouser side seam {side}", [
            (Vector((x * 1.02, -0.070, 0.9500)), 0.006, 0.005),
            (Vector((x * 1.05, -0.080, 0.8600)), 0.007, 0.005),
            (Vector((x * 1.04, -0.072, 0.7500)), 0.006, 0.004),
        ], model.trousers_fold, sides=10)
        # The bare leg ends inside the boot shaft. Ending it lower let the leg
        # cylinder poke through the boot opening as a hard zigzag rim.
# The bare leg stops at the boot opening. Letting it continue past a narrower
        # boot rim made the leg poke through as a sawtooth edge.
        loft(f"Trouser leg bare skin {side}", [
            (Vector((x, -0.010, 0.7300)), 0.077, 0.083),
            (Vector((x, -0.009, 0.6200)), 0.069, 0.076),
            (Vector((x, -0.012, 0.5200)), 0.057, 0.063),
            (Vector((x, -0.017, 0.4780)), 0.055, 0.060),
        ], model.skin, sides=22, sub=1)
        # Black boot: taller shaft than V1's ankle boot, small block heel. The
        # shaft opening is wider than the leg so the rim reads as a boot top.
        loft(f"Trainer ankle boot {side}", [
            (Vector((x, -0.019, 0.4560)), 0.060, 0.060),
            (Vector((x, -0.020, 0.4380)), 0.058, 0.059),
            (Vector((x, -0.021, 0.3300)), 0.054, 0.056),
            (Vector((x, -0.022, 0.2600)), 0.052, 0.054),
            (Vector((x, -0.026, 0.1900)), 0.055, 0.056),
            (Vector((x, -0.058, 0.1100)), 0.061, 0.060),
            (Vector((x, -0.130, 0.0660)), 0.063, 0.050),
            (Vector((x, -0.208, 0.0540)), 0.041, 0.034),
        ], model.trainers, sides=20)
        loft(f"Trainer sole boot {side}", [
            (Vector((x, 0.036, 0.0250)), 0.052, 0.018),
            (Vector((x, -0.045, 0.0190)), 0.064, 0.018),
            (Vector((x, -0.140, 0.0180)), 0.065, 0.017),
            (Vector((x, -0.216, 0.0270)), 0.039, 0.012),
        ], model.soles, sides=18, reference=(0, 0, 1))
        loft(f"Trainer heel block {side}", [
            (Vector((x, 0.010, 0.0450)), 0.044, 0.030),
            (Vector((x, 0.004, 0.0090)), 0.046, 0.012),
        ], model.soles, sides=16, reference=(0, 1, 0))
        strand(f"Trainer seam boot {side}", [
            (x - side * 0.050, -0.056, 0.36), (x - side * 0.052, -0.080, 0.20),
            (x - side * 0.044, -0.122, 0.098),
        ], 0.003, model.trainer_panel, sides=8)


build_arms_v1 = model.build_arms
model.build_torso = torso_v2
model.build_legs = legs_v2
model.build_hair = hair_v2
model.build_arms = arms_v2


# --------------------------------------------------------------------- rig
# The reference ponytail is long enough to hang past the shoulders. Without a
# bone chain behind the head it can only weight to the neck, which both fails
# the skinning distance audit and leaves the tail welded to the skull. A short
# hair chain also allows genuine secondary sway in the walk and idle clips.
HAIR_CHAIN = [
    ("hair_1", (0, 0.06, 1.700), (0, 0.135, 1.540), "head", False),
    ("hair_2", (0, 0.135, 1.540), (0, 0.190, 1.350), "hair_1", True),
    ("hair_3", (0, 0.190, 1.350), (0, 0.215, 1.160), "hair_2", True),
    ("hair_4", (0, 0.215, 1.160), (0, 0.220, 0.980), "hair_3", True),
]
rig.BONES.extend(HAIR_CHAIN)

allowed_bones_v1 = rig.allowed_bones_for


def allowed_bones_v2(obj):
    names = allowed_bones_v1(obj)
    if obj.name.startswith("Hair"):
        names = names + [name for name, *_ in HAIR_CHAIN if name not in names]
    if obj.name.startswith("Arm skin"):
        names = names + [name for name, *_ in rig.ARM_CHAIN if name not in names] + ["chest"]
    return names


rig.allowed_bones_for = allowed_bones_v2

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
    add_hair_sway(arm, clips)
    return clips


HAIR_BONES = ("hair_1", "hair_2", "hair_3", "hair_4")


def add_hair_sway(arm, clips):
    """Give the ponytail a small lag behind the body.

    This is authored keyframe sway on the hair bone chain, not a physics
    simulation. Each bone trails the one above it, which is what stops a high
    ponytail reading as a rigid helmet when she turns, walks or sits down.
    """
    def sway(action_name, frames, amplitude):
        arm.animation_data_create()
        arm.animation_data.action = bpy.data.actions[action_name]
        for index, frame in enumerate(frames):
            rig.reset_pose(arm)
            phase = index / max(1, len(frames) - 1) * math.tau
            pose = {}
            for depth, bone in enumerate(HAIR_BONES):
                lagged = phase - 0.5 * (depth + 1)
                amount = amplitude * (0.32 + 0.24 * depth)
                pose[bone] = (amount * 0.35 * math.sin(lagged), 0.0, amount * math.sin(lagged))
            rig.apply_pose(arm, pose)
            rig.key_bones(arm, list(HAIR_BONES), frame)
        arm.animation_data.action = None

    if "walk" in clips:
        sway(clips["walk"], list(range(1, 37, 4)), 0.085)
    for name in ("turn_left", "turn_right"):
        if name in clips:
            sway(clips[name], list(range(1, 27, 4)), 0.060)
    for name, last in (("sit_down", 46), ("stand_up", 41)):
        if name in clips:
            sway(clips[name], list(range(1, last, 6)), 0.075)


rig.build_clips = clips_v2

render_previews_v1 = rig.build_preview_renders

REPO_ROOT = Path(__file__).resolve().parents[2]
FINAL_EVIDENCE = REPO_ROOT / "docs" / "review" / "lw03" / "final"


def preview_v2(arm, face):
    """Comparison evidence set, including a ponytail close-up.

    The first four frames come from the shared V1 renderer (neutral, wave,
    walk, three-quarter) and are kept so the animation set stays comparable
    between V1 and V2. The rest are the LW-03 final review views.
    """
    files = render_previews_v1(arm, face)
    scene = bpy.context.scene
    camera = scene.camera
    FINAL_EVIDENCE.mkdir(parents=True, exist_ok=True)

    rig.reset_pose(arm)
    rig.apply_pose(arm, {"thigh.L": (-1.42, 0, .06), "thigh.R": (-1.42, 0, -.06),
                         "shin.L": (1.38, 0, 0), "shin.R": (1.38, 0, 0)})
    arm.pose.bones["hips"].location = (0, 0, -.47)
    face.data.shape_keys.key_blocks["happy"].value = 1
    scene.render.filepath = str(FINAL_EVIDENCE / "final-sofa-sit.png")
    bpy.ops.render.render(write_still=True)
    files.append(scene.render.filepath)

    rig.reset_pose(arm)
    seat = {"thigh.L": (-1.42, 0, .06), "thigh.R": (-1.42, 0, -.06),
            "shin.L": (1.38, 0, 0), "shin.R": (1.38, 0, 0),
            "spine_lower": (.09, 0, 0),
            "upperarm.L": (-1.18, 0, -.18), "upperarm.R": (-1.18, 0, .18),
            "lowerarm.L": (.40, 0, 0), "lowerarm.R": (.40, 0, 0)}
    rig.apply_pose(arm, seat)
    arm.pose.bones["hips"].location = (0, 0, -.47)
    for name, location, scale, target in [
        ("final-desk-work", (2.3, -3.0, 1.35), 1.5, (0, 0, 1.05)),
        ("final-desk-side", (0.0, -3.4, 1.15), 1.6, (0, 0, 1.0)),
    ]:
        camera.location = location
        camera.data.ortho_scale = scale
        camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(FINAL_EVIDENCE / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        files.append(scene.render.filepath)
    face.data.shape_keys.key_blocks["happy"].value = 0

    rig.reset_pose(arm)
    for name, location, scale, target in [
        ("final-front", (0, -3.8, 1.15), 2.1, (0, 0, .9)),
        ("final-three-quarter", (2.7, -2.7, 1.15), 2.1, (0, 0, .9)),
        ("final-side", (3.8, 0, 1.15), 2.1, (0, 0, .9)),
        ("final-face", (0, -2.1, 1.57), .55, (0, 0, 1.55)),
        ("final-face-three-quarter", (1.25, -1.75, 1.56), .55, (0, 0, 1.55)),
        ("final-ponytail", (1.5, 2.1, 1.45), .78, (0, .08, 1.42)),
        ("final-hands", (0.55, -1.55, 0.95), .42, (.16, 0, .92)),
        ("final-outfit", (0, -3.4, 1.05), 1.5, (0, 0, 1.05)),
    ]:
        camera.location = location
        camera.data.ortho_scale = scale
        camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(FINAL_EVIDENCE / f"{name}.png")
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