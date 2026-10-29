begin;
-- PostgREST runs STABLE/IMMUTABLE RPCs in a READ ONLY transaction, even over POST.
-- The numbered packing reader keeps the sales.manage guard (subject/membership row
-- locks) and wraps admin_get_shipment_packs, which takes the same guard and was
-- made VOLATILE for this reason in 20261020085452. A lock-free guard here alone
-- would still fail inside that reader, so match it and keep the wrapper a pure
-- enrichment of the legacy reader's document and version.
alter function public.admin_get_shipment_packs_numbered(uuid[]) volatile;
revoke all on function public.admin_get_shipment_packs_numbered(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_shipment_packs_numbered(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_shipment_packs_numbered(uuid[])'::regprocedure,'sales.manage','read',false);
select private.register_operator_internal_contract('public.admin_get_shipment_packs_numbered(uuid[])'::regprocedure);
notify pgrst,'reload schema';
commit;
