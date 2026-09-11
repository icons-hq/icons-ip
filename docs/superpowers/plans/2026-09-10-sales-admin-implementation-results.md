# 영업팀 어드민 피드백 구현 결과

최종 갱신: 2026-09-11 KST
범위: #461~#496, 총 36개 항목

이 문서는 **35개 기능과 통합 검증 1건, 총 36개 항목의 로컬 구현·기술 검증 기록**이다. 2026-09-11 사용자가 권장안을 승인하여 Q12의 기본 문서 HTML과 Q11의 인앱 알림·주문 이메일을 구현했다. 같은 날 후속 요청으로 GitHub 반영·배포, 운영 설정·인수 준비, 로컬 DB 사고 영향 조사를 승인했다. 원격 반영과 최종 배포 검증은 [PR #499](https://github.com/icons-hq/icons-ip/pull/499)의 타임라인에서 추적하며, 아래 로컬 검증을 실제 운영팀 인수로 대체하지 않는다.

각 신규 opt-in 정책은 실제 수치·증빙이 없을 때 그 정책만 비활성 상태로 둔다. 미설정 값을 0원·무제한·무기한·모든 직원 허용으로 해석하지 않으며, 기존 일반 판매·배송·주문 경로 전체를 닫는 의미는 아니다. 브라우저에서 사용한 주문·주소·연락처·입금·출고지 값은 task-local 합성 QA용 `TEST-ONLY` 데이터다. 실제 결제, 재고 인수, 고객 발송, production DB 변경은 이 결과의 근거가 아니다.

## 구현·검증 매트릭스

표의 `구현 경로`는 핵심 경계만 적었다. SQL migration과 SQL smoke는 실제 공개 RPC/Server Action 경계를 통과하도록 구성했고, 단위 테스트는 입력 정규화·DTO·화면 상태를 보강한다.

| 이슈 | 상태 | 구현 경로 | 검증 | 남은 조건 |
|---|---|---|---|---|
| #461 쿠폰 저장 실패 후 입력 복구 | ✅ 구현 | `app/admin/coupon-actions.ts`, `lib/admin/form-state.ts`, `components/admin/sections/CouponSection.tsx` | `app/admin/coupon-actions.test.ts`, `lib/admin/coupons.test.ts`, `coupon-recovery.png` | 기술 잔여 없음. 배포 시 운영 데이터와 권한/audit read-back만 별도 기록 |
| #462 관리자 계정·로그아웃·비밀번호 확인 | ✅ 구현 | `components/admin/Header.tsx`, `components/screens/Login.tsx`, `app/login/actions.ts` | `app/login/actions.test.ts`, `components/screens/Login.test.tsx`, `admin-account.png` | 기술 잔여 없음. 배포·운영 인수 기록은 구현 완료와 별도 관리 |
| #463 상품 입력 순서·가격 명칭 | ✅ 구현 | `components/admin/sections/GoodSection.tsx`, `lib/admin/good-editor.ts`, `app/styles/wc-admin-surfaces.css` | GoodSection/Good editor 관련 Vitest, `goods-main.png`, `goods-options.png` | 기술 잔여 없음. 실제 상품 적용은 배포 후 운영 read-back 범위 |
| #464 이미지 규격·실제 크롭 안내 | ✅ 구현 | `components/admin/ArtworkCropGuide.tsx`, `components/admin/ArtworkUploadField.tsx`, `app/styles/wc-admin.css`, `app/styles/wc-catalog.css` | `goods-guide.png`, `goods-image-crops.png`, 전체 테스트 | 기술 잔여 없음. 실제 계약 자산 적용과 배포 read-back은 별도 |
| #465 쿠폰 검색·필터·페이지 | ✅ 구현 | `lib/admin/coupons.ts`, `lib/admin/coupons.server.ts`, `components/admin/sections/CouponSection.tsx`, `app/admin/(shell)/sales/coupons/page.tsx` | 쿠폰 도메인/server/page 테스트, `admin-coupon-search.json`, `coupon-page2.png` | 기술 잔여 없음. 배포 후 운영 데이터 read-back은 별도 |
| #466 수취인·주문·운송장 검색 | ✅ 구현 | `supabase/migrations/20260910062025_sales_order_search.sql`, `lib/admin/orders.ts`, `lib/admin/orders.server.ts`, `components/admin/sections/Orders.tsx` | `supabase/tests/admin_order_search.sql`, 84개 targeted tests, `order-tracking-search.png` | 기술 잔여 없음. 운영 데이터에서의 배포 read-back만 남음 |
| #467 목록 문맥을 유지하는 주문 상세 | ✅ 구현 | `app/admin/(shell)/sales/orders/[orderId]/page.tsx`, `components/admin/screens/OrderDetailScreen.tsx`, `components/admin/sections/Orders.tsx` | 주문 목록/상세 관련 103개 tests, `order-detail-new-tab.png` | 기술·브라우저 검증 완료. 배포/운영 인수 상태는 별도 추적 |
| #468 옵션 안전재고 기준·부족 경보 | ✅ 구현 | `supabase/migrations/20260910062200_sales_goods_operations.sql`, `app/admin/goods-variant-actions.ts`, `lib/admin/goods-variants.ts`, `components/admin/GoodsOptionEditor.tsx` | `supabase/tests/goods_variant_operations.sql`, 옵션 관련 Vitest, `option-stopped-stock-kept.png` | 구조 완료. 상품별 실제 기준값을 입력할 때 해당 opt-in 경보만 활성화 |
| #469 옵션 사용 중지·복원 | ✅ 구현 | `app/admin/goods-variant-actions.ts`, `lib/admin/goods-publish.ts`, `components/admin/GoodVariantsPanel.tsx`, `components/admin/GoodsOptionEditor.tsx` | 옵션 lifecycle SQL·동시성, `option-stale-error.png`, `option-stopped-stock-kept.png` | 구조·브라우저 검증 완료. 실제 상품 재고의 상태 변경은 배포 read-back 범위 |
| #470 영문 상품명·국내 배송대행지 | ✅ 구현 | `supabase/migrations/20260910063038_sales_goods_english_name.sql`, `lib/admin/catalog.ts`, `lib/admin/goods-workbook.ts`, `components/screens/GoodDetail.tsx` | `supabase/tests/goods_english_name.sql`, workbook round-trip tests, `goods-metadata.png` | 선택 영문명과 국내 배송대행지 안내 연결 완료. 해외 주소·외화 결제는 범위 밖 |
| #471 결제수단·연령 설정 연결 | ✅ 구현 | `supabase/migrations/20260910072933_sales_goods_purchase_policies.sql`, `lib/goods-sales.ts`, `app/admin/actions.ts`, `components/shop/GoodPurchasePanel.tsx`, `app/checkout/actions.ts` | `supabase/tests/goods_purchase_policies.sql`, purchase policy tests, `purchase-form-green.log` | 상품별 허용수단 교집합 구조 완료. 실제 허용값과 19금 성인인증·PG gate 증빙이 있을 때 해당 opt-in만 활성화 |
| #472 ERP 코드·품명·바코드 | ✅ 구현 | `supabase/migrations/20260910072843_sales_variant_external_identity.sql`, `app/admin/variant-external-identity-actions.ts`, `lib/admin/variant-external-identity.ts`, `lib/admin/goods-workbook.ts` | `supabase/tests/goods_variant_external_identity.sql`, ERP/workbook tests, `cold-erp-test.log` | 선택 ERP 식별자·주문 스냅샷 구조 완료. 실제 ERP 코드·품명은 운영 자료로 입력 |
| #473 IP 식별자·미사용 초안 정리 | ✅ 구현 | `supabase/migrations/20260910072807_sales_ip_public_slugs.sql`, `lib/ip-identity.ts`, `lib/ip-identity.server.ts`, `app/admin/ip-identity-actions.ts` | `supabase/tests/ip_public_slug_identity.sql`, IP identity tests, `cold-ip-identity-test.log` | 공개 별칭·재사용 차단·미사용 초안 정리 구조 완료. 기존 주문·링크 식별자를 보존 |
| #474 계층 카테고리·ERP 분류 | ✅ 구현 | `supabase/migrations/20260910080827_sales_category_hierarchy.sql`, `lib/catalog-categories.ts`, `components/admin/CategoryTree.tsx`, `components/admin/CategoryAssignmentField.tsx`, `app/admin/category-actions.ts` | `supabase/tests/sales_category_hierarchy.sql`, `sales_category_hierarchy_concurrency.sh`, category tests | 최대 4단계·대표 분류 1개 구조 완료. 실제 분류표와 ERP 매핑 자료는 입력 필요 |
| #475 매입단가·이력·조회 | ✅ 구현 | `supabase/migrations/20260910081641_sales_variant_purchase_cost.sql`, `lib/admin/goods-purchase-costs.ts`, `app/admin/goods-purchase-cost-actions.ts`, `components/admin/GoodsPurchaseCostsPanel.tsx` | `supabase/tests/goods_variant_purchase_cost.sql`, workbook tests, `browser-cost-saved.png` | 원 단위·세금 구분·관리자 전용 조회/수정·이력 구조 완료. 실제 매입단가만 운영 자료로 입력 |
| #476 기간 할인·옵션 할인율 | ✅ 구현 | `supabase/migrations/20260910072933_sales_goods_purchase_policies.sql`, `lib/admin/goods-price-periods.ts`, `app/admin/goods-price-period-actions.ts`, `components/admin/GoodsPricePeriodsPanel.tsx` | price-period Vitest와 `supabase/tests/goods_purchase_policies.sql`, `browser-price-period-active.png` | 기간·옵션 단일 판정 구조 완료. 실제 할인 기간·가격을 입력할 때 해당 정책만 활성화 |
| #477 KC 정보·공개·게시 검증 | ✅ 구현 | `supabase/migrations/20260910091552_sales_goods_kc_compliance.sql`, `lib/goods-kc.ts`, `lib/admin/goods-kc.ts`, `components/admin/GoodsKcPanel.tsx`, `lib/admin/goods-kc-workbook.ts` | `supabase/tests/goods_kc_compliance.sql`, KC workbook tests, `browser-kc-reviewed.png`, `browser-kc-public.png` | 상품 모델별 법적 분류와 실제 KC 서류·담당자·근거가 필요 |
| #478 상세 HTML 편집·미리보기·공개 | ✅ 구현·검증 | lib/goods-description.ts, GoodSection, GoodsDescription, 상품 엑셀 v3, 20260910235726 migration | HTML·이미지 소속 SQL, 저장/복사 동시성, 실제 업로드·공개·실패 복구·XLSX 왕복 | 기술 잔여 없음. 기본 문서 HTML 범위를 유지하고 실제 콘텐츠와 배포 인수는 별도 |
| #479 상품 전체 초안 복사 | ✅ 구현 | `supabase/migrations/20260910085008_sales_goods_clone.sql`, `lib/admin/good-clone.ts`, `app/admin/good-clone-actions.ts`, `components/admin/GoodClonePanel.tsx` | `supabase/tests/goods_clone.sql`, `goods_clone` concurrency, `cold-goods_clone-test.log` | 승인된 복사 범위 표 반영 완료. 새 상품은 초안·재고 0으로 저장 |
| #480 상품 검색 키워드 | ✅ 구현 | `supabase/migrations/20260910065342_sales_goods_discovery_metadata.sql`, `lib/search-goods.ts`, `lib/catalog.ts`, `lib/admin/catalog.ts`, `lib/admin/goods-workbook.ts` | `supabase/tests/goods_discovery_metadata.sql`, 240개 catalog/discovery tests, `catalog-discovery-result.md` | 기술·브라우저 검증 완료. 실제 검색어 입력과 배포 read-back은 별도 |
| #481 상품 진열 순서 | ✅ 구현 | `lib/shop-catalog.ts`, `lib/catalog.ts`, `app/shop/page.tsx`, `app/shop/best/page.tsx`, `app/shop/new/page.tsx` | catalog/shop tests, `catalog-discovery-result.md`, `goods-main.png` | 기술·브라우저 검증 완료. 기존 BEST/NEW 우선순위 보존 |
| #482 추가구성상품 선택→주문 | ✅ 구현 | `supabase/migrations/20260910085331_sales_additional_goods.sql`, `lib/admin/goods-additional.ts`, `app/admin/goods-additional-actions.ts`, `components/admin/GoodsAdditionalPanel.tsx`, `components/shop/GoodPurchasePanel.tsx` | `supabase/tests/goods_additional.sql`, 75개 targeted tests, 추가품목 quote/cart tests | 선택형 독립 품목 구조 완료. 실제 연결 상품·옵션·재고를 넣을 때 해당 기능만 활성화 |
| #483 주문당 최소·최대 수량 | ✅ 구현 | `supabase/migrations/20260910072933_sales_goods_purchase_policies.sql`, `lib/goods-sales.ts`, `app/cart/sales-actions.ts`, `app/checkout/actions.ts`, `components/admin/sections/GoodSection.tsx` | `supabase/tests/goods_purchase_policies.sql`, `goods_purchase_policies` concurrency, cart/checkout tests | 옵션 합산 구조 완료. 상품별 실제 min/max를 입력할 때 해당 제한만 활성화 |
| #484 회원별 누적 구매 한도·회복 | ✅ 구현 | purchase policy SQL, `lib/goods-sales.server.ts`, `app/checkout/actions.ts`, cart/checkout policy seam | 구매 policy SQL·동시성, cancelled/duplicate recovery assertions | 생애 유효 주문량·pending 선점·취소/전액환불 회복 구조 완료. 상품별 실제 limit을 입력할 때 활성화 |
| #485 단일 예약상품 선결제·예정일 | ✅ 구현 | `supabase/migrations/20260910091553_sales_goods_preorders.sql`, `lib/goods-preorders.ts`, `app/admin/goods-preorder-actions.ts`, `components/admin/GoodsPreordersPanel.tsx`, `components/shop/GoodPurchasePanel.tsx` | `supabase/tests/goods_preorders.sql`, preorder concurrency, `browser-preorder-active.png`, `browser-preorder-mobile.png` | 실제 승인 물량·입고 근거·발송 예정일 없이는 판매를 열 수 없음 |
| #486 예약·일반 혼합 배송·일정 변경 | ✅ 구현 | `supabase/migrations/20260910091900_sales_preorder_checkout_fulfillment.sql`, `lib/orders/shipments.ts`, `components/admin/ShipmentPreorderPromisePanel.tsx`, `app/admin/preorder-shipment-actions.ts` | preorder checkout/fulfillment SQL·shipment tests, `preorder-shipping-guide-green.log` | 같은 출고지는 가장 늦은 예정일에 합배송, 다른 출고지는 분리하는 구조 완료. 실제 예정일·물류 증빙을 넣을 때 활성화 |
| #487 상품·첫구매·재구매 쿠폰 | ✅ 구현 | `supabase/migrations/20260910091859_sales_coupon_targeting.sql`, `lib/coupon-targeting.ts`, `app/admin/coupon-target-actions.ts`, `components/admin/CouponTargetingFields.tsx`, `components/screens/Cart.tsx` | `supabase/tests/coupon_targeting.sql`, coupon concurrency, `browser-cart-coupon-mobile.png` | 첫구매 자격 선점·전액취소/환불 회복·대상 품목 분리 구조 완료. 실제 쿠폰 정의를 넣을 때 활성화 |
| #488 적립금 적립·조정·잔액·이력 | ✅ 구현 | `supabase/migrations/20260910083943_sales_store_credit_ledger.sql`, `lib/store-credits.ts`, `lib/store-credits.server.ts`, `app/admin/store-credit-actions.ts`, `/my/store-credits` | `supabase/tests/store_credit_ledger.sql`, earned/refund tests, `browser-credit-grant.png`, `browser-credit-policy-retry-green.png` | 거래확정 후 별도 원장·출처·권한 구조 완료. 적립률/상한/유효기간/증빙을 입력할 때 해당 opt-in만 활성화 |
| #489 적립금 주문 사용·실패/환불 복원 | ✅ 구현 | `supabase/migrations/20260910083947_sales_store_credit_checkout.sql`, `app/checkout/store-credit-actions.ts`, `components/checkout/useStoreCreditQuote.ts`, `app/checkout/actions.ts` | `supabase/tests/store_credit_checkout.sql`, earned/refund SQL·concurrency, `browser-checkout-credits-region.png`, `browser-checkout-order-snapshot.png` | 기간 할인→대상 쿠폰 1장→적립금, 선점·확정·실패/환불 복원 구조 완료. 실제 사용 한도·유효기간 값을 넣을 때 활성화 |
| #490 배송정보 템플릿·주소·CS | ✅ 구현 | `supabase/migrations/20260910080202_sales_shipping_notice_templates.sql`, `lib/admin/shipping-notice-templates.ts`, `app/admin/shipping-notice-template-actions.ts`, `components/admin/GoodsShippingNoticeField.tsx`, `components/admin/screens/ShippingNoticeTemplatesScreen.tsx` | `supabase/tests/shipping_notice_templates.sql`, template/workbook tests, `cold-shipping_notice_templates-test.log` | 실제 출고지 주소·반송 주소·CS 연락처와 적용 version을 입력 필요 |
| #491 교환·반품 조건·확인 비용 | ✅ 구현 | `supabase/migrations/20260910083942_sales_claim_policy_costs.sql`, `lib/goods-claim-policy.ts`, `lib/admin/goods-claim-policy.ts`, `components/admin/GoodsClaimPolicyFields.tsx`, `components/admin/screens/ClaimOperationalFeePanel.tsx` | `supabase/tests/sales_claim_policy_costs.sql`, claim-linked tests | 귀책별 반품/교환 비용과 운영 확인액의 실제 의미·근거를 확정 필요 |
| #492 퀵·방문수령·완료 증거 | ✅ 구현 | `supabase/migrations/20260910103635_sales_shipment_delivery_methods.sql`, `lib/shipment-delivery.ts`, `app/admin/shipment-delivery-actions.ts`, `components/admin/DeliveryPoliciesPanel.tsx`, `components/admin/ShipmentDeliveryPanel.tsx` | `supabase/tests/shipment_delivery_methods.sql`, 87개 related tests, `browser-preorder-handoff-blocked.png`, `browser-receipt-code.png`, `browser-pickup-complete.png` | 합성 정책 blank activation 거부→TEST 조건 active, TEST-ONLY paid 주문 fixture pickup 변경·배송비 5,500원 유지, 입고 전 수령 차단→2개 할당→주문자 one-use code→admin UI delivered와 금액 19,900원 보존을 완료 |
| #493 제주·도서산간 배송비 | ✅ 구현 | `supabase/migrations/20260910100643_sales_shipping_regions.sql`, `lib/shipping-regions.ts`, `app/admin/shipping-region-actions.ts`, `app/admin/(shell)/settings/shipping-regions/page.tsx` | `supabase/tests/shipping_regions.sql`, shipping-region tests, `browser-regional-policy-active.png` | #177 H6의 출고지별 실제 지역·요금표가 필요; 임의 정액을 넣지 않음 |
| #494 지연 주문 고객 일괄 안내·재시도 | ✅ 구현·검증 | OrderDelayNoticePanel, order-delay-actions, order-delay-jobs.server, 20260910235736 migration, 전용 cron | 알림·복구 SQL, 동시 요청/worker, 실제 화면과 로컬 모의 공급자의 성공·부분 실패·응답 유실·영구 거절 | 기본 OFF 전용 gate 유지. 실제 발신자·키·운영 절차 확인 및 고객 발송은 별도 활성화 범위 |
| #495 거래확정 영업·정산 검토 엑셀 | ✅ 구현 | `supabase/migrations/20260910095819_sales_settled_export_snapshots.sql`, `lib/admin/settled-export.ts`, `lib/admin/settled-workbook.server.ts`, `app/api/admin/settled-workbook/route.ts`, `components/admin/screens/SettledScreen.tsx` | `supabase/tests/settled_export.sql`, workbook artifact inspection/render, `settled-main.png`, `settled-amounts.png`, `settled-reconciliation.png` | 8개 열·행 의미와 ERP/할인 배분은 구현 계약으로 고정. 실제 영업 양식의 배포 인수만 별도 |
| #496 신규 영업 흐름 통합 검증·운영 안내 | ✅ 기술 검증 | 기능별 runbook, admin-ops-rehearsal, 2026-09-11-sales-admin-integration-checklist | 178 migration·121 SQL·3 seed·9 동시성, 전체 JS/타입/빌드, 실제 주문·HTML·엑셀·알림의 전후 데이터 보존 | 로컬 구현·검증 완료. 기존 운영팀·창고 인수 이슈는 별도 유지 |

## 2026-09-11 최종 통합 검증

- 전체 Vitest: **545개 파일 통과 + 1개 생략**, **5,237개 테스트 통과 + 3개 생략**. 생략 사유는 아래 기준선과 같으며 통과로 계산하지 않았다. 전체 typecheck와 build도 통과했다. 빌드 ID는 syLefyrKayeyZN3C3dP_E다.
- 전체 lint는 오류 0건·기존 hong-sil-downloader 경고 1건이며, 이후 변경 파일의 ESLint도 통과했다. 최종 빌드로 공개 HTML과 관리자 안내 이력을 다시 조회했다.
- 전용 CI DB를 초기화 완료한 Supabase Postgres 17 이미지에서 새로 구성하고 **178개 migration 원문 SHA-256 일치**, **121/121 SQL**, **seed 3종**, **동시성 9종**을 확인했다. 일반 리허설도 100주문·100배송 건의 상태·금액·재고·프로필 보존을 통과했다. 기본 icons-ip DB를 이 추가 검증에 사용하지 않았다.
- HTML은 실제 이미지 업로드 → 설명 삽입 → 미리보기 → 저장 → 공개 상세 → XLSX 다운로드·재업로드 → 새 초안 복사까지 확인했다. 실행 태그·이벤트·CSS·외부 이미지는 제거되고 ERP 코드 0004273001·바코드 00123456784273은 문자열로 보존된다.
- FormData의 CRLF가 XLSX에서 LF로 바뀌는 경우를 실제 파일에서 발견했다. 비교할 때 줄바꿈만 통일하여 같은 파일이 **변경 없이 완료**되고, DB의 원문 CRLF와 전체 상품·옵션 row가 그대로 유지되는 것을 확인했다.
- 정리 후 30,000자를 초과하는 HTML은 저장을 거절했다. 입력한 6,001개의 앰퍼샌드가 실패 후에도 보존됐으며, 편집기를 다시 열어 임시 입력을 복구했다. 검증 후 복사 상품의 원래 설명으로 복원했다.
- 고객 안내는 실제 로컬 주문서에서 만든 2개 합성 주문을 사용했다. 각 주문은 상품 10,100원 + 배송비 3,000원 - 적립금 100원 = **13,000원**이다. 지연 조건만 재현하기 위해 이 두 주문의 확인 시각을 테스트 fixture로 조정했으며 실제 나흘이 경과한 운영 기록으로 취급하지 않는다.
- 인앱 알림·구매자 이메일·예정일 확인 중·주문 링크를 화면과 DB에서 대조했다. 내부 지연 메모는 고객 알림과 모의 메일에 포함되지 않았다. 첫 안내의 이메일 1건 성공·1건 실패 뒤 실패 이메일만 재시도했고 인앱 알림은 늘지 않았다.
- 모의 공급자는 수신자를 example.test/example.invalid로 제한한 로컬 HTTP 서버다. 총 4개의 이메일 intent에서 공급자 접수는 3건이다. 응답 유실 건은 같은 키로 1회 재조정되어 접수가 중복되지 않았다. 영구 거절은 기존 dispatcher의 needs_review로 멈추고 수동 재시도 버튼이 없으며, 마지막 worker 재호출은 처리 대상 0건이다. 실제 고객 발송은 0건이다.
- 안내 전후 2개 주문·품목·배송 건 전체 payload가 일치한다. 기존 19,900원 주문과 2026-10-10 예약 배송 약속도 그대로다. HTML 원본 상품은 설명·형식·이미지 목록과 수정 시각만 바뀌었고, 복사본은 초안·재고 0·ERP/바코드·매입단가 공란이다.
- 공개 HTML과 안내 결과는 데스크톱·390px에서 확인했다. 넓은 표는 자체 스크롤하고 긴 링크는 줄바꿈한다. 관리자 미리보기의 수량·가격 스타일 충돌과 운송장 예시의 넘침을 수정했다. 320px 검사는 기존 전역 최소 폭 320px 범위에서 수행했다.
- 독립 Standards/Spec 리뷰의 잠금 순서·기존 이미지 이동 지적을 수정했다. 실제 교착과 이미지 이동 실패의 RED → GREEN, 엑셀 줄바꿈 재리뷰까지 확인했으며 두 축의 잔여 지적은 0건이다.
- 작업용 메일 gate를 OFF로 복원하고 모의 공급자를 종료했다. 최종 앱은 원래 로컬 설정으로 실행하며 기록을 조회할 수 있다.

최신 근거는 /tmp/icons-sales-admin-4273/final-two/의 final-verification-summary.json, integration-preservation.json, fake-mail-verification.json, cold/manifest.json, cold/sql/results.json, cold/concurrency/results.json과 q11/q12 스크린샷·실제 XLSX다. 배포할 코드·SQL과 로컬 검증의 연결은 migration SHA 목록으로 확인한다.

## 2026-09-10 기준선 검증

- 기준선 Vitest: **542 files passed + 1 skipped (543)**, **5,202 tests passed + 3 skipped (5,205)**. 근거: `/tmp/icons-sales-admin-4273/full-test-final.log`.
- 생략 3건은 실행 환경을 명시적으로 켜야 하는 기존 `goods_payment_route.integration.test.ts` 1건과 공개 커뮤니티 스위치가 꺼진 상태의 `AboutLegacy.test.tsx` 2건이다. 실제 PG 승인·환급·고객 메시지 발송은 실행하지 않았다.
- `npm run typecheck`: route type generation과 `tsc --project tsconfig.test.json --noEmit --incremental false` 통과. 근거: `/tmp/icons-sales-admin-4273/full-typecheck.log`.
- `npm run lint`: **0 errors**, 기존 `scripts/hong-sil-downloader.mjs:294`의 unused-vars warning 1건. 근거: `/tmp/icons-sales-admin-4273/full-lint-final.log`.
- `npm run build`: 성공. `/tmp/icons-sales-admin-4273/build-delivery-final.log`에 전체 route 결과가 남아 있다.
- 영업 통합 targeted suite: **6 files / 44 tests passed**. 근거: `/tmp/icons-sales-admin-4273/sales-integration-current.log`.
- root exact replay: 현재 migration **176개 SHA 일치**, SQL smoke **118/118**, seed 3종과 `admin_ops_rehearsal`의 **100 paid orders + 100 shipments/snapshots 보존** PASS. 근거: `/tmp/icons-sales-admin-4273/ci-db`, `exact-migrations.log`, `exact-sql.log`.
- 신규 동시성 6종도 exact 결과에 PASS로 기록되어 있다: `goods_purchase_policies`, `sales_category_hierarchy`, `store_credit`, `coupon_targeting`, `goods_preorders`, `goods_clone`. 근거: `/tmp/icons-sales-admin-4273/exact-concurrency.log`, `concurrency-exact/results.json`.
- 브라우저/파일 증거는 관리자 계정, 쿠폰 검색·복구, 상품/옵션/크롭, 주문 검색·상세, 가격·KC·예약·지역 배송·적립금·정산 엑셀을 포함한다. #492의 최신 증거는 `browser-preorder-handoff-blocked.png`, `browser-receipt-code.png`, `browser-pickup-complete.png`이며, TEST-ONLY paid 주문 fixture의 방식 변경·배송비/주문금액 snapshot 보존과 delivered 전이를 확인했다. 모든 입력은 task-local `TEST-ONLY` synthetic QA이며 실제 결제·발송·고객 메시지 전송 증거가 아니다.
- #495 workbook은 artifact render/inspection으로 확인했다. 잠금 때문에 현재 실제 Excel UI 실행은 불가했고, LibreOffice 출력의 CJK 누락·tiny print는 정상 통과 증거로 세지 않았다.

- 실제 브라우저 다운로드: 상품 1개/옵션 1행 XLSX를 재업로드해 변경 없음 판정과 완료까지 확인했다 (`browser-goods-roundtrip.png`). ERP 코드 `0004273001`과 바코드 `00123456784273`의 문자열 보존을 확인했다.
- 거래확정 4건을 브라우저에서 생성·다운로드해 품목 합계와 주문 금액 차이가 모두 0임을 확인했다. 과거 ERP·결제 원장이 없는 시드 주문은 공란과 사유를 유지한다 (`browser-settled-workbook.xlsx`, `browser-settled-decoded.json`).
- 작업용 Storage 초기화에 가져오기 버킷이 누락되어 첫 업로드는 실패했다. 기존 migration의 비공개 버킷·50MB 한도를 작업용 Storage에 맞춘 뒤 같은 파일의 왕복 검증이 통과했다. 업로드 실패 후 진행 중 문구가 남는 UI도 수정했다.
- 마지막 화면 수정은 관련 6개 테스트와 ESLint를 통과했다. 실제 빈 XLSX에서 오류·파일 선택 유지·진행 상태 해제를 확인했다. 지역 정책 이름과 표는 모바일 390px 화면에서 본문 가로 넘침 없이 표시되며, 640px 표만 내부에서 가로 스크롤한다 (`browser-regional-mobile-green.png`).
- Standards/Spec 독립 리뷰의 지적 5건을 수정했다. 복사/결제 교착, 새 참조가 있는 옵션 삭제, 예약상품의 일반 배송 약속, 사용중지 옵션 복사 누락, 방문수령의 택배 송장 폼 노출에 대한 회귀 검증을 통과했고 구현된 범위의 잔여 finding은 0건이다.
- 주요 로그·스크린샷·실제 다운로드 XLSX·SHA 목록은 `/Users/sangwopark19/Documents/Codex/2026-09-10/sales-admin-feedback-qa/`에도 보존했다. 원래 `.scratch/sales-admin/`의 작업 중간 자료는 `/tmp/icons-sales-admin-4273/working-notes/`로 옮겼다.

## 남은 조건과 완료 경계

기술 검증은 현재 migration·RPC·Server Action·화면·엑셀의 연결을 확인한다. 신규 opt-in을 실제로 활성화하려면 해당 상품의 실물 재고와 공급/물류 자료, 결제·성인인증 gate, KC 자료, 환불·클레임 비용 등 해당 정책의 실제값과 증빙이 별도로 채워져야 한다. 이는 기존 일반 운영 경로 전체를 닫는 판정이 아니다. Q11(#494)과 Q12(#478)는 승인된 구조로 구현됐고, #496의 로컬 기술 검증도 완료했다. 기존 #410/#414/#423/#425/#426/#429/#430/#434의 사람 인수는 이 기술 작업과 별도로 추적하며 완료 처리하거나 복제하지 않는다.

2026-09-11 후속 배포 승인 전 GitHub read-back에서 #461~#496은 모두 OPEN이며 연결된 Project 항목은 없었다. 이후 [PR #499](https://github.com/icons-hq/icons-ip/pull/499)에 36개 이슈의 자동 종료 연결을 확인했다. 병합 후 실제 종료 상태를 확인하며, 실제 정책값 입력과 사람 인수는 기존 운영 이슈에서 별도로 기록한다.

## 후속 배포 검증과 리뷰 보정

- 최신 `main`의 팝업 변경을 보존해 통합했다. 운영 배포는 기존 GitHub Actions의 격리 Preview → production DB → 앱 경로를 따른다.
- GitHub 리뷰의 P2 3건을 재현·수정했다. 쿠폰 선택 변경은 주문 변경 복구 안내로 매핑한다. 옵션 저장이 반환한 실제 UUID로 ERP·바코드·매입단가를 연결하여 과거 중지 옵션과 혼동하지 않으며, 신규 중지 옵션과 명시적 기존 중지 ID도 지원한다. 부족 경보는 활성 옵션만 집계하고 복원 시 다시 표시한다.
- 이미 공유한 migration은 변경하지 않고 `20260911024351_fix_variant_metadata_resolution_and_stock_warnings.sql`을 추가했다. 최종 migration은 **179개**이며 관련 SQL 10개와 checkout 테스트 50개를 통과했다. 이전의 178개 기록은 해당 시점의 검증 기준선이다.
- CI의 구형 Supabase Postgres `17.6.1.106` 권한 오류 처리 결함을 확인하고 CLI를 `2.109.1`로 갱신했다. 로컬·CI 초기 Data API 권한은 현재 hosted 프로젝트의 기본 권한과 일치시킨다. migration의 권한 회수와 권한 거절 테스트는 유지한다. 버전·폐기 예정 설정의 후속 조건은 [README](../../../README.md#cicd)에 기록했다.
- 기존 앱의 민감 메일 키·발신자를 한 쌍으로 재사용하는 설정 호환을 추가했다. HMAC·webhook 설정과 Q11의 전용 gate는 [지연 주문 안내 런북](../../runbooks/order-delay-notices.md)을 따른다. #191 Auth Hook 전환과 그 readiness는 별도다.
- 실제 공개 중인 사업자·CS 값 8개를 기존 관리자 화면으로 운영 설정에 저장하고 감사 이력·공개 연락처 일치·나머지 93개 테이블의 보존을 확인했다. 법인계좌·반송주소·상품별 실제 금액과 증빙은 확인되지 않은 값을 임의로 채우지 않는다.
- 로컬 DB 영향의 읽기 전용 후속 조사는 `/Users/sangwopark19/Documents/Codex/2026-09-11/sales-admin-release/incident/`에 보존했다. 현재 계정·프로필·주문은 0건이고 사고 당일 오전 Auth 사용 흔적이 있으나, 초기화 직전 건수와 전체 복원 가능한 원본 백업은 확인되지 않았다.

## 로컬 DB reset 사고

`/Users/sangwopark19/Documents/Codex/2026-09-10/sales-admin-feedback-qa/local-reset-incident.md`에 당시 보고를 보존했다. 권한 범위는 `icons-sales-admin-4273-db/sales_admin`였지만 이 worktree에서 `supabase db reset --local --no-seed --yes`를 두 차례 실행했고, `supabase/config.toml`의 `project_id = "icons-ip"`에 따라 대상은 `supabase_db_icons-ip` 로컬 stack(API 54321, DB 54322)이었다. task DB `icons-sales-admin-4273-db/sales_admin`(container DB 55482, REST 55485, Auth 55484, API proxy 55481)에는 reset을 실행하지 않았다. reset 전 row count·dump·backup이 없어 기존 `icons-ip` 데이터 영향과 복원 가능성은 unknown이며, task DB의 검증·seed·rollback 증거와는 분리한다.
