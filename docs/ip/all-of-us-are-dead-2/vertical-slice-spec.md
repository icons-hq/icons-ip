# 지금 우리 학교는: 마지막 종 — Chapter 1 수직 슬라이스 스펙

상태: 빌드 가능한 acceptance contract  
목표 플레이 시간: 첫 진입 5–7분  
전체 게임 목표: 25–35분 중 첫 Chapter

## 1. 플레이어에게 보이는 결과

플레이어는 수업 중인 효산고 교실에서 시작한다. 30초 동안 복도 유리 너머의 이상 행동, 교사의 문 잠금, 문이 무너지기 직전의 혼란을 인엔진으로 본다. 카메라는 끊기지 않고 1인칭 시점으로 정렬되며 `게임 시작` 입력 뒤 바로 조작권이 넘어온다.

플레이어는 무기 없이 교실을 빠져나와 소리를 듣고, 감염자를 피해 숨고, 문을 잠가 시간을 벌며 세 경로 중 하나로 설비실에 도착한다. 비상전력을 복구하면 종이 비정상적으로 울려 잠들어 있던 감염자들이 깨어난다. 플레이어가 준비된 은신처와 문 지연 장치를 이용해 안전 계단에 닿으면 Chapter 1이 완료된다.

이 슬라이스는 아래를 동시에 증명해야 한다.

- 실제 3D 공간에서의 1인칭 이동과 충돌이 PC·모바일에서 성립한다.
- 청취·은신·문 잠금·소리/빛 감지가 하나의 공포 문법으로 연결된다.
- 오프닝에서 플레이로 로딩 컷 없이 전환된다.
- seed로 경로 위험이 바뀌어도 목표 도달성과 공정성이 보장된다.
- 절차형 학교 shell을 공식 효산고 GLB로 로직 수정 없이 교체할 수 있다.

## 2. Definition of Done

다음 조건을 모두 충족해야 Chapter 1 수직 슬라이스가 완료다.

1. gate ON에서 게스트가 로딩·오프닝·플레이·Chapter 완료까지 갈 수 있다.
2. gate OFF에서는 route가 404이고 검색 index 대상이 아니다.
3. 오프닝 skip과 완주가 같은 `CONTROL_HANDOFF` 세계 상태로 수렴한다.
4. 교실 이탈, 청취, 은신, 문 잠금은 각각 실제 실패 가능성과 회복 경로를 가진다.
5. 세 route가 모두 전력 panel로 연결되고 위험 예산을 만족한다.
6. 전력 복구 뒤 종소리 세트피스는 기존 공간·문·은신 규칙만으로 완주 가능하다.
7. 실패 후 encounter retry는 같은 seed와 resolved layout을 쓴다.
8. 새 감염자는 backtrack 때문에 생성되지 않는다.
9. PC와 모바일은 같은 simulation parameter와 objective를 사용한다.
10. low mobile hard performance budget을 넘으면 자동 품질 하향 또는 build/QA 실패로 드러난다.
11. asset manifest가 출처·권리·hash·anchor를 검증한다.
12. 기존 `/games/[gameId]` 카드 보상/RPC를 import하거나 호출하지 않는다.

## 3. 시간표와 장면 beat

| 시간 | Chapter state | 화면·공간 | 플레이/검증 목적 |
| --- | --- | --- | --- |
| 00:00–00:05 | `OPENING_CLASS` | 정상 수업, 창밖/교실 ambience | 현재 공간과 평시 소리 학습 |
| 00:05–00:10 | `OPENING_CLASS` | 복도 유리 너머 이상 행동 | 위협을 먼저 보여주되 조작권 없음 |
| 00:10–00:17 | `DOOR_WARNING` | 교사가 상황 확인 후 문을 잠금 | 이후 door rule 시각적 예고 |
| 00:17–00:23 | `DOOR_WARNING` | 학생들이 흩어지고 문 압력 증가 | audio motif와 위험 상승 |
| 00:23–00:27 | `DOOR_WARNING` | 문이 휘고 유리가 흔들림 | 과도한 섬광 없이 충격 전달 |
| 00:27–00:30 | `CONTROL_HANDOFF` | 카메라가 player capsule/POV에 정렬 | `게임 시작`, skip 경로 수렴 |
| 00:30–01:10 | `LISTEN_TUTORIAL` | 교실 후면/준비실 | 청취로 복도 위협 방향 확인 |
| 01:10–02:00 | `CLASSROOM_EXIT` → `LOCK_TUTORIAL` | 교실 문, 복도 첫 bay | 이탈·은신·문 잠금 연쇄 |
| 02:00–03:20 | `ROUTE_CHOICE` | 중앙/후면/관리 route | 짧고 위험/길고 안전/설비 조작 선택 |
| 03:20–04:30 | `POWER_PANEL` | 설비실 | breaker 순서가 아닌 공간·소리 puzzle |
| 04:30–04:45 | `POWER_RESTORED` | 비상등·방송 회복 | checkpoint, 짧은 안도 |
| 04:45–05:05 | `BELL_FAULT` | 같은 motif의 왜곡된 종 | dormant infected wake telegraph |
| 05:05–06:20 | `BELL_ESCAPE` | 후면 복도→안전 계단 | 문/은신/청취를 재조합한 추격 |
| 06:20–06:40 | `SAFE_STAIR` → `COMPLETE` | 방화문 너머 | Chapter 완료·다음 단서, 보상 없음 |

30초 오프닝은 asset preload를 숨기는 동영상이 아니다. 필수 scene이 준비된 뒤 같은 3D world에서 실행한다. preflight user gesture가 WebAudio unlock, fullscreen 권유, landscape 확인을 먼저 처리하므로 오프닝의 오디오 자동재생 실패를 피한다.

## 4. 절차형 공간과 route

### 4.1 semantic map

```text
[C-201 교실]
   ├─ [준비실/HIDE] ─ [후면 복도: 긴 안전 route] ─┐
   ├─ [중앙 복도: 짧은 위험 route] ──────────────┼─ [설비실/POWER]
   └─ [교탁 설비함: 시스템 조작 route] ─ [서비스 통로] ┘
                                                     │
                                  bell wake ─────────┘
                                                     ▼
                                    [후면 복도/door delay]
                                                     ▼
                                     [비상 계단/CHAPTER EXIT]
```

`C-201` 같은 이름은 prototype semantic id이며 공식 canon 좌표를 주장하지 않는다. 공간은 아래 최소 계약을 가진다.

- 교실 1개, 작은 준비실 1개
- 직선/ㄱ자 복도 bay 3개 이상
- 설비실 1개
- 안전 계단 landing 1개
- 상호작용 문 3개 이상
- 은신처 2개 이상
- bell setpiece 시작 시 접근 가능한 은신처 1개와 door delay 1개를 보장

### 4.2 route 성격

| Route | 길이 | 기본 위험 | 고유 행동 | 보장 |
| --- | --- | --- | --- | --- |
| 중앙 복도 | 짧음 | 높음 | patrol timing과 빠른 door 통과 | 실패 전 위협 cue 1회 |
| 후면 복도 | 김 | 낮음 | listen으로 cluster 우회 | 막다른 길 없음 |
| 시스템 통로 | 중간 | 중간 | 교탁 설비함으로 전자 잠금 해제 | interaction이 정답을 숨기지 않음 |

경로는 전력 panel에서 다시 합쳐진다. route 선택으로 Chapter objective나 checkpoint가 달라지지 않는다.

## 5. 상태 머신

### 5.1 앱 lifecycle

```text
server: GATE_OFF ──> 404
server: GATE_ON  ──> PREFLIGHT

PREFLIGHT ──confirm──> PRELOADING ──critical ready──> READY
READY ──start──> OPENING ──finish/skip──> HANDOFF ──ack──> PLAYING
PLAYING <──resume── PAUSED
PLAYING ──chapter exit──> CHAPTER_COMPLETE
PLAYING ──webgl lost──> CONTEXT_LOST ──rebuild──> RECOVERING ──> PLAYING
CONTEXT_LOST ──rebuild failed──> FATAL
```

guards:

- `PRELOADING → READY`: critical scene, collider, nav graph, essential SFX, opening cues 검증 완료
- `OPENING → HANDOFF`: skip 여부와 무관하게 동일 authored end snapshot 적용
- `RECOVERING → PLAYING`: 마지막 안전 checkpoint에서만 복원
- pause 중 simulation·AI·Chapter timer는 증가하지 않음

### 5.2 Chapter flow

```text
OPENING_CLASS
  → DOOR_WARNING
  → CONTROL_HANDOFF
  → LISTEN_TUTORIAL
  → CLASSROOM_EXIT
  → FIRST_PATROL
  → HIDE_TUTORIAL
  → LOCK_TUTORIAL
  → ROUTE_CHOICE
  → POWER_PANEL
  → POWER_RESTORED
  → BELL_FAULT
  → BELL_ESCAPE
  → SAFE_STAIR
  → COMPLETE
```

| 전이 | 필수 guard | side effect |
| --- | --- | --- |
| handoff → listen | player control acknowledged | `ch1_handoff` 저장 |
| listen → exit | 위협 cue를 0.6초 이상 청취 또는 접근성 timeout | objective 갱신 |
| first patrol → hide | 감염자가 investigate/chase 진입 | ready hiding spot 강조 |
| hide → lock | player가 안전하게 은신 종료 | door prompt 활성화 |
| lock → route | tutorial door가 `LOCKED` | 세 route 활성화 |
| route → panel | player가 설비실 trigger 진입 | route risk 기록 |
| panel → restored | semantic panel interaction 완료 | `ch1_power_restored` 저장 |
| restored → bell | 2초 settle, essential audio ready | dormant group wake |
| escape → safe stair | player가 fire-door threshold 통과 | `ch1_post_bell_safe` 저장 |
| safe stair → complete | chase 해제, camera settle | Chapter 완료 |

### 5.3 Player state

```text
FREE ↔ CROUCHED
FREE/CROUCHED ↔ LISTENING
FREE/CROUCHED → HIDING → FREE
FREE/CROUCHED → INTERACTING → previous locomotion
FREE/CROUCHED/LISTENING → GRAPPLED → FREE | CAUGHT
CAUGHT → RESTARTING → last encounter checkpoint
```

- `HIDING`: translation 차단, 제한된 look만 허용, flashlight 강제 off
- `LISTENING`: 이동 속도 감소, self-noise 감쇠, 방향 cue 강화
- `INTERACTING`: authored interaction duration 동안 이동 제한
- `GRAPPLED`: context action이 rapid-tap meter로 전환
- 상태 변경은 runtime command로만 이루어지며 UI가 직접 player state를 쓰지 않는다.

### 5.4 Door state

```text
OPEN ↔ CLOSED → LOCKED/BARRICADED → PRESSURED → BREACHED
```

- 모든 문이 lock 가능하지 않다. manifest의 capability가 결정한다.
- `LOCKED`는 collider blocker와 nav edge를 한 transaction으로 갱신한다.
- `PRESSURED`는 소리·시각 cue와 남은 시간을 제공한다.
- `BREACHED` 뒤 같은 encounter에서 원상복구하지 않는다.
- checkpoint 복원 시 authored semantic 상태로 재구성한다.

### 5.5 감염자 state와 역할

```text
DORMANT/PATROL
  → INVESTIGATE
  → SEARCH
  → CHASE
  → DOOR_PRESSURE | GRAPPLE
  → RETURN/PATROL
```

행동 차이는 별도 종(species)이 아니라 `ambush`, `sound-responsive-cluster`, `patrol`, `door-pressure` 역할로 표현한다. 역할은 같은 perception/movement interface에 parameter만 제공한다.

## 6. 입력 계약

모든 device adapter는 아래 의미 action으로 정규화한다.

```ts
type InputFrame = {
  move: { x: number; y: number };
  lookDelta: { x: number; y: number };
  run: boolean;
  crouchPressed: boolean;
  interactPressed: boolean;
  listenHeld: boolean;
  flashlightPressed: boolean;
  phonePressed: boolean;
  pausePressed: boolean;
  grapplePressCount: number;
};
```

### 6.1 PC

| Action | 기본 입력 |
| --- | --- |
| 이동 | WASD, 방향키 |
| 시점 | mouse, Pointer Lock |
| 달리기 | Shift hold |
| 웅크리기 | Ctrl 또는 C toggle |
| 상호작용/숨기/나오기/문 잠금 | E |
| 집중 청취 | Q hold |
| flashlight | F |
| phone map | M 또는 Tab |
| pause | Esc |
| grapple | Space rapid tap |

### 6.2 모바일 landscape

- 왼쪽 고정 virtual stick: 이동
- 오른쪽 빈 영역 drag: 시점
- 오른쪽 context action: 상호작용/은신/문
- 별도 run, crouch, listen, flashlight, phone 버튼
- grapple 동안 context action이 큰 반복 입력 target으로 변환
- look 영역과 버튼 hit area는 겹치지 않음
- portrait 전환 시 orientation overlay를 표시하고 simulation pause
- 모든 target 최소 48 CSS px, safe-area inset 적용

PC와 모바일은 AI 속도·감지·objective가 같다. grapple의 물리 key count는 기기별로 달라도 목표 성공 시간은 1.25–1.6초 범위로 맞춘다. key repeat/autotap 이벤트는 인정하지 않고 실제 press edge만 센다. 대체 hold 입력은 제공하지 않는다는 결정 때문에 기기·사용자군별 실패율을 QA에서 별도로 보고한다.

## 7. 핵심 mechanic

### 7.1 이동과 소리

- 기본 이동은 중간 소음, crouch는 저소음/저속, run은 고소음/고속
- stamina bar는 없지만 2초 이상 연속 run 시 호흡·발소리 sound radius가 점진 증가
- 멈춘 뒤 1.5초 동안 호흡 소음이 감쇠
- sound event는 `category`, `origin`, `radius`, `intensity`, `occlusionClass`, `sourceId`를 가짐
- 벽/닫힌 문 occlusion은 authored portal 또는 단순 ray/zone 감쇠로 처리

### 7.2 집중 청취

- Q/버튼 hold 중 이동 속도 45% 감소
- player self-noise mix를 낮추고 위험 cue를 강조
- 화면에 정확한 적 실루엣/좌표를 표시하지 않음
- 방향 자막은 8방향, `발소리/문 압력/감염자/종`, 약·중·강만 표시

### 7.3 은신

- `HIDE_*` anchor가 허용하는 cabinet/책상 아래 공간만 사용
- 진입은 0.35초, 이탈은 0.45초 authored transition
- 감염자가 진입을 직접 목격했거나 hide anchor가 탐색 대상으로 선택되면 완전 안전하지 않음
- tutorial의 첫 은신처는 추격 시작 전에 1.5초 이상 인지 가능해야 함

### 7.4 문 잠금/압력

- 문 가까이에서 E/context action으로 닫은 뒤 lock 가능
- lock 동작은 0.6초, 중단 가능
- 감염자 door-pressure는 명시된 delay를 제공하고 cue로 남은 시간을 전달
- 모든 locked door encounter는 우회, system unlock, 또는 기다린 뒤 통과 중 하나의 resolution을 가짐

### 7.5 Flashlight

- battery는 무제한
- near radius 안에서 beam/광원이 감염자의 시야에 들어오면 investigate 가중치 증가
- hiding 진입 시 자동 off, 이탈 뒤 이전 상태를 자동 복원하지 않음

### 7.6 환경 밀치기/막기

- 무기나 공격이 아니다.
- authored object만 한 번 밀어 nav edge를 잠시 막거나 소리를 냄
- Chapter 1에서는 bell escape의 door delay 한 곳에만 사용해 시스템 범위를 제한

## 8. AI와 위험 예산

### 8.1 감지

- AI perception 10Hz
- 시야 raycast는 agent별 frame에 분산
- 시야 score: 거리, view cone, 조도, flashlight, player posture
- 소리 score: event radius, intensity, zone/door occlusion, 역할 민감도
- chase 중 path는 authored nav graph, 근거리만 local steering
- 감염자 logic active 최대 12, 나머지는 dormant/static LOD

### 8.2 위험 단위

| 위험 | 비용 |
| --- | ---: |
| locked/pressured door | 2 |
| ambush | 3 |
| sound-responsive cluster | 4 |
| 은신처 희소 | 3 |
| 긴 우회 | 2 |
| flashlight 민감 구역 | 2 |

| Route | 허용 합계 |
| --- | ---: |
| 긴 안전 route | 3–5 |
| 시스템 route | 5–7 |
| 짧은 위험 route | 7–9 |

hard constraints:

- 매 seed에 위험 합계 5 이하 route가 최소 하나
- 같은 segment에 `ambush + 은신처 희소` 금지
- tutorial 시작 45초에는 hard risk 최대 하나
- 목표와 checkpoint는 BFS로 도달 가능
- bell escape 시작점에서 ready hiding spot 1개와 door delay 1개 도달 가능
- backtrack은 새 감염자를 생성하지 않음
- route를 선택한 뒤 보이지 않는 난이도 보정으로 적을 추가하지 않음

generator는 seed에서 candidate layout을 만들고 hard constraints를 검증한다. 실패하면 파생 sub-seed로 제한 횟수 재시도하고, 끝까지 실패하면 version별 golden fallback layout을 사용한다. checkpoint에는 seed뿐 아니라 확정된 `ResolvedLayout`과 generator version을 저장한다.

## 9. 오디오 연출

### 9.1 bus

- master
- dialogue
- ambience/music
- spatial SFX
- UI/accessibility cue

WebAudio context는 preflight의 사용자 gesture에서 생성·resume한다. dialogue와 SFX는 mono source + spatial panner, ambience/music은 stereo streaming을 기본으로 한다. low tier는 단순 stereo pan, medium/high는 HRTF를 사용한다.

### 9.2 motif와 cue

- 오프닝의 정상 종소리 motif를 기억시킨다.
- 전력 복구 뒤 같은 motif를 pitch wobble·기계음으로 왜곡한다.
- 종소리가 울리기 전 2초간 전기 relay/스피커 pop으로 결과를 예고한다.
- 종은 감염자 wake의 semantic event이며 단순 배경 음악 cue가 아니다.
- 비상등은 느린 pulse만 사용하고 소리와 화면 섬광을 프레임 단위로 동기화하지 않는다.

장기 ambience/music은 stream하고 핵심 상호작용 SFX만 preload/decode한다. limiter를 두고 갑작스러운 peak를 제한한다. 자막·방향 자막이 audio-only 정보를 대체할 수 있어야 한다.

## 10. 3D와 시각 계약

### 10.1 첫 슬라이스 장면

- 절차형 실제 geometry: 벽, 바닥, 천장, 문틀, 문, 창, 책상, 사물함, 설비실 panel, 계단 landing
- baked/static lighting 우선, 비상등만 제한적 runtime light
- low tier dynamic shadow 없음
- repeated 책상/의자는 instancing
- occlusion zone과 frustum culling 사용
- 생성 이미지/권리 확보 still은 plate·poster·loading·Chapter card·시각 기준으로 사용
- 2D plate가 이동 가능한 벽/복도/추격 공간을 대신하지 않음

### 10.2 quality tier

| Feature | Low | Medium | High |
| --- | --- | --- | --- |
| 목표 fps | 30 | 45/60 | 60 |
| DPR 상한 | 1.5 | 1.75 | 2.0 |
| dynamic shadows | 0 | key 1 | 최대 3 |
| visible skinned infected | 6 | 10 | 14 |
| texture tier | 1K 중심 | 1K/2K | 2K 선택 |
| spatial audio | simple pan | HRTF | HRTF |

quality 변경은 그래픽 표현만 바꾸며 AI tick, 감지 거리, 이동 속도, objective는 바꾸지 않는다.

## 11. Asset manifest와 공식 GLB 교체

### 11.1 현재 source hierarchy

1. 공식 Netflix/효산고 원본이 도착하면 최우선
2. 권리 확보된 `icons-hq/icons` commit `dc67a4c0ae6ece52d82d97df555fe032685f94d2`의 `50_apps/plan-viewer/public/ip-popups/aouad/` 24개 이미지와 <https://icons-plan.vercel.app/ip-popups/aouad>
3. clean-room procedural/generated prototype geometry와 texture
4. provenance가 남은 외부 일반 환경 참고

과거 source manifest의 권리 미확보 문구는 2026-08-21 사용자 확인으로 대체되었다. 최신 record에는 `rightsStatus: "user-confirmed-2026-08-21"`를 기록한다.

### 11.2 Scene adapter

```ts
type ChapterSceneAdapter = {
  chapterId: "chapter-01";
  load(signal: AbortSignal): Promise<LoadedScene>;
  resolveAnchor(id: SemanticAnchorId): Transform;
  getStaticCollider(): StaticCollider;
  getNavGraph(): AuthoredNavGraph;
  validate(): SceneValidationReport;
  dispose(): void;
};
```

첫 adapter는 `ProceduralChapter01Adapter`, 후속은 `OfficialHyosanChapter01Adapter`다. runtime은 둘 중 무엇이 선택됐는지 알지 못한다.

필수 anchor:

- player: `ANCHOR_player_start`
- checkpoints: `ANCHOR_checkpoint_handoff`, `ANCHOR_checkpoint_power`, `ANCHOR_checkpoint_post_bell`
- setpiece/exit: `ANCHOR_setpiece_bell`, `ANCHOR_chapter_exit`
- interaction: `INT_door_*`, `INT_power_panel_*`
- systems: `HIDE_*`, `NAV_*`, `COL_*`, `AUDIO_*`, `LIGHT_*`, `OCC_*`

감염자 rig/clip을 도입할 때 이름은 `dormant`, `wake_bell`, `idle`, `walk`, `run`, `investigate`, `door_pressure`, `grapple`, `stagger`로 normalize한다. 공식 원본 이름은 import mapping에서만 다룬다.

### 11.3 Release validator

다음 중 하나라도 발생하면 production-tier asset build를 실패시킨다.

- 필수 anchor, collider, nav edge, audio cue 누락
- source/output SHA-256 불일치
- provenance record 누락
- `prototype-only` 또는 `reference-only` ship tier 포함
- GLB scale/up-axis/floor 규칙 위반
- triangle, texture, draw-call 추정 hard budget 초과

## 12. Checkpoint와 재시작

### 12.1 체크포인트

| id | 생성 시점 | 복원 상태 |
| --- | --- | --- |
| `ch1_handoff` | 조작권 인계 | tutorial 시작, opening 완료 |
| `ch1_power_restored` | panel 완료 | 전력 ON, bell 직전 settle |
| `ch1_post_bell_safe` | 안전 계단 threshold | chase 해제, 완료 직전 |

Story 모드는 위 encounter checkpoint를 사용한다. 향후 Survival 모드는 Chapter 시작/완료만 저장하는 별도 policy를 쓴다. 첫 슬라이스 UI는 Story만 노출해도 runtime config의 `mode` seam은 유지한다.

### 12.2 로컬 schema

```ts
type LocalCheckpointV1 = {
  schemaVersion: 1;
  authority: "local-prototype";
  leaderboardEligible: false;
  runId: string;
  chapterId: "chapter-01";
  checkpointId: string;
  seed: number;
  generatorVersion: string;
  resolvedLayout: ResolvedLayout;
  semanticWorldState: Record<string, string | number | boolean>;
  createdAt: string;
  expiresAt: string;
};
```

- TTL: 생성/갱신 후 24시간
- settings와 opaque identity는 checkpoint와 분리
- entity transform과 frame timer 저장 금지
- 만료/parse/version migration 실패: Chapter 시작
- encounter retry: persistence를 기다리지 않고 memory snapshot 사용, 같은 layout 유지
- production server run과 leaderboard에는 제출하지 않음

현재 PRD/ARCHITECTURE는 게임 플레이에 로그인을 요구하지만 `game-concept.md`는 게스트 전체 스토리를 요구한다. prototype의 local-only guest 예외는 production 정책을 바꾸지 않는다. 서버 run을 붙이기 전 해당 문서를 별도 승인으로 정렬한다.

## 13. 접근성 상세

- FOV 70–100
- mouse/touch sensitivity와 Y축 반전
- head bob off/low/default, camera shake off/low/default
- motion blur 기본 off
- reduced-motion: 오프닝 camera 이동 축소, gameplay timing 불변
- 자막 크기 3단계, 불투명 배경, speaker/category label
- 방향 자막 8방향+강도; 적의 정확한 거리·좌표는 표시하지 않음
- interact outline/reticle high contrast, 색+형태/문자 병행
- 종/비상등은 3Hz 초과 섬광 금지
- pause menu에서 오디오·시각·입력 설정 즉시 변경
- 모바일 48px touch target과 safe area
- 빠른 연타 대체 입력 부재를 알려진 제한으로 릴리스 노트/QA에 기록

## 14. 성능 acceptance

### 14.1 전송과 메모리

- shell + critical JS gzip ≤1.5MB, engine은 진입 뒤 lazy chunk
- opening + Chapter 1 critical compressed 목표 ≤18MB, hard ≤25MB
- 추가 Chapter 1 stream ≤12MB
- decoded short SFX ≤24MB
- 총 관찰 memory: low ≤350MB, medium ≤500MB, high ≤900MB

### 14.2 frame budget

- low mobile: render p95 ≤33.3ms, 안정 30fps
- high desktop: render p95 ≤16.7ms, 안정 60fps
- AI perception 10Hz, simulation 30Hz
- visible triangles low/medium/high ≤350k/650k/1.2m
- draw calls low/medium/high ≤120/180/260
- GPU texture 추정 low/medium/high ≤128/256/512MB
- active AI logic ≤12

성능 측정은 opening, 첫 patrol, 세 route, bell wake 직후 10초, door pressure에서 각각 수행한다. 평균 fps만 보고 통과시키지 않고 p95 frame과 장시간 memory 증가를 본다.

## 15. 테스트 명세

### 15.1 Unit/contract

| 대상 | 필수 테스트 |
| --- | --- |
| gate | exact `"1"`, 미설정/다른 값 false, client bundle 미포함 |
| route | request-time gate, noindex/nofollow, client dynamic fallback |
| runtime | 모든 합법 전이, 불법 command 무시/typed error |
| fixed step | 30/60/120 render cadence에서 같은 final snapshot |
| opening | skip/non-skip 동일 handoff snapshot |
| input | PC/touch가 같은 normalized action sequence 생성 |
| collision | 벽/닫힌 문 관통 방지, 열린 문 통과 |
| door | open→closed→locked→pressured→breached lifecycle |
| perception | run noise, flashlight, occlusion, hiding witness 조건 |
| risk | 같은 seed 동일 layout, BFS, route 예산, golden fallback |
| population | backtrack 무증원, active logic cap |
| retry | 같은 resolved layout과 semantic checkpoint |
| persistence | 24h 전/후, parse 실패, version 실패, key 분리 |
| assets | provenance/hash/anchor/format/tier/budget guard |
| isolation | generic `play_game`/card reward 호출 없음 |

테스트는 내부 helper가 아니라 `LastBellRuntime`, `ChapterSceneAdapter`, `PersistenceAdapter` 같은 public interface를 우선 사용한다.

### 15.2 Playwright/E2E

1. gate OFF에서 404, ON에서 preflight 표시
2. desktop 오프닝 완주 → handoff → Chapter 완료
3. 오프닝 skip → 같은 tutorial 시작 상태
4. 첫 patrol에서 실패 → same seed/layout retry
5. 각 route로 전력 복구 가능
6. bell escape에서 hide/door를 사용해 완료 가능
7. 844×390과 740×360 landscape touch flow
8. portrait 전환 시 pause, landscape 복귀 시 명시 resume
9. pointer lock 상실, tab hidden, audio suspend/resume
10. reduced-motion, captions, head-bob off 설정 유지
11. checkpoint reload와 24시간 만료 fixture

### 15.3 수동 QA

- Chrome/Safari desktop, iOS Safari, Android Chrome 실기기
- 좌/우/뒤 방향 sound cue와 자막 일치
- motion sickness 10분 session과 카메라 option
- rapid tap 성공 시간/실패율 PC·모바일 비교
- low tier bell wake에서 p95 frame/draw call/memory
- WebGL context loss 후 checkpoint recovery
- asset provenance report의 원본/라이브/출력 hash 대조

## 16. 실패와 복구 UX

| 실패 | UX | simulation 처리 |
| --- | --- | --- |
| 필수 asset load 실패 | 재시도/낮은 품질/나가기 | 시작 전 정지 |
| WebAudio 실패 | 무음 경고+재활성화 버튼 | 게임은 시작 가능, caption 강제 유지 |
| Pointer Lock 상실 | pause overlay | clock 정지 |
| portrait | 회전 안내 | clock 정지 |
| WebGL context loss | 복구 shell/progress | checkpoint에서 rebuild |
| player caught | 짧은 failure beat 후 재시작 | 같은 seed/layout |
| checkpoint 손상/만료 | Chapter 시작 안내 | invalid payload 폐기 |
| anchor validation 실패 | 개발 오류 화면 | gameplay 시작 금지 |

## 17. 확장 seam

Chapter 2–4는 이번 구현 범위가 아니지만 첫 슬라이스가 다음을 막지 않아야 한다.

- `ChapterDefinition`: objective graph, scene adapter, cue manifest, checkpoint policy
- semantic device: power, CCTV, broadcast, fire door, generator, gate
- `AudioDirector`: bell 외에 방송/음악 group lure 추가
- perception modifier: Chapter 3 breath hold
- finale director: Chapter 4의 45–60초 생존과 chase chain
- `RunRecorder`: local semantic event stream을 후속 서버 adapter에 전달
- official content adapter: 승인된 대사/VO/공간을 cue id와 anchor로 교체

확장은 runtime의 public interface를 넓힐 필요가 있을 때만 새 API를 추가한다. Chapter별 구현 세부를 React component나 전역 store에 노출하지 않는다.

## 18. 남은 결정과 blocker 구분

첫 슬라이스를 막지 않는 미확정 항목:

- survivor 번호/학급 roster의 최종 사용자-facing 형식
- 청산 휴대폰 대사와 정확한 시간·공간 좌표
- 공식 효산고 GLB의 납품 시점
- 공식 캐릭터 VO와 음악 최종 믹스

위 항목은 opaque id, disabled content anchor, procedural adapter, semantic cue로 자리를 보존한다. 임시 공식 대사를 창작하거나 prototype 값을 canon으로 노출하지 않는다.

첫 슬라이스를 실제로 막는 항목은 WebGL/R3F가 목표 모바일에서 실행되지 않는 경우, critical asset hard budget을 만족시킬 수 없는 경우, 또는 procedural scene의 필수 anchor/BFS 검증 실패뿐이다. 공식 3D 원본 부재와 과거 provenance 경고는 blocker가 아니다.
