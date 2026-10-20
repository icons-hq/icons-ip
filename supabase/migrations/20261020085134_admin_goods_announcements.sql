-- Product announcements are independent of statutory goods notices and the
-- shipping-policy snapshot attached to orders. They never create notifications.
create table public.goods_announcements (
  id uuid primary key,
  reference bigint generated always as identity unique,
  title text not null check(char_length(btrim(title)) between 1 and 50),
  body text not null check(char_length(btrim(body)) between 1 and 30000),
  body_format text not null default 'plain' check(body_format in ('plain','html')),
  category text not null default 'general' check(category in ('general','event','shipping','product')),
  device text not null default 'all' check(device in ('all','pc','mobile')),
  enabled boolean not null default false,
  important boolean not null default false,
  all_goods boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  revision integer not null default 1 check(revision > 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(starts_at is null or ends_at is null or starts_at < ends_at)
);
create table public.goods_announcement_goods (
  announcement_id uuid not null references public.goods_announcements(id) on delete cascade,
  good_id text not null references public.goods(id),
  primary key(announcement_id,good_id)
);
create index goods_announcements_created_idx on public.goods_announcements(created_at desc,id);
create index goods_announcement_goods_good_idx on public.goods_announcement_goods(good_id,announcement_id);
alter table public.goods_announcements enable row level security;
alter table public.goods_announcement_goods enable row level security;
revoke all on public.goods_announcements,public.goods_announcement_goods from public,anon,authenticated,service_role;
grant select on public.goods_announcements,public.goods_announcement_goods to authenticated;
create policy goods_announcements_staff_read on public.goods_announcements for select to authenticated using(public.is_staff());
create policy goods_announcement_goods_staff_read on public.goods_announcement_goods for select to authenticated using(public.is_staff());

create function public.admin_save_goods_announcement(p_id uuid,p_expected_revision integer,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); previous public.goods_announcements; saved public.goods_announcements;
  ids text[]; starts_value timestamptz; ends_value timestamptz; before_goods text[];
begin
  if actor is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_values) is distinct from 'object' then raise invalid_parameter_value using message='invalid_goods_announcement'; end if;
  if exists(select 1 from jsonb_object_keys(p_values) key where key not in
      ('title','body','format','category','device','enabled','important','allGoods','goodIds','startsAt','endsAt'))
    or exists(select 1 from unnest(array['title','body','format','category','device']) key where jsonb_typeof(p_values->key) is distinct from 'string')
    or exists(select 1 from unnest(array['enabled','important','allGoods']) key where jsonb_typeof(p_values->key) is distinct from 'boolean')
    or char_length(btrim(p_values->>'title')) not between 1 and 50
    or char_length(btrim(p_values->>'body')) not between 1 and 30000
    or p_values->>'format' not in ('plain','html') or p_values->>'category' not in ('general','event','shipping','product')
    or p_values->>'device' not in ('all','pc','mobile')
    or jsonb_typeof(p_values->'goodIds') is distinct from 'array'
    or jsonb_array_length(p_values->'goodIds') > 500
    or exists(select 1 from jsonb_array_elements(p_values->'goodIds') item where jsonb_typeof(item) <> 'string'
      or char_length(item#>>'{}') not between 1 and 120)
    or exists(select 1 from unnest(array['startsAt','endsAt']) key where coalesce(jsonb_typeof(p_values->key),'null') not in ('string','null')) then
    raise invalid_parameter_value using message='invalid_goods_announcement';
  end if;
  select coalesce(array_agg(value),'{}') into ids from jsonb_array_elements_text(p_values->'goodIds');
  if cardinality(ids) <> (select count(distinct value) from unnest(ids) value)
    or ((p_values->>'allGoods')::boolean and cardinality(ids) <> 0)
    or (not (p_values->>'allGoods')::boolean and cardinality(ids) = 0)
    or exists(select 1 from unnest(ids) item where not exists(select 1 from public.goods where id=item)) then
    raise invalid_parameter_value using message='invalid_goods_announcement_goods';
  end if;
  starts_value:=nullif(p_values->>'startsAt','')::timestamptz;
  ends_value:=nullif(p_values->>'endsAt','')::timestamptz;
  if (starts_value is not null and not isfinite(starts_value)) or (ends_value is not null and not isfinite(ends_value))
    or (starts_value is not null and ends_value is not null and starts_value >= ends_value) then
    raise invalid_parameter_value using message='invalid_goods_announcement_period';
  end if;
  -- A client-generated id prevents an unknown create result from creating a second record.
  perform pg_advisory_xact_lock(hashtextextended('goods_announcement:'||p_id::text,0));
  select * into previous from public.goods_announcements where id=p_id for update;
  if (previous.id is null and p_expected_revision <> 0) or (previous.id is not null and previous.revision <> p_expected_revision) then
    raise sqlstate 'PT409' using message='goods_announcement_changed';
  end if;
  select coalesce(array_agg(good_id order by good_id),'{}') into before_goods from public.goods_announcement_goods where announcement_id=p_id;
  insert into public.goods_announcements(id,title,body,body_format,category,device,enabled,important,all_goods,starts_at,ends_at,created_by,updated_by)
  values(p_id,btrim(p_values->>'title'),btrim(p_values->>'body'),p_values->>'format',p_values->>'category',p_values->>'device',
    (p_values->>'enabled')::boolean,(p_values->>'important')::boolean,(p_values->>'allGoods')::boolean,starts_value,ends_value,actor,actor)
  on conflict(id) do update set title=excluded.title,body=excluded.body,body_format=excluded.body_format,category=excluded.category,
    device=excluded.device,enabled=excluded.enabled,important=excluded.important,all_goods=excluded.all_goods,
    starts_at=excluded.starts_at,ends_at=excluded.ends_at,revision=public.goods_announcements.revision+1,updated_by=actor,updated_at=clock_timestamp()
  returning * into saved;
  delete from public.goods_announcement_goods where announcement_id=p_id and not(good_id=any(ids));
  insert into public.goods_announcement_goods(announcement_id,good_id) select p_id,item from unnest(ids) item on conflict do nothing;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods_announcement.saved','goods_announcement:'||p_id::text,
    jsonb_build_object('before',case when previous.id is null then null else to_jsonb(previous) end,'after',to_jsonb(saved),'beforeGoodIds',before_goods,'afterGoodIds',ids));
  return jsonb_build_object('id',saved.id,'revision',saved.revision,'reference',saved.reference,'updatedAt',saved.updated_at);
end $$;
revoke all on function public.admin_save_goods_announcement(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_announcement(uuid,integer,jsonb) to authenticated;

create function public.admin_list_goods_announcements(p_query text default '',p_field text default 'title',p_category text default 'all',
  p_state text default 'all',p_from date default null,p_to date default null,p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_query is null or char_length(p_query)>100 or p_field is null or p_field not in ('title','reference')
    or p_category is null or p_category not in ('all','general','event','shipping','product')
    or p_state is null or p_state not in ('all','waiting','shown','stopped')
    or p_limit is null or p_limit not in (20,50,100) or p_offset is null or p_offset < 0 or p_from>p_to then
    raise invalid_parameter_value using message='invalid_goods_announcement_filter';
  end if;
  with scope as materialized (
    select n.*,case when not n.enabled or n.ends_at<=statement_timestamp() then 'stopped'
      when n.starts_at>statement_timestamp() then 'waiting' else 'shown' end as display_state
    from public.goods_announcements n where (p_category='all' or n.category=p_category)
      and (p_query='' or case p_field when 'reference' then n.reference::text=btrim(p_query) else strpos(lower(n.title),lower(btrim(p_query)))>0 end)
      and (p_from is null or n.created_at >= (p_from::timestamp at time zone 'Asia/Seoul'))
      and (p_to is null or n.created_at < ((p_to+1)::timestamp at time zone 'Asia/Seoul'))
  ), matched as materialized(select * from scope where p_state='all' or display_state=p_state),
  page as (select * from matched order by created_at desc,id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'reference',reference,'title',title,'category',category,'device',device,'enabled',enabled,'important',important,'allGoods',all_goods,
    'state',display_state,'startsAt',starts_at,'endsAt',ends_at,'createdAt',created_at,'updatedAt',updated_at,'revision',revision,
    'goodCount',(select count(*) from public.goods_announcement_goods links where links.announcement_id=page.id)
  ) order by created_at desc,id) from page),'[]')) into result;
  return result;
end $$;
revoke all on function public.admin_list_goods_announcements(text,text,text,text,date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_announcements(text,text,text,text,date,date,integer,integer) to authenticated;

create function public.admin_get_goods_announcement(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff_required'; end if;
  select jsonb_build_object('id',n.id,'reference',n.reference,'title',n.title,'body',n.body,'format',n.body_format,'category',n.category,
    'device',n.device,'enabled',n.enabled,'important',n.important,'allGoods',n.all_goods,'startsAt',n.starts_at,'endsAt',n.ends_at,
    'createdAt',n.created_at,'updatedAt',n.updated_at,'revision',n.revision,
    'goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'archived',g.archived_at is not null)
      order by g.name,g.id) from public.goods_announcement_goods links join public.goods g on g.id=links.good_id where links.announcement_id=n.id),'[]'))
    into result from public.goods_announcements n where n.id=p_id;
  return result;
end $$;
revoke all on function public.admin_get_goods_announcement(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_announcement(uuid) to authenticated;

create function public.admin_search_goods_for_announcement(p_query text default '',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then
    raise invalid_parameter_value using message='invalid_goods_announcement_search';
  end if;
  with matched as materialized(select id,name,code from public.goods where archived_at is null and
    (p_query='' or strpos(lower(name),lower(btrim(p_query)))>0 or strpos(lower(code),lower(btrim(p_query)))>0 or id=btrim(p_query))),
  page as (select * from matched order by name,id limit 20 offset (p_page-1)*20)
  select jsonb_build_object('total',(select count(*) from matched),'page',p_page,'pageSize',20,
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'archived',false) order by name,id) from page),'[]')) into result;
  return result;
end $$;
revoke all on function public.admin_search_goods_for_announcement(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_goods_for_announcement(text,integer) to authenticated;

-- Return only presentation fields and only for a currently public, unrestricted good.
create function public.get_good_announcements(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  with eligible as materialized (
    select n.* from public.goods_announcements n where n.enabled
      and exists(select 1 from public.goods g join public.ips ip on ip.id=g.ip_id where g.id=p_good_id
        and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
        and ip.archived_at is null and ip.published_at is not null)
      and (n.all_goods or exists(select 1 from public.goods_announcement_goods links where links.announcement_id=n.id and links.good_id=p_good_id))
  ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'format',body_format,
    'category',category,'device',device,'important',important) order by important desc,updated_at desc,id) from eligible
    where (starts_at is null or starts_at<=statement_timestamp()) and (ends_at is null or ends_at>statement_timestamp())),'[]'),
    'nextChangeAt',(select min(at) from eligible cross join lateral(values(starts_at),(ends_at)) boundary(at) where at>statement_timestamp()));
$$;
revoke all on function public.get_good_announcements(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_announcements(text) to anon,authenticated;
notify pgrst,'reload schema';
