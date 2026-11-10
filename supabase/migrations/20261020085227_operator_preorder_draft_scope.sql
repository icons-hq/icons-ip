-- Drafting/stopping a preorder stays catalog work; activation retains the
-- separate platform approval gate inside the existing state transition.
CREATE OR REPLACE FUNCTION public.admin_save_goods_preorder(p_good_id text, p_variant_id uuid, p_policy_id uuid, p_values jsonb, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); variant public.goods_variants; previous private.goods_preorder_policies; saved private.goods_preorder_policies;
  state_value text; capacity_value integer; starts_value timestamptz; ends_value timestamptz; date_value date; evidence_value text; is_admin boolean;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not coalesce(public.has_operator_capability('catalog.manage',false),false) then raise insufficient_privilege using message='staff required'; end if;
  is_admin:=exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true));
  if jsonb_typeof(p_values) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_values) key where key not in ('state','capacityQty','startsAt','endsAt','expectedShipDate','approvalReference')) then
    raise invalid_parameter_value using message='invalid_preorder_policy';
  end if;
  state_value:=p_values->>'state';
  if state_value is null or state_value not in ('draft','active','stopped') then raise check_violation using message='invalid_preorder_policy'; end if;
  if state_value='active' and not is_admin then raise insufficient_privilege using message='preorder_admin_required'; end if;
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
    if previous.state is null or previous.state='draft' then raise check_violation using message='preorder_not_active'; end if;
    if previous.state='stopped' then return jsonb_build_object('id',previous.id,'revision',previous.revision,'changed',false); end if;
    update private.goods_preorder_policies set state='stopped',stopped_by=actor,stopped_at=clock_timestamp(),
      revision=revision+1,updated_at=clock_timestamp() where id=previous.id returning * into saved;
  else
    if previous.state is not null and previous.state<>'draft' then raise check_violation using message='preorder_policy_immutable'; end if;
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
    if p_values->'approvalReference' is not null and p_values->'approvalReference'<>'null'::jsonb and jsonb_typeof(p_values->'approvalReference')<>'string' then
      raise check_violation using message='invalid_preorder_policy';
    end if;
    evidence_value:=nullif(btrim(p_values->>'approvalReference'),'');
    if (starts_value is not null and not isfinite(starts_value)) or (ends_value is not null and not isfinite(ends_value))
      or (starts_value is not null and ends_value is not null and starts_value>=ends_value)
      or length(evidence_value)>2000 then raise check_violation using message='invalid_preorder_policy'; end if;
    if state_value='active' then
      if to_regprocedure('private.preorder_checkout_ready()') is null then raise check_violation using message='preorder_runtime_not_ready'; end if;
      if capacity_value is null or starts_value is null or ends_value is null or date_value is null or evidence_value is null
        or ends_value<=clock_timestamp() or date_value<(ends_value at time zone 'Asia/Seoul')::date then
        raise check_violation using message='preorder_policy_not_configured';
      end if;
      if variant.archived_at is not null then raise check_violation using message='goods_variant_inactive'; end if;
      if exists(select 1 from private.goods_preorder_policies where variant_id=variant.id and state='active' and id is distinct from previous.id) then
        raise check_violation using message='preorder_policy_already_active';
      end if;
    end if;
    if previous.id is null then
      insert into private.goods_preorder_policies(variant_id,state,capacity_qty,starts_at,ends_at,expected_ship_date,approval_reference,created_by,activated_by,activated_at)
      values(variant.id,state_value,capacity_value,starts_value,ends_value,date_value,evidence_value,actor,
        case when state_value='active' then actor end,case when state_value='active' then clock_timestamp() end) returning * into saved;
    else
      update private.goods_preorder_policies set state=state_value,capacity_qty=capacity_value,starts_at=starts_value,ends_at=ends_value,
        expected_ship_date=date_value,approval_reference=evidence_value,revision=revision+1,updated_at=clock_timestamp(),
        activated_by=case when state_value='active' then actor end,activated_at=case when state_value='active' then clock_timestamp() end
        where id=previous.id returning * into saved;
    end if;
    if saved.state='active' then update public.goods_variants set preorder_policy_id=saved.id where id=variant.id; end if;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.preorder_saved','goods:'||p_good_id,
    jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'revision',saved.revision,'changed',true);
end $function$

;
select private.register_operator_rpc_contract('public.admin_save_goods_preorder(text,uuid,uuid,jsonb,integer)'::regprocedure,'catalog.manage','write',false);
