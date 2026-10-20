begin;

-- The existing exporter and capability guard acquire row locks. PostgREST
-- runs STABLE RPCs in read-only transactions, which would reject those locks.
-- This changes transaction mode only; exporting still makes no data changes.
alter function public.admin_smartstore_shipment_export(uuid[]) volatile;

select private.register_operator_rpc_contract(
  'public.admin_smartstore_shipment_export(uuid[])'::regprocedure,
  'sales.manage','read',false
);

notify pgrst, 'reload schema';
commit;
