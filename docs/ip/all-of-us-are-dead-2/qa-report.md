# 《지금 우리 학교는: 마지막 종》 로컬 수직 슬라이스 QA

> 검증일: 2026-08-21 (Asia/Seoul)
>
> 대상: `/games/prototype-last-bell`, `/games/prototype-last-bell/popup`, `/games/prototype-last-bell/popup/[zone]`, 내부 G2 비교 랩
>
> 기준 범위: `c9b8a02` 이후의 Last Bell·AOUAD 캠페인 통합 변경

## 결론

Chapter 1의 압축된 수직 슬라이스, AOUAD 전용 온라인 팝업, 두 개의 저비용 G2 비교 후보를 같은 exact env gate와 로컬 무권위 결과 계약으로 연결했다. Last Bell은 데스크톱에서 오프닝부터 완료까지 플레이 가능하고, 팝업은 첫 방문·재방문 재소집 오프닝, 메모리 전용 선택 사진을 지원하는 학생증, 5개 개인 수색 존·개별 인장, 별도 Last Bell 생존 인장, 매점 미리보기와 이미지 공유 폴백을 제공한다. 모바일 390×844에서 전체 팝업 동선과 G2 후보를 검증했으며 가로 넘침과 콘솔 오류·경고가 없다.

이 결과는 G3 승격이나 Chapter 1 목표 길이 5~7분, 최적화 GLB·KTX2 환경 제작의 완료를 뜻하지 않는다. 현재 Last Bell은 세 경로 선택과 완주 기록을 가진 압축 플레이어블 후보이며, 내부 참여자 평가에서 가중 총점 1위를 유지할 때만 G3 고품질 제작으로 진행한다. 임의 점수나 승격 결론은 기록하지 않았다.

## 검증 환경

- Node.js `v24.16.0`, npm `11.13.0`, Next.js `16.3.0`
- Chromium/Playwright 데스크톱 `1440×900`, Codex in-app Chromium `1280×720`
- touch/mobile Chromium `844×390`, `740×360`, portrait `390×844`
- 로컬 development 서버와 `next start` production 서버
- 실제 iOS Safari, Android Chrome, macOS Safari 실기기는 이번 검증에서 실행하지 않았다.

## 브라우저 플레이 결과

### 데스크톱 전체 경로

1. 30초 오프닝 화면과 `소리와 함께 시작`, `오프닝 건너뛰기`를 확인했다.
2. 교실 문까지 이동해 `문을 통과해 잠그기`가 거리 안에서만 나타나고, 상호작용 한 번에 문 뒤 안전 좌표로 handoff되는 것을 확인했다.
3. 복도에서 `Q` 청취를 켜 `왼쪽 복도 · 발소리 · 약` 방향 자막과 발소리·감염자 cue 요청을 확인했다.
4. 사물함 은신 지점에서 `C`로 진입·이탈하고 `숨는 중 · C로 나오기` 상태와 vignette를 확인했다.
5. 비상전원을 올린 뒤 목표가 `비상전원이 돌아왔다. 화재문을 잠가라`로 바뀌고 `ch1_power_restored`가 저장되는 것을 확인했다.
6. 화재문까지 이동해 `화재문을 통과해 잠그기`를 실행하고 문 뒤에서 마지막 종을 울렸다.
7. 종을 울린 뒤 멈춰 약 3.3초 안에 붙잡힘 화면을 확인했다. 종 이후에는 새 checkpoint를 저장하지 않고 마지막 안전 checkpoint인 `ch1_power_restored`를 유지한다.
8. `다시 시도`로 전력이 복구된 상태와 화재문 목표 직전으로 복원한 뒤 달려 Chapter exit에 도달했다.
9. `CHAPTER 01 COMPLETE` 화면을 확인했고 완료 직후 로컬 체크포인트가 삭제됐다.

### 저장과 복구

- 교실 이탈 뒤 새로고침하면 오프닝에 `체크포인트에서 계속 · 복도 진입 직전`이 표시된다.
- 이어하기를 선택하면 오프닝을 건너뛰고 복도 목표와 안전 위치가 복원된다.
- 단위 테스트에서 24시간 TTL 직전은 유효하고 만료 시점부터 폐기됨을 검증했다.
- 손상 JSON, schema version 불일치, 잘못된 payload는 삭제하고 새 게임으로 fail closed한다.
- 종 이후 `ch1_post_bell_safe`를 저장하거나 복원하는 경로는 없다. 추격 실패 retry/restore는 `ch1_power_restored`로만 돌아가 추격을 건너뛰지 못한다.
- 정상 진행 중 checkpoint 값 갱신은 플레이어를 순간이동시키지 않으며 retry/restore 때만 위치를 재구성한다.

### 모바일

- `844×390`과 `740×360`에서 이동 스틱과 `듣기/숨기/달리기/행동` 네 버튼이 표시됐다.
- 네 행동 버튼의 실제 CSS box는 약 `51.2×51.2px`이며 두 viewport에서 화면 경계를 벗어나지 않았다.
- `hasTouch: true`, coarse pointer 환경에서 같은 UI를 확인했다.
- `390×844`에서는 시네마틱·pause보다 높은 레이어에 `화면을 가로로 돌려주세요` 안내가 표시되고 simulation이 정지한다.

### 네트워크·콘솔

- 생성 환경 plate, 공식 로고, 6개 개별 재질은 `200`, `206`, 또는 캐시 재검증 `304`로 응답했다.
- 자체 제작 오디오 8종 중 실제 동선에서 호출된 ambience, drone, door pounding, footsteps, groan, breaker, bell이 `200/206`으로 응답했다. 숨기용 breath/heartbeat는 파일 디코드와 런타임 경로 계약으로 별도 검증했다.
- fresh navigation과 완주 흐름의 브라우저 console 결과는 `0 errors / 0 warnings`였다.
- 포인터 잠금이 Chromium에서 거부되는 조건도 Promise 거절을 흡수해 게임을 유지하고 콘솔 오류를 만들지 않는다.
- 사용하지 않는 재질 atlas는 런타임에서 preload하지 않는다.

### 최종 보정 계약

- 추격 AI와 플레이어 이동은 30Hz fixed-step으로 갱신되어 30/60/120Hz render cadence에 같은 결과를 낸다.
- pause/captured/complete 상태는 `role=dialog`, `aria-modal=true` modal이며 primary action focus와 Tab 순환을 제공한다. 완료 상태에서 세로 회전해도 `complete > captured > paused` 우선순위로 dialog와 ARIA ID가 하나만 남는 것을 production build 브라우저에서 재검증했다.
- opening/transition plate와 완료 로고는 `next/image`로 로드하고 opening plate는 `preload` 힌트를 갖는다.
- capture 판정은 UI danger 샘플링과 분리된 30Hz fixed-step tick에서 한 번만 전달되며, 30/60/120Hz render cadence에서 같은 capture 결과를 낸다.
- `bell_trigger`는 일반 anchor 반경 2.25m가 아닌 authored 0.95m 반경만 유효하다. 최외곽 유효 위치에서 종을 울린 직후 현실적인 sprint/strafe로 `bell_hide`에 진입해도 capture되지 않는 순수 결정론 테스트를 통과한다.
- bell hide는 종·감염자 spawn과 겹치지 않는 벽 쪽 anchor를 사용한다. 은신 중 감염자는 최소 2.6m standoff를 유지해 숨기→대기→이탈 회복이 가능하다.
- DOM prompt와 C/E keyboard action은 동일한 최신 nearest descriptor를 사용한다. window keyboard listener는 nearest closure 변경마다 재등록하지 않고 stable ref를 읽는다. production build에서 `bell_hide` prompt 직후 C와 `chapter_exit` prompt 직후 E를 지연 없이 입력해 각각 은신·완료되는 것을 재검증했다.
- 문은 열린 시각 상태로 이동하지 않는다. `문을 통과해 잠그기`/`화재문을 통과해 잠그기`가 atomic handoff를 수행하고, 닫힌 문은 역방향 통과만 blocker로 막는다.

## 온라인 팝업 통합 결과

### 라우팅·진입

- 허브 `/games/prototype-last-bell/popup`과 6개 존(`classroom`, `cafeteria`, `broadcast`, `theater`, `store`, `rooftop`)을 iframe 없이 현재 Next.js 라우팅으로 이식했다.
- 첫 방문에는 10초 재소집 오프닝이 나타나며 건너뛰기와 `Escape`가 같은 종료 동작을 수행한다. 새 문서 재방문에는 즉시 축약판이 나타나고, 같은 문서의 허브↔존 이동에서는 입장 의식이 반복되지 않는다. 오프닝과 뒤쪽 hero를 동시에 preload하지 않고 현재 표시되는 first-view 이미지 하나만 우선한다.
- 팝업 초기 화면에는 Three.js canvas·Last Bell runtime script가 없고, 게임 링크는 `prefetch={false}`다. 게임 진입 뒤에만 canvas가 생성되는 것을 브라우저에서 확인했다.
- 모든 팝업·G2 route는 `noindex, nofollow`이고 게임과 같은 exact env gate를 사용한다.

### 개인 진행·매점·공유

- 이름 없이 입장한 상태에서 교실 기록 3개, 급식실, 방송실 100%, IF 극장, 옥상 불씨를 완료해 허브의 개인 수색이 `5 / 5`로 복원되는 것을 확인했다.
- 5개 존 인장은 학생증에 각각 표시되고 Last Bell 생존 인장과 분리된다. 5존을 완료해도 미완주 Last Bell 기록은 생성되지 않는다.
- 매점은 게임·존 완주 전에도 직접 열리며 가격·SKU·재고·카운트다운 없이 상품명과 로컬 위시만 표시한다. 위시 1개가 새로고침 뒤 복원되는 것을 확인했다.
- 급식실은 모션 설정과 무관하게 항상 사용할 수 있는 정적 대체 입력과 `aria-live` 결과를 제공한다.
- 학생증 사진은 JPEG·PNG·WebP 2MB 이하만 받는다. object URL과 공유 동의는 같은 문서 메모리에만 두고 허브↔존 이동 동안 유지하며, 교체·삭제 시 이전 URL을 해제한다. 공유 카드 포함은 기본 OFF이고 사용자가 명시적으로 켠 경우에만 사진을 전달한다.
- 공유는 세 후보 모두 생성 이미지 카드의 File Web Share, 텍스트 Web Share, 이미지 저장, 클립보드 순서다. 공유 시트 `AbortError`는 사용자 취소로 종료하며 재공유·다운로드를 실행하지 않는다. 기본 카드에는 학생 이름·avatar·업로드 사진이 없다.
- 이벤트는 exact-key allowlist를 통과한 비식별 이벤트만 받으며 이름·사진·자유서술·추가 필드는 거부한다.
- `window.localStorage` getter가 `SecurityError`를 던지는 브라우저 조건에서도 팝업 hydration, G2 결과, Last Bell 플레이가 메모리 상태로 계속되고 콘솔 오류가 발생하지 않는 것을 확인했다. 팝업 Provider는 공통 layout에 있어 허브↔존 이동 중 이름·존·위시 진행도 유지된다.

### 반응형·시각 QA

- 1280×720은 야간 학교 hero의 좌측 카피·2×2 CTA와 우측 학생증을 유지한다.
- 390×844은 첫 방문 이름·avatar·선택 사진 폼과 입장 버튼이 viewport 안에 들어오고, 허브는 게임 CTA → 학생증 → 5존 → 매점 → 생존 기록·캠페인 안내 순으로 흐르며 `documentElement.scrollWidth <= innerWidth`를 만족한다. 학생증의 Last Bell+5존 인장 6개도 카드 안에서 줄바꿈된다.
- 짧은 `1280×720`과 모바일 가로 `844×390`에서도 오프닝 프레임이 `dvh` 경계 안에서 세로 스크롤된다. 포커스된 `등교하기` CTA의 실제 하단은 각각 약 `644px`, `331px`로 viewport 안에 들어온다.
- 획득 인장은 색상과 별도로 화면에 `✓`를 표시하고, 파일 검증 오류는 업로드 입력의 `aria-describedby`·`aria-invalid`와 연결된다. 공유 카드의 선택 사진은 원본 비율을 유지한 중앙 `cover` 크롭을 사용한다.
- 콘셉트 대비 hero 구도, 검정·세이지·엠버 팔레트, CTA 위계, 학생증, 존·매점 타일, 모바일 재배치를 확인했다.
- 팝업·감염 기록·3분 생존의 fresh navigation에서 Next Image LCP 경고를 포함해 console `0 errors / 0 warnings`를 확인했다.

## G2 비교 검증

- 내부 랩 `/games/prototype-last-bell/popup/lab`에 Last Bell, 2D 감염 기록, 180초 생존 아케이드를 같은 로컬 `AouadComparisonResult` 계약으로 연결했다.
- 감염 기록은 3개 선택 뒤 escaped/quarantined/infected 결과와 4개 공통 CTA를 만든다. 브라우저에서 quarantined 결과, 재도전·공유·팝업·매점 CTA, 결과 제목으로의 포커스 이동과 `aria-live` 알림을 확인했다.
- 감염 기록과 생존 아케이드는 공통 visible active clock을 사용해 background 시간을 제외한다. 생존 아케이드는 30Hz simulation을 별도로 유지하며, 30/60/120Hz 결정론과 5fps에서도 180초가 실제 180초로 끝나는 계약, pause/background 시간 제외를 테스트했다.
- Last Bell 완주 시 전용 `LastBellCompletionRecord`와 `icons:aouad-comparison:v1:last-bell`을 함께 저장하고 같은 4개 결과 CTA를 제공한다.
- 평가는 [`g2-evaluation-kit.md`](./g2-evaluation-kit.md)의 8개 가중 항목으로 내부팀이 수행한다. 참여자 원자료가 없으므로 현재 승격 결과는 미정이다.

## 자산·provenance

- 통합 manifest는 64개 자산을 기록하며 모든 파일의 존재, byte size, SHA-256을 실제 파일과 대조한다.
- `icons-hq/icons@d63c7f0c4c5851c9722afdd895c87b72a7217c2d`의 공식 이미지 24개는 원본 경로·commit을 고정했다.
- 공식 이미지, 생성 콘셉트·런타임 WebP, 자체 합성 오디오는 `source_type`과 편집 이력으로 구분된다. 모든 `manifest://` 참조가 실제 manifest ID로 해석되는 테스트를 추가했다.
- 런타임 PNG master는 문서용 콘셉트로만 보존하고, 팝업은 WebP와 필요한 공식 카드 이미지만 요청한다.

## 게이트 검증

production build의 요청 시점 환경값으로 직접 확인했다.

| 환경 | HTTP | robots | 결과 |
| --- | ---: | --- | --- |
| `ICONS_LAST_BELL_PROTOTYPE=0` | `404` | `noindex` | fail closed |
| `ICONS_LAST_BELL_PROTOTYPE=1` | `200` | `noindex, nofollow` | prototype 표시 |

이 라우트는 일반 `/games/[gameId]`와 카드 리워드 계약을 호출하지 않는다.

## 자동 검증

| 명령/검사 | 결과 |
| --- | --- |
| `npm run typecheck` | 통과 |
| `npm run lint` | exit 0, 기존 `scripts/hong-sil-downloader.mjs:294` warning 1건만 존재 |
| `npm test -- --run` | 335 files passed, 1 skipped / 3,243 tests passed, 1 skipped |
| `npm run build` | 통과, game·popup·zone·G2 route는 dynamic server-rendered route |
| `git diff --check` | 통과 |
| asset manifest 검증 | 64개 전부 존재, byte size와 SHA-256 일치, `manifest://` 참조 해석 가능 |
| audio `ffprobe` | 게임 8개와 캠페인 5개 전부 decode 가능; 캠페인 오디오는 48kHz mono PCM |

## 현재 남은 범위와 위험

- 이 저장소와 확인한 소스 저장소에는 공식 효산고 GLB/GLTF/FBX와 공식 게임용 오디오 원본이 없다. 현재 이동 공간은 절차형 R3F/Three 3D이며 공식 공간이 들어오면 semantic anchor 계약 뒤에서 교체해야 한다.
- 오프닝은 현재 생성 raster plate 두 장을 이어 붙인 영화적 연출이다. 합의된 완전한 인엔진 30초 시네마틱과 무절단 handoff는 G3 승격 뒤 제작 범위다.
- Chapter 1에는 정면·후문·설비실 세 경로 선택과 결과 분류가 있으나, 같은 절차형 복도 안의 압축 동선이다. 목표 5~7분, 공간적으로 충분히 분리된 세 경로, risk-budget generator, 손전등 반응, grapple 연타, 설정·멀미 완화, phone/CCTV는 아직 구현되지 않았다.
- 최적화 GLB, KTX2, 라이트맵은 아직 없다. 공식 효산고 원본이 들어오면 semantic anchor·충돌 계약 뒤에서 교체한다.
- Chapter 2~4, 대학 에필로그, G4 서버 run/seed 검증, 공동 미션, 순위, 로그인 이전, 상품 가격·재고·결제는 이번 로컬 프로토타입에 포함하지 않았다.
- 이 env-gated local prototype은 보상·구매 권한을 만들지 않는다. G3 승격은 내부 평가, production 공개는 서버 권위와 별도 운영 결정을 거쳐야 한다.
- authored full-spec의 post-bell safe checkpoint는 로컬 악용 방지를 위해 의도적으로 보류하고 `ch1_power_restored`만 저장한다.
- 공식 GLB를 연결한 뒤에는 실제 iOS/Android/Safari 실기기, 10분 멀미 세션, p95 frame time, draw call, GPU memory, WebGL context loss를 다시 검증해야 한다.
