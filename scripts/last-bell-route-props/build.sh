#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLENDER_BIN="${LAST_BELL_BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
OUTPUT_ROOT="$REPO_ROOT/outputs/last-bell-route-props"
CATALOG="$REPO_ROOT/scripts/last-bell-route-props/catalog.json"
STAGE="$OUTPUT_ROOT/delivery-stage"

if [[ ! -x "$BLENDER_BIN" ]]; then
  echo "Missing Blender binary: $BLENDER_BIN" >&2
  exit 1
fi
if ! command -v cwebp >/dev/null; then
  echo "cwebp is required to produce compact delivery thumbnails." >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null; then
  echo "ffmpeg is required to produce the delivery contact sheet." >&2
  exit 1
fi

cd "$REPO_ROOT"
mkdir -p "$OUTPUT_ROOT" "$STAGE" "$OUTPUT_ROOT/review"
if ! node --input-type=module -e "await import('ktx2-encoder/gltf-transform')" >/dev/null 2>&1; then
  npm install --no-save --package-lock=false ktx2-encoder@0.6.0 @gltf-transform/core@4.4.2 @gltf-transform/extensions@4.4.2
fi
"$BLENDER_BIN" -b --python-exit-code 1 --python "$REPO_ROOT/scripts/last-bell-route-props/build.py" -- "$OUTPUT_ROOT" "$CATALOG" "$STAGE"

while IFS= read -r key; do
  mkdir -p "$STAGE/$key"
  node "$REPO_ROOT/scripts/last-bell-3d/compress-ktx2.mjs" "$OUTPUT_ROOT/raw/$key.raw.glb" "$OUTPUT_ROOT/raw/$key.ktx2.glb"
  npx --yes @gltf-transform/cli@4.4.2 meshopt "$OUTPUT_ROOT/raw/$key.ktx2.glb" "$STAGE/$key/model.glb" --level high
  node "$REPO_ROOT/scripts/last-bell-products/render-delivery.mjs" "$STAGE/$key/model.glb" "$OUTPUT_ROOT/renders/$key-delivery.png"
  cwebp -quiet -q 86 -m 6 -resize 512 512 "$OUTPUT_ROOT/renders/$key-delivery.png" -o "$STAGE/$key/thumbnail.webp"
done < <(node -e "for (const item of require(process.argv[1]).props) console.log(item.key)" "$CATALOG")

node "$REPO_ROOT/scripts/last-bell-route-props/validate.mjs" "$STAGE" "$CATALOG" "$OUTPUT_ROOT/validation-report.json"
ffmpeg -y -loglevel error \
  -i "$STAGE/classroom-desk-chair/thumbnail.webp" -i "$STAGE/locker-bank/thumbnail.webp" -i "$STAGE/broken-fluorescent/thumbnail.webp" \
  -i "$STAGE/debris-cluster/thumbnail.webp" -i "$STAGE/rooftop-hvac/thumbnail.webp" -i "$STAGE/campfire-kit/thumbnail.webp" \
  -filter_complex "[0:v]scale=384:384[a];[1:v]scale=384:384[b];[2:v]scale=384:384[c];[3:v]scale=384:384[d];[4:v]scale=384:384[e];[5:v]scale=384:384[f];[a][b][c]hstack=inputs=3[top];[d][e][f]hstack=inputs=3[bottom];[top][bottom]vstack=inputs=2" \
  -frames:v 1 "$OUTPUT_ROOT/review/route-props-delivery-contact-sheet.png"
echo "Stage-only route prop delivery built at $STAGE; no public assets or manifests were changed."
