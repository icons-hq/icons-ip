#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLENDER_BIN="${LAST_BELL_BLENDER_BIN:-/tmp/last-bell-blender.atZjFO/Blender.app/Contents/MacOS/Blender}"
RAW_DIR="$REPO_ROOT/outputs/last-bell-3d"
PUBLIC_DIR="$REPO_ROOT/public/generated/last-bell/3d"
GLTF="npx --yes @gltf-transform/cli@4.4.2"

if [[ ! -x "$BLENDER_BIN" ]]; then
  echo "Missing Blender binary: $BLENDER_BIN" >&2
  exit 1
fi
mkdir -p "$RAW_DIR"
DELIVERY_STAGE="$(mktemp -d "$RAW_DIR/delivery-stage.XXXXXX")"
STAGE_DIR="$DELIVERY_STAGE/3d"
mkdir -p "$STAGE_DIR/lightmaps" "$STAGE_DIR/basis"

# The pinned Basis encoder is a build-only dependency. --no-save leaves the
# application manifest/lockfile untouched while making this pipeline portable.
npm install --no-save --package-lock=false \
  ktx2-encoder@0.6.0 \
  @gltf-transform/core@4.4.2 \
  @gltf-transform/extensions@4.4.2

node "$REPO_ROOT/scripts/last-bell-3d/fetch-polyhaven-pbr.mjs" "$RAW_DIR/raw/polyhaven-pbr"
node "$REPO_ROOT/scripts/last-bell-3d/prepare-damage-atlas.mjs" \
  "$REPO_ROOT/scripts/last-bell-3d/assets/last-bell-damage-atlas-v1.png" \
  "$RAW_DIR/raw/textures/damage-atlas-v1-keyed.png" \
  "$RAW_DIR/raw/damage-atlas-provenance.json"
"$BLENDER_BIN" -b --python-exit-code 1 --python "$REPO_ROOT/scripts/last-bell-3d/build.py" -- "$RAW_DIR"

for asset in entry start-room first-bay classroom-door; do
  node "$REPO_ROOT/scripts/last-bell-3d/compress-ktx2.mjs" "$RAW_DIR/raw/$asset.raw.glb" "$RAW_DIR/raw/$asset.ktx2.glb"
  $GLTF dedup "$RAW_DIR/raw/$asset.ktx2.glb" "$RAW_DIR/raw/$asset.dedup.glb"
  $GLTF instance "$RAW_DIR/raw/$asset.dedup.glb" "$RAW_DIR/raw/$asset.instances.glb" --min 2
  $GLTF meshopt "$RAW_DIR/raw/$asset.instances.glb" "$STAGE_DIR/$asset.glb" --level high
  $GLTF validate "$STAGE_DIR/$asset.glb"
done

for asset in entry start-room first-bay; do
  bake="$RAW_DIR/raw/bakes/$asset-static-ao.png"
  if [[ -f "$bake" ]]; then
    node "$REPO_ROOT/scripts/last-bell-3d/compress-static-ao.mjs" "$bake" "$STAGE_DIR/lightmaps/$asset-medium.ktx2"
  fi
done

cp "$REPO_ROOT/node_modules/three/examples/jsm/libs/basis/basis_transcoder.js" "$STAGE_DIR/basis/basis_transcoder.js"
cp "$REPO_ROOT/node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm" "$STAGE_DIR/basis/basis_transcoder.wasm"
node "$REPO_ROOT/scripts/last-bell-3d/validate.mjs" "$STAGE_DIR" "$RAW_DIR/raw"

# A validated GLB pack still needs human scene review. Keep it private by
# default and, when approved, merge only files this pipeline owns so streamed
# route/character assets cannot be deleted by a first-bay rebuild.
if [[ "${LAST_BELL_VISUAL_REVIEW_APPROVED:-0}" != "1" ]]; then
  echo "Environment delivery stage validated; public promotion is blocked pending human visual review: $STAGE_DIR"
  exit 0
fi
mkdir -p "$PUBLIC_DIR/lightmaps" "$PUBLIC_DIR/basis"
cp "$STAGE_DIR/"*.glb "$PUBLIC_DIR/"
cp "$STAGE_DIR/lightmaps/"*.ktx2 "$PUBLIC_DIR/lightmaps/"
cp "$STAGE_DIR/basis/"* "$PUBLIC_DIR/basis/"
rmdir "$DELIVERY_STAGE"
