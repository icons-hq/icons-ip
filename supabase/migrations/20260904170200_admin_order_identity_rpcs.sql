-- D-3 ③ — 통합검색 · 메모 · 상태 이력 · 외부 참조 RPC (설계서 v2 §1-3)
--
-- 통합검색의 요점: 운영자가 손에 든 종이에 적힌 번호가 무엇이든 그걸로 찾을 수 있어야 한다.
-- 고객은 주문번호를, 창고는 품목주문번호를, ERP 는 저쪽 번호를, 택배사는 송장번호를 부른다.

drop function if exists public.admin_search_orders(text, date, date, text, integer, integer, timestamptz);

create function public.admin_search_orders(
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_confirmed_before timestamptz default null
)
returns table (
  id uuid, order_no text, user_id uuid, buyer_name text, buyer_email text, status public.order_status,
  total bigint, address jsonb, created_at timestamptz, updated_at timestamptz,
  shipping_carrier text, tracking_number text, confirmed_at timestamptz, shipped_at timestamptz,
  delivered_at timestamptz, done_at timestamptz, note_count integer, pinned_note text,
  cancellation_request_id uuid, cancellation_request_status text, cancellation_reason_type text,
  cancellation_requested_at timestamptz, cancellation_decided_at timestamptz,
  cancellation_decision_note text, cancellation_claim_type text, cancellation_stage text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_like text;
  v_digits text;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_status is not null
    and not exists (
      select 1 from unnest(enum_range(null::public.order_status)) as allowed(value)
      where allowed.value::text = p_status
    )
  then
    raise check_violation using message = 'invalid order status filter';
  end if;

  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid order date range';
  end if;

  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'order search query too long';
  end if;

  v_like := '%' || lower(v_query) || '%';
  -- 연락처는 사람이 하이픈을 넣기도 빼기도 한다 — 양쪽에서 숫자만 남겨 견준다.
  -- 다만 **네 자리 이상일 때만** 연락처로 본다. 두세 자리는 어느 번호에나 들어 있어서,
  -- 「SBN-IDENT-1」 같은 외부 번호 검색이 숫자 1 하나로 전체 주문을 긁어 온다(실제로 그랬다).
  v_digits := nullif(regexp_replace(coalesce(v_query, ''), '[^0-9]', '', 'g'), '');
  if v_digits is not null and length(v_digits) < 4 then
    v_digits := null;
  end if;

  return query
  select
    orders.id,
    orders.order_no,
    orders.user_id,
    profile.nickname as buyer_name,
    profile.email as buyer_email,
    orders.status,
    orders.total,
    orders.address,
    orders.created_at,
    orders.updated_at,
    orders.shipping_carrier,
    orders.tracking_number,
    orders.confirmed_at,
    orders.shipped_at,
    orders.delivered_at,
    orders.done_at,
    notes.note_count,
    notes.pinned_note,
    cancellation.id as cancellation_request_id,
    cancellation.status as cancellation_request_status,
    cancellation.reason_type as cancellation_reason_type,
    cancellation.requested_at as cancellation_requested_at,
    cancellation.decided_at as cancellation_decided_at,
    cancellation.decision_note as cancellation_decision_note,
    cancellation.claim_type as cancellation_claim_type,
    cancellation.stage as cancellation_stage,
    count(*) over()::bigint as total_count
  from public.orders as orders
  join public.profiles as profile on profile.id = orders.user_id
  left join lateral (
    select
      request.id, request.status, request.reason_type, request.requested_at,
      request.decided_at, request.decision_note, request.claim_type, request.stage
    from public.order_cancellation_requests as request
    where request.order_id = orders.id
    order by request.requested_at desc, request.id desc
    limit 1
  ) as cancellation on true
  left join lateral (
    select
      count(*)::integer as note_count,
      max(note.body) filter (where note.pinned) as pinned_note
    from public.order_notes as note
    where note.order_id = orders.id
  ) as notes on true
  where (p_status is null or orders.status::text = p_status)
    and (p_from is null or orders.created_at >= (p_from::timestamp at time zone 'Asia/Seoul'))
    and (p_to is null or orders.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul'))
    -- 발주확인 기록이 없는 주문은 지연 목록에 넣지 않는다. confirmed_at이 비어
    -- 있다는 것은 사다리 도입 전 행이라는 뜻이고, 없는 기산점으로 "지연"이라고
    -- 부르면 운영자가 실제로 늦은 주문을 못 찾는다.
    and (p_confirmed_before is null or orders.confirmed_at < p_confirmed_before)
    and (
      v_query is null
      or position(lower(v_query) in lower(orders.order_no)) > 0
      or position(lower(v_query) in lower(orders.id::text)) > 0
      or position(lower(v_query) in lower(coalesce(orders.tracking_number, ''))) > 0
      or position(lower(v_query) in lower(coalesce(profile.email, ''))) > 0
      or position(lower(v_query) in lower(coalesce(profile.nickname, ''))) > 0
      or position(lower(v_query) in lower(coalesce(orders.address ->> 'recipientName', ''))) > 0
      or (
        v_digits is not null
        and position(v_digits in regexp_replace(coalesce(orders.address ->> 'phone', ''), '[^0-9]', '', 'g')) > 0
      )
      or exists (
        select 1 from public.order_items as item
        where item.order_id = orders.id and lower(item.item_no) like v_like
      )
      or exists (
        select 1 from public.order_external_refs as ref
        where ref.order_id = orders.id and lower(ref.value) like v_like
      )
    )
  order by orders.created_at desc, orders.id desc
  limit v_limit
  offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- 메모 · 상태 이력 읽기
-- ---------------------------------------------------------------------------
create or replace function public.admin_order_notes(p_order_id uuid)
returns table (
  id uuid, kind text, body text, pinned boolean,
  author_id uuid, author_name text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  return query
  select note.id, note.kind, note.body, note.pinned, note.author_id,
         coalesce(author.nickname, '(알 수 없음)'), note.created_at
  from public.order_notes as note
  left join public.profiles as author on author.id = note.author_id
  where note.order_id = p_order_id
  -- 고정한 메모가 먼저. 나머지는 최근 것부터.
  order by note.pinned desc, note.created_at desc, note.id desc;
end;
$$;

create or replace function public.admin_order_status_events(p_order_id uuid)
returns table (
  id uuid, from_status public.order_status, to_status public.order_status,
  actor_id uuid, actor_name text, note text, source text, occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  return query
  select event.id, event.from_status, event.to_status, event.actor_id,
         coalesce(actor.nickname, case when event.source = 'backfill' then '(이관 기록)' else '(시스템)' end),
         event.note, event.source, event.occurred_at
  from public.order_status_events as event
  left join public.profiles as actor on actor.id = event.actor_id
  where event.order_id = p_order_id
  order by event.occurred_at, event.id;
end;
$$;

create or replace function public.admin_order_external_refs(p_order_id uuid)
returns table (
  id uuid, kind text, value text, source text, note text,
  recorded_by uuid, recorded_by_name text, recorded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  return query
  select ref.id, ref.kind, ref.value, ref.source, ref.note, ref.recorded_by,
         coalesce(author.nickname, '(알 수 없음)'), ref.recorded_at
  from public.order_external_refs as ref
  left join public.profiles as author on author.id = ref.recorded_by
  where ref.order_id = p_order_id
  order by ref.recorded_at desc, ref.id desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 쓰기
-- ---------------------------------------------------------------------------
create or replace function public.admin_add_order_note(
  p_order_id uuid,
  p_body text,
  p_kind text default 'memo',
  p_pinned boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_note uuid;
begin
  if v_body is null or char_length(v_body) > 2000 then
    raise exception 'note_body_invalid' using errcode = '22023';
  end if;
  if coalesce(p_kind, 'memo') not in ('memo', 'cs') then
    -- status·system 은 시스템이 남기는 종류다. 사람이 그 옷을 입고 쓸 수 없다.
    raise exception 'note_kind_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders as ord where ord.id = p_order_id) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  insert into public.order_notes (order_id, kind, body, pinned, author_id)
  values (p_order_id, coalesce(p_kind, 'memo'), v_body, coalesce(p_pinned, false), v_actor)
  returning id into v_note;

  -- 한 주문에 고정은 하나. 여러 개를 고정하면 목록에 무엇이 뜨는지가 우연이 된다.
  if coalesce(p_pinned, false) then
    update public.order_notes set pinned = false
    where order_id = p_order_id and id <> v_note and pinned;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'order.note.added', 'order:' || p_order_id::text,
          jsonb_build_object('note_id', v_note, 'kind', coalesce(p_kind, 'memo'), 'pinned', coalesce(p_pinned, false)));
  return v_note;
end;
$$;

create or replace function public.admin_set_order_note_pinned(p_note_id uuid, p_pinned boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_order uuid;
begin
  select note.order_id into v_order from public.order_notes as note where note.id = p_note_id;
  if not found then
    raise exception 'note_not_found' using errcode = 'P0002';
  end if;
  if coalesce(p_pinned, false) then
    update public.order_notes set pinned = false where order_id = v_order and pinned;
  end if;
  update public.order_notes set pinned = coalesce(p_pinned, false) where id = p_note_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'order.note.pinned', 'order:' || v_order::text,
          jsonb_build_object('note_id', p_note_id, 'pinned', coalesce(p_pinned, false)));
  return coalesce(p_pinned, false);
end;
$$;

create or replace function public.admin_record_order_external_ref(
  p_order_id uuid,
  p_kind text,
  p_value text,
  p_source text default 'manual',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_owner uuid;
  v_ref uuid;
begin
  if v_value is null or char_length(v_value) > 100 then
    raise exception 'external_ref_invalid' using errcode = '22023';
  end if;
  if p_kind not in ('sabangnet_order', 'erp_shipment', 'erp_sales', 'other') then
    raise exception 'external_ref_kind_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders as ord where ord.id = p_order_id) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  select ref.order_id into v_owner
  from public.order_external_refs as ref
  where ref.kind = p_kind and ref.value = v_value;
  if found and v_owner <> p_order_id then
    -- 저쪽 번호가 이미 다른 주문에 붙어 있다. 어느 쪽이 맞는지는 우리가 판단할 수 없다.
    raise exception 'external_ref_taken' using errcode = '23505';
  end if;

  insert into public.order_external_refs (order_id, kind, value, source, recorded_by, note)
  values (p_order_id, p_kind, v_value, coalesce(p_source, 'manual'), v_actor, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (kind, value) do update set
    source = excluded.source, recorded_by = excluded.recorded_by,
    recorded_at = now(), note = excluded.note
  returning id into v_ref;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'order.external_ref.recorded', 'order:' || p_order_id::text,
          jsonb_build_object('kind', p_kind, 'value', v_value, 'source', coalesce(p_source, 'manual')));
  return v_ref;
end;
$$;

create or replace function public.admin_remove_order_external_ref(p_ref_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_ref public.order_external_refs;
begin
  delete from public.order_external_refs where id = p_ref_id returning * into v_ref;
  if not found then
    raise exception 'external_ref_not_found' using errcode = 'P0002';
  end if;
  -- 외부 참조는 이력이 아니라 가리키는 손가락이다. 잘못 가리켰으면 내리는 게 맞다(기록은 감사 로그에).
  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'order.external_ref.removed', 'order:' || v_ref.order_id::text,
          jsonb_build_object('kind', v_ref.kind, 'value', v_ref.value));
  return true;
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_search_orders(text, date, date, text, integer, integer, timestamptz)',
    'public.admin_order_notes(uuid)',
    'public.admin_order_status_events(uuid)',
    'public.admin_order_external_refs(uuid)',
    'public.admin_add_order_note(uuid, text, text, boolean)',
    'public.admin_set_order_note_pinned(uuid, boolean)',
    'public.admin_record_order_external_ref(uuid, text, text, text, text)',
    'public.admin_remove_order_external_ref(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;
end;
$$;
