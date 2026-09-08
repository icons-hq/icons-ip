\set ON_ERROR_STOP on

-- 규모 후속 — 판매·할인 경계 틱. 상태를 바꾸지 않는다는 것이 계약이다.

begin;

insert into public.verticals (key, label, color) values ('gsb', '경계 틱', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('gsb-ip', '경계 틱 IP', 'gsb') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, sale_starts_at, sale_ends_at, discount_kind, discount_value, discount_starts_at)
values ('gsb-g1', 'gsb-ip', '경계 상품', '문구', 10000, 'ok', 5,
        now() - interval '30 seconds', now() + interval '1 day', 'percent', 10, now() - interval '20 seconds')
on conflict (id) do nothing;

-- 경계 뷰: 판매 시작·종료·할인 시작 세 줄(할인 종료는 null 이라 없다).
select 1 / case when (
  (select count(*) from private.goods_sale_boundaries where good_id = 'gsb-g1') = 3
  and (select count(*) from private.goods_sale_boundaries where good_id = 'gsb-g1' and kind in ('sale_start', 'discount_start')
       and at > now() - interval '1 minute' and at <= now()) = 2
) then 1 else 0 end as assert_boundaries_view_lists_every_window_edge;

-- 설정(vault)이 없으면 아무 일도 하지 않고 0 — 실패로 적지 않는다. 상태도 그대로다.
select 1 / case when (
  public.goods_sale_boundary_tick() = 0
  and (select public.good_sale_state(good) from public.goods as good where id = 'gsb-g1') = 'on_sale'
  and (select count(*) from public.audit_log where action = 'good.boundary' and target = 'goods:gsb-g1') = 0
) then 1 else 0 end as assert_tick_without_secrets_is_a_noop;

-- 권한: service_role(크론)만 부른다. 경계 뷰는 아무 API 역할도 못 읽는다.
select 1 / case when (
  has_function_privilege('service_role', 'public.goods_sale_boundary_tick()', 'execute')
  and not has_function_privilege('anon', 'public.goods_sale_boundary_tick()', 'execute')
  and not has_function_privilege('authenticated', 'public.goods_sale_boundary_tick()', 'execute')
  and not has_table_privilege('authenticated', 'private.goods_sale_boundaries', 'SELECT')
  and (select count(*) from cron.job where jobname = 'goods-sale-boundary-tick') = 1
) then 1 else 0 end as assert_boundary_tick_acl_and_schedule;

rollback;
