-- Category-specific catalog facts. These are neither SKU options nor legal notices.
-- Definitions never change publication/payment eligibility; values are validated at editing time.
create function private.goods_attribute_trim(value text) returns text language sql immutable set search_path='' as $$
  select btrim(value, E' \t\n\r\v\f'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
revoke all on function private.goods_attribute_trim(text) from public,anon,authenticated,service_role;
create function private.goods_attribute_fields_valid(fields jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare field jsonb; opt jsonb; ids text[]:='{}'; names text[]:='{}'; option_ids text[]; labels text[];
begin
  if jsonb_typeof(fields) is distinct from 'array' then return false; end if;
  if jsonb_array_length(fields)>30 then return false; end if;
  for field in select value from jsonb_array_elements(fields) loop
    if jsonb_typeof(field) is distinct from 'object' then return false; end if;
    if not field ?& array['id','name','kind','required','unit','options'] or (select count(*) from jsonb_object_keys(field))<>6
      or jsonb_typeof(field->'id') is distinct from 'string' or field->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or field->>'id'=any(ids) or jsonb_typeof(field->'name') is distinct from 'string' or char_length(field->>'name') not between 1 and 60
      or field->>'name'<>private.goods_attribute_trim(field->>'name') or field->>'name'=any(names)
      or coalesce(field->>'kind','') not in ('single','multi','text','number') or jsonb_typeof(field->'required') is distinct from 'boolean'
      or jsonb_typeof(field->'unit') is distinct from 'string' or char_length(field->>'unit')>20 or field->>'unit'<>private.goods_attribute_trim(field->>'unit')
      or (field->>'kind'<>'number' and field->>'unit'<>'') or jsonb_typeof(field->'options') is distinct from 'array' then return false; end if;
    ids:=array_append(ids,field->>'id'); names:=array_append(names,field->>'name'); option_ids:='{}'; labels:='{}';
    if jsonb_array_length(field->'options')>100 or (field->>'kind' in ('single','multi') and jsonb_array_length(field->'options')=0)
      or (field->>'kind' in ('text','number') and jsonb_array_length(field->'options')<>0) then return false; end if;
    for opt in select value from jsonb_array_elements(field->'options') loop
      if jsonb_typeof(opt) is distinct from 'object' then return false; end if;
      if not opt ?& array['id','label'] or (select count(*) from jsonb_object_keys(opt))<>2
        or jsonb_typeof(opt->'id') is distinct from 'string' or opt->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or opt->>'id'=any(option_ids) or jsonb_typeof(opt->'label') is distinct from 'string' or char_length(opt->>'label') not between 1 and 80
        or opt->>'label'<>private.goods_attribute_trim(opt->>'label') or opt->>'label'=any(labels) then return false; end if;
      option_ids:=array_append(option_ids,opt->>'id'); labels:=array_append(labels,opt->>'label');
    end loop;
  end loop;
  return true;
end $$;
revoke all on function private.goods_attribute_fields_valid(jsonb) from public,anon,authenticated,service_role;

create function private.goods_attribute_value_valid(field jsonb, val jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare kind text:=field->>'kind'; n numeric;
begin
  if val is null or val='null' then return false; end if;
  if kind='text' then return jsonb_typeof(val)='string' and char_length(val#>>'{}') between 1 and 500 and val#>>'{}'=private.goods_attribute_trim(val#>>'{}'); end if;
  if kind='number' then
    if jsonb_typeof(val)<>'number' then return false; end if;
    n:=(val#>>'{}')::numeric; return abs(n)<=1000000000 and n=round(n,6);
  end if;
  if kind='single' then return jsonb_typeof(val)='string' and exists(select 1 from jsonb_array_elements(field->'options') opt where opt->'id'=val); end if;
  if kind='multi' then
    if jsonb_typeof(val)<>'array' then return false; end if;
    return jsonb_array_length(val) between 1 and 100 and (select count(distinct value) from jsonb_array_elements(val))=jsonb_array_length(val)
      and not exists(select 1 from jsonb_array_elements(val) v where jsonb_typeof(v)<>'string' or not exists(select 1 from jsonb_array_elements(field->'options') opt where opt->'id'=v));
  end if;
  return false;
end $$;
revoke all on function private.goods_attribute_value_valid(jsonb,jsonb) from public,anon,authenticated,service_role;

create table public.catalog_category_attribute_schemas (
  category_id uuid primary key references public.catalog_categories(id) on delete cascade,
  fields jsonb not null default '[]' check(private.goods_attribute_fields_valid(fields)),
  revision integer not null default 1 check(revision>0), updated_at timestamptz not null default clock_timestamp()
);
create table public.goods_attribute_values (
  good_id text primary key references public.goods(id) on update cascade on delete cascade,
  entries jsonb not null default '[]' check(jsonb_typeof(entries)='array' and jsonb_array_length(entries)<=100 and octet_length(entries::text)<=262144),
  revision integer not null default 1 check(revision>0), updated_at timestamptz not null default clock_timestamp()
);
alter table public.catalog_category_attribute_schemas enable row level security;
alter table public.goods_attribute_values enable row level security;
revoke all on public.catalog_category_attribute_schemas,public.goods_attribute_values from public,anon,authenticated,service_role;

create function public.admin_get_goods_attributes(p_category_id uuid,p_good_id text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare schema_data jsonb; document_data jsonb;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if p_category_id is not null then
    if not exists(select 1 from public.catalog_categories where id=p_category_id) then raise no_data_found using message='category_not_found'; end if;
    select jsonb_build_object('categoryId',p_category_id,'revision',revision,'fields',fields) into schema_data from public.catalog_category_attribute_schemas where category_id=p_category_id;
    schema_data:=coalesce(schema_data,jsonb_build_object('categoryId',p_category_id,'revision',0,'fields','[]'::jsonb));
  end if;
  if p_good_id is not null and not exists(select 1 from public.goods where id=p_good_id) then raise no_data_found using message='good_not_found'; end if;
  select jsonb_build_object('revision',revision,'entries',entries) into document_data from public.goods_attribute_values where good_id=p_good_id;
  return jsonb_build_object('schema',schema_data,'document',coalesce(document_data,'{"revision":0,"entries":[]}'::jsonb));
end $$;
revoke all on function public.admin_get_goods_attributes(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_attributes(uuid,text) to authenticated;

create function public.admin_save_goods_attribute_schema(p_category_id uuid,p_fields jsonb,p_expected_revision integer,p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.catalog_category_attribute_schemas; saved public.catalog_category_attribute_schemas; audit public.audit_log; result jsonb;
begin
  if actor is null or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='admin_required'; end if;
  perform 1 from public.profiles where id=actor and role='admin' and suspended_at is null for share;
  if not found then raise insufficient_privilege using message='admin_required'; end if;
  if p_category_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or not coalesce(private.goods_attribute_fields_valid(p_fields),false) then raise invalid_parameter_value using message='invalid_attribute_schema'; end if;
  perform private.lock_catalog_category_tree();
  if not exists(select 1 from public.catalog_categories where id=p_category_id and archived_at is null)
    or exists(select 1 from public.catalog_categories where parent_id=p_category_id and archived_at is null) then raise check_violation using message='category_not_leaf'; end if;
  select * into previous from public.catalog_category_attribute_schemas where category_id=p_category_id for update;
  select * into audit from public.audit_log where id=p_operation_id;
  if found then
    if audit.actor_id=actor and audit.action='catalog.attribute_schema_saved' and audit.target=p_category_id::text
      and audit.diff->'after'=p_fields and (audit.diff->>'expectedRevision')::integer=p_expected_revision then return audit.diff->'result'; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='goods_attribute_schema_changed'; end if;
  insert into public.catalog_category_attribute_schemas(category_id,fields) values(p_category_id,p_fields)
    on conflict(category_id) do update set fields=excluded.fields,revision=catalog_category_attribute_schemas.revision+1,updated_at=clock_timestamp() returning * into saved;
  result:=jsonb_build_object('categoryId',saved.category_id,'revision',saved.revision,'fields',saved.fields);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'catalog.attribute_schema_saved',p_category_id::text,
    jsonb_build_object('before',coalesce(previous.fields,'[]'::jsonb),'after',p_fields,'expectedRevision',p_expected_revision,'result',result));
  return result;
end $$;
revoke all on function public.admin_save_goods_attribute_schema(uuid,jsonb,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_attribute_schema(uuid,jsonb,integer,uuid) to authenticated;

-- Merge only explicit changes. Removed/category-mismatched definitions never erase stored values.
create function private.merge_goods_attributes(p_previous jsonb,p_fields jsonb,p_values jsonb,p_remove_ids jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:=p_previous; entry record; field jsonb; remove_id jsonb;
begin
  if jsonb_typeof(p_values) is distinct from 'object' or jsonb_typeof(p_remove_ids) is distinct from 'array' then raise check_violation using message='invalid_goods_attributes'; end if;
  if (select count(*) from jsonb_object_keys(p_values))>30 or jsonb_array_length(p_remove_ids)>100
    or (select count(distinct value) from jsonb_array_elements(p_remove_ids))<>jsonb_array_length(p_remove_ids) then raise check_violation using message='invalid_goods_attributes'; end if;
  for remove_id in select value from jsonb_array_elements(p_remove_ids) loop
    if jsonb_typeof(remove_id)<>'string' or remove_id#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise check_violation using message='invalid_goods_attributes'; end if;
    select coalesce(jsonb_agg(e),'[]') into result from jsonb_array_elements(result) e where e#>'{field,id}'<>remove_id;
  end loop;
  for entry in select * from jsonb_each(p_values) loop
    select f into field from jsonb_array_elements(p_fields) f where f->>'id'=entry.key;
    if field is null or p_remove_ids ? entry.key then raise check_violation using message='invalid_goods_attributes'; end if;
    if entry.value<>'null' and not private.goods_attribute_value_valid(field,entry.value) then raise check_violation using message='invalid_goods_attribute_value'; end if;
    select coalesce(jsonb_agg(e),'[]') into result from jsonb_array_elements(result) e where e#>>'{field,id}'<>entry.key;
    if entry.value<>'null' then result:=result||jsonb_build_array(jsonb_build_object('field',field,'value',entry.value)); end if;
  end loop;
  for field in select value from jsonb_array_elements(p_fields) loop
    if (field->>'required')::boolean and not exists(select 1 from jsonb_array_elements(result) e
      where e#>>'{field,id}'=field->>'id' and e#>>'{field,kind}'=field->>'kind' and e#>>'{field,unit}'=field->>'unit'
        and private.goods_attribute_value_valid(field,e->'value')) then raise check_violation using message='goods_attribute_required'; end if;
  end loop;
  if jsonb_array_length(result)>100 or octet_length(result::text)>262144 then raise check_violation using message='goods_attribute_retained_limit'; end if;
  return result;
end $$;
revoke all on function private.merge_goods_attributes(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_attributes;
revoke all on function private.admin_save_good_before_attributes(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_save_good_before_attributes(jsonb) to postgres;
create function public.admin_save_good(target_good jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare saved jsonb; previous public.goods; previous_values public.goods_attribute_values; schema_row public.catalog_category_attribute_schemas;
  submission jsonb; category uuid; code_value text; code_id uuid; next_entries jsonb; next_revision integer;
begin
  if auth.uid() is null or private.is_account_write_fenced(auth.uid()) then raise insufficient_privilege using message='staff_required'; end if;
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if jsonb_typeof(target_good) is distinct from 'object' then raise invalid_parameter_value using message='invalid_good'; end if;
  perform private.lock_catalog_category_tree();
  select * into previous from public.goods where id=coalesce(nullif(target_good->>'previous_id',''),target_good->>'id') for update;
  category:=previous.category_id;
  if target_good ? 'category_id' then
    if jsonb_typeof(target_good->'category_id') not in ('string','null') then raise invalid_parameter_value using message='invalid_good_category'; end if;
    begin category:=nullif(btrim(target_good->>'category_id'),'')::uuid;
    exception when invalid_text_representation then raise invalid_parameter_value using message='invalid_good_category'; end;
  end if;
  if target_good ? 'category_code' then
    if jsonb_typeof(target_good->'category_code') not in ('string','null') then raise invalid_parameter_value using message='invalid_good_category'; end if;
    code_value:=nullif(btrim(target_good->>'category_code'),'');
    if code_value is not null then select id into code_id from public.catalog_categories where code=code_value;
      if not found then raise no_data_found using message='category_not_found'; end if; end if;
    if target_good ? 'category_id' and code_id is distinct from category then raise invalid_parameter_value using message='good_category_identity_mismatch'; end if;
    category:=code_id;
  end if;
  select * into previous_values from public.goods_attribute_values where good_id=previous.id for update;
  select * into schema_row from public.catalog_category_attribute_schemas where category_id=category for share;
  if target_good ? 'product_attributes' then
    submission:=target_good->'product_attributes';
    if jsonb_typeof(submission) is distinct from 'object' then raise check_violation using message='invalid_goods_attributes'; end if;
    if not submission ?& array['categoryId','schemaRevision','expectedRevision','values','removeIds'] or (select count(*) from jsonb_object_keys(submission))<>5
      or (submission->>'categoryId')::uuid is distinct from category
      or jsonb_typeof(submission->'schemaRevision') is distinct from 'number' or submission->>'schemaRevision' !~ '^(0|[1-9][0-9]*)$'
      or jsonb_typeof(submission->'expectedRevision') is distinct from 'number' or submission->>'expectedRevision' !~ '^(0|[1-9][0-9]*)$' then raise check_violation using message='invalid_goods_attributes'; end if;
    if (submission->>'schemaRevision')::numeric<>coalesce(schema_row.revision,0) then raise sqlstate 'PT409' using message='goods_attribute_schema_changed'; end if;
    if (submission->>'expectedRevision')::numeric<>coalesce(previous_values.revision,0) then raise sqlstate 'PT409' using message='goods_attributes_changed'; end if;
    next_entries:=private.merge_goods_attributes(coalesce(previous_values.entries,'[]'),coalesce(schema_row.fields,'[]'),submission->'values',submission->'removeIds');
  elsif previous.id is null or category is distinct from previous.category_id then
    -- Old clients may preserve an existing product unchanged. New/category-changed products still satisfy the current mandatory schema.
    next_entries:=private.merge_goods_attributes(coalesce(previous_values.entries,'[]'),coalesce(schema_row.fields,'[]'),'{}','[]');
  end if;
  saved:=private.admin_save_good_before_attributes(target_good-'product_attributes');
  if next_entries is not null and (next_entries<>coalesce(previous_values.entries,'[]') or submission is not null) then
    insert into public.goods_attribute_values(good_id,entries) values(saved->>'id',next_entries)
      on conflict(good_id) do update set entries=excluded.entries,revision=goods_attribute_values.revision+1,updated_at=clock_timestamp() returning revision into next_revision;
    insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'catalog.goods_attributes_saved','goods:'||(saved->>'id'),
      jsonb_build_object('before',coalesce(previous_values.entries,'[]'),'after',next_entries,'categoryId',category,'schemaRevision',coalesce(schema_row.revision,0),'revision',next_revision));
  end if;
  return saved||jsonb_build_object('attributesRevision',coalesce(next_revision,previous_values.revision,0));
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

create function public.get_good_attribute_rows(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare fields jsonb; entries jsonb; field jsonb; entry jsonb; label text; result jsonb:='[]';
begin
  select schema.fields,vals.entries into fields,entries from public.goods g join public.ips ip on ip.id=g.ip_id
    join public.catalog_category_attribute_schemas schema on schema.category_id=g.category_id
    join public.goods_attribute_values vals on vals.good_id=g.id
    where g.id=p_good_id and g.published_at is not null and g.archived_at is null and g.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null;
  if fields is null then return result; end if;
  for field in select value from jsonb_array_elements(fields) loop
    select e into entry from jsonb_array_elements(entries) e where e#>>'{field,id}'=field->>'id'
      and e#>>'{field,kind}'=field->>'kind' and e#>>'{field,unit}'=field->>'unit' and private.goods_attribute_value_valid(field,e->'value');
    if entry is null then continue; end if;
    if field->>'kind'='single' then select opt->>'label' into label from jsonb_array_elements(field->'options') opt where opt->'id'=entry->'value';
    elsif field->>'kind'='multi' then select string_agg(opt->>'label',', ' order by v.ordinality) into label
      from jsonb_array_elements(entry->'value') with ordinality v(value,ordinality) join jsonb_array_elements(field->'options') opt on opt->'id'=v.value;
    else label:=(entry->'value'#>>'{}')||case when field->>'unit'<>'' then ' '||(field->>'unit') else '' end; end if;
    result:=result||jsonb_build_array(jsonb_build_object('id',field->>'id','name',field->>'name','value',label));
  end loop;
  return result;
end $$;
revoke all on function public.get_good_attribute_rows(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_attribute_rows(text) to anon,authenticated;

-- Preserve new incomplete inputs in personal server drafts without changing their publication semantics.
do $$ declare body text; begin
  select pg_get_functiondef('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure) into body;
  if strpos(body,'''customInputsExpectedRevision'',''optionUsage''')=0 then raise exception 'goods_draft_attribute_patch_anchor_missing'; end if;
  body:=replace(body,'''customInputsExpectedRevision'',''optionUsage''','''customInputsExpectedRevision'',''productAttributes'',''productAttributeDraft'',''optionUsage''');
  execute body;
end $$;
revoke all on function public.admin_save_goods_draft(uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_draft(uuid,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
