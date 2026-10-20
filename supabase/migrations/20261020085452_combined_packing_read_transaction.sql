begin;
-- The operator capability guard takes subject/membership locks. PostgREST must
-- therefore run these reads in a read/write transaction, even without mutations.
alter function public.admin_get_shipment_packs(uuid[]) volatile;
alter function public.admin_shipment_pack_summaries(uuid[]) volatile;
notify pgrst,'reload schema';
commit;
