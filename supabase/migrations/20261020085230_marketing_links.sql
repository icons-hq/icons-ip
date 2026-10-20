-- Stable internal marketing links. No visits, identity, orders or attribution are recorded.
create table private.marketing_links (
 id uuid primary key default gen_random_uuid(),
 token text not null unique default replace(gen_random_uuid()::text,'-','') check(token ~ '^[0-9a-f]{32}$'),
 source text not null check(source in ('home','good','story','category')),
 original_target_id text not null,
 original_title text not null,
 good_id text references public.goods(id) on update cascade on delete set null,
 story_id uuid references public.shopping_stories(id) on update cascade on delete set null,
 category_id uuid references public.catalog_categories(id) on update cascade on delete set null,
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 check((source='home' and original_target_id='home' and good_id is null and story_id is null and category_id is null)
  or (source='good' and story_id is null and category_id is null)
  or (source='story' and good_id is null and category_id is null)
  or (source='category' and good_id is null and story_id is null))
);
create unique index marketing_links_home_once on private.marketing_links(source) where source='home';
create unique index marketing_links_good_once on private.marketing_links(good_id) where source='good' and good_id is not null;
create unique index marketing_links_story_once on private.marketing_links(story_id) where source='story' and story_id is not null;
create unique index marketing_links_category_once on private.marketing_links(category_id) where source='category' and category_id is not null;
create index marketing_links_created on private.marketing_links(source,created_at desc,id desc);
alter table private.marketing_links enable row level security;
revoke all on private.marketing_links from public,anon,authenticated,service_role;

create function private.marketing_link_available(p_link private.marketing_links)
returns boolean language sql stable security definer set search_path='' as $$
 select case p_link.source
  when 'home' then true
  when 'good' then exists(select 1 from public.goods g join public.ips ip on ip.id=g.ip_id where g.id=p_link.good_id
    and g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null)
  when 'story' then exists(select 1 from public.shopping_stories s where s.id=p_link.story_id and s.deleted_at is null
    and (s.starts_at is null or s.starts_at<=statement_timestamp()) and (s.ends_at is null or s.ends_at>statement_timestamp()))
  when 'category' then exists(select 1 from public.get_catalog_categories() c where c.id=p_link.category_id)
  else false end;
$$;
revoke all on function private.marketing_link_available(private.marketing_links) from public,anon,authenticated,service_role;

create function private.marketing_link_rows(p_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'token',l.token,'source',l.source,
   'targetId',case l.source when 'home' then 'home' when 'good' then l.good_id when 'story' then l.story_id::text when 'category' then l.category_id::text end,
   'originalTargetId',l.original_target_id,'title',coalesce(g.name,s.title,c.name,l.original_title),
   'available',private.marketing_link_available(l),'createdAt',l.created_at) order by l.created_at desc,l.id desc),'[]')
 from private.marketing_links l left join public.goods g on g.id=l.good_id left join public.shopping_stories s on s.id=l.story_id
 left join public.catalog_categories c on c.id=l.category_id where l.id=any(p_ids);
$$;
revoke all on function private.marketing_link_rows(uuid[]) from public,anon,authenticated,service_role;

create function public.admin_issue_marketing_links(p_source text,p_target_ids text[],p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ids text[]; target text; label text; item_id uuid; issued uuid[]:='{}'; request jsonb; replay jsonb;
begin
 if p_source is null or p_source not in ('home','good','story','category') or p_operation_id is null
  or p_target_ids is null or cardinality(p_target_ids) not between 1 and 100 or array_ndims(p_target_ids)<>1
  or exists(select 1 from unnest(p_target_ids) v where v is null or char_length(v) not between 1 and 200 or v ~ '[[:cntrl:]]')
  or cardinality(p_target_ids)<>(select count(distinct v) from unnest(p_target_ids) v)
  or (p_source='home' and p_target_ids<>array['home'])
  or (p_source='good' and exists(select 1 from unnest(p_target_ids) v where v!~'^[a-z0-9][a-z0-9-]{0,199}$'))
  or (p_source in ('story','category') and exists(select 1 from unnest(p_target_ids) v where v!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
 then raise invalid_parameter_value using message='invalid_marketing_targets';end if;
 perform private.require_actor_operator_capability(actor,case when p_source in ('home','story') then 'store.manage' else 'catalog.manage' end,false);
 select array_agg(v order by v) into ids from unnest(p_target_ids) v;
 request:=jsonb_build_object('source',p_source,'targetIds',ids);
 perform pg_advisory_xact_lock(hashtextextended('marketing-link:operation:'||p_operation_id::text,0));
 replay:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.marketing_links.issued',request);
 if replay is not null then
  select array_agg(value::uuid) into issued from jsonb_array_elements_text(replay->'ids');
  return jsonb_build_object('rows',private.marketing_link_rows(issued));
 end if;
 for target in select unnest(ids) loop
  label:=null;
  if p_source='home' then label:='스토어 홈';
  elsif p_source='good' then select name into label from public.goods where id=target for key share;
  elsif p_source='story' then select title into label from public.shopping_stories where id=target::uuid and deleted_at is null for key share;
  else select name into label from public.catalog_categories where id=target::uuid for key share;end if;
  if label is null then raise no_data_found using message='marketing_target_missing';end if;
  -- Per-target lock and uniqueness protect simultaneous issue requests. Names and
  -- publish states may change later; the stored token never changes with them.
  perform pg_advisory_xact_lock(hashtextextended('marketing-link:'||p_source||':'||target,0));
  select id into item_id from private.marketing_links where source=p_source and
   case p_source when 'home' then true when 'good' then good_id=target when 'story' then story_id=target::uuid else category_id=target::uuid end;
  if item_id is null then
   insert into private.marketing_links(source,original_target_id,original_title,good_id,story_id,category_id,created_by)
   values(p_source,target,label,case when p_source='good' then target end,case when p_source='story' then target::uuid end,
     case when p_source='category' then target::uuid end,actor) returning id into item_id;
  end if;
  issued:=array_append(issued,item_id);
 end loop;
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.marketing_links.issued','marketing_links:'||p_source,
  jsonb_build_object('request',request,'result',jsonb_build_object('ids',issued)));
 return jsonb_build_object('rows',private.marketing_link_rows(issued));
end $$;
revoke all on function public.admin_issue_marketing_links(text,text[],uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_issue_marketing_links(text,text[],uuid) to authenticated;

create function public.admin_list_marketing_links(p_source text default 'home',p_query text default '',p_status text default 'all',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ids uuid[]; total_count bigint; q text:=btrim(coalesce(p_query,''));
begin
 if not private.has_operator_capability(auth.uid(),'marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_source is null or p_source not in ('home','good','story','category') or length(q)>100 or p_status is null or p_status not in ('all','available','unavailable')
  or p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not in (20,50,100)
 then raise invalid_parameter_value using message='invalid_marketing_filter';end if;
 with matched as materialized(select l.id,l.created_at from private.marketing_links l
  left join public.goods g on g.id=l.good_id left join public.shopping_stories s on s.id=l.story_id left join public.catalog_categories c on c.id=l.category_id
  where l.source=p_source and (q='' or strpos(lower(coalesce(g.name,s.title,c.name,l.original_title)),lower(q))>0
    or strpos(lower(coalesce(l.good_id,l.story_id::text,l.category_id::text,l.original_target_id)),lower(q))>0 or strpos(l.token,lower(q))>0)
  and (p_status='all' or private.marketing_link_available(l)=(p_status='available'))), page_rows as (
   select * from matched order by created_at desc,id desc limit p_page_size offset (p_page-1)*p_page_size)
 select (select count(*) from matched),coalesce((select array_agg(id) from page_rows),'{}') into total_count,ids;
 return jsonb_build_object('total',total_count,'rows',private.marketing_link_rows(ids));
end $$;
revoke all on function public.admin_list_marketing_links(text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_marketing_links(text,text,text,integer,integer) to authenticated;

create function public.resolve_marketing_link(p_token text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('source',l.source,'targetId',case l.source when 'home' then 'home' when 'good' then l.good_id when 'story' then l.story_id::text when 'category' then l.category_id::text end)
 from private.marketing_links l where p_token ~ '^[0-9a-f]{32}$' and l.token=p_token and private.marketing_link_available(l);
$$;
revoke all on function public.resolve_marketing_link(text) from public,anon,authenticated,service_role;
grant execute on function public.resolve_marketing_link(text) to anon,authenticated;

-- The issue RPC intentionally uses the source capability, not ledger visibility.
select private.register_operator_rpc_contract('public.admin_issue_marketing_links(text,text[],uuid)','catalog.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_list_marketing_links(text,text,text,integer,integer)','marketing.manage','read',false);
select private.register_operator_internal_contract('private.marketing_link_available(private.marketing_links)'::regprocedure);
select private.register_operator_internal_contract('private.marketing_link_rows(uuid[])'::regprocedure);
select private.register_operator_internal_contract('public.resolve_marketing_link(text)'::regprocedure);
