-- Independent display taxonomy. Clone-verified and applied to local OWN/FRESH/CANON.
-- Existing display UUIDs and composition/source/goods/artwork rows are preserved.
create table private.category_display_nodes (
 id uuid primary key default gen_random_uuid(),
 parent_id uuid references private.category_display_nodes(id) on delete restrict deferrable initially deferred,
 name text not null check(btrim(name)<>''),
 sort_order integer not null check(sort_order>=0),
 archived_at timestamptz,
 legacy_category_id uuid references public.catalog_categories(id) on delete set null,
 legacy_sort_key text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(parent_id is distinct from id)
);
create index category_display_nodes_parent on private.category_display_nodes(parent_id,sort_order,id);
create table private.category_display_tree_control (
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 0 check(revision>=0)
);
alter table private.category_display_nodes enable row level security;
alter table private.category_display_tree_control enable row level security;
revoke all on private.category_display_nodes,private.category_display_tree_control from public,anon,authenticated,service_role;
grant all on private.category_display_nodes,private.category_display_tree_control to postgres;
insert into private.category_display_tree_control(singleton) values(true);
insert into private.category_display_nodes(id,parent_id,name,sort_order,archived_at,legacy_category_id,legacy_sort_key,created_at,updated_at)
 select id,parent_id,name,sort_order,archived_at,id,code,created_at,updated_at from public.catalog_categories;
alter table private.category_display_compositions drop constraint category_display_compositions_category_id_fkey;
alter table private.category_display_compositions add constraint category_display_compositions_category_id_fkey
 foreign key(category_id) references private.category_display_nodes(id) on delete restrict;

-- Source categories still mean merchandise taxonomy; display nodes are separate.
create function private.category_display_source_category(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with recursive lineage as (
  select c.id,c.parent_id,c.archived_at,1 as hops from public.catalog_categories c where c.id=p_id
  union all select p.id,p.parent_id,p.archived_at,l.hops+1 from public.catalog_categories p join lineage l on p.id=l.parent_id where l.hops<4
 ) select jsonb_build_object('id',c.id,'name',c.name,'parentId',c.parent_id,'depth',c.depth,'sortOrder',c.sort_order,
  'publicEnabled',coalesce((select customer_enabled from public.category_activation_control where id='catalog'),false)
    and not exists(select 1 from lineage where archived_at is not null)
    and exists(select 1 from lineage where parent_id is null))
 from public.catalog_categories c where c.id=p_id and c.archived_at is null;
$$;
revoke all on function private.category_display_source_category(uuid) from public,anon,authenticated,service_role;
grant execute on function private.category_display_source_category(uuid) to postgres;

create or replace function private.category_display_category(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with recursive lineage as (
  select c.id,c.parent_id,c.archived_at,1 as hops from private.category_display_nodes c where c.id=p_id
  union all select p.id,p.parent_id,p.archived_at,l.hops+1 from private.category_display_nodes p join lineage l on p.id=l.parent_id where l.hops<4
 ) select jsonb_build_object('id',c.id,'name',c.name,'parentId',c.parent_id,'depth',(select count(*) from lineage),'sortOrder',c.sort_order,
  'archivedAt',c.archived_at,'legacyCategoryId',c.legacy_category_id,
  'publicEnabled',coalesce((select customer_enabled from public.category_activation_control where id='catalog'),false)
    and not exists(select 1 from lineage where archived_at is not null)
    and exists(select 1 from lineage where parent_id is null))
 from private.category_display_nodes c where c.id=p_id;
$$;
create or replace function private.category_display_defaults(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('enabled',false,'mode','categories',
  'categoryIds',coalesce((select jsonb_build_array(n.legacy_category_id) from private.category_display_nodes n
   where n.id=p_id and n.legacy_category_id is not null and private.category_display_source_category(n.legacy_category_id) is not null),'[]'::jsonb),'goodIds','[]'::jsonb,
  'banner',jsonb_build_object('enabled',false,'imagePath',null,'mobileImagePath',null,'title','','content','','altEnabled',false,'altTitle','','altContent','','linkPath',null,'imageDim','none','textColor','white'),
  'video',jsonb_build_object('enabled',false,'goodId',null),'recommendations',jsonb_build_object('enabled',false,'title','추천상품','itemCount',3,'goodIds','[]'::jsonb));
$$;

create or replace function public.admin_list_category_displays() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 return jsonb_build_object('checkedAt',statement_timestamp(),'revision',(select revision from private.category_display_tree_control where singleton),
 'categories',coalesce((with recursive tree as (
  select n.id,array[lpad(n.sort_order::text,10,'0')||':'||coalesce(n.legacy_sort_key,n.id::text)] path from private.category_display_nodes n where n.parent_id is null
  union all select n.id,t.path||(lpad(n.sort_order::text,10,'0')||':'||coalesce(n.legacy_sort_key,n.id::text)) from private.category_display_nodes n join tree t on n.parent_id=t.id
 ) select jsonb_agg(private.category_display_category(n.id) order by t.path) from private.category_display_nodes n join tree t on t.id=n.id),'[]'::jsonb),
 'sourceCategories',coalesce((select jsonb_agg(private.category_display_source_category(c.id) order by c.depth,c.sort_order,c.code)
  from public.catalog_categories c where c.archived_at is null),'[]'::jsonb));
end $$;

create function public.admin_update_category_display_tree(p_change jsonb,p_expected_revision bigint,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; action_name text; node_id uuid; parent_node_id uuid; node_name text; destination integer;
 previous private.category_display_nodes; current_revision bigint; receipt public.audit_log; request jsonb; result jsonb;
 parent_depth integer; subtree_height integer; sibling_count integer; member record; ordered_ids uuid[];
begin
 actor:=private.require_operator_capability('store.manage',false);
 if p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or jsonb_typeof(p_change) is distinct from 'object' or jsonb_typeof(p_change->'action') is distinct from 'string'
  or p_change->>'action' not in('create','update','archive','restore')
  or jsonb_typeof(p_change->'id') is distinct from 'string'
  or p_change->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then raise invalid_parameter_value using message='invalid_display_tree_change';end if;
 action_name:=p_change->>'action';node_id:=(p_change->>'id')::uuid;
 if action_name in('create','update') then
  if (select count(*) from jsonb_object_keys(p_change))<>5 or not p_change ?& array['action','id','name','parentId','position']
   or jsonb_typeof(p_change->'name') is distinct from 'string' or btrim(p_change->>'name')=''
   or p_change->>'name' ~ '[\x00-\x1f\x7f]' or p_change->>'name'<>btrim(p_change->>'name')
   or jsonb_typeof(p_change->'parentId') not in('string','null')
   or p_change->>'parentId' is not null and p_change->>'parentId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_change->'position') is distinct from 'number' or p_change->>'position' !~ '^[0-9]{1,6}$'
   then raise invalid_parameter_value using message='invalid_display_tree_details';end if;
  parent_node_id:=(p_change->>'parentId')::uuid;node_name:=p_change->>'name';destination:=(p_change->>'position')::integer;
 elsif (select count(*) from jsonb_object_keys(p_change))<>2 then raise invalid_parameter_value using message='invalid_display_tree_lifecycle';end if;
 request:=jsonb_build_object('change',p_change,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('category-display-operation:'||p_operation_id,0));
 select * into receipt from public.audit_log where id=p_operation_id;
 if found then
  if receipt.actor_id=actor and receipt.action='admin.category_display.tree_changed' and receipt.target='category-display:'||node_id and receipt.diff->'request'=request then return receipt.diff->'result';end if;
  raise unique_violation using message='operation_conflict';
 end if;
 -- The same lock precedes source-category/product locks in composition writes.
 perform pg_advisory_xact_lock(hashtextextended('catalog_category_tree',0));
 select revision into current_revision from private.category_display_tree_control where singleton for update;
 if current_revision<>p_expected_revision then raise sqlstate 'PT409' using message='category_display_tree_conflict';end if;
 select * into previous from private.category_display_nodes where id=node_id for update;
 if action_name='create' and found then raise unique_violation using message='display_node_exists';end if;
 if action_name<>'create' and not found then raise no_data_found using message='display_node_missing';end if;
 if action_name in('create','update') then
  if char_length(node_name)>20 and (action_name='create' or node_name is distinct from previous.name) then raise check_violation using message='display_node_name_limit';end if;
  if node_id=parent_node_id then raise check_violation using message='display_tree_cycle';end if;
  if parent_node_id is not null then
   if not exists(select 1 from private.category_display_nodes where id=parent_node_id and archived_at is null)
    or exists(with recursive ancestors as (select * from private.category_display_nodes where id=parent_node_id
      union all select p.* from private.category_display_nodes p join ancestors a on p.id=a.parent_id)
      select 1 from ancestors where id=node_id or archived_at is not null)
    then raise check_violation using message='display_parent_unavailable';end if;
   parent_depth:=(private.category_display_category(parent_node_id)->>'depth')::integer;
  else parent_depth:=0;end if;
  if action_name='create' or parent_node_id is distinct from previous.parent_id then
   with recursive descendants as (select node_id id,1 height union all select n.id,d.height+1 from private.category_display_nodes n join descendants d on n.parent_id=d.id)
   select max(height) into subtree_height from descendants;
   if parent_depth+subtree_height>3 then raise check_violation using message='display_tree_depth_limit';end if;
  end if;
  if action_name='create' or parent_node_id is distinct from previous.parent_id then
   select count(*) into sibling_count from private.category_display_nodes where parent_id is not distinct from parent_node_id and archived_at is null and id<>node_id;
   if sibling_count>=(case when parent_node_id is null then 19 else 15 end) then raise check_violation using message='display_tree_sibling_limit';end if;
  end if;
  if action_name='create' then
   insert into private.category_display_nodes(id,parent_id,name,sort_order) values(node_id,parent_node_id,node_name,0);
  else
   update private.category_display_nodes set name=node_name,parent_id=parent_node_id,updated_at=clock_timestamp() where id=node_id;
  end if;
  select coalesce(array_agg(id order by sort_order,coalesce(legacy_sort_key,id::text),id),'{}'::uuid[]) into ordered_ids from private.category_display_nodes where parent_id is not distinct from parent_node_id and id<>node_id;
  if destination>cardinality(ordered_ids) then raise invalid_parameter_value using message='display_tree_position_out_of_range';end if;
  ordered_ids:=coalesce(ordered_ids[1:destination],'{}'::uuid[])||array[node_id]||coalesce(ordered_ids[destination+1:cardinality(ordered_ids)],'{}'::uuid[]);
  for member in select id,ordinality-1 position from unnest(ordered_ids) with ordinality ids(id,ordinality) loop
   update private.category_display_nodes set sort_order=member.position,updated_at=clock_timestamp() where id=member.id and sort_order<>member.position;
  end loop;
 elsif action_name='archive' then
  if previous.archived_at is not null then raise check_violation using message='display_node_already_archived';end if;
  update private.category_display_nodes set archived_at=clock_timestamp(),updated_at=clock_timestamp() where id=node_id;
 else
  if previous.archived_at is null then raise check_violation using message='display_node_not_archived';end if;
  select count(*) into sibling_count from private.category_display_nodes where parent_id is not distinct from previous.parent_id and archived_at is null;
  if sibling_count>=(case when previous.parent_id is null then 19 else 15 end) then raise check_violation using message='display_tree_sibling_limit';end if;
  if previous.parent_id is not null and exists(with recursive ancestors as (select * from private.category_display_nodes where id=previous.parent_id
    union all select p.* from private.category_display_nodes p join ancestors a on p.id=a.parent_id) select 1 from ancestors where archived_at is not null)
    then raise check_violation using message='display_parent_unavailable';end if;
  update private.category_display_nodes set archived_at=null,updated_at=clock_timestamp() where id=node_id;
 end if;
 update private.category_display_tree_control set revision=current_revision+1 where singleton;
 result:=jsonb_build_object('nodeId',node_id,'directory',public.admin_list_category_displays());
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.category_display.tree_changed','category-display:'||node_id,
  jsonb_build_object('request',request,'before',case when action_name='create' then null else to_jsonb(previous) end,'result',result));
 return result;
end $$;
revoke all on function public.admin_update_category_display_tree(jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_update_category_display_tree(jsonb,bigint,uuid) to authenticated;

-- Keep the existing composition implementation and owner/ACL; only separate its
-- source-category validation from the display target and preserve lock ordering.
do $$declare definition text;
begin
 definition:=pg_get_functiondef('public.admin_save_category_display(uuid,jsonb,bigint,uuid)'::regprocedure);
 if position('where c.id=p_category_id or c.id in' in definition)=0
  or position('where private.category_display_category(id::uuid) is null' in definition)=0 then raise exception 'category_display_save_source_drift';end if;
 definition:=replace(definition,'where c.id=p_category_id or c.id in','where c.id in');
 definition:=replace(definition,'where private.category_display_category(id::uuid) is null','where private.category_display_source_category(id::uuid) is null');
 execute definition;
 definition:=pg_get_functiondef('private.category_display_matching_goods(jsonb)'::regprocedure);
 if position('private.category_display_category(c.id)' in definition)=0 then raise exception 'category_display_match_source_drift';end if;
 execute replace(definition,'private.category_display_category(c.id)','private.category_display_source_category(c.id)');
end $$;

create or replace function public.get_category_display_navigation() returns jsonb
language sql stable security definer set search_path='' as $$
 with recursive display_tree as (
  select n.id,array[lpad(n.sort_order::text,10,'0')||':'||coalesce(n.legacy_sort_key,n.id::text)] path from private.category_display_nodes n where n.parent_id is null
  union all select n.id,t.path||(lpad(n.sort_order::text,10,'0')||':'||coalesce(n.legacy_sort_key,n.id::text)) from private.category_display_nodes n join display_tree t on n.parent_id=t.id
 ) select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'name',n.name,'depth',(private.category_display_category(n.id)->>'depth')::integer) order by t.path),'[]'::jsonb)
 from private.category_display_compositions d join private.category_display_nodes n on n.id=d.category_id join display_tree t on t.id=n.id
 where d.enabled and coalesce((private.category_display_category(n.id)->>'publicEnabled')::boolean,false)
  and exists(select 1 from private.category_display_matching_goods(private.category_display_values(n.id)) limit 1);
$$;

select private.register_operator_internal_contract('private.category_display_source_category(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_category(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_defaults(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_matching_goods(jsonb)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_list_category_displays()'::regprocedure,'store.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_category_display(uuid,jsonb,bigint,uuid)'::regprocedure,'store.manage','write',false);
select private.register_operator_rpc_contract('public.admin_update_category_display_tree(jsonb,bigint,uuid)'::regprocedure,'store.manage','write',false);
select private.register_operator_internal_contract('public.get_category_display_navigation()'::regprocedure);
