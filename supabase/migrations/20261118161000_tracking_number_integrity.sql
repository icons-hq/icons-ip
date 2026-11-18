-- 운송장 중복·형식 판정(원장 SHP-030·SHP-031·SHP-032·SHP-014).
--
-- 지금까지 운송장 등록은 형식(8~30자 영숫자)만 보고, 다른 주문이 이미 쓰는 번호인지는 서원 회신 대조와 추가 운송장만 봤다.
-- 김포 21열·ICONS 표준 양식·세 칸 회신·수동 입력·운송장 정정·교환 재출고는 다른 고객의 상자 번호를 그대로 받아, 고객이 남의
-- 택배를 조회하고(이름·주소 일부 노출) 택배 추적 자동 배송완료가 엉뚱한 상자를 따라갔다. 오타도 형식만 맞으면 발송 메일로 나갔다.
--
-- 1. 판정은 한 곳이다. `private.assert_tracking_registrable(택배사, 번호, 배송 건들, 주문)`이 형식(공통 + 택배사별)과
--    "다른 주문의 쓰임"을 함께 보고, 같은 번호의 등록은 advisory lock으로 줄 세운다(두 회신이 같은 번호를 동시에 올려도 하나만 통과).
--    쓰임은 대표 운송장(order_shipments)·추가 운송장·교환 재출고(배송 건별 기록과 옛 클레임 단위 기록)다.
--    정상 공유: 같은 주문(분할·추가·재출고), 같은 합포장 묶음(private.shipment_pack_members, 풀리지 않은 구성원), 그리고
--    창고가 같은 받는 분의 발송 대기 건을 한 상자로 묶은 합배송(같은 출고지·받는 분 이름·전화·주소가 같고 아직 배송 중인 배송 건,
--    서원 회신 대조의 합배송 규칙과 같은 경우)이다. 마지막은 받는 사람이 같아 개인정보가 드러나지 않고 같은 상자라 배송완료도 같다.
-- 2. 진입 경로는 모두 이 판정을 지난다. 발송·정정(private.change_packed_shipments가 부르는 두 함수 — 수동 입력·세 칸·김포·표준·서원 회신과
--    옛 주문 단위 RPC가 모두 여기를 지난다), 추가 운송장(운영자·서원 회신), 교환 재출고(배송 건별 기록 함수 — 운영자·연락처 처리 서비스).
--    일괄·회신 반입은 줄(배송 건)마다 savepoint 안에서 실패하므로 파일 전체가 아니라 그 줄만 실패한다. 한 파일 안에서 서로 관계없는
--    배송 건에 같은 번호가 적히면 어느 줄이 맞는지 알 수 없으므로 그 번호의 줄을 모두 실패로 돌린다(먼저 나온 줄이 등록되지 않게).
-- 3. 택배사 레지스트리에 번호 형식(정규식)과 사람이 읽는 규칙을 둔다. 우체국택배는 숫자 13자리(공공데이터포털 우정사업본부
--    종적조회 API의 등기번호 13자리, NHN Cloud 카카오 비즈메시지 문제 해결 가이드의 택배사별 송장번호 형식 표).
--    한진택배는 같은 NHN 표가 숫자 10자리 또는 12자리라고 적지만 한진 공식 안내를 확인하지 못해, 11자리를 거절하지 않도록
--    숫자 10~12자리로 넓게 둔다(오타 중 영문·하이픈 외 문자·자릿수 초과·부족은 여전히 걸린다). 형식이 없는 택배사는 공통 형식만 본다.
-- 4. 김포 21열·표준 양식 회신의 받는 분 이름·전화번호(회신에 있으면)를 주문 배송지와 대조해, 다르면 그 주문(배송 건)의 줄만 실패한다.
--    회신이 이 칸을 보내지 않으면(세 칸 회신·옛 앱) 지금처럼 대조하지 않는다.
-- 5. 이미 등록된 운영 데이터는 소급하지 않는다. 표 제약이 아니라 등록 함수의 판정이고, 바뀌지 않는 번호(배송완료 처리·같은 회신 재업로드)는 다시 보지 않는다.
--
-- 기존 함수는 현재 정의에서 바꿀 줄만 앵커 치환한다(앵커가 정확히 한 번 나오지 않으면 멈춘다). 끝에서 운영자 계약 지문을 다시 적는다.
begin;

create function private.t6_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't6 patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 택배사별 번호 형식. 규칙 문구는 화면이 오류 안내에 그대로 쓴다. 둘 다 있거나 둘 다 없다.
alter table public.shipping_carriers
  add column tracking_number_pattern text,
  add column tracking_number_rule text,
  add constraint shipping_carriers_tracking_number_pattern_check check (
    (tracking_number_pattern is null) = (tracking_number_rule is null)
    and (tracking_number_pattern is null or (
      -- 전체 일치(^…$)만 받는다. 잘못된 정규식은 여기서 평가 오류로 저장되지 않는다.
      tracking_number_pattern ~ '^\^.+\$$' and char_length(tracking_number_pattern) <= 200
      and ('' ~ tracking_number_pattern) is not null))
    and (tracking_number_rule is null or (btrim(tracking_number_rule) <> '' and char_length(tracking_number_rule) <= 60))
  );
comment on column public.shipping_carriers.tracking_number_pattern is
  '운송장번호 형식(정규식, 하이픈·공백을 뺀 대문자 번호에 전체 일치). 비우면 공통 형식(8~30자 영숫자)만 본다. 앱(lib/orders/shipment.ts)과 DB 등록 판정이 같은 값을 쓴다.';
comment on column public.shipping_carriers.tracking_number_rule is '사람이 읽는 운송장번호 형식(오류 안내 문구). 형식 정규식과 함께 둔다.';

-- 운영자가 이미 다른 형식을 적었으면 덮어쓰지 않는다.
update public.shipping_carriers set tracking_number_pattern = '^[0-9]{10,12}$', tracking_number_rule = '숫자 10~12자리'
 where code = 'hanjin' and tracking_number_pattern is null;
update public.shipping_carriers set tracking_number_pattern = '^[0-9]{13}$', tracking_number_rule = '숫자 13자리'
 where code = 'epost' and tracking_number_pattern is null;

-- 2. 쓰임 조회 색인(유일 제약이 아니다 — 기존 행과 정상 공유를 막지 않는다).
create index if not exists order_shipments_carrier_tracking_idx
  on public.order_shipments (carrier, tracking_number) where tracking_number is not null;
create index if not exists order_claim_reshipments_carrier_tracking_idx
  on public.order_claim_reshipments (carrier, tracking_number);
create index if not exists order_cancellation_requests_reship_tracking_idx
  on public.order_cancellation_requests (reship_carrier, reship_tracking_number) where reship_tracking_number is not null;

-- 3. 공용 판정
-- 받는 분 열쇠(이름·전화·우편번호·주소, 공백 무시). 이름이나 전화가 없으면 null — 합배송으로 보지 않는다.
create function private.tracking_destination_key(p_address jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when nullif(regexp_replace(coalesce(p_address->>'recipientName', ''), '[[:space:]]', '', 'g'), '') is null
      or nullif(regexp_replace(coalesce(p_address->>'phone', ''), '[^0-9]', '', 'g'), '') is null then null
    else concat_ws(chr(31),
      lower(regexp_replace(p_address->>'recipientName', '[[:space:]]', '', 'g')),
      regexp_replace(p_address->>'phone', '[^0-9]', '', 'g'),
      regexp_replace(coalesce(p_address->>'postalCode', ''), '[[:space:]]', '', 'g'),
      lower(regexp_replace(coalesce(p_address->>'address1', ''), '[[:space:]]', '', 'g')),
      lower(regexp_replace(coalesce(p_address->>'address2', ''), '[[:space:]]', '', 'g')))
  end;
$$;
revoke all on function private.tracking_destination_key(jsonb) from public, anon, authenticated, service_role;

-- 같은 번호 등록을 줄 세우는 열쇠. 여러 번호는 호출자가 이 열쇠 문자열 순서로 잠근다.
create function private.tracking_number_lock_key(p_carrier text, p_tracking text) returns bigint
language sql immutable set search_path = '' as $$
  select hashtextextended('icons:tracking:' || p_carrier || ':' || p_tracking, 0);
$$;
revoke all on function private.tracking_number_lock_key(text, text) from public, anon, authenticated, service_role;

-- 번호가 그 택배사의 형식에 맞는가(공통 형식 포함). 형식이 없는 택배사는 공통 형식만 본다.
create function private.tracking_number_format_ok(p_carrier text, p_tracking text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_tracking ~ '^[A-Z0-9]{8,30}$', false)
    and coalesce((select p_tracking ~ c.tracking_number_pattern from public.shipping_carriers c
      where c.code = p_carrier and c.tracking_number_pattern is not null), true);
$$;
revoke all on function private.tracking_number_format_ok(text, text) from public, anon, authenticated, service_role;

-- 두 배송 건이 한 운송장을 함께 쓸 수 있는 관계인가: 같은 주문, 같은 합포장 묶음, 같은 출고지·같은 받는 분(합배송).
create function private.tracking_shipments_related(p_first uuid, p_second uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_first = p_second or exists(
    select 1 from public.order_shipments a join public.orders ao on ao.id = a.order_id,
      public.order_shipments b join public.orders bo on bo.id = b.order_id
    where a.id = p_first and b.id = p_second and (
      a.order_id = b.order_id
      or b.id = any(private.shipment_pack_scope(array[a.id]))
      or (a.origin_id = b.origin_id and private.tracking_destination_key(ao.address) is not null
        and private.tracking_destination_key(ao.address) = private.tracking_destination_key(bo.address))));
$$;
revoke all on function private.tracking_shipments_related(uuid, uuid) from public, anon, authenticated, service_role;

-- 이 번호를 쓰는 "다른 주문"의 쓰임 하나(없으면 null). 대상은 배송 건들(합포장 구성원 포함)과/또는 주문이다.
-- 합배송 예외는 배송 중인 택배 배송 건의 대표·추가 운송장에만 적용한다(배송완료된 옛 상자의 번호를 새 주문에 다시 쓰지 않게).
create function private.tracking_number_conflict(p_carrier text, p_tracking text, p_shipments uuid[], p_order uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with target as (
    select s.id, s.order_id, s.origin_id, private.tracking_destination_key(o.address) destination
    from public.order_shipments s join public.orders o on o.id = s.order_id
    where s.id = any(coalesce(p_shipments, '{}'::uuid[]))
  ), allowed as (
    select p_order id where p_order is not null
    union select order_id from target
    union select s.order_id from public.order_shipments s
      where s.id = any(private.shipment_pack_scope(coalesce(p_shipments, '{}'::uuid[])))
  ), uses as (
    select 'shipment' source, s.order_id, s.id shipment_id, s.origin_id, s.status, s.delivery_method
    from public.order_shipments s where s.carrier = p_carrier and s.tracking_number = p_tracking
    union all
    select 'extra', x.order_id, x.shipment_id, s.origin_id, s.status, s.delivery_method
    from public.order_shipment_extra_trackings x join public.order_shipments s on s.id = x.shipment_id
    where x.carrier = p_carrier and x.tracking_number = p_tracking
    union all
    select 'reshipment', r.order_id, r.shipment_id, null, null, null
    from public.order_claim_reshipments r where r.carrier = p_carrier and r.tracking_number = p_tracking
    union all
    select 'reshipment', q.order_id, null, null, null, null
    from public.order_cancellation_requests q where q.reship_carrier = p_carrier and q.reship_tracking_number = p_tracking
  )
  select jsonb_build_object('source', u.source, 'orderId', u.order_id, 'shipmentId', u.shipment_id)
  from uses u
  where u.order_id not in (select id from allowed)
    and not (u.source in ('shipment', 'extra') and u.status = 'shipping' and u.delivery_method = 'parcel' and exists(
      select 1 from target t join public.orders o on o.id = u.order_id
      where t.origin_id = u.origin_id and t.destination is not null
        and t.destination = private.tracking_destination_key(o.address)))
  order by u.source, u.order_id
  limit 1;
$$;
revoke all on function private.tracking_number_conflict(text, text, uuid[], uuid) from public, anon, authenticated, service_role;

-- 등록 판정(모든 진입 경로가 부른다). 공통 형식 → 택배사 형식 → 같은 번호 줄 세우기 → 다른 주문의 쓰임.
create function private.assert_tracking_registrable(p_carrier text, p_tracking text, p_shipments uuid[], p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_carrier is null or p_tracking is null then raise check_violation using message = 'tracking_required'; end if;
  if p_tracking !~ '^[A-Z0-9]{8,30}$' then raise check_violation using message = 'invalid_tracking_input'; end if;
  if not private.tracking_number_format_ok(p_carrier, p_tracking) then
    raise check_violation using message = 'tracking_number_format_mismatch'; end if;
  -- 같은 번호를 동시에 등록하는 두 트랜잭션은 여기서 줄을 선다. 뒤에 온 쪽은 앞의 커밋을 본 뒤 판정한다(READ COMMITTED 문장 스냅샷).
  perform pg_advisory_xact_lock(private.tracking_number_lock_key(p_carrier, p_tracking));
  if private.tracking_number_conflict(p_carrier, p_tracking, p_shipments, p_order) is not null then
    raise check_violation using message = 'tracking_number_in_use'; end if;
end $$;
revoke all on function private.assert_tracking_registrable(text, text, uuid[], uuid) from public, anon, authenticated, service_role;

-- 일괄·회신 반입: 행의 배송 건을 찾는다(찾지 못하면 null — 그 행의 실패는 기존 경로가 정한다).
create function private.tracking_batch_shipment(p_row jsonb, p_origin uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare sid uuid;
begin
  if jsonb_typeof(p_row) is distinct from 'object' then return null; end if;
  if p_origin is null then sid := private.resolve_shipment_reference(p_row->>'reference');
  else select id into strict sid from public.order_shipments
    where order_id = private.warehouse_reply_order_id(btrim(p_row->>'reference')) and origin_id = p_origin;
  end if;
  return sid;
exception when others then return null;
end $$;
revoke all on function private.tracking_batch_shipment(jsonb, uuid) from public, anon, authenticated, service_role;

-- 일괄·회신 반입 준비: 파일의 모든 번호(대표·추가)를 열쇠 순서로 잠그고, 파일 안에서 서로 관계없는 배송 건에 같은 번호가 적힌
-- 번호('택배사:번호')를 돌려준다. 출고지가 있으면(김포) 택배사는 출고지 기본 택배사다.
create function private.lock_tracking_batch(p_rows jsonb, p_origin uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare origin_carrier text; entries jsonb := '[]'; row_value jsonb; carrier_value text; key text; conflicts text[];
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then return '{}'; end if;
  if p_origin is not null then select default_carrier into origin_carrier from public.fulfillment_origins where id = p_origin; end if;
  for row_value in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(row_value) is distinct from 'object' then continue; end if;
    carrier_value := coalesce(origin_carrier, nullif(btrim(row_value->>'carrier'), ''));
    entries := entries || jsonb_build_array(jsonb_build_object('shipmentId', private.tracking_batch_shipment(row_value, p_origin),
      'carrier', carrier_value, 'trackingNumber', private.normalize_tracking_number(row_value->>'trackingNumber'), 'representative', true));
    if jsonb_typeof(row_value->'extraTrackingNumbers') = 'array' then
      entries := entries || coalesce((select jsonb_agg(jsonb_build_object('carrier', carrier_value,
        'trackingNumber', private.normalize_tracking_number(extra #>> '{}'), 'representative', false))
        from jsonb_array_elements(row_value->'extraTrackingNumbers') extra where jsonb_typeof(extra) = 'string'), '[]');
    end if;
  end loop;
  for key in select distinct value->>'carrier' || ':' || (value->>'trackingNumber') from jsonb_array_elements(entries)
    where value->>'carrier' is not null and value->>'trackingNumber' is not null order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('icons:tracking:' || key, 0));
  end loop;
  with batch_rows as (
    select distinct (value->>'shipmentId')::uuid sid, value->>'carrier' carrier, value->>'trackingNumber' tracking
    from jsonb_array_elements(entries)
    where value->>'representative' = 'true' and value->>'shipmentId' is not null
      and value->>'carrier' is not null and value->>'trackingNumber' is not null
  )
  select coalesce(array_agg(distinct a.carrier || ':' || a.tracking), '{}') into conflicts
  from batch_rows a join batch_rows b on a.carrier = b.carrier and a.tracking = b.tracking and a.sid < b.sid
  where not private.tracking_shipments_related(a.sid, b.sid);
  return conflicts;
end $$;
revoke all on function private.lock_tracking_batch(jsonb, uuid) from public, anon, authenticated, service_role;

-- 회신의 받는 분 이름·전화번호(있으면)를 주문 배송지와 대조한다. 가린 값(*)·빈 값은 대조하지 않는다.
-- 창고가 이름 뒤에 번호를 붙이거나(홍길동01) 자르는 경우가 있어 이름은 한쪽이 다른 쪽으로 시작하면 같은 사람으로 본다.
-- 엑셀이 숫자로 바꿔 앞자리 0을 잃은 전화번호(1012345678)·국가번호(82)도 같은 번호로 본다.
create function private.assert_reply_recipient(p_order uuid, p_row jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare address jsonb; replied_name text; replied_phone text; stored_name text; stored_phone text;
begin
  if jsonb_typeof(p_row) is distinct from 'object' or not (p_row ? 'recipientName' or p_row ? 'recipientPhone') then return; end if;
  if (p_row ? 'recipientName' and jsonb_typeof(p_row->'recipientName') <> 'string')
    or (p_row ? 'recipientPhone' and jsonb_typeof(p_row->'recipientPhone') <> 'string') then
    raise invalid_parameter_value using message = 'invalid_tracking_row'; end if;
  select o.address into address from public.orders o where o.id = p_order;
  if not found then return; end if;
  replied_name := lower(regexp_replace(coalesce(p_row->>'recipientName', ''), '[[:space:]]', '', 'g'));
  stored_name := lower(regexp_replace(coalesce(address->>'recipientName', ''), '[[:space:]]', '', 'g'));
  if replied_name <> '' and position('*' in replied_name) = 0 and stored_name <> ''
    and not starts_with(replied_name, stored_name) and not starts_with(stored_name, replied_name) then
    raise check_violation using message = 'tracking_reply_recipient_mismatch'; end if;
  replied_phone := btrim(coalesce(p_row->>'recipientPhone', ''));
  stored_phone := ltrim(regexp_replace(coalesce(address->>'phone', ''), '[^0-9]', '', 'g'), '0');
  if replied_phone ~ '^[0-9[:space:]()+.-]+$' then
    replied_phone := regexp_replace(replied_phone, '[^0-9]', '', 'g');
    if replied_phone ~ '^82' and length(replied_phone) >= 11 then replied_phone := substr(replied_phone, 3); end if;
    replied_phone := ltrim(replied_phone, '0');
    if length(replied_phone) >= 8 and stored_phone <> '' and replied_phone <> stored_phone then
      raise check_violation using message = 'tracking_reply_recipient_mismatch'; end if;
  end if;
end $$;
revoke all on function private.assert_reply_recipient(uuid, jsonb) from public, anon, authenticated, service_role;

-- 추가 운송장의 옛 판정 함수는 같은 판정으로 위임한다(이 migration 뒤에는 부르는 곳이 없지만 이름을 지우지 않는다).
create or replace function private.shipment_tracking_in_use_elsewhere(p_shipment uuid, p_carrier text, p_tracking text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.tracking_number_conflict(p_carrier, p_tracking, array[p_shipment], null) is not null;
$$;
revoke all on function private.shipment_tracking_in_use_elsewhere(uuid, text, text) from public, anon, authenticated, service_role;

-- 4. 진입 경로 앵커 치환
-- 4-1. 발송(발송 대기 → 배송 중)·운송장 정정. 번호가 바뀔 때만 판정한다(배송완료 처리·같은 번호 재등록은 다시 보지 않는다).
select private.t6_patch_function('private.admin_update_shipment_status_before_delivery_methods(uuid,text,text,text)'::regprocedure, array[
$a$ update public.order_shipments set status=p_status,carrier=carrier_value,tracking_number=tracking_value,$a$,
$a$ if carrier_value is distinct from shipment.carrier or tracking_value is distinct from shipment.tracking_number then
   perform private.assert_tracking_registrable(carrier_value,tracking_value,array[shipment.id],null);end if;
 update public.order_shipments set status=p_status,carrier=carrier_value,tracking_number=tracking_value,$a$
]);
select private.t6_patch_function('private.admin_update_shipment_tracking_before_delivery_methods(uuid,text,text)'::regprocedure, array[
$a$ update public.order_shipments set carrier=carrier_value,tracking_number=tracking_value,updated_at=clock_timestamp() where id=p_shipment_id;$a$,
$a$ perform private.assert_tracking_registrable(carrier_value,tracking_value,array[shipment.id],null);
 update public.order_shipments set carrier=carrier_value,tracking_number=tracking_value,updated_at=clock_timestamp() where id=p_shipment_id;$a$
]);

-- 4-2. 교환 재출고(배송 건별 기록 — 운영자 단건·일괄·연락처 처리 서비스가 모두 여기를 지난다). 같은 재출고의 재전송은 위에서 이미 끝났다.
select private.t6_patch_function('private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure, array[
$a$ now_at:=clock_timestamp();
 insert into public.order_claim_reshipments($a$,
$a$ perform private.assert_tracking_registrable(carrier,tracking,case when p_shipment_id is null then '{}'::uuid[] else array[p_shipment_id] end,order_key);
 now_at:=clock_timestamp();
 insert into public.order_claim_reshipments($a$
]);

-- 4-3. 추가 운송장(운영자 추가·서원 회신). 다른 주문의 쓰임 판정에 택배사 형식을 더한다.
select private.t6_patch_function('public.admin_add_shipment_extra_tracking(uuid,text,text,text,uuid)'::regprocedure, array[
$a$  if private.shipment_tracking_in_use_elsewhere(shipment.id, carrier_value, tracking_value) then
    raise check_violation using message = 'tracking_number_in_use'; end if;$a$,
$a$  perform private.assert_tracking_registrable(carrier_value, tracking_value, array[shipment.id], null);$a$
]);
select private.t6_patch_function('private.assert_reply_extra_trackings(jsonb)'::regprocedure, array[
$a$        if private.shipment_tracking_in_use_elsewhere(shipment.id, nullif(btrim(row_value->>'carrier'), ''), number) then
          raise check_violation using message = 'tracking_number_in_use'; end if;$a$,
$a$        perform private.assert_tracking_registrable(nullif(btrim(row_value->>'carrier'), ''), number, array[shipment.id], null);$a$
]);

-- 4-4. 세 칸·표준 양식(배송 건으로 위임)·서원 회신이 지나는 일괄 등록: 번호를 미리 잠그고, 파일 안 교차 번호의 줄은 실패로 돌린다.
select private.t6_patch_function('public.admin_import_shipment_tracking_batch(jsonb)'::regprocedure, array[
$a$seen uuid[]:='{}'::uuid[];$a$,
$a$seen uuid[]:='{}'::uuid[];conflicts text[];$a$,
$a$ for input in select value from jsonb_array_elements(target_rows) loop$a$,
$a$ -- 주문 잠금 뒤에 번호를 열쇠 순서로 잠근다(주문 → 번호 순서는 모든 등록 경로가 같다).
 conflicts:=private.lock_tracking_batch(target_rows,null);
 for input in select value from jsonb_array_elements(target_rows) loop$a$,
$a$   completed:=public.admin_import_shipment_tracking(shipment_key::text,input->>'carrier',input->>'trackingNumber');$a$,
$a$   if nullif(btrim(input->>'carrier'),'')||':'||private.normalize_tracking_number(input->>'trackingNumber')=any(conflicts) then
    raise check_violation using message='tracking_number_shared_in_reply';end if;
   completed:=public.admin_import_shipment_tracking(shipment_key::text,input->>'carrier',input->>'trackingNumber');$a$
]);

-- 4-5. 김포 21열 회신: 받는 분 이름·전화 칸(선택)을 받아 주문 배송지와 대조하고, 번호 잠금·파일 안 교차 번호 판정을 더한다.
select private.t6_patch_function('public.admin_import_warehouse_tracking_batch(uuid,jsonb)'::regprocedure, array[
$a$  seen uuid[] := '{}';$a$,
$a$  seen uuid[] := '{}';
  conflicts text[];$a$,
$a$key not in ('line','reference','trackingNumber'))$a$,
$a$key not in ('line','reference','trackingNumber','recipientName','recipientPhone'))$a$,
$a$      if tracking_value !~ '^[A-Z0-9]{8,30}$' then
        raise check_violation using message='invalid_tracking_input';
      end if;$a$,
$a$      if tracking_value !~ '^[A-Z0-9]{8,30}$' then
        raise check_violation using message='invalid_tracking_input';
      end if;
      -- 회신의 받는 분이 주문과 다르면(두 주문의 운송장이 뒤바뀐 회신 의심) 그 주문의 줄만 실패한다.
      perform private.assert_reply_recipient(order_key, input);$a$,
$a$  if not found then raise check_violation using message='inactive_shipping_carrier'; end if;$a$,
$a$  if not found then raise check_violation using message='inactive_shipping_carrier'; end if;
  conflicts := private.lock_tracking_batch(target_rows, target_origin_id);$a$,
$a$      completed := public.admin_import_shipment_tracking(shipment_key::text,origin.default_carrier,tracking_value);$a$,
$a$      if origin.default_carrier || ':' || tracking_value = any(conflicts) then
        raise check_violation using message='tracking_number_shared_in_reply';
      end if;
      completed := public.admin_import_shipment_tracking(shipment_key::text,origin.default_carrier,tracking_value);$a$
]);

-- 4-6. ICONS 표준 양식(상품주문번호 단위): 받는 분 이름·전화 칸(선택)을 받아 주문 배송지와 대조한다. 실패는 그 배송 건의 줄만이다.
select private.t6_patch_function('private.admin_import_item_tracking_batch_before_identity_guard(jsonb)'::regprocedure, array[
$a$key not in('line','reference','carrier','trackingNumber'))$a$,
$a$key not in('line','reference','carrier','trackingNumber','recipientName','recipientPhone'))$a$,
$a$      if carrier_value='' or char_length(carrier_value)>100 or tracking_value !~ '^[A-Z0-9]{8,30}$' then
        raise check_violation using message='invalid_tracking_input';end if;$a$,
$a$      if carrier_value='' or char_length(carrier_value)>100 or tracking_value !~ '^[A-Z0-9]{8,30}$' then
        raise check_violation using message='invalid_tracking_input';end if;
      perform private.assert_reply_recipient(order_key, input);$a$
]);

-- 4-7. 서원 회신: 추가 운송장 판정 전에 대표·추가 번호를 모두 잠근다(일괄 등록이 같은 열쇠를 다시 잡아도 이미 가진 잠금이다).
select private.t6_patch_function('public.admin_import_seowon_tracking_batch(uuid,jsonb)'::regprocedure, array[
$a$ perform private.assert_reply_extra_trackings(target_rows);$a$,
$a$ perform private.lock_tracking_batch(target_rows,null);
 perform private.assert_reply_extra_trackings(target_rows);$a$
]);

drop function private.t6_patch_function(regprocedure, text[]);

-- 5. 운영자 계약. 바꾼 함수는 등록된 능력·분류를 그대로 두고 지문만 다시 적는다.
do $contracts$
declare
  signature text;
  fn regprocedure;
  contract record;
begin
  foreach signature in array array[
    'public.admin_add_shipment_extra_tracking(uuid,text,text,text,uuid)',
    'public.admin_import_shipment_tracking_batch(jsonb)',
    'public.admin_import_warehouse_tracking_batch(uuid,jsonb)',
    'public.admin_import_seowon_tracking_batch(uuid,jsonb)'
  ] loop
    fn := signature::regprocedure;
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if not found then raise exception 'tracking_integrity_contract_missing: %', signature; end if;
    perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
  end loop;
  foreach signature in array array[
    'public.admin_add_shipment_extra_tracking(uuid,text,text,text,uuid)',
    'public.admin_import_shipment_tracking_batch(jsonb)',
    'public.admin_import_warehouse_tracking_batch(uuid,jsonb)',
    'public.admin_import_seowon_tracking_batch(uuid,jsonb)',
    'private.admin_import_item_tracking_batch_before_identity_guard(jsonb)',
    'private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)',
    'private.admin_update_shipment_status_before_delivery_methods(uuid,text,text,text)',
    'private.admin_update_shipment_tracking_before_delivery_methods(uuid,text,text)',
    'private.assert_reply_extra_trackings(jsonb)'
  ] loop
    fn := signature::regprocedure;
    if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $contracts$;

notify pgrst, 'reload schema';
commit;
