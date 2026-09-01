# Toss Production rollout runbook

이 runbook은 토스페이먼츠 **주문서형 결제(구 결제위젯) v2**를 **키 등록 → dark deploy →
심사 → 단일 actor canary → 목적별 공개 활성화** 순서로 운영한다. 클라이언트 키·시크릿 키,
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
아직 열리지 않는다. ①은 ③과 독립이므로 순서를 기다리지 말고 먼저 닫는다. 티켓 gate는
⑤ 이후에도 판매 일정이 확정될 때까지 닫아 둔다.

## 환경별 변수

| 변수 | Production | Preview / CI |
|---|---|---|
| `SITE_URL` | `https://iconsip.com`; 일반 server config, 필수 | 환경별 일반 server origin을 둘 수 있음 |
| `NEXT_PUBLIC_TOSS_CLIENT_KEY` | sensitive; `(test\|live)_gck_…` | 두지 않음(구 v1 키 잔존은 빌드를 막지 않음) |
| `TOSS_SECRET_KEY` | sensitive, 서버 전용; `(test\|live)_gsk_…` | 두지 않음 |
| `TOSS_ORDER_CHECKOUT_ENABLED` | 기본 `false`; 라이브 키 전환·공개 승인 뒤에만 `true` | unset 또는 `false` |
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
2. gate 두 개와 canary 두 개는 모두 닫힌 상태를 유지한다. 이 단계의 목적은 결제창을 **띄울
   수 있는 상태**를 심사에 보이는 것이지 결제를 여는 것이 아니다.
3. (agent/CI) 승인된 exact main SHA를 GitHub Actions Production 경로로 배포하고, canonical
   alias와 build readback(Toss configured=true, 목적별 gate·canary=false)을 확인한다. build
   log에 키·paymentKey·provider 원문이 없는지 함께 본다.
4. (agent) 심사 요건을 점검한다 — 판매 상품이 **1개 이상** 공개 노출될 것, 사이트 하단
   **사업자 정보** 표기가 있을 것, 테스트 키로 결제창이 정상 노출될 것. 테스트 키 기간의
   결제는 실결제가 아니며, 첫 실판매 전이라 결제창 공개가 2026-09-01 확정으로 허용됐다.
5. (human) 개발자센터에 **웹훅 URL**(`https://iconsip.com/api/webhooks/tosspayments`)과
   이벤트를 등록한다. 구독 이벤트는 **`PAYMENT_STATUS_CHANGED`만**이다 — 가상계좌 입금통보는
   Phase 1 범위 밖이다. 10초 내 200 응답, 최대 7회 재전송을 전제로 멱등 처리한다.
6. (human) 전자결제를 신청한다(사업자등록증 등 서류). 19금 공존 구조의 서면 확인 문서를
   함께 보관한다.
7. (human) 홈페이지 심사(1~2일) → 카드사 심사(최대 14일)를 추적하고 심사 요청 사항에
   대응한다. 라이브까지 3~4주를 전제로 첫 실판매(에픽 #319) 일정과 맞춘다.

완료 조건: 카드사 심사 통과, 라이브 키 발급 가능 상태.

## 라이브 전환 (⑤, [#395](https://github.com/icons-hq/icons-ip/issues/395))

1. (human) 라이브 키(`live_gck_…`/`live_gsk_…`)를 발급받아 Vercel Production의 두 변수를
   **동시에** 교체한다. 한쪽만 바꾸면 모드 불일치로 게이트웨이가 unconfigured가 되고, gate가
   열려 있으면 빌드가 실패한다. 이 순서를 이용해 **키 교체 → 배포 → gate 개방** 순으로 간다.
2. (human/agent) 구 v1 키 계열(`test_sk_…`) 등 더 이상 참조되지 않는 토스 env가 Production·
   Preview 스코프에 남아 있으면 정리한다. 런타임은 형식으로 이미 거절하지만, 남겨 두면
   운영자가 현재 유효한 키를 오인한다.
3. canary 선검증: `TOSS_ORDER_CANARY_USER_ID`만 등록하고 gate는 `false`로 유지한 채 새
   Production deployment를 만들어, 그 목적의 canary만 true인지 readback한다. 실과금 직전에
   목적·대상·사용자·금액·결제수단·취소 계획을 사용자에게 다시 보여 주고 명시 확인을 받는다.
   과거의 구현 승인이나 키 등록 승인을 과금 승인으로 재사용하지 않는다.
4. (human) 소액 실결제 → 취소 리허설을 **카드 1건 · 간편결제 1건** 수행하고, 웹훅 수신과
   조회 재검증 동작을 확인한다.
5. (human) `TOSS_ORDER_CHECKOUT_ENABLED=true`로 **굿즈만** 공개한다. `TOSS_TICKET_CHECKOUT_ENABLED`
   는 공연·티켓 판매 일정이 확정될 때까지 `false`로 유지한다(2026-09-01 결정). 변경 뒤 새
   Production deployment와 boolean readback까지 확인해야 적용된 것으로 본다.
6. (agent) 테스트 키 기간에 생성된 테스트 주문·attempt 상태를 원장 이력 보존 원칙 안에서
   정리하고, 이 runbook에 readback을 기록한다.

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
  콜백이 유실된 건은 조회 404가 attempt 만료 + 45분(결제창 30분 · 승인 10분 · 버퍼)을 지난
  뒤 자동으로 실패 확정된다 — 그 전에는 `unknown`으로 남는 것이 정상이다.
- **미결제·정합화 큐**: `/admin/sales/unpaid`의 `정합화 필요` 항목이 쌓이면 웹훅 등록·키
  상태를 먼저 의심한다.
- **코페이 drain**: 전환·gate 변경 시점에 진행 중이던 코페이 attempt는 카드 attempt TTL
  **10분** 안에서 종결된다. 코페이 confirm 라우트는 gate가 아니라 자격 증명 기준으로 열려
  있으므로 이 창이 지나기 전에 코페이 자격 증명을 지우지 않는다.

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
   확인한다. 이때부터 새 reserve·prepare·provider session이 차단된 것으로 본다.

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
- canary 직전 사용자 확인 시각과 승인된 목적·대상·사용자·금액·취소 계획
- 원문 provider 식별자 없는 DB 상태 transition과 멱등 count
- 라이브 리허설의 승인·취소 왕복 결과와 웹훅 수신 확인

실제 클라이언트 키·시크릿 키·paymentKey·transactionKey·승인번호·provider raw는 어느
issue·PR·로그에도 복사하지 않는다.
