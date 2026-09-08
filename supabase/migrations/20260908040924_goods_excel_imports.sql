-- #425/#445: actor-private uploads and preview plans; each product/option group
-- commits atomically and idempotently through the current admin_save_good seam.
create table public.admin_goods_imports (
 id uuid primary key default extensions.gen_random_uuid(),
 actor_id uuid not null references auth.users(id) on delete cascade,
 state text not null default 'uploading' check(state in ('uploading','ready','complete')),
 workbook_name text not null default 'goods.xlsx',
 has_images boolean not null default false,
 plan jsonb not null default '[]' check(jsonb_typeof(plan)='array' and jsonb_array_length(plan)<=500),
 prepared_images jsonb not null default '{}' check(jsonb_typeof(prepared_images)='object'),
 results jsonb not null default '{}' check(jsonb_typeof(results)='object'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours'
);
create index admin_goods_imports_expiry_idx on public.admin_goods_imports(expires_at);
alter table public.admin_goods_imports enable row level security;
revoke all on public.admin_goods_imports from public,anon,authenticated,service_role;
grant select on public.admin_goods_imports to authenticated;
grant select,insert,update,delete on public.admin_goods_imports to service_role;
create policy admin_goods_imports_owner_read on public.admin_goods_imports for select to authenticated
 using(actor_id=(select auth.uid()) and (select public.is_staff()));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('admin-goods-imports','admin-goods-imports',false,52428800,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip','application/octet-stream'])
 on conflict(id) do nothing;
create policy admin_goods_import_files_read on storage.objects for select to authenticated using(
 bucket_id='admin-goods-imports' and (select public.is_staff()) and exists(select 1 from public.admin_goods_imports batch
 where batch.actor_id=(select auth.uid()) and batch.expires_at>now() and name in (batch.actor_id::text||'/'||batch.id::text||'/workbook.xlsx',batch.actor_id::text||'/'||batch.id::text||'/images.zip'))
);
create policy admin_goods_import_files_insert on storage.objects for insert to authenticated with check(
 bucket_id='admin-goods-imports' and (select public.is_staff()) and exists(select 1 from public.admin_goods_imports batch
 where batch.actor_id=(select auth.uid()) and batch.state='uploading' and batch.expires_at>now()
 and (name=batch.actor_id::text||'/'||batch.id::text||'/workbook.xlsx' or (batch.has_images and name=batch.actor_id::text||'/'||batch.id::text||'/images.zip')))
);
create policy admin_goods_import_files_delete on storage.objects for delete to authenticated using(
 bucket_id='admin-goods-imports' and (select public.is_staff()) and exists(select 1 from public.admin_goods_imports batch
 where batch.actor_id=(select auth.uid()) and name in (batch.actor_id::text||'/'||batch.id::text||'/workbook.xlsx',batch.actor_id::text||'/'||batch.id::text||'/images.zip'))
);
create function private.goods_import_fingerprint(target_id text)
returns text language sql stable security definer set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object(
  'good',to_jsonb(good)-'stock_qty'-'stock'-'updated_at',
  'variants',(select coalesce(jsonb_agg(to_jsonb(variant)-'stock_qty'-'updated_at' order by variant.id),'[]')
    from public.goods_variants variant where variant.good_id=good.id)
 )::text,'UTF8'),'sha256'),'hex') from public.goods good where good.id=target_id;
$$;
revoke all on function private.goods_import_fingerprint(text) from public,anon,authenticated,service_role;
create function public.admin_goods_import_records(target_codes text[] default '{}',target_ids text[] default '{}')
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 if coalesce(cardinality(target_codes),0)+coalesce(cardinality(target_ids),0)>500 then raise invalid_parameter_value using message='import_record_limit'; end if;
 return query select jsonb_build_object('good',to_jsonb(good),'fingerprint',private.goods_import_fingerprint(good.id),
  'variants',(select coalesce(jsonb_agg(to_jsonb(variant) order by variant.is_default desc,variant.sort_order,variant.id),'[]') from public.goods_variants variant where variant.good_id=good.id))
  from public.goods good where good.code=any(target_codes) or good.id=any(target_ids) order by good.id;
end $$;
revoke all on function public.admin_goods_import_records(text[],text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_import_records(text[],text[]) to authenticated;
create function public.admin_commit_goods_import_group(target_batch uuid,target_index integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch public.admin_goods_imports; entry jsonb; target jsonb; images jsonb; saved jsonb; result jsonb; current_good public.goods; error_code text; error_message text;
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 select * into batch from public.admin_goods_imports where id=target_batch and actor_id=auth.uid() for update;
 if not found then raise insufficient_privilege using message='import_not_found'; end if;
 if batch.expires_at<=now() then raise check_violation using message='import_expired'; end if;
 if batch.state not in ('ready','complete') or target_index<0 or target_index>=jsonb_array_length(batch.plan) then raise invalid_parameter_value using message='import_not_ready'; end if;
 if batch.results ? target_index::text then return batch.results->target_index::text; end if;
 entry:=batch.plan->target_index;
 if entry->>'kind'='unchanged' then result:=jsonb_build_object('status','unchanged');
 elsif entry->>'kind'='error' then result:=jsonb_build_object('status','failed','error','validation_failed');
 else
  begin
   target:=entry->'target';
   if target is null or jsonb_typeof(target)<>'object' then raise invalid_parameter_value using message='invalid_import_plan'; end if;
   if nullif(target->>'previous_id','') is not null then
    select * into current_good from public.goods where id=target->>'previous_id' for update;
    if not found or private.goods_import_fingerprint(current_good.id) is distinct from entry->>'fingerprint' then
     raise serialization_failure using message='import_product_changed';
    end if;
   elsif nullif(target->>'code','') is not null and exists(select 1 from public.goods where code=target->>'code') then
    raise serialization_failure using message='import_product_changed';
   end if;
   images:=coalesce(batch.prepared_images->target_index::text,'{}');
   if exists(select 1 from jsonb_object_keys(images) key where key not in ('image_path','gallery_paths','detail_image_path')) then raise invalid_parameter_value using message='invalid_import_images'; end if;
   target:=target||images;
   if coalesce(target->>'image_path','') like 'import-image:%' or coalesce(target->>'detail_image_path','') like 'import-image:%'
    or exists(select 1 from jsonb_array_elements_text(coalesce(target->'gallery_paths','[]')) path where path like 'import-image:%')
    then raise check_violation using message='import_images_not_ready'; end if;
   saved:=public.admin_save_good(target);
   result:=jsonb_build_object('status','success','id',saved->>'id','code',saved->>'code');
   insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.goods_import.applied','goods:'||(saved->>'id'),
    jsonb_build_object('batch_id',batch.id,'rows',entry->'rows','kind',entry->>'kind'));
  exception when others then
   get stacked diagnostics error_code=returned_sqlstate,error_message=message_text;
   result:=jsonb_build_object('status','failed','error',error_message,'code',error_code);
  end;
 end if;
 update public.admin_goods_imports set results=jsonb_set(results,array[target_index::text],result,true),
  state=case when (select count(*) from jsonb_object_keys(results))+1>=jsonb_array_length(plan) then 'complete' else 'ready' end
  where id=batch.id;
 return result;
end $$;
revoke all on function public.admin_commit_goods_import_group(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_commit_goods_import_group(uuid,integer) to authenticated;

create function public.admin_goods_export_candidates(search_text text default '',ip_filter text default '',status_filter text default 'active',stock_filter text default 'all')
returns table(good_id text,option_rows integer) language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 return query select good.id,greatest(1,(select count(*)::integer from public.goods_variants variant where variant.good_id=good.id and variant.archived_at is null))
 from public.admin_search_goods(search_text) good where (ip_filter='' or good.ip_id=ip_filter)
 and case status_filter when 'all' then true when 'archived' then good.archived_at is not null when 'draft' then good.archived_at is null and good.published_at is null when 'published' then good.archived_at is null and good.published_at is not null else good.archived_at is null end
 and case stock_filter when 'soldout' then good.stock='soldout' or good.stock_qty=0 when 'ok' then good.stock='ok' and good.stock_qty>0 when 'low' then good.stock='low' and good.stock_qty>0 else true end
 order by good.id;
end $$;
revoke all on function public.admin_goods_export_candidates(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_export_candidates(text,text,text,text) to authenticated;
create function public.service_cache_goods_import_images(target_batch uuid,target_actor uuid,target_index integer,target_images jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(target_images) is distinct from 'object' or exists(select 1 from jsonb_object_keys(target_images) key where key not in ('image_path','gallery_paths','detail_image_path')) then raise invalid_parameter_value using message='invalid_import_images'; end if;
 update public.admin_goods_imports set prepared_images=jsonb_set(prepared_images,array[target_index::text],coalesce(prepared_images->target_index::text,'{}')||target_images,true)
 where id=target_batch and actor_id=target_actor and state='ready' and expires_at>now() and target_index>=0 and target_index<jsonb_array_length(plan) and not(results?target_index::text);
 if not found then raise check_violation using message='import_not_ready'; end if;
end $$;
revoke all on function public.service_cache_goods_import_images(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_cache_goods_import_images(uuid,uuid,integer,jsonb) to service_role;
