-- 1014-084 물류 전용 출고 권한. 10/14 회의 "배송은 배송에서 봐야 된다고"(49:32)에 대한 사용자 결정(2026-11-11):
-- "물류 전용 출고 권한 (Recommended)" — 출고지시 내려받기·송장 회신·발송·배송완료, 환불·고객 관리 제외.
--
-- 물류출고관리(logistics) 역할에 출고 전용 능력 sales.dispatch를 더한다. sales.dispatch로 여는 것은
-- 발주확인·발송관리와 배송현황의 목록 조회, 출고지시 내려받기와 전달 표시, 운송장 회신 반입, 발송 처리(발송 대기→배송중),
-- 배송완료(배송중→배송완료), 발송 안내 메일 대기열 등록, 그리고 회신 대조에 필요한 출고지 설정 읽기뿐이다.
-- 발주확인(주문 상태 변경)·취소·환불·클레임·고객·상품 관리·목록 엑셀·합포장·지연 안내는 지금처럼 sales.manage 등에 남는다.
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
-- private.admin_shipment_export_before_production의 검사를 쓴다.
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
    ('public.admin_enqueue_shipment_emails(jsonb)', 2)
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

-- 4. 구매자 검색은 닉네임으로만 한다. 이메일 일치는 주문 조회 권한(sales.read)이 있을 때만 본다 —
-- 출고 전용 운영자가 이메일 일부를 넣어 구매자 이메일을 알아내지 못하게 한다(출고에 필요한 수령인 정보만).
do $patch$
declare
  target regprocedure;
  body text;
  anchor constant text := $a$position(lower(needle) in lower(coalesce(p.email,'')))>0$a$;
begin
  foreach target in array array[
    'public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)'::regprocedure,
    'private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text)'::regprocedure
  ] loop
    body := pg_get_functiondef(target);
    if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'logistics_dispatch_buyer_email_anchor_changed: %', target;
    end if;
    execute replace(body, anchor,
      $a$((select public.has_operator_capability('sales.read',false)) and position(lower(needle) in lower(coalesce(p.email,'')))>0)$a$);
  end loop;
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
      'public.admin_enqueue_shipment_emails(jsonb)'
    ) and capability='sales.manage' and guard_kind in ('read','write') and not legacy_admin_only) <> 20 then
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
    'public.admin_enqueue_shipment_emails(jsonb)'
  );
  select count(*) into changed from private.operator_rpc_contracts where capability='sales.dispatch';
  if changed <> 20 then raise exception 'logistics_dispatch_contract_count: %', changed; end if;
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
  'public.admin_enqueue_shipment_emails(jsonb)'::regprocedure
);

select private.register_operator_policy_contract('public.fulfillment_origins'::regclass, 'fulfillment_origins_dispatch_read', 'sales.dispatch');

commit;
