# Toss Production rollout runbook

이 runbook은 토스페이먼츠 **주문서형 결제(구 결제위젯) v2**를 **키 등록 → 테스트 키 위에서
굿즈 gate 공개 → 심사 → 라이브 키 + 단일 actor canary → 목적별 공개 활성화** 순서로 운영한다. 클라이언트 키·시크릿 키,
paymentKey, transactionKey, 승인번호, 원문 응답, 키 fingerprint는 문서·issue·PR·로그·명령
인자에 기록하지 않는다.

코페이는 제거하지 않고 판매 제한 상품 전용으로 대기한다 —
[Korpay Production rollout runbook](./korpay-production-rollout.md)이 그 상태와 잔여 위험을
소유한다. 구현 계약은 `docs/ARCHITECTURE.md` §9·§9.1이 정본이다.

## 확인된 범위

- 기본 PG 재전환은 에픽 [#384](https://github.com/icons-hq/icons-ip/issues/384),
  정본 스펙 [#398](https://github.com/icons-hq/icons-ip/issues/398)에서 2026-09-01 결정으로
  확정했다. 근거는 코페이의 취소 API 부재(건별 메일 수동 취소)·주문 상태 조회 API 부재·
  간편결제 불가다.
- 토스 재계약은 "같은 사이트에서 일반 상품은 토스, 판매 제한 상품(19금)은 별도 PG"
  구조를 고지하고 **서면 확인을 받은** 상태에서 진행한다. 이 확인을 심사 통과, 전자결제
  신청 완료, 라이브 키 발급으로 해석하지 않는다.
- 기존 토스 계약에는 실거래가 없다 — Production 원장의 `provider=toss` 행은 라이브 첫날
  테스트 키 시절의 `paid` 2건뿐이고, 미종결 toss attempt는 0건이다(2026-09-01 prod 실측).
  레거시 토스 런타임은 전면 제거했고 남긴 것은 원장 행·enum 값과 공식 SDK 패키지다.
- 연동 방식은 주문서형 v2 단일 채택이다. API 개별연동(키인)은 별도 상점 계약·카드정보
  취급 부담으로 배제했고, 키 형식 검증이 `test_sk_…` 계열을 거절한다.
- 모든 토스 구현·절차는 공식문서를 **주문서형 v2 기준 최신판**으로 실조회해 근거를
  확보한다. 문서화되지 않은 endpoint·파라미터를 추측해 호출하지 않는다.

## 전환 시퀀스와 현재 위치

| 순서 | 내용 | 담당 | 상태 |
|---|---|---|---|
| ① | prod `KORPAY_ORDER_CHECKOUT_ENABLED` 폐쇄 | human [#385](https://github.com/icons-hq/icons-ip/issues/385) | 실행 대기 (코페이 런북에 readback 자리 확보) |
| ② | 레거시 제거 + 신규 개발(#386·#387·#388·#389·#390·#392·#393) | agent | 코드 완료 |
| ③ | prod 테스트 키 공개 배포 | human/CI [#394](https://github.com/icons-hq/icons-ip/issues/394) | **다음 단계** |
| ④ | 전자결제 신청 → 홈페이지 심사 → 카드사 심사 | human [#394](https://github.com/icons-hq/icons-ip/issues/394) | 대기 |
| ⑤ | 라이브 키 전환·굿즈 공개 | human [#395](https://github.com/icons-hq/icons-ip/issues/395) | 대기 |
| ⑥ | 코페이 재개방 | 19+ 오픈 트랙 | 별도 에픽 |

②가 끝나 코드는 토스 기본 상태이지만, Production gate가 모두 닫혀 있어 실제 결제 경로는
아직 열리지 않는다. ③에서 심사자가 결제창을 볼 수 있도록 **테스트 키 위에서 굿즈 gate만**
연다(canary로는 대체할 수 없다 — 아래 심사 트랙 2번). ①은 ③과 독립이므로 순서를 기다리지
말고 먼저 닫는다. 티켓 gate는 ⑤ 이후에도 판매 일정이 확정될 때까지 닫아 둔다.

## 환경별 변수

| 변수 | Production | Preview / CI |
|---|---|---|
| `SITE_URL` | `https://iconsip.com`; 일반 server config, 필수 | 환경별 일반 server origin을 둘 수 있음 |
| `NEXT_PUBLIC_TOSS_CLIENT_KEY` | sensitive; `(test\|live)_gck_…` | 두지 않음(구 v1 키 잔존은 빌드를 막지 않음) |
| `TOSS_SECRET_KEY` | sensitive, 서버 전용; `(test\|live)_gsk_…` | 두지 않음 |
| `TOSS_ORDER_CHECKOUT_ENABLED` | 기본 `false`; 심사 창(테스트 키)과 라이브 공개에서만 `true` | unset 또는 `false` |
| `TOSS_TICKET_CHECKOUT_ENABLED` | 기본 `false`; 공연 판매 일정 확정 뒤에만 `true` | unset 또는 `false` |
| `TOSS_ORDER_CANARY_USER_ID` | 선택적 단일 인증 사용자 UUID; 기본 미설정 | 없어야 함 |
| `TOSS_TICKET_CANARY_USER_ID` | 선택적 단일 인증 사용자 UUID; 기본 미설정 | 없어야 함 |

키 규칙:

- 클라이언트/시크릿은 **같은 모드**여야 한다. 테스트 클라이언트 키로 띄운 결제를 라이브
  시크릿 키로 승인하는 반쪽 전환은 빌드와 런타임이 함께 막는다.
- 클라이언트 키만 `NEXT_PUBLIC_`이다. 시크릿 키는 server-only 어댑터의 클로저 밖으로
  나가지 않고, successUrl 경로에 실리는 callback nonce는 그 키의 HMAC 파생이다.
- 실 게이트웨이는 `VERCEL_ENV=production`에서만 생성된다. Preview에 키가 있어도 결제는
  열리지 않는다.
- 자격 증명 readiness와 rollout gate는 독립이다. gate는 정확한 `true`일 때만 열리고,
  gate가 `false`여도 해당 목적의 canary UUID와 정확히 일치하는 인증 사용자 한 명은 새
  provider session을 만들 수 있다.

빌드 가드(`scripts/check-vercel-build-env.mjs`)가 멈추는 조합:

- Production에서 gate가 `true`이거나 canary가 설정됐는데 키 페어가 없거나 모드가
  어긋난 경우 → 오타가 조용히 "결제 불가"로 새지 않도록 빌드 실패. 반대로 gate·canary가
  모두 닫혀 있으면 키 미등록은 정상이다(심사 전 상태).
- Preview에서 `TOSS_*_CHECKOUT_ENABLED=true` 또는 `TOSS_*_CANARY_USER_ID` 존재.
- gate 값이 `true`/`false`/미설정이 아닌 문자열, canary가 UUID v1–5 형식이 아닌 경우.

빌드를 멈추지 않고 경고만 남기는 조합: Production에서 키 페어가 유효한 **테스트 모드**인데
공개 gate가 열려 있는 경우 → `Toss public checkout gate is open on test-mode keys…`. 심사
창(③)에서는 이 경고가 정상 상태의 표시이고, 심사가 끝난 뒤에도 남아 있으면 무과금 결제가
`paid` 주문을 만들고 있다는 신호다.

Vercel 환경변수의 추가·수정·삭제는 이미 생성된 deployment의 runtime을 바꾸지 않는다. 키,
gate, canary를 바꿀 때마다 **GitHub Actions의 Production 배포 경로로 새 deployment**를 만들고,
Ready 확인에서 끝내지 말고 배포한 exact Git SHA와 canonical production alias가 그 deployment를
가리키는지, build readback의 Toss configured·목적별 gate·canary boolean이 의도와 같은지까지
확인한다. 설정만 바뀐 재배포는 `workflow_dispatch`의 `production_redeploy=true`와 현재 main의
exact SHA에서 성공한 `production_source_run_id`를 함께 쓴다.

## 결제 프로토콜

1. 서버 prepare가 DB attempt의 불변 amount·KRW·opaque orderId(굿즈 `O…`·티켓 `T…`)·
   opaque product code를 읽고, 공개 클라이언트 키·금액·successUrl·failUrl만 담은 일회성
   payload를 만든다. `customerKey`는 SDK 상수 `ANONYMOUS`이며 내부 사용자 식별자를 provider에
   보내지 않는다.
2. 브라우저 위젯 SDK가 Redirect 방식으로 결제를 요청한다. 결제 UI는 한 페이지에 하나이고,
   쿠폰 등으로 금액이 바뀌면 위젯 금액을 다시 맞춘다.
3. 성공 리다이렉트는 `/api/payments/{goods,tickets}/confirm/toss/[nonce]`로 온다. nonce는
   쿼리가 아니라 **경로 세그먼트**다 — 토스가 successUrl에 자기 쿼리를 붙이고 기존 쿼리
   보존을 문서가 보장하지 않기 때문이다. failUrl은 confirm을 호출하지 않는 복귀 화면이다.
4. 서버가 nonce·orderId를 상수 시간으로 대조하고 **successUrl 금액이 저장 주문 금액과 다르면
   승인 API를 호출하지 않는다**. 통과한 건만 `POST /v1/payments/confirm`을 `Idempotency-Key`와
   함께 정확히 한 번 호출한다.
5. confirm이 모호하면(타임아웃·5xx·409·`ALREADY_PROCESSED_PAYMENT`·미지 4xx) 즉시 실패로
   단정하지 않고 `GET /v1/payments/orders/{orderId}`로 실상태를 확인해 분기한다.
6. 정규화한 `approved | declined | canceled | unknown | needs_review`만 DB 멱등 finalizer에
   넘긴다. 사용자 브라우저는 provider 식별자가 없는 303 success·checking·failure 경로로
   이동한다.
7. 웹훅(`PAYMENT_STATUS_CHANGED`)은 확정의 진실원이 아니라 재정합 트리거다. 서명이 없으므로
   본문에서 orderId만 읽어 조회 API 기반 reconcile seam을 태우고, 반영은 전부 DB finalizer가
   한다. 종결 attempt·미지 식별자는 200 no-op이다.
8. 취소는 `POST /v1/payments/{paymentKey}/cancel`을 `cancelAmount` 없이(=전액 취소) 호출하고,
   성공 판정은 취소 API 응답이 아니라 fresh 조회(`CANCELED`·`balanceAmount=0`·`totalAmount`
   대조)로만 한다.

## 심사 트랙 (③④, [#394](https://github.com/icons-hq/icons-ip/issues/394))

1. (human) 토스 개발자센터에서 상점 **테스트 키**(`test_gck_…`/`test_gsk_…`)를 발급하고
   Vercel Production에 sensitive 값으로 등록한다. 두 키의 모드가 같은지 등록 직후 확인한다.
   CLI를 쓸 때는 값을 명령 인자나 shell history에 넣지 말고 interactive hidden stdin으로 입력한다.
2. (human) `TOSS_ORDER_CHECKOUT_ENABLED=true`로 **굿즈만** 공개한다.
   `TOSS_TICKET_CHECKOUT_ENABLED`와 canary 두 개는 닫힌 상태를 유지한다. 심사자는 우리
   원장에 계정이 없는 **비회원 방문자**라 canary(로그인 사용자 UUID 단일 일치)로 대체할 수
   없고, gate·canary가 모두 닫히면 `goodsCheckoutPaymentsEnabled()`가 false여서 결제창을
   띄울 경로 자체가 코드에 없다. 결제창 공개는 이 runbook의 2026-09-01 확정 범위다.

   **수반 위험(readback에 함께 적는다)**: 테스트 키 기간에는 공개 사용자 누구나 무과금
   가짜 `paid` 주문을 만들 수 있고, 그 주문이 발주 확인 큐·주문 확인 메일·재고 점유로
   그대로 유입된다. 감수 근거는 **첫 실판매 전**이라는 전제 하나뿐이며, 회수는 라이브
   전환 6번(테스트 주문·attempt 정리)에서 한다. 심사가 끝난 뒤에는 이 상태를 남기지 않는다.
3. (agent/CI) 승인된 exact main SHA를 GitHub Actions Production 경로로 배포하고, canonical
   alias와 build readback(`Toss configured=true`, `order checkout enabled=true`,
   `ticket checkout enabled=false`, `order canary configured=false`,
   `ticket canary configured=false`)을 확인한다. 이 조합에서는 빌드가
   `Toss public checkout gate is open on test-mode keys…` 경고를 출력하는 것이 정상이다 —
   빌드를 멈추는 조건이 아니라 심사 창 상태를 로그에 남기는 비치명 경고다. build log에
   키·paymentKey·provider 원문이 없는지 함께 본다.
4. (human) 테스트 키로 결제창을 실제로 띄워 다음 두 가지를 확인한다.
   - **위젯 노출 결제수단이 카드·간편결제뿐인지** 토스 결제 어드민에서 확인한다(가상계좌·
     상품권 등은 비노출). 가상계좌가 노출되면 승인 API가 200이면서 `DONE`이 아니라
     `WAITING_FOR_DEPOSIT`으로 오고, 어댑터는 이를 `unknown`으로 보존한 채 고착된다 —
     안전측이지만 자동 종결 경로가 없다. `DEPOSIT_CALLBACK`은 구독하지 않으므로 입금
     통보로 풀리지도 않는다.
   - **orderId 조회 API(`GET /v1/payments/orders/{orderId}`) 200**을 실키로 확인한다.
     공식 API 키 문서의 주문서형(`gsk`) 허용 API 열거에 이 endpoint가 빠져 있어(코어 API
     레퍼런스에는 키 제한이 없어 문서가 서로 모호하다) 실키 호출이 아직 미확인이고,
     reconcile·refund 판정은 전적으로 이 조회에 의존한다. 거부되면 paymentKey 기반 조회
     fallback 설계 검토가 후속이다.
5. (agent) 심사 요건을 점검한다 — 판매 상품이 **1개 이상** 공개 노출될 것, 사이트 하단
   **사업자 정보** 표기가 있을 것, 테스트 키로 결제창이 정상 노출될 것, 토스 공식 홈페이지
   심사 조건인 **비회원도 구매 가능할 것**. 마지막 항목은 현재 구조와 충돌한다 — ICONS는
   구매를 로그인 뒤 보호 액션으로 두므로(`AGENTS.md` 구현 원칙) 반려·지연 소지가 있다.
   대응은 human 스텝([#394](https://github.com/icons-hq/icons-ip/issues/394))에서
   **비회원 구매 허용 검토**와 **심사팀 사전 협의** 중 무엇을 먼저 밟을지 정한다. 테스트 키
   기간의 결제는 실결제가 아니며, 첫 실판매 전이라 결제창 공개가 2026-09-01 확정으로 허용됐다.
6. (human) 개발자센터에 **웹훅 URL**(`https://iconsip.com/api/webhooks/tosspayments`)과
   이벤트를 등록한다. 구독 이벤트는 **`PAYMENT_STATUS_CHANGED`만**이다 — 가상계좌 입금통보는
   Phase 1 범위 밖이다. 10초 내 200 응답, 최대 7회 재전송을 전제로 멱등 처리한다.
7. (human) 전자결제를 신청한다(사업자등록증 등 서류). 19금 공존 구조의 서면 확인 문서를
   함께 보관한다.
8. (human) 홈페이지 심사(1~2일) → 카드사 심사(최대 14일)를 추적하고 심사 요청 사항에
   대응한다. 라이브까지 3~4주를 전제로 첫 실판매(에픽 #319) 일정과 맞춘다.

완료 조건: 카드사 심사 통과, 라이브 키 발급 가능 상태.

## 라이브 전환 (⑤, [#395](https://github.com/icons-hq/icons-ip/issues/395))

1. (human) 라이브 키(`live_gck_…`/`live_gsk_…`)를 발급받아 Vercel Production의 두 변수를
   **동시에** 교체한다. 한쪽만 바꾸면 모드 불일치로 게이트웨이가 unconfigured가 되고, 심사
   창(③)에서 굿즈 gate가 이미 `true`이므로 그 조합은 다음 배포의 빌드를 곧바로 실패시킨다.
   두 값을 한 번에 교체해 배포하고 같은 배포의 readback에서 모드를 확인한다.
2. (human/agent) 구 v1 키 계열(`test_sk_…`) 등 더 이상 참조되지 않는 토스 env가 Production·
   Preview 스코프에 남아 있으면 정리한다. 런타임은 형식으로 이미 거절하지만, 남겨 두면
   운영자가 현재 유효한 키를 오인한다.
3. canary 선검증: 라이브 키가 붙은 상태에서 리허설을 한 명으로 가두기 위해
   `TOSS_ORDER_CHECKOUT_ENABLED=false`로 되돌리고(심사 창에서 열어 둔 값이다)
   `TOSS_ORDER_CANARY_USER_ID`만 등록한 새 Production deployment를 만들어, 그 목적의 gate는
   false·canary만 true인지 readback한다. 실과금 직전에 목적·대상·사용자·금액·결제수단·취소
   계획을 사용자에게 다시 보여 주고 명시 확인을 받는다. 과거의 구현 승인이나 키 등록 승인을
   과금 승인으로 재사용하지 않는다.
4. (human) 소액 실결제 → 취소 리허설을 **카드 1건 · 간편결제 1건** 수행하고, 웹훅 수신과
   조회 재검증 동작을 확인한다. 리허설 전에 **위젯 노출 결제수단이 카드·간편결제뿐인지**
   토스 결제 어드민에서 다시 확인한다 — 가상계좌가 노출되면 승인 API 200이 `DONE`이 아니라
   `WAITING_FOR_DEPOSIT`으로 와 attempt가 `unknown`으로 고착되고, `DEPOSIT_CALLBACK`을
   구독하지 않아 입금 통보로도 풀리지 않는다.
5. (human) `TOSS_ORDER_CHECKOUT_ENABLED=true`로 **굿즈만** 다시 공개하고 canary를 제거한다.
   `TOSS_TICKET_CHECKOUT_ENABLED`는 공연·티켓 판매 일정이 확정될 때까지 `false`로 유지한다
   (2026-09-01 결정). 변경 뒤 새 Production deployment와 boolean readback까지 확인해야 적용된
   것으로 본다. 이 배포부터는 테스트 모드 경고가 더 이상 나오지 않는 것이 정상이다.
6. (agent) 테스트 키 기간에 생성된 테스트 주문·attempt 상태를 원장 이력 보존 원칙 안에서
   정리하고, 이 runbook에 readback을 기록한다. 심사 창(③ 2번)에서 공개 사용자가 만든 무과금
   `paid` 주문이 여기 포함된다 — 발주 확인 큐에서 빼고 점유된 재고를 되돌린 결과까지 함께
   적는다.

완료 조건: 라이브 실결제·취소 왕복 검증 완료, 첫 판매(에픽 #319) 결제 준비 상태.

## 운영 확인

각 경로가 실제로 닫히는 지점을 원문 식별자 없이 확인한다.

- **승인**: prepare 1회 → known callback claim 1회 → confirm 1회. 콜백 응답이 provider 값을
  포함하지 않는 303인지, `approved` payment와 주문/예매 상태가 하나의 finalizer transaction
  으로 일치하는지, 중복 콜백이 추가 결제·재고·티켓을 만들지 않는지. 티켓이면 승인 전 QR이
  없고 승인 뒤에만 발급됐는지. 확인 표면은 `/admin/sales/orders` 원장과 사용자 주문/티켓 화면이다.
- **취소·환불**: 클레임 승인이 provider 취소를 자동 발행하고 fresh 조회로 확정되는지.
  `/admin/sales/claims/*` 큐에서 `결제확인필요`(needs_review)로 남는 건은 시스템이
  추측 종결하지 않았다는 뜻이므로 운영자가 원장을 직접 대조한다. 부분취소는 발행하지 않으므로
  잔여 balance가 보이면 그 자체가 이상 신호다.
- **웹훅·재정합**: 개발자센터 전송 이력의 성공/실패와 앱 응답 코드를 대조한다. 400은 형식
  위반(파서 거절), 503은 자격 증명·service 미구성, 5xx는 재정합 실패로 재전송을 유도한 것이다.
  콜백이 유실된 건의 만료 + 45분(결제창 30분 · 승인 10분 · 버퍼)은 **시한이 아니라
  `reconcile()`이 실행됐을 때의 판정 규칙**이다 — 그 시각을 지났고 조회가 404이면 실패로
  확정되지만, 시한 도달만으로 스스로 실행되지는 않는다. reconcile을 태우는 트리거는 ① 토스
  웹훅 재전송(최대 7회 — attempt lookup 실패나 outcome `unknown`이면 앱이 5xx를 돌려 재전송을
  계속 받는다) ② 티켓 내부 Bearer reconcile 라우트 둘뿐이고, 주기 크론은 의도적으로 없다.
  재전송이 소진되거나 웹훅이 아예 오지 않으면 그 건은 `unknown`으로 남아 아래 drain 집계와
  운영 소유로 이관된다.
- **미종결 attempt·장애 신호**: 토스 웹훅·키 장애는 미종결 attempt 집계
  (`prepared | confirming | unknown | needs_review` — Rollback drain 집계와 같은 축)와
  `/admin/sales/orders` 원장의 `pending` 카드 주문 누적, 개발자센터 웹훅 전송 이력으로 본다.
  `/admin/sales/unpaid`는 여기 쓰지 않는다 — 그 화면은 `admin_unpaid_bank_transfer_orders`
  기반 무통장 입금 대조 전용(`payment_method = 'bank_transfer'`)이라 토스 attempt가 나타나지
  않고, 거기 뜨는 `정합화 필요`는 무통장 확정 실패 표시다.
- **코페이 drain**: 진행 중이던 코페이 attempt가 고정 시간창 안에 자동 종결되지는 않는다.
  `expire_stale_checkouts()`는 **주문 만료 + 5분 유예** 뒤 `prepared` attempt만 TTL로 닫고,
  `confirming | unknown | needs_review`는 건드리지 않는다. 코페이 confirm 라우트는 gate가
  아니라 자격 증명 기준으로 열려 있으므로, 자격 증명 삭제는 시간창이 아니라 Rollback 절과
  같은 drain 집계 기준(코페이 미종결 attempt 0건, 또는 남은 전건이 운영 소유로 이관됨)으로만
  검토한다.

## 운영 노트 (도메인 상호작용)

- **판매 제한 전환 중의 진행 중 결제**: 굿즈를 `none → adult`로 바꾸면 그 굿즈가 담긴
  주문의 진행 중 `toss` attempt는 캡처 직전 claim에서 `goods_payment_provider_mismatch`로
  거절된다(파생 provider를 승인 직전에 다시 검증한다). 사용자에게는 결제 실패로 보이므로,
  전환 전에 해당 굿즈의 `pending` 주문과 `prepared` attempt를 먼저 확인하고 창이 빈 시점을
  고른다. 거절된 attempt는 `prepared`로 남아 만료 경로가 재고까지 함께 되돌린다. 무통장
  24시간 창은 PG와 독립인 축이라 자동으로 막히지 않는다 — 입금이 확인되면 사람이 판단한다.
- **무통장 송금이 접수된 클레임의 환불**: `toss` 결제 클레임이라도 환불계좌 송금이
  접수(filed)돼 있으면 자동 취소를 발행하지 않고 `bank_transfer_refund_filed`로 격리한다.
  운영자가 이미 송금했는데 취소 API까지 나가면 이중 환불이 되기 때문이며, 되돌리기 어려운
  쪽을 막는 것이 의도다. 이 건을 어떻게 종결할지(운영자 확인 vs 접수 취소)는 이 runbook이
  정하지 않고 후속 이슈 소관이다 — 큐에서는 `결제확인필요`로 보인다.

## Rollback과 callback drain

1. 해당 목적의 public gate를 `false`로 바꾸고 canary user ID를 제거한다. **키는 지우지
   않는다** — 이미 준비된 known callback과 웹훅 재정합이 drain돼야 한다. 이 시점에는 기존
   deployment 동작이 아직 바뀌지 않았다고 간주한다.
2. config-only rollback이면 현재 승인된 main SHA와 그 SHA의 성공한 Production source run ID,
   코드 결함이면 검토된 revert가 반영된 exact main SHA의 성공 run ID를 GitHub Actions
   Production 경로에 전달해 새로 배포한다.
3. 새 deployment가 Ready이고 canonical production alias가 그 deployment와 exact SHA를
   가리키는지 확인한다.
4. 새 deployment의 boolean readback에서 해당 gate와 canary configured가 모두 false인지
   확인한다. 이때부터 차단되는 것은 **그 provider의 새 reserve·prepare·provider session**
   뿐이다. 무통장 주문은 이 gate와 독립이다 — `placeOrderAction`이 `bank_transfer` 수단에는
   `bankTransferCheckoutEnabled()`(service role + `BANK_TRANSFER_BANK_NAME`·
   `BANK_TRANSFER_ACCOUNT_NUMBER`·`BANK_TRANSFER_ACCOUNT_HOLDER` 계좌 env)만 보므로, PG gate를
   닫아도 무통장 주문은 계속 생성된다.
5. 신규 굿즈 접수 **전체**를 멈추는 롤백이면 별도 스텝으로 세 계좌 env를 Production에서
   제거하고(하나만 비어도 결제수단 자체가 사라진다) 같은 Actions 새 Production deployment →
   exact SHA/canonical alias → readback 순서를 반복해 무통장 수단이 사라졌는지 확인한다.
   이미 접수된 무통장 주문의 24시간 입금 창은 이 조치로 닫히지 않는다.

drain 동안 다음 집계만 확인한다.

- `prepared | confirming | unknown | needs_review` attempt 수
- known callback claim·웹훅 재정합과 finalizer 성공/중복 수
- 승인 결제·주문·예매·환불 상태별 count
- 자동 종결되지 않고 운영 소유로 남은 `needs_review` 건과 담당자

모든 in-flight attempt가 terminal 또는 명시적 `needs_review` 운영 소유 상태가 된 뒤에만 키
교체·삭제를 별도 승인 범위로 검토한다. 키를 교체·삭제한 경우에도 같은 Actions 새 Production
deployment → exact SHA/canonical alias → boolean readback 순서를 반복한다.

## 남길 증거

- 배포 exact SHA, PR, Actions run, Vercel deployment URL과 canonical production alias 대상
- 환경별 변수 **이름·존재 여부·sensitive 여부·gate boolean**과 canonical `SITE_URL` 값만 담은 readback
- 심사 제출·홈페이지 심사·카드사 심사의 접수 시각과 결과, 19금 공존 서면 확인 보관 위치
- 심사 창의 gate readback(굿즈 open · 티켓 closed · canary 없음)과 수반 위험 기록, 그 기간에
  생성된 무과금 주문·attempt 정리 결과
- canary 직전 사용자 확인 시각과 승인된 목적·대상·사용자·금액·취소 계획
- 원문 provider 식별자 없는 DB 상태 transition과 멱등 count
- 라이브 리허설의 승인·취소 왕복 결과와 웹훅 수신 확인

실제 클라이언트 키·시크릿 키·paymentKey·transactionKey·승인번호·provider raw는 어느
issue·PR·로그에도 복사하지 않는다.
