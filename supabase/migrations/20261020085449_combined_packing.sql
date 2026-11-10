begin;
-- A physical package contains immutable original shipment references. No order,
-- item allocation, payment, prepaid shipping charge or COD amount is merged.
create table private.shipment_packs (
 id uuid primary key,revision bigint not null default 1,created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 released_at timestamptz,release_reason text,check(revision>0)
);
create table private.shipment_pack_members (
 pack_id uuid not null references private.shipment_packs(id),shipment_id uuid not null references public.order_shipments(id),
 identity_digest text not null,released_at timestamptz,primary key(pack_id,shipment_id)
);
create unique index shipment_pack_one_active on private.shipment_pack_members(shipment_id) where released_at is null;
create table private.shipment_pack_events (
 id uuid primary key,pack_id uuid not null references private.shipment_packs(id),actor_id uuid not null,session_id uuid not null,
 kind text not null check(kind in('create','release')),request jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table private.shipment_packs enable row level security;
alter table private.shipment_pack_members enable row level security;
alter table private.shipment_pack_events enable row level security;
revoke all on private.shipment_packs,private.shipment_pack_members,private.shipment_pack_events from public,anon,authenticated,service_role;

create function private.shipment_pack_id(p_shipment uuid) returns uuid language sql stable security definer set search_path='' as $$
 select pack_id from private.shipment_pack_members where shipment_id=p_shipment and released_at is null;
$$;
create function private.shipment_pack_scope(p_ids uuid[]) returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct id order by id),'{}'::uuid[]) from (
 select unnest(p_ids) id union select m.shipment_id from private.shipment_pack_members m where m.released_at is null and m.pack_id in(
  select pack_id from private.shipment_pack_members where shipment_id=any(p_ids) and released_at is null)) scope;
$$;
create function private.lock_shipment_pack_scope(p_ids uuid[]) returns uuid[] language plpgsql security definer set search_path='' as $$
declare ids uuid[];begin
 if cardinality(p_ids) is null or cardinality(p_ids) not between 1 and 1000 or array_position(p_ids,null) is not null then raise invalid_parameter_value;end if;
 ids:=private.shipment_pack_scope(p_ids);
 -- Resolve before any order lock. If membership changed while waiting, abort;
 -- never append a new, lower order key after acquiring part of the lock set.
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s where s.order_id=o.id and s.id=any(ids)) order by o.id for update;
 if ids is distinct from private.shipment_pack_scope(p_ids) then raise sqlstate 'PT409' using message='shipment_pack_changed';end if;
 perform id from public.order_shipments where id=any(ids) order by id for update;
 if (select count(*) from public.order_shipments where id=any(ids))<>cardinality(ids) then raise no_data_found using message='shipment_not_found';end if;
 return ids;
end $$;
create function private.shipment_pack_identity(p_shipment uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('buyer',o.user_id,'recipientSubject',coalesce(d.recipient_id,o.user_id),'origin',s.origin_id,
 'address',jsonb_build_object('recipientName',btrim(a->>'recipientName'),'phone',regexp_replace(a->>'phone','[[:space:]-]','','g'),
 'postalCode',btrim(a->>'postalCode'),'address1',btrim(a->>'address1'),'address2',coalesce(btrim(a->>'address2'),'')),
 'gift',exists(select 1 from private.gift_intents where order_id=o.id),
 'collector',(select value->'collector' from jsonb_array_elements(t.original_receipt#>'{display,shipping}') where value->>'originId'=s.origin_id::text))
 from public.order_shipments s join public.orders o on o.id=s.order_id left join private.order_delivery_private_snapshots d on d.order_id=o.id
 left join private.order_goods_transactions t on t.order_id=o.id cross join lateral(select private.operational_order_address(o.id) a)address where s.id=p_shipment;
$$;
create function private.shipment_pack_ready(p_shipment uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare s public.order_shipments;o public.orders;a jsonb;begin
 select * into s from public.order_shipments where id=p_shipment;
 select * into o from public.orders where id=s.order_id;a:=private.shipment_pack_identity(p_shipment)->'address';
 if s.id is null or s.delivery_method<>'parcel' or s.status<>'ready' or o.status not in('confirmed','shipping')
  or s.shipped_at is not null or not private.shipment_preorder_allocation_ready(s.id)
  or coalesce(a->>'recipientName','')='' or coalesce(a->>'address1','')='' or coalesce(a->>'postalCode','')!~'^[0-9]{5}$'
  or coalesce(a->>'phone','')!~'^[0-9]{8,15}$'
  or exists(select 1 from private.account_action_fences where subject_user_id=any(private.contact_parties(o.id)))
  or exists(select 1 from public.order_cancellation_requests where order_id=o.id and status in('requested','processing','needs_review'))
  or exists(select 1 from public.order_cancellation_claims where order_id=o.id)
  or not exists(select 1 from public.payments where purpose='order' and ref_id=o.id and user_id=o.user_id and status='paid') then return false;end if;
 return true;
end $$;
create function private.assert_shipment_pack_basis(p_ids uuid[]) returns void language plpgsql stable security definer set search_path='' as $$begin
 if exists(select 1 from private.shipment_pack_members m where m.shipment_id=any(p_ids) and m.released_at is null
  and m.identity_digest<>encode(extensions.digest(private.shipment_pack_identity(m.shipment_id)::text,'sha256'),'hex')) then
  raise sqlstate 'PT409' using message='shipment_pack_address_changed';end if;
end $$;
create function private.assert_whole_shipment_packs(p_ids uuid[]) returns void language plpgsql stable security definer set search_path='' as $$begin
 if private.shipment_pack_scope(p_ids) is distinct from (select array_agg(distinct id order by id) from unnest(p_ids)id) then
  raise check_violation using message='shipment_pack_selection_required';end if;
 perform private.assert_shipment_pack_basis(p_ids);
end $$;
create function private.shipment_pack_summary(p_shipment uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'revision',p.revision,'count',count(*),'shipmentIds',jsonb_agg(m.shipment_id order by m.shipment_id),
 'collectFee',sum(s.shipping_collect_fee),'canRelease',bool_and(s.status='ready' and s.exported_at is null and s.shipped_at is null))
 from private.shipment_packs p join private.shipment_pack_members m on m.pack_id=p.id and m.released_at is null
 join public.order_shipments s on s.id=m.shipment_id where p.id=private.shipment_pack_id(p_shipment) group by p.id;
$$;
create function private.shipment_pack_document(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ids uuid[]:=private.shipment_pack_scope(p_ids);rows jsonb;stamp text;can_create boolean;begin
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'orderId',s.order_id,'originName',s.origin_name_snapshot,'buyerName',coalesce(p.nickname,'구매자'),
 'recipientName',private.operational_order_address(o.id)->>'recipientName','status',s.status,'exportedAt',s.exported_at,'updatedAt',s.updated_at,
 'orderUpdatedAt',o.updated_at,'identity',encode(extensions.digest(private.shipment_pack_identity(s.id)::text,'sha256'),'hex'),
 'shippingFee',s.shipping_fee,'collectFee',s.shipping_collect_fee,'ready',private.shipment_pack_ready(s.id),'pack',private.shipment_pack_summary(s.id)) order by s.id),'[]') into rows
 from public.order_shipments s join public.orders o on o.id=s.order_id join public.profiles p on p.id=o.user_id where s.id=any(ids);
 stamp:=encode(extensions.digest(rows::text,'sha256'),'hex');
 select cardinality(p_ids) between 2 and 100 and cardinality(ids)=cardinality(p_ids) and jsonb_array_length(rows)=cardinality(ids)
  and bool_and(value->>'ready'='true' and value->'exportedAt'='null'::jsonb and value->'pack'='null'::jsonb)
  and count(distinct value->>'identity')=1 into can_create from jsonb_array_elements(rows);
 return jsonb_build_object('version',stamp,'canCreate',coalesce(can_create,false),'rows',(select coalesce(jsonb_agg(value-'identity'-'orderUpdatedAt'),'[]') from jsonb_array_elements(rows)));
end $$;
create function public.admin_get_shipment_packs(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform private.require_operator_capability('sales.manage',false);
 if cardinality(p_ids) is null or cardinality(p_ids) not between 1 and 1000 or array_position(p_ids,null) is not null then raise invalid_parameter_value;end if;
 return private.shipment_pack_document(p_ids);
end $$;
create function public.admin_change_shipment_pack(p_ids uuid[],p_kind text,p_version text,p_reason text,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ids uuid[];parties uuid[];e private.shipment_pack_events;request jsonb;document jsonb;pack_key uuid;result jsonb;begin
 perform private.purchase_confirmation_identity(p_actor,p_session,true);
 if cardinality(p_ids) is null or cardinality(p_ids) not between 1 and 100 or array_position(p_ids,null) is not null
  or(select count(distinct id) from unnest(p_ids)id)<>cardinality(p_ids) or p_kind is null or p_kind not in('create','release')
  or p_version is null or p_version!~'^[a-f0-9]{64}$' or p_operation is null or p_reason is null or char_length(btrim(p_reason)) not between 2 and 500 or p_reason~'[[:cntrl:]]' then raise invalid_parameter_value;end if;
 select array_agg(id order by id) into p_ids from unnest(p_ids)id;
 select array_agg(distinct subject) into parties from public.order_shipments s cross join lateral unnest(private.contact_parties(s.order_id))subject where s.id=any(private.shipment_pack_scope(p_ids));
 perform private.gift_lock_subjects(array_append(parties,p_actor));perform private.lock_operator_subjects(array_append(parties,p_actor));
 if exists(select 1 from private.account_action_fences where subject_user_id=p_actor) then raise insufficient_privilege;end if;
 perform private.require_operator_capability('sales.manage',false);
 perform pg_advisory_xact_lock(hashtextextended('shipment-pack:'||p_operation,0));
 request:=jsonb_build_object('ids',to_jsonb(p_ids),'kind',p_kind,'version',p_version,'reason',btrim(p_reason));
 select * into e from private.shipment_pack_events where id=p_operation;
 if found then
  if e.actor_id<>p_actor or e.session_id<>p_session or e.request<>request then raise sqlstate 'PT409' using message='shipment_pack_conflict';end if;return e.result;end if;
 ids:=private.lock_shipment_pack_scope(p_ids);document:=private.shipment_pack_document(p_ids);
 if document->>'version'<>p_version then raise sqlstate 'PT409' using message='shipment_pack_changed';end if;
 if p_kind='create' then
  if document->>'canCreate'<>'true' then raise check_violation using message='shipment_pack_ineligible';end if;
  pack_key:=p_operation;insert into private.shipment_packs(id,created_by) values(pack_key,p_actor);
  insert into private.shipment_pack_members(pack_id,shipment_id,identity_digest) select pack_key,id,encode(extensions.digest(private.shipment_pack_identity(id)::text,'sha256'),'hex') from unnest(ids)id;
 else
  select private.shipment_pack_id(p_ids[1]) into pack_key;
  if pack_key is null or exists(select 1 from unnest(ids)id where private.shipment_pack_id(id) is distinct from pack_key)
   or not coalesce((private.shipment_pack_summary(p_ids[1])->>'canRelease')::boolean,false) then raise check_violation using message='shipment_pack_release_blocked';end if;
  update private.shipment_packs set released_at=clock_timestamp(),release_reason=btrim(p_reason),revision=revision+1 where id=pack_key;
  update private.shipment_pack_members set released_at=clock_timestamp() where pack_id=pack_key and released_at is null;
 end if;
 -- Membership changes invalidate a file prepared just before this transaction.
 update public.order_shipments set updated_at=clock_timestamp() where id=any(ids);
 result:=jsonb_build_object('packId',pack_key,'kind',p_kind,'shipmentIds',to_jsonb(ids));
 insert into private.shipment_pack_events(id,pack_id,actor_id,session_id,kind,request,result) values(p_operation,pack_key,p_actor,p_session,p_kind,request,result);
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'admin.shipment.pack_'||p_kind,pack_key::text,jsonb_build_object('operationId',p_operation,'shipmentIds',to_jsonb(ids),'reason',btrim(p_reason)));
 return result;
end $$;

create function private.change_packed_shipments(p_shipment uuid,p_status text,p_carrier text,p_tracking text,p_tracking_only boolean) returns void
language plpgsql security definer set search_path='' as $$
declare ids uuid[];id uuid;begin
 ids:=private.lock_shipment_pack_scope(array[p_shipment]);
 if exists(select 1 from public.order_shipments where order_shipments.id=any(ids) and delivery_method<>'parcel') then raise check_violation using message='delivery_method_evidence_required';end if;
 if not p_tracking_only and p_status='shipping' then
  perform private.assert_shipment_pack_basis(ids);
  if cardinality(ids)>1 and exists(select 1 from unnest(ids)sid where not private.shipment_pack_ready(sid)) then raise check_violation using message='shipment_pack_ineligible';end if;
 end if;
 foreach id in array ids loop
  if p_tracking_only then perform private.admin_update_shipment_tracking_before_delivery_methods(id,p_carrier,p_tracking);
  else perform private.admin_update_shipment_status_before_delivery_methods(id,p_status,p_carrier,p_tracking);end if;
 end loop;
end $$;
create or replace function public.admin_update_shipment_status(p_shipment_id uuid,p_status text,p_carrier text,p_tracking_number text) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('sales.manage',false);
 perform private.change_packed_shipments(p_shipment_id,p_status,p_carrier,p_tracking_number,false);
end $$;
create or replace function public.admin_update_shipment_tracking(p_shipment_id uuid,p_carrier text,p_tracking_number text) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('sales.manage',false);
 perform private.change_packed_shipments(p_shipment_id,null,p_carrier,p_tracking_number,true);
end $$;

-- Files may contain several rows for the same physical package. Resolve all
-- valid references before locks and reject contradictory package tracking before
-- the first per-row savepoint can dispatch anything.
create function private.prepare_pack_tracking_batch(p_rows jsonb,p_origin uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare row_value jsonb;sid uuid;ids uuid[]:='{}';pack_key uuid;seen jsonb:='{}';assignment jsonb;carrier text;begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_tracking_batch';end if;
 if p_origin is not null then select default_carrier into carrier from public.fulfillment_origins where id=p_origin;end if;
 for row_value in select value from jsonb_array_elements(p_rows) loop
  sid:=null;
  begin
   if p_origin is null then sid:=private.resolve_shipment_reference(row_value->>'reference');
   else select id into strict sid from public.order_shipments where order_id=(row_value->>'reference')::uuid and origin_id=p_origin;end if;
  exception when others then sid:=null;end;
  if sid is not null then ids:=array_append(ids,sid);end if;
 end loop;
 if cardinality(ids)>0 then perform private.lock_shipment_pack_scope(ids);end if;
 for row_value in select value from jsonb_array_elements(p_rows) loop
  sid:=null;
  begin
   if p_origin is null then sid:=private.resolve_shipment_reference(row_value->>'reference');
   else select id into strict sid from public.order_shipments where order_id=(row_value->>'reference')::uuid and origin_id=p_origin;end if;
  exception when others then sid:=null;end;
  pack_key:=private.shipment_pack_id(sid);
  if pack_key is not null then
   assignment:=jsonb_build_array(case when p_origin is null then btrim(row_value->>'carrier') else carrier end,upper(regexp_replace(btrim(row_value->>'trackingNumber'),'[[:space:]-]','','g')));
   if seen ? pack_key::text and seen->pack_key::text<>assignment then raise check_violation using message='shipment_pack_tracking_conflict';end if;
   seen:=seen||jsonb_build_object(pack_key::text,assignment);
  end if;
 end loop;
end $$;
CREATE OR REPLACE FUNCTION public.admin_shipment_export(target_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare result jsonb;begin
 if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 if exists(select 1 from public.order_shipments where id=any(target_ids) and delivery_method<>'parcel') then
  raise check_violation using message='delivery_method_evidence_required';end if;
 perform private.assert_whole_shipment_packs(target_ids);
 result:=private.admin_shipment_export_before_delivery_methods(target_ids);
 return jsonb_set(result,'{shipments}',(select jsonb_agg(entry.value||jsonb_build_object(
  'isGift',exists(select 1 from private.gift_intents g where g.order_id=s.order_id),
  'shippingCollectFee',s.shipping_collect_fee,'pack',private.shipment_pack_summary(s.id),
  'collector',(select group_value->'collector' from jsonb_array_elements(t.original_receipt#>'{display,shipping}') group_value
   where group_value->>'originId'=s.origin_id::text)) order by entry.ordinality)
  from jsonb_array_elements(result->'shipments') with ordinality entry(value,ordinality)
  join public.order_shipments s on s.id=(entry.value->>'id')::uuid
  left join private.order_goods_transactions t on t.order_id=s.order_id));
end $function$;

CREATE OR REPLACE FUNCTION public.admin_mark_shipments_exported(target_versions jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare row_value record;shipment public.order_shipments;total integer:=0;actor uuid:=(select auth.uid());
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if jsonb_typeof(target_versions) is distinct from 'array' or jsonb_array_length(target_versions) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_export_selection';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(target_versions))<>jsonb_array_length(target_versions) then raise invalid_parameter_value using message='invalid_export_selection';end if;
 perform private.lock_shipment_pack_scope(array(select (value->>'id')::uuid from jsonb_array_elements(target_versions)));
 perform private.assert_whole_shipment_packs(array(select (value->>'id')::uuid from jsonb_array_elements(target_versions)));
 -- Global order sequence matches all other shipment mutations.
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s join jsonb_to_recordset(target_versions) v(id uuid,"updatedAt" timestamptz) on v.id=s.id where s.order_id=o.id) order by o.id for update;
 for row_value in select * from jsonb_to_recordset(target_versions) as v(id uuid,"updatedAt" timestamptz) order by id loop
  select * into shipment from public.order_shipments where id=row_value.id for update;
  if not found or shipment.status<>'ready' or row_value."updatedAt" is null or shipment.updated_at<>row_value."updatedAt"
    or not exists(select 1 from public.orders where id=shipment.order_id and status in ('confirmed','shipping')) then raise sqlstate 'PT409' using message='shipment_changed';end if;
  perform private.assert_order_dispatch_allowed(shipment.order_id);
  update public.order_shipments set exported_at=clock_timestamp(),exported_by=actor,updated_at=clock_timestamp() where id=shipment.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.exported','order:'||shipment.order_id,jsonb_build_object('shipmentId',shipment.id,'originName',shipment.origin_name_snapshot));
  total:=total+1;
 end loop;
 return total;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_complete_shipments(target_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare shipment_key uuid;results jsonb:='[]'::jsonb;
begin
  perform private.require_operator_capability('sales.manage',false);

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if cardinality(target_ids) is null or cardinality(target_ids) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_shipment_selection';end if;
 perform private.lock_shipment_pack_scope(target_ids);
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s where s.order_id=o.id and s.id=any(target_ids)) order by o.id for update;
 for shipment_key in select distinct id from unnest(target_ids) id order by id loop
  begin
   perform public.admin_update_shipment_status(shipment_key,'delivered',null,null);
   results:=results||jsonb_build_array(jsonb_build_object('id',shipment_key,'ok',true));
  exception when others then results:=results||jsonb_build_array(jsonb_build_object('id',shipment_key,'ok',false,'error',sqlerrm));end;
 end loop;
 return results;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_import_shipment_tracking(p_reference text, p_carrier text, p_tracking_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare reference_key uuid;shipment_key uuid;shipment public.order_shipments;changed boolean;
begin
  perform private.require_operator_capability('sales.manage',false);

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 reference_key:=btrim(p_reference)::uuid;
 select id into shipment_key from public.order_shipments where id=reference_key;
 if shipment_key is null then shipment_key:=private.single_order_shipment(reference_key);end if;
 perform private.lock_shipment_pack_scope(array[shipment_key]);
 perform o.id from public.orders o join public.order_shipments s on s.order_id=o.id where s.id=shipment_key for update of o;
 select * into shipment from public.order_shipments where id=shipment_key for update;
 changed:=shipment.status='ready';
 if changed then perform public.admin_update_shipment_status(shipment.id,'shipping',p_carrier,p_tracking_number);
 else perform public.admin_update_shipment_tracking(shipment.id,p_carrier,p_tracking_number);end if;
 return jsonb_build_object('shipmentId',shipment.id,'orderId',shipment.order_id,'dispatched',changed);
end $function$;

CREATE OR REPLACE FUNCTION public.admin_import_shipment_tracking_batch(target_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input jsonb;shipment_key uuid;completed jsonb;results jsonb:='[]'::jsonb;seen uuid[]:='{}'::uuid[];
begin
  perform private.require_operator_capability('sales.manage',false);

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if jsonb_typeof(target_rows) is distinct from 'array' or jsonb_array_length(target_rows) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_tracking_batch';end if;
 perform private.prepare_pack_tracking_batch(target_rows);
 -- Hold all existing target order locks in one stable order before per-row savepoints.
 -- Different files may list the same warehouses in opposite orders.
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s
   where s.order_id=o.id and exists(select 1 from jsonb_array_elements(target_rows) row_value
     where lower(btrim(row_value->>'reference')) in (s.id::text,o.id::text,right(s.id::text,8),right(o.id::text,8)))) order by o.id for update;
 for input in select value from jsonb_array_elements(target_rows) loop
  begin
   if jsonb_typeof(input) is distinct from 'object' then raise invalid_parameter_value using message='invalid_tracking_row';end if;
   shipment_key:=private.resolve_shipment_reference(input->>'reference');
   if shipment_key=any(seen) then raise check_violation using message='duplicate_shipment_reference';end if;
   completed:=public.admin_import_shipment_tracking(shipment_key::text,input->>'carrier',input->>'trackingNumber');
   seen:=array_append(seen,shipment_key);
   results:=results||jsonb_build_array(completed||jsonb_build_object('line',input->'line','reference',input->>'reference','ok',true));
  exception when others then
   results:=results||jsonb_build_array(jsonb_build_object('line',input->'line','reference',input->>'reference','ok',false,'error',sqlerrm));
  end;
 end loop;
 return results;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_import_warehouse_tracking_batch(target_origin_id uuid, target_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  input jsonb;
  normalized jsonb := '[]';
  outcomes jsonb := '{}';
  results jsonb := '[]';
  reference_value text;
  order_key uuid;
  shipment_key uuid;
  tracking_value text;
  row_error text;
  group_error text;
  group_row record;
  matches integer;
  origin public.fulfillment_origins;
  completed jsonb;
  outcome jsonb;
  seen uuid[] := '{}';
begin
  perform private.require_operator_capability('sales.manage',false);

  if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message='staff required';
  end if;
  if jsonb_typeof(target_rows) is distinct from 'array' then
    raise invalid_parameter_value using message='invalid_tracking_batch';
  end if;
  if jsonb_array_length(target_rows) not between 1 and 1000 then
    raise invalid_parameter_value using message='invalid_tracking_batch';
  end if;
  if target_origin_id is null then
    raise invalid_parameter_value using message='warehouse_origin_required';
  end if;

  for input in select value from jsonb_array_elements(target_rows) loop
    reference_value := null;
    order_key := null;
    tracking_value := null;
    row_error := null;
    begin
      if jsonb_typeof(input) is distinct from 'object' then
        raise invalid_parameter_value using message='invalid_tracking_row';
      end if;
      reference_value := btrim(input->>'reference');
      if jsonb_typeof(input->'reference') is distinct from 'string'
        or reference_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise invalid_parameter_value using message='invalid_warehouse_order_reference';
      end if;
      order_key := reference_value::uuid;
      -- Keep the parsed order on row errors so an invalid sibling cannot let the
      -- first valid row write half of the same shipment group.
      if exists(select 1 from jsonb_object_keys(input) key where key not in ('line','reference','trackingNumber'))
        or jsonb_typeof(input->'line') is distinct from 'number'
        or (input->>'line') !~ '^[0-9]+$'
        or (input->>'line')::numeric not between 1 and 2147483647
        or jsonb_typeof(input->'trackingNumber') is distinct from 'string' then
        raise invalid_parameter_value using message='invalid_tracking_row';
      end if;
      tracking_value := upper(regexp_replace(btrim(input->>'trackingNumber'),'[[:space:]-]','','g'));
      if tracking_value !~ '^[A-Z0-9]{8,30}$' then
        raise check_violation using message='invalid_tracking_input';
      end if;
    exception when others then row_error := sqlerrm;
    end;
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'line',input->'line','reference',reference_value,'orderId',order_key,
      'trackingNumber',tracking_value,'error',row_error));
  end loop;

  perform private.prepare_pack_tracking_batch(target_rows,target_origin_id);
  -- Same global order->origin->shipment lock ordering as order/dispatch writers.
  -- Lock every existing order before per-shipment savepoints, including groups
  -- with invalid tracking data. Opposite file row orders cannot deadlock.
  perform o.id from public.orders o where exists(
    select 1 from jsonb_array_elements(normalized) row_value
    where row_value->>'orderId'=o.id::text
  ) order by o.id for update;
  select * into origin from public.fulfillment_origins where id=target_origin_id for share;
  if not found then raise no_data_found using message='warehouse_origin_not_found'; end if;
  if not origin.is_active then raise check_violation using message='warehouse_origin_inactive'; end if;
  if origin.export_template<>'wms_csv' then raise check_violation using message='warehouse_template_required'; end if;
  if origin.default_carrier is null then raise check_violation using message='warehouse_carrier_required'; end if;
  perform code from public.shipping_carriers where code=origin.default_carrier and is_active for share;
  if not found then raise check_violation using message='inactive_shipping_carrier'; end if;

  for group_row in
    select (value->>'orderId')::uuid order_id, jsonb_agg(value) rows
    from jsonb_array_elements(normalized)
    where value->>'orderId' is not null
    group by value->>'orderId' order by value->>'orderId'
  loop
    begin
      select value->>'error' into group_error from jsonb_array_elements(group_row.rows)
        where value->>'error' is not null limit 1;
      if group_error is not null then raise check_violation using message=group_error; end if;
      if (select count(distinct value->>'trackingNumber') from jsonb_array_elements(group_row.rows))<>1 then
        raise check_violation using message='conflicting_shipment_tracking';
      end if;
      select count(*),(array_agg(id))[1] into matches,shipment_key
        from public.order_shipments where order_id=group_row.order_id and origin_id=origin.id;
      if matches=0 then raise no_data_found using message='shipment_not_found'; end if;
      if matches<>1 then raise check_violation using message='shipment_reference_required'; end if;
      tracking_value := group_row.rows->0->>'trackingNumber';
      completed := public.admin_import_shipment_tracking(shipment_key::text,origin.default_carrier,tracking_value);
      outcomes := outcomes || jsonb_build_object(group_row.order_id::text,completed||jsonb_build_object('ok',true));
    exception when others then
      outcomes := outcomes || jsonb_build_object(group_row.order_id::text,jsonb_build_object('ok',false,'error',sqlerrm));
    end;
  end loop;

  -- Return one outcome per original row, in file order. Only the first successful
  -- row represents the mutation; duplicate rows must not count or enqueue twice.
  for input in select value from jsonb_array_elements(normalized) loop
    order_key := (input->>'orderId')::uuid;
    outcome := case when order_key is null then jsonb_build_object('ok',false,'error',input->>'error')
      else outcomes->order_key::text end;
    if outcome->>'ok'='true' then
      if order_key=any(seen) then
        outcome := outcome || jsonb_build_object('duplicate',true,'dispatched',false);
      else
        seen := array_append(seen,order_key);
        outcome := outcome || jsonb_build_object('duplicate',false);
      end if;
    end if;
    results := results || jsonb_build_array(outcome||jsonb_build_object('line',input->'line','reference',input->>'reference'));
  end loop;
  return results;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_update_order_status(p_order_id uuid, p_status order_status, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());purchase public.orders;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if p_status in ('shipping','delivered') then
   perform public.admin_update_shipment_status(private.single_order_shipment(p_order_id),p_status::text,p_carrier,p_tracking_number);return;
 end if;
 select * into purchase from public.orders where id=p_order_id for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 perform id from public.order_shipments where order_id=p_order_id order by id for update;
 if p_status is null or p_status not in ('confirmed','shipping','delivered') then raise check_violation using message='invalid_order_status';end if;
 if p_status in ('shipping','delivered') then
   perform public.admin_update_shipment_status(private.single_order_shipment(p_order_id),p_status::text,p_carrier,p_tracking_number);return;
 end if;
 if purchase.status='confirmed' then return;end if;
 if purchase.status<>'paid' then raise exception using message='invalid_order_transition';end if;
 perform private.assert_order_dispatch_allowed(p_order_id);
 update public.orders set status='confirmed',confirmed_at=clock_timestamp() where id=p_order_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.status_updated','order:'||p_order_id,
  jsonb_build_object('from',purchase.status,'to','confirmed'));
end $function$;

CREATE OR REPLACE FUNCTION public.admin_update_order_tracking(p_order_id uuid, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_operator_capability('sales.manage',false);

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 perform private.lock_shipment_pack_scope(array[private.single_order_shipment(p_order_id)]);
 perform id from public.orders where id=p_order_id for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 perform public.admin_update_shipment_tracking(private.single_order_shipment(p_order_id),p_carrier,p_tracking_number);
end $function$;

do $$declare sig text;begin
 foreach sig in array array[
 'private.shipment_pack_id(uuid)','private.shipment_pack_scope(uuid[])','private.lock_shipment_pack_scope(uuid[])',
 'private.shipment_pack_identity(uuid)','private.shipment_pack_ready(uuid)','private.assert_shipment_pack_basis(uuid[])',
 'private.assert_whole_shipment_packs(uuid[])','private.shipment_pack_summary(uuid)','private.shipment_pack_document(uuid[])',
 'private.change_packed_shipments(uuid,text,text,text,boolean)','private.prepare_pack_tracking_batch(jsonb,uuid)',
 'public.admin_get_shipment_packs(uuid[])','public.admin_change_shipment_pack(uuid[],text,text,text,uuid,uuid,uuid)'] loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',sig);
 if sig like 'private.%' then perform private.register_operator_internal_contract(sig::regprocedure);
 else execute format('grant execute on function %s to authenticated',sig);perform private.register_operator_rpc_contract(sig::regprocedure,'sales.manage',case when sig like 'public.admin_get_%' then 'read' else 'write' end,false);end if;
 end loop;
end $$;
commit;
