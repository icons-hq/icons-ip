-- Additional memberships are an admin discovery aid. The primary category and
-- public category activation/ERP contracts continue to use goods.category_id.
create table public.goods_additional_categories (
  good_id text not null references public.goods(id) on update cascade on delete cascade,
  category_id uuid not null references public.catalog_categories(id) on delete restrict,
  primary key (good_id,category_id)
);
create index goods_additional_categories_category_idx on public.goods_additional_categories(category_id,good_id);
alter table public.goods_additional_categories enable row level security;
revoke all on public.goods_additional_categories from public,anon,authenticated,service_role;
grant select on public.goods_additional_categories to authenticated;
create policy goods_additional_categories_staff_read on public.goods_additional_categories
  for select to authenticated using ((select public.is_staff()));

create function private.goods_additional_category_ids(target_good_id text)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(category_id order by category_id),'{}'::uuid[])
  from public.goods_additional_categories where good_id=target_good_id;
$$;
revoke all on function private.goods_additional_category_ids(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_additional_category_ids(text) to postgres;

create or replace function private.guard_category_tree()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_catalog_category_tree();
  if new.parent_id is not null then
    if tg_op='INSERT' then
      if exists(select 1 from public.goods where category_id=new.parent_id)
        or exists(select 1 from public.goods_additional_categories where category_id=new.parent_id) then
        raise check_violation using message='category_has_goods';
      end if;
    elsif (old.parent_id is distinct from new.parent_id or (old.archived_at is not null and new.archived_at is null))
      and (exists(select 1 from public.goods where category_id=new.parent_id)
        or exists(select 1 from public.goods_additional_categories where category_id=new.parent_id)) then
      raise check_violation using message='category_has_goods';
    end if;
  end if;
  new.depth:=private.category_validate_parent(new.id,new.parent_id);
  return new;
end $$;
revoke all on function private.guard_category_tree() from public,anon,authenticated,service_role;
drop trigger catalog_categories_tree_guard on public.catalog_categories;
create trigger catalog_categories_tree_guard before insert or update of parent_id,archived_at on public.catalog_categories
  for each row execute function private.guard_category_tree();

create function private.guard_goods_additional_category()
returns trigger language plpgsql security definer set search_path='' as $$
declare category_row public.catalog_categories;
begin
  perform private.lock_catalog_category_tree();
  select * into category_row from public.catalog_categories where id=new.category_id for share;
  if not found then raise foreign_key_violation using message='category_not_found'; end if;
  if category_row.archived_at is not null then raise check_violation using message='category_archived'; end if;
  if exists(select 1 from public.catalog_categories where parent_id=new.category_id and archived_at is null) then
    raise check_violation using message='category_not_leaf';
  end if;
  return new;
end $$;
revoke all on function private.guard_goods_additional_category() from public,anon,authenticated,service_role;
create trigger goods_additional_category_guard before insert or update of category_id on public.goods_additional_categories
  for each row execute function private.guard_goods_additional_category();

create function private.apply_goods_additional_categories(target_good_id text,target_category_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare previous_ids uuid[]; next_ids uuid[]; primary_id uuid; category_id uuid; category_row public.catalog_categories;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  perform private.lock_catalog_category_tree();
  select good.category_id into primary_id from public.goods good where good.id=target_good_id for update;
  if not found then raise no_data_found using message='goods_not_found'; end if;
  previous_ids:=private.goods_additional_category_ids(target_good_id);
  if target_category_ids is null or array_position(target_category_ids,null) is not null then
    raise invalid_parameter_value using message='invalid_additional_categories';
  end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into next_ids
    from (select distinct unnest(target_category_ids) as id) candidates where id is distinct from primary_id;
  if previous_ids=next_ids then return; end if;
  foreach category_id in array next_ids loop
    select * into category_row from public.catalog_categories category where category.id=category_id for share;
    if not found then raise foreign_key_violation using message='category_not_found'; end if;
    if category_row.archived_at is not null and not category_id=any(previous_ids) then
      raise check_violation using message='category_archived';
    end if;
    if exists(select 1 from public.catalog_categories where parent_id=category_id and archived_at is null) then
      raise check_violation using message='category_not_leaf';
    end if;
  end loop;
  delete from public.goods_additional_categories membership where membership.good_id=target_good_id and not membership.category_id=any(next_ids);
  insert into public.goods_additional_categories(good_id,category_id)
    select target_good_id,id from unnest(next_ids) ids(id) where not id=any(previous_ids);
  update public.goods set updated_at=clock_timestamp() where id=target_good_id;
  insert into public.audit_log(actor_id,action,target,diff)
    values(auth.uid(),'admin.good.additional_categories_saved','goods:'||target_good_id,
      jsonb_build_object('before',to_jsonb(previous_ids),'after',to_jsonb(next_ids)));
end $$;
revoke all on function private.apply_goods_additional_categories(text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.apply_goods_additional_categories(text,uuid[]) to postgres;

alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_additional_categories;
revoke all on function private.admin_save_good_before_additional_categories(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_save_good_before_additional_categories(jsonb) to postgres;
create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; category_ids uuid[];
begin
  if auth.uid() is null then raise invalid_authorization_specification using message='auth_required'; end if;
  if not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if jsonb_typeof(target_good) is distinct from 'object' then raise invalid_parameter_value using message='invalid_good'; end if;
  if target_good ? 'additional_category_ids' then
    if jsonb_typeof(target_good->'additional_category_ids') is distinct from 'array' then
      raise invalid_parameter_value using message='invalid_additional_categories';
    end if;
    if exists(select 1 from jsonb_array_elements(target_good->'additional_category_ids') item where jsonb_typeof(item)<>'string') then
      raise invalid_parameter_value using message='invalid_additional_categories';
    end if;
    begin
      select coalesce(array_agg(value::uuid),'{}'::uuid[]) into category_ids from jsonb_array_elements_text(target_good->'additional_category_ids');
    exception when invalid_text_representation then raise invalid_parameter_value using message='invalid_additional_categories'; end;
  end if;
  -- Always acquire tree before product/option locks; omission still needs to
  -- remove a redundant membership if the existing primary category changes.
  perform private.lock_catalog_category_tree();
  saved:=private.admin_save_good_before_additional_categories(target_good-'additional_category_ids');
  perform private.apply_goods_additional_categories(saved->>'id',coalesce(category_ids,private.goods_additional_category_ids(saved->>'id')));
  return saved;
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

alter function public.admin_assign_good_category(uuid,text,uuid,timestamptz) set schema private;
alter function private.admin_assign_good_category(uuid,text,uuid,timestamptz) rename to admin_assign_good_category_before_additional;
revoke all on function private.admin_assign_good_category_before_additional(uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.admin_assign_good_category_before_additional(uuid,text,uuid,timestamptz) to postgres;
create function public.admin_assign_good_category(target_operation_id uuid,target_good_id text,target_category_id uuid,target_expected_updated_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed boolean; replay boolean;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin.catalog.category.operation:'||target_operation_id::text,0));
  select exists(select 1 from public.audit_log where id=target_operation_id) into replay;
  changed:=private.admin_assign_good_category_before_additional(target_operation_id,target_good_id,target_category_id,target_expected_updated_at);
  if not replay then perform private.apply_goods_additional_categories(target_good_id,private.goods_additional_category_ids(target_good_id)); end if;
  return changed;
end $$;
revoke all on function public.admin_assign_good_category(uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_assign_good_category(uuid,text,uuid,timestamptz) to authenticated;

alter function public.admin_clone_good(uuid,text,text,text,text) set schema private;
alter function private.admin_clone_good(uuid,text,text,text,text) rename to admin_clone_good_before_additional_categories;
revoke all on function private.admin_clone_good_before_additional_categories(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_clone_good_before_additional_categories(uuid,text,text,text,text) to postgres;
create function public.admin_clone_good(target_operation_id uuid,target_source_good_id text,target_new_id text default null,target_new_code text default null,target_new_name text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; replay boolean; category_ids uuid[];
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin.goods.clone.operation:'||target_operation_id::text,0));
  select exists(select 1 from public.audit_log where id=target_operation_id) into replay;
  saved:=private.admin_clone_good_before_additional_categories(target_operation_id,target_source_good_id,target_new_id,target_new_code,target_new_name);
  if not replay then
    select coalesce(array_agg(membership.category_id),'{}'::uuid[]) into category_ids
      from public.goods_additional_categories membership join public.catalog_categories category on category.id=membership.category_id
      where membership.good_id=saved->>'sourceGoodId' and category.archived_at is null;
    perform private.apply_goods_additional_categories(saved->>'id',category_ids);
  end if;
  return saved;
end $$;
revoke all on function public.admin_clone_good(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_clone_good(uuid,text,text,text,text) to authenticated;

-- A workbook captured before a membership edit must fail its optimistic check.
alter function private.goods_import_fingerprint(text) rename to goods_import_fingerprint_before_additional_categories;
revoke all on function private.goods_import_fingerprint_before_additional_categories(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_import_fingerprint_before_additional_categories(text) to postgres;
create function private.goods_import_fingerprint(target_id text)
returns text language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object('catalog',private.goods_import_fingerprint_before_additional_categories(target_id),
    'additional_categories',private.goods_additional_category_ids(target_id))::text,'UTF8'),'sha256'),'hex');
$$;
revoke all on function private.goods_import_fingerprint(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_import_fingerprint(text) to postgres;
alter function public.admin_goods_import_records(text[],text[]) set schema private;
alter function private.admin_goods_import_records(text[],text[]) rename to admin_goods_import_records_before_additional_categories;
revoke all on function private.admin_goods_import_records_before_additional_categories(text[],text[]) from public,anon,authenticated,service_role;
grant execute on function private.admin_goods_import_records_before_additional_categories(text[],text[]) to postgres;
create function public.admin_goods_import_records(target_codes text[] default '{}',target_ids text[] default '{}')
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  return query select jsonb_set(entry.value,'{good,additional_category_ids}',to_jsonb(private.goods_additional_category_ids(entry.value#>>'{good,id}')))
    from private.admin_goods_import_records_before_additional_categories(target_codes,target_ids) entry(value);
end $$;
revoke all on function public.admin_goods_import_records(text[],text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_import_records(text[],text[]) to authenticated;

-- Exists preserves one product row even when several descendant memberships match.
create or replace function private.admin_goods_workspace_matches(p_query text,p_ip_id text,p_status text,p_stock text,p_category_id uuid,p_readiness text)
returns table(good public.goods,readiness jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_status is null or p_status not in ('active','all','draft','published','archived') or p_stock is null or p_stock not in ('all','ok','low','soldout')
    or p_readiness is null or p_readiness not in ('all','ready','review_required','archived','draft','stopped','ip_unpublished','ip_archived',
    'type_missing','image_missing','notice_missing','no_active_options','stock_unavailable','payment_disabled','restricted_sale','shipping_unavailable',
    'kc_required','kc_legacy_unrecorded','readiness_unknown') then raise invalid_parameter_value using message='invalid_goods_workspace_filter'; end if;
  return query
  with recursive categories as (
    select id from public.catalog_categories where id=p_category_id
    union select child.id from public.catalog_categories child join categories parent on child.parent_id=parent.id
  ), candidates as materialized (
    select item from public.admin_search_goods(p_query) item
    where (coalesce(p_ip_id,'')='' or item.ip_id=p_ip_id)
      and (p_category_id is null or item.category_id in (select id from categories)
        or exists(select 1 from public.goods_additional_categories membership where membership.good_id=item.id and membership.category_id in (select id from categories)))
      and case p_status when 'all' then true when 'archived' then item.archived_at is not null
        when 'draft' then item.archived_at is null and item.published_at is null
        when 'published' then item.archived_at is null and item.published_at is not null else item.archived_at is null end
  ), assessed as materialized (
    select item,private.admin_goods_readiness(item) decision from candidates
  ) select item,decision from assessed
    where case p_stock when 'soldout' then (item).stock='soldout' or (decision->>'activeStockQty')::bigint=0
      when 'ok' then (item).stock='ok' and (decision->>'activeStockQty')::bigint>0
      when 'low' then (item).stock='low' and (decision->>'activeStockQty')::bigint>0 else true end
    and case p_readiness when 'all' then true when 'ready' then decision->>'state'='ready'
      when 'review_required' then (decision->>'reviewRequired')::boolean else decision->'reasonCodes' ? p_readiness end;
end $$;
revoke all on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) to postgres;
notify pgrst,'reload schema';
