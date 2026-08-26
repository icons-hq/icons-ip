#!/usr/bin/env python3
"""Render a normalized, neutral review of a private DCC source GLB.

This script is intentionally separate from the delivery build. It gives the
human visual gate a consistent way to reject a source before topology cleanup,
composition or promotion work begins.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> tuple[Path, Path]:
    marker = sys.argv.index("--")
    return Path(sys.argv[marker + 1]).resolve(), Path(sys.argv[marker + 2]).resolve()


def scene_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, point.x)
            minimum.y = min(minimum.y, point.y)
            minimum.z = min(minimum.z, point.z)
            maximum.x = max(maximum.x, point.x)
            maximum.y = max(maximum.y, point.y)
            maximum.z = max(maximum.z, point.z)
    if not math.isfinite(minimum.x):
        raise RuntimeError("source contains no mesh bounds")
    return minimum, maximum


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = ((target - camera.location).to_track_quat("-Z", "Y")).to_euler()


source, destination = parse_args()
if not source.exists():
    raise FileNotFoundError(source)
destination.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source), import_shading="NORMALS")

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
minimum, maximum = scene_bounds(meshes)
dimensions = maximum - minimum
center = (minimum + maximum) * 0.5
largest = max(dimensions)
if largest <= 0:
    raise RuntimeError("source bounds are degenerate")

scale = 6.0 / largest
for obj in list(bpy.context.scene.objects):
    if obj.parent is None:
        obj.scale *= scale
bpy.context.view_layer.update()

minimum, maximum = scene_bounds(meshes)
center = (minimum + maximum) * 0.5
ground = minimum.z
offset = Vector((-center.x, -center.y, -ground))
for obj in list(bpy.context.scene.objects):
    if obj.parent is None:
        obj.location += offset
bpy.context.view_layer.update()

minimum, maximum = scene_bounds(meshes)
dimensions = maximum - minimum
center = (minimum + maximum) * 0.5

bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, -0.02))
floor = bpy.context.object
floor.name = "Review_Ground"
floor_material = bpy.data.materials.new("Review_Ground_Material")
floor_material.diffuse_color = (0.035, 0.042, 0.050, 1)
floor_material.roughness = 0.86
floor.data.materials.append(floor_material)

radius = max(3.0, dimensions.length * 0.62)
bpy.ops.object.camera_add(location=(radius * 0.72, -radius, max(2.6, dimensions.z * 0.72)))
camera = bpy.context.object
camera.data.lens = 52
camera.data.sensor_width = 36
point_camera(camera, Vector((0, 0, max(0.8, dimensions.z * 0.43))))
bpy.context.scene.camera = camera

for name, location, energy, size, color in (
    ("Review_Key", (-3.8, -4.8, 6.8), 980.0, 5.0, (0.72, 0.86, 1.0)),
    ("Review_Fill", (4.5, -1.0, 3.8), 560.0, 4.0, (0.32, 0.58, 0.72)),
    ("Review_Rim", (1.0, 5.0, 5.2), 760.0, 3.0, (1.0, 0.55, 0.30)),
):
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.name = name
    light.data.energy = energy
    light.data.shape = "DISK"
    light.data.size = size
    light.data.color = color
    point_camera(light, center)

world = bpy.context.scene.world or bpy.data.worlds.new("Review_World")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.008, 0.012, 0.018, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.22

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.filepath = str(destination)
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.render.image_settings.compression = 15
scene.render.use_file_extension = True

bpy.ops.wm.save_as_mainfile(filepath=str(destination.with_suffix(".blend")))
bpy.ops.render.render(write_still=True)

print(
    {
        "source": str(source),
        "destination": str(destination),
        "mesh_count": len(meshes),
        "normalized_dimensions": [round(value, 4) for value in dimensions],
    },
    flush=True,
)
