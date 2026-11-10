begin;
-- Existing obligations remain serviceable after a customer's deletion request;
-- the fence still prevents new charges, and a fenced operator cannot act.
do $$declare definition text;anchor text;begin
 definition:=pg_get_functiondef('private.claim_fee_identity(uuid,uuid,uuid,boolean)'::regprocedure);
 anchor:='subject_user_id=any(array_append(parties,p_actor))';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'claim_fee_identity_anchor_changed';end if;
 execute replace(definition,anchor,'subject_user_id=p_actor');
 definition:=pg_get_functiondef('private.change_claim_fee(uuid,uuid,text,jsonb,bigint,integer,uuid,uuid,uuid,boolean)'::regprocedure);
 anchor:='if not policy.enabled or not (private.claim_fee_document(p_claim,p_actor,true)->>''canIssue'')::boolean then';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'claim_fee_issue_anchor_changed';end if;
 execute replace(definition,anchor,'if exists(select 1 from private.account_action_fences where subject_user_id=any(parties)) or not policy.enabled or not (private.claim_fee_document(p_claim,p_actor,true)->>''canIssue'')::boolean then');
end $$;

create function public.get_my_order_claim_fees(p_order uuid,p_actor uuid,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare parties uuid[];begin
 if p_actor is null or p_actor is distinct from auth.uid() or p_session is null or auth.jwt()->>'session_id' is distinct from p_session::text then raise insufficient_privilege;end if;
 parties:=private.contact_parties(p_order);
 if parties is null or not(p_actor=any(parties)) then raise no_data_found;end if;
 perform private.gift_lock_subjects(array_append(parties,p_actor));perform private.lock_operator_subjects(array_append(parties,p_actor));
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and(not_after is null or not_after>clock_timestamp()) for share;
 if not found or private.is_account_write_fenced(p_actor) then raise insufficient_privilege;end if;
 perform private.assert_active_user(p_actor);
 return coalesce((select jsonb_agg(private.claim_fee_document(c.id,p_actor,false) order by c.requested_at desc,c.id)
  from public.order_cancellation_requests c where c.order_id=p_order and exists(select 1 from private.claim_fee_invoices i where i.claim_id=c.id and i.payer_id=p_actor)),'[]');
end $$;
create function public.admin_list_claim_fees(p_state text default 'open',p_page integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('sales.manage',false);
 if p_state is null or p_state not in('open','all','unpaid','reported','paid','waived','voided','refund_due','refunded') or p_page is null or p_page not between 1 and 50000 then raise invalid_parameter_value;end if;
 return jsonb_build_object('state',p_state,'page',p_page,'pageSize',50,
  'total',(select count(*) from private.claim_fee_invoices where p_state='all' or p_state='open' and state in('unpaid','reported','refund_due') or state=p_state),
  'counts',(select coalesce(jsonb_object_agg(state,n),'{}') from(select state,count(*) n from private.claim_fee_invoices group by state)x),
  'rows',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'claimId',i.claim_id,'orderId',c.order_id,'claimType',c.claim_type,'amount',i.amount,'state',i.state,
   'payerRole',i.payer_role,'issuedAt',i.issued_at,'receivedAt',i.received_at,'refundedAt',i.refunded_at) order by i.issued_at desc,i.id),'[]')
   from(select * from private.claim_fee_invoices where p_state='all' or p_state='open' and state in('unpaid','reported','refund_due') or state=p_state order by issued_at desc,id limit 50 offset(p_page-1)*50)i
   join public.order_cancellation_requests c on c.id=i.claim_id));
end $$;

create function private.claim_fee_account_blockers(p_actor uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when count(*)>0 then jsonb_build_array(jsonb_build_object('code','active_claim_fee','count',count(*),'path','/orders')) else '[]'::jsonb end
 from private.claim_fee_invoices where payer_id=p_actor and state in('unpaid','reported','refund_due');
$$;
do $$declare definition text;anchor text:='|| private.goods_transaction_account_blockers(p_user_id)';begin
 definition:=pg_get_functiondef('private.account_deletion_blockers(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'claim_fee_account_blocker_anchor_changed';end if;
 execute replace(definition,anchor,anchor||' || private.claim_fee_account_blockers(p_user_id)');
end $$;
-- Use the established transaction retention period and snapshot store; exclude
-- bank account, contact details, sessions and free-text agreement/evidence.
do $$declare definition text;begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='private.account_deletion_legal_snapshots'::regclass and conname='account_deletion_legal_snapshots_record_type_check';
 if definition is null or position('ARRAY[' in definition)=0 then raise exception 'claim_fee_snapshot_type_anchor_changed';end if;
 alter table private.account_deletion_legal_snapshots drop constraint account_deletion_legal_snapshots_record_type_check;
 execute 'alter table private.account_deletion_legal_snapshots add constraint account_deletion_legal_snapshots_record_type_check '||replace(definition,'ARRAY[','ARRAY[''claim_fee''::text,');
end $$;
create function private.snapshot_claim_fee_contracts(p_deletion_event uuid,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$begin
 insert into private.account_deletion_legal_snapshots(deletion_event_id,record_type,record_ref,snapshot_data,legal_basis,retain_until)
 select p_deletion_event,'claim_fee',i.id::text,jsonb_build_object('invoiceRef',i.id,'claimRef',i.claim_id,'amount',i.amount,'state',i.state,'payerRole',i.payer_role,
  'claimType',i.claim_type,'reasonType',i.reason_type,'policyRevision',i.policy_revision,'issuedAt',i.issued_at,'receivedAt',i.received_at,'refundedAt',i.refunded_at,
  'events',coalesce((select jsonb_agg(jsonb_build_object('operationId',e.id,'kind',e.kind,'at',e.created_at,'occurredAt',e.request#>'{values,occurredAt}') order by e.created_at,e.id) from private.claim_fee_events e where e.invoice_id=i.id),'[]')),
  'ecommerce_transaction_v1',greatest(i.issued_at,i.received_at,i.refunded_at,i.updated_at)+interval '5 years'
 from private.claim_fee_invoices i where i.payer_id=p_actor and greatest(i.issued_at,i.received_at,i.refunded_at,i.updated_at)+interval '5 years'>clock_timestamp()
 on conflict(deletion_event_id,record_type,record_ref) do update set snapshot_data=excluded.snapshot_data,retain_until=greatest(private.account_deletion_legal_snapshots.retain_until,excluded.retain_until)
 where private.account_deletion_legal_snapshots.destroyed_at is null;
end $$;
do $$declare definition text;anchor text:='perform private.snapshot_goods_subscription_contracts(p_deletion_event_id,p_user_id);';begin
 definition:=pg_get_functiondef('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'claim_fee_snapshot_anchor_changed';end if;
 execute replace(definition,anchor,anchor||E'\n  perform private.snapshot_claim_fee_contracts(p_deletion_event_id,p_user_id);');
end $$;
revoke all on function public.get_my_order_claim_fees(uuid,uuid,uuid),public.admin_list_claim_fees(text,integer),private.claim_fee_account_blockers(uuid),private.snapshot_claim_fee_contracts(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_order_claim_fees(uuid,uuid,uuid),public.admin_list_claim_fees(text,integer) to authenticated;
select private.register_operator_rpc_contract('public.admin_list_claim_fees(text,integer)'::regprocedure,'sales.manage','read',false);
select private.register_operator_internal_contract('private.claim_fee_account_blockers(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.snapshot_claim_fee_contracts(uuid,uuid)'::regprocedure);
commit;
