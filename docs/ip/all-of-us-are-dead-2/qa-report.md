# 《지금 우리 학교는: 마지막 종》 2챕터 로컬·Preview QA

> 검증일: 2026-08-26 (Asia/Seoul)
>
> 조정 release build: `last-bell-release-da8957979ec883a0`
>
> 대상: `/games/prototype-last-bell`, `/experiences/all-of-us-are-dead/last-bell`, `/games/prototype-last-bell/popup/store`

## 결론

현재 로컬 worktree에는 정확히 두 챕터로 구성된 10분 목표의 Last Bell 게임, 처치 없는 잠입·도주 simulation, 10개 상품 수집, 옥상 남라 엔딩, 서버 검증 run과 story entitlement 구매권 경계가 연결되어 있다. QA 전용 경로는 구매권을 만들지 않고, verified 후보 경로만 Supabase run ledger를 사용한다.

런타임·서버 계약과 public route validator는 승인된 `r18` 승격 뒤 통과한다. 사용자는 2026-08-26 Netflix 협의와 IP·human visual·캐릭터·환경·오프닝·대사 승인을 모두 완료했다고 명시했고, 이 확인을 human/external-IP 승인 근거로 기록했다. 6개 route와 4개 캐릭터의 동일 delivery build 렌더 12장, current `e336…` 오프닝 렌더 4장을 저장소에 고정했으며 release guard가 매 실행마다 실제 PNG SHA-256과 build ID를 다시 확인한다.

따라서 `last-bell-route-character-99f9d262441685b4`와 `last-bell-3d-e3367030b580e17d`의 시각·external/IP gate는 `P0=0`, `no_clay_primitive_final=true`로 닫혔고 public delivery 승격이 완료됐다. 이 승인은 실제 기기 10분 성능, 사람 5회 페이싱, production 배포 read-back 또는 상품 제조·판매 정보 확정을 대신하지 않는다.

## 구현 범위

### Chapter 1 — 죽은 학교

- 목표 길이 `7분 05초`, 폭격 후 밤의 파괴된 효산고에서 바로 시작한다.
- 미닫이문 열기→통과→닫기→잠금, 손전등·집중 청취·은신, 샛길 탐색, 비상전원, 소음 유인, 방화문·바리케이드, 마지막 종과 계단 추격을 한 개의 주 경로로 연결했다.
- 좀비는 `patrol → investigate → search → chase → capture`를 renderer 밖 30Hz fixed-step에서 계산한다. 최대 동시 활성은 2체이며 벽, 잠긴 문, LOS, 손전등 조사각, 발소리, 마지막 목격 위치를 같은 simulation snapshot에서 읽는다.
- 감염 복선은 힘, 좀비의 망설임, 충격 뒤 빠른 회복 세 번만 사용한다.

### Chapter 2 — 옥상의 불빛

- 목표 길이 `2분 55초`, 계단실의 마지막 두 수집품과 체크포인트 뒤 옥상으로 이어진다.
- 옥상 문이 열리면 좀비, 수집품, 구매 UI와 일반 HUD를 제거한다.
- 차가운 옥상과 따뜻한 모닥불, 남라 접근, 맥박 고정·비자발적 전진, `너…`·`인간이 아니네.`, 제압, BLACK, 심장 정지, 여러 사람의 계단 발소리 순서를 고정했다.
- 대사와 timing은 `lib/prototypes/last-bell/narrative.ts`에 분리했고 `character.namra.rooftop` 교체 seam을 사용한다. 옥상에 플레이어 시체나 큰 혈흔을 남기지 않는다.

### 상호작용·복구

- 키보드 계약은 `E/F/Q/C/Shift/Tab`, 이동은 WASD다. touch HUD도 동일한 semantic action을 호출한다.
- 문, 차단물, 전원반, 소음 장치, 사물함, 상품, 체크포인트가 하나의 interaction descriptor 계약을 사용한다.
- 인벤토리 동안 simulation과 카메라가 함께 정지하며 닫은 뒤 일시정지 overlay가 남지 않는다.
- 체크포인트는 `ch1_first_bay`, `ch1_power`, `ch2_stairwell`이고 capture/retry 및 Chapter 2 독립 replay를 지원한다.
- objective 전환은 첫 actor가 수색하는 실제 사물함 은신, 보건실·방송실 심층 수색, `HeavyObstacle` E 상호작용, 두 좀비의 고정 소음 인지, 열린 방화문 실제 통과, 계단실 두 inspection seam, 옥상 접근 같은 route evidence만 사용한다. `activeSeconds`는 목표 시간과 실제 플레이 측정을 비교하기 위한 telemetry이며, 단순 idle로 진행되지도 않고 핵심 상호작용을 잠그지도 않는다.
- 감염 복선 세 번은 단순 snapshot 플래그가 아니라 성공 경로의 `HeavyObstacle` 힘, fire-door의 냄새 머뭇거림, bell 뒤 빠른 회복에서 각각 1회 발생하며, 별도 DOM 문구·one-shot audio·camera shock로 표시된다. 빠른 회복 복선도 capture 실패가 아닌 정상 추격 경로에 포함된다.
- authored GLB의 `COL_*` collider와 문 portal을 simulation world로 투영해 플레이어·좀비·LOS·nav가 같은 passable snapshot을 읽는다.

## 상품·3D 자산

| pack | build ID | 전송량 | 결과 |
| --- | --- | ---: | --- |
| 현재 public 오프닝 critical 3D | `last-bell-3d-e3367030b580e17d` | 16,326,468 B / 15.57 MiB | hard cap·동일 build human/external-IP 재승인 통과 |
| 2챕터 route·좀비·남라 seam | `last-bell-campaign-3d-v1` | 2,666,152 B | 5.5 MB hard cap 통과 |
| 상품 10종 GLB·실제 GLB 렌더 thumbnail·SVG layer | `last-bell-products-f12d1120f2426103` | 3,157,485 B / 3.011 MiB | 4 MiB 목표·게임 내 P0 통과, 판매 활성화는 별도 차단 |
| 현재 public zone route·캐릭터 교체 pack | `last-bell-route-character-99f9d262441685b4` | 24,927,228 B / 23.772 MiB | 20 MiB 목표 미달, 24 MiB hard cap·환경 자동·human/external-IP gate 통과 |

- 10개 stable key는 `idcard`, `badge`, `photo`, `radio`, `kit`, `zipup`, `archery`, `postcard`, `candle`, `blanket`이다.
- Chapter 1에서 8개, 옥상 문 이전 Chapter 2 계단실에서 2개를 제공한다. 7개는 주 시선 경로, 3개는 짧은 detour다.
- 제품별 ImageGen lookdev를 분리 실행하고, 생성 문자는 shipping 자산에 굽지 않았다. Blender GLB의 LOD, collider, semantic anchor를 검증했으며 썸네일은 ImageGen 원본이 아니라 delivery GLB를 재수입해 동일 카메라로 렌더했다.
- 제품 prompt, lookdev hash, derivative hash, 조판 layer, 검수 상태는 `last-bell-product-asset-manifest.json`에 있다.
- 현재 전체 `public/generated/last-bell` 파일 합계는 53,286,900 B / 50.818 MiB다. 실제 첫 구역은 Chapter 1 상품 8개만 요청하고 계단실 상품 2개는 deferred하므로 전체 첫 플레이 55 MiB 목표·75 MiB hard cap 안에 있다.
- 확장 route·actor는 입장 전에는 요청하지 않고 현재 zone과 다음 portal만 prefetch한다. corridor·infirmary·broadcast·utility·stairwell·rooftop은 독립 GLB로 mount/unmount하며 두 zone 뒤 cache lease와 GPU resource를 실제 해제한다. 남라는 rooftop에서만, 좀비 variant는 동시 활성 상한 2체에 필요한 것만 mount한다. 실패한 GLB promise는 cache에서 제거되어 fallback 상태에서 사용자가 다시 불러올 수 있다.

### 2026-08-26 private 복구 후보 시각 게이트

아래 후보는 public delivery가 아니라 비교 검수용 private 출력이다. 자동 GLB validator 통과, skin·animation 이름 존재, 파일 크기 상한 통과는 시각 승인으로 계산하지 않았다.

| 후보 | 직접 검수 결과 | public 승격 |
| --- | --- | --- |
| 환경 `r10` | 복도는 판형 구조·약한 접지·평면적인 원경이 남았고, 옥상은 지붕·문틀·바닥에 주황/검정 모아레, 녹색 목재처럼 보이는 금속문, 배경 카드가 남아 P0 | 차단 |
| 환경 `r11` | 복도 가독성은 올랐지만 얇은 천장 판·카드형 파손·과도하게 늘어난 바닥 무늬가 남았다. 옥상은 모아레, 직사각형 sky matte, 저해상도 폴리곤 산, 붙여 넣은 듯한 입면이 남아 P0 | 차단 |
| 환경 `r12` | shadow acne와 배경 matte/card는 제거했지만 복도는 여전히 얇은 판형 파손·희박한 접지로 보이고, 옥상 출입구는 폭격 후 효산고가 아니라 깨끗한 상자형 구조로 읽혀 P0 | 차단 |
| 환경 `r13` | portal·은신·화로 semantic 계약, KTX2·Meshopt와 용량 상한은 통과했지만 복도 바닥에 넓은 수평 banding이 생겨 `r12`보다 후퇴했다. 옥상도 모아레와 배경 카드는 제거됐으나 출입구가 여전히 단순한 clean-box로 읽혀 P0 | 차단 |
| 환경 `r18` | 복도 바닥을 dirty-floor PBR로 복구하고, 옥상 출입구의 불규칙 roof/coping·노출 brick·stained plaster와 도달 불가능한 원경 matte overscan을 적용했다. 생성 reference hash를 고정한 자동 게이트에서 바닥 banding·표면 detail·하늘 변화·lateral detail·matte edge seam·headhouse detail 6/6 통과했고 strict GLB validator·KTX2·Meshopt도 통과했다. | 자동·human visual·external/IP 통과, public 승격 완료 |
| 좀비 `authored-zombie-real3d-v4/v5` | 인체 리그와 다섯 상태 포즈, 조끼 형태는 개선됐지만 정상인에 가까운 창백한 얼굴·붉은 눈, 플라스틱 머리, 피부에 붙지 않고 떠 있는 붉은 상처 조각, 상처·혈흔·비대칭 부족으로 감염자가 6m에서 읽히지 않아 P0 | 차단 |
| 좀비 `authored-zombie-real3d-v3` | 연속 인체와 교복 실루엣은 확보했지만 정상 학생에 가까운 얼굴·비율과 깨끗한 피부·손, 붉은 눈 중심의 감염 표현, 그래픽 마스크처럼 보이는 셔츠 손상, 직사각형 붉은 패치와 평면 줄무늬 머리카락 때문에 6m에서 감염자가 읽히지 않아 P0 | 차단 |
| 좀비 `authored-zombie-real3d-v6` private revision | 감염 얼굴 texture와 앞으로 꺾인 목 pose를 추가했지만 6m에서 정상 학생으로 읽히고, hard-cap 머리·합성 티가 나는 셔츠/조끼·부족한 피부 감염과 파열 접합이 남았다. GLB 재-import에는 source blend에 없던 무재질 `Icosphere` primitive까지 들어와 P0 | 차단 |
| 남라 `mpfb2-v13` | 해부학적 인체 기반은 확보했지만 흰 눈, 머리 위 부유 구체, 원통형 머리카락·원뿔 치마와 단순 재질이 남아 P0 | 차단 |
| 남라 `imagegen-hero-v14` | 얼굴 lookdev 일부만 개선됐고, 몸 전체가 캡슐 관절·원형 손·흰 갑옷형 몸통·블록 발·분리된 막대 머리카락으로 구성돼 찰흙/로봇 실루엣이 더 강해 P0 | 차단 |
| 남라 `mpfb2-anatomical-v15` | 팔·손의 연속 인체는 복구했지만 torso와 하체가 분리되고 허벅지가 사라졌으며, 두 개의 빈 원통형 바지·떠 있는 신발·복부 노출 상의·단일 머리카락 slab이 남아 P0 | 차단 |
| 남라 `mpfb2-anatomical-v16` | 연속 인체 복구 대신 굵은 튜브형 머리카락이 얼굴을 완전히 가리고, 등 뒤의 거대한 평면 카드·주름이 찢어진 갑옷처럼 보이는 상의·원통형 하의가 생겨 `v15`보다 후퇴한 P0 | 차단 |
| 남라 `mpfb2-v17-clean` | `v16`의 대형 tube/card 오류는 제거했지만 얼굴이 남라로 식별되지 않는 흰 마네킹으로 남았고, 플라스틱 눈·피부, 뒤쪽 slab 머리카락, 상의와 열린 원통형 치마 사이의 허리 간격, 단순 양말·신발과 손 변형이 남아 P0 | 차단 |

`r18` 환경 자동 증거는 `outputs/last-bell-environment-recovery-autoqa-r18-20260826/visual-quality-report.json`에 있다. 승인된 build-matched human 증거는 `release-evidence/last-bell-route-character-99f9d262441685b4/`의 12개 render와 JSON, 오프닝 증거는 `release-evidence/last-bell-3d-e3367030b580e17d/`의 4개 render와 JSON에 있다. public 승격 전 candidate guard, 승격 뒤 public validator와 release guard가 모두 통과했다. 자동 브라우저 안정화 샘플은 60 FPS였지만 698~704 calls·391,463~392,235 triangles였으므로 실제 기기 10분 sustained trace를 대체하지 않는다.

최종 조정 release의 production build는 fresh in-app Browser에서 `1280×720`, `844×390`, `390×844`로 다시 열었다. 세 viewport 모두 정확한 route title, canvas 1개, 가로 overflow 0, console error 0을 확인했고 `입장 → 건너뛰기 → E 미닫이문 열기 → 다음 objective`를 실제 버튼과 mobile touch HUD로 완료했다. 모바일 최소 측정 target은 `34×34 CSS px`로 WCAG 2.2 AA의 24 CSS px 최소 계약을 통과한다. 10장 screenshot과 측정값·SHA-256은 `release-evidence/last-bell-release-da8957979ec883a0/browser-qa-evidence.json`에 고정했고 public release guard가 다시 검증한다.

GitHub Actions run `32923471193`에서 같은 commit `3977884`의 asset validation, lint, typecheck, 전체 test, Next production build, Supabase Preview migration·seed·baseline이 모두 통과했고 Vercel Preview를 생성했다. Preview 전용·브랜치 한정 feature flag를 사용한 [`/experiences/all-of-us-are-dead/last-bell`](https://icons-figslnzst-sangwopark19icons-1055s-projects.vercel.app/experiences/all-of-us-are-dead/last-bell)을 fresh in-app Browser로 다시 읽었다. `1280×720`에서는 입장부터 첫 미닫이문을 열어 objective가 `문을 통과한 뒤 닫고 잠가라`로 바뀌는 것을 확인했고, `844×390`·`390×844`에서는 이동·look pad와 `E/F/Q/C/Shift/Tab` touch HUD가 모두 보였다. 세 viewport 모두 canvas 1개, 정확한 `scrollWidth`, 가로 overflow 0, console error 0이었고 모바일 최소 target은 `34 CSS px`였다. Production feature flag와 production 배포는 변경하지 않았다.

실패 이력으로 남긴 private v17/v4 후보는 예상치 못한 primitive·미압축 delivery·기술 계약 결함 때문에 승격하지 않았다. 승인 build는 strict validator를 통과한 r18 route와 기존 skinned character delivery이며, release guard는 저장소에 고정한 렌더를 다시 읽어 SHA-256을 검증한다.

## verified run·구매권

- 게스트 run raw token은 `__Host-icons-last-bell-run`의 `HttpOnly; Secure; SameSite=Lax; Path=/` 쿠키에만 있고 JavaScript와 DB에는 노출되지 않는다. DB에는 SHA-256 digest만 저장한다.
- active run 24시간, 완주 뒤 로그인 claim 7일 계약을 적용했다.
- 서버가 sequence, operation idempotency, 필수 objective 순서, checkpoint, zone, 물리적 최소 전이 시간, 중복 pickup, 완료 후 event를 검증한다.
- 최소 전이 시간은 클라이언트 누적값이 아니라 서버가 관측한 milestone 전이 시각으로 검증한다. 현재 stage 절대 하한은 `0/1/4/15/18/20/20/20/23/128/138초`, 직전 stage 전이 하한은 `0/1/3/11/2/1/0/0/3/105/10초`다. 이는 불가능한 event burst를 거절하는 하한이며 10분 플레이를 만드는 장치가 아니다.
- 자연 cold-open과 준비 완료 뒤 skip은 동일한 route evidence에 합류하며, `worldReady && doorReady` 뒤 첫 문 상호작용을 즉시 사용할 수 있다. 겹치는 authored zone은 가장 작은 collider 우선과 stable tie-break로 판정해 utility가 corridor로 오인되지 않는다.
- verified experience gate가 꺼지면 run 시작·event·complete·claim·inventory 다섯 authority surface가 모두 `404 not_found`로 닫힌다. 계정 run과 guest claim에는 계정 정지·삭제 대기·온보딩 write fence를 API preflight와 DB trigger 양쪽에 적용한다.
- 클라이언트는 `good_id`를 제출하지 않는다. versioned collectible→good mapping과 검증된 pickup ledger가 entitlement를 결정한다.
- `goods.purchase_access = story_entitlement` 상품은 직접 cart DML, cart merge, 주문 생성 모두에서 구매권을 다시 검증한다. 기존 재고 잠금, 주문 snapshot, Korpay `PaymentGateway` 경계는 변경하지 않았다.
- `20260826023403_last_bell_public_cart_compatibility.sql`은 이 trigger를 `story_entitlement` 상품에만 적용해 기존 `public` 상품의 정상 cart 동작을 보존한다. fresh local DB와 Preview migration에서 함께 검증했다.
- Chapter replay에서 새 pickup은 검증된 챕터 출구에 도달한 뒤만 귀속되고 중복 수집은 추가 혜택을 만들지 않는다.

## 복구 전 production build 브라우저 QA 기준선

로컬 Supabase를 clean reset한 뒤 같은 공개 환경값으로 Next production build와 server를 실행했다.

| 항목 | 결과 |
| --- | --- |
| `1280×720` verified 경로 | viewport 완전 점유, 제품 header/footer/mobile nav 없음, authored mode, 일반 진행 console 0 errors / 0 warnings |
| `844×390` | `E/F/Q/C/Shift/Tab` touch HUD가 viewport 안, `scrollWidth=844`, `scrollHeight=390`, overflow 없음 |
| `390×844` coarse touch emulation | `maxTouchPoints=5`, `E/F/Q/C/Shift/Tab`과 이동·look surface가 viewport 안, `scrollWidth=390`, `scrollHeight=844`, overflow 없음 |
| renderer sample | desktop automated browser low tier에서 211 calls, 50,188 triangles, 57~60 FPS; 844×390은 211 calls / 50,252 triangles / 60 FPS; 390×844은 126 calls / 39,748 triangles / 60.2 FPS |
| inventory | 표시 전후 clock `00:50 / 10:00` 불변, touch 닫기 뒤 simulation·touch HUD 재개, pause dialog 잔류 없음 |
| guest start | verified API `200`, 같은 HttpOnly cookie 재호출은 같은 run을 `resumed: true`로 반환 |
| guest token | `document.cookie`는 빈 문자열이며 raw token을 JavaScript에서 읽을 수 없음 |
| authority gate OFF | run start와 inventory가 모두 `404 { error: { code: "not_found" } }`로 fail-closed |
| origin guard | `localhost`와 `127.0.0.1`의 실제 Host 기준 same-origin은 `200`, 공격자 Origin은 `403` |
| zone streaming | 입장 전 route/character 요청 0건, Chapter 1 입장 뒤 `corridor.glb`와 필요한 좀비 1종만 요청, rooftop resume에서는 `rooftop.glb`와 남라만 추가 요청 |
| route asset 실패 | `corridor.glb` 1회 실패·재시도뿐 아니라 최종 build에서 `stairwell.glb` 지속 실패도 검증했다. player zone `z=67..82`의 authored world bounds에 임시 바닥·벽·조명이 렌더되고, 1280×720에서 재시도 CTA가 viewport 내부·단일 canvas·60 FPS로 유지됨 |
| WebGL loss | 복구 overlay와 simulation 정지 확인, context restore 뒤 동일 chapter/objective·단일 canvas·60 FPS로 복귀 |
| 옥상 cinematic touch | `liveZombies=0`, 일반 `E/F/Q/C/Shift/Tab` HUD 0개, viewport 안의 `앞으로 걷기`·시야 drag·상황별 `E` 접근만 표시 |
| 은신 상태 옥상 전환 | 계단실 pacing `35/35` 뒤 `C` 은신 상태에서 옥상 문을 열고 `W`를 유지했을 때 `stairwell → rooftop`, `rooftopPhase=approach`, `liveZombies=0`으로 정상 전환; 숨기·집중·달리기 입력도 cinematic 진입 시 해제 |
| BLACK 이후 결과 | controlled local verified-run resume로 `rooftopPhase=black`, `liveZombies=0` 확인; complete API `200`, 그 뒤에만 인벤토리·로그인 구매권 저장·챕터 재수색 CTA 표시, 인벤토리 dialog 실제 개방 |

이 표와 화면은 2026-08-25 이전 조정 build에서 수집한 기준선이며, 현재 복구 build의 최종 승인 증거로 재사용하지 않는다. 최신 자산과 런타임을 묶은 fresh production build를 별도 포트에서 다시 실행해 스킵 직후 문, 좌우 이동, 문 닫힘·잠금, 가시 좀비, 실물 은신, 조명, 옥상 순서를 재검증해야 한다. 강제로 `WEBGL_lose_context`를 실행한 과거 복구 과정에서는 Chromium의 오래된 context resource 정리 경고 3건과 의도적인 aborted request console error 1건이 있었다. `390×844` 결과 역시 Chromium CDP coarse-pointer emulation으로 실제 iOS·Android 검증을 대체하지 않는다.

복구 전 기준선 화면은 `output/playwright/last-bell-acceptance-2026-08-25-game-1280x720.png`, `output/playwright/last-bell-acceptance-2026-08-25-game-844x390.png`, `output/playwright/last-bell-acceptance-2026-08-25-touch-390x844.png`, `output/playwright/last-bell-final-stairwell-fallback-1280x720.png`에 보존했다. current build 최종 증거 파일은 fresh QA 뒤 다른 이름으로 추가한다.

## 복구 런타임 브라우저 증거

최종 자산 승격 전에도 자산과 독립적인 런타임 회귀는 2026-08-26 복구 build에서 실제 키 입력과 debug snapshot으로 다시 확인했다. 이 표는 이동·스킵·문 계약의 증거이며 남라·좀비·route의 최종 시각 승인을 뜻하지 않는다.

| 항목 | fresh 결과 |
| --- | --- |
| 카메라 기준 좌우 이동 | 기본 카메라에서 `D`를 누른 실제 변위는 `x=-0.6167`, snapshot의 `cameraRight=(-1, 0, 0)`와 내적은 `+0.6167`이었다. 키보드·touch·gamepad가 같은 `movementBasisFromFacing` 순수 함수를 읽도록 중복 계산을 제거했다. |
| cold-open 건너뛰기 | skip 뒤 `worldReady && doorReady`가 된 즉시 objective가 `ch1.classroom-door.open`으로 바뀌고 첫 문 interaction이 enabled였다. 별도 18초 숨은 타이머는 문 입력을 잠그지 않는다. |
| 첫 문 개방 | 준비 직후 `E`를 누른 뒤 약 `639ms`에 시각 문과 `DoorSnapshot.passable`이 함께 열렸다. |
| 실제 통과·닫기·잠금 | 문을 연 뒤 `W`로 passage sensor를 실제 통과한 snapshot은 player `z=14.438`, `captured=false`였다. 첫 좀비는 의도한 감염 복선인 `investigate` 망설임 상태로 `z=22.10`에 있었고, 통과 후 `E`로 닫기→closed 확인→lock→locked 확인이 완료되어 `ch1_first_bay` checkpoint와 `ch1.restore-emergency-power` objective가 함께 기록됐다. 최종 문은 `locked`, `passable=false`였다. |
| 비정면 문 통과 경계 | 실제 브라우저에서 교실을 둘러본 뒤 `x=+1.3567`로 문에 접근하면, 과거 semantic portal 폭이 실제 door frame보다 좁아 `z=12.7117`에서 멈추는 회귀를 재현했다. decoded frame 폭에 맞춰 actor-radius 안전 폭을 `x=-1.65..+1.65`로 수정했다. 재실행에서는 `x=+1.1717` 비정면 접근으로 `z=13.9267`까지 실제 통과했고, `E` 뒤 `locked/passable=false`, `ch1_first_bay`, `ch1.restore-emergency-power`, `captured=false`를 확인했다. 이 경계는 world 및 full simulation 실패 회귀 테스트로 고정했다. |
| 문틀 capture/retry | 첫 좀비가 passage sensor 내부 `z=13.205`에서 플레이어를 붙잡는 실제 회귀를 재현했다. `다시 일어나기` 뒤 player는 문 앞 안전 지점 `z=10.8`, 첫 문은 `open/passable=true/occupants=[]`, 좀비는 `patrol`로 함께 복원됐고 checkpoint를 허위 지급하지 않았다. 같은 세션에서 다시 통과한 `z=13.59`에서 `E`를 눌러 문이 `locked/passable=false`, checkpoint `ch1_first_bay`, objective `ch1.restore-emergency-power`로 정상 진행됐다. |
| 첫 좀비의 복선과 공정성 | 즉시 통과하는 플레이어가 문을 닫고 잠글 실제 시간을 갖도록 첫 감지에 한해 `1.8s`의 냄새 확인 망설임을 simulation 상태로 구현했다. UI 대기 타이머가 아니며 한 번 소진된 뒤 일반 perception·chase로 돌아간다. |
| 실제 책상 은신 | 시작 교실의 authored 책상까지 실제 이동한 뒤에만 `ch1.hide.desk`가 enabled가 됐다. `E` 뒤 `standing → entering-hide → hidden`으로 전이하고 카메라는 책상 아래 `y=0.72m`로 이동했으며, `hidingSpotId=ch1.hide.desk`, 손전등 직접광 off, 은신처에서 나오기 interaction을 확인했다. 지정 은신처 밖의 `C`는 웅크리기만 수행한다. |
| 실제 사물함 은신 | authored corridor의 보이는 `Hide_Locker_Corridor_Pivot`은 `(x=2.25, z=15.1)`인데 simulation interaction은 과거 invisible proxy `(3.2, 24)`를 가리키는 좌표 불일치를 fresh 브라우저에서 재현했다. interaction·hiding definition·semantic anchor를 같은 보이는 피벗으로 맞췄다. `ch1_first_bay` 재시작 뒤 손전등을 끄고 실제 사물함까지 이동했을 때만 `ch1.hide.locker`가 enabled였고, `E` 뒤 `hidden`, `hidingSpotId=ch1.hide.locker`, 내부 카메라 `y=1.46m`, 손전등 억제를 확인했다. 해당 화면의 좀비는 여전히 흰 마네킹처럼 보이는 시각 P0이므로 gameplay 계약 통과와 캐릭터 승인을 분리한다. |
| 세로 mobile touch | Playwright의 fine-pointer `390×844`에서 touch HUD가 사라지는 회귀를 재현했다. touch 여부를 coarse pointer만으로 결정하지 않고 `width≤520 || height≤480`도 같은 입력 경로로 보내도록 수정한 뒤, fresh reload·skip 직후 이동 D-pad, look pad, `E/F/Q/C/Shift/Tab`이 모두 노출됨을 확인했다. |

관련 runtime 회귀는 simulation, cadence, world, doors, movement, release approval, touch HUD의 targeted run `87/87`과 typecheck를 통과했다. 사물함 좌표 회귀를 추가한 뒤 `runtime/world.test.ts`와 `runtime/simulation.test.ts`의 focused run도 `34/34`로 통과했다. visible-locker 경로를 반영한 전체 pacing matrix는 `10/10`으로 통과했으며, 계단실의 두 실제 inspection 지점을 지나 actor-radius 밖의 옥상 문 손잡이 위치에서 E를 사용한 뒤 남라 접근·제압·BLACK·game complete까지 5/15/30/60/120Hz에서 같은 결과를 냈다. 특히 `simulation.test.ts`에는 passage sensor 내부 capture가 문 밖 안전 지점·열린 문·순찰 좀비로 원자적으로 복구되는 실패 회귀를 추가했고, 보이는 사물함 피벗에서만 실제 은신 경로가 성공하도록 고정했다. 유지 대상 current authored opening을 새 후보 전용 node 이름 때문에 거부하던 validator 회귀는 동일 역할의 authored semantic ID를 검사하도록 고쳤고 실제 public delivery 복사본 회귀 `1/1`을 추가했다. 실제 은신 화면은 `output/playwright/last-bell-recovery-desk-hide-fresh-1280x720.png`, `output/playwright/last-bell-visible-locker-hidden-1280x720.png`, 조명·가시 좀비 화면은 `output/playwright/last-bell-current-corridor-lit-pre-capture-1280x720.png`에 보존했다. 최종 public GLB를 묶은 세 viewport fresh QA도 `release-evidence/last-bell-release-da8957979ec883a0/browser/`에 고정했다.

## 자동 검증

| 명령/검사 | 결과 |
| --- | --- |
| `npm test` | 최신 `origin/main` 병합 및 clean-runner provenance 회귀 추가 뒤 통과: 379 files passed, 1 skipped / 3,503 tests passed, 1 skipped |
| `npm run typecheck` | 통과 |
| `npm run lint` | exit 0; 기존 `scripts/hong-sil-downloader.mjs:294` warning 1건만 존재 |
| `npm run build` | 통과; Next.js 16.3.0 production build와 verified page·5개 API route 포함 |
| `supabase db reset --local --no-seed` 및 seed 포함 재실행 | migration clean apply와 Preview seed 초기화 모두 통과 |
| `supabase/tests/last_bell_verified_runs.sql` | ACL/RLS, run 순서, replay, guest claim, multitab, 직접 cart/merge/order 우회, public 상품 cart 호환성, order snapshot 통과 |
| `supabase/tests/last_bell_preview_catalog.sql` | Preview 10상품 mapping·가안 seed canary 통과 |
| `npx supabase db lint --local` | schema lint 오류 없음 |
| 4개 Last Bell asset validator + 환경 자동 디자인 gate | opening, 상품 10종, source-archive campaign pack, public route·character `r18` strict validator가 모두 통과했다. clean CI runner에서는 커밋된 CC0 provenance pin과 5개 source-review render hash를 재검증하고, raw DCC source가 존재하는 로컬 빌드에서는 같은 source GLB hash까지 추가로 재검증한다. 생성 reference 기반 환경 자동 디자인 gate도 6/6 통과했다. human visual·external IP 승인은 build-matched 렌더와 별도 근거로 고정했다. |
| public release guard | 통과: public GLB marker, route·character 및 opening build ID, human/external-IP 승인, 16개 DCC/delivery render와 10개 fresh browser screenshot의 실제 SHA-256, 3개 viewport의 P0·overflow·console·interaction 계약을 재검증 |
| GitHub Actions `32923471193` + Preview read-back | validate, Supabase Preview, Vercel Preview job 통과. 배포 URL에서 desktop·landscape·portrait의 canvas·overflow·console·첫 문·touch HUD 계약 통과 |
| fixed-step matrix | 5/15/30/60/120Hz와 200ms stall 결정론 테스트 통과 |
| evidence-driven route contract | idle 시간만으로 objective가 열리지 않고, 실제 locker cover → 보건실·방송실 수색 → HeavyObstacle → power/noise → fire-door 통과·잠금 → 계단실 2개 inspection → rooftop 접근 순서가 필요하다. 5/15/30/60/120Hz와 200ms stall에서 같은 semantic 결과를 확인했다. deterministic 경로 테스트는 사람의 첫 성공 10분 측정을 대체하지 않는다. |
| `git diff --check` | 통과 |

## 출시 전 남은 release gate

1. 실제 사용자 첫 성공 플레이를 최소 5회 측정해 중앙값 `9:30~10:30`을 확인해야 한다. 현재 수치는 deterministic authored pacing 목표이며 사람의 탐색 편차 측정값이 아니다.
2. 실제 iOS Safari, Android Chrome, macOS Safari에서 10분 세션, sustained frame time, 열·메모리, pointer/touch, context recovery를 확인해야 한다.
3. Preview seed 가격은 가안이다. 실제 판매 전 가격, 치수, 소재, 제조국, A/S, 재고, 판매기간과 상품 제조 검수를 확정해야 한다. 이번 IP/시각 승인은 판매 정보 확정이 아니다.
4. Preview 배포와 remote Supabase Preview migration은 통과했다. Production DB, 실결제, production 공개 read-back은 아직 실행하지 않았으며 별도 결과로 기록해야 한다.
5. verified run은 서버 검증 경계를 갖지만 브라우저의 물리 입력 자체를 암호학적으로 증명하지는 않는다. 실물 구매권 공개 전 rate limit, abuse telemetry, 운영 alert와 수동 회수 runbook을 production 수준으로 확정해야 한다.
