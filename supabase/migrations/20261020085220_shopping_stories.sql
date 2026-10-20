-- Editorial shopping stories are separate from reward/event campaigns.
-- Public order is immutable creation time, then UUID; edits never move a story.
create table public.shopping_stories (
  id uuid primary key,
  reference bigint generated always as identity unique,
  title text not null check(char_length(btrim(title)) between 1 and 50),
  body_html text not null check(char_length(body_html) between 1 and 30000),
  body_image_paths text[] not null default '{}' check(cardinality(body_image_paths)<=20),
  starts_at timestamptz,
  ends_at timestamptz,
  revision integer not null default 1 check(revision>0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  check(starts_at is null or ends_at is null or starts_at<ends_at)
);
create index shopping_stories_created_idx on public.shopping_stories(created_at desc,id desc) where deleted_at is null;
create index shopping_stories_window_idx on public.shopping_stories(starts_at,ends_at) where deleted_at is null;

create table public.shopping_story_sections (
  id uuid primary key,
  story_id uuid not null references public.shopping_stories(id) on delete cascade,
  title text not null check(char_length(btrim(title)) between 1 and 13),
  image_shape text not null default 'square' check(image_shape in ('square','portrait')),
  sort_order integer not null check(sort_order between 0 and 9),
  unique(id,story_id),
  unique(story_id,sort_order)
);
create table public.shopping_story_goods (
  story_id uuid not null references public.shopping_stories(id) on delete cascade,
  section_id uuid not null,
  good_id text not null references public.goods(id) on update cascade on delete cascade,
  sort_order integer not null check(sort_order between 0 and 199),
  primary key(story_id,good_id),
  foreign key(section_id,story_id) references public.shopping_story_sections(id,story_id) on delete cascade,
  unique(section_id,sort_order)
);
create index shopping_story_goods_good_idx on public.shopping_story_goods(good_id,story_id);

alter table public.shopping_stories enable row level security;
alter table public.shopping_story_sections enable row level security;
alter table public.shopping_story_goods enable row level security;
revoke all on public.shopping_stories,public.shopping_story_sections,public.shopping_story_goods from public,anon,authenticated,service_role;
grant select on public.shopping_stories,public.shopping_story_sections,public.shopping_story_goods to authenticated;
create policy shopping_stories_operator_read on public.shopping_stories for select to authenticated using(public.has_operator_capability('store.manage'));
create policy shopping_story_sections_operator_read on public.shopping_story_sections for select to authenticated using(public.has_operator_capability('store.manage'));
create policy shopping_story_goods_operator_read on public.shopping_story_goods for select to authenticated using(public.has_operator_capability('store.manage'));

-- Attached claims are only cleaned from staging. Keep the additional reference
-- catalogue accurate as well: deleted stories retain their audit source and
-- therefore continue protecting their uploaded images from manual archival.
create or replace function private.goods_photo_references(target_path text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind) order by kind,id),'[]') from (
  select g.id,g.name,'good'::text kind from public.goods g
   where target_path=any(array_remove(array[g.image_path,g.detail_image_path]||coalesce(g.gallery_paths,'{}')||coalesce(g.description_image_paths,'{}'),null))
  union all select c.id::text,c.title,'curation' from public.home_curations c where to_jsonb(c)::text like '%'||substr(target_path,14)||'%'
  union all select 'store','스토어 로고','store' from public.store_settings s where to_jsonb(s)::text like '%'||substr(target_path,14)||'%'
  union all select d.id::text,'개인 임시저장 상품','draft' from public.admin_goods_drafts d where d.archived_at is null and target_path=any(d.image_paths)
  union all select s.id::text,s.title,'story' from public.shopping_stories s where target_path=any(s.body_image_paths)
 ) refs;
$$;
revoke all on function private.goods_photo_references(text) from public,anon,authenticated,service_role;

create function private.shopping_story_state(p_starts timestamptz,p_ends timestamptz,p_at timestamptz)
returns text language sql immutable set search_path='' as $$
 select case when p_ends is not null and p_ends<=p_at then 'ended'
   when p_starts is not null and p_starts>p_at then 'scheduled' else 'active' end;
$$;
revoke all on function private.shopping_story_state(timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function private.validate_shopping_story_values(p_values jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare section_value jsonb; item jsonb; image_value jsonb; section_ids uuid[]:='{}'; good_ids text[]:='{}'; images text[]:='{}'; section_id uuid; start_value timestamptz; end_value timestamptz;
begin
 if p_values is null or jsonb_typeof(p_values)<>'object'
  or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('title','bodyHtml','imagePaths','startsAt','endsAt','sections'))
  or not(p_values ?& array['title','bodyHtml','imagePaths','startsAt','endsAt','sections'])
  or jsonb_typeof(p_values->'title')<>'string' or char_length(btrim(p_values->>'title')) not between 1 and 50
  or jsonb_typeof(p_values->'bodyHtml')<>'string' or char_length(p_values->>'bodyHtml') not between 1 and 30000
  or jsonb_typeof(p_values->'imagePaths')<>'array' or jsonb_array_length(p_values->'imagePaths')>20
  or jsonb_typeof(p_values->'sections')<>'array' or jsonb_array_length(p_values->'sections')>10
  or jsonb_typeof(p_values->'startsAt') not in ('null','string') or jsonb_typeof(p_values->'endsAt') not in ('null','string')
  or (p_values->>'startsAt' is not null and (p_values->>'startsAt')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$')
  or (p_values->>'endsAt' is not null and (p_values->>'endsAt')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$')
 then raise invalid_parameter_value using message='invalid_shopping_story';end if;
 begin
  start_value:=(p_values->>'startsAt')::timestamptz; end_value:=(p_values->>'endsAt')::timestamptz;
 exception when others then raise invalid_parameter_value using message='invalid_shopping_story_window';end;
 if (start_value is not null and not isfinite(start_value)) or (end_value is not null and not isfinite(end_value))
  or (start_value is not null and end_value is not null and start_value>=end_value)
 then raise invalid_parameter_value using message='invalid_shopping_story_window';end if;
 for image_value in select value from jsonb_array_elements(p_values->'imagePaths') loop
  if jsonb_typeof(image_value)<>'string' or (image_value#>>'{}')!~'^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
   or (image_value#>>'{}')=any(images) then raise invalid_parameter_value using message='invalid_shopping_story_images';end if;
  images:=array_append(images,image_value#>>'{}');
 end loop;
 for section_value in select value from jsonb_array_elements(p_values->'sections') loop
  if jsonb_typeof(section_value)<>'object'
   or exists(select 1 from jsonb_object_keys(section_value) k where k not in ('id','title','imageShape','goodIds'))
   or not(section_value ?& array['id','title','imageShape','goodIds'])
   or jsonb_typeof(section_value->'id')<>'string' or (section_value->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(section_value->'title')<>'string' or char_length(btrim(section_value->>'title')) not between 1 and 13
   or jsonb_typeof(section_value->'imageShape')<>'string' or section_value->>'imageShape' not in ('square','portrait')
   or jsonb_typeof(section_value->'goodIds')<>'array' or jsonb_array_length(section_value->'goodIds') not between 1 and 200
  then raise invalid_parameter_value using message='invalid_shopping_story_section';end if;
  section_id:=(section_value->>'id')::uuid;
  if section_id=any(section_ids) then raise invalid_parameter_value using message='invalid_shopping_story_section';end if;
  section_ids:=array_append(section_ids,section_id);
  for item in select value from jsonb_array_elements(section_value->'goodIds') loop
   if jsonb_typeof(item)<>'string' or (item#>>'{}')!~'^[a-z0-9][a-z0-9-]{0,119}$' or (item#>>'{}')=any(good_ids)
   then raise invalid_parameter_value using message='invalid_shopping_story_goods';end if;
   good_ids:=array_append(good_ids,item#>>'{}');
  end loop;
 end loop;
 if cardinality(good_ids)>300 then raise invalid_parameter_value using message='shopping_story_goods_limit';end if;
end;
$$;
revoke all on function private.validate_shopping_story_values(jsonb) from public,anon,authenticated,service_role;

create function private.shopping_story_document(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'reference',s.reference,'title',s.title,'bodyHtml',s.body_html,'imagePaths',to_jsonb(s.body_image_paths),
  'startsAt',s.starts_at,'endsAt',s.ends_at,'revision',s.revision,'createdAt',s.created_at,'updatedAt',s.updated_at,
  'state',private.shopping_story_state(s.starts_at,s.ends_at,statement_timestamp()),
  'sectionCount',(select count(*) from public.shopping_story_sections x where x.story_id=s.id),
  'goodCount',(select count(*) from public.shopping_story_goods x where x.story_id=s.id),
  'sections',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'imageShape',x.image_shape,
    'goodIds',coalesce((select jsonb_agg(g.good_id order by g.sort_order) from public.shopping_story_goods g where g.section_id=x.id),'[]'::jsonb)) order by x.sort_order)
    from public.shopping_story_sections x where x.story_id=s.id),'[]'::jsonb))
 from public.shopping_stories s where s.id=p_id;
$$;
revoke all on function private.shopping_story_document(uuid) from public,anon,authenticated,service_role;

create function public.admin_save_shopping_story(p_id uuid,p_expected_revision integer,p_operation_id uuid,p_values jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.shopping_stories; saved public.shopping_stories; existing public.audit_log;
 request_value jsonb; result_value jsonb; before_value jsonb; image_paths text[]; image_path text; ids text[]; bad_good text; section_value jsonb; section_position bigint; good_value text; good_position bigint;
begin
 perform private.require_operator_capability('store.manage',false);
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 then raise invalid_parameter_value using message='invalid_shopping_story';end if;
 perform private.validate_shopping_story_values(p_values);
 request_value:=jsonb_build_object('expectedRevision',p_expected_revision,'values',p_values);
 perform pg_advisory_xact_lock(hashtextextended('shopping-story-operation:'||p_operation_id::text,0));
 select * into existing from public.audit_log where id=p_operation_id;
 if found then
  if existing.actor_id=actor and existing.action='admin.shopping_story.saved' and existing.target='shopping_stories:'||p_id::text and existing.diff->'request'=request_value
  then return existing.diff->'result';end if;
  raise sqlstate 'PT409' using message='shopping_story_operation_conflict';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('shopping-story:'||p_id::text,0));
 select * into previous from public.shopping_stories where id=p_id for update;
 if found then
  if previous.deleted_at is not null then raise no_data_found using message='shopping_story_not_found';end if;
  if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='shopping_story_conflict';end if;
  before_value:=private.shopping_story_document(p_id);
 elsif p_expected_revision<>0 then raise no_data_found using message='shopping_story_not_found';end if;
 select coalesce(array_agg(value order by value),'{}') into image_paths from jsonb_array_elements_text(p_values->'imagePaths');
 select coalesce(array_agg(good_id order by good_id),'{}') into ids
 from jsonb_array_elements(p_values->'sections') section_entry cross join lateral jsonb_array_elements_text(section_entry->'goodIds') good_id;
 -- Lock every reference in deterministic order; all 300 identifiers are checked
 -- inside Postgres, independent of PostgREST's default row limit.
 perform 1 from public.goods g where g.id=any(ids) order by g.id for share;
 select input.id into bad_good from unnest(ids) input(id) left join public.goods g on g.id=input.id left join public.ips ip on ip.id=g.ip_id
 where g.id is null or ((g.archived_at is not null or ip.archived_at is not null) and not exists(
  select 1 from public.shopping_story_goods old_link where old_link.story_id=p_id and old_link.good_id=input.id)) limit 1;
 if bad_good is not null then raise check_violation using message='shopping_story_good_unavailable';end if;
 if exists(select 1 from public.shopping_story_sections x where x.story_id<>p_id and x.id in
  (select (entry->>'id')::uuid from jsonb_array_elements(p_values->'sections') entry)) then raise invalid_parameter_value using message='invalid_shopping_story_section';end if;
 foreach image_path in array image_paths loop
  if image_path=any(coalesce(previous.body_image_paths,'{}')) then continue;end if;
  update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
  where claim.actor_id=actor and claim.kind='curation' and claim.path=substr(image_path,length('public-media/')+1)
   and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
  if not found then raise check_violation using message='unverified_artwork';end if;
 end loop;
 if previous.id is null then
  insert into public.shopping_stories(id,title,body_html,body_image_paths,starts_at,ends_at,created_by,updated_by)
  values(p_id,btrim(p_values->>'title'),p_values->>'bodyHtml',image_paths,(p_values->>'startsAt')::timestamptz,(p_values->>'endsAt')::timestamptz,actor,actor) returning * into saved;
 else
  update public.shopping_stories set title=btrim(p_values->>'title'),body_html=p_values->>'bodyHtml',body_image_paths=image_paths,
   starts_at=(p_values->>'startsAt')::timestamptz,ends_at=(p_values->>'endsAt')::timestamptz,revision=revision+1,updated_at=clock_timestamp(),updated_by=actor
  where id=p_id returning * into saved;
 end if;
 delete from public.shopping_story_sections where story_id=p_id;
 for section_value,section_position in select value,ordinality-1 from jsonb_array_elements(p_values->'sections') with ordinality loop
  insert into public.shopping_story_sections(id,story_id,title,image_shape,sort_order)
  values((section_value->>'id')::uuid,p_id,btrim(section_value->>'title'),section_value->>'imageShape',section_position::integer);
  for good_value,good_position in select value,ordinality-1 from jsonb_array_elements_text(section_value->'goodIds') with ordinality loop
   insert into public.shopping_story_goods(story_id,section_id,good_id,sort_order) values(p_id,(section_value->>'id')::uuid,good_value,good_position::integer);
  end loop;
 end loop;
 result_value:=jsonb_build_object('id',saved.id,'reference',saved.reference,'revision',saved.revision);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.shopping_story.saved','shopping_stories:'||p_id::text,
  jsonb_build_object('request',request_value,'before',before_value,'after',private.shopping_story_document(p_id),'result',result_value));
 return result_value;
end;
$$;
revoke all on function public.admin_save_shopping_story(uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_shopping_story(uuid,integer,uuid,jsonb) to authenticated;

create function public.admin_delete_shopping_stories(p_operation_id uuid,p_entries jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.audit_log; entry jsonb; target_id uuid; ids uuid[]:='{}'; current_story public.shopping_stories; before_rows jsonb:='[]'; result_value jsonb;
begin
 perform private.require_operator_capability('store.manage',false);
 if p_operation_id is null or p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 100
 then raise invalid_parameter_value using message='invalid_shopping_story_delete';end if;
 for entry in select value from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(entry)<>'object' or not(entry ?& array['id','revision']) or exists(select 1 from jsonb_object_keys(entry) k where k not in ('id','revision'))
   or jsonb_typeof(entry->'id')<>'string' or (entry->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(entry->'revision')<>'number' or (entry->>'revision')!~'^[1-9][0-9]{0,8}$' then raise invalid_parameter_value using message='invalid_shopping_story_delete';end if;
  target_id:=(entry->>'id')::uuid;
  if target_id=any(ids) then raise invalid_parameter_value using message='invalid_shopping_story_delete';end if;
  ids:=array_append(ids,target_id);
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('shopping-story-operation:'||p_operation_id::text,0));
 select * into existing from public.audit_log where id=p_operation_id;
 if found then
  if existing.actor_id=actor and existing.action='admin.shopping_stories.deleted' and existing.target='shopping_stories' and existing.diff->'request'=p_entries then return existing.diff->'result';end if;
  raise sqlstate 'PT409' using message='shopping_story_operation_conflict';
 end if;
 for target_id in select value from unnest(ids) value order by value loop
  perform pg_advisory_xact_lock(hashtextextended('shopping-story:'||target_id::text,0));
  select * into current_story from public.shopping_stories where id=target_id for update;
  if not found or current_story.deleted_at is not null then raise no_data_found using message='shopping_story_not_found';end if;
  if current_story.revision<>(select (value->>'revision')::integer from jsonb_array_elements(p_entries) where (value->>'id')::uuid=target_id)
  then raise sqlstate 'PT409' using message='shopping_story_conflict';end if;
  before_rows:=before_rows||jsonb_build_array(jsonb_build_object('id',current_story.id,'title',current_story.title,'revision',current_story.revision));
 end loop;
 update public.shopping_stories set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=actor,revision=revision+1 where id=any(ids);
 result_value:=jsonb_build_object('deletedCount',cardinality(ids));
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.shopping_stories.deleted','shopping_stories',
  jsonb_build_object('request',p_entries,'before',before_rows,'result',result_value));
 return result_value;
end;
$$;
revoke all on function public.admin_delete_shopping_stories(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_delete_shopping_stories(uuid,jsonb) to authenticated;

create function public.admin_get_shopping_story(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result_value jsonb;
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if not exists(select 1 from public.shopping_stories where id=p_id and deleted_at is null) then return null;end if;
 result_value:=private.shopping_story_document(p_id);
 return result_value||jsonb_build_object('goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,
  'imagePath',g.image_path,'price',g.price,'archived',g.archived_at is not null or ip.archived_at is not null,
  'published',g.published_at is not null and ip.published_at is not null and g.archived_at is null and ip.archived_at is null and g.sale_restriction='none',
  'soldOut',g.stock='soldout' or coalesce(g.stock_qty,0)<=0) order by g.id)
  from public.shopping_story_goods links join public.goods g on g.id=links.good_id join public.ips ip on ip.id=g.ip_id where links.story_id=p_id),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_get_shopping_story(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_shopping_story(uuid) to authenticated;

create function public.admin_list_shopping_stories(p_query text default '',p_state text default 'all',p_from date default null,p_to date default null,p_sort text default 'created_desc',p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=statement_timestamp(); result_value jsonb;
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_state is null or p_state not in ('all','scheduled','active','ended')
  or p_sort is null or p_sort not in ('created_desc','created_asc','updated_desc') or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0
  or (p_from is not null and p_to is not null and p_from>p_to) then raise invalid_parameter_value using message='invalid_shopping_story_filter';end if;
 with filtered as (
  select s.*,private.shopping_story_state(s.starts_at,s.ends_at,at_value) display_state from public.shopping_stories s
  where s.deleted_at is null and (p_query='' or position(lower(p_query) in lower(s.title))>0)
   and (p_state='all' or private.shopping_story_state(s.starts_at,s.ends_at,at_value)=p_state)
   and (p_from is null or s.created_at>=p_from::timestamp at time zone 'Asia/Seoul')
   and (p_to is null or s.created_at<(p_to+1)::timestamp at time zone 'Asia/Seoul')
 ), page as (
  select * from filtered order by case when p_sort='created_asc' then created_at end asc,
   case when p_sort='updated_desc' then updated_at end desc,created_at desc,id desc limit p_limit offset p_offset
 ) select jsonb_build_object('total',(select count(*) from filtered),'checkedAt',at_value,'rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'reference',p.reference,'title',p.title,'startsAt',p.starts_at,'endsAt',p.ends_at,'state',p.display_state,'revision',p.revision,
  'createdAt',p.created_at,'updatedAt',p.updated_at,'sectionCount',(select count(*) from public.shopping_story_sections x where x.story_id=p.id),
  'goodCount',(select count(*) from public.shopping_story_goods x where x.story_id=p.id)) order by case when p_sort='created_asc' then p.created_at end asc,
   case when p_sort='updated_desc' then p.updated_at end desc,p.created_at desc,p.id desc) from page p),'[]'::jsonb)) into result_value;
 return result_value;
end;
$$;
revoke all on function public.admin_list_shopping_stories(text,text,date,date,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_shopping_stories(text,text,date,date,text,integer,integer) to authenticated;

create function public.admin_search_shopping_story_goods(p_query text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result_value jsonb;
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 1000000 then raise invalid_parameter_value using message='invalid_shopping_story_goods_search';end if;
 with filtered as (
  select g.*,ip.published_at as ip_published_at from public.goods g join public.ips ip on ip.id=g.ip_id
  where g.archived_at is null and ip.archived_at is null and (p_query='' or position(lower(p_query) in lower(g.name||' '||g.code||' '||g.id))>0)
 ), page as (select * from filtered order by name,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('page',p_page,'pageSize',20,'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'name',p.name,'code',p.code,'imagePath',p.image_path,'price',p.price,'archived',false,
  'published',p.published_at is not null and p.ip_published_at is not null and p.sale_restriction='none',
  'soldOut',p.stock='soldout' or coalesce(p.stock_qty,0)<=0) order by p.name,p.id) from page p),'[]'::jsonb)) into result_value;
 return result_value;
end;
$$;
revoke all on function public.admin_search_shopping_story_goods(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_shopping_story_goods(text,integer) to authenticated;

create function public.get_shopping_stories(p_limit integer default 12,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=statement_timestamp(); result_value jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise invalid_parameter_value using message='invalid_shopping_story_page';end if;
 with visible as (select * from public.shopping_stories s where deleted_at is null and private.shopping_story_state(starts_at,ends_at,at_value)='active'),
 page as (select * from visible order by created_at desc,id desc limit p_limit offset p_offset)
 select jsonb_build_object('total',(select count(*) from visible),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'reference',p.reference,
  'title',p.title,'bodyHtml',p.body_html,'imagePaths',to_jsonb(p.body_image_paths),'createdAt',p.created_at,'startsAt',p.starts_at,'endsAt',p.ends_at) order by p.created_at desc,p.id desc) from page p),'[]'::jsonb),
  'nextChangeAt',(select min(boundary) from public.shopping_stories s cross join lateral (values(s.starts_at),(s.ends_at)) dates(boundary) where s.deleted_at is null and dates.boundary>at_value)) into result_value;
 return result_value;
end;
$$;
revoke all on function public.get_shopping_stories(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_shopping_stories(integer,integer) to anon,authenticated;

create function public.get_shopping_story(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=statement_timestamp(); story public.shopping_stories;
begin
 select * into story from public.shopping_stories s where s.id=p_id and s.deleted_at is null and private.shopping_story_state(s.starts_at,s.ends_at,at_value)='active';
 if not found then return null;end if;
 return jsonb_build_object('id',story.id,'reference',story.reference,'title',story.title,'bodyHtml',story.body_html,
  'imagePaths',to_jsonb(story.body_image_paths),'createdAt',story.created_at,'startsAt',story.starts_at,'endsAt',story.ends_at,'nextChangeAt',story.ends_at,
  'sections',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'imageShape',x.image_shape,
   'goodIds',coalesce((select jsonb_agg(links.good_id order by links.sort_order) from public.shopping_story_goods links join public.goods g on g.id=links.good_id join public.ips ip on ip.id=g.ip_id
    where links.section_id=x.id and g.archived_at is null and g.published_at is not null and ip.archived_at is null and ip.published_at is not null and g.sale_restriction='none'),'[]'::jsonb)) order by x.sort_order)
    from public.shopping_story_sections x where x.story_id=p_id),'[]'::jsonb),
  -- A single JSON aggregate contains every related product. It cannot be cut
  -- to a PostgREST row page, and 300 long IDs never become an oversized GET URL.
  'goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'price',g.price,'compareAtPrice',g.compare_at_price,
   'showDiscountRate',g.show_discount_rate,'badge',g.badge,'stock',g.stock,'imagePath',g.image_path,'bg',g.bg,
   'variants',coalesce((select jsonb_agg(jsonb_build_object('price',v.price,'pricing',public.goods_variant_pricing(v),'supply',public.goods_variant_supply(v)) order by v.id)
    from public.goods_variants v where v.good_id=g.id and v.archived_at is null),'[]'::jsonb)) order by g.id)
   from public.shopping_story_goods links join public.goods g on g.id=links.good_id join public.ips ip on ip.id=g.ip_id
   where links.story_id=p_id and g.archived_at is null and g.published_at is not null and ip.archived_at is null and ip.published_at is not null and g.sale_restriction='none'),'[]'::jsonb));
end;
$$;
revoke all on function public.get_shopping_story(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_shopping_story(uuid) to anon,authenticated;

do $$ begin
 perform private.register_operator_rpc_contract('public.admin_save_shopping_story(uuid,integer,uuid,jsonb)'::regprocedure,'store.manage','write',false);
 perform private.register_operator_rpc_contract('public.admin_delete_shopping_stories(uuid,jsonb)'::regprocedure,'store.manage','write',false);
 perform private.register_operator_rpc_contract('public.admin_get_shopping_story(uuid)'::regprocedure,'store.manage','read',false);
 perform private.register_operator_rpc_contract('public.admin_list_shopping_stories(text,text,date,date,text,integer,integer)'::regprocedure,'store.manage','read',false);
 perform private.register_operator_rpc_contract('public.admin_search_shopping_story_goods(text,integer)'::regprocedure,'store.manage','read',false);
 perform private.register_operator_policy_contract('public.shopping_stories'::regclass,'shopping_stories_operator_read','store.manage');
 perform private.register_operator_policy_contract('public.shopping_story_sections'::regclass,'shopping_story_sections_operator_read','store.manage');
 perform private.register_operator_policy_contract('public.shopping_story_goods'::regclass,'shopping_story_goods_operator_read','store.manage');
 perform private.register_operator_internal_contract('public.get_shopping_story(uuid)'::regprocedure);
 perform private.register_operator_internal_contract('public.get_shopping_stories(integer,integer)'::regprocedure);
 perform private.register_operator_internal_contract('private.shopping_story_state(timestamptz,timestamptz,timestamptz)'::regprocedure);
 perform private.register_operator_internal_contract('private.validate_shopping_story_values(jsonb)'::regprocedure);
 perform private.register_operator_internal_contract('private.shopping_story_document(uuid)'::regprocedure);
 perform private.register_operator_internal_contract('private.goods_photo_references(text)'::regprocedure);
end $$;
