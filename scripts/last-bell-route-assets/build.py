#!/usr/bin/env python3
"""Author streamable Last Bell routes and replaceable non-likeness characters.

Every delivery mesh is authored with UV0/UV1, CC0 PBR texture maps, semantic
anchors and collision contracts. Character art deliberately makes no actor
likeness claim; it is a skinned replacement seam with original material
variants and approved clip names.
"""

from __future__ import annotations

import math
import os
import sys
import json
import hashlib
import struct
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector


def args() -> tuple[Path, Path]:
    marker = sys.argv.index("--")
    return Path(sys.argv[marker + 1]).resolve(), Path(sys.argv[marker + 2]).resolve()


OUTPUT, DELIVERY = args()
RAW = OUTPUT / "raw"
RAW.mkdir(parents=True, exist_ok=True)
# The 20MiB route/character target and 24MiB hard cap reserve 512px KTX2 PBR
# for the first encounter and rooftop hero zones. Support zones remain 256px
# because the streaming contract prevents them from being visual focal points
# until after their portal transition.
ROUTE_PBR_DELIVERY_SIZE = 256
REPO_ROOT = Path(__file__).resolve().parents[2]
PBR_DIR = REPO_ROOT / "outputs" / "last-bell-3d" / "raw" / "polyhaven-pbr"
HUMAN_BASE_BLEND = REPO_ROOT / "outputs" / "last-bell-character-sources" / "human-base-meshes-bundle-v1.4.1" / "human_base_meshes_bundle.blend"
OPENING_SOURCE_BLEND = REPO_ROOT / "outputs" / "last-bell-3d" / "raw" / "last-bell-source.blend"
CHARACTER_PBR_DIR = RAW / "character-pbr"
# Route dressing is authored and validated in its own stage-only kit.  Route
# builds consume its raw PNG-textured GLBs so Blender can retain base/normal/
# ORM maps before this pack applies the common KTX2 + Meshopt delivery pass.
# Never write into this directory from the route build.
ROUTE_PROP_RAW_DIR = REPO_ROOT / "outputs" / "last-bell-route-props" / "raw"
ROUTE_PROP_BUILD_ID = "last-bell-route-props-71a10d1704393e9a"
POLYHAVEN_DUCT_SOURCE = PBR_DIR / "models" / "modular_airduct_circular_01" / "modular_airduct_circular_01_1k.gltf"
POLYHAVEN_DUCT_API = "https://api.polyhaven.com/files/modular_airduct_circular_01"
POLYHAVEN_DUCT_SHA256 = "7087958648acaa201fb3f1900e1ff61c2bfed7372f648346b4dc70d92b618274"
# Detailed CC0 models are ingested as DCC source only. The route output keeps
# their authored topology while remapping them to our shared KTX2 PBR atlases,
# preventing six stock 1K texture bundles from defeating zone streaming.
# `api-1k.json` beside each source retains Poly Haven's official URL, MD5 and
# component list; the recorded SHA-256 below covers the downloaded glTF source.
POLYHAVEN_DETAIL_MODELS = {
    "mounted_fluorescent_lights": {
        "gltf": PBR_DIR / "models" / "mounted_fluorescent_lights" / "mounted_fluorescent_lights_1k.gltf",
        "api": "https://api.polyhaven.com/files/mounted_fluorescent_lights",
        "url": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/mounted_fluorescent_lights/mounted_fluorescent_lights_1k.gltf",
        "md5": "88af3c716ac36b280c60579f4b015119",
        "sha256": "7a56f167fe7074f4e4d4f314f72c5aa8b01c191394ee5ecb0b3461a240441b4a",
        "pieces": 7,
    },
    "korean_fire_extinguisher_01": {
        "gltf": PBR_DIR / "models" / "korean_fire_extinguisher_01" / "korean_fire_extinguisher_01_1k.gltf",
        "api": "https://api.polyhaven.com/files/korean_fire_extinguisher_01",
        "url": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/korean_fire_extinguisher_01/korean_fire_extinguisher_01_1k.gltf",
        "md5": "842e3c682b1bd286ba90af70848a0fbf",
        "sha256": "565f9e41909165c2bead24b722746e29ba55e8eb5e541f61fe0d1ef7e66d2ecf",
        "pieces": 1,
    },
    "utility_box_01": {
        "gltf": PBR_DIR / "models" / "utility_box_01" / "utility_box_01_1k.gltf",
        "api": "https://api.polyhaven.com/files/utility_box_01",
        "url": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/utility_box_01/utility_box_01_1k.gltf",
        "md5": "a9154d210827ea508c59cb5917ca1d0f",
        "sha256": "5b9f8c45f2640c9dd831dc3450529e45b24c987208ddcf73010fe717ce8c454e",
        "pieces": 1,
    },
    "portable_generator": {
        "gltf": PBR_DIR / "models" / "portable_generator" / "portable_generator_1k.gltf",
        "api": "https://api.polyhaven.com/files/portable_generator",
        "url": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/portable_generator/portable_generator_1k.gltf",
        "md5": "13c2380487daae6726443b9f38dd7e53",
        "sha256": "d5afe27834f824dfe753391713c45be03479e8100831f320796030531f61b848",
        "pieces": 4,
    },
    "modular_industrial_pipes_01": {
        "gltf": PBR_DIR / "models" / "modular_industrial_pipes_01" / "modular_industrial_pipes_01_1k.gltf",
        "api": "https://api.polyhaven.com/files/modular_industrial_pipes_01",
        "url": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/modular_industrial_pipes_01/modular_industrial_pipes_01_1k.gltf",
        "md5": "cb30fdf4d471374ba439bfd5a0c8105d",
        "sha256": "455d3a0fe95b7900a08cbebb23cfb2c341672fcb67ae7355d776e53cfa3d0688",
        "pieces": 8,
    },
    "exterior_aircon_unit": {
        "gltf": PBR_DIR / "models" / "exterior_aircon_unit" / "exterior_aircon_unit_1k.gltf",
        "api": "https://api.polyhaven.com/files/exterior_aircon_unit",
        "url": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/exterior_aircon_unit/exterior_aircon_unit_1k.gltf",
        "md5": "10beccfb1bf0c973a0729be8970532a9",
        "sha256": "f19d85c76948903047c2846068aeaa376d5e956a410675268cb6cb6aac5d97c2",
        "pieces": 2,
    },
    "stone_fire_pit": {
        "gltf": PBR_DIR / "models" / "stone_fire_pit" / "stone_fire_pit_1k.gltf",
        "api": "https://api.polyhaven.com/files/stone_fire_pit",
        "url": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/stone_fire_pit/stone_fire_pit_1k.gltf",
        "md5": "f3a23e45ee66802ccc7a5462a9371ae3",
        "sha256": "40034b326d28c06f25cf1cdb39a5ab3f3b1d1a9415d490af39621efe6c31cee6",
        "pieces": 1,
    },
    # These two sources were already downloaded with their official CC0
    # provenance by ``fetch-polyhaven-pbr.mjs``.  They replace the old
    # generic desk/chair assemblies at the first player sightline with real
    # school furniture topology (underside, welded frame, seat shell and
    # hardware), while retaining the shared zone-local material policy.
    "SchoolDesk_01": {
        "gltf": PBR_DIR / "models" / "SchoolDesk_01" / "SchoolDesk_01_1k.gltf",
        "api": "https://api.polyhaven.com/files/SchoolDesk_01",
        "url": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/SchoolDesk_01/SchoolDesk_01_1k.gltf",
        "md5": "f327b010a117ab6af3dec7538cdf23ee",
        "sha256": "9d840b58a9e66ce9dc3d8d5396fb97cf954b12dc27adaf41b8cc78ae1a6404eb",
        "pieces": 1,
    },
    "SchoolChair_01": {
        "gltf": PBR_DIR / "models" / "SchoolChair_01" / "SchoolChair_01_1k.gltf",
        "api": "https://api.polyhaven.com/files/SchoolChair_01",
        "url": "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/SchoolChair_01/SchoolChair_01_1k.gltf",
        "md5": "dea922d55d029fb99085b50196d1eec0",
        "sha256": "1db6aca4bf379c2d568b2068492dcfcda15d764c0c3d98a970055af25b46281e",
        "pieces": 1,
    },
}
# Kept outside the route's ordinary kit: these are the private recovery's
# hero silhouettes, fetched from Poly Haven's official API with a separate
# CC0 provenance manifest under ``outputs/last-bell-terra-authored-recovery``.
TERRA_RECOVERY_CC0_DIR = REPO_ROOT / "outputs" / "last-bell-terra-authored-recovery" / "cc0-official"
TERRA_RECOVERY_MATTE = REPO_ROOT / "outputs" / "last-bell-terra-authored-recovery" / "mattes" / "rooftop-night-mountain-matte-v1.png"
TERRA_RECOVERY_MATTE_SHA256 = "04a8532c64b54a359b808aed09eba6c4becce96835817ca8b38bc38d8546394e"
TERRA_RECOVERY_MODELS = {
    "modular_factory_facade": {
        "gltf": TERRA_RECOVERY_CC0_DIR / "modular_factory_facade" / "modular_factory_facade_1k.gltf",
        "sha256": "41ff58b722f9cb3e9db8bcacae3163946603ae99a1d42bb6f9045d7c4ec0f179",
    },
    "modular_fire_escape": {
        "gltf": TERRA_RECOVERY_CC0_DIR / "modular_fire_escape" / "modular_fire_escape_1k.gltf",
        "sha256": "3a28e24cf2b6fc32c86f4fd378a372f9c3babfb9c2206036c6276d5bb47df2fd",
    },
    "caged_hanging_light": {
        "gltf": TERRA_RECOVERY_CC0_DIR / "caged_hanging_light" / "caged_hanging_light_1k.gltf",
        "sha256": "4d809194606f0862a08147df6408f2124ed7a5dbc90e4090c82a332efb3aa50d",
    },
    "modular_electric_cables": {
        "gltf": TERRA_RECOVERY_CC0_DIR / "modular_electric_cables" / "modular_electric_cables_1k.gltf",
        "sha256": "f9292a9eff5bea32dde06356633da84615c508c9c0ee0246fc96c301cfd71fe8",
    },
    "concrete_road_barrier_02": {
        "gltf": TERRA_RECOVERY_CC0_DIR / "concrete_road_barrier_02" / "concrete_road_barrier_02_1k.gltf",
        "sha256": "52d13b5105ce861db5dd1413a1a924ad5594dee5a8eb37dbe1a9df441fcd7caf",
    },
}
# BlenderKit is intentionally a *private* photogrammetry input, never a
# runtime dependency.  The exact revision/hash inventory is pinned by the
# source fetcher and visual gate supplied with this recovery.  These values
# live here too so a DCC build cannot silently exchange one download for a
# similarly named stock asset.
BLENDERKIT_ENVIRONMENT_SOURCE_DIR = REPO_ROOT / "outputs" / "last-bell-environment-recovery-sources" / "blenderkit-cc0"
BLENDERKIT_ENVIRONMENT_PROVENANCE = BLENDERKIT_ENVIRONMENT_SOURCE_DIR / "provenance.json"
BLENDERKIT_ENVIRONMENT_SOURCE_PROVENANCE = "outputs/last-bell-environment-recovery-sources/blenderkit-cc0/provenance.json"
BLENDERKIT_ENVIRONMENT_SOURCES = {
    "abandoned-house": {
        "file": "abandoned-house.glb",
        "sha256": "618d5f5153470d9039c11d6dc82eb1625416d383d6e1efcc5b23005b71a94660",
        "asset_base_id": "94e53774-84d7-430e-89bd-12cf7b2ef828",
    },
    "painted-concrete-blocks": {
        "file": "painted-concrete-blocks.glb",
        "sha256": "efd2e80aa3f957da81e64d68d0bcd11526f5bb2b215f12d88206a6357793e29e",
        "asset_base_id": "049c6887-3484-4725-b8ae-8749d7b68e1f",
    },
    "scan-old-broken-floor": {
        "file": "scan-old-broken-floor.glb",
        "sha256": "77e8919e10008374ad67a078be3bf2a697704297129ac61708856403ae46ac34",
        "asset_base_id": "c4f28476-3d97-46dc-8969-cbf704059205",
    },
    "scan-rubble-pile-a": {
        "file": "scan-rubble-pile-a.glb",
        "sha256": "cf9681a80565cfd9845b63b39a205758cf904807917da7f5e216368d5ab9a58e",
        "asset_base_id": "930f3a3b-b6c3-4971-ab86-ce65c93b2a3c",
    },
    "scan-rubble-ruins": {
        "file": "scan-rubble-ruins.glb",
        "sha256": "6a51c2a3f63f3acc2417494f673bb068d55152e27d64dd758c5e51e167c8ee33",
        "asset_base_id": "853f291b-6f22-4900-9979-75826dac8c27",
    },
}
BLENDERKIT_GEOMETRY_ONLY_IMPORTS: list[dict[str, object]] = []
OPENING_REFERENCE_MESHES: dict[str, bpy.types.Object] | None = None
# The roof review/route composition begins at the authoritative exit at
# local-z=0.  Keeping this landmark in one place prevents the physical hearth,
# its contact treatment and the same-camera review key from drifting apart.
ROOFTOP_FIRE_Z = 12.10

# Each material class starts from its own physical CC0 source.  A previous
# one-map shortcut multiplied *everything* by charred plaster, which made the
# first encounter's furniture and people read as the same black clay under the
# cyan key.  Tints still establish the fiction; base, normal and ORM response
# now retain the distinction between painted masonry, oxidised metal, wood,
# exposed brick and fabric.
PBR_SOURCES = {
    "concrete": "dirty-floor-tile",
    "roof": "tarred-gravel",
    "wall": "charred-plaster",
    "sage": "worn-wood",
    "metal": "smoked-aluminium",
    "glass": "smoked-aluminium",
    "wood": "worn-wood",
    "black": "charred-plaster",
    "cyan": "smoked-aluminium",
    "ember": "exposed-brick",
    # The first recovery used the damaged-wall scan for all exposed masonry.
    # At player height its broad mortar bands stretched into timber-like
    # stripes on the rooftop headhouse.  This is the opening vocabulary's
    # actual small-format exposed brick source, tiled at a physical scale.
    "brick": "exposed-brick",
    "uniform": "cotton-jersey",
    "athletic": "cotton-jersey",
    "staff": "cotton-jersey",
    "skin": "cotton-jersey",
    "hair": "cotton-jersey",
}


def clear() -> None:
    global OPENING_REFERENCE_MESHES
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves, bpy.data.armatures, bpy.data.actions):
        for item in list(collection):
            try:
                collection.remove(item)
            except RuntimeError:
                pass
    # Every route is built in a clean Blender scene. Reusing object/material
    # pointers from a previous zone makes source-derived finishes disappear
    # after their datablocks are released.
    OPENING_REFERENCE_MESHES = None


def tag(obj: bpy.types.Object, semantic: str, **extras: object) -> bpy.types.Object:
    obj["semantic_id"] = semantic
    for key, value in extras.items():
        obj[key] = value
    return obj


def to_blender(location: tuple[float, float, float]) -> tuple[float, float, float]:
    """Convert the shared glTF game-space (x, up=y, forward=z) into Blender."""
    x, y, z = location
    return (x, -z, y)


def size_to_blender(size: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = size
    return (x, z, y)


def texture_triplet(source: str, delivery_size: int | None = None) -> dict[str, bpy.types.Image]:
    files = {
        "basecolor": PBR_DIR / f"{source}-basecolor.png",
        "normal": PBR_DIR / f"{source}-normal.png",
        "orm": PBR_DIR / f"{source}-orm.png",
    }
    missing = [str(path) for path in files.values() if not path.exists()]
    if missing:
        raise RuntimeError(f"Missing CC0 PBR source maps: {', '.join(missing)}. Run scripts/last-bell-3d/fetch-polyhaven-pbr.mjs first.")
    images: dict[str, bpy.types.Image] = {}
    # Zone-local GLBs repeat their texture payloads by design. Hero zones use
    # 512px delivery copies while later support zones use 256px; both are KTX2
    # + Meshopt packaged and are measured against the 20MiB target / 24MiB
    # hard pack cap. Merely resizing an in-memory linked image was ignored by
    # glTF export, which still embedded its source file.
    resolved_delivery_size = delivery_size or ROUTE_PBR_DELIVERY_SIZE
    delivery_dir = RAW / f"route-pbr-{resolved_delivery_size}"
    delivery_dir.mkdir(parents=True, exist_ok=True)
    for key, path in files.items():
        delivery_path = delivery_dir / f"{source}-{key}-{resolved_delivery_size}.png"
        if delivery_path.exists():
            images[key] = bpy.data.images.load(str(delivery_path), check_existing=True)
            continue
        source_image = bpy.data.images.load(str(path), check_existing=True)
        delivery_image = source_image.copy()
        delivery_image.scale(resolved_delivery_size, resolved_delivery_size)
        delivery_image.filepath_raw = str(delivery_path)
        delivery_image.file_format = "PNG"
        delivery_image.save()
        images[key] = delivery_image
    images["basecolor"].colorspace_settings.name = "sRGB"
    images["normal"].colorspace_settings.name = "Non-Color"
    images["orm"].colorspace_settings.name = "Non-Color"
    return images


def mat(name: str, color: tuple[float, float, float, float], metal: float = 0.0, rough: float = 0.6, source: str = "concrete", emission: tuple[float, float, float, float] | None = None, emission_strength: float = 0.0, roughness_multiplier: float = 1.0, physical_texture_width_m: float = 1.0, delivery_size: int | None = None) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    nodes = result.node_tree.nodes
    links = result.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    assert bsdf is not None
    images = texture_triplet(PBR_SOURCES[source], delivery_size)
    base = nodes.new("ShaderNodeTexImage")
    base.name = f"{name}_BaseColor"
    base.image = images["basecolor"]
    tint = nodes.new("ShaderNodeMixRGB")
    tint.blend_type = "MULTIPLY"
    tint.inputs[0].default_value = 1.0
    tint.inputs[2].default_value = color
    orm = nodes.new("ShaderNodeTexImage")
    orm.name = f"{name}_ORM"
    orm.image = images["orm"]
    normal = nodes.new("ShaderNodeTexImage")
    normal.name = f"{name}_Normal"
    normal.image = images["normal"]
    separate = nodes.new("ShaderNodeSeparateColor")
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(base.outputs["Color"], tint.inputs[1])
    links.new(tint.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(orm.outputs["Color"], separate.inputs["Color"])
    if roughness_multiplier != 1.0:
        roughness = nodes.new("ShaderNodeMath")
        roughness.operation = "MULTIPLY"
        roughness.inputs[1].default_value = roughness_multiplier
        links.new(separate.outputs["Green"], roughness.inputs[0])
        links.new(roughness.outputs[0], bsdf.inputs["Roughness"])
    else:
        links.new(separate.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(separate.outputs["Blue"], bsdf.inputs["Metallic"])
    links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emission is not None and emission_strength > 0:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    result["asset_quality"] = "authored-pbr-textured"
    result["pbr_source"] = f"Poly Haven CC0 {PBR_SOURCES[source]}"
    result["physical_texture_width_m"] = physical_texture_width_m
    return result


def solid_pbr(name: str, color: tuple[float, float, float, float], metal: float, rough: float) -> bpy.types.Material:
    """A stable authored structural PBR for non-overlapping close geometry.

    The roof headhouse is a DCC-authored assembly, not a texture test. Its
    broad plaster, concrete and steel faces must keep a controlled physical
    response even when the delivery encoder resamples texture UVs at a shallow
    player camera angle. Textured Poly Haven PBR remains on the roof membrane,
    scans and environment; these structural finishes deliberately use direct
    base/roughness/metallic values to prevent false wood/moire assignments.
    """
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    bsdf = result.node_tree.nodes.get("Principled BSDF")
    assert bsdf is not None
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    result["asset_quality"] = "authored-pbr-structural-finish"
    result["pbr_source"] = "DCC-authored structural PBR"
    result["physical_texture_width_m"] = 1.0
    return result


def materials() -> dict[str, bpy.types.Material]:
    return {
        "concrete": mat("PBR_Dirty_Tile", (0.27, 0.36, 0.36, 1), 0.0, 0.86, "concrete"),
        # The continuous structural base is projected coarser than the
        # separately damaged floor inserts. This prevents a 43m corridor from
        # reading as one dissolved/repeated tile sheet while preserving the
        # same CC0 source and physical roughness/normal response.
        "floor_base": mat("PBR_Dirty_Tile_Corridor_Base", (0.31, 0.36, 0.35, 1), 0.0, 0.91, "concrete", physical_texture_width_m=7.40),
        "corridor_floor": mat("PBR_Corridor_Worn_Painted_Concrete", (0.43, 0.46, 0.44, 1), 0.0, 0.94, "wall", physical_texture_width_m=3.80),
        "roof": mat("PBR_Tarred_Gravel_Roof", (0.31, 0.36, 0.35, 1), 0.0, 0.92, "roof"),
        # A roof reads at a much shallower camera angle than a corridor
        # floor.  At one repeat per metre its tar aggregate aliases into
        # pinstripe moire in the actual 62-degree player review.  This remains
        # the same CC0 PBR, merely projected at a physically plausible broad
        # membrane scale so it can read as damaged roof construction.
        "roof_macro": mat("PBR_Tarred_Gravel_Roof_Macro", (0.34, 0.37, 0.36, 1), 0.0, 0.94, "roof", physical_texture_width_m=3.20),
        # This is the unlit, water-stained acoustic substrate, not ambient
        # daylight. Its restrained reflectance prevents the top of a real
        # suspended corridor from collapsing into an empty black void between
        # the failed fixtures in a player flashlight review.
        "acoustic": mat("PBR_Damaged_Acoustic_Ceiling", (0.40, 0.49, 0.47, 1), 0.0, 0.91, "concrete", (0.032, 0.085, 0.082, 1), .38),
        "wall": mat("PBR_Charred_Plaster", (0.36, 0.38, 0.32, 1), 0.0, 0.82, "wall"),
        "sage": mat("PBR_Sooted_Sage", (0.18, 0.42, 0.39, 1), 0.0, 0.58, "sage"),
        "metal": mat("PBR_Oxidized_Metal", (0.34, 0.40, 0.38, 1), 0.75, 0.36, "metal"),
        "glass": mat("PBR_Smoked_Glass", (0.18, 0.34, 0.38, 1), 0.28, 0.17, "glass"),
        "wood": mat("PBR_Worn_Laminate", (0.45, 0.25, 0.12, 1), 0.0, 0.63, "wood"),
        "black": mat("PBR_Black_Rubber", (0.035, 0.042, 0.046, 1), 0.0, 0.7, "black"),
        "cyan": mat("PBR_Cold_Cyan_Reflector", (0.08, 0.62, 0.66, 1), 0.2, 0.3, "cyan"),
        "window": mat("PBR_Cold_Wired_Glass", (0.08, 0.46, 0.52, 1), 0.2, 0.40, "cyan", (0.02, 0.12, 0.16, 1), 0.32),
        # Reuses the wired-glass CC0 response already resident in the corridor
        # but keeps the fluorescent lens and its emissive phosphor distinct
        # from a window.  This is visible authored geometry, not a review-only
        # light, so the streamed GLB still reads as a damaged school ceiling
        # under the runtime hand-light.
        "fluorescent": mat("PBR_Damaged_Fluorescent", (0.20, 0.70, 0.68, 1), 0.08, 0.34, "cyan", (0.05, 0.30, 0.30, 1), .58),
        "safety_red": mat("PBR_Safety_Red_Paint", (0.62, 0.075, 0.040, 1), 0.42, 0.44, "metal"),
        "ember": mat("PBR_Warm_Ember", (0.78, 0.10, 0.01, 1), 0.0, 0.35, "ember", (1.0, .055, .006, 1), 2.8),
        "brick": mat("PBR_Weathered_Rooftop_Brick", (0.68, 0.30, 0.16, 1), 0.0, 0.88, "brick"),
        # The close route uses one correctly-scaled brick course.  The distant
        # headhouse uses the same CC0 source at a coarser projection so its
        # individual mortar lines do not alias into a striped wall at 15–20m.
        "brick_macro": mat("PBR_Weathered_Rooftop_Brick_Macro", (0.68, 0.30, 0.16, 1), 0.0, 0.90, "brick", physical_texture_width_m=2.8),
        # The roof headhouse is painted concrete/plaster with a restrained
        # grey steel door. Exposed brick is reserved for its broken side
        # returns, preventing the player view from becoming three repeated
        # orange facade samples or a green/wood-like door panel.
        # The large facade needs low-frequency stains and aggregate variation
        # to survive the player flashlight without reading as a clean grey
        # prototype box.  Keep the same audited material identity, but use a
        # coarse CC0 plaster PBR rather than a uniform structural colour.
        "headhouse_plaster": mat("PBR_Rooftop_HeadHouse_CharredPlaster", (0.30, 0.31, 0.29, 1), 0.0, 0.96, "wall", roughness_multiplier=1.16, physical_texture_width_m=4.8, delivery_size=256),
        "headhouse_concrete": solid_pbr("PBR_Rooftop_HeadHouse_Concrete", (0.17, 0.19, 0.19, 1), 0.0, 0.94),
        "headhouse_metal": solid_pbr("PBR_Rooftop_HeadHouse_SmokedAluminiumGrey", (0.105, 0.13, 0.14, 1), 0.78, 0.48),
        "headhouse_void": solid_pbr("PBR_Rooftop_HeadHouse_DoorRecess", (0.012, 0.016, 0.018, 1), 0.0, 1.0),
        "hearth_concrete": solid_pbr("PBR_Rooftop_Hearth_CharredConcrete", (0.13, 0.12, 0.105, 1), 0.0, 0.98),
        # Reuse the rooftop's already-loaded exposed-brick atlas so chipped
        # facade volumes show masonry scale instead of flat salmon polygons.
        "headhouse_brick": mat("PBR_Rooftop_HeadHouse_ExposedBrick", (0.42, 0.22, 0.16, 1), 0.0, 0.93, "brick", physical_texture_width_m=3.2),
        "mountain": mat("PBR_Distant_Mountain", (0.16, 0.38, 0.46, 1), 0.0, 0.94, "wall", (0.025, 0.075, 0.11, 1), .52),
        # The atmosphere is intentionally blue-black rather than a pure black
        # cap; even a moonless rooftop needs a visible depth gradient behind
        # the parapet under the runtime's restrained exposure.
        "sky": mat("PBR_Night_Sky_Backdrop", (0.12, 0.32, 0.42, 1), 0.0, 0.98, "cyan", (0.050, 0.150, 0.215, 1), 1.85),
        "moon": mat("PBR_Cyan_Moon_Haze", (0.25, 0.72, 0.78, 1), 0.0, 0.64, "cyan", (0.11, 0.72, 0.86, 1), 4.8),
        "ash": mat("PBR_Ash_Mote", (0.28, 0.31, 0.31, 1), 0.0, 0.95, "wall"),
        # Ground-level contact patches remain physically rough/absorptive;
        # they use the roof atlas but vary the BRDF rather than painting dark
        # fake shadows into a texture.
        "soot": mat("PBR_Soot_Contact", (0.085, 0.095, 0.090, 1), 0.0, 0.94, "wall", roughness_multiplier=1.18),
        "wet": mat("PBR_Wet_Roof_Contact", (0.13, 0.18, 0.18, 1), 0.0, 0.32, "roof", roughness_multiplier=.28),
        "uniform": mat("PBR_Weathered_Uniform", (0.18, 0.32, 0.35, 1), 0.0, 0.68, "uniform"),
        "athletic": mat("PBR_Torn_Athletics", (0.34, 0.12, 0.20, 1), 0.0, 0.71, "athletic"),
        "staff": mat("PBR_Torn_Staff_Fabric", (0.46, 0.39, 0.20, 1), 0.0, 0.74, "staff"),
        "skin": mat("PBR_Neutral_Stylized_Skin", (0.52, 0.31, 0.18, 1), 0.0, 0.72, "skin"),
        "hair": mat("PBR_Matte_Black_Hair", (0.025, 0.028, 0.034, 1), 0.0, 0.52, "hair"),
    }


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
            # Keep the authored lightmap channel distinct so meshopt does not
            # collapse it into UV0 during the final delivery transform.
            target.data[index].uv = (value.uv.x * 0.5, value.uv.y * 0.5)
    obj["uv0"] = "pbr-authored"
    obj["uv1"] = "lightmap-ready"


def tile_primary_uvs(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    """Keep architectural PBR maps at a metre-scale instead of stretching.

    Blender's default cube UVs span 0..1 regardless of its authored world
    size.  Leaving a 43m corridor floor at that mapping made the physical
    source maps read as blurry green bands.  Each cube face now repeats UV0
    according to its actual mesh extents; custom opening/prop UVs are retained
    exactly as authored and do not call this helper.
    """
    if obj.type != "MESH" or not obj.data.uv_layers:
        return
    width = float(material.get("physical_texture_width_m", 1.0))
    if width <= 0:
        return
    dimensions = obj.dimensions
    uv = obj.data.uv_layers.active
    assert uv is not None
    for polygon in obj.data.polygons:
        normal = polygon.normal
        absolute = (abs(normal.x), abs(normal.y), abs(normal.z))
        if absolute[2] >= absolute[0] and absolute[2] >= absolute[1]:
            repeat = (max(.25, dimensions.x / width), max(.25, dimensions.y / width))
        elif absolute[0] >= absolute[1]:
            repeat = (max(.25, dimensions.y / width), max(.25, dimensions.z / width))
        else:
            repeat = (max(.25, dimensions.x / width), max(.25, dimensions.z / width))
        for loop_index in polygon.loop_indices:
            value = uv.data[loop_index].uv
            value.x *= repeat[0]
            value.y *= repeat[1]


def clean_component_uvs(obj: bpy.types.Object, material: bpy.types.Material, world_scale: float) -> None:
    """Replace stock-library UV density after a shared-PBR material remap.

    The selected Poly Haven facade meshes retain useful authored topology, but
    their original UV density was calibrated for a different, high-frequency
    texture bundle.  Carrying those coordinates into the opening atlas made
    the headhouse read as one-pixel vertical stripes at player height.  Use a
    conservative planar projection in the component's final metre scale;
    this is a material/UV cleanup of the imported geometry, not a stock asset
    passthrough.
    """
    if obj.type != "MESH":
        return
    ensure_uv_layers(obj)
    uv = obj.data.uv_layers.active
    assert uv is not None
    width = max(.25, float(material.get("physical_texture_width_m", 1.0)))
    for polygon in obj.data.polygons:
        normal = polygon.normal
        absolute = (abs(normal.x), abs(normal.y), abs(normal.z))
        for loop_index in polygon.loop_indices:
            vertex = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            if absolute[2] >= absolute[0] and absolute[2] >= absolute[1]:
                coordinate = (vertex.x, vertex.y)
            elif absolute[0] >= absolute[1]:
                coordinate = (vertex.y, vertex.z)
            else:
                coordinate = (vertex.x, vertex.z)
            uv.data[loop_index].uv = (coordinate[0] * world_scale / width, coordinate[1] * world_scale / width)
    obj["uv_cleanup"] = "planar-final-metre-scale-after-stock-material-remap"


def empty(name: str, parent: bpy.types.Object | None, semantic: str, **extras: object) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return tag(obj, semantic, **extras)


def authored_route_prop(
    parent: bpy.types.Object,
    key: str,
    prefix: str,
    location: tuple[float, float, float],
) -> bpy.types.Object:
    """Import one independently authored prop source into a streamable zone.

    The prop kit is its own delivery boundary.  We import its *raw* GLB only
    because Blender can preserve the source PNG PBR triplets before the route
    delivery re-encodes them as KTX2; the public/stage prop deliveries are not
    copied or modified.  Flattening source rotations is intentional: the route
    validator derives exact world AABBs and refuses hidden rotated transforms
    that could make portal-clearance inspection ambiguous.
    """
    source = ROUTE_PROP_RAW_DIR / f"{key}.raw.glb"
    if not source.exists():
        raise RuntimeError(f"Missing authored route prop source: {source}")
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    instance = empty(
        f"{prefix}_Instance",
        parent,
        f"route.prop.{key}",
        authored_prop_source=str(source.relative_to(REPO_ROOT)),
        authored_prop_build_id=ROUTE_PROP_BUILD_ID,
        source_key=key,
    )
    instance.location = to_blender(location)
    discard_names = ("COL_", "Shelf_")
    meshes = [obj for obj in imported if obj.type == "MESH" and not obj.name.startswith(discard_names)]
    for obj in imported:
        if obj not in meshes:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in meshes:
        # Imported assets carry their own root hierarchy.  Bake all local
        # transforms into geometry, then attach only visible authored meshes
        # to this zone-local instance root.
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.select_set(False)
        local_location = obj.location.copy()
        obj.parent = instance
        obj.matrix_parent_inverse.identity()
        obj.location = local_location
        obj.name = f"{prefix}_{obj.name}"
        semantic = str(obj.get("semantic_id", f"route.prop.{key}.mesh"))
        tag(
            obj,
            semantic,
            authored_prop_source=str(source.relative_to(REPO_ROOT)),
            authored_prop_build_id=ROUTE_PROP_BUILD_ID,
            source_key=key,
            pbr_authored=True,
        )
        ensure_uv_layers(obj)
    return instance


def authored_polyhaven_rooftop_duct(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Stage a few art-directed pieces from Poly Haven's CC0 duct kit.

    The official 1K source is used for its authored bends, fan, seams and
    braces; only four pieces are carried into this route and they share the
    existing oxidised-metal atlas.  This replaces a stock-looking box HVAC
    without shipping the source kit's 1K texture triplet or its unused parts.
    """
    if not POLYHAVEN_DUCT_SOURCE.exists():
        raise RuntimeError(f"Missing Poly Haven CC0 duct source: {POLYHAVEN_DUCT_SOURCE}")
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(POLYHAVEN_DUCT_SOURCE))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    # Keep this kit curb-attached to the headhouse.  In the old placement the
    # player saw one uncontextualised cylinder at six metres, which read as a
    # game primitive instead of a roof-service system.
    selected = {
        "modular_airduct_circular_triple": (-4.18, .78, 19.46, (0.0, 0.0, 0.0)),
        "modular_airduct_circular_smooth_bend_half": (-3.78, 1.14, 20.80, (math.pi / 2, 0.0, 0.0)),
        "modular_airduct_circular_fan": (-3.78, 1.16, 21.18, (math.pi / 2, 0.0, 0.0)),
        "modular_airduct_circular_brace": (-4.18, 1.22, 19.42, (0.0, 0.0, 0.0)),
    }
    instance = empty(
        "RooftopPolyHavenDuct_Instance",
        parent,
        "rooftop.polyhaven-airduct",
        polyhaven_asset="modular_airduct_circular_01",
        license="CC0-1.0",
        source_api=POLYHAVEN_DUCT_API,
        source_sha256=POLYHAVEN_DUCT_SHA256,
        source_runtime_role="zone-local-art-directed-subset",
    )
    for obj in imported:
        if obj.type != "MESH" or obj.name not in selected:
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        x, y, z, rotation = selected[obj.name]
        obj.parent = instance
        obj.matrix_parent_inverse.identity()
        obj.location = to_blender((x, y, z))
        obj.rotation_euler = rotation
        obj.scale = (1.0, 1.0, 1.0)
        obj.data.materials.clear()
        obj.data.materials.append(mats["headhouse_metal"])
        tag(
            obj,
            "rooftop.polyhaven-airduct.mesh",
            polyhaven_asset="modular_airduct_circular_01",
            license="CC0-1.0",
            source_api=POLYHAVEN_DUCT_API,
            source_sha256=POLYHAVEN_DUCT_SHA256,
            pbr_authored=True,
            art_directed_for="hyosan-rooftop-service-run",
        )
        ensure_uv_layers(obj)


def authored_polyhaven_detail(
    parent: bpy.types.Object,
    asset_id: str,
    prefix: str,
    location: tuple[float, float, float],
    material: bpy.types.Material,
    semantic: str,
    scale: float = 1.0,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> None:
    """Embed a small, art-directed official model into one streamed zone.

    This is intentionally not a runtime reference to Poly Haven. Blender
    flattens the selected authored meshes into the zone-local GLB, their
    original material slots are replaced by the pack's shared PBR atlas, and
    the source details are retained in node extras for reproducibility.
    """
    source = POLYHAVEN_DETAIL_MODELS[asset_id]
    gltf = source["gltf"]
    assert isinstance(gltf, Path)
    if not gltf.exists():
        raise RuntimeError(f"Missing Poly Haven 1K model source: {gltf}")
    source_digest = hashlib.sha256(gltf.read_bytes()).hexdigest()
    if source_digest != source["sha256"]:
        raise RuntimeError(f"{asset_id}: downloaded glTF SHA-256 no longer matches the recorded official source")
    api_record = gltf.parent / "api-1k.json"
    # The six later imports were added after the initial PBR fetch.  The desk
    # and chair predate that convention and are recorded in the same official
    # fetch provenance manifest instead. Both forms pin the downloaded URL
    # and upstream MD5; accepting neither would turn a legitimate stage
    # source into an untraceable delivery mesh.
    provenance_manifest = PBR_DIR / "provenance.json"
    provenance_text = api_record.read_text() if api_record.exists() else (provenance_manifest.read_text() if provenance_manifest.exists() else "")
    if source["url"] not in provenance_text or source["md5"] not in provenance_text:
        raise RuntimeError(f"{asset_id}: official Poly Haven API provenance record is missing or stale")
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(gltf))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    instance = empty(
        f"{prefix}_Instance",
        parent,
        f"route.polyhaven.{asset_id}",
        polyhaven_asset=asset_id,
        license="CC0-1.0",
        source_api=source["api"],
        source_url=source["url"],
        source_md5=source["md5"],
        source_sha256=source["sha256"],
        source_runtime_role="zone-local-art-directed-subset",
        texture_policy="shared-route-pbr-atlas-not-stock-texture-bundle",
    )
    instance.location = to_blender(location)
    instance.scale = (scale, scale, scale)
    instance.rotation_euler = rotation
    discarded = {"cube", "plane", "ground"}
    selected = [obj for obj in imported if obj.type == "MESH" and obj.name.lower() not in discarded]
    for obj in imported:
        if obj not in selected:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in selected:
        # Preserve the source object's authored local geometry and pivots while
        # removing importer root hierarchy. Its parent instance alone carries
        # the game-world placement, so a zone release disposes all its pieces.
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.select_set(False)
        local_location = obj.location.copy()
        obj.parent = instance
        obj.matrix_parent_inverse.identity()
        obj.location = local_location
        obj.name = f"{prefix}_{obj.name}"
        obj.data.materials.clear()
        obj.data.materials.append(material)
        tag(
            obj,
            semantic,
            polyhaven_asset=asset_id,
            license="CC0-1.0",
            source_api=source["api"],
            source_url=source["url"],
            source_md5=source["md5"],
            source_sha256=source["sha256"],
            pbr_authored=True,
            texture_policy="shared-route-pbr-atlas-not-stock-texture-bundle",
        )
        ensure_uv_layers(obj)
    expected = int(source["pieces"])
    if len(selected) != expected:
        raise RuntimeError(f"{asset_id}: expected {expected} source meshes, imported {len(selected)}")


def write_polyhaven_route_model_provenance() -> None:
    """Persist the official-model source evidence beside the private stage."""
    models = []
    for asset_id, source in POLYHAVEN_DETAIL_MODELS.items():
        gltf = source["gltf"]
        assert isinstance(gltf, Path)
        models.append({
            "id": asset_id,
            "license": "CC0-1.0",
            "api_url": source["api"],
            "gltf_url": source["url"],
            "gltf_md5": source["md5"],
            "gltf_sha256": source["sha256"],
            "source_file": str(gltf.relative_to(REPO_ROOT)),
            "api_record": str(((gltf.parent / "api-1k.json") if (gltf.parent / "api-1k.json").exists() else (PBR_DIR / "provenance.json")).relative_to(REPO_ROOT)),
            "delivery_use": "authored geometry only; original stock texture bundle is replaced by shared route PBR atlases",
        })
    destination = OUTPUT / "polyhaven-route-model-provenance.json"
    destination.write_text(json.dumps({
        "schema": 1,
        "provider": "Poly Haven official API",
        "license": "CC0-1.0",
        "models": models,
    }, indent=2) + "\n")


BLENDERKIT_DERIVATIVE_USAGE: list[dict[str, object]] = []


def blenderkit_environment_source(asset_id: str) -> tuple[Path, dict[str, object]]:
    """Return one hash-pinned private BlenderKit source after policy checks.

    This deliberately verifies the fetched provenance *inside* the Blender
    build.  A saved source GLB alone is not enough evidence: a future author
    must not be able to replace it with a similarly named BlenderKit asset or
    carry an unreviewed/raw source into the delivery stage.
    """
    source = BLENDERKIT_ENVIRONMENT_SOURCES[asset_id]
    if not BLENDERKIT_ENVIRONMENT_PROVENANCE.exists():
        raise RuntimeError(f"Missing pinned BlenderKit provenance: {BLENDERKIT_ENVIRONMENT_PROVENANCE}")
    provenance = json.loads(BLENDERKIT_ENVIRONMENT_PROVENANCE.read_text())
    policy = provenance.get("policy", {})
    if (
        provenance.get("schema_version") != 1
        or policy.get("accepted_license") != "cc_zero"
        or policy.get("source_role") != "private-photogrammetry-input-only"
        or policy.get("public_runtime_delivery") is not False
    ):
        raise RuntimeError("BlenderKit provenance policy does not permit runtime delivery")
    record = next((candidate for candidate in provenance.get("assets", []) if candidate.get("key") == asset_id), None)
    if not isinstance(record, dict):
        raise RuntimeError(f"BlenderKit provenance has no pinned record for {asset_id}")
    if (
        record.get("license") != "cc_zero"
        or record.get("sha256") != source["sha256"]
        or record.get("asset_base_id") != source["asset_base_id"]
        or record.get("local_file") != source["file"]
    ):
        raise RuntimeError(f"{asset_id}: BlenderKit provenance does not match the approved pin")
    path = BLENDERKIT_ENVIRONMENT_SOURCE_DIR / str(source["file"])
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]:
        raise RuntimeError(f"{asset_id}: private BlenderKit source hash changed")
    return path, source


def blenderkit_geometry_only_import(asset_id: str, source_path: Path, source: dict[str, object]) -> Path:
    """Make a private, non-deliverable GLB that retains only pinned geometry.

    Blender 5.2's importer intermittently reaches an absent ``Iridescence
    Factor`` socket while constructing third-party material graphs.  The route
    never uses those materials — it immediately remaps every imported mesh to
    the shared approved PBR set — so import a temporary geometry-only GLB
    instead.  The pinned source remains untouched and its SHA is verified
    before this step; this staging copy is neither mounted nor referenced by
    the delivery GLB.
    """
    cache_dir = RAW / "blenderkit-private-geometry-import"
    cache_dir.mkdir(parents=True, exist_ok=True)
    destination = cache_dir / f"{asset_id}.geometry-only.glb"
    original = source_path.read_bytes()
    if hashlib.sha256(original).hexdigest() != source["sha256"]:
        raise RuntimeError(f"{asset_id}: source changed before geometry-only import")
    if original[:4] != b"glTF" or len(original) < 20:
        raise RuntimeError(f"{asset_id}: expected a binary GLB source")
    version, declared_length = struct.unpack_from("<II", original, 4)
    if version != 2 or declared_length != len(original):
        raise RuntimeError(f"{asset_id}: malformed GLB header")
    chunks: list[tuple[int, bytes]] = []
    offset = 12
    document: dict[str, object] | None = None
    while offset < len(original):
        if offset + 8 > len(original):
            raise RuntimeError(f"{asset_id}: truncated GLB chunk header")
        chunk_length, chunk_type = struct.unpack_from("<II", original, offset)
        offset += 8
        chunk = original[offset:offset + chunk_length]
        if len(chunk) != chunk_length:
            raise RuntimeError(f"{asset_id}: truncated GLB chunk")
        offset += chunk_length
        if chunk_type == 0x4E4F534A:
            if document is not None:
                raise RuntimeError(f"{asset_id}: multiple JSON chunks are unsupported")
            document = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\x00"))
        chunks.append((chunk_type, chunk))
    if document is None:
        raise RuntimeError(f"{asset_id}: GLB has no JSON chunk")
    for mesh in document.get("meshes", []):
        if not isinstance(mesh, dict):
            continue
        for primitive in mesh.get("primitives", []):
            if isinstance(primitive, dict):
                primitive.pop("material", None)
    # Prevent Blender from parsing any vendor material/image extension.  The
    # original buffer is retained only because accessors still reference its
    # geometry slices; none of its image/material data has a JSON reference.
    for key in ("materials", "textures", "images", "samplers"):
        document.pop(key, None)
    keep_extensions = {"KHR_draco_mesh_compression"}
    for key in ("extensionsUsed", "extensionsRequired"):
        extensions = document.get(key)
        if isinstance(extensions, list):
            filtered = [extension for extension in extensions if extension in keep_extensions]
            if filtered:
                document[key] = filtered
            else:
                document.pop(key, None)
    json_chunk = json.dumps(document, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    json_chunk += b" " * ((4 - len(json_chunk) % 4) % 4)
    rebuilt_chunks = [(0x4E4F534A, json_chunk)] + [chunk for chunk in chunks if chunk[0] != 0x4E4F534A]
    payload = bytearray(b"glTF" + struct.pack("<II", 2, 0))
    for chunk_type, chunk in rebuilt_chunks:
        payload.extend(struct.pack("<II", len(chunk), chunk_type))
        payload.extend(chunk)
    struct.pack_into("<I", payload, 8, len(payload))
    destination.write_bytes(payload)
    entry = {
        "asset": asset_id,
        "pinned_source_sha256": source["sha256"],
        "private_geometry_only_import": str(destination.relative_to(OUTPUT)),
        "geometry_only_import_sha256": hashlib.sha256(payload).hexdigest(),
        "geometry_only_import_bytes": len(payload),
        "raw_runtime_delivery": False,
    }
    if not any(existing.get("asset") == asset_id for existing in BLENDERKIT_GEOMETRY_ONLY_IMPORTS):
        BLENDERKIT_GEOMETRY_ONLY_IMPORTS.append(entry)
    return destination


def cleanup_blenderkit_mesh(
    obj: bpy.types.Object,
    ratio: float,
    crop: tuple[float, float, float, float] | None,
) -> None:
    """Remove non-contributing scan surface and apply a silhouette-first LOD.

    BlenderKit scan inputs commonly retain the underside/table surface and a
    very dense unseen interior.  Crop is expressed as normalized local XY
    bounds; it is applied before the decimator so the exported mesh is a real
    authored subset rather than the raw scan hidden behind a tiny scale.
    """
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    if crop is not None and bm.verts:
        minimum = Vector((min(vertex.co.x for vertex in bm.verts), min(vertex.co.y for vertex in bm.verts), min(vertex.co.z for vertex in bm.verts)))
        maximum = Vector((max(vertex.co.x for vertex in bm.verts), max(vertex.co.y for vertex in bm.verts), max(vertex.co.z for vertex in bm.verts)))
        span = maximum - minimum
        min_x, max_x, min_y, max_y = crop
        remove = [
            face for face in bm.faces
            if not (
                minimum.x + span.x * min_x <= face.calc_center_median().x <= minimum.x + span.x * max_x
                and minimum.y + span.y * min_y <= face.calc_center_median().y <= minimum.y + span.y * max_y
            )
        ]
        if len(remove) < len(bm.faces) - 64:
            bmesh.ops.delete(bm, geom=remove, context="FACES")
            bm.normal_update()
    if bm.faces:
        floor = min(vertex.co.z for vertex in bm.verts)
        height = max(vertex.co.z for vertex in bm.verts) - floor
        underside = [
            face for face in bm.faces
            if face.normal.z < -.45 and face.calc_center_median().z <= floor + max(.015, height * .045)
        ]
        if underside:
            bmesh.ops.delete(bm, geom=underside, context="FACES")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new("BlenderKit_Silhouette_Decimate", "DECIMATE")
    modifier.ratio = ratio
    modifier.decimate_type = "COLLAPSE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def authored_blenderkit_derivative(
    parent: bpy.types.Object,
    asset_id: str,
    prefix: str,
    location: tuple[float, float, float],
    scale: float,
    rotation: tuple[float, float, float],
    material: bpy.types.Material,
    semantic: str,
    *,
    decimate_ratio: float,
    crop: tuple[float, float, float, float] | None = None,
) -> bpy.types.Object:
    """Import a private scan, clean it in Blender, then emit one derivative.

    No original BlenderKit image, mesh or material is retained.  The only
    delivery payload is the cropped/underside-removed/decimated mesh with the
    project shared CC0 PBR material, later encoded as KTX2 and Meshopt.
    """
    source_path, source = blenderkit_environment_source(asset_id)
    geometry_only_path = blenderkit_geometry_only_import(asset_id, source_path, source)
    material_source = str(material.get("pbr_source", ""))
    if not material_source.startswith("Poly Haven CC0 "):
        raise RuntimeError(f"{asset_id}: derivative must use a named approved Poly Haven PBR material source")
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(geometry_only_path), import_shading="NORMALS")
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    selected = [obj for obj in imported if obj.type == "MESH"]
    if not selected:
        raise RuntimeError(f"{asset_id}: BlenderKit import had no mesh")
    instance = empty(
        f"{prefix}_Instance",
        parent,
        semantic,
        blenderkit_asset=asset_id,
        license="CC0-1.0",
        source_sha256=source["sha256"],
        source_provenance=BLENDERKIT_ENVIRONMENT_SOURCE_PROVENANCE,
        source_visual_gate="outputs/last-bell-environment-recovery-sources/review/source-visual-gate.json",
        source_runtime_role="dcc-source-only-authored-derivative",
        raw_runtime_delivery=False,
        private_geometry_only_import=True,
        authored_pbr_material_source=material_source,
        derivative_steps="geometry-only-import,blender-import,crop,underside-removal,aggressive-decimation,authored-pbr-remap,uv-review",
    )
    instance.location = to_blender(location)
    instance.scale = (scale, scale, scale)
    instance.rotation_euler = rotation

    for obj in imported:
        if obj not in selected:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in selected:
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        cleanup_blenderkit_mesh(obj, decimate_ratio, crop)

    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for obj in selected:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, point.x)
            minimum.y = min(minimum.y, point.y)
            minimum.z = min(minimum.z, point.z)
            maximum.x = max(maximum.x, point.x)
            maximum.y = max(maximum.y, point.y)
            maximum.z = max(maximum.z, point.z)
    source_center = (minimum + maximum) * .5
    for index, obj in enumerate(selected):
        obj.parent = instance
        obj.matrix_parent_inverse.identity()
        obj.location = obj.location - Vector((source_center.x, source_center.y, minimum.z))
        obj.name = f"{prefix}_{index:02d}"
        obj.data.materials.clear()
        obj.data.materials.append(material)
        # Geometry-only BlenderKit imports deliberately have no original
        # material slots, but their surviving source UVs still target the
        # donor's old texture sheet.  Project at the derivative's final
        # metre scale after decimation: otherwise the six hearth block
        # variants produce a striped/orange UV artefact in the real player
        # camera even though their PBR material was correctly remapped.
        clean_component_uvs(obj, material, scale)
        tag(
            obj,
            semantic + ".mesh",
            blenderkit_asset=asset_id,
            license="CC0-1.0",
            source_sha256=source["sha256"],
            source_provenance=BLENDERKIT_ENVIRONMENT_SOURCE_PROVENANCE,
            source_visual_gate="outputs/last-bell-environment-recovery-sources/review/source-visual-gate.json",
            source_runtime_role="dcc-source-only-authored-derivative",
            raw_runtime_delivery=False,
            private_geometry_only_import=True,
            pbr_authored=True,
            authored_pbr_material_source=material_source,
            derivative_steps="geometry-only-import,blender-import,crop,underside-removal,aggressive-decimation,authored-pbr-remap,uv-review",
        )
        ensure_uv_layers(obj)
    BLENDERKIT_DERIVATIVE_USAGE.append({
        "asset": asset_id,
        "sha256": source["sha256"],
        "semantic": semantic,
        "nodes": [obj.name for obj in selected],
        "decimate_ratio": decimate_ratio,
        "crop": crop,
        "geometry_only_import": str(geometry_only_path.relative_to(OUTPUT)),
        "authored_pbr_material_source": material_source,
        "raw_runtime_delivery": False,
    })
    return instance


def arrange_blenderkit_hearth_blocks(instance: bpy.types.Object) -> None:
    """Turn six cleaned scan blocks into one irregular, usable fire hearth.

    The imported BlenderKit set is a linear reference display.  Keeping that
    source layout would look like toy bricks in the delivery view, so the
    DCC derivative deliberately re-spaces each individual cleaned block into
    a low, incomplete ring around the runtime fire anchor.  No source material
    or raw hierarchy survives this authored composition.
    """
    placements = (
        (-1.16, -.62, .22), (-.38, -1.10, -.12), (.78, -.86, .38),
        (1.20, .28, -.28), (.46, 1.06, .14), (-.82, .96, -.36),
    )
    blocks = sorted((child for child in instance.children if child.type == "MESH"), key=lambda child: child.name)
    for child, (x, z, yaw) in zip(blocks, placements):
        child.location = to_blender((x, .035, z))
        child.rotation_euler = (0.0, 0.0, yaw)
        child["dcc_arrangement"] = "irregular-low-hearth-ring"
        child["individual_variant"] = True
    instance["dcc_arrangement"] = "irregular-low-hearth-ring"


def write_blenderkit_environment_derivative_provenance() -> None:
    """Write only private stage evidence; never a public runtime manifest."""
    source_inventory = []
    for asset_id, source in BLENDERKIT_ENVIRONMENT_SOURCES.items():
        source_inventory.append({
            "key": asset_id,
            "sha256": source["sha256"],
            "asset_base_id": source["asset_base_id"],
            "input": str((BLENDERKIT_ENVIRONMENT_SOURCE_DIR / str(source["file"])).relative_to(REPO_ROOT)),
        })
    destination = OUTPUT / "blenderkit-environment-derivative-provenance.json"
    destination.write_text(json.dumps({
        "schema": 1,
        "source_provenance": BLENDERKIT_ENVIRONMENT_SOURCE_PROVENANCE,
        "source_review": "outputs/last-bell-environment-recovery-sources/review/source-visual-gate.json",
        "public_runtime_delivery": False,
        "required_derivative_steps": [
            "geometry-only-import", "blender-import", "crop", "underside-removal", "aggressive-decimation",
            "authored-pbr-remap", "uv-review", "ktx2-textures", "meshopt-geometry",
            "human-runtime-visual-gate",
        ],
        "pinned_sources": source_inventory,
        "private_geometry_only_imports": BLENDERKIT_GEOMETRY_ONLY_IMPORTS,
        "derivatives": BLENDERKIT_DERIVATIVE_USAGE,
    }, indent=2) + "\n")


def authored_recovery_cc0(
    parent: bpy.types.Object,
    asset_id: str,
    prefix: str,
    location: tuple[float, float, float],
    scale: float,
    rotation: tuple[float, float, float],
    mats: dict[str, bpy.types.Material],
    semantic: str,
) -> bpy.types.Object:
    """Flatten an official CC0 hero model into the private recovery GLB.

    The source model contributes authored silhouette/topology only. All stock
    bitmap slots are replaced with the opening's shared CC0 PBR vocabulary so
    a single hero asset cannot silently exceed the mobile texture budget.
    """
    source = TERRA_RECOVERY_MODELS[asset_id]
    gltf = source["gltf"]
    assert isinstance(gltf, Path)
    if not gltf.exists():
        raise RuntimeError(f"Missing official CC0 recovery source: {gltf}")
    digest = hashlib.sha256(gltf.read_bytes()).hexdigest()
    if digest != source["sha256"]:
        raise RuntimeError(f"{asset_id}: official recovery source SHA-256 changed")
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(gltf))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    instance = empty(
        f"{prefix}_Instance", parent, semantic,
        polyhaven_asset=asset_id,
        license="CC0-1.0",
        source_api=f"https://api.polyhaven.com/files/{asset_id}",
        source_sha256=source["sha256"],
        source_provenance="outputs/last-bell-terra-authored-recovery/cc0-official/provenance.json",
        source_runtime_role="zone-local-private-recovery",
        texture_policy="opening-shared-cc0-pbr-atlas",
    )
    instance.location = to_blender(location)
    instance.scale = (scale, scale, scale)
    instance.rotation_euler = rotation
    selected = [obj for obj in imported if obj.type == "MESH"]
    # Poly Haven's modular facade download is an asset-library sheet, not one
    # preassembled building. Select a single coherent large-door bay and its
    # matching trim, then recenter that bay before it becomes the headhouse.
    # Importing every library sample was exactly the flat repeated-grid failure
    # this recovery is meant to avoid.
    if asset_id == "modular_factory_facade":
        coherent_bay = {
            "wall_door_centered_large_01", "door_centered_large_01", "dado_door_centered_large_01",
            "window_centered_large_01", "window_centered_medium_01",
            "wall_window_centered_large_01", "wall_window_centered_medium_01",
        }
        selected = [obj for obj in selected if obj.name in coherent_bay]
    if not selected:
        raise RuntimeError(f"{asset_id}: no coherent CC0 recovery mesh was selected")
    selected_center = sum((obj.location for obj in selected), Vector()) / len(selected)
    for obj in imported:
        if obj not in selected:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in selected:
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.select_set(False)
        local_location = obj.location.copy() - selected_center
        obj.parent = instance
        obj.matrix_parent_inverse.identity()
        obj.location = local_location
        material_name = " ".join(material.name.lower() for material in obj.data.materials)
        material = mats["brick"] if "brick" in material_name else mats["window"] if "window" in material_name else mats["metal"] if any(token in material_name for token in ("door", "metal", "steel", "cable", "lamp")) else mats["concrete"]
        obj.data.materials.clear()
        obj.data.materials.append(material)
        obj.name = f"{prefix}_{obj.name}"
        tag(obj, semantic + ".mesh", polyhaven_asset=asset_id, license="CC0-1.0", source_api=f"https://api.polyhaven.com/files/{asset_id}", source_sha256=source["sha256"], pbr_authored=True, source_runtime_role="zone-local-private-recovery")
        ensure_uv_layers(obj)
    return instance


def authored_recovery_component(
    parent: bpy.types.Object,
    asset_id: str,
    node_name: str,
    prefix: str,
    location: tuple[float, float, float],
    scale: float,
    rotation: tuple[float, float, float],
    semantic: str,
    material: bpy.types.Material | None = None,
) -> bpy.types.Object:
    """Place one real CC0 component as a hand-composed hero object.

    Poly Haven's facade and escape downloads are intentionally modular source
    libraries.  This routine chooses one named, authored component and places
    it at a scene-specific position after recentering its source-library
    offset.  Keeping its original CC0 PBR slots is deliberate: the hero
    headhouse needs the component's brick, painted steel, roughness and normal
    response, not a tinted box approximation of them.
    """
    source = TERRA_RECOVERY_MODELS[asset_id]
    gltf = source["gltf"]
    assert isinstance(gltf, Path)
    if not gltf.exists():
        raise RuntimeError(f"Missing official CC0 recovery source: {gltf}")
    digest = hashlib.sha256(gltf.read_bytes()).hexdigest()
    if digest != source["sha256"]:
        raise RuntimeError(f"{asset_id}: official recovery source SHA-256 changed")
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(gltf))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    component = next((obj for obj in imported if obj.type == "MESH" and obj.name == node_name), None)
    if component is None:
        raise RuntimeError(f"{asset_id}: expected authored component {node_name!r} was not found")
    for obj in imported:
        if obj is not component:
            bpy.data.objects.remove(obj, do_unlink=True)
    matrix = component.matrix_world.copy()
    component.parent = None
    component.matrix_world = matrix
    bpy.ops.object.select_all(action="DESELECT")
    component.select_set(True)
    bpy.context.view_layer.objects.active = component
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    component.select_set(False)
    # A library component may be parked tens of metres from its own local
    # origin. Centre the actual geometry, then set a clean route-local
    # transform so that a facade bay can become one non-repeated headhouse.
    local_center = sum((Vector(corner) for corner in component.bound_box), Vector()) / 8.0
    component.data.transform(Matrix.Translation(-local_center))
    component.location = to_blender(location)
    component.rotation_euler = rotation
    component.scale = (scale, scale, scale)
    component.name = prefix
    component.parent = parent
    if material is not None:
        # The component topology is the CC0 source; its stock texture bundle
        # is not. Reusing the route's approved shared PBR is what keeps the
        # detailed headhouse streamable alongside the corridor and characters.
        component.data.materials.clear()
        component.data.materials.append(material)
        clean_component_uvs(component, material, scale)
    tag(
        component,
        semantic,
        polyhaven_asset=asset_id,
        polyhaven_component=node_name,
        license="CC0-1.0",
        source_api=f"https://api.polyhaven.com/files/{asset_id}",
        source_sha256=source["sha256"],
        source_provenance="outputs/last-bell-terra-authored-recovery/cc0-official/provenance.json",
        pbr_authored=True,
        texture_policy="opening-shared-cc0-pbr-atlas" if material is not None else "retained-official-cc0-hero-pbr",
    )
    ensure_uv_layers(component)
    return component


def distant_matte_material() -> bpy.types.Material:
    """Build the only generated raster material: an unreachable horizon matte."""
    if not TERRA_RECOVERY_MATTE.exists():
        raise RuntimeError(f"Missing private rooftop night matte: {TERRA_RECOVERY_MATTE}")
    if hashlib.sha256(TERRA_RECOVERY_MATTE.read_bytes()).hexdigest() != TERRA_RECOVERY_MATTE_SHA256:
        raise RuntimeError("Private rooftop night matte hash changed")
    result = bpy.data.materials.new("Rooftop_Distant_Night_Matte")
    result.use_nodes = True
    nodes = result.node_tree.nodes
    links = result.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    assert bsdf is not None
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(TERRA_RECOVERY_MATTE), check_existing=True)
    texture.image.colorspace_settings.name = "sRGB"
    links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(texture.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    # The original generated matte is deliberately low-key; retain its
    # mountain depth without allowing it to become the scene's oversized cyan
    # light source in the delivery review.
    bsdf.inputs["Emission Strength"].default_value = 1.18
    result["asset_quality"] = "generated-distant-matte-only"
    result["usage_boundary"] = "outside-playable-and-parallax-critical-geometry"
    result["source"] = "OpenAI image generation, original non-drama night mountain matte"
    result["sha256"] = TERRA_RECOVERY_MATTE_SHA256
    return result


def rooftop_distant_matte(parent: bpy.types.Object) -> None:
    """Install one fixed, unreachable panorama behind physical roof geometry."""
    material = distant_matte_material()
    # Face the authored player view instead of leaving the plane oblique to
    # its 18.6-degree rooftop turn.  Oblique projection made a correct 16:9
    # source reveal one vertical edge and slope its mountain horizon.  This
    # camera-facing plane remains 30m beyond the north parapet and outside all
    # playable/parallax-critical geometry.
    camera_x, camera_z = -1.05, 5.25
    target_x, target_z = 2.8, 16.7
    direction_x, direction_z = target_x - camera_x, target_z - camera_z
    direction_length = math.sqrt(direction_x * direction_x + direction_z * direction_z)
    direction_x, direction_z = direction_x / direction_length, direction_z / direction_length
    centre_x, centre_z = camera_x + direction_x * 42.0, camera_z + direction_z * 42.0
    right_x, right_z = direction_z, -direction_x
    # Overscan the generated distant matte so no plane boundary can enter the
    # delivery frame after the player-camera FOV and safe-frame crop. The 16:9
    # aspect is preserved; only the unreachable backing plane grows.
    half_width, half_height, centre_y = 70.0, 39.375, 1.0
    vertices = [
        to_blender((centre_x - right_x * half_width, centre_y - half_height, centre_z - right_z * half_width)),
        to_blender((centre_x + right_x * half_width, centre_y - half_height, centre_z + right_z * half_width)),
        to_blender((centre_x + right_x * half_width, centre_y + half_height, centre_z + right_z * half_width)),
        to_blender((centre_x - right_x * half_width, centre_y + half_height, centre_z - right_z * half_width)),
    ]
    mesh = bpy.data.meshes.new("RooftopDistantNightMatte_Mesh")
    # Face the roof player explicitly.  Keeping this one-sided in delivery
    # prevents a reversed back-face from becoming a flat black wall in WebGL.
    mesh.from_pydata(vertices, [], [(3, 2, 1, 0)])
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    # The full generated frame is retained so geometry and UV aspect match.
    # It remains an unreachable horizon layer behind physical route geometry.
    for loop_index, coordinate in zip(mesh.polygons[0].loop_indices, ((0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0))):
        uv.data[loop_index].uv = coordinate
    obj = bpy.data.objects.new("RooftopDistantNightMatte", mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    material.use_backface_culling = True
    tag(
        obj,
        "rooftop.distant-generated-night-matte",
        authored_backdrop=True,
        outside_playable_geometry=True,
        parallax_critical=False,
        source_sha256=TERRA_RECOVERY_MATTE_SHA256,
    )
    ensure_uv_layers(obj)


def flame_mesh(
    name: str,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
    radius: float,
    height: float,
    lean: tuple[float, float],
    material: bpy.types.Material,
    semantic: str,
) -> bpy.types.Object:
    """Sculpt a smooth asymmetric flame tongue rather than shipping an icosphere."""
    sides = 9
    rings = ((0.0, 1.00), (.20, .86), (.46, .60), (.70, .36), (.90, .14), (1.0, .018))
    vertices: list[tuple[float, float, float]] = []
    for ring_index, (vertical, width) in enumerate(rings):
        for side in range(sides):
            angle = math.tau * side / sides
            wobble = 1.0 + .18 * math.sin(side * 2.7 + ring_index * 1.4)
            x = location[0] + math.cos(angle) * radius * width * wobble + lean[0] * vertical
            z = location[2] + math.sin(angle) * radius * width * wobble + lean[1] * vertical
            y = location[1] + vertical * height
            vertices.append(to_blender((x, y, z)))
    faces: list[tuple[int, ...]] = []
    for ring_index in range(len(rings) - 1):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((ring_index * sides + side, ring_index * sides + nxt, (ring_index + 1) * sides + nxt, (ring_index + 1) * sides + side))
    faces.append(tuple(range(sides - 1, -1, -1)))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(material)
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (vertex.x * .24, vertex.y * -.24)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    tag(obj, semantic, pbr_authored=True, volumetric_layer=True, sculpted_flame=True)
    ensure_uv_layers(obj)
    return obj


def rooftop_private_recovery_hero(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Compose one physical rooftop vista for the player-height exit view.

    This replaces the failed asset-library scatter with a short, readable
    sequence: broken exit returns in the foreground, a practical hearth in
    the midground, then one damaged CC0 brick headhouse against an unreachable
    night matte.  Every near object is geometry; the sole bitmap is behind
    the far parapet and carries no playable/parallax-critical information.
    """
    rooftop_distant_matte(parent)

    # The two opening-derived collapse modules are intentionally non-identical
    # and placed as foreground framing, not tiled as roof dressing. They carry
    # the approved opening's bespoke bevels, material stack and damaged scale.
    opening_dressing_module(parent, "RooftopRecoveryForegroundCollapse", "StartRoom_FloorCollapseSlab_", (-5.82, .05, 4.84))
    opening_dressing_module(parent, "RooftopRecoveryForegroundRubble", "StartRoom_BreachOriginRubble_", (5.72, .05, 5.38))
    authored_recovery_component(
        parent, "concrete_road_barrier_02", "concrete_road_barrier_02",
        "RooftopRecoveryBarrierWest", (-4.82, .22, 6.84), 1.16, (0.0, .18, .32),
        "rooftop.recovery.foreground-cc0-concrete-rubble",
    )
    # One dry, irregular contact patch grounds the only large near CC0 piece;
    # it is physical roughness variation rather than a painted shadow square.
    rooftop_contact_patch("RooftopRecoveryBarrierContact", parent, (-4.82, 6.84), 2.20, 1.34, mats["soot"], "rooftop.recovery.debris-contact-soot")

    # Fire: a real stone pit, crossed charred logs, three smooth sculpted
    # flame tongues, suspended embers and rising smoke wisps. The former
    # faceted orange icospheres are deliberately not retained.
    fire_z = ROOFTOP_FIRE_Z
    authored_polyhaven_detail(parent, "stone_fire_pit", "RooftopRecoveryStoneFirePit", (.36, .18, fire_z), mats["brick"], "rooftop.recovery.cc0-stone-hearth", 1.08)
    for index, (x, z, length, angle) in enumerate(((-.34, fire_z - .28, 1.46, .82), (.56, fire_z + .18, 1.34, -1.04), (.06, fire_z + .54, 1.12, .26))):
        log = cylinder(f"RooftopRecoveryCharredLog_{index}", parent, (x, .29, z), .105, length, mats["wood"], "rooftop.recovery.fire-charred-log")
        log.rotation_euler = (math.pi / 2, 0.0, angle)
    flame_outer = mat("PBR_Rooftop_Flame_Outer", (0.96, .12, .012, 1), 0.0, .38, "ember", (1.0, .055, .004, 1), 4.2)
    flame_core = mat("PBR_Rooftop_Flame_Core", (1.0, .46, .025, 1), 0.0, .31, "ember", (1.0, .21, .012, 1), 5.6)
    flame_mesh("RooftopRecoveryFlameOuter", parent, (.33, .34, fire_z), .38, .98, (.12, -.06), flame_outer, "rooftop.recovery.fire-flame-layer")
    flame_mesh("RooftopRecoveryFlameLickWest", parent, (.04, .36, fire_z + .14), .20, .68, (-.15, .14), flame_outer, "rooftop.recovery.fire-flame-layer")
    flame_mesh("RooftopRecoveryFlameCore", parent, (.38, .43, fire_z - .06), .18, .56, (.05, .08), flame_core, "rooftop.recovery.fire-core-layer")
    for index, (x, y, z, radius) in enumerate(((-.08, 1.18, fire_z + .18, .13), (.16, 1.48, fire_z + .08, .16), (.03, 1.78, fire_z + .22, .18))):
        flame_mesh(f"RooftopRecoverySmokeWisp_{index}", parent, (x, y, z), radius, .32 + index * .05, ((-.05 + index * .04), .07), mats["ash"], "rooftop.recovery.fire-smoke-layer")
    for index, (x, y, z) in enumerate(((-.38, .82, fire_z - .20), (.22, 1.06, fire_z + .20), (.46, 1.38, fire_z - .06), (-.10, 1.72, fire_z + .42), (.12, 2.14, fire_z + .08))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=.032, location=to_blender((x, y, z)))
        ember = bpy.context.object
        ember.name = f"RooftopRecoveryEmber_{index}"
        ember.data.materials.append(flame_core)
        ember.parent = parent
        tag(ember, "rooftop.recovery.fire-ember", pbr_authored=True, moving_layer=False)
        ensure_uv_layers(ember)
    rooftop_contact_patch("RooftopRecoveryHearthSoot", parent, (.36, fire_z), 1.70, 1.28, mats["soot"], "rooftop.recovery.fire-contact-soot")

    # The background access mass is a hand-composed selection of real facade
    # components, never the asset library's sample grid. Retaining its CC0
    # normal/roughness maps makes the brick returns and painted door react to
    # the cold fill and warm practical at player distance.
    authored_recovery_component(parent, "modular_factory_facade", "wall_door_centered_large_01", "RooftopRecoveryHeadHouseBrick", (0.0, 2.25, 17.78), 1.24, (0.0, 0.0, 0.0), "rooftop.recovery.headhouse-brick-door-bay")
    authored_recovery_component(parent, "modular_factory_facade", "dado_door_centered_large_01", "RooftopRecoveryHeadHouseDado", (0.0, .54, 17.72), 1.24, (0.0, 0.0, 0.0), "rooftop.recovery.headhouse-stone-dado")
    authored_recovery_component(parent, "modular_factory_facade", "door_centered_large_01", "RooftopRecoveryOpenGreyDoor", (-.72, 1.96, 17.30), 1.24, (0.0, 0.0, -.52), "rooftop.recovery.headhouse-open-grey-metal-door")
    authored_recovery_component(parent, "modular_factory_facade", "wall_window_centered_large_01", "RooftopRecoveryHeadHouseWestWindow", (-4.92, 2.22, 18.34), 1.06, (0.0, 0.0, 0.0), "rooftop.recovery.headhouse-broken-window-return")
    authored_recovery_component(parent, "modular_factory_facade", "wall_window_centered_medium_01", "RooftopRecoveryHeadHouseEastWindow", (4.90, 2.22, 18.58), 1.08, (0.0, 0.0, 0.0), "rooftop.recovery.headhouse-broken-window-return")
    # Thick hand-authored side scars turn the licensed bay into a bombed
    # volume with concrete depth and exposed rebar, rather than a wall card.
    jagged_wall_fragment("RooftopRecoveryHeadHouseScarWest", parent, -6.10, -4.62, ((.10, 16.46), (3.12, 16.52), (3.72, 17.32), (4.32, 17.88), (3.90, 19.34), (2.98, 20.12), (.12, 20.20)), mats["concrete"], "rooftop.recovery.headhouse-broken-concrete-return", boolean_wall_break=True)
    jagged_wall_fragment("RooftopRecoveryHeadHouseScarEast", parent, 4.70, 6.14, ((.10, 16.86), (2.08, 16.86), (2.86, 17.78), (3.54, 18.52), (3.12, 20.30), (.12, 20.08)), mats["brick"], "rooftop.recovery.headhouse-broken-brick-return", boolean_wall_break=True)
    for index, (x, y, z, height, lean) in enumerate(((-5.30, 3.92, 16.74, 1.48, -.20), (-4.82, 4.24, 18.12, 1.10, .18), (5.32, 3.88, 17.32, 1.30, .22), (5.74, 4.20, 18.44, .94, -.14))):
        rod = cylinder(f"RooftopRecoveryHeadHouseRebar_{index}", parent, (x, y, z), .030, height, mats["metal"], "rooftop.recovery.headhouse-exposed-rebar")
        rod.rotation_euler.rotate_axis("Y", lean)
    authored_recovery_component(parent, "modular_fire_escape", "modular_fire_escape_stairs", "RooftopRecoveryFireEscape", (7.20, .34, 18.04), .82, (0.0, 0.0, 0.0), "rooftop.recovery.headhouse-fire-escape")

    # Service detail belongs to one far-side curb so the foreground remains a
    # broken evacuation roof, not a field of repeated plastic furniture.
    authored_polyhaven_detail(parent, "portable_generator", "RooftopRecoveryGenerator", (-5.82, .46, 16.86), mats["metal"], "rooftop.recovery.cc0-portable-generator", 1.05)
    authored_polyhaven_rooftop_duct(parent, mats)
    rooftop_contact_patch("RooftopRecoveryGeneratorContact", parent, (-5.82, 16.86), 1.68, 1.28, mats["wet"], "rooftop.recovery.service-contact-wet")


def rooftop_validator_contract_dressing(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Keep only non-fire streaming dressing outside the player vista.

    The player sees only the physical hearth around the runtime seam.  A stock
    campfire prop is not retained even offscreen: it could introduce a static
    flame/billboard source into delivery.  Debris remains as a streamability
    proof behind the unreachable horizon plane.
    """
    staging_z = 52.0
    for index, (x, z) in enumerate(((-12.0, staging_z + .4), (-8.6, staging_z + 2.4), (-4.8, staging_z + .8), (3.8, staging_z + 1.8), (8.8, staging_z + .2))):
        authored_route_prop(parent, "debris-cluster", f"RooftopContractDebris_{index}", (x, .12, z))


def rooftop_blenderkit_scan_recovery(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Author the exit view around real scan rubble and the live fire seam.

    The only far building is a cropped, aggressively decimated abandoned-house
    scan beyond the north parapet.  It is deliberately non-navigable and can
    never impersonate the DoorSystem headhouse.  The foreground instead uses
    the reviewed rubble/floor scan derivatives, with a real timber-and-block
    hearth aligned to the runtime's warm particle/light position.
    """
    # Keep the horizon to the runtime's clear colour/fog.  The former matte
    # card and low-polygon ridges became a giant rectangular backdrop at the
    # 62-degree player camera, so neither is exported into the route.
    scan_rubble = mat(
        "PBR_Rooftop_Scan_Rubble",
        (.56, .49, .39, 1.0),
        rough=.91,
        source="concrete",
        roughness_multiplier=1.18,
    )
    scan_broken_roof = mat(
        "PBR_Rooftop_Broken_Roof",
        (.42, .48, .46, 1.0),
        rough=.95,
        source="concrete",
        roughness_multiplier=1.22,
    )
    charred_hearth = mat(
        "PBR_Rooftop_Charred_Hearth",
        (.18, .15, .12, 1.0),
        rough=.96,
        source="concrete",
        roughness_multiplier=1.24,
    )

    # Keep a 2m central lane from the authoritative rooftop door. All close
    # damage is physical scan geometry on the left/right roof edges, not a
    # cyan card or generic cube made to look like debris.
    authored_blenderkit_derivative(
        parent,
        "scan-rubble-pile-a",
        "RooftopBlenderKitWestForegroundRubble",
        (-3.82, .17, 6.34),
        .680,
        (0.0, 0.0, -.24),
        scan_rubble,
        "rooftop.recovery.blenderkit-foreground-scan-rubble",
        decimate_ratio=.022,
        crop=(.18, .78, .18, .78),
    )
    authored_blenderkit_derivative(
        parent,
        "scan-rubble-pile-a",
        "RooftopBlenderKitEastForegroundRubble",
        (4.42, .17, 7.76),
        .640,
        (0.0, 0.0, .42),
        scan_rubble,
        "rooftop.recovery.blenderkit-foreground-scan-rubble",
        decimate_ratio=.022,
        crop=(.18, .80, .18, .80),
    )
    # Both rejected-in-source scans are only used after their original black
    # response is removed, their underside is stripped and a shared authored
    # PBR material/UV review has been applied.
    authored_blenderkit_derivative(
        parent,
        "scan-rubble-ruins",
        "RooftopBlenderKitEastRuinBed",
        (5.18, .17, 10.42),
        .86,
        (0.0, 0.0, -.28),
        scan_rubble,
        "rooftop.recovery.blenderkit-rematerialed-ruin-bed",
        decimate_ratio=.028,
        crop=(.08, .92, .10, .90),
    )
    # A second structural scan rises against the west headhouse return.  This
    # is the blast-origin mass in the player view, not decorative fragments:
    # its cropped, underside-stripped photogrammetry supplies thick concrete,
    # aggregate and occlusion while leaving the middle evacuation lane clear.
    authored_blenderkit_derivative(
        parent,
        "scan-rubble-ruins",
        "RooftopBlenderKitHeadHouseBlastRuin",
        (-4.88, .19, 15.34),
        .78,
        (0.0, 0.0, .42),
        scan_rubble,
        "rooftop.recovery.blenderkit-headhouse-blast-edge-rubble",
        decimate_ratio=.024,
        crop=(.12, .86, .16, .84),
    )
    authored_blenderkit_derivative(
        parent,
        "scan-old-broken-floor",
        "RooftopBlenderKitWestBrokenFloor",
        (-4.26, .17, 8.02),
        .66,
        (0.0, 0.0, .30),
        scan_broken_roof,
        "rooftop.recovery.blenderkit-rematerialed-broken-floor",
        decimate_ratio=.020,
        crop=(.20, .84, .18, .86),
    )
    # A second, more aggressively cropped floor scan is tipped into the west
    # edge pile.  It is a genuine fractured slab with depth, not a cube used
    # as a recovery substitute, and keeps the centre traversal lane clear.
    authored_blenderkit_derivative(
        parent,
        "scan-old-broken-floor",
        "RooftopBlenderKitWestTiltedScanSlab",
        (-5.28, .31, 5.28),
        .78,
        (.32, .08, -.30),
        scan_broken_roof,
        "rooftop.recovery.blenderkit-tilted-fractured-slab",
        decimate_ratio=.018,
        crop=(.30, .72, .22, .78),
    )

    # The runtime CampfireLight lives at world [2.8, 1.1, 98.7], i.e. this
    # route-local position.  The static route owns actual fuel/hearth contact;
    # runtime owns the only moving flame/particle/light response.  No opaque
    # billboard or toy flame mesh is exported into the route GLB.
    fire_x, fire_z = 2.8, 16.7
    hearth_blocks = authored_blenderkit_derivative(
        parent,
        "painted-concrete-blocks",
        "RooftopBlenderKitHearthBlocks",
        # Keep the reviewed utility-block derivative as sparse side rubble;
        # its six distinct source variants are not allowed to overlap at the
        # flame seam, where their source topology previously z-fought.
        (7.72, .17, 23.62),
        .18,
        (0.0, 0.0, .12),
        charred_hearth,
        "rooftop.recovery.blenderkit-hearth-blocks",
        decimate_ratio=.28,
    )
    arrange_blenderkit_hearth_blocks(hearth_blocks)
    hearth_layout = ((-1.02, -.54), (-.28, -.88), (.62, -.66), (1.04, .10), (.38, .80), (-.68, .66))
    for index, (offset_x, offset_z) in enumerate(hearth_layout):
        block = cube(
            f"RooftopAuthoredHearthBlock_{index}", parent,
            (fire_x + offset_x, .18, fire_z + offset_z), (.72, .30, .42),
            mats["hearth_concrete"], "rooftop.recovery.runtime-hearth.solid-charred-concrete", .045,
            pbr_authored=True, dcc_authored_hearth=True,
        )
        block.rotation_euler.rotate_axis("Y", (-.26 + index * .22))
    for index, (offset_x, offset_z, length, angle) in enumerate(((-.42, -.18, 1.58, .84), (.38, .14, 1.44, -1.04), (.08, .38, 1.18, .22))):
        log = cylinder(
            f"RooftopRecoveryRuntimeHearthLog_{index}",
            parent,
            (fire_x + offset_x, .31, fire_z + offset_z),
            .12,
            length,
            mats["wood"],
            "rooftop.recovery.runtime-hearth.charred-log",
        )
        log.rotation_euler = (math.pi / 2, 0.0, angle)
    anchor(
        parent,
        "Anchor_RooftopFire_RuntimeParticleLight",
        "rooftop.fire.runtime-particle-light-seam",
        (fire_x, .26, fire_z),
        runtime_vfx_id="vfx.rooftop.fire.local-warm",
        runtime_smoke_vfx_id="vfx.rooftop.smoke.local",
        runtime_light_world_position="2.8,1.1,98.7",
        static_geometry="logs-and-hearth-only",
        flame_billboard=False,
    )

    # Foreground framing stays in the cleaned scan derivatives above. Reusing
    # opening submeshes here pulled in a worn-wood UV/material response that
    # polluted the roof plane and created an orange/black moire at the fire.

    # The scan is restricted to a silhouette-only distant neighbour. It sits
    # eight metres past the parapet and is neither a school landmark nor a
    # navigable headhouse. The matte behind it supplies horizon depth only.
    authored_blenderkit_derivative(
        parent,
        "abandoned-house",
        "RooftopBlenderKitDistantDestroyedHouse",
        # Keep this derivative as the distant adjacent mass the source gate
        # permits, but place it beyond the east parapet.  Centring the broad
        # scan in the player view created a flat black wall that hid the
        # school headhouse instead of reading as an adjacent ruined building.
        (50.0, .18, 34.20),
        .245,
        (0.0, 0.0, -.10),
        mats["brick_macro"],
        "rooftop.recovery.distant-blenderkit-destroyed-adjacent-building",
        decimate_ratio=.010,
        crop=(.14, .86, .18, .84),
    )


def rooftop_visible_school_service_dressing(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Build one damaged school headhouse rather than a facade sample row."""
    # A headhouse facade is school architecture, not the BlenderKit ruined
    # house.  It stays behind Nam-ra's roof clearing and has no static leaf at
    # the route portal, so DoorSystem remains the sole authoritative door.
    headhouse = empty(
        "RooftopAdjacentHeadHouse_Group",
        parent,
        "rooftop.adjacent-headhouse.group",
        pbr_authored=True,
        composition="dcc-authored-integrated-school-headhouse-with-thick-damage-returns",
    )
    # This is a single non-overlapping headhouse assembly.  The prior facade
    # library components carried coplanar wall/door sheets; at player height
    # those sheets z-fought into orange/black wood-like moire.  Here every
    # front, return, back and roof surface has a separate physical depth.
    front_z, rear_z = 18.94, 22.34
    for side in (-1, 1):
        # The front wings are true broken masonry volumes: their fractured
        # roofline and reveals provide the 0–20m bomb-damage silhouette that
        # a pair of clean facade rectangles could not supply.
        if side < 0:
            outline = ((-4.36, .10), (-1.78, .10), (-1.78, 2.66), (-2.14, 2.94), (-2.26, 3.50), (-2.76, 3.38), (-3.16, 4.16), (-3.70, 3.82), (-4.38, 3.72))
        else:
            outline = ((1.78, .10), (4.36, .10), (4.38, 3.64), (3.74, 3.84), (3.32, 4.22), (2.82, 3.46), (2.28, 3.58), (2.04, 2.96), (1.78, 2.70))
        wing = jagged_facade_fragment(
            f"RooftopVisibleHeadHousePlasterWing_{side:+d}", headhouse,
            front_z - .22, front_z + .20, outline, mats["headhouse_plaster"],
            "rooftop.visible-school-headhouse.charred-plaster-front",
            pbr_authored=True, non_overlapping_architecture=True,
        )
        bevel(wing, .030)
        cube(
            f"RooftopVisibleHeadHouseSideReturn_{side:+d}", headhouse,
            (side * 4.18, 2.02, 20.64), (.36, 4.04, 3.74),
            mats["headhouse_brick"], "rooftop.visible-school-headhouse.exposed-brick-side-return", .030,
            pbr_authored=True, non_overlapping_architecture=True,
        )
    cube(
        "RooftopVisibleHeadHouseRearWall", headhouse, (0.0, 2.02, rear_z),
        (8.72, 4.04, .32), mats["headhouse_plaster"],
        "rooftop.visible-school-headhouse.charred-plaster-rear", .030,
        pbr_authored=True, non_overlapping_architecture=True,
    )
    cube(
        "RooftopVisibleHeadHouseConcreteLintel", headhouse, (0.0, 3.30, front_z - .05),
        (3.92, .52, .34), mats["headhouse_concrete"],
        "rooftop.visible-school-headhouse.broken-concrete-lintel", .030,
        pbr_authored=True, non_overlapping_architecture=True,
    )
    # A true grey double door sits in a recessed opening, separate from the
    # authoritative stairwell DoorSystem leaf. It reads as adjacent building
    # architecture only and never lies on the roof portal seam.
    for side in (-1, 1):
        door = cube(
            f"RooftopVisibleHeadHouseDoubleDoor_{side:+d}", headhouse,
            (side * .84, 1.48, front_z - .045), (1.54, 2.84, .12),
            mats["headhouse_metal"], "rooftop.visible-school-headhouse.smoked-aluminium-double-door", .022,
            pbr_authored=True, non_overlapping_architecture=True,
        )
        cube(
            f"RooftopVisibleHeadHouseDoorInset_{side:+d}", headhouse,
            (side * .84, 1.48, front_z - .118), (1.18, 1.94, .025),
            mats["headhouse_void"], "rooftop.visible-school-headhouse.door-recessed-panel", .006,
            pbr_authored=True,
        )
        handle = cylinder(
            f"RooftopVisibleHeadHouseDoorHandle_{side:+d}", headhouse,
            (side * .16, 1.56, front_z - .17), .032, .34,
            mats["headhouse_metal"], "rooftop.visible-school-headhouse.door-handle",
            rotation=(0.0, math.pi / 2, 0.0),
        )
    cube("RooftopVisibleHeadHouseDoorJamb_W", headhouse, (-1.68, 1.54, front_z - .05), (.16, 3.12, .18), mats["headhouse_metal"], "rooftop.visible-school-headhouse.door-jamb", .015)
    cube("RooftopVisibleHeadHouseDoorJamb_E", headhouse, (1.68, 1.54, front_z - .05), (.16, 3.12, .18), mats["headhouse_metal"], "rooftop.visible-school-headhouse.door-jamb", .015)
    cube("RooftopVisibleHeadHouseDoorMullion", headhouse, (0.0, 1.54, front_z - .06), (.10, 3.02, .18), mats["headhouse_metal"], "rooftop.visible-school-headhouse.door-mullion", .012)
    cube("RooftopVisibleHeadHouseDoorHeader", headhouse, (0.0, 3.06, front_z - .06), (3.52, .16, .18), mats["headhouse_metal"], "rooftop.visible-school-headhouse.door-header", .012)
    roof_fragments = (
        ("West", ((-4.56, 18.52), (-1.22, 18.54), (-1.34, 19.52), (-1.08, 20.38), (-1.48, 21.34), (-1.36, 22.58), (-3.06, 22.66), (-4.48, 22.34))),
        ("East", ((1.18, 18.54), (4.54, 18.50), (4.42, 19.66), (4.58, 20.54), (4.18, 21.32), (4.46, 22.62), (2.62, 22.56), (1.46, 22.24), (1.06, 21.18))),
    )
    for side, outline in roof_fragments:
        slab = jagged_horizontal_fragment(
            f"RooftopVisibleHeadHouseBrokenRoof{side}", headhouse,
            3.98, 4.32, outline, mats["headhouse_concrete"],
            "rooftop.visible-school-headhouse.broken-concrete-roof-slab",
            pbr_authored=True, structural_architecture=True,
        )
        bevel(slab, .032)
    # Chipped coping is split into unequal physical pieces so the foreground
    # edge cannot resolve as one clean CAD rectangle after Meshopt delivery.
    for index, (x, width, y, lean) in enumerate(((-3.62, 1.44, 4.43, -.10), (-1.96, 1.32, 4.39, .08), (1.84, 1.18, 4.40, -.06), (3.42, 1.56, 4.44, .12))):
        coping = cube(
            f"RooftopVisibleHeadHouseCopingFragment_{index}", headhouse,
            (x, y, front_z + .02), (width, .20, .38), mats["headhouse_concrete"],
            "rooftop.visible-school-headhouse.chipped-coping", .020,
            pbr_authored=True, structural_architecture=True,
        )
        coping.rotation_euler.rotate_axis("Y", lean)
    # These uneven, thick spalls make the forward facade a bombed school
    # masonry mass rather than a pristine rectangular enclosure.  They sit
    # outside the plaster plane and do not share a coplanar front face.
    for index, (x, y, z, width, height, depth, lean) in enumerate((
        (-3.92, 3.84, 18.57, .72, .72, .46, -.20),
        (-2.94, 3.98, 18.54, .84, .48, .44, .12),
        (3.86, 3.76, 18.55, .66, .84, .46, .16),
        (2.96, 3.96, 18.55, .92, .44, .44, -.14),
    )):
        spall = cube(
            f"RooftopVisibleHeadHouseConcreteSpall_{index}", headhouse,
            (x, y, z), (width, height, depth), mats["headhouse_concrete"],
            "rooftop.visible-school-headhouse.thick-broken-concrete-spall", .050,
            pbr_authored=True, structural_damage=True,
        )
        spall.rotation_euler.rotate_axis("Y", lean)
    for index, (x, z, lean) in enumerate(((-4.18, 18.94, -.18), (-3.56, 21.42, .15), (3.48, 19.18, .19), (4.12, 21.56, -.12))):
        rod = cylinder(
            f"RooftopVisibleHeadHouseRebar_{index}", headhouse, (x, 3.72, z), .028, 1.28,
            mats["headhouse_metal"], "rooftop.visible-school-headhouse.exposed-rebar",
        )
        rod.rotation_euler.rotate_axis("Y", lean)

    # Generated lookdev establishes a stained, layered bomb-damage read; only
    # physical DCC geometry carries that direction into delivery. These
    # closed, offset edge volumes cast real contact shadows and avoid the
    # former large black polygon treatment.
    facade_damage = (
        (
            "WestExposedBrick", front_z - .47, front_z - .31,
            ((-4.28, .36), (-3.46, .30), (-3.02, .74), (-3.18, 1.40), (-2.96, 2.16), (-3.30, 3.12), (-3.78, 2.92), (-4.16, 3.46)),
            mats["headhouse_brick"],
        ),
        (
            "WestExposedAggregate", front_z - .50, front_z - .39,
            ((-3.26, 2.46), (-2.62, 2.62), (-2.42, 3.22), (-2.72, 3.62), (-3.18, 3.34)),
            mats["headhouse_concrete"],
        ),
        (
            "EastExposedBrick", front_z - .46, front_z - .30,
            ((3.54, .30), (4.30, .24), (4.24, 1.58), (4.02, 2.62), (3.66, 3.44), (3.30, 2.72), (3.48, 1.82)),
            mats["headhouse_brick"],
        ),
        (
            "EastExposedAggregate", front_z - .60, front_z - .50,
            ((2.68, 2.56), (3.24, 2.42), (3.46, 3.10), (3.12, 3.64), (2.62, 3.34)),
            mats["headhouse_concrete"],
        ),
    )
    for label, damage_front, damage_back, outline, material in facade_damage:
        fragment = jagged_facade_fragment(
            f"RooftopVisibleHeadHouse{label}", headhouse,
            damage_front, damage_back, outline, material,
            "rooftop.visible-school-headhouse.thick-blast-damage",
            pbr_authored=True, structural_architecture=True,
        )
        bevel(fragment, .018)

    for side, front_x, back_x, outline, material in (
        ("West", -4.54, -4.36, ((.32, 18.96), (2.86, 18.82), (3.58, 19.56), (3.18, 20.62), (3.72, 21.38), (2.44, 22.42), (.52, 22.26)), mats["headhouse_brick"]),
        ("East", 4.54, 4.36, ((.30, 18.92), (2.34, 18.80), (3.54, 19.34), (3.16, 20.22), (3.72, 21.10), (2.86, 22.38), (.48, 22.28)), mats["headhouse_concrete"]),
    ):
        fragment = jagged_wall_fragment(
            f"RooftopVisibleHeadHouseSideBlast{side}", headhouse,
            front_x, back_x, outline, material,
            "rooftop.visible-school-headhouse.thick-side-blast-damage",
            pbr_authored=True, structural_architecture=True,
        )
        bevel(fragment, .018)

    # The far-side water tank is a composed service silhouette: a ribbed
    # reservoir on four braces and a shallow lid, not a lone game-cylinder.
    # It remains past the hearth so the player first reads fire/Nam-ra, then
    # recognises the broader Hyosan school roof context.
    tank_x, tank_z = 5.72, 21.64
    cylinder("RooftopVisibleWaterTankBody", headhouse, (tank_x, 3.22, tank_z), .72, 1.24, mats["headhouse_metal"], "rooftop.visible-service.water-tank-body")
    cylinder("RooftopVisibleWaterTankLid", headhouse, (tank_x, 3.90, tank_z), .58, .14, mats["headhouse_metal"], "rooftop.visible-service.water-tank-lid")
    cylinder("RooftopVisibleWaterTankBase", headhouse, (tank_x, 2.54, tank_z), .78, .12, mats["headhouse_metal"], "rooftop.visible-service.water-tank-base")
    for index, (offset_x, offset_z) in enumerate(((-.48, -.48), (-.48, .48), (.48, -.48), (.48, .48))):
        cylinder(
            f"RooftopVisibleWaterTankBrace_{index}", headhouse,
            (tank_x + offset_x, 1.46, tank_z + offset_z), .055, 2.06,
            mats["headhouse_metal"], "rooftop.visible-service.water-tank-brace",
        )
    for index, angle in enumerate((0.0, math.pi / 2)):
        ring = cylinder(
            f"RooftopVisibleWaterTankBand_{index}", headhouse,
            (tank_x, 3.08 + index * .36, tank_z), .755, .040,
            mats["headhouse_metal"], "rooftop.visible-service.water-tank-rib",
        )
        ring.rotation_euler.rotate_axis("Z", angle)

    # Source-detail services are curb-attached to the architectural mass.
    # Their authored seams/readable supports now form a school roof service
    # story rather than isolated foreground box/cylinder silhouettes.
    authored_polyhaven_detail(parent, "exterior_aircon_unit", "RooftopVisibleAircon", (-5.12, .32, 18.28), mats["headhouse_metal"], "rooftop.visible-service.aircon", 1.02, rotation=(0.0, .10, -.16))
    authored_polyhaven_detail(parent, "portable_generator", "RooftopVisibleGenerator", (5.16, .42, 19.12), mats["headhouse_metal"], "rooftop.visible-service.generator", .94, rotation=(0.0, .08, -.18))
    authored_polyhaven_detail(parent, "modular_industrial_pipes_01", "RooftopVisiblePipes", (4.46, .28, 20.12), mats["headhouse_metal"], "rooftop.visible-service.pipes", .62, rotation=(0.0, .0, .12))
    authored_polyhaven_rooftop_duct(parent, mats)
    # The local fire uses the cleaned BlenderKit block ring and real crossed
    # logs authored above.  Do not embed a stock circular fire-pit ground
    # mesh: it previously aliased with the roof at player height and could be
    # mistaken for a static flame/prop substitute.  Motion and warm light
    # remain exclusively in the runtime particle/light seam.
    authored_polyhaven_detail(parent, "SchoolDesk_01", "RooftopVisibleWreckedDesk", (5.12, .12, 10.88), mats["wood"], "rooftop.visible-school.wrecked-desk", .96, rotation=(0.0, .28, -.24))
    for index, (x, z, angle) in enumerate(((6.24, 8.72, .22), (7.08, 13.24, -.34), (4.62, 15.22, .18))):
        authored_polyhaven_detail(parent, "SchoolChair_01", f"RooftopVisibleChair_{index}", (x, .12, z), mats["metal"], "rooftop.visible-school.wrecked-chair", .90 - index * .05, rotation=(0.0, .22 - index * .10, angle))


def rooftop_visual_recovery8(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Raw-first recovery composition for the player-height rooftop gate.

    It intentionally has no horizon panel and no stone-pit hero.  A clear
    centre path is framed by three irregular physical depth bands, a small
    practical log fire, then a human-scale damaged stair headhouse at 10m.
    """
    # Real, low mountain silhouettes and restrained fog beyond the parapet.
    # They are mesh layers, not an image card, and sit well outside the roof.
    mountain_ridge(parent, "RooftopRecovery8MountainFar", 34.0, mats["mountain"], elevation_lift=1.10)
    mountain_ridge(parent, "RooftopRecovery8MountainNear", 30.4, mats["mountain"], elevation_lift=.36)
    for index, (x, z, width, height) in enumerate(((-7.5, 28.8, 6.8, 1.25), (0.4, 29.2, 7.6, 1.50), (7.1, 28.5, 5.6, 1.15))):
        cube(f"RooftopRecovery8Fog_{index}", parent, (x, height, z), (width, height * 1.32, .045), mats["sky"], "rooftop.recovery.distant-cyan-fog", .0, authored_backdrop=True, outside_playable_geometry=True)

    # Foreground 0–8m: three non-identical, physically grounded evacuation
    # clusters. Their x positions preserve a 2m centre walking path.
    opening_dressing_module(parent, "RooftopRecovery8WestCollapse", "StartRoom_FloorCollapseSlab_", (-5.92, .05, 3.42))
    opening_dressing_module(parent, "RooftopRecovery8WestRubble", "StartRoom_BreachOriginRubble_", (-4.72, .05, 6.48))
    authored_recovery_component(parent, "concrete_road_barrier_02", "concrete_road_barrier_02", "RooftopRecovery8EastBarrier", (5.22, .24, 4.28), 1.12, (0.0, -.18, -.25), "rooftop.recovery.foreground-cc0-concrete-rubble")
    authored_polyhaven_detail(parent, "SchoolDesk_01", "RooftopRecovery8WreckedDesk", (4.54, .12, 6.46), mats["wood"], "rooftop.recovery.cc0-wrecked-school-desk", .94, rotation=(0.0, .28, -.21))
    authored_polyhaven_detail(parent, "SchoolChair_01", "RooftopRecovery8WreckedChair", (-3.74, .12, 5.22), mats["metal"], "rooftop.recovery.cc0-wrecked-school-chair", .84, rotation=(0.0, -.38, .34))
    authored_recovery_cc0(parent, "modular_electric_cables", "RooftopRecovery8CableLoom", (3.48, .30, 3.10), .42, (0.0, .0, -.22), mats, "rooftop.recovery.cc0-fallen-cable-loom")
    for label, center, radius in (("West", (-5.34, 4.92), (2.32, 2.06)), ("East", (4.80, 5.02), (2.16, 1.88))):
        rooftop_contact_patch(f"RooftopRecovery8Contact{label}", parent, center, radius[0], radius[1], mats["soot"], "rooftop.recovery.debris-contact-soot")

    # A small crossed-log fire, with alpha-blended flame membranes instead of
    # an opaque stone-pit sculpture. It is the only warm practical key.
    fire_z = 8.54
    for index, (x, z, length, angle) in enumerate(((-.22, fire_z - .12, 1.04, .92), (.34, fire_z + .16, .96, -1.06), (.12, fire_z + .36, .82, .28))):
        log = cylinder(f"RooftopRecovery8Log_{index}", parent, (x, .25, z), .082, length, mats["wood"], "rooftop.recovery.fire-charred-log")
        log.rotation_euler = (math.pi / 2, 0.0, angle)
    outer = mat("PBR_RooftopRecovery8_FlameOuter", (1.0, .13, .01, .78), 0.0, .35, "ember", (1.0, .045, .004, 1), 3.4)
    core = mat("PBR_RooftopRecovery8_FlameCore", (1.0, .56, .05, .66), 0.0, .28, "ember", (1.0, .22, .016, 1), 4.6)
    for material in (outer, core):
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None: bsdf.inputs["Alpha"].default_value = material.diffuse_color[3]
        try: material.surface_render_method = "DITHERED"
        except TypeError: pass
    flame_mesh("RooftopRecovery8FlameOuter", parent, (.10, .30, fire_z), .27, .72, (.08, -.04), outer, "rooftop.recovery.fire-translucent-flame-layer")
    flame_mesh("RooftopRecovery8FlameCore", parent, (.13, .34, fire_z), .15, .46, (-.05, .04), core, "rooftop.recovery.fire-translucent-flame-layer")
    smoke = mat("PBR_RooftopRecovery8_Smoke", (.26, .31, .31, .25), 0.0, .96, "wall")
    bsdf = smoke.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None: bsdf.inputs["Alpha"].default_value = .25
    try: smoke.surface_render_method = "DITHERED"
    except TypeError: pass
    flame_mesh("RooftopRecovery8Smoke", parent, (.06, 1.12, fire_z + .10), .18, .42, (.05, .10), smoke, "rooftop.recovery.fire-translucent-smoke-layer")
    rooftop_contact_patch("RooftopRecovery8HearthSoot", parent, (.10, fire_z), 1.34, .94, mats["soot"], "rooftop.recovery.fire-contact-soot")

    # One 2.1m-wide door bay and thick flanking scar volumes form a credible
    # human-scale headhouse 9–12m from the player, behind the small fire.
    authored_recovery_component(parent, "modular_factory_facade", "wall_door_centered_large_01", "RooftopRecovery8HeadHouseBrick", (0.0, 2.08, 11.82), 1.02, (0.0, 0.0, 0.0), "rooftop.recovery.headhouse-brick-door-bay")
    authored_recovery_component(parent, "modular_factory_facade", "dado_door_centered_large_01", "RooftopRecovery8HeadHouseDado", (0.0, .46, 11.78), 1.02, (0.0, 0.0, 0.0), "rooftop.recovery.headhouse-stone-dado")
    authored_recovery_component(parent, "modular_factory_facade", "door_centered_large_01", "RooftopRecovery8OpenGreyDoor", (-.56, 1.78, 11.48), 1.02, (0.0, 0.0, -.48), "rooftop.recovery.headhouse-open-grey-metal-door")
    cube("RooftopRecovery8HeadHouseRoof", parent, (0.0, 4.25, 12.14), (7.20, .28, 3.34), mats["concrete"], "rooftop.recovery.headhouse-deep-concrete-roof", .028)
    jagged_wall_fragment("RooftopRecovery8HeadHouseWestScar", parent, -4.40, -2.84, ((.10, 10.24), (2.46, 10.28), (3.12, 10.84), (3.68, 11.42), (3.20, 13.20), (.12, 13.10)), mats["concrete"], "rooftop.recovery.headhouse-broken-concrete-return", boolean_wall_break=True)
    jagged_wall_fragment("RooftopRecovery8HeadHouseEastScar", parent, 2.86, 4.46, ((.10, 10.40), (2.12, 10.44), (2.82, 11.24), (3.42, 11.96), (3.02, 13.18), (.12, 13.08)), mats["brick"], "rooftop.recovery.headhouse-broken-brick-return", boolean_wall_break=True)
    for index, (x, z, lean) in enumerate(((-3.82, 10.54, -.24), (-3.22, 12.22, .16), (3.62, 10.82, .23), (4.04, 12.04, -.12))):
        rod = cylinder(f"RooftopRecovery8Rebar_{index}", parent, (x, 3.52, z), .027, 1.10, mats["metal"], "rooftop.recovery.headhouse-exposed-rebar")
        rod.rotation_euler.rotate_axis("Y", lean)
    authored_recovery_component(parent, "modular_fire_escape", "modular_fire_escape_stairs", "RooftopRecovery8FireEscape", (5.44, .30, 12.10), .62, (0.0, 0.0, 0.0), "rooftop.recovery.headhouse-fire-escape")
    authored_polyhaven_detail(parent, "portable_generator", "RooftopRecovery8Generator", (-5.36, .38, 10.92), mats["metal"], "rooftop.recovery.cc0-portable-generator", .92)


def mountain_ridge(parent: bpy.types.Object, prefix: str, z: float, material: bpy.types.Material, elevation_lift: float = 0.0) -> None:
    """A layered, low-contrast skyline beyond the far rooftop parapet.

    It is intentionally delivered as authored route geometry rather than a
    renderer-only backdrop, so every player-height runtime camera sees the same
    framing.  The ridges sit outside the navigable slab and cannot affect the
    rooftop portal/collider contract.
    """
    layers = (
        ((-15.0, 1.18), (-11.0, 3.05), (-7.6, 2.15), (-3.2, 4.42), (.5, 2.46), (4.2, 3.72), (8.8, 2.08), (12.2, 3.28), (15.0, 1.18)),
        ((-15.0, 1.18), (-12.5, 2.16), (-8.0, 1.62), (-4.4, 3.18), (-.8, 1.86), (3.0, 2.72), (6.8, 1.72), (10.6, 2.48), (15.0, 1.18)),
    )
    for layer, ridge in enumerate(layers):
        vertices: list[tuple[float, float, float]] = []
        faces: list[tuple[int, int, int, int]] = []
        depth = z + layer * .12
        for x, height in ridge:
            vertices.extend((to_blender((x, 1.15 + elevation_lift, depth)), to_blender((x, height + elevation_lift, depth))))
        for index in range(len(ridge) - 1):
            base = index * 2
            faces.append((base, base + 2, base + 3, base + 1))
        mesh = bpy.data.meshes.new(f"{prefix}_{layer}")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(f"{prefix}_{layer}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        obj.data.materials.append(material)
        ensure_uv_layers(obj)
        tag(obj, "rooftop.mountain-silhouette", authored_backdrop=True, pbr_authored=True)


def rooftop_bulkhead(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """A real brick stair bulkhead with an unblocked door-frame opening."""
    # The Fire/Rooftop DoorSystem leaf remains authored in the stairwell zone.
    # This roof-side architecture deliberately has a void plus fixed frame, so
    # there is no second static closed leaf that can contradict openProgress.
    # The authoritative portal is the southern edge of a north-running roof
    # lane. Keep the building mass behind that seam (negative local z) so a
    # player who crosses DoorSystem's open leaf faces the playable rooftop,
    # not a static back wall.
    cube("RooftopBulkhead_Left", parent, (-1.92, 1.78, -.34), (1.76, 3.56, .44), mats["brick"], "rooftop.bulkhead.brick-left", .028)
    cube("RooftopBulkhead_Right", parent, (1.92, 1.78, -.34), (1.76, 3.56, .44), mats["brick"], "rooftop.bulkhead.brick-right", .028)
    cube("RooftopBulkhead_Lintel", parent, (0, 3.32, -.34), (5.6, .48, .44), mats["brick"], "rooftop.bulkhead.brick-lintel", .028)
    cube("RooftopBulkhead_Side_L", parent, (-2.72, 1.8, -1.95), (.30, 3.60, 3.45), mats["brick"], "rooftop.bulkhead.side-wall", .024)
    cube("RooftopBulkhead_Side_R", parent, (2.72, 1.8, -1.95), (.30, 3.60, 3.45), mats["brick"], "rooftop.bulkhead.side-wall", .024)
    cube("RooftopBulkhead_Back", parent, (0, 1.8, -3.60), (5.72, 3.60, .30), mats["brick"], "rooftop.bulkhead.rear-wall", .024)
    cube("RooftopBulkhead_Roof", parent, (0, 3.67, -1.96), (5.72, .26, 3.62), mats["concrete"], "rooftop.bulkhead.roof-slab", .022)
    # A chipped coping and rain hood give the exit enclosure a legible school
    # roof construction without adding a second static DoorSystem leaf.
    cube("RooftopBulkheadCoping_Front", parent, (0, 3.88, -.34), (5.98, .20, .34), mats["concrete"], "rooftop.bulkhead.coping", .020)
    cube("RooftopBulkheadCoping_Left", parent, (-2.86, 3.88, -1.96), (.32, .20, 3.54), mats["concrete"], "rooftop.bulkhead.coping", .020)
    cube("RooftopBulkheadCoping_Right", parent, (2.86, 3.88, -1.96), (.32, .20, 3.54), mats["concrete"], "rooftop.bulkhead.coping", .020)
    for side in (-1, 1):
        cube(f"RooftopDoorFrame_{side}", parent, (side * .86, 1.44, .08), (.12, 2.82, .16), mats["metal"], "rooftop.door-frame", .014)
    cube("RooftopDoorFrame_Header", parent, (0, 2.83, .08), (1.84, .16, .16), mats["metal"], "rooftop.door-frame", .014)
    cube("RooftopDoorRainHood", parent, (0, 3.02, -.64), (2.48, .10, .74), mats["metal"], "rooftop.door-rain-hood", .018)
    for side in (-1, 1):
        cube(f"RooftopDoorHoodBrace_{side}", parent, (side * 1.04, 2.78, -.43), (.075, .52, .075), mats["metal"], "rooftop.door-rain-hood-brace", .008)
    anchor(parent, "Anchor_RooftopDoorVisualSeam", "door.rooftop.runtime-visible-leaf", (0, 1.48, .0))


def rooftop_ash(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Sparse dimensional ash motes support the warm fire/cold-moon contrast."""
    motes = ((-1.8, 1.46, 10.8), (-.7, 2.22, 12.4), (.9, 1.82, 13.6), (2.0, 2.64, 15.2), (3.5, 1.44, 17.1), (4.2, 2.95, 18.8), (-3.2, 2.10, 19.6), (-4.4, 1.62, 22.4), (1.6, 3.22, 21.1), (5.1, 2.26, 24.0))
    for index, (x, y, z) in enumerate(motes):
        cube(f"RooftopAsh_{index}", parent, (x, y, z), (.045, .018, .085), mats["ash"], "rooftop.ash-mote", .002)


def rooftop_night_dome(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Author a curved, lit night atmosphere instead of a flat black panel."""
    segments, rings, radius = 28, 8, 43.0
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    # A hemisphere is intentionally real route geometry: the player receives
    # the same horizon/weather framing at runtime and in its DCC review. The
    # faces wind inward so a normal glTF front-side material is visible from
    # the roof rather than requiring a renderer-only skybox override.
    for ring in range(rings + 1):
        elevation = (math.pi * .5) * (ring / rings)
        radial = radius * math.cos(elevation)
        for segment in range(segments + 1):
            angle = math.tau * (segment / segments)
            vertices.append(to_blender((radial * math.cos(angle), .85 + radius * math.sin(elevation), 13.0 + radial * math.sin(angle))))
    stride = segments + 1
    for ring in range(rings):
        for segment in range(segments):
            base = ring * stride + segment
            faces.append((base, base + stride, base + stride + 1, base + 1))
    mesh = bpy.data.meshes.new("RooftopNightDome_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("RooftopNightDome", mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(mats["sky"])
    ensure_uv_layers(obj)
    tag(obj, "rooftop.night-atmosphere", authored_backdrop=True, pbr_authored=True, curved_background=True)


def rooftop_industrial_dressing(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Give the roof a serviceable school-building silhouette and depth."""
    rust = approved_opening_material("Smoked_Aluminium")
    cylinder("RooftopAntennaMast", parent, (-7.55, 2.18, 21.4), .045, 3.4, rust, "rooftop.antenna-mast")
    cylinder("RooftopAntennaArm", parent, (-7.10, 3.22, 21.4), .028, .96, rust, "rooftop.antenna-arm", rotation=(0, math.pi / 2, 0))


def rooftop_distant_school_mass(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Build the damaged Hyosan roofline beyond the north parapet.

    A playable roof cannot terminate in a black sky and a low mountain strip.
    These staggered brick wings, recessed windows and damaged roof members are
    actual route geometry outside the collider, giving the player parallax and
    an architectural scale reference without becoming a flat backdrop panel.
    """
    wings = (
        ("West", -6.35, 2.52, 28.10, 6.10, 5.04, 2.20),
        ("Centre", .05, 3.34, 28.45, 6.72, 6.68, 2.82),
        ("East", 6.48, 2.05, 28.00, 5.42, 4.10, 2.06),
    )
    for name, x, y, z, width, height, depth in wings:
        cube(f"RooftopDistantSchoolWing_{name}", parent, (x, y, z), (width, height, depth), mats["brick"], "rooftop.distant-school.brick-wing", .035)
        cube(f"RooftopDistantSchoolRoof_{name}", parent, (x, y + height / 2 + .10, z), (width + .32, .20, depth + .24), mats["concrete"], "rooftop.distant-school.coping", .020)
    # Varying recess depth, frame thickness and missing panes avoids a copied
    # wall-card rhythm. All glass remains behind a physical brick return.
    windows = (
        (-7.42, 2.34, 26.94, 1.42, 1.22, True), (-5.46, 3.12, 26.94, 1.28, 1.52, False),
        (-1.84, 2.46, 26.95, 1.30, 1.34, False), (.08, 4.16, 26.88, 1.55, 1.68, True),
        (2.12, 3.12, 26.90, 1.18, 1.40, False), (5.60, 2.10, 26.98, 1.30, 1.10, False),
        (7.26, 2.42, 26.98, 1.16, 1.32, True),
    )
    for index, (x, y, z, width, height, broken) in enumerate(windows):
        cube(f"RooftopDistantWindowRecess_{index}", parent, (x, y, z), (width + .24, height + .24, .20), mats["black"], "rooftop.distant-school.window-recess", .012)
        if not broken:
            cube(f"RooftopDistantWindowGlass_{index}", parent, (x, y, z - .115), (width, height, .026), mats["window"], "rooftop.distant-school.window-glass", .004)
        cube(f"RooftopDistantWindowMullionV_{index}", parent, (x, y, z - .145), (.055, height + .20, .075), mats["metal"], "rooftop.distant-school.window-mullion", .006)
        cube(f"RooftopDistantWindowMullionH_{index}", parent, (x, y, z - .145), (width + .20, .055, .075), mats["metal"], "rooftop.distant-school.window-mullion", .006)
    for index, (x, height, z, lean) in enumerate(((-8.72, 2.35, 26.65, -.16), (-3.32, 2.85, 26.72, .10), (3.38, 3.38, 26.66, -.10), (8.48, 2.48, 26.64, .17))):
        bar = cylinder(f"RooftopDistantRebar_{index}", parent, (x, height, z), .035, 1.65, mats["metal"], "rooftop.distant-school.exposed-rebar", rotation=(0.0, 0.0, lean))
        bar.rotation_euler.rotate_axis("Y", .18 * (index - 1))


def rooftop_adjacent_stair_headhouse(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Place a real neighbouring brick headhouse beyond the north parapet.

    It is intentionally separate from the actual DoorSystem exit enclosure at
    local z=0: this distant school mass cannot leave a duplicate static leaf
    over the passable RooftopDoor contract. Its full-depth frame, recessed
    double doors, coping and damaged side return give the forward player view
    a credible school roofline instead of the previous small brick cards.
    """
    brick = mats["brick"]
    # Reuse the opening's photographed/author-authored rusted steel response
    # for the background double door. The shared aluminium tint was reading
    # as a clean green panel under moonlight instead of weathered metal.
    metal = approved_opening_material("Door_RustedMetal")
    concrete = mats["concrete"]
    # Keep the headhouse beyond Nam-ra's clearing (anchor z=19.5), while
    # pulling its facade close enough to read as a real destination behind the
    # fire instead of a tiny skyline card at the end of the 26m roof slab.
    base_z = 24.10
    # Thick side returns and a deep rear wall make this a volume, not a
    # billboard: the front door recess is 0.54m back from the brick edge.
    cube("RooftopAdjacentHeadHouse_Left", parent, (-2.62, 2.10, base_z), (1.58, 4.18, 3.76), brick, "rooftop.adjacent-headhouse.brick-return", .035)
    cube("RooftopAdjacentHeadHouse_Right", parent, (2.62, 2.10, base_z), (1.58, 4.18, 3.76), brick, "rooftop.adjacent-headhouse.brick-return", .035)
    cube("RooftopAdjacentHeadHouse_Lintel", parent, (0.0, 3.78, base_z), (6.80, .82, 3.76), brick, "rooftop.adjacent-headhouse.brick-lintel", .032)
    cube("RooftopAdjacentHeadHouse_Rear", parent, (0.0, 2.05, base_z + 1.76), (6.80, 4.10, .28), brick, "rooftop.adjacent-headhouse.rear-wall", .028)
    cube("RooftopAdjacentHeadHouse_Roof", parent, (0.0, 4.23, base_z), (7.16, .24, 4.12), concrete, "rooftop.adjacent-headhouse.roof-slab", .024)
    cube("RooftopAdjacentHeadHouse_Coping", parent, (0.0, 4.44, base_z - .05), (7.42, .18, 4.38), concrete, "rooftop.adjacent-headhouse.coping", .020)
    # The reveal, jambs and paired leaves are deliberately small enough to
    # read as an adjacent service entry, not as a duplicate of the runtime
    # door. They remain beyond z=26, outside the playable rooftop collider.
    front = base_z - 1.86
    cube("RooftopAdjacentHeadHouse_DoorVoid", parent, (0.0, 1.62, front + .04), (3.60, 3.18, .24), mats["black"], "rooftop.adjacent-headhouse.door-recess", .012)
    for side in (-1, 1):
        leaf = cube(f"RooftopAdjacentHeadHouse_DoorLeaf_{side}", parent, (side * .86, 1.54, front - .10), (1.58, 2.84, .10), metal, "rooftop.adjacent-headhouse.fixed-double-door", .020, static_architecture=True)
        if side > 0:
            # This is an adjacent fixed school entry, not the DoorSystem
            # exit. Keeping one leaf visibly ajar gives the far access block
            # a credible evacuation silhouette without duplicating the
            # passable rooftop door at local z=0.
            leaf.rotation_euler.rotate_axis("Z", -.62)
        cube(f"RooftopAdjacentHeadHouse_DoorKickplate_{side}", parent, (side * .86, .54, front - .165), (1.34, .44, .024), mats["black"], "rooftop.adjacent-headhouse.door-kickplate", .006)
        cube(f"RooftopAdjacentHeadHouse_DoorJamb_{side}", parent, (side * 1.72, 1.62, front - .14), (.14, 3.22, .16), metal, "rooftop.adjacent-headhouse.door-jamb", .014)
    cube("RooftopAdjacentHeadHouse_DoorMullion", parent, (0.0, 1.62, front - .15), (.11, 3.10, .16), metal, "rooftop.adjacent-headhouse.door-mullion", .012)
    cube("RooftopAdjacentHeadHouse_DoorHeader", parent, (0.0, 3.11, front - .14), (3.62, .14, .16), metal, "rooftop.adjacent-headhouse.door-header", .012)
    # Broken plaster/brick returns and protruding rebar vary the silhouette.
    for index, (x, y, z, height, lean) in enumerate(((-3.30, 4.66, base_z - .84, .92, -.20), (-2.84, 4.50, base_z + .66, 1.18, .10), (3.36, 4.60, base_z - .72, .82, .17), (2.76, 4.48, base_z + .82, 1.06, -.14))):
        rod = cylinder(f"RooftopAdjacentHeadHouse_Rebar_{index}", parent, (x, y, z), .028, height, metal, "rooftop.adjacent-headhouse.exposed-rebar")
        rod.rotation_euler.rotate_axis("Y", lean)
    # Scale the whole authored headhouse about its own ground anchor instead
    # of stretching a single brick card. This keeps its recessed double doors,
    # deep returns, coping and rebar proportionate while making the destination
    # read beyond the midground fire from a 1.65m doorway camera.
    parts = [child for child in parent.children if child.name.startswith("RooftopAdjacentHeadHouse_")]
    group = empty("RooftopAdjacentHeadHouse_Group", parent, "rooftop.adjacent-headhouse.group", pbr_authored=True, composition_scale="1.70x")
    group.location = to_blender((0.0, 0.0, base_z))
    for child in parts:
        child.parent = group
        child.matrix_parent_inverse.identity()
        child.location -= group.location
    # Apply the composition scale to child transforms rather than leaving a
    # parent-only scale. UV0 is now retiled against the enlarged physical
    # dimensions, preventing a brick return from stretching into timber-like
    # vertical stripes in the delivery GLB.
    composition_scale = Vector((1.70, 1.70, 1.55))
    for child in parts:
        child.location = Vector((child.location.x * composition_scale.x, child.location.y * composition_scale.y, child.location.z * composition_scale.z))
        child.scale = Vector((child.scale.x * composition_scale.x, child.scale.y * composition_scale.y, child.scale.z * composition_scale.z))
        if child.type == "MESH" and child.data.materials:
            tile_primary_uvs(child, child.data.materials[0])


def rooftop_service_foundation(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Anchor the licensed duct subset to a credible roof curb and service run."""
    cube("RooftopDuctServiceCurb", parent, (-5.02, .20, 14.18), (4.72, .34, 4.46), mats["concrete"], "rooftop.service-curb", .028)
    cube("RooftopDuctServiceCurb_North", parent, (-5.02, .48, 16.31), (4.84, .22, .18), mats["metal"], "rooftop.service-curb-edge", .012)
    cube("RooftopDuctServiceCurb_South", parent, (-5.02, .48, 12.05), (4.84, .22, .18), mats["metal"], "rooftop.service-curb-edge", .012)
    for index, (x, z) in enumerate(((-6.62, 12.62), (-3.42, 12.62), (-6.62, 15.76), (-3.42, 15.76))):
        cube(f"RooftopDuctServiceSupport_{index}", parent, (x, .66, z), (.16, .54, .16), mats["metal"], "rooftop.service-curb-support", .012)
    # The previous long freestanding pipe pair crossed the player view as two
    # oversized green rails. Service runs now remain wall/curb attached via
    # the imported HVAC assembly, leaving the foreground legible as rubble,
    # furniture wreckage and the campfire route rather than a pipe corridor.


def rooftop_polyhaven_anchors(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Give the service curb actual authored HVAC, generator and pipe detail."""
    authored_polyhaven_detail(
        parent,
        "exterior_aircon_unit",
        "RooftopExteriorAircon",
        (-5.78, .70, 12.86),
        mats["metal"],
        "rooftop.polyhaven-exterior-aircon.mesh",
        1.34,
    )
    authored_polyhaven_detail(
        parent,
        "modular_industrial_pipes_01",
        "RooftopIndustrialPipes",
        # The authored assembly now sits against the far-west curb instead of
        # crossing the doorway view as a pair of oversized free-standing
        # rails. It reads as a background HVAC silhouette beyond the fire.
        (-8.62, .84, 19.45),
        mats["metal"],
        "rooftop.polyhaven-industrial-pipes.mesh",
        .58,
    )
    authored_polyhaven_detail(
        parent,
        "portable_generator",
        "RooftopPortableGenerator",
        (3.82, .48, 14.08),
        mats["metal"],
        "rooftop.polyhaven-portable-generator.mesh",
        1.22,
    )
    # The existing campfire kit supplies the restrained ember state; this
    # authored stone ring supplies the physical hearth/log-scale silhouette so
    # the warm point light does not float over a generic primitive pile.
    authored_polyhaven_detail(
        parent,
        "stone_fire_pit",
        "RooftopStoneFirePit",
        (0.36, .20, ROOFTOP_FIRE_Z),
        mats["brick"],
        "rooftop.polyhaven-stone-fire-pit.mesh",
        1.10,
    )
    # A few real school-furniture silhouettes make the roof feel like a
    # desperate evacuation space rather than a pristine HVAC showroom. They
    # are staged off the central door-to-fire lane and each carries the same
    # CC0 provenance/zone-release contract as the first-bay desk/chair.
    authored_polyhaven_detail(
        parent,
        "SchoolDesk_01",
        "RooftopWreckedDesk",
        (-5.72, .18, 5.92),
        mats["wood"],
        "rooftop.polyhaven-school-desk-wreckage.mesh",
        .94,
        rotation=(0.0, 0.22, -.17),
    )
    for index, (x, y, z, rotation) in enumerate((
        (-4.20, .22, 7.32, (0.0, -.26, .32)),
        (-6.38, .16, 9.34, (0.0, .34, -.24)),
        (5.58, .15, 8.46, (0.0, -.38, .22)),
    )):
        authored_polyhaven_detail(
            parent,
            "SchoolChair_01",
            f"RooftopWreckedChair_{index}",
            (x, y, z),
            mats["metal"],
            "rooftop.polyhaven-school-chair-wreckage.mesh",
            .90,
            rotation=rotation,
        )


def rooftop_opening_damage_reuse(parent: bpy.types.Object) -> None:
    """Carry authored collapse scale from the opening into the rooftop edges."""
    # These groups stay clear of the central door-to-fire sightline. They add
    # layered cover and a credible demolition origin rather than random
    # clutter over a featureless slab.
    # The opening slabs have an intentionally large first-room silhouette.
    # They remain edge/background damage here; placing that full-scale source
    # directly in the 1.6m exit camera made it read as an opaque black screen.
    # Smaller foreground dressing is authored separately below around the
    # actual service/fire landmarks.
    opening_dressing_module(parent, "RooftopSourceCollapseWest", "StartRoom_FloorCollapseSlab_", (-5.46, .06, 19.12))
    opening_dressing_module(parent, "RooftopSourceRubbleWest", "StartRoom_BreachOriginRubble_", (-5.46, .06, 19.12))
    opening_dressing_module(parent, "RooftopSourceCollapseEast", "StartRoom_FloorCollapseSlab_", (6.28, .06, 20.84))
    opening_dressing_module(parent, "RooftopSourceFallenFrame", "StartRoom_ForegroundFallenFrame", (7.10, 1.28, 21.10))


def rooftop_fire_dressing(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Give the existing campfire kit a readable physical log hearth.

    The kit owns embers/particles. This route-owned geometry supplies the
    charred split logs, stone-scale surround and ash contact at player height,
    preventing its warm practical from reading as a tiny orange primitive on
    an otherwise empty slab.
    """
    log_positions = (
        (-.06, .30, ROOFTOP_FIRE_Z - .22, 1.26, math.pi / 2),
        (.78, .30, ROOFTOP_FIRE_Z + .22, 1.22, math.pi / 2 + .82),
        (.48, .42, ROOFTOP_FIRE_Z - .40, 1.06, math.pi / 2 - .72),
        (.20, .44, ROOFTOP_FIRE_Z + .52, .94, math.pi / 2 + .26),
    )
    for index, (x, y, z, length, angle) in enumerate(log_positions):
        log = cylinder(
            f"RooftopCampfireLog_{index}",
            parent,
            (x, y, z),
            .105,
            length,
            mats["wood"],
            "rooftop.campfire.charred-log",
        )
        log.rotation_euler = (math.pi / 2, 0.0, angle)
        tag(log, "rooftop.campfire.charred-log", pbr_authored=True, practical_fire_dressing=True)
    # Irregular ash/stone contacts break the machine-perfect ring without
    # affecting the service lane or Nam-ra landmark anchor.
    for index, (x, z, sx, sz) in enumerate(((-.28, ROOFTOP_FIRE_Z - .46, .30, .22), (1.12, ROOFTOP_FIRE_Z - .28, .24, .34), (-.26, ROOFTOP_FIRE_Z + .44, .34, .20), (.94, ROOFTOP_FIRE_Z + .66, .28, .26), (.40, ROOFTOP_FIRE_Z - .72, .24, .30))):
        stone = cube(
            f"RooftopCampfireStone_{index}",
            parent,
            (x, .14, z),
            (sx, .16, sz),
            mats["concrete"],
            "rooftop.campfire.hearth-stone",
            .035,
            pbr_authored=True,
        )
        stone.rotation_euler.rotate_axis("Y", .16 * (index - 2))


def rooftop_depth_band_dressing(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Arrange the roof as doorway, fire/Nam-ra, and headhouse depth bands.

    All of these meshes are zone-local source geometry. The spacing avoids the
    primary door-to-fire lane, so visual storytelling does not invent a hidden
    physics blocker inside the authoritative rooftop slab.
    """
    # Foreground (local z≈4..10): a collapsed evacuation beat immediately
    # after the access door, with small source rubble rather than full-size
    # start-room slabs that previously filled the camera as black screens.
    opening_dressing_module(parent, "RooftopDoorwayOverturnedDesk", "FirstBay_OverturnedDesk_A_", (-4.78, .08, 4.62))
    opening_dressing_module(parent, "RooftopDoorwayOverturnedDesk_East", "FirstBay_OverturnedDesk_B_", (4.14, .08, 4.88))
    opening_dressing_module(parent, "RooftopDoorwayChair", "FirstBay_Chair_Foreground_", (-3.66, .08, 6.18))
    opening_dressing_module(parent, "RooftopDoorwayRubble", "StartRoom_BreachOriginRubble_", (-6.24, .05, 6.66))
    # Midground (local z≈12..19): the already-authored fire stays centered;
    # a single damaged chair and paper group frame it without obscuring the
    # later Nam-ra anchor at z=19.5.
    opening_dressing_module(parent, "RooftopFirePaper", "StartRoom_PaperDebris_", (4.62, .04, 11.42))
    opening_dressing_module(parent, "RooftopFireChair", "FirstBay_Chair_A_", (-1.98, .08, 10.78))
    # Background (local z≈22..26): smaller source rubble establishes a
    # damaged parapet/school edge below the full brick access mass.
    opening_dressing_module(parent, "RooftopHeadHouseRubble", "FirstBay_Rubble_", (5.72, .04, 22.24))


def rooftop_contact_patch(
    name: str,
    parent: bpy.types.Object,
    center: tuple[float, float],
    radius_x: float,
    radius_z: float,
    material: bpy.types.Material,
    semantic: str,
) -> bpy.types.Object:
    """Lay a deliberately irregular physical contact layer on the roof.

    The mesh is a shallow, non-rectangular surface with a shared route PBR
    material. It carries soot/wet BRDF response under furniture and rubble,
    rather than painting a fake ambient-occlusion square into the slab atlas.
    """
    x, z = center
    outline = (
        (-.94, -.18), (-.58, -.76), (.12, -.92), (.82, -.48),
        (.98, .18), (.54, .76), (-.18, .92), (-.82, .54),
    )
    # The roof slab's finished top is y=.15. Keep this layer visibly above it
    # to avoid the moire/z-fight that made contact shadows read as a grid.
    vertices = [to_blender((x + ox * radius_x, .182, z + oz * radius_z)) for ox, oz in outline]
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], [tuple(range(len(vertices)))])
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for loop_index in mesh.polygons[0].loop_indices:
        vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
        uv.data[loop_index].uv = (vertex.x * .45, vertex.y * -.45)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    tag(obj, semantic, pbr_authored=True, contact_layer=True, physical_surface_response=True)
    ensure_uv_layers(obj)
    return obj


def rooftop_rubble_clusters(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Stage six shared-mesh rubble clusters around, never across, the route.

    Forty-two individually placed objects reuse three authored seed meshes.
    That gives close player cameras fractured concrete, exposed brick and metal
    depth without forty-two unique payloads or an opaque obstacle in the
    DoorSystem-to-fire traversal lane.
    """
    seed_shapes = (
        ("Concrete", mats["concrete"], ((-.46, -.30), (.34, -.42), (.56, .08), (.18, .48), (-.50, .34)), .54),
        ("Brick", mats["brick"], ((-.36, -.42), (.44, -.26), (.52, .20), (-.12, .46), (-.52, .12)), .38),
        ("Metal", mats["metal"], ((-.32, -.16), (.46, -.24), (.30, .34), (-.46, .24)), .22),
    )
    seeds: list[bpy.types.Mesh] = []
    for name, material, outline, height in seed_shapes:
        bottom = [to_blender((x, 0.0, z)) for x, z in outline]
        top = [to_blender((x * .88, height * (1.0 + (index % 2) * .18), z * .88)) for index, (x, z) in enumerate(outline)]
        count = len(outline)
        faces: list[tuple[int, ...]] = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
        for index in range(count):
            next_index = (index + 1) % count
            faces.append((index, next_index, count + next_index, count + index))
        mesh = bpy.data.meshes.new(f"RooftopRubbleSeed_{name}_Mesh")
        mesh.from_pydata(bottom + top, [], faces)
        mesh.update()
        mesh.materials.append(material)
        uv = mesh.uv_layers.new(name="UVMap")
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                uv.data[loop_index].uv = (vertex.x * .56, vertex.y * -.56)
        seeds.append(mesh)

    # left/right foreground, fire-edge, two parapet rests, and an offset rear
    # collapse. Counts total 42. The central x≈0 lane remains readable for the
    # 0→12m doorway-to-fire composition.
    clusters = (
        ("DoorwayWest", -3.72, 4.54, 7, 1.48),
        ("DoorwayEast", 3.82, 5.22, 7, 1.42),
        ("FireWest", -4.18, 9.32, 7, 1.34),
        ("FireEast", 4.34, 10.42, 7, 1.38),
        ("ParapetWest", -6.82, 16.88, 7, 1.48),
        ("ParapetEast", 6.54, 18.92, 7, 1.56),
    )
    for cluster_index, (name, x, z, count, radius) in enumerate(clusters):
        rooftop_contact_patch(
            f"RooftopContact_{name}",
            parent,
            (x, z),
            radius * 1.18,
            radius * .82,
            mats["wet"] if cluster_index in {0, 1, 4} else mats["soot"],
            "rooftop.contact-soot-wet",
        )
        for piece in range(count):
            angle = (piece * 2.399 + cluster_index * .71) % math.tau
            distance = radius * (.24 + (piece % 4) * .19)
            obj = bpy.data.objects.new(f"RooftopRubble_{name}_{piece:02d}", seeds[(piece + cluster_index) % len(seeds)])
            bpy.context.collection.objects.link(obj)
            obj.parent = parent
            obj.location = to_blender((x + math.cos(angle) * distance, .16, z + math.sin(angle) * distance * .72))
            scale = .62 + ((piece * 17 + cluster_index * 11) % 5) * .13
            obj.scale = (scale, scale * (.78 + (piece % 3) * .10), scale)
            obj.rotation_euler = (0.0, 0.0, angle + .36)
            tag(
                obj,
                "rooftop.rubble-cluster.shared-mesh",
                pbr_authored=True,
                rubble_cluster=name,
                shared_mesh_seed=seeds.index(obj.data),
                player_readable_dressing=True,
            )
            ensure_uv_layers(obj)


def rooftop_foreground_breaks(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Make two thick, player-scale broken concrete returns at the doorway.

    These are fractured volumes, not screen-facing cards: each has a chipped
    front/back face, edge depth, brick substrate and snapped rebar. They frame
    the central fire view while preserving a broad centre lane from DoorSystem
    exit to Nam-ra's clearing.
    """
    def chunk(name: str, front_z: float, back_z: float, outline: tuple[tuple[float, float], ...]) -> None:
        count = len(outline)
        vertices = [to_blender((x, y, front_z)) for x, y in outline]
        vertices.extend(to_blender((x, y, back_z)) for x, y in outline)
        faces: list[tuple[int, ...]] = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
        for index in range(count):
            next_index = (index + 1) % count
            faces.append((index, next_index, count + next_index, count + index))
        mesh = bpy.data.meshes.new(f"{name}_Mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        mesh.materials.append(mats["concrete"])
        uv = mesh.uv_layers.new(name="UVMap")
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                uv.data[loop_index].uv = (vertex.x * .48, vertex.y * -.48)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        tag(obj, "rooftop.foreground.fractured-concrete", pbr_authored=True, structural_damage=True, player_readable_dressing=True)
        ensure_uv_layers(obj)

    chunk(
        "RooftopDoorwayBreakWest",
        2.42,
        3.34,
        ((-5.82, .08), (-5.82, 2.72), (-5.20, 2.96), (-4.52, 2.18), (-3.92, 1.36), (-3.24, .72), (-2.66, .08)),
    )
    chunk(
        "RooftopDoorwayBreakEast",
        3.08,
        3.98,
        ((2.66, .08), (3.34, .64), (4.08, 1.86), (4.72, 2.72), (5.82, 2.36), (5.82, .08)),
    )
    for index, (x, z, height, lean) in enumerate(((-4.46, 2.58, 1.22, -.26), (-3.52, 2.74, .84, .18), (4.34, 3.26, 1.12, .23), (5.10, 3.48, .72, -.18))):
        rod = cylinder(
            f"RooftopDoorwayRebar_{index}",
            parent,
            (x, .78, z),
            .026,
            height,
            mats["metal"],
            "rooftop.foreground.exposed-rebar",
            rotation=(0.0, 0.0, lean),
        )
        rod.rotation_euler.rotate_axis("Y", .46 if index % 2 else -.34)


def rooftop_night_recovery(parent: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Author the S1-ending roof as a physical night composition.

    This is deliberately a replacement visual language for the rejected flat
    roof survey: one close fire, fractured foreground returns, a damaged
    stair headhouse and a layered cyan horizon.  The haze and mountains sit
    beyond the playable slab; every playable element remains real geometry.
    """
    # A real moon disc and staggered haze strips live past the north parapet,
    # outside both the navigable slab and any parallax-critical near geometry.
    # They provide depth behind the headhouse rather than an unlit black clear
    # color swallowing the roofline.
    cube("RooftopMoonDisc", parent, (6.45, 8.6, 42.0), (4.2, 4.2, .08), mats["moon"], "rooftop.distant-moon", .0, authored_backdrop=True)
    cube("RooftopHazeBand_Far", parent, (0.0, 3.35, 38.0), (31.0, 5.2, .06), mats["sky"], "rooftop.distant-haze", .0, authored_backdrop=True)
    cube("RooftopHazeBand_Near", parent, (-1.4, 2.12, 32.4), (25.0, 2.35, .06), mats["mountain"], "rooftop.distant-haze", .0, authored_backdrop=True)
    mountain_ridge(parent, "RooftopRecoveryRidge_A", 31.8, mats["mountain"], elevation_lift=2.9)
    mountain_ridge(parent, "RooftopRecoveryRidge_B", 35.2, mats["mountain"], elevation_lift=4.15)

    # A low, bombed concrete-and-brick headhouse frames the fire.  Its broken
    # front is formed from thick jagged volumes; no screen-facing wall card or
    # sealed duplicate of the playable DoorSystem portal is used.
    base_z = 28.2
    jagged_wall_fragment(
        "RooftopRecoveryHeadHouse_West", parent, -3.18, -2.54,
        ((.08, base_z - 3.10), (3.62, base_z - 3.10), (3.98, base_z - 2.46), (3.54, base_z - 1.76), (2.88, base_z - 1.10), (1.86, base_z - .92), (.18, base_z - .92)),
        mats["brick"], "rooftop.recovery-headhouse.broken-brick", boolean_wall_break=True,
    )
    jagged_wall_fragment(
        "RooftopRecoveryHeadHouse_East", parent, 2.54, 3.18,
        ((.08, base_z - 3.10), (1.70, base_z - 3.10), (2.36, base_z - 2.30), (3.82, base_z - 1.92), (3.96, base_z - .94), (2.16, base_z - .94), (.16, base_z - 1.52)),
        mats["brick"], "rooftop.recovery-headhouse.broken-brick", boolean_wall_break=True,
    )
    jagged_wall_fragment(
        "RooftopRecoveryHeadHouse_Lintel", parent, -2.54, 2.54,
        ((3.02, base_z - 3.08), (4.14, base_z - 3.08), (4.36, base_z - 2.20), (3.88, base_z - 1.10), (3.32, base_z - .86), (3.04, base_z - 1.64)),
        mats["concrete"], "rooftop.recovery-headhouse.broken-concrete", boolean_wall_break=True,
    )
    # Door assembly is a distinct grey steel leaf, intentionally ajar. It is
    # an adjacent ruined access room at z≈22, never the DoorSystem leaf at
    # the rooftop portal z=0.
    cube("RooftopRecoveryDoorRecess", parent, (0.0, 1.55, base_z - 3.16), (4.32, 3.10, .32), mats["black"], "rooftop.recovery-headhouse.door-void", .0)
    for side in (-1, 1):
        cube(f"RooftopRecoveryDoorJamb_{side}", parent, (side * 2.08, 1.62, base_z - 3.34), (.16, 3.20, .22), mats["metal"], "rooftop.recovery-headhouse.door-jamb", .018)
    cube("RooftopRecoveryDoorHeader", parent, (0.0, 3.10, base_z - 3.34), (4.36, .18, .22), mats["metal"], "rooftop.recovery-headhouse.door-header", .018)
    door_pivot = empty("RooftopRecoveryOpenDoor_Pivot", parent, "rooftop.recovery-headhouse.open-door", visual_state="fixed-open-adjacent-architecture")
    door_pivot.location = to_blender((-1.83, 0.0, base_z - 3.47))
    door_leaf = local_cube("RooftopRecoveryOpenDoor_Leaf", door_pivot, (1.64, 1.48, 0.0), (3.28, 2.96, .12), mats["metal"], "rooftop.recovery-headhouse.open-grey-metal-door", .024)
    for panel_y in (.78, 2.12):
        local_cube(f"RooftopRecoveryDoorPanel_{panel_y:.2f}", door_pivot, (1.64, panel_y, -.075), (2.76, .96, .045), mats["black"], "rooftop.recovery-headhouse.door-inset", .008)
    door_pivot.rotation_euler.rotate_axis("Z", -.94)
    # A roof slab with a chipped overhang gives the headhouse actual depth.
    cube("RooftopRecoveryHeadHouseRoof", parent, (0.0, 4.08, base_z - 1.10), (7.24, .32, 5.10), mats["concrete"], "rooftop.recovery-headhouse.broken-roof-slab", .032)
    cube("RooftopRecoveryHeadHouseCoping", parent, (0.0, 4.34, base_z - 3.04), (7.62, .20, .30), mats["concrete"], "rooftop.recovery-headhouse.coping", .022)
    for index, (x, z, height, lean) in enumerate(((-3.12, base_z - 2.86, 1.34, -.31), (-2.56, base_z - 1.86, .86, .18), (3.18, base_z - 2.66, 1.18, .27), (2.62, base_z - 1.28, .72, -.22))):
        rod = cylinder(f"RooftopRecoveryHeadHouseRebar_{index}", parent, (x, 4.18, z), .032, height, mats["metal"], "rooftop.recovery-headhouse.exposed-rebar")
        rod.rotation_euler.rotate_axis("Y", lean)

    # Build physically layered combustion instead of a single bright cone:
    # charred logs, core and outer flame volumes, ember sparks and smoke puffs
    # share one campfire landmark so the warm practical is the only key light.
    fire_z = 11.82
    for index, (x, z, length, angle) in enumerate(((-.48, fire_z - .32, 1.78, .88), (.62, fire_z + .24, 1.62, -1.03), (.18, fire_z + .58, 1.44, .28))):
        log = cylinder(f"RooftopRecoveryFireLog_{index}", parent, (x, .34, z), .14, length, mats["wood"], "rooftop.fire.charred-log")
        log.rotation_euler = (math.pi / 2, 0.0, angle)
    for index, (x, y, z, radius, height) in enumerate(((.06, .78, fire_z, .42, 1.92), (-.28, .62, fire_z + .22, .28, 1.38), (.34, .60, fire_z - .18, .24, 1.18))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=to_blender((x, y, z)))
        flame = bpy.context.object
        flame.name = f"RooftopRecoveryFlameLayer_{index}"
        flame.dimensions = size_to_blender((radius * 1.18, height, radius))
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        flame.data.materials.append(mats["ember"])
        flame.parent = parent
        tag(flame, "rooftop.fire.flame-layer", pbr_authored=True, volumetric_layer=True)
        ensure_uv_layers(flame)
    for index, (x, y, z, scale) in enumerate(((-.18, 1.96, fire_z + .10, .42), (.18, 2.42, fire_z + .42, .54), (-.02, 2.96, fire_z + .16, .68))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=scale, location=to_blender((x, y, z)))
        smoke = bpy.context.object
        smoke.name = f"RooftopRecoverySmokeVolume_{index}"
        smoke.scale = (.82, 1.34, .82)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        smoke.data.materials.append(mats["ash"])
        smoke.parent = parent
        tag(smoke, "rooftop.fire.smoke-volume", pbr_authored=True, volumetric_layer=True)
        ensure_uv_layers(smoke)
    for index, (x, y, z) in enumerate(((-.52, 1.18, fire_z - .22), (.28, 1.46, fire_z + .14), (.62, 1.82, fire_z + .42), (-.16, 2.16, fire_z + .56), (.16, 2.68, fire_z - .12))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.042, location=to_blender((x, y, z)))
        ember = bpy.context.object
        ember.name = f"RooftopRecoveryEmber_{index}"
        ember.data.materials.append(mats["ember"])
        ember.parent = parent
        tag(ember, "rooftop.fire.ember", pbr_authored=True, moving_layer=False)
        ensure_uv_layers(ember)


def opening_reference_meshes() -> dict[str, bpy.types.Object]:
    """Load selected approved opening construction modules once per build.

    The corridor is an extension of the approved cold-open, not a second
    primitive corridor.  These meshes retain the opening's wired glass,
    recessed door, rust, damage and physical material decisions.  They are
    source data only; the exported route has no dependency on the monolithic
    opening scene at runtime.
    """
    global OPENING_REFERENCE_MESHES
    if OPENING_REFERENCE_MESHES is not None:
        return OPENING_REFERENCE_MESHES
    if not OPENING_SOURCE_BLEND.exists():
        raise RuntimeError(f"Missing approved opening source: {OPENING_SOURCE_BLEND}")
    prefixes = tuple(
        [
            *(f"FirstBay_{kind}_{index}_" for kind in ("Window", "ClassroomDoor") for index in range(3)),
            "FirstBay_OverturnedDesk_A_",
            "FirstBay_OverturnedDesk_B_",
            "FirstBay_OverturnedDesk_Foreground_",
            "FirstBay_Chair_A_",
            "FirstBay_Chair_Foreground_",
            "FirstBay_Rubble_",
            "FirstBay_CeilingSkeleton",
            "FirstBay_CeilingBeam_",
            "FirstBay_SagFixture",
            "FirstBay_SagFixtureCable",
            "FirstBay_SaggingCeilingBeam",
            # These proven opening assets are the structural/damage language
            # used to extend the first playable corridor; they remain source
            # only and are flattened into this zone-local delivery.
            "StartRoom_CeilingBeam_",
            "StartRoom_FloorCollapseSlab_",
            "StartRoom_BreachOriginSlab",
            "StartRoom_BreachOriginRubble_",
            "StartRoom_CollapseMicroDebris_",
            "StartRoom_PaperDebris_",
            "StartRoom_ForegroundFallenFrame",
            "StartRoom_CollapseDust",
        ]
    )
    with bpy.data.libraries.load(str(OPENING_SOURCE_BLEND), link=False) as (source, loaded):
        loaded.objects = [name for name in source.objects if name.startswith(prefixes)]
        # Wall/ceiling finish meshes are procedurally split around live portal
        # clearances below, so load their exact source materials explicitly
        # instead of importing a continuous wall that could close a detour.
        required_materials = {"School_UpperPaint", "School_PaintedLower", "Damaged_AcousticCeiling", "Door_RustedMetal", "Smoked_Aluminium", "Concrete_Debris", "Charred_Plaster", "Damage_Decal_Atlas", "Worn_Wood", "Wired_Glass"}
        loaded.materials = [name for name in source.materials if name in required_materials]
    for obj in loaded.objects:
        if obj is not None:
            bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.update()
    result: dict[str, bpy.types.Object] = {}
    for obj in loaded.objects:
        if obj is None or obj.type != "MESH":
            continue
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.select_set(False)
        ensure_uv_layers(obj)
        obj.hide_render = True
        obj.hide_viewport = True
        result[obj.name] = obj
    # The source containers are not renderable reference geometry.  Removing
    # them leaves only flattened mesh templates, which are never selected by
    # route export unless copied into a zone instance below.
    for obj in loaded.objects:
        if obj is not None and obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    OPENING_REFERENCE_MESHES = result
    return result


def opening_module(
    parent: bpy.types.Object,
    prefix: str,
    source_prefix: str,
    world_z_offset: float,
    mats: dict[str, bpy.types.Material],
    mirror_x: bool = False,
) -> None:
    """Clone one approved opening window/door construction at a route offset."""
    templates = [obj for name, obj in opening_reference_meshes().items() if name.startswith(source_prefix)]
    if not templates:
        raise RuntimeError(f"Missing opening construction module: {source_prefix}")
    instance = empty(
        f"{prefix}_Instance",
        parent,
        "route.opening-module",
        authored_opening_source=str(OPENING_SOURCE_BLEND.relative_to(REPO_ROOT)),
        source_module=source_prefix.rstrip("_"),
        source_runtime_role="dcc-source-only-zone-local-delivery",
    )
    offset = Vector(to_blender((0, 0, world_z_offset)))
    for template in templates:
        obj = template.copy()
        obj.data = template.data
        bpy.context.collection.objects.link(obj)
        obj.hide_render = False
        obj.hide_viewport = False
        obj.parent = instance
        obj.matrix_parent_inverse.identity()
        obj.location = template.location + offset - parent.location
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)
        if mirror_x:
            # Classroom construction is authored on the opening's right wall.
            # Mirror the actual mesh assembly (not a substitute plane) for
            # the continuation's left bays. glTF preserves negative local
            # scale and keeps closed doors, glass and break edges aligned.
            obj.location.x *= -1
            obj.scale.x = -1.0
        obj.name = f"{prefix}_{template.name.removeprefix(source_prefix)}"
        semantic = str(template.get("semantic_id", "architecture.hyosan.opening-module"))
        if "Glass" in template.name or "Transom" in template.name:
            obj.data.materials.clear()
            obj.data.materials.append(mats["window"])
        tag(
            obj,
            semantic,
            authored_opening_source=str(OPENING_SOURCE_BLEND.relative_to(REPO_ROOT)),
            source_module=source_prefix.rstrip("_"),
            mirrored_from_opening=mirror_x,
            pbr_authored=True,
        )


def approved_opening_material(name: str) -> bpy.types.Material:
    """Return a material embedded in the approved cold-open source.

    These are intentionally shared rather than approximated with a tinted
    generic map: the corridor continuation needs the same paint, damaged
    acoustic ceiling and rust response as its authored opening neighbour.
    The material has already been loaded by ``opening_reference_meshes`` and
    remains baked into each zone-local GLB at export time.
    """
    opening_reference_meshes()
    material = bpy.data.materials.get(name)
    if material is None:
        raise RuntimeError(f"Missing approved opening material: {name}")
    return material


def opening_dressing_module(
    parent: bpy.types.Object,
    prefix: str,
    source_prefix: str,
    local_location: tuple[float, float, float],
) -> None:
    """Recompose a distinct opening-set prop near a player-readable beat.

    The construction retains the original PBR materials, mesh topology and
    non-generic silhouette. We reposition the flattened source group around
    its own centre, then emit it into this one streamed corridor GLB.
    """
    templates = [obj for name, obj in opening_reference_meshes().items() if name.startswith(source_prefix)]
    if not templates:
        raise RuntimeError(f"Missing approved opening dressing module: {source_prefix}")
    source_center = sum((obj.location for obj in templates), Vector()) / len(templates)
    instance = empty(
        f"{prefix}_Instance",
        parent,
        "route.opening-dressing",
        authored_opening_source=str(OPENING_SOURCE_BLEND.relative_to(REPO_ROOT)),
        source_module=source_prefix.rstrip("_"),
        source_runtime_role="dcc-source-only-zone-local-delivery",
    )
    for template in templates:
        obj = template.copy()
        obj.data = template.data
        bpy.context.collection.objects.link(obj)
        obj.hide_render = False
        obj.hide_viewport = False
        obj.parent = instance
        obj.matrix_parent_inverse.identity()
        obj.location = template.location - source_center + Vector(to_blender(local_location))
        # Dressing groups include pre-authored topple/sag transforms. The old
        # reset-to-identity path turned those source slabs and fallen frames
        # into impossible vertical cards in the streamed corridor.
        obj.rotation_mode = template.rotation_mode
        obj.rotation_euler = template.rotation_euler.copy()
        obj.scale = template.scale.copy()
        obj.name = f"{prefix}_{template.name.removeprefix(source_prefix)}"
        tag(
            obj,
            str(template.get("semantic_id", "architecture.hyosan.opening-dressing")),
            authored_opening_source=str(OPENING_SOURCE_BLEND.relative_to(REPO_ROOT)),
            source_module=source_prefix.rstrip("_"),
            pbr_authored=True,
            player_readable_dressing=True,
        )


def replace_material(obj: bpy.types.Object, material: bpy.types.Material, *, remap_uvs: bool = False) -> None:
    if obj.type != "MESH":
        return
    obj.data.materials.clear()
    obj.data.materials.append(material)
    ensure_uv_layers(obj)
    if remap_uvs:
        tile_primary_uvs(obj, material)


def finish_wall_segments(
    root: bpy.types.Object,
    prefix: str,
    side: float,
    length: float,
    half_width: float,
    upper: bpy.types.Material,
    lower: bpy.types.Material,
    breaches: tuple[tuple[str, float, float, tuple[float, float, float, float]], ...],
) -> None:
    """Add a layered, source-authored corridor wall face around portal voids.

    The shell remains a structural 18cm wall, while these two thin skins carry
    the approved upper/lower painted-plaster material split, baseboard and
    actual jamb members.  Splitting both skins around a portal means a visual
    wall can never silently close a simulation detour.
    """
    cursor = 0.0
    for index, (_portal_id, center_z, width, _clearance) in enumerate(sorted(breaches, key=lambda breach: breach[1])):
        start = max(0.0, center_z - width / 2)
        end = min(length, center_z + width / 2)
        if start > cursor:
            segment_center = (cursor + start) / 2
            segment_length = start - cursor
            cube(f"{prefix}_Upper_{index}", root, (side * (half_width - .095), 2.56, segment_center), (.045, 2.35, segment_length), upper, f"{prefix}.painted-upper", .006, source_material="approved-opening")
            cube(f"{prefix}_Lower_{index}", root, (side * (half_width - .102), .67, segment_center), (.052, 1.26, segment_length), lower, f"{prefix}.painted-lower", .006, source_material="approved-opening")
            cube(f"{prefix}_Baseboard_{index}", root, (side * (half_width - .13), .14, segment_center), (.075, .18, segment_length), approved_opening_material("Door_RustedMetal"), f"{prefix}.baseboard", .004, source_material="approved-opening")
        # A real jamb frames the existing breach without filling the portal
        # clearance. This gives both detours a visual cut edge from either
        # side rather than an anchor floating in a continuous wall.
        # Keep the jamb's inner edge outside the validator's actual playable
        # volume; a frame that protrudes even centimetres into this interval
        # is still a visual mesh that would contradict a passable portal.
        for jamb_index, jamb_z in enumerate((start - .08, end + .08)):
            cube(f"{prefix}_Jamb_{index}_{jamb_index}", root, (side * (half_width - .12), 1.48, jamb_z), (.10, 2.92, .13), approved_opening_material("Door_RustedMetal"), f"{prefix}.portal-jamb", .012, source_material="approved-opening")
        cursor = end
    if cursor < length:
        index = len(breaches)
        segment_center = (cursor + length) / 2
        segment_length = length - cursor
        cube(f"{prefix}_Upper_{index}", root, (side * (half_width - .095), 2.56, segment_center), (.045, 2.35, segment_length), upper, f"{prefix}.painted-upper", .006, source_material="approved-opening")
        cube(f"{prefix}_Lower_{index}", root, (side * (half_width - .102), .67, segment_center), (.052, 1.26, segment_length), lower, f"{prefix}.painted-lower", .006, source_material="approved-opening")
        cube(f"{prefix}_Baseboard_{index}", root, (side * (half_width - .13), .14, segment_center), (.075, .18, segment_length), approved_opening_material("Door_RustedMetal"), f"{prefix}.baseboard", .004, source_material="approved-opening")


def corridor_authored_finish(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Carry the cold-open construction language through the streamed route."""
    upper = approved_opening_material("School_UpperPaint")
    lower = approved_opening_material("School_PaintedLower")
    for obj in root.children_recursive:
        semantic = str(obj.get("semantic_id", ""))
        if semantic == "Corridor.floor":
            # The wall-derived painted-concrete atlas aliases into broad
            # horizontal bands at the 62-degree player camera.  Retain the
            # corridor base's correctly scaled dirty-floor PBR instead.  It
            # is the same authored UV0 that the shell received at creation,
            # so this changes material class without stretching or remapping
            # the 43m slab.
            replace_material(obj, mats["floor_base"])
        elif semantic == "Corridor.ceiling":
            # The source acoustic-ceiling export evaluated nearly black in
            # the delivery renderer, erasing the actual ceiling depth between
            # every fixture. Use the already-shipped weathered concrete PBR
            # for the structural substrate, while retaining the approved
            # opening paint on the wall skins. This exposes ceiling depth and
            # damage rhythm without another texture payload.
            replace_material(obj, mats["acoustic"])
        elif semantic == "Corridor.wall-left":
            # The legacy charred-plaster backing made the left side render as
            # an unreadable black plane. The source finish below is layered on
            # top; this backing still supplies true wall thickness.
            replace_material(obj, upper)
    finish_wall_segments(
        root,
        "CorridorLeftFinish",
        -1,
        43.0,
        3.0,
        upper,
        lower,
        (("portal.broadcast", 18.65, 9.6, (-4.52, 37.9, -2.48, 47.4)),),
    )
    finish_wall_segments(
        root,
        "CorridorRightFinish",
        1,
        43.0,
        3.0,
        upper,
        lower,
        (("portal.infirmary", 8.05, 4.0, (2.48, 30.1, 4.52, 34.0)),),
    )
    # Reuse the opening's slim steel ceiling rhythm at irregular positions;
    # one intentionally sagging member prevents a repeated game-kit pattern.
    rust = approved_opening_material("Smoked_Aluminium")
    for index, local_z in enumerate((3.4, 9.1, 15.8, 23.7, 30.9, 38.4)):
        cube(f"CorridorServiceBeam_{index}", root, (0, 3.52, local_z), (5.72, .085, .10), rust, "corridor.ceiling-service-beam", .004, source_material="approved-opening")
    cube("CorridorSaggingConduit", root, (-.35, 3.12, 18.8), (.07, .06, 5.1), rust, "corridor.damaged-ceiling-conduit", .005, source_material="approved-opening")
    # These recessed, varied-length fixtures break the former uninterrupted
    # black ceiling. They sit below the shell (rather than replacing it), so
    # the actual ceiling depth and collider contract remain intact. Alternate
    # dead and dim tubes preserve the damaged-corridor rhythm without creating
    # a bright ambient wash over the whole route.
    for index, (local_z, width, live) in enumerate(((2.25, 1.42, True), (8.85, 1.16, True), (16.35, 1.46, False), (25.65, 1.30, True), (39.35, 1.52, True))):
        cube(f"CorridorFluorescentHousing_{index}", root, (0, 3.67, local_z), (width + .22, .11, .48), rust, "corridor.fluorescent-housing", .012, source_material="approved-opening")
        lens_material = mats["fluorescent"] if live else mats["glass"]
        cube(f"CorridorFluorescentLens_{index}", root, (0, 3.61, local_z), (width, .035, .27), lens_material, "corridor.fluorescent-lens", .006, source_material="approved-opening", damaged=not live)


def corridor_suspended_ceiling_recovery(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Build a player-readable damaged suspended ceiling at the entry beat.

    The old shell was structurally valid, but its uninterrupted dark underside
    left the strict first-bay view looking out into blackness. These are real
    inset acoustic panels, perimeter T-runners and a few displaced panels,
    arranged only in the initial player sightline. They share the approved
    route PBR response and the opening's metal runner language; they are not
    review-only lighting cards or a repeating whole-route prefab.
    """
    runner = approved_opening_material("Smoked_Aluminium")
    # Keep only three displaced, thick ceiling islands in the player-facing
    # first 12m.  A full T-runner grid made even real panels read as thin,
    # parallel game-kit plates; the structural shell above remains intact.
    panel_rows = (
        (2.15, (-1,)),
        (6.42, (1,)),
        (10.18, (0,)),
    )
    for row, (z, slots) in enumerate(panel_rows):
        # The missing slots are deliberate collapse gaps: metal runners and
        # sagging wires remain visible through them rather than a black plane.
        for slot in slots:
            x = slot * 1.68
            cube(
                f"CorridorAcousticPanel_{row}_{slot}",
                root,
                (x, 3.38, z),
                (1.56, .16, 1.52),
                mats["acoustic"],
                "corridor.suspended-ceiling.acoustic-panel",
                .010,
                source_material="approved-opening-suspended-ceiling-language",
                damaged=row in {2, 3, 7},
            )
        for x in (-2.48, 2.48):
            cube(
                f"CorridorCeilingCrossRunner_{row}_{x:+.2f}",
                root,
                (x, 3.31, z + .77),
                (.045, .075, 1.60),
                runner,
                "corridor.suspended-ceiling.cross-runner",
                .004,
                source_material="approved-opening",
            )
    for index, x in enumerate((-2.48, 2.48)):
        cube(
            f"CorridorCeilingMainRunner_{index}",
            root,
            (x, 3.31, 6.18),
            (.052, .076, 10.40),
            runner,
            "corridor.suspended-ceiling.main-runner",
            .004,
            source_material="approved-opening",
        )
    # Bent runners and hanging fragments make the damaged pattern legible at
    # normal eye height. All pieces stay above the player capsule and clear of
    # the infirmary/broadcast side portal intervals.
    # A close soffit band is a real low suspended section at the doorway;
    # it removes the remaining near-camera black void without faking ambient
    # illumination or flattening the full 43m corridor.
    cube(
        "CorridorEntrySoffitBand",
        root,
        (0.0, 3.35, .62),
        (5.52, .20, 1.20),
        mats["acoustic"],
        "corridor.suspended-ceiling.entry-soffit",
        .012,
        source_material="approved-opening-suspended-ceiling-language",
    )
    for index, (x, y, z, angle) in enumerate(((-.46, 3.04, 4.70, -.22), (1.24, 3.09, 8.12, .17))):
        fragment = cube(
            f"CorridorCeilingDisplacedPanel_{index}",
            root,
            (x, y, z),
            (1.12, .14, .74),
            mats["acoustic"],
            "corridor.suspended-ceiling.displaced-panel",
            .010,
            source_material="approved-opening-suspended-ceiling-language",
            collapsed=True,
        )
        fragment.rotation_euler.rotate_axis("Y", angle)
    for index, (x, z, length) in enumerate(((-2.22, 2.52, .58), (2.12, 5.96, .72), (-1.62, 10.36, .64))):
        cable = cylinder(
            f"CorridorCeilingDropWire_{index}",
            root,
            (x, 3.09, z),
            .015,
            length,
            runner,
            "corridor.suspended-ceiling.drop-wire",
        )
        cable.rotation_euler.rotate_axis("X", math.pi / 2)


def corridor_irregular_wall_failure(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Replace one intact left-wall bay with a deep, broken-plaster failure.

    The opening source uses irregular plaster lips over a recessed brick core.
    Repeating that construction here, rather than attaching rectangular brick
    cards to an opaque wall, produces a true world-space void, substrate and
    thickness without changing the authoritative corridor lane or detours.
    """
    # The first left wall run is 0..13.85m before the broadcast breach.  Its
    # existing opaque cuboid and thin painted skins must be removed together;
    # leaving any of them in place would occlude the recessed geometry.
    replace_names = {
        "Corridor_Wall_L_0",
        "CorridorLeftFinish_Upper_0",
        "CorridorLeftFinish_Lower_0",
        "CorridorLeftFinish_Baseboard_0",
    }
    for child in list(root.children_recursive):
        if child.name in replace_names:
            bpy.data.objects.remove(child, do_unlink=True)

    upper = approved_opening_material("School_UpperPaint")
    lower = approved_opening_material("School_PaintedLower")
    rust = approved_opening_material("Door_RustedMetal")
    # Keep the failure local to one first-bay reveal. The former 4.5m-wide
    # floor-to-ceiling cut read as an unbroken stock brick wall, rather than a
    # believable failure within a painted school partition.
    damage_start, damage_end, original_end = 4.68, 7.10, 13.85

    def restore_segment(prefix: str, start: float, end: float) -> None:
        if end <= start:
            return
        center, length = (start + end) / 2, end - start
        cube(f"{prefix}_Structural", root, (-3.0, 1.9, center), (.18, 3.8, length), mats["wall"], "Corridor.wall-left", .018)
        cube(f"{prefix}_Upper", root, (-2.905, 2.56, center), (.045, 2.35, length), upper, "corridor.damage-adjacent-painted-upper", .006, source_material="approved-opening")
        cube(f"{prefix}_Lower", root, (-2.898, .67, center), (.052, 1.26, length), lower, "corridor.damage-adjacent-painted-lower", .006, source_material="approved-opening")
        cube(f"{prefix}_Baseboard", root, (-2.87, .14, center), (.075, .18, length), rust, "corridor.damage-adjacent-baseboard", .004, source_material="approved-opening")

    restore_segment("CorridorFailureLead", 0.0, damage_start)
    restore_segment("CorridorFailureTail", damage_end, original_end)

    # The dark, broken brick core sits 12cm behind the interior wall finish.
    # It is a thick irregular mesh, not a transparent decal or planar texture.
    core_outline = (
        (.82, 5.10), (1.10, 4.86), (1.74, 5.02), (2.32, 4.90),
        (2.76, 5.22), (3.14, 5.84), (2.96, 6.42), (3.20, 6.84),
        (2.62, 7.02), (1.96, 6.86), (1.26, 7.05), (.80, 6.76),
        (.64, 6.18), (.86, 5.64),
    )
    jagged_wall_fragment(
        "CorridorBrokenBrickSubstrate",
        root,
        -3.03,
        -3.15,
        core_outline,
        mats["brick"],
        "corridor.damage.recessed-broken-brick-substrate",
        recessed_depth_m=.12,
        source_material="Poly Haven CC0 broken-brickwall",
    )

    # Plaster lips overlap the core by a few centimetres and have visibly
    # different tears. Their depth and edge surfaces catch the hand-light at
    # player height, which is the construction cue a flat atlas cannot supply.
    lips = (
        ("Top", upper, ((3.10, 4.72), (3.42, 4.92), (3.24, 5.48), (3.43, 6.12), (3.20, 6.72), (3.48, 7.16), (3.80, 7.16), (3.80, 4.72))),
        ("Bottom", lower, ((.30, 4.72), (.76, 5.10), (.58, 5.64), (.78, 6.18), (.54, 6.72), (.82, 7.16), (.30, 7.16))),
        ("Near", upper, ((.30, 4.70), (3.80, 4.70), (3.54, 5.02), (2.90, 4.88), (2.26, 5.06), (1.54, 4.88), (.86, 5.08), (.30, 4.70))),
        ("Far", upper, ((.32, 6.76), (.78, 7.10), (1.50, 6.92), (2.16, 7.12), (2.82, 6.90), (3.40, 7.15), (3.72, 7.15), (.34, 7.15))),
    )
    for name, material, outline in lips:
        fragment = jagged_wall_fragment(
            f"CorridorBrokenPlasterLip_{name}",
            root,
            -2.875,
            -3.055,
            outline,
            material,
            "corridor.damage.broken-plaster-lip",
            source_material="approved-opening",
        )
        bevel(fragment, .012)

    # A few separately bevelled bricks and snapped reinforcing bars give the
    # substrate parallax and structural cause, without a regular mini-brick
    # grid or anything that intrudes into a portal clearance.
    for index, (height, local_z, width) in enumerate(((.96, 5.26, .42), (1.34, 5.82, .34), (1.72, 5.34, .40), (2.04, 6.68, .46), (2.40, 6.04, .36), (2.76, 6.44, .40))):
        cube(f"CorridorBrokenBrickCourse_{index}", root, (-2.982, height, local_z), (.105, .22, width), mats["brick"], "corridor.damage.recessed-brick-course", .014, recessed_depth_m=.07)
    for index, (height, local_z, lean) in enumerate(((1.24, 5.06, -.18), (2.28, 6.88, .13), (2.90, 5.52, -.09))):
        rod = cylinder(f"CorridorFailureRebar_{index}", root, (-2.90, height, local_z), .021, .96, rust, "corridor.damage.exposed-rebar", rotation=(0.0, 0.0, lean))
        rod.rotation_euler.rotate_axis("Y", .22 * (index - 1))


def corridor_right_wall_break(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Cut an immediate, full-depth right-wall failure before the infirmary.

    Unlike a brick card laid onto a wall, the structural section uses a
    Blender Boolean difference before its irregular lips and substrate are
    added. The final delivery therefore has an actual empty wall volume behind
    the player-readable fracture, while its extent remains clear of the
    authoritative infirmary breach beginning at local-z=6.05.
    """
    for child in list(root.children_recursive):
        if child.name in {"Corridor_Wall_R_0", "CorridorRightFinish_Upper_0", "CorridorRightFinish_Lower_0", "CorridorRightFinish_Baseboard_0"}:
            bpy.data.objects.remove(child, do_unlink=True)
    upper = approved_opening_material("School_UpperPaint")
    lower = approved_opening_material("School_PaintedLower")
    rust = approved_opening_material("Door_RustedMetal")
    wall = cube("CorridorRightBreakStructural", root, (3.0, 1.9, 3.01), (.18, 3.8, 6.02), mats["wall"], "corridor.damage.right-structural-wall", .0)
    bpy.ops.mesh.primitive_cube_add(size=1, location=to_blender((3.0, 1.82, 3.18)))
    cutter = bpy.context.object
    cutter.name = "CorridorRightBreakBooleanCutter"
    cutter.dimensions = size_to_blender((.46, 2.92, 2.24))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = wall.modifiers.new("ActualWallBreakDifference", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.solver = "EXACT"
    modifier.object = cutter
    bpy.context.view_layer.objects.active = wall
    wall.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    wall.select_set(False)
    bpy.data.objects.remove(cutter, do_unlink=True)
    bevel(wall, .016)
    tag(wall, "corridor.damage.right-structural-wall", pbr_authored=True, structural_damage=True, boolean_wall_break=True)

    # Rebuild the finished skins as short real segments around the void.
    for prefix, start, end in (("Lead", .0, 2.02), ("Tail", 4.34, 6.02)):
        center, length = (start + end) / 2, end - start
        cube(f"CorridorRightBreak{prefix}Upper", root, (2.905, 2.56, center), (.045, 2.35, length), upper, "corridor.damage.right-painted-upper", .006, source_material="approved-opening")
        cube(f"CorridorRightBreak{prefix}Lower", root, (2.898, .67, center), (.052, 1.26, length), lower, "corridor.damage.right-painted-lower", .006, source_material="approved-opening")
        cube(f"CorridorRightBreak{prefix}Baseboard", root, (2.87, .14, center), (.075, .18, length), rust, "corridor.damage.right-baseboard", .004, source_material="approved-opening")

    outline = ((.40, 2.02), (.78, 2.26), (1.30, 2.08), (1.92, 2.34), (2.54, 2.16), (2.94, 2.48), (3.22, 3.12), (3.00, 3.84), (2.48, 4.18), (1.76, 4.06), (1.16, 4.30), (.56, 4.02), (.32, 3.42), (.52, 2.82))
    jagged_wall_fragment(
        "CorridorRightBrokenBrickSubstrate",
        root,
        3.03,
        3.17,
        outline,
        mats["brick"],
        "corridor.damage.right-recessed-broken-brick-substrate",
        recessed_depth_m=.14,
        source_material="Poly Haven CC0 broken-brickwall",
        boolean_wall_break=True,
    )
    lips = (
        ("Top", upper, ((.26, 3.98), (.60, 4.24), (1.32, 4.12), (1.96, 4.34), (2.60, 4.10), (3.34, 4.24), (3.72, 4.24), (3.72, 3.92))),
        ("Bottom", lower, ((.26, 2.00), (3.72, 2.00), (3.42, 2.28), (2.76, 2.12), (2.12, 2.34), (1.38, 2.14), (.72, 2.32), (.26, 2.00))),
        ("Near", upper, ((.26, 2.00), (.72, 2.30), (.54, 2.88), (.74, 3.40), (.48, 3.90), (.26, 4.24))),
        ("Far", upper, ((3.72, 2.00), (3.34, 2.48), (3.56, 3.06), (3.30, 3.64), (3.72, 4.24))),
    )
    for name, material, lip_outline in lips:
        fragment = jagged_wall_fragment(
            f"CorridorRightBrokenPlasterLip_{name}",
            root,
            2.872,
            3.06,
            lip_outline,
            material,
            "corridor.damage.right-broken-plaster-lip",
            source_material="approved-opening",
            boolean_wall_break=True,
        )
        bevel(fragment, .012)
    for index, (height, local_z, lean) in enumerate(((1.18, 2.48, .18), (2.08, 3.76, -.13), (2.82, 2.92, .10))):
        rod = cylinder(f"CorridorRightFailureRebar_{index}", root, (2.92, height, local_z), .021, .98, rust, "corridor.damage.right-exposed-rebar", rotation=(0.0, 0.0, lean))
        rod.rotation_euler.rotate_axis("Y", -.22 * (index - 1))


def corridor_polyhaven_anchors(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Use authored fixture/safety/electrical silhouettes at first contact."""
    # Replace the temporary cuboid housings with the source's individual tube,
    # cap and bracket topology. Service beams remain because they support the
    # fixture rhythm structurally rather than being a visual duplicate.
    for child in list(root.children_recursive):
        if child.name.startswith("CorridorFluorescentHousing_") or child.name.startswith("CorridorFluorescentLens_"):
            bpy.data.objects.remove(child, do_unlink=True)
    for index, local_z in enumerate((2.32, 8.92, 16.42, 25.72)):
        authored_polyhaven_detail(
            root,
            "mounted_fluorescent_lights",
            f"CorridorMountedFluorescent_{index}",
            (0.0, 3.57, local_z),
            mats["fluorescent"] if index != 2 else mats["glass"],
            "corridor.polyhaven-mounted-fluorescent.mesh",
            1.62,
        )
    # A fallen housing turns the ceiling failure into a player-readable story
    # beat at the first 6–10m of the lane, rather than four pristine repeated
    # fixtures floating overhead. It rests beside the left wall and stays out
    # of the center traversal line.
    authored_polyhaven_detail(
        root,
        "mounted_fluorescent_lights",
        "CorridorFallenFluorescent",
        (-2.12, .18, 7.26),
        mats["glass"],
        "corridor.polyhaven-fallen-fluorescent.mesh",
        .92,
        rotation=(0.0, .58, -.16),
    )
    # Three further real housings hang at visibly different heights/angles in
    # the first sightline. Their wires are authored below; this avoids a
    # repeated, perfectly flush ceiling-grid read in the strict player view.
    for index, (x, y, z, angle) in enumerate(((-.78, 2.78, 3.62, -.19), (1.18, 2.58, 6.52, .23), (-.32, 2.66, 9.74, -.27))):
        authored_polyhaven_detail(
            root,
            "mounted_fluorescent_lights",
            f"CorridorHangingFluorescent_{index}",
            (x, y, z),
            mats["fluorescent"] if index != 1 else mats["glass"],
            "corridor.polyhaven-hanging-fluorescent.mesh",
            1.18,
            rotation=(0.0, .18 * (index - 1), angle),
        )
        wire = cylinder(
            f"CorridorHangingFluorescentWire_{index}",
            root,
            (x, (y + 3.38) / 2, z),
            .014,
            max(.48, 3.38 - y),
            approved_opening_material("Smoked_Aluminium"),
            "corridor.hanging-fluorescent.support-wire",
        )
        wire.rotation_euler.rotate_axis("X", math.pi / 2)
    # Both wall-mounted elements are deliberately close to the first camera
    # beat. They break the former endless painted-plane read without creating
    # another procedural furniture language or touching the detour volumes.
    authored_polyhaven_detail(
        root,
        "korean_fire_extinguisher_01",
        "CorridorFireExtinguisher",
        # Stay before the infirmary's world-z=30.1 portal clearance. A real
        # wall prop is still a blocker even when it is visually small.
        (2.74, 1.10, 2.18),
        mats["safety_red"],
        "corridor.polyhaven-fire-extinguisher.mesh",
        1.0,
    )
    authored_polyhaven_detail(
        root,
        "utility_box_01",
        "CorridorUtilityBox",
        (-2.76, 1.62, 10.85),
        mats["metal"],
        "corridor.polyhaven-utility-box.mesh",
        .90,
    )
    # First contact needs furniture that reads as a damaged school at hand
    # light distance. These are art-directed as an overturned-study cluster,
    # not repeated down the full lane: the far route is streamed later and
    # retains the opening-source dressing instead of becoming a stock kit.
    authored_polyhaven_detail(
        root,
        "SchoolDesk_01",
        "CorridorHeroDesk_Near",
        (-1.42, .02, 3.92),
        mats["wood"],
        "corridor.polyhaven-school-desk.mesh",
        .95,
    )
    authored_polyhaven_detail(
        root,
        "SchoolDesk_01",
        "CorridorHeroDesk_Far",
        (1.64, .02, 7.34),
        mats["wood"],
        "corridor.polyhaven-school-desk.mesh",
        .89,
    )
    for index, (x, z, scale, rotation) in enumerate(((-.78, 4.92, .91, (0.0, .16, -.12)), (1.15, 6.42, .88, (0.0, -.24, .18)), (-1.88, 8.06, .82, (0.0, .32, -.22)), (2.12, 3.18, .86, (0.0, -.20, .34)))):
        authored_polyhaven_detail(
            root,
            "SchoolChair_01",
            f"CorridorHeroChair_{index}",
            (x, .02, z),
            mats["metal"],
            "corridor.polyhaven-school-chair.mesh",
            scale,
            rotation=rotation,
        )


def corridor_opening_damage_reuse(root: bpy.types.Object) -> None:
    """Recompose the approved opening's real collapse vocabulary in corridor."""
    # These are source mesh groups, not new procedural rubble. Their bespoke
    # outlines, bevels, material stacks and dust placement were already
    # approved in the opening source; each is re-centred in a lane-safe edge
    # location and emitted inside the corridor's own GLB.
    # Pull three thick source-authored collapse groups into the actual first
    # player view rather than leaving every high-detail break at the far end
    # of the review frame.  The two side clusters preserve a clear centre and
    # remain before the right-hand infirmary portal interval.
    opening_dressing_module(root, "CorridorSourceCollapseSlabs", "StartRoom_FloorCollapseSlab_", (1.54, .05, 3.38))
    opening_dressing_module(root, "CorridorSourceBreachSlab", "StartRoom_BreachOriginSlab", (-1.66, .05, 9.52))
    opening_dressing_module(root, "CorridorSourceBreachRubble", "StartRoom_BreachOriginRubble_", (-1.66, .05, 9.52))
    opening_dressing_module(root, "CorridorSourceMicroDebris", "StartRoom_CollapseMicroDebris_", (-1.66, .05, 9.52))


def corridor_depth_recovery(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Give the first player view real exterior depth and grounded damage.

    These exterior wing returns are 0.8–1.3m beyond the window line, so a
    player sees parallax-ready masonry and real sill thickness instead of a
    flat clear-color void.  No cyan weather card is installed in an opening:
    the visible exterior is entirely thick, broken school geometry.
    """
    # Non-playable exterior wings behind the broken/right window rhythm.
    # Their staggered depth is intentional: a single straight blue wall made
    # the corridor read like a theatre card at first-person height.
    # The nearest east exterior wing stops before the infirmary breach
    # (local-z 6.1..10.0). Weather remains visible at first contact without
    # placing even a transparent haze card inside the portal clearance.
    for index, (x, z, length, depth) in enumerate(((3.64, 3.30, 4.8, .44), (3.94, 12.15, 5.4, .56), (-3.68, 7.42, 7.0, .42))):
        side = 1.0 if x > 0 else -1.0
        # The backing wall is 1.4–1.6m beyond the shell, not immediately at
        # the opening. Its two orthogonal returns create a genuine classroom
        # recess and parallax rather than an opaque cyan/black cap.
        back_x = x + side * 1.12
        cube(f"CorridorExteriorBackWall_{index}", root, (back_x, 2.06, z), (.26, 4.12, length), mats["brick"], "corridor.exterior-deep-brick-back-wall", .028, pbr_authored=True, recess_depth_m=1.42)
        return_offsets = (-length * .26, length * .23)
        # The second exterior wing starts beyond the infirmary opening. Its
        # near return must remain outside the authoritative portal interval.
        if index == 1:
            return_offsets = (length * .23,)
        for return_index, offset in enumerate(return_offsets):
            cube(
                f"CorridorExteriorMasonryReturn_{index}_{return_index}", root,
                ((x + back_x) * .5, 2.02, z + offset),
                (abs(back_x - x), 3.96, .58), mats["concrete"],
                "corridor.exterior-thick-masonry-return", .024, pbr_authored=True,
            )
        sill_offsets = (-length / 2 + .96, 0.15, length / 2 - .88)
        if index == 1:
            sill_offsets = (0.15, length / 2 - .88)
        for sill in sill_offsets:
            cube(f"CorridorExteriorSill_{index}_{sill:+.2f}", root, ((x + back_x) * .5, 1.30, z + sill), (abs(back_x - x), .14, .18), mats["metal"], "corridor.exterior-window-sill", .012)
    # One deep door return and a side-lite close the nearest left-hand void.
    cube("CorridorRecoveryDoorReturn", root, (-2.74, 1.62, 3.04), (.36, 3.24, 2.32), mats["wall"], "corridor.recovery-door-return", .030)
    cube("CorridorRecoveryDoorLeaf", root, (-2.93, 1.58, 3.04), (.10, 3.02, 1.94), mats["metal"], "corridor.recovery-closed-metal-door", .018)
    cube("CorridorRecoveryDoorSideLite", root, (-2.87, 2.16, 4.24), (.08, 1.46, .54), mats["window"], "corridor.recovery-door-sidelite", .010)
    # Irregular soot/wet contacts add perceptible furniture grounding without
    # painting a fake baked shadow into the floor albedo.
    contact_shapes = (
        ("NearDesk", (-1.52, 3.86), (1.24, .72)),
        ("ChairPile", (.82, 5.78), (1.12, .64)),
        ("FallenFixture", (-2.14, 7.22), (.94, .56)),
    )
    outline = ((-.94, -.16), (-.56, -.62), (.18, -.78), (.88, -.36), (.98, .18), (.50, .72), (-.26, .66), (-.82, .42))
    for label, (cx, cz), (sx, sz) in contact_shapes:
        vertices = [to_blender((cx + ox * sx, .155, cz + oz * sz)) for ox, oz in outline]
        mesh = bpy.data.meshes.new(f"CorridorContact_{label}_Mesh")
        mesh.from_pydata(vertices, [], [tuple(range(len(vertices)))])
        mesh.update()
        uv = mesh.uv_layers.new(name="UVMap")
        for loop_index in mesh.polygons[0].loop_indices:
            point = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (point.x * .62, point.y * -.62)
        obj = bpy.data.objects.new(f"CorridorContact_{label}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = root
        obj.data.materials.append(mats["soot"])
        tag(obj, "corridor.debris-contact-soot", pbr_authored=True, physical_surface_response=True)
        ensure_uv_layers(obj)


def corridor_blenderkit_scan_recovery(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Put three independently rematerialed scan derivatives in 0–12m.

    The approved opening modules remain the school identity (desk, wired
    windows, ceilings and broken paint).  These scans supply the high-density
    fracture/aggregate read that handcrafted wall lips cannot fake, while
    remaining well clear of the central traversal lane and both side portals.
    """
    authored_blenderkit_derivative(
        root,
        "scan-rubble-pile-a",
        "CorridorBlenderKitForegroundRubble",
        (-2.22, .16, 4.78),
        .365,
        (0.0, 0.0, .34),
        mats["concrete"],
        "corridor.recovery.blenderkit-scan-rubble",
        decimate_ratio=.024,
        crop=(.10, .90, .12, .86),
    )
    # A second scan contributes heavy, exposed-masonry breakup above the
    # floor rise.  Its original presentation material was rejected by the
    # review gate; this cropped, underside-stripped derivative is remapped to
    # a third approved PBR source and placed left of the traversal lane.
    authored_blenderkit_derivative(
        root,
        "scan-rubble-ruins",
        "CorridorBlenderKitRuinMasonry",
        (-2.16, .19, 8.72),
        .52,
        (0.0, 0.0, -.28),
        mats["brick"],
        "corridor.recovery.blenderkit-rematerialed-ruin-bed",
        decimate_ratio=.026,
        crop=(.12, .86, .14, .88),
    )
    # This source was rejected before its black/specular material was
    # replaced.  It now carries the shared weathered tile PBR and is trimmed
    # to one chipped floor rise at the far edge of the first sightline.
    authored_blenderkit_derivative(
        root,
        "scan-old-broken-floor",
        "CorridorBlenderKitBrokenFloor",
        (2.02, .16, 10.58),
        .38,
        (0.0, 0.0, -.44),
        mats["roof"],
        "corridor.recovery.blenderkit-broken-floor",
        decimate_ratio=.020,
        crop=(.18, .82, .16, .84),
    )


def corridor_exterior_school_silhouettes(root: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    """Put real broken school mass beyond the first right-hand window bays.

    These shallow, thick fragments sit outside the route and portal clearance.
    They are deliberately not cyan/weather cards: at player height the broken
    jambs now reveal staggered masonry, sill depth and exposed rebar rather
    than the renderer clear colour.
    """
    for index, (z, height, width) in enumerate(((3.35, 3.46, 2.10), (12.18, 3.72, 2.45))):
        jagged_wall_fragment(
            f"CorridorExteriorSchoolSilhouette_{index}",
            root,
            4.78,
            5.48,
            ((.15, z - width / 2), (height * .48, z - width / 2), (height, z - width * .18), (height * .82, z + width / 2), (.18, z + width / 2)),
            mats["brick"],
            "corridor.exterior-ruined-school-thick-masonry",
            pbr_authored=True,
            exterior_only=True,
        )
        for rod_index, offset in enumerate((-.56, .46)):
            rod = cylinder(
                f"CorridorExteriorSchoolRebar_{index}_{rod_index}",
                root,
                (5.12, height + .32, z + offset),
                .024,
                .84,
                mats["metal"],
                "corridor.exterior-ruined-school-exposed-rebar",
            )
            rod.rotation_euler.rotate_axis("Y", -.16 + rod_index * .30)


def bevel(obj: bpy.types.Object, amount: float) -> bpy.types.Object:
    modifier = obj.modifiers.new("Structural_Bevel", "BEVEL")
    modifier.width = amount
    modifier.segments = 2
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    except RuntimeError:
        pass
    obj.select_set(False)
    ensure_uv_layers(obj)
    return obj


def cube(name: str, parent: bpy.types.Object, loc: tuple[float, float, float], size: tuple[float, float, float], material: bpy.types.Material, semantic: str, amount: float = 0.025, **extras: object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=to_blender(loc))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size_to_blender(size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    obj.parent = parent
    tag(obj, semantic, **extras)
    tile_primary_uvs(obj, material)
    if amount:
        return bevel(obj, amount)
    ensure_uv_layers(obj)
    return obj


def jagged_wall_fragment(
    name: str,
    parent: bpy.types.Object,
    front_x: float,
    back_x: float,
    outline: tuple[tuple[float, float], ...],
    material: bpy.types.Material,
    semantic: str,
    **extras: object,
) -> bpy.types.Object:
    """Make a thick, irregular wall fragment in the shared game frame.

    Corridor damage may not be a flat decal/card over an intact wall: that
    shortcut reads as pasted wallpaper at first-bay distance and has no actual
    plaster edge.  This helper is the source build's jagged-patch pattern
    adapted to the streamable route coordinate frame.  Its two x planes form a
    real thickness, while the y/z outline lets each exposed substrate break
    differently from its neighbouring fragment.
    """
    count = len(outline)
    if count < 3:
        raise ValueError(f"{name}: a wall fragment needs at least three outline points")
    vertices = [to_blender((front_x, y, z)) for y, z in outline]
    vertices.extend(to_blender((back_x, y, z)) for y, z in outline)
    faces: list[tuple[int, ...]] = [tuple(range(count)), tuple(range(count * 2 - 1, count - 1, -1))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            # Blender coordinates are (x, -game-z, game-y).  Preserve a
            # metre-scale material mapping over both face and torn thickness.
            uv.data[loop_index].uv = (-vertex.y * .72, vertex.z * .72)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    tag(obj, semantic, structural_damage=True, **extras)
    ensure_uv_layers(obj)
    return obj


def jagged_facade_fragment(
    name: str,
    parent: bpy.types.Object,
    front_z: float,
    back_z: float,
    outline: tuple[tuple[float, float], ...],
    material: bpy.types.Material,
    semantic: str,
    **extras: object,
) -> bpy.types.Object:
    """Extrude an irregular X/Y facade silhouette through real wall depth.

    A damaged headhouse needs fractured rooflines and missing plaster at eye
    height.  Cubes are appropriate for hidden structural return walls, but a
    clean rectangular front elevation reads as a prototype even when its
    material is physically correct.  This creates one closed, bevel-ready
    masonry volume with no coplanar decorative sheet.
    """
    if len(outline) < 3:
        raise ValueError(f"{name}: a facade fragment needs at least three outline points")
    vertices = [to_blender((x, y, front_z)) for x, y in outline]
    vertices.extend(to_blender((x, y, back_z)) for x, y in outline)
    count = len(outline)
    faces: list[tuple[int, ...]] = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (vertex.x * .72, vertex.z * .72)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    tag(obj, semantic, structural_damage=True, non_coplanar_facade=True, **extras)
    ensure_uv_layers(obj)
    return obj


def jagged_horizontal_fragment(
    name: str,
    parent: bpy.types.Object,
    bottom_y: float,
    top_y: float,
    outline: tuple[tuple[float, float], ...],
    material: bpy.types.Material,
    semantic: str,
    **extras: object,
) -> bpy.types.Object:
    """Extrude an irregular X/Z structural slab through real vertical depth.

    Rooftop blast damage cannot terminate in two clean rectangular roof
    plates.  This keeps the same solid structural PBR and real closed volume,
    while letting the exposed edge and silhouette break independently from
    the facade below it.
    """
    if len(outline) < 3:
        raise ValueError(f"{name}: a horizontal fragment needs at least three outline points")
    vertices = [to_blender((x, bottom_y, z)) for x, z in outline]
    vertices.extend(to_blender((x, top_y, z)) for x, z in outline)
    count = len(outline)
    faces: list[tuple[int, ...]] = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (vertex.x * .72, -vertex.y * .72)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    tag(obj, semantic, structural_damage=True, non_rectangular_slab=True, **extras)
    ensure_uv_layers(obj)
    return obj


def local_cube(name: str, parent: bpy.types.Object, loc: tuple[float, float, float], size: tuple[float, float, float], material: bpy.types.Material, semantic: str, amount: float = 0.025, **extras: object) -> bpy.types.Object:
    """Create geometry in a parent's gameplay-local frame.

    Hinged leaves must be children of an authored pivot rather than independent
    static meshes. Parenting before assigning the local transform makes their
    closed pose and the DoorSystem hinge pivot serializable in the delivery GLB.
    """
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = to_blender(loc)
    obj.dimensions = size_to_blender(size)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    tag(obj, semantic, **extras)
    tile_primary_uvs(obj, material)
    if amount:
        return bevel(obj, amount)
    ensure_uv_layers(obj)
    return obj


def cylinder(name: str, parent: bpy.types.Object, loc: tuple[float, float, float], radius: float, depth: float, material: bpy.types.Material, semantic: str, rotation: tuple[float, float, float] = (0, 0, 0), **extras: object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=depth, location=to_blender(loc), rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    obj.parent = parent
    tag(obj, semantic, **extras)
    for face in obj.data.polygons:
        face.use_smooth = True
    return bevel(obj, min(0.015, radius * 0.18))


def anchor(parent: bpy.types.Object, name: str, semantic: str, location: tuple[float, float, float], **extras: object) -> None:
    item = empty(name, parent, semantic, anchor_type="semantic", mount_contract="stable", **extras)
    item.location = to_blender(location)


def collider(parent: bpy.types.Object, name: str, semantic: str, bounds: tuple[float, float, float, float], local_center: tuple[float, float, float]) -> None:
    """Record one world-space floor contract alongside the authored route."""
    min_x, min_z, max_x, max_z = bounds
    item = empty(name, parent, semantic, collider_type="navigable-floor", coordinate_space="world")
    item.location = to_blender(local_center)
    tag(
        item,
        semantic,
        bounds_min_x=min_x,
        bounds_min_z=min_z,
        bounds_max_x=max_x,
        bounds_max_z=max_z,
    )


def portal_breach(
    root: bpy.types.Object,
    prefix: str,
    side: float,
    local_center_z: float,
    width: float,
    portal_id: str,
    clearance_bounds: tuple[float, float, float, float],
    mats: dict[str, bpy.types.Material],
) -> None:
    """Author an actual side-wall opening, not merely a portal anchor.

    `clearance_bounds` stays in game world x/z coordinates and is duplicated
    onto the delivery node. The validator also reads mesh AABBs, so this is a
    semantic trace in addition to (never instead of) a real breach.
    """
    item = empty(
        f"Breach_{prefix}",
        root,
        portal_id,
        portal_breach=True,
        clearance_min_x=clearance_bounds[0],
        clearance_min_z=clearance_bounds[1],
        clearance_max_x=clearance_bounds[2],
        clearance_max_z=clearance_bounds[3],
    )
    item.location = to_blender((side, 0.2, local_center_z))
    # The lintel retains the damaged-plaster architectural read while leaving
    # a 2.65m headroom through the simulation portal volume.
    cube(
        f"PortalLintel_{prefix}",
        root,
        (side, 3.24, local_center_z),
        (0.18, 1.12, width),
        mats["wall"],
        f"{portal_id}.lintel",
        0.01,
    )


def wall_segments(
    root: bpy.types.Object,
    prefix: str,
    side: float,
    length: float,
    half_width: float,
    material: bpy.types.Material,
    semantic: str,
    breaches: tuple[tuple[str, float, float, tuple[float, float, float, float]], ...],
    mats: dict[str, bpy.types.Material],
) -> None:
    """Split an opaque side wall around every authored portal clearance."""
    cursor = 0.0
    for index, (portal_id, center_z, width, clearance_bounds) in enumerate(sorted(breaches, key=lambda breach: breach[1])):
        start = max(0.0, center_z - width / 2)
        end = min(length, center_z + width / 2)
        if start > cursor:
            cube(
                f"{prefix}_Wall_{'L' if side < 0 else 'R'}_{index}",
                root,
                (side * half_width, 1.9, (cursor + start) / 2),
                (0.18, 3.8, start - cursor),
                material,
                semantic,
            )
        portal_breach(root, f"{prefix}_{portal_id.replace('.', '_')}", side * half_width, center_z, end - start, portal_id, clearance_bounds, mats)
        cursor = end
    if cursor < length:
        cube(
            f"{prefix}_Wall_{'L' if side < 0 else 'R'}_end",
            root,
            (side * half_width, 1.9, (cursor + length) / 2),
            (0.18, 3.8, length - cursor),
            material,
            semantic,
        )


def shell(
    root: bpy.types.Object,
    prefix: str,
    length: float,
    half_width: float,
    mats: dict[str, bpy.types.Material],
    left_breaches: tuple[tuple[str, float, float, tuple[float, float, float, float]], ...] = (),
    right_breaches: tuple[tuple[str, float, float, tuple[float, float, float, float]], ...] = (),
) -> None:
    cube(f"{prefix}_Floor", root, (0, 0, length / 2), (half_width * 2, 0.18, length), mats["concrete"], f"{prefix}.floor", 0.015)
    cube(f"{prefix}_Ceiling", root, (0, 3.8, length / 2), (half_width * 2, 0.13, length), mats["wall"], f"{prefix}.ceiling", 0.01)
    wall_segments(root, prefix, -1, length, half_width, mats["wall"], f"{prefix}.wall-left", left_breaches, mats)
    wall_segments(root, prefix, 1, length, half_width, mats["sage"], f"{prefix}.wall-right", right_breaches, mats)
    for position in (1.2, length * 0.5, length - 1.1):
        cube(f"{prefix}_Beam_{position:.1f}", root, (0, 3.58, position), (half_width * 1.8, 0.15, 0.18), mats["metal"], f"{prefix}.ceiling-beam", 0.01)


def hinged_door(parent: bpy.types.Object, prefix: str, pivot_location: tuple[float, float, float], closed_center: tuple[float, float, float], mats: dict[str, bpy.types.Material], door_id: str) -> None:
    """Author a DoorSystem-owned hinge leaf with its real closed pose.

    The route root owns the fixed frame. Only `*_Pivot` and its leaf children
    move in the renderer, so a passable DoorSystem snapshot cannot leave a
    visually closed duplicate behind.
    """
    x, y, z = closed_center
    world_origin = (
        float(parent.get("world_origin_x", 0)),
        float(parent.get("world_origin_y", 0)),
        float(parent.get("world_origin_z", 0)),
    )
    world_pivot = tuple(world_origin[index] + pivot_location[index] for index in range(3))
    world_closed = tuple(world_origin[index] + closed_center[index] for index in range(3))
    cube(f"{prefix}_Frame", parent, (x, y, z + 0.055), (3.62, 3.14, 0.16), mats["metal"], f"{door_id}.frame", 0.026)
    pivot = empty(
        f"{prefix}_Pivot",
        parent,
        f"{door_id}.pivot",
        door_id=door_id,
        door_kind="hinge",
        coordinate_space="world",
        closed_position_x=world_closed[0],
        closed_position_y=world_closed[1],
        closed_position_z=world_closed[2],
        pivot_x=world_pivot[0],
        pivot_y=world_pivot[1],
        pivot_z=world_pivot[2],
        axis_x=0,
        axis_y=1,
        axis_z=0,
    )
    pivot.location = to_blender(pivot_location)
    leaf_offset = (x - pivot_location[0], y - pivot_location[1], z - pivot_location[2])
    leaf = local_cube(
        f"{prefix}_Leaf",
        pivot,
        leaf_offset,
        (3.3, 2.82, 0.11),
        mats["metal"],
        f"{door_id}.leaf",
        0.022,
        door_id=door_id,
        visual_motion_source="DoorSystem.render.motionAmount",
    )
    local_cube(f"{prefix}_Glass", leaf, (0, 0.34, -0.061), (1.78, 0.86, 0.018), mats["glass"], f"{door_id}.glass", 0.004)
    local_cube(f"{prefix}_Kickplate", leaf, (0, -1.0, -0.064), (2.84, 0.54, 0.018), mats["black"], f"{door_id}.kickplate", 0.008)


def hiding_panel(parent: bpy.types.Object, name: str, hide_id: str, local_position: tuple[float, float, float], size: tuple[float, float, float], material: bpy.types.Material, open_angle: float) -> None:
    """Author a renderer-owned cover seam for simulation hiding state.

    The runtime can stay authoritative about `outside → entering → hidden →
    exiting`; this GLB only exposes the stable visual panel, closed pose, and
    reversible authored open clip needed to mirror that state.
    """
    pivot = empty(
        f"{name}_Pivot",
        parent,
        hide_id,
        hide_id=hide_id,
        visual_state_source="HideSystem.snapshot.phase",
        closed_transform="translation 0,0,0; rotation 0,0,0",
        open_transform=f"rotation_z {open_angle:.4f}",
        runtime_states="outside|entering|hidden|exiting",
    )
    pivot.location = to_blender(local_position)
    panel = local_cube(
        f"{name}_Panel",
        pivot,
        (0, size[1] * 0.5, 0),
        size,
        material,
        f"{hide_id}.panel",
        0.018,
        hide_id=hide_id,
        closed_parent="Pivot",
        visual_motion_source="HideSystem.snapshot.phase",
    )
    action = bpy.data.actions.new(f"{name}_OpenClose")
    pivot.animation_data_create()
    pivot.animation_data.action = action
    pivot.rotation_mode = "XYZ"
    for frame, angle in ((1, 0.0), (16, open_angle), (32, 0.0)):
        pivot.rotation_euler = (0.0, 0.0, angle)
        pivot.keyframe_insert(data_path="rotation_euler", frame=frame)
    pivot.rotation_euler = (0.0, 0.0, 0.0)
    tag(panel, f"{hide_id}.panel", animation_clip=action.name, visible_cover=True)


def route_root(key: str, world_origin: tuple[float, float, float]) -> tuple[bpy.types.Object, dict[str, bpy.types.Material]]:
    global ROUTE_PBR_DELIVERY_SIZE
    ROUTE_PBR_DELIVERY_SIZE = 512 if key in {"corridor", "rooftop"} else 256
    root = empty(
        "LOD0_Route",
        None,
        f"route.{key}",
        zone_id=key,
        authored_in="Blender 5.2",
        lod_level=0,
        coordinate_space="world-root",
        world_origin_x=world_origin[0],
        world_origin_y=world_origin[1],
        world_origin_z=world_origin[2],
    )
    root.location = to_blender(world_origin)
    return root, materials()


def make_corridor() -> bpy.types.Object:
    # The first bay owns z=13.2..25. This continuation deliberately overlaps
    # it by one metre and then spans the full authoritative collider to z=67.
    root, mats = route_root("corridor", (0, 0, 24))
    shell(
        root,
        "Corridor",
        43.0,
        3.0,
        mats,
        left_breaches=(("portal.broadcast", 18.65, 9.6, (-4.52, 37.9, -2.48, 47.4)),),
        right_breaches=(("portal.infirmary", 8.05, 4.0, (2.48, 30.1, 4.52, 34.0)),),
    )
    corridor_authored_finish(root, mats)
    corridor_suspended_ceiling_recovery(root, mats)
    corridor_irregular_wall_failure(root, mats)
    corridor_right_wall_break(root, mats)
    corridor_polyhaven_anchors(root, mats)
    # Private recovery: two real CC0 caged fittings and a fallen cable loom
    # break the stock-kit ceiling rhythm at the player-facing first bay.
    authored_recovery_cc0(root, "caged_hanging_light", "CorridorRecoveryCagedLight_A", (-1.32, 3.06, 4.10), .76, (0.0, .12, -.18), mats, "corridor.recovery.cc0-caged-light")
    authored_recovery_cc0(root, "caged_hanging_light", "CorridorRecoveryCagedLight_B", (1.44, 2.72, 8.86), .68, (0.0, -.18, .24), mats, "corridor.recovery.cc0-caged-light")
    authored_recovery_cc0(root, "modular_electric_cables", "CorridorRecoveryCableLoom", (-2.34, 2.92, 10.92), .50, (0.0, .0, -.28), mats, "corridor.recovery.cc0-cable-loom")
    # The dedicated recovery above contains only the runner, torn-acoustic
    # edge and hanging-cable language that remains legible at eye height.
    # Reimporting the opening's complete ceiling assembly made a stack of
    # thin parallel boards under the shell, not a plausible failed ceiling.
    corridor_opening_damage_reuse(root)
    # Retain a sparse, authored service-beam rhythm below. Reimporting the
    # opening's full ceiling set added enough duplicate texture/mesh payload
    # to break the mobile whole-pack cap; the stage only ships details it can
    # keep resident with its current/next-zone streaming contract.
    # Reuse the approved opening's actual wired-glass bays and recessed
    # classroom frames.  Each clone is still emitted into *this* zone-local
    # GLB, so no monolithic opening asset survives in the runtime stream.
    # The first player-camera beat needs one full authored window bay. The
    # second copy at the far streaming boundary had no first-sightline value
    # but consumed the budget needed by the rooftop's hero structure.
    for source_index, offset in enumerate((11.4,)):
        for module_index in range(3):
            opening_module(root, f"CorridorWindow_{source_index}_{module_index}", f"FirstBay_Window_{module_index}_", offset, mats)
    for source_index, module_index, offset in ((0, 0, 11.4), (1, 0, 21.4), (1, 1, 21.4), (1, 2, 21.4)):
        opening_module(root, f"CorridorClassroomDoor_{source_index}_{module_index}", f"FirstBay_ClassroomDoor_{module_index}_", offset, mats)
    # Do not mirror a classroom module into the left broadcast detour volume;
    # the streamed wall must remain physically open at its authoritative
    # portal, even while the opposite-side classroom rhythm continues.
    for source_index, module_index, offset in ((0, 0, 11.4),):
        opening_module(root, f"CorridorClassroomDoor_Left_{source_index}_{module_index}", f"FirstBay_ClassroomDoor_{module_index}_", offset, mats, mirror_x=True)
    # The first encounter reads within the initial twelve metres, so place
    # varied, source-authored collapse at short intervals instead of repeating
    # the same kit primitive down the whole hall.
    opening_dressing_module(root, "CorridorOverturnedDesk_A", "FirstBay_OverturnedDesk_A_", (-1.28, .08, 2.8))
    opening_dressing_module(root, "CorridorChair_A", "FirstBay_Chair_A_", (1.12, .08, 5.5))
    opening_dressing_module(root, "CorridorOverturnedDesk_B", "FirstBay_OverturnedDesk_B_", (-1.12, .08, 8.2))
    # Stay entirely past the infirmary portal's visual clearance. The rubble
    # group is intentionally wide, so its authored centre needs more than a
    # nominal 0.6m separation from the portal edge.
    opening_dressing_module(root, "CorridorRubble_A", "FirstBay_Rubble_", (1.26, .04, 12.8))
    for index, z in enumerate((2.2, 8.8, 16.4, 25.7, 32.6, 39.2)):
        authored_route_prop(root, "broken-fluorescent", f"Fluorescent_{index}", (0.0, 3.28, z))
    # The hiding seam is a full, visible locker bank at the player route, not
    # an isolated animated cover floating on a wall.  Its only door leaf is
    # the reversible HideSystem panel below; the source bank supplies the
    # surrounding steel carcass, vents, side thickness and neighbouring doors.
    authored_route_prop(root, "locker-bank", "CorridorHideLockerBank", (2.72, 0.0, 15.1))
    hiding_panel(root, "Hide_Locker_Corridor", "hiding.locker.corridor", (2.25, 0.0, 15.1), (0.10, 2.62, 1.42), mats["metal"], -1.28)
    anchor(root, "Anchor_Hide_Locker", "hiding.locker.corridor.anchor", (2.25, .05, 15.1), hide_id="hiding.locker.corridor", visual_cover="Hide_Locker_Corridor_Panel", panel_animation="Hide_Locker_Corridor_OpenClose")
    authored_route_prop(root, "classroom-desk-chair", "CorridorDesk_WallA", (-1.72, 0.0, 26.0))
    authored_route_prop(root, "classroom-desk-chair", "CorridorDesk_WallB", (1.35, 0.0, 29.1))
    authored_route_prop(root, "debris-cluster", "CorridorDebris_A", (-1.35, 0.0, 12.3))
    authored_route_prop(root, "debris-cluster", "CorridorDebris_B", (1.45, 0.0, 35.7))
    # The first bay needs clustered low/mid/high debris, not two isolated
    # floor props. Each kit instance contains ten authored pieces; the two
    # staged groups plus the two existing route beats make forty fragments
    # across the foreground and midground while retaining portal clearance.
    for index, (x, z) in enumerate(((-2.30, 1.62), (1.02, 6.32))):
        authored_route_prop(root, "debris-cluster", f"CorridorStoryDebris_{index}", (x, .0, z))
    # Keep the individually posed chairs in their first-contact positions.
    # Pulling them into later portal ranges made their real mesh bounds block
    # the broadcast clearance even though their origin appeared lane-safe.
    for obj in root.children_recursive:
        if obj.type == "MESH" and obj.name.startswith("CorridorHeroChair_"):
            obj.data.materials.clear()
            obj.data.materials.append(mats["wood"])
    # Close every first-bay opening with thick exterior returns. The depth
    # recovery installs no cyan/weather card: the player sees school masonry,
    # sill thickness and scan/approved-opening debris only.
    corridor_blenderkit_scan_recovery(root, mats)
    corridor_depth_recovery(root, mats)
    corridor_exterior_school_silhouettes(root, mats)
    anchor(root, "Anchor_Main", "route.corridor.main", (0, 0.2, 22.0))
    anchor(root, "Anchor_Detour", "route.corridor.detour", (2.2, 0.2, 8.0))
    anchor(root, "Portal_Infirmary", "portal.corridor.infirmary", (4.45, 0.2, 8.0))
    anchor(root, "Portal_Broadcast", "portal.corridor.broadcast", (-4.45, 0.2, 19.0))
    anchor(root, "Portal_Utility", "portal.corridor.utility", (0, 0.2, 37.0))
    collider(root, "COL_Corridor_Lane", "collider.corridor.lane", (-3, 24, 3, 67), (0, 0, 21.5))
    return root


def make_infirmary() -> bpy.types.Object:
    root, mats = route_root("infirmary", (7, 0, 27))
    shell(
        root,
        "Infirmary",
        11.0,
        3.0,
        mats,
        left_breaches=(("portal.infirmary", 5.05, 4.0, (2.48, 30.1, 4.52, 34.0)),),
    )
    cube("TreatmentCabinet", root, (2.1, 1.1, 4.0), (1.1, 2.0, 1.2), mats["metal"], "infirmary.cabinet", 0.035)
    cube("GurneyFrame", root, (-0.4, 0.82, 5.6), (1.35, 0.35, 2.25), mats["metal"], "infirmary.gurney-frame", 0.025)
    cube("GurneyPad", root, (-0.4, 1.03, 5.6), (1.22, 0.12, 2.08), mats["sage"], "infirmary.gurney-pad", 0.045)
    anchor(root, "Anchor_KitDetour", "collectible.kit.infirmary-detour", (0.1, 0.2, 4.6))
    anchor(root, "Portal_Corridor", "portal.infirmary.corridor", (-2.55, 0.2, 5.0))
    collider(root, "COL_Infirmary", "collider.infirmary.floor", (4, 27, 10, 38), (0, 0, 5.5))
    return root


def make_broadcast() -> bpy.types.Object:
    root, mats = route_root("broadcast", (-7, 0, 37))
    shell(
        root,
        "Broadcast",
        12.0,
        3.0,
        mats,
        right_breaches=(("portal.broadcast", 5.65, 9.6, (-4.52, 37.9, -2.48, 47.4)),),
    )
    cube("BroadcastDesk", root, (0, 0.86, 6.1), (2.45, 0.74, 1.1), mats["wood"], "broadcast.desk", 0.04)
    for index, x in enumerate((-0.72, 0.0, 0.72)):
        cube(f"Console_{index}", root, (x, 1.34, 5.95), (0.55, 0.11, 0.36), mats["graphite"] if "graphite" in mats else mats["black"], "broadcast.console", 0.02)
    cube("RadioShelf", root, (-2.35, 1.45, 7.6), (0.58, 2.4, 1.0), mats["metal"], "broadcast.shelf", 0.02)
    anchor(root, "Anchor_Radio", "collectible.radio.broadcast-desk", (-0.2, 1.3, 6.5))
    anchor(root, "Portal_Corridor", "portal.broadcast.corridor", (2.55, 0.2, 6.0))
    collider(root, "COL_Broadcast", "collider.broadcast.floor", (-10, 37, -4, 49), (0, 0, 6.0))
    return root


def make_utility() -> bpy.types.Object:
    root, mats = route_root("utility", (0, 0, 61))
    shell(root, "Utility", 6.0, 3.0, mats)
    cube("BreakerCabinet", root, (1.9, 1.55, 3.5), (0.52, 2.1, 1.35), mats["metal"], "utility.breaker-cabinet", 0.035)
    for index in range(5):
        cube(f"Breaker_{index}", root, (1.61 + (index % 2) * 0.22, 1.55, 3.04 + (index // 2) * 0.28), (0.1, 0.04, 0.16), mats["ember"], "utility.breaker-switch", 0.006)
    cube("PowerConduit", root, (-2.45, 2.82, 3.0), (0.16, 0.16, 5.0), mats["metal"], "utility.conduit", 0.02)
    cube("HeavyObstacle", root, (0, 0.42, 4.4), (1.72, 0.78, 0.7), mats["concrete"], "utility.heavy-obstacle", 0.035)
    anchor(root, "Anchor_Power", "interaction.utility.power", (1.5, 1.1, 3.5))
    anchor(root, "Portal_Stairwell", "portal.utility.stairwell", (0, 0.2, 6.0))
    collider(root, "COL_Utility", "collider.utility.floor", (-3, 61, 3, 67), (0, 0, 3.0))
    return root


def make_stairwell() -> bpy.types.Object:
    root, mats = route_root("stairwell", (0, 0, 67))
    shell(root, "Stairwell", 15.0, 3.65, mats)
    for index in range(12):
        cube(f"Step_{index}", root, (0, 0.11 + index * 0.16, 1.3 + index * 0.78), (2.5, 0.22, 0.82), mats["concrete"], "stairwell.step", 0.012)
    for side in (-1, 1):
        cube(f"Rail_{side}", root, (side * 1.45, 1.65, 7.7), (0.07, 1.9, 12.8), mats["metal"], "stairwell.rail", 0.018)
    hinged_door(root, "DoorFire", (-1.65, 1.5, 0), (0, 1.5, 0), mats, "door.fire")
    hinged_door(root, "DoorRooftop", (-1.65, 1.5, 15.0), (0, 1.5, 15.0), mats, "door.rooftop")
    anchor(root, "Anchor_Candle", "collectible.candle.stairwell-shelf", (-1.8, 1.0, 10.3))
    anchor(root, "Anchor_Blanket", "collectible.blanket.stairwell-search", (2.05, 0.25, 12.25))
    anchor(root, "Portal_Fire", "portal.stairwell.fire", (0, 0.2, 0))
    anchor(root, "Portal_Rooftop", "portal.stairwell.rooftop", (0, 0.2, 15.0))
    collider(root, "COL_Stairwell", "collider.stairwell.floor", (-3.65, 67, 3.65, 82), (0, 0, 7.5))
    return root


def make_rooftop() -> bpy.types.Object:
    root, mats = route_root("rooftop", (0, 0, 82))
    cube("RooftopSlab", root, (0, 0, 13.0), (20.0, 0.3, 26.0), mats["roof_macro"], "rooftop.slab", 0.02)
    # This generated source is restricted to an unreachable distant layer;
    # the playable roof, school mass, rubble, hearth and all parallax-critical
    # geometry remain authored physical meshes in front of it.
    rooftop_distant_matte(root)
    for x, z, size in ((0, 0.0, (20.0, 1.25, 0.1)), (0, 26.0, (20.0, 1.25, 0.1)), (-9.9, 13.0, (0.1, 1.25, 26.0)), (9.9, 13.0, (0.1, 1.25, 26.0))):
        cube("Rooftop_Parapet", root, (x, 0.62, z), size, mats["concrete"], "rooftop.parapet", 0.02)
    # Coping stones, exit enclosure and HVAC give the playable slab a real
    # roof rhythm instead of a single empty tile plane.
    for index, (x, z, size) in enumerate(((0, .16, (19.8, .16, .28)), (0, 25.84, (19.8, .16, .28)), (-9.78, 13, (.28, .16, 25.4)), (9.78, 13, (.28, .16, 25.4)))):
        cube(f"RooftopCoping_{index}", root, (x, 1.28, z), size, mats["concrete"], "rooftop.parapet-coping", 0.018)
    # Private recovery is intentionally one authored exit vista, not an
    # accumulation of rejected stock-kit experiments. Its fire geometry is
    # aligned to the existing runtime particle/light seam and its only house
    # is a distant, non-navigable scan derivative. The route contract below
    # (anchor, portal and collider) remains exactly as before.
    # This is the actual roof-side exit enclosure, not a second DoorSystem
    # leaf.  It gives the player a physical school roof threshold while the
    # movable authoritative door remains in the stairwell stream.
    rooftop_bulkhead(root, mats)
    rooftop_blenderkit_scan_recovery(root, mats)
    rooftop_visible_school_service_dressing(root, mats)
    rooftop_validator_contract_dressing(root, mats)
    anchor(root, "Anchor_Namra", "character.namra.rooftop", (0.0, 0.2, 19.5))
    anchor(root, "Portal_RooftopDoor", "portal.rooftop.door", (0, 0.2, 0.0))
    collider(root, "COL_Rooftop", "collider.rooftop.floor", (-10, 82, 10, 108), (0, 0, 13.0))
    return root


def add_bone(armature: bpy.types.Object, name: str, head: tuple[float, float, float], tail: tuple[float, float, float], parent: bpy.types.Bone | None = None) -> bpy.types.EditBone:
    bone = armature.data.edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    bone.parent = parent
    return bone


def armature(parent: bpy.types.Object, rig_id: str) -> bpy.types.Object:
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    rig = bpy.context.object
    rig.name = "Armature_Common"
    rig.data.name = "Armature_Common_Data"
    base = rig.data.edit_bones[0]
    base.name = "Hips"
    base.head, base.tail = (0, 0, 0.9), (0, 0, 1.22)
    spine = add_bone(rig, "Spine", (0, 0, 1.22), (0, 0, 1.62), base)
    neck = add_bone(rig, "Neck", (0, 0, 1.62), (0, 0, 1.82), spine)
    add_bone(rig, "Head", (0, 0, 1.82), (0, 0, 2.15), neck)
    for side, sign in (("L", -1), ("R", 1)):
        upper = add_bone(rig, f"UpperArm_{side}", (sign * 0.18, 0, 1.55), (sign * 0.52, 0, 1.35), spine)
        add_bone(rig, f"Forearm_{side}", (sign * 0.52, 0, 1.35), (sign * 0.64, 0, 1.02), upper)
        thigh = add_bone(rig, f"Thigh_{side}", (sign * 0.15, 0, 0.9), (sign * 0.2, 0, 0.48), base)
        add_bone(rig, f"Shin_{side}", (sign * 0.2, 0, 0.48), (sign * 0.22, 0.05, 0.08), thigh)
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.parent = parent
    tag(rig, f"rig.{rig_id}", rig_id=rig_id, replaceable_non_likeness=True, retarget_contract="humanoid-v1", deformation="skinned")
    return rig


def character_texture(map_key: str, slot: str, palette: tuple[float, float, float]) -> bpy.types.Image:
    """Write compact original character PBR maps; reference boards are never embedded."""
    CHARACTER_PBR_DIR.mkdir(parents=True, exist_ok=True)
    # Failed v6c assets are never rebuilt by default. A separately approved
    # stage-only character replacement gets a 512px authored PBR map so the
    # first-bay flashlight review does not inherit the former clay budget.
    size = 512
    path = CHARACTER_PBR_DIR / f"{map_key}-{slot}-{size}.png"
    image = bpy.data.images.new(f"{map_key}-{slot}", width=size, height=size, alpha=True)
    pixels = [0.0] * (size * size * 4)
    for y in range(size):
        for x in range(size):
            index = (y * size + x) * 4
            is_skin = map_key.endswith("-skin")
            # Character lookdev is deliberately matte. The prior maps made
            # every delivery surface read as wet plaster under a neutral key
            # light; restrained weave belongs only on cloth and never on skin.
            weave = 0.002 * math.sin(x * 0.17) * math.sin(y * 0.13) if is_skin else 0.018 * math.sin(x * 0.27) * math.sin(y * 0.31) + 0.006 * math.sin((x + y) * 0.73)
            seam = 0.0 if is_skin else (0.025 if (x % 48) in (0, 1) or (y % 56) in (0, 1) else 0.0)
            if slot == "basecolor":
                pixels[index:index + 4] = [min(1.0, max(0.0, channel + weave - seam)) for channel in palette] + [1.0]
            elif slot == "normal":
                pixels[index:index + 4] = [0.5 + weave * 0.10, 0.5 + seam * 0.04, 1.0, 1.0]
            else:
                # R=AO, G=roughness, B=metallic. These remain physical maps,
                # rather than painted lighting or a frame-derived texture.
                roughness = .72 if is_skin else (.78 if map_key.endswith("-hair") else .88)
                pixels[index:index + 4] = [0.97 if is_skin else 0.94, roughness, 0.0, 1.0]
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    image.colorspace_settings.name = "sRGB" if slot == "basecolor" else "Non-Color"
    return image


def character_material(name: str, map_key: str, palette: tuple[float, float, float]) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    nodes = result.node_tree.nodes
    links = result.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    assert bsdf is not None
    base = nodes.new("ShaderNodeTexImage")
    base.image = character_texture(map_key, "basecolor", palette)
    orm = nodes.new("ShaderNodeTexImage")
    orm.image = character_texture(map_key, "orm", palette)
    normal = nodes.new("ShaderNodeTexImage")
    normal.image = character_texture(map_key, "normal", palette)
    separate = nodes.new("ShaderNodeSeparateColor")
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(orm.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(separate.outputs["Blue"], bsdf.inputs["Metallic"])
    links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    result["asset_quality"] = "original-character-pbr"
    result["texture_provenance"] = "original material maps; no reference-board pixels"
    return result


def character_materials(profile: str, namra: bool) -> dict[str, bpy.types.Material]:
    fabric_palette = {
        "uniform": (0.38, 0.46, 0.52),
        "athletic": (0.44, 0.10, 0.15),
        "staff": (0.38, 0.30, 0.15),
    }[profile]
    identity = "namra" if namra else profile
    # Keep skin and cloth within a readable, matte sRGB range under the
    # campaign's deliberately dark motivated lights.  These are material
    # albedos, not baked portrait lighting or reference-board pixels.
    cardigan_palette = (0.36, 0.39, 0.42) if namra else tuple(min(.58, value * .92) for value in fabric_palette)
    return {
        "skin": character_material(f"CHR_{identity}_Skin", f"{identity}-skin", (0.72, 0.47, 0.33)),
        "fabric": character_material(f"CHR_{identity}_Fabric", f"{identity}-fabric", fabric_palette),
        "cardigan": character_material(f"CHR_{identity}_Cardigan", f"{identity}-cardigan", cardigan_palette),
        # A warm dark brown keeps individual locks visible under the encounter's blue key.
        "hair": character_material(f"CHR_{identity}_Hair", f"{identity}-hair", (0.15, 0.075, 0.042)),
        "skirt": character_material(f"CHR_{identity}_Skirt", f"{identity}-skirt", (0.22, 0.24, 0.28) if namra else (0.075, 0.095, 0.16)),
        "socks": character_material(f"CHR_{identity}_Socks", f"{identity}-socks", (0.74, 0.76, 0.74)),
        "footwear": character_material(f"CHR_{identity}_Footwear", f"{identity}-footwear", (0.045, 0.060, 0.080)),
        "sclera": character_material(f"CHR_{identity}_Sclera", f"{identity}-sclera", (0.86, 0.89, 0.85)),
        "iris": character_material(f"CHR_{identity}_Iris", f"{identity}-iris", (0.055, 0.12, 0.085)),
        "infection": character_material(f"CHR_{identity}_Infection", f"{identity}-infection", (0.32, 0.08, 0.05)),
    }


def human_mesh(source_name: str, name: str) -> bpy.types.Object:
    """Import official CC0 human topology without source preview machinery."""
    if not HUMAN_BASE_BLEND.exists():
        raise RuntimeError(f"Missing Blender Human Base Meshes v1.4.1 source: {HUMAN_BASE_BLEND}")
    with bpy.data.libraries.load(str(HUMAN_BASE_BLEND), link=False) as (source, loaded):
        if source_name not in source.meshes:
            raise RuntimeError(f"Human Base Meshes source does not contain {source_name}")
        loaded.meshes = [source_name]
    mesh = loaded.meshes[0]
    assert mesh is not None
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    # Catalog previews lay their bodies out side-by-side; re-centre the real
    # topology to our stable humanoid rig, retaining its authored UV layout.
    min_x = min(vertex.co.x for vertex in mesh.vertices)
    max_x = max(vertex.co.x for vertex in mesh.vertices)
    for vertex in mesh.vertices:
        vertex.co.x -= (min_x + max_x) * 0.5
    obj.scale = (1.1, 1.1, 1.1)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.select_set(False)
    ensure_uv_layers(obj)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj["source_topology"] = "Blender Human Base Meshes v1.4.1 CC0"
    obj["source_mesh"] = source_name
    obj["asset_quality"] = "licensed-base-topology-pbr"
    return obj


def human_eye(source_name: str, name: str, location: tuple[float, float, float], material: bpy.types.Material, root: bpy.types.Object, rig: bpy.types.Object) -> bpy.types.Object:
    """Append the CC0 bundle's paired eye topology at its authored face pose."""
    with bpy.data.libraries.load(str(HUMAN_BASE_BLEND), link=False) as (source, loaded):
        if source_name not in source.meshes:
            raise RuntimeError(f"Human Base Meshes source does not contain {source_name}")
        loaded.meshes = [source_name]
    mesh = loaded.meshes[0]
    assert mesh is not None
    eye = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(eye)
    eye.location = location
    eye.scale = (0.9482, 0.9482, 0.9482)  # source eye transform 0.862 * body scale 1.1
    eye.data.materials.append(material)
    eye.parent = root
    ensure_uv_layers(eye)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    tag(eye, f"character.eye.{name.lower()}", skinned=True, source_topology="Blender Human Base Meshes v1.4.1 CC0", eye_role="sclera")
    attach_skin(eye, rig, "Head")
    return eye


def iris_disc(name: str, root: bpy.types.Object, rig: bpy.types.Object, location: tuple[float, float, float], material: bpy.types.Material) -> bpy.types.Object:
    """A small authored iris insert on the supplied CC0 sclera topology."""
    vertices = [(0, 0, 0)]
    sides = 14
    radius = 0.0087
    for side in range(sides):
        theta = 2.0 * math.pi * side / sides
        vertices.append((math.cos(theta) * radius, 0, math.sin(theta) * radius))
    faces = [tuple([0, side + 1, (side + 1) % sides + 1]) for side in range(sides)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for loop in uv.data:
        loop.uv = (.5, .5)
    iris = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(iris)
    iris.location = location
    iris.parent = root
    iris.data.materials.append(material)
    ensure_uv_layers(iris)
    tag(iris, f"character.eye.{name.lower()}", skinned=True, eye_role="iris", pbr_authored=True)
    attach_skin(iris, rig, "Head")
    return iris


def assign_character_materials(body: bpy.types.Object, profile: str, mats: dict[str, bpy.types.Material], namra: bool) -> None:
    """Keep the licensed base as a continuous skin surface.

    Clothing must be its own skinned surface derived from this exact topology.
    Painting garments onto a naked base made the old delivery read as a torn
    mannequin suit at the collar, shoulders, cuffs and ankles. Only the
    optional infection variation belongs on the skin mesh.
    """
    for material in [mats["skin"], mats["infection"], mats["footwear"]]:
        body.data.materials.append(material)
    for polygon in body.data.polygons:
        center = sum((body.data.vertices[index].co for index in polygon.vertices), Vector()) / len(polygon.vertices)
        polygon.material_index = 0
        # A restrained cheek/neck variation remains a skin material region.
        # A coarse half-face split read as a mask in delivery renders.
        if not namra and 1.58 < center.z < 1.66 and center.y < -.105 and .09 < center.x < .17:
            polygon.material_index = 1
        # Shoes remain a material region of the imported, skinned foot
        # topology: there is no detached visual sole or toe-cap mesh.
        elif center.z <= .21:
            polygon.material_index = 2


def attach_skin(mesh: bpy.types.Object, rig: bpy.types.Object, bone: str | None = None) -> None:
    """Export an actual glTF skin; eye meshes use the explicit head-bone seam."""
    mesh.parent = rig
    if bone is not None:
        group = mesh.vertex_groups.new(name=bone)
        group.add(list(range(len(mesh.data.vertices))), 1.0, "REPLACE")
        modifier = mesh.modifiers.new("ArmatureSkin", "ARMATURE")
        modifier.object = rig
        return
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    except RuntimeError as error:
        raise RuntimeError(f"Automatic human-topology skinning failed: {error}") from error


def garment_surface(name: str, body: bpy.types.Object, rig: bpy.types.Object, material: bpy.types.Material, semantic: str, predicate, offset: float = 0.016, deform=None) -> bpy.types.Object:
    """Split clothing from real human topology, then skin it as its own mesh.

    This deliberately avoids box/sphere substitutes: every garment starts as a
    UV-bearing region of the licensed human body topology, gets a physical
    outer offset, and remains independently replaceable at the rig seam.
    """
    source = body.data
    mesh = bpy.data.meshes.new(name)
    working = bmesh.new()
    working.from_mesh(source)
    doomed = []
    for face in working.faces:
        center = sum((vertex.co for vertex in face.verts), Vector()) / len(face.verts)
        if not predicate(center):
            doomed.append(face)
    bmesh.ops.delete(working, geom=doomed, context="FACES_ONLY")
    orphaned = [vertex for vertex in working.verts if not vertex.link_faces]
    if orphaned:
        bmesh.ops.delete(working, geom=orphaned, context="VERTS")
    working.normal_update()
    for vertex in working.verts:
        vertex.co += vertex.normal * offset
        if deform is not None:
            vertex.co = deform(vertex.co)
    working.to_mesh(mesh)
    working.free()
    garment = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(garment)
    garment.data.materials.append(material)
    ensure_uv_layers(garment)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    solidify = garment.modifiers.new("Garment_Layer_Thickness", "SOLIDIFY")
    solidify.thickness = max(0.004, offset * 0.75)
    bpy.context.view_layer.objects.active = garment
    garment.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    garment.select_set(False)
    tag(garment, semantic, skinned=True, garment_surface="licensed-human-topology", pbr_authored=True)
    attach_skin(garment, rig)
    return garment


def _mesh_uv_from_rings(mesh: bpy.types.Mesh, rings: int, sides: int) -> None:
    """Add stable UV0 to authored closed garment mesh rings."""
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].index
            ring, side = divmod(vertex, sides)
            uv.data[loop_index].uv = (side / sides, ring / max(1, rings - 1))


def closed_garment(name: str, parent: bpy.types.Object, rig: bpy.types.Object, rings: list[tuple[float, float, float, float]], material: bpy.types.Material, semantic: str, *, sides: int = 16, waves: float = 0.0, caps: bool = True) -> bpy.types.Object:
    """Author an independently skinned, closed garment shell.

    ``rings`` carry (z, center_x, radius_x, radius_y).  They form actual
    volume, unlike a shrink-wrapped body material region, so cardigan, skirt,
    socks and shoes retain their silhouette at a distance.
    """
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for ring_index, (z, center_x, radius_x, radius_y) in enumerate(rings):
        for side in range(sides):
            theta = 2.0 * math.pi * side / sides
            ripple = 1.0 + waves * math.sin(theta * 5.0 + ring_index * 1.7)
            vertices.append((center_x + math.cos(theta) * radius_x * ripple, math.sin(theta) * radius_y * ripple, z))
    for ring_index in range(len(rings) - 1):
        for side in range(sides):
            next_side = (side + 1) % sides
            a = ring_index * sides + side
            b = ring_index * sides + next_side
            faces.append((a, b, b + sides, a + sides))
    if caps:
        # Cap meshes such as shoes, socks and skirts so they do not expose
        # an open substitute surface. Jacket and sleeve shells deliberately
        # use a collar/cuff opening instead of a flat shoulder cap.
        faces.append(tuple(range(sides - 1, -1, -1)))
        end = (len(rings) - 1) * sides
        faces.append(tuple(end + side for side in range(sides)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    _mesh_uv_from_rings(mesh, len(rings), sides)
    garment = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(garment)
    garment.parent = parent
    garment.data.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    ensure_uv_layers(garment)
    tag(garment, semantic, skinned=True, garment_construction="closed-authored-mesh", pbr_authored=True)
    # Skirts follow the pelvis as one authored garment. Automatic weights
    # stretched the pleats between thighs and turned the flare into a wedge.
    attach_skin(garment, rig, "Hips")
    return garment


def pleated_skirt(name: str, parent: bpy.types.Object, rig: bpy.types.Object, material: bpy.types.Material, semantic: str) -> bpy.types.Object:
    """Create the one free-hanging item of clothing as a sewn A-line shell.

    The waist stays on the CC0 body's dimensions while the two lower rows are
    deliberately flared and alternately pushed in/out to create physical
    pleats.  This is a garment pattern with a hem thickness, not a generic
    cylinder, and is rigidly attached to the pelvis to preserve the pattern
    under the existing retargetable animation clips.
    """
    sides = 28
    # (height, x radius, front/back radius). Ordered waist -> hem.
    rows = ((.805, .188, .145), (.655, .245, .172), (.475, .275, .190))
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for row_index, (z, radius_x, radius_y) in enumerate(rows):
        for side in range(sides):
            theta = math.tau * side / sides
            # Six broad, alternating box pleats read in both a full-body and
            # first-encounter camera without becoming a noisy radial tube.
            pleat = 1.0 + .055 * math.cos(theta * 6.0 + row_index * .42)
            vertices.append((math.cos(theta) * radius_x * pleat, math.sin(theta) * radius_y * pleat, z))
    for row_index in range(len(rows) - 1):
        for side in range(sides):
            next_side = (side + 1) % sides
            a = row_index * sides + side
            b = row_index * sides + next_side
            faces.append((a, b, b + sides, a + sides))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    _mesh_uv_from_rings(mesh, len(rows), sides)
    skirt = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(skirt)
    skirt.parent = parent
    skirt.data.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    solidify = skirt.modifiers.new("PleatedSkirt_HemAndSeamThickness", "SOLIDIFY")
    solidify.thickness = .008
    bpy.context.view_layer.objects.active = skirt
    skirt.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    skirt.select_set(False)
    ensure_uv_layers(skirt)
    tag(skirt, semantic, skinned=True, garment_construction="sewn-pleated-a-line-shell", pbr_authored=True)
    attach_skin(skirt, rig, "Hips")
    return skirt


def garment_sleeve(name: str, parent: bpy.types.Object, rig: bpy.types.Object, side: int, material: bpy.types.Material, semantic: str) -> bpy.types.Object:
    # An angled tapered sleeve: closed rings, not a rectangular arm proxy.
    return closed_garment(
        name,
        parent,
        rig,
        [(1.39, side * 0.31, 0.105, 0.10), (1.18, side * 0.40, 0.090, 0.09), (0.98, side * 0.47, 0.075, 0.075)],
        material,
        semantic,
        sides=14,
        waves=0.025,
        caps=False,
    )


def sneaker_mesh(name: str, parent: bpy.types.Object, rig: bpy.types.Object, side: int, material: bpy.types.Material, semantic: str) -> bpy.types.Object:
    """Closed sneaker volume elongated along the foot, not a vertical ball."""
    rings = 12
    sides = 14
    vertices: list[tuple[float, float, float]] = []
    for ring in range(rings):
        t = ring / (rings - 1)
        y = -.16 + t * .26
        # Toe box is wider/higher than heel, retaining a recognisable sneaker.
        toe = math.sin(t * math.pi)
        rx = .050 + toe * .018
        rz = .040 + toe * .014
        for segment in range(sides):
            theta = segment * math.tau / sides
            vertices.append((side * .16 + math.cos(theta) * rx, y, .095 + math.sin(theta) * (rz + .020)))
    faces: list[tuple[int, ...]] = [tuple(range(sides - 1, -1, -1))]
    for ring in range(rings - 1):
        for segment in range(sides):
            next_segment = (segment + 1) % sides
            start = ring * sides + segment
            faces.append((start, ring * sides + next_segment, (ring + 1) * sides + next_segment, (ring + 1) * sides + segment))
    end = (rings - 1) * sides
    faces.append(tuple(end + segment for segment in range(sides)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    _mesh_uv_from_rings(mesh, rings, sides)
    shoe = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(shoe)
    shoe.parent = parent
    shoe.data.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    ensure_uv_layers(shoe)
    tag(shoe, semantic, skinned=True, garment_construction="closed-authored-sneaker", pbr_authored=True)
    # Auto-weighting a closed toe volume across unrelated bones caused the
    # swollen, toe-exposing blob in the prior review render.
    attach_skin(shoe, rig, f"Shin_{'L' if side < 0 else 'R'}")
    return shoe


def hair_card(name: str, parent: bpy.types.Object, rig: bpy.types.Object, x: float, y: float, z_top: float, z_bottom: float, material: bpy.types.Material, semantic: str, bend: float, width: float = .028) -> bpy.types.Object:
    """Create a narrow, curved strand — never a back-of-head billboard."""
    segments = 11
    half = width
    vertices: list[tuple[float, float, float]] = []
    for row in range(segments + 1):
        t = row / segments
        z = z_top + (z_bottom - z_top) * t
        drift = bend * math.sin(t * math.pi * 0.9)
        # Tapered, curved cards avoid the prior rectangular helmet silhouette.
        side_sway = bend * .34 * math.sin(t * math.pi * 1.45)
        for column in (-1, 1):
            vertices.append((x + side_sway + column * half * (1.0 - t * .62), y + drift + .012 * math.sin(t * math.pi * 2.0), z))
    faces: list[tuple[int, int, int, int]] = []
    for row in range(segments):
        start = row * 2
        faces.append((start, start + 1, start + 3, start + 2))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].index
            row, column = divmod(vertex, 2)
            uv.data[loop_index].uv = (column, row / segments)
    card = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(card)
    card.parent = parent
    card.data.materials.append(material)
    solidify = card.modifiers.new("HairCard_Thickness", "SOLIDIFY")
    solidify.thickness = 0.012
    bpy.context.view_layer.objects.active = card
    card.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    card.select_set(False)
    ensure_uv_layers(card)
    tag(card, semantic, skinned=True, garment_construction="authored-hair-card", pbr_authored=True)
    # Cards are authored in head-local space; rigid binding prevents a card
    # from being spread across shoulders into a semicircular billboard.
    attach_skin(card, rig, "Head")
    return card


def hair_strand(name: str, parent: bpy.types.Object, rig: bpy.types.Object, points: list[tuple[float, float, float]], material: bpy.types.Material, semantic: str, radius: float = .008) -> bpy.types.Object:
    """Author a softly curved, individual hair strand and bake it to mesh.

    These small round strands replace the rectangular card panels that were
    visible from three-quarter and rear review cameras.  Their source points
    are placed around the scalp, sideburn and back-hair volume so the style is
    materially readable without pretending to be a scanned performer asset.
    """
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 4
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for control, coordinate in zip(spline.bezier_points, points):
        control.co = coordinate
        control.handle_left_type = "AUTO"
        control.handle_right_type = "AUTO"
    strand = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(strand)
    strand.parent = parent
    curve.materials.append(material)
    bpy.ops.object.select_all(action="DESELECT")
    strand.select_set(True)
    bpy.context.view_layer.objects.active = strand
    bpy.ops.object.convert(target="MESH")
    strand = bpy.context.object
    assert strand is not None
    ensure_uv_layers(strand)
    tag(strand, semantic, skinned=True, garment_construction="authored-curved-hair-strand", pbr_authored=True)
    attach_skin(strand, rig)
    return strand


def rear_hair_shell(name: str, parent: bpy.types.Object, rig: bpy.types.Object, material: bpy.types.Material, semantic: str) -> bpy.types.Object:
    """Build one continuous, head-attached rear hair curtain for Namra.

    This curved semi-shell is an authored, solidified profile from crown to
    shoulders. It replaces every separate card/tube so no floating rods or
    rectangular billboard can appear in the four-view delivery review.
    """
    columns = 18
    rows = ((1.78, .18, .115), (1.58, .245, .135), (1.34, .265, .150), (1.05, .225, .115))
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    # theta 0..pi traces the rear semicircle (positive local y); the exposed
    # side boundaries naturally continue the smooth scalp cap around ears.
    for z, radius_x, radius_y in rows:
        for column in range(columns):
            theta = math.pi * column / (columns - 1)
            vertices.append((math.cos(theta) * radius_x, math.sin(theta) * radius_y + .012, z))
    for row in range(len(rows) - 1):
        for column in range(columns - 1):
            index = row * columns + column
            faces.append((index, index + 1, index + 1 + columns, index + columns))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    _mesh_uv_from_rings(mesh, len(rows), columns)
    shell = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(shell)
    shell.parent = parent
    shell.data.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    solidify = shell.modifiers.new("ContinuousHair_Thickness", "SOLIDIFY")
    solidify.thickness = .012
    bpy.context.view_layer.objects.active = shell
    shell.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    shell.select_set(False)
    ensure_uv_layers(shell)
    tag(shell, semantic, skinned=True, garment_construction="continuous-rear-hair-shell", pbr_authored=True)
    attach_skin(shell, rig, "Head")
    return shell


def cardigan_detail(name: str, parent: bpy.types.Object, rig: bpy.types.Object, vertices: list[tuple[float, float, float]], material: bpy.types.Material, semantic: str) -> bpy.types.Object:
    """Create a small sewn collar/placket detail as a thick authored panel."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], [(0, 1, 2, 3)])
    mesh.update()
    mesh.uv_layers.new(name="UVMap")
    panel = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(panel)
    panel.parent = parent
    panel.data.materials.append(material)
    solidify = panel.modifiers.new("Sewn_Edge_Thickness", "SOLIDIFY")
    solidify.thickness = .007
    bpy.context.view_layer.objects.active = panel
    panel.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    panel.select_set(False)
    ensure_uv_layers(panel)
    tag(panel, semantic, skinned=True, garment_construction="authored-sewn-panel", pbr_authored=True)
    attach_skin(panel, rig, "Spine")
    return panel


def build_character_garments(key: str, body: bpy.types.Object, rig: bpy.types.Object, mats: dict[str, bpy.types.Material], namra: bool) -> None:
    # All wardrobe below is copied from the continuous CC0 body topology,
    # offset outwards, given cloth thickness and then weighted to the same
    # armature. It deliberately replaces the former cylinder/ring/box
    # wardrobe generator: shoulders, elbows, fingers and feet now inherit the
    # human mesh rather than approximating it with disconnected primitives.
    upper_material = mats["cardigan"] if namra else mats["fabric"]
    garment_surface(
        "Garment_Upper_Render",
        body,
        rig,
        upper_material,
        f"character.{key}.garment.upper",
        lambda point: .50 < point.z < 1.58,
        .019,
    )
    garment_surface(
        "Garment_Socks_Render",
        body,
        rig,
        mats["socks"],
        f"character.{key}.garment.socks",
        lambda point: .18 < point.z < .54,
        .017,
    )
    pleated_skirt("Garment_PleatedSkirt_Render", body.parent, rig, mats["skirt"], f"character.{key}.garment.pleated-skirt")
    # Cover the crown and rear scalp but never the face. The old `z > 1.55`
    # predicate duplicated the whole head in dark hair and produced a mask.
    garment_surface(
        "Hair_Scalp_Render",
        body,
        rig,
        mats["hair"],
        f"character.{key}.hair.scalp",
        lambda point: point.z > 1.75 or (point.z > 1.60 and point.y > -.005),
        .009,
    )
    if namra:
        rear_hair_shell("Hair_Rear_Continuous", body.parent, rig, mats["hair"], f"character.{key}.hair.rear-continuous")
    else:
        # A compact topology-derived scalp is the whole first-zombie haircut.
        # Short cards were visibly detached claws, so no loose card is used
        # until a human still review calls for a replacement hairstyle.
        pass


def animations(rig: bpy.types.Object, clips: list[str]) -> None:
    for index, clip in enumerate(clips):
        action = bpy.data.actions.new(clip)
        rig.animation_data_create()
        rig.animation_data.action = action
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="POSE")
        for bone_name in ("Spine", "UpperArm_L", "UpperArm_R", "Thigh_L", "Thigh_R"):
            bone = rig.pose.bones.get(bone_name)
            if bone is None:
                continue
            bone.rotation_mode = "XYZ"
            bone.rotation_euler = (0, 0, 0)
            bone.keyframe_insert(data_path="rotation_euler", frame=1)
            amplitude = 0.12 + (index % 3) * 0.08
            bone.rotation_euler = (amplitude if bone_name.endswith("L") else -amplitude, 0, amplitude * 0.5)
            bone.keyframe_insert(data_path="rotation_euler", frame=16)
            bone.rotation_euler = (0, 0, 0)
            bone.keyframe_insert(data_path="rotation_euler", frame=32)
        bpy.ops.object.mode_set(mode="OBJECT")


def character_root(key: str, profile: str, namra: bool = False) -> bpy.types.Object:
    root = empty(
        "Character_Root",
        None,
        f"character.{key}",
        character_key=key,
        review_status="replaceable-non-likeness-art; licensed likeness not asserted",
        replaceable_non_likeness=True,
        delivery_quality="cc0-human-topology-skinned-pbr-uv1",
        source_asset="Blender Human Base Meshes v1.4.1 (CC0)",
    )
    rig = armature(root, "namra-rooftop-v1" if namra else "zombie-common-v1")
    mats = character_materials(profile, namra)
    # The bundle provides a single realistic body mesh datablock instanced by
    # its catalog variants; delivery differentiation is original material and
    # clip data, never a claim about a specific person.
    body = human_mesh("GEO-body_female_realistic", "Body_Render")
    body.parent = root
    assign_character_materials(body, profile, mats, namra)
    tag(body, f"character.{key}.body", skinned=True, material_variant=profile, no_likeness_claim=True)
    attach_skin(body, rig)
    # The bundle keeps the realistic sclera meshes separate from the body.  In
    # the source atlas the body object lives at x=-1.34, so these are the
    # authored eye transforms expressed in the re-centred delivery space.
    human_eye("GEO-body_female_realistic.eye.L", "Eye_Sclera_L", (0.022, -0.134, 1.687), mats["sclera"], root, rig)
    human_eye("GEO-body_female_realistic.eye.R", "Eye_Sclera_R", (-0.051, -0.132, 1.687), mats["sclera"], root, rig)
    iris_disc("Eye_Iris_L", root, rig, (0.022, -0.150, 1.687), mats["iris"])
    iris_disc("Eye_Iris_R", root, rig, (-0.051, -0.148, 1.687), mats["iris"])
    build_character_garments(key, body, rig, mats, namra)
    if namra:
        animations(rig, ["Idle_Rooftop", "Detect_Threat", "Restrain"])
    else:
        animations(rig, ["Patrol", "Investigate", "Search", "Chase", "Capture"])
    return root


def select(root: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        current = obj
        while current.parent is not None:
            current = current.parent
        if current == root:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = root


def export(root: bpy.types.Object, key: str) -> None:
    select(root)
    bpy.ops.export_scene.gltf(
        filepath=str(RAW / f"{key}.raw.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_animations=True,
        export_force_sampling=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )


def main() -> None:
    routes = {
        "corridor": make_corridor,
        "infirmary": make_infirmary,
        "broadcast": make_broadcast,
        "utility": make_utility,
        "stairwell": make_stairwell,
        "rooftop": make_rooftop,
    }
    requested_route_keys = tuple(
        key.strip() for key in os.environ.get("LAST_BELL_ROUTE_KEYS", "").split(",") if key.strip()
    )
    if requested_route_keys:
        unknown = sorted(set(requested_route_keys).difference(routes))
        if unknown:
            raise RuntimeError(f"Unknown LAST_BELL_ROUTE_KEYS: {', '.join(unknown)}")
        route_items = [(key, routes[key]) for key in requested_route_keys]
    else:
        route_items = list(routes.items())
    BLENDERKIT_DERIVATIVE_USAGE.clear()
    BLENDERKIT_GEOMETRY_ONLY_IMPORTS.clear()
    for key, build in route_items:
        clear()
        export(build(), key)
        print(f"authored route {key}", flush=True)
    # v6c did not clear the human visual gate. Never silently regenerate those
    # failed deliverables while polishing a route; a new character experiment
    # must opt in and remain stage-only until separately approved.
    if os.environ.get("LAST_BELL_BUILD_EXPERIMENTAL_CHARACTERS") == "1":
        for key, profile, namra in (("zombie-student", "uniform", False), ("zombie-athletics", "athletic", False), ("zombie-staff", "staff", False), ("namra-rooftop", "uniform", True)):
            clear()
            export(character_root("namra.rooftop" if namra else key, profile, namra), key)
            print(f"experimental character {key}", flush=True)
    else:
        print("character delivery regeneration blocked; set LAST_BELL_BUILD_EXPERIMENTAL_CHARACTERS=1 for a private experiment", flush=True)
    write_polyhaven_route_model_provenance()
    write_blenderkit_environment_derivative_provenance()


if __name__ == "__main__":
    main()
