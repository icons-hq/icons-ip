\set ON_ERROR_STOP on

-- 현업 3-3 — 거래확정 엑셀. 8열이 그 순서로 있고, 배송비는 첫 품목 행에만, 주문번호는 사람이 보는 번호다.

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000c01', 'authenticated', 'authenticated', 'settled@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values ('00000000-0000-4000-8000-000000000c01', 'settled@example.test', 'settled_user', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do nothing;
insert into public.verticals (key, label, color) values ('sox', '정산 엑셀', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('sox-ip', '정산 IP', 'sox') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('sox-g1', 'sox-ip', '정산 굿즈 하나', '문구', 12000, 'ok', 9), ('sox-g2', 'sox-ip', '정산 굿즈 둘', '문구', 3000, 'ok', 9)
on conflict (id) do nothing;

-- 확정된 주문(품목 2) 하나 · 결제만 된 주문 하나
insert into public.orders (id, user_id, status, total, address, shipping_fee, shipping_carrier, tracking_number, shipped_at, delivered_at, paid_at, done_at, created_at)
values
  ('00000000-0000-4000-8000-000000000c10', '00000000-0000-4000-8000-000000000c01', 'done', 30000, '{}'::jsonb, 3000,
   (select code from public.shipping_carriers order by code limit 1), '1234567890', '2026-09-02 09:00+09', '2026-09-03 09:00+09',
   '2026-09-01 09:00+09', '2026-09-08 10:00+09', '2026-09-01 08:00+09'),
  ('00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', 'paid', 12000, '{}'::jsonb, 3000,
   null, null, null, null, '2026-09-02 09:00+09', null, '2026-09-02 08:00+09');
insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
values
  ('00000000-0000-4000-8000-000000000c10', 'sox-g1', 2, 12000, '정산 굿즈 하나', '문구', 'sox-ip'),
  ('00000000-0000-4000-8000-000000000c10', 'sox-g2', 1, 3000, '정산 굿즈 둘', '문구', 'sox-ip'),
  ('00000000-0000-4000-8000-000000000c11', 'sox-g1', 1, 12000, '정산 굿즈 하나', '문구', 'sox-ip');

select id as template_id from public.export_templates where key = 'settled_orders' \gset

-- 양식: 8열이 요청 순서 그대로, 기본 조건은 확정 주문, 개인정보 없음.
select 1 / case when (
  (select pg_catalog.string_agg(col ->> 'header', '/' order by ord)
   from public.export_templates as t, jsonb_array_elements(t.columns) with ordinality as c(col, ord)
   where t.key = 'settled_orders')
  = '구매확정일/쇼핑몰주문번호/송장번호/ERP품명/수량/판매금액/배송비/결제일'
  and (select default_filters ->> 'status' from public.export_templates where key = 'settled_orders') = 'done'
  and (select security_level::text from public.export_templates where key = 'settled_orders') = 'normal'
  and (select is_system from public.export_templates where key = 'settled_orders')
) then 1 else 0 end as assert_settled_template_has_the_eight_columns_in_order;

-- 행: 확정 주문만 · 주문번호는 사람이 보는 번호 · 확정일/결제일 KST · 배송비는 첫 품목 행에만.
create temp table settled_rows as
  select row_data
  from private.export_rows(:'template_id'::uuid, '{"status":"done"}'::jsonb, null, 100, false)
  where row_data ->> 'good_id' like 'sox-%';

select 1 / case when (
  (select count(*) from settled_rows) = 2
  and (select count(*) from settled_rows where row_data ->> 'order_no' = (select order_no from public.orders where id = '00000000-0000-4000-8000-000000000c10')) = 2
  and (select count(*) from settled_rows where row_data ->> 'order_no' like '%-%-%-%-%') = 0
  and (select count(distinct row_data ->> 'done_at') from settled_rows) = 1
  and (select row_data ->> 'done_at' from settled_rows limit 1) = '2026-09-08 10:00'
  and (select row_data ->> 'paid_at' from settled_rows limit 1) = '2026-09-01 09:00'
  and (select pg_catalog.sum((row_data ->> 'shipping_fee')::bigint) from settled_rows) = 3000
  and (select pg_catalog.sum((row_data ->> 'line_total')::bigint) from settled_rows) = 27000
  and (select row_data ->> 'tracking_number' from settled_rows limit 1) = '1234567890'
) then 1 else 0 end as assert_settled_rows_are_done_orders_with_fee_once;

-- 결제만 된 주문은 조건 없이 뽑으면 나오되 확정일이 비어 있다 — 「없는 값을 지어내지 않는다」.
select 1 / case when (
  (select row_data ->> 'done_at'
   from private.export_rows(:'template_id'::uuid, '{}'::jsonb, null, 100, false)
   where row_data ->> 'order_no' = (select order_no from public.orders where id = '00000000-0000-4000-8000-000000000c11')) = ''
) then 1 else 0 end as assert_unsettled_order_has_empty_done_at;

rollback;
