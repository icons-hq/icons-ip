-- 반품입고 파일 반영(QNA-034) — 반품입고 회신 매칭·미리보기·확정.
-- 2026-11-11 사용자 결정(묶음 8): "반품입고 파일 반영" — 계약 전에는 스위치를 끈 채 배포한다(게이트: 서원 반품입고 파일 양식·주기).
-- 오케스트레이터 판단: 서원 양식이 없으므로 파일은 열 이름 대응표(private.return_pickup_settings.intake_columns)로 받고 스위치 OFF.
--
-- 흐름: 앱이 파일(XLSX·비밀번호 XLSX·CSV)을 읽어 대응표로 네 칸(회수 송장·주문번호·연락처·입고일)만 뽑아 보낸다 → DB가 회수 묶음에
-- 맞춘다(미리보기, 바꾸지 않음) → 운영자가 확정하면 회수 묶음마다 T11b·T14a 회수 확인 경로(private.record_order_claim_collection_bundle)로
-- 입고를 기록한다. 실제 입고일 = 파일의 입고일, 근거 = 파일 SHA-256과 행 번호.
--
-- 매칭(④ 엉뚱한 주문을 입고 처리하지 않게):
--  * 회수 송장이 자동 회수 접수의 회수 송장이나 운영자가 기록한 수거 송장과 같으면 그 회수 묶음(들)이다.
--  * 아니면 주문번호와 연락처(끝 8자리)가 함께 맞는 주문의 회수 묶음이다. 주문번호만으로는 맞추지 않는다.
--  * 아직 입고되지 않은 묶음이 정확히 하나일 때만 맞춘다. 반품지가 갈린 배송 건처럼 둘 이상이면 '여러 곳'으로 돌려 상세에서 고르게 한다.
--  * 회수 생략 배송 건(ADR-0041)은 파일로 확정하지 않는다(늦은 입고는 상세에서 확인 — T11b 일괄 계획과 같다).
--  * 한 파일 안에서 같은 묶음을 두 줄이 가리키면 뒤 줄은 '중복'이다. 입고일은 오늘(KST) 이하·주문일 이상이어야 한다.
--  * 응답에는 연락처·주소를 싣지 않는다(파일의 연락처는 대조에만 쓰고 저장하지 않는다).
begin;

create table private.claim_return_intake_imports (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  request_md5 text not null check (request_md5 ~ '^[0-9a-f]{32}$'),
  row_count integer not null check (row_count between 1 and 1000),
  recorded integer not null check (recorded >= 0),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
create index claim_return_intake_imports_file on private.claim_return_intake_imports(file_sha256, created_at desc);
alter table private.claim_return_intake_imports enable row level security;
revoke all on table private.claim_return_intake_imports from public, anon, authenticated, service_role;

-- 행마다 회수 묶음을 찾는다(쓰기 없음). rows: [{rowNumber, trackingNumber?, orderNumber?, phone?, receivedOn('YYYY-MM-DD')}].
create function private.claim_return_intake_match(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare entry jsonb; results jsonb := '[]'::jsonb; used uuid[] := '{}'; seen integer[] := '{}'; row_no integer; tracking text; order_no text;
  phone text; received date; status text; matched_by text; candidates uuid[]; open_bundles uuid[]; bundle public.order_claim_collection_bundles;
  claim public.order_cancellation_requests; order_row public.orders; label text; items text;
  today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise invalid_parameter_value using message = 'invalid_return_intake_rows'; end if;
  for entry in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(entry) is distinct from 'object' or coalesce(entry->>'rowNumber', '') !~ '^[1-9][0-9]{0,6}$'
      or exists(select 1 from jsonb_object_keys(entry) key where key not in ('rowNumber','trackingNumber','orderNumber','phone','receivedOn'))
      or exists(select 1 from jsonb_each(entry) field where field.key <> 'rowNumber' and jsonb_typeof(field.value) not in ('string','null'))
      or char_length(coalesce(entry->>'trackingNumber', '')) > 60 or char_length(coalesce(entry->>'orderNumber', '')) > 60
      or char_length(coalesce(entry->>'phone', '')) > 40 or char_length(coalesce(entry->>'receivedOn', '')) > 10 then
      raise invalid_parameter_value using message = 'invalid_return_intake_rows'; end if;
    row_no := (entry->>'rowNumber')::integer;
    if row_no = any(seen) then raise invalid_parameter_value using message = 'invalid_return_intake_rows'; end if;
    seen := seen || row_no;
    tracking := nullif(upper(regexp_replace(coalesce(entry->>'trackingNumber', ''), '[^A-Za-z0-9]', '', 'g')), '');
    order_no := nullif(regexp_replace(coalesce(entry->>'orderNumber', ''), '[^0-9]', '', 'g'), '');
    phone := nullif(regexp_replace(coalesce(entry->>'phone', ''), '[^0-9]', '', 'g'), '');
    status := null; matched_by := null; received := null; candidates := '{}'; bundle := null; claim := null; order_row := null;
    if coalesce(entry->>'receivedOn', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then status := 'received_on_invalid';
    else
      begin received := to_date(entry->>'receivedOn', 'YYYY-MM-DD');
      exception when others then status := 'received_on_invalid'; end;
      if status is null and to_char(received, 'YYYY-MM-DD') <> entry->>'receivedOn' then status := 'received_on_invalid'; end if;
      if status is null and received > today then status := 'received_on_future'; end if;
    end if;
    if status is null then
      if tracking is not null then
        select coalesce(array_agg(distinct p.bundle_id), '{}') into candidates from private.claim_return_pickups p
        where p.tracking_number = tracking and p.state in ('requested','collected');
        if cardinality(candidates) = 0 then
          select coalesce(array_agg(distinct b.id), '{}') into candidates from private.claim_collection_plans plan
          join public.order_claim_collection_bundles b on b.claim_id = plan.claim_id and b.shipment_id = plan.shipment_id
          where plan.tracking_number = tracking;
        end if;
        if cardinality(candidates) > 0 then matched_by := 'tracking'; end if;
      end if;
      if cardinality(candidates) = 0 and order_no is not null and char_length(coalesce(phone, '')) >= 8 then
        select coalesce(array_agg(b.id), '{}') into candidates from public.orders o
        join public.order_cancellation_requests c on c.order_id = o.id and c.claim_type in ('return','exchange')
        join public.order_claim_collection_bundles b on b.claim_id = c.id
        where o.order_number = order_no
          and (right(regexp_replace(coalesce(private.operational_order_address(o.id)->>'phone', ''), '[^0-9]', '', 'g'), 8) = right(phone, 8)
            or exists(select 1 from private.seller_order_claim_intakes intake where intake.claim_id = c.id
              and right(regexp_replace(coalesce(intake.payload#>>'{collectionAddress,phone}', ''), '[^0-9]', '', 'g'), 8) = right(phone, 8)));
        if cardinality(candidates) > 0 then matched_by := 'order_phone'; end if;
      end if;
      if cardinality(candidates) = 0 then
        status := case when tracking is null and order_no is not null and char_length(coalesce(phone, '')) < 8 then 'phone_required' else 'not_found' end;
      else
        select coalesce(array_agg(b.id order by b.created_at, b.id), '{}') into open_bundles from public.order_claim_collection_bundles b
        join public.order_cancellation_requests c on c.id = b.claim_id
        where b.id = any(candidates) and b.collected_at is null and c.stage not in ('withdrawn','rejected','completed');
        if cardinality(open_bundles) = 0 then
          select b.* into bundle from public.order_claim_collection_bundles b where b.id = any(candidates)
          order by b.collected_at desc nulls last, b.id limit 1;
          status := case when bundle.collected_at is not null then 'already_collected' else 'not_collectable' end;
        elsif cardinality(open_bundles) > 1 then
          status := 'ambiguous';
          select b.* into bundle from public.order_claim_collection_bundles b where b.id = open_bundles[1];
        else
          select b.* into bundle from public.order_claim_collection_bundles b where b.id = open_bundles[1];
        end if;
      end if;
    end if;
    if bundle.id is not null then
      select * into claim from public.order_cancellation_requests where id = bundle.claim_id;
      select * into order_row from public.orders where id = claim.order_id;
      if status is null then
        if claim.stage not in ('collecting','collected','processing','needs_review') then status := 'not_collectable';
        elsif private.claim_collection_waived(claim.id, bundle.shipment_id) then status := 'waived';
        elsif received < (order_row.created_at at time zone 'Asia/Seoul')::date then status := 'received_on_before_order';
        elsif bundle.id = any(used) then status := 'duplicate';
        else status := 'matched'; used := used || bundle.id;
        end if;
      end if;
      select coalesce(nullif(bundle.return_name_snapshot, ''), x.origin_name_snapshot) into label from public.order_claim_collections x
      where x.claim_id = bundle.claim_id and x.shipment_id = bundle.shipment_id;
      select string_agg((j.value->>'name') || ' ' || (j.value->>'qty') || '개', ', ' order by j.ordinality) into items
      from jsonb_array_elements(bundle.items_snapshot) with ordinality j;
    end if;
    results := results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('rowNumber', row_no, 'status', status, 'matchedBy', matched_by,
      'trackingNumber', tracking, 'receivedOn', case when received is null then null else to_char(received, 'YYYY-MM-DD') end,
      'claimId', claim.id, 'claimType', claim.claim_type, 'claimReference', claim.reference, 'orderId', order_row.id, 'orderNumber', order_row.order_number,
      'bundleId', bundle.id, 'shipmentId', bundle.shipment_id, 'returnLabel', case when bundle.id is null then null else label end,
      'items', case when bundle.id is null then null else items end)));
  end loop;
  return results;
end $$;
revoke all on function private.claim_return_intake_match(jsonb) from public, anon, authenticated, service_role;

-- 미리보기(쓰기 없음). 꺼져 있으면 거절한다.
create function public.admin_preview_claim_return_intake(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare settings private.return_pickup_settings; matches jsonb;
begin
  perform private.require_operator_capability('sales.manage', false);
  select * into settings from private.return_pickup_settings where singleton;
  if not found or not settings.intake_enabled then raise check_violation using message = 'claim_return_intake_disabled'; end if;
  matches := private.claim_return_intake_match(p_rows);
  return jsonb_build_object('rows', matches, 'counts', coalesce((select jsonb_object_agg(t.status, t.n)
    from (select value->>'status' status, count(*) n from jsonb_array_elements(matches) group by 1) t), '{}'::jsonb));
end $$;
revoke all on function public.admin_preview_claim_return_intake(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_preview_claim_return_intake(jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_preview_claim_return_intake(jsonb)'::regprocedure, 'sales.manage', 'read', false);

-- 확정. rows는 미리보기에 보낸 줄에 운영자가 확인한 묶음(bundleId, 확정하지 않을 줄은 null)을 더한 것이다. DB가 다시 맞춰 보고
-- 미리보기와 같은 묶음일 때만 회수 확인을 기록한다(달라졌으면 'changed'). 줄마다 따로 기록해 한 줄의 실패가 다른 줄을 막지 않는다.
-- 주문 순서로 처리해 다른 회수 확인과 같은 잠금 순서(주문 → 배송 건 → 클레임 → 회수 행 → 묶음)를 지킨다.
-- 같은 operation 재전송은 저장된 결과를 돌려준다(요청이 다르면 충돌).
create function public.admin_confirm_claim_return_intake(p_rows jsonb, p_file_sha256 text, p_operation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); settings private.return_pickup_settings; prior private.claim_return_intake_imports; request_md5 text;
  matches jsonb; item record; outcome text; error_code text; results jsonb := '[]'::jsonb; recorded integer := 0; changed integer := 0;
  failed integer := 0; skipped integer := 0; recorded_bundles uuid[] := '{}'; result jsonb;
begin
  perform private.require_operator_capability('sales.manage', false);
  if actor is null or not public.has_operator_capability('sales.manage', false) then raise insufficient_privilege using message = 'staff required'; end if;
  select * into settings from private.return_pickup_settings where singleton;
  if not found or not settings.intake_enabled then raise check_violation using message = 'claim_return_intake_disabled'; end if;
  if p_operation is null or coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 1000
    or exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r) is distinct from 'object' or not (r ? 'bundleId')
      or (r->'bundleId' <> 'null'::jsonb and coalesce(r->>'bundleId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    raise invalid_parameter_value using message = 'invalid_return_intake_rows'; end if;
  perform pg_advisory_xact_lock(hashtextextended('claim-return-intake:' || p_operation::text, 0));
  request_md5 := md5(jsonb_build_array(p_rows, p_file_sha256)::text);
  select * into prior from private.claim_return_intake_imports where id = p_operation;
  if found then
    if prior.actor_id <> actor or prior.request_md5 <> request_md5 then raise sqlstate 'PT409' using message = 'claim_return_intake_conflict'; end if;
    return prior.result || jsonb_build_object('replayed', true);
  end if;
  matches := private.claim_return_intake_match((select jsonb_agg(r.value - 'bundleId' order by r.ordinality) from jsonb_array_elements(p_rows) with ordinality r));
  for item in
    select m.value match, nullif(r.value->>'bundleId', '')::uuid expected
    from jsonb_array_elements(matches) m
    join jsonb_array_elements(p_rows) r on (r.value->>'rowNumber')::integer = (m.value->>'rowNumber')::integer
    order by m.value->>'orderId' nulls last, (m.value->>'rowNumber')::integer
  loop
    error_code := null;
    if item.expected is null then outcome := 'skipped'; skipped := skipped + 1;
    elsif item.match->>'status' <> 'matched' or (item.match->>'bundleId')::uuid <> item.expected then outcome := 'changed'; changed := changed + 1;
    else
      begin
        perform private.record_order_claim_collection_bundle((item.match->>'claimId')::uuid, null, item.expected,
          format('반품입고 회신 파일 SHA-256 %s · %s행', p_file_sha256, item.match->>'rowNumber'), (item.match->>'receivedOn')::date);
        outcome := 'recorded'; recorded := recorded + 1; recorded_bundles := recorded_bundles || item.expected;
      exception when others then
        outcome := 'failed'; failed := failed + 1;
        error_code := case when sqlerrm ~ '^[a-z][a-z0-9_]{1,63}$' then sqlerrm else 'unexpected' end;
      end;
    end if;
    results := results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('rowNumber', (item.match->>'rowNumber')::integer, 'outcome', outcome,
      'status', item.match->>'status', 'errorCode', error_code, 'claimId', item.match->>'claimId', 'claimType', item.match->>'claimType',
      'claimReference', item.match->'claimReference', 'orderNumber', item.match->>'orderNumber', 'bundleId', item.match->>'bundleId',
      'returnLabel', item.match->>'returnLabel', 'receivedOn', item.match->>'receivedOn')));
  end loop;
  result := jsonb_build_object('operationId', p_operation, 'fileSha256', p_file_sha256, 'recorded', recorded, 'changed', changed, 'failed', failed,
    'skipped', skipped, 'rows', (select jsonb_agg(value order by (value->>'rowNumber')::integer) from jsonb_array_elements(results)), 'replayed', false);
  insert into private.claim_return_intake_imports(id, actor_id, file_sha256, request_md5, row_count, recorded, result)
  values (p_operation, actor, p_file_sha256, request_md5, jsonb_array_length(p_rows), recorded, result);
  insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.order.claim_return_intake_confirmed', 'claim_return_intake:' || p_operation,
    jsonb_build_object('operationId', p_operation, 'fileSha256', p_file_sha256, 'rows', jsonb_array_length(p_rows), 'recorded', recorded,
      'changed', changed, 'failed', failed, 'skipped', skipped, 'bundleIds', to_jsonb(recorded_bundles)));
  return result;
end $$;
revoke all on function public.admin_confirm_claim_return_intake(jsonb, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_confirm_claim_return_intake(jsonb, text, uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_confirm_claim_return_intake(jsonb,text,uuid)'::regprocedure, 'sales.manage', 'write', false);

commit;
notify pgrst, 'reload schema';
