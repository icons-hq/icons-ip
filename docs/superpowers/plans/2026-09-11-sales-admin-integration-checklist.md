# 영업팀 어드민 신규 흐름 통합 검증 체크리스트

작성일: 2026-09-11 KST
대상: #478 상세 HTML, #494 지연 주문 고객 안내, #496 신규 영업 흐름 통합 검증

이 문서는 Q11/Q12와 그 조합의 실행 기준 및 최종 검증 기록이다. 각 항목은 격리된 task DB와 `TEST-ONLY` 자료에서 실제 화면 → 서버 경계 → 저장 결과를 이어서 확인한다. 체크하지 않은 항목은 미완료로 남기며, 단위 테스트나 화면의 성공 문구만으로 통과 처리하지 않는다.

## 현재 기준과 완료 경계

- 기준선은 `de7f1165`와 [2026-09-10 구현 결과](./2026-09-10-sales-admin-implementation-results.md)다. 기존 33개 기능과 이미 통과한 전체 회귀 증거를 이 문서에서 다시 합성하지 않고, 새 Q11/Q12와 조합 검증의 delta만 추가한다.
- 2026-09-11 사용자 승인으로 Q11은 **인앱 알림 + 주문 이메일**, Q12는 **제목·문단·목록·표·안전 링크·검증 이미지의 기본 문서 HTML**로 고정했다. 실제 고객 발송·운영팀 인수·production 배포 승인은 포함하지 않는다.
- 현재 worktree의 Q12 경로는 `components/admin/sections/GoodSection.tsx`, `lib/goods-description.ts`, `lib/admin/catalog.ts`, `lib/admin/good-preview.ts`, `components/shop/GoodsDescription.tsx`, `components/screens/GoodDetail.tsx`, 상품 workbook 파일들이다. Q12 migration `20260910235726_sales_goods_detail_html.sql`은 최종 178개 migration 재적용과 관련 SQL 검증을 통과했다.
- 현재 worktree의 Q11 경로는 기존 내부 지연 메모(`components/admin/screens/DispatchDelayNoteForm.tsx`, `app/admin/order-actions.ts`), 관리자 action/DTO(`app/admin/order-delay-actions.ts`, `lib/admin/order-delay-notices.ts`), cron route(`app/api/cron/order-delay-notices/route.ts`), 신규 메일 작업(`lib/email/order-delay-jobs.server.ts`, `lib/email/dispatcher.ts`)이다. `20260910235736_sales_order_delay_notices.sql`과 `supabase/tests/order_delay_notices.sql`은 fixture와 첫 컴파일 실패를 고친 뒤 최종 적용·SQL·복구·동시성 검증을 통과했다.
- `/tmp/icons-sales-admin-4273/final-two/order-delay-notices-red.log`는 `order_shipments_order_id_origin_id_key`의 `(order_id, origin_id)` 중복으로 fixture 삽입 단계에서 멈춘 기록이다. 기능 통과로 세지 않는다. fixture를 고친 뒤 새 green log를 만들었으며 red log는 수정 전 이력으로 보존한다.
- GitHub 이슈와 원격 Project 상태를 이 문서에서 바꾸지 않는다. #496의 기술 완료는 아래 모든 새 시나리오, migration·SQL, targeted test, 브라우저 증거, 운영 안내 갱신이 갖춰진 뒤에만 판단한다.

## 고정 계약

### Q12 — 상품 상세 기본 문서 HTML

- `description_format`은 `plain | html`이고 기존 값이 없는 레거시 설명은 `plain`으로 읽는다. plain은 일반 텍스트로 표시하며, HTML로 바꿀 때도 원 입력이 실패 복구 대상에서 사라지지 않아야 한다.
- 허용 요소는 제목(`h2`~`h6`), 문단, 줄바꿈·구분선, 강조, 목록, 인용, 표와 캡션, 링크, 검증된 이미지다. 저장·관리자 미리보기·공개 상세가 같은 sanitizer와 허용 범위를 사용한다.
- 링크는 사이트 안의 단일 슬래시 경로 또는 허용된 `http`/`https`/`mailto`/`tel` 주소만 허용하고 사용자명·비밀번호·제어문자·실행 가능한 주소는 제거한다. CSS, `style`, 이벤트 속성, `script`, iframe·object·SVG 등 실행·외부 삽입 경로는 저장 결과와 렌더 결과에서 제거한다.
- 본문 원문과 정리된 결과 모두 30,000자 제한을 확인하고, 이미지 경로는 DB가 승인한 상품용 Storage path만 보존한다. 설명 이미지 최대 20장을 넘기면 저장을 거절한다. 공개 렌더에서 path를 `publicMediaUrl`로 확장하며 임의 외부 이미지 URL을 직접 출력하지 않는다.
- 모바일 390px에서 본문이 viewport를 밀어내지 않아야 한다. 넓은 표는 자체 스크롤 등 명시된 표 동작을 확인하고, 이미지·링크·긴 문자열은 줄바꿈 또는 폭 제한을 통과해야 한다.
- 상품 복사는 설명·format·승인된 설명 이미지 참조를 이어받되 새 초안 정체성을 만든다. 재고·KC 검토·ERP/바코드·매입단가·기간 할인·예약·추가구성·쿠폰·판매 실적은 복사하지 않는다.

### Q11 — 지연 주문 고객 안내

- 운영자는 지연 대상 배송 건을 선택하고 **고객용 제목·본문·예정일**을 미리 본다. 예정일을 모르면 `확인 중`으로 표시하며 날짜를 추정하지 않는다. 선택된 배송 건은 주문별로 묶고 중복 ID를 정규화한다.
- 대상은 현재 계약에 맞는 `confirmed` 또는 `shipping` 주문의 지연된 `ready` 배송 건이다. 원 예정일이 있으면 KST 현재일보다 이전인지, 없으면 확인된 주문 후 3일 초과인지 판단한다. 취소·클레임으로 보호된 주문, `pending` 주문, 이미 배송 중·완료된 배송 건은 준비 단계에서 거절한다.
- `admin_prepare_order_delay_notice`가 구매자·현재 이메일·주문·배송 건·지연 시각을 snapshot으로 얼리고, 내부 지연 메모를 고객 문구에 복사하지 않는다. 요청 전 미리보기와 저장된 공지를 구별한다.
- `admin_request_order_delay_notice`는 대상별 인앱 알림을 한 번만 `sent`로 만들고 주문 이메일을 `queued`로 만든다. 메일은 worker가 durable `email_intent`를 bind한 뒤 기존 dispatcher/provider 경계를 통과한다. 고객은 본인 알림만 읽으며 private notice/target/intent 원장에는 직접 권한이 없다.
- 동일 notice ID와 동일 내용의 재요청은 같은 결과로 수렴하고 새 알림·새 메일 intent·새 멱등키를 만들지 않는다. 부분 실패 재시도는 `failed + retryable`인 이메일만 다시 queue하며 이미 보낸 인앱 알림은 만들지 않는다.
- provider 접수 후 응답이 유실되거나 결과가 모호하면 동일 멱등키로만 재조정한다. `unknown`/`needs_review`를 무조건 새 메일로 우회하지 않는다. provider가 비활성·미설정이면 이메일 완료로 표시하지 않고 원인을 남긴다.
- staff만 관리자 prepare/get/request/retry/list를 호출하고, service role만 claim/bind/finish worker RPC를 호출한다. 로그·고객 응답에 내부 메모·불필요한 PII·provider raw payload를 남기지 않는다.

## 실행 전 조건과 증거 규칙

1. 승인된 격리 task DB를 새 migration까지 적용할 준비 상태로 만든다. production·shared preview·실제 고객 계정·실제 메일 provider를 사용하지 않는다. 기존 데이터가 있는 DB는 reset하지 말고 fixture ID를 별도로 사용하며, 실행 전 schema/migration manifest와 관련 row count를 저장한다.
2. Q11 SQL fixture는 한 주문에 같은 출고지 배송 건을 두 개 만들지 않는다. 현재 DB의 `order_id + origin_id` unique 계약을 지키도록 서로 다른 주문 또는 출고지를 사용하고, 준비 대상은 실제 지연 판정 조건을 만족하게 만든다.
3. 메일은 `/tmp/icons-sales-admin-4273/final-two/fake-mail-provider.mjs`의 synthetic-only endpoint와 `example.test`/`example.invalid` 수신자만 사용한다. endpoint는 `accept`, `fail_once`, `permanent_failure`, `accept_timeout_once`를 각각 재현할 수 있어야 하며, ledger와 event log를 실행 회차별로 초기화·보존한다.
4. 브라우저는 현재 Browser skill의 프로젝트 탭에서 실행하고 desktop과 390px mobile viewport를 모두 캡처한다. 화면에서 저장·요청을 시작한 뒤 browser read-back, SQL read-back, 파일/메일 ledger를 같은 run ID에 묶는다.
5. 기존 전체 테스트·DB exact replay 결과는 baseline 증거로 참조한다. 새 변경을 모두 합친 마지막 한 번에만 전체 `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`를 실행한다. 그 전에는 아래 delta targeted test와 SQL만 반복한다.

증거 기본 위치는 `/tmp/icons-sales-admin-4273/final-two/`다. 새 산출물은 다음 이름을 사용한다.

- `order-delay-notices-green.log`: migration 적용, SQL fixture와 assertion 전체 결과
- `fake-mail-events.jsonl`, `fake-mail-ledger.json`: provider 호출 횟수·idempotency key·payload hash·accepted replay 결과
- `q12-html-desktop.png`, `q12-html-mobile.png`, `q11-notice-preview.png`, `q11-notice-result.png`: 실제 browser 화면
- `q12-goods-html-roundtrip.xlsx`, `q12-goods-html-roundtrip-inspection.ndjson`: workbook 바이너리와 셀 read-back
- `sales-integration-final-green.log`, `sales-integration-before-after.json`: 조합 시나리오의 상태·금액·snapshot 전후 비교

## 12개 시나리오

각 행은 독립적으로 `미실행 → 실행 중 → PASS/FAIL`을 기록한다. 실패한 원래 회차의 fixture·화면·ledger를 지우지 않고 수정 후 새 run ID로 재실행한다.

| ID | 실행 흐름과 기대 결과 | 코드·서버 경계 | 필수 증거 |
|---|---|---|---|
| Q12-1 | 기존 plain 상품을 열어 HTML 문서로 전환한다. 제목·문단·목록·표·안전 링크를 입력해 초안 저장 → 관리자 공개 화면 미리보기 → 공개 상세 조회를 한다. 저장 전에는 카탈로그가 바뀌지 않고, 저장 후 preview/public의 정리된 HTML과 `description_format`이 일치한다. 기존 plain 상품은 줄바꿈 표시와 원문을 유지한다. | `GoodSection`, `good-preview`, `normalizeAdminGoodForm`, `admin_save_good`, `GoodsDescription`, `GoodDetail`, `20260910235726...` | desktop/mobile screenshot, DB row read-back, 공개 URL 응답의 HTML·console 오류 0 |
| Q12-2 | `script`, 이벤트 속성, `style`, `javascript:`·userinfo 링크, 외부 이미지, 허용하지 않은 태그를 섞고 길이 초과·이미지 21장 입력도 만든다. 경고와 서버 오류를 확인한 뒤 새로고침/실패 복구로 원 입력을 되살린다. 저장 결과에는 제거된 실행 요소가 없고 입력 textarea·local recovery가 임의로 비워지지 않는다. | `lib/goods-description.ts`, `lib/admin/catalog.ts`, `app/admin/actions.ts`, local autosave/form-state, 신규 sanitizer/catalog tests | sanitizer unit 결과, 실패 화면, 복구 화면, DB에 저장되지 않은 악성 fragment 확인 |
| Q12-3 | 검증된 상품 이미지를 업로드하고 alt를 입력해 “설명에 넣기”를 누른다. preview와 공개 상세에서 이미지·alt·lazy/decoding을 확인한다. 임의 외부 image src와 다른 상품 path는 제거되며 390px에서 가로 넘침이 없다. | `ArtworkUploadField`, `GoodsDescription`, `publicMediaUrl`, 상품 artwork claim/Storage 권한, `wc-catalog.css` | 업로드/삽입 desktop·mobile screenshot, 저장 path와 `description_image_paths` SQL read-back, 승인 path 외 0건 |
| Q12-4 | HTML 상품을 workbook으로 내보내 `description`·`descriptionFormat`·기존 ERP/바코드 선행 0을 확인한다. 같은 파일을 재업로드해 변경 없음으로 끝내고, HTML 문구를 한 칸만 바꿔 sanitizer·부분 오류·재업로드를 거친다. 같은 상품을 복사해 새 초안에서 설명/format/이미지 참조만 유지되는지, 재고 0·KC 미검토·외부 식별자 공란인지 확인한다. | `goods-workbook.ts`, `goods-workbook-file.ts`, `admin_clone_good`, `goods_clone.sql`, workbook/clone actions | roundtrip XLSX + inspection, clone SQL/audit, 새 초안 browser read-back |
| Q11-1 | 지연 탭에서 적격 배송 건을 여러 주문에서 선택하고 고객 제목·본문·예정일을 입력한다. 미리보기에는 주문별 구매자·수신 이메일·배송 건 label·`확인 중` 또는 입력한 날짜만 보인다. 내부 지연 사유는 보이지 않고 요청 전에는 notification/email target이 생성되지 않는다. | 지연 목록/새 notice panel, `admin_prepare_order_delay_notice`, `admin_get_order_delay_notice`, `order_delay_notice_snapshot` | 선택·미리보기 screenshot, prepare JSON, private target count/내용 read-back |
| Q11-2 | 준비된 공지를 요청한다. 각 적격 구매자에게 인앱 알림 하나가 생성되고 이메일은 queued가 된다. 구매자 세션에서 본인 주문 알림과 고객 문구·주문 링크만 보며, 내부 메모·다른 구매자 정보는 0건이다. worker가 claim → intent bind → provider dispatch → finish로 이어진다. | `admin_request_order_delay_notice`, `notifications`, `claim/bind/finish_order_delay_email_job`, `order-delay-jobs.server.ts`, 기존 `dispatcher` | admin/customer browser screenshot, SQL target/notification/intent states, fake provider accepted ledger |
| Q11-3 | 두 이메일 중 하나만 `fail_once`, 다른 하나는 accept로 설정한다. 첫 worker 결과는 성공 1건과 재시도 가능한 실패 1건이어야 한다. admin retry 후 실패 대상만 queued→sent로 회복되고 인앱 알림 수는 늘지 않는다. `permanent_failure`는 기존 dispatcher의 needs_review로 보존되어 자동·수동 재시도 대상이 되지 않는다. | `admin_retry_order_delay_notice`, `processOrderDelayEmails`, `EmailDispatcher`, fake provider scenario rules | 상태 전이 SQL, retry response, event/ledger, partial-failure browser screenshot, targeted worker test |
| Q11-4 | 같은 notice payload를 두 번 prepare/request하고 worker 두 개를 동시에 실행한다. notification·email intent·provider delivery는 각각 한 개로 수렴하고 한 lease만 claim된다. `accept_timeout_once` 또는 ambiguous 결과 뒤에는 기존 멱등키로만 replay하며 provider가 한 delivery만 보존한다. | notice ID advisory lock, `email_intents`/fence, claim token/lease, `dispatcher` acceptance recovery | concurrent SQL/worker log, fake event payload hash와 key, intent·notification count, `unknown/needs_review` read-back |
| Q11-5 | 요청 전 수신자 이메일, 주문 상태, 배송 상태, 예정일 또는 취소/클레임을 바꾼다. prepare/request/bind 중 감지되는 시점에 stale 또는 ineligible로 중단되고 provider 호출은 0회다. pending 주문·이미 shipping 또는 delivered인 배송 건은 준비되지 않으며, provider 접수 후 주문 상태가 바뀐 경우에는 접수 결과를 sent로 보존한다. | `order_delay_notice_target_current`, order/shipment/cancellation locks, eligibility snapshot, `bind/finish` | stale/ineligible SQL assertion, provider call count 0 또는 accepted preservation, 금액·주문 상태 before/after |
| Q11-6 | anon·일반 구매자·staff·service role로 관리자/worker RPC와 private table을 각각 시도한다. staff/admin 경계와 service-only worker 경계가 유지되고 direct SELECT/UPDATE는 거절된다. provider env가 비어 있거나 dispatch gate가 닫히면 관리자 요청은 fail closed하거나 이미 커밋된 대상의 이메일만 재시도 가능 실패로 남기며, 어느 경우에도 provider 네트워크 호출·이메일 성공 표시는 없다. | `app/admin/order-delay-actions.ts`, `lib/admin/order-delay-notices.ts`, cron route, migration revoke/grant, `is_staff()`, service client, `emailDispatcherFromEnvironment`, `order-delay-jobs.server.test.ts` | ACL SQL, disabled runtime log, raw email/PII가 없는 log scan, 권한 오류 browser/API 결과 |
| INT-1 | 기존 #496 baseline에서 이미 확인한 대표 paid order와 settled snapshot을 그대로 고정한다. 이번 delta로 HTML 상품을 workbook 왕복·clone하고, 같은 상품/주문의 설명·format·검증 이미지와 ERP/바코드가 보존되는지만 확인한다. baseline에 있는 가격·예약 예정일·쿠폰·적립금·지역 배송비·방문수령·클레임 비용·settled 금액을 다시 생성하거나 재검증하지 않고 before/after read-back으로 대조한다. | Q12 `GoodSection`/workbook/clone, baseline order/settled snapshot, `goods_detail_html.sql`, `goods_clone.sql` | Q12 browser desktop/mobile, XLSX inspection, baseline-vs-delta JSON; 기존 #496 증거 링크와 이번 증거를 분리하고 actual PG/provider send는 수행하지 않음 |
| INT-2 | 기존 기준선 주문은 이미 배송완료이므로 다시 지연 상태로 바꾸지 않는다. 실제 UI로 만든 적립금 사용 합성 주문 2개에서 지연 시간 조건만 fixture로 재현하여 notice의 준비·요청·부분 실패·재시도·응답 유실을 검증한다. 안내 전후 주문·품목·배송 건 전체 payload를 비교하고, 별도로 기준선의 가격·예약·혜택·정산 회귀를 확인한다. 같은 notice/intent 재실행은 알림·공급자 접수를 중복 생성하지 않아야 한다. | Q11 action/cron/dispatcher, 실제 주문과 이전 기준선 snapshot, email fence, workbook fingerprint | notice-orders-eligible-before.json / notice-orders-after.json, html-integration-before.json / html-integration-after.json, fake-mail-verification.json, 전체 SQL/리허설 |

## 검증 순서

1. **계약 단위 RED**: Q12 sanitizer/normalizer/workbook과 Q11 notice repository/worker의 실패·멱등 테스트를 먼저 만든다. private table 직접 조회만 통과하는 테스트는 완료 증거로 쓰지 않고 public RPC·Server Action·provider adapter 경계를 통과시킨다.
2. **DB GREEN**: 최종 Q12 migration과 Q11 migration을 격리 DB에 적용하고, 기본 execute revoke·필요 role grant·`search_path=''`·RLS/private ACL을 read-back한다. `supabase/tests/order_delay_notices.sql`, 신규 detail HTML SQL, clone/workbook 관련 SQL을 순서대로 실행한다. 현재 코드의 migration·SQL 검증이 실패한 상태에서는 browser 통합을 통과로 기록하지 않는다. 수정 전 RED 로그는 이력으로 보존한다.
3. **메일 GREEN**: 기존 dispatcher dark/acceptance recovery 계약을 유지한 채 fake provider 네 시나리오를 실행한다. provider 호출이 DB lock을 잡은 채 진행되지 않는지, accepted/ambiguous/failed/disabled 결과가 target과 intent에 같은 의미로 기록되는지 확인한다.
4. **브라우저 GREEN**: Q12는 상품 폼에서 시작해 preview와 공개 상세로 이동하고, Q11은 지연 목록에서 시작해 preview·request·고객 알림·admin 결과 조회까지 이동한다. 각 화면에서 실제 입력·버튼·오류·재시도 상태를 캡처한다.
5. **통합 GREEN**: INT-1과 INT-2를 모두 완료한 뒤에만 전체 `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`를 한 번 실행한다. 기존 baseline의 542 files/5,202 tests 결과를 새 Q11/Q12 결과로 소급하지 않는다.

## 운영 문서와 최종 판정

구현이 green이면 다음 문서를 실제 제공 기능과 대조해 갱신한다.

- `docs/runbooks/goods-detail-html.md`와 `docs/runbooks/admin-ops-rehearsal.md`: 상품 HTML 저장·미리보기·이미지 삽입, 지연 안내 preview/request/retry의 실제 운영 동선과 실패 시 확인 위치를 실제 제공 기능에 맞춰 반영한다. 실제 고객 발송 승인을 부여하는 표현은 쓰지 않는다.
- `docs/superpowers/plans/2026-09-10-sales-admin-implementation-results.md`: #478·#494·#496 상태, migration/test/browser/fake-provider 증거와 남은 사람 인수 조건을 갱신한다.
- Q11/Q12 계약 자체가 PRD·ARCHITECTURE의 명시 원칙을 바꾼 경우에만 해당 문서를 함께 갱신한다. `CONTEXT.md`에는 용어만 남기고 구현 세부사항을 넣지 않는다.

최종 판정은 아래를 모두 만족할 때 `#496 기술 검증 green`이다.

- [x] Q12-1~Q12-4와 Q11-1~Q11-6의 browser/SQL/fake-provider 증거가 같은 실행 기준과 연결된다.
- [x] INT-1·INT-2에서 기존 #496 baseline의 주문 금액, 재고, 예약 약속일, 혜택 원장, 배송 건, 클레임, 거래확정 snapshot이 이번 HTML/메일 delta 전후에 보존된다.
- [x] 새 migration·SQL fixture·targeted tests가 green이고, `final-two` red는 수정 전 실패 재현 이력으로만 남아 있다.
- [x] 마지막 full test/typecheck/lint/build가 통과하고 새 문서가 실제 동선과 일치한다.
- [x] production DB mutation, 실제 PG 승인·환급, 실제 고객 메일, 운영팀·창고 인수, GitHub issue close/Project Done는 별도 승인·증거 없이는 완료로 기록하지 않는다.


## 최종 실행 결과

전체 코드·DB·브라우저 결과는 [구현 결과](./2026-09-10-sales-admin-implementation-results.md)의 2026-09-11 절을 따른다. 아래의 파일명은 /tmp/icons-sales-admin-4273/final-two/ 기준이며 실제 실행 방식도 함께 남긴다.

| 범위 | 결과와 실제 증거 |
|---|---|
| Q12-1·Q12-3 | 실제 업로드·삽입·저장·공개 조회, q12-html-desktop.png / q12-html-mobile.png, HTML SQL의 검증 claim·공개 query·ACL assertion |
| Q12-2 | 정리 후 길이 초과를 실제 저장에서 거절, q12-html-save-error.png / q12-recovered-input.json. 허용목록·이미지 상한·악성 입력은 단위 및 SQL 회귀로 검증 |
| Q12-4 | 실제 다운로드한 q12-goods-html-roundtrip.xlsx를 재업로드해 변경 없이 완료. html-roundtrip-before/after.json 전체 일치, html-clone-verified.json 및 이미지 이동·복사 동시성 SQL 통과. 실제 셀 내용 변경은 XLSX binary roundtrip 테스트로 구분 |
| Q11-1·Q11-2 | 미리보기부터 요청·고객 알림·주문 링크·이력 조회까지 실제 브라우저에서 수행. q11-notice-preview.png / q11-customer-notifications.png / q11-notice-result.png |
| Q11-3·Q11-4 | 모의 HTTP 공급자의 4개 시나리오 실행. 부분 실패 후 실패 건만 재시도, 접수 후 응답 유실은 동일 키 replay, 영구 거절은 needs_review·재시도 없음. fake-mail-verification.json: 4 intents, 접수 3건, 중복 접수 0 |
| Q11-5·Q11-6 | 수신자·클레임·배송 변경·권한·미설정·lease 경계는 order_delay_notices / order_delay_notice_recovery SQL과 worker/Server Action 테스트. 실제 화면에서는 전용 OFF gate의 요청 차단을 확인 |
| INT-1·INT-2 | integration-preservation.json: 13,000원 주문 2개와 품목·배송 건 전체 보존, 기존 19,900원 주문·2026-10-10 약속 보존. 100주문·100배송 리허설 및 전체 기존 SQL 회귀 통과 |
| 최종 통합 | 178 migration SHA 일치, 121/121 SQL + seed 3종 + 동시성 9종. 545 test files / 5,237 tests 통과, 생략 3건은 통과로 세지 않음. 전체 typecheck·build·lint 오류 0 |
| 정리 | 모의 공급자 종료, 작업용 gate OFF 복원, 실제 고객 발송·production 변경 0. 원격 36개 이슈 OPEN, 연결 Project 항목 0 |

320px 시각 검사는 기존 전역 최소 폭 320px의 범위에서 수행했다. 데스크톱 세로 스크롤바를 제외한 clientWidth보다 10px 큰 기존 최소 폭을 새 HTML의 넘침으로 계산하지 않으며, 실제 기본 검수 폭 390px에서는 본문과 document가 모두 380px로 일치했다.
