# High-fidelity 3D game production workflow

> 고품질 3D 브라우저 게임의 신규 vertical slice, 환경·캐릭터 에셋, 조명, 상호작용, 성능 polish에 사용하는 공용 runbook

이 문서는 특정 게임의 장면을 복제하지 않는다. **좋은 3D 결과가 반복해서 나오는 제작 순서와 품질 게이트**를 고정한다. Three.js, React Three Fiber, Babylon.js, PlayCanvas 등 런타임은 달라도 같은 문법을 사용하며, 웹 배포 에셋은 별도 요구가 없으면 GLB/glTF 2.0을 기본으로 한다.

## 공통 슬롯

| 슬롯 | 채워야 하는 값 |
| --- | --- |
| `[GAME_FANTASY]` | 플레이어가 어떤 존재가 되어 무엇을 느끼는가 |
| `[PLAYER_VERBS]` | 이동, 관찰, 조작, 회피, 전투처럼 반복하는 핵심 행동 |
| `[VERTICAL_SLICE]` | 이번 iteration에서 처음부터 끝까지 완성할 짧은 플레이 구간 |
| `[REFERENCE_SET]` | 공간, 비례, 재질, 조명, 카메라의 시각 정본 |
| `[SCENE_CONTRACT]` | 좌표계, 단위, spawn, lane, portal, semantic anchor |
| `[INTERACTION_CONTRACT]` | 입력, 상태 전이, collider, animation, 완료 조건 |
| `[ASSET_PACK]` | scene, prop, character, material, texture, lightmap, collision 묶음 |
| `[PERFORMANCE_BUDGET]` | 전송량, 메모리, draw calls, triangles, frame time, FPS 목표 |
| `[TARGET_MATRIX]` | 기기, viewport, 브라우저, 입력 방식, 품질 tier |
| `[EVIDENCE]` | still, screenshot, 영상, validator, 로그, 측정값 |

## 품질 불변식

1. 한 번에 하나의 짧고 완결된 `[VERTICAL_SLICE]`를 만든다. P0가 남은 상태에서 다음 공간이나 Chapter를 확장하지 않는다.
2. 실사감은 폴리곤·텍스처 해상도 하나로 만들지 않는다. **실제 비례 → 두께와 bevel → 구조적 detail → PBR roughness/normal → 조명 → 접촉감 → 카메라** 순서로 만든다.
3. `[REFERENCE_SET]`은 관찰의 진실원이다. 생성 concept는 방향 탐색에 쓰고, 사용자가 승인한 뒤에만 정본이 된다.
4. simulation은 gameplay state를 소유하고 renderer는 표현을 소유한다. scene callback이나 mesh transform이 게임 규칙의 진실원이 되지 않는다.
5. gameplay는 asset filename 대신 manifest key와 semantic anchor를 사용한다. geometry를 교체해도 `[SCENE_CONTRACT]`와 `[INTERACTION_CONTRACT]`는 유지한다.
6. authored asset이 정상 golden path다. procedural geometry는 명시적인 load/decode 실패 때만 쓰는 기능 복구 경로로 두되, **production의 hero character·적·상품을 primitive proxy로 표시하지 않는다.** 환경 기능 복구용 proxy도 시각 승인 증거로 사용할 수 없다.
7. DCC still이 승인되기 전에 런타임 최적화와 대규모 통합을 시작하지 않는다. 런타임 캡처가 승인되기 전에 다음 slice로 넘어가지 않는다.
8. 품질 판정은 구현자의 설명보다 `[EVIDENCE]`를 우선한다. 최종 시각 검수는 구현과 분리한다.
9. source, license, hash와 파생 이력을 에셋과 함께 추적한다. reference pixel을 shipping texture로 쓰려면 별도 권리와 provenance가 있어야 한다.
10. 기존 사용자 변경을 보존하고 commit, push, 배포, production 변경은 승인 범위에서만 수행한다.
11. 자동 validator는 파일 구조·계약·예산을 검증할 뿐 최종 시각 승인을 대신하지 않는다. `no_clay_primitive_final=true` 같은 최종 플래그는 동일 build의 비교 still과 독립 human visual gate에서 P0가 0개일 때만 기록한다. 승인 증거에는 `reviewer_type=human`, reviewer 식별자, 검수 시각, 검수한 build ID, `p0_findings=0`, 각 비교 렌더의 경로와 SHA-256, 카메라 ID·FOV·노출·해상도를 함께 남긴다. release gate는 해당 경로의 실제 파일을 다시 읽어 SHA-256과 build ID 일치를 확인하며, 승인 문자열만 있거나 렌더가 누락·변경됐거나 다른 카메라 조건이면 실패해야 한다.
12. `placeholder`, `technical-mountable`, `non-likeness`, `pending replacement` 상태와 최종 시각 승인 상태는 동시에 존재할 수 없다. production manifest가 두 상태를 함께 선언하면 validator가 실패해야 한다. 밑줄·하이픈으로 결합한 `technical-mountable-placeholder`, `non_likeness_placeholder`, `PENDING_APPROVED_CHARACTER_REPLACEMENT`도 같은 금지 토큰으로 정규화해 검사한다.

## 역할과 분업

| 역할 | 기본 모델 | 책임 | 파일 소유권 |
| --- | --- | --- | --- |
| 통합 담당 | 현재 root agent | repo truth, slice 범위, 계약, 작업 분해, 통합, 최종 handoff | 전체를 읽고 편집 충돌을 방지한다 |
| 설계·아트 디렉터 | `gpt-5.6-sol`, reasoning `max` | 그릴링, research synthesis, reference matrix, slice spec, 시각 P0/P1/P2 | 원칙상 구현 파일을 쓰지 않는다 |
| 3D 에셋 담당 | `gpt-5.6-terra`, reasoning `xhigh` | DCC scene, PBR, UV, bake, GLB/glTF, 압축, provenance, validator | asset source와 asset pipeline만 편집한다 |
| 런타임 담당 | `gpt-5.6-terra`, reasoning `xhigh` | loader, simulation 연결, interaction, collision, camera, lighting, tests, performance | runtime과 gameplay integration만 편집한다 |
| 독립 최종 검수 | `gpt-5.6-sol`, reasoning `max` | reference와 실제 플레이 결과 비교, P0/P1/P2 판정 | 결과를 읽고 원칙상 구현하지 않는다 |

공유 filesystem에서 두 에이전트가 같은 파일을 동시에 편집하지 않는다. 에셋과 런타임의 계약이 먼저 잠겼을 때만 두 Terra 작업을 병렬화한다.

## 제작 폐쇄 루프

```text
Preflight
  → Grill·사용자 확정
  → Reference research
  → Architecture·slice contract
  → DCC blockout·authored asset
  → Still render·Sol visual gate
  → Optimize·package·validate
  → Runtime integration
  → Real playtest·performance capture
  → Independent Sol acceptance
  → Docs·handoff
```

각 화살표는 다음 단계로 넘어가기 위한 gate다. 완료 조건이 충족되지 않으면 직전 제작 단계로 돌아간다.

## 0. Preflight — 현재 게임의 진실원 찾기

다음을 코드와 실제 실행 상태에서 조사한다.

- engine, renderer, scene/level 구조
- simulation loop와 render loop의 소유권
- player state, camera, input action map
- collision/physics와 interaction state
- story, quest, objective, cutscene, dialogue, audio
- save/checkpoint와 transition
- asset manifest, loader, quality tier, fallback
- 현재 에셋, source file, license, build pipeline
- test, asset validator, browser QA, performance probe

기존 변경과 이번 작업 파일을 분리하고, 재사용할 시스템과 추가할 최소 seam을 정리한다.

완료 조건: 현재 구조, 마지막 playable state, 유지할 계약, 수정할 파일, 실행할 검증 명령이 기록되어 있다.

## 1. Grill — 게임과 slice를 잠그기

구현 전에 결과를 크게 바꾸는 항목을 확정한다.

- `[GAME_FANTASY]`와 `[PLAYER_VERBS]`
- 시작 장면, 종료 장면, 목표 플레이 시간
- 아트 스타일과 `[REFERENCE_SET]`
- camera와 input 방식
- 핵심 interaction과 실패·복구 상태
- `[TARGET_MATRIX]`와 `[PERFORMANCE_BUDGET]`
- asset 권리와 교체 예정 항목
- 이번 `[VERTICAL_SLICE]`와 명시적 비범위

결정 로그를 사용자에게 요약하고 `확정`을 받는다. 확정 뒤 repo에서 판단 가능한 세부사항은 계속 진행한다.

완료 조건: 처음 10초, 핵심 행동, 마지막 10초와 비범위를 한 문단으로 설명할 수 있다.

## 2. Reference research — 보이는 결과를 수치와 문법으로 바꾸기

`[REFERENCE_SET]`을 다음 관찰 항목으로 분해한다.

| 항목 | 기록할 내용 |
| --- | --- |
| 공간 | 크기, 동선, 소실점, 입구와 다음 공간의 관계 |
| 비례 | 문, 창, 가구, 캐릭터, 손잡이, 천장 높이 |
| 재질 | BaseColor 범위, roughness, normal scale, 금속/비금속 |
| 구조 | 실제 두께, 접합부, bevel, 파손 단면, 지지 구조 |
| 조명 | key/fill/rim, 색온도, negative fill, 노출, 그림자 |
| 분위기 | fog, dust, particle, wetness, sound bed의 역할 |
| 카메라 | eye height, FOV, framing, motion, focal point |
| gameplay | 이동 lane, 목표 가독성, 상호작용 거리, 위험 시야 |

기술 선택은 공식 engine·DCC·format 문서로 검증한다. 외부 asset은 원 배포처의 license, author, download, hash를 기록한다.

완료 조건: 각 주요 시각 결정이 reference observation 또는 명시적인 authored 결정으로 추적된다.

## 3. Architecture — 에셋과 게임 규칙 사이의 계약 만들기

구현 전에 다음을 잠근다.

### Runtime contract

- simulation fixed step 또는 update ownership
- renderer와 UI가 읽을 snapshot
- action 기반 input map
- pause, focus loss, menu, pointer/camera handoff
- serializable save/checkpoint boundary
- debug와 performance surface

### 3D contract

- meter 단위, up/forward axis, world origin
- spawn, camera handoff, portal과 playable lane
- stable semantic node/anchor naming
- pivots와 animation origin
- static/dynamic mesh 구분
- collision proxy와 passable threshold
- lighting 방식: dynamic, baked, hybrid
- LOD, culling, instancing, shadow ownership

### Loading contract

- boot에 필요한 core asset
- 첫 플레이 뒤 deferred asset
- decoder와 texture transcoder 경로
- loading, decode failure, context loss recovery
- asset pack의 atomic version/build ID

완료 조건: 3D 에셋 담당과 런타임 담당이 같은 좌표·node·interaction·loading 계약으로 독립 작업할 수 있다.

## 4. Budget — 품질을 깎기 전에 예산 정하기

프로젝트와 `[TARGET_MATRIX]`에 맞춰 구현 전에 값을 채운다.

| 항목 | Target | Hard cap | 측정 방법 |
| --- | ---: | ---: | --- |
| initial 3D transfer | `[VALUE]` | `[VALUE]` | network log |
| total scene transfer | `[VALUE]` | `[VALUE]` | asset manifest |
| texture memory | `[VALUE]` | `[VALUE]` | renderer/GPU probe |
| draw calls | `[VALUE]` | `[VALUE]` | stable gameplay capture |
| visible triangles | `[VALUE]` | `[VALUE]` | stable gameplay capture |
| CPU/GPU frame time | `[VALUE]` | `[VALUE]` | performance trace |
| minimum FPS | `[VALUE]` | `[VALUE]` | target-device session |
| loading-to-control | `[VALUE]` | `[VALUE]` | cold-load timing |

예산을 넘으면 먼저 unique material, oversized texture, unculled space, shadow caster, post-processing, decode timing을 조사한다. 시각 정체성을 담당하는 hero silhouette부터 제거하지 않는다.

완료 조건: 모든 hard cap에 측정 방법과 실패 시 조정 우선순위가 있다.

## 5. DCC authoring — 찰흙 blockout을 최종 장면으로 바꾸기

### 5.1 Blockout

1. 실제 단위로 공간과 hero prop을 배치한다.
2. player eye height와 camera FOV로 lane, portal, 목표 가독성을 확인한다.
3. interaction anchor와 collision proxy를 임시 geometry로 검증한다.

### 5.2 Structural pass

1. 벽·바닥·문·창에 실제 두께와 접합부를 만든다.
2. silhouette에 기여하는 edge에 bevel을 준다.
3. 큰 손상과 구조 detail은 geometry로 만든다.
4. 반복 소품은 linked mesh 또는 instance로 구성한다.

### 5.3 Material pass

1. 실제 물리 크기에 맞춰 UV0와 texel density를 맞춘다.
2. BaseColor, roughness, normal, metalness/occlusion 역할을 분리한다.
3. 큰 변화는 geometry, 중간 변화는 layered material/mesh, 미세 변화는 normal·roughness·decal로 만든다.
4. 접촉 AO나 baked lighting용 보조 UV가 필요하면 겹치지 않게 별도 작성한다.
5. texture 해상도는 화면 점유율에 맞춘다.

### 5.4 Lighting pass

1. reference의 key direction과 negative fill을 먼저 맞춘다.
2. gameplay focal point만 의도적으로 노출한다.
3. shadow는 hero object와 접촉감에 우선 사용한다.
4. fog, dust, particle과 post-processing은 구도와 depth를 보강하는 최소 비용으로 사용한다.

source scene, raw export, bake와 still은 staging/ignored output에 둔다. 검증 전 partial asset을 runtime delivery와 섞지 않는다.

완료 조건: texture를 끄거나 낮춰도 공간 비례, 구조, silhouette와 interaction focal point가 읽힌다.

## 6. Still gate — 런타임 전에 시각 P0 닫기

DCC에서 최소 네 시점을 렌더한다.

1. entry 또는 첫 impression
2. 실제 gameplay camera
3. 핵심 interaction focal point
4. 다음 공간 reveal 또는 위험 상태

Sol max 아트 디렉터가 `[REFERENCE_SET]`과 비교해 판정한다.

### P0

- 공간·시대·장르·아트 스타일이 다르게 읽힘
- 실제 두께와 bevel이 없어 찰흙·종이·플라스틱처럼 보임
- scale, pivot, lane, portal 또는 focal point가 틀림
- 구조적 이유 없는 random clutter와 반복 복사 look
- 빈 공간, 검은 cap, 잘못 연결된 transition
- 넓은 ambient fill로 reference contrast가 사라짐
- unlicensed source나 승인되지 않은 reference pixel이 asset에 포함됨

### P1

핵심 가능성은 유지되지만 국부 조명, 반복 대비, 작은 가림, 미세 material variation이 부족한 상태다.

P0가 하나라도 있으면 DCC 단계로 돌아간다. 최적화는 P0가 0개일 때 시작한다.

완료 조건: 승인 still과 P0=0, 기록된 P1 목록이 있다. 각 still은 실제 검수한 파일의 SHA-256과 gameplay camera 조건을 포함하며 승인 대상 build ID와 일치한다.

## 7. Package — runtime-ready asset 만들기

1. transform, scale, pivot, orientation을 정규화한다.
2. hierarchy와 semantic node 이름을 validator 계약에 맞춘다.
3. unused data를 prune하고 geometry/material을 deduplicate한다.
4. 반복 mesh는 instance로 바꾼다.
5. 런타임과 맞는 geometry compression 하나를 선택한다.
6. texture는 지원되는 GPU-friendly format으로 압축한다.
7. collision proxy, animation clip, LOD와 baked-light binding을 검증한다.
8. provenance와 build report를 생성한다.
9. 파일, metadata, decoder를 하나의 versioned `[ASSET_PACK]`으로 승격한다.

브라우저 3D 기본값은 GLB/glTF 2.0, glTF Transform, Meshopt 또는 Draco, KTX2/BasisU다. 실제 선택은 engine support와 decode 비용을 측정해 하나로 고정한다.

Validator는 최소한 다음을 실패시킨다.

- 필수 semantic node 누락
- bounds, scale, axis, pivot 불일치
- 비정상 material 수와 texture budget 초과
- collision/LOD/lightmap 계약 누락
- unsupported extension 또는 decoder 누락
- transfer hard cap 초과
- provenance 또는 hash 불일치
- production hero asset의 placeholder·technical-only·pending-replacement marker
- 최종 승인으로 선언된 캐릭터·상품의 primitive-only silhouette 또는 필요한 PBR texture/UV·skinning·animation 부재
- human visual gate 증거 없이 설정된 최종 시각 승인 플래그

완료 조건: validator가 green이고 public/runtime target에는 한 build의 파일만 존재한다.

## 8. Runtime integration — 에셋을 실제 게임으로 만들기

1. core asset은 병렬 준비하고 이후 공간은 player path에 맞춰 deferred load한다.
2. simulation state를 renderer 밖에 두고 scene은 snapshot을 표현한다.
3. interaction animation은 하나의 authoritative state progress를 읽는다.
4. collider와 visual mesh의 passable 상태를 같은 threshold로 연결한다.
5. 실제 이동으로 portal을 통과하게 하고 transition shortcut은 spec에 있을 때만 쓴다.
6. 닫힌 공간과 보이지 않는 영역은 portal/occlusion/distance rule로 cull한다.
7. 반복 prop shadow를 제한하고 hero interaction에 shadow budget을 집중한다.
8. HUD와 menu는 playfield를 가리지 않는 별도 UI layer로 관리한다.
9. loading, fallback, quality tier, loaded asset, bounds, renderer stats를 debug surface에서 관찰 가능하게 한다.
10. procedural fallback은 authored 환경 pack이 실패한 경우에만 명시적인 복구 상태로 mount한다. 캐릭터·적·hero 상품 실패는 proxy를 노출하지 않고 조우나 상호작용을 보류한 뒤 retry를 제공한다.

완료 조건: `[PLAYER_VERBS]`와 `[INTERACTION_CONTRACT]`가 authored asset 위에서 처음부터 끝까지 플레이된다.

## 9. Real playtest — 캔버스가 아니라 플레이 경험 검증하기

`[TARGET_MATRIX]`의 실제 browser/device/input 조합에서 다음을 수행한다.

- cold boot부터 첫 조작 가능 시점
- 모든 primary verb
- camera control과 reset
- 핵심 interaction의 접근·실행·완료
- scene transition과 streaming stall
- collision proxy와 visual mesh 정합
- HUD, menu, pause, focus loss, resize, pointer/camera handoff
- failure, restart, checkpoint restore
- renderer fallback과 context-loss recovery
- 대표 상태의 visual stability와 performance budget

WebGL/canvas 게임은 screenshot 또는 영상이 필수다. DOM assertion만으로 시각 승인하지 않는다. 성능 cliff는 SpectorJS, browser performance trace, engine stats로 capture한 뒤 원인을 판단한다.

각 대표 상태에서 다음 `[EVIDENCE]`를 남긴다.

```text
State: [BOOT | GAMEPLAY | INTERACTION | TRANSITION | FAILURE | RECOVERY]
Visual: [SCREENSHOT_OR_VIDEO]
Input path: [REPRO_STEPS]
Assets: [REQUEST_STATUS_AND_BUILD_ID]
Console: [ERRORS_AND_WARNINGS]
Renderer: [CALLS, TRIANGLES, MEMORY, FRAME_TIME, FPS]
Result: [PASS_OR_FINDING]
Owner: [ASSET | RUNTIME | SIMULATION | UI]
```

완료 조건: 실제 player path, 경계 상태, 복구 상태와 hard performance cap이 같은 build의 증거로 닫혔다.

## 10. Independent acceptance — 구현자와 승인자 분리하기

Sol max 검수 담당에게 다음만 제공한다.

- locked slice spec와 `[REFERENCE_SET]`
- 최신 runtime screenshot/영상
- `[INTERACTION_CONTRACT]` 결과
- asset/network/console/performance evidence
- 알려진 P1과 미실행 device test

판정 형식:

```text
Decision: accept | conditional | block
P0: [BLOCKING_VISUAL_OR_PLAYABILITY_DEFECT]
P1: [REQUIRED_POLISH]
P2: [OPTIONAL_IMPROVEMENT]
Evidence: [ARTIFACT_AND_CONTRACT]
```

P0가 있으면 해당 owner에게 그 항목만 bounded follow-up으로 보낸다. 5~10단계를 반복해 P0가 0개일 때만 slice를 수용한다.

완료 조건: 독립 판정이 accept 또는 명시적 conditional이며 P0가 0개다.

## 11. Validation과 handoff

저장소에서 실제 명령을 찾아 다음 계층을 닫는다.

```text
[ASSET_PIPELINE_COMMAND]
[ASSET_VALIDATOR_COMMAND]
[TARGETED_GAMEPLAY_TEST_COMMAND]
[FULL_TEST_COMMAND]
[TYPE_OR_STATIC_CHECK_COMMAND]
[BUILD_COMMAND]
[BROWSER_PLAYTEST_COMMAND]
[DIFF_CHECK_COMMAND]
```

현재 동작이 달라졌다면 slice spec, visual spec, asset provenance/manifest, architecture, QA report를 함께 갱신한다.

최종 handoff:

```text
Playable result: [VERTICAL_SLICE]
Asset build: [ASSET_PACK_ID]
Visual gate: [P0, P1, P2]
Interaction evidence: [RESULT]
Performance evidence: [RESULT]
Automated validation: [RESULT]
Unverified devices/paths: [RISK]
Commit/push/deploy: [STATUS]
```

## 재사용 Task Packet

### Sol max 설계·아트 디렉션

```text
Model: gpt-5.6-sol, reasoning max
Objective: [VERTICAL_SLICE]의 reference, scene, interaction, performance 계약을 잠근다.
Read first: [GAME_DOCS, CURRENT_RUNTIME, REFERENCE_SET]
Output: reference matrix, slice spec, P0/P1/P2 acceptance rubric.
Guardrail: 구현 파일을 쓰지 않고 current slice 밖으로 범위를 넓히지 않는다.
```

### Terra xhigh 3D 에셋

```text
Model: gpt-5.6-terra, reasoning xhigh
Objective: [ASSET_PACK]을 authored DCC source에서 runtime-ready delivery로 만든다.
Owned: [DCC_SOURCE, ASSET_PIPELINE, STAGING_OUTPUT]
Contracts: [SCENE_CONTRACT, PERFORMANCE_BUDGET]
Required: stills, PBR, semantic nodes, collision/LOD, compression, provenance, validator.
Return: build ID, stills, asset report, validator output, remaining risks.
```

### Terra xhigh 런타임

```text
Model: gpt-5.6-terra, reasoning xhigh
Objective: 검증된 [ASSET_PACK]을 [INTERACTION_CONTRACT]와 player path에 연결한다.
Owned: [LOADER, SCENE_RUNTIME, SIMULATION_ADAPTER, TESTS]
Contracts: simulation/render separation, input map, collision, save, loading/fallback.
Required: real-path playtest, debug surface, renderer/network/console evidence.
Return: gameplay tests, captures, performance evidence, remaining risks.
```

## Definition of Done

- `[VERTICAL_SLICE]`를 cold boot부터 종료까지 실제로 플레이할 수 있다.
- 첫 화면부터 `[GAME_FANTASY]`와 승인된 아트 방향이 읽힌다.
- geometry, material, lighting, camera가 함께 작동하며 찰흙 blockout처럼 보이지 않는다.
- `[PLAYER_VERBS]`, collision, animation과 state transition이 일치한다.
- authored `[ASSET_PACK]`이 golden path이고 fallback은 오류 때만 나타난다.
- asset validator, gameplay tests, build와 실제 playtest가 통과한다.
- `[PERFORMANCE_BUDGET]`의 hard cap을 넘지 않는다.
- `[TARGET_MATRIX]`의 필수 조합에 screenshot/영상과 측정 증거가 있다.
- 독립 Sol 검수의 P0가 0개다.
- spec, provenance, manifest와 QA 문서가 같은 build를 설명한다.
- 기존 사용자 변경이 보존되고 미실행 검증과 실제 위험이 명시된다.
- 다음 공간이나 Chapter는 사용자 결정 전까지 시작하지 않는다.
