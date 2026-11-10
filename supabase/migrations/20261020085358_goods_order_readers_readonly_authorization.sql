-- Keep reviewed pure order readers compatible with PostgREST READ ONLY requests.
-- A STABLE RPC runs read-only even for POST. These readers do not reserve work
-- or mutate an order, so use the same capability predicate as address context.
-- https://docs.postgrest.org/en/v14/references/transactions.html#access-mode-on-functions

do $patch$
declare signature text;fn regprocedure;definition text;contract record;
 anchor text:=$old$perform private.require_actor_operator_capability(auth.uid(),'sales.read',false);$old$;
 replacement text:=$new$if not coalesce(private.has_operator_capability(auth.uid(),'sales.read',false),false) then
  raise insufficient_privilege using message='operator_capability_required';end if;$new$;
begin
 foreach signature in array array['public.admin_get_order_delivery_snapshots(uuid[])','public.admin_get_order_transaction_receipts(uuid[])'] loop
  fn:=signature::regprocedure;
  if (select provolatile from pg_proc where oid=fn::oid)<>'s' then raise exception 'order_reader_volatility_changed: %',signature;end if;
  definition:=pg_get_functiondef(fn);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
   raise exception 'order_reader_capability_anchor_changed: %',signature;end if;
  execute replace(definition,anchor,replacement);
  select * into contract from private.operator_rpc_contracts registered where registered.signature::regprocedure=fn;
  if not found or contract.capability<>'sales.read' or contract.guard_kind<>'read' or contract.legacy_admin_only then
   raise exception 'order_reader_permission_contract_changed: %',signature;end if;
  perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
 end loop;
end $patch$;
notify pgrst,'reload schema';
