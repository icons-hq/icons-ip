#!/usr/bin/env bash
# Build only the Last Bell corridor/rooftop recovery into an isolated private
# stage. It deliberately cannot copy into public/generated.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLENDER_BIN="${LAST_BELL_BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
OUTPUT="${LAST_BELL_ENVIRONMENT_RECOVERY_OUTPUT:-$REPO_ROOT/outputs/last-bell-environment-recovery-build}"
STAGE="$OUTPUT/delivery-stage"
BASELINE_STAGE="${LAST_BELL_ROUTE_BASELINE_STAGE:-$REPO_ROOT/outputs/last-bell-terra-authored-recovery/build-20260826/stage}"
OPENING_DELIVERY="${LAST_BELL_OPENING_DELIVERY:-$REPO_ROOT/public/generated/last-bell/3d}"

if [[ ! -x "$BLENDER_BIN" ]]; then
  echo "Missing Blender binary: $BLENDER_BIN" >&2
  exit 1
fi
if [[ ! -f "$BASELINE_STAGE/routes/infirmary.glb" || ! -f "$BASELINE_STAGE/characters/namra-rooftop.glb" ]]; then
  echo "Missing immutable private baseline stage: $BASELINE_STAGE" >&2
  exit 1
fi
if [[ -e "$STAGE/routes/corridor.glb" || -e "$STAGE/routes/rooftop.glb" ]]; then
  echo "Refusing to overwrite an existing recovery stage: $STAGE" >&2
  exit 1
fi

mkdir -p "$OUTPUT/raw" "$STAGE/routes" "$STAGE/characters"
for key in infirmary broadcast utility stairwell; do
  cp "$BASELINE_STAGE/routes/$key.glb" "$STAGE/routes/$key.glb"
done
for key in zombie-student zombie-athletics zombie-staff namra-rooftop; do
  cp "$BASELINE_STAGE/characters/$key.glb" "$STAGE/characters/$key.glb"
done

node "$REPO_ROOT/scripts/last-bell-3d/fetch-polyhaven-pbr.mjs" "$REPO_ROOT/outputs/last-bell-3d/raw/polyhaven-pbr"
# `painted-concrete-blocks` imports cleanly only before the corridor's many
# source-mesh node groups are loaded in Blender 5.2.  This build order still
# exports the same two isolated routes; it prevents the upstream importer
# iridescence-socket defect from changing the authored derivative.
LAST_BELL_ROUTE_KEYS=rooftop,corridor "$BLENDER_BIN" -b --python-exit-code 1 \
  --python "$REPO_ROOT/scripts/last-bell-route-assets/build.py" -- "$OUTPUT" "$STAGE" \
  2>&1 | tee "$OUTPUT/blender-build.log"

for key in corridor rooftop; do
  node "$REPO_ROOT/scripts/last-bell-3d/compress-ktx2.mjs" "$OUTPUT/raw/$key.raw.glb" "$OUTPUT/raw/$key.ktx2.glb" \
    | tee "$OUTPUT/$key-ktx2.log"
  npx --yes @gltf-transform/cli@4.4.2 meshopt "$OUTPUT/raw/$key.ktx2.glb" "$STAGE/routes/$key.glb" --level medium \
    | tee "$OUTPUT/$key-meshopt.log"
done

node "$REPO_ROOT/scripts/last-bell-route-assets/validate.mjs" "$STAGE" "$OUTPUT/validation-report.json" "$OPENING_DELIVERY" \
  | tee "$OUTPUT/validator.log"

for key in corridor rooftop; do
  node "$REPO_ROOT/scripts/last-bell-route-assets/render-review.mjs" "$OUTPUT/raw/$key.raw.glb" "$OUTPUT/review-$key-raw-1280x720.png" "$key" \
    | tee "$OUTPUT/review-$key-raw.log"
  node "$REPO_ROOT/scripts/last-bell-route-assets/render-review.mjs" "$STAGE/routes/$key.glb" "$OUTPUT/review-$key-delivery-1280x720.png" "$key" \
    | tee "$OUTPUT/review-$key-delivery.log"
done

node "$REPO_ROOT/scripts/last-bell-route-assets/validate-visual-quality.mjs" "$OUTPUT" "$OUTPUT/visual-quality-report.json" \
  | tee "$OUTPUT/visual-quality-validator.log"

echo "Private environment recovery stage complete: $OUTPUT"
