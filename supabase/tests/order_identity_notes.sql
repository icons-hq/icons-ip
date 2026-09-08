\set ON_ERROR_STOP on

-- D-3 — 주문 식별키 3중 · 관리자 메모 · 상태 이력 (설계서 v2 §1-3)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000009d1', 'authenticated', 'authenticated', 'ident-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000009d2', 'authenticated', 'authenticated', 'ident-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000009d3', 'authenticated', 'authenticated', 'ident-other@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000009d1', 'ident-buyer@example.test', 'ident_buyer', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-0000000009d2', 'ident-staff@example.test', 'ident_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-0000000009d3', 'ident-other@example.test', 'ident_other', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role;

insert into public.verticals (key, label, color) values ('ident-test', '식별 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('ident-ip', '식별 테스트 IP', 'ident-test') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('ident-g1', 'ident-ip', '식별 테스트 굿즈', '문구', 5000, 'ok', 50)
on conflict (id) do nothing;

insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-0000000009d1', 'ident-g1', 2);
select public.place_order(
  '00000000-0000-4000-8000-0000000009d1'::uuid,
  '{"recipientName":"김주문","phone":"01098765432","postalCode":"06236","address1":"서울특별시 강남구 테헤란로 1","address2":"3층"}'::jsonb,
  '00000000-0000-4000-8000-0000000009e1'::uuid
) as order_a \gset
select set_config('ident.order_a', :'order_a', true);

insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-0000000009d1', 'ident-g1', 1);
select public.place_order(
  '00000000-0000-4000-8000-0000000009d1'::uuid,
  '{"recipientName":"김주문","phone":"01098765432","postalCode":"06236","address1":"서울특별시 강남구 테헤란로 1","address2":"3층"}'::jsonb,
  '00000000-0000-4000-8000-0000000009e2'::uuid
) as order_b \gset
select set_config('ident.order_b', :'order_b', true);

-- ---------------------------------------------------------------------------
-- A. 주문번호 — 같은 날 두 주문은 같은 날짜 · 이어지는 번호를 받는다
-- ---------------------------------------------------------------------------
select 1 / case when (
  (select order_no from public.orders where id = current_setting('ident.order_a')::uuid)
    ~ '^[0-9]{8}-[0-9]{6}$'
  and left((select order_no from public.orders where id = current_setting('ident.order_a')::uuid), 8)
    = to_char((select created_at from public.orders where id = current_setting('ident.order_a')::uuid) at time zone 'Asia/Seoul', 'YYYYMMDD')
  and (select order_no from public.orders where id = current_setting('ident.order_b')::uuid)
    > (select order_no from public.orders where id = current_setting('ident.order_a')::uuid)
) then 1 else 0 end as assert_order_no_is_dated_and_ordered;

-- 품목주문번호는 주문번호를 접두로 하고 주문 안에서 1부터 센다.
select 1 / case when (
  select item.item_no = ord.order_no || '-01'
  from public.order_items as item
  join public.orders as ord on ord.id = item.order_id
  where item.order_id = current_setting('ident.order_a')::uuid
) then 1 else 0 end as assert_item_no_follows_order_no;

-- 주문번호·품목주문번호는 유일하다.
select 1 / case when (
  (select count(*) from public.orders) = (select count(distinct order_no) from public.orders)
  and (select count(*) from public.order_items) = (select count(distinct item_no) from public.order_items)
) then 1 else 0 end as assert_identifiers_are_unique;

-- ---------------------------------------------------------------------------
-- B. 상태 이력 — 어느 경로로 바뀌든 트리거가 남긴다
-- ---------------------------------------------------------------------------
update public.orders set status = 'paid' where id = current_setting('ident.order_a')::uuid;
update public.orders set status = 'confirmed', confirmed_at = now() where id = current_setting('ident.order_a')::uuid;
select 1 / case when (
  select array_agg(event.to_status::text order by event.occurred_at, event.id)
  from public.order_status_events as event
  where event.order_id = current_setting('ident.order_a')::uuid and event.source = 'trigger'
) = array['paid', 'confirmed'] then 1 else 0 end as assert_status_events_follow_transitions;

-- 상태가 안 바뀐 UPDATE 는 사건이 아니다.
update public.orders set total = total where id = current_setting('ident.order_a')::uuid;
select 1 / case when (
  select count(*) from public.order_status_events
  where order_id = current_setting('ident.order_a')::uuid and source = 'trigger'
) = 2 then 1 else 0 end as assert_no_event_without_status_change;

-- ---------------------------------------------------------------------------
-- C. 메모 — 덧붙이기만 하고, 고정은 주문당 하나
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009d2', true);

select public.admin_add_order_note(current_setting('ident.order_a')::uuid, '고객 통화 — 주소 확인 요청', 'cs', true) as note_1 \gset
select public.admin_add_order_note(current_setting('ident.order_a')::uuid, '주소 정정 완료', 'memo', true) as note_2 \gset
select 1 / case when (
  (select count(*) from public.order_notes where order_id = current_setting('ident.order_a')::uuid and pinned) = 1
  and (select pinned from public.order_notes where id = :'note_2'::uuid)
  and not (select pinned from public.order_notes where id = :'note_1'::uuid)
) then 1 else 0 end as assert_only_one_pinned_note;

-- 사람이 시스템 종류를 입을 수 없다.
do $$
begin
  perform public.admin_add_order_note(current_setting('ident.order_a')::uuid, '시스템인 척', 'system', false);
  raise exception 'system note kind must be rejected';
exception when others then
  if sqlerrm <> 'note_kind_invalid' then raise; end if;
end $$;

-- 빈 메모도 거절한다.
do $$
begin
  perform public.admin_add_order_note(current_setting('ident.order_a')::uuid, '   ', 'memo', false);
  raise exception 'blank note must be rejected';
exception when others then
  if sqlerrm <> 'note_body_invalid' then raise; end if;
end $$;
reset role;

-- 내용은 고칠 수 없고 지울 수도 없다. 고정만 바뀐다.
select set_config('ident.note_1', :'note_1', true);
do $$
begin
  update public.order_notes set body = '조작' where id = current_setting('ident.note_1')::uuid;
  raise exception 'note body must be immutable';
exception when others then
  if sqlerrm <> 'order_notes_append_only' then raise; end if;
end $$;
do $$
begin
  delete from public.order_notes where id = current_setting('ident.note_1')::uuid;
  raise exception 'note must not be deletable';
exception when others then
  if sqlerrm <> 'order_notes_append_only' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- D. 외부 참조 — 저쪽 번호는 저쪽에서 유일하다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009d2', true);
select public.admin_record_order_external_ref(
  current_setting('ident.order_a')::uuid, 'sabangnet_order', 'SBN-IDENT-1', 'manual', '사방넷 회신'
) as ref_1 \gset
-- 같은 주문에 같은 번호를 다시 적으면 갱신이다(중복 행이 생기지 않는다).
select public.admin_record_order_external_ref(
  current_setting('ident.order_a')::uuid, 'sabangnet_order', 'SBN-IDENT-1', 'import', '재확인'
) as ref_again \gset
select 1 / case when :'ref_1' = :'ref_again'
  and (select count(*) from public.order_external_refs where order_id = current_setting('ident.order_a')::uuid) = 1
  then 1 else 0 end as assert_external_ref_is_idempotent;

-- 다른 주문이 같은 번호를 가져가려 하면 막는다 — 어느 쪽이 맞는지 우리는 모른다.
do $$
begin
  perform public.admin_record_order_external_ref(
    current_setting('ident.order_b')::uuid, 'sabangnet_order', 'SBN-IDENT-1', 'manual', null
  );
  raise exception 'external ref must not be shared across orders';
exception when others then
  if sqlerrm <> 'external_ref_taken' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- E. 통합검색 — 손에 든 번호가 무엇이든 찾는다
-- ---------------------------------------------------------------------------
select order_no as order_a_no from public.orders where id = current_setting('ident.order_a')::uuid \gset
select item_no as item_a_no from public.order_items where order_id = current_setting('ident.order_a')::uuid limit 1 \gset

select count(*) as by_order_no from public.admin_search_orders(null, null, null, :'order_a_no', 20, 0) \gset
select count(*) as by_item_no from public.admin_search_orders(null, null, null, :'item_a_no', 20, 0) \gset
select count(*) as by_external from public.admin_search_orders(null, null, null, 'SBN-IDENT-1', 20, 0) \gset
select count(*) as by_recipient from public.admin_search_orders(null, null, null, '김주문', 20, 0) \gset
-- 운영자는 하이픈을 넣어 치고 저장된 값에는 없다. 양쪽에서 숫자만 남겨 견준다.
select count(*) as by_phone from public.admin_search_orders(null, null, null, '010-9876-5432', 20, 0) \gset
select 1 / case when (
  :'by_order_no'::integer = 1 and :'by_item_no'::integer = 1
  and :'by_external'::integer = 1 and :'by_recipient'::integer = 2
  and :'by_phone'::integer = 2
) then 1 else 0 end as assert_unified_search_finds_every_key;

-- 숫자 한두 자리는 연락처로 보지 않는다. 그러지 않으면 「1」이 들어간 외부 번호 검색이
-- 연락처에 1이 있는 주문을 전부 긁어 온다(실제로 그랬다).
select count(*) as by_stray_digit from public.admin_search_orders(null, null, null, 'ZZZ-9', 20, 0) \gset
select 1 / case when :'by_stray_digit'::integer = 0 then 1 else 0 end as assert_short_digits_are_not_a_phone;

-- 목록은 메모 개수와 고정 메모 한 줄을 함께 준다.
select note_count as a_notes, coalesce(pinned_note, '') as a_pinned
from public.admin_search_orders(null, null, null, :'order_a_no', 20, 0) \gset
select 1 / case when :'a_notes'::integer = 2 and :'a_pinned' = '주소 정정 완료'
  then 1 else 0 end as assert_list_carries_note_summary;

-- 클레임 목록도 같은 주문번호를 부른다(사람이 화면 사이를 오간다).
select 1 / case when (
  select pg_get_function_result('public.admin_search_order_claims'::regproc)::text
) like '%order_no text%' then 1 else 0 end as assert_claim_list_carries_order_no;
reset role;

-- ---------------------------------------------------------------------------
-- F. 권한 — 스태프만 읽고 쓴다
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_add_order_note(uuid,text,text,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.admin_add_order_note(uuid,text,text,boolean)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_record_order_external_ref(uuid,text,text,text,text)', 'execute')
  and not has_table_privilege('authenticated', 'public.order_notes', 'insert')
  and not has_table_privilege('anon', 'public.order_status_events', 'select')
) then 1 else 0 end as assert_order_record_acl;

-- 스태프가 아니면 RPC 자체가 막힌다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009d3', true);
do $$
begin
  perform public.admin_add_order_note(current_setting('ident.order_a')::uuid, '남의 주문', 'memo', false);
  raise exception 'non-staff must not write order notes';
exception when insufficient_privilege then null;
  when others then
    if sqlerrm not in ('forbidden', 'auth_required') then raise; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 발송지연 일괄 안내 (현업 슬라이스 3)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009d2', true);

do $$
declare
  v_orders uuid[] := array[
    current_setting('ident.order_a')::uuid,
    current_setting('ident.order_b')::uuid
  ];
  v_count integer;
begin
  -- 사유 없이는 보낼 수 없다. 「늦어집니다」만 가는 안내는 문의를 늘린다.
  begin
    perform public.admin_bulk_note_dispatch_delay(v_orders, '   ', null, false, gen_random_uuid());
    raise exception 'expected an empty reason to be rejected';
  exception when check_violation then null;
  end;

  begin
    perform public.admin_bulk_note_dispatch_delay(array[]::uuid[], '사유', null, false, gen_random_uuid());
    raise exception 'expected an empty selection to be rejected';
  exception when check_violation then null;
  end;

  v_count := public.admin_bulk_note_dispatch_delay(
    v_orders, '공급사 입고 지연', current_date + 3, true, gen_random_uuid()
  );
  if v_count <> 2 then
    raise exception 'bulk delay should touch every selected order';
  end if;

  -- 같은 사유·예정일로 두 번 눌러도 알림은 하나다.
  perform public.admin_bulk_note_dispatch_delay(
    v_orders, '공급사 입고 지연', current_date + 3, true, gen_random_uuid()
  );
end;
$$;
reset role;

-- 알림 확인은 역할을 내려놓고 한다 — staff 는 남의 알림함을 RLS 로 못 본다.
select 1 / case when (
  (select count(*) from public.order_dispatch_delays
   where order_id in (current_setting('ident.order_a')::uuid, current_setting('ident.order_b')::uuid)
     and reason = '공급사 입고 지연') = 2
) then 1 else 0 end as assert_bulk_delay_records_every_order;

select 1 / case when (
  (select count(*) from public.notifications
   where type = 'order_dispatch_delayed'
     and source_id in (current_setting('ident.order_a'), current_setting('ident.order_b'))) = 2
) then 1 else 0 end as assert_bulk_delay_notifies_once_per_order;

rollback;
