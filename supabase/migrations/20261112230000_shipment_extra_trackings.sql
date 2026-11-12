-- 배송 건 추가(연결) 운송장 — QNA-019(서원 회신 C7 "부피가 큰 상품은 … 분리배송되며 별도 연결 송장을 현장에서 출력해서 포장")
-- 2026-11-11 사용자 결정(no-question): 배송 건에 추가 운송장 목록을 두고, 서원 회신의 같은 배송 건 다른 송장번호를
-- '대표 + 추가'로 저장한다(지금까지는 '대표 송장 하나로' 거절). 대표 운송장은 지금처럼 order_shipments.carrier·tracking_number에
-- 남고(출고·메일·조회·정정 계약 불변), 추가 운송장은 아래 표에만 있다. 오케스트레이터 판단(④): 회신 파일 오기를 정정할 길이
-- 있어야 하므로 운영자가 사유와 함께 추가 운송장을 더하고 지울 수 있고, 모든 변경은 이력(private)과 감사 기록에 남는다.
--
-- 다른 고객의 상자 번호가 붙으면 배송조회로 그 수령인의 정보가 드러나므로(개인정보), 합포장 묶음 밖의 다른 배송 건이 대표·추가로
-- 쓰는 번호는 추가 운송장으로 받지 않는다. 김포·ICONS 표준 양식·일반 세 칸 회신의 '한 배송 건 한 운송장' 규칙은 그대로다
-- (요청 원문은 서원 분리배송이고, 다른 출고지는 운영자 추가로 같은 결과를 남긴다).
--
-- 웨이브 1이 고친 함수(T03·T05·T06)는 통합 브랜치 본문에서 앵커 치환으로만 바꾼다: 앵커가 정확히 한 번 나오지 않으면 멈추고,
-- sales.dispatch·sales.read 능력 검사 줄은 건드리지 않는다. 같은 migration 끝에서 운영자 계약 지문을 다시 적는다.
begin;

-- 1. 추가 운송장(지금 붙어 있는 것만). 지운 운송장은 이력 표에만 남는다.
create table public.order_shipment_extra_trackings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  shipment_id uuid not null,
  carrier text not null references public.shipping_carriers(code) on delete restrict,
  tracking_number text not null check (tracking_number ~ '^[A-Z0-9]{8,30}$'),
  source text not null check (source in ('warehouse_reply','operator')),
  created_by uuid references public.profiles(id) on delete set null,
  -- 한 트랜잭션에서 여러 개를 붙여도 나온 순서가 남게 문장 시각이 아니라 실제 시각을 쓴다(표시 순서 = created_at, id).
  created_at timestamptz not null default clock_timestamp(),
  constraint order_shipment_extra_trackings_shipment_fkey foreign key (order_id, shipment_id)
    references public.order_shipments(order_id, id) on delete cascade,
  constraint order_shipment_extra_trackings_unique unique (shipment_id, carrier, tracking_number)
);
create index order_shipment_extra_trackings_order_idx on public.order_shipment_extra_trackings(order_id);
create index order_shipment_extra_trackings_number_idx on public.order_shipment_extra_trackings(carrier, tracking_number);
comment on table public.order_shipment_extra_trackings is
  '배송 건의 추가(연결) 운송장(QNA-019). 대표 운송장은 order_shipments에 있다. 쓰기는 회신 반입·운영자 RPC만, 읽기는 주문 본인·주문 조회 운영자(RLS).';
alter table public.order_shipment_extra_trackings enable row level security;
revoke all on table public.order_shipment_extra_trackings from public, anon, authenticated, service_role;
grant select on table public.order_shipment_extra_trackings to authenticated, service_role;
-- order_shipments와 같은 읽기 규칙: 주문 조회 운영자 또는 주문 본인. 선물 주문의 수령인 정보 보호(restrictive)도 같다.
create policy order_shipment_extra_trackings_owner_staff_read on public.order_shipment_extra_trackings
  for select to authenticated
  using (public.has_operator_capability('sales.read') or exists(select 1 from public.orders o
    where o.id = order_shipment_extra_trackings.order_id and o.user_id = (select auth.uid())));
create policy gift_shipment_extra_trackings_private_read on public.order_shipment_extra_trackings
  as restrictive for select to authenticated
  using (public.gift_direct_order_read_allowed(order_id));

-- 2. 추가·삭제 이력(사유·처리자·operation ID). 감사 기록(audit_log)과 함께 남긴다.
create table private.order_shipment_tracking_changes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  shipment_id uuid not null references public.order_shipments(id) on delete cascade,
  action text not null check (action in ('added','removed')),
  carrier text not null,
  tracking_number text not null,
  source text not null check (source in ('warehouse_reply','operator')),
  reason text check (reason is null or char_length(reason) between 1 and 500),
  actor_id uuid references public.profiles(id) on delete set null,
  operation_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  check (source = 'warehouse_reply' or (reason is not null and operation_id is not null))
);
create index order_shipment_tracking_changes_shipment_idx on private.order_shipment_tracking_changes(shipment_id, created_at);
alter table private.order_shipment_tracking_changes enable row level security;
revoke all on table private.order_shipment_tracking_changes from public, anon, authenticated, service_role;

-- 3. 공용 판정
-- 운송장번호 표기 정규화(공백·하이픈 제거, 대문자). 회신·운영자 입력이 같은 규칙을 쓴다.
create function private.normalize_tracking_number(p_value text) returns text
language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]-]', '', 'g')), '');
$$;
revoke all on function private.normalize_tracking_number(text) from public, anon, authenticated, service_role;

-- 합포장 묶음 밖의 다른 배송 건이 대표 또는 추가 운송장으로 쓰는 번호인가.
create function private.shipment_tracking_in_use_elsewhere(p_shipment uuid, p_carrier text, p_tracking text) returns boolean
language sql stable security definer set search_path = '' as $$
  with scope as (select unnest(private.shipment_pack_scope(array[p_shipment])) id)
  select exists(select 1 from public.order_shipments s where s.carrier = p_carrier and s.tracking_number = p_tracking
      and s.id not in (select id from scope))
    or exists(select 1 from public.order_shipment_extra_trackings x where x.carrier = p_carrier and x.tracking_number = p_tracking
      and x.shipment_id not in (select id from scope));
$$;
revoke all on function private.shipment_tracking_in_use_elsewhere(uuid, text, text) from public, anon, authenticated, service_role;

-- 배송 건의 지금 추가 운송장 번호(등록 순). 서원 회신 대조 후보에 싣는다.
create function private.shipment_extra_tracking_numbers(p_shipment uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.tracking_number order by x.created_at, x.id), '[]'::jsonb)
  from public.order_shipment_extra_trackings x where x.shipment_id = p_shipment;
$$;
revoke all on function private.shipment_extra_tracking_numbers(uuid) from public, anon, authenticated, service_role;

-- 배송 건의 추가 운송장 택배사·번호(등록 순). 선물 수령인 화면(private.gift_detail)이 쓴다.
create function private.shipment_extra_tracking_pairs(p_shipment uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('carrier', x.carrier, 'trackingNumber', x.tracking_number) order by x.created_at, x.id), '[]'::jsonb)
  from public.order_shipment_extra_trackings x where x.shipment_id = p_shipment;
$$;
revoke all on function private.shipment_extra_tracking_pairs(uuid) from public, anon, authenticated, service_role;

-- 회신 행의 extraTrackingNumbers(선택)를 정규화한다. 대표와 같거나 겹치는 번호, 형식 오류, 19개 초과(대표 포함 20개)는 거절한다.
create function private.reply_extra_tracking_numbers(p_extras jsonb, p_representative text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare value jsonb; normalized text; result text[] := '{}'::text[];
begin
  if p_extras is null or p_extras = 'null'::jsonb then return result; end if;
  if jsonb_typeof(p_extras) <> 'array' or jsonb_array_length(p_extras) > 19 then
    raise invalid_parameter_value using message = 'invalid_tracking_row'; end if;
  for value in select entry from jsonb_array_elements(p_extras) entry loop
    if jsonb_typeof(value) <> 'string' then raise invalid_parameter_value using message = 'invalid_tracking_row'; end if;
    normalized := private.normalize_tracking_number(value #>> '{}');
    if normalized is null or normalized !~ '^[A-Z0-9]{8,30}$' then raise check_violation using message = 'invalid_tracking_input'; end if;
    if normalized = p_representative or normalized = any(result) then raise invalid_parameter_value using message = 'invalid_tracking_row'; end if;
    result := array_append(result, normalized);
  end loop;
  return result;
end $$;
revoke all on function private.reply_extra_tracking_numbers(jsonb, text) from public, anon, authenticated, service_role;

-- 서원 회신 반입 전 검사(배송 건은 호출자가 이미 잠갔다). 발송 대기 건은 추가 운송장이 다른 배송 건에 쓰이지 않아야 하고,
-- 이미 발송된 건(다른 운영자가 같은 회신을 먼저 등록)은 회신의 추가 운송장이 모두 이미 붙어 있어야 한다 — 덮어쓰거나 더하지 않는다.
create function private.assert_reply_extra_trackings(p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare row_value jsonb; shipment public.order_shipments; extras text[]; number text;
begin
  for row_value in select value from jsonb_array_elements(p_rows) loop
    if not (row_value ? 'extraTrackingNumbers') then continue; end if;
    select * into strict shipment from public.order_shipments where id = (row_value->>'reference')::uuid;
    extras := private.reply_extra_tracking_numbers(row_value->'extraTrackingNumbers', private.normalize_tracking_number(row_value->>'trackingNumber'));
    foreach number in array extras loop
      if shipment.status = 'ready' then
        if private.shipment_tracking_in_use_elsewhere(shipment.id, nullif(btrim(row_value->>'carrier'), ''), number) then
          raise check_violation using message = 'tracking_number_in_use'; end if;
      elsif not exists(select 1 from public.order_shipment_extra_trackings x where x.shipment_id = shipment.id
          and x.carrier = shipment.carrier and x.tracking_number = number) then
        raise check_violation using message = 'shipment_tracking_conflict';
      end if;
    end loop;
  end loop;
end $$;
revoke all on function private.assert_reply_extra_trackings(jsonb) from public, anon, authenticated, service_role;

-- 반입이 끝난 행에 추가 운송장을 붙이고 결과 행에 extraTrackingNumbers를 싣는다. 성공한 행이면 모두 붙인다 — 합포장의 다른
-- 구성원 행이 먼저 묶음 전체를 발송해 이 행이 '그대로'(dispatched=false)로 끝나도 이 배송 건의 추가 운송장은 이번 회신의 것이다.
-- 반입 전 검사가 발송 대기 건은 다른 배송 건 번호가 아님을, 이미 발송된 건은 같은 번호가 이미 붙어 있음을 확인했으므로
-- 이미 발송된 건에는 새로 붙는 번호가 없다(덮어쓰거나 더하지 않는다). 결과 행 수·순서는 그대로다.
create function private.attach_reply_extra_trackings(p_rows jsonb, p_results jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare outcome jsonb; input jsonb; shipment public.order_shipments; extras text[]; number text; output jsonb := '[]'::jsonb;
  actor uuid := (select auth.uid()); added integer;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then return p_results; end if;
  for outcome in select value from jsonb_array_elements(p_results) loop
    select r.value into input from jsonb_array_elements(p_rows) r where r.value->>'reference' = outcome->>'reference' limit 1;
    if outcome->>'ok' = 'true' and input is not null and input ? 'extraTrackingNumbers' then
      select * into strict shipment from public.order_shipments where id = (input->>'reference')::uuid;
      extras := private.reply_extra_tracking_numbers(input->'extraTrackingNumbers', shipment.tracking_number);
      added := 0;
      foreach number in array extras loop
        insert into public.order_shipment_extra_trackings(order_id, shipment_id, carrier, tracking_number, source, created_by)
        values (shipment.order_id, shipment.id, shipment.carrier, number, 'warehouse_reply', actor)
        on conflict (shipment_id, carrier, tracking_number) do nothing;
        if found then
          added := added + 1;
          insert into private.order_shipment_tracking_changes(order_id, shipment_id, action, carrier, tracking_number, source, actor_id)
          values (shipment.order_id, shipment.id, 'added', shipment.carrier, number, 'warehouse_reply', actor);
          insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.shipment.extra_tracking_added', 'order:' || shipment.order_id,
            jsonb_build_object('shipmentId', shipment.id, 'originName', shipment.origin_name_snapshot, 'carrier', shipment.carrier,
              'trackingNumber', number, 'source', 'warehouse_reply'));
        end if;
      end loop;
      outcome := outcome || jsonb_build_object('extraTrackingNumbers', to_jsonb(extras), 'extraTrackingsAdded', added);
    end if;
    output := output || jsonb_build_array(outcome);
  end loop;
  return output;
end $$;
revoke all on function private.attach_reply_extra_trackings(jsonb, jsonb) from public, anon, authenticated, service_role;

-- 4. 운영자 추가·삭제. 운송장 정정(admin_update_shipment_tracking)과 같은 출고 권한이고 사유가 필수다.
create function public.admin_add_shipment_extra_tracking(p_shipment_id uuid, p_carrier text, p_tracking_number text, p_reason text, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; shipment public.order_shipments; carrier_value text := nullif(btrim(coalesce(p_carrier, '')), '');
  tracking_value text := private.normalize_tracking_number(p_tracking_number); reason_value text := nullif(btrim(coalesce(p_reason, '')), '');
  previous private.order_shipment_tracking_changes; added public.order_shipment_extra_trackings;
begin
  actor := private.require_operator_capability('sales.dispatch', false);
  if p_shipment_id is null or p_operation_id is null then raise invalid_parameter_value using message = 'invalid_extra_tracking'; end if;
  if reason_value is null or char_length(reason_value) > 500 then raise check_violation using message = 'extra_tracking_reason_required'; end if;
  if carrier_value is null or tracking_value is null or tracking_value !~ '^[A-Z0-9]{8,30}$' then
    raise check_violation using message = 'invalid_tracking_input'; end if;
  select * into previous from private.order_shipment_tracking_changes where operation_id = p_operation_id;
  if found then
    if previous.action <> 'added' or previous.shipment_id <> p_shipment_id or previous.carrier <> carrier_value
      or previous.tracking_number <> tracking_value or previous.actor_id is distinct from actor then
      raise check_violation using message = 'extra_tracking_operation_conflict'; end if;
    return jsonb_build_object('status', 'unchanged', 'shipmentId', previous.shipment_id, 'orderId', previous.order_id);
  end if;
  perform private.lock_parcel_shipment(p_shipment_id);
  select * into shipment from public.order_shipments where id = p_shipment_id;
  if shipment.status not in ('shipping', 'delivered') or exists(select 1 from public.orders where id = shipment.order_id and status = 'canceled') then
    raise check_violation using message = 'order_not_shipped'; end if;
  if shipment.tracking_number is null then raise check_violation using message = 'tracking_required'; end if;
  if not exists(select 1 from public.shipping_carriers where code = carrier_value and is_active) then
    raise check_violation using message = 'inactive_shipping_carrier'; end if;
  if carrier_value = shipment.carrier and tracking_value = shipment.tracking_number then
    raise check_violation using message = 'extra_tracking_is_representative'; end if;
  if exists(select 1 from public.order_shipment_extra_trackings where shipment_id = shipment.id and carrier = carrier_value and tracking_number = tracking_value) then
    raise check_violation using message = 'extra_tracking_duplicate'; end if;
  if (select count(*) from public.order_shipment_extra_trackings where shipment_id = shipment.id) >= 19 then
    raise check_violation using message = 'extra_tracking_limit'; end if;
  if private.shipment_tracking_in_use_elsewhere(shipment.id, carrier_value, tracking_value) then
    raise check_violation using message = 'tracking_number_in_use'; end if;
  insert into public.order_shipment_extra_trackings(order_id, shipment_id, carrier, tracking_number, source, created_by)
  values (shipment.order_id, shipment.id, carrier_value, tracking_value, 'operator', actor) returning * into added;
  insert into private.order_shipment_tracking_changes(order_id, shipment_id, action, carrier, tracking_number, source, reason, actor_id, operation_id)
  values (shipment.order_id, shipment.id, 'added', carrier_value, tracking_value, 'operator', reason_value, actor, p_operation_id);
  insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.shipment.extra_tracking_added', 'order:' || shipment.order_id,
    jsonb_build_object('shipmentId', shipment.id, 'originName', shipment.origin_name_snapshot, 'carrier', carrier_value,
      'trackingNumber', tracking_value, 'source', 'operator', 'reason', reason_value, 'operationId', p_operation_id));
  return jsonb_build_object('status', 'added', 'id', added.id, 'shipmentId', shipment.id, 'orderId', shipment.order_id);
end $$;

create function public.admin_remove_shipment_extra_tracking(p_extra_tracking_id uuid, p_reason text, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; extra public.order_shipment_extra_trackings; shipment public.order_shipments;
  reason_value text := nullif(btrim(coalesce(p_reason, '')), ''); previous private.order_shipment_tracking_changes;
begin
  actor := private.require_operator_capability('sales.dispatch', false);
  if p_extra_tracking_id is null or p_operation_id is null then raise invalid_parameter_value using message = 'invalid_extra_tracking'; end if;
  if reason_value is null or char_length(reason_value) > 500 then raise check_violation using message = 'extra_tracking_reason_required'; end if;
  select * into previous from private.order_shipment_tracking_changes where operation_id = p_operation_id;
  if found then
    if previous.action <> 'removed' or previous.actor_id is distinct from actor then
      raise check_violation using message = 'extra_tracking_operation_conflict'; end if;
    return jsonb_build_object('status', 'unchanged', 'shipmentId', previous.shipment_id, 'orderId', previous.order_id);
  end if;
  select * into extra from public.order_shipment_extra_trackings where id = p_extra_tracking_id;
  if not found then raise no_data_found using message = 'extra_tracking_not_found'; end if;
  perform private.lock_parcel_shipment(extra.shipment_id);
  select * into extra from public.order_shipment_extra_trackings where id = p_extra_tracking_id for update;
  if not found then raise no_data_found using message = 'extra_tracking_not_found'; end if;
  select * into shipment from public.order_shipments where id = extra.shipment_id;
  delete from public.order_shipment_extra_trackings where id = extra.id;
  insert into private.order_shipment_tracking_changes(order_id, shipment_id, action, carrier, tracking_number, source, reason, actor_id, operation_id)
  values (extra.order_id, extra.shipment_id, 'removed', extra.carrier, extra.tracking_number, 'operator', reason_value, actor, p_operation_id);
  insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.shipment.extra_tracking_removed', 'order:' || extra.order_id,
    jsonb_build_object('shipmentId', extra.shipment_id, 'originName', shipment.origin_name_snapshot, 'carrier', extra.carrier,
      'trackingNumber', extra.tracking_number, 'reason', reason_value, 'operationId', p_operation_id));
  return jsonb_build_object('status', 'removed', 'shipmentId', extra.shipment_id, 'orderId', extra.order_id);
end $$;

revoke all on function public.admin_add_shipment_extra_tracking(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_remove_shipment_extra_tracking(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_shipment_extra_tracking(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.admin_remove_shipment_extra_tracking(uuid, text, uuid) to authenticated;

-- 5. 웨이브 1 함수 앵커 치환(각 앵커는 정확히 한 번).
do $patch$
declare
  item record;
  body text;
begin
  for item in select * from (values
    -- 서원 회신 대조 후보: 배송 건의 추가 운송장 번호를 싣고(같은 회신 재등록 판정), 이미 쓰인 번호에 추가 운송장도 넣는다.
    (1, 'public.admin_origin_tracking_candidates(uuid,text[],text[])',
      $a$'carrier',c.carrier,'trackingNumber',c.tracking_number,$a$,
      $r$'carrier',c.carrier,'trackingNumber',c.tracking_number,'extraTrackingNumbers',private.shipment_extra_tracking_numbers(c.id),$r$),
    (2, 'public.admin_origin_tracking_candidates(uuid,text[],text[])',
      $a$from public.order_shipments s where s.carrier=origin.default_carrier and s.tracking_number=any(target_tracking_numbers))$a$,
      $r$from (select s.tracking_number,s.id from public.order_shipments s where s.carrier=origin.default_carrier and s.tracking_number=any(target_tracking_numbers)
     union select x.tracking_number,x.shipment_id from public.order_shipment_extra_trackings x where x.carrier=origin.default_carrier and x.tracking_number=any(target_tracking_numbers)) s)$r$),
    -- 서원 회신 반입: 행의 추가 운송장을 검사한 뒤, 발송한 배송 건에 붙인다.
    (3, 'public.admin_import_seowon_tracking_batch(uuid,jsonb)',
      $a$perform private.prepare_pack_tracking_batch(target_rows);$a$,
      $r$perform private.prepare_pack_tracking_batch(target_rows);
 perform private.assert_reply_extra_trackings(target_rows);$r$),
    (4, 'public.admin_import_seowon_tracking_batch(uuid,jsonb)',
      $a$return public.admin_import_shipment_tracking_batch(target_rows);$a$,
      $r$return private.attach_reply_extra_trackings(target_rows,public.admin_import_shipment_tracking_batch(target_rows));$r$),
    -- 배송현황 검색: 운송장번호 칸이 추가 운송장도 찾는다.
    (5, 'private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text)',
      $a$or (p_field in ('all','tracking') and position(nullif(regexp_replace(lower(needle),'[[:space:]-]','','g'),'') in lower(coalesce(s.tracking_number,'')))>0)$a$,
      $r$or (p_field in ('all','tracking') and position(nullif(regexp_replace(lower(needle),'[[:space:]-]','','g'),'') in lower(coalesce(s.tracking_number,'')))>0)
      or (p_field in ('all','tracking') and exists(select 1 from public.order_shipment_extra_trackings extra where extra.shipment_id=s.id
        and position(nullif(regexp_replace(lower(needle),'[[:space:]-]','','g'),'') in lower(extra.tracking_number))>0))$r$),
    -- 주문 통합검색·탭 건수·거래확정 검색 엑셀의 공용 판정: 운송장번호(또는 전체) 검색이 추가 운송장도 찾는다. 다른 검색 항목(연락처·
    -- 수취인·상품 등)은 추가 운송장을 보지 않도록 자기 검색 항목 조건으로 묶은 별도 항을 대표 운송장 항 뒤에 더한다.
    (6, 'private.admin_sales_order_matches(public.orders,date,date,text,text,text,text)',
      $a$and position(nullif(regexp_replace(lower(p_query),'[[:space:]-]','','g'),'') in lower(coalesce(s.tracking_number,'')))>0))$a$,
      $r$and position(nullif(regexp_replace(lower(p_query),'[[:space:]-]','','g'),'') in lower(coalesce(s.tracking_number,'')))>0))
   or (p_field in ('all','tracking') and exists(select 1 from public.order_shipment_extra_trackings extra where extra.order_id=(p_order).id
     and position(nullif(regexp_replace(lower(p_query),'[[:space:]-]','','g'),'') in lower(extra.tracking_number))>0))$r$),
    -- 상품주문별 조회: 운송장번호(또는 전체) 검색이 그 품목 배송 건의 추가 운송장도 찾는다.
    (7, 'public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)',
      $a$or (p_field in ('all','tracking') and strpos(lower(coalesce(shipment.tracking_number,'')),nullif(regexp_replace(lower(needle),'[[:space:]-]','','g'),''))>0)$a$,
      $r$or (p_field in ('all','tracking') and strpos(lower(coalesce(shipment.tracking_number,'')),nullif(regexp_replace(lower(needle),'[[:space:]-]','','g'),''))>0)
    or (p_field in ('all','tracking') and shipment.id is not null and exists(select 1 from public.order_shipment_extra_trackings extra where extra.shipment_id=shipment.id
      and strpos(lower(extra.tracking_number),nullif(regexp_replace(lower(needle),'[[:space:]-]','','g'),''))>0))$r$),
    -- 선물 수령인 화면: 상자를 받는 수령인에게만 추가 운송장을 싣는다(보내는 분·주문 본인 화면은 지금처럼 운송장이 없다).
    -- 추가 운송장이 있는 배송 건에만 키를 더해, 이 변경 전 앱이 읽는 모양은 추가 운송장이 생기기 전까지 그대로다.
    (8, 'private.gift_detail(uuid,uuid)',
      $a$'trackingNumber',case when gift.recipient_id=p_actor then s.tracking_number else null end)$a$,
      $r$'trackingNumber',case when gift.recipient_id=p_actor then s.tracking_number else null end)
   ||case when gift.recipient_id=p_actor and exists(select 1 from public.order_shipment_extra_trackings x where x.shipment_id=s.id)
     then jsonb_build_object('extraTrackings',private.shipment_extra_tracking_pairs(s.id)) else '{}'::jsonb end$r$)
  ) as target(step, signature, anchor, replacement) order by step
  loop
    body := pg_get_functiondef(item.signature::regprocedure);
    if (length(body) - length(replace(body, item.anchor, ''))) / length(item.anchor) <> 1 then
      raise exception 'shipment_extra_trackings_anchor_changed: % (step %)', item.signature, item.step;
    end if;
    execute replace(body, item.anchor, item.replacement);
  end loop;
end $patch$;

-- 6. 운영자 계약. 바꾼 함수는 등록된 능력·분류를 그대로 두고 지문만 다시 적는다. 새 RPC는 출고 권한이다.
do $contracts$
declare
  signature text;
  fn regprocedure;
  contract record;
begin
  foreach signature in array array[
    'public.admin_origin_tracking_candidates(uuid,text[],text[])',
    'public.admin_import_seowon_tracking_batch(uuid,jsonb)',
    'public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)'
  ] loop
    fn := signature::regprocedure;
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if not found then raise exception 'shipment_extra_trackings_contract_missing: %', signature; end if;
    perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
  end loop;
  foreach signature in array array[
    'private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text)',
    'private.admin_sales_order_matches(public.orders,date,date,text,text,text,text)',
    'private.gift_detail(uuid,uuid)'
  ] loop
    fn := signature::regprocedure;
    if not exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      raise exception 'shipment_extra_trackings_internal_contract_missing: %', signature; end if;
    perform private.register_operator_internal_contract(fn);
  end loop;
  perform private.register_operator_rpc_contract('public.admin_add_shipment_extra_tracking(uuid,text,text,text,uuid)'::regprocedure, 'sales.dispatch', 'write', false);
  perform private.register_operator_rpc_contract('public.admin_remove_shipment_extra_tracking(uuid,text,uuid)'::regprocedure, 'sales.dispatch', 'write', false);
  perform private.register_operator_policy_contract('public.order_shipment_extra_trackings'::regclass, 'order_shipment_extra_trackings_owner_staff_read', 'sales.read');
  perform private.register_operator_policy_contract('public.order_shipment_extra_trackings'::regclass, 'gift_shipment_extra_trackings_private_read', 'sales.read');
end $contracts$;

notify pgrst, 'reload schema';
commit;
