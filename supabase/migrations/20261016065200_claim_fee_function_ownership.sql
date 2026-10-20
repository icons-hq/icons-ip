begin;
-- Match the established database owner even if a bootstrap connection has a
-- different owner. Existing deletion/snapshot functions must call these sealed
-- helpers without giving an API role direct access.
alter table private.claim_fee_policy owner to postgres;
alter table private.claim_fee_ledgers owner to postgres;
alter table private.claim_fee_invoices owner to postgres;
alter table private.claim_fee_events owner to postgres;
do $$declare sig text;begin
 foreach sig in array array['private.claim_fee_policy_document()','private.claim_fee_identity(uuid,uuid,uuid,boolean)','private.claim_fee_document(uuid,uuid,boolean)',
  'private.change_claim_fee(uuid,uuid,text,jsonb,bigint,integer,uuid,uuid,uuid,boolean)','private.invalidate_claim_fee_basis()',
  'private.claim_fee_account_blockers(uuid)','private.snapshot_claim_fee_contracts(uuid,uuid)',
  'public.admin_get_claim_fee_policy()','public.admin_save_claim_fee_policy(jsonb,bigint,uuid,uuid,uuid)','public.admin_get_claim_fees(uuid,uuid,uuid)',
  'public.get_my_claim_fees(uuid,uuid,uuid)','public.admin_change_claim_fee(uuid,uuid,text,jsonb,bigint,integer,uuid,uuid,uuid)',
  'public.report_my_claim_fee_payment(uuid,uuid,bigint,integer,uuid,uuid,uuid)','public.get_my_order_claim_fees(uuid,uuid,uuid)','public.admin_list_claim_fees(text,integer)'] loop
  execute format('alter function %s owner to postgres',sig);
  if sig like 'private.%' then perform private.register_operator_internal_contract(sig::regprocedure);end if;
 end loop;
end $$;
commit;
