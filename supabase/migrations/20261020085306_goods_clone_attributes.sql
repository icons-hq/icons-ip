-- Product cloning predates dynamic attributes. Supply the locked source's
-- current values to the canonical writer and preserve former-category entries
-- as private retained values on the new draft, under its initial revision.
do $migration$
declare body text; declaration_anchor text:='  target_payload jsonb;';
 payload_anchor text:='  saved := public.admin_save_good(target_payload);';
 saved_anchor text:=E'  -- Stopped non-default rows are historical configuration, not rows of the';
begin
 body:=pg_get_functiondef('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure);
 if (length(body)-length(replace(body,declaration_anchor,'')))/length(declaration_anchor)<>1
  or (length(body)-length(replace(body,payload_anchor,'')))/length(payload_anchor)<>1
  or (length(body)-length(replace(body,saved_anchor,'')))/length(saved_anchor)<>1 then
  raise exception 'goods_clone_attributes_anchor_missing';end if;
 body:=replace(body,declaration_anchor,declaration_anchor||E'\n  source_attribute_entries jsonb; clone_attribute_fields jsonb; clone_attribute_revision integer;\n  clone_attribute_submission jsonb; clone_attribute_entries jsonb;');
 body:=replace(body,payload_anchor,$patch$
  -- The category tree and source good are already locked, so a competing schema
  -- or product edit cannot mix its definition with the copied values.
  select entries into source_attribute_entries from public.goods_attribute_values where good_id=source_good.id for share;
  select fields,revision into clone_attribute_fields,clone_attribute_revision
    from public.catalog_category_attribute_schemas where category_id=category_value for share;
  source_attribute_entries:=coalesce(source_attribute_entries,'[]');
  clone_attribute_fields:=coalesce(clone_attribute_fields,'[]');
  clone_attribute_submission:=jsonb_build_object('categoryId',category_value,'schemaRevision',coalesce(clone_attribute_revision,0),
    'expectedRevision',0,'values',coalesce((select jsonb_object_agg(entry#>>'{field,id}',entry->'value')
      from jsonb_array_elements(source_attribute_entries) entry
      where exists(select 1 from jsonb_array_elements(clone_attribute_fields) field where field->>'id'=entry#>>'{field,id}'
        and field->>'kind'=entry#>>'{field,kind}' and field->>'unit'=entry#>>'{field,unit}'
        and private.goods_attribute_value_valid(field,entry->'value'))),'{}'),
    'removeIds','[]'::jsonb);
  clone_attribute_entries:=private.merge_goods_attributes(source_attribute_entries,clone_attribute_fields,clone_attribute_submission->'values','[]');
  target_payload:=target_payload||jsonb_build_object('product_attributes',clone_attribute_submission);
  saved := public.admin_save_good(target_payload);
$patch$);
 body:=replace(body,saved_anchor,$patch$
  -- Creation remains one transaction/version, including values retained after a
  -- source category change. Publication still exposes only matching definitions.
  update public.goods_attribute_values set entries=clone_attribute_entries
    where good_id=saved_id and entries is distinct from clone_attribute_entries;
  if clone_attribute_entries<>'[]'::jsonb then
    insert into public.audit_log(actor_id,action,target,diff) values(actor_id,'catalog.goods_attributes_cloned','goods:'||saved_id,
      jsonb_build_object('sourceGoodId',source_good.id,'after',clone_attribute_entries,'revision',1));
  end if;
$patch$||saved_anchor);
 execute body;
end $migration$;
select private.register_operator_internal_contract('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure);
