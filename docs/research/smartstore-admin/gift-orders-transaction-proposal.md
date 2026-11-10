# 선물 주문: 수락·결제·배송 주소와 권한 설계

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14. **수락·주소 입력 후 결제하는 기본안을 구현하고 격리 DB·실제 로컬 앱에서 검증했다. 승인된 선물 SQL 6개는 전용 로컬 OWN/FRESH/CANON에 적용했으며 공개 gate는 기본 OFF다.** 운영 배포·외부 PG·메일 발송은 하지 않았다. 공통 주문 생성은 [GoodsTransaction 계약](goods-transaction-module-proposal.md), 금액은 [할인·배송 계약](discounts-shipping-transaction-proposal.md)을 따른다. 원본 서비스에서 확인한 동작을 옮긴 문서가 아니라 ICONS의 계약이다.

기본안은 **보낸 사람이 상품을 고정해 링크를 전달 → 받는 사람이 로그인·수락·주소 입력 → 보낸 사람이 최신 견적을 확인하고 결제**다. 사용자가 “수락·주소 입력 후 구매자가 결제”를 명시적으로 확정했으며 이를 구현 기준으로 승인받았다. 이후 사용자의 명시적 변경 요청이 오면 새 계약을 검토한다. 선물 한 건은 주문 한 건이며 일반 구매와 한 주문에 섞지 않는다. 선물·현재 카트·정기배송은 서로의 선택·쿠폰을 임시로 교체하지 않는다.

## 설계 착수 당시 확인한 연결 지점

| 현재 근거 | 확인한 동작 | 선물에 필요한 변경 |
| --- | --- | --- |
| [checkout loader](../../../lib/checkout.server.ts), [주문 loader](../../../lib/orders.server.ts) | 최근 주소·결제 대기·주문 상세에서 본인 `orders.address`를 직접 읽는다. 주문 소유자는 결제자 한 명이다. | 선물 결제자 DTO는 주소 대신 수락·배송지 준비 상태를 반환한다. 받은 선물 조회는 별도 권한이며 결제자 ID로 로그인한 척하지 않는다. |
| 현재 ACL/RLS (`output/gift-order-design-20261014/current-order-access.json`) | `orders_self_read`는 본인 또는 `sales.read`, 품목·배송 건도 주문 소유자 또는 해당 운영 권한을 읽기 대상으로 삼는다. 구매자는 직접 Data API로 전체 주문/배송 행을 읽을 수 있다. | 화면에서 주소를 감추는 것만으로는 보호되지 않는다. 선물 행의 직접 읽기 또는 모든 민감 필드 저장 위치까지 함께 바꿔야 한다. 비선물 RLS·주소 계약은 유지한다. |
| [지역 배송 모델](../../../lib/shipping-regions.ts), [배송 SELECT](../../../lib/orders/shipments.ts), 현재 생성 함수 (`output/gift-order-design-20261014/current-order-dependencies.json`) | `orders.shipping_fee_breakdown`을 `order_shipments.shipping_fee_snapshot`으로 복제한다. `destinationPostalCode`, `matchedAddressPrefix`, `regionLabel`, 정책/규칙 ID가 포함된다. | `orders.address=null`만 적용하면 주소 추정 정보가 남는다. 원본 지역 근거도 private에 두고 고객용 금액 projection과 구분한다. |
| [관리자 주문](../../../lib/admin/orders.server.ts), [내보내기 contacts](../../../lib/admin/list-export-data.server.ts), [창고 양식](../../../lib/admin/warehouse-templates.server.ts) | 목록·상세·주문/클레임 파일과 출고 데이터가 현재 주문 주소를 소비한다. 창고 양식에는 주소·연락처·품목 단가도 있다. | 운영 주소 getter를 한 소유 모듈로 전환하고 출고 파일에 선물 여부를 전달한다. 판매자가 받는 단가와 수신자용 포장 명세를 구별한다. 외부 창고의 가격표 제외 이행은 별도 확인 대상이다. |
| [주소 수정](../../../lib/admin/order-address.server.ts), 현재 주소/회수 함수 (`output/gift-order-design-20261014/current-function-address-surface.json`) | 주소 변경은 주문 revision·출고/클레임 상태·현재 지역 운임을 검사한다. 판매자 반품 접수는 수거 주소를 별도로 보관한다. | 선물 주소 revision과 실제 수신자의 변경/동의 근거를 사용한다. 배송지·수거지는 서로 다른 private 기록이다. |
| [고객 클레임 API](../../../app/api/orders/[orderId]/claims/route.ts), 현재 클레임 함수 (`output/gift-order-design-20261014/current-order-dependencies.json`) | API와 `request_order_claim`은 `orders.user_id=p_user_id`를 요구한다. `requested_by`도 그 사용자로 기록한다. 전 주문 취소/반품·교환, 출고지별 회수와 원결제 환급을 사용한다. | 수신자 접수를 위해 `p_user_id=sender`로 대리 호출하면 행위자 기록이 틀어진다. 실제 actor·원결제자·수신자 권한을 분리한 내부 클레임 Interface가 필요하다. |
| [거래 메일](../../../lib/email/transactional.server.ts), [출고 큐](../../../lib/email/order-shipment-jobs.server.ts), [지연 큐](../../../lib/email/order-delay-jobs.server.ts) | 거래 메일은 주문자의 이메일과 주문 주소를 함께 읽는다. 출고 큐와 지연 안내는 서로 다른 durable 작업이다. | 구매자/수신자용 DTO·본문·멱등 키를 구별한다. 기존 메일 문맥을 수신자에게 그대로 보내지 않는다. 이번 작업에서는 외부 메일/SMS를 보내지 않는다. |
| 탈퇴 관련 현재 함수 (`output/gift-order-design-20261014/current-function-address-surface.json`), [PRD](../../PRD.md) | 진행 의무와 법정 기록 스냅샷의 주문 연결은 `orders.user_id` 중심이다. Phase 1은 기본 OFF이고 완전 삭제까지 구현됐다는 근거는 없다. | 보낸 사람과 수신자 양쪽의 선물 의무·private PII 삭제/보존 경계를 추가한다. 현재 구현에 없는 자동 삭제를 이미 제공한다고 표현하지 않는다. |

위 표는 구현 착수 전의 함수 정의·정책을 기록한 기준선이다. 현재 구현과 검증 범위는 문서 끝의 구현 현황에서 구분한다.

## 결제 시점과 초기 범위

| 방식 | 장점 | 추가로 필요한 계약 | 판단 |
| --- | --- | --- | --- |
| 수락·주소 입력 후 보낸 사람 결제 | 실제 목적지로 운임·판매 가능 여부를 계산하고 기존 주문/승인/환급 흐름을 사용한다. 거절·초대 만료 시 결제나 환급이 없다. | 수락 후 보낸 사람의 결제가 남았다는 상태와 재고/가격 변동 안내 | **사용자 확정: 수락·주소 입력 후 구매자 결제** |
| 보낸 사람이 먼저 결제 | 링크를 받은 시점에 결제가 끝난 선물로 표현할 수 있다. | 미정 주소의 운임 부담·배송 불가 지역·상품 확보 기간·미수락 전체 환급·paid 주문의 배송 대기·만료 worker와 결제 복구 | 사용자 선택 시 별도 설계 확장. 가짜 우편번호나 배송비 0원으로 해결하지 않는다. |

초기 선물은 **배송비 선결제**를 기본으로 한다. 수신자에게 착불을 부담시키려면 정확한 `D`·수납 주체·수납 방법을 수락 내용에 결속하고, 변경 후 다시 동의를 받아야 한다. 이 계약이 준비되지 않은 착불 조합은 결제를 차단한다. 일반 주문의 착불 지원을 이유로 선물 수신자가 동의했다고 간주하지 않는다.

상품/옵션·수량·직접입력은 생성 당시 고정한다. 선물 링크 발급과 수락은 재고·쿠폰·적립금 예약이 아니다. 실제 주문 생성 시 현재 공개/판매기간·옵션·구매 제한·공급·출고지·지역·결제 허용을 재검사한다. 사용 중인 상품별 결제수단 제한과 provider 파생 규칙을 그대로 적용한다. 카드 외 수단을 허용하는 경우 기존 만료·대사·원결제자 환급계좌 계약까지 연결해야 한다.

초대의 기본 유효기간은 생성 후 7일이다. 수락 후 결제 준비도 원래 초대 기한 안에서만 가능하고, 견적은 공통 계약의 최대 10분이다. 주문이 생성되면 초대 만료 대신 주문의 실제 `expires_at`과 결제 상태를 따른다. 현재 일반 주문은 카드 15분·무통장 24시간이지만 새 creator의 잠금 후 기준시각과 만료 계산을 검증해야 한다. 이 숫자는 ICONS의 현재 코드이며 외부 서비스의 보장값이 아니다.

## 원장과 Interface

`GiftOrders` 모듈은 초대·수락자·비공개 주소·선물과 주문의 결속을 소유한다. 상품 금액·배송 산식·재고·승인은 공통 모듈과 기존 결제 모듈이 소유한다.

| private 원장 | 담는 정보 | 변경 규칙 |
| --- | --- | --- |
| `gift_intents` | 선물 ID, sender ID, 상태, revision, 안전한 메시지, 초대 기한, recipient ID, 주문 ID | 선택은 불변. 바꾸려면 이전 초대를 취소하고 새 선물을 만든다. 주문 ID는 한 번만 결속한다. |
| `gift_items` | 상품/옵션·수량·직접입력과 표시 snapshot | 선택은 불변이고 상품 식별자 FK 변경만 반영한다. 공통 견적 source는 현재 선택 식별자의 fingerprint도 포함한다. |
| `gift_link_tokens` | 선물 ID, 무작위 토큰의 hash, generation, 만료/폐기/소비 시각 | 원문을 저장하지 않는다. 재발급은 이전 generation과 그 수신 세션을 폐기한다. 수락 후 다른 사람에게 재발급하지 않는다. |
| `gift_intents`의 수락 상태와 `gift_operations` | 실제 recipient ID·수락 시각, 실제 actor·요청 hash·원 operation revision | 명시적 수락/거절에서만 귀속한다. 불변 영수증과 현재 선물 상태를 구분하며 링크 GET·로그인·미리보기로 수락하지 않는다. |
| `gift_recipient_addresses` | 수신자가 입력한 배송 주소와 revision, 입력 주체·변경 시각 | 수신자와 허용된 운영자만 읽는다. 미결제 주소 변경은 견적을 무효화한다. |
| `order_delivery_private_snapshots` | 선물 주문의 실제 주소, 지역 판정/운임 원본, acceptance/address revision, 주문/배송 건 결속 | 주문 생성 트랜잭션에서 보존한다. 변경은 배송 주소 모듈의 CAS·운임·출고 검사로만 수행한다. |
| 기존 source/quote receipt | 공통 `source`, 선택/주소 revision, quote ID, checkout key, 원주문 ID | 성공 후 같은 요청은 원결과를 재생한다. 주소 삭제 후에도 원문을 다시 요구하지 않는다. |

직접 테이블 접근은 `public, anon, authenticated, service_role` 모두 봉인한다. 공개 함수는 생성 후 execute를 네 롤에서 회수하고 인증 사용자의 실제 작업 또는 서버 작업에 필요한 권한만 부여한다. 신규 운영 RPC는 기존 capability 계약에 등록한다. private 저장소라는 사실만으로 공개 SECURITY DEFINER wrapper의 권한 검사를 생략하지 않는다.

```text
createGift(selection, message, operationId) -> senderGift
issueGiftLink(giftId, expectedRevision, token, operationId) -> generation, expiresAt
readGiftInvitation(claimSession) -> safeInvitation
respondGift(claimSession, accept|decline, address?, expectedRevision, operationId)
  -> recipientGift
updateGiftAddress(giftId, address, expectedGiftRevision, operationId)
closeGift(giftId, expectedGiftRevision, operationId) // sender 취소 또는 recipient 수락 철회
quoteGift(giftId, couponChoice, creditChoice, deliveryChoices) -> common quoted|blocked
placeGift(giftId, quoteId, checkoutKey, paymentMethod) -> orderId, safeReceipt
readSentGift(giftId) / readReceivedGift(giftId) -> role-specific DTO
```

Action은 `auth.getUser()`의 실제 actor를 결속한다. DB adapter는 source를 서버 원장에서 읽어 검증한다. 브라우저가 전송한 sender/recipient ID, 주소 소유자, source revision을 권한 근거로 사용하지 않는다.

공통 Interface는 다음과 같이 연결한다. 수신자 주소와 source revision은 서버 안에서만 전달하며 public 견적에는 노출하지 않는다.

```text
source = {kind:'gift', id:giftId, revision:canonicalGiftRevision}
selection = [{goodId, variantId, qty, inputRevision, inputValues}]

private.lock_goods_transaction_source(senderId, source)
private.quote_goods_transaction(senderId, source, selection, address,
  deliveryChoices, senderUserCouponId, senderStoreCreditAmount)
private.place_goods_transaction(senderId, source, selection, address,
  quoteId, checkoutKey, paymentMethod)
```

여기서 `senderId`는 공통 금액/혜택 모듈의 **결제자**다. 선물의 모든 adapter가 actor를 sender로 바꾸라는 뜻이 아니다. 수락·주소 변경·반품 접수는 실제 recipient actor를 별도로 검증·기록하며, 결제자 ID는 gift 원장에서 읽는다.

## 상태와 동시 처리

| 상태 | 허용되는 동작 | 금전/재고 |
| --- | --- | --- |
| `awaiting_acceptance` | 로그인한 링크 소지자 한 명의 명시적 수락/거절, sender 취소·링크 재발급 | 예약 없음 |
| `accepted` | recipient 주소 수정·수락 철회, sender 최신 견적·결제 준비·취소 | 견적만으로 예약하지 않음 |
| `ordered` + 주문 `pending` | 기존 주문의 결제/만료/취소·조회/복구 | 주문 생성으로 기존 예약 계약 시작. 초대 수락 철회로 주문을 지우지 않음 |
| `ordered` | 실제 주문의 배송·취소·반품·교환·환급 조회 | provider 증거/기존 finalizer와 주문 원장이 진실원 |
| `declined`, `expired`, `canceled` | 안전한 상태 조회, 새 선물 만들기 | 새 주문/수락 금지 |

`ordered`가 곧 `paid`, `delivered`, `refunded`라는 뜻은 아니다. 화면은 실제 주문·attempt 상태를 함께 표시한다. 모호한 결제는 실패나 미주문으로 바꾸지 않고 원래 attempt를 조회한다. 실패·만료된 pending 주문이 있는 선물에 두 번째 주문을 결속하지 않는다. 새 시도는 사용자에게 종료 상태를 확인시킨 뒤 새 선물 ID로 생성한다.

수락 철회는 주문이 생성되기 전까지만 가능하다. 철회는 acceptance·주소·미사용 견적을 폐기하고 해당 선물을 종료한다. 수신자를 해제해 링크를 다른 사람에게 재사용하지 않는다. 주문이 생긴 후에는 선물 상태의 단순 전환으로 예약을 취소하지 않고 실제 주문 취소 경로를 이용한다.

모든 writer는 실제 actor의 현재 자격, 정지/탈퇴 fence, operation ID와 canonical 요청, expected revision을 검사한다. 계정 정지는 새 선물/수락/결제를 막되 기존 주문 조회·반품/환급·개인정보 회복 경로까지 일괄 차단하지 않는다. 계정 전환 후 늦게 도착한 조회/업로드/저장 결과는 폐기한다. 충돌은 입력을 유지하고 최신 저장본을 명시적으로 불러온다. 결과 불명은 원요청/동일 UUID로만 확인한다.

잠금은 관계자의 UUID 순서로 공통 actor advisory → 계정 action advisory·profile → gift source advisory → gift/주소 행 → 공통 checkout key/견적 → 정렬된 상품/옵션/공급·출고지/운임·쿠폰/적립금 순서를 사용한다. recipient 작업도 원장의 sender와 현재 recipient를 읽은 뒤 같은 helper를 먼저 호출하며 gift 행 뒤에서 actor 잠금을 얻지 않는다. 기다리는 동안 수신자가 새로 결속되면 잠금 대상 전체를 다시 읽는 충돌 응답으로 종료한다. 주문 결속 후 클레임/출고는 기존 order → shipments → attempts/payment 순서를 보존하며, 주문 행을 잠근 상태에서 역으로 gift source 잠금을 획득하는 새 경로를 만들지 않는다.

## 링크와 로그인

- 토큰은 32바이트 이상의 암호학적 난수다. DB·감사·오류·분석 이벤트에는 hash/generation만 저장한다. 공개 PII hash나 순차 ID를 초대 권한으로 쓰지 않는다.
- 링크는 `/gifts/receive#token=...`처럼 토큰을 fragment에 두고 페이지 시작 시 지운다. same-origin POST로 짧은 수신 세션을 만들고 로그인 이동에는 원문 토큰을 넣지 않는다. 서버 세션은 임의 ID의 HttpOnly/SameSite 쿠키와 만료를 가지며 `no-store`, `no-referrer`를 사용한다. 제3자 분석/이미지 요청에 토큰을 전달하지 않는다.
- 발급 시 브라우저가 안전한 난수를 만들고 확인 전까지 메모리에 보관하는 안을 사용하면, 원문을 DB에 저장하지 않고도 동일 operation/token 요청을 재시도할 수 있다. 새로고침 등으로 원문을 잃으면 이전 발급의 결과를 확인한 뒤 명시적 새 generation으로 재발급한다. 재시도를 새로운 링크 발급으로 숨기지 않는다.
- 공유 링크 소지자가 수신 대상이다. 특정 전화번호/이메일 소유자 검증을 제공하지 않으므로 그런 보장을 표시하지 않는다. 수락 화면은 현재 로그인 계정을 명시하며 최종 POST에서 그 계정에 한 번 귀속한다. 두 계정의 동시 수락은 하나만 성공한다. 다른 계정에는 기존 수신자의 신원·주소를 보여주지 않는다.
- 링크 복사만 제공한다. 외부 메일·SMS·메신저 발송, 연락처 업로드, 사용자 대신 전송은 실행하지 않는다. 클릭/프리뷰 봇은 토큰을 소비하지 않는다. 복사 성공은 전달·수락 성공과 구별한다.

## 배송 주소의 소유권과 직접 조회 대안

**권고:** 선물 실주소/지역 근거는 private 배송 모듈이 소유하고, 생성 시부터 public 주소에는 null만 쓴다. 비선물의 주소와 RLS 계약은 유지한다. 선물에는 역할별 DTO를 사용하며, 직접 Data API로 DTO를 우회할 수 없도록 선물 행만 좁혀야 한다.

| 대안 | 효과 | 비용/위험 | 판단 |
| --- | --- | --- | --- |
| 전체 주문 SELECT 권한을 회수하고 모든 주문을 새 RPC로 전환 | 전 주문의 출력 Interface를 단일화 | 기존 주문/결제/운영 독자의 광범위한 회귀 | 이번 선물 변경에는 권고하지 않음 |
| 기존 SELECT를 유지하고 gift의 `orders.address`만 null | 기존 비선물 영향이 작음 | `shipping_fee_breakdown`, shipment 지역 snapshot·raw 운송장·후속 메모를 통해 주소/배송 정보가 남음 | **단독으로 불충분** |
| gift의 public 민감 필드를 모두 안전 projection으로 저장 | 선물 행의 직접 SELECT에서도 제한된 정보만 보임 | 모든 새 필드·writer가 mask 규칙을 지켜야 함. raw tracking/지역 snapshot의 기존 reader도 private로 이관 필요 | 가능하지만 지속적인 필드 누락 위험을 검증해야 함 |
| **gift 행만 구매자/수신자 직접 SELECT에서 제외 + private 배송 원본 + 역할별 DTO** | 비선물 정책을 유지하면서 새 필드가 생겨도 선물 고객의 직접 조회 우회를 막음 | gift를 제외하는 RLS helper와 모든 gift 화면/후속 API의 DTO 전환 필요 | **우선 권고**. 운영 capability 경로는 기존 범위를 보존하고 실제 주소는 owner helper로 읽음 |
| 기존 creator가 raw 값을 쓴 뒤 같은 트랜잭션에서 private 이동/public redact | 새 creator와의 일시적 호환이 가능. 중간 커밋이 없으면 외부 SELECT가 중간 행을 읽지는 못함 | 트리거·감사·알림·견적/배송 복제·리턴 영수증에 raw 값이 남을 수 있음 | 생성 시 직접 분리보다 열등한 호환안. 전수 readback/호출 그래프 검증 전 채택하지 않음 |

RLS를 좁힐 경우 `orders`만 바꾸고 끝내지 않는다. 현재 품목·배송 policy의 주문 subquery, 계산 컬럼/공개 wrapper, 주문 클레임·회수·review 대상·inquiry 연결까지 직접 접근 행렬을 검사한다. sender에게 금액·결제·원쿠폰·적립금은 허용되지만 recipient에게 이를 얻는 권한을 추가하지 않는다. recipient는 본인 배송지와 배송에 필요한 정보를 받고 원결제 수단·환불계좌·원쿠폰·카드팩/적립금 내역은 받지 않는다.

운송장 원문과 외부 택배 조회 URL도 수신지 추정의 단서가 될 수 있다. sender DTO는 배송 준비/배송 중/완료 상태와 필요한 시각만 주고, raw 운송장/주소 기반 지역명은 recipient 및 허용 운영자에게만 제공하는 것을 기본으로 한다. 실제 수신자명은 배송 주소의 일부이며 sender가 확인한 별도 표시 이름과 혼동하지 않는다.

owner Interface는 다음 이름으로 제안한다. **모두 내부 봉인 함수**이고 외부 RPC는 실제 actor·목적을 검사한 뒤 필요한 필드만 반환한다.

```text
private.order_delivery_snapshot(orderId)
  -> {address, addressRevision, shipments:[{shipmentId, regionalEvidence}]}
  // gift는 private 원본, 비선물은 기존 orders/shipments에서 읽는 호환 adapter

private.bind_goods_transaction_delivery_snapshot(orderId, senderId, source, address, shippingEvidence)
  -> void
  // 실제 source/수락/주소 revision을 확인해 주문과 같은 transaction에서 결속
```

주소 입력 검증, 이후 운임 재검사, 영수증 재생은 public의 null/요약 주소로 하지 않는다. `checkoutKey` 재생은 private source receipt를 먼저 확인하고, 이미 성공한 견적의 개인정보 보존 기한이 지났다고 원주문을 다시 만들지 않는다. 가격·재고·공급 snapshot의 검증도 private 원본과 당시 금액 버전을 사용한다.

### 반드시 전환할 읽기·쓰기 표면

| 표면 | 선물 처리 |
| --- | --- |
| 최근 주소 자동완성 | 보낸 선물의 주소를 구매자 최근 주소에 넣지 않는다. 수신자 주소 재사용은 본인이 명시적으로 선택한 경우에만 별도 허용한다. |
| 결제 대기/주문 목록·상세·성공/실패 복귀 | sender 전용 안전 주문 DTO를 사용한다. `address=null`을 오류·미입력으로 표시하거나 결제를 다시 만들지 않는다. |
| received 선물 상세 | 원결제 금액/증빙 없이 상품·수량·직접입력의 수령에 필요한 내용, 본인 주소·배송/클레임 상태를 반환한다. |
| 관리자 주문/품목/미결제/발주·배송 검색 | 권한별 기존 업무 범위를 유지하고 수취인 검색/정렬·총건수도 owner getter를 사용한다. 주소가 null인 선물을 검색에서 잃지 않는다. |
| 발주서·거래확정·일반 주문/클레임 XLSX | 같은 getter를 사용한다. 일반 거래 보고와 배송 실행에 필요한 PII를 구별하고 파일 생성 감사·출고지 범위·행 완전성·문자열 셀 보호를 유지한다. |
| 배송지 수정 | 실제 recipient의 동의/요청과 revision을 검사한다. 발주/출고 이력·열린 클레임·운임 변경을 기존처럼 차단한다. sender는 수신자 주소를 입력/변경하지 않는다. |
| 회수/교환 | 수거지·교환 목적지를 private에 별도로 보존한다. 창고 반송 주소는 수신자의 실주소와 다른 필드다. 기존 전체 출고지 회수/재고/재출고 원장을 유지한다. |
| 메일·인앱 알림 | sender와 recipient의 문맥·링크·멱등 키를 구별한다. sender 메일에서 주소·운송장을 누출하지 않고 recipient 메일에서 금액·결제 증빙을 누출하지 않는다. 기존 전송 gate를 자동 활성화하지 않는다. |
| 감사·운영 alert·에러·메일 작업 snapshot | ID·작업 주체·필드명/버전과 최소 상태만 저장한다. raw 주소·전화·토큰을 공개 audit diff에 넣지 않는다. 필요한 전후 주소는 private 변경 이력에 둔다. |
| 탈퇴·보존/파기 | 양쪽 역할의 진행 중 의무를 판정하고 실제 발송/회수/환급 근거를 보존한다. 미주문 만료 선물의 주소/수신 세션은 제거하고 공개된 토큰을 다시 살리지 않는다. |

이미 존재하는 창고 양식으로 파일을 만들었다고 수신자에게 가격표가 전달되지 않는다고 보장할 수 없다. 출고 파일의 선물 표시/포장 요청과 실제 창고 이행 확인을 운영 준비 항목으로 분리한다.

## 수신자의 배송·취소·반품 권한

| 작업 | 보낸 사람/결제자 | 수신자 | 운영자 |
| --- | --- | --- | --- |
| 수락 전 선물 취소·링크 재발급 | 본인 선물만 | 불가 | 고객 요청에 따른 범위만 별도 audited 처리 |
| 수락/거절 | 링크 소지자로서 실제 본인 계정에 수락하는 경우만; 다른 계정 대리 수락 불가 | 명시적 동작에서 본인 귀속 | 임의 대리 수락 불가 |
| 수락 후 주문 전 주소 변경·수락 철회 | 수신자 주소 수정 불가, 선물 취소 가능 | 본인만, source CAS·견적 폐기 | 실제 수신자 동의와 사유 필요 |
| 결제 준비/결제/환불계좌 | 원결제자만 | 불가 | 기존 판매관리·결제 복구 권한 |
| 주문 후 발송 전 배송지 변경 | 수신자에게 변경 요청만 | 허용 상태에서 본인 요청. 기지 운임을 바꾸는 지역 이동은 거절/새 주문 검토 | 기존 주소 변경 게이트 + recipient 동의 근거 |
| 직접 주문 취소 | 기존 전체 주문 취소 자격 적용 | 결제 취소를 대신 확정하지 않음. 수령 거절/취소 요청은 기록해 운영 검토 | 현재 전체 주문/전액 계약으로 처리 |
| 배송 후 반품·교환 접수 | 기존 자격 유지. 수거지 입력은 수신자 확인 필요 | **허용 권고**. 본인에게 결속된 선물 전체, 기존 배송완료/신청 자격을 사용 | 실제 접수자/의사표시 시각·수거 근거 보존 |
| 접수 철회 | 본인이 낸 요청만, 기존 진행 단계 내 | 본인이 낸 요청만, 기존 진행 단계 내 | 고객 합의 근거가 있는 audited 처리 |
| 전체 환급·쿠폰/적립금 복원 | 원결제 수단·원결제자에게만 | 현금·적립금·쿠폰을 받지 않음 | 기존 provider 증거·원장·멱등 finalizer 사용 |
| 구매 혜택·리뷰 자격 | 기존 구매자 기준 유지 | 받은 선물이라는 이유로 중복 혜택/구매 리뷰 권한을 자동 부여하지 않음 | 별도 제품 변경 없이는 이전하지 않음 |

recipient 클레임은 `private.request_goods_order_claim(actualActor, orderId, verifiedParty, request)` 같은 내부 Interface로 권한과 금전 소유자를 분리한다. `verifiedParty`는 DB가 현재 gift/order 연결에서 도출한다. 기존 구매자용 API도 이 Interface로 위임하되 종전 자격을 유지한다. 실제 actor를 audit와 새 private 선물 클레임 당사자 원장에 기록한다. 현재 환급 finalizer는 `request.requested_by=orders.user_id`를 검증하므로 이 기존 필드는 금전 소유자인 payer 의미로 유지하고, 요청 작성자·철회 권한은 새 actual requester로 판정한다. 환급/쿠폰/적립금 owner는 `orders.user_id`로 유지한다. `auth.uid()`를 sender로 바꾸거나 service wrapper에 sender ID를 넣어 recipient 요청을 위장하지 않는다.

수신자의 반품 접수에는 환불계좌를 받지 않는다. 무통장 또는 카드 취소 실패로 계좌가 필요한 경우 원결제자만 별도 제출하며, 미제출은 **계좌 확인 필요**로 남긴다. 접수 시각과 회수 근거는 계속 보존하고 recipient 계좌로 대체하지 않는다. 교환은 원래대로 환불계좌를 저장하지 않는다. 부분 수량·부분 금액·일부 출고지 환급은 추가하지 않는다.

직접 버튼이 닫힌 상태에서도 수신자의 고객지원 의사표시·실제 접수 시각을 보존한다. 선물 기능의 UI 상태를 권리 판단의 새로운 근거로 삼지 않고 기존 클레임 모듈의 자격 판정과 운영 절차를 사용한다.

## 계정 삭제와 정보 보존

- sender가 미주문 선물을 취소하거나 탈퇴 절차에 들어가면 새 수락/결제를 막고 열린 링크·견적을 폐기한다. recipient가 주문 전 철회/탈퇴하면 해당 수락과 주소를 제거하고 선물을 종료한다.
- 주문 생성 이후에는 sender와 recipient의 진행 중 배송·교환·회수 의무를 모두 확인한다. sender의 미확정 결제/환급, recipient의 배송/회수 의무를 같은 종류로 섞지 않는다. 이미 발생한 결제 증거 저장·환급 복구는 계정 정지로 사라지면 안 된다.
- 현재 법정 스냅샷의 보존 목적·기간을 별도 검토 없이 새 초대/수신 주소에 복제하지 않는다. 미주문 만료 주소와 수신 세션은 짧게 정리하고, 거래/배송 원본은 기존 승인된 보존 절차에 맞춰 최소한만 유지한다. 정확한 기간과 phase별 파기는 운영 계약 확인 후 활성화한다.
- FK cascade로 결제/배송 증거가 먼저 사라지거나 토큰 재사용이 가능해지지 않도록 한다. 파기 후에도 비식별 source/operation receipt로 중복 주문·환급을 방지할 수 있어야 한다. 운영 백업/restore replay는 기존 탈퇴 후속 범위를 함께 따른다.

## 구현·검증 순서

1. 결제 시점 답변을 반영하고 주소/RLS 대안 중 최종안을 확정한다. 새 공통 creator의 함수·트리거 호출 그래프를 추출한다. source 선택, 금액, 주소 보존 모듈의 책임을 고정한다.
2. 새 격리 clone에서 원장·token/session·CAS/operation·읽기 DTO를 만들고 주소/지역/운송장 누출을 먼저 검증한다. 공개 gate는 OFF이며 실제 사용 가능한 것으로 표시하지 않는다.
3. 상품 선택 → 링크 복사 → 다른 계정 수락/주소 → sender 확정 견적/주문 → Fake provider 확정/모호 결과 복구를 연결한다. 일반 카트·coupon 선택은 전후 동일한지 확인한다.
4. 관리자 주문/출고·주소 수정·파일·클레임/회수·알림·계정 삭제 reader를 owner getter로 전환하고 일반 주문 회귀를 실행한다. null 주소로 파일을 만들거나 근거 없는 무료배송을 표시하는 fallback은 금지한다.
5. exact migration SHA의 기능·ACL/RLS·실제 두 세션 경합·금전 독립 oracle 검증 후에만 로컬 named DB 적용을 별도로 검토한다. 적용된 SQL은 수정하지 않는다. 원격 DB·실 PG·운송사 거래는 이 검증에 포함하지 않는다.

필수 검증은 다음과 같다.

- **PII:** anon/무관한 회원/sender/recipient/현재 운영 capability 각각으로 직접 REST의 `select=*`, 중첩 품목/배송 join, 계산 컬럼/RPC, 정상·실패·오래된 operation 영수증을 검사한다. 실제 주소·우편번호·지역 규칙·운송장·token canary가 허용되지 않은 DTO, HTML/RSC, 메일, audit, 로그, URL, 파일에 없는지 전수 검색한다. 화면 숨김만 검사하지 않는다.
- **재생/경합:** 두 계정 동시 수락, 수락 대 재발급/거절/만료, 주소 변경 대 quote/place, sender 취소 대 place, 모호 결제 대 취소, 클레임 접수 대 출고/철회, 계정 변경 대 응답 도착을 실제 두 세션으로 검사한다. 잠금 대기 중 quote 만료도 포함한다.
- **금전/공급:** 당시 S/V/C/R/H/D와 T, 상품별 할인 배분, 배송 건별 snapshot, 공급 reservation, payer 쿠폰/적립금 lot를 독립 계산과 대조한다. receiver에게 refund·원쿠폰·적립금이 귀속되지 않는지 확인한다. 동일 key 재시도는 주문/예약/환급 하나다.
- **운영:** 여러 출고지의 전체 회수→전체 환급/교환, 미확정 계좌, 주소 변경으로 운임이 달라진 경우, 출고 후 주소 변경 거절, private 주소를 쓴 XLSX 재열기와 실제 원장 대조를 확인한다. 외부 창고 포장/PG 승인·실환급은 별도 미확인으로 남긴다.
- **기존 기능:** 비선물 주문의 직접 읽기·최근 주소·일반 checkout/승인·무통장·주문 만료·정기배송 source·배송·리뷰·탈퇴 Phase 1 테스트를 유지한다. 선물 추가를 이유로 기존 계정/권한 범위를 넓히지 않는다.

외부 발송과 운영 배포는 수행하지 않았다. 아래 로컬 검증 결과와 실제 배포·PG 승인·운송사 동작의 증거를 구분한다.

## 구현 현황과 운영 연결

- `20261014011000`은 선물 원장·해시 토큰/수신 세션·수락·주소·권한별 DTO를, `11100`은 공통 견적/주문 adapter와 구매자 안전 projection을 소유한다. 주소/운송장/지역 원본을 public 주문에 쓰지 않으며 원결과 재생은 만료·gate OFF·계정 정지 후에도 가능하다.
- `11200`은 운영 주소 getter와 주소 CAS를 소유한다. v2 배송지 재견적의 잠금은 상품→거래 설정→출고지 순서다. `11300`은 실제 청구자와 결제자 분리, 본인 요청 철회, 구매자 환불계좌 확인, 미주문 선물 주소·견적·수신 세션 정리를 소유한다. `requested_by`는 기존 환급 원장의 결제자로 유지하고 실제 접수자는 별도 private 원장과 audit actor로 남긴다.
- `/gifts`·`/gifts/new`·`/gifts/[giftId]`·`/gifts/receive/session`이 선물함·준비·상세·수락 화면이다. 링크는 `/gifts/receive#token=...`이며 bare 응답이 fragment를 먼저 제거하고 HttpOnly 수신 세션으로 전환한다. 저장소·analytics·일반 페이지 HTML에 원문 토큰을 보관하지 않는다.
- 수령인의 교환/반품은 배송 완료된 전체 주문에 기존 기한 판정을 적용한다. 실제 신청자만 철회한다. 환불계좌는 무통장 또는 카드 환급 `needs_review`에서 결제자가 확인하고, 수령인은 계좌나 금액을 받지 않는다. 안내 알림은 두 당사자에게 금액·주소 없는 선물함 링크로 기록한다.
- `/admin/sales/gifts`는 `sales.read` 권한의 선물 목록이다. 기본 상태는 수락 대기이며 전체 또는 수락 대기·수락 완료·주문 연결·거절·만료·취소를 조회한다. 미주문 선물은 조회문 시작 시각 `asOf`에 기한이 지났으면 만료로 분류한다. 선물번호·연결 주문번호·보낸/받는 닉네임·상품/옵션명으로 검색하고 50·100·200건씩 본다. 총건수와 현재 페이지를 같은 조회문에서 계산하며 수령인 이름은 닉네임만 반환한다. 배송지·연락처·선물 메시지·직접입력 내용·원문/해시 토큰·금액은 목록과 검색 대상에서 제외한다.
- 선물 Excel은 현재 검색 결과 전체를 최대 10,000건까지 비밀번호로 암호화한다. 현재 페이지의 200건만 잘라 내보내지 않으며 10,000건을 넘으면 파일 생성을 거절한다. private receipt에 동일 행과 fingerprint·`asOf`를 고정하고 10분 안에 실제 파일 SHA-256을 감사 기록에 결속한다. 파일 발급 직전에는 receipt 소유자와 현재 `sales.read` 권한을 다시 검사한다. receipt payload는 생성 24시간 후 정리하고 파일 발급 감사 기록은 보존한다. [`41322` migration](../../../supabase/migrations/20261020085356_gift_operations_console.sql)과 [내보내기 route](../../../app/api/admin/gifts/export/route.ts)가 이 계약을 구현한다.
- `/api/cron/gifts`는 인증된 서버 작업으로 만료 100건과 탈퇴 fence 대상 100건을 한 번에 제한하고, 24시간 지난 선물 export receipt를 최대 1,000건 정리한다. fence cleanup은 각 선물별 별도 RPC 트랜잭션이며 부분 성공을 유지하고 실패 시 503으로 재시도를 요청한다. 실제 배포 전에는 이 스케줄이 실행됐다고 간주하지 않는다.
- 격리 clone의 실제 공통 주문 생성·승인 증거 finalizer·개인정보 분리·청구/철회·계좌 권한·운영 알림과 11개 두 세션 및 1개 세 세션 경합을 통과했다. 선물 19,200원과 별도 일반 주문 13,000원 각각에서 반품 철회→재접수→전체 입고→원구매자 환급을 검증했으며, 과거 철회는 수거 검사에서 제외하고 현재 반품의 수거는 계속 강제한다. 금전 검증 (`output/gift-order-qa-20261014/syntax-financial-27/result.json`), 경합 검증 (`output/gift-order-qa-20261014/syntax-financial-26/concurrency/result.json`).
- `11000`~`11500` 6개 migration은 헤더 주석만 정리한 동일 본문으로 로컬 OWN 252 / FRESH 285 / CANON 320에 적용했다. 기존 함수 owner/ACL·정책·운영 데이터·이전 migration 원문을 보존하고 새 55개 함수·10개 private 테이블·4개 제한 정책을 승인 clone과 대조했다. 적용·보존 근거 (`output/gift-order-qa-20261014/named-gift/result.json`). CANON의 기존 `postgres` 소유 주소 변경 함수에 필요한 private 행 잠금·갱신은 후속 `32249`의 봉인 helper로 보완하고 전체 통합 검증을 통과했다. 기존 함수 owner나 적용된 6개 파일 본문은 바꾸지 않았다.
- 정식 회귀 진입점은 [`supabase/tests/gift_orders_isolated.sh`](../../../supabase/tests/gift_orders_isolated.sh)다. 전체 migration이 이미 적용된 로컬 컨테이너를 `GIFT_ORDER_TEST_SCOPE=isolated-local SUPABASE_DB_CONTAINER=<정확한 컨테이너 이름> bash supabase/tests/gift_orders_isolated.sh`로 지정한다. GitHub Actions는 `ci` scope와 `supabase_db_icons-ip`를 사용한다. 원본은 읽기 전용으로 clone하고, lease와 전체 컨테이너 ID를 검증한 clone에서 domain·금융/운영/환불·현재 권한/legacy 회귀·실제 12개 경합을 실행한다. migration 재적용은 하지 않는다. CANON 327에서 전체 PASS, 원본 전체 migration 원장 SHA 불변과 clone·dump·TOC 제거를 확인했다. 정식 wrapper 검증 (`output/gift-order-tests/426103a900da405ca00fd39352716b73/result.json`).
- 새 선물 목록·export SQL은 CANON 327의 owned clone에만 추가해 [전용 회귀](../../../supabase/tests/gift_operations_console.sql)와 기존 gift 전체 회귀·12개 경합을 통과했다. 207건의 두 페이지·전체 상태/검색, 지연 중 만료되는 `asOf` 경계, 4역할 ACL·권한 철회, 목록 전체와 receipt 행의 일치, 파일 hash 감사·10분 만료·24시간 payload 정리, 10,001건 거절과 정확히 10,000건 허용을 확인했다. 원본 전체 원장 SHA는 변하지 않았고 clone·dump·TOC를 제거했다. 이 SQL 시험의 파일 hash는 합성값이며 실제 XLSX 생성·브라우저 다운로드의 증거로 대신하지 않는다. 이 SQL 검증 당시에는 새 관리자 목록의 실제 브라우저 검증을 수행하지 않았다. 이후 관리자 PC/390px·검색/목록수 선택 (`output/goods-transaction-browser-qa-20261014/admin-ui-progress-result.json`)·안정된 PC 재캡처 (`output/goods-transaction-browser-qa-20261014/16-gifts-desktop-stable.png`)와 암호화 XLSX 다운로드·재열람·잘못된 암호 거부 (`output/goods-transaction-browser-qa-20261014/export-readback-result.json`)를 별도로 확인했다. 41322 clone 검증 (`output/gift-operations-console-qa-20261014/review-result.json`).
- 별도 로컬 앱 `4332`와 OWN에서 선물 생성/무통장 주문의 성공 응답 유실 후 동일 요청 복구, 실제 수신자 로그인·동의·주소 저장, 소모된 링크/제3자 차단, 결제자 REST/HTML/RSC 주소 비노출, 수신자 금액 비노출, 원장바구니 불변 및 390/1440px 화면을 확인했다. 외부 CDN 폰트는 차단하고 시스템 폰트로 검증했다. 브라우저 결과 (`output/gift-order-qa-20261014/actual-app/run-5/result.json`).
- 검증 종료 후 미입금 합성 주문 2건을 기존 취소 RPC로 취소하고 재고 100개를 복원했다. 은행 표시 설정과 `updated_at`, 공통/선물/개인정보 gate를 원본과 정확히 일치시켰다. 검증 계정의 로그인·세션·운영 권한·링크를 폐기하고 상품/IP 비공개·출고지 비활성 상태로 남겼다. 재고가 있는 상품의 archive 금지 및 원장/감사 보존 규칙은 유지했다. 정리 결과 (`output/gift-order-qa-20261014/actual-app/cleanup-result.json`).
