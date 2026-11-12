-- 1014-084 물류 전용 출고 권한. 10/14 회의 "배송은 배송에서 봐야 된다고"(49:32)에 대한 사용자 결정(2026-11-11):
-- "물류 전용 출고 권한 (Recommended)" — 출고지시 내려받기·송장 회신·발송·배송완료, 환불·고객 관리 제외.
--
-- 물류출고관리(logistics) 역할에 출고 전용 능력 sales.dispatch를 더한다. sales.dispatch로 여는 것은
-- 발주확인·발송관리와 배송현황의 목록 조회, 출고지시 내려받기와 전달 표시, 운송장 회신 반입, 발송 처리(발송 대기→배송중),
-- 배송완료(배송중→배송완료), 발송 안내 메일 대기열 등록, 택배 외 배송(퀵·방문수령·직접배송·화물·직접전달)의 인계·수령 기록과
-- 그 기록에 필요한 배송 건 인계 정보 읽기, 그리고 회신 대조에 필요한 출고지 설정 읽기뿐이다(발송·배송완료를 택배로 좁히지 않는다).
-- 발주확인(주문 상태 변경)·배송 방식 변경·취소·환불·클레임·고객·상품 관리·목록 엑셀·합포장·지연 안내는 지금처럼 sales.manage 등에 남는다.
-- 열람 범위는 사용자 결정(2026-11-11) "수령인 정보만"이다: 주문 조회 권한(sales.read)이 없으면 목록·표준 출고지시 자료·인계 정보에서
-- 구매자·결제·금액을 비우고, 그 값으로 찾거나 거르거나 정렬하지 못하게 한다(4·4-2절).
--
-- sales.manage는 sales.dispatch를 포함한다(private.has_operator_capability의 함의). 통합 매니저·계정 주매니저·
-- 전환 전 운영자의 능력 목록은 한 글자도 바뀌지 않는다. 그래서 다른 역할의 권한은 넓어지지도 좁아지지도 않고,
-- DB를 먼저 올리는 배포 사이에 옛 앱이 낯선 능력 이름 때문에 권한 응답 전체를 거절하는 일도 없다.
--
-- 출고 함수는 다른 트랙이 같은 날 고칠 수 있어 pg_get_functiondef + 앵커 치환으로 최소만 바꾸고,
-- 앵커 수가 다르면 멈춘다. 같은 migration 끝에서 운영자 계약 지문(RPC·내부·RLS)을 다시 적는다.
begin;

-- 1. 계약 표의 능력 이름 목록에 sales.dispatch를 더한다.
alter table private.operator_rpc_contracts
  drop constraint operator_rpc_contracts_capability_check,
  add constraint operator_rpc_contracts_capability_check check (capability in (
    'home','catalog.read','catalog.manage','catalog.announcements',
    'sales.read','sales.manage','sales.dispatch','sales.restrictions','cs.manage','store.manage',
    'seller.read','seller.manage','marketing.manage','stats.read','promotion.manage',
    'operators.manage','operators.transfer','platform.manage'));

-- 2. 역할 부여·함의·RLS 계약 검증.
do $patch$
declare
  body text;
  anchor text;
begin
  -- 물류출고관리만 sales.dispatch를 새로 받는다. 기존 배열은 그대로 두고 뒤에 붙인다
  -- (goods_import_guidance.sql의 읽기 전용 fixture가 같은 앵커로 이 줄을 잠시 바꿔 본다).
  body := pg_get_functiondef('private.operator_role_capabilities(text)'::regprocedure);
  anchor := $a$when 'logistics' then array['home','catalog.announcements']$a$;
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'logistics_dispatch_role_anchor_changed';
  end if;
  execute replace(body, anchor, anchor || $a$||array['sales.dispatch']$a$);

  -- sales.manage를 가진 운영자는 출고 전용 업무도 그대로 할 수 있다. 다른 능력의 판정은 바뀌지 않는다.
  body := pg_get_functiondef('private.has_operator_capability(uuid,text,boolean)'::regprocedure);
  anchor := $a$if not coalesce(access->'capabilities' ? p_capability,false) then return false; end if;$a$;
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'logistics_dispatch_implication_anchor_changed';
  end if;
  execute replace(body, anchor, $a$if not coalesce(access->'capabilities' ? p_capability,false)
    -- sales.manage는 출고 전용 sales.dispatch를 포함한다(1014-084).
    and not (p_capability='sales.dispatch' and coalesce(access->'capabilities' ? 'sales.manage',false)) then return false; end if;$a$);

  -- RLS 계약은 어느 역할이든 실제로 가질 수 있는 능력만 받는다. 통합 매니저 목록에 없는 sales.dispatch도 그중 하나다.
  body := pg_get_functiondef('private.register_operator_policy_contract(regclass,text,text)'::regprocedure);
  anchor := $a$if not(p_capability=any(private.operator_role_capabilities('owner'))) then$a$;
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'logistics_dispatch_policy_anchor_changed';
  end if;
  execute replace(body, anchor, $a$if not exists(select 1 from unnest(array['owner','primary','deputy','influencer','agency','logistics']) as role_name
    where p_capability=any(private.operator_role_capabilities(role_name))) then$a$);
end $patch$;

-- 3. 출고 함수의 능력 검사를 sales.manage에서 sales.dispatch로 바꾼다.
-- 함수마다 'sales.manage'가 정해진 횟수만큼, 모두 능력 검사 호출의 인자로만 나와야 한다(진입 검사와 옛 staff 검사).
-- 안쪽 private 함수 세 개도 같은 출고 경로의 검사라 함께 바꾼다. public.admin_shipment_export는 자기 검사가 없고
-- private.admin_shipment_export_before_production의 검사를 쓴다. 택배 외 인계·수령 기록과 그 읽기도 같은 출고 업무다.
do $patch$
declare
  item record;
  body text;
  token constant text := $a$'sales.manage'$a$;
  guard constant text := $a$(require_operator_capability|has_operator_capability)\((auth\.uid\(\),)?'sales\.manage'$a$;
  found_tokens integer;
  found_guards integer;
begin
  for item in select * from (values
    ('public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)', 1),
    ('public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text)', 2),
    ('public.admin_shipment_pack_summaries(uuid[])', 1),
    ('public.admin_shipment_production_summaries(uuid[])', 1),
    ('public.admin_smartstore_shipment_export(uuid[])', 1),
    ('private.admin_shipment_export_before_production(uuid[])', 1),
    ('public.admin_mark_shipments_exported(jsonb)', 2),
    ('public.admin_mark_seowon_shipments_exported(jsonb,uuid,jsonb)', 1),
    ('public.admin_origin_pending_export_ids(uuid)', 1),
    ('public.admin_shipment_barcode_gaps(uuid[],uuid)', 1),
    ('public.admin_origin_tracking_candidates(uuid,text[],text[])', 1),
    ('public.admin_import_seowon_tracking_batch(uuid,jsonb)', 1),
    ('public.admin_import_warehouse_tracking_batch(uuid,jsonb)', 2),
    ('public.admin_import_shipment_tracking_batch(jsonb)', 2),
    ('public.admin_import_item_tracking_batch(jsonb)', 1),
    ('private.admin_import_item_tracking_batch_before_numbers(jsonb)', 1),
    ('private.admin_import_item_tracking_batch_before_identity_guard(jsonb)', 1),
    ('public.admin_import_shipment_tracking(text,text,text)', 1),
    ('public.admin_update_shipment_status(uuid,text,text,text)', 1),
    ('public.admin_update_shipment_tracking(uuid,text,text)', 1),
    ('public.admin_complete_shipments(uuid[])', 2),
    ('public.admin_enqueue_shipment_emails(jsonb)', 2),
    ('public.admin_read_shipment_delivery(uuid)', 2),
    ('public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamp with time zone,uuid)', 2)
  ) as target(signature, expected)
  loop
    body := pg_get_functiondef(item.signature::regprocedure);
    found_tokens := (length(body) - length(replace(body, token, ''))) / length(token);
    select count(*) into found_guards from regexp_matches(body, guard, 'g');
    if found_tokens <> item.expected or found_guards <> item.expected then
      raise exception 'logistics_dispatch_guard_anchor_changed: % (tokens %, guards %, expected %)',
        item.signature, found_tokens, found_guards, item.expected;
    end if;
    execute replace(body, token, $a$'sales.dispatch'$a$);
  end loop;
end $patch$;

-- 4. 사용자 결정(2026-11-11) "수령인 정보만": 주문 조회 권한(sales.read)이 없는 출고 전용 운영자에게는
-- 발송·배송현황 목록에서 구매자 닉네임·주문 총액·결제수단·배송비를 비운다. 구매자(닉네임·이메일)로 찾거나
-- 결제수단·결제일로 거르거나 금액으로 정렬해 그 값을 알아내지도 못한다. 주문 조회 권한이 있으면 응답은 그대로다.
create function private.shipment_console_for_reader(p_result jsonb)
returns jsonb language sql stable set search_path='' as $$
  select case when p_result is null or jsonb_typeof(p_result->'rows') is distinct from 'array'
      or public.has_operator_capability('sales.read',false) then p_result
    else jsonb_set(p_result,'{rows}',coalesce((select jsonb_agg(entry.value
        ||'{"buyerName":null,"total":null,"paymentMethod":null,"shippingFee":null}'::jsonb order by entry.ordinality)
      from jsonb_array_elements(p_result->'rows') with ordinality entry(value,ordinality)),'[]'::jsonb)) end;
$$;
revoke all on function private.shipment_console_for_reader(jsonb) from public,anon,authenticated,service_role;

-- 표준 출고지시 자료(ICONS 표준 양식)의 구매자·결제·품목 금액도 같은 기준으로 비운다. 배송 건 줄의 배송비·단가는
-- 창고 양식(김포 21열·배송 운영 안내)이 함께 쓰는 값이라 여기서 지우지 않고, 표준 양식 파일은 앱이 비운다.
create function private.shipment_export_detail_for_reader(p_detail jsonb,p_reads_orders boolean)
returns jsonb language sql immutable set search_path='' as $$
  select case when p_reads_orders then p_detail else p_detail||'{"buyerName":null,"buyerId":null,"paidAt":null,"paymentMethod":null,
    "productPrice":null,"optionPrice":null,"itemTotal":null,"itemDiscount":null,"sellerDiscount":null,"regionalShippingFee":null,
    "shippingDiscount":null}'::jsonb end;
$$;
revoke all on function private.shipment_export_detail_for_reader(jsonb,boolean) from public,anon,authenticated,service_role;

do $patch$
declare
  target regprocedure;
  body text;
  buyer_anchor constant text := $a$(p_field in ('all','buyer') and (position(lower(needle) in lower(coalesce(p.nickname,'')))>0 or position(lower(needle) in lower(coalesce(p.email,'')))>0))$a$;
  normalize constant text := $a$
 if not public.has_operator_capability('sales.read',false) then
  -- 출고 전용 운영자는 결제수단·결제일·금액으로 거르거나 정렬하지 않는다(수령인 정보만, 1014-084).
  p_payment_method:=null;
  if p_date_field='paid' then p_date_field:='ordered'; end if;
  if p_sort in ('amount_high','amount_low') then p_sort:='oldest'; end if;
 end if;$a$;
  notice_guard constant text := $a$if not public.has_operator_capability('sales.dispatch',false) then raise insufficient_privilege using message='operator_capability_required';end if;$a$;
  staff_guard constant text := $a$if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;$a$;
  notice_return constant text := $a$ return result;
end$a$;
  console_call constant text := $a$result:=private.admin_search_shipments_console_before_custom_inputs(p_tab,p_origin_id,p_query,p_from,p_to,p_limit,p_offset,p_field,p_date_field,p_method,p_payment_method,p_sort);$a$;
  detail_open constant text := $a$select jsonb_agg(line.value||jsonb_build_object('smartstore',jsonb_build_object($a$;
  detail_close constant text := $a$)) order by line.ordinality)$a$;
  fee_anchor constant text := $a$'shippingFee',shipment.shipping_fee,$a$;
  pack_anchor constant text := $a$jsonb_object_agg(id,private.shipment_pack_summary(id))$a$;
begin
  -- 발주·발송 목록(지연 안내 포함): 구매자 검색·거르기·정렬을 막고 응답을 비운다.
  target := 'public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)'::regprocedure;
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, buyer_anchor, ''))) / length(buyer_anchor) <> 1
    or (length(body) - length(replace(body, notice_guard, ''))) / length(notice_guard) <> 1
    or (length(body) - length(replace(body, notice_return, ''))) / length(notice_return) <> 1 then
    raise exception 'logistics_dispatch_notice_console_anchor_changed';
  end if;
  body := replace(body, buyer_anchor, $a$((select public.has_operator_capability('sales.read',false)) and $a$ || buyer_anchor || ')');
  body := replace(body, notice_guard, notice_guard || normalize);
  body := replace(body, notice_return, $a$ return private.shipment_console_for_reader(result);
end$a$);
  execute body;

  -- 배송현황 목록: 안쪽 조회가 거르기·정렬을 막고, 바깥 함수가 응답을 비운다.
  target := 'private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text)'::regprocedure;
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, buyer_anchor, ''))) / length(buyer_anchor) <> 1
    or (length(body) - length(replace(body, staff_guard, ''))) / length(staff_guard) <> 1 then
    raise exception 'logistics_dispatch_shipping_console_anchor_changed';
  end if;
  body := replace(body, buyer_anchor, $a$((select public.has_operator_capability('sales.read',false)) and $a$ || buyer_anchor || ')');
  body := replace(body, staff_guard, staff_guard || normalize);
  execute body;
  target := 'public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text)'::regprocedure;
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, console_call, ''))) / length(console_call) <> 1 then
    raise exception 'logistics_dispatch_shipping_console_call_anchor_changed';
  end if;
  execute replace(body, console_call, $a$result:=private.shipment_console_for_reader(private.admin_search_shipments_console_before_custom_inputs(p_tab,p_origin_id,p_query,p_from,p_to,p_limit,p_offset,p_field,p_date_field,p_method,p_payment_method,p_sort));$a$);

  -- ICONS 표준 양식 자료: 줄마다 구매자·결제·품목 금액을 비운다(판정은 조회마다 한 번).
  target := 'public.admin_smartstore_shipment_export(uuid[])'::regprocedure;
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, detail_open, ''))) / length(detail_open) <> 1
    or (length(body) - length(replace(body, detail_close, ''))) / length(detail_close) <> 1 then
    raise exception 'logistics_dispatch_standard_export_anchor_changed';
  end if;
  body := replace(body, detail_open, $a$select jsonb_agg(line.value||jsonb_build_object('smartstore',private.shipment_export_detail_for_reader(jsonb_build_object($a$);
  body := replace(body, detail_close, $a$),(select public.has_operator_capability('sales.read',false)))) order by line.ordinality)$a$);
  execute body;

  -- 발송 목록의 합포장 요약에 실리는 묶음 착불 배송비도 비운다(목록 화면에는 표시하지 않지만 화면 자료로 전달된다).
  target := 'public.admin_shipment_pack_summaries(uuid[])'::regprocedure;
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, pack_anchor, ''))) / length(pack_anchor) <> 1 then
    raise exception 'logistics_dispatch_pack_summary_anchor_changed';
  end if;
  execute replace(body, pack_anchor, $a$jsonb_object_agg(id,case when (select public.has_operator_capability('sales.read',false)) then private.shipment_pack_summary(id)
    else private.shipment_pack_summary(id)||'{"collectFee":null}'::jsonb end)$a$);

  -- 택배 외 인계 정보 읽기의 배송비도 같은 기준으로 비운다.
  target := 'public.admin_read_shipment_delivery(uuid)'::regprocedure;
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, fee_anchor, ''))) / length(fee_anchor) <> 1 then
    raise exception 'logistics_dispatch_delivery_fee_anchor_changed';
  end if;
  execute replace(body, fee_anchor, $a$'shippingFee',case when public.has_operator_capability('sales.read',false) then shipment.shipping_fee end,$a$);
end $patch$;

-- 4-2. 택배 외 인계 정보 읽기에서 배송 방식 변경용 자료는 주문 관리 권한(sales.manage)이 있을 때만 준다.
-- 출고 전용 운영자는 저장된 인계 조건·상태·인계·수령 이력을 보고, 출고지의 방식 정책 목록과
-- 방식 변경 이력의 고객 요청·배송비 동의 근거(운영자가 적은 고객 응대 메모)는 받지 않는다.
do $patch$
declare
  target constant regprocedure := 'public.admin_read_shipment_delivery(uuid)'::regprocedure;
  body text;
  policies_anchor constant text := $a$'policies',public.admin_list_delivery_policies(shipment.origin_id),$a$;
  evidence_anchor constant text := $a$'evidence',operation.evidence,$a$;
begin
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, policies_anchor, ''))) / length(policies_anchor) <> 1
    or (length(body) - length(replace(body, evidence_anchor, ''))) / length(evidence_anchor) <> 1 then
    raise exception 'logistics_dispatch_delivery_read_anchor_changed';
  end if;
  body := replace(body, policies_anchor,
    $a$'policies',case when public.has_operator_capability('sales.manage',false) then public.admin_list_delivery_policies(shipment.origin_id) else '[]'::jsonb end,$a$);
  body := replace(body, evidence_anchor,
    $a$'evidence',case when (select public.has_operator_capability('sales.manage',false)) then operation.evidence
      else operation.evidence-'customerRequestReference'-'feeConsentReference' end,$a$);
  execute body;
end $patch$;

-- 5. 회신 대조와 출고지별 내려받기는 출고지 설정(이름·양식·기본 택배사)을 읽는다. 고객 정보는 없는 표다.
create policy fulfillment_origins_dispatch_read on public.fulfillment_origins
  for select to authenticated
  using ((select public.has_operator_capability('sales.dispatch')));

-- 6. 운영자 계약 지문을 다시 적는다. 출고 RPC는 분류(read/write)와 legacy 관리자 전용 여부를 그대로 두고 능력만 바꾼다.
do $contracts$
declare
  changed integer;
begin
  if (select count(*) from private.operator_rpc_contracts where signature in (
      'public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)',
      'public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text)',
      'public.admin_shipment_pack_summaries(uuid[])',
      'public.admin_shipment_production_summaries(uuid[])',
      'public.admin_smartstore_shipment_export(uuid[])',
      'public.admin_shipment_export(uuid[])',
      'public.admin_mark_shipments_exported(jsonb)',
      'public.admin_mark_seowon_shipments_exported(jsonb,uuid,jsonb)',
      'public.admin_origin_pending_export_ids(uuid)',
      'public.admin_shipment_barcode_gaps(uuid[],uuid)',
      'public.admin_origin_tracking_candidates(uuid,text[],text[])',
      'public.admin_import_seowon_tracking_batch(uuid,jsonb)',
      'public.admin_import_warehouse_tracking_batch(uuid,jsonb)',
      'public.admin_import_shipment_tracking_batch(jsonb)',
      'public.admin_import_item_tracking_batch(jsonb)',
      'public.admin_import_shipment_tracking(text,text,text)',
      'public.admin_update_shipment_status(uuid,text,text,text)',
      'public.admin_update_shipment_tracking(uuid,text,text)',
      'public.admin_complete_shipments(uuid[])',
      'public.admin_enqueue_shipment_emails(jsonb)',
      'public.admin_read_shipment_delivery(uuid)',
      'public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamp with time zone,uuid)'
    ) and capability='sales.manage' and guard_kind in ('read','write') and not legacy_admin_only) <> 22 then
    raise exception 'logistics_dispatch_contract_baseline_changed';
  end if;
  perform private.register_operator_rpc_contract(c.signature::regprocedure, 'sales.dispatch', c.guard_kind, c.legacy_admin_only)
  from private.operator_rpc_contracts c
  where c.signature in (
    'public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)',
    'public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text)',
    'public.admin_shipment_pack_summaries(uuid[])',
    'public.admin_shipment_production_summaries(uuid[])',
    'public.admin_smartstore_shipment_export(uuid[])',
    'public.admin_shipment_export(uuid[])',
    'public.admin_mark_shipments_exported(jsonb)',
    'public.admin_mark_seowon_shipments_exported(jsonb,uuid,jsonb)',
    'public.admin_origin_pending_export_ids(uuid)',
    'public.admin_shipment_barcode_gaps(uuid[],uuid)',
    'public.admin_origin_tracking_candidates(uuid,text[],text[])',
    'public.admin_import_seowon_tracking_batch(uuid,jsonb)',
    'public.admin_import_warehouse_tracking_batch(uuid,jsonb)',
    'public.admin_import_shipment_tracking_batch(jsonb)',
    'public.admin_import_item_tracking_batch(jsonb)',
    'public.admin_import_shipment_tracking(text,text,text)',
    'public.admin_update_shipment_status(uuid,text,text,text)',
    'public.admin_update_shipment_tracking(uuid,text,text)',
    'public.admin_complete_shipments(uuid[])',
    'public.admin_enqueue_shipment_emails(jsonb)',
    'public.admin_read_shipment_delivery(uuid)',
    'public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamp with time zone,uuid)'
  );
  select count(*) into changed from private.operator_rpc_contracts where capability='sales.dispatch';
  if changed <> 22 then raise exception 'logistics_dispatch_contract_count: %', changed; end if;
end $contracts$;

-- 본문을 바꾼 함수와 능력 판정 함수의 내부 지문.
select private.register_operator_internal_contract(signature::regprocedure)
from private.operator_internal_contracts
where signature::regprocedure in (
  'private.operator_role_capabilities(text)'::regprocedure,
  'private.has_operator_capability(uuid,text,boolean)'::regprocedure,
  'private.register_operator_policy_contract(regclass,text,text)'::regprocedure,
  'public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)'::regprocedure,
  'public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text)'::regprocedure,
  'private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text)'::regprocedure,
  'public.admin_shipment_pack_summaries(uuid[])'::regprocedure,
  'public.admin_shipment_production_summaries(uuid[])'::regprocedure,
  'public.admin_smartstore_shipment_export(uuid[])'::regprocedure,
  'private.admin_shipment_export_before_production(uuid[])'::regprocedure,
  'public.admin_mark_shipments_exported(jsonb)'::regprocedure,
  'public.admin_mark_seowon_shipments_exported(jsonb,uuid,jsonb)'::regprocedure,
  'public.admin_origin_pending_export_ids(uuid)'::regprocedure,
  'public.admin_shipment_barcode_gaps(uuid[],uuid)'::regprocedure,
  'public.admin_origin_tracking_candidates(uuid,text[],text[])'::regprocedure,
  'public.admin_import_seowon_tracking_batch(uuid,jsonb)'::regprocedure,
  'public.admin_import_warehouse_tracking_batch(uuid,jsonb)'::regprocedure,
  'public.admin_import_shipment_tracking_batch(jsonb)'::regprocedure,
  'public.admin_import_item_tracking_batch(jsonb)'::regprocedure,
  'private.admin_import_item_tracking_batch_before_numbers(jsonb)'::regprocedure,
  'private.admin_import_item_tracking_batch_before_identity_guard(jsonb)'::regprocedure,
  'public.admin_import_shipment_tracking(text,text,text)'::regprocedure,
  'public.admin_update_shipment_status(uuid,text,text,text)'::regprocedure,
  'public.admin_update_shipment_tracking(uuid,text,text)'::regprocedure,
  'public.admin_complete_shipments(uuid[])'::regprocedure,
  'public.admin_enqueue_shipment_emails(jsonb)'::regprocedure,
  'public.admin_read_shipment_delivery(uuid)'::regprocedure,
  'public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamp with time zone,uuid)'::regprocedure
);
-- 새 판정 함수도 내부 지문을 남겨 뒤 migration이 조용히 바꾸면 coverage가 잡게 한다.
select private.register_operator_internal_contract('private.shipment_console_for_reader(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.shipment_export_detail_for_reader(jsonb,boolean)'::regprocedure);

select private.register_operator_policy_contract('public.fulfillment_origins'::regclass, 'fulfillment_origins_dispatch_read', 'sales.dispatch');

commit;
