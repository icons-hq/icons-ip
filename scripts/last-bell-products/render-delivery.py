#!/usr/bin/env python3
"""Render a stable catalog thumbnail by importing the delivery GLB itself."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


def args() -> tuple[Path, Path]:
    marker = sys.argv.index("--")
    return Path(sys.argv[marker + 1]).resolve(), Path(sys.argv[marker + 2]).resolve()


MODEL, OUTPUT = args()


def aim(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(MODEL))
    for obj in bpy.context.scene.objects:
        if obj.name.startswith("COL_") or obj.name.startswith("LOD1_") or (obj.parent and obj.parent.name.startswith("LOD1_")):
            obj.hide_render = True
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.009, 0.011, 0.014)
    bpy.ops.object.light_add(type="AREA", location=(3.2, -4.0, 4.3))
    key = bpy.context.object
    key.data.energy = 750
    key.data.shape = "DISK"
    key.data.size = 4.0
    aim(key, (0, 0, 0.75))
    bpy.ops.object.light_add(type="AREA", location=(-3.0, -1.6, 2.4))
    fill = bpy.context.object
    fill.data.energy = 230
    fill.data.color = (0.23, 0.65, 0.7)
    fill.data.size = 3.0
    aim(fill, (0, 0, 0.7))
    bpy.ops.object.camera_add(location=(2.0, -3.15, 1.85))
    camera = bpy.context.object
    camera.data.lens = 55
    aim(camera, (0, 0, 0.72))
    scene.camera = camera
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(OUTPUT)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
