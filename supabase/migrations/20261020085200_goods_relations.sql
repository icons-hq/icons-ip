-- Editorial product relationships are navigation, never additional purchase lines.
create table public.goods_relations (
  id uuid primary key,
  kind text not null check(kind in ('together','similar')),
  title text not null check(char_length(btrim(title)) between 1 and 15),
  representative_good_id text not null references public.goods(id),
  enabled boolean not null default false,
  starts_at timestamptz check(starts_at is null or isfinite(starts_at)),
  ends_at timestamptz check(ends_at is null or isfinite(ends_at)),
  revision integer not null default 1 check(revision>0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(starts_at is null or ends_at is null or starts_at<ends_at)
);
create table public.goods_relation_members (
  relation_id uuid not null references public.goods_relations(id) on delete cascade,
  good_id text not null references public.goods(id),
  position integer not null check(position between 1 and 10),
  primary key(relation_id,good_id),
  unique(relation_id,position)
);
create index goods_relations_recent_idx on public.goods_relations(updated_at desc,id);
create index goods_relations_representative_idx on public.goods_relations(representative_good_id) where enabled;
create index goods_relation_members_good_idx on public.goods_relation_members(good_id,relation_id);
alter table public.goods_relations enable row level security;
alter table public.goods_relation_members enable row level security;
revoke all on public.goods_relations,public.goods_relation_members from public,anon,authenticated,service_role;
grant select on public.goods_relations,public.goods_relation_members to authenticated;
create policy goods_relations_staff_read on public.goods_relations for select to authenticated using((select public.is_staff()));
create policy goods_relation_members_staff_read on public.goods_relation_members for select to authenticated using((select public.is_staff()));

create function private.goods_relation_document(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,'representativeGoodId',r.representative_good_id,
    'enabled',r.enabled,'startsAt',r.starts_at,'endsAt',r.ends_at,'revision',r.revision,
    'createdAt',r.created_at,'updatedAt',r.updated_at,
    'state',case when not r.enabled then 'stopped' when r.starts_at>statement_timestamp() then 'scheduled'
      when r.ends_at<=statement_timestamp() then 'ended' else 'active' end,
    'goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'imagePath',g.image_path,
      'public',g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
        and i.archived_at is null and i.published_at is not null) order by m.position)
      from public.goods_relation_members m join public.goods g on g.id=m.good_id join public.ips i on i.id=g.ip_id
      where m.relation_id=r.id),'[]'::jsonb))
  from public.goods_relations r where r.id=p_id;
$$;
revoke all on function private.goods_relation_document(uuid) from public,anon,authenticated,service_role;

create function public.admin_get_goods_relation(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  return private.goods_relation_document(p_id);
end $$;
revoke all on function public.admin_get_goods_relation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_relation(uuid) to authenticated;

create function public.admin_save_goods_relation(p_id uuid,p_expected_revision integer,p_values jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); prior public.goods_relations; saved public.goods_relations; before_document jsonb;
  ids text[]; representative text; relation_kind text; title_value text; starts_value timestamptz; ends_value timestamptz;
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_values) is distinct from 'object'
    or not(p_values ?& array['kind','title','representativeGoodId','enabled','startsAt','endsAt','goodIds'])
    or exists(select 1 from jsonb_object_keys(p_values) key where key<>all(array['kind','title','representativeGoodId','enabled','startsAt','endsAt','goodIds']))
    or jsonb_typeof(p_values->'kind') is distinct from 'string' or p_values->>'kind' not in ('together','similar')
    or jsonb_typeof(p_values->'title') is distinct from 'string' or char_length(btrim(p_values->>'title')) not between 1 and 15
    or jsonb_typeof(p_values->'representativeGoodId') is distinct from 'string'
    or jsonb_typeof(p_values->'enabled') is distinct from 'boolean'
    or jsonb_typeof(p_values->'goodIds') is distinct from 'array'
    or jsonb_typeof(p_values->'startsAt') not in ('null','string') or jsonb_typeof(p_values->'endsAt') not in ('null','string')
  then raise invalid_parameter_value using message='invalid_goods_relation'; end if;
  relation_kind:=p_values->>'kind'; title_value:=btrim(p_values->>'title'); representative:=p_values->>'representativeGoodId';
  if jsonb_array_length(p_values->'goodIds') not between 2 and (case when relation_kind='together' then 6 else 10 end)
    or exists(select 1 from jsonb_array_elements(p_values->'goodIds') value where jsonb_typeof(value)<>'string')
  then raise invalid_parameter_value using message='invalid_goods_relation_goods'; end if;
  select array_agg(value order by position) into ids from jsonb_array_elements_text(p_values->'goodIds') with ordinality item(value,position);
  if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) or not(representative=any(ids))
    or exists(select 1 from unnest(ids) requested(id) where not exists(select 1 from public.goods g where g.id=requested.id))
  then raise invalid_parameter_value using message='invalid_goods_relation_goods'; end if;
  begin
    starts_value:=(p_values->>'startsAt')::timestamptz; ends_value:=(p_values->>'endsAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise invalid_parameter_value using message='invalid_goods_relation_period';
  end;
  if starts_value is not null and not isfinite(starts_value) or ends_value is not null and not isfinite(ends_value)
    or starts_value is not null and ends_value is not null and starts_value>=ends_value
  then raise invalid_parameter_value using message='invalid_goods_relation_period'; end if;
  -- A caller-generated id makes a retry of a new form collide with the first save.
  if p_expected_revision=0 then
    insert into public.goods_relations(id,kind,title,representative_good_id,enabled,starts_at,ends_at,created_by,updated_by)
      values(p_id,relation_kind,title_value,representative,(p_values->>'enabled')::boolean,starts_value,ends_value,actor,actor)
      on conflict(id) do nothing returning * into saved;
    if saved.id is null then raise sqlstate 'PT409' using message='goods_relation_changed'; end if;
  else
    select * into prior from public.goods_relations where id=p_id for update;
    if prior.id is null or prior.revision<>p_expected_revision then raise sqlstate 'PT409' using message='goods_relation_changed'; end if;
    before_document:=private.goods_relation_document(p_id);
    update public.goods_relations set kind=relation_kind,title=title_value,representative_good_id=representative,
      enabled=(p_values->>'enabled')::boolean,starts_at=starts_value,ends_at=ends_value,
      revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id=p_id returning * into saved;
  end if;
  delete from public.goods_relation_members where relation_id=p_id;
  insert into public.goods_relation_members(relation_id,good_id,position)
    select p_id,id,position::integer from unnest(ids) with ordinality item(id,position);
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods.relation.saved','goods_relation:'||p_id,
    jsonb_build_object('before',before_document,'after',private.goods_relation_document(p_id)));
  return jsonb_build_object('id',p_id,'revision',saved.revision);
end $$;
revoke all on function public.admin_save_goods_relation(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_relation(uuid,integer,jsonb) to authenticated;

create function public.admin_list_goods_relations(p_query text default '',p_kind text default 'all',p_state text default 'all',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_query is null or char_length(p_query)>100 or p_kind is null or p_kind not in ('all','together','similar')
    or p_state is null or p_state not in ('all','active','scheduled','stopped','ended')
    or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (20,50,100)
  then raise invalid_parameter_value using message='invalid_goods_relation_filter'; end if;
  with matched as materialized (
    select r.*,case when not r.enabled then 'stopped' when r.starts_at>statement_timestamp() then 'scheduled'
      when r.ends_at<=statement_timestamp() then 'ended' else 'active' end state
    from public.goods_relations r where (p_kind='all' or r.kind=p_kind) and (btrim(p_query)=''
      or strpos(lower(r.title),lower(btrim(p_query)))>0 or strpos(r.id::text,btrim(p_query))>0
      or exists(select 1 from public.goods_relation_members m join public.goods g on g.id=m.good_id where m.relation_id=r.id
        and (strpos(lower(g.name),lower(btrim(p_query)))>0 or strpos(lower(g.code),lower(btrim(p_query)))>0 or strpos(g.id,btrim(p_query))>0)))
  ), filtered as materialized (select * from matched where p_state='all' or state=p_state),
  page_rows as (select id,updated_at from filtered order by updated_at desc,id limit p_page_size offset (p_page-1)*p_page_size)
  select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,
    'rows',coalesce((select jsonb_agg(private.goods_relation_document(id) order by updated_at desc,id) from page_rows),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.admin_list_goods_relations(text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_relations(text,text,text,integer,integer) to authenticated;

create function public.admin_search_goods_for_relation(p_query text default '',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then
    raise invalid_parameter_value using message='invalid_goods_relation_filter'; end if;
  with matches as materialized (
    select g.id,g.name,g.code,g.image_path,g.published_at is not null and g.sale_restriction='none'
      and i.archived_at is null and i.published_at is not null as is_public
    from public.goods g join public.ips i on i.id=g.ip_id where g.archived_at is null and (btrim(p_query)=''
      or strpos(lower(g.name),lower(btrim(p_query)))>0 or strpos(lower(g.code),lower(btrim(p_query)))>0 or strpos(g.id,btrim(p_query))>0)
  ), page_rows as (select * from matches order by is_public desc,name,id limit 20 offset(p_page-1)*20)
  select jsonb_build_object('total',(select count(*) from matches),'page',p_page,'pageSize',20,
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'imagePath',image_path,'public',is_public)
      order by is_public desc,name,id) from page_rows),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.admin_search_goods_for_relation(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_goods_for_relation(text,integer) to authenticated;

create function public.get_good_relations(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  with matching as materialized (
    select r.* from public.goods_relations r
    where r.enabled and ((r.kind='together' and r.representative_good_id=p_good_id)
      or (r.kind='similar' and exists(select 1 from public.goods_relation_members m where m.relation_id=r.id and m.good_id=p_good_id)))
  ), public_members as materialized (
    select m.relation_id,m.good_id,m.position from public.goods_relation_members m join matching r on r.id=m.relation_id
      join public.goods g on g.id=m.good_id join public.ips i on i.id=g.ip_id
    where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null
  ), eligible as materialized (
    select r.* from matching r where (select count(*) from public_members m where m.relation_id=r.id)>=2
      and exists(select 1 from public_members m where m.relation_id=r.id and m.good_id=p_good_id)
      and exists(select 1 from public_members m where m.relation_id=r.id and m.good_id=r.representative_good_id)
  ), active as (
    select * from eligible where (starts_at is null or starts_at<=statement_timestamp()) and (ends_at is null or ends_at>statement_timestamp())
  )
  select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,
    'goodIds',(select jsonb_agg(m.good_id order by m.position) from public_members m where m.relation_id=r.id and m.good_id<>p_good_id))
    order by case when r.kind='together' then 0 else 1 end,r.created_at,r.id) from active r),'[]'::jsonb),
    'nextChangeAt',(select min(boundary) from eligible r cross join lateral(values(r.starts_at),(r.ends_at)) changes(boundary) where boundary>statement_timestamp()));
$$;
revoke all on function public.get_good_relations(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_relations(text) to anon,authenticated;
