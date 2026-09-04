\set ON_ERROR_STOP on
\timing on
-- 내보내기 규모 검증 — 주문 10만 줄을 트랜잭션 안에서 심고 워커가 실제로 도는 경로
-- (`private.export_rows` 1,000줄 페이지 반복)의 지연을 본 뒤 되돌린다.
-- 실행: scratchpad/db.sh < supabase/perf/export_rows_scale.sql (로컬 전용, 기본 seed 에 넣지 않는다)
begin;

insert into public.verticals (key, label, color) values ('perfx', '내보내기 규모', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('perfx-ip', '내보내기 규모 IP', 'perfx') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('perfx-g1', 'perfx-ip', '규모 테스트 굿즈', '문구', 3000, 'ok', 1000000)
on conflict (id) do nothing;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000109', 'authenticated', 'authenticated', 'perfx@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values ('00000000-0000-4000-8000-000000000109', 'perfx@example.test', 'perfx_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'admin')
on conflict (id) do update set role = excluded.role;

\echo '--- seed 100,000 orders + 100,000 order items'
-- 결제·예약 RPC 를 거치지 않고 표에 바로 심는다. 여기서 재는 것은 읽기(내보내기)다.
-- 품목·출고지는 D-1b 의 BEFORE INSERT 트리거가 채운다.
insert into public.orders (id, user_id, status, total, address, created_at)
select gen_random_uuid(), '00000000-0000-4000-8000-000000000109', 'paid', 3000,
       jsonb_build_object(
         'recipientName', '수취인' || i,
         'phone', '010' || lpad((10000000 + i)::text, 8, '0'),
         'postalCode', lpad(((i * 7) % 100000)::text, 5, '0'),
         'address1', '서울특별시 강남구 테헤란로 ' || i,
         'address2', (1 + i % 30) || '동 ' || (100 + i % 900) || '호',
         'deliveryNote', '문 앞'
       ),
       now() - (i || ' minutes')::interval
from generate_series(1, 100000) as g(i);

insert into public.order_items (order_id, good_id, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, qty, unit_price)
select ord.id, 'perfx-g1', '규모 테스트 굿즈', '문구', 'perfx-ip', 1, 3000
from public.orders as ord
where ord.user_id = '00000000-0000-4000-8000-000000000109';

analyze public.orders;
analyze public.order_items;
select count(*) as items from public.order_items as item
join public.orders as ord on ord.id = item.order_id
where ord.user_id = '00000000-0000-4000-8000-000000000109';

\echo '--- 첫 페이지 1,000줄 (마스킹 없음 / 마스킹 있음)'
select count(*) from private.export_rows(
  (select id from public.export_templates where key = 'picking_list'), '{}'::jsonb, null, 1000, true);
select count(*) from private.export_rows(
  (select id from public.export_templates where key = 'picking_list'), '{}'::jsonb, null, 1000, false);

\echo '--- 커서로 100페이지 도는 전체 시간 (= 워커가 10만 줄을 읽는 시간)'
do $$
declare
  v_template uuid := (select id from public.export_templates where key = 'picking_list');
  v_after jsonb := null;
  v_rows integer := 0;
  v_page integer := 0;
  v_last jsonb;
  v_started timestamptz := clock_timestamp();
begin
  loop
    with page as (
      select row_key, row_number() over () as rn
      from private.export_rows(v_template, '{}'::jsonb, v_after, 1000, true)
    )
    select count(*)::integer, (select row_key from page order by rn desc limit 1)
    into v_page, v_last
    from page;
    exit when v_page = 0;
    v_rows := v_rows + v_page;
    v_after := v_last;
    exit when v_page < 1000;
  end loop;
  raise notice '읽은 줄 % · 걸린 시간 %', v_rows, clock_timestamp() - v_started;
end;
$$;

\echo '--- 마지막 페이지(커서가 끝에 가 있을 때)'
explain (analyze, buffers, timing)
select * from private.export_rows(
  (select id from public.export_templates where key = 'picking_list'),
  '{}'::jsonb,
  jsonb_build_object('at', (select max(created_at) - interval '2 minutes' from public.orders where user_id = '00000000-0000-4000-8000-000000000109'), 'id', gen_random_uuid()),
  1000,
  true
);

rollback;
