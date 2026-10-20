# 정기배송·자동결제 거래 설계

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14 초기 설계. 이후 승인된 범위에서 코드·DRAFT migration과 로컬 합성 검증을 구현했다. 현재 설정·복구·운영 절차는 [운영 문서](../../runbooks/goods-subscription-billing.md)를 참조한다. 실제 키 발급·토스 계약 변경·외부 결제·클라우드 배포는 수행하지 않았다. 사용자가 포함을 요청한 정기배송을 [공통 주문 Module](goods-transaction-module-proposal.md), [할인·배송 설계](discounts-shipping-transaction-proposal.md)에 연결한다. 실제 거래는 별도 계약·환경·배포 검증이 끝날 때까지 OFF다. 아래 주기 선택·지연 허용 시간·재시도 횟수는 ICONS 구현 제안이며 토스의 상품 정책으로 주장하지 않는다.

## 현재 코드에서 달라져야 하는 점

정기배송은 현재 존재하는 재입고 알림 subscription과 다른 도메인이다. 회차는 일반 상품 주문 한 건이며 주문·결제·배송·전체 주문 환급을 다시 만들지 않는다. 새 회차를 만들기 위해 회원의 실제 카트를 비웠다가 채우는 방식은 사용하지 않는다.

| 현재 확인 | 정기배송에 필요한 변경 |
| --- | --- |
| [cart-snapshot creator](../../../supabase/migrations/20261020085146_checkout_cart_snapshot.sql)는 사용자 잠금→카트 잠금→카트/쿠폰 선택을 사용한다. 실제 하위 creator도 `auth.uid()`, `cart_items`, `cart_coupon_selections`를 읽고 소비한다. | 고정된 구독 선택을 입력받는 공통 내부 creator를 만든다. 일반 카트 wrapper만 카트를 소유한다. 회차 Adapter가 고객의 현재 쿠폰·적립금 선택을 대신 가져오지 않는다. |
| 현재 `prepare_goods_payment_attempt`는 판매기간 검사를 추가한 wrapper다. 실제 helper는 pending·양수 주문·카드/무통장·provider·사용자 fence·snapshot·기존 attempt를 검사하고 O+UUID 주문번호와 카드 최대 10분 TTL을 만든다. | 이 검사와 O+UUID 계약을 유지하면서 회차/빌링 credential binding을 원자적으로 추가한다. 가짜 callback nonce로 기존 callback claim을 통과시키지 않고 서비스 전용 회차 claim을 둔다. |
| [일반 Toss Adapter](../../../lib/payments/toss-gateway.server.ts)의 `paymentMatchesAttempt`는 orderId/KRW/총액/paymentKey를 대조하고 가상계좌를 별도 격리한다. 현재 MID·BILLING 타입 검사는 없다. | Billing Adapter는 고정 MID·`type=BILLING`·카드·orderId·KRW·총액·paymentKey·승인시각을 추가 대조한다. 일반 결제 규칙을 넓혀 빌링을 암묵적으로 허용하지 않는다. |
| [키 검사](../../../lib/payments/toss-config.mjs)는 gck/gsk 전용, [runtime dispatcher](../../../lib/payments/runtime-gateway.ts)는 provider만 받아 현재 단일 Toss 설정을 고른다. | ck/sk와 빌링 MID의 별도 설정, attempt별 integration·credential profile·발송 key version이 필요하다. 승인뿐 아니라 재조회·웹훅·환급·정산의 dispatcher도 이를 사용한다. |
| 현재 승인 요청 timeout은 25초, 일반 confirm route 예산은 60초다. | 빌링 전용 실행 예산을 둔다. 60초 이상 provider timeout + 증거 저장 여유를 확보하고, 조회 복구는 별도 작업으로 넘긴다. 기존 일반 route 예산 안에 억지로 추가하지 않는다. |
| 현재 finalizer는 claim token, 주문 상태·금액·사용자 fence·snapshot을 검사하고 승인 증거와 paid 주문을 확정한다. 만료 뒤 도착한 유효한 승인 증거도 보존한다. `unknown`은 별도 reconciliation claim/finalizer로 복구한다. | 기존 finalizer를 호출하는 회차 wrapper가 그 결과와 cycle을 같은 트랜잭션에 결속한다. 고객 해지/계정 상태가 바뀌어도 이미 발생한 외부 결제 증거를 잃지 않는다. |

현재 함수 정본은 CANON 312에서 추출한 함수 인덱스 (`output/goods-transaction-design-20261014/functions-index.json`)·finalizer (`output/goods-transaction-design-20261014/12-public-finalize_goods_payment_attempt.sql.txt`)·카트 creator (`output/goods-transaction-design-20261014/19-public-place_order_with_cart_snapshot.sql.txt`)를 기준으로 확인했다. `private.prepare_goods_payment_before_sale_period`와 `claim_goods_payment_reconciliation`도 같은 로컬 DB에서 읽었으며 후자는 기존 10분 claim lease를 사용한다. 과거 migration 한 개만 복사해 최신 계약을 덮어쓰지 않는다.

## 공식 원문으로 확인한 외부 조건

- 자동결제는 추가 리스크 검토/계약이 필요하고 주기 실행은 가맹점이 구현한다. 빌링키 자체를 나중에 조회하는 API는 없으며 분실 시 재등록이 필요하다. 이 계정의 계약 상태는 확인하지 않았다. [자동결제 이해하기](https://docs.tosspayments.com/guides/v2/billing)
- 현재 카드 등록 가이드는 API 개별 연동 키와 `payment().requestBillingAuth()`를 안내한다. 돌아오는 `authKey`는 일회 인증 값이며 `customerKey`와 함께 서버 발급 요청에 사용한다. 카드번호·생년월일 등을 ICONS 폼에 직접 수집하는 방식은 채택하지 않는다. 등록창의 카드 비밀번호 입력 제한과 계약이 맞지 않으면 도입을 중단하고 계약을 확인한다. [결제창 연동](https://docs.tosspayments.com/guides/v2/billing/integration)
- SDK 등록은 인증일 뿐 결제 완료가 아니다. PC/모바일이 지원되는 redirect 방식으로 통일하며 모바일 iframe에 의존하지 않는다. SDK 페이지의 현재 표제는 `결제창(구버전)`이지만 위 공식 빌링 가이드는 여전히 그 등록 메서드를 연결한다. [SDK](https://docs.tosspayments.com/sdk/v2/js/payment#paymentrequestbillingauth)
- 발급은 `POST /v1/billing/authorizations/issue`, 청구는 `POST /v1/billing/{billingKey}`, 등록 해지는 `DELETE /v1/billing/{billingKey}`다. 승인에는 최소 60초 timeout이 필요하다. Payment의 일반결제와 자동결제 type은 다르며 조회·취소에는 결제 paymentKey/orderId를 사용한다. [API](https://docs.tosspayments.com/reference#자동결제)
- 빌링 개별 키는 ck/sk이며 주문서형 gck/gsk와 MID가 다를 수 있다. 키 회전은 같은 상점의 credential profile을 바꾸지 않아야 한다. 현재 공식 안내의 신·구 시크릿 중첩 기간은 7일이다. [API 키](https://docs.tosspayments.com/reference/using-api/api-keys)
- 모든 POST에 `Idempotency-Key`를 사용할 수 있다. 유효기간은 15일이며 동일성에는 API 키·주소·HTTP 메서드도 포함된다. 따라서 시크릿 회전이나 경로 변경 뒤 같은 key 문자열을 보낸다고 같은 요청이 되는 것은 아니다. [인증·멱등 헤더](https://docs.tosspayments.com/reference/using-api/authorization#멱등키-헤더)

## Module과 Interface

`GoodsSubscription` Module은 신청·동의·주기·회차·일시정지·해지·고객/관리자 표시를 소유한다. 금액·재고·배송 계산은 `GoodsTransaction.quote/place`를 호출한다. 카드 입력과 provider 통신은 `RecurringBilling` Module에 숨긴다. 실제 Toss와 결정론적 Fake가 같은 Interface를 구현한다.

| 외부 Interface | 호출자가 알아야 하는 계약 |
| --- | --- |
| `prepareEnrollment(selection, schedule, destination, explicitBenefits)` | 인증한 회원 소유의 초안을 만들고 최초 금액·향후 기준금액·T/D·주기·해지 기준·동의 버전·필요한 다음 동작을 반환한다. 카드 등록이 주문 생성/청구를 뜻하지 않는다. |
| `confirmEnrollment(enrollmentId, quoteId, credentialId, consentRevision, operationId)` | 현재 계정·초안·견적·카드 소유권·약관을 잠금 아래 확인하고 첫 회차 한 건을 만든다. 성공 재시도는 동일 구독/회차/주문 영수증이다. |
| `changeSubscription(id, expectedRevision, operationId, command)` | pause, resume, cancel, changeSchedule, changeDestination, replaceCard, acceptTerms를 닫힌 command로 받는다. 각 command의 재동의/현재 회차 영향은 아래 상태표를 따른다. |
| `readSubscription(id)` | 본인만 읽는 masked DTO. 관리자에게도 빌링키/customerKey/authKey/ciphertext/nonce를 반환하지 않는다. |
| `runDueWork(batchLimit)` | 인증된 내부 작업만 호출한다. DB 시각으로 due 후보를 선택하고 lease를 얻은 뒤 처리한 회차·복구 필요 건수만 반환한다. 스케줄러가 회원 ID·임의 금액을 직접 넣어 청구하지 않는다. |

`RecurringBilling`의 외부 Interface는 등록 준비/교환, `charge(boundAttempt)`, `inspect(boundAttempt)`, `refund(boundAttempt, request)`, `revoke(credentialId)`다. 모두 provider의 검증된 결과 또는 `unknown/needs_review`를 반환하며 직접 주문을 paid로 바꾸지 않는다. `boundAttempt`는 서버가 private binding에서 만든 값이며 브라우저 DTO가 아니다. 승인과 조회/환급의 공통 검증은 이 Module 내부에 둔다.

공통 주문 Module과의 실제 SQL Interface는 다음으로 맞춘다. 아래 함수 본문·가격 산식은 공통 Module이 소유하며 구독 코드에서 복제하지 않는다.

```text
private.lock_goods_transaction_source(actor, source)
private.quote_goods_transaction(actor, source, selection, address,
  deliveryChoices, userCouponId, storeCreditAmount)
  → quoted { quoteId, expiresAt, display } | blocked { issues }
private.place_goods_transaction(actor, source, selection, address,
  quoteId, checkoutKey, paymentMethod)
  → orderId

source = { kind: 'subscription', id: cycleUUID, revision: sourceRevision }
selection = [{ goodId, variantId, qty, inputRevision, inputValues }]
```

`blocked`에는 결제 가능한 quote ID가 없다. `sourceRevision`은 선택·주소·약관의 불변 snapshot을 가리키는 문자열이며 worker lease나 운영 상태 revision과 구분한다. Adapter는 현재 cycle 소유자와 snapshot을 서버에서 확인한다. 재동의로 새 snapshot을 선택할 때는 이전 snapshot을 수정하지 않고 새 revision을 발급하며, 이전 quote는 place할 수 없다. place의 쿠폰·적립금·배송 선택은 quote에 고정된 값만 사용한다.

최초 견적에도 cycle ID가 필요하므로 신청 준비에서 만료되는 draft plan/cycle과 source snapshot을 먼저 만든다. 이 단계에는 주문·재고 예약·외부 청구가 없다. 이후 신청 확정은 그 cycle을 재사용한다. 자동 회차도 예정 slot당 cycle ID를 먼저 확정하고 같은 Interface를 호출한다. quote/place Adapter는 plan/cycle 행을 읽거나 잠그기 전에 `lock_goods_transaction_source`를 호출한다. 이 helper와 공통 quote/place 내부 재진입은 모두 actor advisory→source advisory 순서를 유지한다.

## 원장과 불변 스냅샷

모두 private 원장을 기본으로 하고 권한 있는 RPC/서버의 최소 DTO로만 읽는다. 공개 상품에는 판매자가 등록한 정기배송 가능 여부·주기·설명만 투영한다.

| 원장 | 주요 결속·제약 |
| --- | --- |
| `billing_customers` | 회원+provider environment+MID profile당 무작위 UUID customerKey. 고객 ID/이메일/전화번호를 customerKey로 쓰지 않는다. |
| `billing_enrollments` | actor/session binding, nonce digest, 만료, credential profile/key version, 고정 provider idempotency key, 상태. `authKey`가 필요할 때는 짧은 수명의 암호문만 보존한다. |
| `billing_credentials` | 소유자·customer binding·MID/profile, 인증 암호화한 billingKey, encryption key version, 최소 마스킹 카드 표시, active/revoking/revoked/needs_review. plaintext 반환 함수 없음. |
| `goods_subscription_plans` | 소유자, 상태/revision, immutable 선택 revision, 주기/기준일/다음 slot, 주소 revision, credential ID, 약관 revision, 최초/갱신 금액 동의, cancellation marker. |
| `goods_subscription_terms` | 상품·옵션·수량·직접입력, 가격·할인·배송 조건 버전, T/D 및 수납 주체/방식, 주기·지연/해지 정책, 확인 시각. 기존 동의는 수정하지 않고 새 revision을 만든다. |
| `goods_subscription_cycles` | `(plan_id, cycle_number)` unique, 예정시각/동의 revision·source snapshot revision, 상태/revision, quote/order/attempt ID, claim owner/expiry/fence, dispatch 시각, 다음 재조회 시각, 안전한 사유 코드. 한 cycle에 주문·attempt를 하나씩만 연결한다. |
| `payment_provider_bindings` | attempt ID당 integration(`toss_order_form`/`toss_billing`), 불변 credential profile/MID/environment, 최초 write key version, credential ID, cycle ID, 검증 정책 버전. 사용자 읽기 없음. |

회차 주문은 기존 `orders`/`order_items`/shipments/payment attempt에 생성하고 cycle ID·견적/계산 버전만 결속한다. 기존 public payment DTO에 빌링키 또는 복호화 참조를 추가하지 않는다. 공통 감사 기록에는 ID·revision·hash·안전한 결과 코드만 남긴다. billingKey뿐 아니라 customerKey/authKey/nonce/전체 provider URL 및 응답 본문도 로그·에러 리포트·XLSX·이메일에 남기지 않는다. 카드 표시는 허용된 issuerCode·마스킹 번호만 검증해 남긴다.

암호화 키는 DB·migration·환경 예제의 실제 값에 포함하지 않고 서버의 별도 secret 관리에서 가져온다. AEAD의 associated data는 credential ID·owner·profile/MID·environment를 결속한다. 키 회전은 새 버전으로 재암호화/대조한 뒤 기존 버전을 폐기한다. 평문을 돌려주는 service-role RPC도 만들지 않는다.

## 최초 신청과 카드 등록

1. 정기배송 가능 상품의 현재 공개·옵션·수량·구매 한도·일반 재고를 확인하고 immutable 선택을 만든다. 기존 예약판매, 19금/코페이 강제 상품, 티켓·경품은 이 카드 정기배송의 지원 대상으로 표시하지 않는다. 일반 판매 기능은 계속 유지하며 다른 공급형을 추가할 때는 별도 정책 검토가 필요하다.
2. 고객에게 최초 결제 T, 최초 쿠폰/적립금, 향후 회차는 쿠폰/적립금 0이라는 기본 정책, 향후 기준 T와 D, 주기·결제일·배송 주소·해지 기준을 구분해 보여준다. 최초 혜택을 매 회 제공한다고 표시하지 않는다.
3. 로그인/session·nonce·허용 origin·만료에 결속한 카드 등록 세션을 만든다. SDK에 필요한 공개 client key와 customerKey만 인증 화면에서 일시 사용한다. callback endpoint는 HTML/분석 스크립트를 렌더링하지 않고, 쿼리를 수집하는 로그를 차단한 뒤 즉시 query 없는 결과 URL로 이동한다. 응답에는 `Cache-Control: no-store`와 `Referrer-Policy: no-referrer`를 적용한다. 애플리케이션뿐 아니라 edge/호스팅 access log의 쿼리 마스킹도 gate 점검에 포함한다. provider가 쿼리로 돌려주는 authKey의 브라우저 노출 자체와 서버의 불필요한 재노출을 구별한다.
4. 서버가 authKey/customerKey/등록 세션/같은 계정을 대조하고 고정 멱등키와 고정 key version으로 발급한다. 발급 응답을 검증·암호화해 원장에 저장한 뒤에만 credential ready를 표시한다. 고객에게 최초 확정 견적과 약관을 다시 보여주고 신청 확정을 받는다.
5. `confirmEnrollment`는 현재 유효한 quote를 다시 검사한다. 등록 도중 만료되거나 금액/조건이 바뀌면 새 견적·동의가 필요하다. 첫 회차가 승인되기 전에는 plan을 active로 표시하지 않는다.

발급 응답 손실은 같은 발급 요청을 동일 credential version/idempotency key로만 복구한다. provider에서 이미 발급됐지만 암호문을 저장하지 못한 경우까지 구분한다. 복구할 수 없으면 `needs_review`/재등록 안내이며 알 수 없는 빌링키로 활성 구독을 만들지 않는다. 자체 등록 세션은 10분, 이미 발송한 발급 결과의 암호화 복구 재료는 최대 24시간을 제안한다. 외부 멱등 유효기간을 내부 저장 허가로 해석하지 않는다. 반환되지 않은 orphan key는 조회/삭제할 수 있다고 주장하지 않고 운영 확인 항목으로 남긴다.

## 주기와 회차

기본 선택은 1·2·4주 또는 1·2·3개월을 제안한다. KST 날짜와 기준 시각을 저장하고 실행 예정 timestamp는 UTC로 파생한다. 월 주기는 원래 기준일/말일 의도를 보존한다. 1월31일→2월말→3월31일이며 2월말에서 다시 한 달을 더해 3월28일로 밀리지 않는다. 주 주기는 기준 KST 날짜에서 7×간격×회차를 더한다. 실행이 지연돼도 실제 처리 시각을 다음 기준일로 쓰지 않는다.

한 plan에는 해결되지 않은 청구 회차를 하나만 둔다. 일시정지·재고 부족·미확정 결제를 건너뛰어 다음 회차를 자동 중복 청구하지 않는다. 기본 지연 허용은 예정시각 후 24시간으로 제안한다. 그 이상 지나면 `paused/schedule_missed`로 중지하고 새 일정 확인을 받으며, 장애 복구 직후 여러 과거 회차를 몰아서 결제하지 않는다. 회차 번호와 주문 생성 횟수는 다를 수 있고 미청구 slot도 이유와 함께 기록한다.

같은 일정의 worker 재실행, lease 회수, 프로세스 재시작은 같은 cycle·order·attempt·provider orderId·provider 멱등키를 사용한다. 첫 확정 성공을 현재 가격으로 다시 계산하지 않는다. 확정 카드 거절 후 자동 연속 청구는 기본 제공하지 않는다. plan을 payment_failed로 일시정지하고 미결제 주문의 예약 자원을 기존 취소/만료 절차로 해소한다. 카드 변경 후 재개는 새 미래 slot을 확인한다. 같은 실패 주문에 새 attempt를 덮어쓰거나 같은 회차에 두 번째 주문을 조용히 만들지 않는다.

## 회차 견적과 청구

due claim은 짧은 트랜잭션에서 `SKIP LOCKED`로 후보를 고르고 lease/fence를 저장한 뒤 commit한다. 이 행 잠금을 가진 채 사용자 공통 잠금이나 HTTP를 기다리지 않는다. 후속 quote/place Adapter는 `lock_goods_transaction_source`의 사용자 advisory→회차 source advisory를 먼저 획득한 뒤 plan/cycle→공통 quote/order/정렬된 재고·배송·혜택→attempt 순서로 잠근다. plan 단위 변경 command도 사용자 advisory를 첫 잠금으로 획득한 뒤 해당 plan과 미해결 회차를 읽고 잠근다. cycle ID를 찾으려고 plan 행을 잠근 다음 사용자 잠금을 얻는 역순을 만들지 않는다. 기존 취소/환급 경로와 실제 lock graph를 구현 전 대조한다.

매 회차 최신 상품/옵션/직접입력 정의·공개/판매기간·계정 상태·재고·구매 한도·주소·지역배송·가격·할인·운임을 같은 `GoodsTransaction`에서 검증한다. 미래 회차는 명시적으로 C=0/R=0이다. 상품 가격·혜택·배송 조건의 변경을 카트나 현재 회원 쿠폰으로 우회하지 않는다.

```text
claim due → current quote + accepted renewal terms 대조
          → 공통 place로 cycle 주문 1건 + 재고/혜택 예약
          → billing binding + charge lease를 원자적으로 확정
          → DB 잠금을 놓고 provider 청구
          → 검증된 증거로 기존 order finalizer + cycle 결속
```

최초 동의와 향후 갱신 동의는 구분한다. 같은 갱신 기준 T 또는 D가 달라지거나 상품/수량/주기/주소 영향·수납 주체/방법이 달라지면 `needs_confirmation`이며 그 회차를 청구하지 않는다. 결제 T가 같아도 착불 D 증가를 무시하지 않는다. 재동의 시 quote·동의 revision·구독 revision을 함께 검사하고, 동시에 다시 바뀌면 다시 확인한다. 한 번 받은 포괄 동의로 향후 모든 가격을 임의 청구하지 않는다.

재고 부족·판매 종료·지원하지 않는 결제 route·지역 정책 불명확은 `paused`와 구체 사유다. 외부 청구를 먼저 하고 나중에 재고를 찾지 않는다. 지급 예약은 주문 생성 시 기존 계약대로 이루어지며, 아직 청구하지 않은 회차를 취소할 때 기존 자원 해제 경로를 재사용한다. 신규 amount=0 특별 경로를 만들지 않고 공통 최소 결제액 계약을 따른다.

## 미확정 결과·취소·해지

| 상황 | 결과 |
| --- | --- |
| lease 획득 전 또는 외부 발송 확정 전 pause/cancel 승리 | 새 주문/청구를 차단한다. 이미 만든 미발송 주문이 있으면 기존 취소 경로로 자원을 해소한다. |
| `charge_dispatched_at` 확정 뒤 해지 | 이후 회차는 즉시 중지한다. 현재 회차는 결제 확인 중으로 보여주고 결과를 조회한다. 현재 주문 취소는 별도 명시 동작으로 기존 전액 취소를 요청한다. 해지만으로 환급 완료를 표시하지 않는다. |
| timeout/5xx/형태 오류/응답 손실 | `unknown`. 현재 cycle을 유지하고 같은 profile/MID의 orderId로 조회한다. 404 한 번을 미청구 증거로 보거나 새 UUID로 재청구하지 않는다. |
| 승인됐으나 동시 계정 fence/주문 취소로 finalizer가 needs_review | 외부 승인 증거를 보존한다. 기존 reconciliation/취소 복구로 환급 여부를 확정한다. 새 주문이나 리워드를 추가하지 않는다. |
| 프로세스가 발송 전후에 죽고 lease가 만료 | 새 worker는 fencing token을 갱신하되 첫 동작은 inspect다. 이전 worker의 늦은 DB 확정은 거절하고 외부 멱등 요청 식별은 유지한다. |
| 확정 결제 거절 | 미청구 실패와 자원 해제를 확인하고 plan을 일시정지한다. 카드 변경/일정 재확인 전 자동 재청구하지 않는다. |
| 승인된 회차의 취소·반품 | 기존 주문 단위 전액 환급·재고·쿠폰·적립금 계약을 사용한다. 미래 plan 상태와 이미 만들어진 주문 상태를 분리한다. |

DB의 마지막 dispatch 확인과 외부 HTTP 사이를 원자화할 수는 없다. 해지 효력 기준은 위 dispatch commit으로 명시하고, 아직 전송되지 않았을 것이라는 추측으로 전액 무료 또는 환급 완료 상태를 만들지 않는다. 모든 worker/webhook/manual recovery는 cycle/attempt fencing과 불변 provider binding을 다시 읽는다. 스케줄러 gate를 내려도 이미 보낸 결제의 inspect/refund 복구 gate는 유지한다.

provider 청구는 최대 60초 요청과 commit 여유가 필요하다. 실행 환경은 최소 90초 전용 작업 예산과 10분 claim lease를 제안하며 실제 플랫폼 제한을 배포 전 확인한다. 같은 작업에서 60초 청구를 여러 번 반복하지 않는다. 미확정 건은 별도 재조회 작업으로 회수하고 재조회 실패가 임계 횟수/시간을 넘으면 운영 검토로 올린다. 외부 멱등 15일이 지난 미확정 청구는 새 key로 갱신해 보내지 않는다.

## MID·키 회전·과거 결제 복구

`credentialProfileId`는 provider/product/MID/environment의 불변 정체성이다. secret bytes/version은 그 profile의 교체 가능한 자격이다. 다른 MID로 변경은 키 회전이 아니며 새 profile과 재등록/동의가 필요하다. 과거 attempt의 profile을 새 상점으로 재지정하지 않는다.

- 첫 provider POST에 사용한 key version·method·path 유형·멱등키·정규화 payload hash를 기록한다. billingKey가 포함된 실제 path와 plaintext payload는 기록하지 않는다.
- POST의 재시도는 해당 version이 유효한 동안 같은 조합으로만 수행한다. 회전한 키로는 같은 MID 조회를 먼저 한다. 옛 키가 만료된 불명확 쓰기를 새 키로 자동 반복하지 않는다. 발급에는 payment orderId 조회 대안이 없으므로 동일 발급 영수증 복구 실패를 별도로 처리한다.
- 정상 과거 결제의 조회·환급·정산은 해당 MID에서 현재 유효한 키를 resolver가 선택할 수 있다. 환급 요청 자체가 불명확하면 그 요청의 key version/멱등키를 보존하고 먼저 잔액/취소 증거를 조회한다. 기존 전체 환급 검증을 건너뛰지 않는다.
- 기존 Toss attempt는 기존 주문서형 profile로 명시 해석한다. `provider='toss'` 또는 O 접두사만으로 빌링이라고 추정하지 않는다. 웹훅은 payload가 아니라 local attempt→binding→provider 조회로 확정한다.
- 현재 [취소 orchestrator](../../../lib/orders/cancellation-orchestrator.server.ts), [runtime gateway](../../../lib/payments/runtime-gateway.ts), [goods checkout runtime](../../../lib/payments/goods-checkout.runtime.server.ts), webhook/reconciliation/정산 resolver 모두 변경 목록에 포함한다. billing branch만 추가하고 환급 경로를 기존 gsk에 남겨두면 완료가 아니다.

## 권한·계정 삭제·운영 화면

회원은 본인 구독/등록카드 표시만 읽고 본인 세션으로 변경한다. 관리자는 `catalog.manage`로 상품의 정기배송 제공 설정을, `sales.read`로 구독/회차와 파일을 조회하고 `sales.manage`로 이미 발송한 미확정 회차를 재조회한다. 결제자 대신 카드 등록·동의·임의 증액·새 청구를 실행하는 버튼은 제공하지 않는다. 서비스 전용 worker/credential 처리는 운영자 RLS 권한과 분리한다. 모든 writer에 expected actor/revision/operation을 적용한다.

카드 교체는 새 카드가 검증·암호화 저장된 뒤 미래 회차의 binding을 전환한다. 이미 dispatch한 attempt의 credential은 교체하지 않는다. 여러 plan이 같은 카드에 결속되어 있으면 카드 삭제 화면에 영향을 받을 구독을 표시하고, 명시 해지/교체 후 사용 중인 참조가 없어야 폐기한다. 진행 중 결과를 정합화한 다음 provider revoke를 확인하고 암호문을 삭제한다. revoke 실패를 삭제 완료로 표시하지 않는다.

계정 삭제·쓰기 fence·운영 정지는 새로운 회차 획득/발송을 먼저 차단한다. provider에서 이미 발생한 승인·취소의 증거와 필요한 정합화 식별자는 기존 금융 기록 보존 절차로 넘긴다. 해결되지 않은 cycle/환급이 있는 상태에서 credential·order 연결을 cascade 삭제하지 않는다. 주소의 원문 보존 기간과 주문 법정 보존 정책은 기존 계정 삭제 계약과 함께 검토하며 새 구독 테이블의 FK만으로 삭제를 구현하지 않는다.

현재 [계정 삭제 계약](../../ARCHITECTURE.md)은 신규 write fence와 진행 거래 blocker를 함께 사용하며, 보존 snapshot에 주소·provider raw·payment key를 복사하지 않는다. 새 active plan/미확정 cycle/등록 해지 미확정 상태를 blocker 및 정리 절차에 연결한다. 정합화에 잠시 필요한 private 식별자와 최종 보존 allowlist를 구분하고, 기존 계약에 없는 billingKey·주소·원문을 장기 보존 snapshot으로 옮기지 않는다.

고객 화면은 최초/다음 예정 금액과 날짜, 회차 상태, 일시정지 사유, 재동의 항목, 카드 마스킹, 주소 변경, 해지, 회차 주문 링크를 제공한다. 관리자 화면은 상태·다음 실행·회차/주문·미확정 결제·재조회 필요 상태를 보여주며 숨긴 provider 원문 대신 안전한 오류 코드로 원인을 안내한다. 운영자의 재조회는 청구 재시도와 별도다.

## 구현 순서와 검증 기준

1. 공통 `quote/place`의 고정 선택 Adapter, 새 할인/운임 snapshot, legacy 산식 보호를 먼저 완성한다. 회차 생성이 카트와 독립적인지 기존 일반 주문 회귀로 확인한다.
2. credential profile/binding과 masked DTO·암호화·등록 세션을 구현하고 Fake만 연결한다. 기존 Toss 과거 결제의 환급/조회 dispatcher 회귀를 함께 만든다.
3. plan/cycle/terms와 due claim·fencing·pause/cancel/reconsent를 구현한다. 실제 승인 없이 1월31일·윤년·월 말일·지연·중복 worker를 검증한다.
4. Fake 승인/거절/timeout/응답 손실/늦은 성공을 공통 finalizer 및 기존 전액 환급에 연결한다. 로컬 PC/390px에서 고객 신청→첫 회차→다음 회차→일시정지/해지→주문/원장/파일 readback을 확인한다.
5. 공식 계약·MID·테스트 billing 키·암호화/실행 환경·로그 마스킹을 별도 확인한 뒤 테스트 PG 연결을 검토한다. 운영 gateway/cron/public gate는 코드 존재나 키 준비만으로 켜지 않는다.

필수 실제 두 세션 회귀는 같은 cycle의 worker 경쟁, plan pause/cancel 대 dispatch, 동의/가격 변경 대 place, 카드 교체 대 발송, 계정 fence 대 finalization, 일반 카트 주문 대 같은 재고/구매 한도, unknown 회수 대 늦은 기존 worker, 같은 operation 중복, 환급과 webhook 재조회 경쟁이다. 독립 oracle은 S/V/C/R/H/D/T와 회차 합계·납부/환급액을 대조하며 C=R=0 미래 기본값, 최초 혜택 분리, 착불 D 재동의, 양수 결제 최소액을 포함한다.

동일/타인 계정·권한 상실·서비스 전용 RPC·RLS·네 롤 execute revoke·매개변수 bound·개인정보/비밀 비노출을 검사한다. migration은 새 격리 clone에서 기능·실경합·ACL/owner·기존 함수/registry/ledger 보존을 먼저 검증하며 리뷰 전 named DB에 적용하지 않는다. 확인되지 않은 카드 계약, 등록 응답 손실 복구, 키 회전, 진행 중 해지 결과를 가짜 성공으로 접는 구현은 허용하지 않는다.
