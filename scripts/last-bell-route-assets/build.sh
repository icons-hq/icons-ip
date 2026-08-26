#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLENDER_BIN="${LAST_BELL_BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
OUTPUT="$REPO_ROOT/outputs/last-bell-product-assets/route-character-assets"
DELIVERY="$REPO_ROOT/public/generated/last-bell/3d"
# A private opening rebuild can validate together with the private route pack;
# production defaults remain fail-closed against the published opening pack.
OPENING_DELIVERY="${LAST_BELL_OPENING_DELIVERY:-$DELIVERY}"
STAGE="$OUTPUT/delivery-stage"
if [[ ! -x "$BLENDER_BIN" ]]; then echo "Missing Blender binary: $BLENDER_BIN" >&2; exit 1; fi
mkdir -p "$OUTPUT" "$STAGE/routes" "$STAGE/characters"
node "$REPO_ROOT/scripts/last-bell-3d/fetch-polyhaven-pbr.mjs" "$REPO_ROOT/outputs/last-bell-3d/raw/polyhaven-pbr"
if ! node --input-type=module -e "await import('ktx2-encoder/gltf-transform')" >/dev/null 2>&1; then
  npm install --no-save --package-lock=false ktx2-encoder@0.6.0 @gltf-transform/core@4.4.2 @gltf-transform/extensions@4.4.2
fi
"$BLENDER_BIN" -b --python-exit-code 1 --python "$REPO_ROOT/scripts/last-bell-route-assets/build.py" -- "$OUTPUT" "$STAGE"
for key in corridor infirmary broadcast utility stairwell rooftop; do
  node "$REPO_ROOT/scripts/last-bell-3d/compress-ktx2.mjs" "$OUTPUT/raw/$key.raw.glb" "$OUTPUT/raw/$key.ktx2.glb"
  npx --yes @gltf-transform/cli@4.4.2 meshopt "$OUTPUT/raw/$key.ktx2.glb" "$STAGE/routes/$key.glb" --level medium
done
for key in zombie-student zombie-athletics zombie-staff namra-rooftop; do
  node "$REPO_ROOT/scripts/last-bell-3d/compress-ktx2.mjs" "$OUTPUT/raw/$key.raw.glb" "$OUTPUT/raw/$key.ktx2.glb"
  npx --yes @gltf-transform/cli@4.4.2 meshopt "$OUTPUT/raw/$key.ktx2.glb" "$STAGE/characters/$key.glb" --level medium
done
node "$REPO_ROOT/scripts/last-bell-route-assets/validate.mjs" "$STAGE" "$OUTPUT/validation-report.json" "$OPENING_DELIVERY"

# Automated asset contracts prove delivery integrity, not the human visual
# approval required for a public character/route promotion.  Keep every raw
# rebuild in the private stage until that review explicitly approves it.
if [[ "${LAST_BELL_VISUAL_REVIEW_APPROVED:-0}" != "1" ]]; then
  echo "Delivery stage validated; public promotion is blocked pending human visual review."
  exit 0
fi

VISUAL_EVIDENCE="${LAST_BELL_VISUAL_REVIEW_EVIDENCE:-}"
if [[ -z "$VISUAL_EVIDENCE" || ! -f "$VISUAL_EVIDENCE" ]]; then
  echo "Public promotion requires LAST_BELL_VISUAL_REVIEW_EVIDENCE with build-matched human review evidence." >&2
  exit 1
fi

# Build and guard a complete candidate before any public file or release
# metadata is changed.  The candidate includes retained source-archive GLBs
# because those public files must not carry a prohibited production marker.
CANDIDATE="$(mktemp -d "$OUTPUT/release-candidate.XXXXXX")"
trap 'rm -rf "$CANDIDATE"' EXIT
mkdir -p "$CANDIDATE/routes" "$CANDIDATE/characters" "$CANDIDATE/campaign"
cp "$STAGE/routes/"*.glb "$CANDIDATE/routes/"
cp "$STAGE/characters/"*.glb "$CANDIDATE/characters/"
cp "$DELIVERY/campaign/two-chapter-route.glb" \
  "$DELIVERY/campaign/zombie-shared-rig.glb" \
  "$DELIVERY/campaign/character-namra-rooftop.glb" \
  "$CANDIDATE/campaign/"
CANDIDATE_SEAMS="$CANDIDATE/last-bell-character-asset-seams.json"
CANDIDATE_RELEASE="$CANDIDATE/last-bell-release-manifest.json"
node "$REPO_ROOT/scripts/last-bell-route-assets/update-manifest.mjs" \
  "$OUTPUT/validation-report.json" "$CANDIDATE_SEAMS" "$VISUAL_EVIDENCE"
cp "$REPO_ROOT/docs/ip/all-of-us-are-dead-2/last-bell-release-manifest.json" "$CANDIDATE_RELEASE"
node "$REPO_ROOT/scripts/last-bell-route-assets/update-release-manifest.mjs" \
  "$CANDIDATE_SEAMS" "$CANDIDATE_RELEASE"
node "$REPO_ROOT/scripts/last-bell-route-assets/release-guard.mjs" \
  "$CANDIDATE" "$CANDIDATE_SEAMS" "$CANDIDATE_RELEASE"

mkdir -p "$DELIVERY/routes" "$DELIVERY/characters"
cp "$STAGE/routes/"*.glb "$DELIVERY/routes/"
cp "$STAGE/characters/"*.glb "$DELIVERY/characters/"
cp "$CANDIDATE_SEAMS" "$REPO_ROOT/docs/ip/all-of-us-are-dead-2/last-bell-character-asset-seams.json"
cp "$CANDIDATE_RELEASE" "$REPO_ROOT/docs/ip/all-of-us-are-dead-2/last-bell-release-manifest.json"
node "$REPO_ROOT/scripts/last-bell-route-assets/update-release-manifest.mjs" \
  "$REPO_ROOT/docs/ip/all-of-us-are-dead-2/last-bell-character-asset-seams.json" \
  "$REPO_ROOT/docs/ip/all-of-us-are-dead-2/last-bell-release-manifest.json" \
  "$REPO_ROOT/docs/ip/all-of-us-are-dead-2/asset-provenance.md" \
  "$REPO_ROOT/docs/ip/all-of-us-are-dead-2/qa-report.md"
node "$REPO_ROOT/scripts/last-bell-route-assets/release-guard.mjs" \
  "$DELIVERY" \
  "$REPO_ROOT/docs/ip/all-of-us-are-dead-2/last-bell-character-asset-seams.json" \
  "$REPO_ROOT/docs/ip/all-of-us-are-dead-2/last-bell-release-manifest.json"
