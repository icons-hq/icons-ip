-- A stale editor is an application conflict, not a retryable database
-- serialization failure. PostgREST retries SQLSTATE 40001 transactions; report
-- HTTP 409 promptly so the editor can retain input and request a fresh version.
do $$
declare definition text;
  anchor constant text := 'raise serialization_failure using message=''curation_conflict'';';
begin
  definition:=pg_get_functiondef('private.save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz,boolean)'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'home_curation_conflict_response_anchor_missing';
  end if;
  execute replace(definition,anchor,'raise sqlstate ''PT409'' using message=''curation_conflict'';');
end $$;
select private.register_operator_internal_contract('private.save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz,boolean)'::regprocedure);
notify pgrst,'reload schema';
