# 지우학 온라인 팝업 프레젠테이션

`/ip/aouad`는 Netflix 관계자에게 ICONS의 온라인 팝업 경험을 보여주는 전용 시연이다. 기존 `/ip` 카탈로그와 나란히 연결하며 실제 주문·결제·재고·리워드·현장 예약·외부 게시를 만들지 않는다. 원본과 에셋 이력은 [모듈 README](../../components/online-popup/aouad/README.md)를 따른다.

## 접근과 회수

- 2026-09-10 현재 기본값은 `AOUAD_POPUP_ENABLED=true`, `AOUAD_POPUP_PUBLIC=true`다. 비로그인·일반 회원·staff/admin 모두 `/ip`의 카드를 보고 `/ip/aouad`에 직접 들어가며, 전용 에셋 GET·HEAD·Range도 사용할 수 있다. Next.js의 스트리밍 응답은 HTTP 200일 수 있으므로 페이지 검증 때 상태 코드만 보지 않고 시연 본문·noindex를 함께 확인한다.
- 서버 페이지·에셋의 공통 게이트는 `lib/aouad-popup.server.ts`의 `canViewAouadPopup()`이다. 공개 모드에서는 인증 전에 통과하고, `AOUAD_POPUP_PUBLIC=false`인 비공개 모드에서만 `getCurrentAdminAuthState()`의 정지되지 않은 staff/admin 판정을 사용한다. 디렉토리의 `is_staff` readback은 비공개 카드 노출용이며 서버 검사를 대신하지 않는다.
- 공개 전환은 `lib/aouad-popup.ts`의 `AOUAD_POPUP_PUBLIC`을, 전체 회수는 `AOUAD_POPUP_ENABLED`를 변경한 뒤 같은 검증·배포 경로로 반영한다. 현재 공개 상태는 환경 변수로 우회하지 않으며, `AOUAD_POPUP_PUBLIC=false`로 되돌릴 때는 아래 비공개 접근 검증을 다시 적용한다.
- 2026-09-10 PM이 현재 시연 스틸의 Netflix 검토용 공유에 대한 사용을 승인했다. 공개 모드는 페이지뿐 아니라 현재 시연의 이미지·영상도 익명으로 열며, `noindex`·`no-store`는 접근 통제가 아니다. 원본 권리 기록과 이번 시연 사용 승인 범위는 [모듈 README](../../components/online-popup/aouad/README.md#시연과-운영의-경계)에 구분해 둔다.
- 페이지는 `force-dynamic`이고 `noindex, nofollow`다. 전용 화면의 ICONS 복귀 링크로 `/ip`에 돌아온다.
- 이미지·영상·오디오·게임 JSON 229개는 `private/ip-popups/aouad/`에 둔다. 같은 URL의 `/ip-popups/aouad/[...asset]` Route Handler가 GET·HEAD마다 같은 공개·회수 스위치를 확인하므로 현재 공개 모드에서는 비로그인 요청도 통과한다. 비활성화·manifest 밖 경로·경로 탈출·symlink는 HTTP 404와 빈 본문으로 닫힌다. 모든 응답은 `private, no-store, max-age=0`이며 영상은 스트리밍과 단일 byte Range를 지원한다. 에셋을 `public`으로 복사하면 Route Handler의 allowlist·경로 보호를 우회하므로 금지한다. 새 파일은 `asset-index.json`의 크기·SHA와 생성 이미지 manifest를 함께 갱신한다.

## 로컬 시연

```bash
ICONS_AOUAD_LOCAL_PREVIEW=1 npm run dev -- --hostname 127.0.0.1 --port 4312
```

`http://127.0.0.1:4312/ip/aouad`에서 직접 확인한다. 우회는 `NODE_ENV=development`와 위 변수를 모두 요구한다. production build·Vercel Preview·production에는 같은 변수가 남아도 적용되지 않는다. 실제 staff 권한 확인은 이 우회 없이 검증한다.

상단 `프레젠테이션` 버튼은 시연 범위를 안내한다. HUD의 초기화 버튼은 현재 브라우저의 시연 진행을 새로 시작하는 용도이며 운영 계정·주문 데이터를 삭제하지 않는다. 저장소 차단·손상 시에는 현재 세션의 메모리 상태로 계속 동작한다.

## 효산의 기억 게임 통합 — 2026-09-10

체험존의 첫 장면 `/ip/aouad?s=hyosan`에서 **효산의 기억 시작하기**를 누른다. 첫 방문자는 기존 학생증 오프닝을 마친 뒤 같은 장면으로 도착한다. 게임은 같은 origin의 전체 화면 iframe으로 열리며 **팝업으로 돌아가기**로 닫는다. 실행 전에는 게임 엔진·모델을 요청하지 않는다. 기존 세 미니게임과 팝업의 학생증·상품·시연 기록은 유지한다.

선택된 게임은 `88b9937a118120f60ef5166b66e5c370fc292b3a`의 S1–S8 연결 학교 탐험·활 전투 시연판이다. 기존 원본의 최종 미술 승인과 실제 휴대폰 성능 검증은 이식으로 완료 처리하지 않는다. 원본 소스 109파일과 재빌드 설정은 `components/online-popup/aouad/hyosan/upstream-source.tar.gz`에 보관하며, 승인 기록이나 원본 모델을 수정하지 않는다.

### 파일 제공과 회수

- `private/ip-popups/aouad-hyosan/`의 50파일은 약 98.77MB다. 공개 요청 키는 `package-manifest.json`의 HTML·JS·CSS·미디어 18개뿐이며 원본 manifest·소스 보관본·압축 디렉터리는 직접 요청할 수 없다.
- `/ip-popups/aouad/hyosan/[...asset]`의 GET·HEAD는 문서·엔진·미디어 모두 `canViewAouadPopup()`을 먼저 확인한다. 기존 `AOUAD_POPUP_PUBLIC`·`AOUAD_POPUP_ENABLED`로 함께 회수한다. 다운로드되어 이미 실행 중인 문서의 즉시 종료까지 보장하는 스위치는 아니다.
- `Accept-Encoding`에 따라 Brotli/gzip·identity를 선택하고 `Vary: Cookie, Accept-Encoding`·`private, no-store`·`noindex`로 응답한다. 엔진 JS의 Brotli 전송량은 1,412,926 bytes이며 모델도 미리 압축한다. 큰 파일은 메모리 응답으로 합치지 않고 스트리밍한다.
- Next 출력 추적은 기존 팝업 미디어 함수와 게임 패키지 함수를 분리한다. includes/excludes 모두 실제 동적 route의 대괄호를 escape한 키를 사용한다. Next matcher의 `contains: true`에서는 부모 경로의 단순 `*`가 게임 경로에도 적용되므로 이를 넓히지 않는다. `public/` 복사나 `/api/dev/hyosan-3d/` 공개로 대체하지 않는다.
- `/games/hyosan-memories`·카드·리워드·계정별 진행·DB 권한은 이번 통합의 대상이 아니다. 이 게임은 브라우저 저장으로만 동작한다.

### 저장과 재시도

원본의 `hyosan-memories-campaign-v1`·`hyosan-memories-3d-adventure-v1`·`hyosan-memories-difficulty-v1`과 `hyosan-memories:3d-campaign-writer` Web Lock을 그대로 사용한다. 같은 origin의 다른 탭이 이미 게임을 열었으면 내부 안내에서 기다렸다가 **다시 확인**한다. 기존 탭의 팝업 복귀·페이지 이탈은 게임 문서를 해제해 잠금을 반환한다. 잠금을 강제로 빼앗거나 오래된 진행으로 병합하지 않는다.

게임 내부의 저장 차단·읽기 실패 안내는 iframe 안에서 조작할 수 있어야 한다. 특히 **저장 없이 탐험**과 잠금 재시도 화면을 호스트 로딩 화면으로 덮지 않는다. Web Locks를 지원하지 않는 환경의 정지 안내는 원본 계약이며 저장 보호를 끄는 우회는 없다. 팝업의 시연 초기화와 게임의 새 탐험은 각각의 저장만 초기화한다.

### 원본 재현과 교체

다른 작업 폴더나 비공개 Git 커밋에 의존하지 않고 다음 명령으로 원본을 재빌드한다. npm 패키지 다운로드를 위한 네트워크는 필요하다. Node 24.16.0·npm 11.13.0으로 원본 manifest와 45개 산출물의 동일성을 확인했다.

```bash
hyosan_rebuild_dir="$(mktemp -d /tmp/aouad-hyosan-rebuild.XXXXXX)"
npm run rebuild:aouad-hyosan -- --work-directory "$hyosan_rebuild_dir"
npm run package:aouad-hyosan -- --source-directory "$hyosan_rebuild_dir/output/hyosan-showcase/site"
```

재빌드는 고정 소스 보관본과 패키지의 원본 미디어를 먼저 검산한 뒤 외부의 빈 폴더에 복원하고 `npm ci --ignore-scripts`와 원래 Vite 빌드만 실행한다. Next 빌드·DB 준비·배포는 호출하지 않는다. 패키징은 원본 manifest SHA와 모든 파일의 크기·SHA를 확인한 뒤 URL 8곳만 재배치하고 최종 파일명·해시·전송용 압축을 다시 만든다. QA driver·개발 API URL이 남거나 파일이 추가·누락되면 실패한다.

게임 자체를 갱신할 때는 먼저 새로운 원본 게임의 검증을 끝내고 소스 커밋·보관본·원본 manifest pin을 함께 갱신한다. 생성된 JS만 직접 고치거나 기대 해시만 바꿔 통과시키지 않는다. 모델 변경이 포함되면 해당 원본의 미술·기술 QA를 새 해시에 다시 결속한다.

### 통합 검사

```bash
npx vitest run lib/aouad-hyosan-assets.server.test.ts scripts/package-aouad-hyosan.test.mjs
AOUAD_QA_ORIGIN=http://127.0.0.1:4314 npm run test:aouad-hyosan-browser
AOUAD_QA_ORIGIN=http://127.0.0.1:4314 npm run test:aouad-mobile-browser
npm run typecheck
npm run lint
npm run build
```

게임 브라우저 검사는 별도 저장 컨텍스트에서 첫 방문·진입 전 지연 로딩·실제 WASD/J/E·다중 탭 저장 보호·팝업 복귀·좁은 화면을 확인한다. 개발 QA driver나 시뮬레이션 좌표를 조작하지 않는다. 브라우저 출력 폴더의 `results.json`과 스크린샷으로 검증 범위를 확인하며, viewport 에뮬레이션은 실제 iPhone·카카오톡의 GPU·터치·발열 검사와 구분한다. 배포 시에는 해당 산출물의 최종 SHA, 공개/회수 동작, Brotli 해제 후 실제 HTTP 바이트를 다시 확인한다.

### 통합 검증 기록

2026-09-10, Node 24.16.0의 로컬 production build에서 확인했다. 다음 결과는 원격 배포 완료 기록이 아니다.

| 검사 | 결과 |
| --- | --- |
| 전체 저장소 Vitest | 4934개 통과, 기존 3개 skip·1개 파일 skip |
| TypeScript·lint·production build | 통과. lint는 기존 downloader 경고 1개, 오류 0개 |
| 게임 접근·패키징 집중 검사 | 팝업 기존 권한·미디어 포함 65개, 패키징 11개 통과 |
| 게임 브라우저 | 고유 11개 그룹 통과: 첫 방문·키보드 플레이·두 탭 저장·복귀 1, Chromium/WebKit 3개 화면 크기씩 6, 저장 읽기 실패·다운로드 실패 복구 4 |
| 터치 입력 | Chromium 390×844·844×390·320×568에서 실제 touch event로 이동·활 사격 확인 |
| 기존 팝업 모바일 | Chromium/WebKit 320·375·390·440px, 첫 방문과 열린 HUD 회전 등 12개 그룹 통과 |
| 실제 HTTP 파일 | HTML·JS·CSS·모델·이미지 50개 응답의 전송 바이트와 압축 해제 SHA 일치 |
| 최종 출력 추적 | 기존 함수: 332파일·107,419,900 bytes, 원래 미디어 229개만 포함. 게임 함수: 153파일·100,756,897 bytes, 게임 패키지 50개만 포함 |
| 원본 재현 | 소스 보관본 복원·npm ci·Vite 빌드 후 원본 manifest와 45개 산출물 동일 |

진입 시 게임 파일 요청 0건, 렌더러 마운트 전 오류 안내와 재시도, 내부 저장 복구 버튼의 실제 클릭, 닫기 후 iframe 제거·Web Lock 반환·원래 CTA focus·학생증 저장 보존을 확인했다. 실제 게임 조사는 화면에 노출된 미니맵 위치를 읽어 WASD를 누르는 방식이며 좌표·HP·진행을 직접 설정하지 않았다. 시연 초보자의 전 구역 완주율과 실기기 카카오톡 검수는 이번 통합 검증에 포함하지 않았다.

## 이미지와 검수

내장 ImageGen으로 생성한 디자인 시안 23종을 무크롭 WebP quality 90으로 패키징했다. 원본 PNG는 repo 밖에 보존하며 manifest의 원본/최종 SHA-256으로 동일성을 확인한다. 기존 upstream `provenance.json`은 변경 전 입력 기록이다.

| 범위 | 최종 크기 | 크기 합계 | 기록 |
|---|---|---:|---|
| 일반 굿즈 9종 | 1440×1080 6종 · 1200×1200 3종 | 2,237,660 bytes | `generated-asset-manifest.json` |
| 소형 경품 14종 | 1200×1200 | 2,498,016 bytes | `generated-box-asset-manifest.json` |

2026-09-09 최종 23종의 원본·최종 직접 시각 검수 통과 및 46개 SHA-256 일치를 확인했다. 이 이미지는 제작된 실물의 촬영본이 아니라 디자인 시안이며 상품화·실거래의 완료 근거가 아니다.

## 검증 기록 — 2026-09-09

- `npm run lint`: 통과, 오류 0개. 이 모듈은 경고 0개이며 기존 `hong-sil-downloader.mjs`의 경고 1개는 변경 범위 밖이다.
- `npm run typecheck`: Next route type 생성과 테스트 TypeScript 검사 통과.
- `npm run build`: production build 통과. `/ip/aouad`가 요청별 서버 렌더링 경로(`ƒ`)로 출력됐다. 로컬 실행이므로 Vercel의 Preview/production 환경 변수 검증은 배포 workflow에서 별도로 수행한다.
- 로컬 production build에 `ICONS_AOUAD_LOCAL_PREVIEW=1`을 남긴 상태에서도 비로그인 시연 본문과 `/ip` 진입 카드가 노출되지 않았다. 응답은 스트리밍 HTTP 200·noindex·private no-store였다. 새 이미지 23종은 실제 HTTP bytes의 SHA-256이 manifest와 모두 일치했다.
- 호스트·권한·HUD·미디어·게임·시연 상태·커머스 집중 테스트: 21파일 208개 통과.
- 브라우저: 첫 방문 이름/사진 선택 → 학생증 → 허브, 급식실 완료 결과 복원·재도전 제한, 방송실 시작 전 입력 차단·학생증 모달 중 일시정지·복귀·결과 제한을 확인했다. 도서관은 실제 입력으로 탈출(60.8초·무피격·책갈피 4/5·비밀 서고)을 확인했고, 결과 뒤 키보드 재시작 우회도 수정 후 재완주·새로고침으로 차단을 검증했다. 네 뽑기 방식의 확인·개봉·결과·복귀·회차 전환 취소·잔여 수량을 확인했다.
- 상품 상세 37개를 모바일에서 열어 이미지·명칭·옵션을 확인했고 14개 허브 장면을 데스크톱/모바일로 검수했다. 서로 다른 사이즈의 장바구니 합계, 주문 체험, 커뮤니티 작성, 현장 예약과 변경을 확인했다.
- 래플 1회·사전예약의 선택 SKU/옵션·선착순 2개 주문(24,000원·잔여86→84·누적138,000→162,000원)을 확인했다. 허브/상세/HUD가 같은 재고를 읽고 카운트다운과 기록은 새로고침에도 유지된다.
- 새 이미지 23종의 검수는 각 manifest의 `passed`와 최종 SHA에 결속한다. 브라우저의 최종 배치 검수와 서버 배포 상태는 이미지 검수와 별개다.

### PR #458 리뷰 수정 검증

- 전체 저장소 481개 테스트 파일의 4,889개 테스트 통과(기존 3개 skip·1개 파일 skip). 최종 권한·사진·뽑기 집중 검증, lint·typecheck·production build도 통과했다.
- 에셋 경로 권한·HEAD·Range·경로 탈출·symlink·229개 SHA와 생성 이미지 manifest를 확인했다. 최종 Node 함수의 Next 출력 추적에는 에셋 229개가 모두 포함되고, 고유 파일 332개·107,419,885 bytes이며 무관한 저장소 에셋은 포함되지 않았다. 실제 Vercel 함수 크기는 Preview 배포 산출물에서 확인한다.
- 사진 파일 선택 → 학생증 240×180 반영 → 새로고침 복원을 확인했다. 진열은 데스크톱 1440×900·모바일 390×844에서 확인했고, 첫 표지의 이미지 요청은 2개였다. 지연 마운트 뒤에도 모바일 14개 장면이 직접 URL로 정상 진입한다.
- 네 뽑기 방식의 정확한 상품·보관함 복원, G1 세 칸 동시 개봉, G2 10회 뒤 한도와 잔여 70의 새로고침·회차 전환 복원, 배송 신청 1건의 주문 내역 반영을 실제 UI로 확인했다. G3에서는 확인 직후 결과 연출 중 학교 맵으로 나간 다음 새로고침한 보관함에 새 결과가 유지됐다.
- 일일 한도는 시연 카운트다운과 무관한 실제 KST 자정 기준으로 회차별 10회다. 자정에도 열린 칸은 복원되지 않는다. 시연 상태 초기화만 네 판을 새로 만든다. 이 기록은 실제 결제·경품 배정·배송의 운영 원장이 아니다.

## 모바일 브라우저 검증 — 2026-09-10

아이폰의 오프라인 포스터 누락·배지 겹침은 광고 차단 없이 WebKit에서 재현됐다. 배경만 있는 grid 자식의 폭이 미정이라 포스터가 약 3×2px로 축소됐고, 모바일 폭을 명시한 뒤 390px 화면에서 약 346×231px로 복구됐다. 이미지가 늦게 오거나 실패해도 레이아웃 크기는 이미지에 의존하지 않는다.

함께 보정한 범위는 설명의 첫 터치·화면 안 배치, 학생증 패널 닫기의 탭 레일 분리, 주문 미리보기 행, 짧은 화면의 첫 방문 대화, 펼친 HUD에 따른 본문 여백, 굿즈 상세 행동의 음수 여백이다. 모바일 예약 폼은 Safari의 스크롤 스냅이 마지막 버튼을 HUD 아래로 되감지 않도록 자유 스크롤을 사용한다. 학생증의 3D 양면은 WebKit 실제 창에서도 교차 확인했다. 게임 위에 모바일 안내 시트·학교 안내도가 열리면 기존 게임 일시정지 경로에 연결되며, 가려진 상태로 게임이 진행되지 않아야 한다.

방송실은 모바일 화면의 높이에서 머리 영역과 HUD 몫을 뺀 크기 안에 세계 전체를 같은 비율로 맞춘다. 프레임의 희망 높이는 가로 폭으로 정하고 실제 세계 배율은 ResizeObserver가 측정한 내부 높이로 정하므로 화면 회전·주소창 높이 변화에도 세계를 자르거나 크기 계산을 순환하지 않는다. 게임 좌표·물리·내려다보는 거리는 변경하지 않는다.

- Chromium·WebKit 각각 320×568, 375×667, 390×844, 440×956에서 포스터·설명·모달·주문·HUD·굿즈 행동을 검사한다. 현장 예약은 HUD를 접은 상태와 펼친 상태 모두에서 확정·변경 버튼의 접근성을 확인한다.
- 새 브라우저의 첫 방문에서 이름·사진 선택 → 학생증 → 원래 오프라인 팝업 딥링크 복귀를 확인했다. 높이 360px의 짧은 viewport에서도 안내 시작점과 입력/완료 동선을 확인했다.
- 14개 메인 장면·10개 상세 존·37개 굿즈를 390×844와 320×568에서 확인했다. 122개 화면 진입과 74개 상품 행동 스크롤 검사에서 가로 넘침·이미지 누락·HUD와 행동의 겹침·앱 오류가 없었다.
- 급식실·방송실·도서관을 두 엔진의 320×568·390×844에서 실제로 시작하고 입력했다. 12개 조합에서 학생증·안내 시트·학교 안내도의 각 열림 동안 게임 상태가 멈추고 닫으면 재개되는 것을 확인했다. 방송실의 표시 영역과 안내 시트·지도 중 정지·재개는 회귀 검사에도 포함한다.
- 방송실은 두 엔진의 320px 폭에서 높이 540·568·600·601·640px 모두 세계 전체와 HUD가 겹치지 않았다. 390×844 → 320×568 → 390×844로 바꾼 뒤 표시 배율과 높이가 원래 값으로 복원됐고 터치 입력·앱 오류도 확인했다.
- 펼친 안내 시트는 같은 모바일 구간 안의 폭·높이 변경도 다시 측정한다. 굿즈샵의 시트를 연 채 390×844 → 320×568 → 390×844 및 390px 폭에서 844 → 568 → 844로 바꿔 실제 높이·CSS 상한·예약 여백이 모두 422 → 284 → 422px로 일치하는 것을 두 엔진에서 확인했다. 모바일 여부는 CSS와 같은 미디어 쿼리를 따르고 상한은 실제 `50dvh` 계산값을 사용한다.
- 로컬 production build의 테스트 결과다. 실제 아이폰 기기나 사용자의 광고 차단 설정을 원격으로 조작한 검증으로 표현하지 않는다. 운영 반영은 PR의 배포 결과와 실제 도메인 확인으로 별도 기록한다.

회귀 검사는 설치된 Chrome과 Playwright WebKit 런타임을 사용한다. WebKit 준비가 필요하면 `node node_modules/playwright-core/cli.js install webkit`을 한 번 실행한다. 별도 터미널에서 `npm run build` 후 `npm run start -- --hostname 127.0.0.1 --port 4314`로 앱을 실행한 다음 검사한다.

```bash
npm run test:aouad-mobile-browser
```

다른 실행 주소는 `AOUAD_QA_ORIGIN`으로, 증거 저장 위치는 `AOUAD_QA_OUTPUT_DIR`로 지정한다. 기본 주소는 `http://127.0.0.1:4314`이고 기본 출력은 OS 임시 디렉터리다. 검사에서 쓰는 이름·사진·장바구니는 각 브라우저 컨텍스트의 시연 fixture이며 운영 계정·주문·결제·예약 원장은 변경하지 않는다.

## 배포와 실제 도메인 확인

Vercel Git 자동 배포는 비활성화되어 있다. 일반 PR의 `validate`·Supabase Preview·Vercel Preview 성공 및 현재 head의 리뷰 결과를 확인한 뒤 승인 범위에서 merge한다. `main` Actions의 production DB·Vercel·shared Preview·staging 결과까지 확인한다. 이 작업은 DB migration을 추가하지 않는다.

배포 후에는 실제 `https://iconsip.com`에서 다음을 확인한다.

1. 현재 공개 모드에서는 비로그인 상태에서 `/ip`에 시연 카드가 보이고 `/ip/aouad` 직접 진입이 성공하는지 확인한다. 에셋 직접 URL의 GET·HEAD·Range도 비로그인 상태에서 성공하고, 실제 이미지·Phaser 에셋·오디오·영상 재생 및 seek가 동작하는지 확인한다. `AOUAD_POPUP_PUBLIC=false`인 비공개 배포에서는 이 검증을 비로그인·일반 회원 404, staff/admin 성공으로 바꾼다.
2. 데스크톱·모바일의 첫 방문, 모든 장/존 이동, 상품 옵션·장바구니·주문 체험, 학생증·퀘스트, 세 게임, 네 뽑기 방식, 현장 예약 체험, 뒤로가기·새로고침·초기화를 확인한다.
3. 화면의 시연 표기, 네이티브 대화상자 초점·Escape, 숨긴 패널의 키보드 제외, 오류 없는 네트워크/콘솔을 확인한다. 시연 행동으로 실제 거래 API가 호출되지 않아야 한다.
4. 배포 SHA와 canonical alias를 확인하고 새 이미지 23종의 실제 HTTP bytes를 manifest의 최종 SHA와 대조한다. 실제 Preview/production 실행 결과는 연결된 PR의 배포 체크와 완료 기록으로 남긴다.

이 문서의 수치는 로컬 검증 기록이다. 초기 통합은 [PR #458](https://github.com/icons-hq/icons-ip/pull/458), 공개 전환·모바일 수정은 [PR #459](https://github.com/icons-hq/icons-ip/pull/459)의 최신 head 체크와 merge 이후 main Actions, 작업 완료 기록에서 실제 배포·read-back 결과를 확인한다.
