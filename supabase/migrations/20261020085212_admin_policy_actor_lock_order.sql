-- Account actions take their per-user fence lock before profile rows. Policy
-- writers must use the same order to avoid a cycle with a simultaneous payment.
do $$
declare signature text; original pg_catalog.pg_proc; after_row pg_catalog.pg_proc; definition text; changed text;
begin
  foreach signature in array array['public.admin_save_loyalty_policy(jsonb,integer,uuid)','public.admin_set_operator_duty(uuid,text,integer,uuid)'] loop
    select * into strict original from pg_catalog.pg_proc where oid=signature::regprocedure;
    definition:=pg_get_functiondef(original.oid);changed:=definition;
    if signature like 'public.admin_save_loyalty_policy%' then
      if position('if not found or private.is_account_write_fenced(actor)' in changed)=0 then raise exception 'unexpected loyalty policy definition'; end if;
      changed:=replace(changed,E'begin\n  perform 1 from public.profiles',E'begin\n  if private.is_account_write_fenced(actor) then raise insufficient_privilege using message=''admin_required''; end if;\n  perform 1 from public.profiles');
      changed:=replace(changed,'if not found or private.is_account_write_fenced(actor)','if not found');
    else
      if position('or private.is_account_write_fenced(actor)' in changed)=0 then raise exception 'unexpected operator duty definition'; end if;
      changed:=replace(changed,'  -- Stable role checks',E'  if private.is_account_write_fenced(actor) then raise insufficient_privilege using message=''admin_required''; end if;\n  -- Stable role checks');
      changed:=replace(changed,E'\n    or private.is_account_write_fenced(actor)','');
    end if;
    if changed=definition or position('private.is_account_write_fenced(actor)' in changed)>position('perform 1 from public.profiles' in changed)
      then raise exception 'actor lock order replacement failed: %',signature; end if;
    execute changed;
    select * into strict after_row from pg_catalog.pg_proc where oid=original.oid;
    if (to_jsonb(original)-'prosrc') is distinct from (to_jsonb(after_row)-'prosrc')
      then raise exception 'function metadata changed: %',signature; end if;
  end loop;
end $$;
notify pgrst,'reload schema';
