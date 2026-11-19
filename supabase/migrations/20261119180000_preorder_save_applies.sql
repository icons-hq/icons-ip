-- ==========================================================================
-- ICONS · 예약판매는 저장하면 적용된다 (2026-11-19 사용자·MD 결정)
--
-- 2026-11-19 홍실 2차 신규 상품 7개가 예약 '초안'으로만 저장된 채 공개되어, 예약 대신 일반 재고(재고수량
-- 300~1,000)로 바로 구매할 수 있는 상태였다. 원인은 예약판매에만 있던 세 가지 브레이크였다.
--   ① 저장 방식 '초안'(판매에 반영되지 않는 상태) ② 활성화 필수값 '승인 문서·확인 근거'
--   ③ 활성화·일반 재고 전환을 platform.manage(계정 주매니저·통합 매니저)에만 허용.
-- 결정: "그딴 승인문서 필요 없어 그냥 MD가 등록하면 완료되는거야" · "초안 저장도 그냥 없애구 다른 작성
-- 항목이랑 동일하게"(MD) · "꼭 들어가야하는 내용들 없으면 그때만 알람처리".
--
-- 이 migration이 고정하는 것:
--   1. 예약 정책에는 초안이 없다. 상태는 active·stopped뿐이고(테이블 CHECK), admin_save_goods_preorder는
--      'draft'를 받지 않는다. 필수값(물량·접수 시작·종료·발송 예정일)이 비면 저장 자체가 거절된다.
--   2. 승인 근거(approval_reference)는 선택 메모다. 일정 일괄 변경이 남기는 변경 사유처럼 값이 있으면 보존한다.
--   3. 예약 적용·일반 재고 전환은 상품 관리 권한(catalog.manage)이면 된다. 감사 기록은 그대로 남긴다.
--   4. 일반 재고 전환은 접수 중인 정책도 받는다 — 미할당 예약이 0이면 정책을 중지하고 바로 일반 재고로 돌린다
--      (전에는 [새 예약 접수 중지] 뒤 [일반 재고 판매로 전환]을 따로 눌러야 했다).
--   5. 남은 초안은 지운다. 초안은 판매에 영향이 없었으므로(선택된 정책이 아니다) 지워도 주문·예약 장부와 무관하다.
--      초안이 있던 사용 중 옵션이 예약 없이 일반 재고로 팔리던 상품(선택된 예약 정책 없음)이 공개 중이면 "임시저장이면
--      보이지 않는다"에 맞춰 비공개로 내린다. 예약이 적용돼 판매 중인 옵션에 다음 회차 초안만 남은 상품이나 사용 중지
--      옵션의 초안은 내리지 않는다. 지운 값과 비공개 전환은 audit_log에 남긴다. 2026-11-19 운영 실측: 초안 7행 =
--      홍실 2차 6개 상품(HSQ-0059·0060·0061(옵션 2)·0062·0064·0065), 모두 공개·일반 재고 판매 상태.
--
-- 바꾸지 않는 것: 적용한 정책의 물량·기간·원 예정일 불변(바꾸려면 중지 후 새로 적용), 예약 장부·입고 할당·
-- 환불 회복, 랜덤 판매 예약 일괄 저장(admin_save_random_goods_preorders — 옵션별로 아래 두 함수를 부른다),
-- 일정 일괄 변경의 '접수 중 조건 교체' 권한(별도 흐름, 주문 관리).
-- ==========================================================================

begin;

-- 1. 남은 초안 정리 --------------------------------------------------------------------------------------------
with drafts as (
  select policy.*, variant.good_id, variant.archived_at is null and variant.preorder_policy_id is null as selling_as_stock
  from private.goods_preorder_policies policy
  join public.goods_variants variant on variant.id=policy.variant_id
  where policy.state='draft'
), unpublished as (
  update public.goods good set published_at=null
  where good.id in (select good_id from drafts where selling_as_stock) and good.published_at is not null and good.archived_at is null
  returning good.id
), unpublish_audit as (
  insert into public.audit_log(actor_id,action,target,diff)
  select null,'admin.good.unpublished','goods:'||unpublished.id,
    jsonb_build_object('published_at',null,'reason','preorder_draft_retired',
      'note','예약판매 초안(판매 미적용)만 있는 상태로 공개되어 있어 비공개로 내림 — 예약을 적용한 뒤 다시 공개')
  from unpublished
  returning 1
)
insert into public.audit_log(actor_id,action,target,diff)
select null,'admin.good.preorder_draft_retired','goods:'||drafts.good_id,
  jsonb_build_object('before',to_jsonb(drafts)-'good_id'-'selling_as_stock','after',null,
    'unpublished',exists(select 1 from unpublished where unpublished.id=drafts.good_id))
from drafts;

delete from private.goods_preorder_policies where state='draft';

-- 2. 테이블 규칙: 초안 없음, 승인 근거 선택 --------------------------------------------------------------------
alter table private.goods_preorder_policies drop constraint goods_preorder_policies_state_check;
alter table private.goods_preorder_policies drop constraint goods_preorder_policies_check1;
alter table private.goods_preorder_policies alter column state set default 'active';
alter table private.goods_preorder_policies add constraint goods_preorder_policies_state_check
  check(state in ('active','stopped'));
alter table private.goods_preorder_policies add constraint goods_preorder_policies_complete check(
  capacity_qty is not null and starts_at is not null and ends_at is not null and expected_ship_date is not null
  and activated_by is not null and activated_at is not null);

-- 3. 예약 저장: 저장 = 적용 ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_goods_preorder(p_good_id text, p_variant_id uuid, p_policy_id uuid, p_values jsonb, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); variant public.goods_variants; previous private.goods_preorder_policies; saved private.goods_preorder_policies;
  state_value text; capacity_value integer; starts_value timestamptz; ends_value timestamptz; date_value date; note_value text;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not coalesce(public.has_operator_capability('catalog.manage',false),false) then raise insufficient_privilege using message='staff required'; end if;
  if jsonb_typeof(p_values) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_values) key where key not in ('state','capacityQty','startsAt','endsAt','expectedShipDate','approvalReference')) then
    raise invalid_parameter_value using message='invalid_preorder_policy';
  end if;
  state_value:=p_values->>'state';
  -- 초안은 없다(2026-11-19). 예전 화면이 'draft'를 보내면 저장하지 않고 거절한다.
  if state_value is null or state_value not in ('active','stopped') then raise check_violation using message='invalid_preorder_policy'; end if;
  perform 1 from public.goods where id=p_good_id and archived_at is null for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into variant from public.goods_variants where id=p_variant_id and good_id=p_good_id for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  if p_policy_id is not null then
    select * into previous from private.goods_preorder_policies where id=p_policy_id and variant_id=p_variant_id for update;
    if not found then raise no_data_found using message='preorder_policy_not_found'; end if;
  end if;
  if previous.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='preorder_policy_changed'; end if;
  if state_value='stopped' then
    if previous.state is null then raise check_violation using message='preorder_not_active'; end if;
    if previous.state='stopped' then return jsonb_build_object('id',previous.id,'revision',previous.revision,'changed',false); end if;
    update private.goods_preorder_policies set state='stopped',stopped_by=actor,stopped_at=clock_timestamp(),
      revision=revision+1,updated_at=clock_timestamp() where id=previous.id returning * into saved;
  else
    -- 적용한 정책은 그대로 둔다. 조건을 바꾸려면 중지한 뒤 새 정책을 적용한다.
    if previous.id is not null then raise check_violation using message='preorder_policy_immutable'; end if;
    if p_values->'capacityQty' is not null and p_values->'capacityQty'<>'null'::jsonb then
      if jsonb_typeof(p_values->'capacityQty')<>'number' or p_values->>'capacityQty' !~ '^[1-9][0-9]*$'
        or (p_values->>'capacityQty')::numeric>2147483647 then raise check_violation using message='invalid_preorder_policy'; end if;
      capacity_value:=(p_values->>'capacityQty')::integer;
    end if;
    if nullif(p_values->>'startsAt','') is not null then
      if jsonb_typeof(p_values->'startsAt')<>'string' or p_values->>'startsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then raise check_violation using message='invalid_preorder_policy'; end if;
      starts_value:=(p_values->>'startsAt')::timestamptz;
    end if;
    if nullif(p_values->>'endsAt','') is not null then
      if jsonb_typeof(p_values->'endsAt')<>'string' or p_values->>'endsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then raise check_violation using message='invalid_preorder_policy'; end if;
      ends_value:=(p_values->>'endsAt')::timestamptz;
    end if;
    if nullif(p_values->>'expectedShipDate','') is not null then
      if p_values->>'expectedShipDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise check_violation using message='invalid_preorder_policy'; end if;
      date_value:=(p_values->>'expectedShipDate')::date;
    end if;
    -- 승인 근거는 선택 메모다(일정 일괄 변경이 변경 사유를 붙여 보낸다).
    if p_values->'approvalReference' is not null and p_values->'approvalReference'<>'null'::jsonb and jsonb_typeof(p_values->'approvalReference')<>'string' then
      raise check_violation using message='invalid_preorder_policy';
    end if;
    /* 일정 일괄 교체는 빈 메모 뒤에 줄바꿈과 사유를 붙여 보낸다 — 앞뒤 줄바꿈까지 지운다. */
    note_value:=nullif(btrim(p_values->>'approvalReference',E' \t\r\n'),'');
    if (starts_value is not null and not isfinite(starts_value)) or (ends_value is not null and not isfinite(ends_value))
      or (starts_value is not null and ends_value is not null and starts_value>=ends_value)
      or length(note_value)>2000 then raise check_violation using message='invalid_preorder_policy'; end if;
    if to_regprocedure('private.preorder_checkout_ready()') is null then raise check_violation using message='preorder_runtime_not_ready'; end if;
    if capacity_value is null or starts_value is null or ends_value is null or date_value is null
      or ends_value<=clock_timestamp() or date_value<(ends_value at time zone 'Asia/Seoul')::date then
      raise check_violation using message='preorder_policy_not_configured';
    end if;
    if variant.archived_at is not null then raise check_violation using message='goods_variant_inactive'; end if;
    if exists(select 1 from private.goods_preorder_policies where variant_id=variant.id and state='active') then
      raise check_violation using message='preorder_policy_already_active';
    end if;
    insert into private.goods_preorder_policies(variant_id,state,capacity_qty,starts_at,ends_at,expected_ship_date,approval_reference,created_by,activated_by,activated_at)
    values(variant.id,'active',capacity_value,starts_value,ends_value,date_value,note_value,actor,actor,clock_timestamp()) returning * into saved;
    update public.goods_variants set preorder_policy_id=saved.id where id=variant.id;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.preorder_saved','goods:'||p_good_id,
    jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'revision',saved.revision,'changed',true);
end $function$;
revoke all on function public.admin_save_goods_preorder(text,uuid,uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_preorder(text,uuid,uuid,jsonb,integer) to authenticated;

-- 4. 일반 재고 전환: 상품 관리 권한, 접수 중이면 중지까지 한 번에 ------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_use_stock_supply(p_good_id text, p_variant_id uuid, p_expected_policy_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); variant public.goods_variants; policy private.goods_preorder_policies;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not coalesce(public.has_operator_capability('catalog.manage',false),false) then
    raise insufficient_privilege using message='staff required';
  end if;
  perform 1 from public.goods where id=p_good_id and archived_at is null for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into variant from public.goods_variants where id=p_variant_id and good_id=p_good_id for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  if variant.preorder_policy_id is null and p_expected_policy_id is null then return jsonb_build_object('changed',false); end if;
  if variant.preorder_policy_id is distinct from p_expected_policy_id then raise sqlstate 'PT409' using message='preorder_policy_changed'; end if;
  select * into policy from private.goods_preorder_policies where id=variant.preorder_policy_id for update;
  if policy.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='preorder_policy_changed'; end if;
  -- 미할당 예약은 지금 선택된 정책만이 아니라 이 옵션의 모든 정책(이전 회차 포함)에서 센다.
  if exists(select 1 from private.goods_preorder_reservations reservation join private.goods_preorder_policies source on source.id=reservation.policy_id
    where source.variant_id=variant.id and reservation.state='reserved') then raise check_violation using message='preorder_allocations_pending'; end if;
  if policy.state='active' then
    update private.goods_preorder_policies set state='stopped',stopped_by=actor,stopped_at=clock_timestamp(),
      revision=revision+1,updated_at=clock_timestamp() where id=policy.id;
  end if;
  update public.goods_variants set preorder_policy_id=null where id=variant.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.stock_supply_selected','goods:'||p_good_id,
    jsonb_build_object('variantId',variant.id,'previousPolicyId',policy.id,'stoppedPolicy',policy.state='active'));
  return jsonb_build_object('changed',true);
end $function$;
revoke all on function public.admin_use_stock_supply(text,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_use_stock_supply(text,uuid,uuid,integer) to authenticated;

select private.register_operator_rpc_contract('public.admin_save_goods_preorder(text,uuid,uuid,jsonb,integer)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_use_stock_supply(text,uuid,uuid,integer)'::regprocedure,'catalog.manage','write',false);

commit;
notify pgrst,'reload schema';
