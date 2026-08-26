#!/usr/bin/env python3
"""Build compact, authored Last Bell route environment props in Blender.

Every delivery source is original geometry plus compact generated PBR maps.
No drama frame, actor, logo, readable text, or generated lookdev pixels are
embedded.  The result remains an integration-neutral stage asset kit.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def cli_paths() -> tuple[Path, Path, Path]:
    separator = sys.argv.index("--")
    return tuple(Path(value).resolve() for value in sys.argv[separator + 1:separator + 4])  # type: ignore[return-value]


OUTPUT, CATALOG_PATH, STAGE = cli_paths()
RAW = OUTPUT / "raw"
RENDERS = OUTPUT / "renders"
PBR_DIR = RAW / "prop-pbr"
CATALOG = json.loads(CATALOG_PATH.read_text())
for directory in (RAW, RENDERS, PBR_DIR, STAGE):
    directory.mkdir(parents=True, exist_ok=True)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            try:
                datablocks.remove(block)
            except RuntimeError:
                pass


def tag(obj: bpy.types.Object, semantic_id: str, **extras: object) -> bpy.types.Object:
    obj["semantic_id"] = semantic_id
    for key, value in extras.items():
        obj[key] = value
    return obj


def ensure_uv(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        return
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    if "LightmapUV" not in mesh.uv_layers:
        source = mesh.uv_layers.active or mesh.uv_layers[0]
        target = mesh.uv_layers.new(name="LightmapUV")
        for index, value in enumerate(source.data):
            target.data[index].uv = (value.uv.x * .47 + .03, value.uv.y * .47 + .03)
    obj["uv0"] = "authored-pbr"
    obj["uv1"] = "lightmap-ready"


def finish(obj: bpy.types.Object, bevel: float = .015, smooth: bool = False) -> bpy.types.Object:
    if bevel:
        modifier = obj.modifiers.new("Edge_Bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    ensure_uv(obj)
    return obj


PALETTES = {
    "wood": (0.23, 0.13, 0.065),
    "paint": (0.075, 0.11, 0.13),
    "steel": (0.22, 0.28, 0.30),
    "white-steel": (0.42, 0.46, 0.43),
    "concrete": (0.24, 0.25, 0.25),
    "brick": (0.31, 0.075, 0.040),
    "plaster": (0.36, 0.33, 0.27),
    "roof": (0.12, 0.18, 0.20),
    "char": (0.026, 0.022, 0.018),
    "ember": (0.82, 0.12, 0.015),
    "glass": (0.44, 0.66, 0.66),
}


def authored_map(source: str, slot: str, path: Path) -> None:
    size = 160
    image = bpy.data.images.new(f"{source}-{slot}", width=size, height=size, alpha=True)
    pixels = [0.0] * (size * size * 4)
    base = PALETTES[source]
    is_metal = source in {"steel", "white-steel", "roof"}
    is_rough = source in {"concrete", "brick", "plaster", "wood", "char"}
    for y in range(size):
        for x in range(size):
            index = (y * size + x) * 4
            grain = math.sin(x * .17 + y * .09) * .026 + math.sin(x * .73 - y * .31) * .014
            if source == "wood":
                grain += math.sin(x * .075 + math.sin(y * .15) * 2.5) * .075
            elif source == "brick":
                grain += (.07 if (x // 28 + y // 19) % 2 else -.025) + math.sin(x * .51) * .02
            elif source in {"concrete", "plaster"}:
                grain += math.sin(x * 1.27 + y * 1.79) * .038
            elif is_metal:
                grain += math.sin(x * 1.1) * .028
            elif source == "ember":
                grain += math.sin(x * .38 + y * .66) * .09
            if slot == "basecolor":
                pixels[index:index + 4] = [max(0.0, min(1.0, channel + grain)) for channel in base] + [1.0]
            elif slot == "normal":
                pixels[index:index + 4] = [0.5 + grain * .9, 0.5 + math.sin(y * .42) * .035, 1.0, 1.0]
            else:
                roughness = .29 if is_metal else (.45 if source == "ember" else (.63 if source == "glass" else .78 if is_rough else .56))
                pixels[index:index + 4] = [.92, max(.05, min(.98, roughness + abs(grain) * .45)), .76 if is_metal else .0, 1.0]
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def texture_set(source: str) -> dict[str, bpy.types.Image]:
    images: dict[str, bpy.types.Image] = {}
    for slot in ("basecolor", "normal", "orm"):
        path = PBR_DIR / f"{source}-{slot}-160.png"
        if not path.exists():
            authored_map(source, slot, path)
        images[slot] = bpy.data.images.load(str(path), check_existing=True)
    images["basecolor"].colorspace_settings.name = "sRGB"
    images["normal"].colorspace_settings.name = "Non-Color"
    images["orm"].colorspace_settings.name = "Non-Color"
    return images


def material(name: str, source: str, metallic: float = 0.0, roughness: float = .6, emission: bool = False) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    nodes, links = result.node_tree.nodes, result.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    assert bsdf is not None
    textures = texture_set(source)
    base = nodes.new("ShaderNodeTexImage")
    base.image = textures["basecolor"]
    orm = nodes.new("ShaderNodeTexImage")
    orm.image = textures["orm"]
    normal = nodes.new("ShaderNodeTexImage")
    normal.image = textures["normal"]
    separate = nodes.new("ShaderNodeSeparateColor")
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(orm.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(separate.outputs["Blue"], bsdf.inputs["Metallic"])
    links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (1.0, .12, .01, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 2.1
    result["asset_quality"] = "authored-pbr-textured"
    result["pbr_source"] = f"original authored {source} delivery maps"
    return result


def materials() -> dict[str, bpy.types.Material]:
    return {
        "wood": material("Worn_Wood", "wood", .0, .68),
        "paint": material("Painted_Steel", "paint", .35, .48),
        "steel": material("Brushed_Steel", "steel", .84, .31),
        "white": material("Chipped_White_Steel", "white-steel", .72, .42),
        "concrete": material("Broken_Concrete", "concrete", .0, .84),
        "brick": material("Exposed_Brick", "brick", .0, .88),
        "plaster": material("Broken_Plaster", "plaster", .0, .81),
        "roof": material("Rooftop_Enamel", "roof", .72, .36),
        "char": material("Charred_Wood", "char", .0, .83),
        "ember": material("Campfire_Ember", "ember", .0, .42, emission=True),
        "glass": material("Fluorescent_Glass", "glass", .12, .23),
    }


def empty(name: str, parent: bpy.types.Object | None, semantic: str, **extras: object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return tag(obj, semantic, **extras)


def box(name: str, parent: bpy.types.Object, location: tuple[float, float, float], size: tuple[float, float, float], mat: bpy.types.Material, semantic: str, bevel: float = .02, rotation: tuple[float, float, float] = (0, 0, 0), **extras: object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    tag(obj, semantic, **extras)
    return finish(obj, bevel)


def cylinder(name: str, parent: bpy.types.Object, location: tuple[float, float, float], radius: float, depth: float, mat: bpy.types.Material, semantic: str, rotation: tuple[float, float, float] = (0, 0, 0), vertices: int = 14, **extras: object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    tag(obj, semantic, **extras)
    return finish(obj, min(.02, radius * .16), smooth=True)


def torus(name: str, parent: bpy.types.Object, location: tuple[float, float, float], major: float, minor: float, mat: bpy.types.Material, semantic: str, rotation: tuple[float, float, float] = (0, 0, 0), **extras: object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=16, minor_segments=6, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    tag(obj, semantic, **extras)
    return finish(obj, 0, smooth=True)


def curve(name: str, parent: bpy.types.Object, points: list[tuple[float, float, float]], mat: bpy.types.Material, semantic: str, radius: float = .018, **extras: object) -> bpy.types.Object:
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = radius
    data.bevel_resolution = 2
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, value in zip(spline.bezier_points, points):
        point.co = value
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = parent
    tag(obj, semantic, **extras)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return finish(obj, 0, smooth=True)


def prism(name: str, parent: bpy.types.Object, location: tuple[float, float, float], size: tuple[float, float, float], mat: bpy.types.Material, semantic: str, skew: float = .12, **extras: object) -> bpy.types.Object:
    sx, sy, sz = (value / 2 for value in size)
    vertices = [
        (-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
        (-sx + skew, -sy, sz), (sx - skew, -sy, sz * .78), (sx + skew, sy, sz), (-sx - skew, sy, sz * .72),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat)
    obj.parent = parent
    tag(obj, semantic, **extras)
    return finish(obj, .018)


def desk_chair(root: bpy.types.Object, mat: dict[str, bpy.types.Material]) -> None:
    box("Desk_Top", root, (-.28, 0, 1.08), (1.42, .72, .105), mat["wood"], "desk.top", .035)
    box("Desk_Chip", root, (.37, -.32, 1.045), (.34, .11, .07), mat["plaster"], "desk.chipped-edge", .01, rotation=(0, .19, 0))
    for x in (-.82, .22):
        for y in (-.27, .27):
            cylinder("Desk_Leg", root, (x, y, .52), .035, 1.02, mat["steel"], "desk.leg", vertices=12)
    box("Desk_Modesty", root, (-.28, .29, .74), (1.16, .04, .34), mat["paint"], "desk.modesty-panel", .012)
    curve("Desk_Crossbar", root, [(-.82, .22, .42), (-.28, .22, .39), (.22, .22, .42)], mat["steel"], "desk.crossbar", .025)
    box("Chair_Seat", root, (.78, .10, .57), (.66, .62, .09), mat["wood"], "chair.seat", .028, rotation=(0, 0, -.08))
    box("Chair_Back", root, (.88, .38, 1.05), (.60, .085, .52), mat["wood"], "chair.back", .028, rotation=(.12, 0, -.08))
    for x in (.52, 1.05):
        for y in (-.12, .33):
            cylinder("Chair_Leg", root, (x, y, .30), .028, .58, mat["steel"], "chair.leg", vertices=12)
    curve("Chair_Frame", root, [(.52, -.12, .55), (.52, .33, .50), (.88, .38, 1.18)], mat["steel"], "chair.frame", .027)


def locker_bank(root: bpy.types.Object, mat: dict[str, bpy.types.Material]) -> None:
    box("Locker_Carcass", root, (0, .08, 1.18), (2.34, .50, 2.30), mat["paint"], "locker.carcass", .045)
    for row in range(2):
        for column in range(3):
            x = - .72 + column * .72
            z = .62 + row * 1.12
            box(f"Locker_Door_{row}_{column}", root, (x, -.205, z), (.62, .055, 1.00), mat["white"], "locker.door", .024, rotation=(0, 0, (column - 1) * .018))
            box(f"Locker_Handle_{row}_{column}", root, (x + .19, -.245, z), (.045, .028, .18), mat["steel"], "locker.handle", .009)
            for vent in range(3):
                box(f"Locker_Vent_{row}_{column}_{vent}", root, (x - .08 + vent * .08, -.244, z + .28), (.042, .008, .13), mat["char"], "locker.vent", .003)
    box("Locker_Base", root, (0, .08, .08), (2.43, .58, .16), mat["steel"], "locker.base", .016)
    prism("Locker_Dent", root, (.60, -.25, 1.82), (.24, .035, .19), mat["paint"], "locker.dent", .06)


def fluorescent(root: bpy.types.Object, mat: dict[str, bpy.types.Material]) -> None:
    box("Fluorescent_Backplate", root, (0, 0, .20), (2.18, .42, .10), mat["white"], "fluorescent.backplate", .025)
    box("Fluorescent_Frame_Left", root, (-1.0, 0, .08), (.10, .38, .13), mat["steel"], "fluorescent.frame", .012)
    box("Fluorescent_Frame_Right", root, (1.0, 0, .08), (.10, .38, .13), mat["steel"], "fluorescent.frame", .012)
    cylinder("Fluorescent_Tube_Intact", root, (-.42, -.11, .04), .062, 1.10, mat["glass"], "fluorescent.tube", rotation=(0, math.pi / 2, 0), vertices=16)
    cylinder("Fluorescent_Tube_Broken_A", root, (.45, -.11, .04), .062, .43, mat["glass"], "fluorescent.broken-tube", rotation=(0, math.pi / 2, 0), vertices=16)
    cylinder("Fluorescent_Tube_Broken_B", root, (.85, -.11, .04), .062, .22, mat["glass"], "fluorescent.broken-tube", rotation=(0, math.pi / 2, 0), vertices=16)
    for index, x in enumerate((.18, .30, .65)):
        prism(f"Fluorescent_Shard_{index}", root, (x, -.13, -.08 - index * .04), (.12, .025, .055), mat["glass"], "fluorescent.shard", .025)
    curve("Fluorescent_Wire", root, [(.94, .10, .06), (1.16, .14, -.28), (1.05, -.02, -.51)], mat["char"], "fluorescent.dangling-wire", .012)


def debris(root: bpy.types.Object, mat: dict[str, bpy.types.Material]) -> None:
    fragments = [
        ((-.70, -.28, .18), (.62, .44, .32), "concrete", .10),
        ((-.18, .18, .13), (.48, .38, .25), "brick", .08),
        ((.35, -.12, .19), (.58, .45, .33), "plaster", .15),
        ((.76, .24, .12), (.32, .30, .21), "brick", .05),
        ((.18, .43, .09), (.36, .27, .17), "concrete", .07),
    ]
    for index, (location, size, source, skew) in enumerate(fragments):
        prism(f"Debris_Fragment_{index}", root, location, size, mat[source], "debris.fragment", skew)
    for index, (x, y) in enumerate(((-.5, .22), (-.1, -.40), (.52, .05))):
        box(f"Debris_Brick_{index}", root, (x, y, .09), (.33, .16, .12), mat["brick"], "debris.brick", .012, rotation=(.06, .14 * index, .18 * index))
    curve("Debris_Rebar_A", root, [(-.68, -.25, .32), (-.15, -.12, .48), (.28, .14, .29)], mat["steel"], "debris.rebar", .017)
    curve("Debris_Rebar_B", root, [(.10, -.28, .28), (.48, -.12, .45), (.76, -.02, .24)], mat["steel"], "debris.rebar", .015)


def rooftop_hvac(root: bpy.types.Object, mat: dict[str, bpy.types.Material]) -> None:
    box("HVAC_Base", root, (-.22, 0, .16), (1.80, 1.22, .22), mat["concrete"], "hvac.base", .035)
    box("HVAC_Cabinet", root, (-.22, 0, .91), (1.56, 1.06, 1.30), mat["roof"], "hvac.cabinet", .055)
    box("HVAC_Top", root, (-.22, 0, 1.59), (1.70, 1.18, .13), mat["steel"], "hvac.top", .028)
    torus("HVAC_Fan_Grille", root, (-.22, -.56, 1.02), .33, .022, mat["steel"], "hvac.fan-grille", rotation=(math.pi / 2, 0, 0))
    for angle in (0, math.pi / 3, math.pi * 2 / 3):
        box("HVAC_Fan_Blade", root, (-.22, -.58, 1.02), (.52, .025, .055), mat["steel"], "hvac.fan-blade", .008, rotation=(0, angle, 0))
    for index in range(5):
        box(f"HVAC_Side_Slat_{index}", root, (.59, -.56, .55 + index * .17), (.52, .022, .055), mat["steel"], "hvac.vent-slat", .006)
    cylinder("HVAC_Duct", root, (.95, .16, .86), .22, .82, mat["steel"], "hvac.duct", rotation=(0, math.pi / 2, 0), vertices=16)
    for x in (-.88, .45):
        for y in (-.47, .47):
            box("HVAC_Foot", root, (x, y, .35), (.12, .12, .38), mat["steel"], "hvac.foot", .012)


def campfire(root: bpy.types.Object, mat: dict[str, bpy.types.Material]) -> None:
    for index, angle in enumerate((.22, 1.79, 3.35, 4.92)):
        x, y = math.cos(angle) * .44, math.sin(angle) * .44
        cylinder(f"Campfire_Stone_{index}", root, (x, y, .10), .18, .19, mat["concrete"], "campfire.stone", vertices=10)
    for index, angle in enumerate((.45, -.48, .45)):
        cylinder(f"Campfire_Log_{index}", root, (0, 0, .20 + index * .09), .105, 1.05 - index * .12, mat["char"], "campfire.log", rotation=(0, math.pi / 2, angle), vertices=12)
    cylinder("Campfire_Ember_Bed", root, (0, 0, .27), .28, .07, mat["ember"], "campfire.ember-bed", vertices=16)
    for index, (x, y, scale) in enumerate(((0, 0, .34), (.12, .03, .23), (-.10, -.04, .20))):
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=scale * .46, radius2=.025, depth=scale, location=(x, y, .33 + scale / 2))
        flame = bpy.context.object
        flame.name = f"Campfire_Flame_{index}"
        flame.data.materials.append(mat["ember"])
        flame.parent = root
        tag(flame, "campfire.flame", stylized_fire=True)
        finish(flame, .012, smooth=True)


BUILDERS = {
    "classroom-desk-chair": desk_chair,
    "locker-bank": locker_bank,
    "broken-fluorescent": fluorescent,
    "debris-cluster": debris,
    "rooftop-hvac": rooftop_hvac,
    "campfire-kit": campfire,
}


def add_contract(root: bpy.types.Object, prop: dict[str, object], mat: dict[str, bpy.types.Material]) -> None:
    bounds = tuple(float(value) for value in prop["collision_m"])
    key = str(prop["key"])
    lod = empty("LOD1_Shelf", root, f"lod1.{key}", lod_level=1, runtime_visibility="opt-in")
    low = box("Shelf_Silhouette", lod, (0, .70, max(bounds[2] / 2, .20)), tuple(value * .72 for value in bounds), mat["paint"], f"lod1.{key}.silhouette", .025, lod_level=1)
    low.hide_render = True
    collider = box("COL_Environment", root, (0, .70, max(bounds[2] / 2, .20)), bounds, mat["char"], f"collision.{key}", 0, collision_proxy=True, physics="query-only")
    collider.hide_render = True
    anchor = empty("Anchor_Environment", root, str(prop["anchor"]), prop_key=key, interaction="environment", collision_node="COL_Environment")
    anchor.location = (0, 0, 0)


def export(root: bpy.types.Object, key: str) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for obj in bpy.context.scene.objects:
        ancestor = obj.parent
        while ancestor is not None and ancestor != root:
            ancestor = ancestor.parent
        if ancestor == root:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(RAW / f"{key}.raw.glb"), export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_extras=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False,
    )


def point(camera: bpy.types.Object, target: tuple[float, float, float]) -> None:
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def render(root: bpy.types.Object, key: str) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (.008, .011, .014)
    for obj in scene.objects:
        if obj.name.startswith("COL_") or obj.name == "LOD1_Shelf" or (obj.parent and obj.parent.name == "LOD1_Shelf"):
            obj.hide_render = True
    for location, energy, color, size in (((3.6, -4.2, 4.8), 980, (1.0, .93, .83), 4.0), ((-3.2, -2.1, 3.0), 350, (.20, .64, .72), 3.0)):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy = energy
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = size
        point(light, (0, 0, .70))
    bpy.ops.object.camera_add(location=(3.1, -4.6, 2.8))
    camera = bpy.context.object
    camera.data.lens = 52
    point(camera, (0, 0, .75))
    scene.camera = camera
    scene.render.filepath = str(RENDERS / f"{key}.png")
    bpy.ops.render.render(write_still=True)


def main() -> None:
    for prop in CATALOG["props"]:
        clear_scene()
        mat = materials()
        key = str(prop["key"])
        root = empty("LOD0_Hero", None, f"environment.{key}", prop_key=key, lod_level=0, authored_in="Blender 5.2")
        BUILDERS[key](root, mat)
        add_contract(root, prop, mat)
        export(root, key)
        render(root, key)
        print(f"authored {key}", flush=True)


if __name__ == "__main__":
    main()
