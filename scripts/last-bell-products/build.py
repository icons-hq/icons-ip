#!/usr/bin/env python3
"""Author and render the ten Last Bell product assets in Blender.

This source deliberately creates original product geometry and authored CC0 PBR
materials. It never projects generated lookdev, a drama frame, an actor, or
text onto the shipping meshes.  The small `GraphicLayer_*` meshes are blank,
replaceable print surfaces described by a sibling SVG contract.
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
    output = Path(sys.argv[separator + 1]).resolve()
    catalog = Path(sys.argv[separator + 2]).resolve()
    public = Path(sys.argv[separator + 3]).resolve()
    return output, catalog, public


OUTPUT, CATALOG_PATH, PUBLIC_ROOT = cli_paths()
RAW = OUTPUT / "raw"
RENDERS = OUTPUT / "renders"
REPO_ROOT = Path(__file__).resolve().parents[2]
PBR_DIR = REPO_ROOT / "outputs" / "last-bell-3d" / "raw" / "polyhaven-pbr"
DELIVERY_PBR_DIR = RAW / "product-pbr"
DELIVERY_TEXTURE_SIZE = 160
DELIVERY_TEXTURE_VERSION = "v6-final-candidate"
# Product surfaces deliberately use material-specific authored PBR triplets.
# They are compact delivery maps, not a universal weathered-plaster overlay.
PBR_SOURCES = {
    "graphite": "graphite-polymer",
    "navy": "navy-woven-fabric",
    "nickel": "brushed-nickel",
    "smoke": "smoked-polycarbonate",
    "paper": "uncoated-cardstock",
    "teal": "teal-enamel",
    "olive": "olive-canvas",
    "ivory": "ivory-cardstock",
    "silver": "thermal-silver",
    "wax": "amber-wax",
    "black": "black-rubber",
    "graphic": "replaceable-print-stock",
    "photo": "satin-photo-stock",
    "orange": "signal-plastic",
}
MATERIAL_PROFILES = {
    # Base colour is authored in these maps.  The Blender material applies no
    # second dark tint, which keeps physically different material families
    # readable in both the studio and a cold gameplay flashlight.
    "graphite-polymer": {"kind": "plastic", "base": (.12, .145, .165), "roughness": .46, "metallic": .0, "scale": (4.0, 4.0, 4.0)},
    "navy-woven-fabric": {"kind": "woven", "base": (.035, .085, .20), "roughness": .74, "metallic": .0, "scale": (5.5, 5.5, 5.5)},
    "brushed-nickel": {"kind": "metal", "base": (.48, .53, .56), "roughness": .29, "metallic": .95, "scale": (3.2, 4.5, 3.2)},
    "smoked-polycarbonate": {"kind": "polycarbonate", "base": (.055, .073, .085), "roughness": .16, "metallic": .0, "scale": (2.4, 2.4, 2.4)},
    "uncoated-cardstock": {"kind": "paper", "base": (.52, .47, .37), "roughness": .83, "metallic": .0, "scale": (3.5, 3.5, 3.5)},
    "teal-enamel": {"kind": "enamel", "base": (.025, .33, .35), "roughness": .33, "metallic": .0, "scale": (3.4, 3.4, 3.4)},
    "olive-canvas": {"kind": "woven", "base": (.14, .205, .072), "roughness": .79, "metallic": .0, "scale": (5.0, 5.0, 5.0)},
    "ivory-cardstock": {"kind": "paper", "base": (.72, .68, .56), "roughness": .72, "metallic": .0, "scale": (3.2, 3.2, 3.2)},
    "thermal-silver": {"kind": "foil", "base": (.55, .59, .61), "roughness": .40, "metallic": .91, "scale": (4.6, 4.6, 4.6)},
    "amber-wax": {"kind": "wax", "base": (.62, .18, .035), "roughness": .38, "metallic": .0, "scale": (2.6, 2.6, 2.6)},
    "black-rubber": {"kind": "rubber", "base": (.015, .020, .022), "roughness": .80, "metallic": .0, "scale": (4.5, 4.5, 4.5)},
    "replaceable-print-stock": {"kind": "paper", "base": (.73, .78, .72), "roughness": .76, "metallic": .0, "scale": (3.0, 3.0, 3.0)},
    "satin-photo-stock": {"kind": "paper", "base": (.57, .66, .61), "roughness": .58, "metallic": .0, "scale": (3.0, 3.0, 3.0)},
    "signal-plastic": {"kind": "plastic", "base": (.72, .09, .016), "roughness": .43, "metallic": .0, "scale": (4.0, 4.0, 4.0)},
}
RAW.mkdir(parents=True, exist_ok=True)
RENDERS.mkdir(parents=True, exist_ok=True)
DELIVERY_PBR_DIR.mkdir(parents=True, exist_ok=True)
CATALOG = json.loads(CATALOG_PATH.read_text())


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            try:
                datablocks.remove(block)
            except RuntimeError:
                pass


def metadata(obj: bpy.types.Object, semantic_id: str, **extras: object) -> bpy.types.Object:
    obj["semantic_id"] = semantic_id
    for key, value in extras.items():
        obj[key] = value
    return obj


def texture_triplet(source: str) -> dict[str, bpy.types.Image]:
    """Make a small, delivery-local copy of a CC0 PBR triplet.

    The source maps are intentionally high resolution for the route assets.
    Each collectible is only viewed at close thumbnail scale, so a 160px copy
    preserves normal/roughness variation while keeping the ten-item shelf pack
    below its 4MiB streamed-transfer budget.  This does not alter the source
    map or replace it with a flat colour/material fallback.
    """
    result: dict[str, bpy.types.Image] = {}
    for slot in ("basecolor", "normal", "orm"):
        delivery_path = DELIVERY_PBR_DIR / f"{source}-{DELIVERY_TEXTURE_VERSION}-{slot}-{DELIVERY_TEXTURE_SIZE}.png"
        if not delivery_path.exists():
            authored_product_texture(source, slot, delivery_path)
        result[slot] = bpy.data.images.load(str(delivery_path), check_existing=True)
    result["basecolor"].colorspace_settings.name = "sRGB"
    result["normal"].colorspace_settings.name = "Non-Color"
    result["orm"].colorspace_settings.name = "Non-Color"
    return result


def clamp(value: float, low: float = .0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def noise_hash(x: int, y: int, seed: float) -> float:
    value = math.sin(x * 127.1 + y * 311.7 + seed * 91.13) * 43758.5453123
    return value - math.floor(value)


def smooth_noise(x: float, y: float, seed: float) -> float:
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    sx, sy = fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy)
    a, b = noise_hash(ix, iy, seed), noise_hash(ix + 1, iy, seed)
    c, d = noise_hash(ix, iy + 1, seed), noise_hash(ix + 1, iy + 1, seed)
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy


def authored_product_texture(source: str, slot: str, path: Path) -> None:
    """Bake an original, material-specific physical map for delivery.

    Every material class has its own restrained base, roughness and normal
    response. This deliberately avoids a universal diagonal pattern being used
    as a substitute for material definition. Maps contain no frame, logo,
    actor, lookdev-board pixels, or shared source imagery.
    """
    profile = MATERIAL_PROFILES[source]
    kind = str(profile["kind"])
    color = tuple(float(value) for value in profile["base"])
    base_roughness = float(profile["roughness"])
    metallic = float(profile["metallic"])
    texel_scale = float(profile["scale"][0]) / 3.5
    size = DELIVERY_TEXTURE_SIZE
    image = bpy.data.images.new(f"{source}-{slot}", width=size, height=size, alpha=True)
    pixels = [0.0] * (size * size * 4)
    seed = sum(ord(character) for character in source) * .071
    for y in range(size):
        for x in range(size):
            index = (y * size + x) * 4
            low = smooth_noise(x * texel_scale / 36.0, y * texel_scale / 36.0, seed) - .5
            mid = smooth_noise(x * texel_scale / 9.0, y * texel_scale / 9.0, seed + 1.7) - .5
            micro = smooth_noise(x * texel_scale * .72, y * texel_scale * .72, seed + 3.4) - .5
            detail = low * .020 + mid * .012 + micro * .006
            normal_x, normal_y = micro * .035, mid * .024
            roughness = base_roughness + low * .055 + mid * .025
            if kind == "woven":
                warp_period = max(4, round(10 / texel_scale))
                weft_period = max(4, round(12 / texel_scale))
                warp = .014 if (x % warp_period) in (1, 2) else -.004
                weft = .011 if (y % weft_period) in (2, 3) else -.003
                detail += warp + weft
                normal_x += warp * 1.45
                normal_y += weft * 1.25
                roughness += .055
            elif kind == "metal":
                brush = (smooth_noise(x * texel_scale * .18, math.floor(y * texel_scale / 5), seed + 5.1) - .5) * .026
                detail += brush
                normal_x += brush * .25
                roughness -= .035
            elif kind == "foil":
                crinkle = (smooth_noise(x * texel_scale / 3.8, y * texel_scale / 4.1, seed + 7.2) - .5) * .075
                ridge = (smooth_noise(x * texel_scale / 15.0, y * texel_scale / 12.0, seed + 8.4) - .5) * .045
                detail += crinkle + ridge
                normal_x += crinkle * .72
                normal_y += ridge * .70
                roughness += abs(crinkle) * 1.6
            elif kind == "paper":
                # Card fibre must not resolve as the same diagonal weave used
                # by fabric. At product-card resolution even subtle procedural
                # pulp may alias into diagonal moire, so paper gets a matte,
                # nearly flat map. Physical fibre is instead communicated by
                # the separately modelled duplex plies, deckle edges, folds,
                # and restrained high roughness.
                detail = 0.0
                normal_x, normal_y = 0.0, 0.0
                roughness = base_roughness + .040
            elif kind == "polycarbonate":
                haze = (smooth_noise(x * texel_scale / 18.0, y * texel_scale / 18.0, seed + 10.2) - .5) * .018
                detail += haze
                roughness -= .035
            elif kind == "enamel":
                orange_peel = (smooth_noise(x * texel_scale * 1.3, y * texel_scale * 1.3, seed + 11.3) - .5) * .015
                detail += orange_peel
                normal_x += orange_peel * .55
                normal_y += orange_peel * .55
                roughness -= .025
            elif kind == "wax":
                pool = (smooth_noise(x * texel_scale / 12.0, y * texel_scale / 12.0, seed + 12.4) - .5) * .045
                detail += pool
                normal_x += pool * .48
                normal_y += pool * .48
                roughness += abs(pool) * .45
            elif kind in ("plastic", "rubber"):
                grain = (smooth_noise(x * texel_scale * 1.55, y * texel_scale * 1.55, seed + 13.5) - .5) * (.009 if kind == "plastic" else .018)
                detail += grain
                normal_x += grain * .65
                normal_y += grain * .65
                roughness += .025 if kind == "rubber" else 0.0
            if slot == "basecolor":
                pixels[index:index + 4] = [clamp(channel + detail) for channel in color] + [1.0]
            elif slot == "normal":
                pixels[index:index + 4] = [clamp(.5 + normal_x), clamp(.5 + normal_y), 1.0, 1.0]
            else:
                pixels[index:index + 4] = [.96, clamp(roughness), metallic, 1.0]
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def material(name: str, color: tuple[float, float, float, float], metallic: float = 0.0, roughness: float = 0.5, source_key: str = "graphite") -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    nodes = result.node_tree.nodes
    links = result.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    assert bsdf is not None
    paper_without_raster = source_key in ("paper", "ivory", "graphic", "photo")
    if paper_without_raster:
        # KTX's 4x4 block texture sampler can alias as a diagonal fabric weave
        # on large printed planes. Matte paper is therefore a deliberately
        # plain physical shader; its authored fibre/deckle read is carried by
        # the separately modelled plies and edges, never a repeated raster.
        paper_profile = MATERIAL_PROFILES[PBR_SOURCES[source_key]]
        base_color = tuple(float(channel) for channel in paper_profile["base"])
        bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
        bsdf.inputs["Metallic"].default_value = float(paper_profile["metallic"])
        bsdf.inputs["Roughness"].default_value = float(paper_profile["roughness"])
        result["paper_finish"] = "matte physical shader with authored duplex edge geometry"
    else:
        images = texture_triplet(PBR_SOURCES[source_key])
        base = nodes.new("ShaderNodeTexImage")
        base.image = images["basecolor"]
        tint = nodes.new("ShaderNodeMixRGB")
        tint.blend_type = "MULTIPLY"
        tint.inputs[0].default_value = 1.0
        tint.inputs[2].default_value = color
        orm = nodes.new("ShaderNodeTexImage")
        orm.image = images["orm"]
        separate = nodes.new("ShaderNodeSeparateColor")
        normal = nodes.new("ShaderNodeTexImage")
        normal.image = images["normal"]
        normal_map = nodes.new("ShaderNodeNormalMap")
        links.new(base.outputs["Color"], tint.inputs[1])
        links.new(tint.outputs["Color"], bsdf.inputs["Base Color"])
        links.new(orm.outputs["Color"], separate.inputs["Color"])
        links.new(separate.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(separate.outputs["Blue"], bsdf.inputs["Metallic"])
        links.new(normal.outputs["Color"], normal_map.inputs["Color"])
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    if source_key in ("teal", "smoke") and bsdf.inputs.get("Coat Weight"):
        bsdf.inputs["Coat Weight"].default_value = .22
        bsdf.inputs["Coat Roughness"].default_value = .18
    if source_key == "wax":
        # The shallow subsurface response differentiates poured wax from both
        # the anodized tin and the replaceable paper label in the same shot.
        if bsdf.inputs.get("Subsurface Weight"):
            bsdf.inputs["Subsurface Weight"].default_value = .055
        if bsdf.inputs.get("Subsurface Radius"):
            bsdf.inputs["Subsurface Radius"].default_value = (.8, .28, .12)
    result["asset_quality"] = "authored-pbr-textured" if not paper_without_raster else "authored-matte-paper-with-geometry"
    result["pbr_source"] = f"Original authored delivery map: {PBR_SOURCES[source_key]}" if not paper_without_raster else "Matte paper shader plus authored fibre, deckle, and ply geometry"
    return result


def material_library() -> dict[str, bpy.types.Material]:
    return {
        "graphite": material("Graphite_Polymer", (1, 1, 1, 1), 0.0, .46, "graphite"),
        "navy": material("Woven_Navy", (1, 1, 1, 1), 0.0, .74, "navy"),
        "nickel": material("Brushed_Nickel", (1, 1, 1, 1), .95, .29, "nickel"),
        "smoke": material("Smoked_Polycarbonate", (1, 1, 1, 1), 0.0, .16, "smoke"),
        "paper": material("Uncoated_Cardstock", (1, 1, 1, 1), 0.0, .83, "paper"),
        "teal": material("Muted_Teal", (1, 1, 1, 1), 0.0, .33, "teal"),
        "olive": material("Woven_Olive", (1, 1, 1, 1), 0.0, .79, "olive"),
        "ivory": material("Dusty_Ivory", (1, 1, 1, 1), 0.0, .72, "ivory"),
        "silver": material("Thermal_Silver", (1, 1, 1, 1), .91, .40, "silver"),
        "wax": material("Amber_Wax", (1, 1, 1, 1), 0.0, .38, "wax"),
        "black": material("Soft_Black", (1, 1, 1, 1), 0.0, .80, "black"),
        "graphic": material("Replaceable_Graphic_Layer", (1, 1, 1, 1), 0.0, .76, "graphic"),
        "photo": material("Satin_Photo_Stock", (1, 1, 1, 1), 0.0, .58, "photo"),
        "orange": material("Signal_Orange", (1, 1, 1, 1), 0.0, .43, "orange"),
    }


def parented_empty(name: str, parent: bpy.types.Object | None, semantic_id: str, **extras: object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return metadata(obj, semantic_id, **extras)


def ensure_uv_layers(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        return
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    if "LightmapUV" not in mesh.uv_layers:
        source = mesh.uv_layers.active or mesh.uv_layers[0]
        target = mesh.uv_layers.new(name="LightmapUV")
        for index, value in enumerate(source.data):
            # Keep the lightmap channel semantically independent.  Exact UV0
            # copies are correctly deduplicated by glTF-Transform, which would
            # silently strip TEXCOORD_1 from the delivery GLB.
            target.data[index].uv = (value.uv.x * 0.5, value.uv.y * 0.5)
    obj["uv0"] = "pbr-authored"
    obj["uv1"] = "lightmap-ready"


def finish(obj: bpy.types.Object, bevel: float = 0.02, smooth: bool = False) -> bpy.types.Object:
    if bevel:
        modifier = obj.modifiers.new("Edge_Bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except RuntimeError:
            pass
        obj.select_set(False)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    ensure_uv_layers(obj)
    return obj


def box(name: str, parent: bpy.types.Object, location: tuple[float, float, float], size: tuple[float, float, float], mat: bpy.types.Material, semantic: str, bevel: float = 0.02, **extras: object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    metadata(obj, semantic, **extras)
    return finish(obj, bevel=bevel)


def cylinder(name: str, parent: bpy.types.Object, location: tuple[float, float, float], radius: float, depth: float, mat: bpy.types.Material, semantic: str, rotation: tuple[float, float, float] = (0, 0, 0), vertices: int = 16, **extras: object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    metadata(obj, semantic, **extras)
    return finish(obj, bevel=min(0.018, radius * 0.22), smooth=True)


def torus(name: str, parent: bpy.types.Object, location: tuple[float, float, float], major: float, minor: float, mat: bpy.types.Material, semantic: str, rotation: tuple[float, float, float] = (0, 0, 0), **extras: object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=16, minor_segments=6, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    metadata(obj, semantic, **extras)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return finish(obj, bevel=0.0, smooth=True)


def cloth_panel(name: str, parent: bpy.types.Object, location: tuple[float, float, float], width: float, height: float, material: bpy.types.Material, semantic: str, *, thickness: float = 0.055, shoulder_taper: float = 0.0, folds: float = 0.02, **extras: object) -> bpy.types.Object:
    """Author a sewn, softly folded cloth panel rather than a box proxy."""
    columns, rows = 9, 12
    vertices: list[tuple[float, float, float]] = []
    for row in range(rows):
        t = row / (rows - 1)
        row_width = width * (1.0 - shoulder_taper * t)
        for column in range(columns):
            u = column / (columns - 1)
            x = location[0] + (u - .5) * row_width
            z = location[2] + (t - .5) * height
            y = location[1] + math.sin(u * math.pi * 4.0 + t * 2.3) * folds + math.sin(t * math.pi) * folds * .65
            vertices.append((x, y, z))
    faces = []
    for row in range(rows - 1):
        for column in range(columns - 1):
            start = row * columns + column
            faces.append((start, start + 1, start + columns + 1, start + columns))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].index
            row, column = divmod(vertex, columns)
            uv.data[loop_index].uv = (column / (columns - 1), row / (rows - 1))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.parent = parent
    metadata(obj, semantic, authored_cloth=True, sewn_panel=True, **extras)
    solidify = obj.modifiers.new("Cloth_Thickness", "SOLIDIFY")
    solidify.thickness = thickness
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    obj.select_set(False)
    return finish(obj, bevel=0.012, smooth=True)


def cloth_tube(name: str, parent: bpy.types.Object, centers: list[tuple[float, float, float]], radii: list[tuple[float, float]], material: bpy.types.Material, semantic: str, **extras: object) -> bpy.types.Object:
    """A tapered closed cloth tube used for sleeves and pouch gussets."""
    sides = 14
    vertices: list[tuple[float, float, float]] = []
    for ring, (center, radius) in enumerate(zip(centers, radii)):
        for side in range(sides):
            theta = side * math.tau / sides
            vertices.append((center[0] + math.cos(theta) * radius[0], center[1] + math.sin(theta) * radius[1], center[2]))
    faces: list[tuple[int, ...]] = [tuple(range(sides - 1, -1, -1))]
    for ring in range(len(centers) - 1):
        for side in range(sides):
            next_side = (side + 1) % sides
            start = ring * sides + side
            faces.append((start, ring * sides + next_side, (ring + 1) * sides + next_side, (ring + 1) * sides + side))
    end = (len(centers) - 1) * sides
    faces.append(tuple(end + side for side in range(sides)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            index = mesh.vertices[mesh.loops[loop_index].vertex_index].index
            ring, side = divmod(index, sides)
            uv.data[loop_index].uv = (side / sides, ring / max(1, len(centers) - 1))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.parent = parent
    metadata(obj, semantic, authored_cloth=True, closed_mesh=True, **extras)
    return finish(obj, bevel=0.008, smooth=True)


def zipup_body_panel(name: str, parent: bpy.types.Object, side: int, y: float, material: bpy.types.Material, semantic: str) -> bpy.types.Object:
    """A shaped half-body with a real waist, shoulder slope, and neck opening.

    The half-panel construction keeps the zipper seam physically credible while
    avoiding the straight-sided, storage-box silhouette of a single cloth slab.
    """
    rows, columns = 9, 6
    row_profile = (
        (.29, .035, .47), (.46, .027, .50), (.66, .024, .51),
        (.90, .030, .50), (1.16, .038, .49), (1.38, .055, .47),
        (1.53, .105, .43), (1.62, .155, .35), (1.66, .205, .28),
    )
    vertices: list[tuple[float, float, float]] = []
    for row, (z, inner, outer) in enumerate(row_profile):
        for column in range(columns):
            u = column / (columns - 1)
            x = side * (inner + (outer - inner) * u)
            fullness = math.sin(u * math.pi) * (.040 + .018 * math.sin(row * .86))
            fold = math.sin(u * math.pi * 3.0 + row * .70) * .026
            vertices.append((x, y + fullness + fold, z))
    faces = []
    for row in range(rows - 1):
        for column in range(columns - 1):
            start = row * columns + column
            faces.append((start, start + 1, start + columns + 1, start + columns))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            index = mesh.vertices[mesh.loops[loop_index].vertex_index].index
            row, column = divmod(index, columns)
            uv.data[loop_index].uv = (column / (columns - 1), row / (rows - 1))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.parent = parent
    metadata(obj, semantic, authored_cloth=True, sewn_panel=True, shaped_garment_panel=True)
    solidify = obj.modifiers.new("Garment_Thickness", "SOLIDIFY")
    solidify.thickness = .068
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    obj.select_set(False)
    return finish(obj, bevel=.012, smooth=True)


def folded_blanket(name: str, parent: bpy.types.Object, location: tuple[float, float, float], material: bpy.types.Material, semantic: str) -> bpy.types.Object:
    """A compact, folded foil layer with a gently crimped but legible edge.

    A single wavy plane reads as an amorphous sea-creature in a product card.
    This helper is deliberately used in a stepped stack below: each layer
    keeps a clearly rectangular folded edge, while the surface only carries
    the small irregularities expected from a thermal foil blanket.
    """
    columns, rows = 16, 12
    width, depth = 1.18, .72
    vertices: list[tuple[float, float, float]] = []
    for row in range(rows):
        v = row / (rows - 1)
        for column in range(columns):
            u = column / (columns - 1)
            x = location[0] + (u - .5) * width
            y = location[1] + (v - .5) * depth
            fold = .012 * math.sin(u * math.pi * 4.0 + v * .8) + .008 * math.cos(v * math.pi * 3.0)
            edge = .010 * (abs(u - .5) * 2.0 + abs(v - .5) * 2.0)
            vertices.append((x, y, location[2] + fold + edge))
    faces = []
    for row in range(rows - 1):
        for column in range(columns - 1):
            start = row * columns + column
            faces.append((start, start + 1, start + columns + 1, start + columns))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            index = mesh.vertices[mesh.loops[loop_index].vertex_index].index
            row, column = divmod(index, columns)
            uv.data[loop_index].uv = (column / (columns - 1), row / (rows - 1))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.parent = parent
    metadata(obj, semantic, authored_cloth=True, folded_textile=True, hemmed=True)
    solidify = obj.modifiers.new("Blanket_Thickness", "SOLIDIFY")
    # A thermal blanket is thin when opened, but a folded emergency pack has
    # visible compressible volume. This keeps the layered silhouette from
    # reading as a stack of flat game cards.
    solidify.thickness = .052
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    obj.select_set(False)
    return finish(obj, bevel=.016, smooth=True)


def blanket_layer(name: str, parent: bpy.types.Object, location: tuple[float, float, float], width: float, depth: float, material: bpy.types.Material, semantic: str) -> bpy.types.Object:
    """Create a scale-specific folded-blanket layer without changing global helpers."""
    obj = folded_blanket(name, parent, location, material, semantic)
    obj.scale = (width / 1.18, depth / .72, 1.0)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.select_set(False)
    return obj


def foil_bundle_fold(name: str, parent: bpy.types.Object, location: tuple[float, float, float], width: float, depth: float, height: float, material: bpy.types.Material, semantic: str) -> bpy.types.Object:
    """A compressed, asymmetric foil fold with soft volume, not a hard board."""
    columns, rows = 15, 11
    vertices: list[tuple[float, float, float]] = []
    for row in range(rows):
        v = row / (rows - 1)
        for column in range(columns):
            u = column / (columns - 1)
            edge = abs(u - .5) * 2.0 + abs(v - .5) * 2.0
            crinkle = math.sin(u * math.pi * 5.0 + v * 1.7) * .032 + math.cos(v * math.pi * 3.0 - u) * .020
            dome = math.sin(u * math.pi) * math.sin(v * math.pi) * height
            vertices.append((location[0] + (u - .5) * width, location[1] + (v - .5) * depth, location[2] + dome + crinkle + edge * .012))
    faces = []
    for row in range(rows - 1):
        for column in range(columns - 1):
            start = row * columns + column
            faces.append((start, start + 1, start + columns + 1, start + columns))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            index = mesh.vertices[mesh.loops[loop_index].vertex_index].index
            row, column = divmod(index, columns)
            uv.data[loop_index].uv = (column / (columns - 1), row / (rows - 1))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.parent = parent
    metadata(obj, semantic, authored_foil=True, compressed_soft_fold=True, crinkle_geometry=True)
    solidify = obj.modifiers.new("Foil_Bundle_Thickness", "SOLIDIFY")
    solidify.thickness = .075
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    obj.select_set(False)
    return finish(obj, bevel=.014, smooth=True)


def curve(name: str, parent: bpy.types.Object, points: list[tuple[float, float, float]], mat: bpy.types.Material, semantic: str, radius: float = 0.018, **extras: object) -> bpy.types.Object:
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
    metadata(obj, semantic, **extras)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return finish(obj, bevel=0.0, smooth=True)


def rivet(name: str, parent: bpy.types.Object, location: tuple[float, float, float], mat: bpy.types.Material, semantic: str, radius: float = 0.018, *, front: bool = True) -> bpy.types.Object:
    """Small countersunk hardware that gives sewn and molded goods a scale cue."""
    return cylinder(
        name,
        parent,
        location,
        radius,
        0.012,
        mat,
        semantic,
        rotation=(math.pi / 2, 0, 0) if front else (0, 0, 0),
        vertices=12,
        fastener="countersunk",
    )


def stitch_line(name: str, parent: bpy.types.Object, points: list[tuple[float, float, float]], mat: bpy.types.Material, semantic: str, *, count: int = 18, radius: float = 0.004) -> None:
    """Author visible stitch dashes instead of representing a seam as paint."""
    if len(points) < 2:
        return
    start, end = Vector(points[0]), Vector(points[-1])
    for index in range(count):
        t = (index + .5) / count
        position = start.lerp(end, t)
        dash = box(
            f"{name}_{index:02d}", parent, tuple(position), (radius * 1.4, radius * 1.8, radius * 4.8), mat,
            semantic, bevel=radius * .45, stitch=True,
        )
        if abs(end.x - start.x) > abs(end.z - start.z):
            dash.rotation_euler[1] = math.pi / 2


def zipper_teeth(name: str, parent: bpy.types.Object, start: tuple[float, float, float], end: tuple[float, float, float], mat: bpy.types.Material, semantic: str, *, count: int = 14, width: float = .052) -> None:
    """Interlocking zipper teeth with a separate tape seam; an important product-scale detail."""
    origin, destination = Vector(start), Vector(end)
    for index in range(count):
        point = origin.lerp(destination, (index + .5) / count)
        for side in (-1, 1):
            box(
                f"{name}_{index:02d}_{side:+d}", parent, (point.x + side * width * .26, point.y, point.z),
                (width * .38, .018, .025), mat, semantic, bevel=.004, zipper_tooth=True,
            )


def graphic_layer(name: str, parent: bpy.types.Object, location: tuple[float, float, float], size: tuple[float, float, float], product: dict[str, object], mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """Add a replaceable print panel plus a non-verbal stable-key symbol.

    The printed SVG remains the source of truth for any future Korean typeset
    copy.  The mesh only carries a product-key-specific campus-wayfinding
    motif, so a catalog item never presents a blank white or black placeholder
    while it is waiting for the legal/IP-approved final print layer.
    """
    key = str(product["key"])
    surface_key = {
        "idcard": "ivory", "badge": "teal", "photo": "paper", "radio": "ivory", "kit": "ivory",
        "zipup": "ivory", "archery": "ivory", "postcard": "ivory", "candle": "ivory", "blanket": "ivory",
    }[key]
    surface = box(
        name,
        parent,
        location,
        size,
        mats[surface_key],
        f"graphic.{key}",
        bevel=0.007,
        replaceable_graphic=f"{key}/graphic-layer.svg",
        text_baked=False,
        graphic_system="nonverbal-campus-wayfinding-v4",
    )
    symbol_y = location[1] - size[1] * .5 - .008
    accent = mats["graphite"] if surface_key in ("ivory", "paper") else mats["ivory"]
    signal = mats["teal"] if surface_key != "teal" else mats["ivory"]

    def mark(index: int, x: float, z: float, width: float, height: float, *, mat: bpy.types.Material = accent) -> None:
        box(
            f"GraphicSymbol_{key}_{index:02d}", parent, (location[0] + x, symbol_y, location[2] + z),
            (width, .010, height), mat, f"graphic.{key}.symbol", bevel=.003,
            replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False,
        )

    if key == "idcard":
        # Campus ID hierarchy: distinct portrait placeholder frame, a simple
        # nonverbal school crest, and record bars. No likeness or copy exists.
        mark(0, -.115, .0, .16, .33, mat=mats["graphite"])
        cylinder(f"GraphicSymbol_{key}_01", parent, (location[0] - .115, symbol_y - .008, location[2] + .075), .038, .010, signal, f"graphic.{key}.portrait-head", rotation=(math.pi / 2, 0, 0), vertices=12, replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
        curve(f"GraphicSymbol_{key}_02", parent, [(location[0] - .17, symbol_y - .009, location[2] - .075), (location[0] - .115, symbol_y - .011, location[2] - .015), (location[0] - .06, symbol_y - .009, location[2] - .075)], signal, f"graphic.{key}.portrait-shoulders", .010, replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
        torus(f"GraphicSymbol_{key}_03", parent, (location[0] + .105, symbol_y, location[2] + .075), .052, .008, signal, f"graphic.{key}.campus-crest", rotation=(math.pi / 2, 0, 0), replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
        mark(4, .105, .075, .032, .10, mat=signal); mark(5, .105, .075, .095, .025, mat=signal)
        mark(6, .105, -.035, .15, .018); mark(7, .105, -.085, .15, .018)
    elif key == "badge":
        mark(0, -.075, .0, .05, .05); mark(1, .0, .0, .05, .05); mark(2, .075, .0, .05, .05)
        for index in range(5):
            mark(3 + index, -.10 + index * .05, -.035, .016, .016)
    elif key == "photo":
        mark(0, -.075, .02, .22, .29, mat=mats["graphite"])
        torus(f"GraphicSymbol_{key}_01", parent, (location[0] - .075, symbol_y, location[2] + .06), .043, .007, signal, f"graphic.{key}.photo-subject-frame", rotation=(math.pi / 2, 0, 0), replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
        curve(f"GraphicSymbol_{key}_02", parent, [(location[0] - .16, symbol_y, location[2] - .09), (location[0] - .075, symbol_y, location[2] - .005), (location[0] + .01, symbol_y, location[2] - .09)], signal, f"graphic.{key}.photo-subject-frame", .010, replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
        for index, width in enumerate((.12, .16, .09)):
            mark(3 + index, .105, .085 - index * .070, width, .018)
    elif key == "radio":
        for index, height in enumerate((.04, .085, .13)):
            curve(f"GraphicSymbol_{key}_{index:02d}", parent, [(location[0] - .09 + index * .035, symbol_y, location[2] - height * .5), (location[0] - .02 + index * .035, symbol_y, location[2]), (location[0] - .09 + index * .035, symbol_y, location[2] + height * .5)], accent, f"graphic.{key}.symbol", .006, replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
        torus(f"GraphicSymbol_{key}_03", parent, (location[0] + .08, symbol_y, location[2]), .023, .008, accent, f"graphic.{key}.symbol", rotation=(math.pi / 2, 0, 0), replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
    elif key == "kit":
        for index, inset in enumerate((.0, .04, .08)):
            curve(f"GraphicSymbol_{key}_{index:02d}", parent, [(location[0] - .10 + inset, symbol_y, location[2] - .055 + inset * .25), (location[0], symbol_y, location[2] + .065 - inset * .18), (location[0] + .10 - inset, symbol_y, location[2] - .055 + inset * .25)], accent, f"graphic.{key}.symbol", .006, replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
    elif key == "zipup":
        mark(0, -.065, .055, .028, .14); mark(1, .0, .0, .028, .20); mark(2, .065, -.055, .028, .14)
    elif key == "archery":
        mark(0, -.065, .08, .14, .018); mark(1, -.065, .0, .14, .018); mark(2, -.065, -.08, .14, .018)
        torus(f"GraphicSymbol_{key}_03", parent, (location[0] + .09, symbol_y, location[2]), .035, .008, accent, f"graphic.{key}.symbol", rotation=(math.pi / 2, 0, 0), replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
    elif key == "postcard":
        for index, width in enumerate((.20, .14, .08)):
            curve(f"GraphicSymbol_{key}_{index:02d}", parent, [(location[0] - width * .5, symbol_y, location[2] - .07 + index * .07), (location[0], symbol_y, location[2] - .025 + index * .07), (location[0] + width * .5, symbol_y, location[2] - .07 + index * .07)], accent, f"graphic.{key}.symbol", .006, replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
    elif key == "candle":
        for index, radius in enumerate((.035, .070, .105)):
            torus(f"GraphicSymbol_{key}_{index:02d}", parent, (location[0], symbol_y, location[2]), radius, .006, accent, f"graphic.{key}.symbol", rotation=(math.pi / 2, 0, 0), replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
    elif key == "blanket":
        for index, offset in enumerate((-.08, -.02, .04)):
            curve(f"GraphicSymbol_{key}_{index:02d}", parent, [(location[0] - .10, symbol_y, location[2] + offset), (location[0] - .015, symbol_y, location[2] + offset + .045), (location[0] + .10, symbol_y, location[2] + offset)], accent, f"graphic.{key}.symbol", .008, replaceable_graphic=f"{key}/graphic-layer.svg", text_baked=False)
    return surface


def card_shape(parent: bpy.types.Object, offset: tuple[float, float, float], product: dict[str, object], mats: dict[str, bpy.types.Material], semantic: str = "card") -> None:
    x, y, z = offset
    # A clear outer sleeve, dark frame rails, and a recessed print card create
    # parallax that survives a small catalog thumbnail.
    box("Card_Case", parent, (x, y, z), (0.66, 0.065, 0.95), mats["smoke"], semantic, bevel=0.045, construction="clear molded sleeve")
    box("Card_Insert", parent, (x, y - 0.038, z), (0.54, 0.010, 0.73), mats["ivory"], f"{semantic}.insert", bevel=0.022, construction="replaceable card stock")
    box("Card_Inner_Shadow", parent, (x, y - 0.044, z + .335), (.43, .006, .042), mats["graphite"], f"{semantic}.inner-rail", bevel=.007)
    graphic_layer("GraphicLayer_ID", parent, (x, y - 0.048, z - .03), (0.47, 0.006, 0.54), product, mats)
    # Back-side campus record plate prevents the holder from reverting to a
    # blank black proxy in turntable views while retaining one SVG seam.
    back = box("Card_Back_Record_Plate", parent, (x, y + .040, z - .02), (.47, .008, .58), mats["ivory"], f"{semantic}.back-record", bevel=.012, replaceable_graphic=f"{product['key']}/graphic-layer.svg", text_baked=False)
    back_y = y + .047
    torus("Card_Back_Crest", parent, (x, back_y, z + .13), .075, .009, mats["teal"], f"{semantic}.back-crest", rotation=(math.pi / 2, 0, 0), replaceable_graphic=f"{product['key']}/graphic-layer.svg", text_baked=False)
    for index, width in enumerate((.21, .28, .16)):
        box(f"Card_Back_Record_{index}", parent, (x, back_y, z - .03 - index * .075), (width, .009, .017), mats["graphite"], f"{semantic}.back-record-bar", bevel=.003, replaceable_graphic=f"{product['key']}/graphic-layer.svg", text_baked=False)
    box("Card_Strap", parent, (x, y + 0.03, z + 0.59), (0.13, 0.04, 0.27), mats["nickel"], f"{semantic}.clip", bevel=0.02, hardware="swivel clip")
    for side in (-1, 1):
        rivet(f"Card_Clip_Rivet_{side}", parent, (x + side * .042, y - .055, z + .59), mats["nickel"], f"{semantic}.clip-rivet", .011)


def create_idcard(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    card_shape(root, (0, 0, 0.65), product, mats, "idcard")
    # Layered rails and a captive swivel stop the holder from reading as one
    # opaque card-shaped block at thumbnail distance.
    box("Card_Frame_Top", root, (0, 0.018, 1.095), (.57, .045, .055), mats["graphite"], "idcard.frame.top", bevel=.018)
    box("Card_Frame_Bottom", root, (0, 0.018, .205), (.57, .045, .055), mats["graphite"], "idcard.frame.bottom", bevel=.018)
    for side in (-1, 1):
        box(f"Card_Frame_Side_{side}", root, (side * .285, 0.018, .65), (.052, .045, .79), mats["graphite"], "idcard.frame.side", bevel=.015)
    box("Card_Slot", root, (0, -.052, 1.055), (.16, .008, .032), mats["black"], "idcard.slot", bevel=.008)
    torus("Lanyard_Ring", root, (0, 0.06, 1.23), 0.13, 0.022, mats["nickel"], "idcard.ring", rotation=(math.pi / 2, 0, 0))
    cylinder("Swivel_Barrel", root, (0, 0.06, 1.37), .048, .12, mats["nickel"], "idcard.swivel-barrel", rotation=(math.pi / 2, 0, 0), vertices=16)
    torus("Swivel_Joint", root, (0, .12, 1.43), .055, .012, mats["nickel"], "idcard.swivel-joint", rotation=(math.pi / 2, 0, 0))
    curve("Lanyard_Loop", root, [(-.06, .05, 1.48), (-.54, .02, 1.66), (-.48, .0, 2.13), (-.08, .02, 2.19), (.21, .03, 1.72), (.09, .04, 1.48)], mats["navy"], "idcard.lanyard", .040)
    curve("Lanyard_Stitch", root, [(-.06, -.002, 1.48), (-.49, -.017, 1.68), (-.42, -.024, 2.06), (-.06, -.017, 2.11)], mats["ivory"], "idcard.lanyard-stitch", .006)
    stitch_line("Lanyard_BoxStitch", root, [(-.10, -.016, 1.49), (-.10, -.016, 1.72)], mats["ivory"], "idcard.lanyard.box-stitch", count=5, radius=.003)
    for side in (-1, 1):
        rivet(f"Card_Frame_Rivet_{side}", root, (side * .245, -.055, .28), mats["nickel"], "idcard.frame-rivet", .012)


def create_badge(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    # Three shallow, separately pinned school nameplates. The silhouette is
    # intentionally compact and planar so it cannot read as a sci-fi bar or
    # radio component at discovery distance.
    layouts = ((0.0, .42, .46, .155, .0), (-.22, .18, .30, .125, -.065), (.22, .18, .30, .125, .065))
    for index, (x, z, width, height, rotation) in enumerate(layouts):
        backing = box(f"Badge_Backing_{index}", root, (x, .025 + index * .012, z), (width + .035, .046, height + .035), mats["nickel"], "badge.backing", bevel=.026, piece=index, construction="shallow stamped pin backing")
        backing.rotation_euler[1] = rotation
        plate = box(f"Badge_Nameplate_{index}", root, (x, -.008 + index * .012, z), (width, .018, height), mats["ivory"], "badge.nameplate", bevel=.014, piece=index, construction="matte school nameplate face", replaceable_graphic="badge/graphic-layer.svg", text_baked=False)
        plate.rotation_euler[1] = rotation
        band = box(f"Badge_CrestBand_{index}", root, (x, -.022 + index * .012, z + height * .20), (width * .68, .008, .022), mats["teal"], "badge.crest-band", bevel=.004, piece=index, replaceable_graphic="badge/graphic-layer.svg", text_baked=False)
        band.rotation_euler[1] = rotation
        for marker in range(5):
            token = box(f"Badge_ClassMarker_{index}_{marker}", root, (x - width * .28 + marker * width * .14, -.024 + index * .012, z - height * .20), (.014, .007, .014), mats["graphite"], "badge.class-marker", bevel=.002, piece=index, replaceable_graphic="badge/graphic-layer.svg", text_baked=False)
            token.rotation_euler[1] = rotation
        pin_y = .065 + index * .012
        cylinder(f"Badge_PinPost_{index}", root, (x, pin_y, z), .018, .074, mats["nickel"], "badge.pin-post", rotation=(math.pi / 2, 0, 0), vertices=12, piece=index)
        cylinder(f"Badge_PinCatch_{index}", root, (x, pin_y + .044, z), .037, .022, mats["nickel"], "badge.pin-catch", rotation=(math.pi / 2, 0, 0), vertices=12, piece=index)
        curve(f"Badge_SafetyPin_{index}", root, [(x - width * .24, pin_y + .050, z), (x, pin_y + .060, z + .020), (x + width * .22, pin_y + .050, z)], mats["nickel"], "badge.pin-wire", .006, piece=index)
    graphic_layer("GraphicLayer_Badge", root, (0, -.028, .42), (.22, .006, .072), product, mats)


def create_photo(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    box("Photo_Sleeve_Back", root, (0, .035, .45), (.82, .11, 1.13), mats["paper"], "photo.sleeve", bevel=.035, construction="folded carton sleeve")
    box("Photo_Sleeve_Side", root, (.39, -.025, .45), (.055, .105, 1.03), mats["teal"], "photo.sleeve.edge", bevel=.012)
    box("Photo_Sleeve_Flap", root, (0, -.022, 1.025), (.72, .075, .18), mats["paper"], "photo.sleeve.flap", bevel=.022, construction="tuck flap")
    for index, (x, rotation, z) in enumerate(((-.16, -.13, .64), (0.0, .0, .68), (.16, .13, .64))):
        card = box(f"Photo_Card_{index}", root, (x, -.115 - index * .012, z), (.54, .018, .78), mats["photo"], "photo.card", bevel=.025, card_finish="satin photo stock with matte edge")
        card.rotation_euler[1] = rotation
        # A formal-but-anonymous student-photo field reads as a usable card
        # hierarchy. It is deliberately geometric rather than a likeness.
        box(f"Photo_Frame_{index}", root, (x, -.130 - index * .012, z + .065), (.42, .006, .49), mats["photo"], "photo.card.inset", bevel=.012, abstract_print_recess=True)
        box(f"Photo_Portrait_Field_{index}", root, (x - .075, -.138 - index * .012, z + .095), (.19, .006, .30), mats["graphite"], "photo.card.portrait-field", bevel=.010, replaceable_graphic="photo/graphic-layer.svg", text_baked=False)
        cylinder(f"Photo_Portrait_Head_{index}", root, (x - .075, -.145 - index * .012, z + .165), .040, .010, mats["teal"], "photo.card.portrait-head", rotation=(math.pi / 2, 0, 0), vertices=12, replaceable_graphic="photo/graphic-layer.svg", text_baked=False)
        curve(f"Photo_Portrait_Shoulders_{index}", root, [(x - .14, -.147 - index * .012, z - .005), (x - .075, -.149 - index * .012, z + .060), (x - .01, -.147 - index * .012, z - .005)], mats["teal"], "photo.card.portrait-shoulders", .010, replaceable_graphic="photo/graphic-layer.svg", text_baked=False)
        for record in range(3):
            box(f"Photo_Record_Bar_{index}_{record}", root, (x + .115, -.140 - index * .012, z + .145 - record * .080), (.105 - record * .012, .006, .016), mats["graphite"], "photo.card.record-bar", bevel=.003, replaceable_graphic="photo/graphic-layer.svg", text_baked=False)
        curve(f"Photo_Deckle_{index}", root, [(x - .22, -.142 - index * .012, z - .33), (x, -.146 - index * .012, z - .345), (x + .22, -.142 - index * .012, z - .33)], mats["teal"], "photo.card.edge-accent", .005)
        # Separate plies make the card edges read as matte duplex stock rather
        # than a single smooth plastic tile.
        box(f"Photo_Paper_Ply_{index}", root, (x, -.140 - index * .012, z - .355), (.43, .007, .014), mats["paper"], "photo.card.paper-ply", bevel=.002, delaminated_edge=True)
        box(f"Photo_Paper_Edge_{index}", root, (x - .235, -.140 - index * .012, z), (.012, .007, .63), mats["paper"], "photo.card.paper-edge", bevel=.002, delaminated_edge=True)
    stitch_line("Photo_Sleeve_Stitch", root, [(-.34, -.078, .09), (-.34, -.078, .91)], mats["ivory"], "photo.sleeve.stitch", count=14, radius=.003)
    graphic_layer("GraphicLayer_Photo", root, (0, -.145, .43), (.50, .006, .45), product, mats)
    graphic_layer("GraphicLayer_Photo_Back", root, (0, .095, .46), (.54, .006, .52), product, mats)


def create_radio(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    # The forward hero is paired with a slightly offset companion charm. Both
    # share the same hardware language but are constructed as actual radios.
    for unit, (offset_x, offset_y, offset_z, scale) in enumerate(((.0, -.035, .0, 1.0), (-.17, .115, .035, .78))):
        body = box(f"Radio_Body_{unit}", root, (offset_x, offset_y, .45 + offset_z), (.62 * scale, .22 * scale, .82 * scale), mats["graphite"], "radio.body", bevel=.06 * scale, unit=unit, construction="two-shell molded body")
        box(f"Radio_Faceplate_{unit}", root, (offset_x, offset_y - .126 * scale, .49 + offset_z), (.53 * scale, .026 * scale, .67 * scale), mats["black"], "radio.faceplate", bevel=.035 * scale, unit=unit)
        box(f"Radio_Screen_{unit}", root, (offset_x - .085 * scale, offset_y - .148 * scale, .69 + offset_z), (.25 * scale, .010 * scale, .105 * scale), mats["smoke"], "radio.screen", bevel=.018 * scale, unit=unit)
        box(f"Radio_Screen_Inner_{unit}", root, (offset_x - .085 * scale, offset_y - .155 * scale, .69 + offset_z), (.20 * scale, .004 * scale, .065 * scale), mats["teal"], "radio.screen-glow", bevel=.010 * scale, unit=unit)
        cylinder(f"Radio_Dial_{unit}", root, (offset_x + .16 * scale, offset_y - .135 * scale, .62 + offset_z), .105 * scale, .04 * scale, mats["teal"], "radio.dial", rotation=(math.pi / 2, 0, 0), unit=unit)
        torus(f"Radio_Dial_Knurl_{unit}", root, (offset_x + .16 * scale, offset_y - .163 * scale, .62 + offset_z), .106 * scale, .012 * scale, mats["nickel"], "radio.dial-knurl", rotation=(math.pi / 2, 0, 0), unit=unit)
        box(f"Radio_Speaker_{unit}", root, (offset_x - .06 * scale, offset_y - .132 * scale, .36 + offset_z), (.37 * scale, .025 * scale, .24 * scale), mats["nickel"], "radio.speaker", bevel=.025 * scale, unit=unit)
        for column in range(4):
            for row in range(3):
                cylinder(f"Speaker_Hole_{unit}_{column}_{row}", root, (offset_x + (-.18 + column * .08) * scale, offset_y - .15 * scale, .28 + row * .075 * scale + offset_z), .017 * scale, .006 * scale, mats["black"], "radio.speaker-hole", rotation=(math.pi / 2, 0, 0), vertices=8, unit=unit)
        torus(f"Radio_Keyring_{unit}", root, (offset_x - .23 * scale, offset_y, .98 * scale + offset_z), .11 * scale, .018 * scale, mats["nickel"], "radio.keyring", rotation=(math.pi / 2, 0, 0), unit=unit)
        cylinder(f"Radio_Antenna_Base_{unit}", root, (offset_x + .14 * scale, offset_y, .93 * scale + offset_z), .065 * scale, .07 * scale, mats["nickel"], "radio.antenna-base", vertices=16, unit=unit)
        cylinder(f"Radio_Antenna_{unit}", root, (offset_x + .14 * scale, offset_y, 1.16 * scale + offset_z), .025 * scale, .44 * scale, mats["black"], "radio.antenna", vertices=12, unit=unit)
        for side in (-1, 1):
            box(f"Radio_Side_Rail_{unit}_{side}", root, (offset_x + side * .327 * scale, offset_y, .48 * scale + offset_z), (.025 * scale, .17 * scale, .48 * scale), mats["nickel"], "radio.side-rail", bevel=.010 * scale, unit=unit)
            rivet(f"Radio_Screw_{unit}_{side}", root, (offset_x + side * .22 * scale, offset_y - .153 * scale, .19 * scale + offset_z), mats["nickel"], "radio.face-screw", .018 * scale)
    graphic_layer("GraphicLayer_Radio", root, (.0, -.194, .72), (.19, .006, .08), product, mats)


def create_kit(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    # Keep the v2 sewn construction, but give it the compact rectangular
    # organizer profile of an actual utility pouch rather than a toy handbag.
    box("Kit_Pouch_Core", root, (0, 0, .48), (.72, .27, .84), mats["olive"], "kit.pouch.core", bevel=.078, construction="padded rectangular organizer")
    cloth_panel("Kit_Pouch_Front", root, (0, -.155, .48), .72, .86, mats["olive"], "kit.pouch.front", thickness=.050, shoulder_taper=.02, folds=.010)
    cloth_panel("Kit_Pouch_Back", root, (0, .155, .48), .72, .86, mats["olive"], "kit.pouch.back", thickness=.050, shoulder_taper=.02, folds=.009)
    box("Kit_Pouch_Gusset", root, (-.365, 0, .48), (.07, .25, .76), mats["olive"], "kit.pouch.gusset", bevel=.030, construction="bound side gusset")
    box("Kit_Pouch_Gusset_Right", root, (.365, 0, .48), (.07, .25, .76), mats["olive"], "kit.pouch.gusset", bevel=.030, construction="bound side gusset")
    for side in (-1, 1):
        cloth_tube(f"Kit_Gusset_Bulge_{side}", root, [(side * .362, -.02, .18), (side * .390, -.01, .48), (side * .362, -.02, .78)], [(.065, .085), (.085, .105), (.065, .085)], mats["olive"], "kit.pouch.gusset-volume", construction="padded expansion gusset")
        curve(f"Kit_Gusset_Seam_{side}", root, [(side * .405, -.13, .20), (side * .420, -.15, .48), (side * .405, -.13, .76)], mats["black"], "kit.gusset.bound-seam", .009)
        curve(f"Kit_Gusset_Fold_{side}", root, [(side * .355, -.16, .30), (side * .385, -.18, .48), (side * .355, -.16, .64)], mats["ivory"], "kit.gusset.fold", .004)
    cloth_panel("Kit_Front_Pocket", root, (0, -.218, .34), .58, .30, mats["olive"], "kit.front-pocket", thickness=.032, shoulder_taper=.03, folds=.006)
    curve("Kit_Pocket_Seam", root, [(-.27, -.246, .235), (0, -.258, .218), (.27, -.246, .235)], mats["black"], "kit.pocket-seam", .010)
    curve("Kit_Zipper", root, [(-.30, -.205, .78), (0.0, -.222, .93), (.30, -.205, .78)], mats["nickel"], "kit.zipper", .017)
    zipper_teeth("Kit_ZipperTeeth_Left", root, (-.29, -.223, .78), (0.0, -.242, .922), mats["nickel"], "kit.zipper-tooth", count=10, width=.042)
    zipper_teeth("Kit_ZipperTeeth_Right", root, (.29, -.223, .78), (0.0, -.242, .922), mats["nickel"], "kit.zipper-tooth", count=10, width=.042)
    box("Kit_Zipper_Pull", root, (0, -.235, .925), (.055, .028, .09), mats["nickel"], "kit.zipper-pull", bevel=.012)
    torus("Kit_Zipper_Tab", root, (0, -.25, .852), .040, .009, mats["nickel"], "kit.zipper-tab", rotation=(math.pi / 2, 0, 0))
    for side in (-1, 1):
        curve(f"Kit_Webbing_{side}", root, [(side * .18, -.215, .21), (side * .18, -.225, .66)], mats["black"], "kit.webbing", .016)
        torus(f"Kit_D_Ring_{side}", root, (side * .34, -.015, .74), .052, .012, mats["nickel"], "kit.d-ring", rotation=(math.pi / 2, 0, 0))
        rivet(f"Kit_Webbing_Rivet_{side}", root, (side * .18, -.247, .68), mats["nickel"], "kit.webbing-rivet", .011)
        stitch_line(f"Kit_EdgeStitch_{side}", root, [(side * .295, -.232, .18), (side * .295, -.232, .75)], mats["ivory"], "kit.edge-stitch", count=12, radius=.0028)
    graphic_layer("GraphicLayer_Kit", root, (0, -0.227, 0.44), (0.27, 0.006, 0.17), product, mats)
    curve("Kit_Loop", root, [(-.12, .01, .83), (0, .01, .96), (.12, .01, .83)], mats["black"], "kit.carry-loop", .022, construction="low-profile webbing handle")
    box("Kit_Reinforcement_Left", root, (-.23, -.239, .66), (.09, .018, .13), mats["black"], "kit.reinforcement", bevel=.008)
    box("Kit_Reinforcement_Right", root, (.23, -.239, .66), (.09, .018, .13), mats["black"], "kit.reinforcement", bevel=.008)
    box("Kit_Closure_Guard", root, (0, -.238, .79), (.50, .022, .075), mats["black"], "kit.closure-guard", bevel=.010)


def create_zipup(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    # Separate, shaped front panels create an actual center closure and collar
    # break instead of a single inflated rectangular jacket mass.
    for side in (-1, 1):
        zipup_body_panel(f"Zipup_Front_{side}", root, side, -.10, mats["navy"], "zipup.front-panel")
        zipup_body_panel(f"Zipup_Back_{side}", root, side, .10, mats["navy"], "zipup.back-panel")
        cloth_panel(f"Zipup_Front_Drape_{side}", root, (side * .275, -.166, .96), .34, 1.12, mats["navy"], "zipup.front-drape", thickness=.040, shoulder_taper=.24, folds=.040, construction="soft hanging technical-knit front")
        curve(f"Zipup_Chest_Fold_{side}", root, [(side * .10, -.218, 1.22), (side * .27, -.236, 1.12), (side * .41, -.218, 1.00)], mats["black"], "zipup.chest-fold", .007)
    for side in (-1, 1):
        cloth_tube(f"Zipup_Sleeve_{side}", root, [(side * .47, 0, 1.49), (side * .67, -.005, 1.18), (side * .73, .015, .90), (side * .80, .01, .70)], [(.19, .16), (.16, .145), (.135, .13), (.115, .11)], mats["navy"], "zipup.sleeve")
        cloth_panel(f"Zipup_Shoulder_Panel_{side}", root, (side * .39, -.158, 1.47), .34, .19, mats["ivory"], "zipup.shoulder-panel", thickness=.020, shoulder_taper=.18, folds=.008)
        cloth_panel(f"Zipup_Raglan_Yoke_{side}", root, (side * .29, -.112, 1.53), .32, .28, mats["navy"], "zipup.raglan-yoke", thickness=.034, shoulder_taper=.22, folds=.014)
        curve(f"Zipup_Sleeve_Seam_{side}", root, [(side * .42, -.165, 1.54), (side * .63, -.17, 1.18), (side * .75, -.16, .78)], mats["ivory"], "zipup.sleeve-seam", .009)
        curve(f"Zipup_Raglan_Seam_{side}", root, [(side * .14, -.171, 1.64), (side * .39, -.182, 1.50), (side * .58, -.172, 1.26)], mats["ivory"], "zipup.raglan-seam", .007)
        curve(f"Zipup_Elbow_Fold_{side}", root, [(side * .59, -.147, 1.10), (side * .73, -.172, 1.03), (side * .77, -.155, .91)], mats["black"], "zipup.sleeve.elbow-fold", .006)
        curve(f"Zipup_Cuff_Fold_{side}", root, [(side * .72, -.145, .76), (side * .80, -.165, .72), (side * .85, -.145, .75)], mats["navy"], "zipup.cuff.fold", .008)
        cloth_panel(f"Zipup_Sleeve_Drape_{side}", root, (side * .705, -.140, 1.04), .18, .54, mats["navy"], "zipup.sleeve-drape", thickness=.035, shoulder_taper=.12, folds=.030, construction="soft sleeve drape")
        box(f"Zipup_Cuff_{side}", root, (side * .80, -.005, .67), (.23, .19, .105), mats["ivory"], "zipup.cuff", bevel=.024)
    cloth_panel("Zipup_Collar_Left", root, (-.16, -.095, 1.65), .23, .30, mats["navy"], "zipup.collar", thickness=.048, shoulder_taper=.10, folds=.006)
    cloth_panel("Zipup_Collar_Right", root, (.16, -.095, 1.65), .23, .30, mats["navy"], "zipup.collar", thickness=.048, shoulder_taper=.10, folds=.006)
    curve("Zipup_Zipper", root, [(0, -.163, .31), (0, -.176, .95), (0, -.163, 1.57)], mats["nickel"], "zipup.zipper", .018)
    zipper_teeth("Zipup_ZipperTeeth", root, (0, -.184, .38), (0, -.184, 1.53), mats["nickel"], "zipup.zipper-tooth", count=16, width=.075)
    box("Zipup_Zipper_Pull", root, (.0, -.198, 1.15), (.070, .030, .10), mats["nickel"], "zipup.zipper-pull", bevel=.014)
    torus("Zipup_Zipper_Tab", root, (0, -.218, 1.075), .045, .009, mats["nickel"], "zipup.zipper-tab", rotation=(math.pi / 2, 0, 0))
    curve("Zipup_Hem", root, [(-.49, -.13, .29), (0, -.165, .25), (.49, -.13, .29)], mats["ivory"], "zipup.hem", .012)
    for side in (-1, 1):
        curve(f"Zipup_Pocket_{side}", root, [(side * .08, -.174, .72), (side * .29, -.184, .65), (side * .42, -.165, .76)], mats["ivory"], "zipup.welt-pocket", .010)
        stitch_line(f"Zipup_PocketStitch_{side}", root, [(side * .08, -.184, .70), (side * .39, -.184, .74)], mats["ivory"], "zipup.pocket-stitch", count=8, radius=.0024)
        curve(f"Zipup_SideSeam_{side}", root, [(side * .47, -.12, .32), (side * .50, -.13, .92), (side * .44, -.12, 1.43)], mats["ivory"], "zipup.side-seam", .006)
    box("Zipup_Neck_Tape", root, (0, -.125, 1.60), (.30, .025, .055), mats["ivory"], "zipup.neck-tape", bevel=.009)
    curve("Zipup_Hanger", root, [(-.25, .04, 1.94), (-.10, .04, 2.02), (0, .04, 2.10), (.12, .04, 2.02), (.28, .04, 1.94), (.15, .04, 1.90), (0, .04, 2.04)], mats["black"], "zipup.hanger", .018)
    graphic_layer("GraphicLayer_Zipup", root, (-0.35, -0.182, 1.05), (0.18, 0.006, 0.12), product, mats)


def create_archery(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    # The bookmark is an intentionally blunt, safe desk object: a clipped
    # metal shaft with rounded cap, layered fletching, and a real eyelet.
    cylinder("Archery_Bookmark_Shaft", root, (-.13, -.04, .61), .037, 1.10, mats["nickel"], "archery.bookmark.shaft", vertices=12, construction="rounded safe bookmark")
    cylinder("Archery_Bookmark_Cap", root, (-.13, -.04, 1.18), .072, .08, mats["teal"], "archery.bookmark.cap", vertices=16)
    cylinder("Archery_Bookmark_Foot", root, (-.13, -.04, .06), .060, .075, mats["nickel"], "archery.bookmark.foot", vertices=16)
    torus("Archery_Bookmark_Eyelet", root, (-.13, -.078, 1.18), .025, .007, mats["nickel"], "archery.bookmark.eyelet", rotation=(math.pi / 2, 0, 0))
    for index, (dx, dz, tilt) in enumerate(((-.075, .98, -.28), (.0, 1.02, .0), (.075, .98, .28))):
        fin = box(f"Bookmark_Fletching_{index}", root, (-.13 + dx, -.04, dz), (.07, .038, .19), mats["ivory"], "archery.bookmark.fletching", bevel=.012, flexible_fletching=True)
        fin.rotation_euler[1] = tilt
    cylinder("Archery_Pencil", root, (.16, -.04, .58), .045, 1.12, mats["graphite"], "archery.pencil", vertices=8, construction="faceted wood pencil")
    cylinder("Archery_Pencil_Cap", root, (.16, -.04, 1.18), .055, .13, mats["teal"], "archery.pencil-cap", vertices=12)
    cylinder("Archery_Pencil_Eraser", root, (.16, -.04, .015), .042, .055, mats["ivory"], "archery.pencil.eraser", vertices=12)
    box("Archery_Sleeve_Back", root, (.02, .10, .57), (.58, .035, 1.34), mats["paper"], "archery.sleeve", bevel=.025, construction="die-cut kraft sleeve")
    box("Archery_Sleeve_Fold", root, (.02, .060, 1.20), (.50, .022, .12), mats["paper"], "archery.sleeve.fold", bevel=.014)
    for side in (-1, 1):
        rivet(f"Archery_Sleeve_Rivet_{side}", root, (side * .22, .072, .20), mats["nickel"], "archery.sleeve-rivet", .009)
    graphic_layer("GraphicLayer_Archery", root, (.02, .072, .43), (.31, .006, .34), product, mats)


def create_postcard(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    for index, (x, rotation, mat) in enumerate(((-0.19, -0.19, mats["photo"]), (0.0, 0.0, mats["teal"]), (0.19, 0.19, mats["paper"]))):
        card = box(f"Postcard_{index}", root, (x, -index * 0.025, 0.42 + index * 0.018), (.56, .025, .77), mat, "postcard.card", bevel=.035, card_finish="rounded duplex stock")
        card.rotation_euler[1] = rotation
        curve(f"Postcard_SignalArc_{index}", root, [(x - .16, -.05 - index * .026, .45 + index * .018), (x, -.06 - index * .026, .62 + index * .018), (x + .16, -.05 - index * .026, .45 + index * .018)], mats["smoke"], "postcard.abstract-signal", .007)
        box(f"Postcard_Paper_Ply_{index}", root, (x, -.045 - index * .026, .052 + index * .018), (.43, .006, .012), mats["paper"], "postcard.paper-ply", bevel=.002, delaminated_edge=True)
    box("Postcard_VellumBand", root, (0, -.10, .42), (.87, .020, .12), mats["smoke"], "postcard.vellum-band", bevel=.005, construction="translucent wrap")
    box("Postcard_Band_Seal", root, (0, -.117, .42), (.12, .007, .12), mats["nickel"], "postcard.band-seal", bevel=.020)
    for side in (-1, 1):
        curve(f"Postcard_BandFold_{side}", root, [(side * .43, -.11, .33), (side * .445, -.115, .42), (side * .43, -.11, .51)], mats["ivory"], "postcard.vellum-fold", .004)
    graphic_layer("GraphicLayer_Postcard", root, (0, -.125, .42), (.40, .006, .44), product, mats)


def create_candle(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    cylinder("Candle_Tin", root, (0, 0, .16), .37, .30, mats["nickel"], "candle.tin", vertices=32, construction="deep drawn brushed tin")
    torus("Candle_Tin_Rim", root, (0, 0, .315), .335, .018, mats["nickel"], "candle.tin.rim")
    # Independent inner wall, wax meniscus, cool pool, and charred wick give
    # the tin a real interior rather than a coloured disk on a metal can.
    torus("Candle_Inner_Wall", root, (0, 0, .302), .305, .020, mats["nickel"], "candle.tin.inner-wall")
    cylinder("Candle_Wax", root, (0, 0, .328), .302, .050, mats["wax"], "candle.wax", vertices=32)
    torus("Candle_Wax_Meniscus", root, (0, 0, .356), .286, .022, mats["wax"], "candle.wax.meniscus")
    cylinder("Candle_Wax_Pool", root, (0, -.004, .358), .105, .008, mats["wax"], "candle.wax.melt-pool", vertices=24)
    for index, radius in enumerate((.075, .118, .165)):
        curve(f"Candle_Melt_Ripple_{index}", root, [(-radius, -.004, .363), (0, -.012, .363 + index * .003), (radius, -.004, .363)], mats["wax"], "candle.wax.ripple", .006)
    curve("Candle_Wick", root, [(0, 0, .360), (.015, -.005, .415), (.006, -.003, .462)], mats["black"], "candle.wick", .014, construction="curved cotton wick")
    cylinder("Candle_Wick_Char", root, (.006, -.003, .465), .020, .035, mats["black"], "candle.wick.charred-tip", vertices=10)
    cylinder("Candle_Lid", root, (.49, .0, .075), .34, .06, mats["nickel"], "candle.lid", rotation=(.06, .12, 0), vertices=32)
    torus("Candle_Lid_Rim", root, (.49, -.008, .107), .285, .013, mats["nickel"], "candle.lid.rim", rotation=(.06, .12, 0))
    cylinder("Candle_Lid_Recess", root, (.49, -.033, .078), .155, .009, mats["black"], "candle.lid.label-recess", rotation=(.06, .12, 0), vertices=28)
    for angle in (0, math.pi * .5, math.pi, math.pi * 1.5):
        rivet(f"Candle_Label_Rivet_{angle:.2f}", root, (.26 * math.cos(angle), -.374, .16 + .09 * math.sin(angle)), mats["nickel"], "candle.label-rivet", .008)
    graphic_layer("GraphicLayer_Candle", root, (0, -.380, .16), (.28, .006, .18), product, mats)


def create_blanket(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    # A real thermal-foil bundle compresses into rounded, irregular textile
    # folds; it is not a stack of rigid plates. Three soft volumes and one
    # retention strap preserve the rescue-blanket read at all four angles.
    base = foil_bundle_fold("Blanket_BaseSoftFold", root, (-.02, .0, .085), 1.18, .72, .095, mats["silver"], "blanket.base-soft-fold")
    middle = foil_bundle_fold("Blanket_MiddleSoftFold", root, (-.05, -.015, .155), 1.00, .60, .120, mats["silver"], "blanket.middle-soft-fold")
    top = foil_bundle_fold("Blanket_TopSoftFold", root, (.08, .025, .245), .78, .46, .115, mats["silver"], "blanket.top-soft-fold")
    middle.rotation_euler[2] = -.055
    top.rotation_euler[2] = .11
    top.rotation_euler[0] = -.10
    for index, (y, height) in enumerate(((-.20, .305), (-.04, .365), (.13, .335))):
        curve(f"Blanket_SoftFold_Ridge_{index}", root, [(-.35, y, height), (-.06, y - .025, height + .032), (.22, y + .018, height + .010), (.38, y, height - .006)], mats["silver"], "blanket.soft-fold-ridge", .025)
    for side in (-1, 1):
        curve(f"Blanket_Rounded_Hem_{side}", root, [(side * .54, -.28, .14), (side * .59, -.03, .20), (side * .54, .28, .15)], mats["ivory"], "blanket.rounded-hem", .014)
        stitch_line(f"Blanket_HemStitch_{side}", root, [(side * .525, -.21, .16), (side * .525, .21, .16)], mats["ivory"], "blanket.hem-stitch", count=8, radius=.0026)
    # Exactly one broad soft-webbing keeper: no extra cables or hard plates.
    cloth_panel("Blanket_Keeper_Strap", root, (-.02, -.300, .335), .72, .16, mats["black"], "blanket.keeper-strap", thickness=.032, shoulder_taper=.04, folds=.010, construction="single elastic retention strap")
    box("Blanket_Keeper_Buckle", root, (-.02, -.327, .337), (.16, .030, .062), mats["nickel"], "blanket.keeper-buckle", bevel=.014)
    torus("Blanket_Buckle_Opening", root, (-.02, -.347, .337), .036, .010, mats["black"], "blanket.keeper-buckle-opening", rotation=(math.pi / 2, 0, 0))
    graphic_layer("GraphicLayer_Blanket", root, (-.02, -.323, .345), (.24, .006, .11), product, mats)


BUILDERS = {
    "idcard": create_idcard,
    "badge": create_badge,
    "photo": create_photo,
    "radio": create_radio,
    "kit": create_kit,
    "zipup": create_zipup,
    "archery": create_archery,
    "postcard": create_postcard,
    "candle": create_candle,
    "blanket": create_blanket,
}


def add_lod_and_collision(root: bpy.types.Object, product: dict[str, object], mats: dict[str, bpy.types.Material]) -> None:
    lod1 = parented_empty("LOD1_Shelf", root, f"lod1.{product['key']}", lod_level=1, runtime_visibility="opt-in")
    bounds = product["collision_m"]
    assert isinstance(bounds, list)
    shelf = box("Shelf_Silhouette", lod1, (0, 0.5, max(bounds[2] * 0.5, 0.22)), tuple(float(value) * 0.76 for value in bounds), mats["graphite"], f"lod1.{product['key']}.silhouette", bevel=0.025, lod_level=1)
    shelf.hide_render = True
    collider = box("COL_Collectible", root, (0, 0.8, max(bounds[2] * 0.5, 0.22)), tuple(float(value) for value in bounds), mats["black"], f"collision.{product['key']}", bevel=0.0, collision_proxy=True, physics="query-only")
    collider.hide_render = True
    anchor = parented_empty("Anchor_Collectible", root, str(product["anchor"]), collectible_key=product["key"], interaction="pickup", collision_node="COL_Collectible")
    anchor.location = (0, 0, 0)


def select_for_export(root: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for obj in bpy.context.scene.objects:
        ancestor = obj.parent
        while ancestor is not None and ancestor != root:
            ancestor = ancestor.parent
        if ancestor == root:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = root


def export_raw(root: bpy.types.Object, key: str) -> None:
    select_for_export(root)
    bpy.ops.export_scene.gltf(
        filepath=str(RAW / f"{key}.raw.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )


def point_camera(camera: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_render(root: bpy.types.Object, key: str) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.009, 0.011, 0.014)
    for obj in bpy.context.scene.objects:
        if obj.name.startswith("COL_") or obj.name == "LOD1_Shelf" or (obj.parent and obj.parent.name == "LOD1_Shelf"):
            obj.hide_render = True
    bpy.ops.object.light_add(type="AREA", location=(3.2, -4.0, 4.3))
    key_light = bpy.context.object
    key_light.data.energy = 750
    key_light.data.shape = "DISK"
    key_light.data.size = 4.0
    point_camera(key_light, (0, 0, 0.75))
    bpy.ops.object.light_add(type="AREA", location=(-3.0, -1.6, 2.4))
    fill = bpy.context.object
    fill.data.energy = 230
    fill.data.color = (0.23, 0.65, 0.7)
    fill.data.size = 3.0
    point_camera(fill, (0, 0, 0.7))
    bpy.ops.object.camera_add(location=(2.0, -3.15, 1.85))
    camera = bpy.context.object
    camera.data.lens = 55
    point_camera(camera, (0, 0, 0.72))
    scene.camera = camera
    scene.render.filepath = str(RENDERS / f"{key}.png")
    bpy.ops.render.render(write_still=True)


def make_graphic_layer_svg(product: dict[str, object]) -> None:
    key = str(product["key"])
    destination = PUBLIC_ROOT / key / "graphic-layer.svg"
    destination.parent.mkdir(parents=True, exist_ok=True)
    backgrounds = {
        "idcard": "#ded9ba", "badge": "#17656b", "photo": "#887961", "radio": "#ded9ba", "kit": "#ded9ba",
        "zipup": "#ded9ba", "archery": "#ded9ba", "postcard": "#ded9ba", "candle": "#ded9ba", "blanket": "#ded9ba",
    }
    symbols = {
        "idcard": "<rect x=\"58\" y=\"64\" width=\"190\" height=\"300\" rx=\"16\" fill=\"#16252a\"/><path d=\"M152 128a40 40 0 1 0 0 80a40 40 0 1 0 0-80M92 300Q152 230 212 300\" fill=\"none\" stroke=\"#5aaeb1\" stroke-width=\"18\"/><path d=\"M338 112a66 66 0 1 0 0 132a66 66 0 1 0 0-132M338 132v92M292 178h92M298 294h150M298 332h116\" fill=\"none\" stroke=\"#1b3c40\" stroke-width=\"18\" stroke-linecap=\"round\"/>",
        "badge": "<rect x=\"74\" y=\"180\" width=\"106\" height=\"120\" rx=\"14\" fill=\"#ded9ba\"/><rect x=\"203\" y=\"180\" width=\"106\" height=\"120\" rx=\"14\" fill=\"#ded9ba\"/><rect x=\"332\" y=\"180\" width=\"106\" height=\"120\" rx=\"14\" fill=\"#ded9ba\"/><path d=\"M98 232h58M227 232h58M356 232h58\" stroke=\"#16252a\" stroke-width=\"18\"/><path d=\"M84 352h35M142 352h35M213 352h35M271 352h35M342 352h35\" stroke=\"#ded9ba\" stroke-width=\"22\" stroke-linecap=\"round\"/>",
        "photo": "<rect x=\"60\" y=\"58\" width=\"236\" height=\"320\" rx=\"16\" fill=\"#16252a\"/><path d=\"M178 130a42 42 0 1 0 0 84a42 42 0 1 0 0-84M108 306Q178 222 248 306\" fill=\"none\" stroke=\"#5aaeb1\" stroke-width=\"18\"/><path d=\"M342 140h118M342 206h92M342 272h124M342 338h74\" stroke=\"#ded9ba\" stroke-width=\"18\" stroke-linecap=\"round\"/>",
        "radio": "<path d=\"M96 364h320V154H96zM164 202Q248 256 164 310M212 174Q322 256 212 338M272 146Q404 256 272 366\" fill=\"none\" stroke=\"#17656b\" stroke-width=\"22\" stroke-linecap=\"round\"/><path d=\"M326 186v142M354 186v142M382 186v142\" stroke=\"#16252a\" stroke-width=\"20\"/><path d=\"M112 406h288\" stroke=\"#5aaeb1\" stroke-width=\"18\"/>",
        "kit": "<path d=\"M112 350L256 128 400 350M148 350L256 180 364 350M184 350L256 230 328 350\" fill=\"none\" stroke=\"#1b3c40\" stroke-width=\"18\" stroke-linejoin=\"round\"/><path d=\"M96 396h320\" stroke=\"#5aaeb1\" stroke-width=\"18\"/><path d=\"M152 94h208\" stroke=\"#16252a\" stroke-width=\"22\" stroke-linecap=\"round\"/>",
        "zipup": "<path d=\"M166 106l90 74 90-74M256 118v286M140 196l72 70M372 196l-72 70\" fill=\"none\" stroke=\"#1b3c40\" stroke-width=\"22\" stroke-linecap=\"round\"/><path d=\"M130 388h252\" stroke=\"#5aaeb1\" stroke-width=\"18\"/>",
        "archery": "<path d=\"M116 154h208M116 236h208M116 318h208M380 196a60 60 0 1 0 0 120a60 60 0 1 0 0-120M380 220v72M344 256h72\" fill=\"none\" stroke=\"#1b3c40\" stroke-width=\"18\" stroke-linecap=\"round\"/>",
        "postcard": "<path d=\"M104 354Q256 238 408 354M138 278Q256 194 374 278M172 208Q256 150 340 208\" fill=\"none\" stroke=\"#17656b\" stroke-width=\"20\" stroke-linecap=\"round\"/><path d=\"M90 412h332\" stroke=\"#1b3c40\" stroke-width=\"18\"/>",
        "candle": "<path d=\"M256 112a144 144 0 1 0 0 288a144 144 0 1 0 0-288M256 160a96 96 0 1 0 0 192a96 96 0 1 0 0-192M256 208a48 48 0 1 0 0 96a48 48 0 1 0 0-96\" fill=\"none\" stroke=\"#17656b\" stroke-width=\"18\"/><path d=\"M256 70v52\" stroke=\"#a24e26\" stroke-width=\"20\" stroke-linecap=\"round\"/>",
        "blanket": "<path d=\"M100 362l152-84 160 84M100 280l152-84 160 84M100 198l152-84 160 84\" fill=\"none\" stroke=\"#1b3c40\" stroke-width=\"20\" stroke-linejoin=\"round\"/><path d=\"M96 420h320\" stroke=\"#5aaeb1\" stroke-width=\"18\"/>",
    }
    destination.write_text(
        f"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\" role=\"img\" aria-label=\"replaceable {key} graphic layer\" data-stable-key=\"{key}\">\n"
        f"  <rect width=\"512\" height=\"512\" rx=\"32\" fill=\"{backgrounds[key]}\"/>\n"
        f"  {symbols[key]}\n"
        "</svg>\n"
    )


def main() -> None:
    for product in CATALOG["products"]:
        clear_scene()
        mats = material_library()
        key = str(product["key"])
        root = parented_empty("LOD0_Hero", None, f"product.{key}", product_key=key, lod_level=0, authored_in="Blender 5.2")
        BUILDERS[str(product["model_kind"])](root, product, mats)
        add_lod_and_collision(root, product, mats)
        export_raw(root, key)
        setup_render(root, key)
        make_graphic_layer_svg(product)
        print(f"authored {key}", flush=True)


if __name__ == "__main__":
    main()
