-- Optional editorial image maps extend the existing relation ledger. Coordinates
-- are integer 1/100-percent values relative to the uncropped source image.
alter table public.goods_relations drop constraint goods_relations_kind_check;
alter table public.goods_relations add constraint goods_relations_kind_check check(kind in ('together','similar','codi'));
alter table public.goods_relations add column image_path text;
alter table public.goods_relations add column image_alt text not null default '';
alter table public.goods_relations add column description text not null default '';
alter table public.goods_relations add constraint goods_relations_visual_fields check(
 char_length(image_alt)<=120 and char_length(description)<=90 and
 ((image_path is null and image_alt='' and description='' and kind<>'codi') or
  (image_path is not null and image_path ~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
   and btrim(image_alt)<>'' and kind in ('together','codi'))));
create table public.goods_relation_hotspots (
 relation_id uuid not null, good_id text not null,
 x integer not null check(x between 0 and 10000), y integer not null check(y between 0 and 10000),
 primary key(relation_id,good_id),
 foreign key(relation_id,good_id) references public.goods_relation_members(relation_id,good_id) on update cascade on delete cascade
);
alter table public.goods_relation_hotspots enable row level security;
revoke all on public.goods_relation_hotspots from public,anon,authenticated,service_role;
grant select on public.goods_relation_hotspots to authenticated;
create policy goods_relation_hotspots_operator_read on public.goods_relation_hotspots for select to authenticated using(public.has_operator_capability('catalog.read'));

create function private.validate_goods_relation_composition(p_values jsonb) returns void
language plpgsql stable set search_path='' as $$
declare relation_kind text; visual jsonb; ids text[]; point jsonb; seen text[]:='{}'; starts_value timestamptz;ends_value timestamptz;
begin
 if jsonb_typeof(p_values) is distinct from 'object'
  or not(p_values ?& array['kind','title','representativeGoodId','enabled','startsAt','endsAt','goodIds','visual'])
  or exists(select 1 from jsonb_object_keys(p_values) key where key<>all(array['kind','title','representativeGoodId','enabled','startsAt','endsAt','goodIds','visual']))
  or jsonb_typeof(p_values->'kind') is distinct from 'string' or p_values->>'kind' not in ('together','similar','codi')
  or jsonb_typeof(p_values->'title') is distinct from 'string' or char_length(btrim(p_values->>'title')) not between 1 and 15
  or jsonb_typeof(p_values->'representativeGoodId') is distinct from 'string' or jsonb_typeof(p_values->'enabled') is distinct from 'boolean'
  or jsonb_typeof(p_values->'goodIds') is distinct from 'array' or jsonb_typeof(p_values->'startsAt') not in ('null','string')
  or jsonb_typeof(p_values->'endsAt') not in ('null','string') or jsonb_typeof(p_values->'visual') not in ('null','object')
 then raise invalid_parameter_value using message='invalid_goods_relation';end if;
 relation_kind:=p_values->>'kind';visual:=nullif(p_values->'visual','null'::jsonb);
 if jsonb_array_length(p_values->'goodIds') not between 2 and (case when visual is not null or relation_kind='codi' then 5 when relation_kind='together' then 6 else 10 end)
  or exists(select 1 from jsonb_array_elements(p_values->'goodIds') item where jsonb_typeof(item)<>'string' or item#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,119}$')
 then raise invalid_parameter_value using message='invalid_goods_relation_goods';end if;
 select array_agg(value order by position) into ids from jsonb_array_elements_text(p_values->'goodIds') with ordinality item(value,position);
 if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) or not(p_values->>'representativeGoodId'=any(ids)) then raise invalid_parameter_value using message='invalid_goods_relation_goods';end if;
 begin starts_value:=(p_values->>'startsAt')::timestamptz;ends_value:=(p_values->>'endsAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then raise invalid_parameter_value using message='invalid_goods_relation_period';end;
 if starts_value is not null and not isfinite(starts_value) or ends_value is not null and not isfinite(ends_value)
  or starts_value is not null and ends_value is not null and starts_value>=ends_value then raise invalid_parameter_value using message='invalid_goods_relation_period';end if;
 if relation_kind='codi' and visual is null or relation_kind='similar' and visual is not null then raise invalid_parameter_value using message='invalid_goods_relation_visual';end if;
 if visual is null then return;end if;
 if not(visual ?& array['imagePath','alt','description','hotspots'])
  or exists(select 1 from jsonb_object_keys(visual) key where key<>all(array['imagePath','alt','description','hotspots']))
  or jsonb_typeof(visual->'imagePath') is distinct from 'string'
  or visual->>'imagePath' !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  or jsonb_typeof(visual->'alt') is distinct from 'string' or char_length(btrim(visual->>'alt')) not between 1 and 120
  or jsonb_typeof(visual->'description') is distinct from 'string' or char_length(btrim(visual->>'description'))>90
  or jsonb_typeof(visual->'hotspots') is distinct from 'array' or jsonb_array_length(visual->'hotspots')>5
 then raise invalid_parameter_value using message='invalid_goods_relation_visual';end if;
 for point in select value from jsonb_array_elements(visual->'hotspots') loop
  if jsonb_typeof(point) is distinct from 'object' or not(point ?& array['goodId','x','y'])
   or exists(select 1 from jsonb_object_keys(point) key where key<>all(array['goodId','x','y']))
   or jsonb_typeof(point->'goodId') is distinct from 'string' or not(point->>'goodId'=any(ids)) or point->>'goodId'=any(seen)
   or jsonb_typeof(point->'x') is distinct from 'number' or point->>'x' !~ '^[0-9]{1,5}$'
   or jsonb_typeof(point->'y') is distinct from 'number' or point->>'y' !~ '^[0-9]{1,5}$'
  then raise invalid_parameter_value using message='invalid_goods_relation_visual';end if;
  if (point->>'x')::integer>10000 or (point->>'y')::integer>10000 then raise invalid_parameter_value using message='invalid_goods_relation_visual';end if;
  seen:=array_append(seen,point->>'goodId');
 end loop;
end $$;
revoke all on function private.validate_goods_relation_composition(jsonb) from public,anon,authenticated,service_role;

create or replace function private.goods_relation_document(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,'representativeGoodId',r.representative_good_id,
  'enabled',r.enabled,'startsAt',r.starts_at,'endsAt',r.ends_at,'revision',r.revision,'createdAt',r.created_at,'updatedAt',r.updated_at,
  'state',case when not r.enabled then 'stopped' when r.starts_at>statement_timestamp() then 'scheduled' when r.ends_at<=statement_timestamp() then 'ended' else 'active' end,
  'visual',case when r.image_path is null then null else jsonb_build_object('imagePath',r.image_path,'alt',r.image_alt,'description',r.description,
   'hotspots',coalesce((select jsonb_agg(jsonb_build_object('goodId',h.good_id,'x',h.x,'y',h.y) order by m.position)
    from public.goods_relation_hotspots h join public.goods_relation_members m using(relation_id,good_id) where h.relation_id=r.id),'[]'::jsonb)) end,
  'goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'imagePath',g.image_path,
   'public',g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null) order by m.position)
   from public.goods_relation_members m join public.goods g on g.id=m.good_id join public.ips i on i.id=g.ip_id where m.relation_id=r.id),'[]'::jsonb))
 from public.goods_relations r where r.id=p_id;
$$;
revoke all on function private.goods_relation_document(uuid) from public,anon,authenticated,service_role;

create function public.admin_save_goods_relation_composition(p_id uuid,p_expected_revision integer,p_operation_id uuid,p_values jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();prior public.goods_relations;saved public.goods_relations;existing public.audit_log;
 request_value jsonb;result_value jsonb;before_document jsonb;visual jsonb;ids text[];bad_id text;image_value text;
begin
 perform private.require_operator_capability('catalog.manage',false);
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 then raise invalid_parameter_value using message='invalid_goods_relation';end if;
 perform private.validate_goods_relation_composition(p_values);
 request_value:=jsonb_build_object('expectedRevision',p_expected_revision,'values',p_values);
 perform pg_advisory_xact_lock(hashtextextended('goods-relation-operation:'||p_operation_id::text,0));
 select * into existing from public.audit_log where id=p_operation_id;
 if found then
  if existing.actor_id=actor and existing.action='admin.goods.relation.saved' and existing.target='goods_relation:'||p_id::text and existing.diff->'request'=request_value then return existing.diff->'result';end if;
  raise sqlstate 'PT409' using message='goods_relation_operation_conflict';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-relation:'||p_id::text,0));
 select * into prior from public.goods_relations where id=p_id for update;
 if found then
  if prior.revision<>p_expected_revision then raise sqlstate 'PT409' using message='goods_relation_changed';end if;
  before_document:=private.goods_relation_document(p_id);
 elsif p_expected_revision<>0 then raise sqlstate 'PT409' using message='goods_relation_changed';end if;
 select array_agg(value order by position) into ids from jsonb_array_elements_text(p_values->'goodIds') with ordinality item(value,position);
 perform 1 from public.goods where id=any(ids) order by id for share;
 -- Retain the existing relation contract: unavailable records can remain in a
 -- composition, while both public readers independently apply visibility gates.
 select requested.id into bad_id from unnest(ids) requested(id) left join public.goods g on g.id=requested.id where g.id is null limit 1;
 if bad_id is not null then raise invalid_parameter_value using message='invalid_goods_relation_goods';end if;
 visual:=nullif(p_values->'visual','null'::jsonb);image_value:=visual->>'imagePath';
 if image_value is not null and image_value is distinct from prior.image_path then
  update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
  where claim.actor_id=actor and claim.kind='curation' and claim.path=substr(image_value,length('public-media/')+1)
   and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
  if not found then raise check_violation using message='unverified_artwork';end if;
 end if;
 if prior.id is null then
  insert into public.goods_relations(id,kind,title,representative_good_id,enabled,starts_at,ends_at,image_path,image_alt,description,created_by,updated_by)
  values(p_id,p_values->>'kind',btrim(p_values->>'title'),p_values->>'representativeGoodId',(p_values->>'enabled')::boolean,
   (p_values->>'startsAt')::timestamptz,(p_values->>'endsAt')::timestamptz,image_value,coalesce(btrim(visual->>'alt'),''),coalesce(btrim(visual->>'description'),''),actor,actor) returning * into saved;
 else
  update public.goods_relations set kind=p_values->>'kind',title=btrim(p_values->>'title'),representative_good_id=p_values->>'representativeGoodId',enabled=(p_values->>'enabled')::boolean,
   starts_at=(p_values->>'startsAt')::timestamptz,ends_at=(p_values->>'endsAt')::timestamptz,image_path=image_value,image_alt=coalesce(btrim(visual->>'alt'),''),description=coalesce(btrim(visual->>'description'),''),
   revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id=p_id returning * into saved;
 end if;
 -- Member replacement cascades old points; recreated points must target the new members.
 delete from public.goods_relation_members where relation_id=p_id;
 insert into public.goods_relation_members(relation_id,good_id,position) select p_id,id,position::integer from unnest(ids) with ordinality item(id,position);
 if visual is not null then
  insert into public.goods_relation_hotspots(relation_id,good_id,x,y) select p_id,item->>'goodId',(item->>'x')::integer,(item->>'y')::integer from jsonb_array_elements(visual->'hotspots')item;
 end if;
 result_value:=jsonb_build_object('id',p_id,'revision',saved.revision);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods.relation.saved','goods_relation:'||p_id,
  jsonb_build_object('request',request_value,'before',before_document,'after',private.goods_relation_document(p_id),'result',result_value));
 return result_value;
end $$;
revoke all on function public.admin_save_goods_relation_composition(uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_relation_composition(uuid,integer,uuid,jsonb) to authenticated;

-- Preserve the list API for existing callers; it cannot silently erase a newer image map.
create or replace function public.admin_save_goods_relation(p_id uuid,p_expected_revision integer,p_values jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_operator_capability('catalog.manage',false);
 if jsonb_typeof(p_values) is distinct from 'object' or p_values ? 'visual' or p_values->>'kind' not in ('together','similar')
  or exists(select 1 from public.goods_relations where id=p_id and image_path is not null) then raise invalid_parameter_value using message='goods_relation_visual_required';end if;
 return public.admin_save_goods_relation_composition(p_id,p_expected_revision,gen_random_uuid(),p_values||'{"visual":null}'::jsonb);
end $$;
revoke all on function public.admin_save_goods_relation(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_relation(uuid,integer,jsonb) to authenticated;

create or replace function public.admin_list_goods_relations(p_query text default '',p_kind text default 'all',p_state text default 'all',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_operator_capability('catalog.read') then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_kind is null or p_kind not in ('all','together','similar','codi')
  or p_state is null or p_state not in ('all','active','scheduled','stopped','ended') or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (20,50,100)
 then raise invalid_parameter_value using message='invalid_goods_relation_filter';end if;
 with matched as materialized (
  select r.*,case when not r.enabled then 'stopped' when r.starts_at>statement_timestamp() then 'scheduled' when r.ends_at<=statement_timestamp() then 'ended' else 'active' end state
  from public.goods_relations r where (p_kind='all' or r.kind=p_kind) and (btrim(p_query)='' or strpos(lower(r.title),lower(btrim(p_query)))>0 or strpos(r.id::text,btrim(p_query))>0
   or exists(select 1 from public.goods_relation_members m join public.goods g on g.id=m.good_id where m.relation_id=r.id
    and (strpos(lower(g.name),lower(btrim(p_query)))>0 or strpos(lower(g.code),lower(btrim(p_query)))>0 or strpos(g.id,btrim(p_query))>0)))
 ),filtered as materialized(select * from matched where p_state='all' or state=p_state),page_rows as(select id,updated_at from filtered order by updated_at desc,id limit p_page_size offset(p_page-1)*p_page_size)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,'rows',coalesce((select jsonb_agg(private.goods_relation_document(id) order by updated_at desc,id) from page_rows),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_list_goods_relations(text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_relations(text,text,text,integer,integer) to authenticated;

create function public.get_good_relation_compositions(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 with matching as materialized(
  select r.* from public.goods_relations r where r.enabled and
   ((r.kind='together' and r.image_path is null and r.representative_good_id=p_good_id)
    or ((r.kind in ('similar','codi') or r.image_path is not null) and exists(select 1 from public.goods_relation_members m where m.relation_id=r.id and m.good_id=p_good_id)))
 ),public_members as materialized(
  select m.relation_id,m.good_id,m.position from public.goods_relation_members m join matching r on r.id=m.relation_id join public.goods g on g.id=m.good_id join public.ips i on i.id=g.ip_id
  where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null
 ),eligible as materialized(
  select r.* from matching r where (select count(*) from public_members m where m.relation_id=r.id)>=2
   and exists(select 1 from public_members m where m.relation_id=r.id and m.good_id=p_good_id)
   and exists(select 1 from public_members m where m.relation_id=r.id and m.good_id=r.representative_good_id)
 ),active as(select * from eligible where (starts_at is null or starts_at<=statement_timestamp()) and (ends_at is null or ends_at>statement_timestamp()))
 select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,'representativeGoodId',r.representative_good_id,
  'goodIds',(select jsonb_agg(m.good_id order by m.position) from public_members m where m.relation_id=r.id and m.good_id<>p_good_id),
  'allGoodIds',(select jsonb_agg(m.good_id order by m.position) from public_members m where m.relation_id=r.id),
  'visual',case when r.image_path is null then null else jsonb_build_object('imagePath',r.image_path,'alt',r.image_alt,'description',r.description,
   'hotspots',coalesce((select jsonb_agg(jsonb_build_object('goodId',h.good_id,'x',h.x,'y',h.y) order by m.position)
    from public.goods_relation_hotspots h join public_members m using(relation_id,good_id) where h.relation_id=r.id),'[]'::jsonb)) end)
  order by case r.kind when 'codi' then 0 when 'together' then 1 else 2 end,r.created_at,r.id) from active r),'[]'::jsonb),
  'nextChangeAt',(select min(boundary) from eligible r cross join lateral(values(r.starts_at),(r.ends_at))changes(boundary) where boundary>statement_timestamp()));
$$;
revoke all on function public.get_good_relation_compositions(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_relation_compositions(text) to anon,authenticated;

create or replace function private.goods_photo_references(target_path text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind) order by kind,id),'[]') from (
  select g.id,g.name,'good'::text kind from public.goods g
   where target_path=any(array_remove(array[g.image_path,g.detail_image_path]||coalesce(g.gallery_paths,'{}')||coalesce(g.description_image_paths,'{}'),null))
  union all select c.id::text,c.title,'curation' from public.home_curations c where to_jsonb(c)::text like '%'||substr(target_path,14)||'%'
  union all select 'store','스토어 로고','store' from public.store_settings s where to_jsonb(s)::text like '%'||substr(target_path,14)||'%'
  union all select d.id::text,'개인 임시저장 상품','draft' from public.admin_goods_drafts d where d.archived_at is null and target_path=any(d.image_paths)
  union all select s.id::text,s.title,'story' from public.shopping_stories s where target_path=any(s.body_image_paths)
  union all select r.id::text,r.title,'relation' from public.goods_relations r where target_path=r.image_path
 ) refs;
$$;
revoke all on function private.goods_photo_references(text) from public,anon,authenticated,service_role;
do $$begin
 perform private.register_operator_rpc_contract('public.admin_save_goods_relation_composition(uuid,integer,uuid,jsonb)'::regprocedure,'catalog.manage','write',false);
 perform private.register_operator_rpc_contract('public.admin_save_goods_relation(uuid,integer,jsonb)'::regprocedure,'catalog.manage','write',false);
 perform private.register_operator_rpc_contract('public.admin_list_goods_relations(text,text,text,integer,integer)'::regprocedure,'catalog.read','read',false);
 perform private.register_operator_policy_contract('public.goods_relation_hotspots'::regclass,'goods_relation_hotspots_operator_read','catalog.read');
 perform private.register_operator_internal_contract('private.validate_goods_relation_composition(jsonb)'::regprocedure);
 perform private.register_operator_internal_contract('private.goods_relation_document(uuid)'::regprocedure);
 perform private.register_operator_internal_contract('private.goods_photo_references(text)'::regprocedure);
 perform private.register_operator_internal_contract('public.get_good_relation_compositions(text)'::regprocedure);
end $$;
