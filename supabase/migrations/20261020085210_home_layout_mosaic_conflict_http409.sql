-- The mosaic layout extension redefined this function after the shared HTTP
-- conflict migration. Restore its application conflict status without changing
-- the expanded block contract, ownership, ACL, or other pg_proc attributes.
do $migration$
declare
  target_oid oid := 'public.admin_save_home_layout(uuid,bigint,jsonb)'::regprocedure;
  original_source text; original_definition text; original_metadata jsonb;
  changed_source text; changed_metadata jsonb;
  old_raise constant text := 'raise serialization_failure using message=''home_layout_conflict'';';
  new_raise constant text := 'raise sqlstate ''PT409'' using message=''home_layout_conflict'';';
begin
  select p.prosrc, pg_get_functiondef(p.oid), to_jsonb(p)-'prosrc'
    into original_source, original_definition, original_metadata
    from pg_proc p where p.oid=target_oid;
  if (length(original_source)-length(replace(original_source,old_raise,'')))/length(old_raise)<>1
  then raise exception 'Unexpected mosaic layout conflict body; review before migration'; end if;
  execute replace(original_definition,old_raise,new_raise);
  select p.prosrc, to_jsonb(p)-'prosrc' into changed_source, changed_metadata
    from pg_proc p where p.oid=target_oid;
  if changed_source is distinct from replace(original_source,old_raise,new_raise)
    or changed_metadata is distinct from original_metadata
  then raise exception 'Unexpected mosaic layout function or ACL change'; end if;
end;
$migration$;

notify pgrst, 'reload schema';
