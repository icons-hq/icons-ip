-- 정기 미팅 시연용 데이터 (로컬 전용 · 재실행 가능)
--
-- 로컬 시드에는 주문·쿠폰·출고가 0건이라 판매 관리 화면이 전부 비어 보인다. 시연은 화면이 채워져
-- 있어야 「무엇이 바뀌었는지」가 보인다. 모든 id 는 demo- 접두어라 지우기도 쉽다:
--   docker exec -i supabase_db_icons-ip psql -U postgres -d postgres < scripts/demo/admin-meeting-seed.sql
-- 운영 DB 에 넣지 않는다 — 여기 있는 사람·주소·전화는 전부 가짜다.

begin;

-- ── 스태프 계정에 개인정보 내보내기 권한 — 발주서(개인정보 포함) 양식은 이 권한이 없으면 요청이 거절된다.
insert into public.admin_permissions (user_id, permission)
select id, 'secure_export' from public.profiles where email = 'test@test.com'
on conflict do nothing;

-- ── 손님 셋
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000d001', 'authenticated', 'authenticated', 'demo-kim@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000d002', 'authenticated', 'authenticated', 'demo-lee@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000d003', 'authenticated', 'authenticated', 'demo-park@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-00000000d001', 'demo-kim@example.test', 'rilak_fan', '1995-03-02', '{"terms":true,"privacy":true}'::jsonb, now() - interval '40 day', 'user'),
  ('00000000-0000-4000-8000-00000000d002', 'demo-lee@example.test', 'maple_lover', '2001-11-20', '{"terms":true,"privacy":true}'::jsonb, now() - interval '20 day', 'user'),
  ('00000000-0000-4000-8000-00000000d003', 'demo-park@example.test', 'damgom_daily', '2009-06-15', '{"terms":true,"privacy":true}'::jsonb, now() - interval '3 day', 'user')
on conflict (id) do nothing;

-- ── 상품 데이터 확장(슬라이스 1) — 리락쿠마 쿠션에 할인·KC·수량 상한·바코드, 피크닉 세트는 성인 전용
update public.goods set
  compare_at_price = 48000,
  discount_kind = 'percent', discount_value = 10, discount_shows_rate = true,
  discount_starts_at = now() - interval '1 day', discount_ends_at = now() + interval '13 day',
  kc_status = 'certified', kc_type = '어린이제품 안전확인', kc_number = 'CB061R1234-5001', kc_company = '(주)아이콘스',
  min_order_qty = 1, max_order_qty = 3, max_qty_per_account = 5,
  barcode = '8801234567890'
where id = 'g1';
update public.goods set kc_status = 'exempt', barcode = '8801234567906' where id = 'g2';
update public.goods set adult_only = true, kc_status = 'none' where id = 'g9';
update public.goods set kc_status = 'unknown' where id in ('g3', 'g4', 'g5');

-- ── 배송 정책 하나 더(슬라이스 2) — 기본 정책을 베껴 「도서산간 별도 · 유료」로. 주황버섯 인형이 이 정책을 쓴다.
insert into public.shipping_policies (id, name, method, bundling, fee_kind, fee_amount, free_threshold, remote_surcharge,
  ship_from_location_id, exchange_location_id, return_location_id, exchange_fee, return_fee, return_restrictions, support_note, allow_bank_transfer, is_default)
select 'demo-bulky', '부피 상품 · 유료 3,000', method, false, 'paid', 3000, null, 5000,
  'namyangju', 'namyangju', 'namyangju', 6000, 6000,
  '포장 개봉 후 봉제 인형은 위생상 반품이 어렵습니다.', '고객센터 010-0000-0000 (평일 10~18시)', allow_bank_transfer, false
from public.shipping_policies where is_default limit 1
on conflict (id) do nothing;
update public.goods set shipping_policy_id = 'demo-bulky' where id in ('g3', 'g7');

-- ── 쿠폰 셋(슬라이스 4) — 누구나 · 첫 구매 · 리락쿠마 쿠션을 산 사람
insert into public.coupons (code, name, discount_type, discount_value, min_subtotal, starts_at, ends_at, status, target_kind, target_good_id)
values
  ('WELCOME3000', '가입 환영 3천원', 'fixed', 3000, 20000, now() - interval '10 day', now() + interval '50 day', 'active', 'all', null),
  ('FIRST5000', '첫 구매 5천원', 'fixed', 5000, 30000, now() - interval '10 day', now() + interval '80 day', 'active', 'first_purchase', null),
  ('RILAK10', '쿠션 산 분께 10%', 'percent', 10, 0, now() - interval '3 day', now() + interval '27 day', 'active', 'bought_good', 'g1'),
  ('SUMMER2026', '여름 프로모션(종료)', 'percent', 15, 0, now() - interval '90 day', now() - interval '30 day', 'archived', 'all', null)
on conflict (code) do nothing;

-- ── 주문 — 단계별로 하나씩. 주소는 전부 가짜다.
insert into public.orders (id, user_id, status, total, address, shipping_fee, shipping_carrier, tracking_number, shipped_at, delivered_at, paid_at, confirmed_at, done_at, created_at)
values
  -- 신규(결제 완료)
  ('00000000-0000-4000-8000-00000000d101', '00000000-0000-4000-8000-00000000d001', 'paid', 57000,
   '{"recipientName":"김리락","phone":"010-1111-2222","address1":"서울특별시 마포구 월드컵북로 400","address2":"3층","postalCode":"03925","deliveryNote":"문 앞에 두세요"}'::jsonb,
   0, null, null, null, null, now() - interval '2 hour', null, null, now() - interval '2 hour'),
  ('00000000-0000-4000-8000-00000000d102', '00000000-0000-4000-8000-00000000d002', 'paid', 21000,
   '{"recipientName":"이메플","phone":"010-3333-4444","address1":"경기도 성남시 분당구 판교역로 166","address2":"","postalCode":"13529","deliveryNote":""}'::jsonb,
   3000, null, null, null, null, now() - interval '1 day', null, null, now() - interval '1 day'),
  -- 발송 대기(발주 확인 됨) — 하나는 지연 안내 대상
  ('00000000-0000-4000-8000-00000000d103', '00000000-0000-4000-8000-00000000d003', 'confirmed', 31000,
   '{"recipientName":"박담곰","phone":"010-5555-6666","address1":"부산광역시 해운대구 센텀중앙로 55","address2":"1201호","postalCode":"48058","deliveryNote":"경비실 보관"}'::jsonb,
   3000, null, null, null, null, now() - interval '4 day', now() - interval '3 day', null, now() - interval '4 day'),
  ('00000000-0000-4000-8000-00000000d104', '00000000-0000-4000-8000-00000000d001', 'confirmed', 45000,
   '{"recipientName":"김리락","phone":"010-1111-2222","address1":"서울특별시 마포구 월드컵북로 400","address2":"3층","postalCode":"03925","deliveryNote":""}'::jsonb,
   0, null, null, null, null, now() - interval '6 day', now() - interval '5 day', null, now() - interval '6 day'),
  -- 배송 중
  ('00000000-0000-4000-8000-00000000d105', '00000000-0000-4000-8000-00000000d002', 'shipping', 33000,
   '{"recipientName":"이메플","phone":"010-3333-4444","address1":"경기도 성남시 분당구 판교역로 166","address2":"","postalCode":"13529","deliveryNote":""}'::jsonb,
   0, 'hanjin', '5012345678901', now() - interval '1 day', null, now() - interval '5 day', now() - interval '4 day', null, now() - interval '5 day'),
  -- 거래확정(정산 대상) 둘
  ('00000000-0000-4000-8000-00000000d106', '00000000-0000-4000-8000-00000000d001', 'done', 42000,
   '{"recipientName":"김리락","phone":"010-1111-2222","address1":"서울특별시 마포구 월드컵북로 400","address2":"3층","postalCode":"03925","deliveryNote":""}'::jsonb,
   0, 'hanjin', '5012345678001', now() - interval '20 day', now() - interval '18 day', now() - interval '22 day', now() - interval '21 day', now() - interval '10 day', now() - interval '22 day'),
  ('00000000-0000-4000-8000-00000000d107', '00000000-0000-4000-8000-00000000d002', 'done', 31000,
   '{"recipientName":"이메플","phone":"010-3333-4444","address1":"경기도 성남시 분당구 판교역로 166","address2":"","postalCode":"13529","deliveryNote":""}'::jsonb,
   3000, 'hanjin', '5012345678002', now() - interval '15 day', now() - interval '13 day', now() - interval '17 day', now() - interval '16 day', now() - interval '5 day', now() - interval '17 day'),
  -- 미입금(무통장 대기)
  ('00000000-0000-4000-8000-00000000d108', '00000000-0000-4000-8000-00000000d003', 'pending', 12000,
   '{"recipientName":"박담곰","phone":"010-5555-6666","address1":"부산광역시 해운대구 센텀중앙로 55","address2":"1201호","postalCode":"48058","deliveryNote":""}'::jsonb,
   3000, null, null, null, null, null, null, null, now() - interval '6 hour')
on conflict (id) do nothing;

insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
select o.id, g.id, i.qty, g.price, g.name, g.type, g.ip_id
from (values
  ('00000000-0000-4000-8000-00000000d101', 'g1', 1), ('00000000-0000-4000-8000-00000000d101', 'g2', 1),
  ('00000000-0000-4000-8000-00000000d102', 'g4', 1),
  ('00000000-0000-4000-8000-00000000d103', 'g3', 1),
  ('00000000-0000-4000-8000-00000000d104', 'g14', 5),
  ('00000000-0000-4000-8000-00000000d105', 'g5', 1),
  ('00000000-0000-4000-8000-00000000d106', 'g1', 1),
  ('00000000-0000-4000-8000-00000000d107', 'g3', 1),
  ('00000000-0000-4000-8000-00000000d108', 'g13', 1)
) as i(order_id, good_id, qty)
join public.orders o on o.id = i.order_id::uuid
join public.goods g on g.id = i.good_id
where not exists (select 1 from public.order_items x where x.order_id = o.id);

-- ── 발송지연 안내(슬라이스 3) — 발송 대기 주문 하나에
insert into public.order_dispatch_delays (order_id, reason, expected_ship_date, noted_by)
select '00000000-0000-4000-8000-00000000d103', '공급사 입고 지연으로 발송이 늦어지고 있습니다', (now() + interval '3 day')::date, (select id from public.profiles where role in ('staff','admin') order by created_at limit 1)
where not exists (select 1 from public.order_dispatch_delays where order_id = '00000000-0000-4000-8000-00000000d103');

-- ── 첫 구매 쿠폰을 손님 하나가 받아 둔 상태(발급 시점 판정 시연용)
insert into public.user_coupons (user_id, coupon_code, issued_source)
select '00000000-0000-4000-8000-00000000d003', 'FIRST5000', 'code_entry'
where not exists (select 1 from public.user_coupons where user_id = '00000000-0000-4000-8000-00000000d003' and coupon_code = 'FIRST5000');

-- ── 굿즈의 대표 분류 = ERP 소분류 (PM 2026-09-09 「상품 분류는 ERP 기준으로」).
--    ERP 에 없는 「아크릴 스탠드」는 리빙 › 홈데코 › 장식소품 아래 자체 분류로 두고 ERP 에 소분류 추가를 요청한다.
insert into public.categories (id, kind, parent_id, name, description, path, depth, position, source)
select 'acrylic-stand', 'catalog', leaf.id, '아크릴 스탠드', 'ERP 에 소분류가 없어 장식소품 아래 자체 분류로 둔다(ERP 추가 요청 중).', '', 1, 0, 'store'
from public.categories as leaf
where leaf.erp_key = '리빙 > 홈데코 > 장식소품'
on conflict (id) do nothing;

delete from public.good_categories where good_id in ('g1','g2','g3','g4','g5','g6','g7','g8','g9','g10','g11','g12','g13','g14','g15');
insert into public.good_categories (good_id, category_id, is_primary, position)
select mapping.good_id, category.id, true, 0
from (values
  ('g1',  '리빙 > 쿠션 > 형태쿠션'),
  ('g2',  '패션 > 키링 > 봉제키링'),
  ('g3',  '리빙 > 토이 > 인형'),
  ('g4',  '패션 > 키링 > 아크릴키링'),
  ('g5',  '리빙 > 홈데코 > 장식소품'),
  ('g6',  '문구 > 데스크정리/보관 > 매트/패드/보드'),
  ('g7',  '리빙 > 쿠션 > 형태쿠션'),
  ('g8',  '패션 > 파우치 > 납작파우치'),
  ('g9',  '리빙 > 캠핑용품 > 캠핑매트'),
  ('g10', '리빙 > 토이 > 피규어'),
  ('g12', '리빙 > 토이 > 피규어'),
  ('g14', '패션 > 키링 > 아크릴키링'),
  ('g15', '리빙 > 토이 > 인형')
) as mapping(good_id, erp_key)
join public.categories as category on category.erp_key = mapping.erp_key
join public.goods as good on good.id = mapping.good_id
on conflict do nothing;
-- 아크릴 스탠드·블록은 자체 분류(4단째)에 — 엑셀에는 조상 셋(리빙/홈데코/장식소품)이 나간다.
insert into public.good_categories (good_id, category_id, is_primary, position)
select good.id, 'acrylic-stand', true, 0
from public.goods as good
where good.id in ('g11', 'g13')
on conflict do nothing;

commit;
