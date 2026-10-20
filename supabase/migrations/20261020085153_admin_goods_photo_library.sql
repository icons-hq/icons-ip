-- Staff-shared, verified goods images. Archiving never deletes Storage objects.
create table public.goods_photo_library (
  id uuid primary key,
  image_path text not null unique check(image_path ~ '^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'),
  name text not null check(char_length(btrim(name)) between 1 and 100),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  revision integer not null default 1 check(revision > 0)
);
alter table public.goods_photo_library enable row level security;
revoke all on public.goods_photo_library from public,anon,authenticated,service_role;
grant select on public.goods_photo_library to authenticated;
create policy goods_photo_library_staff_read on public.goods_photo_library for select to authenticated using(public.is_staff());

-- SELECT FOR SHARE prevents archive from racing with a new goods reference.
-- The lock is held until the goods transaction commits or rolls back.
create function private.can_reuse_shared_goods_artwork(target_path text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then return false; end if;
  perform 1 from public.goods_photo_library where image_path=target_path and archived_at is null for share;
  return found;
end $$;
revoke all on function private.can_reuse_shared_goods_artwork(text) from public,anon,authenticated,service_role;

create function private.goods_photo_references(target_path text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind) order by kind,id),'[]') from (
    select g.id,g.name,'good'::text kind from public.goods g
      where target_path=any(array_remove(array[g.image_path,g.detail_image_path]||coalesce(g.gallery_paths,'{}')||coalesce(g.description_image_paths,'{}'),null))
    union all
    select c.id::text,c.title,'curation' from public.home_curations c where to_jsonb(c)::text like '%'||substr(target_path,14)||'%'
    union all
    select 'store','스토어 로고','store' from public.store_settings s where to_jsonb(s)::text like '%'||substr(target_path,14)||'%'
  ) refs;
$$;
revoke all on function private.goods_photo_references(text) from public,anon,authenticated,service_role;

create function public.admin_list_goods_photos(p_query text default '',p_archived boolean default false,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total_count bigint;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_page is null or p_page < 1 or p_page > 100000 or p_query is null or char_length(p_query)>100 or p_archived is null then raise invalid_parameter_value using message='invalid_photo_search'; end if;
  select count(*) into total_count from public.goods_photo_library p where (p.archived_at is not null)=p_archived and strpos(lower(p.name),lower(btrim(p_query)))>0;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'imagePath',p.image_path,'revision',p.revision,'archived',p.archived_at is not null,'createdAt',p.created_at,'references',private.goods_photo_references(p.image_path)) order by p.created_at desc,p.id),'[]') into result
    from (select * from public.goods_photo_library p where (p.archived_at is not null)=p_archived and strpos(lower(p.name),lower(btrim(p_query)))>0 order by p.created_at desc,p.id limit 20 offset (p_page-1)*20) p;
  return jsonb_build_object('rows',result,'total',total_count,'page',p_page,'pageSize',20);
end $$;
revoke all on function public.admin_list_goods_photos(text,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_photos(text,boolean,integer) to authenticated;

create function public.admin_save_goods_photo(p_id uuid,p_image_path text,p_name text,p_expected_revision integer,p_archived boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.goods_photo_library; saved public.goods_photo_library; object_path text; refs jsonb;
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 100 or p_expected_revision is null or p_expected_revision<0 or p_archived is null then raise invalid_parameter_value using message='invalid_goods_photo'; end if;
  perform pg_advisory_xact_lock(hashtextextended('goods-photo:'||p_id::text,0));
  select * into previous from public.goods_photo_library where id=p_id for update;
  if found then
    if previous.image_path is distinct from p_image_path then raise check_violation using message='photo_path_immutable'; end if;
    -- Register retries are safe only for the exact creator and original payload.
    if p_expected_revision=0 and previous.created_by=actor and previous.revision=1 and previous.name=btrim(p_name) and previous.archived_at is null and not p_archived then
      return jsonb_build_object('id',previous.id,'revision',previous.revision);
    end if;
    if previous.revision<>p_expected_revision then raise serialization_failure using message='goods_photo_changed'; end if;
    refs:=private.goods_photo_references(previous.image_path);
    if p_archived and jsonb_array_length(refs)>0 then raise check_violation using message='goods_photo_in_use'; end if;
    update public.goods_photo_library set name=btrim(p_name),archived_at=case when p_archived then coalesce(archived_at,clock_timestamp()) else null end,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into saved;
  else
    if p_expected_revision<>0 or p_archived then raise serialization_failure using message='goods_photo_changed'; end if;
    if p_image_path is null or p_image_path !~ '^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$' then raise check_violation using message='unverified_artwork'; end if;
    object_path:=substr(p_image_path,length('public-media/')+1);
    update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
      where claim.actor_id=actor and claim.path=object_path and claim.kind='good' and claim.status='verified'
        and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
    if not found then raise check_violation using message='unverified_artwork'; end if;
    insert into public.goods_photo_library(id,image_path,name,created_by) values(p_id,p_image_path,btrim(p_name),actor) returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods.photo.saved','goods_photo:'||p_id::text,jsonb_build_object('before',case when previous.id is null then null else to_jsonb(previous) end,'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'revision',saved.revision);
end $$;
revoke all on function public.admin_save_goods_photo(uuid,text,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_photo(uuid,text,text,integer,boolean) to authenticated;

-- Trigger bodies below preserve all existing one-use, clone and within-good move gates;
-- only an active library asset may take the new staff-shared path.
create or replace function public.enforce_admin_catalog_artwork_claim()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := (select auth.uid());
  object_path text;
  expected_kind text := tg_argv[0];
begin
  if new.image_path is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.image_path is not distinct from old.image_path then
    return new;
  end if;

  if expected_kind='good' and tg_table_schema='public' and tg_table_name='goods' and tg_op='UPDATE' then
    if new.image_path=any(array_remove(array[old.detail_image_path]||coalesce(old.gallery_paths,'{}')||coalesce(old.description_image_paths,'{}'),null)) then
      return new;
    end if;
  end if;

  if expected_kind='good' and tg_table_schema='public' and tg_table_name='goods'
    and private.can_copy_goods_artwork(new.id::text,new.image_path) then return new; end if;
  if expected_kind='good' and tg_table_schema='public' and tg_table_name='goods'
    and private.can_reuse_shared_goods_artwork(new.image_path) then return new; end if;

  if current_actor_id is null then
    if session_user = 'postgres' then
      return new;
    end if;
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  if not public.is_staff()
    or new.image_path !~ '^public-media/catalog/(ip|good|card|event|curation)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  then
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  object_path := substring(new.image_path from length('public-media/') + 1);
  if object_path not like 'catalog/' || expected_kind || '/%' then
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  update public.admin_artwork_upload_claims as claim
  set
    status = 'attached',
    attached_at = clock_timestamp(),
    resolved_at = clock_timestamp()
  where claim.actor_id = current_actor_id
    and claim.path = object_path
    and claim.kind = expected_kind
    and claim.status = 'verified'
    and claim.verified_at is not null
    and claim.final_size is not null
    and claim.attached_at is null
    and claim.expires_at > clock_timestamp();

  if not found then
    raise exception 'unverified_artwork' using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke all on function public.enforce_admin_catalog_artwork_claim() from public,anon,authenticated,service_role;

create or replace function public.enforce_admin_goods_content_artwork_claim()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor_id uuid:=(select auth.uid());
  old_paths text[]:='{}';
  new_paths text[];
  candidate text;
begin
  if tg_op='UPDATE' then
    old_paths:=array_remove(array[old.image_path,old.detail_image_path]
      || coalesce(old.gallery_paths,'{}') || coalesce(old.description_image_paths,'{}'),null);
  end if;
  select coalesce(array_agg(distinct path),'{}') into new_paths
    from unnest(array_remove(array[new.detail_image_path]
      || coalesce(new.gallery_paths,'{}') || coalesce(new.description_image_paths,'{}'),null)) path;
  foreach candidate in array new_paths loop
    continue when candidate=any(old_paths);
    -- The existing main-image AFTER trigger validates this same row's image.
    continue when candidate=new.image_path;
    continue when private.can_copy_goods_artwork(new.id::text,candidate);
    continue when private.can_reuse_shared_goods_artwork(candidate);
    if v_actor_id is null then
      if session_user='postgres' then continue; end if;
      raise check_violation using message='unverified_artwork';
    end if;
    if not public.is_staff() or candidate !~ '^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$' then
      raise check_violation using message='unverified_artwork';
    end if;
    update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
      where claim.actor_id=v_actor_id and claim.path=substring(candidate from length('public-media/')+1)
        and claim.kind='good' and claim.status='verified' and claim.verified_at is not null
        and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
    if not found then raise check_violation using message='unverified_artwork'; end if;
  end loop;
  return new;
end $$;
revoke all on function public.enforce_admin_goods_content_artwork_claim() from public,anon,authenticated,service_role;
