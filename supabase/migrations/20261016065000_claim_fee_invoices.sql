begin;
-- Separate, explicitly agreed claim delivery charges. Never net against the
-- whole-order payment/refund, fabricate a bank transfer, or block claim rights.
create table private.claim_fee_policy (
 singleton boolean primary key default true check(singleton), revision bigint not null default 1 check(revision>0),
 enabled boolean not null default false, return_amount integer check(return_amount between 1 and 1000000),
 exchange_amount integer check(exchange_amount between 1 and 1000000), evidence text not null default '', updated_at timestamptz not null default clock_timestamp()
);
insert into private.claim_fee_policy(singleton) values(true);
create table private.claim_fee_ledgers (claim_id uuid primary key references public.order_cancellation_requests(id),revision bigint not null default 0);
create table private.claim_fee_invoices (
 id uuid primary key,claim_id uuid not null references public.order_cancellation_requests(id),payer_id uuid not null,
 payer_role text not null check(payer_role in('buyer','requester')), amount integer not null check(amount between 1 and 1000000),
 state text not null check(state in('unpaid','reported','paid','waived','voided','refund_due','refunded')),
 claim_type text not null,reason_type text not null,policy_revision bigint not null, bank_account jsonb not null,
 customer_note text not null,agreement_evidence text not null,issued_at timestamptz not null default clock_timestamp(),
 received_at timestamptz,refunded_at timestamptz,updated_at timestamptz not null default clock_timestamp(),
 check(state not in('paid','refund_due','refunded') or received_at is not null),check(state<>'refunded' or refunded_at is not null)
);
create unique index claim_fee_one_active on private.claim_fee_invoices(claim_id) where state in('unpaid','reported','paid');
create index claim_fee_invoice_payer on private.claim_fee_invoices(payer_id,claim_id,issued_at);
create table private.claim_fee_events (
 id uuid primary key,claim_id uuid not null references public.order_cancellation_requests(id),invoice_id uuid not null references private.claim_fee_invoices(id),
 actor_id uuid,session_id uuid,kind text not null,request jsonb not null,result jsonb,created_at timestamptz not null default clock_timestamp()
);
create index claim_fee_event_history on private.claim_fee_events(claim_id,created_at,id);
alter table private.claim_fee_policy enable row level security;
alter table private.claim_fee_ledgers enable row level security;
alter table private.claim_fee_invoices enable row level security;
alter table private.claim_fee_events enable row level security;
revoke all on private.claim_fee_policy,private.claim_fee_ledgers,private.claim_fee_invoices,private.claim_fee_events from public,anon,authenticated,service_role;

create function private.claim_fee_policy_document() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',revision,'enabled',enabled,'returnAmount',return_amount,'exchangeAmount',exchange_amount,'evidence',evidence,'updatedAt',updated_at,
 'accountReady',coalesce((select bank_transfer ?& array['bank','accountNumber','holder'] and not exists(select 1 from jsonb_each_text(bank_transfer) where value='') from public.store_settings where singleton),false))
 from private.claim_fee_policy where singleton;
$$;
create function public.admin_get_claim_fee_policy() returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('sales.manage',false);return private.claim_fee_policy_document();end $$;
create function public.admin_save_claim_fee_policy(p_values jsonb,p_revision bigint,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare policy private.claim_fee_policy;prior public.audit_log;request jsonb;result jsonb;k text;begin
 perform private.purchase_confirmation_identity(p_actor,p_session,true);
 if p_operation is null or p_revision is null or p_revision<1 or not private.transaction_json_keys(p_values,array['enabled','returnAmount','exchangeAmount','evidence','confirmed'])
  or jsonb_typeof(p_values->'enabled') is distinct from 'boolean' or p_values->'confirmed' is distinct from 'true'::jsonb
  or jsonb_typeof(p_values->'evidence') is distinct from 'string' or char_length(btrim(p_values->>'evidence')) not between 2 and 1000
  or (p_values->>'evidence')~'[[:cntrl:]]' then raise invalid_parameter_value;end if;
 foreach k in array array['returnAmount','exchangeAmount'] loop
  if p_values->k<>'null'::jsonb and (jsonb_typeof(p_values->k)<>'number' or p_values->>k!~'^[1-9][0-9]*$' or (p_values->>k)::numeric>1000000) then raise invalid_parameter_value;end if;
 end loop;
 select * into policy from private.claim_fee_policy where singleton for update;
 request:=jsonb_build_object('values',p_values,'revision',p_revision,'sessionId',p_session);
 select * into prior from public.audit_log where id=p_operation;
 if found then
  if prior.actor_id is distinct from p_actor or prior.action<>'admin.claim_fee.policy' or prior.diff->'request' is distinct from request then raise sqlstate 'PT409';end if;
  return prior.diff->'result';end if;
 if policy.revision<>p_revision then raise sqlstate 'PT409' using message='claim_fee_changed';end if;
 if p_values->'enabled'='true'::jsonb and (private.claim_fee_policy_document()->>'accountReady')::boolean is distinct from true then raise sqlstate 'PT409' using message='claim_fee_account_missing';end if;
 update private.claim_fee_policy set revision=revision+1,enabled=(p_values->>'enabled')::boolean,return_amount=(p_values->>'returnAmount')::integer,
  exchange_amount=(p_values->>'exchangeAmount')::integer,evidence=btrim(p_values->>'evidence'),updated_at=clock_timestamp() where singleton;
 result:=private.claim_fee_policy_document();
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation,p_actor,'admin.claim_fee.policy','claim_fee',jsonb_build_object('request',request,'result',result));return result;
end $$;

create function private.claim_fee_identity(p_claim uuid,p_actor uuid,p_session uuid,p_operator boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare order_key uuid;parties uuid[];begin
 if p_actor is null or p_actor is distinct from auth.uid() or p_session is null or auth.jwt()->>'session_id' is distinct from p_session::text then raise insufficient_privilege;end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_claim;
 if order_key is null then raise no_data_found;end if;
 parties:=private.contact_parties(order_key);
 if not p_operator and not(p_actor=any(parties)) then raise no_data_found;end if;
 perform private.gift_lock_subjects(array_append(parties,p_actor));
 perform private.lock_operator_subjects(array_append(parties,p_actor));
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and(not_after is null or not_after>clock_timestamp()) for share;
 if not found or exists(select 1 from private.account_action_fences where subject_user_id=any(array_append(parties,p_actor))) then raise insufficient_privilege;end if;
 perform private.assert_active_user(p_actor);
 if p_operator then perform private.require_operator_capability('sales.manage',false);end if;
 return order_key;
end $$;
create function private.claim_fee_document(p_claim uuid,p_actor uuid,p_operator boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('claimId',c.id,'orderId',c.order_id,'claimRevision',c.claim_revision,'revision',coalesce(l.revision,0),'claimType',c.claim_type,
 'policy',case when p_operator then private.claim_fee_policy_document() else null end,
 'canIssue',p_operator and p.enabled and c.claim_type in('return','exchange') and c.stage not in('completed','rejected','withdrawn')
   and not exists(select 1 from private.claim_fee_invoices where claim_id=c.id and state in('unpaid','reported','paid')),
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'amount',i.amount,'state',i.state,'payerRole',i.payer_role,
  'bankAccount',case when i.state in('unpaid','reported') then i.bank_account else null end,'customerNote',i.customer_note,
  'agreementEvidence',case when p_operator then i.agreement_evidence else '' end,'issuedAt',i.issued_at,'receivedAt',i.received_at,'refundedAt',i.refunded_at)
  order by i.issued_at desc,i.id) from private.claim_fee_invoices i where i.claim_id=c.id and (p_operator or i.payer_id=p_actor)),'[]'),
 'history',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'invoiceId',e.invoice_id,'kind',e.kind,'at',e.created_at,
  'evidence',case when p_operator then coalesce(e.request#>>'{values,evidence}','') else '' end) order by e.created_at desc,e.id)
  from(select e.* from private.claim_fee_events e join private.claim_fee_invoices i on i.id=e.invoice_id where e.claim_id=c.id and(p_operator or i.payer_id=p_actor) order by e.created_at desc,e.id limit 50)e),'[]'))
 from public.order_cancellation_requests c left join private.claim_fee_ledgers l on l.claim_id=c.id cross join private.claim_fee_policy p where c.id=p_claim and p.singleton;
$$;
create function public.admin_get_claim_fees(p_claim uuid,p_actor uuid,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.claim_fee_identity(p_claim,p_actor,p_session,true);return private.claim_fee_document(p_claim,p_actor,true);end $$;
create function public.get_my_claim_fees(p_claim uuid,p_actor uuid,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.claim_fee_identity(p_claim,p_actor,p_session,false);return private.claim_fee_document(p_claim,p_actor,false);end $$;

create function private.change_claim_fee(p_claim uuid,p_invoice uuid,p_kind text,p_values jsonb,p_revision bigint,p_claim_revision integer,p_operation uuid,p_actor uuid,p_session uuid,p_operator boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare order_key uuid;parties uuid[];c public.order_cancellation_requests;l private.claim_fee_ledgers;i private.claim_fee_invoices;e private.claim_fee_events;
 policy private.claim_fee_policy;account jsonb;payer uuid;request jsonb;v_result jsonb;occurred timestamptz;begin
 order_key:=private.claim_fee_identity(p_claim,p_actor,p_session,p_operator);parties:=private.contact_parties(order_key);
 if p_operation is null or p_revision is null or p_revision<0 or p_claim_revision is null or p_claim_revision<0 or p_kind is null
  or(p_operator and p_kind not in('issue','confirm_payment','waive','cancel','refund')) or(not p_operator and p_kind<>'report_payment')
  or(p_kind='issue' and p_invoice is not null) or(p_kind<>'issue' and p_invoice is null) then raise invalid_parameter_value;end if;
 if p_kind='issue' then
  if not private.transaction_json_keys(p_values,array['amount','payerRole','customerNote','evidence','confirmed'])
   or jsonb_typeof(p_values->'amount') is distinct from 'number' or p_values->>'amount'!~'^[1-9][0-9]*$' or (p_values->>'amount')::numeric>1000000
   or coalesce(p_values->>'payerRole','') not in('buyer','requester') or jsonb_typeof(p_values->'customerNote') is distinct from 'string'
   or char_length(btrim(p_values->>'customerNote')) not between 2 and 500 or (p_values->>'customerNote')~'[[:cntrl:]]' then raise invalid_parameter_value;end if;
 elsif p_kind in('confirm_payment','refund') then
  if not private.transaction_json_keys(p_values,array['amount','occurredAt','evidence','confirmed']) or jsonb_typeof(p_values->'amount') is distinct from 'number'
   or p_values->>'amount'!~'^[1-9][0-9]*$' or (p_values->>'amount')::numeric>1000000
   or jsonb_typeof(p_values->'occurredAt') is distinct from 'string' then raise invalid_parameter_value;end if;
  begin occurred:=(p_values->>'occurredAt')::timestamptz;exception when others then raise invalid_parameter_value;end;
  if not isfinite(occurred) or occurred>clock_timestamp()+interval '1 minute' then raise invalid_parameter_value;end if;
 elsif p_kind='report_payment' then
  if not private.transaction_json_keys(p_values,array['confirmed']) then raise invalid_parameter_value;end if;
 else
  if not private.transaction_json_keys(p_values,array['evidence','confirmed']) then raise invalid_parameter_value;end if;
 end if;
 if p_values->'confirmed' is distinct from 'true'::jsonb or p_operator and (jsonb_typeof(p_values->'evidence') is distinct from 'string'
  or char_length(btrim(p_values->>'evidence')) not between 2 and 1000 or (p_values->>'evidence')~'[[:cntrl:]]') then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-fee:'||p_operation,0));
 request:=jsonb_build_object('claimId',p_claim,'invoiceId',p_invoice,'kind',p_kind,'values',p_values,'revision',p_revision,'claimRevision',p_claim_revision,'operator',p_operator);
 select * into e from private.claim_fee_events where id=p_operation;
 if found then
  if e.actor_id is distinct from p_actor or e.session_id is distinct from p_session or e.request<>request then raise sqlstate 'PT409' using message='claim_fee_conflict';end if;
  return e.result;end if;
 c:=private.contact_lock_scope(order_key,p_claim,parties);
 if c.claim_revision<>p_claim_revision then raise sqlstate 'PT409' using message='claim_fee_changed';end if;
 insert into private.claim_fee_ledgers(claim_id) values(p_claim) on conflict do nothing;
 select * into l from private.claim_fee_ledgers where claim_id=p_claim for update;
 if l.revision<>p_revision then raise sqlstate 'PT409' using message='claim_fee_changed';end if;
 if p_kind='issue' then
  select * into policy from private.claim_fee_policy where singleton for share;
  if not policy.enabled or not (private.claim_fee_document(p_claim,p_actor,true)->>'canIssue')::boolean then raise sqlstate 'PT409' using message='claim_fee_issue_blocked';end if;
  select bank_transfer into account from public.store_settings where singleton for share;
  if account is null or not(account ?& array['bank','accountNumber','holder']) or exists(select 1 from jsonb_each_text(account) where value='') then raise sqlstate 'PT409' using message='claim_fee_account_missing';end if;
  select case when p_values->>'payerRole'='requester' then c.requested_by else user_id end into payer from public.orders where id=order_key;
  if payer is null or not(payer=any(parties)) then raise sqlstate 'PT409' using message='claim_fee_payer_invalid';end if;
  insert into private.claim_fee_invoices(id,claim_id,payer_id,payer_role,amount,state,claim_type,reason_type,policy_revision,bank_account,customer_note,agreement_evidence)
   values(p_operation,p_claim,payer,p_values->>'payerRole',(p_values->>'amount')::integer,'unpaid',c.claim_type,c.reason_type,policy.revision,account,btrim(p_values->>'customerNote'),btrim(p_values->>'evidence')) returning * into i;
 else
  select * into i from private.claim_fee_invoices where id=p_invoice and claim_id=p_claim for update;
  if not found or not p_operator and i.payer_id<>p_actor then raise no_data_found;end if;
  if p_kind='report_payment' and i.state<>'unpaid' or p_kind='waive' and i.state not in('unpaid','reported')
   or p_kind='cancel' and i.state not in('unpaid','reported','paid') or p_kind='confirm_payment' and i.state not in('unpaid','reported','voided','waived')
   or p_kind='refund' and i.state<>'refund_due' then raise sqlstate 'PT409' using message='claim_fee_state_blocked';end if;
  if p_kind in('confirm_payment','refund') and ((p_values->>'amount')::integer<>i.amount or occurred<i.issued_at or p_kind='refund' and occurred<i.received_at) then raise invalid_parameter_value using message='claim_fee_amount_or_time';end if;
  update private.claim_fee_invoices set state=case p_kind when 'report_payment' then 'reported' when 'waive' then 'waived'
    when 'cancel' then case when i.state='paid' then 'refund_due' else 'voided' end
    when 'confirm_payment' then case when i.state in('voided','waived') then 'refund_due' else 'paid' end when 'refund' then 'refunded' end,
   received_at=case when p_kind='confirm_payment' then occurred else received_at end,refunded_at=case when p_kind='refund' then occurred else refunded_at end,updated_at=clock_timestamp() where id=i.id;
 end if;
 update private.claim_fee_ledgers set revision=revision+1 where claim_id=p_claim;
 insert into private.claim_fee_events(id,claim_id,invoice_id,actor_id,session_id,kind,request) values(p_operation,p_claim,i.id,p_actor,p_session,p_kind,request);
 v_result:=private.claim_fee_document(p_claim,p_actor,p_operator);
 update private.claim_fee_events set result=v_result where id=p_operation;
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor,case when p_operator then 'admin.order.claim_fee_' else 'order.claim_fee_' end||p_kind,p_claim::text,
  jsonb_build_object('operationId',p_operation,'invoiceId',i.id,'amount',i.amount,'revision',l.revision+1));
 return v_result;
end $$;
create function public.admin_change_claim_fee(p_claim uuid,p_invoice uuid,p_kind text,p_values jsonb,p_revision bigint,p_claim_revision integer,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language sql security definer set search_path='' as $$select private.change_claim_fee(p_claim,p_invoice,p_kind,p_values,p_revision,p_claim_revision,p_operation,p_actor,p_session,true)$$;
create function public.report_my_claim_fee_payment(p_claim uuid,p_invoice uuid,p_revision bigint,p_claim_revision integer,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language sql security definer set search_path='' as $$select private.change_claim_fee(p_claim,p_invoice,'report_payment','{"confirmed":true}',p_revision,p_claim_revision,p_operation,p_actor,p_session,false)$$;

-- Claim basis changes invalidate collection authority, never erase paid money.
create function private.invalidate_claim_fee_basis() returns trigger language plpgsql security definer set search_path='' as $$
declare i private.claim_fee_invoices;changed boolean:=false;begin
 if new.claim_type is not distinct from old.claim_type and new.reason_type is not distinct from old.reason_type and new.reason is not distinct from old.reason
  and not(new.stage in('rejected','withdrawn') and new.stage is distinct from old.stage) then return null;end if;
 for i in select * from private.claim_fee_invoices where claim_id=new.id and state in('unpaid','reported','paid') order by id for update loop
  update private.claim_fee_invoices set state=case when i.state='paid' then 'refund_due' else 'voided' end,updated_at=clock_timestamp() where id=i.id;
  insert into private.claim_fee_events(id,claim_id,invoice_id,kind,request) values(gen_random_uuid(),new.id,i.id,'basis_changed','{}');changed:=true;
 end loop;
 if changed then update private.claim_fee_ledgers set revision=revision+1 where claim_id=new.id;end if;return null;
end $$;
create trigger claim_fee_basis_changed after update of claim_type,reason_type,reason,stage on public.order_cancellation_requests for each row execute function private.invalidate_claim_fee_basis();

do $$declare sig text;begin
 foreach sig in array array['private.claim_fee_policy_document()','private.claim_fee_identity(uuid,uuid,uuid,boolean)','private.claim_fee_document(uuid,uuid,boolean)',
  'private.change_claim_fee(uuid,uuid,text,jsonb,bigint,integer,uuid,uuid,uuid,boolean)','private.invalidate_claim_fee_basis()',
  'public.admin_get_claim_fee_policy()','public.admin_save_claim_fee_policy(jsonb,bigint,uuid,uuid,uuid)','public.admin_get_claim_fees(uuid,uuid,uuid)',
  'public.get_my_claim_fees(uuid,uuid,uuid)','public.admin_change_claim_fee(uuid,uuid,text,jsonb,bigint,integer,uuid,uuid,uuid)',
  'public.report_my_claim_fee_payment(uuid,uuid,bigint,integer,uuid,uuid,uuid)'] loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',sig);
  if sig like 'public.%' then execute format('grant execute on function %s to authenticated',sig);end if;
  if sig like 'public.admin_%' then perform private.register_operator_rpc_contract(sig::regprocedure,'sales.manage',case when sig like 'public.admin_get_%' then 'read' else 'write' end,false);end if;
 end loop;
end $$;
commit;
