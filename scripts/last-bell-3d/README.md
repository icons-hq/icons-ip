# Last Bell 3D source pipeline

고품질 3D 에셋 제작, 런타임 통합과 실제 플레이 검수는
[`high-fidelity-3d-game-workflow.md`](../../docs/agents/high-fidelity-3d-game-workflow.md)를 먼저 따른다.

`./scripts/last-bell-3d/build.sh` fetches the pinned, approved Poly Haven CC0
PBR subset (plus original procedural glass/blackboard/sign materials), exports
the four review-space GLBs with Blender, applies deduplication, GPU instancing,
Meshopt and Basis/KTX2 compression, validates the delivery GLBs, and writes
`metadata.json` for the runtime loader. The fetch script verifies pinned
upstream MD5 values and records source/direct/vendored hashes, authors and CC0
provenance in `outputs/last-bell-3d/raw/polyhaven-pbr/provenance.json`.

The same pinned CC0 subset includes `concrete_debris` and `broken_brick_wall`
for only the causal strike zones (not the full walking floor). A separately
generated, project-authored damage atlas is vendored at
`scripts/last-bell-3d/assets/last-bell-damage-atlas-v1.png`; preparation uses
a white-distance alpha key and edge decontamination, records relative-path
hash provenance in `outputs/last-bell-3d/raw/damage-atlas-provenance.json`,
and adds only local decals over real geometry. It contains no show-frame or
drama-image pixels.

Raw source maps, Blender file, static AO bake carriers, and still renders stay
under ignored `outputs/last-bell-3d/`. Runtime delivery files are built and
validated in ignored staging, then promoted together to
`public/generated/last-bell/3d/`; the previous delivery stays under `outputs/`
for recovery. The static-light outputs are explicitly ground-receiver Cycles AO
only; they are not a colored GI claim. Flashlight and door motion remain
runtime concerns.

## Evaluated corridor donor (not vendored)

Sketchfab's `The Japanese School Corridor` by `volvor` is listed as CC BY 4.0
and downloadable in its public metadata, but its official archive endpoint
requires an authenticated Sketchfab OAuth request before returning a temporary
signed URL. It is therefore not part of this reproducible unauthenticated
pipeline and no viewer/CDN asset has been copied. Re-evaluate it only with a
licensed authenticated download and attribution record: [model page](https://sketchfab.com/3d-models/the-japanese-school-corridor-f7775fea6fc34f518424ef9cad55c926), [metadata API](https://api.sketchfab.com/v3/models/f7775fea6fc34f518424ef9cad55c926), [official download API docs](https://sketchfab.com/developers/download-api/downloading-models).
