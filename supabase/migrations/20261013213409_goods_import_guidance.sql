-- Reviewed XLSX guidance integration; verified in a disposable local clone.
-- XLSX guidance reuses the existing child CAS/audit contracts and product savepoint.
create function private.apply_goods_import_guidance(
  p_batch_id uuid, p_index integer, p_good_id text, p_guidance jsonb
)
returns void language plpgsql security definer set search_path = ''
as $function$
declare
  actor uuid := auth.uid();
  item record;
  expected_revision integer;
  operation_id uuid;
begin
  perform private.require_actor_operator_capability(actor, 'catalog.manage');
  if p_guidance is null then return; end if;
  if p_batch_id is null or p_index is null or p_index < 0 or p_good_id is null
    or jsonb_typeof(p_guidance) <> 'object' or p_guidance = '{}'::jsonb
    or p_guidance - array['afterSales','sizeChart'] <> '{}'::jsonb then
    raise invalid_parameter_value using message = 'invalid_import_guidance';
  end if;
  if not exists (
    select 1 from public.admin_goods_imports batch
    where batch.id = p_batch_id and batch.actor_id = actor
      and p_index < jsonb_array_length(batch.plan)
      and batch.plan->p_index->'guidance' = p_guidance
  ) then raise insufficient_privilege using message = 'import_not_found'; end if;
  for item in select key, value from jsonb_each(p_guidance) order by key loop
    if jsonb_typeof(item.value) <> 'object'
      or not item.value ?& array['expectedRevision','values']
      or item.value - array['expectedRevision','values'] <> '{}'::jsonb
      or jsonb_typeof(item.value->'expectedRevision') <> 'number'
      or (item.value->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,9})$'
      or jsonb_typeof(item.value->'values') <> 'object' then
      raise invalid_parameter_value using message = 'invalid_import_guidance';
    end if;
    if (item.value->>'expectedRevision')::numeric > 2147483646 then
      raise invalid_parameter_value using message = 'invalid_import_guidance';
    end if;
    expected_revision := (item.value->>'expectedRevision')::integer;
    -- A trusted batch, actor, row index and child kind fix the receipt identity.
    operation_id := md5('goods-import-guidance:v1:' || p_batch_id::text || ':' ||
      actor::text || ':' || p_index::text || ':' || item.key)::uuid;
    if item.key = 'afterSales' then
      perform public.admin_save_goods_after_sales_content(
        p_good_id, expected_revision, operation_id, item.value->'values');
    else
      perform public.admin_save_goods_size_chart(
        p_good_id, expected_revision, operation_id, item.value->'values');
    end if;
  end loop;
end;
$function$;
revoke all on function private.apply_goods_import_guidance(uuid,integer,text,jsonb)
  from public, anon, authenticated, service_role;
alter function private.apply_goods_import_guidance(uuid,integer,text,jsonb) owner to postgres;
grant execute on function private.apply_goods_import_guidance(uuid,integer,text,jsonb) to postgres;

-- Keep the existing catalog.read guard, cost visibility and 500-record bound.
-- New private guidance snapshots are only added for current catalog managers.
do $patch$
declare
  signature regprocedure := 'public.admin_goods_import_records(text[],text[])'::regprocedure;
  original text := pg_get_functiondef(signature);
  original_owner oid;
  original_acl aclitem[];
  expected text;
  anchor text := $anchor$return query select jsonb_set(entry.value,'{good,additional_category_ids}',to_jsonb(private.goods_additional_category_ids(entry.value#>>'{good,id}')))
    from private.admin_goods_import_records_before_additional_categories(target_codes,target_ids) entry(value);$anchor$;
  replacement text := $replacement$return query select jsonb_set(entry.value,'{good,additional_category_ids}',to_jsonb(private.goods_additional_category_ids(entry.value#>>'{good,id}')))
    || jsonb_build_object(
      'afterSales', case when public.has_operator_capability('catalog.manage',false)
        then private.goods_after_sales_document(entry.value#>>'{good,id}') else null end,
      'sizeChart', case when public.has_operator_capability('catalog.manage',false)
        then private.goods_size_chart_document(entry.value#>>'{good,id}') else null end)
    from private.admin_goods_import_records_before_additional_categories(target_codes,target_ids) entry(value);$replacement$;
begin
  if cardinality(string_to_array(original,anchor)) <> 2 then
    raise exception 'admin_goods_import_records guidance anchor mismatch';
  end if;
  select proowner,proacl into strict original_owner,original_acl from pg_proc where oid=signature;
  expected := replace(original,anchor,replacement);
  execute expected;
  if pg_get_functiondef(signature) is distinct from expected or exists(
    select 1 from pg_proc where oid=signature
      and (proowner is distinct from original_owner or proacl is distinct from original_acl)
  ) then raise exception 'goods_import_guidance_definition_preservation_failed'; end if;
end;
$patch$;

-- The before_purchase_cost function is a category-lock wrapper. The actual
-- savepoint is inside before_category; preserve every wrapper and existing lock.
do $patch$
declare
  signature regprocedure := 'private.admin_commit_goods_import_group_before_category(uuid,integer)'::regprocedure;
  original text := pg_get_functiondef(signature);
  original_owner oid;
  original_acl aclitem[];
  expected text;
  anchor text := $anchor$   saved:=public.admin_save_good(target);
   result:=jsonb_build_object('status','success','id',saved->>'id','code',saved->>'code');$anchor$;
  replacement text := $replacement$   if entry ? 'guidanceOnly' and entry->'guidanceOnly' <> 'true'::jsonb then
    raise invalid_parameter_value using message='invalid_import_guidance_only';
   end if;
   if entry->'guidanceOnly' = 'true'::jsonb then
    if entry->>'kind' is distinct from 'update' or current_good.id is null or current_good.archived_at is not null
     or not target ?& array['previous_id','code'] or target-array['previous_id','code'] <> '{}'::jsonb
     or target->>'previous_id' is distinct from current_good.id or target->>'code' is distinct from current_good.code
     or images <> '{}'::jsonb or entry->'guidance' is null or jsonb_typeof(entry->'guidance') <> 'object'
     or entry->'guidance' = '{}'::jsonb then
     raise invalid_parameter_value using message='invalid_import_guidance_only';
    end if;
    saved:=jsonb_build_object('id',current_good.id,'code',current_good.code);
   else
    saved:=public.admin_save_good(target);
   end if;
   perform private.apply_goods_import_guidance(batch.id,target_index,saved->>'id',entry->'guidance');
   result:=jsonb_build_object('status','success','id',saved->>'id','code',saved->>'code');$replacement$;
begin
  if cardinality(string_to_array(original,anchor)) <> 2 then
    raise exception 'admin_commit_goods_import_group guidance anchor mismatch';
  end if;
  select proowner,proacl into strict original_owner,original_acl from pg_proc where oid=signature;
  expected := replace(original,anchor,replacement);
  execute expected;
  if pg_get_functiondef(signature) is distinct from expected or exists(
    select 1 from pg_proc where oid=signature
      and (proowner is distinct from original_owner or proacl is distinct from original_acl)
  ) then raise exception 'goods_import_guidance_definition_preservation_failed'; end if;
end;
$patch$;

select private.register_operator_rpc_contract(
  'public.admin_goods_import_records(text[],text[])'::regprocedure, 'catalog.read', 'read', false);
select private.register_operator_internal_contract(
  'private.admin_commit_goods_import_group_before_category(uuid,integer)'::regprocedure);
select private.register_operator_internal_contract(
  'private.apply_goods_import_guidance(uuid,integer,text,jsonb)'::regprocedure);
notify pgrst, 'reload schema';
