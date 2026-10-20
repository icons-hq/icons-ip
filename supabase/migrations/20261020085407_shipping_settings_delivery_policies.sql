-- DRAFT: copy the existing versioned delivery contract through shipping templates.
-- Missing legacy delivery directives preserve the independent product policy.
-- No runtime, collector contract, order, volume policy, or family owner is changed.
create table private.shipping_settings_operations(
 operation_id uuid primary key,actor_id uuid not null,session_id uuid not null,command text not null check(command in('save','apply')),
 template_id uuid not null,expected_revision integer not null check(expected_revision>=0),request_hash text,
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 check(request_hash is null or request_hash~'^[0-9a-f]{64}$'),check((receipt->>'state'='sealed')=(request_hash is null))
);
alter table private.shipping_settings_operations enable row level security;
revoke all on private.shipping_settings_operations from public,anon,authenticated,service_role;

create function private.shipping_settings_uuid(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='string' and p_value#>>'{}'~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false);
$$;
create function private.shipping_settings_good_id(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='string' and char_length(p_value#>>'{}') between 1 and 120
  and p_value#>>'{}'=btrim(p_value#>>'{}') and p_value#>>'{}'!~'[[:cntrl:]]',false);
$$;
create function private.require_shipping_settings_identity(p_actor uuid,p_session uuid) returns void
language plpgsql volatile security invoker set search_path='' as $$begin
 perform private.require_operator_capability('catalog.manage',false);
 if p_actor is null or p_actor is distinct from auth.uid() or p_session is null
  or auth.jwt()->>'session_id' is distinct from p_session::text then raise insufficient_privilege using message='shipping_settings_auth_changed';end if;
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise insufficient_privilege using message='shipping_settings_auth_changed';end if;
end $$;
create function private.shipping_settings_operation_context(p_request jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$declare result jsonb;begin
 if jsonb_typeof(p_request) is distinct from 'object' or not p_request ?& array['operationId','command','templateId','expectedRevision','expectedActorId','expectedSessionId']
  or not private.shipping_settings_uuid(p_request->'operationId') or not private.shipping_settings_uuid(p_request->'templateId')
  or not private.shipping_settings_uuid(p_request->'expectedActorId') or not private.shipping_settings_uuid(p_request->'expectedSessionId')
  or coalesce(p_request->>'command','') not in('save','apply')
  or not private.transaction_uint(p_request->'expectedRevision',case when p_request->>'command'='apply' then 1 else 0 end,
   case when p_request->>'command'='save' then 2147483646 else 2147483647 end) then
  raise invalid_parameter_value using message='invalid_shipping_settings_operation';end if;
 select jsonb_object_agg(key,value) into result from jsonb_each(p_request)
 where key=any(array['operationId','command','templateId','expectedRevision','expectedActorId','expectedSessionId']);
 return result;
end $$;
create function private.validate_shipping_settings_extended(p_settings jsonb) returns void
language plpgsql immutable set search_path='' as $$declare directive jsonb;begin
 perform private.validate_shipping_settings(p_settings-'delivery');
 if not private.shipping_settings_uuid(p_settings->'originId') then raise invalid_parameter_value using message='invalid_shipping_settings';end if;
 if not(p_settings ? 'delivery') then return;end if;directive:=p_settings->'delivery';
 if private.transaction_json_keys(directive,array['mode']) and directive->>'mode'='preserve' then return;end if;
 if not coalesce(private.transaction_json_keys(directive,array['mode','policy']) and directive->>'mode'='replace'
  and private.goods_delivery_input_valid(directive->'policy'),false) then raise invalid_parameter_value using message='invalid_shipping_settings_delivery';end if;
end $$;
create function private.shipping_settings_delivery_input(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when d.id is null then 'null'::jsonb else jsonb_build_object('status',d.status,'paymentMode',d.payment_mode,
  'quantityTerms',d.quantity_terms,'draftValues',d.draft_values) end
 from public.goods g left join private.goods_transaction_configs c on c.good_id=private.goods_aggregation_owner(g.id)
 left join private.goods_delivery_versions d on d.id=c.delivery_version_id where g.id=p_good_id;
$$;
create function private.shipping_settings_effective(p_settings jsonb,p_delivery jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('originId',p_settings->'originId','feeType',p_settings->'feeType','individualFee',p_settings->'individualFee',
  'delivery',coalesce(p_delivery,'null'::jsonb));
$$;
create function private.shipping_settings_good_guard(p_good public.goods) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_good.id,'updatedAt',p_good.updated_at,'ownerGoodId',owner.id,'ownerUpdatedAt',owner.updated_at,
  'transactionRevision',coalesce(c.revision,0),'deliveryVersionId',c.delivery_version_id,
  'familyGoodIds',coalesce((select jsonb_agg(good_id order by good_id) from private.goods_aggregation_members where root_good_id=owner.id),jsonb_build_array(owner.id)))
 from public.goods owner left join private.goods_transaction_configs c on c.good_id=owner.id
 where owner.id=private.goods_aggregation_owner(p_good.id);
$$;
create function private.shipping_settings_origin(p_origin public.fulfillment_origins) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_origin.id,'name',p_origin.name,'updatedAt',p_origin.updated_at,'baseFee',p_origin.base_fee,
  'freeThreshold',p_origin.free_threshold,'returnAddress',p_origin.return_address,'defaultCarrier',p_origin.default_carrier,
  'collectRevision',coalesce(c.revision,0),'collectVersionId',c.version_id,'collectReady',coalesce(v.status='active' and p_origin.is_active,false),
  'collectorName',case when v.status='active' and p_origin.is_active then v.contract_values->>'collectorName' else null end)
 from (select 1) one left join private.shipping_collect_contracts c on c.origin_id=p_origin.id
 left join private.shipping_collect_contract_versions v on v.id=c.version_id;
$$;
create function private.shipping_settings_delivery_blocker(p_good_id text,p_settings jsonb,p_current jsonb,p_origin jsonb) returns text
language plpgsql stable security definer set search_path='' as $$declare final_delivery jsonb;begin
 if private.goods_aggregation_owner(p_good_id)<>p_good_id then return 'goods_aggregation_policy_owned_by_source';end if;
 final_delivery:=case when p_settings#>>'{delivery,mode}'='replace' then p_settings#>'{delivery,policy}' else p_current end;
 if p_settings#>>'{delivery,mode}'='replace' and final_delivery is distinct from p_current and final_delivery->>'status'='active'
  and not coalesce((select enabled from private.goods_transaction_runtime where singleton),false) then return 'checkout_contract_upgrade_required';end if;
 if final_delivery->>'status'='active' and final_delivery->>'paymentMode'<>'prepaid' and p_origin->>'collectReady'<>'true' then
  return 'collect_contract_not_ready';end if;
 return null;
end $$;
create function private.shipping_settings_receipt(p_context jsonb,p_state text,p_template jsonb default null,p_goods jsonb default '[]') returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('state',p_state,'operationId',p_context->'operationId','command',p_context->'command','templateId',p_context->'templateId',
  'expectedRevision',p_context->'expectedRevision','actorId',p_context->'expectedActorId','sessionId',p_context->'expectedSessionId',
  'template',p_template,'appliedCount',jsonb_array_length(p_goods),'goods',p_goods);
$$;
create function private.shipping_settings_prior(p_context jsonb,p_hash text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare previous private.shipping_settings_operations;begin
 select * into previous from private.shipping_settings_operations where operation_id=(p_context->>'operationId')::uuid;
 if not found then return null;end if;
 if previous.actor_id is distinct from (p_context->>'expectedActorId')::uuid or previous.session_id is distinct from (p_context->>'expectedSessionId')::uuid
  or previous.command is distinct from p_context->>'command' or previous.template_id is distinct from (p_context->>'templateId')::uuid
  or previous.expected_revision is distinct from (p_context->>'expectedRevision')::integer
  or (p_hash is not null and previous.receipt->>'state'<>'sealed' and previous.request_hash is distinct from p_hash) then
  raise sqlstate 'PT409' using message='shipping_settings_operation_conflict';end if;
 return previous.receipt;
end $$;
create function private.record_shipping_settings_operation(p_context jsonb,p_hash text,p_receipt jsonb) returns void
language sql volatile security definer set search_path='' as $$
 insert into private.shipping_settings_operations(operation_id,actor_id,session_id,command,template_id,expected_revision,request_hash,receipt)
 values((p_context->>'operationId')::uuid,(p_context->>'expectedActorId')::uuid,(p_context->>'expectedSessionId')::uuid,p_context->>'command',
  (p_context->>'templateId')::uuid,(p_context->>'expectedRevision')::integer,p_hash,p_receipt);
$$;

create function public.admin_read_shipping_settings_operation(p_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare context jsonb;begin
 context:=private.shipping_settings_operation_context(p_context);
 if context is distinct from p_context then raise invalid_parameter_value using message='invalid_shipping_settings_operation';end if;
 perform private.require_shipping_settings_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 return private.shipping_settings_prior(context);
end $$;
create function public.admin_seal_shipping_settings_operation(p_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare context jsonb;receipt jsonb;begin
 context:=private.shipping_settings_operation_context(p_context);
 if context is distinct from p_context then raise invalid_parameter_value using message='invalid_shipping_settings_operation';end if;
 perform private.require_shipping_settings_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 perform pg_advisory_xact_lock(hashtextextended('shipping-settings-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_settings_prior(context);if receipt is not null then return receipt;end if;
 receipt:=private.shipping_settings_receipt(context,'sealed');perform private.record_shipping_settings_operation(context,null,receipt);
 insert into public.audit_log(id,actor_id,action,target,diff) values((context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,
  'catalog.shipping_settings.operation_sealed','shipping_settings_templates:'||(context->>'templateId'),jsonb_build_object('context',context));
 return receipt;
end $$;
create function public.admin_save_shipping_settings_template_v2(p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare context jsonb;payload_hash text;receipt jsonb;previous public.shipping_settings_templates;saved public.shipping_settings_templates;settings jsonb;
begin
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
end $$;

create function public.admin_search_goods_for_shipping_settings_v2(p_query text,p_page integer,p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare result jsonb;pattern text;begin
 perform private.require_shipping_settings_identity(p_expected_actor_id,p_expected_session_id);
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then
  raise invalid_parameter_value using message='invalid_shipping_settings_filter';end if;
 pattern:='%'||replace(replace(replace(btrim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with matched as(select g.* from public.goods g where g.archived_at is null and (g.name ilike pattern escape E'\\' or g.code ilike pattern escape E'\\' or g.id ilike pattern escape E'\\')),
 page as(select * from matched order by updated_at desc,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from matched),'page',p_page,'pageSize',20,'rows',coalesce(jsonb_agg(jsonb_build_object(
  'id',page.id,'name',page.name,'code',page.code,'updatedAt',page.updated_at,'settings',private.good_shipping_settings(page),
  'templateId',page.shipping_settings_template_id,'templateRevision',page.shipping_settings_template_revision,'ownerGoodId',owner.id,
  'familyGoodIds',(private.shipping_settings_good_guard(page))->'familyGoodIds',
  'editable',owner.id=page.id,'blocker',case when owner.id<>page.id then 'goods_aggregation_policy_owned_by_source' else null end,
  'effective',private.shipping_settings_effective(private.good_shipping_settings(owner),private.shipping_settings_delivery_input(page.id))) order by page.updated_at desc,page.id),'[]'))
 into result from page join public.goods owner on owner.id=private.goods_aggregation_owner(page.id);
 return result;
end $$;
create function public.admin_preview_shipping_settings_template_v2(p_template_id uuid,p_good_ids text[],p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare template public.shipping_settings_templates;origin public.fulfillment_origins;good public.goods;owner public.goods;rows jsonb:='[]';
 origin_doc jsonb;current_delivery jsonb;next_delivery jsonb;blocker text;can_apply boolean:=true;
begin
 perform private.require_shipping_settings_identity(p_expected_actor_id,p_expected_session_id);
 if p_template_id is null or p_good_ids is null or cardinality(p_good_ids) not between 1 and 100 or array_position(p_good_ids,null) is not null
  or exists(select 1 from unnest(p_good_ids) id where not private.shipping_settings_good_id(to_jsonb(id)))
  or (select count(distinct id) from unnest(p_good_ids) id)<>cardinality(p_good_ids) then
  raise invalid_parameter_value using message='invalid_shipping_settings_targets';end if;
 select * into template from public.shipping_settings_templates where id=p_template_id and enabled;
 if not found then raise check_violation using message='shipping_settings_template_unavailable';end if;
 perform private.validate_shipping_settings_extended(template.settings);
 select * into origin from public.fulfillment_origins where id=(template.settings->>'originId')::uuid and is_active;
 if not found then raise check_violation using message='shipping_settings_origin_unavailable';end if;
 origin_doc:=private.shipping_settings_origin(origin);
 if (select count(*) from public.goods where id=any(p_good_ids) and archived_at is null)<>cardinality(p_good_ids) then
  raise check_violation using message='shipping_settings_goods_unavailable';end if;
 for good in select * from public.goods where id=any(p_good_ids) order by id loop
  select * into owner from public.goods where id=private.goods_aggregation_owner(good.id);
  current_delivery:=private.shipping_settings_delivery_input(good.id);
  next_delivery:=case when template.settings#>>'{delivery,mode}'='replace' then template.settings#>'{delivery,policy}' else current_delivery end;
  blocker:=private.shipping_settings_delivery_blocker(good.id,template.settings,current_delivery,origin_doc);can_apply:=can_apply and blocker is null;
  rows:=rows||jsonb_build_array(private.shipping_settings_good_guard(good)||jsonb_build_object('name',good.name,'code',good.code,
   'editable',owner.id=good.id,'blocker',blocker,'before',private.good_shipping_settings(good),'after',template.settings,
   'effectiveBefore',private.shipping_settings_effective(private.good_shipping_settings(owner),current_delivery),
   'effectiveAfter',private.shipping_settings_effective(template.settings,next_delivery)));
 end loop;
 return jsonb_build_object('template',private.shipping_settings_template_json(template),'actorId',p_expected_actor_id,'sessionId',p_expected_session_id,
  'canApply',can_apply,'origin',origin_doc,'goods',rows);
end $$;

create function private.validate_shipping_settings_apply(p_request jsonb) returns void
language plpgsql immutable set search_path='' as $$declare row jsonb;begin
 if not private.transaction_json_keys(p_request,array['operationId','command','templateId','expectedRevision','expectedActorId','expectedSessionId',
  'originUpdatedAt','collectRevision','collectVersionId','goods']) or p_request->>'command'<>'apply'
  or not private.transaction_instant_valid(p_request->'originUpdatedAt') or not private.transaction_uint(p_request->'collectRevision',0,2147483647)
  or not(p_request->'collectVersionId'='null'::jsonb or private.shipping_settings_uuid(p_request->'collectVersionId'))
  or ((p_request->>'collectRevision')::integer=0) is distinct from (p_request->'collectVersionId'='null'::jsonb)
  or jsonb_typeof(p_request->'goods') is distinct from 'array' then raise invalid_parameter_value using message='invalid_shipping_settings_application';end if;
 if jsonb_array_length(p_request->'goods') not between 1 and 100 then raise invalid_parameter_value using message='invalid_shipping_settings_targets';end if;
 for row in select value from jsonb_array_elements(p_request->'goods') loop
  if not private.transaction_json_keys(row,array['id','updatedAt','ownerGoodId','ownerUpdatedAt','familyGoodIds','transactionRevision','deliveryVersionId'])
   or not private.shipping_settings_good_id(row->'id') or not private.shipping_settings_good_id(row->'ownerGoodId')
   or not private.transaction_instant_valid(row->'updatedAt') or not private.transaction_instant_valid(row->'ownerUpdatedAt')
   or not private.transaction_uint(row->'transactionRevision',0,2147483647)
   or not(row->'deliveryVersionId'='null'::jsonb or private.shipping_settings_uuid(row->'deliveryVersionId'))
   or (row->'deliveryVersionId'<>'null'::jsonb and row->>'transactionRevision'='0')
   or jsonb_typeof(row->'familyGoodIds') is distinct from 'array' then raise invalid_parameter_value using message='invalid_shipping_settings_targets';end if;
  if jsonb_array_length(row->'familyGoodIds') not between 1 and 100
   or exists(select 1 from jsonb_array_elements(row->'familyGoodIds') id where not private.shipping_settings_good_id(id))
   or (select count(distinct value) from jsonb_array_elements(row->'familyGoodIds'))<>jsonb_array_length(row->'familyGoodIds')
   or not (row->'familyGoodIds') ? (row->>'id') or not (row->'familyGoodIds') ? (row->>'ownerGoodId') then
   raise invalid_parameter_value using message='invalid_shipping_settings_targets';end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_request->'goods'))<>jsonb_array_length(p_request->'goods') then
  raise invalid_parameter_value using message='invalid_shipping_settings_targets';end if;
end $$;
create function public.admin_apply_shipping_settings_template_v2(p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare context jsonb;payload_hash text;receipt jsonb;template public.shipping_settings_templates;origin public.fulfillment_origins;origin_doc jsonb;
 good public.goods;target text;ids text[];row jsonb;actual jsonb;current_delivery jsonb;blocker text;child_operation uuid;transaction_receipt jsonb;
 previous jsonb;results jsonb:='[]';config private.goods_transaction_configs;
begin
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
end $$;

-- Legacy snapshots own only their original four fields. An explicit copied
-- delivery policy additionally detaches when that policy is edited separately;
-- volume-only changes and a catalog ID rename preserve the association.
create or replace function private.detach_changed_shipping_settings() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.shipping_settings_template_id is not null and (
  ((new.shipping_settings_snapshot->'settings')-'delivery') is distinct from private.good_shipping_settings(new)
  or (new.shipping_settings_snapshot#>>'{settings,delivery,mode}'='replace'
   and new.shipping_settings_snapshot->'appliedDelivery' is distinct from private.shipping_settings_delivery_input(old.id))) then
  new.shipping_settings_template_id:=null;new.shipping_settings_template_revision:=null;new.shipping_settings_snapshot:=null;
 end if;
 if new.shipping_settings_snapshot is distinct from old.shipping_settings_snapshot or private.good_shipping_settings(new) is distinct from private.good_shipping_settings(old) then
  new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');end if;
 return new;
end $$;

-- An older client cannot silently ignore an extended template's copy directive.
do $$declare definition text;needle text:='if not found or not template.enabled then raise check_violation using message=''shipping_settings_template_unavailable''; end if;';begin
 definition:=pg_get_functiondef('public.admin_apply_shipping_settings_template(uuid,uuid,integer,timestamptz,jsonb)'::regprocedure);
 if strpos(definition,needle)=0 then raise check_violation using message='shipping_settings_legacy_apply_shape_changed';end if;
 definition:=replace(definition,needle,needle||E'\n if template.settings ? ''delivery'' then raise check_violation using message=''shipping_settings_preview_upgrade_required'';end if;');
 execute definition;
end $$;

do $$declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any(array[
  'shipping_settings_uuid','shipping_settings_good_id','require_shipping_settings_identity','shipping_settings_operation_context','validate_shipping_settings_extended',
  'shipping_settings_delivery_input','shipping_settings_effective','shipping_settings_good_guard','shipping_settings_origin','shipping_settings_delivery_blocker',
  'shipping_settings_receipt','shipping_settings_prior','record_shipping_settings_operation','validate_shipping_settings_apply']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);execute format('grant execute on function %s to postgres',fn);
  perform private.register_operator_internal_contract(fn);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
  'admin_read_shipping_settings_operation','admin_seal_shipping_settings_operation','admin_save_shipping_settings_template_v2',
  'admin_search_goods_for_shipping_settings_v2','admin_preview_shipping_settings_template_v2','admin_apply_shipping_settings_template_v2']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);execute format('grant execute on function %s to authenticated',fn);
  perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
select private.register_operator_internal_contract('private.detach_changed_shipping_settings()'::regprocedure);
select private.register_operator_internal_contract('public.admin_apply_shipping_settings_template(uuid,uuid,integer,timestamptz,jsonb)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_apply_shipping_settings_template(uuid,uuid,integer,timestamptz,jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_read_shipping_settings_operation(jsonb)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_seal_shipping_settings_operation(jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_save_shipping_settings_template_v2(jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_search_goods_for_shipping_settings_v2(text,integer,uuid,uuid)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_preview_shipping_settings_template_v2(uuid,text[],uuid,uuid)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_apply_shipping_settings_template_v2(jsonb)'::regprocedure,'catalog.manage','write',false);
notify pgrst,'reload schema';
