# 지금 우리 학교는: 마지막 종 — 구현 계획

상태: Chapter 1 수직 슬라이스 구현 계약  
기준일: 2026-08-21  
제품 진실원: [`game-concept.md`](./game-concept.md)

## 1. 결론

첫 구현은 **2D 클릭 어드벤처가 아니라 브라우저에서 직접 이동·충돌·청취·은신·추격을 수행하는 실제 1인칭 3D 공포 탈출 게임**이다. Next.js는 진입·게이트·로딩 UI를 맡고, 게임 루프는 React Three Fiber(R3F)와 Three.js, 고정 시간 간격의 순수 TypeScript 런타임으로 분리한다.

Chapter 1은 다음 한 경로를 끝까지 완성하는 tracer bullet이다.

> 30초 인엔진 오프닝 → 교실 이탈 → 청취 → 은신 → 문 잠금 → 경로 선택 → 비상전력 복구 → 종소리 세트피스 → 안전 계단 → Chapter 1 완료

현재 저장소에 공식 효산고 3D 원본은 없다. 따라서 첫 슬라이스는 절차형 3D 교실·복도·설비실과 권리 확보된 AOUAD 이미지 자산으로 완성한다. 게임 로직은 공간의 파일명이나 메시 노드를 직접 참조하지 않고 semantic anchor manifest만 참조한다. 추후 공식 효산고 GLB가 들어오면 같은 anchor 계약을 만족하는 adapter로 교체한다.

## 2. 권위와 범위

### 2.1 우선순위

충돌 시 다음 순서로 판단한다.

1. 2026-08-21 사용자 확인과 `game-concept.md`
2. 이 구현 계획과 `vertical-slice-spec.md`
3. 현재 코드 계약과 `AGENTS.md`
4. `CONTEXT.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, 관련 ADR

2026-08-21 사용자는 지우학 IP와 `icons-hq/icons`의 AOUAD 이미지 자산 권리 확보를 확인했다. `icons-hq/icons`의 과거 provenance 문서에 남은 “내부 참고 전용/권리 미확보” 표시는 역사적 상태이며 현재 blocker가 아니다. 다만 모든 복사·변환·생성물은 출처, 원본 해시, 파생 이력을 manifest에 남긴다.

### 2.2 이번 구현 범위

- 독립 prototype route와 request-time fail-closed gate
- Chapter 1의 시작부터 완료까지 5–7분짜리 실제 플레이
- PC 및 모바일 landscape의 동일 게임 규칙
- 절차형 3D 환경, 1인칭 이동, 충돌, 상호작용, 청취, 은신, 문 상태, 추격, grapple, 재시작
- 30초 인엔진 오프닝과 플레이 전환
- 결정론적 seed, 위험 예산, 로컬 24시간 체크포인트
- 오디오, 방향 자막, 접근성, 품질 tier, 성능 계측
- 4개 Chapter 및 향후 서버 run recorder가 붙을 확장 seam

### 2.3 명시적 비범위

- 상품, 결제, 카드 보상, 뽑기권, 리더보드, 운영 콘솔
- `/games/[gameId]`의 `play_game` RPC 및 카드 리워드 계약과의 연결
- Chapter 2–4의 콘텐츠 구현, 두 번째 막/슬라이스 구현
- 공식 대사·성우 녹음·청산 휴대폰 대사의 임의 창작
- production 익명 run 발급, 서버 판정, 계정 이전
- 멀티플레이, 전투, 무기, 마이크 입력

## 3. 기존 구조와의 통합 결정

### 3.1 독립 라우트

경로는 `/games/prototype-last-bell`로 고정한다. 일반 `/games/[gameId]`는 서버가 카드 보상을 결정하는 기존 Marble Roulette 계약이므로 재사용하지 않는다. 두 계약을 섞으면 게스트 플레이, 로컬 체크포인트, 게임 결과의 신뢰 수준이 모두 모호해진다.

라우트는 과거 commit `e4e2a76`의 독립 prototype 선례를 따른다.

```tsx
export const metadata = {
  robots: { index: false, follow: false },
};

export default async function Page() {
  await connection();
  if (!isLastBellPrototypeEnabled()) notFound();
  return <LastBellClient />;
}
```

- gate: 서버 전용 `ICONS_LAST_BELL_PROTOTYPE === "1"`
- gate 미설정, 빈 값, 다른 값: 404
- `connection()`으로 정적 prerender를 중단하고 요청 시점 환경값을 판정
- `robots: noindex, nofollow`
- R3F 엔트리는 작은 Client Component 안에서 `next/dynamic(..., { ssr: false })`

이 gate는 공개 롤아웃 제어이지 DRM이 아니다. 정적 게임 자산의 비공개가 필요해지면 public 폴더를 억지로 보호하지 않고 서명 URL을 제공하는 object storage/CDN adapter를 별도 도입한다.

### 3.2 Next.js 16 적용 원칙

현재 설치된 Next.js 16.3 문서를 기준으로 다음을 지킨다.

- route page와 metadata는 Server Component에 둔다.
- 브라우저 API, Pointer Lock, WebAudio, localStorage, R3F는 최소한의 Client Component 그래프 안에 둔다.
- `ssr: false` dynamic import는 Server Component가 아닌 Client Component에서 선언한다.
- 초기 HTML에 게임 엔진을 넣지 않고 preflight 뒤 lazy load한다.
- 해시가 포함된 정적 자산만 immutable cache header를 설정한다. 해시 없는 manifest는 재검증 가능하게 둔다.

## 4. 기술 선택

| 관심사 | 선택 | 이유 | 첫 슬라이스에서 제외한 대안 |
| --- | --- | --- | --- |
| 3D 렌더링 | Three.js + React Three Fiber | React 19/Next 구조와 결합하면서 실제 3D scene graph와 WebGL 제어 가능 | 2D DOM/canvas 게임은 요구 불충족 |
| 장면 보조 | `@react-three/drei`의 제한된 유틸리티 | 로더, pointer lock 등 검증된 얇은 도구만 사용 | 상위 프레임워크에 게임 상태 위임 |
| UI 상태 | Zustand | 메뉴·HUD의 저빈도 snapshot 공유 | 프레임별 위치를 store에 기록하지 않음 |
| 게임 진실원 | 순수 TypeScript `LastBellRuntime` | 테스트 가능하고 renderer와 분리된 결정론적 fixed-step | React state를 simulation truth로 사용하지 않음 |
| 충돌 | merged static geometry + `three-mesh-bvh` swept capsule | 학교 내부의 정적 구조에 작고 빠른 계약 | Chapter 1에서 Rapier 전체 물리 도입 없음 |
| 동적 문 | authored OBB blocker + 문 state/nav-edge 동기화 | hinge 문에 필요한 규칙만 명시적으로 구현 | 범용 rigid body joint 없음 |
| AI 이동 | authored nav graph + local steering | 복도형 맵, seed 검증, 추적 재현에 적합 | 런타임 navmesh bake 없음 |
| 자산 포맷 | GLB 2.0 + Meshopt, KTX2/Basis, baked lightmap | 모바일 전송량과 draw call 관리 | 원본 PNG/FBX 직접 런타임 로드 없음 |
| 장기 오디오 | streaming | 메모리 급증 방지 | 전체 디코드 없음 |

정확한 패키지 버전은 구현 시 React 19 peer dependency를 확인한 뒤 `package-lock.json`에 고정한다. 계획 문서가 최신 버전을 추측해 고정하지 않는다.

## 5. 아키텍처와 깊은 모듈

```text
Server route / request-time gate
                │
                ▼
LastBellClient ── preflight / lazy load / recovery shell
                │
       ┌────────┴─────────┐
       ▼                  ▼
LastBellRuntime       R3F ChapterScene
(game truth)          (snapshot renderer)
       ▲                  │
       │                  ├── AudioDirector(event consumer)
InputAdapter               ├── HUD / captions
       │                  └── AssetCatalog + anchors
       ▼
keyboard/mouse | touch
       │
       └──── PersistenceAdapter(checkpoint/settings)
                     future: RunRecorder(server adapter)
```

핵심은 `LastBellRuntime`라는 깊은 모듈이다. 상태 머신, seed, 위험 배치, AI 감지, 문/은신/grapple, 체크포인트 직렬화 복잡성을 작은 interface 뒤에 숨긴다.

```ts
type LastBellRuntime = {
  step(fixedDeltaSeconds: number, input: InputFrame): void;
  dispatch(command: RuntimeCommand): void;
  snapshot(): RuntimeSnapshot;
  serializeCheckpoint(): CheckpointPayload | null;
  dispose(): void;
};

function createLastBellRuntime(config: {
  chapterId: "chapter-01";
  mode: "story" | "survival";
  seed: number;
  resolvedLayout?: ResolvedLayout;
  checkpoint?: CheckpointPayload;
  settings: GameplaySettings;
  clock: RuntimeClock;
}): LastBellRuntime;
```

렌더러는 snapshot을 읽고 ref를 갱신한다. 프레임별 transform은 React state나 Zustand에 쓰지 않는다. HUD에 필요한 목적·자막·위험 상태만 저빈도로 publish한다.

### 5.1 교체 seam

| Seam | 현재 adapter | 이후 adapter | 안정 계약 |
| --- | --- | --- | --- |
| 환경 | procedural school shell | official Hyosan GLB 또는 검수된 CC-BY GLB | semantic anchors, collider, nav graph |
| 입력 | keyboard/mouse, touch | gamepad | normalized `InputFrame` |
| 저장 | localStorage, memory test adapter | 익명 서버 run/checkpoint | versioned payload, event ids |
| 결과 | local Chapter complete | server recorder/validator | ordered semantic events |
| 오디오 | prototype/승인 자산 | 공식 믹스와 VO | semantic cue ids |
| 품질 | local device heuristic | telemetry-tuned profile | capability → quality config |

## 6. 상태와 시간 모델

- simulation: 30 Hz fixed step
- render: 품질 tier에 따라 30/60 Hz, accumulator interpolation
- AI perception: 10 Hz, sight raycast를 agent별로 분산
- pause/portrait/tab-hidden/pointer-lock-loss: simulation clock 정지
- 최대 누적 보정: 긴 frame 뒤 catch-up step을 제한하고 나머지는 버린다.
- 모든 랜덤 결정: 이름 있는 PRNG stream(`layout`, `encounter`, `audio-variation`)에서만 생성
- 저장: seed만 믿지 않고 `generatorVersion + resolvedLayout`을 함께 보존

상태 머신의 구체 전이와 guard는 `vertical-slice-spec.md`를 따른다.

## 7. 에셋 파이프라인과 provenance

### 7.1 소스 우선순위

1. 납품된 공식 Netflix/효산고 3D, 오디오, 캐릭터 원본
2. 권리 확보된 `icons-hq/icons` AOUAD 이미지와 라이브 디자인 자료
3. 부족한 geometry를 위한 clean-room 절차형/생성 prototype 자산
4. 외부 웹의 일반 학교 환경·소품 참고 자료

2차 소스의 현재 대조 기준은 다음과 같다.

- 저장소: `icons-hq/icons` main commit `dc67a4c0ae6ece52d82d97df555fe032685f94d2`
- 경로: `50_apps/plan-viewer/public/ip-popups/aouad/`
- 라이브: <https://icons-plan.vercel.app/ip-popups/aouad>
- 대조 결과: 저장소와 라이브 디자인 자료 탭의 24개 이미지가 일치

이 이미지는 로고, 로딩/Chapter 카드, 오프닝 plate, 승인된 diegetic poster/texture에 사용할 수 있다. 라이브 URL을 hotlink하지 않고 원본을 프로젝트 자산 파이프라인으로 복사하여 해시를 기록한다. 생성 환경 이미지는 시네마틱 plate·로딩·Chapter 카드·시각 기준으로만 사용하고, 이동 가능한 공간을 billboard나 2D 배경으로 대체하지 않는다.

외부 웹 수집은 부족한 교실 구조·배전반·문 하드웨어 같은 일반 참고를 보강하는 데만 쓴다. URL 발견만으로 ship 권한을 추론하지 않는다. 예를 들어 Sketchfab의 Korean highschool classroom 후보는 약 80.9k tris, CC Attribution, downloadable로 표시되어 있으나 원본 다운로드·라이선스 파일·attribution 표시를 검수하기 전에는 의존하지 않는다. Kenney Building/Furniture CC0는 선택적 placeholder 후보일 뿐 IP fidelity를 위한 필수 의존이 아니다.

### 7.2 provenance manifest 필드

모든 shipping asset과 직접 파생물은 아래 필드를 가진다.

```ts
type AssetRecord = {
  assetId: string;
  role: "scene" | "character" | "texture" | "audio" | "plate" | "ui";
  sourceClass: "official" | "icons-cleared" | "generated" | "third-party";
  sourceRepo?: string;
  sourceCommit?: string;
  sourcePath?: string;
  sourceUrl?: string;
  rightsStatus: "user-confirmed-2026-08-21" | "approved" | "prototype-only" | "reference-only";
  approvalRef?: string;
  derivation?: { tool: string; promptRef?: string; parentAssetIds: string[] };
  sourceSha256: string;
  outputSha256: string;
  format: string;
  dimensionsOrGeometry: Record<string, number>;
  shipTier: "production" | "prototype" | "reference-only";
  replacementKey?: string;
  dependencies: string[];
};
```

build guard는 필수 record 누락, hash 불일치, production build의 `prototype-only`/`reference-only`, anchor 누락, 예산 초과를 실패시킨다.

### 7.3 3D 교체 계약

- GLB 2.0, meter 단위, Y-up, floor `y=0`
- chapter origin과 forward 규칙 고정
- static render mesh와 collider mesh 분리
- door hinge pivot과 닫힘 blocker 명시
- baked lightmap은 UV2 사용
- gameplay 코드는 메시 이름을 직접 찾지 않고 manifest의 semantic id를 조회

필수 anchor prefix:

```text
ANCHOR_player_start
ANCHOR_checkpoint_*
ANCHOR_setpiece_bell
ANCHOR_chapter_exit
INT_door_*
INT_power_panel_*
HIDE_*
NAV_*
COL_*
AUDIO_*
LIGHT_*
OCC_*
```

공식 GLB 교체는 anchor validator와 Chapter 1 smoke test를 통과해야 완료로 본다. 공식 geometry가 anchor를 제공하지 않으면 import adapter에서 sidecar manifest를 합성하되 게임 런타임 계약은 바꾸지 않는다.

## 8. 정확한 구현 파일 계획

아래는 구현 에이전트가 생성·수정할 예상 파일이다. 폴더마다 작은 helper를 무분별하게 늘리지 않고 외부 interface가 필요한 단위만 분리한다.

### 8.1 라우트와 gate

- `app/games/prototype-last-bell/page.tsx`
- `app/games/prototype-last-bell/page.test.tsx`
- `lib/prototypes/last-bell/gate.server.ts`

### 8.2 Client shell과 HUD

- `components/prototype/last-bell/LastBellClient.tsx`
- `components/prototype/last-bell/LastBellStage.tsx`
- `components/prototype/last-bell/last-bell.module.css`
- `components/prototype/last-bell/hud/Preflight.tsx`
- `components/prototype/last-bell/hud/GameHud.tsx`
- `components/prototype/last-bell/hud/PauseMenu.tsx`
- `components/prototype/last-bell/hud/SettingsPanel.tsx`
- `components/prototype/last-bell/hud/DirectionalCaptions.tsx`
- `components/prototype/last-bell/hud/MobileControls.tsx`
- `components/prototype/last-bell/hud/PhoneOverlay.tsx`
- `components/prototype/last-bell/hud/LoadingScreen.tsx`

### 8.3 깊은 runtime 모듈

- `lib/prototypes/last-bell/engine/index.ts`
- `lib/prototypes/last-bell/engine/types.ts`
- `lib/prototypes/last-bell/engine/runtime.ts`
- `lib/prototypes/last-bell/engine/state-machine.ts`
- `lib/prototypes/last-bell/engine/chapter-flow.ts`
- `lib/prototypes/last-bell/engine/prng.ts`
- `lib/prototypes/last-bell/engine/risk-layout.ts`
- `lib/prototypes/last-bell/engine/perception.ts`
- `lib/prototypes/last-bell/engine/checkpoint.ts`
- 같은 폴더의 public-interface 중심 `*.test.ts`

### 8.4 입력, 렌더링, 오디오, 저장

- `lib/prototypes/last-bell/input/types.ts`
- `lib/prototypes/last-bell/input/keyboard-mouse.ts`
- `lib/prototypes/last-bell/input/touch.ts`
- `components/prototype/last-bell/scene/ChapterScene.tsx`
- `components/prototype/last-bell/scene/PlayerRig.tsx`
- `components/prototype/last-bell/scene/ZombieActors.tsx`
- `components/prototype/last-bell/scene/Interactables.tsx`
- `components/prototype/last-bell/scene/Lighting.tsx`
- `lib/prototypes/last-bell/render/quality.ts`
- `lib/prototypes/last-bell/render/collision.ts`
- `lib/prototypes/last-bell/render/anchors.ts`
- `lib/prototypes/last-bell/audio/director.ts`
- `lib/prototypes/last-bell/audio/manifest.ts`
- `lib/prototypes/last-bell/persistence/types.ts`
- `lib/prototypes/last-bell/persistence/local.ts`
- `lib/prototypes/last-bell/persistence/memory.ts`

### 8.5 콘텐츠, 에셋, 검증

- `lib/prototypes/last-bell/content/game.ts`
- `lib/prototypes/last-bell/content/chapter-01.ts`
- `public/game-assets/last-bell/<content-hash>/...`
- `public/game-assets/last-bell/asset-manifest.v1.json`
- `docs/ip/all-of-us-are-dead-2/assets/provenance-manifest.json`
- `scripts/validate-last-bell-assets.mjs`
- `test/e2e/last-bell-prototype.spec.ts`
- `next.config.ts`의 해시 자산 immutable header
- `package.json`, `package-lock.json`의 검증된 3D dependency

기존 `app/games/[gameId]`, `components/games/GameScreen.tsx`, `lib/games/*`, Supabase migration은 건드리지 않는다.

## 9. Tracer-bullet 구현 순서

각 단계는 자체로 실행 가능하고, 다음 단계가 전 단계를 버리지 않게 한다.

### T0 — 게이트된 3D 방

- 독립 route, exact env gate, noindex, request-time 판정
- lazy R3F canvas와 절차형 교실 한 칸
- preflight에서 오디오 unlock·품질 선택·landscape 안내
- 검증: gate 404/200, SSR에서 WebGL import 없음, canvas mount/unmount

### T1 — 같은 규칙의 이동과 충돌

- fixed-step runtime, swept capsule, 계단 없는 교실/복도 shell
- PC와 touch adapter를 같은 `InputFrame`으로 연결
- pointer lock 상실, portrait, tab hidden 시 pause
- 검증: frame cadence 독립성, collider 관통 방지, 입력 equivalence

### T2 — 오프닝에서 조작으로

- 30초 인엔진 오프닝, skip, seamless POV handoff
- 카메라 transform과 문 상태를 runtime에 인계
- 검증: skip/non-skip이 같은 `CONTROL_HANDOFF` snapshot에 도착

### T3 — 핵심 공포 문법

- 한 감염자와 청취·은신·문 잠금 tutorial
- 소리 event, flashlight near-reaction, 방향 자막
- 첫 grapple rapid tap 및 동일 encounter 재시작
- 검증: 감지/은신/문 전이, 모바일 반복 입력, pause 안전성

### T4 — 경로와 비상전력

- 세 semantic route, authored nav graph, risk-budget generator
- 설비실 panel interaction과 `ch1_power_restored` checkpoint
- 결정론적 validation, invalid seed golden fallback
- 검증: BFS 도달성, route별 risk 범위, backtrack 무증원

### T5 — 종소리 세트피스와 완료

- opening bell motif 회수, dormant infected wake, 60–90초 escape
- ready hiding spot·door delay·safe stair
- Chapter complete 화면과 local checkpoint 정리
- 검증: 전체 5–7분 E2E, 실패/재시도 same layout

### T6 — 모바일·접근성·오디오 완성

- quality tier, captions, FOV/head-bob/shake/sensitivity
- phone map, touch safe area, portrait overlay
- 오디오 bus/streaming/ducking, WebAudio recovery
- 검증: 실제 iOS Safari/Android Chrome와 reduced-motion

### T7 — 자산 교체와 성능 하드닝

- provenance manifest, hash, anchor, budget build guard
- KTX2/Meshopt/baked lighting, LOD, memory/context-loss recovery
- 절차형 ↔ official GLB adapter swap rehearsal
- 검증: cold/cached load, p95 frame, draw call, memory, production-tier manifest

## 10. 25–35분 전체 게임 확장 로드맵

현재 코드는 Chapter 1만 구현한다. 나머지는 같은 runtime와 content interface가 실제로 견디는지 보여주는 계획이지 이번 변경의 콘텐츠 범위가 아니다.

| 구간 | 목표 시간 | 고정 목표/세트피스 | 새로 깊어지는 시스템 | 재사용 seam |
| --- | ---: | --- | --- | --- |
| Chapter 1 마지막 수업 | 5–7분 | 탈출 문법 학습, 비상전력, 첫 종소리 | 이동·청취·은신·문·추격 | runtime, anchors, checkpoint |
| Chapter 2 망가진 방송 | 6–8분 | 전력/CCTV, 필수 온조 방송, 음악 유인 | 방송/전력 network, group lure | semantic devices, AudioDirector |
| Chapter 3 숨 | 7–9분 | 급식실/체육관, 후문 수동 핸들 회수 | breath hold, 넓은 공간 risk | perception, route budget |
| Chapter 4 후문 | 6–8분 | 발전기/방화문/후문, 45–60초 생존 후 추격 | chained objective, finale director | chapter content, recorder seam |
| 에필로그 | 1–3분 | 생존 결과와 단서 회수 | 읽기 전용 run summary | future server recorder |

목표 합계는 25–35분이다. Chapter별 고정 objective/setpiece를 유지하고 2–3개 route risk layout만 seed로 바꾼다. Chapter 콘텐츠는 `ChapterDefinition` 데이터와 semantic commands로 추가하며 runtime에 `if (chapterId === ...)` 분기를 쌓지 않는다.

전체 게임 production 전의 문서 정렬 상태와 별도 승인 선행 조건은 다음과 같다.

1. **반영 완료** — PRD §4.3과 ARCHITECTURE §2.1에서 현재 `local-prototype`과 production `anonymous-story-run`의 별도 권위 경계를 분리
2. **남은 production guest gate** — 서버 익명 run ID·seed 발급, 순서가 있는 Chapter event 검증, 검증된 기록 기반 순위 제출·계정 이전 계약 구현
3. survivor 번호/학급 roster의 공식 표기 확정
4. Chapter 2–4 공식 대사·공간·오디오 승인

## 11. 성능 예산

| 항목 | Low mobile | Medium | High desktop | 실패 처리 |
| --- | ---: | ---: | ---: | --- |
| render p95 | ≤33.3ms / 30fps | ≤22ms | ≤16.7ms / 60fps | 자동 quality 하향 |
| visible triangles | ≤350k | ≤650k | ≤1.2m | LOD/cull/asset guard |
| draw calls | ≤120 | ≤180 | ≤260 | merge/instancing |
| GPU texture 추정 | ≤128MB | ≤256MB | ≤512MB | texture tier 하향 |
| skinned infected visible | 6 | 10 | 14 | distant impostor/static pose |
| active AI logic | 최대 12 | 최대 12 | 최대 12 | encounter director 대기열 |
| dynamic shadow caster | 0 | 1 | ≤3 | baked-only fallback |
| JS + shell gzip | \- | ≤1.5MB | ≤1.5MB | engine lazy split |
| opening + critical Ch1 compressed | ≤18MB 목표, 25MB hard | 동일 | 동일 | build 실패/asset trim |
| 추가 Ch1 stream | ≤12MB | ≤12MB | ≤12MB | 비필수 preload 제거 |
| decoded short SFX | ≤24MB | ≤24MB | ≤24MB | eviction/stream |
| 총 heap+GPU 관찰값 | ≤350MB | ≤500MB | ≤900MB | reload 가능한 recovery |

- device pixel ratio는 tier별 동적 0.7–1.0 scale을 적용하고 low 상한 1.5, high 상한 2.0으로 둔다.
- 첫 상호작용 가능한 shell은 일반 broadband cached 조건 3초 이내를 목표로 한다.
- 로드 중 progress, 취소, 오프닝 skip을 제공한다.
- WebGL context loss는 shell로 복귀하여 checkpoint에서 scene을 재구축한다.

## 12. 접근성 계약

- FOV 70–100, look sensitivity, Y축 반전, look acceleration toggle
- head bob, camera shake 각각 off/low/default
- motion blur 기본 off, reduced-motion 오프닝 제공
- 상호작용 reticle high contrast, 색만으로 상태를 전달하지 않음
- 자막 크기·배경·화자/범주 구분, 방향 자막은 8방향+강도만 표시
- 종소리/비상등은 3Hz 초과 섬광을 만들지 않고 느린 pulse 사용
- 모바일 touch target 최소 48 CSS px, safe-area 반영
- 언제든 pause, tab hidden/portrait/pointer-lock-loss 자동 pause
- 마이크 입력 없음
- 첫 grapple의 rapid tap에는 장시간 hold/autotap 대체 입력을 제공하지 않는다는 사용자 결정을 유지한다. 이는 알려진 접근성 위험이며 PC·모바일의 성공 시간 분포를 QA에서 맞춘다.

## 13. 게스트와 로컬 체크포인트

prototype은 로그인 없이 완주 가능하며 다음 key를 분리한다.

- `icons:last-bell:identity:v1`: opaque local survivor id와 미확정 roster용 내부 값
- `icons:last-bell:checkpoint:v1`: 24시간 TTL, chapter/checkpoint/seed/resolved layout/version
- `icons:last-bell:settings:v1`: 접근성·입력·오디오 설정

실시간 entity transform, 감염자 위치, 타이머 중간값은 저장하지 않는다. 체크포인트는 semantic state에서 안전하게 scene을 재구성한다. schema migration 실패나 만료 시 Chapter 시작으로 fail closed한다. prototype run은 `leaderboardEligible: false`, `authority: "local-prototype"`로 명시한다.

## 14. 테스트와 QA 계획

### 자동 테스트

- route: exact gate, request-time 판정, noindex, dynamic client fallback
- 금지 결합: `play_game`, 카드 리워드, Supabase game RPC import/call 없음
- runtime interface: 모든 합법/불법 상태 전이
- fixed step: 30/60/120fps render cadence에서 동일 결과
- seed: 동일 seed·version의 동일 resolved layout, retry 동일성
- risk layout: BFS 도달성, 예산, golden fallback, backtrack 무증원
- perception: sound occlusion, run noise, flashlight near-reaction, hide break 조건
- doors/grapple/checkpoint: lifecycle, 실패/재시작, TTL/version migration
- input: PC/touch의 normalized action equivalence
- assets: provenance/hash/anchor/format/budget/release-tier guard
- UI: HUD, pause, caption, mobile control의 keyboard/touch 접근

### E2E와 수동 QA

- gate OFF 404, ON 진입
- desktop opening skip/non-skip과 동일 handoff
- Chapter 1 전체 happy path 및 각 tutorial 실패 복구
- 같은 seed/layout 재시도
- 844×390, 740×360 landscape 및 portrait pause overlay
- Chrome, Safari, iOS Safari, Android Chrome
- reduced-motion, captions, head-bob off, 키보드만 사용
- WebAudio unlock/resume, 이어폰 방향성, mute/ducking
- p95 frame, draw call, GPU texture, heap, cold/cached load
- WebGL context loss와 checkpoint recovery
- 24시간 만료 직전/직후 체크포인트

문서만 바꾸는 이번 단계에서는 `npm run lint`/`npm run build` 대상 코드가 없다. 구현 단계의 완료 gate는 관련 unit/E2E, asset validator, `npm run lint`, `npm run build`가 모두 통과하는 것이다.

## 15. 구현 중 반드시 멈춰야 하는 위험

다음은 임의로 추정해 넘기지 않는다.

- official GLB가 anchor/scale/rights metadata 없이 전달됨
- guest production run을 기존 로그인 보호 게임 계약에 몰래 연결해야 함
- survivor 번호/학급 표기를 사용자-facing으로 확정해야 함
- 공식 캐릭터 음성/대사를 새로 만들어야 함
- low-mobile hard budget을 넘는데 시각 품질보다 예산을 바꿔야 함

반대로 공식 3D 원본이 없다는 사실 자체는 blocker가 아니다. procedural 3D adapter로 Chapter 1을 완성하고, 교체 seam과 검증을 유지한다.
