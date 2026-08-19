-- ============================================================================
-- ICONS · 주문 상태 사다리 확장 — enum 값 추가만 (#250)
--
-- Postgres는 같은 트랜잭션에서 방금 추가한 enum 값을 참조하지 못한다
-- (unsafe use of new value of enum type). Supabase CLI는 마이그레이션 파일
-- 하나를 한 트랜잭션으로 적용하므로, 값 추가와 그 값을 쓰는 DDL/함수 본문을
-- 반드시 다른 파일로 나눈다. 이 파일은 값 추가만 담고, 나머지는
-- 20260818090001_order_status_ladder.sql이 담는다.
--
-- 사다리: pending → paid → confirmed → shipping → delivered → done
--         (+ canceled)
--   confirmed — 운영자가 신규 주문을 인지한 "발주확인" 단계
--   delivered — 배송완료. 청약철회 기산점(delivered_at)을 확정한다
--   done      — 거래확정. delivered + 8일 자동 전이(변심 철회 창 종료)
--
-- `after`로 위치를 지정해 enum_range 순서가 사다리 순서와 일치하게 둔다.
-- 어드민 필터(admin_search_orders)가 enum_range로 유효값을 검증하므로
-- 순서 자체가 운영 화면의 표시 순서 근거가 된다.
-- ============================================================================

alter type public.order_status add value if not exists 'confirmed' after 'paid';
alter type public.order_status add value if not exists 'delivered' after 'shipping';
