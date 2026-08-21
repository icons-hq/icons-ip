# 《지금 우리 학교는: 마지막 종》 로컬 수직 슬라이스 QA

> 검증일: 2026-08-21 (Asia/Seoul)
>
> 대상: 독립 게이트 라우트 `/games/prototype-last-bell`
>
> 기준 commit: `eaca8cc084d302cf462eb502aa73b1400f3cdfd3` 이후의 로컬 변경

## 결론

Chapter 1의 압축된 수직 슬라이스는 데스크톱에서 오프닝부터 완료까지 플레이 가능하다. 실제 브라우저에서 청취·은신·문 잠금·비상전원·종 세트피스·추격 실패·동일 체크포인트 재시도·탈출을 순서대로 검증했다. 모바일 가로 터치 UI와 세로 회전 안내, 24시간 로컬 체크포인트, 서버 전용 fail-closed gate도 동작한다.

이 결과는 전체 25~35분 게임이나 Chapter 1 목표 길이 5~7분의 완료를 뜻하지 않는다. 현재 구현은 핵심 동사와 기술 경계를 검증하는 압축된 Chapter 1 플레이어블 빌드다.

## 검증 환경

- Node.js `v24.16.0`, npm `11.13.0`, Next.js `16.3.0`
- Chromium/Playwright 데스크톱 `1440×900`
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
| `npm test -- --run` | 311 files passed, 1 skipped / 3,137 tests passed, 1 skipped |
| `npm run build` | 통과, prototype route는 dynamic server-rendered route |
| `git diff --check` | 통과 |
| asset manifest 검증 | 27개 전부 존재, byte size와 SHA-256 일치 |
| audio `ffprobe` | 8개 전부 decode 가능, 48kHz stereo |

## 현재 남은 범위와 위험

- 이 저장소와 확인한 소스 저장소에는 공식 효산고 GLB/GLTF/FBX와 공식 게임용 오디오 원본이 없다. 현재 이동 공간은 절차형 R3F/Three 3D이며 공식 공간이 들어오면 semantic anchor 계약 뒤에서 교체해야 한다.
- 오프닝은 현재 생성 raster plate 두 장을 이어 붙인 영화적 연출이다. 합의된 완전한 인엔진 30초 시네마틱과 무절단 handoff는 후속 제작 범위다.
- 현재 Chapter 1은 단일 압축 동선이다. 목표 5~7분, 세 경로, risk-budget generator, 손전등 반응, grapple 연타, 설정·멀미 완화, phone/CCTV는 아직 구현되지 않았다.
- Chapter 2~4, 대학 에필로그, 서버 run/seed 검증, 순위, 로그인 이전, 상품 연결은 이번 로컬 프로토타입에 포함하지 않았다.
- 이 env-gated local prototype은 서버 권위, 로그인, promotion gate, 상품 연결을 구현하지 않는다. 공개 promotion 전 별도 제품·운영 결정을 거쳐야 한다.
- authored full-spec의 post-bell safe checkpoint는 로컬 악용 방지를 위해 의도적으로 보류하고 `ch1_power_restored`만 저장한다.
- 공식 GLB를 연결한 뒤에는 실제 iOS/Android/Safari 실기기, 10분 멀미 세션, p95 frame time, draw call, GPU memory, WebGL context loss를 다시 검증해야 한다.
