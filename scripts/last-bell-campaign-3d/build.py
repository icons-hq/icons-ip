#!/usr/bin/env python3
"""Build the original, rights-safe Last Bell two-chapter runtime pack.

The pack is deliberately authored from neutral school architecture and
procedural PBR materials. It contains no actor likeness, show frame, or
licensed promotional pixel. `character.namra.rooftop` is a replaceable,
faceless staging silhouette until a separately approved character delivery
replaces it.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy


OUT = Path(sys.argv[sys.argv.index("--") + 1]).resolve() if "--" in sys.argv else Path.cwd() / "public/generated/last-bell/3d/campaign"
OUT.mkdir(parents=True, exist_ok=True)


def game_position(value: tuple[float, float, float]) -> tuple[float, float, float]:
    """Convert the R3F Y-up world to Blender's Z-up authoring space."""
    x, y, z = value
    return (x, -z, y)


def game_size(value: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = value
    return (x, z, y)


def clean() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for block in list(blocks):
            try:
                blocks.remove(block)
            except RuntimeError:
                pass


def material(name: str, color: tuple[float, float, float, float], roughness: float, metallic: float = 0.0, emission: tuple[float, float, float, float] | None = None) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.diffuse_color = color
    bsdf = result.node_tree.nodes.get("Principled BSDF")
    assert bsdf is not None
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = 0.42
    return result


def set_parent(object: bpy.types.Object, parent: bpy.types.Object | None) -> bpy.types.Object:
    if parent:
        object.parent = parent
    return object


def empty(name: str, parent: bpy.types.Object | None = None, position: tuple[float, float, float] | None = None) -> bpy.types.Object:
    object = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(object)
    set_parent(object, parent)
    if position:
        object.location = game_position(position)
    return object


def box(name: str, position: tuple[float, float, float], size: tuple[float, float, float], surface: bpy.types.Material, parent: bpy.types.Object | None = None, bevel: float = 0.018) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add()
    object = bpy.context.object
    assert object is not None
    object.name = name
    object.location = game_position(position)
    object.dimensions = game_size(size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = object.modifiers.new("Structural_Bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    object.data.materials.append(surface)
    set_parent(object, parent)
    return object


def cylinder(name: str, position: tuple[float, float, float], radius: float, height: float, surface: bpy.types.Material, parent: bpy.types.Object | None = None, sides: int = 12) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=height)
    object = bpy.context.object
    assert object is not None
    object.name = name
    object.location = game_position(position)
    object.data.materials.append(surface)
    set_parent(object, parent)
    bevel = object.modifiers.new("Edge_Soften", "BEVEL")
    bevel.width = min(radius * .2, .012)
    bevel.segments = 2
    return object


def cube_collider(name: str, parent: bpy.types.Object, center: tuple[float, float, float], size: tuple[float, float, float]) -> None:
    proxy = empty(name, parent, center)
    proxy["collision_bounds_m"] = list(size)
    proxy["collision_only"] = True


def room_shell(zone: bpy.types.Object, label: str, center: tuple[float, float, float], size: tuple[float, float, float], surfaces: dict[str, bpy.types.Material], entry_side: str | None = None) -> bpy.types.Object:
    x, _, z = center
    width, _, depth = size
    shell = empty(f"Shell_{label}", zone)
    box(f"{label}_Floor", (x, 0, z), (width, .18, depth), surfaces["tile"], shell, .012)
    box(f"{label}_Ceiling", (x, 3.92, z), (width, .14, depth), surfaces["ceiling"], shell, .006)
    box(f"{label}_BackWall", (x, 1.96, z + depth / 2), (width, 3.92, .16), surfaces["plaster"], shell, .026)
    box(f"{label}_FrontWall", (x, 1.96, z - depth / 2), (width, 3.92, .16), surfaces["plaster_dark"], shell, .026)
    if entry_side != "left":
        box(f"{label}_LeftWall", (x - width / 2, 1.96, z), (.16, 3.92, depth), surfaces["plaster"], shell, .026)
    if entry_side != "right":
        box(f"{label}_RightWall", (x + width / 2, 1.96, z), (.16, 3.92, depth), surfaces["plaster_dark"], shell, .026)
    cube_collider(f"COL_{label}", zone, (x, 1.9, z), size)
    return shell


def desk(name: str, parent: bpy.types.Object, position: tuple[float, float, float], surfaces: dict[str, bpy.types.Material], rotation: float = 0.0) -> None:
    root = empty(name, parent, position)
    root.rotation_euler[2] = -rotation
    box(f"{name}_Top", (0, .72, 0), (1.15, .1, .58), surfaces["wood"], root, .028)
    box(f"{name}_Shelf", (0, .52, 0), (.96, .06, .46), surfaces["wood_dark"], root, .018)
    for index, (x, z) in enumerate(((-.46, -.21), (.46, -.21), (-.46, .21), (.46, .21))):
        leg = cylinder(f"{name}_Leg_{index}", (x, .34, z), .026, .7, surfaces["metal"], root, 8)
        leg.rotation_euler[0] = math.pi / 2


def locker_bank(name: str, parent: bpy.types.Object, position: tuple[float, float, float], count: int, surfaces: dict[str, bpy.types.Material]) -> None:
    root = empty(name, parent, position)
    for index in range(count):
        x = (index - (count - 1) / 2) * .54
        box(f"{name}_Door_{index}", (x, 1.22, 0), (.48, 2.35, .34), surfaces["locker"], root, .026)
        box(f"{name}_Vent_{index}", (x, 1.84, -.18), (.26, .09, .016), surfaces["metal_dark"], root, .004)
        cylinder(f"{name}_Pull_{index}", (x + .14, 1.22, -.2), .018, .11, surfaces["metal"], root, 8)


def bed(name: str, parent: bpy.types.Object, position: tuple[float, float, float], surfaces: dict[str, bpy.types.Material]) -> None:
    root = empty(name, parent, position)
    box(f"{name}_Frame", (0, .5, 0), (.92, .08, 2.06), surfaces["metal"], root, .025)
    box(f"{name}_Mattress", (0, .62, 0), (.78, .2, 1.82), surfaces["linen"], root, .035)
    for x in (-.42, .42):
        rail = cylinder(f"{name}_Rail_{x}", (x, .95, 0), .026, 1.92, surfaces["metal"], root, 8)
        rail.rotation_euler[0] = math.pi / 2
    for x, z in ((-.38, -.86), (.38, -.86), (-.38, .86), (.38, .86)):
        cylinder(f"{name}_Leg_{x}_{z}", (x, .27, z), .03, .55, surfaces["metal_dark"], root, 8)


def create_environment() -> bpy.types.Object:
    surfaces = {
        "tile": material("PBR_Dirty_Teal_Tile", (.075, .12, .125, 1), .86),
        "plaster": material("PBR_Aged_Ivory_Plaster", (.30, .34, .31, 1), .94),
        "plaster_dark": material("PBR_Sooted_Plaster", (.045, .07, .072, 1), .98),
        "ceiling": material("PBR_Acoustic_Ceiling", (.20, .25, .24, 1), .97),
        "metal": material("PBR_Worn_Steel", (.19, .28, .28, 1), .38, .75),
        "metal_dark": material("PBR_Burned_Steel", (.025, .045, .048, 1), .48, .82),
        "locker": material("PBR_Faded_Sage_Metal", (.17, .31, .30, 1), .52, .54),
        "wood": material("PBR_Worn_Desk_Wood", (.20, .13, .075, 1), .74),
        "wood_dark": material("PBR_Charred_Wood", (.065, .04, .025, 1), .88),
        "linen": material("PBR_Aged_Linen", (.33, .36, .32, 1), .96),
        "broadcast": material("PBR_Console_Plastic", (.055, .10, .105, 1), .31, .15),
        "brick": material("PBR_Exposed_Brick", (.18, .075, .055, 1), .91),
        "ember": material("PBR_Ember", (.33, .045, .006, 1), .57, .0, (.95, .12, .008, 1)),
        "roof": material("PBR_Wet_Rooftop_Concrete", (.055, .09, .095, 1), .76),
    }
    root = empty("TwoChapterCampaign_Root")
    root["asset_contract"] = "last-bell.two-chapter.route.v1"
    root["units"] = "meters-y-up"

    corridor = empty("Zone_corridor", root)
    corridor["zone_id"] = "corridor"
    box("Corridor_Floor", (0, 0, 45.5), (6.1, .18, 43), surfaces["tile"], corridor, .012)
    box("Corridor_Ceiling", (0, 3.92, 45.5), (6.1, .14, 43), surfaces["ceiling"], corridor, .006)
    # The two breached door bays are left physically open to match simulation navigation.
    for index, (z, depth) in enumerate(((27, 5.7), (39.6, 11.0), (57.7, 18.2))):
        box(f"Corridor_RightWall_{index}", (3.0, 1.96, z), (.18, 3.92, depth), surfaces["plaster_dark"], corridor, .026)
    for index, (z, depth) in enumerate(((31, 13.6), (56.9, 18.7))):
        box(f"Corridor_LeftWall_{index}", (-3.0, 1.96, z), (.18, 3.92, depth), surfaces["plaster"], corridor, .026)
    cube_collider("COL_Corridor_Lane", corridor, (0, 1.8, 45.5), (6, 3.6, 43))
    lod0 = empty("LOD0_corridor_detail", corridor)
    lod1 = empty("LOD1_corridor_silhouette", corridor)
    for index, z in enumerate((29, 35, 51, 58)):
        locker_bank(f"Corridor_LockerBank_{index}", lod0, (2.68, 0, z), 4, surfaces)
        box(f"Corridor_LowDetailBank_{index}", (2.7, 1.25, z), (.35, 2.45, 2.45), surfaces["locker"], lod1, .02)
    for index, (x, z, yaw) in enumerate(((-1.4, 27.3, .12), (1.0, 34.1, -.32), (-.85, 52.8, .24), (1.4, 60.1, -.15))):
        desk(f"Corridor_OverturnedDesk_{index}", lod0, (x, 0, z), surfaces, yaw)
    for index, z in enumerate((26.4, 33.4, 47.6, 56.2, 62.2)):
        box(f"Corridor_Fluorescent_{index}", (0, 3.72, z), (1.38, .1, .22), surfaces["metal"], lod0, .024)

    infirmary = empty("Zone_infirmary", root)
    infirmary["zone_id"] = "infirmary"
    room_shell(infirmary, "Infirmary", (7, 0, 32.5), (6, 0, 11), surfaces, "left")
    # Re-open the corridor-facing shell after room_shell adds the full wall.
    box("Infirmary_EntryFrame_Top", (4.05, 3.36, 32.5), (.16, .55, 2.15), surfaces["metal"], infirmary, .02)
    infirmary_lod0 = empty("LOD0_infirmary_detail", infirmary)
    infirmary_lod1 = empty("LOD1_infirmary_silhouette", infirmary)
    for index, z in enumerate((29.7, 33.0, 36.1)):
        bed(f"Infirmary_Bed_{index}", infirmary_lod0, (7.85, 0, z), surfaces)
    box("Infirmary_Cabinet", (9.25, 1.22, 29.1), (.7, 2.35, 1.1), surfaces["locker"], infirmary_lod0, .03)
    box("Infirmary_LowBeds", (7.8, .6, 32.5), (1.2, 1.15, 7.4), surfaces["linen"], infirmary_lod1, .035)

    broadcast = empty("Zone_broadcast", root)
    broadcast["zone_id"] = "broadcast"
    room_shell(broadcast, "Broadcast", (-7, 0, 43), (6, 0, 12), surfaces, "right")
    broadcast_lod0 = empty("LOD0_broadcast_detail", broadcast)
    broadcast_lod1 = empty("LOD1_broadcast_silhouette", broadcast)
    box("Broadcast_ConsoleDesk", (-7.1, .75, 45.3), (3.9, 1.45, 1.05), surfaces["broadcast"], broadcast_lod0, .045)
    for index, x in enumerate((-8.25, -7.45, -6.65, -5.85)):
        box(f"Broadcast_Monitor_{index}", (x, 1.58, 45.1), (.6, .48, .08), surfaces["metal_dark"], broadcast_lod0, .018)
        box(f"Broadcast_MonitorGlow_{index}", (x, 1.58, 45.045), (.46, .3, .01), surfaces["broadcast"], broadcast_lod0, .004)
    box("Broadcast_AcousticWall", (-9.86, 2.0, 43), (.13, 3.8, 11.6), surfaces["wood_dark"], broadcast_lod1, .02)
    locker_bank("Broadcast_ArchiveBank", broadcast_lod0, (-9.2, 0, 39.2), 3, surfaces)

    utility = empty("Zone_utility", root)
    utility["zone_id"] = "utility"
    room_shell(utility, "Utility", (0, 0, 64), (6, 0, 6), surfaces)
    utility_lod0 = empty("LOD0_utility_detail", utility)
    utility_lod1 = empty("LOD1_utility_silhouette", utility)
    box("Utility_PowerPanel", (1.55, 1.52, 64.52), (1.05, 2.25, .19), surfaces["metal"], utility_lod0, .035)
    for index in range(5):
        box(f"Utility_Breaker_{index}", (1.22 + index * .16, 1.55, 64.3), (.08, .27, .05), surfaces["ember" if index == 3 else "metal_dark"], utility_lod0, .008)
    box("Utility_NoiseRig", (-1.45, .95, 64.3), (.92, 1.55, .86), surfaces["broadcast"], utility_lod0, .04)
    cylinder("Utility_NoiseSpeaker", (-1.45, 1.15, 63.84), .22, .1, surfaces["metal_dark"], utility_lod0, 18)
    box("Utility_LowGenerator", (0, .72, 64), (4.2, 1.45, 2.9), surfaces["metal_dark"], utility_lod1, .04)

    stairwell = empty("Zone_stairwell", root)
    stairwell["zone_id"] = "stairwell"
    room_shell(stairwell, "Stairwell", (0, 0, 74.5), (7.3, 0, 15), surfaces)
    stair_lod0 = empty("LOD0_stairwell_detail", stairwell)
    stair_lod1 = empty("LOD1_stairwell_silhouette", stairwell)
    for index in range(12):
        step_z = 69.5 + index * .86
        step_y = .13 + index * .06
        box(f"Stairwell_Step_{index}", (0, step_y, step_z), (3.55, .18, .88), surfaces["tile"], stair_lod0, .012)
    for x in (-1.65, 1.65):
        rail = box(f"Stairwell_Rail_{x}", (x, 1.25, 74.5), (.06, .06, 10.5), surfaces["metal"], stair_lod0, .018)
        rail.rotation_euler[0] = -.09
    box("Stairwell_LowFlight", (0, .82, 74.5), (3.7, 1.5, 10.8), surfaces["tile"], stair_lod1, .025)

    rooftop = empty("Zone_rooftop", root)
    rooftop["zone_id"] = "rooftop"
    box("Rooftop_Floor", (0, 0, 95), (20, .22, 26), surfaces["roof"], rooftop, .018)
    for name, pos, size in (
        ("Rooftop_Parapet_North", (0, 1.05, 108), (20, 2.1, .45)),
        ("Rooftop_Parapet_South", (0, 1.05, 82), (20, 2.1, .45)),
        ("Rooftop_Parapet_West", (-10, 1.05, 95), (.45, 2.1, 26)),
        ("Rooftop_Parapet_East", (10, 1.05, 95), (.45, 2.1, 26)),
    ):
        box(name, pos, size, surfaces["plaster_dark"], rooftop, .04)
    cube_collider("COL_Rooftop", rooftop, (0, 1.1, 95), (20, 2.2, 26))
    roof_lod0 = empty("LOD0_rooftop_detail", rooftop)
    roof_lod1 = empty("LOD1_rooftop_silhouette", rooftop)
    cylinder("Rooftop_WaterTank", (-6.8, 2.05, 91.2), 1.18, 3.8, surfaces["metal"], roof_lod0, 18)
    box("Rooftop_TankStand", (-6.8, .52, 91.2), (2.7, 1.05, 2.7), surfaces["metal_dark"], roof_lod0, .04)
    box("Rooftop_EmergencyBox", (5.6, .52, 88.3), (1.55, .84, .9), surfaces["metal"], roof_lod0, .04)
    box("Rooftop_LowTank", (-6.8, 1.55, 91.2), (2.8, 3.1, 2.8), surfaces["metal"], roof_lod1, .05)
    fire = empty("Rooftop_Campfire", roof_lod0, (2.8, 0, 98.7))
    for index, rotation in enumerate((.15, 1.2, 2.35)):
        log = box(f"Rooftop_FireLog_{index}", (0, .18, 0), (1.3, .18, .16), surfaces["wood_dark"], fire, .03)
        log.rotation_euler[2] = -rotation
    for index, (x, z) in enumerate(((.05, .02), (-.13, -.04), (.15, -.1))):
        cylinder(f"Rooftop_Ember_{index}", (x, .37 + index * .05, z), .14 - index * .02, .45 + index * .16, surfaces["ember"], fire, 8)

    for identifier, z in (("DoorFire", 67.0), ("DoorRooftop", 82.0)):
        pivot = empty(f"{identifier}_Pivot", root, (0, 1.5, z))
        pivot["door_system_id"] = "door.fire" if identifier == "DoorFire" else "door.rooftop"
        panel = box(f"{identifier}_Panel", (0, 0, 0), (3.28, 3.0, .13), surfaces["metal_dark"], pivot, .035)
        panel.location = (0, 0, 0)
        box(f"{identifier}_Window", (0, .35, -.075), (1.45, 1.08, .012), surfaces["broadcast"], pivot, .005).location = game_position((0, .35, -.075))
        cube_collider(f"COL_{identifier}", pivot, (0, 0, 0), (3.3, 3.0, .18))

    return root


def create_armature(name: str, parent: bpy.types.Object | None = None) -> tuple[bpy.types.Object, dict[str, bpy.types.Object]]:
    data = bpy.data.armatures.new(name + "_Data")
    armature = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(armature)
    set_parent(armature, parent)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = {}
    for bone_name, head, tail, parent_name in (
        ("Root", (0, 0, 0), (0, 0, 1), None),
        ("Spine", (0, 0, .8), (0, 0, 1.75), "Root"),
        ("Head", (0, 0, 1.65), (0, 0, 2.25), "Spine"),
        ("Arm_L", (0, 0, 1.45), (-.65, 0, 1.15), "Spine"),
        ("Arm_R", (0, 0, 1.45), (.65, 0, 1.15), "Spine"),
    ):
        bone = data.edit_bones.new(bone_name)
        bone.head, bone.tail = head, tail
        if parent_name:
            bone.parent = data.edit_bones[parent_name]
        bones[bone_name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature, {name: armature.pose.bones[name] for name in bones}


def limb(name: str, armature: bpy.types.Object, bone: str, location: tuple[float, float, float], size: tuple[float, float, float], surface: bpy.types.Material, rounded: bool = True) -> bpy.types.Object:
    object = box(name, location, size, surface, None, .05 if rounded else .016)
    object.parent = armature
    object.parent_type = "BONE"
    object.parent_bone = bone
    return object


def animate_pose(armature: bpy.types.Object, label: str, motion: list[tuple[int, dict[str, tuple[float, float, float]]]]) -> None:
    action = bpy.data.actions.new(label)
    armature.animation_data_create()
    armature.animation_data.action = action
    for frame, pose in motion:
        for bone_name, rotation in pose.items():
            bone = armature.pose.bones[bone_name]
            bone.rotation_mode = "XYZ"
            bone.rotation_euler = rotation
            bone.keyframe_insert(data_path="rotation_euler", frame=frame)


def create_zombie() -> bpy.types.Object:
    fabric = material("PBR_Zombie_Uniform_Base", (.18, .26, .25, 1), .67, .04)
    skin = material("PBR_Zombie_Desaturated_Skin", (.25, .35, .31, 1), .84)
    blood = material("PBR_Zombie_Stained_Fabric", (.14, .035, .025, 1), .76)
    root = empty("ZombieSharedRig_Root")
    root["shared_rig"] = True
    root["appearance_variants"] = ["uniform-a", "uniform-b", "uniform-c"]
    armature, _ = create_armature("ZombieSharedRig", root)
    limb("Zombie_Torso", armature, "Spine", (0, 0, 1.23), (.72, .5, .92), fabric)
    limb("Zombie_Head", armature, "Head", (0, 0, 1.96), (.43, .43, .5), skin)
    limb("Zombie_Arm_L", armature, "Arm_L", (-.5, 0, 1.3), (.2, .22, .82), skin)
    limb("Zombie_Arm_R", armature, "Arm_R", (.5, 0, 1.3), (.2, .22, .82), skin)
    limb("Zombie_Leg_L", armature, "Root", (-.22, 0, .42), (.24, .27, .92), fabric)
    limb("Zombie_Leg_R", armature, "Root", (.22, 0, .42), (.24, .27, .92), fabric)
    limb("Zombie_Stain", armature, "Spine", (0, -.265, 1.3), (.34, .025, .34), blood, False)
    animate_pose(armature, "Idle", [(1, {"Spine": (0, 0, 0), "Head": (0, 0, 0)}), (30, {"Spine": (.04, 0, .02), "Head": (-.03, .08, 0)}), (60, {"Spine": (0, 0, 0), "Head": (0, 0, 0)})])
    animate_pose(armature, "Patrol", [(1, {"Arm_L": (.28, 0, 0), "Arm_R": (-.28, 0, 0), "Spine": (0, 0, .03)}), (18, {"Arm_L": (-.24, 0, 0), "Arm_R": (.24, 0, 0), "Spine": (0, 0, -.03)}), (36, {"Arm_L": (.28, 0, 0), "Arm_R": (-.28, 0, 0), "Spine": (0, 0, .03)})])
    animate_pose(armature, "Investigate", [(1, {"Head": (0, -.32, .08), "Spine": (.12, 0, 0)}), (36, {"Head": (.04, .28, -.08), "Spine": (.06, 0, 0)}), (72, {"Head": (0, -.32, .08), "Spine": (.12, 0, 0)})])
    animate_pose(armature, "Search", [(1, {"Head": (.08, -.5, 0), "Arm_L": (.38, 0, .12)}), (36, {"Head": (.08, .5, 0), "Arm_R": (.38, 0, -.12)}), (72, {"Head": (.08, -.5, 0), "Arm_L": (.38, 0, .12)})])
    animate_pose(armature, "Chase", [(1, {"Spine": (.22, 0, 0), "Arm_L": (.74, 0, .1), "Arm_R": (.55, 0, -.1)}), (14, {"Spine": (.18, 0, 0), "Arm_L": (-.18, 0, 0), "Arm_R": (-.22, 0, 0)}), (28, {"Spine": (.22, 0, 0), "Arm_L": (.74, 0, .1), "Arm_R": (.55, 0, -.1)})])
    animate_pose(armature, "Capture", [(1, {"Spine": (.35, 0, 0), "Arm_L": (1.25, 0, .18), "Arm_R": (1.25, 0, -.18)}), (20, {"Spine": (.45, 0, 0), "Arm_L": (1.45, 0, .22), "Arm_R": (1.45, 0, -.22)}), (40, {"Spine": (.35, 0, 0), "Arm_L": (1.25, 0, .18), "Arm_R": (1.25, 0, -.18)})])
    return root


def create_archive_character() -> bpy.types.Object:
    coat = material("PBR_Rooftop_Character_Coat", (.075, .09, .12, 1), .64, .05)
    skin = material("PBR_Rooftop_Character_NeutralSkin", (.34, .27, .22, 1), .84)
    hair = material("PBR_Rooftop_Character_Hair", (.018, .016, .02, 1), .59)
    root = empty("character.namra.rooftop")
    root["replacement_status"] = "REPLACEABLE_CHARACTER_ART_REVIEW_REQUIRED"
    root["rights_safe"] = "faceless-original-archive-no-likeness"
    armature, _ = create_armature("NamraArchive_Rig", root)
    limb("NamraArchive_Torso", armature, "Spine", (0, 0, 1.22), (.68, .44, .98), coat)
    limb("NamraArchive_Head", armature, "Head", (0, 0, 1.98), (.40, .38, .47), skin)
    limb("NamraArchive_HairCap", armature, "Head", (0, -.08, 2.1), (.46, .22, .34), hair)
    limb("NamraArchive_Arm_L", armature, "Arm_L", (-.47, 0, 1.3), (.18, .2, .8), coat)
    limb("NamraArchive_Arm_R", armature, "Arm_R", (.47, 0, 1.3), (.18, .2, .8), coat)
    limb("NamraArchive_Leg_L", armature, "Root", (-.2, 0, .42), (.23, .25, .92), coat)
    limb("NamraArchive_Leg_R", armature, "Root", (.2, 0, .42), (.23, .25, .92), coat)
    animate_pose(armature, "Neutral", [(1, {"Spine": (0, 0, 0), "Head": (0, 0, 0)}), (56, {"Spine": (.025, 0, 0), "Head": (-.02, .04, 0)}), (112, {"Spine": (0, 0, 0), "Head": (0, 0, 0)})])
    animate_pose(armature, "Recognition", [(1, {"Head": (0, .12, 0), "Spine": (0, 0, 0)}), (42, {"Head": (-.12, .38, 0), "Spine": (-.06, 0, .02)}), (84, {"Head": (-.08, .52, 0), "Spine": (-.08, 0, .04)})])
    animate_pose(armature, "Subdue", [(1, {"Spine": (-.1, 0, 0), "Arm_L": (.24, 0, 0), "Arm_R": (.24, 0, 0)}), (30, {"Spine": (.32, 0, 0), "Arm_L": (1.15, 0, .18), "Arm_R": (1.15, 0, -.18)}), (60, {"Spine": (.22, 0, 0), "Arm_L": (.92, 0, .14), "Arm_R": (.92, 0, -.14)})])
    return root


def select_tree(root: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    stack = [root]
    while stack:
        current = stack.pop()
        current.select_set(True)
        stack.extend(current.children)
    bpy.context.view_layer.objects.active = root


def export(root: bpy.types.Object, filename: str, animations: bool = False) -> None:
    select_tree(root)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT / filename),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_materials="EXPORT",
        export_lights=False,
        export_cameras=False,
        export_extras=True,
        export_animations=animations,
        export_animation_mode="ACTIONS" if animations else "ACTIVE_ACTIONS",
        export_force_sampling=True,
        export_optimize_animation_size=True,
    )


def main() -> None:
    clean()
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    environment = create_environment()
    export(environment, "two-chapter-route.glb")
    clean()
    zombie = create_zombie()
    export(zombie, "zombie-shared-rig.glb", True)
    clean()
    character = create_archive_character()
    export(character, "character-namra-rooftop.glb", True)
    manifest = {
        "schema": 1,
        "build_id": "last-bell-campaign-3d-v1",
        "status": "REPLACEABLE_CHARACTER_ART_REVIEW_REQUIRED",
        "delivery_role": "dcc-source-archive-not-streamed-runtime",
        "rights": {
            "source": "original authored Blender geometry and PBR parameters",
            "contains_actor_likeness": False,
            "replaceable_character_seam": "character.namra.rooftop",
        },
        "assets": {
            "route": "two-chapter-route.glb",
            "zombie": "zombie-shared-rig.glb",
            "character": "character-namra-rooftop.glb",
        },
        "budget": {
            "total_transfer_hard_cap_bytes": 5500000,
            "max_live_zombies": 2,
            "route_lod": "Zone_* with LOD0_* foreground detail and LOD1_* silhouette",
            "collision": "COL_* nodes; simulation owns authoritative walkability",
        },
    }
    (OUT / "campaign-asset-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
