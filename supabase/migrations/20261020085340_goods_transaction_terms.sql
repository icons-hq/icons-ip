-- Immutable versioned volume-discount and delivery terms.
-- Runtime defaults OFF; active terms require the shared checkout runtime.
create table private.goods_transaction_runtime (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into private.goods_transaction_runtime(singleton) values(true);

create function private.transaction_json_keys(p_value jsonb,p_keys text[]) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='object' and p_value ?& p_keys and p_value-p_keys='{}'::jsonb,false);
$$;
create function private.transaction_uint(p_value jsonb,p_min numeric default 0,p_max numeric default 9007199254740991) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare number_value numeric;begin
 if jsonb_typeof(p_value) is distinct from 'number' then return false;end if;
 number_value:=(p_value#>>'{}')::numeric;
 return number_value between p_min and p_max and trunc(number_value)=number_value;
exception when numeric_value_out_of_range or invalid_text_representation then return false;
end $$;
create function private.transaction_draft_valid(p_value jsonb,p_keys text[]) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='object' and p_value-p_keys='{}'::jsonb
  and not exists(select 1 from jsonb_each(case when jsonb_typeof(p_value)='object' then p_value else '{}'::jsonb end) e
   where jsonb_typeof(e.value)<>'string' or char_length(e.value#>>'{}')>128 or (e.value#>>'{}')~'[[:cntrl:]]'),false);
$$;
create function private.transaction_instant_valid(p_value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$declare parts text[];instant timestamptz;begin
 if jsonb_typeof(p_value) is distinct from 'string' then return false;end if;
 parts:=regexp_match(p_value#>>'{}','^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$');
 if parts is null or parts[1]::integer=0 or parts[4]::integer>23 or parts[5]::integer>59 or parts[6]::integer>59
  or (parts[8]<>'Z' and (substring(parts[8],2,2)::integer>15 or substring(parts[8],5,2)::integer>59)) then return false;end if;
 instant:=(p_value#>>'{}')::timestamptz;return isfinite(instant);
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
create function private.goods_volume_terms_valid(p_value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare starts timestamptz;ends timestamptz;begin
 if not private.transaction_json_keys(p_value,array['condition','threshold','discountKind','discountValue','startsAt','endsAt'])
  or coalesce(p_value->>'condition','') not in ('quantity','regular_subtotal') or coalesce(p_value->>'discountKind','') not in ('fixed','percent')
  or not private.transaction_uint(p_value->'threshold',case when p_value->>'condition'='quantity' then 2 else 1 end,
   case when p_value->>'condition'='quantity' then 2147483647 else 999999999999 end)
  or not private.transaction_uint(p_value->'discountValue',1,case when p_value->>'discountKind'='percent' then 100 else 2147483647 end) then return false;end if;
 if p_value->'startsAt'='null'::jsonb and p_value->'endsAt'='null'::jsonb then return true;end if;
 if not private.transaction_instant_valid(p_value->'startsAt') or not private.transaction_instant_valid(p_value->'endsAt') then return false;end if;
 starts:=(p_value->>'startsAt')::timestamptz;ends:=(p_value->>'endsAt')::timestamptz;
 return isfinite(starts) and isfinite(ends) and starts<ends;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
create function private.goods_delivery_quantity_terms_valid(p_value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$begin
 if not private.transaction_uint(p_value->'baseFee',0,1000000) then return false;end if;
 if p_value->>'kind'='repeat' then
  return private.transaction_json_keys(p_value,array['kind','baseFee','interval']) and private.transaction_uint(p_value->'interval',1,2147483647);
 end if;
 if not private.transaction_uint(p_value->'firstLimit',1,2147483647) or not private.transaction_uint(p_value->'extra1',0,1000000) then return false;end if;
 if p_value->>'kind'='tier2' then return private.transaction_json_keys(p_value,array['kind','baseFee','firstLimit','extra1']);end if;
 if p_value->>'kind'='tier3' then
  return private.transaction_json_keys(p_value,array['kind','baseFee','firstLimit','secondLimit','extra1','extra2'])
   and private.transaction_uint(p_value->'secondLimit',(p_value->>'firstLimit')::numeric+1,2147483647)
   and private.transaction_uint(p_value->'extra2',(p_value->>'extra1')::numeric,1000000);
 end if;return false;
end $$;
create function private.goods_volume_input_valid(p_value jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(private.transaction_json_keys(p_value,array['status','terms','draftValues'])
  and p_value->>'status' in ('draft','active','disabled')
  and (private.goods_volume_terms_valid(p_value->'terms') or (p_value->'terms'='null'::jsonb and p_value->>'status'<>'active'))
  and private.transaction_draft_valid(p_value->'draftValues',array['condition','threshold','discountKind','discountValue','startsAt','endsAt']),false);
$$;
create function private.goods_delivery_input_valid(p_value jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(private.transaction_json_keys(p_value,array['status','paymentMode','quantityTerms','draftValues'])
  and p_value->>'status' in ('draft','active','disabled') and p_value->>'paymentMode' in ('prepaid','collect','buyer_choice')
  and (p_value->'quantityTerms'='null'::jsonb or private.goods_delivery_quantity_terms_valid(p_value->'quantityTerms'))
  and private.transaction_draft_valid(p_value->'draftValues',array['kind','baseFee','interval','firstLimit','secondLimit','extra1','extra2','paymentMode']),false);
$$;

create table private.goods_volume_discount_versions (
 id uuid primary key default gen_random_uuid(),good_id text not null references public.goods(id) on update cascade on delete restrict,
 revision integer not null check(revision>0),status text not null check(status in ('draft','active','disabled')),
 terms jsonb,draft_values jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),
 created_by uuid not null references auth.users(id),unique(id,good_id),unique(good_id,revision),
 check(private.goods_volume_input_valid(jsonb_build_object('status',status,'terms',terms,'draftValues',draft_values)))
);
create table private.goods_delivery_versions (
 id uuid primary key default gen_random_uuid(),good_id text not null references public.goods(id) on update cascade on delete restrict,
 revision integer not null check(revision>0),status text not null check(status in ('draft','active','disabled')),
 payment_mode text not null check(payment_mode in ('prepaid','collect','buyer_choice')),quantity_terms jsonb,
 draft_values jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),
 unique(id,good_id),unique(good_id,revision),
 check(private.goods_delivery_input_valid(jsonb_build_object('status',status,'paymentMode',payment_mode,'quantityTerms',quantity_terms,'draftValues',draft_values)))
);
create table private.goods_transaction_configs (
 good_id text primary key references public.goods(id) on update cascade on delete restrict,
 revision integer not null default 0 check(revision>=0),volume_version_id uuid,delivery_version_id uuid,
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null references auth.users(id),
 foreign key(volume_version_id,good_id) references private.goods_volume_discount_versions(id,good_id) on update cascade,
 foreign key(delivery_version_id,good_id) references private.goods_delivery_versions(id,good_id) on update cascade
);
create table private.shipping_collect_contract_versions (
 id uuid primary key default gen_random_uuid(),origin_id uuid not null references public.fulfillment_origins(id),revision integer not null check(revision>0),
 status text not null check(status in ('draft','active','disabled')),contract_values jsonb not null,created_at timestamptz not null default clock_timestamp(),
 created_by uuid not null references auth.users(id),unique(id,origin_id),unique(origin_id,revision)
);
create table private.shipping_collect_contracts (
 origin_id uuid primary key references public.fulfillment_origins(id),revision integer not null check(revision>0),version_id uuid not null,
 foreign key(version_id,origin_id) references private.shipping_collect_contract_versions(id,origin_id)
);
create function private.guard_goods_transaction_version() returns trigger
language plpgsql security invoker set search_path='' as $$begin
 -- A catalog ID rename propagates through FK identities without rewriting any
 -- price/contract term. All other version updates and deletion are forbidden.
 if tg_op='UPDATE' and (to_jsonb(new)-'good_id')=(to_jsonb(old)-'good_id') then return new;end if;
 raise check_violation using message='transaction_terms_immutable';
end $$;
create trigger immutable_goods_volume_version before update or delete on private.goods_volume_discount_versions
 for each row execute function private.guard_goods_transaction_version();
create trigger immutable_goods_delivery_version before update or delete on private.goods_delivery_versions
 for each row execute function private.guard_goods_transaction_version();
create trigger immutable_shipping_collect_contract before update or delete on private.shipping_collect_contract_versions
 for each row execute function private.guard_goods_transaction_version();

create function private.goods_transaction_terms_document(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('goodId',g.id,'revision',coalesce(c.revision,0),'goodUpdatedAt',g.updated_at,
  'volume',case when v.id is null then null else jsonb_build_object('id',v.id,'goodId',v.good_id,'revision',v.revision,'status',v.status,'terms',v.terms,'draftValues',v.draft_values) end,
  'delivery',case when d.id is null then null else jsonb_build_object('id',d.id,'goodId',d.good_id,'revision',d.revision,'status',d.status,
   'paymentMode',d.payment_mode,'quantityTerms',d.quantity_terms,'draftValues',d.draft_values) end)
 from public.goods g left join private.goods_transaction_configs c on c.good_id=g.id
 left join private.goods_volume_discount_versions v on v.id=c.volume_version_id
 left join private.goods_delivery_versions d on d.id=c.delivery_version_id where g.id=p_good_id;
$$;
create function public.admin_get_good_transaction_terms(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return private.goods_transaction_terms_document(p_good_id);
end $$;
create function public.admin_save_good_transaction_terms(p_good_id text,p_expected_revision integer,p_expected_good_updated_at timestamptz,
 p_volume jsonb,p_delivery jsonb,p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous private.goods_transaction_configs;good public.goods;request jsonb;receipt jsonb;
 before_document jsonb;volume_changed boolean;delivery_changed boolean;changed boolean;new_revision integer;volume_id uuid;delivery_id uuid;
begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='auth_context_changed';end if;
 perform private.require_actor_operator_capability(actor,'catalog.manage');
 if p_good_id is null or char_length(p_good_id) not between 1 and 200 or p_good_id<>btrim(p_good_id) or p_good_id~'[[:cntrl:]]'
  or p_expected_revision is null or p_expected_revision<0 or p_expected_good_updated_at is null or not isfinite(p_expected_good_updated_at) or p_operation_id is null
  or (p_volume is not null and not private.goods_volume_input_valid(p_volume))
  or (p_delivery is not null and not private.goods_delivery_input_valid(p_delivery)) then
  raise invalid_parameter_value using message='invalid_goods_transaction_terms';end if;
 request:=jsonb_build_object('goodId',p_good_id,'expectedRevision',p_expected_revision,'expectedGoodUpdatedAt',p_expected_good_updated_at,
  'volume',p_volume,'delivery',p_delivery);
 perform pg_advisory_xact_lock(hashtextextended('goods-transaction-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.goods.transaction_terms.saved',request);
 if receipt is not null then return receipt;end if;
 select * into good from public.goods where id=p_good_id and archived_at is null for update;
 if not found then raise no_data_found using message='good_not_found';end if;
 select * into previous from private.goods_transaction_configs where good_id=p_good_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision or good.updated_at is distinct from p_expected_good_updated_at then
  raise sqlstate 'PT409' using message='goods_transaction_terms_changed';end if;
 before_document:=private.goods_transaction_terms_document(p_good_id);
 volume_changed:=p_volume is not null and p_volume is distinct from case when before_document->'volume'='null'::jsonb then null else (before_document->'volume')-array['id','goodId','revision'] end;
 delivery_changed:=p_delivery is not null and p_delivery is distinct from case when before_document->'delivery'='null'::jsonb then null else (before_document->'delivery')-array['id','goodId','revision'] end;
 changed:=volume_changed or delivery_changed;new_revision:=coalesce(previous.revision,0)+case when changed then 1 else 0 end;
 volume_id:=previous.volume_version_id;delivery_id:=previous.delivery_version_id;
 if (volume_changed and p_volume->>'status'='active') or (delivery_changed and p_delivery->>'status'='active') then
  perform 1 from private.goods_transaction_runtime where singleton and enabled for share;
  if not found then raise check_violation using message='checkout_contract_upgrade_required';end if;
 end if;
 if delivery_changed and p_delivery->>'status'='active' and p_delivery->>'paymentMode'<>'prepaid' then
  -- Parent goods precedes origin; checkout uses this same order.
  perform 1 from public.fulfillment_origins where id=good.origin_id and is_active for share;
  if not found then raise check_violation using message='collect_contract_not_ready';end if;
  perform 1 from private.shipping_collect_contracts c join private.shipping_collect_contract_versions v on v.id=c.version_id
   where c.origin_id=good.origin_id and v.status='active' for share of c;
  if not found then raise check_violation using message='collect_contract_not_ready';end if;
 end if;
 if volume_changed then
  insert into private.goods_volume_discount_versions(good_id,revision,status,terms,draft_values,created_by)
   values(p_good_id,new_revision,p_volume->>'status',nullif(p_volume->'terms','null'::jsonb),p_volume->'draftValues',actor) returning id into volume_id;
 end if;
 if delivery_changed then
  insert into private.goods_delivery_versions(good_id,revision,status,payment_mode,quantity_terms,draft_values,created_by)
   values(p_good_id,new_revision,p_delivery->>'status',p_delivery->>'paymentMode',nullif(p_delivery->'quantityTerms','null'::jsonb),p_delivery->'draftValues',actor) returning id into delivery_id;
 end if;
 if changed then
  insert into private.goods_transaction_configs(good_id,revision,volume_version_id,delivery_version_id,updated_by)
   values(p_good_id,new_revision,volume_id,delivery_id,actor) on conflict(good_id) do update set revision=excluded.revision,
    volume_version_id=excluded.volume_version_id,delivery_version_id=excluded.delivery_version_id,updated_at=clock_timestamp(),updated_by=actor;
  update public.goods set updated_at=clock_timestamp() where id=p_good_id;
 end if;
 receipt:=private.goods_transaction_terms_document(p_good_id)||jsonb_build_object('operationId',p_operation_id,'changed',changed);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods.transaction_terms.saved','goods:'||p_good_id,
  jsonb_build_object('request',request,'before',before_document,'result',receipt));
 return receipt;
end $$;

create function private.shipping_collect_contract_input_valid(p_values jsonb,p_status text) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(p_status in ('draft','active','disabled')
  and private.transaction_json_keys(p_values,array['collectorName','collectionMethod','refundContact','customerInstructions','contractReference','dispatchMappingReference','receiptReference','disputeContact'])
  and not exists(select 1 from jsonb_each(case when jsonb_typeof(p_values)='object' then p_values else '{}'::jsonb end) e
   where jsonb_typeof(e.value)<>'string' or (e.value#>>'{}')<>btrim(e.value#>>'{}') or (e.value#>>'{}')~'[[:cntrl:]]'
    or char_length(e.value#>>'{}')>case when e.key='customerInstructions' then 500 when e.key='collectorName' then 100 else 200 end
    or (p_status='active' and char_length(e.value#>>'{}')=0)),false);
$$;
alter table private.shipping_collect_contract_versions add constraint shipping_collect_contract_values_valid
 check(private.shipping_collect_contract_input_valid(contract_values,status));
create function private.shipping_collect_contract_document(p_origin_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('originId',o.id,'revision',coalesce(c.revision,0),'versionId',v.id,'status',coalesce(v.status,'disabled'),
  'values',coalesce(v.contract_values,jsonb_build_object('collectorName','','collectionMethod','','refundContact','','customerInstructions','','contractReference','','dispatchMappingReference','','receiptReference','','disputeContact','')))
 from public.fulfillment_origins o left join private.shipping_collect_contracts c on c.origin_id=o.id
 left join private.shipping_collect_contract_versions v on v.id=c.version_id where o.id=p_origin_id;
$$;
create function public.admin_get_shipping_collect_contract(p_origin_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not public.has_operator_capability('platform.manage',true) then raise insufficient_privilege using message='operator_capability_required';end if;
 return private.shipping_collect_contract_document(p_origin_id);
end $$;
create function public.admin_get_shipping_collect_readiness(p_origin_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 result:=private.shipping_collect_contract_document(p_origin_id);if result is null then return null;end if;
 return jsonb_build_object('originId',result->'originId','revision',result->'revision','status',result->'status',
  'collector',case when result->>'status'='active' then jsonb_build_object('name',result#>>'{values,collectorName}',
   'method',result#>>'{values,collectionMethod}','refundContact',result#>>'{values,refundContact}','instructions',result#>>'{values,customerInstructions}') end);
end $$;
create function public.admin_get_shipping_collect_operation(p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare actor uuid:=auth.uid();result jsonb;begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='auth_context_changed';end if;
 if not public.has_operator_capability('platform.manage',true) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_collect_operation';end if;
 select diff->'result' into result from public.audit_log where id=p_operation_id and actor_id=actor and action='admin.shipping.collect_contract.saved';
 return result;
end $$;
create function public.admin_save_shipping_collect_contract(p_origin_id uuid,p_expected_revision integer,p_status text,p_values jsonb,
 p_operation_id uuid,p_expected_actor_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous private.shipping_collect_contracts;request jsonb;receipt jsonb;version_id uuid;begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='auth_context_changed';end if;
 perform private.require_actor_operator_capability(actor,'platform.manage',true);
 if p_origin_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null
  or not private.shipping_collect_contract_input_valid(p_values,p_status) then raise invalid_parameter_value using message='invalid_collect_contract';end if;
 request:=jsonb_build_object('originId',p_origin_id,'expectedRevision',p_expected_revision,'status',p_status,'values',p_values);
 perform pg_advisory_xact_lock(hashtextextended('shipping-collect-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.shipping.collect_contract.saved',request);if receipt is not null then return receipt;end if;
 perform 1 from public.fulfillment_origins where id=p_origin_id and is_active for update;
 if not found then raise no_data_found using message='fulfillment_origin_not_found';end if;
 select * into previous from private.shipping_collect_contracts where origin_id=p_origin_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='collect_contract_changed';end if;
 insert into private.shipping_collect_contract_versions(origin_id,revision,status,contract_values,created_by)
  values(p_origin_id,p_expected_revision+1,p_status,p_values,actor) returning id into version_id;
 insert into private.shipping_collect_contracts(origin_id,revision,version_id) values(p_origin_id,p_expected_revision+1,version_id)
  on conflict(origin_id) do update set revision=excluded.revision,version_id=excluded.version_id;
 receipt:=private.shipping_collect_contract_document(p_origin_id)||jsonb_build_object('operationId',p_operation_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.shipping.collect_contract.saved','fulfillment_origins:'||p_origin_id,
  jsonb_build_object('request',request,'before',to_jsonb(previous),'result',receipt));return receipt;
end $$;

create function private.goods_quantity_delivery_fee(p_quantity numeric,p_terms jsonb) returns bigint
language plpgsql immutable security invoker set search_path='' as $$declare fee numeric;begin
 if p_quantity is null or p_quantity<1 or trunc(p_quantity)<>p_quantity or p_quantity>9007199254740991
  or not private.goods_delivery_quantity_terms_valid(p_terms) then raise invalid_parameter_value using message='invalid_quantity_delivery';end if;
 fee:=(p_terms->>'baseFee')::numeric;
 if p_terms->>'kind'='repeat' then fee:=ceil(p_quantity/(p_terms->>'interval')::numeric)*fee;
 elsif p_quantity>(p_terms->>'firstLimit')::numeric then
  fee:=fee+case when p_terms->>'kind'='tier3' and p_quantity>(p_terms->>'secondLimit')::numeric then (p_terms->>'extra2')::numeric else (p_terms->>'extra1')::numeric end;
 end if;
 if fee>9007199254740991 then raise numeric_value_out_of_range using message='transaction_amount_overflow';end if;
 return fee::bigint;
end $$;
create function private.calculate_goods_volume_discounts(p_lines jsonb,p_policies jsonb,p_at timestamptz) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare line jsonb;policy jsonb;terms jsonb;quantity numeric;regular_subtotal numeric;basis numeric;unit_discount numeric;
 subtotal numeric:=0;discount numeric:=0;line_subtotal numeric;line_discount numeric;result_lines jsonb:='[]';policy_id uuid;
 next_change timestamptz;boundary timestamptz;starts timestamptz;ends timestamptz;
begin
 if p_at is null or not isfinite(p_at) or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 19239
  or jsonb_typeof(p_policies) is distinct from 'array' or jsonb_array_length(p_policies)>19239 then raise invalid_parameter_value using message='invalid_volume_discount_lines';end if;
 if exists(select 1 from jsonb_array_elements(p_lines) r where not private.transaction_json_keys(r,array['lineId','goodId','regularUnitPrice','unitPrice','qty'])
  or jsonb_typeof(r->'lineId') is distinct from 'string' or char_length(r->>'lineId') not between 1 and 256
  or jsonb_typeof(r->'goodId') is distinct from 'string' or char_length(r->>'goodId') not between 1 and 200
  or not private.transaction_uint(r->'regularUnitPrice',0,2147483647) or not private.transaction_uint(r->'unitPrice',0,2147483647)
  or not private.transaction_uint(r->'qty',1,2147483647))
  or exists(select 1 from jsonb_array_elements(p_lines) r where (r->>'unitPrice')::numeric>(r->>'regularUnitPrice')::numeric)
  or (select count(distinct r->>'lineId') from jsonb_array_elements(p_lines) r)<>jsonb_array_length(p_lines) then
  raise invalid_parameter_value using message='invalid_volume_discount_lines';end if;
 if exists(select 1 from jsonb_array_elements(p_policies) p where not private.transaction_json_keys(p,array['id','goodId','revision','status','terms','draftValues'])
  or jsonb_typeof(p->'id') is distinct from 'string' or (p->>'id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p->'goodId') is distinct from 'string' or char_length(p->>'goodId') not between 1 and 200
  or not private.transaction_uint(p->'revision',1,2147483647) or not private.goods_volume_input_valid(p-array['id','goodId','revision']))
  or (select count(distinct p->>'goodId') from jsonb_array_elements(p_policies) p)<>jsonb_array_length(p_policies) then
  raise invalid_parameter_value using message='invalid_volume_discount_policies';end if;
 for line in select r from jsonb_array_elements(p_lines) r loop
  select p into policy from jsonb_array_elements(p_policies) p where p->>'goodId'=line->>'goodId';
  terms:=policy->'terms';unit_discount:=0;policy_id:=null;
  if policy->>'status'='active' then
   starts:=(terms->>'startsAt')::timestamptz;ends:=(terms->>'endsAt')::timestamptz;
   foreach boundary in array array[starts,ends] loop
    if boundary>p_at and (next_change is null or boundary<next_change) then next_change:=boundary;end if;
   end loop;
   select sum((r->>'qty')::numeric),sum((r->>'qty')::numeric*(r->>'regularUnitPrice')::numeric) into quantity,regular_subtotal
    from jsonb_array_elements(p_lines) r where r->>'goodId'=line->>'goodId';
   basis:=case when terms->>'condition'='quantity' then quantity else regular_subtotal end;
   if (starts is null or (p_at>=starts and p_at<ends)) and basis>=(terms->>'threshold')::numeric then
    unit_discount:=case when terms->>'discountKind'='fixed' then least((line->>'unitPrice')::numeric,(terms->>'discountValue')::numeric)
     else trunc((line->>'unitPrice')::numeric*(terms->>'discountValue')::numeric/100) end;
    policy_id:=(policy->>'id')::uuid;
   end if;
  end if;
  line_subtotal:=(line->>'qty')::numeric*(line->>'unitPrice')::numeric;line_discount:=(line->>'qty')::numeric*unit_discount;
  subtotal:=subtotal+line_subtotal;discount:=discount+line_discount;
  if subtotal>9007199254740991 then raise numeric_value_out_of_range using message='transaction_amount_overflow';end if;
  result_lines:=result_lines||jsonb_build_array(line||jsonb_build_object('volumeUnitDiscount',unit_discount,'volumeDiscountTotal',line_discount,
   'netSubtotal',line_subtotal-line_discount,'policyId',policy_id));
 end loop;
 return jsonb_build_object('subtotal',subtotal,'volumeDiscountTotal',discount,'netSubtotal',subtotal-discount,'nextChangeAt',next_change,'lines',result_lines);
end $$;
create function private.allocate_transaction_amount(p_total numeric,p_rows jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$declare denominator numeric;result jsonb;begin
 if p_total is null or p_total<0 or p_total>9007199254740991 or trunc(p_total)<>p_total or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows) not between 1 and 19239 then raise invalid_parameter_value using message='invalid_transaction_allocation';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where not private.transaction_json_keys(r,array['id','weight'])
  or jsonb_typeof(r->'id') is distinct from 'string' or char_length(r->>'id') not between 1 and 256 or not private.transaction_uint(r->'weight'))
  or (select count(distinct r->>'id') from jsonb_array_elements(p_rows) r)<>jsonb_array_length(p_rows) then
  raise invalid_parameter_value using message='invalid_transaction_allocation';end if;
 select sum((r->>'weight')::numeric) into denominator from jsonb_array_elements(p_rows) r;
 if denominator=0 then
  if p_total<>0 then raise invalid_parameter_value using message='transaction_allocation_zero_weight';end if;
  select jsonb_object_agg(r->>'id',0) into result from jsonb_array_elements(p_rows) r;return result;
 end if;
 with parts as(select r->>'id' id,trunc(p_total*(r->>'weight')::numeric/denominator) base,
   mod(p_total*(r->>'weight')::numeric,denominator) remainder from jsonb_array_elements(p_rows) r),
 ranked as(select *,row_number() over(order by remainder desc,id collate "C") position,sum(base) over() allocated from parts)
 select jsonb_object_agg(id,base+case when position<=p_total-allocated then 1 else 0 end) into result from ranked;
 return result;
end $$;

-- One actor/source order is shared by cart, gift, subscription adapters and the
-- private quote/place implementations. No caller may rely on adapter-only locks.
create function private.lock_goods_transaction_actor(p_actor uuid) returns void
language plpgsql volatile security invoker set search_path='' as $$begin
 if p_actor is null then raise invalid_parameter_value using message='invalid_transaction_actor';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
 perform private.lock_account_action_subject(p_actor);
 perform 1 from public.profiles where id=p_actor for share;
end $$;
create function private.lock_goods_transaction_source(p_actor uuid,p_source jsonb) returns void
language plpgsql volatile security invoker set search_path='' as $$declare source_id uuid;begin
 if p_actor is null or not private.transaction_json_keys(p_source,array['kind','id','revision'])
  or coalesce(p_source->>'kind','') not in ('cart','gift','subscription') or jsonb_typeof(p_source->'id') is distinct from 'string'
  or p_source->>'id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_source->'revision') is distinct from 'string' or char_length(p_source->>'revision') not between 1 and 256
  or p_source->>'revision'<>btrim(p_source->>'revision') or p_source->>'revision'~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_transaction_source';end if;
 source_id:=(p_source->>'id')::uuid;
 if p_source->>'kind'='cart' and source_id<>p_actor then raise insufficient_privilege using message='transaction_source_forbidden';end if;
 perform private.lock_goods_transaction_actor(p_actor);
 if p_source->>'kind'='cart' then perform pg_advisory_xact_lock(hashtextextended('cart:'||p_actor::text,0));
 else perform pg_advisory_xact_lock(hashtextextended('goods-transaction-source:'||(p_source->>'kind')||':'||source_id::text,0));end if;
end $$;

-- Seal all new tables and functions; the migration owner is the only direct
-- writer. Existing postgres-owned internal callers receive only EXECUTE.
do $$declare item regclass;fn regprocedure;begin
 foreach item in array array['private.goods_transaction_runtime'::regclass,'private.goods_volume_discount_versions'::regclass,
  'private.goods_delivery_versions'::regclass,'private.goods_transaction_configs'::regclass,
  'private.shipping_collect_contract_versions'::regclass,'private.shipping_collect_contracts'::regclass] loop
  execute format('alter table %s enable row level security',item);
  execute format('revoke all on %s from public,anon,authenticated,service_role',item);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname=any(array['transaction_json_keys','transaction_uint','transaction_draft_valid','transaction_instant_valid','goods_volume_terms_valid',
   'goods_delivery_quantity_terms_valid','goods_volume_input_valid','goods_delivery_input_valid','guard_goods_transaction_version',
   'goods_transaction_terms_document','shipping_collect_contract_input_valid','shipping_collect_contract_document','goods_quantity_delivery_fee',
   'calculate_goods_volume_discounts','allocate_transaction_amount','lock_goods_transaction_actor','lock_goods_transaction_source']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to postgres',fn);
  perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
revoke all on function public.admin_get_good_transaction_terms(text),public.admin_save_good_transaction_terms(text,integer,timestamptz,jsonb,jsonb,uuid,uuid),
 public.admin_get_shipping_collect_contract(uuid),public.admin_get_shipping_collect_readiness(uuid),public.admin_get_shipping_collect_operation(uuid,uuid),
 public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_good_transaction_terms(text),public.admin_save_good_transaction_terms(text,integer,timestamptz,jsonb,jsonb,uuid,uuid),
 public.admin_get_shipping_collect_contract(uuid),public.admin_get_shipping_collect_readiness(uuid),public.admin_get_shipping_collect_operation(uuid,uuid),
 public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_good_transaction_terms(text)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_good_transaction_terms(text,integer,timestamptz,jsonb,jsonb,uuid,uuid)'::regprocedure,'catalog.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_get_shipping_collect_contract(uuid)'::regprocedure,'platform.manage','read',true);
select private.register_operator_rpc_contract('public.admin_get_shipping_collect_readiness(uuid)'::regprocedure,'catalog.read','read',false);
select private.register_operator_rpc_contract('public.admin_get_shipping_collect_operation(uuid,uuid)'::regprocedure,'platform.manage','read',true);
select private.register_operator_rpc_contract('public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid)'::regprocedure,'platform.manage','manual',true);
notify pgrst,'reload schema';
