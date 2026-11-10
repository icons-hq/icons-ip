-- Reviewed repair, verified with the existing OWN role and owner boundaries.
-- Reuse each authorized public getter's SECURITY DEFINER owner boundary.
-- Existing deployments may have different trusted owners for private documents.
do $patch$
declare
  signature regprocedure := 'public.admin_goods_import_records(text[],text[])'::regprocedure;
  original text := pg_get_functiondef(signature);
  original_owner oid;
  original_acl aclitem[];
  expected text;
  as_anchor text := $anchor$then private.goods_after_sales_document(entry.value#>>'{good,id}') else null end$anchor$;
  as_replacement text := $replacement$then public.admin_get_goods_after_sales_content(entry.value#>>'{good,id}') else null end$replacement$;
  size_anchor text := $anchor$then private.goods_size_chart_document(entry.value#>>'{good,id}') else null end$anchor$;
  size_replacement text := $replacement$then public.admin_get_goods_size_chart(entry.value#>>'{good,id}') else null end$replacement$;
begin
  if cardinality(string_to_array(original,as_anchor)) <> 2
    or cardinality(string_to_array(original,size_anchor)) <> 2 then
    raise exception 'goods_import_guidance_reader_boundary_anchor_mismatch';
  end if;
  select proowner,proacl into strict original_owner,original_acl from pg_proc where oid=signature;
  expected := replace(replace(original,as_anchor,as_replacement),size_anchor,size_replacement);
  execute expected;
  if pg_get_functiondef(signature) is distinct from expected or exists(
    select 1 from pg_proc where oid=signature
      and (proowner is distinct from original_owner or proacl is distinct from original_acl)
  ) then raise exception 'goods_import_guidance_reader_boundary_preservation_failed'; end if;
end;
$patch$;
select private.register_operator_rpc_contract(
  'public.admin_goods_import_records(text[],text[])'::regprocedure, 'catalog.read', 'read', false);
notify pgrst, 'reload schema';
