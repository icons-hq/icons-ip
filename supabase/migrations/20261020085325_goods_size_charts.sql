-- Product measurement tables are separate from notices, variants and model/body data.
-- Text trims ASCII space/LF/CR/TAB only, matching lib/goods-size-chart.ts. Notes retain internal LF/TAB.
create function private.validate_goods_size_chart(p_chart jsonb, p_allow_empty boolean default false)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
 size_item jsonb; measure_item jsonb; cell_item jsonb; label text; cell_value text; note_value text;
 sizes jsonb:='[]'; measures jsonb:='[]'; cells jsonb; names text[]:='{}'; normalized_size text[]:='{}';
begin
 if p_chart is null or jsonb_typeof(p_chart)<>'object'
  or not p_chart ?& array['unit','sizes','measurements','note']
  or p_chart-array['unit','sizes','measurements','note']<>'{}'::jsonb
  or jsonb_typeof(p_chart->'unit')<>'string' or p_chart->>'unit' not in ('cm','mm')
  or jsonb_typeof(p_chart->'sizes')<>'array' or jsonb_typeof(p_chart->'measurements')<>'array'
  or jsonb_typeof(p_chart->'note')<>'string' then
  raise invalid_parameter_value using message='invalid_goods_size_chart';
 end if;
 note_value:=btrim(replace(replace(p_chart->>'note',E'\r\n',E'\n'),E'\r',E'\n'),E' \n\t');
 if char_length(note_value)>500 or translate(note_value,E'\n\t','')~'[[:cntrl:]]' or note_value~'[<>]' then
  raise invalid_parameter_value using message='invalid_goods_size_chart';
 end if;
 if p_allow_empty and p_chart->'sizes'='[]'::jsonb and p_chart->'measurements'='[]'::jsonb and note_value='' then
  return jsonb_build_object('unit',p_chart->>'unit','sizes','[]'::jsonb,'measurements','[]'::jsonb,'note','');
 end if;
 if jsonb_array_length(p_chart->'sizes') not between 1 and 10 or jsonb_array_length(p_chart->'measurements') not between 1 and 10 then
  raise invalid_parameter_value using message='invalid_goods_size_chart';
 end if;
 for size_item in select value from jsonb_array_elements(p_chart->'sizes') loop
  if jsonb_typeof(size_item)<>'string' then raise invalid_parameter_value using message='invalid_goods_size_chart';end if;
  label:=btrim(size_item#>>'{}',E' \n\r\t');
  if char_length(label) not between 1 and 10 or label~'[[:cntrl:]<>]' or label=any(normalized_size) then
   raise invalid_parameter_value using message='invalid_goods_size_chart';end if;
  normalized_size:=array_append(normalized_size,label);sizes:=sizes||jsonb_build_array(label);
 end loop;
 for measure_item in select value from jsonb_array_elements(p_chart->'measurements') loop
  if jsonb_typeof(measure_item)<>'object' or not measure_item ?& array['name','values']
   or measure_item-array['name','values']<>'{}'::jsonb or jsonb_typeof(measure_item->'name')<>'string'
   or jsonb_typeof(measure_item->'values')<>'array' then
   raise invalid_parameter_value using message='invalid_goods_size_chart';end if;
  label:=btrim(measure_item->>'name',E' \n\r\t');
  if char_length(label) not between 1 and 20 or label~'[[:cntrl:]<>]' or label=any(names)
   or jsonb_array_length(measure_item->'values')<>jsonb_array_length(sizes) then
   raise invalid_parameter_value using message='invalid_goods_size_chart';end if;
  names:=array_append(names,label);cells:='[]';
  for cell_item in select value from jsonb_array_elements(measure_item->'values') loop
   if jsonb_typeof(cell_item)<>'string' then raise invalid_parameter_value using message='invalid_goods_size_chart';end if;
   cell_value:=btrim(cell_item#>>'{}',E' \n\r\t');
   if cell_value!~'^(0|[1-9][0-9]{0,4})(\.[0-9])?$' then raise invalid_parameter_value using message='invalid_goods_size_chart';end if;
   if cell_value::numeric<0.1 or cell_value::numeric>99999 then raise invalid_parameter_value using message='invalid_goods_size_chart';end if;
   cell_value:=regexp_replace(cell_value,'\.0$','');
   cells:=cells||jsonb_build_array(cell_value);
  end loop;
  measures:=measures||jsonb_build_array(jsonb_build_object('name',label,'values',cells));
 end loop;
 return jsonb_build_object('unit',p_chart->>'unit','sizes',sizes,'measurements',measures,'note',note_value);
end $$;
revoke all on function private.validate_goods_size_chart(jsonb,boolean) from public,anon,authenticated,service_role;

create table private.goods_size_charts (
 good_id text primary key references public.goods(id) on update cascade on delete restrict,
 enabled boolean not null default false,
 chart jsonb not null check(chart=private.validate_goods_size_chart(chart,true)),
 check(not enabled or jsonb_array_length(chart->'sizes')>0),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null references auth.users(id)
);
create table private.goods_size_templates (
 id uuid primary key,
 name text not null check(char_length(name) between 1 and 50 and name!~'[[:cntrl:]<>]' and name=btrim(name,E' \n\r\t')),
 chart jsonb not null check(chart=private.validate_goods_size_chart(chart,false)),
 revision integer not null default 1 check(revision>0),archived_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null references auth.users(id)
);
alter table private.goods_size_charts enable row level security;
alter table private.goods_size_templates enable row level security;
revoke all on private.goods_size_charts,private.goods_size_templates from public,anon,authenticated,service_role;

create function private.goods_size_chart_document(p_good_id text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('goodId',g.id,'goodName',g.name,'values',jsonb_build_object('enabled',coalesce(s.enabled,false),
  'chart',coalesce(s.chart,'{"unit":"cm","sizes":[],"measurements":[],"note":""}'::jsonb)),
  'revision',coalesce(s.revision,0),'updatedAt',s.updated_at)
 from public.goods g left join private.goods_size_charts s on s.good_id=g.id where g.id=p_good_id;
$$;
revoke all on function private.goods_size_chart_document(text) from public,anon,authenticated,service_role;

create function public.admin_get_goods_size_chart(p_good_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return private.goods_size_chart_document(p_good_id);
end $$;
revoke all on function public.admin_get_goods_size_chart(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_size_chart(text) to authenticated;

create function public.admin_save_goods_size_chart(p_good_id text,p_expected_revision integer,p_operation_id uuid,p_values jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous private.goods_size_charts;request jsonb;receipt jsonb;chart_value jsonb;enabled_value boolean;
begin
 perform private.require_actor_operator_capability(actor,'catalog.manage');
 if p_good_id is null or p_expected_revision is null or p_expected_revision not between 0 and 2147483646 or p_operation_id is null
  or p_values is null or jsonb_typeof(p_values)<>'object' or not p_values ?& array['enabled','chart']
  or p_values-array['enabled','chart']<>'{}'::jsonb or jsonb_typeof(p_values->'enabled')<>'boolean' then
  raise invalid_parameter_value using message='invalid_goods_size_chart';end if;
 enabled_value:=(p_values->>'enabled')::boolean;
 chart_value:=private.validate_goods_size_chart(p_values->'chart',not enabled_value);
 request:=jsonb_build_object('goodId',p_good_id,'expectedRevision',p_expected_revision,
  'values',jsonb_build_object('enabled',enabled_value,'chart',chart_value));
 perform pg_advisory_xact_lock(hashtextextended('goods-size-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.goods.size_chart.saved',request);if receipt is not null then return receipt;end if;
 perform 1 from public.goods where id=p_good_id and archived_at is null for update;
 if not found then raise no_data_found using message='good_not_found';end if;
 select * into previous from private.goods_size_charts where good_id=p_good_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='goods_size_chart_changed';end if;
 -- Disabling is reversible. It may never erase an existing table by submitting the initial empty document.
 if previous.good_id is not null and jsonb_array_length(previous.chart->'sizes')>0 and chart_value->'sizes'='[]'::jsonb then
  raise check_violation using message='goods_size_chart_cannot_clear';end if;
 insert into private.goods_size_charts(good_id,enabled,chart,updated_by) values(p_good_id,enabled_value,chart_value,actor)
 on conflict(good_id) do update set enabled=excluded.enabled,chart=excluded.chart,
  revision=goods_size_charts.revision+1,updated_at=clock_timestamp(),updated_by=actor;
 receipt:=private.goods_size_chart_document(p_good_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods.size_chart.saved','goods:'||p_good_id,
  jsonb_build_object('request',request,'before',to_jsonb(previous),'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_save_goods_size_chart(text,integer,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_size_chart(text,integer,uuid,jsonb) to authenticated;

create function public.get_good_size_chart(p_good_id text)
returns jsonb language sql stable security definer set search_path='' as $$
 select s.chart from private.goods_size_charts s join public.goods g on g.id=s.good_id join public.ips i on i.id=g.ip_id
 where s.enabled and g.id=p_good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
  and i.archived_at is null and i.published_at is not null;
$$;
revoke all on function public.get_good_size_chart(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_size_chart(text) to anon,authenticated;

create function public.admin_list_goods_size_templates(p_query text default '',p_archived boolean default false,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_archived is null or p_page is null or p_page not between 1 and 100000 then
  raise invalid_parameter_value using message='invalid_goods_size_template_search';end if;
 with filtered as materialized(select * from private.goods_size_templates where (archived_at is not null)=p_archived
  and strpos(lower(name),lower(btrim(p_query,E' \n\r\t')))>0),
 page as(select * from filtered order by created_at desc,id limit 20 offset(p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',20,
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'chart',chart,'revision',revision,
   'archived',archived_at is not null,'createdAt',created_at,'updatedAt',updated_at) order by created_at desc,id) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_list_goods_size_templates(text,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_size_templates(text,boolean,integer) to authenticated;

create function public.admin_save_goods_size_template(p_id uuid,p_name text,p_chart jsonb,p_archived boolean,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous private.goods_size_templates;saved private.goods_size_templates;request jsonb;receipt jsonb;chart_value jsonb;name_value text;
begin
 perform private.require_actor_operator_capability(actor,'catalog.manage');
 name_value:=btrim(p_name,E' \n\r\t');
 if p_id is null or p_operation_id is null or p_archived is null or p_expected_revision is null or p_expected_revision not between 0 and 2147483646
  or name_value is null or char_length(name_value) not between 1 and 50 or name_value~'[[:cntrl:]<>]' then
  raise invalid_parameter_value using message='invalid_goods_size_template';end if;
 chart_value:=private.validate_goods_size_chart(p_chart,false);
 request:=jsonb_build_object('id',p_id,'name',name_value,'chart',chart_value,'archived',p_archived,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('goods-size-template-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.goods.size_template.saved',request);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-size-template:'||p_id::text,0));
 select * into previous from private.goods_size_templates where id=p_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision or(previous.id is null and p_archived) then
  raise sqlstate 'PT409' using message='goods_size_template_changed';end if;
 insert into private.goods_size_templates(id,name,chart,updated_by) values(p_id,name_value,chart_value,actor)
 on conflict(id) do update set name=excluded.name,chart=excluded.chart,
  archived_at=case when p_archived then coalesce(goods_size_templates.archived_at,clock_timestamp()) else null end,
  revision=goods_size_templates.revision+1,updated_at=clock_timestamp(),updated_by=actor returning * into saved;
 receipt:=jsonb_build_object('id',saved.id,'name',saved.name,'chart',saved.chart,'revision',saved.revision,
  'archived',saved.archived_at is not null,'createdAt',saved.created_at,'updatedAt',saved.updated_at);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods.size_template.saved','goods_size_template:'||p_id,
  jsonb_build_object('request',request,'before',to_jsonb(previous),'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_save_goods_size_template(uuid,text,jsonb,boolean,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_size_template(uuid,text,jsonb,boolean,integer,uuid) to authenticated;

create function private.clone_goods_size_chart(p_source text,p_target text,p_actor uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if p_actor is distinct from auth.uid() or p_source=p_target then raise insufficient_privilege using message='operator_capability_required';end if;
 perform private.require_actor_operator_capability(p_actor,'catalog.manage');
 perform 1 from public.goods where id=p_source for share;
 if not found then raise no_data_found using message='good_not_found';end if;
 perform 1 from public.goods where id=p_target and published_at is null and archived_at is null for update;
 if not found then raise check_violation using message='goods_size_clone_target_invalid';end if;
 insert into private.goods_size_charts(good_id,enabled,chart,updated_by)
 select p_target,enabled,chart,p_actor from private.goods_size_charts where good_id=p_source;
end $$;
revoke all on function private.clone_goods_size_chart(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.clone_goods_size_chart(text,text,uuid) to postgres;

do $$ declare body text;anchor text:=E'  -- Stopped non-default rows are historical configuration, not rows of the';begin
 body:=pg_get_functiondef('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure);
 if(length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then raise exception 'goods_size_clone_anchor_missing';end if;
 body:=replace(body,anchor,$clone$
  perform private.clone_goods_size_chart(source_good.id,saved_id,actor_id);
$clone$||anchor);execute body;
end $$;
select private.register_operator_internal_contract('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure);
select private.register_operator_internal_contract('private.clone_goods_size_chart(text,text,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.validate_goods_size_chart(jsonb,boolean)'::regprocedure);
select private.register_operator_internal_contract('private.goods_size_chart_document(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_size_chart(text)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_get_goods_size_chart(text)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_size_chart(text,integer,uuid,jsonb)'::regprocedure,'catalog.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_list_goods_size_templates(text,boolean,integer)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_size_template(uuid,text,jsonb,boolean,integer,uuid)'::regprocedure,'catalog.manage','manual',false);
notify pgrst,'reload schema';
