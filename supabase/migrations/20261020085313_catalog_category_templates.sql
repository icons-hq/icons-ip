-- Reusable references to the existing catalog tree. They never move goods.
create table private.catalog_category_templates (
  category_id uuid primary key references public.catalog_categories(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  archived_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id)
);
alter table private.catalog_category_templates enable row level security;
revoke all on private.catalog_category_templates from public, anon, authenticated, service_role;
create index catalog_category_templates_active_created on private.catalog_category_templates(created_at desc,category_id) where archived_at is null;

create function private.catalog_category_template_document(p_category_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with recursive ancestors as (
    select c.id,c.parent_id,c.name,c.archived_at,c.depth from public.catalog_categories c where c.id=p_category_id
    union all
    select p.id,p.parent_id,p.name,p.archived_at,p.depth from public.catalog_categories p join ancestors child on child.parent_id=p.id where p.depth<child.depth
  )
  select jsonb_build_object(
    'categoryId',c.id,'code',c.code,'name',c.name,
    'path',(select jsonb_agg(a.name order by a.depth) from ancestors a),
    'usable',c.archived_at is null and not exists(select 1 from ancestors a where a.archived_at is not null)
      and not exists(select 1 from public.catalog_categories child where child.parent_id=c.id and child.archived_at is null),
    'revision',coalesce(t.revision,0),'archived',t.archived_at is not null,'createdAt',t.created_at
  ) from public.catalog_categories c left join private.catalog_category_templates t on t.category_id=c.id where c.id=p_category_id;
$$;
revoke all on function private.catalog_category_template_document(uuid) from public, anon, authenticated, service_role;

create function public.admin_list_catalog_category_templates(p_query text default '',p_archived boolean default false,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;
begin
  if not private.has_operator_capability(auth.uid(),'catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
  if p_query is null or char_length(p_query)>120 or p_archived is null or p_page is null or p_page<1 or p_page>10000 then
    raise invalid_parameter_value using message='invalid_category_template_filter';
  end if;
  with candidates as materialized (
    select t.category_id,t.created_at,private.catalog_category_template_document(t.category_id) document
    from private.catalog_category_templates t where (t.archived_at is not null)=p_archived
  ), filtered as materialized (
    select * from candidates where strpos(lower((document->'path')::text||' '||(document->>'code')),lower(btrim(p_query)))>0
  ), paged as (
    select * from filtered order by created_at desc,category_id limit 20 offset (p_page-1)*20
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(document order by created_at desc,category_id) from paged),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'pageSize',20) into answer;
  return answer;
end $$;
revoke all on function public.admin_list_catalog_category_templates(text,boolean,integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_catalog_category_templates(text,boolean,integer) to authenticated;

create function public.admin_save_catalog_category_templates(p_items jsonb,p_archived boolean,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item jsonb; items jsonb; request jsonb; receipt jsonb;
  previous private.catalog_category_templates; snapshot jsonb; before_rows jsonb:='[]'; result_rows jsonb:='[]'; category uuid; expected integer;
begin
  perform private.require_actor_operator_capability(actor,'catalog.manage');
  if p_archived is null or p_operation_id is null or p_items is null or jsonb_typeof(p_items)<>'array' then
    raise invalid_parameter_value using message='invalid_category_templates';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise invalid_parameter_value using message='invalid_category_templates';end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'categoryId') is distinct from 'string'
      or jsonb_typeof(item->'revision') is distinct from 'number'
      or (item->>'revision')!~'^[0-9]{1,9}$'
      or exists(select 1 from jsonb_object_keys(item) key where key not in ('categoryId','revision')) then
      raise invalid_parameter_value using message='invalid_category_templates';
    end if;
    begin category:=(item->>'categoryId')::uuid; exception when invalid_text_representation then raise invalid_parameter_value using message='invalid_category_templates';end;
  end loop;
  if (select count(distinct (value->>'categoryId')::uuid) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then
    raise invalid_parameter_value using message='invalid_category_templates';
  end if;
  select jsonb_agg(jsonb_build_object('categoryId',(value->>'categoryId')::uuid,'revision',(value->>'revision')::integer) order by (value->>'categoryId')::uuid)
    into items from jsonb_array_elements(p_items);
  request:=jsonb_build_object('items',items,'archived',p_archived);
  perform pg_advisory_xact_lock(hashtextextended('category-template-operation:'||p_operation_id::text,0));
  receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.catalog.category_templates.saved',request);
  if receipt is not null then return receipt;end if;
  -- The same lock as catalog edits prevents a leaf from gaining a child between validation and commit.
  perform private.lock_catalog_category_tree();
  for item in select value from jsonb_array_elements(items) loop
    category:=(item->>'categoryId')::uuid;expected:=(item->>'revision')::integer;
    snapshot:=private.catalog_category_template_document(category);
    if snapshot is null then raise no_data_found using message='category_not_found';end if;
    if not p_archived and not (snapshot->>'usable')::boolean then raise check_violation using message='category_not_usable';end if;
    select * into previous from private.catalog_category_templates where category_id=category for update;
    if coalesce(previous.revision,0)<>expected or (previous.category_id is null and p_archived) then
      raise sqlstate 'PT409' using message='category_templates_changed';
    end if;
    before_rows:=before_rows||jsonb_build_array(snapshot);
    insert into private.catalog_category_templates(category_id,updated_by) values(category,actor)
    on conflict(category_id) do update set revision=catalog_category_templates.revision+1,
      archived_at=case when p_archived then coalesce(catalog_category_templates.archived_at,clock_timestamp()) else null end,
      updated_at=clock_timestamp(),updated_by=actor;
    result_rows:=result_rows||jsonb_build_array(private.catalog_category_template_document(category));
  end loop;
  receipt:=jsonb_build_object('rows',result_rows);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.catalog.category_templates.saved','catalog_category_templates',
    jsonb_build_object('request',request,'before',before_rows,'result',receipt));
  return receipt;
end $$;
revoke all on function public.admin_save_catalog_category_templates(jsonb,boolean,uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_catalog_category_templates(jsonb,boolean,uuid) to authenticated;
select private.register_operator_internal_contract('private.catalog_category_template_document(uuid)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_list_catalog_category_templates(text,boolean,integer)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_catalog_category_templates(jsonb,boolean,uuid)'::regprocedure,'catalog.manage','manual',false);
notify pgrst,'reload schema';
