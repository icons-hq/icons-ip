#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLENDER_BIN="${LAST_BELL_BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
OUTPUT_ROOT="${LAST_BELL_PRODUCT_OUTPUT_ROOT:-$REPO_ROOT/outputs/last-bell-product-assets}"
CATALOG="$REPO_ROOT/scripts/last-bell-products/catalog.json"
PUBLIC_ROOT="$REPO_ROOT/public/generated/last-bell/products"
DOC_MANIFEST="$REPO_ROOT/docs/ip/all-of-us-are-dead-2/last-bell-product-asset-manifest.json"
STAGE="$OUTPUT_ROOT/delivery-stage"
WRITE_STAGE_MANIFEST="${LAST_BELL_PRODUCT_WRITE_STAGE_MANIFEST:-1}"
RENDER_TURNTABLE="${LAST_BELL_PRODUCT_RENDER_TURNTABLE:-0}"
RENDER_GAMEPLAY_REVIEW="${LAST_BELL_PRODUCT_RENDER_GAMEPLAY_REVIEW:-0}"
RENDER_DISCOVERY_REVIEW="${LAST_BELL_PRODUCT_RENDER_DISCOVERY_REVIEW:-0}"
FETCH_SHARED_PBR="${LAST_BELL_PRODUCT_FETCH_SHARED_PBR:-1}"

if [[ ! -x "$BLENDER_BIN" ]]; then
  echo "Missing Blender binary: $BLENDER_BIN" >&2
  exit 1
fi

cd "$REPO_ROOT"
mkdir -p "$OUTPUT_ROOT" "$STAGE"
if [[ "$FETCH_SHARED_PBR" == "1" ]]; then
  node "$REPO_ROOT/scripts/last-bell-3d/fetch-polyhaven-pbr.mjs" "$REPO_ROOT/outputs/last-bell-3d/raw/polyhaven-pbr"
fi
if ! node --input-type=module -e "await import('ktx2-encoder/gltf-transform')" >/dev/null 2>&1; then
  npm install --no-save --package-lock=false ktx2-encoder@0.6.0 @gltf-transform/core@4.4.2 @gltf-transform/extensions@4.4.2
fi
"$BLENDER_BIN" -b --python-exit-code 1 --python "$REPO_ROOT/scripts/last-bell-products/build.py" -- "$OUTPUT_ROOT" "$CATALOG" "$STAGE"

while IFS= read -r key; do
  mkdir -p "$STAGE/$key"
  node "$REPO_ROOT/scripts/last-bell-3d/compress-ktx2.mjs" "$OUTPUT_ROOT/raw/$key.raw.glb" "$OUTPUT_ROOT/raw/$key.ktx2.glb"
  npx --yes @gltf-transform/cli@4.4.2 meshopt "$OUTPUT_ROOT/raw/$key.ktx2.glb" "$STAGE/$key/model.glb" --level high
  node "$REPO_ROOT/scripts/last-bell-products/render-delivery.mjs" "$STAGE/$key/model.glb" "$OUTPUT_ROOT/renders/$key-delivery.png"
  cwebp -quiet -q 86 -m 6 -resize 512 512 "$OUTPUT_ROOT/renders/$key-delivery.png" -o "$STAGE/$key/thumbnail.webp"
done < <(node -e "for (const item of require(process.argv[1]).products) console.log(item.key)" "$CATALOG")

node "$REPO_ROOT/scripts/last-bell-products/validate.mjs" "$STAGE" "$CATALOG" "$OUTPUT_ROOT/validation-report.json"
if [[ "$RENDER_TURNTABLE" == "1" ]]; then
  node "$REPO_ROOT/scripts/last-bell-products/render-turntable.mjs" "$STAGE" "$CATALOG" "$OUTPUT_ROOT/review"
fi
if [[ "$RENDER_GAMEPLAY_REVIEW" == "1" ]]; then
  node "$REPO_ROOT/scripts/last-bell-products/render-gameplay-review.mjs" "$STAGE" "$CATALOG" "$OUTPUT_ROOT/review"
fi
if [[ "$RENDER_DISCOVERY_REVIEW" == "1" ]]; then
  node "$REPO_ROOT/scripts/last-bell-products/render-discovery-review.mjs" "$STAGE" "$CATALOG" "$OUTPUT_ROOT/review"
fi
if [[ "${LAST_BELL_VISUAL_REVIEW_APPROVED:-0}" != "1" ]]; then
  if [[ "$WRITE_STAGE_MANIFEST" == "1" ]]; then
    node "$REPO_ROOT/scripts/last-bell-products/update-manifest.mjs" "$CATALOG" "$OUTPUT_ROOT/validation-report.json" "$DOC_MANIFEST" stage
  fi
  echo "Delivery stage validated; public promotion is blocked pending human visual review." >&2
  exit 0
fi
RELEASE_EVIDENCE="${LAST_BELL_PRODUCT_RELEASE_EVIDENCE:-}"
PUBLIC_IN_GAME_EVIDENCE="${LAST_BELL_PRODUCT_PUBLIC_IN_GAME_EVIDENCE:-}"
PREFLIGHT_MANIFEST="$OUTPUT_ROOT/public-release-manifest-preflight.json"
if [[ "${LAST_BELL_IP_MANUFACTURING_APPROVED:-0}" == "1" ]]; then
  if [[ -z "$RELEASE_EVIDENCE" || ! -f "$RELEASE_EVIDENCE" ]]; then
    echo "Sales release requires LAST_BELL_PRODUCT_RELEASE_EVIDENCE to name an approval evidence JSON file." >&2
    exit 1
  fi
  RELEASE_MODE="public"
  REVIEW_EVIDENCE="$RELEASE_EVIDENCE"
elif [[ "${LAST_BELL_PUBLIC_IN_GAME_DELIVERY_APPROVED:-0}" == "1" ]]; then
  if [[ -z "$PUBLIC_IN_GAME_EVIDENCE" || ! -f "$PUBLIC_IN_GAME_EVIDENCE" ]]; then
    echo "Public in-game delivery requires LAST_BELL_PRODUCT_PUBLIC_IN_GAME_EVIDENCE." >&2
    exit 1
  fi
  RELEASE_MODE="public-in-game"
  REVIEW_EVIDENCE="$PUBLIC_IN_GAME_EVIDENCE"
else
  echo "Public promotion is blocked pending IP/manufacturing review or explicit in-game-only delivery review." >&2
  exit 1
fi
node "$REPO_ROOT/scripts/last-bell-products/update-manifest.mjs" "$CATALOG" "$OUTPUT_ROOT/validation-report.json" "$PREFLIGHT_MANIFEST" "$RELEASE_MODE" "$REVIEW_EVIDENCE"
node "$REPO_ROOT/scripts/last-bell-products/release-guard.mjs" "$PREFLIGHT_MANIFEST"
mkdir -p "$PUBLIC_ROOT"
for key in idcard badge photo radio kit zipup archery postcard candle blanket; do
  mkdir -p "$PUBLIC_ROOT/$key"
  cp "$STAGE/$key/model.glb" "$STAGE/$key/thumbnail.webp" "$STAGE/$key/graphic-layer.svg" "$PUBLIC_ROOT/$key/"
done
node "$REPO_ROOT/scripts/last-bell-products/update-manifest.mjs" "$CATALOG" "$OUTPUT_ROOT/validation-report.json" "$DOC_MANIFEST" "$RELEASE_MODE" "$REVIEW_EVIDENCE"
node "$REPO_ROOT/scripts/last-bell-products/release-guard.mjs" "$DOC_MANIFEST"
