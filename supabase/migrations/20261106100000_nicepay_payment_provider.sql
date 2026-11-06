-- ==========================================================================
-- ICONS · 결제 provider 축에 나이스페이(NICEPAY 웹표준)를 더한다
--
-- 판매 제한 상품(성인/19금)이 담긴 굿즈 주문의 카드 PG를 코페이에서 나이스페이로
-- 바꾼다(2026-11-05 결정 — 코페이는 취소·조회 API가 없어 수동 취소만 됐다). 이
-- migration은 enum 값만 더한다. 새 enum 값은 추가한 트랜잭션 안에서 쓸 수 없으므로
-- (unsafe use of new value) 값을 쓰는 seam 재정의는 다음 migration
-- 20261106100100_nicepay_goods_payment_seam.sql이 따로 한다.
--
-- 'korpay'는 지우지 않는다. 진행 중이던 코페이 결제의 콜백 drain·수동 복구와 과거
-- 원장 행이 같은 값을 계속 가리킨다.
-- ==========================================================================

alter type public.payment_provider add value if not exists 'nicepay';
