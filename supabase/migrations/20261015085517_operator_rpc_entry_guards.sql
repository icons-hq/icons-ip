-- Enforce authentication and capability rejection before input or row lookup.
-- Thirteen existing public RPCs; no schema/table/ACL changes.

-- DRAFT: reject unauthorized legacy reshipment reads before claim lookup.
-- A lock-free precheck prevents existence disclosure without changing the
-- established gift-subject -> operator -> order/claim lock order. The locked
-- capability check remains mandatory for concurrent authority changes.
do $guard$
declare target record; actual text;
begin
 for target in select * from (values
  ('public.admin_record_order_claim_reshipment(uuid,text,text,jsonb)','b34dfe6358a0af0f1d650b2509dc4bb7'),
  ('public.admin_record_order_claim_reshipment(uuid,text,text)','c99968f515e8f28a5f4e09efe3faddc2')
 ) expected(signature,body_md5) loop
  select md5(p.prosrc) into actual from pg_proc p where p.oid=to_regprocedure(target.signature);
  if actual is distinct from target.body_md5 then
   raise exception using errcode='55000',message='legacy_reshipment_guard_source_changed';
  end if;
 end loop;
end $guard$;

CREATE OR REPLACE FUNCTION public.admin_record_order_claim_reshipment(p_claim_id uuid, p_carrier text, p_tracking_number text, p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.order_cancellation_requests;parties uuid[];begin
 -- Read-only rejection must precede any claim lookup or subject lock.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('sales.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 select * into c from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 parties:=private.contact_parties(c.order_id);perform private.gift_lock_subjects(array_append(parties,auth.uid()));
 perform private.require_operator_capability('sales.manage',false);
 c:=private.contact_lock_scope(c.order_id,p_claim_id,parties);
 if c.stage<>'completed' then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 return private.record_order_claim_reshipment_physical(p_claim_id,p_carrier,p_tracking_number,p_items);
end $function$;

CREATE OR REPLACE FUNCTION public.admin_record_order_claim_reshipment(p_claim_id uuid, p_carrier text, p_tracking_number text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.order_cancellation_requests;parties uuid[];begin
 -- Read-only rejection must precede any claim lookup or subject lock.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('sales.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 select * into c from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 parties:=private.contact_parties(c.order_id);perform private.gift_lock_subjects(array_append(parties,auth.uid()));
 perform private.require_operator_capability('sales.manage',false);
 c:=private.contact_lock_scope(c.order_id,p_claim_id,parties);
 if c.stage<>'completed' then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 return private.record_order_claim_reshipment_physical(p_claim_id,p_carrier,p_tracking_number,'[]'::jsonb);
end $function$;

select private.register_operator_rpc_contract('public.admin_record_order_claim_reshipment(uuid,text,text,jsonb)'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_record_order_claim_reshipment(uuid,text,text)'::regprocedure,'sales.manage','read',false);

-- DRAFT ONLY: six public shipping-setting entries, prepared from CANON350.
-- Run inside the caller's explicit transaction, only in the approved clone.
-- Preserve the immutable parser, locked identity/session validation, all domain
-- locks, CAS/retry/replay order, function ownership and ACLs byte-for-byte.
do $guard$
declare target record;actual text;
begin
 for target in select * from(values
  ('public.admin_apply_shipping_settings_template_v2(jsonb)','27346b215a789836135fdd9ebee22b7c'),
  ('public.admin_apply_shipping_settings_template_v3(jsonb)','cbf14aa787b3f9f6cde9446f8670638b'),
  ('public.admin_save_shipping_settings_template_v2(jsonb)','b235536cba1cbfc133de4865c39a8351'),
  ('public.admin_save_shipping_settings_template_v3(jsonb)','5f0a402d1f0a5697e4e451ed5ec2f446'),
  ('public.admin_read_shipping_settings_operation(jsonb)','6c0f1000c28980d5358ccc453dc3358b'),
  ('public.admin_seal_shipping_settings_operation(jsonb)','03d5fc67e1f928c1e8b3acc188243d2b')
 ) expected(signature,body_md5) loop
  select md5(p.prosrc) into actual from pg_proc p where p.oid=to_regprocedure(target.signature);
  if actual is distinct from target.body_md5 then
   raise exception using errcode='55000',message='shipping_entry_guard_source_changed';
  end if;
 end loop;
end $guard$;

CREATE OR REPLACE FUNCTION public.admin_apply_shipping_settings_template_v2(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare context jsonb;payload_hash text;receipt jsonb;template public.shipping_settings_templates;origin public.fulfillment_origins;origin_doc jsonb;
 good public.goods;target text;ids text[];row jsonb;actual jsonb;current_delivery jsonb;blocker text;child_operation uuid;transaction_receipt jsonb;
 previous jsonb;results jsonb:='[]';config private.goods_transaction_configs;
begin
 -- Reject missing authority before parsing caller-controlled operation JSON.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 context:=private.shipping_settings_operation_context(p_request);
 perform private.require_shipping_settings_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 perform private.validate_shipping_settings_apply(p_request);
 p_request:=jsonb_set(p_request,'{goods}',(select jsonb_agg(value order by value->>'id') from jsonb_array_elements(p_request->'goods')));
 payload_hash:=encode(extensions.digest(p_request::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('shipping-settings-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_settings_prior(context,payload_hash);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
 select * into template from public.shipping_settings_templates where id=(context->>'templateId')::uuid for share;
 if not found or not template.enabled then raise check_violation using message='shipping_settings_template_unavailable';end if;
 if template.revision<>(context->>'expectedRevision')::integer then raise sqlstate 'PT409' using message='shipping_settings_template_changed';end if;
 perform private.validate_shipping_settings_extended(template.settings);
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
 if exists(select 1 from private.shipping_charge_group_assignments where owner_good_id=any(ids) and group_id is not null) then raise check_violation using message='shipping_settings_preview_upgrade_required';end if;
 for good in select * from public.goods where id=any(ids) order by id loop
  select value into row from jsonb_array_elements(p_request->'goods') where value->>'id'=good.id;
  actual:=private.shipping_settings_good_guard(good);
  if actual->>'ownerGoodId' is distinct from row->>'ownerGoodId' or actual->'familyGoodIds' is distinct from row->'familyGoodIds'
   or (actual->>'updatedAt')::timestamptz is distinct from (row->>'updatedAt')::timestamptz
   or (actual->>'ownerUpdatedAt')::timestamptz is distinct from (row->>'ownerUpdatedAt')::timestamptz
   or actual->'transactionRevision' is distinct from row->'transactionRevision' or actual->'deliveryVersionId' is distinct from row->'deliveryVersionId' then
   raise sqlstate 'PT409' using message='shipping_settings_goods_changed';end if;
 end loop;
 select * into origin from public.fulfillment_origins where id=(template.settings->>'originId')::uuid for share nowait;
 if not found or not origin.is_active then raise check_violation using message='shipping_settings_origin_unavailable';end if;
 perform 1 from private.shipping_collect_contracts where origin_id=origin.id for share nowait;
 origin_doc:=private.shipping_settings_origin(origin);
 if origin.updated_at is distinct from (p_request->>'originUpdatedAt')::timestamptz
  or origin_doc->'collectRevision' is distinct from p_request->'collectRevision' or origin_doc->'collectVersionId' is distinct from p_request->'collectVersionId' then
  raise sqlstate 'PT409' using message='shipping_settings_origin_changed';end if;
 -- Hold the activation state while creating active delivery versions.
 perform 1 from private.goods_transaction_runtime where singleton for share nowait;
 for good in select * from public.goods where id=any(ids) order by id loop
  current_delivery:=private.shipping_settings_delivery_input(good.id);
  blocker:=private.shipping_settings_delivery_blocker(good.id,template.settings,current_delivery,origin_doc);
  if blocker is not null then raise check_violation using message=blocker;end if;
 end loop;
 for good in select * from public.goods where id=any(ids) order by id loop
  previous:=jsonb_build_object('settings',private.good_shipping_settings(good),'effective',private.shipping_settings_effective(private.good_shipping_settings(good),private.shipping_settings_delivery_input(good.id)));
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
  update public.goods set shipping_settings_template_id=template.id,shipping_settings_template_revision=template.revision,
   shipping_settings_snapshot=jsonb_build_object('templateId',template.id,'templateRevision',template.revision,'name',template.name,'settings',template.settings,
    'appliedDelivery',case when template.settings#>>'{delivery,mode}'='replace' then private.shipping_settings_delivery_input(good.id) else null end,
    'appliedAt',clock_timestamp(),'originUpdatedAt',origin.updated_at,'collectRevision',origin_doc->'collectRevision','collectVersionId',origin_doc->'collectVersionId')
  where id=good.id returning * into good;
  actual:=private.shipping_settings_good_guard(good);
  insert into public.audit_log(actor_id,action,target,diff) values((context->>'expectedActorId')::uuid,'catalog.good.shipping_settings_applied','goods:'||good.id,
   jsonb_build_object('requestId',context->'operationId','templateId',template.id,'templateRevision',template.revision,'before',previous,
    'after',jsonb_build_object('settings',private.good_shipping_settings(good),'effective',private.shipping_settings_effective(private.good_shipping_settings(good),private.shipping_settings_delivery_input(good.id))),
    'originUpdatedAt',origin.updated_at,'collectRevision',origin_doc->'collectRevision','collectVersionId',origin_doc->'collectVersionId'));
  results:=results||jsonb_build_array(jsonb_build_object('id',good.id,'updatedAt',good.updated_at,'transactionRevision',actual->'transactionRevision','deliveryVersionId',actual->'deliveryVersionId'));
 end loop;
 receipt:=private.shipping_settings_receipt(context,'applied',private.shipping_settings_template_json(template),results);
 perform private.record_shipping_settings_operation(context,payload_hash,receipt);return receipt;
exception when lock_not_available then raise sqlstate 'PT409' using message='shipping_settings_retry';
end $function$;

CREATE OR REPLACE FUNCTION public.admin_apply_shipping_settings_template_v3(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare context jsonb;payload_hash text;receipt jsonb;template public.shipping_settings_templates;origin public.fulfillment_origins;origin_doc jsonb;
 good public.goods;target text;ids text[];row jsonb;actual jsonb;current_delivery jsonb;blocker text;child_operation uuid;transaction_receipt jsonb;
 target_group jsonb;next_group jsonb;directive text;assignment_guard jsonb;previous jsonb;results jsonb:='[]';config private.goods_transaction_configs;
begin
 -- Reject missing authority before parsing caller-controlled operation JSON.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.admin_save_shipping_settings_template_v2(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare context jsonb;payload_hash text;receipt jsonb;previous public.shipping_settings_templates;saved public.shipping_settings_templates;settings jsonb;
begin
 -- Reject missing authority before parsing caller-controlled operation JSON.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 context:=private.shipping_settings_operation_context(p_request);
 perform private.require_shipping_settings_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 if not private.transaction_json_keys(p_request,array['operationId','command','templateId','expectedRevision','expectedActorId','expectedSessionId','name','enabled','settings'])
  or context->>'command'<>'save' or jsonb_typeof(p_request->'name') is distinct from 'string' or char_length(p_request->>'name') not between 1 and 80
  or p_request->>'name'<>btrim(p_request->>'name',E' \t\n\r') or p_request->>'name'~'[[:cntrl:]]'
  or jsonb_typeof(p_request->'enabled') is distinct from 'boolean' then raise invalid_parameter_value using message='invalid_shipping_settings_template';end if;
 settings:=p_request->'settings';perform private.validate_shipping_settings_extended(settings);
 settings:=settings||jsonb_build_object('delivery',coalesce(settings->'delivery','{"mode":"preserve"}'::jsonb));
 payload_hash:=encode(extensions.digest(p_request::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('shipping-settings-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_settings_prior(context,payload_hash);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('shipping_settings_template:'||(context->>'templateId'),0));
 select * into previous from public.shipping_settings_templates where id=(context->>'templateId')::uuid for update;
 if (found and previous.revision<>(context->>'expectedRevision')::integer) or (not found and context->>'expectedRevision'<>'0') then
  raise sqlstate 'PT409' using message='shipping_settings_template_changed';end if;
 perform id from public.fulfillment_origins where id=(settings->>'originId')::uuid and (not(p_request->>'enabled')::boolean or is_active) for share;
 if not found then raise check_violation using message='shipping_settings_origin_unavailable';end if;
 insert into public.shipping_settings_templates(id,name,enabled,settings,created_by,updated_by)
 values((context->>'templateId')::uuid,p_request->>'name',(p_request->>'enabled')::boolean,settings,(context->>'expectedActorId')::uuid,(context->>'expectedActorId')::uuid)
 on conflict(id) do update set name=excluded.name,enabled=excluded.enabled,settings=excluded.settings,revision=public.shipping_settings_templates.revision+1,
  updated_by=excluded.updated_by,updated_at=clock_timestamp() returning * into saved;
 receipt:=private.shipping_settings_receipt(context,'saved',private.shipping_settings_template_json(saved));
 insert into public.audit_log(id,actor_id,action,target,diff) values((context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,
  'catalog.shipping_settings_template.saved','shipping_settings_templates:'||saved.id,
  jsonb_build_object('before',case when previous.id is null then null else private.shipping_settings_template_json(previous) end,'after',private.shipping_settings_template_json(saved),'context',context));
 perform private.record_shipping_settings_operation(context,payload_hash,receipt);return receipt;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_save_shipping_settings_template_v3(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare context jsonb;payload_hash text;receipt jsonb;previous public.shipping_settings_templates;saved public.shipping_settings_templates;settings jsonb;
begin
 -- Reject missing authority before parsing caller-controlled operation JSON.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.admin_read_shipping_settings_operation(p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare context jsonb;begin
 -- Reject missing authority before parsing caller-controlled operation JSON.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 context:=private.shipping_settings_operation_context(p_context);
 if context is distinct from p_context then raise invalid_parameter_value using message='invalid_shipping_settings_operation';end if;
 perform private.require_shipping_settings_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 return private.shipping_settings_prior(context);
end $function$;

CREATE OR REPLACE FUNCTION public.admin_seal_shipping_settings_operation(p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare context jsonb;receipt jsonb;begin
 -- Reject missing authority before parsing caller-controlled operation JSON.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 context:=private.shipping_settings_operation_context(p_context);
 if context is distinct from p_context then raise invalid_parameter_value using message='invalid_shipping_settings_operation';end if;
 perform private.require_shipping_settings_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 perform pg_advisory_xact_lock(hashtextextended('shipping-settings-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_settings_prior(context);if receipt is not null then return receipt;end if;
 receipt:=private.shipping_settings_receipt(context,'sealed');perform private.record_shipping_settings_operation(context,null,receipt);
 insert into public.audit_log(id,actor_id,action,target,diff) values((context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,
  'catalog.shipping_settings.operation_sealed','shipping_settings_templates:'||(context->>'templateId'),jsonb_build_object('context',context));
 return receipt;
end $function$;

-- The current register_operator_rpc_contract also refreshes the internal
-- metadata hash (20261013053055_operator_rpc_metadata_coverage.sql).
select private.register_operator_rpc_contract('public.admin_apply_shipping_settings_template_v2(jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_apply_shipping_settings_template_v3(jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_save_shipping_settings_template_v2(jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_save_shipping_settings_template_v3(jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_read_shipping_settings_operation(jsonb)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_seal_shipping_settings_operation(jsonb)'::regprocedure,'catalog.manage','write',false);

-- DRAFT ONLY: four public shipping-charge-group entries from CANON350.
-- Run inside the caller's explicit transaction, only in the approved clone.
-- Preserve the immutable context parser, locked identity/session validation,
-- all domain locks, CAS/retry/replay order, function ownership and ACLs.
do $guard$
declare target record;actual text;
begin
 for target in select * from(values
  ('public.admin_assign_shipping_charge_group(jsonb)','7be531a73d400b121ad1682d01be5878'),
  ('public.admin_read_shipping_charge_group_operation(jsonb)','b3428639815b71bd7bf2315dac25c27d'),
  ('public.admin_save_shipping_charge_group(jsonb)','2881301ee7d0a778b26d24abac0cc107'),
  ('public.admin_seal_shipping_charge_group_operation(jsonb)','3e60dc9ef1882dae9c99761639b6d610')
 ) expected(signature,body_md5) loop
  select md5(p.prosrc) into actual from pg_proc p where p.oid=to_regprocedure(target.signature);
  if actual is distinct from target.body_md5 then
   raise exception using errcode='55000',message='charge_group_entry_guard_source_changed';
  end if;
 end loop;
end $guard$;

CREATE OR REPLACE FUNCTION public.admin_assign_shipping_charge_group(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare context jsonb;request_hash text;receipt jsonb;ids text[];target text;good public.goods;origin public.fulfillment_origins;
 row jsonb;actual jsonb;expected_origin jsonb;results jsonb:='[]';group_row private.shipping_charge_groups;
begin
 -- Reject missing authority before parsing caller-controlled operation JSON.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 context:=private.shipping_charge_group_context(p_request);
 perform private.require_shipping_charge_group_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 perform private.validate_shipping_charge_group_assignment(p_request);
 p_request:=jsonb_set(jsonb_set(p_request,'{goods}',(select jsonb_agg(value order by value->>'id') from jsonb_array_elements(p_request->'goods'))),
  '{origins}',(select coalesce(jsonb_agg(value order by value->>'id'),'[]') from jsonb_array_elements(p_request->'origins')));
 request_hash:=encode(extensions.digest(p_request::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('shipping-charge-group-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_charge_group_prior(context,request_hash);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
 select array_agg(value->>'id' order by value->>'id') into ids from jsonb_array_elements(p_request->'goods');
 foreach target in array ids loop
  if not pg_try_advisory_xact_lock(hashtextextended('admin_good:'||target,0)) then raise sqlstate 'PT409' using message='shipping_charge_group_retry';end if;
 end loop;
 perform 1 from public.goods where id=any(ids) order by id for update nowait;
 if (select count(*) from public.goods where id=any(ids) and archived_at is null)<>cardinality(ids) then
  raise no_data_found using message='shipping_charge_group_goods_unavailable';end if;
 perform 1 from private.goods_transaction_configs where good_id=any(ids) order by good_id for share nowait;
 perform 1 from public.fulfillment_origins where id in(select (value->>'id')::uuid from jsonb_array_elements(p_request->'origins')) order by id for share nowait;
 for expected_origin in select value from jsonb_array_elements(p_request->'origins') loop
  if private.shipping_charge_group_origin((expected_origin->>'id')::uuid) is distinct from expected_origin then
   raise sqlstate 'PT409' using message='shipping_charge_group_origin_changed';end if;
 end loop;
 select * into group_row from private.shipping_charge_groups where id=(context->>'groupId')::uuid for share nowait;
 if context->>'groupId' is not null and (not found or group_row.revision<>(context->>'expectedRevision')::integer) then
  raise sqlstate 'PT409' using message='shipping_charge_group_changed';end if;
 perform 1 from private.shipping_charge_group_assignments where owner_good_id=any(ids) order by owner_good_id for update nowait;
 for good in select * from public.goods where id=any(ids) order by id loop
  select value into row from jsonb_array_elements(p_request->'goods') where value->>'id'=good.id;
  actual:=private.shipping_charge_group_good_guard(good);
  -- Compare timestamps as instants; preserve their microseconds in the DTO.
  if (actual-array['updatedAt','ownerUpdatedAt']) is distinct from (row-array['updatedAt','ownerUpdatedAt'])
   or (actual->>'updatedAt')::timestamptz is distinct from (row->>'updatedAt')::timestamptz
   or (actual->>'ownerUpdatedAt')::timestamptz is distinct from (row->>'ownerUpdatedAt')::timestamptz then
   raise sqlstate 'PT409' using message='shipping_charge_group_goods_changed';end if;
 end loop;
 for good in select * from public.goods where id=any(ids) order by id loop
  select value into row from jsonb_array_elements(p_request->'goods') where value->>'id'=good.id;
  select * into origin from public.fulfillment_origins where id=good.origin_id;
  actual:=private.apply_shipping_charge_group_assignment_locked(good.id,(context->>'groupId')::uuid,(context->>'expectedRevision')::integer,
   (row->>'assignmentRevision')::integer,(row->>'assignmentVersionId')::uuid,
   array(select jsonb_array_elements_text(row->'familyGoodIds')),good.updated_at,origin.updated_at,
   (context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
  results:=results||jsonb_build_array(actual);
 end loop;
 receipt:=private.shipping_charge_group_receipt(context,'assigned',private.shipping_charge_group_document((context->>'groupId')::uuid),null,results);
 insert into public.audit_log(id,actor_id,action,target,diff) values((context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,
  'catalog.shipping_charge_group.assigned','shipping_charge_groups:'||coalesce(context->>'groupId','clear'),
  jsonb_build_object('context',context,'before',p_request->'goods','after',results));
 perform private.record_shipping_charge_group_operation(context,request_hash,receipt);return receipt;
exception when lock_not_available then raise sqlstate 'PT409' using message='shipping_charge_group_retry';
end $function$;

CREATE OR REPLACE FUNCTION public.admin_read_shipping_charge_group_operation(p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare context jsonb;begin
 -- Reject missing authority before parsing caller-controlled operation JSON.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 context:=private.shipping_charge_group_context(p_context);
 if context is distinct from p_context then raise invalid_parameter_value using message='invalid_shipping_charge_group_operation';end if;
 perform private.require_shipping_charge_group_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 return private.shipping_charge_group_prior(context);
end $function$;

CREATE OR REPLACE FUNCTION public.admin_save_shipping_charge_group(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare context jsonb;request_hash text;receipt jsonb;origin public.fulfillment_origins;previous private.shipping_charge_groups;
 previous_version private.shipping_charge_group_versions;default_group private.shipping_charge_groups;default_version private.shipping_charge_group_versions;
 policy_values jsonb;region_changed boolean;requires_confirmation boolean;confirmed_by uuid;confirmed_at timestamptz;default_result jsonb;before_document jsonb;
begin
 -- Reject missing authority before parsing caller-controlled operation JSON.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 context:=private.shipping_charge_group_context(p_request);
 perform private.require_shipping_charge_group_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 if not private.transaction_json_keys(p_request,array['operationId','command','groupId','expectedRevision','expectedActorId','expectedSessionId',
  'originId','originUpdatedAt','expectedDefaultGroupId','expectedDefaultGroupRevision','values','attestRegional']) or context->>'command'<>'save'
  or not private.shipping_settings_uuid(p_request->'originId') or not private.transaction_instant_valid(p_request->'originUpdatedAt')
  or not (p_request->'expectedDefaultGroupId'='null'::jsonb or private.shipping_settings_uuid(p_request->'expectedDefaultGroupId'))
  or not private.transaction_uint(p_request->'expectedDefaultGroupRevision',0,2147483646)
  or ((p_request->'expectedDefaultGroupId'='null'::jsonb) is distinct from (p_request->>'expectedDefaultGroupRevision'='0'))
  or jsonb_typeof(p_request->'attestRegional') is distinct from 'boolean' then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_save';end if;
 request_hash:=encode(extensions.digest(p_request::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('shipping-charge-group-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_charge_group_prior(context,request_hash);if receipt is not null then return receipt;end if;
 -- Origin serializes first-default creation and all default changes. No member
 -- product locks are acquired here; checkout acquires origin before group rows.
 select * into origin from public.fulfillment_origins where id=(p_request->>'originId')::uuid for update nowait;
 if not found then raise check_violation using message='shipping_charge_group_origin_unavailable';end if;
 if origin.updated_at is distinct from (p_request->>'originUpdatedAt')::timestamptz then raise sqlstate 'PT409' using message='shipping_charge_group_origin_changed';end if;
 perform 1 from private.shipping_charge_groups where origin_id=origin.id or id=(context->>'groupId')::uuid order by id for update nowait;
 select * into previous from private.shipping_charge_groups where id=(context->>'groupId')::uuid;
 if (found and previous.revision<>(context->>'expectedRevision')::integer) or (not found and context->>'expectedRevision'<>'0') then
  raise sqlstate 'PT409' using message='shipping_charge_group_changed';end if;
 if previous.id is not null and previous.origin_id<>origin.id then raise check_violation using message='shipping_charge_group_origin_immutable';end if;
 select * into default_group from private.shipping_charge_groups where origin_id=origin.id and is_default;
 if default_group.id is distinct from (p_request->>'expectedDefaultGroupId')::uuid
  or coalesce(default_group.revision,0)<>(p_request->>'expectedDefaultGroupRevision')::integer then
  raise sqlstate 'PT409' using message='shipping_charge_group_default_changed';end if;
 select * into previous_version from private.shipping_charge_group_versions where id=previous.version_id;
 policy_values:=private.normalize_shipping_charge_group_values(origin.id,p_request->'values');
 if (policy_values->>'enabled')::boolean and not origin.is_active then raise check_violation using message='shipping_charge_group_origin_unavailable';end if;
 if (not(policy_values->>'enabled')::boolean or (policy_values->>'archived')::boolean)
  and exists(select 1 from private.shipping_charge_group_assignments where group_id=previous.id) then
  raise check_violation using message='shipping_charge_group_has_assignments';end if;
 region_changed:=case when previous.id is null then policy_values#>>'{regional,mode}'='override'
  else previous_version.policy_values->'regional' is distinct from policy_values->'regional' end;
 requires_confirmation:=region_changed or (policy_values#>>'{regional,mode}'='override' and (policy_values->>'enabled')::boolean
  and not coalesce((previous_version.policy_values->>'enabled')::boolean,false));
 if requires_confirmation then
  perform private.require_operator_capability('platform.manage',true);
  if not(p_request->>'attestRegional')::boolean then raise check_violation using message='shipping_charge_group_region_confirmation_required';end if;
 end if;
 confirmed_by:=previous_version.regional_confirmed_by;confirmed_at:=previous_version.regional_confirmed_at;
 if policy_values#>>'{regional,mode}'='inherit' then confirmed_by:=null;confirmed_at:=null;
 elsif requires_confirmation then confirmed_by:=(context->>'expectedActorId')::uuid;confirmed_at:=clock_timestamp();end if;
 if policy_values#>>'{regional,mode}'='override' and (policy_values->>'enabled')::boolean then
  perform 1 from public.shipping_carriers where code=policy_values#>>'{regional,policy,carrierCode}' for share nowait;
  if confirmed_by is null or not exists(select 1 from public.shipping_carriers where code=policy_values#>>'{regional,policy,carrierCode}' and is_active)
   or policy_values#>>'{regional,policy,carrierCode}' is distinct from origin.default_carrier then
   raise check_violation using message='shipping_charge_group_region_unavailable';end if;
 end if;
 if (policy_values->>'enabled')::boolean then
  perform 1 from private.goods_transaction_runtime where singleton and enabled for share nowait;
  if not found then raise check_violation using message='checkout_contract_upgrade_required';end if;
 end if;
 before_document:=private.shipping_charge_group_document(previous.id);
 if (policy_values->>'isDefault')::boolean and default_group.id is not null and default_group.id<>(context->>'groupId')::uuid then
  select * into default_version from private.shipping_charge_group_versions where id=default_group.version_id;
  perform private.write_shipping_charge_group_version(default_group.id,origin.id,jsonb_set(default_version.policy_values,'{isDefault}','false'),
   (context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid,(context->>'operationId')::uuid,
   default_version.regional_confirmed_by,default_version.regional_confirmed_at);
  default_result:=private.shipping_charge_group_document(default_group.id);
 end if;
 if previous.id is null or previous_version.policy_values is distinct from policy_values then
  perform private.write_shipping_charge_group_version((context->>'groupId')::uuid,origin.id,policy_values,
   (context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid,(context->>'operationId')::uuid,confirmed_by,confirmed_at);
 end if;
 receipt:=private.shipping_charge_group_receipt(context,'saved',private.shipping_charge_group_document((context->>'groupId')::uuid),default_result);
 insert into public.audit_log(id,actor_id,action,target,diff) values((context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,
  'catalog.shipping_charge_group.saved','shipping_charge_groups:'||(context->>'groupId'),
  jsonb_build_object('context',context,'before',before_document,'after',receipt->'group','changedDefaultGroup',default_result,
   'regionalChanged',region_changed,'regionalConfirmed',requires_confirmation));
 perform private.record_shipping_charge_group_operation(context,request_hash,receipt);return receipt;
exception when lock_not_available then raise sqlstate 'PT409' using message='shipping_charge_group_retry';
end $function$;

CREATE OR REPLACE FUNCTION public.admin_seal_shipping_charge_group_operation(p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare context jsonb;receipt jsonb;begin
 -- Reject missing authority before parsing caller-controlled operation JSON.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 context:=private.shipping_charge_group_context(p_context);
 if context is distinct from p_context then raise invalid_parameter_value using message='invalid_shipping_charge_group_operation';end if;
 perform private.require_shipping_charge_group_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 perform pg_advisory_xact_lock(hashtextextended('shipping-charge-group-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_charge_group_prior(context);if receipt is not null then return receipt;end if;
 receipt:=private.shipping_charge_group_receipt(context,'sealed');perform private.record_shipping_charge_group_operation(context,null,receipt);
 insert into public.audit_log(id,actor_id,action,target,diff) values((context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,
  'catalog.shipping_charge_group.operation_sealed','shipping_charge_groups:'||coalesce(context->>'groupId','clear'),jsonb_build_object('context',context));
 return receipt;
end $function$;

-- Current RPC registration also refreshes each internal metadata hash.
select private.register_operator_rpc_contract('public.admin_assign_shipping_charge_group(jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_read_shipping_charge_group_operation(jsonb)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_shipping_charge_group(jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_seal_shipping_charge_group_operation(jsonb)'::regprocedure,'catalog.manage','write',false);

-- DRAFT ONLY: make the stable ownership reader reject unauthorized callers.
-- Keep the authorized scalar SELECT, NULL-on-missing semantics and STABLE
-- read-only contract. The added precheck does not take any lock.
do $guard$begin
 if (select md5(prosrc) from pg_proc where oid='public.admin_get_goods_group_editor_ownership(text)'::regprocedure)
  is distinct from '5e348738af8f7f85f488bc8b189e7900' then
  raise exception using errcode='55000',message='goods_group_ownership_guard_source_changed';
 end if;
end $guard$;

CREATE OR REPLACE FUNCTION public.admin_get_goods_group_editor_ownership(p_good_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 -- Reject before any goods lookup without adding row/advisory locks.
 if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required';end if;
 if not public.has_operator_capability('catalog.read',false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 return (
 select case when public.has_operator_capability('catalog.read',false) then jsonb_build_object('goodId',g.id,
  'group',(select private.goods_group_snapshot(group_id) from private.goods_group_members where good_id=g.id),
  'aggregation',jsonb_build_object('goodId',g.id,'ownerGoodId',coalesce(m.root_good_id,g.id),'aggregationId',r.aggregation_id,
   'sharedPolicy',private.goods_aggregation_shared_policy(g.id),'shared',m.good_id is not null,'editable',coalesce(m.root_good_id,g.id)=g.id)) else null end
 from public.goods g left join private.goods_aggregation_members m on m.good_id=g.id
 left join private.goods_aggregation_roots r on r.root_good_id=m.root_good_id where g.id=p_good_id
 );
end
$function$;

select private.register_operator_rpc_contract('public.admin_get_goods_group_editor_ownership(text)'::regprocedure,'catalog.read','read',false);
