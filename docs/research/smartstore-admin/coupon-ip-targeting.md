# IP 쿠폰 (쿠폰 대상 'IP 선택')

2026-10-27 구현·격리 DB 검증. 10/14 실사용 QA 회의의 "IP별 쿠폰, 그 IP에서 5만·7만 원 이상" 요구(S22, D10 ①)를 쿠폰 대상 범위에 추가했다. 운영 DB 적용·배포는 하지 않았다.

## 계약

- 대상 범위에 `selected_ips`(어드민 표기 "선택한 IP")를 추가했다. 기존 전체·선택 상품·선택 카테고리와 배타적이며, `coupons.target_ip_ids`(IP ID 최대 100개)는 이 범위에서만 비어 있지 않다(`coupon_goods_scope_ready`).
- 판정은 **각 상품의 현재 `goods.ip_id`**다. 쿠폰 등록 뒤 그 IP에 새로 등록하거나 그 IP로 옮긴 상품도 자동으로 포함한다. 발급 시점의 상품 목록을 동결하지 않는다. 합산 원상품의 IP는 보지 않는다.
- 최소 주문 금액은 기존 계약대로 대상 소계(해당 IP 상품의 기간·복수구매 할인 후 소계)로 확인한다. 그래서 "이 IP에서 50,000원 이상"이 된다. 장바구니 전체 금액이 넘어도 IP 소계가 모자라면 `coupon_min_subtotal`이다.
- 보관한 IP는 새로 지정할 수 없다(`coupon_target_ip_unavailable`). 이미 지정된 IP가 나중에 보관되면 정의에 남지만 그 IP 상품은 판매되지 않는다. IP 검색(`admin_search_coupon_ips`)은 보관 IP를 제외한다.
- 대상 IP 변경은 조건 revision(`touch_coupon_terms_revision`)에 포함되고 `commerce.coupon.targeting_updated` 감사에 `targetIpIds` 전후를 남긴다. 완료 주문의 사용 스냅샷에는 `targetIpIds`가 남는다.
- 고객 쿠폰함·주문서는 "선택한 IP의 굿즈에만 사용"으로 안내하고, 브라우저의 장바구니 미리보기는 IP 쿠폰을 임의 계산하지 않는다(서버 견적만).

## 계산 경로

`private.coupon_good_matches(scope, goods, categories, ips, good)` 5인자 판정을 추가했다. 4인자 판정은 그대로이며 IP 범위를 모르면 대상 없음으로 보수적으로 처리한다. 다음 호출부만 4인자 → 5인자로 바꿨다(본문 전체 재정의가 아니라 기대 문자열 개수를 단언하는 치환 패치, `20261027150000_coupon_ip_targeting.sql`).

- `private.evaluate_coupon_target_lines_at`: legacy 주문서(운영 경로)·카트 쿠폰 견적·단일 쿠폰 평가. 스냅샷에 `targetIpIds` 추가.
- `private.calculate_goods_transaction_locked`: 거래 런타임 단일 쿠폰의 품목 배분(스냅샷 기준).
- `private.calculate_goods_transaction_combined_locked`: 거래 런타임 조합 쿠폰의 상품 배분·배송 묶음 범위(정의 기준).
- `private.touch_coupon_terms_revision`: revision 비교 열에 `target_ip_ids` 추가.

주문 생성·결제 확정 함수 본문은 재정의하지 않았다. 다른 변경이 위 함수의 쿠폰 호출 문자열을 바꾸면 이 migration이 적용 단계에서 실패해 조용한 누락을 막는다. 이 migration보다 늦은 타임스탬프로 위 함수를 원본에서 통째로 재정의하면 IP 판정이 빠지므로 병합 시 대조가 필요하다.

새 공개 RPC `admin_coupon_target_ips`·`admin_search_coupon_ips`·`admin_search_coupon_console_v4`는 `marketing.manage`를 검사하고 네 역할 execute를 봉인한 뒤 authenticated에만 열었다. 재정의·패치한 함수는 운영자 계약 레지스트리에 다시 등록했다.

## 검증

- `supabase/tests/coupon_ip_targeting.sql`: 빈 IP·없는 IP·보관 IP·잘못된 ID·다른 범위 잔여 IP 거절, 검색의 보관 IP 제외, v4 목록 읽기, 대상 IP 변경의 revision·감사, 범위 제약, 나중에 추가한 상품 자동 포함, legacy 평가(IP 소계 20,000원만 대상·10% 2,000원, 25,000원 최소금액은 장바구니 25,000원이어도 거절, 다른 IP만 담으면 `coupon_no_eligible_goods`), 거래 런타임 단일·조합 견적의 2,000원 할인과 IP 품목만의 배분, 권한 봉인.
- 기존 `coupon_category_targeting.sql`·`operator_capability_coverage.sql` 통과.

알려진 한계: 어드민 `거래확정 내역` 엑셀의 쿠폰 조건 해석(`lib/admin/settled-export.ts`)은 `all`·`selected_goods`만 허용한다. 카테고리 쿠폰과 같이 IP 쿠폰 주문도 그 해석을 확장해야 한다(품목별 쿠폰 배분 작업과 함께).
