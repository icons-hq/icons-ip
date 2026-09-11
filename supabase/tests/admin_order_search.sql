\set ON_ERROR_STOP on

begin;

-- #466 주문 검색 계약: 선택한 원장만 검색하고, 여러 배송 건은 주문 한 행으로
-- 반환한다. 운영 데이터와 충돌하지 않는 별도 UUID를 쓴다.
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000009901', 'authenticated', 'authenticated', 'order-search-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000009902', 'authenticated', 'authenticated', 'order-search-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000009903', 'authenticated', 'authenticated', 'order-search-other@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-000000009901', 'order-search-staff@example.test', 'order_search_staff', '1990-01-01', '{"terms":true,"privacy":true}', now(), 'staff'),
  ('00000000-0000-4000-8000-000000009902', 'order-search-buyer@example.test', 'order_search_buyer', '1990-01-01', '{"terms":true,"privacy":true}', now(), 'user'),
  ('00000000-0000-4000-8000-000000009903', 'order-search-other@example.test', 'order_search_other', '1990-01-01', '{"terms":true,"privacy":true}', now(), 'user')
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.orders (id, user_id, status, total, address, created_at, updated_at)
values
  (
    '70000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000009902',
    'paid', 10000,
    '{"recipientName":"배송검색 수취인","phone":"01000000001","postalCode":"00001","address1":"검색 주소 1"}',
    '2026-09-09 00:00:00+00', '2026-09-09 00:00:00+00'
  ),
  (
    '70000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000009902',
    'paid', 10000,
    '{"recipientName":"배송검색 수취인","phone":"01000000002","postalCode":"00002","address1":"검색 주소 2"}',
    '2026-09-10 00:00:00+00', '2026-09-10 00:00:00+00'
  ),
  (
    '70000000-0000-4000-8000-000000000903',
    '00000000-0000-4000-8000-000000009903',
    'paid', 10000,
    '{"recipientName":"다른 수취인","phone":"01000000003","postalCode":"00003","address1":"다른 주소"}',
    '2026-09-10 00:00:00+00', '2026-09-10 00:00:00+00'
  );

-- 주문 902에는 배송 건이 둘이다. 검색 대상은 배송 건이지만 반환 단위는 주문이어야
-- 하므로, 두 번째 운송장만 맞춰도 주문 902가 한 번만 나와야 한다.
insert into public.order_shipments (
  id, order_id, origin_id, origin_name_snapshot, shipping_fee,
  shipping_fee_snapshot, status, carrier, tracking_number
)
values
  (
    '71000000-0000-4000-8000-000000000901',
    '70000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000042201', '김포', 3000,
    '{}', 'ready', 'hanjin', 'TARGETTRACK901'
  ),
  (
    '71000000-0000-4000-8000-000000000902',
    '70000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000042201', '김포', 3000,
    '{}', 'shipping', 'hanjin', 'TARGETTRACK902'
  ),
  (
    '71000000-0000-4000-8000-000000000903',
    '70000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000042202', '남양주', 0,
    '{}', 'shipping', 'hanjin', 'OTHERTRACK902'
  ),
  (
    '71000000-0000-4000-8000-000000000904',
    '70000000-0000-4000-8000-000000000903',
    '00000000-0000-4000-8000-000000042201', '김포', 3000,
    '{}', 'ready', 'hanjin', 'UNRELATED903'
  );

-- The selector is a staff-only RPC with no public or service-role execute grant.
select 1 / case when (
  not has_function_privilege('anon', 'public.admin_search_orders(text,date,date,text,integer,integer,timestamptz,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_search_orders(text,date,date,text,integer,integer,timestamptz,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_search_orders(text,date,date,text,integer,integer,timestamptz,text)', 'execute')
) then 1 else 0 end as assert_order_search_acl;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009901', true);

-- Field selection, KST date/status filters, page offset, and total_count all stay in
-- the same DB query. The second page is order 901; there are two matching orders.
select 1 / case when (
  (select array_agg(id order by id)
   from public.admin_search_orders(
     p_field := 'recipient', p_query := '배송검색 수취인',
     p_status := 'paid', p_from := '2026-09-09', p_to := '2026-09-10',
     p_limit := 1, p_offset := 1
   )) = array['70000000-0000-4000-8000-000000000901'::uuid]
  and (select total_count
       from public.admin_search_orders(
         p_field := 'recipient', p_query := '배송검색 수취인',
         p_status := 'paid', p_from := '2026-09-09', p_to := '2026-09-10',
         p_limit := 1, p_offset := 1
       )) = 2
) then 1 else 0 end as assert_recipient_search_preserves_filters_and_page;

-- A tracking match across two shipments returns one order and one total-count row.
select 1 / case when (
  (select count(*)
   from public.admin_search_orders(p_field := 'tracking', p_query := 'OTHERTRACK902')) = 1
  and (select count(*)
       from public.admin_search_orders(p_field := 'tracking', p_query := 'OTHER-TRACK-902')) = 1
  and (select count(*)
       from public.admin_search_orders(p_field := 'tracking', p_query := 'OTHERTRACK902')
       where id = '70000000-0000-4000-8000-000000000902') = 1
  and (select total_count
       from public.admin_search_orders(p_field := 'tracking', p_query := 'OTHERTRACK902')) = 1
) then 1 else 0 end as assert_multi_shipment_tracking_is_deduplicated;

-- The legacy whole-query behavior still includes order, nickname, email, recipient,
-- and shipment tracking. Each explicit field narrows it to the selected source.
select 1 / case when (
  (select count(*) from public.admin_search_orders(p_query := '배송검색 수취인')) = 2
  and (select count(*) from public.admin_search_orders(p_field := 'order', p_query := '70000000-0000-4000-8000-000000000901')) = 1
  and (select count(*) from public.admin_search_orders(p_field := 'nickname', p_query := 'order_search_buyer')) = 2
  and (select count(*) from public.admin_search_orders(p_field := 'email', p_query := 'order-search-buyer@example.test')) = 2
  and (select count(*) from public.admin_search_orders(p_field := 'tracking', p_query := 'TARGETTRACK901')) = 1
) then 1 else 0 end as assert_order_search_fields_are_selectable;

-- Unknown selectors are rejected at the server boundary rather than silently changing
-- the meaning of a search URL.
do $$
begin
  begin
    perform public.admin_search_orders(p_field := 'phone', p_query := 'x');
    raise exception 'invalid search field should be rejected';
  exception when check_violation then
    if sqlerrm <> 'invalid order search field' then raise; end if;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009902', true);

do $$
begin
  begin
    perform public.admin_search_orders(p_field := 'tracking', p_query := 'OTHERTRACK902');
    raise exception 'non-staff order search should be rejected';
  exception when insufficient_privilege then
    if sqlerrm <> 'staff required' then raise; end if;
  end;
end;
$$;

rollback;
