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
--    창고가 같은 받는 분의 배송 건을 한 상자로 묶은 합배송(같은 출고지·받는 분 전화번호·주소가 같은 배송 건·교환 재출고 가운데 배송 중이거나
--    최근 7일 안에 배송완료된 것, 서원 회신 대조의 합배송 규칙과 같은 받는 분 기준)이다. 받는 사람이 같아 개인정보가 드러나지 않고 같은
--    상자라 배송완료도 같다. 7일: 택배는 보통 1~3일 안에 배송완료되고 회신 정정·재업로드는 같은 주 안에 끝나므로, 한 상자의 늦게 등록하는
--    줄은 받고 몇 주 지난 옛 번호의 재사용은 받지 않는다. 취소된 주문의 쓰임은 보지 않는다.
--    이 밖의 정상 공유(예: 7일이 지난 뒤 같은 상자 확인)는 운영자가 사유를 적어 '중복 확인 후 등록'한다
--    (admin_register_shipment_tracking_duplicate, 출고 권한·사유·감사, private.tracking_duplicate_approvals).
-- 2. 진입 경로는 모두 이 판정을 지난다. 발송·정정(private.change_packed_shipments가 부르는 두 함수 — 수동 입력·세 칸·김포·표준·서원 회신과
--    옛 주문 단위 RPC가 모두 여기를 지난다), 추가 운송장(운영자·서원 회신), 교환 재출고(배송 건별 기록 함수 — 운영자·연락처 처리 서비스).
--    일괄·회신 반입은 줄(배송 건)마다 savepoint 안에서 실패하므로 파일 전체가 아니라 그 줄만 실패한다. 한 파일 안에서 서로 관계없는
--    배송 건에 같은 번호가 적히면 어느 줄이 맞는지 알 수 없으므로 그 번호의 줄을 모두 실패로 돌린다(먼저 나온 줄이 등록되지 않게).
-- 3. 택배사 레지스트리에 번호 형식(정규식)과 사람이 읽는 규칙을 둔다. 우체국택배는 숫자 13자리(공공데이터포털 우정사업본부
--    종적조회 API의 등기번호 13자리, NHN Cloud 카카오 비즈메시지 문제 해결 가이드의 택배사별 송장번호 형식 표).
--    한진택배 공식 배송조회(hanjin.com/kor/CMS/DeliveryMgr/WaybillSch.do 입력 검사, 2026-11-18 확인)는 숫자 12자리 또는 14자리만
--    받고, NHN 표는 10자리 또는 12자리(옛 안내)다. 출고가 막히지 않도록 숫자 10~14자리로 넓게 둔다(영문·자릿수 초과·부족은 걸린다).
--    형식이 없는 택배사는 공통 형식만 본다. 형식은 택배사 관리 화면에서 최고 관리자가 확인용 번호와 함께 고친다
--    (admin_save_shipping_carrier_tracking_format, 감사 기록).
-- 4. 김포 21열·표준 양식 회신의 받는 분 이름·전화번호(회신에 있으면)를 주문 배송지와 대조해, 다르면 그 주문(배송 건)의 줄만 실패한다.
--    회신이 이 칸을 보내지 않으면(세 칸 회신·옛 앱) 지금처럼 대조하지 않는다.
-- 5. 이미 등록된 운영 데이터는 소급하지 않는다. 표 제약이 아니라 등록 함수의 판정이고, 바뀌지 않는 번호(배송완료 처리·같은 회신 재업로드)는 다시 보지 않는다.
-- 6. 두 주문의 운송장이 서로 뒤바뀌어 등록되면 위 판정 때문에 정정으로 고칠 수 없으므로, 두 배송 건의 대표 운송장을 한 번에 맞바꾸는
--    운영자 RPC(admin_swap_shipment_trackings, 출고 권한·사유 필수·감사)를 둔다.
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
update public.shipping_carriers set tracking_number_pattern = '^[0-9]{10,14}$', tracking_number_rule = '숫자 10~14자리'
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
-- 전화번호 비교 열쇠: 숫자만 남기고, 국가번호 82로 시작하는 11자리 이상은 82를 떼고, 앞자리 0을 뗀다. 주문에 저장된 값과 회신 값에
-- 같은 규칙을 써서 엑셀이 지운 앞자리 0·국제 표기(8210…)를 같은 번호로 본다. 숫자가 없으면 null.
create function private.tracking_phone_key(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select nullif(ltrim(case when digits ~ '^82' and length(digits) >= 11 then substr(digits, 3) else digits end, '0'), '')
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') digits) phone;
$$;
revoke all on function private.tracking_phone_key(text) from public, anon, authenticated, service_role;

-- 받는 분 열쇠(전화번호 열쇠 + 주소, 공백·대소문자 무시). 서원 회신 대조가 한 상자의 받는 분으로 보는 열쇠(전화·주소)와 같다.
-- 전화나 주소가 없으면 null — 합배송으로 보지 않는다.
create function private.tracking_destination_key(p_address jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when private.tracking_phone_key(p_address->>'phone') is null
      or nullif(regexp_replace(coalesce(p_address->>'address1', ''), '[[:space:]]', '', 'g'), '') is null then null
    else concat_ws(chr(31), private.tracking_phone_key(p_address->>'phone'),
      lower(regexp_replace(concat(p_address->>'address1', p_address->>'address2'), '[[:space:]]', '', 'g')))
  end;
$$;
revoke all on function private.tracking_destination_key(jsonb) from public, anon, authenticated, service_role;

-- 같은 번호 등록을 줄 세우는 열쇠. 여러 번호를 잡는 호출자는 이 열쇠 값의 오름차순으로 잠근다.
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
      or (a.origin_id = b.origin_id and private.tracking_destination_key(private.operational_order_address(ao.id)) is not null
        and private.tracking_destination_key(private.operational_order_address(ao.id))
          = private.tracking_destination_key(private.operational_order_address(bo.id)))));
$$;
revoke all on function private.tracking_shipments_related(uuid, uuid) from public, anon, authenticated, service_role;

-- 이 번호를 쓰는 "다른 주문"의 쓰임 하나(없으면 null). 대상은 배송 건들(합포장 구성원 포함)과/또는 주문이다.
-- 취소된 주문의 쓰임은 보지 않는다. 합배송 예외(같은 출고지·같은 받는 분 열쇠)는 대표·추가 운송장과 배송 건별 교환 재출고에 쓰고,
-- 그 쓰임이 배송 중이거나 최근 7일 안에 배송완료됐을 때만이다(재출고는 배송완료 확인 전이면 배송 중으로 본다).
create function private.tracking_number_conflict(p_carrier text, p_tracking text, p_shipments uuid[], p_order uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with target as (
    select s.id, s.order_id, s.origin_id, private.tracking_destination_key(private.operational_order_address(s.order_id)) destination
    from public.order_shipments s
    where s.id = any(coalesce(p_shipments, '{}'::uuid[]))
  ), allowed as (
    select p_order id where p_order is not null
    union select order_id from target
    union select s.order_id from public.order_shipments s
      where s.id = any(private.shipment_pack_scope(coalesce(p_shipments, '{}'::uuid[])))
  ), uses as (
    select 'shipment' source, s.order_id, s.id shipment_id, s.origin_id, s.delivery_method, s.status, s.delivered_at
    from public.order_shipments s where s.carrier = p_carrier and s.tracking_number = p_tracking
    union all
    select 'extra', x.order_id, x.shipment_id, s.origin_id, s.delivery_method, s.status, s.delivered_at
    from public.order_shipment_extra_trackings x join public.order_shipments s on s.id = x.shipment_id
    where x.carrier = p_carrier and x.tracking_number = p_tracking
    union all
    select 'reshipment', r.order_id, r.shipment_id, s.origin_id, s.delivery_method,
      case when r.delivered_at is null then 'shipping' else 'delivered' end, r.delivered_at
    from public.order_claim_reshipments r left join public.order_shipments s on s.id = r.shipment_id
    where r.carrier = p_carrier and r.tracking_number = p_tracking
    union all
    -- 옛 클레임 단위 재출고만(배송 건별 기록이 있는 클레임은 같은 번호를 이 열에도 적는다 — 위 기록이 진실원이다).
    select 'reshipment', q.order_id, null, null, null, null, null
    from public.order_cancellation_requests q where q.reship_carrier = p_carrier and q.reship_tracking_number = p_tracking
      and not exists(select 1 from public.order_claim_reshipments r where r.claim_id = q.id)
  )
  select jsonb_build_object('source', u.source, 'orderId', u.order_id, 'shipmentId', u.shipment_id)
  from uses u join public.orders uo on uo.id = u.order_id
  where u.order_id not in (select id from allowed)
    and uo.status <> 'canceled'
    and not (u.origin_id is not null and u.delivery_method = 'parcel'
      and (u.status = 'shipping' or (u.status = 'delivered' and u.delivered_at >= now() - interval '7 days'))
      and exists(select 1 from target t
        where t.origin_id = u.origin_id and t.destination is not null and t.destination = private.tracking_destination_key(private.operational_order_address(uo.id))))
  order by u.source, u.order_id
  limit 1;
$$;
revoke all on function private.tracking_number_conflict(text, text, uuid[], uuid) from public, anon, authenticated, service_role;

-- 운영자가 '중복 확인 후 등록'으로 승인한 배송 건·번호(사유·처리자·다른 주문의 쓰임). 판정은 이 승인이 있으면 다른 주문의 쓰임을
-- 보지 않는다(형식 검사는 그대로). 승인은 admin_register_shipment_tracking_duplicate만 만든다.
create table private.tracking_duplicate_approvals (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.order_shipments(id) on delete cascade,
  carrier text not null,
  tracking_number text not null,
  reason text not null check (char_length(reason) between 1 and 500),
  conflict jsonb not null,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint tracking_duplicate_approvals_unique unique (shipment_id, carrier, tracking_number)
);
alter table private.tracking_duplicate_approvals enable row level security;
revoke all on table private.tracking_duplicate_approvals from public, anon, authenticated, service_role;

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
  if private.tracking_number_conflict(p_carrier, p_tracking, p_shipments, p_order) is not null and not exists(
    select 1 from private.tracking_duplicate_approvals a
    where a.shipment_id = any(private.shipment_pack_scope(coalesce(p_shipments, '{}'::uuid[])))
      and a.carrier = p_carrier and a.tracking_number = p_tracking) then
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
-- 번호('택배사:번호')를 돌려준다. 한 줄의 추가 운송장과 다른 줄의 대표 운송장이 같아도 교차다. 출고지가 있으면(김포) 택배사는
-- 출고지 기본 택배사다.
create function private.lock_tracking_batch(p_rows jsonb, p_origin uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare origin_carrier text; entries jsonb := '[]'; row_value jsonb; carrier_value text; row_shipment uuid; lock_key bigint; conflicts text[];
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then return '{}'; end if;
  if p_origin is not null then select default_carrier into origin_carrier from public.fulfillment_origins where id = p_origin; end if;
  for row_value in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(row_value) is distinct from 'object' then continue; end if;
    carrier_value := coalesce(origin_carrier, nullif(btrim(row_value->>'carrier'), ''));
    row_shipment := private.tracking_batch_shipment(row_value, p_origin);
    entries := entries || jsonb_build_array(jsonb_build_object('shipmentId', row_shipment,
      'carrier', carrier_value, 'trackingNumber', private.normalize_tracking_number(row_value->>'trackingNumber')));
    if jsonb_typeof(row_value->'extraTrackingNumbers') = 'array' then
      entries := entries || coalesce((select jsonb_agg(jsonb_build_object('shipmentId', row_shipment, 'carrier', carrier_value,
        'trackingNumber', private.normalize_tracking_number(extra #>> '{}')))
        from jsonb_array_elements(row_value->'extraTrackingNumbers') extra where jsonb_typeof(extra) = 'string'), '[]');
    end if;
  end loop;
  -- 여러 번호를 잡는 모든 경로(일괄·회신 반입, 맞바꾸기)는 잠금 열쇠 값 순서로 잡는다 — 번호가 엇갈린 두 요청이 교착하지 않는다.
  for lock_key in select distinct private.tracking_number_lock_key(value->>'carrier', value->>'trackingNumber') from jsonb_array_elements(entries)
    where value->>'carrier' is not null and value->>'trackingNumber' is not null order by 1 loop
    perform pg_advisory_xact_lock(lock_key);
  end loop;
  with batch_rows as (
    select distinct (value->>'shipmentId')::uuid sid, value->>'carrier' carrier, value->>'trackingNumber' tracking
    from jsonb_array_elements(entries)
    where value->>'shipmentId' is not null and value->>'carrier' is not null and value->>'trackingNumber' is not null
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
  -- 선물 주문은 orders.address가 비어 있고 받는 분은 배송 스냅샷에 있다 — 출고 화면과 같은 운영 주소를 읽는다.
  select private.operational_order_address(o.id) into address from public.orders o where o.id = p_order;
  if not found then return; end if;
  replied_name := lower(regexp_replace(coalesce(p_row->>'recipientName', ''), '[[:space:]]', '', 'g'));
  stored_name := lower(regexp_replace(coalesce(address->>'recipientName', ''), '[[:space:]]', '', 'g'));
  if replied_name <> '' and position('*' in replied_name) = 0 and stored_name <> ''
    and not starts_with(replied_name, stored_name) and not starts_with(stored_name, replied_name) then
    raise check_violation using message = 'tracking_reply_recipient_mismatch'; end if;
  replied_phone := btrim(coalesce(p_row->>'recipientPhone', ''));
  -- 주문에 저장된 값과 회신 값에 같은 전화번호 열쇠(숫자만, 국가번호 82·앞자리 0 제거)를 쓴다.
  stored_phone := private.tracking_phone_key(address->>'phone');
  if replied_phone ~ '^[0-9[:space:]()+.-]+$' then
    replied_phone := private.tracking_phone_key(replied_phone);
    if length(coalesce(replied_phone, '')) >= 8 and stored_phone is not null and replied_phone <> stored_phone then
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
$a$   if nullif(btrim(input->>'carrier'),'')||':'||private.normalize_tracking_number(input->>'trackingNumber')=any(conflicts)
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(input->'extraTrackingNumbers')='array' then input->'extraTrackingNumbers' else '[]'::jsonb end) extra
     where jsonb_typeof(extra)='string' and nullif(btrim(input->>'carrier'),'')||':'||private.normalize_tracking_number(extra#>>'{}')=any(conflicts)) then
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

-- 5. 뒤바뀐 운송장 맞바꾸기. 두 주문의 운송장이 서로 바뀌어 등록되면 위 판정 때문에 어느 쪽도 상대 번호로 정정할 수 없다.
--    운영자가 두 배송 건(합포장이면 묶음 전체)의 대표 운송장을 한 트랜잭션에서 맞바꾼다. 화면이 본 두 번호(p_expected_*)가 지금 값과
--    같을 때만 바꾸므로 같은 요청을 다시 보내도 되돌아가지 않는다(두 번째는 shipment_tracking_changed). 추가 운송장은 그대로다.
create function public.admin_swap_shipment_trackings(p_shipment_id uuid, p_expected_tracking text, p_other_reference text,
  p_expected_other_tracking text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; other_id uuid; reason_value text := nullif(btrim(coalesce(p_reason, '')), '');
  first_scope uuid[]; second_scope uuid[]; first public.order_shipments; second public.order_shipments; member public.order_shipments;
begin
  actor := private.require_operator_capability('sales.dispatch', false);
  if p_shipment_id is null or p_other_reference is null then raise invalid_parameter_value using message = 'invalid_tracking_swap'; end if;
  if reason_value is null or char_length(reason_value) > 500 then raise check_violation using message = 'tracking_swap_reason_required'; end if;
  other_id := private.resolve_shipment_reference(p_other_reference);
  if other_id = p_shipment_id then raise invalid_parameter_value using message = 'invalid_tracking_swap'; end if;
  -- 주문 → 배송 건 순서로 두 묶음을 한 번에 잠근다(다른 등록 경로와 같은 순서).
  perform private.lock_shipment_pack_scope(array[p_shipment_id, other_id]);
  first_scope := private.shipment_pack_scope(array[p_shipment_id]);
  second_scope := private.shipment_pack_scope(array[other_id]);
  if first_scope && second_scope then raise check_violation using message = 'tracking_swap_same_pack'; end if;
  select * into first from public.order_shipments where id = p_shipment_id;
  select * into second from public.order_shipments where id = other_id;
  if exists(select 1 from public.order_shipments s join public.orders o on o.id = s.order_id
    where s.id = any(first_scope || second_scope)
      and (s.delivery_method <> 'parcel' or s.status not in ('shipping', 'delivered') or o.status = 'canceled' or s.tracking_number is null)) then
    raise check_violation using message = 'order_not_shipped'; end if;
  if first.tracking_number is distinct from private.normalize_tracking_number(p_expected_tracking)
    or second.tracking_number is distinct from private.normalize_tracking_number(p_expected_other_tracking)
    or exists(select 1 from public.order_shipments where id = any(first_scope) and (carrier, tracking_number) is distinct from (first.carrier, first.tracking_number))
    or exists(select 1 from public.order_shipments where id = any(second_scope) and (carrier, tracking_number) is distinct from (second.carrier, second.tracking_number)) then
    raise check_violation using message = 'shipment_tracking_changed'; end if;
  if (first.carrier, first.tracking_number) = (second.carrier, second.tracking_number) then
    raise check_violation using message = 'invalid_tracking_swap'; end if;
  perform pg_advisory_xact_lock(key) from (select unnest(array[private.tracking_number_lock_key(first.carrier, first.tracking_number),
    private.tracking_number_lock_key(second.carrier, second.tracking_number)]) key order by 1) keys;
  update public.order_shipments set carrier = second.carrier, tracking_number = second.tracking_number, updated_at = clock_timestamp() where id = any(first_scope);
  update public.order_shipments set carrier = first.carrier, tracking_number = first.tracking_number, updated_at = clock_timestamp() where id = any(second_scope);
  -- 맞바꾼 뒤에도 각 번호를 다른 주문(추가 운송장·재출고 포함)이 쓰고 있으면 바꾸지 않는다.
  if private.tracking_number_conflict(second.carrier, second.tracking_number, first_scope, null) is not null
    or private.tracking_number_conflict(first.carrier, first.tracking_number, second_scope, null) is not null then
    raise check_violation using message = 'tracking_number_in_use'; end if;
  for member in select * from public.order_shipments where id = any(first_scope || second_scope) order by id loop
    insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.shipment.tracking_updated', 'order:' || member.order_id,
      jsonb_build_object('shipmentId', member.id, 'originName', member.origin_name_snapshot,
        'fromCarrier', case when member.id = any(first_scope) then first.carrier else second.carrier end,
        'fromTrackingNumber', case when member.id = any(first_scope) then first.tracking_number else second.tracking_number end,
        'toCarrier', member.carrier, 'toTrackingNumber', member.tracking_number,
        'swappedWithShipmentId', case when member.id = any(first_scope) then second.id else first.id end, 'reason', reason_value));
  end loop;
  return jsonb_build_object('status', 'swapped', 'shipmentId', first.id, 'orderId', first.order_id, 'otherShipmentId', second.id, 'otherOrderId', second.order_id,
    'trackingNumber', second.tracking_number, 'otherTrackingNumber', first.tracking_number);
end $$;
revoke all on function public.admin_swap_shipment_trackings(uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_swap_shipment_trackings(uuid, text, text, text, text) to authenticated;

-- 6. 중복 확인 후 등록. 판정이 다른 주문의 쓰임으로 거절했지만 같은 상자가 맞는 경우(7일이 지난 합배송 확인, 받는 분 표기가 달라
--    열쇠가 어긋난 같은 집 등) 운영자가 사유를 적어 그 배송 건에 그 번호를 등록한다. 형식 검사는 그대로이고, 승인·감사 기록이 남는다.
--    발송 대기 건은 발송처리, 발송된 건은 운송장 정정과 같은 경로(합포장 묶음 전체)를 지난다.
create function public.admin_register_shipment_tracking_duplicate(p_shipment_id uuid, p_carrier text, p_tracking_number text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; carrier_value text := nullif(btrim(coalesce(p_carrier, '')), ''); tracking_value text := private.normalize_tracking_number(p_tracking_number);
  reason_value text := nullif(btrim(coalesce(p_reason, '')), ''); scope uuid[]; shipment public.order_shipments; conflict jsonb; outcome text;
begin
  actor := private.require_operator_capability('sales.dispatch', false);
  if p_shipment_id is null then raise invalid_parameter_value using message = 'invalid_tracking_duplicate'; end if;
  if reason_value is null or char_length(reason_value) > 500 then raise check_violation using message = 'tracking_duplicate_reason_required'; end if;
  if carrier_value is null or tracking_value is null or tracking_value !~ '^[A-Z0-9]{8,30}$' then
    raise check_violation using message = 'invalid_tracking_input'; end if;
  if not exists(select 1 from public.shipping_carriers where code = carrier_value and is_active) then
    raise check_violation using message = 'inactive_shipping_carrier'; end if;
  if not private.tracking_number_format_ok(carrier_value, tracking_value) then
    raise check_violation using message = 'tracking_number_format_mismatch'; end if;
  scope := private.lock_shipment_pack_scope(array[p_shipment_id]);
  select * into shipment from public.order_shipments where id = p_shipment_id;
  if shipment.delivery_method <> 'parcel' then raise check_violation using message = 'delivery_method_evidence_required'; end if;
  if shipment.status not in ('ready', 'shipping', 'delivered') then raise check_violation using message = 'invalid_shipment_transition'; end if;
  perform pg_advisory_xact_lock(private.tracking_number_lock_key(carrier_value, tracking_value));
  conflict := private.tracking_number_conflict(carrier_value, tracking_value, scope, null);
  if conflict is null then raise check_violation using message = 'tracking_duplicate_not_needed'; end if;
  insert into private.tracking_duplicate_approvals(shipment_id, carrier, tracking_number, reason, conflict, actor_id)
  values (shipment.id, carrier_value, tracking_value, reason_value, conflict, actor)
  on conflict (shipment_id, carrier, tracking_number) do update
    set reason = excluded.reason, conflict = excluded.conflict, actor_id = excluded.actor_id, created_at = excluded.created_at;
  if shipment.status = 'ready' then
    perform public.admin_update_shipment_status(shipment.id, 'shipping', carrier_value, tracking_value); outcome := 'dispatched';
  else
    perform public.admin_update_shipment_tracking(shipment.id, carrier_value, tracking_value); outcome := 'corrected';
  end if;
  insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.shipment.tracking_duplicate_registered', 'order:' || shipment.order_id,
    jsonb_build_object('shipmentId', shipment.id, 'originName', shipment.origin_name_snapshot, 'carrier', carrier_value, 'trackingNumber', tracking_value,
      'reason', reason_value, 'outcome', outcome, 'fromTrackingNumber', shipment.tracking_number,
      'otherSource', conflict->>'source', 'otherOrderId', conflict->>'orderId', 'otherShipmentId', conflict->>'shipmentId'));
  return jsonb_build_object('status', outcome, 'shipmentId', shipment.id, 'orderId', shipment.order_id,
    'packedShipments', (select jsonb_agg(jsonb_build_object('shipmentId', s.id, 'orderId', s.order_id) order by s.id) from public.order_shipments s where s.id = any(scope)));
end $$;
revoke all on function public.admin_register_shipment_tracking_duplicate(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_register_shipment_tracking_duplicate(uuid, text, text, text) to authenticated;

-- 7. 택배사 운송장 형식 편집(택배사 관리 화면, 최고 관리자). 형식과 안내 문구는 함께 저장·삭제하고, 형식을 둘 때는 확인용 번호가
--    공통 형식과 새 형식에 맞아야 저장한다(잘못된 식으로 모든 발송이 막히지 않게). 택배사 저장과 같은 잠금·충돌 검사·감사 기록이다.
create function public.admin_save_shipping_carrier_tracking_format(target_code text, target_pattern text, target_rule text, target_sample text,
  expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path = '' as $format$
declare actor uuid := (select auth.uid()); previous public.shipping_carriers; saved public.shipping_carriers;
  code_value text := btrim(coalesce(target_code, '')); pattern_value text := nullif(btrim(coalesce(target_pattern, '')), '');
  rule_value text := nullif(btrim(coalesce(target_rule, '')), ''); sample_value text := private.normalize_tracking_number(target_sample);
begin
  perform private.require_operator_capability('platform.manage', true);
  if actor is null or not public.has_operator_capability('platform.manage', true) then raise insufficient_privilege using message = 'admin_required'; end if;
  if (pattern_value is null) <> (rule_value is null) or char_length(coalesce(pattern_value, '')) > 200 or char_length(coalesce(rule_value, '')) > 60
    or (pattern_value is not null and pattern_value !~ '^\^.+\$$') then
    raise invalid_parameter_value using message = 'invalid_tracking_number_format'; end if;
  if pattern_value is not null then
    begin
      if sample_value is null or sample_value !~ '^[A-Z0-9]{8,30}$' or not (sample_value ~ pattern_value) then
        raise invalid_parameter_value using message = 'tracking_number_format_sample_mismatch'; end if;
    exception when invalid_regular_expression then
      raise invalid_parameter_value using message = 'invalid_tracking_number_format';
    end;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shipping_carrier:' || code_value, 0));
  select * into previous from public.shipping_carriers where code = code_value for update;
  if not found then raise no_data_found using message = 'shipping_carrier_not_found'; end if;
  if expected_updated_at is distinct from previous.updated_at then raise sqlstate 'PT409' using message = 'store_settings_conflict'; end if;
  update public.shipping_carriers set tracking_number_pattern = pattern_value, tracking_number_rule = rule_value
    where code = code_value returning * into saved;
  insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.shipping_carrier.saved', 'shipping_carriers:' || code_value,
    jsonb_build_object('before', to_jsonb(previous), 'after', to_jsonb(saved)));
  return saved.updated_at;
end $format$;
revoke all on function public.admin_save_shipping_carrier_tracking_format(text, text, text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_shipping_carrier_tracking_format(text, text, text, text, timestamptz) to authenticated;

-- 8. 운영자 계약. 바꾼 함수는 등록된 능력·분류를 그대로 두고 지문만 다시 적는다. 맞바꾸기·중복 확인 후 등록은 운송장 정정과 같은 출고
--    권한, 운송장 형식 편집은 택배사 저장과 같은 최고 관리자 권한이다.
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
  perform private.register_operator_rpc_contract('public.admin_swap_shipment_trackings(uuid,text,text,text,text)'::regprocedure, 'sales.dispatch', 'write', false);
  perform private.register_operator_rpc_contract('public.admin_register_shipment_tracking_duplicate(uuid,text,text,text)'::regprocedure, 'sales.dispatch', 'write', false);
  perform private.register_operator_rpc_contract('public.admin_save_shipping_carrier_tracking_format(text,text,text,text,timestamp with time zone)'::regprocedure,
    'platform.manage', 'write', true);
end $contracts$;

notify pgrst, 'reload schema';
commit;
