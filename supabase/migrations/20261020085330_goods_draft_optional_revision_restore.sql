-- Restore the optional direct-input revision fallback without changing the
-- selling-window allowlist, draft ownership, CAS, artwork rules or permissions.
-- The applied selling-window migration remains immutable.
do $migration$
declare
  target regprocedure := 'public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure;
  original_definition text := pg_get_functiondef(target);
  broken_expression constant text := $broken$coalesce(p_values->>'customInputsExpectedRevision','salePeriodEnabled','saleStartsAt','saleEndsAt','salePeriodRevision','0')$broken$;
  restored_expression constant text := $restored$coalesce(p_values->>'customInputsExpectedRevision','0')$restored$;
  allowlist_anchor constant text := $fields$'customInputsExpectedRevision','salePeriodEnabled','saleStartsAt','saleEndsAt','salePeriodRevision','productAttributes'$fields$;
  original_owner oid;
  original_acl aclitem[];
  expected_definition text;
begin
  if (length(original_definition)-length(replace(original_definition,broken_expression,'')))/length(broken_expression) <> 1
    or (length(original_definition)-length(replace(original_definition,allowlist_anchor,'')))/length(allowlist_anchor) <> 1
  then raise exception 'goods_draft_optional_revision_anchor_mismatch'; end if;
  if not exists(select 1 from private.operator_rpc_contracts
    where signature='public.admin_save_goods_draft(uuid,jsonb,integer)'
      and capability='catalog.manage' and guard_kind='write' and not legacy_admin_only)
  then raise exception 'goods_draft_operator_contract_mismatch'; end if;
  select proowner,proacl into strict original_owner,original_acl from pg_proc where oid=target;
  expected_definition := replace(original_definition,broken_expression,restored_expression);
  execute expected_definition;
  if pg_get_functiondef(target) is distinct from expected_definition
    or strpos(pg_get_functiondef(target),allowlist_anchor)=0
    or exists(select 1 from pg_proc where oid=target
      and (proowner is distinct from original_owner or proacl is distinct from original_acl))
  then raise exception 'goods_draft_optional_revision_preservation_failed'; end if;
end $migration$;

select private.register_operator_rpc_contract('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure,'catalog.manage','write',false);
notify pgrst,'reload schema';
