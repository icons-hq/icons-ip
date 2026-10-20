-- Reusable supported shipping settings. Rates and return addresses stay owned by
-- fulfillment_origins. Applying a template never edits an origin or an order.
create table public.shipping_settings_templates (
  id uuid primary key,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  revision integer not null default 1 check (revision > 0),
  enabled boolean not null default true,
  settings jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.shipping_settings_templates enable row level security;
revoke all on public.shipping_settings_templates from public,anon,authenticated,service_role;
grant select on public.shipping_settings_templates to authenticated;
create policy shipping_settings_templates_staff_read on public.shipping_settings_templates for select to authenticated
  using ((select public.is_staff()));

create table private.shipping_settings_applications (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.shipping_settings_applications enable row level security;
revoke all on private.shipping_settings_applications from public,anon,authenticated,service_role;

alter table public.goods
  add column shipping_settings_template_id uuid references public.shipping_settings_templates(id) on delete restrict,
  add column shipping_settings_template_revision integer,
  add column shipping_settings_snapshot jsonb,
  add constraint goods_shipping_settings_template_shape check (
    (shipping_settings_template_id is null and shipping_settings_template_revision is null and shipping_settings_snapshot is null)
    or (shipping_settings_template_id is not null and shipping_settings_template_revision is not null and shipping_settings_template_revision > 0 and shipping_settings_snapshot is not null and jsonb_typeof(shipping_settings_snapshot)='object')
  );
create index goods_shipping_settings_template_idx on public.goods(shipping_settings_template_id);

create function private.good_shipping_settings(good public.goods) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('originId',good.origin_id,'feeType',good.shipping_fee_type,'individualFee',good.individual_fee,
  'claimPolicy',jsonb_build_object('returnAllowed',good.claim_return_allowed,'exchangeAllowed',good.claim_exchange_allowed,
   'restrictionReason',good.claim_restriction_reason,'returnFee',good.claim_return_fee,
   'returnFreeShippingFee',good.claim_return_free_shipping_fee,'exchangeFee',good.claim_exchange_fee));
$$;
revoke all on function private.good_shipping_settings(public.goods) from public,anon,authenticated,service_role;

create function private.validate_shipping_settings(settings jsonb) returns void
language plpgsql set search_path='' as $$
declare field text; policy jsonb := settings->'claimPolicy';
begin
 if jsonb_typeof(settings) is distinct from 'object'
  or not (settings ?& array['originId','feeType','individualFee','claimPolicy'])
  or exists(select 1 from jsonb_object_keys(settings) k where k not in ('originId','feeType','individualFee','claimPolicy'))
  or jsonb_typeof(settings->'originId') is distinct from 'string'
  or coalesce(settings->>'originId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(settings->>'feeType','') not in ('policy','free','individual')
  or jsonb_typeof(settings->'individualFee') is distinct from 'number'
  or coalesce(settings->>'individualFee','') !~ '^[0-9]+$'
  or (settings->>'individualFee')::numeric > 1000000
  or jsonb_typeof(policy) is distinct from 'object'
 then raise invalid_parameter_value using message='invalid_shipping_settings'; end if;
 if not (policy ?& array['returnAllowed','exchangeAllowed','restrictionReason','returnFee','returnFreeShippingFee','exchangeFee'])
  or exists(select 1 from jsonb_object_keys(policy) k where k not in ('returnAllowed','exchangeAllowed','restrictionReason','returnFee','returnFreeShippingFee','exchangeFee'))
 then raise invalid_parameter_value using message='invalid_shipping_settings'; end if;
 foreach field in array array['returnAllowed','exchangeAllowed'] loop
  if jsonb_typeof(policy->field) not in ('boolean','null') then raise invalid_parameter_value using message='invalid_shipping_settings'; end if;
 end loop;
 foreach field in array array['returnFee','returnFreeShippingFee','exchangeFee'] loop
  if jsonb_typeof(policy->field)<>'null' and (jsonb_typeof(policy->field)<>'number' or policy->>field !~ '^[0-9]+$'
   or (policy->>field)::numeric>1000000) then raise invalid_parameter_value using message='invalid_shipping_settings'; end if;
 end loop;
 if jsonb_typeof(policy->'restrictionReason') not in ('string','null')
  or char_length(coalesce(policy->>'restrictionReason',''))>2000
  or private.has_disallowed_shipping_notice_control(policy->>'restrictionReason')
  or (policy->>'restrictionReason' is not null and (policy->>'restrictionReason'='' or policy->>'restrictionReason'<>btrim(policy->>'restrictionReason',E' \t\n\r')))
  or ((policy->>'returnAllowed'='false' or policy->>'exchangeAllowed'='false') and nullif(btrim(policy->>'restrictionReason',E' \t\n\r'),'') is null)
 then raise invalid_parameter_value using message='invalid_shipping_settings'; end if;
end $$;
revoke all on function private.validate_shipping_settings(jsonb) from public,anon,authenticated,service_role;

-- If an ordinary product edit changes a copied field, detach the association.
-- Last-applied values remain in the audit log; they are not shown as current.
create function private.detach_changed_shipping_settings() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.shipping_settings_template_id is not null
  and (new.shipping_settings_snapshot->'settings') is distinct from private.good_shipping_settings(new) then
  new.shipping_settings_template_id:=null;
  new.shipping_settings_template_revision:=null;
  new.shipping_settings_snapshot:=null;
 end if;
 if new.shipping_settings_snapshot is distinct from old.shipping_settings_snapshot
  or private.good_shipping_settings(new) is distinct from private.good_shipping_settings(old) then
  new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 end if;
 return new;
end $$;
revoke all on function private.detach_changed_shipping_settings() from public,anon,authenticated,service_role;
create trigger zz_goods_shipping_settings_detach before update on public.goods
 for each row execute function private.detach_changed_shipping_settings();

create function private.shipping_settings_template_json(template public.shipping_settings_templates) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',template.id,'name',template.name,'revision',template.revision,'enabled',template.enabled,
  'settings',template.settings,'createdAt',template.created_at,'updatedAt',template.updated_at);
$$;
revoke all on function private.shipping_settings_template_json(public.shipping_settings_templates) from public,anon,authenticated,service_role;

create function public.admin_save_shipping_settings_template(p_id uuid,p_expected_revision integer,p_name text,p_enabled boolean,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); previous public.shipping_settings_templates; saved public.shipping_settings_templates; normalized_settings jsonb; normalized_name text:=btrim(coalesce(p_name,''),E' \t\n\r');
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_enabled is null
  or char_length(normalized_name) not between 1 and 80 or normalized_name ~ '[[:cntrl:]]'
 then raise invalid_parameter_value using message='invalid_shipping_settings_template'; end if;
 perform private.validate_shipping_settings(p_settings);
 normalized_settings:=jsonb_set(p_settings,'{originId}',to_jsonb((p_settings->>'originId')::uuid));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shipping_settings_template:'||p_id,0));
 select * into previous from public.shipping_settings_templates where id=p_id for update;
 if (found and previous.revision<>p_expected_revision) or (not found and p_expected_revision<>0) then
  raise exception using errcode='PT409',message='shipping_settings_template_changed'; end if;
 perform id from public.fulfillment_origins where id=(p_settings->>'originId')::uuid and (not p_enabled or is_active) for share;
 if not found then raise check_violation using message='shipping_settings_origin_unavailable'; end if;
 insert into public.shipping_settings_templates(id,name,enabled,settings,created_by,updated_by)
  values(p_id,normalized_name,p_enabled,normalized_settings,actor,actor)
 on conflict(id) do update set name=excluded.name,enabled=excluded.enabled,settings=excluded.settings,
  revision=public.shipping_settings_templates.revision+1,updated_by=actor,updated_at=clock_timestamp()
 returning * into saved;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'catalog.shipping_settings_template.saved','shipping_settings_templates:'||p_id,
  jsonb_build_object('before',case when previous.id is null then null else private.shipping_settings_template_json(previous) end,
   'after',private.shipping_settings_template_json(saved)));
 return private.shipping_settings_template_json(saved);
end $$;
revoke all on function public.admin_save_shipping_settings_template(uuid,integer,text,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_shipping_settings_template(uuid,integer,text,boolean,jsonb) to authenticated;

create function public.admin_list_shipping_settings_templates(p_query text default '',p_state text default 'all',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 if p_query is null or char_length(p_query)>80 or p_state is null or p_state not in ('all','enabled','disabled') or p_page is null or p_page not between 1 and 100000
 then raise invalid_parameter_value using message='invalid_shipping_settings_filter'; end if;
 pattern:='%'||replace(replace(replace(btrim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with matched as (select * from public.shipping_settings_templates t where t.name ilike pattern escape E'\\'
  and (p_state='all' or t.enabled=(p_state='enabled'))), page as (select * from matched order by updated_at desc,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce(jsonb_agg(private.shipping_settings_template_json(page) order by page.updated_at desc,page.id),'[]')) into result from page;
 return result;
end $$;
revoke all on function public.admin_list_shipping_settings_templates(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_shipping_settings_templates(text,text,integer) to authenticated;

create function public.admin_search_goods_for_shipping_settings(p_query text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then raise invalid_parameter_value using message='invalid_shipping_settings_filter'; end if;
 pattern:='%'||replace(replace(replace(btrim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with matched as (select g.* from public.goods g where g.archived_at is null and (g.name ilike pattern escape E'\\' or g.code ilike pattern escape E'\\' or g.id ilike pattern escape E'\\')),
 page as (select * from matched order by updated_at desc,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from matched),'page',p_page,'pageSize',20,'rows',coalesce(jsonb_agg(jsonb_build_object(
  'id',page.id,'name',page.name,'code',page.code,'updatedAt',page.updated_at,'settings',private.good_shipping_settings(page),
  'templateId',page.shipping_settings_template_id,'templateRevision',page.shipping_settings_template_revision)
  order by page.updated_at desc,page.id),'[]')) into result from page;
 return result;
end $$;
revoke all on function public.admin_search_goods_for_shipping_settings(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_goods_for_shipping_settings(text,integer) to authenticated;

create function public.admin_preview_shipping_settings_template(p_template_id uuid,p_good_ids text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare template public.shipping_settings_templates; origin public.fulfillment_origins; rows jsonb; goods_count integer;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 if p_good_ids is null or cardinality(p_good_ids) not between 1 and 100 or array_position(p_good_ids,null) is not null
  or exists(select 1 from unnest(p_good_ids) id where char_length(id) not between 1 and 120)
  or (select count(distinct id) from unnest(p_good_ids) id)<>cardinality(p_good_ids)
 then raise invalid_parameter_value using message='invalid_shipping_settings_targets'; end if;
 select * into template from public.shipping_settings_templates where id=p_template_id and enabled;
 if not found then raise check_violation using message='shipping_settings_template_unavailable'; end if;
 select * into origin from public.fulfillment_origins where id=(template.settings->>'originId')::uuid and is_active;
 if not found then raise check_violation using message='shipping_settings_origin_unavailable'; end if;
 select count(*),jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'updatedAt',g.updated_at,
  'before',private.good_shipping_settings(g),'after',template.settings) order by g.id) into goods_count,rows
 from public.goods g where g.id=any(p_good_ids) and g.archived_at is null;
 if goods_count<>cardinality(p_good_ids) then raise check_violation using message='shipping_settings_goods_unavailable'; end if;
 return jsonb_build_object('template',private.shipping_settings_template_json(template),'goods',rows,
  'origin',jsonb_build_object('id',origin.id,'name',origin.name,'updatedAt',origin.updated_at,'baseFee',origin.base_fee,
   'freeThreshold',origin.free_threshold,'returnAddress',origin.return_address,'defaultCarrier',origin.default_carrier));
end $$;
revoke all on function public.admin_preview_shipping_settings_template(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_shipping_settings_template(uuid,text[]) to authenticated;

create function public.admin_apply_shipping_settings_template(p_request_id uuid,p_template_id uuid,p_expected_revision integer,
 p_expected_origin_updated_at timestamptz,p_goods jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); payload jsonb; existing private.shipping_settings_applications;
 template public.shipping_settings_templates; origin public.fulfillment_origins; good public.goods; previous jsonb; item jsonb;
 ids text[]; target_count integer; result jsonb; results jsonb:='[]';
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 if p_request_id is null or p_template_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_origin_updated_at is null
  or jsonb_typeof(p_goods) is distinct from 'array' then raise invalid_parameter_value using message='invalid_shipping_settings_application'; end if;
 if jsonb_array_length(p_goods) not between 1 and 100 then raise invalid_parameter_value using message='invalid_shipping_settings_targets'; end if;
 for item in select value from jsonb_array_elements(p_goods) loop
  if jsonb_typeof(item) is distinct from 'object' or not(item ?& array['id','updatedAt'])
   or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','updatedAt'))
   or jsonb_typeof(item->'id') is distinct from 'string' or char_length(item->>'id') not between 1 and 120
   or jsonb_typeof(item->'updatedAt') is distinct from 'string' or (item->>'updatedAt')::timestamptz is null
  then raise invalid_parameter_value using message='invalid_shipping_settings_targets'; end if;
 end loop;
 select array_agg(value->>'id' order by value->>'id'),count(distinct value->>'id') into ids,target_count from jsonb_array_elements(p_goods);
 if target_count<>jsonb_array_length(p_goods) then raise invalid_parameter_value using message='invalid_shipping_settings_targets'; end if;
 payload:=jsonb_build_object('templateId',p_template_id,'revision',p_expected_revision,'originUpdatedAt',p_expected_origin_updated_at,
  'goods',(select jsonb_agg(value order by value->>'id') from jsonb_array_elements(p_goods)));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shipping_settings_apply:'||p_request_id,0));
 select * into existing from private.shipping_settings_applications where id=p_request_id;
 if found then
  if existing.actor_id<>actor or existing.payload<>payload then raise exception using errcode='PT409',message='shipping_settings_request_conflict'; end if;
  return existing.result;
 end if;
 select * into template from public.shipping_settings_templates where id=p_template_id for share;
 if not found or not template.enabled then raise check_violation using message='shipping_settings_template_unavailable'; end if;
 if template.revision<>p_expected_revision then raise exception using errcode='PT409',message='shipping_settings_template_changed'; end if;
 -- Lock every target before inspecting/applying any copied field. A conflict
 -- aborts the statement so neither a prefix nor its audits can be committed.
 perform g.id from public.goods g where g.id=any(ids) order by g.id for update;
 if (select count(*) from public.goods g where g.id=any(ids) and g.archived_at is null)<>target_count then
  raise check_violation using message='shipping_settings_goods_unavailable'; end if;
 if exists(select 1 from jsonb_array_elements(p_goods) x join public.goods g on g.id=x->>'id'
  where g.updated_at is distinct from (x->>'updatedAt')::timestamptz) then
  raise exception using errcode='PT409',message='shipping_settings_goods_changed'; end if;
 select * into origin from public.fulfillment_origins where id=(template.settings->>'originId')::uuid for share;
 if not found or not origin.is_active then raise check_violation using message='shipping_settings_origin_unavailable'; end if;
 if origin.updated_at is distinct from p_expected_origin_updated_at then raise exception using errcode='PT409',message='shipping_settings_origin_changed'; end if;
 for good in select * from public.goods where id=any(ids) order by id loop
  previous:=private.good_shipping_settings(good);
  -- Reuse existing validation and the null/zero contract for claim guidance.
  perform public.admin_save_good_claim_policy(good.id,template.settings->'claimPolicy',good.updated_at);
  update public.goods set origin_id=origin.id,shipping_fee_type=template.settings->>'feeType',
   individual_fee=(template.settings->>'individualFee')::bigint,
   shipping_settings_template_id=template.id,shipping_settings_template_revision=template.revision,
   shipping_settings_snapshot=jsonb_build_object('templateId',template.id,'templateRevision',template.revision,'name',template.name,
    'settings',template.settings,'appliedAt',clock_timestamp(),'originUpdatedAt',origin.updated_at)
  where id=good.id returning * into good;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'catalog.good.shipping_settings_applied','goods:'||good.id,
   jsonb_build_object('requestId',p_request_id,'templateId',template.id,'templateRevision',template.revision,
    'before',previous,'after',private.good_shipping_settings(good),'originUpdatedAt',origin.updated_at));
  results:=results||jsonb_build_array(jsonb_build_object('id',good.id,'updatedAt',good.updated_at));
 end loop;
 result:=jsonb_build_object('requestId',p_request_id,'templateId',template.id,'templateRevision',template.revision,'appliedCount',target_count,'goods',results);
 insert into private.shipping_settings_applications(id,actor_id,payload,result) values(p_request_id,actor,payload,result);
 return result;
end $$;
revoke all on function public.admin_apply_shipping_settings_template(uuid,uuid,integer,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_apply_shipping_settings_template(uuid,uuid,integer,timestamptz,jsonb) to authenticated;
