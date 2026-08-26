#!/usr/bin/env python3
"""Deterministic Blender source build for the Last Bell review spaces.

This file deliberately creates original procedural materials and structural
school geometry.  It contains no image projection, source still, or drama
texture input.  Raw GLBs, PNGs, blend file, render checks, and bake carriers
are written below the ignored outputs/ tree; build.sh alone promotes the
optimized delivery assets into public/generated/last-bell/3d/.
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector


ROOT_DIR = Path(sys.argv[sys.argv.index("--") + 1]).resolve() if "--" in sys.argv else Path.cwd() / "outputs" / "last-bell-3d"
RAW_DIR = ROOT_DIR / "raw"
TEXTURE_DIR = RAW_DIR / "textures"
BAKE_DIR = RAW_DIR / "bakes"
RENDER_DIR = ROOT_DIR / "renders"
POLYHAVEN_DIR = RAW_DIR / "polyhaven-pbr"
DAMAGE_ATLAS_PATH = TEXTURE_DIR / "damage-atlas-v1-keyed.png"

for directory in (RAW_DIR, TEXTURE_DIR, BAKE_DIR, RENDER_DIR):
    directory.mkdir(parents=True, exist_ok=True)

# Authored/game-space is Three/glTF Y-up: (x, height=y, depth=z). Blender is
# Z-up and its exporter maps (bx, by, bz) to glTF (x, z, -y). Keep all source
# authoring calls in the game-space contract and convert only at the DCC seam.
AUTHORED_TO_BLENDER = Matrix(((1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0)))
BLENDER_TO_AUTHORED = AUTHORED_TO_BLENDER.inverted()


def to_blender_position(value: tuple[float, float, float]) -> tuple[float, float, float]:
    result = AUTHORED_TO_BLENDER @ Vector(value)
    return (result.x, result.y, result.z)


def to_blender_size(value: tuple[float, float, float]) -> tuple[float, float, float]:
    return (value[0], value[2], value[1])


def to_blender_euler(value: tuple[float, float, float]) -> tuple[float, float, float]:
    authored = Euler(value).to_matrix()
    blender = AUTHORED_TO_BLENDER @ authored @ BLENDER_TO_AUTHORED
    return blender.to_euler()


def set_authored_location(obj: bpy.types.Object, value: tuple[float, float, float]) -> None:
    obj.location = to_blender_position(value)


def set_authored_rotation(obj: bpy.types.Object, value: tuple[float, float, float]) -> None:
    obj.rotation_euler = to_blender_euler(value)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            try:
                datablocks.remove(block)
            except RuntimeError:
                pass


def tag(obj: bpy.types.Object, semantic_id: str, **extra: object) -> bpy.types.Object:
    obj["semantic_id"] = semantic_id
    for key, value in extra.items():
        obj[key] = value
    return obj


def safe_mesh_name(name: str) -> str:
    """Avoid a Blender 5.2 modifier bug on names ending in signed decimals."""
    return name.replace("-", "neg").replace(".", "p")


def group(name: str, semantic_id: str, parent: bpy.types.Object | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return tag(obj, semantic_id)


def _apply_modifier(obj: bpy.types.Object, modifier: bpy.types.Modifier) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    except RuntimeError:
        pass
    obj.select_set(False)


def ensure_uv1(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        return
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    if "LightmapUV" not in mesh.uv_layers:
        source = mesh.uv_layers.active or mesh.uv_layers[0]
        target = mesh.uv_layers.new(name="LightmapUV")
        for index, item in enumerate(source.data):
            target.data[index].uv = item.uv


def pack_lightmap_uv(obj: bpy.types.Object) -> None:
    """Give each AO ground receiver its own non-overlapping UV1 atlas."""
    ensure_uv1(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.uv_layers.active = obj.data.uv_layers["LightmapUV"]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15192, island_margin=0.03)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj["lightmap_uv"] = "LightmapUV non-overlap packed ground receiver"


def project_physical_uv(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    """Project UV0 in authored metres; UV1 remains a separate lightmap atlas."""
    if obj.type != "MESH" or not obj.data.uv_layers:
        return
    width = float(material.get("physical_texture_width_m", 1.0))
    uv_layer = obj.data.uv_layers["UVMap"] if "UVMap" in obj.data.uv_layers else obj.data.uv_layers.active
    # Every modular panel is deliberately offset in the physical material
    # space. It keeps a corridor of repeated school modules from reading as a
    # single projected wallpaper while retaining the stated metres-per-repeat.
    variant_seed = sum((index + 1) * ord(char) for index, char in enumerate(obj.name))
    offset_u = (variant_seed % 17) * 0.173
    offset_v = ((variant_seed // 17) % 19) * 0.137
    for polygon in obj.data.polygons:
        normal = BLENDER_TO_AUTHORED @ polygon.normal
        axis = max(range(3), key=lambda index: abs(normal[index]))
        for loop_index in polygon.loop_indices:
            point = BLENDER_TO_AUTHORED @ obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            if axis == 0:
                uv = (point.z / width, point.y / width)
            elif axis == 1:
                uv = (point.x / width, point.z / width)
            else:
                uv = (point.x / width, point.y / width)
            uv_layer.data[loop_index].uv = (uv[0] + offset_u, uv[1] + offset_v)


def finish_mesh(obj: bpy.types.Object, bevel: float = 0.0, smooth: bool = False) -> bpy.types.Object:
    if bevel > 0:
        modifier = obj.modifiers.new("EdgeBevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        _apply_modifier(obj, modifier)
        try:
            weighted = obj.modifiers.new("FaceWeightedNormals", "WEIGHTED_NORMAL")
            weighted.keep_sharp = True
            _apply_modifier(obj, weighted)
        except (RuntimeError, TypeError):
            pass
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    ensure_uv1(obj)
    return obj


def box(name: str, parent: bpy.types.Object, location: tuple[float, float, float], size: tuple[float, float, float], material: bpy.types.Material, semantic_id: str, bevel: float = 0.018) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=to_blender_position(location))
    obj = bpy.context.object
    obj.name = safe_mesh_name(name)
    obj.dimensions = to_blender_size(size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    project_physical_uv(obj, material)
    if material.name == "Wired_Glass":
        # Safety-glass texture is a surface cue, never a light-gobo. In both
        # the stills and runtime it must not stripe adjacent plaster/floor.
        obj.visible_shadow = False
    obj.parent = parent
    tag(obj, semantic_id)
    return finish_mesh(obj, bevel=bevel)


def jagged_patch(name: str, parent: bpy.types.Object, points: list[tuple[float, float, float]], material: bpy.types.Material, semantic_id: str) -> bpy.types.Object:
    """Make a thin but real irregular damage layer, never a zero-depth card."""
    authored = [Vector(point) for point in points]
    normal = (authored[1] - authored[0]).cross(authored[2] - authored[0]).normalized()
    # Give peeled paint, exposed core, soot, and fallen signage a physical
    # back face and edge so they catch contact light rather than read as decals.
    depth = 0.018
    front = [point + normal * depth * 0.5 for point in authored]
    back = [point - normal * depth * 0.5 for point in authored]
    count = len(points)
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata([to_blender_position(tuple(point)) for point in front + back], [], [list(range(count)), list(range(count * 2 - 1, count - 1, -1))] + [[index, (index + 1) % count, (index + 1) % count + count, index + count] for index in range(count)])
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    tag(obj, semantic_id)
    finish_mesh(obj, bevel=0.0, smooth=False)
    project_physical_uv(obj, material)
    return obj


def damage_decal_patch(name: str, parent: bpy.types.Object, points: list[tuple[float, float, float]], material: bpy.types.Material, cell: tuple[int, int], semantic_id: str, facing: tuple[float, float, float]) -> bpy.types.Object:
    """Attach one keyed atlas crop as a thin, irregular physical layer.

    Damage geometry always supplies the macro break; this only adds local
    soot, cracks, and dust so the authored atlas never becomes a projection
    shortcut. Every crop shares one blended material, keeping the transparent
    material/draw budget bounded.
    """
    if len(points) != 4:
        raise ValueError(f"{name}: keyed atlas decals require four fixed UV corners")
    authored = [Vector(point) for point in points]
    normal = (authored[1] - authored[0]).cross(authored[2] - authored[0]).normalized()
    target_normal = Vector(facing).normalized()
    if normal.dot(target_normal) < 0.0:
        authored.reverse()
        normal = (authored[1] - authored[0]).cross(authored[2] - authored[0]).normalized()
    depth = 0.006
    front = [point + normal * depth * 0.5 for point in authored]
    back = [point - normal * depth * 0.5 for point in authored]
    count = len(points)
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    faces = [list(range(count)), list(range(count * 2 - 1, count - 1, -1))] + [[index, (index + 1) % count, (index + 1) % count + count, index + count] for index in range(count)]
    mesh.from_pydata([to_blender_position(tuple(point)) for point in front + back], [], faces)
    mesh.materials.append(material)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    cell_u, cell_row = cell
    gutter = 3.0 / 512.0
    u0, u1 = cell_u / 4.0 + gutter, (cell_u + 1) / 4.0 - gutter
    v0, v1 = (3 - cell_row) / 4.0 + gutter, (4 - cell_row) / 4.0 - gutter
    corners = ((u0, v0), (u1, v0), (u1, v1), (u0, v1))
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index % count
            uv_layer.data[loop_index].uv = corners[vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    tag(obj, semantic_id, atlas_cell=f"{cell_u},{cell_row}", authored_damage_layer=True)
    finish_mesh(obj, bevel=0.0, smooth=False)
    ensure_uv1(obj)
    return obj


def fractured_slab(name: str, parent: bpy.types.Object, location: tuple[float, float, float], footprint: list[tuple[float, float]], thickness: float, material: bpy.types.Material, semantic_id: str) -> bpy.types.Object:
    """Make a chipped, thick floor fragment with a non-rectangular outline."""
    bottom = [(x, 0.0, z) for x, z in footprint]
    top = [(x, thickness, z) for x, _, z in bottom]
    count = len(footprint)
    vertices = [to_blender_position(point) for point in bottom + top]
    faces = [list(range(count - 1, -1, -1)), list(range(count, count * 2))]
    for index in range(count):
        following = (index + 1) % count
        faces.append([index, following, following + count, index + count])
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    set_authored_location(obj, location)
    obj.parent = parent
    tag(obj, semantic_id)
    project_physical_uv(obj, material)
    return finish_mesh(obj, bevel=0.012, smooth=False)


def jagged_wall_section(name: str, parent: bpy.types.Object, outline: list[tuple[float, float]], front_z: float, depth: float, material: bpy.types.Material, semantic_id: str) -> bpy.types.Object:
    """Extrude a wall break in depth so it reads as missing structure, not a decal.

    ``outline`` is an authored x/y silhouette seen from the room.  The outer
    paint, recessed core and soot can share its damage origin while each has a
    different actual z depth.  This is intentionally not a zero-thickness
    card layered on an intact doorway wall.
    """
    front = [(x, y, front_z) for x, y in outline]
    back = [(x, y, front_z + depth) for x, y in outline]
    count = len(outline)
    faces = [list(range(count - 1, -1, -1)), list(range(count, count * 2))]
    for index in range(count):
        following = (index + 1) % count
        faces.append([index, following, following + count, index + count])
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata([to_blender_position(point) for point in front + back], [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    tag(obj, semantic_id)
    project_physical_uv(obj, material)
    return finish_mesh(obj, bevel=0.012, smooth=False)


def cylinder(name: str, parent: bpy.types.Object, location: tuple[float, float, float], radius: float, depth: float, material: bpy.types.Material, semantic_id: str, rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=depth, location=to_blender_position(location), rotation=to_blender_euler(rotation))
    obj = bpy.context.object
    obj.name = safe_mesh_name(name)
    obj.data.materials.append(material)
    project_physical_uv(obj, material)
    obj.parent = parent
    tag(obj, semantic_id)
    return finish_mesh(obj, bevel=min(radius * 0.28, 0.012), smooth=True)


def rubble(name: str, parent: bpy.types.Object, location: tuple[float, float, float], scale: tuple[float, float, float], material: bpy.types.Material, semantic_id: str, rotation: float) -> bpy.types.Object:
    # Deliberately faceted demolition fragments, not soft generic stones.
    bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=1.0, radius2=0.32, depth=0.78, location=to_blender_position(location))
    obj = bpy.context.object
    obj.name = safe_mesh_name(name)
    obj.scale = to_blender_size(scale)
    set_authored_rotation(obj, (rotation * 0.16, rotation, rotation * 0.11))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    project_physical_uv(obj, material)
    obj.parent = parent
    tag(obj, semantic_id)
    return finish_mesh(obj, bevel=0.008, smooth=False)


def write_texture(name: str, kind: str, base: tuple[float, float, float], metallic: float, size: int, seed: int) -> dict[str, bpy.types.Image]:
    """Create deterministic original base color, normal, and packed ORM maps."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    u = xx / float(size)
    v = yy / float(size)
    # Deterministic value noise: a blurred random lattice makes broad dust
    # and stain variation without a periodic/sine direction that can turn
    # into screen-space diagonal moire in long corridor shots.
    lattice = max(18, size // 28)
    coarse = rng.normal(0.0, 1.0, (lattice + 1, lattice + 1)).astype(np.float32)
    gx = u * lattice
    gy = v * lattice
    x0 = np.floor(gx).astype(np.int32)
    y0 = np.floor(gy).astype(np.int32)
    tx = gx - x0
    ty = gy - y0
    tx = tx * tx * (3.0 - 2.0 * tx)
    ty = ty * ty * (3.0 - 2.0 * ty)
    c00 = coarse[y0, x0]
    c10 = coarse[y0, x0 + 1]
    c01 = coarse[y0 + 1, x0]
    c11 = coarse[y0 + 1, x0 + 1]
    macro = ((c00 * (1.0 - tx) + c10 * tx) * (1.0 - ty) + (c01 * (1.0 - tx) + c11 * tx) * ty)
    macro = np.clip(macro * 0.14, -0.18, 0.18)
    # A second smooth stochastic octave replaces per-pixel grain: this is
    # intentionally mip-safe at 720p rather than a noisy procedural screen.
    detail_lattice = max(24, size // 20)
    detail_grid = rng.normal(0.0, 1.0, (detail_lattice + 1, detail_lattice + 1)).astype(np.float32)
    dx = u * detail_lattice
    dy = v * detail_lattice
    ix = np.floor(dx).astype(np.int32)
    iy = np.floor(dy).astype(np.int32)
    fx = dx - ix
    fy = dy - iy
    fx = fx * fx * (3.0 - 2.0 * fx)
    fy = fy * fy * (3.0 - 2.0 * fy)
    grain = ((detail_grid[iy, ix] * (1.0 - fx) + detail_grid[iy, ix + 1] * fx) * (1.0 - fy) + (detail_grid[iy + 1, ix] * (1.0 - fx) + detail_grid[iy + 1, ix + 1] * fx) * fy) * 0.035
    # Sparse scuffs derive from the filtered octave too — no independent
    # pixel-frequency noise remains in baseColor, normal, or ORM generation.
    scratch = np.maximum(0.0, grain - 0.014) * 0.28
    # Broad material separation lives in albedo and roughness.  The surface
    # height is deliberately restrained: a destroyed school is dusty and
    # chipped, not made from puffy foam.
    height = np.clip(0.52 + macro * 0.055 + grain * 0.075 - scratch * 0.055, 0.0, 1.0)
    color_noise = macro * 0.10 + grain * 0.12 - scratch * 0.13

    if kind == "brick":
        row = np.floor(v * 13.0).astype(np.int32)
        stagger = (row % 2) * 0.5
        mortar_h = np.mod(v * 13.0, 1.0) < 0.105
        mortar_v = np.mod(u * 8.2 + stagger, 1.0) < 0.052
        mortar = mortar_h | mortar_v
        color_noise = color_noise + np.where(mortar, -0.45, 0.08)
        height = np.where(mortar, height * 0.46, height + 0.13)
    elif kind == "tile":
        # 36 repeat cells over the room floor make a roughly 300–390mm
        # school tile, with darker grout and dust collecting at its edges.
        seam = (np.mod(u * 36.0, 1.0) < 0.028) | (np.mod(v * 36.0, 1.0) < 0.028)
        color_noise = color_noise + np.where(seam, -0.34, 0.0)
        height = np.where(seam, height * 0.5, height)
    elif kind == "aluminium":
        color_noise = color_noise * 0.22 + grain * 0.28
    elif kind == "glass":
        # Fine, low-contrast safety-wire cells communicate damaged wired
        # glazing without turning into diagonal moire stripes in a 720p shot.
        # The wire identity is carried by semantic material/node names and
        # dark, damaged glazing; no visible texture grid survives 720p.
        color_noise = color_noise * 0.08
        height = height * 0.985
    elif kind == "blackboard":
        color_noise = color_noise * 0.12 + grain * 0.12
    elif kind == "wood":
        color_noise = color_noise * 0.32 + grain * 0.45
    elif kind == "acoustic":
        flecks = np.maximum(0.0, grain - 0.012) * 0.45
        color_noise = color_noise * 0.14 + flecks
        height = np.clip(0.51 + grain * 0.035 + flecks * 0.08, 0.0, 1.0)

    rgb = np.stack([np.clip(channel + color_noise, 0.0, 1.0) for channel in base], axis=-1)
    # Safety glass exposes damaged framing and dark depth beyond; it must not
    # collapse into a cyan opaque card.  The texture carries no dense wire
    # pattern, because the sparse geometry on the hero door is mip-safe.
    alpha = np.full((size, size, 1), 0.24 if kind == "glass" else 1.0, dtype=np.float32)
    base_pixels = np.concatenate([rgb, alpha], axis=-1).astype(np.float32)
    dy, dx = np.gradient(height)
    nx = np.clip(-dx * 3.0, -0.42, 0.42)
    ny = np.clip(-dy * 3.0, -0.42, 0.42)
    nz = np.sqrt(np.maximum(0.02, 1.0 - nx * nx - ny * ny))
    normal_pixels = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, np.ones_like(nx)], axis=-1).astype(np.float32)
    roughness = np.clip(0.48 + (1.0 - metallic) * 0.3 + macro * 0.15 + scratch * 0.13, 0.22, 0.98)
    ao = np.clip(0.93 - (1.0 - height) * 0.34 - np.maximum(0.0, -macro) * 0.13, 0.42, 1.0)
    orm_pixels = np.stack([ao, roughness, np.full_like(ao, metallic), np.ones_like(ao)], axis=-1).astype(np.float32)

    result: dict[str, bpy.types.Image] = {}
    for suffix, pixels, colorspace in (("basecolor", base_pixels, "sRGB"), ("normal", normal_pixels, "Non-Color"), ("orm", orm_pixels, "Non-Color")):
        image = bpy.data.images.new(f"{name}-{suffix}", width=size, height=size, alpha=True, float_buffer=False)
        texture_path = TEXTURE_DIR / f"{name}-{suffix}.png"
        image.filepath_raw = str(texture_path)
        image.filepath = str(texture_path)
        image.file_format = "PNG"
        image.colorspace_settings.name = colorspace
        image.pixels.foreach_set(pixels.reshape(-1))
        image.save()
        # Reload the written source PNG. Blender's glTF exporter otherwise
        # substitutes a 1x1 generated-image placeholder for an in-memory map.
        bpy.data.images.remove(image)
        exported_image = bpy.data.images.load(str(texture_path), check_existing=False)
        exported_image.name = f"{name}-{suffix}"
        exported_image.colorspace_settings.name = colorspace
        result[suffix] = exported_image
    return result


def load_polyhaven_texture(material_name: str) -> dict[str, bpy.types.Image]:
    """Load approved 512px CC0 PBR maps vendored by fetch-polyhaven-pbr.mjs."""
    stem = material_name.lower().replace("_", "-")
    result: dict[str, bpy.types.Image] = {}
    for suffix, colorspace in (("basecolor", "sRGB"), ("normal", "Non-Color"), ("orm", "Non-Color")):
        path = POLYHAVEN_DIR / f"{stem}-{suffix}.png"
        if not path.exists():
            raise RuntimeError(f"Missing approved Poly Haven map for {material_name}: {path}")
        image = bpy.data.images.load(str(path), check_existing=False)
        image.name = f"polyhaven-{stem}-{suffix}"
        image.colorspace_settings.name = colorspace
        result[suffix] = image
    return result


def make_damage_atlas_material() -> bpy.types.Material:
    """Load the whiteness-keyed, project-authored atlas as one decal material."""
    if not DAMAGE_ATLAS_PATH.exists():
        raise RuntimeError(f"Missing prepared damage atlas: {DAMAGE_ATLAS_PATH}. Run prepare-damage-atlas.mjs first.")
    image = bpy.data.images.load(str(DAMAGE_ATLAS_PATH), check_existing=False)
    image.name = "last-bell-damage-atlas-v1-keyed"
    image.colorspace_settings.name = "sRGB"
    image.alpha_mode = "STRAIGHT"
    material = bpy.data.materials.new("Damage_Decal_Atlas")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexImage")
    texture.name = "Damage_Decal_Atlas_Keyed"
    texture.image = image
    texture.interpolation = "Linear"
    alpha_gain = nodes.new("ShaderNodeMath")
    alpha_gain.operation = "MULTIPLY"
    alpha_gain.name = "Damage_Decal_Atlas_Opacity"
    alpha_gain.inputs[1].default_value = 0.42
    links.new(texture.outputs["Color"], principled.inputs["Base Color"])
    links.new(texture.outputs["Alpha"], alpha_gain.inputs[0])
    links.new(alpha_gain.outputs[0], principled.inputs["Alpha"])
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    output = nodes.get("Material Output")
    links.new(alpha_gain.outputs[0], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(principled.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs["Surface"])
    principled.inputs["Roughness"].default_value = 0.82
    principled.inputs["Metallic"].default_value = 0.0
    material.surface_render_method = "DITHERED"
    material.use_backface_culling = True
    material.use_transparent_shadow = False
    material["damage_atlas"] = "AI-authored v1 keyed; geometry remains damage source"
    material["transparent_budget"] = "one shared decal material"
    return material


def lowpass_normal_texture(name: str, source: bpy.types.Image) -> bpy.types.Image:
    """Box-filter a normal map to 128px before it reaches a distant surface.

    This preserves a valid glTF normalTexture while avoiding aliasing from
    high-frequency 512/1024 source normals in long, shallow game views.
    """
    width, height = source.size
    target = min(128, width, height)
    pixels = np.asarray(source.pixels[:], dtype=np.float32).reshape((height, width, 4))
    if width % target == 0 and height % target == 0:
        block_x = width // target
        block_y = height // target
        filtered = pixels.reshape((target, block_y, target, block_x, 4)).mean(axis=(1, 3))
    else:
        # All current sources are powers of two, but retain a deterministic
        # nearest fallback for a future non-divisible CC0 input.
        ys = np.linspace(0, height - 1, target).astype(np.int32)
        xs = np.linspace(0, width - 1, target).astype(np.int32)
        filtered = pixels[ys][:, xs]
    # Keep normal direction conservative after filtering. This is not a flat
    # placeholder: it retains large material relief without screen shimmer.
    filtered[..., 0:2] = 0.5 + (filtered[..., 0:2] - 0.5) * 0.34
    filtered[..., 2] = np.maximum(filtered[..., 2], 0.965)
    filtered[..., 3] = 1.0
    image = bpy.data.images.new(f"{name}-normal-lowpass", width=target, height=target, alpha=True, float_buffer=False)
    path = TEXTURE_DIR / f"{name}-normal-lowpass.png"
    image.filepath_raw = str(path)
    image.filepath = str(path)
    image.file_format = "PNG"
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(filtered.astype(np.float32).reshape(-1))
    image.save()
    bpy.data.images.remove(image)
    result = bpy.data.images.load(str(path), check_existing=False)
    result.name = f"{name}-normal-lowpass"
    result.colorspace_settings.name = "Non-Color"
    return result


def prepare_hero_material(material: bpy.types.Material, label: str) -> None:
    """Keep imported CC0 hero props PBR-correct and distance-safe."""
    material.use_nodes = True
    material.use_backface_culling = True
    material["pbr_maps"] = "approved-polyhaven-cc0 baseColor + lowpass normal + packed ORM"
    material["physical_texture_width_m"] = 0.6
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    normal = next((node for node in nodes if node.bl_idname == "ShaderNodeNormalMap"), None)
    if normal:
        normal.inputs["Strength"].default_value = 0.10
        for link in list(normal.inputs["Color"].links):
            if getattr(link.from_node, "image", None):
                link.from_node.image = lowpass_normal_texture(f"{label}-{material.name}", link.from_node.image)
    principled = next((node for node in nodes if node.bl_idname == "ShaderNodeBsdfPrincipled"), None)
    if not principled:
        return
    orm = None
    for node in nodes:
        if node.bl_idname != "ShaderNodeTexImage":
            continue
        if any(link.to_node == principled and link.to_socket.name in {"Roughness", "Metallic"} for link in node.outputs["Color"].links):
            orm = node
        if any(link.to_node.bl_idname == "ShaderNodeSeparateColor" and any(next_link.to_node == principled for next_link in link.to_node.outputs["Green"].links + link.to_node.outputs["Blue"].links) for link in node.outputs["Color"].links):
            orm = node
    if orm:
        group = bpy.data.node_groups.new(f"{label}_{material.name}_glTF_Material_Output", "ShaderNodeTree")
        group.name = "glTF Material Output"
        group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        output = nodes.new("ShaderNodeGroup")
        output.name = "glTF Material Output"
        output.node_tree = group
        links.new(orm.outputs["Color"], output.inputs["Occlusion"])


def import_hero_prop(parent: bpy.types.Object, name: str, model_id: str, location: tuple[float, float, float], rotation: float, toppled: bool = False, source: bpy.types.Object | None = None) -> bpy.types.Object:
    """Import one CC0 hero prop, then make mesh-linked repetition if needed."""
    root = group(name, "prop.hyosan.cc0-hero-school-furniture", parent)
    set_authored_location(root, location)
    collapse_pitch = 0.38 if toppled and "Desk" in name else (0.16 if toppled else 0.0)
    collapse_roll = -0.34 if toppled and "Desk" in name else (-0.22 if toppled else 0.0)
    set_authored_rotation(root, (collapse_pitch, rotation, collapse_roll))
    if source is None:
        path = POLYHAVEN_DIR / "models" / model_id / f"{model_id}_1k.gltf"
        if not path.exists():
            raise RuntimeError(f"Missing approved Poly Haven hero model: {path}")
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(path))
        imported = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
        if not imported:
            raise RuntimeError(f"Poly Haven import produced no mesh: {model_id}")
        mesh = imported[0]
        for material in mesh.data.materials:
            if material:
                prepare_hero_material(material, name)
    else:
        mesh = source.copy()
        mesh.data = source.data
        bpy.context.collection.objects.link(mesh)
    mesh.name = f"{name}_Mesh"
    mesh.parent = root
    mesh.visible_shadow = True
    tag(mesh, "prop.hyosan.cc0-hero-school-furniture.mesh", source_model=model_id, linked_instance=source is not None)
    ensure_uv1(mesh)
    return root


def make_material(name: str, textures: dict[str, bpy.types.Image], emission: tuple[float, float, float] | None = None, transmission: bool = False) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (0.4, 0.4, 0.4, 1.0)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    base_node = nodes.new("ShaderNodeTexImage")
    base_node.name = f"{name}_BaseColor"
    base_node.image = textures["basecolor"]
    orm_node = nodes.new("ShaderNodeTexImage")
    orm_node.name = f"{name}_ORM"
    orm_node.image = textures["orm"]
    normal_node = nodes.new("ShaderNodeTexImage")
    normal_node.name = f"{name}_Normal"
    normal_node.image = lowpass_normal_texture(name.lower().replace("_", "-"), textures["normal"])
    separate = nodes.new("ShaderNodeSeparateColor")
    normal_map = nodes.new("ShaderNodeNormalMap")
    # Blender's glTF exporter recognises this exact custom group name and
    # serialises the ORM image's red channel as `occlusionTexture`.
    gltf_group = bpy.data.node_groups.new(f"{name}_glTF_Material_Output", "ShaderNodeTree")
    gltf_group.name = "glTF Material Output"
    gltf_group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    gltf_output = nodes.new("ShaderNodeGroup")
    gltf_output.name = "glTF Material Output"
    gltf_output.node_tree = gltf_group
    links.new(base_node.outputs["Color"], principled.inputs["Base Color"])
    if name == "Broken_BrickWall":
        # Keep exposed strike cores old, cold and desaturated. The raw CC0 map
        # is an input material, not a claim that this ruined school brick is
        # freshly laid orange masonry.
        hue_sat = nodes.new("ShaderNodeHueSaturation")
        hue_sat.name = "Broken_BrickWall_Desaturate"
        hue_sat.inputs["Saturation"].default_value = 0.44
        hue_sat.inputs["Value"].default_value = 0.42
        links.new(base_node.outputs["Color"], hue_sat.inputs["Color"])
        links.new(hue_sat.outputs["Color"], principled.inputs["Base Color"])
    links.new(orm_node.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], principled.inputs["Roughness"])
    links.new(separate.outputs["Blue"], principled.inputs["Metallic"])
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
    links.new(orm_node.outputs["Color"], gltf_output.inputs["Occlusion"])
    # Paint, plaster, and floor read primarily through roughness/dirt; broad
    # noisy normal maps were intentionally reduced to avoid foam-like walls.
    if name == "Wired_Glass":
        normal_map.inputs["Strength"].default_value = 0.04
    elif name in {"Smoked_Aluminium", "Door_RustedMetal", "Worn_Wood"}:
        normal_map.inputs["Strength"].default_value = 0.10
    else:
        normal_map.inputs["Strength"].default_value = 0.075
    if emission:
        principled.inputs["Emission Color"].default_value = (*emission, 1.0)
        principled.inputs["Emission Strength"].default_value = 0.16
    if transmission:
        # The only translucent material in the kit is wired safety glass.
        # Opaque materials must not inherit a BLEND alpha mode or two-sided
        # state: it costs fill rate and makes enclosed architecture leak.
        links.new(base_node.outputs["Alpha"], principled.inputs["Alpha"])
        principled.inputs["Transmission Weight"].default_value = 0.18
        material.surface_render_method = "BLENDED"
        material.use_backface_culling = False
        material.use_transparent_shadow = False
    else:
        material.use_backface_culling = True
    material["pbr_maps"] = "baseColor + normal + packed ORM"
    return material


def make_material_library() -> dict[str, bpy.types.Material]:
    physical_width_m = {
        "Dirty_Floor_Tile": 2.0,
        "Charred_Plaster": 1.8,
        "Smoked_Aluminium": 1.0,
        "Worn_Wood": 0.6,
        "Exposed_Brick": 1.4,
        "Wired_Glass": 0.65,
        "Blackboard": 1.2,
        "Hyosan_Yellow": 1.5,
        "School_PaintedLower": 1.8,
        "School_UpperPaint": 1.8,
        "Damaged_AcousticCeiling": 0.8,
        "Door_RustedMetal": 1.0,
        "Concrete_Debris": 1.2,
        "Broken_BrickWall": 1.4,
    }
    specs = {
        "Charred_Plaster": ("charred-plaster", "plaster", (0.14, 0.20, 0.20), 0.02, 1024, 1101, None, False, True),
        "Exposed_Brick": ("exposed-brick", "brick", (0.29, 0.17, 0.12), 0.0, 1024, 1102, None, False, True),
        "Dirty_Floor_Tile": ("dirty-floor-tile", "tile", (0.16, 0.23, 0.24), 0.03, 1024, 1103, None, False, True),
        "Smoked_Aluminium": ("smoked-aluminium", "aluminium", (0.20, 0.30, 0.30), 0.74, 512, 1104, None, False, True),
        "Wired_Glass": ("wired-glass", "glass", (0.018, 0.07, 0.075), 0.08, 512, 1105, (0.004, 0.016, 0.018), True, False),
        "Worn_Wood": ("worn-wood", "wood", (0.30, 0.20, 0.12), 0.02, 1024, 1106, None, False, True),
        "Blackboard": ("blackboard", "blackboard", (0.025, 0.075, 0.064), 0.0, 1024, 1107, None, False, False),
        "Hyosan_Yellow": ("hyosan-yellow-paint", "plaster", (0.63, 0.43, 0.055), 0.03, 512, 1108, None, False, False),
        "School_PaintedLower": ("school-painted-lower", "plaster", (0.055, 0.14, 0.15), 0.02, 1024, 1109, None, False, False),
        "School_UpperPaint": ("school-upper-paint", "plaster", (0.48, 0.50, 0.46), 0.01, 1024, 1110, None, False, False),
        "Damaged_AcousticCeiling": ("damaged-acoustic-ceiling", "acoustic", (0.20, 0.23, 0.21), 0.0, 512, 1111, None, False, False),
        "Door_RustedMetal": ("door-rusted-metal", "aluminium", (0.095, 0.14, 0.13), 0.64, 512, 1112, None, False, False),
        "Concrete_Debris": ("concrete-debris", "plaster", (0.22, 0.23, 0.21), 0.0, 512, 1114, None, False, True),
        "Broken_BrickWall": ("broken-brickwall", "brick", (0.26, 0.14, 0.10), 0.0, 512, 1115, None, False, True),
    }
    library = {}
    for material_name, values in specs.items():
        external = values[8]
        if external:
            print(f"Loading Poly Haven CC0 PBR material: {material_name}", flush=True)
            textures = load_polyhaven_texture(material_name)
        else:
            print(f"Creating procedural PBR material: {material_name}", flush=True)
            textures = write_texture(*values[:6])
        material = make_material(material_name, textures, emission=values[6], transmission=values[7])
        material["physical_texture_width_m"] = physical_width_m[material_name]
        material["uv0_projection"] = "authored-metre-box-projection"
        library[material_name] = material
    library["Damage_Decal_Atlas"] = make_damage_atlas_material()
    return library


def add_desk(parent: bpy.types.Object, name: str, location: tuple[float, float, float], rotation: float, materials: dict[str, bpy.types.Material], toppled: bool = False) -> bpy.types.Object:
    desk = group(name, "prop.hyosan.destroyed-desk", parent)
    set_authored_location(desk, location)
    # A modest lean keeps the prop visibly wrecked while preserving the
    # familiar desk silhouette — full 90-degree parent rolls turned the
    # previous version into anonymous bars in the cold-open camera.
    set_authored_rotation(desk, (0.0, rotation, 0.24 if toppled else 0.0))
    box(f"{name}_Top", desk, (0, 0.74, 0), (1.22, 0.075, 0.56), materials["Worn_Wood"], "prop.hyosan.desk.top", 0.022)
    box(f"{name}_FrontPanel", desk, (0, 0.52, 0.245), (0.94, 0.34, 0.035), materials["Door_RustedMetal"], "prop.hyosan.desk.front-panel", 0.008)
    box(f"{name}_BackRail", desk, (0, 0.48, -0.235), (1.05, 0.05, 0.028), materials["Smoked_Aluminium"], "prop.hyosan.desk.back-rail", 0.006)
    for sx in (-0.56, 0.56):
        for sz in (-0.22, 0.22):
            cylinder(f"{name}_Leg_{sx}_{sz}", desk, (sx, 0.36, sz), 0.022, 0.70, materials["Smoked_Aluminium"], "prop.hyosan.desk.leg")
    return desk


def add_chair(parent: bpy.types.Object, name: str, location: tuple[float, float, float], rotation: float, materials: dict[str, bpy.types.Material], toppled: bool = False) -> bpy.types.Object:
    chair = group(name, "prop.hyosan.student-chair", parent)
    set_authored_location(chair, location)
    set_authored_rotation(chair, (0.16 if toppled else 0.0, rotation, -0.30 if toppled else 0.0))
    box(f"{name}_Seat", chair, (0.0, 0.42, 0.0), (0.53, 0.055, 0.50), materials["Worn_Wood"], "prop.hyosan.chair.seat", 0.014)
    box(f"{name}_Back", chair, (0.0, 0.75, 0.21), (0.53, 0.43, 0.045), materials["Door_RustedMetal"], "prop.hyosan.chair.back", 0.014)
    for sx in (-0.25, 0.25):
        cylinder(f"{name}_Leg_{sx}", chair, (sx, 0.21, -0.16), 0.018, 0.42, materials["Smoked_Aluminium"], "prop.hyosan.chair.leg")
        cylinder(f"{name}_RearLeg_{sx}", chair, (sx, 0.30, 0.18), 0.018, 0.60, materials["Smoked_Aluminium"], "prop.hyosan.chair.rear-leg")
    return chair


def entry_text(parent: bpy.types.Object, materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """Author split Korean text on the two physically separated door leaves."""
    font_path = Path("/System/Library/Fonts/AppleSDGothicNeo.ttc")
    font = bpy.data.fonts.load(str(font_path), check_existing=True) if font_path.exists() else bpy.data.fonts.load(str(Path("/System/Library/AssetsV2/com_apple_MobileAsset_Font8/7a0b5c0f3c1d41c4c52a33343496c9c65ad52c50.asset/AssetData/NanumGothic.ttc")), check_existing=True)
    result = group("Entry_HyosanSchoolName", "architecture.hyosan.entrance.school-name", parent)
    # Blender's Y-up export/camera conversion mirrors this surface in the
    # exterior review view; arrange the two physical leaves so the rendered
    # Korean reads left-to-right as `효산고등학교` across the interrupted band.
    for index, (label, text, x) in enumerate((("L", "등학교", -0.55), ("R", "효산고", 0.55))):
        curve = bpy.data.curves.new(f"Entry_HyosanSchoolName_{label}_Curve", "FONT")
        curve.body = text
        curve.font = font
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        curve.size = 0.14
        curve.extrude = 0.008
        curve.bevel_depth = 0.002
        curve.resolution_u = 8
        obj = bpy.data.objects.new(f"Entry_HyosanSchoolName_{label}", curve)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(materials["Blackboard"])
        obj.location = to_blender_position((x, 2.35, 2.242))
        obj.rotation_euler = (math.pi / 2, 0.0, math.pi)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.convert(target="MESH")
        obj = bpy.context.object
        obj.name = f"Entry_HyosanSchoolName_{label}"
        obj.parent = result
        tag(obj, "architecture.hyosan.entrance.school-name-text", text=text, panel=label)
        finish_mesh(obj, bevel=0.0, smooth=False)
    return result


def add_window(parent: bpy.types.Object, name: str, z: float, materials: dict[str, bpy.types.Material], missing: bool = False, corridor: bool = False) -> bpy.types.Object:
    # For the review camera, the continuous x=+ side becomes screen-left;
    # reserve it for the cyan window run, with classroom doors opposite.
    x = -2.9 if corridor else -6.9
    width = 2.55 if not corridor else 2.75
    window = group(name, "architecture.hyosan.broken-window", parent)
    # In the corridor this is a real opening: moonlight comes from an area
    # source outside its frame, never from a dark/cyan solid card that becomes
    # a trapezoid in an oblique review camera. Start-room windows retain a
    # black exterior void because their frame is seen near-frontally.
    if not corridor:
        box(f"{name}_Void", window, (x, 2.24, z), (0.06, 1.95, width), materials["Blackboard"], "architecture.hyosan.window.void", 0.0)
    glass = group(f"{name}_Glass", "material.hyosan.wired-glass", window)
    if not missing:
        box(f"{name}_GlassPane", glass, (x + 0.026, 2.24, z), (0.018, 1.72, width - 0.22), materials["Wired_Glass"], "architecture.hyosan.window.wired-glass", 0.001)
    else:
        for index, (dy, dz, sx, sy) in enumerate(((0.48, -0.5, 0.45, 0.3), (-0.2, 0.44, 0.36, 0.42), (-0.62, -0.12, 0.5, 0.16))):
            shard = box(f"{name}_Shard_{index}", glass, (x + 0.028, 2.24 + dy, z + dz), (0.025, sy, sx), materials["Wired_Glass"], "architecture.hyosan.window.glass-shard", 0.001)
            set_authored_rotation(shard, (0.3 * (index + 1), 0.0, 0.0))
    for dz in (-width / 2 + 0.07, 0.0, width / 2 - 0.07):
        box(f"{name}_Mullion_{dz}", window, (x + 0.06, 2.24, z + dz), (0.11, 2.12, 0.08), materials["Smoked_Aluminium"], "architecture.hyosan.window.frame", 0.014)
    box(f"{name}_Header", window, (x + 0.06, 3.19, z), (0.11, 0.08, width), materials["Smoked_Aluminium"], "architecture.hyosan.window.frame", 0.012)
    box(f"{name}_Sill", window, (x + 0.06, 1.5, z), (0.12, 0.08, width), materials["Smoked_Aluminium"], "architecture.hyosan.window.sill", 0.012)
    return window


def add_corridor_classroom_door(parent: bpy.types.Object, name: str, z: float, materials: dict[str, bpy.types.Material], damaged: bool = False) -> bpy.types.Object:
    door = group(name, "architecture.hyosan.corridor.classroom-door", parent)
    # These repeated room doors provide the dark opposite-side rhythm while
    # keeping the center corridor x[-1.1,1.1] open for player movement.
    box(f"{name}_Recess", door, (2.83, 1.92, z), (0.04, 2.75, 1.58), materials["Blackboard"], "architecture.hyosan.corridor.door-recess", 0.003)
    box(f"{name}_FrameTop", door, (2.76, 3.30, z), (0.12, 0.10, 1.72), materials["Door_RustedMetal"], "architecture.hyosan.corridor.door-frame", 0.012)
    for dz in (-0.81, 0.81):
        frame = box(f"{name}_Frame_{'L' if dz < 0 else 'R'}", door, (2.76, 1.95, z + dz), (0.12, 2.76, 0.10), materials["Door_RustedMetal"], "architecture.hyosan.corridor.door-frame", 0.012)
        if damaged and dz > 0:
            set_authored_rotation(frame, (0.08, 0.0, -0.07))
    pane_length = 0.64 if damaged else 1.42
    # Split the leaf into lower metal and an upper wired-glass transom. This
    # gives every four-metre module a legible school-door rhythm in the dark.
    box(f"{name}_LowerPanel", door, (2.74, 1.18, z + (0.28 if damaged else 0.0)), (0.06, 1.38, pane_length), materials["Door_RustedMetal"], "architecture.hyosan.corridor.door.lower-metal-panel", 0.014)
    box(f"{name}_Transom", door, (2.735, 2.64, z + (0.28 if damaged else 0.0)), (0.024, 0.68, max(0.28, pane_length - 0.12)), materials["Wired_Glass"], "architecture.hyosan.corridor.door.upper-wired-glass-transom", 0.002)
    box(f"{name}_TransomRail", door, (2.70, 2.27, z + (0.28 if damaged else 0.0)), (0.10, 0.08, pane_length), materials["Smoked_Aluminium"], "architecture.hyosan.corridor.door.transom-rail", 0.008)
    box(f"{name}_Kick", door, (2.69, 0.70, z), (0.10, 0.12, 1.42), materials["Smoked_Aluminium"], "architecture.hyosan.corridor.door-kickplate", 0.010)
    return door


def create_start_room(materials: dict[str, bpy.types.Material]) -> tuple[bpy.types.Object, bpy.types.Object]:
    root = group("StartRoom_Root", "environment.hyosan.start-room", None)
    tag(root, "environment.hyosan.start-room", bounds="x[-7,7] z[-2,13.2] y[0,4]", clear_lane="x[-1.1,1.1] z[4,13]")
    floor = box("StartRoom_DirtyTileFloor", root, (0, -0.08, 5.6), (14.0, 0.16, 15.2), materials["Dirty_Floor_Tile"], "architecture.hyosan.start-room.floor", 0.012)
    # Build the rear wall around a real post-strike opening. The core sits
    # behind the opening, so the cold-open reads as loss of structure rather
    # than a brick sticker laid over intact plaster.
    box("StartRoom_RearWall_Left", root, (-6.68, 2.0, -1.92), (0.64, 4.0, 0.16), materials["School_UpperPaint"], "architecture.hyosan.start-room.rear-wall", 0.018)
    box("StartRoom_RearWall_Right", root, (1.76, 2.0, -1.92), (10.32, 4.0, 0.16), materials["School_UpperPaint"], "architecture.hyosan.start-room.rear-wall", 0.018)
    jagged_patch("StartRoom_RearWall_DamageTop", root, [
        (-6.37, 4.0, -1.92), (-3.40, 4.0, -1.92), (-3.40, 3.18, -1.92),
        (-3.72, 3.05, -1.92), (-4.18, 3.30, -1.92), (-4.84, 3.06, -1.92),
        (-5.45, 3.39, -1.92), (-6.12, 3.12, -1.92), (-6.37, 3.45, -1.92),
    ], materials["School_UpperPaint"], "architecture.hyosan.start-room.rear-wall-damaged-top")
    jagged_patch("StartRoom_RearWall_DamageBottom", root, [
        (-6.37, 0.0, -1.92), (-3.40, 0.0, -1.92), (-3.40, 0.96, -1.92),
        (-3.72, 1.13, -1.92), (-4.15, 0.88, -1.92), (-4.86, 1.18, -1.92),
        (-5.46, 0.77, -1.92), (-6.06, 1.05, -1.92), (-6.37, 0.72, -1.92),
    ], materials["School_PaintedLower"], "architecture.hyosan.start-room.rear-wall-damaged-bottom")
    # Leave this bay physically open. The offset core and rebar behind it
    # create depth; an opaque black polygon would turn it back into a patch.
    box("StartRoom_RearBrickCore_Left", root, (-6.12, 2.02, -2.03), (0.30, 2.40, 0.34), materials["Broken_BrickWall"], "damage.hyosan.start-room.recessed-brick-core", 0.012)
    box("StartRoom_RearBrickCore_Top", root, (-5.18, 3.22, -2.03), (1.92, 0.31, 0.34), materials["Broken_BrickWall"], "damage.hyosan.start-room.recessed-brick-core", 0.012)
    box("StartRoom_RearBrickCore_Right", root, (-3.70, 2.31, -2.03), (0.28, 1.72, 0.34), materials["Broken_BrickWall"], "damage.hyosan.start-room.recessed-brick-core", 0.012)
    box("StartRoom_RearBrickCore_Bottom", root, (-4.92, 0.89, -2.03), (1.98, 0.34, 0.34), materials["Broken_BrickWall"], "damage.hyosan.start-room.recessed-brick-core", 0.012)
    box("StartRoom_RightWall", root, (6.9, 2.0, 5.6), (0.18, 4.0, 15.2), materials["School_UpperPaint"], "architecture.hyosan.start-room.right-wall", 0.018)
    box("StartRoom_LeftPillar", root, (-6.9, 2.0, 12.25), (0.18, 4.0, 1.85), materials["School_UpperPaint"], "architecture.hyosan.start-room.left-pillar", 0.018)
    for z in (0.0, 3.2, 6.4, 9.6):
        box(f"StartRoom_LeftWall_{z}", root, (-6.9, 2.0, z), (0.18, 4.0, 0.52), materials["School_UpperPaint"], "architecture.hyosan.start-room.window-wall", 0.018)
    # Model the doorway wall as segments around real asymmetric strike voids;
    # do not lay triangular brick/soot cards over a single intact wall.
    box("StartRoom_DoorWall_L_Far", root, (-5.02, 2.0, 13.1), (3.76, 4.0, 0.18), materials["School_UpperPaint"], "architecture.hyosan.start-room.door-wall.segment", 0.018)
    box("StartRoom_DoorWall_R_Far", root, (5.02, 2.0, 13.1), (3.76, 4.0, 0.18), materials["School_UpperPaint"], "architecture.hyosan.start-room.door-wall.segment", 0.018)
    box("StartRoom_DoorLintel", root, (0, 3.62, 13.1), (2.16, 0.76, 0.18), materials["School_UpperPaint"], "architecture.hyosan.start-room.door-lintel", 0.018)
    # The two jamb shoulders are actual three-depth strike cross-sections:
    # front paint has an irregular torn edge, old brick retreats behind it,
    # and soot/rebar sit still farther inside the void.  No full rectangular
    # wall is left behind these pieces, and all points stay outside the portal.
    left_shell = [(-3.20, 0.0), (-1.38, 0.0), (-1.39, 0.42), (-1.56, 0.67), (-1.43, 1.03), (-1.78, 1.37), (-1.48, 1.80), (-1.64, 2.36), (-1.38, 2.78), (-1.58, 3.20), (-1.38, 3.54), (-1.38, 4.0), (-3.20, 4.0)]
    right_shell = [(1.38, 0.0), (3.20, 0.0), (3.20, 4.0), (1.38, 4.0), (1.40, 3.40), (1.56, 3.08), (1.43, 2.66), (1.55, 2.14), (1.41, 1.76), (1.60, 1.31), (1.40, 0.86), (1.50, 0.42)]
    jagged_wall_section("StartRoom_DoorWall_L_TornPlaster", root, left_shell, 13.005, 0.15, materials["School_UpperPaint"], "damage.hyosan.doorway.torn-plaster-shell.large")
    jagged_wall_section("StartRoom_DoorWall_R_TornPlaster", root, right_shell, 13.005, 0.15, materials["School_UpperPaint"], "damage.hyosan.doorway.torn-plaster-shell.small")
    jagged_wall_section("StartRoom_DoorWall_L_LowerPaint", root, [(-3.20, 0.0), (-1.38, 0.0), (-1.39, 0.42), (-1.56, 0.67), (-1.43, 1.03), (-1.96, 1.14), (-3.20, 1.14)], 12.992, 0.042, materials["School_PaintedLower"], "damage.hyosan.doorway.lower-paint-torn-edge.large")
    jagged_wall_section("StartRoom_DoorWall_R_LowerPaint", root, [(1.38, 0.0), (3.20, 0.0), (3.20, 1.14), (1.96, 1.14), (1.40, 0.86), (1.50, 0.42)], 12.992, 0.042, materials["School_PaintedLower"], "damage.hyosan.doorway.lower-paint-torn-edge.small")
    left_core = [(-2.55, 0.22), (-1.48, 0.22), (-1.57, 0.62), (-1.48, 1.12), (-1.85, 1.38), (-1.54, 1.82), (-1.71, 2.34), (-1.43, 2.79), (-1.58, 3.27), (-1.47, 3.60), (-2.55, 3.60)]
    right_core = [(1.47, 0.26), (2.42, 0.26), (2.42, 3.47), (1.48, 3.47), (1.61, 3.06), (1.49, 2.62), (1.62, 2.14), (1.48, 1.72), (1.65, 1.31), (1.48, 0.82)]
    jagged_wall_section("StartRoom_DoorVoidCore_L", root, left_core, 13.06, 0.09, materials["Broken_BrickWall"], "damage.hyosan.doorway.recessed-jagged-brick-core.large")
    jagged_wall_section("StartRoom_DoorVoidCore_R", root, right_core, 13.06, 0.09, materials["Broken_BrickWall"], "damage.hyosan.doorway.recessed-jagged-brick-core.small")
    jagged_wall_section("StartRoom_DoorVoidSoot_L", root, [(-1.69, 0.44), (-1.50, 0.62), (-1.59, 1.16), (-1.78, 1.38), (-1.58, 1.83), (-1.74, 2.33), (-1.51, 2.76), (-1.66, 3.24), (-1.52, 3.44), (-1.76, 3.18), (-1.93, 2.52), (-1.78, 1.95), (-2.02, 1.40), (-1.81, 0.86)], 13.155, 0.03, materials["Charred_Plaster"], "damage.hyosan.doorway.recessed-jagged-soot-lip.large")
    jagged_wall_section("StartRoom_DoorVoidSoot_R", root, [(1.63, 0.50), (1.50, 0.84), (1.66, 1.32), (1.50, 1.74), (1.66, 2.14), (1.51, 2.62), (1.64, 3.08), (1.50, 3.28), (1.83, 2.96), (1.72, 2.42), (1.90, 1.92), (1.74, 1.36)], 13.155, 0.03, materials["Charred_Plaster"], "damage.hyosan.doorway.recessed-jagged-soot-lip.small")
    cylinder("StartRoom_DoorwayRebar", root, (-1.50, 2.05, 12.92), 0.018, 1.92, materials["Smoked_Aluminium"], "damage.hyosan.doorway.exposed-rebar.large", rotation=(0.0, 0.0, 0.13))
    cylinder("StartRoom_DoorwayRebar_R", root, (1.50, 1.94, 12.92), 0.019, 1.30, materials["Smoked_Aluminium"], "damage.hyosan.doorway.exposed-rebar.small", rotation=(0.0, 0.0, -0.22))
    fallen_sign = box("StartRoom_FallenWayfindingPanel", root, (-3.76, 2.72, 12.93), (0.82, 0.54, 0.055), materials["Door_RustedMetal"], "damage.hyosan.doorway.fallen-wayfinding-panel", 0.012)
    set_authored_rotation(fallen_sign, (0.0, 0.0, 0.31))
    floor_sign = box("StartRoom_FlashlightFallenSign", root, (-1.54, 0.08, 11.58), (0.54, 0.025, 0.88), materials["Door_RustedMetal"], "damage.hyosan.doorway.fallen-wayfinding-panel", 0.006)
    set_authored_rotation(floor_sign, (0.02, -0.42, 0.08))
    foreground_jamb = box("StartRoom_GameplayForegroundJamb", root, (4.92, 1.55, 11.84), (0.18, 2.75, 0.62), materials["Door_RustedMetal"], "damage.hyosan.start-room.foreground-jamb-occluder", 0.016)
    set_authored_rotation(foreground_jamb, (0.08, -0.16, 0.20))
    for index, (x, z, width, length, angle) in enumerate(((-1.52, 10.35, 0.42, 0.15, 0.26), (1.46, 10.90, 0.31, 0.11, -0.35), (-1.62, 11.72, 0.55, 0.16, 0.18), (1.58, 12.08, 0.38, 0.14, -0.42), (-2.25, 11.28, 0.66, 0.19, 0.61))):
        trim = box(f"StartRoom_DoorwayFloorTrim_{index}", root, (x, 0.075, z), (width, 0.035, length), materials["Door_RustedMetal"], "damage.hyosan.doorway.floor-trim-debris", 0.004)
        set_authored_rotation(trim, (0.0, angle, 0.0))
    box("StartRoom_BaseboardRear", root, (0, 0.34, -1.80), (13.75, 0.12, 0.08), materials["Smoked_Aluminium"], "architecture.hyosan.start-room.baseboard", 0.012)
    box("StartRoom_BaseboardRight", root, (6.78, 0.34, 5.6), (0.08, 0.12, 14.9), materials["Smoked_Aluminium"], "architecture.hyosan.start-room.baseboard", 0.012)
    box("StartRoom_RearLowerPaint_Left", root, (-6.70, 0.82, -1.81), (0.42, 1.10, 0.035), materials["School_PaintedLower"], "architecture.hyosan.start-room.lower-painted-wall", 0.006)
    box("StartRoom_RearLowerPaint_Right", root, (1.50, 0.82, -1.81), (10.80, 1.10, 0.035), materials["School_PaintedLower"], "architecture.hyosan.start-room.lower-painted-wall", 0.006)
    box("StartRoom_RightLowerPaint", root, (6.79, 0.82, 5.6), (0.035, 1.10, 14.85), materials["School_PaintedLower"], "architecture.hyosan.start-room.lower-painted-wall", 0.006)

    exposed = group("StartRoom_ExposedBrickDamage", "damage.hyosan.start-room.exposed-brick", root)
    # Three torn, hand-authored silhouettes replace the previous regular
    # mini-brick grid. Brick, soot, and rebar appear in layers only where the
    # plaster has failed, preserving the broader two-tone school wall.
    jagged_patch("StartRoom_SootTear_A", root, [
        (-6.28, 0.92, -1.785), (-6.03, 1.52, -1.785), (-6.15, 2.22, -1.785),
        (-5.92, 3.22, -1.785), (-6.25, 3.44, -1.785), (-6.44, 2.51, -1.785),
    ], materials["Charred_Plaster"], "damage.hyosan.irregular-soot-plaster-edge")
    jagged_patch("StartRoom_SootTear_B", root, [
        (-3.52, 1.03, -1.785), (-3.72, 1.83, -1.785), (-3.48, 2.66, -1.785),
        (-3.78, 3.30, -1.785), (-3.40, 3.10, -1.785), (-3.28, 1.84, -1.785),
    ], materials["Charred_Plaster"], "damage.hyosan.irregular-soot-plaster-edge")
    jagged_patch("StartRoom_SootTear_B", root, [
        ((6.765), 1.31, 4.62), ((6.765), 1.87, 4.88), ((6.765), 2.71, 5.15),
        ((6.765), 3.14, 5.66), ((6.765), 2.63, 5.97), ((6.765), 1.76, 5.70),
        ((6.765), 1.28, 5.24),
    ], materials["Charred_Plaster"], "damage.hyosan.irregular-soot-plaster-peel")
    # Broken plaster chunks bite into the recess from three directions; their
    # silhouette destroys the rectangular hole while leaving deep brick/core
    # and exposed rebar readable behind them.
    jagged_patch("StartRoom_RearPlasterChunk_A", root, [
        (-6.32, 3.39, -1.785), (-5.56, 3.37, -1.785), (-5.32, 2.98, -1.785),
        (-5.77, 2.74, -1.785), (-6.20, 2.96, -1.785),
    ], materials["School_UpperPaint"], "damage.hyosan.rear-wall.broken-plaster-chunk")
    jagged_patch("StartRoom_RearPlasterChunk_B", root, [
        (-3.48, 3.27, -1.785), (-3.32, 2.67, -1.785), (-3.62, 2.24, -1.785),
        (-4.05, 2.57, -1.785), (-3.92, 3.13, -1.785),
    ], materials["School_UpperPaint"], "damage.hyosan.rear-wall.broken-plaster-chunk")
    jagged_patch("StartRoom_RearPlasterChunk_C", root, [
        (-6.18, 1.14, -1.785), (-5.72, 1.43, -1.785), (-5.43, 1.06, -1.785),
        (-5.66, 0.72, -1.785), (-6.16, 0.80, -1.785),
    ], materials["School_PaintedLower"], "damage.hyosan.rear-wall.broken-paint-chunk")
    cylinder("StartRoom_ExposedRebar_A", exposed, (-5.30, 2.22, -1.74), 0.026, 1.95, materials["Smoked_Aluminium"], "damage.hyosan.exposed-rebar", rotation=(0.0, 0.0, 0.15))
    cylinder("StartRoom_ExposedRebar_B", exposed, (-5.74, 2.34, -1.74), 0.021, 1.50, materials["Smoked_Aluminium"], "damage.hyosan.exposed-rebar", rotation=(0.0, 0.0, -0.33))
    cylinder("StartRoom_ExposedRebar_C", exposed, (-3.72, 2.28, -1.88), 0.018, 1.26, materials["Smoked_Aluminium"], "damage.hyosan.exposed-rebar", rotation=(0.0, 0.0, 0.42))
    jagged_patch("StartRoom_RearBrickLip_A", root, [
        (-6.28, 2.68, -1.77), (-5.86, 2.94, -1.77), (-5.12, 2.80, -1.77),
        (-4.74, 2.42, -1.77), (-5.16, 2.18, -1.77), (-5.82, 2.34, -1.77),
    ], materials["Exposed_Brick"], "damage.hyosan.rear-wall.irregular-brick-lip")
    jagged_patch("StartRoom_RearCharredLip_B", root, [
        (-4.32, 1.04, -1.77), (-3.76, 1.36, -1.77), (-3.52, 1.84, -1.77),
        (-3.76, 2.18, -1.77), (-4.30, 1.95, -1.77), (-4.54, 1.46, -1.77),
    ], materials["Charred_Plaster"], "damage.hyosan.rear-wall.irregular-charred-lip")
    board = group("StartRoom_RearBlackboard", "architecture.hyosan.start-room.blackboard", root)
    box("StartRoom_BlackboardFace", board, (0.52, 2.64, -1.80), (7.08, 1.5, 0.05), materials["Blackboard"], "architecture.hyosan.blackboard.face", 0.008)
    box("StartRoom_BlackboardFrameTop", board, (0.52, 3.42, -1.75), (7.27, 0.07, 0.13), materials["Smoked_Aluminium"], "architecture.hyosan.blackboard.frame", 0.012)
    box("StartRoom_BlackboardTray", board, (0.52, 1.86, -1.72), (7.27, 0.08, 0.20), materials["Smoked_Aluminium"], "architecture.hyosan.blackboard.tray", 0.012)
    box("StartRoom_TeacherDesk", root, (-1.05, 0.52, -0.82), (2.65, 0.78, 0.72), materials["Worn_Wood"], "prop.hyosan.teacher-desk", 0.035)

    ceiling = group("StartRoom_StrippedCeiling", "damage.hyosan.start-room.stripped-ceiling", root)
    box("StartRoom_CeilingShadowPlane", ceiling, (0.0, 3.96, 5.6), (14.0, 0.10, 15.2), materials["Damaged_AcousticCeiling"], "architecture.hyosan.start-room.ceiling-shadow-plane", 0.006)
    for z in (-0.4, 2.8, 6.0, 9.2, 12.2):
        cylinder(f"StartRoom_CeilingBeam_{z}", ceiling, (0, 3.82, z), 0.055, 13.45, materials["Smoked_Aluminium"], "architecture.hyosan.ceiling-beam", rotation=(0, 0, math.pi / 2))
    # The collapse leaves anchored beams and broken panel edges only. Loose
    # mid-air cards or unsupported conduit do not communicate causal damage,
    # so the room deliberately has no free-hanging ceiling fragments.

    for index, z in enumerate((1.3, 4.45, 7.65, 10.8)):
        add_window(root, f"StartRoom_Window_{index}", z, materials, missing=index in (1, 3))
    for index, (x, z, scale, rotation) in enumerate(((-5.5, 2.1, 0.22, 0.4), (4.8, 2.8, 0.3, 1.1), (-5.7, 6.7, 0.26, 2.2), (5.1, 7.6, 0.18, 0.8), (-4.7, 10.3, 0.34, 1.8), (5.8, 11.4, 0.23, 0.1), (-2.55, 8.6, 0.17, 1.3), (2.45, 9.4, 0.2, 2.6))):
        rubble(f"StartRoom_Rubble_{index}", root, (x, scale * 0.42, z), (scale * 1.5, scale * 0.72, scale), materials["Charred_Plaster"], "prop.hyosan.rubble", rotation)
    add_desk(root, "StartRoom_OverturnedDesk_A", (-4.35, 0.0, 4.3), 0.66, materials, toppled=True)
    add_desk(root, "StartRoom_OverturnedDesk_B", (4.55, 0.0, 8.9), -0.48, materials, toppled=True)
    add_desk(root, "StartRoom_SideDesk", (-4.7, 0.0, 10.8), 0.22, materials, toppled=False)
    # The damage lanes stay outside the player corridor, but pack the rear
    # half with recognisable classroom silhouettes for the cold-open view.
    add_desk(root, "StartRoom_OverturnedDesk_C", (-2.75, 0.0, 3.2), -0.78, materials, toppled=True)
    add_desk(root, "StartRoom_OverturnedDesk_D", (2.65, 0.0, 3.8), 0.62, materials, toppled=True)
    add_desk(root, "StartRoom_OverturnedDesk_E", (-3.25, 0.0, 6.25), 0.35, materials, toppled=True)
    add_desk(root, "StartRoom_OverturnedDesk_F", (3.25, 0.0, 6.85), -0.54, materials, toppled=True)
    add_desk(root, "StartRoom_SideDesk_G", (-3.85, 0.0, 8.0), 0.18, materials, toppled=False)
    add_chair(root, "StartRoom_Chair_A", (-3.6, 0.0, 2.3), 1.08, materials, toppled=True)
    add_chair(root, "StartRoom_Chair_B", (4.8, 0.0, 5.8), -0.74, materials, toppled=True)
    add_chair(root, "StartRoom_Chair_C", (-4.3, 0.0, 9.5), 0.26, materials, toppled=False)
    add_chair(root, "StartRoom_Chair_D", (-2.15, 0.0, 2.5), -0.32, materials, toppled=True)
    add_chair(root, "StartRoom_Chair_E", (2.25, 0.0, 2.9), 0.91, materials, toppled=True)
    add_chair(root, "StartRoom_Chair_F", (-2.4, 0.0, 5.15), 0.58, materials, toppled=False)
    add_chair(root, "StartRoom_Chair_G", (2.5, 0.0, 5.55), -0.65, materials, toppled=True)
    # The hiding desk must sit at the approved delivery anchor
    # (x=-3.35,y=.05,z=2.85). The 5 cm authored floor offset prevents z-fighting
    # and is part of the exported semantic contract.
    # and remain level: a toppled hero desk made the inside camera stare into
    # an oversized wedge.  This CC0 desk keeps a legible underside/egress gap
    # while the named root remains the state-driven cover seam.
    hero_desk = import_hero_prop(root, "Hide_Desk_Classroom_Cover", "SchoolDesk_01", (-3.35, 0.05, 2.85), 0.0, toppled=False)
    hide_anchor = group("Hide_Desk_Classroom_Anchor", "hiding.desk.classroom", root)
    set_authored_location(hide_anchor, (-3.35, 0.05, 2.85))
    tag(
        hide_anchor,
        "hiding.desk.classroom",
        hide_id="hiding.desk.classroom",
        cover_node="Hide_Desk_Classroom_Cover",
        visual_state_source="HideSystem.snapshot.phase",
        closed_transform="authored cover transform",
        open_transform="authored cover transform plus 0.32m vertical clearance",
        runtime_states="outside|entering|hidden|exiting",
    )
    action = bpy.data.actions.new("Hide_Desk_Classroom_EnterExit")
    hero_desk.animation_data_create()
    hero_desk.animation_data.action = action
    closed_location = hero_desk.location.copy()
    for frame, offset in ((1, 0.0), (16, -.32), (32, 0.0)):
        hero_desk.location = closed_location + Vector((0.0, offset, 0.0))
        hero_desk.keyframe_insert(data_path="location", frame=frame)
    hero_desk.location = closed_location
    tag(hero_desk, "hiding.desk.classroom.cover", hide_id="hiding.desk.classroom", visual_motion_source="HideSystem.snapshot.phase", visible_cover=True, camera_clearance_m=.78, camera_occluder_extent_m=(.72, .55))
    hero_desk_mesh = next(child for child in hero_desk.children if child.type == "MESH")
    import_hero_prop(root, "StartRoom_HeroDesk_Linked", "SchoolDesk_01", (3.45, 0.05, 3.60), 0.56, toppled=True, source=hero_desk_mesh)
    import_hero_prop(root, "StartRoom_HeroDesk_Linked_C", "SchoolDesk_01", (-4.65, 0.05, 3.56), -0.58, toppled=True, source=hero_desk_mesh)
    import_hero_prop(root, "StartRoom_HeroDesk_Linked_D", "SchoolDesk_01", (-3.96, 0.05, 4.42), 0.38, toppled=True, source=hero_desk_mesh)
    import_hero_prop(root, "StartRoom_HeroDesk_LaneSide_A", "SchoolDesk_01", (-1.72, 0.05, 2.18), 0.52, toppled=True, source=hero_desk_mesh)
    import_hero_prop(root, "StartRoom_HeroDesk_LaneSide_B", "SchoolDesk_01", (1.78, 0.05, 3.42), -0.42, toppled=True, source=hero_desk_mesh)
    # A clustered fore-ground collapse frames the cold-open without entering
    # the central spawn-to-door lane.
    box("StartRoom_ForegroundFallenFrame", root, (-4.92, 1.42, 7.45), (0.08, 2.14, 1.34), materials["Door_RustedMetal"], "damage.hyosan.start-room.fallen-window-frame", 0.012)
    set_authored_rotation(bpy.data.objects["StartRoom_ForegroundFallenFrame"], (0.24, -0.22, 0.34))
    for index, (x, z, scale, rotation) in enumerate(((-4.95, 3.02, 0.10, 0.2), (-4.46, 2.72, 0.075, 1.4), (-3.88, 3.12, 0.12, 2.1), (3.98, 4.15, 0.10, 0.6), (4.58, 4.42, 0.08, 2.3), (-5.52, 4.24, 0.14, 0.9))):
        rubble(f"StartRoom_MicroDebris_{index}", root, (x, scale * 0.30, z), (scale * 1.35, scale * 0.45, scale), materials["Charred_Plaster"], "prop.hyosan.micro-rubble", rotation)
    for index, (x, z, sx, sz, angle) in enumerate(((-5.22, 2.46, 0.18, 0.24, 0.24), (-4.54, 2.18, 0.12, 0.21, -0.42), (-4.22, 3.84, 0.17, 0.10, 0.78), (-3.72, 4.68, 0.11, 0.18, -0.18), (4.24, 5.46, 0.14, 0.20, 0.38), (4.86, 6.12, 0.16, 0.12, -0.64), (-5.58, 5.42, 0.10, 0.16, 0.52))):
        paper = box(f"StartRoom_PaperDebris_{index}", root, (x, 0.045, z), (sx, 0.012, sz), materials["School_UpperPaint"], "prop.hyosan.paper-debris", 0.001)
        set_authored_rotation(paper, (0.08, angle, 0.04 * (index - 3)))
    # The ceiling is stripped back to beams, conduit, and supported fixtures;
    # detached floating cards do not communicate believable collapse.
    for index, (x, z, scale, angle) in enumerate(((-1.86, 1.48, 0.74, 0.36), (1.72, 2.28, 0.58, -0.28), (-2.18, 4.56, 0.82, 0.42), (2.12, 5.72, 0.62, -0.34))):
        slab = fractured_slab(f"StartRoom_FloorCollapseSlab_{index}", root, (x, 0.04, z), [(-scale, -0.38 * scale), (-0.18 * scale, -0.56 * scale), (0.66 * scale, -0.28 * scale), (0.88 * scale, 0.22 * scale), (0.24 * scale, 0.54 * scale), (-0.62 * scale, 0.38 * scale)], 0.13, materials["Concrete_Debris"], "damage.hyosan.floor-collapse-slab")
        set_authored_rotation(slab, (0.04, angle, -0.08 + index * 0.05))
    jagged_patch("StartRoom_BlackboardSootPeel", root, [
        (2.06, 1.62, -1.766), (2.42, 1.92, -1.766), (3.08, 1.74, -1.766),
        (3.44, 2.12, -1.766), (3.18, 2.54, -1.766), (2.54, 2.42, -1.766),
        (2.18, 2.08, -1.766),
    ], materials["Charred_Plaster"], "damage.hyosan.blackboard-wall.irregular-soot-peel")
    box("StartRoom_BlackboardDustStrip", root, (2.42, 1.76, -1.755), (3.35, 0.075, 0.020), materials["Charred_Plaster"], "damage.hyosan.blackboard-wall.contact-dust", 0.003)
    for index, (x, z, scale, rotation) in enumerate(((-2.36, 1.22, 0.10, 0.20), (-1.56, 1.88, 0.07, 1.42), (-2.54, 2.62, 0.12, 2.10), (1.46, 2.74, 0.09, 0.64), (2.28, 3.44, 0.13, 1.86), (1.54, 4.46, 0.08, 2.62), (-2.66, 4.84, 0.11, 1.10), (2.42, 5.30, 0.10, 0.42), (-1.48, 5.84, 0.07, 2.42), (1.38, 5.98, 0.08, 0.90))):
        rubble(f"StartRoom_CollapseMicroDebris_{index}", root, (x, scale * 0.30, z), (scale * 1.4, scale * 0.46, scale), materials["Charred_Plaster"], "prop.hyosan.collapse-micro-debris", rotation)
    damage_decal_patch("StartRoom_CollapseDust", root, [
        (-4.90, 0.014, 2.04), (-2.14, 0.014, 2.30), (-2.30, 0.014, 4.96),
        (-5.16, 0.014, 4.76),
    ], materials["Damage_Decal_Atlas"], (0, 3), "damage.hyosan.start-room.keyed-collapse-dust", (0.0, 1.0, 0.0))
    # Three real debris scales anchor the rear-wall breach: thick slabs at its
    # foot, mid chunks, then fine dust/glass. They stay left of the clear lane.
    origin_slab = fractured_slab("StartRoom_BreachOriginSlab", root, (-4.78, 0.035, 0.66), [(-1.02, -0.44), (-0.30, -0.72), (0.76, -0.34), (0.94, 0.28), (0.22, 0.66), (-0.78, 0.44)], 0.18, materials["Concrete_Debris"], "damage.hyosan.start-room.breach-origin-hero-slab")
    set_authored_rotation(origin_slab, (0.06, 0.26, -0.11))
    for index, (x, z, scale, rotation) in enumerate(((-5.34, 0.48, 0.48, 0.22), (-4.18, 0.92, 0.36, 1.18), (-5.05, 1.36, 0.28, 2.18), (-4.42, 1.74, 0.20, 0.66), (-5.72, 1.18, 0.17, 1.74), (-3.72, 0.56, 0.22, 2.62))):
        rubble(f"StartRoom_BreachOriginRubble_{index}", root, (x, scale * 0.40, z), (scale * 1.45, scale * 0.74, scale), materials["Concrete_Debris"], "damage.hyosan.start-room.breach-origin-rubble", rotation)
    for index, (x, top, bottom, lean) in enumerate(((1.10, 1.42, 0.84, -0.05), (1.46, 1.34, 0.76, 0.06), (1.82, 1.30, 0.90, -0.03))):
        jagged_patch(f"StartRoom_SolidWaterStreak_{index}", root, [
            (x - 0.055, bottom, -1.755), (x + 0.055, bottom, -1.755),
            (x + 0.035 + lean, top, -1.755), (x - 0.045 + lean, top, -1.755),
        ], materials["Charred_Plaster"], "damage.hyosan.blackboard-wall.solid-water-streak")
    box("StartRoom_RightStorageCabinet", root, (5.72, 1.0, 1.0), (1.7, 1.9, 0.52), materials["Worn_Wood"], "prop.hyosan.damaged-storage-cabinet", 0.035)
    box("StartRoom_RightStorageDoor", root, (5.42, 1.16, 0.70), (1.07, 1.42, 0.045), materials["Charred_Plaster"], "prop.hyosan.damaged-storage-cabinet.door", 0.014)
    return root, floor


def create_classroom_door(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    root = group("ClassroomDoor_Root", "door.hyosan.classroom.slide", None)
    tag(root, "door.hyosan.classroom.slide", local_origin="runtime closed transform (0,1.5,13)", portal="x[-1.1,1.1] z[12.85,13.15]")
    frame = group("Door_Frame", "door.hyosan.classroom.slide.frame", root)
    box("Door_Frame_Left", frame, (-1.30, 0.03, 0.0), (0.14, 3.06, 0.22), materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.frame.left", 0.02)
    box("Door_Frame_Right", frame, (1.30, -0.03, 0.0), (0.14, 3.0, 0.22), materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.frame.right", 0.02)
    box("Door_Frame_Header", frame, (0.0, 1.42, 0.0), (2.74, 0.15, 0.24), materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.frame.header", 0.018)
    box("Door_Threshold", frame, (0.0, -1.46, 0.02), (2.74, 0.10, 0.28), materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.threshold", 0.015)
    rail = group("Door_Rail", "door.hyosan.classroom.slide.rail", root)
    box("Door_Rail_Support", rail, (0.14, 1.68, -0.05), (3.18, 0.09, 0.18), materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.rail-support", 0.012)
    cylinder("Door_Rail_Tube", rail, (-0.08, 1.61, -0.17), 0.035, 3.12, materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.rail-tube", rotation=(0, 0, math.pi / 2))
    # The fixed pockets make this read as a sliding partition, not a hinged
    # egress door. During runtime opening the named panels travel along this
    # overhead rail and clear the central portal.
    # Both pockets stay outside the x[-1.1,1.1] portal and the door's local
    # bound.  They are recess backing for the open leaves, never a centre
    # post that a player could collide with.
    box("Door_SidePocket_L", frame, (-1.51, -0.02, 0.08), (0.42, 2.72, 0.18), materials["Door_RustedMetal"], "door.hyosan.classroom.slide.fixed-side-pocket", 0.018)
    box("Door_SidePocket_R", frame, (1.51, -0.02, 0.08), (0.42, 2.72, 0.18), materials["Door_RustedMetal"], "door.hyosan.classroom.slide.fixed-side-pocket", 0.018)

    def panel(side: int) -> None:
        name = "Door_Panel_L" if side < 0 else "Door_Panel_R"
        panel_root = group(name, "door.hyosan.classroom.slide.panel.left" if side < 0 else "door.hyosan.classroom.slide.panel.right", root)
        panel_root.location.x = -0.54 if side < 0 else 0.54
        tag(panel_root, panel_root["semantic_id"], pivot_local_x=panel_root.location.x, runtime_axis="x outward")
        box(f"{name}_OuterStile", panel_root, (side * 0.47, 0.0, 0.01), (0.08, 2.68, 0.09), materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.panel.stile", 0.014)
        box(f"{name}_InnerStile", panel_root, (-side * 0.47, side * 0.03, 0.01), (0.08, 2.58, 0.09), materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.panel.stile", 0.014)
        # A single named centre seam belongs to the left leaf.  In its closed
        # position it meets the right inner stile; during runtime travel it
        # moves with Door_Panel_L, leaving the entire portal empty.
        if side < 0:
            box("Door_CenterSeam", panel_root, (0.47, -0.03, -0.08), (0.026, 2.66, 0.06), materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.closed-centre-seam", 0.004)
        box(f"{name}_CrossbarTop", panel_root, (0.0, 1.28, 0.01), (1.06, 0.08, 0.09), materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.panel.crossbar", 0.012)
        glass = group("Door_Glass_L" if side < 0 else "Door_Glass_R", "door.hyosan.classroom.slide.glass.left" if side < 0 else "door.hyosan.classroom.slide.glass.right", panel_root)
        if side > 0:
            box(f"{name}_WiredGlass", glass, (0.0, 0.48, -0.034), (0.88, 1.43, 0.018), materials["Wired_Glass"], "door.hyosan.classroom.slide.wired-glass", 0.002)
            # Sparse real wire strands are intentionally thin enough to avoid
            # a moire grid, but remain legible in the close gameplay cone.
            for wire_index, wire_x in enumerate((-0.28, 0.0, 0.28)):
                cylinder(f"{name}_WiredGlass_V_{wire_index}", glass, (wire_x, 0.48, -0.052), 0.005, 1.35, materials["Smoked_Aluminium"], "door.hyosan.classroom.wired-glass.vertical-wire")
            for wire_index, wire_y in enumerate((0.05, 0.48, 0.91)):
                cylinder(f"{name}_WiredGlass_H_{wire_index}", glass, (0.0, wire_y, -0.052), 0.005, 0.80, materials["Smoked_Aluminium"], "door.hyosan.classroom.wired-glass.horizontal-wire", rotation=(0.0, 0.0, math.pi / 2))
        else:
            for index, (x, y, sx, sy, angle) in enumerate(((-0.18, 0.57, 0.28, 0.82, 0.1), (0.24, -0.03, 0.24, 0.55, -0.17), (0.08, 0.98, 0.3, 0.24, 0.3))):
                fragment = box(f"Door_Glass_L_Fragment_{index}", glass, (x, y, -0.034), (sx, sy, 0.014), materials["Wired_Glass"], "door.hyosan.classroom.slide.glass-fragment", 0.002)
                set_authored_rotation(fragment, (0.0, angle, 0.0))
        box(f"{name}_Kickplate", panel_root, (0.0, -0.98, 0.01), (0.9, 0.82, 0.075), materials["Door_RustedMetal"], "door.hyosan.classroom.slide.lower-metal-panel", 0.012)
        box(f"{name}_KickplateScuff", panel_root, (0.0, -1.18, -0.034), (0.68, 0.08, 0.008), materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.lower-metal-panel-scuff", 0.004)
        # A recessed vertical pull reads as sliding-door hardware. The old
        # horizontal tube looked like a push-bar on a hinged egress door.
        cylinder(f"{name}_Handle", panel_root, (-side * 0.18, -0.18, -0.10), 0.026, 0.46, materials["Smoked_Aluminium"], "door.hyosan.classroom.slide.vertical-pull", rotation=(0, 0, 0))
    panel(-1)
    panel(1)
    return root


def create_first_bay(materials: dict[str, bpy.types.Material]) -> tuple[bpy.types.Object, bpy.types.Object]:
    root = group("FirstBay_Root", "environment.hyosan.first-bay", None)
    tag(root, "environment.hyosan.first-bay", bounds="x[-3,3] z[13.2,25] y[0,4]", lighting="cyan side-lit / opposite wall negative fill")
    floor = box("FirstBay_DirtyTileFloor", root, (0.0, -0.08, 19.1), (6.0, 0.16, 11.8), materials["Dirty_Floor_Tile"], "architecture.hyosan.first-bay.floor", 0.012)
    # The right side needs a real readable finish at first-contact distance:
    # use weathered school paint with separate lower paint, joints and door
    # modules rather than one enormous black plaster card.
    box("FirstBay_BlackWall", root, (2.91, 2.0, 19.1), (0.18, 4.0, 11.8), materials["School_UpperPaint"], "architecture.hyosan.first-bay.black-wall", 0.018)
    box("FirstBay_RightWallFinish", root, (2.79, 2.47, 19.1), (0.036, 1.68, 11.45), materials["School_UpperPaint"], "architecture.hyosan.first-bay.right-wall-finish", 0.008)
    # No cap at the far end: the bay falls through a dark, framed continuation
    # so the modest playable volume reads as a long building axis rather than
    # a clean box.
    box("FirstBay_EndReveal_L", root, (-2.88, 2.0, 24.88), (0.18, 4.0, 0.16), materials["School_PaintedLower"], "architecture.hyosan.first-bay.dark-continuation-reveal", 0.014)
    box("FirstBay_EndReveal_R", root, (2.88, 2.0, 24.88), (0.18, 4.0, 0.16), materials["School_PaintedLower"], "architecture.hyosan.first-bay.dark-continuation-reveal", 0.014)
    box("FirstBay_EndRevealTop", root, (0.0, 3.88, 24.88), (5.9, 0.18, 0.16), materials["Smoked_Aluminium"], "architecture.hyosan.first-bay.dark-continuation-reveal", 0.014)
    box("FirstBay_CeilingSkeleton", root, (0.0, 3.92, 19.1), (6.0, 0.10, 11.8), materials["Damaged_AcousticCeiling"], "damage.hyosan.first-bay.stripped-ceiling", 0.012)
    box("FirstBay_BaseboardRight", root, (2.80, 0.35, 19.1), (0.08, 0.12, 11.55), materials["Smoked_Aluminium"], "architecture.hyosan.corridor.baseboard", 0.012)
    box("FirstBay_RightLowerPaint", root, (2.80, 0.82, 19.1), (0.035, 1.10, 11.55), materials["School_PaintedLower"], "architecture.hyosan.corridor.lower-painted-wall", 0.006)
    # Three clear four-metre modules make the x=- window / x=+ classroom-door
    # grammar legible from the open sliding door, instead of a short uniform
    # picket of repeated bars.
    for index, z in enumerate((14.9, 18.9, 22.9)):
        add_window(root, f"FirstBay_Window_{index}", z, materials, missing=index == 1, corridor=True)
        add_corridor_classroom_door(root, f"FirstBay_ClassroomDoor_{index}", z, materials, damaged=index == 1)
    for z in (13.8, 15.65, 17.5, 19.35, 21.2, 23.05, 24.65):
        cylinder(f"FirstBay_CeilingBeam_{z}", root, (0, 3.75, z), 0.05, 5.75, materials["Smoked_Aluminium"], "architecture.hyosan.corridor.ceiling-beam", rotation=(0, 0, math.pi / 2))
    # Two CC0 school-furniture hero assets establish a believable close bay;
    # repeated debris remains cheap but the sightline is no longer only boxes.
    # The source props' toppled rotation lets their authored feet dip beneath
    # the authored floor if their roots sit exactly at y=0.  Lift the whole
    # source asset (rather than weakening the delivery bounds contract) so
    # it has a truthful floor clearance in the exported GLB.
    hero_desk = import_hero_prop(root, "FirstBay_HeroDesk", "SchoolDesk_01", (1.42, .14, 17.72), .62, toppled=True)
    hero_chair = import_hero_prop(root, "FirstBay_HeroChair", "SchoolChair_01", (-1.34, .14, 20.18), -1.18, toppled=True)
    tag(hero_desk, "prop.hyosan.first-bay.hero-desk", delivery_role="first-encounter-hero-prop")
    tag(hero_chair, "prop.hyosan.first-bay.hero-chair", delivery_role="first-encounter-hero-prop")
    for index, (x, z, scale, rotation) in enumerate(((-1.95, 16.8, 0.32, 0.4), (1.72, 18.1, 0.52, 1.5), (-2.15, 21.4, 0.4, 2.2), (1.7, 23.9, 0.47, 0.1))):
        rubble(f"FirstBay_Rubble_{index}", root, (x, scale * 0.42, z), (scale * 1.4, scale * 0.75, scale), materials["Concrete_Debris"], "prop.hyosan.corridor-rubble", rotation)
    add_desk(root, "FirstBay_OverturnedDesk_A", (1.9, 0.0, 17.1), 0.48, materials, toppled=True)
    add_desk(root, "FirstBay_OverturnedDesk_B", (-1.85, 0.0, 22.8), -0.62, materials, toppled=True)
    add_desk(root, "FirstBay_OverturnedDesk_Foreground", (-1.72, 0.0, 15.16), 0.64, materials, toppled=True)
    add_chair(root, "FirstBay_Chair_A", (1.95, 0.0, 20.65), 1.0, materials, toppled=True)
    add_chair(root, "FirstBay_Chair_Foreground", (1.62, 0.0, 15.72), -0.52, materials, toppled=True)
    # Long supported beams sag between the two corridor walls; detached cards
    # are not used as a shortcut for ceiling damage.
    sag_beam = cylinder("FirstBay_SaggingCeilingBeam", root, (0.0, 3.30, 20.72), 0.055, 5.52, materials["Smoked_Aluminium"], "damage.hyosan.corridor.sagging-supported-ceiling-beam", rotation=(0, 0, math.pi / 2))
    set_authored_rotation(sag_beam, (0.0, 0.0, math.pi / 2))
    # One sagging fixture is physically tied to that beam. Loose floating
    # ceiling cards are not used.
    cylinder("FirstBay_SagFixtureCable", root, (0.0, 3.48, 20.72), 0.016, 0.42, materials["Smoked_Aluminium"], "damage.hyosan.corridor.sag-fixture-supported-cable")
    fixture = box("FirstBay_SagFixture", root, (0.0, 3.07, 20.72), (0.84, 0.08, 0.22), materials["Door_RustedMetal"], "damage.hyosan.corridor.sag-fixture-supported", 0.010)
    set_authored_rotation(fixture, (0.08, 0.0, 0.18))
    for index, (x, z, scale, rotation) in enumerate(((-1.42, 16.18, 0.08, 0.3), (-1.72, 16.56, 0.11, 1.2), (1.62, 18.65, 0.09, 2.0), (-1.28, 20.38, 0.12, 0.7), (1.52, 22.16, 0.07, 2.5), (-1.54, 23.36, 0.10, 1.5))):
        rubble(f"FirstBay_MicroDebris_{index}", root, (x, scale * 0.30, z), (scale * 1.35, scale * 0.43, scale), materials["Charred_Plaster"], "prop.hyosan.corridor.micro-rubble", rotation)
    for index, (x, z, scale, rotation) in enumerate(((1.76, 23.86, 0.70, 0.34), (-1.76, 24.12, 0.54, 1.26), (1.38, 24.30, 0.38, 2.12))):
        rubble(f"FirstBay_EndMound_{index}", root, (x, scale * 0.40, z), (scale * 1.55, scale * 0.78, scale), materials["Concrete_Debris"], "damage.hyosan.corridor.collapsed-ceiling-floor-mound", rotation)
    damage_decal_patch("FirstBay_DebrisDust", root, [
        (1.38, 0.014, 16.36), (2.42, 0.014, 16.58), (2.28, 0.014, 17.94),
        (1.10, 0.014, 17.72),
    ], materials["Damage_Decal_Atlas"], (0, 3), "damage.hyosan.corridor.keyed-rubble-dust", (0.0, 1.0, 0.0))
    # A narrow offset return turns the last bay left. It deliberately leaves
    # an illuminated floor slip instead of presenting a full frontal end cap.
    box("FirstBay_FarTurnOccluder", root, (2.38, 1.44, 24.62), (0.78, 2.78, 0.18), materials["School_PaintedLower"], "architecture.hyosan.corridor.far-turn-occluder", 0.014)
    # The playable volume stops at z=25, but its last bay turns left instead
    # of presenting a frontal cap. The lit floor slip and return wall keep the
    # opening legible as a continuing school corridor in the review camera.
    box("FirstBay_BendFloorReveal", root, (-1.15, 0.005, 24.69), (3.15, 0.05, 0.55), materials["Dirty_Floor_Tile"], "architecture.hyosan.corridor.turn-floor-reveal", 0.004)
    box("FirstBay_BendLeftReturn", root, (-2.72, 1.85, 24.66), (0.16, 3.65, 0.68), materials["School_UpperPaint"], "architecture.hyosan.corridor.turn-left-return", 0.012)
    box("FirstBay_BendLowerPaint", root, (-2.62, 0.76, 24.66), (0.035, 1.02, 0.62), materials["School_PaintedLower"], "architecture.hyosan.corridor.turn-lower-paint", 0.006)
    return root, floor


def create_entry(materials: dict[str, bpy.types.Material]) -> tuple[bpy.types.Object, bpy.types.Object]:
    root = group("Entry_Root", "environment.hyosan.entrance.cold-open", None)
    tag(root, "environment.hyosan.entrance.cold-open", presentation="post-strike exterior entry")
    floor = box("Entry_WetForecourt", root, (0.0, -0.08, 0.0), (15.5, 0.16, 7.0), materials["Dirty_Floor_Tile"], "architecture.hyosan.entrance.forecourt", 0.012)
    # The facade is assembled around a real recessed glass opening. A solid
    # wall behind the panes made the old "broken" glazing read as opaque cyan.
    box("Entry_Facade_Left", root, (-5.77, 2.42, 2.75), (2.46, 4.82, 0.38), materials["School_UpperPaint"], "architecture.hyosan.entrance.facade.side", 0.025)
    box("Entry_Facade_Right", root, (5.77, 2.42, 2.75), (2.46, 4.82, 0.38), materials["School_UpperPaint"], "architecture.hyosan.entrance.facade.side", 0.025)
    box("Entry_Facade_Upper", root, (0.0, 4.70, 2.75), (14.0, 1.40, 0.38), materials["School_UpperPaint"], "architecture.hyosan.entrance.facade.upper", 0.025)
    box("Entry_Facade_Base", root, (0.0, 0.34, 2.75), (14.0, 0.68, 0.38), materials["School_PaintedLower"], "architecture.hyosan.entrance.facade.base", 0.018)
    # Flanking wings extend the entry into a damaged building mass, preventing
    # the review frame from reading as a freestanding stage facade.
    box("Entry_LeftBuildingWing", root, (-10.55, 2.55, 3.18), (7.65, 5.10, 1.20), materials["School_UpperPaint"], "architecture.hyosan.entrance.building-wing", 0.028)
    box("Entry_RightBuildingWing", root, (10.55, 2.55, 3.18), (7.65, 5.10, 1.20), materials["School_UpperPaint"], "architecture.hyosan.entrance.building-wing", 0.028)
    box("Entry_LeftWingBase", root, (-10.55, 0.64, 2.52), (7.70, 1.10, 0.48), materials["School_PaintedLower"], "architecture.hyosan.entrance.building-wing-base", 0.014)
    box("Entry_RightWingBase", root, (10.55, 0.64, 2.52), (7.70, 1.10, 0.48), materials["School_PaintedLower"], "architecture.hyosan.entrance.building-wing-base", 0.014)
    box("Entry_LeftReturnWall", root, (-6.72, 2.10, 1.10), (0.52, 4.20, 3.70), materials["Exposed_Brick"], "architecture.hyosan.entrance.side-structure", 0.018)
    box("Entry_RightReturnWall", root, (6.72, 2.10, 1.10), (0.52, 4.20, 3.70), materials["Exposed_Brick"], "architecture.hyosan.entrance.side-structure", 0.018)
    # A shallow damaged lintel gives the building thickness without reading as
    # a freestanding bus shelter. The camera crops close to the actual doors.
    box("Entry_LintelUnderside", root, (0.0, 4.12, 1.88), (6.35, 0.26, 1.08), materials["Smoked_Aluminium"], "architecture.hyosan.entrance.damaged-lintel", 0.022)
    box("Entry_LintelFace", root, (0.0, 4.02, 2.44), (6.18, 0.38, 0.20), materials["Charred_Plaster"], "architecture.hyosan.entrance.damaged-lintel", 0.015)
    # The yellow identity strip crosses the double glazing at handle height,
    # matching the school-door composition rather than becoming a marquee.
    # The school strip is physically interrupted at the central meeting rail:
    # it rides each door leaf instead of becoming a pristine single marquee.
    for index, x in enumerate((-1.82, -0.55, 0.55, 1.82)):
        box(f"Entry_HyosanYellowBand_{index}", root, (x, 2.36, 2.305), (1.08, 0.27, 0.085), materials["Hyosan_Yellow"], "architecture.hyosan.entrance.school-yellow-strip.segment", 0.010)
    entry_text(root, materials)
    brick_group = group("Entry_ExposedBrickDamage", "damage.hyosan.entrance.exposed-brick", root)
    for row in range(5):
        for column in range(22):
            if (row * 7 + column * 3) % 9 in (0, 1):
                continue
            x = -6.2 + column * 0.55 + (row % 2) * 0.15
            y = 0.72 + row * 0.32
            if abs(x) < 3.2 and y < 2.7:
                continue
            box(f"Entry_Brick_{row}_{column}", brick_group, (x, y, 2.54), (0.48, 0.25, 0.04), materials["Exposed_Brick"], "damage.hyosan.entrance.brick", 0.006)
    # Exposed structure has real depth at the torn facade edges, rather than
    # a flat brick decal over the school entry.
    for index, x in enumerate((-6.38, 6.38)):
        box(f"Entry_BrickCore_{index}", brick_group, (x, 2.1, 2.48), (0.72, 3.85, 0.62), materials["Broken_BrickWall"], "damage.hyosan.entrance.exposed-brick-core", 0.015)
        cylinder(f"Entry_Rebar_{index}", brick_group, (x + (-0.18 if x < 0 else 0.18), 2.48, 2.04), 0.025, 2.55, materials["Smoked_Aluminium"], "damage.hyosan.entrance.exposed-rebar", rotation=(0.0, 0.0, 0.0))
    # These tears deliberately have different silhouettes and depths.  A
    # rotated rectangle here read as a painted-on damage sticker in close entry
    # framing, so use small irregular, solid fragments with exposed edges.
    entry_tears = (
        ((-5.86, 3.16, 2.535), ((-0.72, -0.48), (-0.21, -0.63), (0.67, -0.34), (0.54, 0.20), (0.12, 0.60), (-0.43, 0.42))),
        ((5.42, 1.82, 2.535), ((-0.40, -0.78), (0.28, -0.70), (0.49, -0.14), (0.29, 0.72), (-0.26, 0.58), (-0.47, 0.04))),
        ((-4.34, 0.79, 2.535), ((-0.44, -0.22), (-0.08, -0.34), (0.40, -0.12), (0.31, 0.22), (-0.21, 0.29), (-0.49, 0.07))),
    )
    for index, (center, outline) in enumerate(entry_tears):
        cx, cy, cz = center
        jagged_patch(
            f"Entry_SootPeel_{index}",
            root,
            [(cx + dx, cy + dy, cz) for dx, dy in outline],
            materials["Charred_Plaster"],
            "damage.hyosan.entrance.irregular-soot-plaster-peel",
        )
    # Two thin smoked-aluminium rails frame, rather than obscure, the exposed
    # yellow school identity strip.
    for rail_y in (2.175, 2.545):
        box(f"Entry_SignRail_{rail_y}", root, (0.0, rail_y, 2.285), (5.08, 0.038, 0.072), materials["Smoked_Aluminium"], "architecture.hyosan.entrance.sign-rail", 0.008)
    door_frame = group("Entry_BrokenGlassFacade", "architecture.hyosan.entrance.glass-facade", root)
    box("Entry_InteriorLeftReturn", door_frame, (-3.12, 2.0, 3.66), (0.32, 3.25, 2.65), materials["Blackboard"], "architecture.hyosan.entrance.interior-dark-return", 0.010)
    box("Entry_InteriorRightReturn", door_frame, (3.12, 2.0, 3.66), (0.32, 3.25, 2.65), materials["Blackboard"], "architecture.hyosan.entrance.interior-dark-return", 0.010)
    box("Entry_InteriorCeiling", door_frame, (0.0, 3.50, 4.15), (6.25, 0.18, 1.75), materials["Damaged_AcousticCeiling"], "architecture.hyosan.entrance.interior-dark-ceiling", 0.010)
    box("Entry_GlassHeader", door_frame, (0.0, 3.55, 2.44), (5.10, 0.13, 0.12), materials["Smoked_Aluminium"], "architecture.hyosan.entrance.glass-frame", 0.012)
    for index, x in enumerate((-1.10, 0.0, 1.10)):
        mullion = box(f"Entry_GlassMullion_{x}", door_frame, (x, 1.95, 2.44), (0.14, 3.48, 0.14), materials["Smoked_Aluminium"], "architecture.hyosan.entrance.glass-frame", 0.012)
        if index == 2:
            set_authored_rotation(mullion, (0.0, 0.0, -0.028))
    box("Entry_GlassBottomRail", door_frame, (0.0, 0.47, 2.42), (5.08, 0.10, 0.12), materials["Smoked_Aluminium"], "architecture.hyosan.entrance.glass-frame", 0.010)
    box("Entry_BrickJamb_Left", door_frame, (-2.55, 1.95, 2.18), (0.66, 3.25, 0.66), materials["Broken_BrickWall"], "damage.hyosan.entrance.brick-jamb", 0.016)
    cylinder("Entry_BrickJambRebar_Left", door_frame, (-2.75, 2.42, 1.90), 0.025, 2.32, materials["Smoked_Aluminium"], "damage.hyosan.entrance.brick-jamb-rebar", rotation=(0.0, 0.0, 0.0))
    box("Entry_BrickJamb_RightBroken", door_frame, (2.55, 1.18, 2.18), (0.64, 1.66, 0.66), materials["Broken_BrickWall"], "damage.hyosan.entrance.broken-brick-jamb", 0.016)
    cylinder("Entry_BrickJambRebar_Right", door_frame, (2.72, 2.42, 1.90), 0.025, 1.58, materials["Smoked_Aluminium"], "damage.hyosan.entrance.broken-brick-jamb-rebar", rotation=(0.0, 0.0, -0.22))
    for index, x in enumerate((-1.80, 1.80)):
        if index == 0:
            box(f"Entry_SideGlazing_{index}", door_frame, (x, 1.96, 2.38), (1.18, 2.88, 0.020), materials["Wired_Glass"], "architecture.hyosan.entrance.side-wired-glass", 0.002)
        else:
            # The asymmetric side pane is mostly gone after the strike.
            box(f"Entry_SideGlazing_{index}", door_frame, (x + 0.10, 1.08, 2.38), (0.54, 0.72, 0.020), materials["Wired_Glass"], "architecture.hyosan.entrance.side-wired-glass-fragment", 0.002)
    for index, (x, missing) in enumerate(((-0.55, False), (0.55, True))):
        glass = group(f"Entry_GlassDoor_{index}", "architecture.hyosan.entrance.glass-door", door_frame)
        if not missing:
            box(f"Entry_GlassDoorPane_{index}", glass, (x, 1.95, 2.38), (1.04, 2.86, 0.018), materials["Wired_Glass"], "architecture.hyosan.entrance.wired-glass", 0.002)
        else:
            # Keep the broken doorway mostly open; two edge fragments sell
            # shattered wired glass while exposing a genuine dark recess.
            for shard_index, (dy, sx, sy) in enumerate(((1.06, 0.24, 0.38), (-1.02, 0.30, 0.22))):
                shard = box(f"Entry_GlassShard_{shard_index}", glass, (x + (shard_index - 1) * 0.24, 1.95 + dy, 2.38), (sx, sy, 0.016), materials["Wired_Glass"], "architecture.hyosan.entrance.glass-shard", 0.002)
                set_authored_rotation(shard, (0.0, (shard_index - 1) * 0.2, 0.0))
        box(f"Entry_DoorKick_{index}", glass, (x, 0.66, 2.39), (1.00, 0.15, 0.12), materials["Smoked_Aluminium"], "architecture.hyosan.entrance.door-threshold", 0.01)
        cylinder(f"Entry_DoorPull_{index}", glass, (x + (-0.18 if index == 0 else 0.18), 1.74, 2.23), 0.034, 0.72, materials["Smoked_Aluminium"], "architecture.hyosan.entrance.vertical-door-pull", rotation=(0.0, 0.0, 0.0))
    # Two different 4x4 atlas crack cells sit over actual glazing: no wire or
    # crack pattern is repeated across the facade, and the missing right pane
    # remains a genuine opening rather than a dark decal.
    damage_decal_patch("Entry_GlassSpiderweb_A", door_frame, [
        (-1.02, 2.02, 2.346), (-0.10, 2.02, 2.346), (-0.12, 3.12, 2.346),
        (-0.98, 3.08, 2.346),
    ], materials["Damage_Decal_Atlas"], (1, 0), "damage.hyosan.entrance.keyed-glass-spiderweb", (0.0, 0.0, -1.0))
    damage_decal_patch("Entry_GlassSpiderweb_B", door_frame, [
        (-0.94, 0.96, 2.346), (-0.14, 0.98, 2.346), (-0.18, 1.80, 2.346),
        (-0.98, 1.86, 2.346),
    ], materials["Damage_Decal_Atlas"], (2, 0), "damage.hyosan.entrance.keyed-glass-spiderweb", (0.0, 0.0, -1.0))
    # Short radial impact leads read as fractured glass without a texture grid
    # or transparent shadowing. They are deliberately irregular and local.
    for index, (x, y, angle, length) in enumerate(((-1.18, 2.76, 0.18, 0.42), (-1.30, 2.66, -0.46, 0.31), (-1.05, 2.59, 0.72, 0.36), (-1.34, 2.47, -0.16, 0.26), (-1.02, 2.42, 1.03, 0.22), (1.18, 1.25, -0.20, 0.30), (1.07, 1.36, 0.55, 0.24), (1.33, 1.44, -0.78, 0.20), (1.21, 1.58, 1.02, 0.18))):
        lead = cylinder(f"Entry_GlassImpactLead_{index}", door_frame, (x, y, 2.35), 0.006, length, materials["Smoked_Aluminium"], "damage.hyosan.entrance.glass-impact-crack", rotation=(0.0, 0.0, angle))
    for index, (x, y, angle, length) in enumerate(((-1.16, 2.88, 1.34, 0.16), (-1.35, 2.78, 0.98, 0.18), (-1.42, 2.58, 0.48, 0.15), (-0.96, 2.42, -0.74, 0.15), (1.04, 1.55, 1.28, 0.14), (1.00, 1.36, 0.82, 0.16), (1.28, 1.18, 0.26, 0.14), (1.42, 1.42, -0.44, 0.15))):
        arc = cylinder(f"Entry_GlassImpactArc_{index}", door_frame, (x, y, 2.35), 0.005, length, materials["Smoked_Aluminium"], "damage.hyosan.entrance.glass-impact-arc", rotation=(0.0, 0.0, angle))
    box("Entry_InteriorFloor", door_frame, (0.0, 0.05, 4.22), (7.72, 0.10, 3.10), materials["Dirty_Floor_Tile"], "architecture.hyosan.entrance.interior-floor-depth", 0.006)
    box("Entry_InteriorOffsetWall", door_frame, (2.78, 1.62, 4.86), (2.1, 3.05, 0.18), materials["Blackboard"], "architecture.hyosan.entrance.interior-offset-dark-wall", 0.010)
    for index, (x, z, scale, rotation) in enumerate(((-5.3, 1.4, 0.35, 0.4), (4.9, 1.5, 0.46, 1.3), (-3.8, -0.4, 0.24, 2.0), (3.9, 0.1, 0.28, 0.7), (-6.65, -1.0, 0.16, 1.8), (-2.70, -1.4, 0.18, 2.45), (2.85, -1.7, 0.22, 0.18), (6.22, -0.86, 0.15, 1.12))):
        rubble(f"Entry_Rubble_{index}", root, (x, scale * 0.42, z), (scale * 1.5, scale * 0.75, scale), materials["Charred_Plaster"], "prop.hyosan.entrance-rubble", rotation)
    for index, (x, z, scale, rotation) in enumerate(((-3.46, 1.08, 0.58, 0.36), (-2.94, 1.36, 0.32, 1.84), (3.32, 0.98, 0.44, 2.34))):
        rubble(f"Entry_JambHeroRubble_{index}", root, (x, scale * 0.43, z), (scale * 1.55, scale * 0.78, scale), materials["Charred_Plaster"], "prop.hyosan.entrance.jamb-hero-rubble", rotation)
    # The absent pane leaves a causal line of glass and frame fragments at the
    # threshold, instead of merely turning one otherwise pristine pane dark.
    for index, (x, z, sx, sz, angle) in enumerate(((1.18, 1.62, 0.32, 0.12, 0.24), (1.54, 1.30, 0.20, 0.18, -0.48), (0.86, 1.18, 0.16, 0.10, 0.74), (1.88, 1.48, 0.28, 0.07, -0.16))):
        shard = box(f"Entry_MissingPaneFloorShard_{index}", root, (x, 0.035, z), (sx, 0.012, sz), materials["Wired_Glass"], "damage.hyosan.entrance.missing-pane-floor-shard", 0.001)
        set_authored_rotation(shard, (0.0, angle, 0.02 * (index - 1)))
    for index, (x, z, width, angle) in enumerate(((-5.8, -1.2, 1.05, -0.34), (-4.15, -1.0, 0.72, 0.22), (4.85, -0.85, 1.15, 0.28), (5.95, 0.45, 0.68, -0.22))):
        slab = box(f"Entry_CrackedSlab_{index}", root, (x, 0.18, z), (width, 0.18, 0.62), materials["Charred_Plaster"], "damage.hyosan.entrance.cracked-concrete-slab", 0.015)
        set_authored_rotation(slab, (0.08 + index * 0.03, angle, -0.14 + index * 0.07))
    # Fine local debris gives the forecourt a layered strike aftermath without
    # treating the player-facing entrance as an evenly distributed prop field.
    for index, (x, z, scale, rotation) in enumerate(((-2.82, -0.24, 0.07, 0.4), (-2.44, -0.38, 0.09, 1.3), (-1.95, -0.08, 0.055, 2.2), (1.56, -0.45, 0.07, 0.8), (2.15, -0.20, 0.11, 2.7), (3.06, -0.12, 0.06, 0.2), (-5.12, 0.32, 0.10, 1.8), (5.28, 0.48, 0.08, 2.4))):
        rubble(f"Entry_MicroDebris_{index}", root, (x, scale * 0.30, z), (scale * 1.4, scale * 0.42, scale), materials["Charred_Plaster"], "prop.hyosan.entrance.micro-rubble", rotation)
    return root, floor


def select_tree(root: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    stack = [root]
    while stack:
        current = stack.pop()
        current.select_set(True)
        stack.extend(current.children)
    bpy.context.view_layer.objects.active = root


def export_glb(root: bpy.types.Object, filename: str) -> Path:
    path = RAW_DIR / filename
    select_tree(root)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_materials="EXPORT",
        # Keep the source files only under outputs/, but embed their actual
        # pixels in this source GLB.  `export_keep_originals=True` in Blender
        # 5.2 writes a generated 1x1 placeholder when the target is GLB.
        export_image_format="AUTO",
        export_keep_originals=False,
        export_lights=False,
        export_cameras=False,
        export_extras=True,
        export_animations=True,
        export_unused_images=False,
    )
    return path


def bake_static_ao(name: str, floor: bpy.types.Object) -> tuple[Path, str]:
    """Bake a ground-receiver AO map in Cycles.  It is intentionally not GI."""
    image = bpy.data.images.new(f"{name}-static-ao", width=1024, height=1024, alpha=False)
    image.filepath_raw = str(BAKE_DIR / f"{name}-static-ao.png")
    image.file_format = "PNG"
    image.colorspace_settings.name = "Non-Color"
    material = floor.active_material
    nodes = material.node_tree.nodes
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.name = f"{name}_StaticAO_BakeTarget"
    image_node.image = image
    nodes.active = image_node
    scene = bpy.context.scene
    original_engine = scene.render.engine
    try:
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 16
        scene.render.bake.margin = 8
        scene.render.bake.use_clear = True
        scene.render.bake.use_selected_to_active = False
        bpy.ops.object.select_all(action="DESELECT")
        floor.select_set(True)
        bpy.context.view_layer.objects.active = floor
        bpy.ops.object.bake(type="AO", margin=8)
        image.save()
        return Path(image.filepath_raw), "cycles-ground-receiver-ao"
    except RuntimeError as error:
        # A missing device/API must be explicit to the runtime metadata.
        print(f"Last Bell AO bake unavailable for {name}: {error}")
        return Path(image.filepath_raw), "unavailable-no-fallback"
    finally:
        scene.render.engine = original_engine


def lightmap_carrier(name: str, source: Path) -> Path:
    """Export a one-plane carrier so glTF Transform can produce a named KTX2."""
    image = bpy.data.images.load(str(source), check_existing=False)
    material = bpy.data.materials.new(f"{name}-static-ao-carrier")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    links.new(tex.outputs["Color"], nodes.get("Principled BSDF").inputs["Base Color"])
    carrier = group(f"{name}-StaticAO_Carrier", f"lightmap.hyosan.{name}.ground-ao")
    carrier["lightmap_kind"] = "cycles-ground-receiver-ao"
    plane = box(f"{name}-StaticAO_Plane", carrier, (40.0, -10.0, 40.0), (1.0, 0.01, 1.0), material, f"lightmap.hyosan.{name}.ground-ao", 0.0)
    path = export_glb(carrier, f"{name}-static-ao-carrier.raw.glb")
    bpy.data.objects.remove(carrier, do_unlink=True)
    bpy.data.objects.remove(plane, do_unlink=True)
    bpy.data.materials.remove(material)
    return path


def add_area(name: str, location: tuple[float, float, float], target: tuple[float, float, float], color: tuple[float, float, float], energy: float, size: float) -> bpy.types.Object:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = to_blender_position(location)
    obj.rotation_euler = (Vector(to_blender_position(target)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def add_spot(name: str, location: tuple[float, float, float], target: tuple[float, float, float], color: tuple[float, float, float], energy: float, angle: float) -> bpy.types.Object:
    data = bpy.data.lights.new(name, "SPOT")
    data.energy = energy
    data.color = color
    data.spot_size = angle
    data.spot_blend = 0.62
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = to_blender_position(location)
    obj.rotation_euler = (Vector(to_blender_position(target)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def camera_at(location: tuple[float, float, float], target: tuple[float, float, float], lens: float = 28.0) -> bpy.types.Object:
    camera_data = bpy.data.cameras.new("LastBell_RenderCamera")
    camera_data.lens = lens
    camera = bpy.data.objects.new("LastBell_RenderCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = to_blender_position(location)
    target_position = Vector(to_blender_position(target))
    # Construct the camera basis explicitly with Blender +Z as the vertical.
    # Quaternion tracking can roll a perspective camera on oblique targets.
    forward = (target_position - camera.location).normalized()
    world_up = Vector((0.0, 0.0, 1.0))
    right = forward.cross(world_up).normalized()
    up = right.cross(forward).normalized()
    rotation = Matrix((right, up, -forward)).transposed().to_4x4()
    camera.matrix_world = Matrix.Translation(camera.location) @ rotation
    bpy.context.scene.camera = camera
    return camera


def set_render_roots(roots: list[bpy.types.Object], visible: set[bpy.types.Object]) -> None:
    for root in roots:
        root.hide_render = root not in visible


def set_render_lights(lights: list[bpy.types.Object], visible: set[bpy.types.Object]) -> None:
    for light in lights:
        light.hide_render = light not in visible


def render_luma(path: Path) -> dict[str, float | bool]:
    image = bpy.data.images.load(str(path), check_existing=False)
    # `image.pixels` otherwise reflects Blender's working conversion.  The
    # review contract is the rendered PNG as displayed in a browser, so read
    # its stored sRGB samples without applying a second display transfer.
    image.colorspace_settings.name = "Non-Color"
    pixels = np.asarray(image.pixels[:], dtype=np.float32).reshape((-1, 4))[:, :3]
    luma = pixels[:, 0] * 0.2126 + pixels[:, 1] * 0.7152 + pixels[:, 2] * 0.0722
    bpy.data.images.remove(image)
    return {
        "mean_0_100": round(float(np.mean(luma) * 100), 2),
        "below_16_percent": round(float(np.mean(luma < 0.16) * 100), 2),
        "above_235_percent": round(float(np.mean(luma > (235 / 255))) * 100, 3),
    }


def render_stills(entry: bpy.types.Object, start_room: bpy.types.Object, first_bay: bpy.types.Object, door: bpy.types.Object) -> dict[str, dict[str, float | bool]]:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    world_background = scene.world.node_tree.nodes.get("Background") if scene.world and scene.world.use_nodes else None
    if world_background:
        world_background.inputs["Color"].default_value = (0.001, 0.003, 0.004, 1.0)
        world_background.inputs["Strength"].default_value = 0.02
    else:
        scene.world.color = (0.001, 0.003, 0.004)
    moon = add_area("MoonKey", (-5.8, 5.8, 2.1), (0, 1.8, 7), (0.19, 0.72, 0.76), 410, 5.5)
    # The cyan key lives at the authored x=-3 window wall.  It only rims the
    # openings and floor lane, rather than becoming a broad corridor fill.
    corridor = add_area("CyanCorridor", (-2.3, 2.3, 19.0), (1.5, 1.6, 19.0), (0.06, 0.55, 0.64), 160, 2.6)
    corridor_depth = add_area("CorridorDepthFill", (2.4, 2.0, 23.85), (0.8, 0.55, 24.6), (0.20, 0.46, 0.48), 50, 2.0)
    corridor_side = add_area("CorridorWindowShaft", (-2.72, 2.12, 20.7), (0.85, 1.35, 21.8), (0.05, 0.50, 0.60), 65, 1.7)
    # Tight, inward-facing rim lights let the three real x=- window frames
    # read as separate moonlit openings. They illuminate sill/mullion depth
    # only; no cyan card or broad corridor fill is rendered behind the glass.
    corridor_window_rims = [
        add_area(f"CorridorWindowRim_{index}", (-1.26, 2.22, z), (-2.94, 2.22, z), (0.04, 0.50, 0.59), 38, 1.35)
        for index, z in enumerate((14.9, 18.9, 22.9))
    ]
    corridor_door_rims = [
        add_area(f"CorridorDoorRim_{index}", (1.46, 2.26, z), (2.84, 2.26, z), (0.035, 0.34, 0.39), 15, 1.10)
        for index, z in enumerate((14.9, 18.9, 22.9))
    ]
    rear = add_area("RearFill", (1.5, 3.7, -1.4), (0, 1.7, 5), (0.22, 0.50, 0.47), 470, 4.0)
    cold_open = add_area("ColdOpenKey", (2.1, 3.7, 8.8), (0.0, 2.25, -1.7), (0.12, 0.58, 0.62), 1050, 4.8)
    flashlight = add_spot("GameplayNeutralFlashlight", (0.0, 1.62, 4.12), (0.0, 1.28, 10.3), (0.69, 0.86, 0.84), 3100, 0.54)
    gameplay_window = add_area("GameplayWindowSpill", (-5.85, 2.4, 5.5), (0.0, 1.2, 8.6), (0.05, 0.38, 0.47), 120, 2.8)
    gameplay_negative = add_area("GameplayNegativeFill", (5.9, 2.4, 6.0), (3.2, 1.0, 8.4), (0.008, 0.018, 0.018), 8, 3.0)
    entry_cyan = add_area("EntryCyan", (-4.2, 3.6, -7.3), (0.0, 2.0, -6.3), (0.08, 0.62, 0.68), 455, 3.5)
    entry_fill = add_area("EntryFill", (3.6, 2.5, -12.0), (0.0, 1.9, -6.3), (0.22, 0.42, 0.42), 245, 3.0)
    gameplay_bounce = add_area("GameplayNeutralBounce", (-0.25, 2.35, 3.65), (0.0, 1.35, 10.1), (0.62, 0.79, 0.77), 160, 1.85)
    corridor_axis = add_area("CorridorNeutralAxis", (-0.15, 2.65, 16.3), (-0.45, 1.15, 24.45), (0.56, 0.72, 0.70), 32, 1.8)
    entry_wide = add_area("EntryWideFill", (0.0, 5.2, -10.5), (0.0, 1.7, -6.0), (0.16, 0.30, 0.30), 245, 8.0)
    all_lights = [moon, corridor, corridor_depth, corridor_side, *corridor_window_rims, *corridor_door_rims, rear, cold_open, flashlight, gameplay_window, gameplay_negative, gameplay_bounce, corridor_axis, entry_cyan, entry_fill, entry_wide]
    light_sets = {
        "entry": {entry_cyan, entry_fill, entry_wide},
        "cold-open": {moon, rear, cold_open},
        "gameplay": {flashlight, gameplay_window, gameplay_negative, gameplay_bounce},
        "open-door": {flashlight, gameplay_window, gameplay_negative, gameplay_bounce, corridor, corridor_depth, corridor_side, corridor_axis, *corridor_window_rims, *corridor_door_rims},
    }
    set_authored_location(entry, (0.0, 0.0, -9.0))
    set_authored_location(door, (0.0, 1.5, 13.0))
    roots = [entry, start_room, first_bay, door]
    shots = [
        ("entry.png", "entry", {entry}, (0.0, 2.24, -13.5), (0.0, 2.05, -6.55)),
        ("cold-open.png", "cold-open", {start_room, first_bay, door}, (2.5, 1.44, 9.6), (-1.62, 1.62, -1.76)),
        ("gameplay.png", "gameplay", {start_room, first_bay, door}, (0.0, 1.68, 4.0), (0.0, 1.5, 13.0)),
        # The hiding cover has its own internal-review camera at the exact
        # interaction x/z. This prevents a technically valid but oversized
        # desk from being accepted without verifying the under-desk occluder.
        ("hiding-desk.png", "gameplay", {start_room}, (-3.0, .60, 5.18), (-3.0, .58, 6.22)),
    ]
    camera = None
    for filename, light_set, visible, location, target in shots:
        set_render_roots(roots, visible)
        set_render_lights(all_lights, light_sets[light_set])
        if camera:
            bpy.data.objects.remove(camera, do_unlink=True)
        lens = 38.0 if filename == "entry.png" else (28.0 if filename == "cold-open.png" else 28.0)
        camera = camera_at(location, target, lens=lens)
        scene.render.filepath = str(RENDER_DIR / filename)
        bpy.ops.render.render(write_still=True)
    left = bpy.data.objects.get("Door_Panel_L")
    right = bpy.data.objects.get("Door_Panel_R")
    # For the review still the fully-open leaves must clear the cyan window
    # side.  Keeping them near the opening made the corridor read as two
    # black panels instead of an open sliding-door threshold.
    if left:
        # With a half-leaf width of about 0.53m, ±1.62m opens the exact
        # x[-1.1,1.1] portal without pushing review-only geometry beyond the
        # fixed side pockets or obscuring the first three corridor bays.
        left.location.x = -1.62
    if right:
        right.location.x = 1.62
    set_render_roots(roots, {start_room, first_bay, door})
    set_render_lights(all_lights, light_sets["open-door"])
    if camera:
        bpy.data.objects.remove(camera, do_unlink=True)
    # Hold the review camera on the portal centreline. Both walls are visible:
    # x=-3 resolves into three cyan-rimmed window openings and x=+3 into the
    # darker three-door/transom rhythm, with the clear floor lane between.
    camera = camera_at((0.0, 1.68, 10.55), (0.0, 1.55, 22.0), lens=26.0)
    scene.render.filepath = str(RENDER_DIR / "open-door.png")
    bpy.ops.render.render(write_still=True)
    if left:
        left.location.x = -0.54
    if right:
        right.location.x = 0.54
    set_authored_location(entry, (0.0, 0.0, 0.0))
    set_authored_location(door, (0.0, 0.0, 0.0))
    set_render_roots(roots, set(roots))
    set_render_lights(all_lights, set(all_lights))
    targets = {
        "entry.png": (6.0, 11.0),
        "cold-open.png": (8.0, 14.0),
        "gameplay.png": (3.0, 8.0),
        "hiding-desk.png": (3.0, 8.0),
        "open-door.png": (4.0, 10.0),
    }
    result = {}
    for filename, target_range in targets.items():
        metric = render_luma(RENDER_DIR / filename)
        mean = float(metric["mean_0_100"])
        low = float(metric["below_16_percent"])
        metric["target_mean_0_100"] = list(target_range)
        metric["mean_gate_pass"] = target_range[0] <= mean <= target_range[1]
        metric["shadow_gate_pass"] = low >= 65.0
        metric["highlight_gate_pass"] = float(metric["above_235_percent"]) <= 0.5
        result[filename] = metric
    return result


def main() -> None:
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_percentage = 100
    scene.view_settings.look = "AgX - Medium High Contrast"
    random.seed(1107)
    print("Generating original procedural PBR maps", flush=True)
    materials = make_material_library()
    print("Building start room", flush=True)
    start_room, start_floor = create_start_room(materials)
    pack_lightmap_uv(start_floor)
    print("Building classroom door", flush=True)
    door = create_classroom_door(materials)
    # Export the two runtime-critical assets before building the review-only
    # exterior and bay, preserving a fast export/validate checkpoint.
    print("Exporting critical start-room GLB", flush=True)
    export_glb(start_room, "start-room.raw.glb")
    print("Exporting critical classroom-door GLB", flush=True)
    export_glb(door, "classroom-door.raw.glb")
    print("Building first corridor bay and entry", flush=True)
    first_bay, bay_floor = create_first_bay(materials)
    entry, entry_floor = create_entry(materials)
    pack_lightmap_uv(bay_floor)
    pack_lightmap_uv(entry_floor)
    export_glb(first_bay, "first-bay.raw.glb")
    export_glb(entry, "entry.raw.glb")
    bake_results = {}
    for name, floor in (("start-room", start_floor), ("first-bay", bay_floor), ("entry", entry_floor)):
        source, state = bake_static_ao(name, floor)
        bake_results[name] = {"png": str(source.relative_to(ROOT_DIR)), "state": state}
    luma_report = render_stills(entry, start_room, first_bay, door)
    bpy.ops.wm.save_as_mainfile(filepath=str(RAW_DIR / "last-bell-source.blend"))
    (RAW_DIR / "build-report.json").write_text(json.dumps({
        "schema": 1,
        "art_source": "deterministic-procedural + approved-polyhaven-cc0-pbr",
        "no_source_pixel_projection": True,
        "external_pbr_provenance": "raw/polyhaven-pbr/provenance.json",
        "physical_texture_scale_m": {
            "Dirty_Floor_Tile": 2.0,
            "Charred_Plaster": 1.8,
            "Smoked_Aluminium": 1.0,
            "Worn_Wood": 0.6,
            "Exposed_Brick": 1.4,
            "Wired_Glass": 0.65,
            "Blackboard": 1.2,
            "Hyosan_Yellow": 1.5,
            "School_PaintedLower": 1.8,
            "School_UpperPaint": 1.8,
            "Damaged_AcousticCeiling": 0.8,
            "Door_RustedMetal": 1.0,
        },
        "render_luminance": luma_report,
        "static_lightmaps": bake_results,
        "coordinate_contract": {
            "start_room": "x[-7,7] z[-2,13.2] y[0,4]",
            "player_start": [0, 1.68, 4],
            "door_closed_transform": [0, 1.5, 13],
            "portal": "x[-1.1,1.1] z[12.85,13.15]",
            "first_bay": "x[-3,3] z[13.2,25] y[0,4]",
            "cold_open_camera": [2.5, 1.44, 9.6],
        },
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
