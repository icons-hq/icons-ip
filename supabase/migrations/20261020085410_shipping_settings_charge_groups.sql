-- DRAFT: opt-in shipping charge group references in shipping templates.
-- Existing templates preserve assignments; v3 binds assignment/group revisions.
-- The original applied migrations and existing orders are not changed.
create function private.validate_shipping_settings_charge(p_settings jsonb) returns void
language plpgsql immutable set search_path='' as $$declare directive jsonb;begin
 perform private.validate_shipping_settings_extended(p_settings-'chargeGroup');
 if not(p_settings ? 'chargeGroup') then return;end if;
 directive:=p_settings->'chargeGroup';
 if private.transaction_json_keys(directive,array['mode']) and directive->>'mode' in('preserve','clear') then return;end if;
 if not coalesce(private.transaction_json_keys(directive,array['mode','groupId']) and directive->>'mode'='assign'
  and private.shipping_settings_uuid(directive->'groupId'),false) then
  raise invalid_parameter_value using message='invalid_shipping_settings_charge_group';end if;
end $$;

create function private.shipping_settings_charge_good_guard(p_good public.goods) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.shipping_settings_good_guard(p_good) || jsonb_build_object(
  'assignmentRevision',state->'assignmentRevision','assignmentVersionId',state->'assignmentVersionId',
  'groupId',state->'groupId','groupRevision',state->'groupRevision')
 from (select private.shipping_charge_group_good_guard(p_good) state) current_state;
$$;
create function private.shipping_settings_charge_summary(p_good public.goods) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(private.shipping_charge_group_summary((private.shipping_charge_group_good_guard(p_good)->>'groupId')::uuid),'null'::jsonb);
$$;
create function private.shipping_settings_charge_effective(p_settings jsonb,p_delivery jsonb,p_group jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select private.shipping_settings_effective(p_settings,p_delivery)||jsonb_build_object('chargeGroup',coalesce(p_group,'null'::jsonb));
$$;
create function private.shipping_settings_charge_blocker(p_good public.goods,p_settings jsonb,p_current_delivery jsonb,p_origin jsonb,p_group jsonb) returns text
language plpgsql stable security definer set search_path='' as $$declare reason text;directive text;begin
 reason:=private.shipping_settings_delivery_blocker(p_good.id,p_settings,p_current_delivery,p_origin);
 if reason is not null then return reason;end if;
 directive:=coalesce(p_settings#>>'{chargeGroup,mode}','preserve');
 if directive='assign' and (p_group is null or p_group='null'::jsonb) then return 'shipping_charge_group_unavailable';end if;
 if p_group is not null and p_group<>'null'::jsonb then
  if p_group->>'originId' is distinct from p_settings->>'originId' then return 'shipping_charge_group_origin_mismatch';end if;
  if not coalesce((p_group->>'enabled')::boolean,false) or coalesce((p_group->>'archived')::boolean,true) then
   return 'shipping_charge_group_unavailable';end if;
 end if;
 if ((p_group is not null and p_group<>'null'::jsonb) or directive='clear')
  and not coalesce((select enabled from private.goods_transaction_runtime where singleton),false) then
  return 'checkout_contract_upgrade_required';end if;
 return null;
end $$;

create function private.validate_shipping_settings_charge_apply(p_request jsonb) returns void
language plpgsql immutable set search_path='' as $$declare legacy jsonb;row jsonb;target jsonb;begin
 if not private.transaction_json_keys(p_request,array['operationId','command','templateId','expectedRevision','expectedActorId','expectedSessionId',
  'originUpdatedAt','collectRevision','collectVersionId','goods','targetGroup']) then
  raise invalid_parameter_value using message='invalid_shipping_settings_application';end if;
 if jsonb_typeof(p_request->'goods') is distinct from 'array' then
  raise invalid_parameter_value using message='invalid_shipping_settings_targets';end if;
 target:=p_request->'targetGroup';
 if target<>'null'::jsonb and not coalesce(private.transaction_json_keys(target,array['id','revision'])
  and private.shipping_settings_uuid(target->'id') and private.transaction_uint(target->'revision',1,2147483647),false) then
  raise invalid_parameter_value using message='invalid_shipping_settings_charge_group';end if;
 for row in select value from jsonb_array_elements(p_request->'goods') loop
  if not private.transaction_json_keys(row,array['id','updatedAt','ownerGoodId','ownerUpdatedAt','familyGoodIds','transactionRevision','deliveryVersionId',
   'assignmentRevision','assignmentVersionId','groupId','groupRevision'])
   or not private.transaction_uint(row->'assignmentRevision',0,2147483647)
   or not(row->'assignmentVersionId'='null'::jsonb or private.shipping_settings_uuid(row->'assignmentVersionId'))
   or (row->>'assignmentRevision'='0') is distinct from (row->'assignmentVersionId'='null'::jsonb)
   or not(row->'groupId'='null'::jsonb or private.shipping_settings_uuid(row->'groupId'))
   or not(row->'groupRevision'='null'::jsonb or private.transaction_uint(row->'groupRevision',1,2147483647))
   or (row->'groupId'='null'::jsonb) is distinct from (row->'groupRevision'='null'::jsonb)
   or (row->'groupId'<>'null'::jsonb and row->>'assignmentRevision'='0') then
   raise invalid_parameter_value using message='invalid_shipping_settings_targets';end if;
 end loop;
 legacy:=(p_request-'targetGroup')||jsonb_build_object('goods',(select jsonb_agg(value-array['assignmentRevision','assignmentVersionId','groupId','groupRevision'])
  from jsonb_array_elements(p_request->'goods')));
 perform private.validate_shipping_settings_apply(legacy);
end $$;


create function public.admin_save_shipping_settings_template_v3(p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare context jsonb;payload_hash text;receipt jsonb;previous public.shipping_settings_templates;saved public.shipping_settings_templates;settings jsonb;
begin
 context:=private.shipping_settings_operation_context(p_request);
 perform private.require_shipping_settings_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 if not private.transaction_json_keys(p_request,array['operationId','command','templateId','expectedRevision','expectedActorId','expectedSessionId','name','enabled','settings'])
  or context->>'command'<>'save' or jsonb_typeof(p_request->'name') is distinct from 'string' or char_length(p_request->>'name') not between 1 and 80
  or p_request->>'name'<>btrim(p_request->>'name',E' \t\n\r') or p_request->>'name'~'[[:cntrl:]]'
  or jsonb_typeof(p_request->'enabled') is distinct from 'boolean' then raise invalid_parameter_value using message='invalid_shipping_settings_template';end if;
 settings:=p_request->'settings';perform private.validate_shipping_settings_charge(settings);
 settings:=settings||jsonb_build_object('delivery',coalesce(settings->'delivery','{"mode":"preserve"}'::jsonb),'chargeGroup',coalesce(settings->'chargeGroup','{"mode":"preserve"}'::jsonb));
 payload_hash:=encode(extensions.digest(p_request::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('shipping-settings-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_settings_prior(context,payload_hash);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('shipping_settings_template:'||(context->>'templateId'),0));
 select * into previous from public.shipping_settings_templates where id=(context->>'templateId')::uuid for update;
 if (found and previous.revision<>(context->>'expectedRevision')::integer) or (not found and context->>'expectedRevision'<>'0') then
  raise sqlstate 'PT409' using message='shipping_settings_template_changed';end if;
 perform id from public.fulfillment_origins where id=(settings->>'originId')::uuid and (not(p_request->>'enabled')::boolean or is_active) for share;
 if not found then raise check_violation using message='shipping_settings_origin_unavailable';end if;

 if settings#>>'{chargeGroup,mode}'='assign' then
  perform 1 from private.shipping_charge_groups g join private.shipping_charge_group_versions v on v.id=g.version_id
   where g.id=(settings#>>'{chargeGroup,groupId}')::uuid and g.origin_id=(settings->>'originId')::uuid
   and not(v.policy_values->>'archived')::boolean and (not(p_request->>'enabled')::boolean or (v.policy_values->>'enabled')::boolean) for share of g;
  if not found then raise check_violation using message='shipping_charge_group_unavailable';end if;
 end if;
 insert into public.shipping_settings_templates(id,name,enabled,settings,created_by,updated_by)
 values((context->>'templateId')::uuid,p_request->>'name',(p_request->>'enabled')::boolean,settings,(context->>'expectedActorId')::uuid,(context->>'expectedActorId')::uuid)
 on conflict(id) do update set name=excluded.name,enabled=excluded.enabled,settings=excluded.settings,revision=public.shipping_settings_templates.revision+1,
  updated_by=excluded.updated_by,updated_at=clock_timestamp() returning * into saved;
 receipt:=private.shipping_settings_receipt(context,'saved',private.shipping_settings_template_json(saved));
 insert into public.audit_log(id,actor_id,action,target,diff) values((context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,
  'catalog.shipping_settings_template.saved','shipping_settings_templates:'||saved.id,
  jsonb_build_object('before',case when previous.id is null then null else private.shipping_settings_template_json(previous) end,'after',private.shipping_settings_template_json(saved),'context',context));
 perform private.record_shipping_settings_operation(context,payload_hash,receipt);return receipt;
end $$;


create function public.admin_search_goods_for_shipping_settings_v3(p_query text,p_page integer,p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare result jsonb;rows jsonb;begin
 result:=public.admin_search_goods_for_shipping_settings_v2(p_query,p_page,p_expected_actor_id,p_expected_session_id);
 select coalesce(jsonb_agg(item.value||jsonb_build_object('effective',item.value->'effective'||jsonb_build_object('chargeGroup',private.shipping_settings_charge_summary(g))) order by item.ordinality),'[]')
 into rows from jsonb_array_elements(result->'rows') with ordinality item(value,ordinality)
 join public.goods g on g.id=item.value->>'id';
 return jsonb_set(result,'{rows}',rows);
end $$;


create function public.admin_preview_shipping_settings_template_v3(p_template_id uuid,p_good_ids text[],p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare template public.shipping_settings_templates;origin public.fulfillment_origins;good public.goods;owner public.goods;rows jsonb:='[]';
 origin_doc jsonb;target_group jsonb;before_group jsonb;after_group jsonb;directive text;current_delivery jsonb;next_delivery jsonb;blocker text;can_apply boolean:=true;
begin
 perform private.require_shipping_settings_identity(p_expected_actor_id,p_expected_session_id);
 if p_template_id is null or p_good_ids is null or cardinality(p_good_ids) not between 1 and 100 or array_position(p_good_ids,null) is not null
  or exists(select 1 from unnest(p_good_ids) id where not private.shipping_settings_good_id(to_jsonb(id)))
  or (select count(distinct id) from unnest(p_good_ids) id)<>cardinality(p_good_ids) then
  raise invalid_parameter_value using message='invalid_shipping_settings_targets';end if;
 select * into template from public.shipping_settings_templates where id=p_template_id and enabled;
 if not found then raise check_violation using message='shipping_settings_template_unavailable';end if;
 perform private.validate_shipping_settings_charge(template.settings);
 select * into origin from public.fulfillment_origins where id=(template.settings->>'originId')::uuid and is_active;
 if not found then raise check_violation using message='shipping_settings_origin_unavailable';end if;
 origin_doc:=private.shipping_settings_origin(origin);
 directive:=coalesce(template.settings#>>'{chargeGroup,mode}','preserve');
 target_group:=case when directive='assign' then private.shipping_charge_group_summary((template.settings#>>'{chargeGroup,groupId}')::uuid) else null end;
 if directive='assign' and target_group is null then raise check_violation using message='shipping_charge_group_unavailable';end if;
 if (select count(*) from public.goods where id=any(p_good_ids) and archived_at is null)<>cardinality(p_good_ids) then
  raise check_violation using message='shipping_settings_goods_unavailable';end if;
 for good in select * from public.goods where id=any(p_good_ids) order by id loop
  select * into owner from public.goods where id=private.goods_aggregation_owner(good.id);
  current_delivery:=private.shipping_settings_delivery_input(good.id);
  next_delivery:=case when template.settings#>>'{delivery,mode}'='replace' then template.settings#>'{delivery,policy}' else current_delivery end;
  before_group:=private.shipping_settings_charge_summary(good);
  after_group:=case when directive='preserve' then before_group when directive='assign' then target_group else 'null'::jsonb end;
  blocker:=private.shipping_settings_charge_blocker(good,template.settings,current_delivery,origin_doc,after_group);can_apply:=can_apply and blocker is null;
  rows:=rows||jsonb_build_array(private.shipping_settings_charge_good_guard(good)||jsonb_build_object('name',good.name,'code',good.code,
   'editable',owner.id=good.id,'blocker',blocker,'before',private.good_shipping_settings(good),'after',template.settings,
   'effectiveBefore',private.shipping_settings_charge_effective(private.good_shipping_settings(owner),current_delivery,before_group),
   'effectiveAfter',private.shipping_settings_charge_effective(template.settings,next_delivery,after_group)));
 end loop;
 return jsonb_build_object('template',private.shipping_settings_template_json(template),'actorId',p_expected_actor_id,'sessionId',p_expected_session_id,
  'canApply',can_apply,'origin',origin_doc,'goods',rows,'targetGroup',coalesce(target_group,'null'::jsonb));
end $$;

create function public.admin_apply_shipping_settings_template_v3(p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare context jsonb;payload_hash text;receipt jsonb;template public.shipping_settings_templates;origin public.fulfillment_origins;origin_doc jsonb;
 good public.goods;target text;ids text[];row jsonb;actual jsonb;current_delivery jsonb;blocker text;child_operation uuid;transaction_receipt jsonb;
 target_group jsonb;next_group jsonb;directive text;assignment_guard jsonb;previous jsonb;results jsonb:='[]';config private.goods_transaction_configs;
begin
 context:=private.shipping_settings_operation_context(p_request);
 perform private.require_shipping_settings_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 perform private.validate_shipping_settings_charge_apply(p_request);
 p_request:=jsonb_set(p_request,'{goods}',(select jsonb_agg(value order by value->>'id') from jsonb_array_elements(p_request->'goods')));
 payload_hash:=encode(extensions.digest(p_request::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('shipping-settings-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_settings_prior(context,payload_hash);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
 select * into template from public.shipping_settings_templates where id=(context->>'templateId')::uuid for share;
 if not found or not template.enabled then raise check_violation using message='shipping_settings_template_unavailable';end if;
 if template.revision<>(context->>'expectedRevision')::integer then raise sqlstate 'PT409' using message='shipping_settings_template_changed';end if;
 perform private.validate_shipping_settings_charge(template.settings);
 select array_agg(value->>'id' order by value->>'id') into ids from jsonb_array_elements(p_request->'goods');
 -- Claim operation/editor advisory locks before product rows. NOWAIT keeps
 -- cross-workflow contention recoverable instead of reversing lock order.
 foreach target in array ids loop
  if not pg_try_advisory_xact_lock(hashtextextended('admin_good:'||target,0)) then raise sqlstate 'PT409' using message='shipping_settings_retry';end if;
  child_operation:=md5('shipping-settings-delivery:'||(context->>'operationId')||':'||target)::uuid;
  if not pg_try_advisory_xact_lock(hashtextextended('goods-transaction-operation:'||child_operation::text,0)) then
   raise sqlstate 'PT409' using message='shipping_settings_retry';end if;
 end loop;
 perform 1 from public.goods where id=any(ids) order by id for update nowait;
 if (select count(*) from public.goods where id=any(ids) and archived_at is null)<>cardinality(ids) then
  raise check_violation using message='shipping_settings_goods_unavailable';end if;
 if exists(select 1 from unnest(ids) id where private.goods_aggregation_owner(id)<>id) then
  raise check_violation using message='goods_aggregation_policy_owned_by_source';end if;
 perform 1 from private.goods_transaction_configs where good_id=any(ids) order by good_id for update nowait;
 select * into origin from public.fulfillment_origins where id=(template.settings->>'originId')::uuid for share nowait;
 if not found or not origin.is_active then raise check_violation using message='shipping_settings_origin_unavailable';end if;
 perform 1 from private.shipping_collect_contracts where origin_id=origin.id for share nowait;
 origin_doc:=private.shipping_settings_origin(origin);
 if origin.updated_at is distinct from (p_request->>'originUpdatedAt')::timestamptz
  or origin_doc->'collectRevision' is distinct from p_request->'collectRevision' or origin_doc->'collectVersionId' is distinct from p_request->'collectVersionId' then
  raise sqlstate 'PT409' using message='shipping_settings_origin_changed';end if;
 directive:=coalesce(template.settings#>>'{chargeGroup,mode}','preserve');
 perform 1 from private.shipping_charge_groups g where g.id in (
  select a.group_id from private.shipping_charge_group_assignments a where a.owner_good_id=any(ids)
  union select (template.settings#>>'{chargeGroup,groupId}')::uuid where directive='assign'
 ) order by g.id for share nowait;
 perform 1 from private.shipping_charge_group_assignments where owner_good_id=any(ids) order by owner_good_id for update nowait;
 target_group:=case when directive='assign' then private.shipping_charge_group_summary((template.settings#>>'{chargeGroup,groupId}')::uuid) else null end;
 if directive='assign' then
  if target_group is null or p_request->'targetGroup' is distinct from jsonb_build_object('id',target_group->'id','revision',target_group->'revision') then
   raise sqlstate 'PT409' using message='shipping_charge_group_changed';end if;
 elsif p_request->'targetGroup'<>'null'::jsonb then raise invalid_parameter_value using message='invalid_shipping_settings_charge_group';end if;
 for good in select * from public.goods where id=any(ids) order by id loop
  select value into row from jsonb_array_elements(p_request->'goods') where value->>'id'=good.id;
  actual:=private.shipping_settings_charge_good_guard(good);
  if actual->>'ownerGoodId' is distinct from row->>'ownerGoodId' or actual->'familyGoodIds' is distinct from row->'familyGoodIds'
   or (actual->>'updatedAt')::timestamptz is distinct from (row->>'updatedAt')::timestamptz
   or (actual->>'ownerUpdatedAt')::timestamptz is distinct from (row->>'ownerUpdatedAt')::timestamptz
   or actual->'transactionRevision' is distinct from row->'transactionRevision' or actual->'deliveryVersionId' is distinct from row->'deliveryVersionId'
   or (actual-array['id','updatedAt','ownerGoodId','ownerUpdatedAt','familyGoodIds','transactionRevision','deliveryVersionId'])
    is distinct from (row-array['id','updatedAt','ownerGoodId','ownerUpdatedAt','familyGoodIds','transactionRevision','deliveryVersionId']) then
   raise sqlstate 'PT409' using message='shipping_settings_goods_changed';end if;
 end loop;
 -- Hold the activation state while creating active delivery versions.
 perform 1 from private.goods_transaction_runtime where singleton for share nowait;
 for good in select * from public.goods where id=any(ids) order by id loop
  current_delivery:=private.shipping_settings_delivery_input(good.id);
  next_group:=case when directive='preserve' then private.shipping_settings_charge_summary(good) when directive='assign' then target_group else 'null'::jsonb end;
  blocker:=private.shipping_settings_charge_blocker(good,template.settings,current_delivery,origin_doc,next_group);
  if blocker is not null then raise check_violation using message=blocker;end if;
 end loop;
 for good in select * from public.goods where id=any(ids) order by id loop
  previous:=jsonb_build_object('settings',private.good_shipping_settings(good),'effective',private.shipping_settings_charge_effective(private.good_shipping_settings(good),private.shipping_settings_delivery_input(good.id),private.shipping_settings_charge_summary(good)));
  perform public.admin_save_good_claim_policy(good.id,template.settings->'claimPolicy',good.updated_at);
  -- Bind the final origin before the existing delivery writer validates the
  -- collector. Nothing can commit if any later product fails.
  update public.goods set origin_id=origin.id,shipping_fee_type=template.settings->>'feeType',individual_fee=(template.settings->>'individualFee')::bigint
   where id=good.id returning * into good;
  if template.settings#>>'{delivery,mode}'='replace' then
   select * into config from private.goods_transaction_configs where good_id=good.id;
   child_operation:=md5('shipping-settings-delivery:'||(context->>'operationId')||':'||good.id)::uuid;
   transaction_receipt:=public.admin_save_good_transaction_terms(good.id,coalesce(config.revision,0),good.updated_at,null,template.settings#>'{delivery,policy}',
    child_operation,(context->>'expectedActorId')::uuid);
  end if;
  select value into row from jsonb_array_elements(p_request->'goods') where value->>'id'=good.id;
  select * into good from public.goods where id=good.id;
  if directive<>'preserve' and (row->>'groupId')::uuid is distinct from (case when directive='assign' then (target_group->>'id')::uuid else null end) then
   assignment_guard:=private.apply_shipping_charge_group_assignment_locked(good.id,
    case when directive='assign' then (target_group->>'id')::uuid else null end,
    case when directive='assign' then (target_group->>'revision')::integer else 0 end,
    (row->>'assignmentRevision')::integer,(row->>'assignmentVersionId')::uuid,
    array(select jsonb_array_elements_text(row->'familyGoodIds')),good.updated_at,origin.updated_at,
    (context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
  else perform private.assert_shipping_charge_group_owner_assignment(good.id);end if;
  update public.goods set shipping_settings_template_id=template.id,shipping_settings_template_revision=template.revision,
   shipping_settings_snapshot=jsonb_build_object('templateId',template.id,'templateRevision',template.revision,'name',template.name,'settings',template.settings,
    'appliedDelivery',case when template.settings#>>'{delivery,mode}'='replace' then private.shipping_settings_delivery_input(good.id) else null end,
    'appliedChargeGroup',case when directive='preserve' then null else jsonb_build_object('groupId',case when directive='assign' then target_group->'id' else 'null'::jsonb end) end,
    'appliedAt',clock_timestamp(),'originUpdatedAt',origin.updated_at,'collectRevision',origin_doc->'collectRevision','collectVersionId',origin_doc->'collectVersionId')
  where id=good.id returning * into good;
  actual:=private.shipping_settings_charge_good_guard(good);
  insert into public.audit_log(actor_id,action,target,diff) values((context->>'expectedActorId')::uuid,'catalog.good.shipping_settings_applied','goods:'||good.id,
   jsonb_build_object('requestId',context->'operationId','templateId',template.id,'templateRevision',template.revision,'before',previous,
    'after',jsonb_build_object('settings',private.good_shipping_settings(good),'effective',private.shipping_settings_charge_effective(private.good_shipping_settings(good),private.shipping_settings_delivery_input(good.id),private.shipping_settings_charge_summary(good))),
    'originUpdatedAt',origin.updated_at,'collectRevision',origin_doc->'collectRevision','collectVersionId',origin_doc->'collectVersionId'));
  results:=results||jsonb_build_array(jsonb_build_object('id',good.id,'updatedAt',good.updated_at,'transactionRevision',actual->'transactionRevision','deliveryVersionId',actual->'deliveryVersionId','assignmentRevision',actual->'assignmentRevision','assignmentVersionId',actual->'assignmentVersionId','groupId',actual->'groupId','groupRevision',actual->'groupRevision'));
 end loop;
 receipt:=private.shipping_settings_receipt(context,'applied',private.shipping_settings_template_json(template),results)||jsonb_build_object('chargeGroupVersion',1);
 perform private.record_shipping_settings_operation(context,payload_hash,receipt);return receipt;
exception when lock_not_available then raise sqlstate 'PT409' using message='shipping_settings_retry';
end $$;


-- Old application calls cannot silently edit members without a group CAS.
-- Original successful operation recovery remains ahead of these new guards.
do $$declare definition text;needle text;fn regprocedure;begin
 fn:='public.admin_apply_shipping_settings_template_v2(jsonb)'::regprocedure;
 definition:=pg_get_functiondef(fn);
 needle:='perform 1 from private.goods_transaction_configs where good_id=any(ids) order by good_id for update nowait;';
 if strpos(definition,needle)=0 then raise check_violation using message='shipping_settings_v2_apply_shape_changed';end if;
 definition:=replace(definition,needle,needle||E'\n if exists(select 1 from private.shipping_charge_group_assignments where owner_good_id=any(ids) and group_id is not null) then raise check_violation using message=''shipping_settings_preview_upgrade_required'';end if;');
 execute definition;
 fn:='public.admin_apply_shipping_settings_template(uuid,uuid,integer,timestamptz,jsonb)'::regprocedure;
 definition:=pg_get_functiondef(fn);needle:='perform g.id from public.goods g where g.id=any(ids) order by g.id for update;';
 if strpos(definition,needle)=0 then raise check_violation using message='shipping_settings_v1_apply_shape_changed';end if;
 definition:=replace(definition,needle,needle||E'\n if exists(select 1 from private.shipping_charge_group_assignments where owner_good_id in(select private.goods_aggregation_owner(id) from unnest(ids) id) and group_id is not null) then raise check_violation using message=''shipping_settings_preview_upgrade_required'';end if;');
 execute definition;
end $$;

create or replace function private.detach_changed_shipping_settings() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.shipping_settings_template_id is not null and (
  ((new.shipping_settings_snapshot->'settings')-array['delivery','chargeGroup']) is distinct from private.good_shipping_settings(new)
  or (new.shipping_settings_snapshot#>>'{settings,delivery,mode}'='replace'
   and new.shipping_settings_snapshot->'appliedDelivery' is distinct from private.shipping_settings_delivery_input(old.id))) then
  new.shipping_settings_template_id:=null;new.shipping_settings_template_revision:=null;new.shipping_settings_snapshot:=null;
 end if;
 if new.shipping_settings_snapshot is distinct from old.shipping_settings_snapshot or private.good_shipping_settings(new) is distinct from private.good_shipping_settings(old) then
  new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');end if;
 return new;
end $$;

do $$declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any(array[
  'validate_shipping_settings_charge','shipping_settings_charge_good_guard','shipping_settings_charge_summary','shipping_settings_charge_effective',
  'shipping_settings_charge_blocker','validate_shipping_settings_charge_apply']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to postgres',fn);perform private.register_operator_internal_contract(fn);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
  'admin_save_shipping_settings_template_v3','admin_search_goods_for_shipping_settings_v3','admin_preview_shipping_settings_template_v3','admin_apply_shipping_settings_template_v3']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to authenticated',fn);perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
select private.register_operator_internal_contract('private.detach_changed_shipping_settings()'::regprocedure);
select private.register_operator_internal_contract('public.admin_apply_shipping_settings_template_v2(jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.admin_apply_shipping_settings_template(uuid,uuid,integer,timestamptz,jsonb)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_apply_shipping_settings_template_v2(jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_apply_shipping_settings_template(uuid,uuid,integer,timestamptz,jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_save_shipping_settings_template_v3(jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_search_goods_for_shipping_settings_v3(text,integer,uuid,uuid)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_preview_shipping_settings_template_v3(uuid,text[],uuid,uuid)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_apply_shipping_settings_template_v3(jsonb)'::regprocedure,'catalog.manage','write',false);
notify pgrst,'reload schema';
