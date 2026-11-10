-- Payer-only completion of a missing refund account on an existing
-- ordinary bank-transfer claim. Apply only to an owned disposable clone first.
-- Approval opens a requested refund row; it does not mean a transfer was filed.
-- No payment, refund amount, order status, stock, or gift contract is changed.

create table private.order_claim_refund_account_operations (
 id uuid primary key,
 actor_id uuid not null,
 session_id uuid not null,
 order_id uuid not null references public.orders(id) on delete cascade,
 claim_id uuid not null references public.order_cancellation_requests(id) on delete cascade,
 expected_revision integer not null check(expected_revision>=0),
 result_revision integer not null,
 state text not null check(state in('saved','sealed')),
 request_hash text check(request_hash~'^[0-9a-f]{64}$'),
 hash_purged_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 check(result_revision=expected_revision+case when state='saved' then 1 else 0 end),
 check((state='sealed' and request_hash is null and hash_purged_at is null)
  or(state='saved' and ((request_hash is not null and hash_purged_at is null)
    or(request_hash is null and hash_purged_at is not null))))
);
create index order_claim_refund_account_operations_claim on private.order_claim_refund_account_operations(claim_id);
alter table private.order_claim_refund_account_operations enable row level security;
revoke all on private.order_claim_refund_account_operations from public,anon,authenticated,service_role;

create function private.require_claim_refund_account_identity(p_actor uuid,p_session_id uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if p_actor is null or auth.uid() is distinct from p_actor or p_session_id is null
  or auth.jwt()->>'session_id' is distinct from p_session_id::text
  or not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_actor
    and (not_after is null or not_after>statement_timestamp()))
  or not exists(select 1 from public.profiles where id=p_actor) then
  raise insufficient_privilege using message='refund_account_auth_changed';
 end if;
end $$;

create function private.lock_claim_refund_account_session(p_actor uuid,p_session_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 -- A logout/expiry update and an accepted write have a single ordering point.
 -- Readers that only return context remain STABLE and do not take row locks.
 perform id from auth.sessions where id=p_session_id and user_id=p_actor
  and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise insufficient_privilege using message='refund_account_auth_changed';end if;
 perform private.require_claim_refund_account_identity(p_actor,p_session_id);
end $$;

create function private.order_claim_refund_account_blocker(p_claim public.order_cancellation_requests,p_order public.orders) returns text
language sql stable security definer set search_path='' as $$
 select case
  when p_order.id is null or p_claim.id is null or p_claim.order_id is distinct from p_order.id then 'claim_not_found'
  when exists(select 1 from private.gift_intents where order_id=p_order.id) then 'refund_account_gift_order'
  when p_order.payment_method is distinct from 'bank_transfer' or p_order.total<=0 then 'refund_account_payment_unavailable'
  when p_order.status::text not in('paid','confirmed','shipping','delivered','done')
   or p_claim.claim_type not in('cancel','return')
   or p_claim.stage not in('requested','in_review','collecting','collected','on_hold','processing','needs_review')
   or p_claim.status not in('requested','processing','needs_review') then 'refund_account_claim_closed'
  when exists(select 1 from private.claim_refund_accounts where claim_id=p_claim.id) then 'refund_account_already_recorded'
  when not exists(select 1 from public.payments where purpose='order' and ref_id=p_order.id and provider='bank_transfer' and status='paid' and amount>0)
   or exists(select 1 from public.payments where purpose='order' and ref_id=p_order.id and(provider<>'bank_transfer' or status<>'paid'))
   or (select sum(amount) from public.payments where purpose='order' and ref_id=p_order.id) is distinct from p_order.total then 'refund_account_payment_unavailable'
  when exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id
   where p.purpose='order' and p.ref_id=p_order.id and(r.status<>'requested' or r.method is not null
    or r.filed_at is not null or r.completed_at is not null or r.handled_by is not null
    or r.cancellation_request_id is distinct from p_claim.id or r.amount<>p.amount)) then 'refund_account_finance_started'
  else null end;
$$;

create function private.order_claim_refund_account_receipt(p_operation_id uuid,p_actor uuid,p_session_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('operationId',id,'actorId',actor_id,'orderId',order_id,'claimId',claim_id,
  'revision',expected_revision,'resultRevision',result_revision,'state',state,'createdAt',created_at)
 from private.order_claim_refund_account_operations where id=p_operation_id and actor_id=p_actor and session_id=p_session_id;
$$;

create function public.get_my_order_claim_refund_account_context(p_order_id uuid,p_claim_id uuid,p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare purchase public.orders;claim public.order_cancellation_requests;account private.claim_refund_accounts;blocker text;
begin
 perform private.require_claim_refund_account_identity(p_expected_actor_id,p_expected_session_id);
 select * into purchase from public.orders where id=p_order_id and user_id=p_expected_actor_id;
 select * into claim from public.order_cancellation_requests where id=p_claim_id and order_id=purchase.id;
 if purchase.id is null or claim.id is null or exists(select 1 from private.gift_intents where order_id=purchase.id) then
  raise sqlstate 'PT404' using message='claim_not_found';end if;
 blocker:=private.order_claim_refund_account_blocker(claim,purchase);
 select * into account from private.claim_refund_accounts where claim_id=claim.id;
 return jsonb_build_object('actorId',p_expected_actor_id,'orderId',purchase.id,'claimId',claim.id,
  'claimType',claim.claim_type,'stage',claim.stage,'revision',claim.claim_revision,'allowed',blocker is null,'blocker',blocker,
  'maskedAccount',account.masked_account,'maskedHolder',account.masked_holder,'recordedAt',account.created_at);
end $$;

create function public.set_my_order_claim_refund_account(p_order_id uuid,p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,
 p_bank_name text,p_account_number text,p_account_holder text,p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare purchase public.orders;claim public.order_cancellation_requests;previous private.order_claim_refund_account_operations;
 request_hash text;blocker text;result_revision integer;
begin
 perform private.require_claim_refund_account_identity(p_expected_actor_id,p_expected_session_id);
 if p_order_id is null or p_claim_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or p_bank_name is null or p_bank_name<>btrim(p_bank_name) or char_length(p_bank_name) not between 1 and 40 or p_bank_name~'[[:cntrl:]]'
  or p_account_number is null or p_account_number!~'^[0-9-]{8,30}$' or p_account_number!~'[0-9]'
  or p_account_holder is null or p_account_holder<>btrim(p_account_holder) or char_length(p_account_holder) not between 1 and 40 or p_account_holder~'[[:cntrl:]]'
  then raise invalid_parameter_value using message='invalid_claim_refund_account';end if;
 if not exists(select 1 from public.orders o join public.order_cancellation_requests c on c.order_id=o.id
  where o.id=p_order_id and o.user_id=p_expected_actor_id and c.id=p_claim_id)
  or exists(select 1 from private.gift_intents where order_id=p_order_id) then raise sqlstate 'PT404' using message='claim_not_found';end if;
 -- Match existing account-deletion, claim, and refund ordering. Existing-order
 -- recovery remains available to its owner even when new purchases are fenced.
 perform private.lock_operator_subjects(array[p_expected_actor_id]);
 perform private.lock_claim_refund_account_session(p_expected_actor_id,p_expected_session_id);
 perform pg_advisory_xact_lock(hashtextextended('claim-refund-account:'||p_operation_id::text,0));
 request_hash:=encode(extensions.digest(jsonb_build_array(p_operation_id,p_order_id,p_claim_id,p_expected_actor_id,
  p_expected_session_id,p_expected_revision,p_bank_name,p_account_number,p_account_holder)::text,'sha256'),'hex');
 select * into previous from private.order_claim_refund_account_operations where id=p_operation_id;
 if found then
  if previous.actor_id<>p_expected_actor_id or previous.session_id<>p_expected_session_id or previous.order_id<>p_order_id
   or previous.claim_id<>p_claim_id or previous.expected_revision<>p_expected_revision then
   raise unique_violation using message='refund_account_request_conflict';end if;
  if previous.state='sealed' then raise check_violation using message='refund_account_request_sealed';end if;
  if previous.request_hash is null then raise check_violation using message='refund_account_request_expired';end if;
  if previous.request_hash<>request_hash then raise unique_violation using message='refund_account_request_conflict';end if;
  return private.order_claim_refund_account_receipt(p_operation_id,p_expected_actor_id,p_expected_session_id);
 end if;
 select * into purchase from public.orders where id=p_order_id and user_id=p_expected_actor_id for update;
 if not found then raise sqlstate 'PT404' using message='claim_not_found';end if;
 perform id from public.order_shipments where order_id=purchase.id order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id and order_id=purchase.id for update;
 if not found then raise sqlstate 'PT404' using message='claim_not_found';end if;
 if claim.claim_revision<>p_expected_revision then raise sqlstate 'PT409' using message='claim_changed';end if;
 perform id from public.payments where purpose='order' and ref_id=purchase.id order by id for update;
 perform r.id from public.refunds r join public.payments p on p.id=r.payment_id
  where p.purpose='order' and p.ref_id=purchase.id order by r.id for update of r;
 blocker:=private.order_claim_refund_account_blocker(claim,purchase);
 if blocker is not null then raise check_violation using message=blocker;end if;
 insert into private.claim_refund_accounts(claim_id,bank_name,account_number,account_holder,masked_account,masked_holder)
 values(claim.id,p_bank_name,p_account_number,p_account_holder,p_bank_name||' '||public.mask_refund_account_number(p_account_number),public.mask_refund_account_holder(p_account_holder));
 update public.order_cancellation_requests set updated_at=clock_timestamp() where id=claim.id returning claim_revision into result_revision;
 insert into private.order_claim_refund_account_operations(id,actor_id,session_id,order_id,claim_id,expected_revision,result_revision,state,request_hash)
 values(p_operation_id,p_expected_actor_id,p_expected_session_id,purchase.id,claim.id,p_expected_revision,result_revision,'saved',request_hash);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_expected_actor_id,'order.claim_refund_account_confirmed','order:'||purchase.id,
  jsonb_build_object('claimId',claim.id,'claimType',claim.claim_type,'revision',p_expected_revision,'resultRevision',result_revision));
 return private.order_claim_refund_account_receipt(p_operation_id,p_expected_actor_id,p_expected_session_id);
end $$;

create function public.read_my_order_claim_refund_account_operation(p_order_id uuid,p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,
 p_expected_actor_id uuid,p_expected_session_id uuid,p_seal boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare previous private.order_claim_refund_account_operations;
begin
 perform private.require_claim_refund_account_identity(p_expected_actor_id,p_expected_session_id);
 if p_order_id is null or p_claim_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or p_seal is null then
  raise invalid_parameter_value using message='invalid_claim_refund_account';end if;
 if not exists(select 1 from public.orders o join public.order_cancellation_requests c on c.order_id=o.id
  where o.id=p_order_id and o.user_id=p_expected_actor_id and c.id=p_claim_id)
  or exists(select 1 from private.gift_intents where order_id=p_order_id) then raise sqlstate 'PT404' using message='claim_not_found';end if;
 perform private.lock_operator_subjects(array[p_expected_actor_id]);
 perform private.lock_claim_refund_account_session(p_expected_actor_id,p_expected_session_id);
 -- A read waits for the current writer; sealing also excludes a delayed writer.
 perform pg_advisory_xact_lock(hashtextextended('claim-refund-account:'||p_operation_id::text,0));
 select * into previous from private.order_claim_refund_account_operations where id=p_operation_id;
 if found then
  if previous.actor_id<>p_expected_actor_id or previous.session_id<>p_expected_session_id or previous.order_id<>p_order_id
   or previous.claim_id<>p_claim_id or previous.expected_revision<>p_expected_revision then
   raise unique_violation using message='refund_account_request_conflict';end if;
 elsif p_seal then
  insert into private.order_claim_refund_account_operations(id,actor_id,session_id,order_id,claim_id,expected_revision,result_revision,state)
  values(p_operation_id,p_expected_actor_id,p_expected_session_id,p_order_id,p_claim_id,p_expected_revision,p_expected_revision,'sealed');
 end if;
 return private.order_claim_refund_account_receipt(p_operation_id,p_expected_actor_id,p_expected_session_id);
end $$;

-- The sole extra account-derived value follows the existing account's purge.
-- Historical receipts remain readable, with no raw account or digest returned.
create function private.purge_claim_refund_account_operation_hash() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if new.purged_at is not null and old.purged_at is null then
  update private.order_claim_refund_account_operations set request_hash=null,hash_purged_at=new.purged_at
   where claim_id=new.claim_id and state='saved' and request_hash is not null;
 end if;
 return null;
end $$;
create trigger claim_refund_account_operation_hash_retention after update of purged_at on private.claim_refund_accounts
 for each row execute function private.purge_claim_refund_account_operation_hash();

revoke all on function private.require_claim_refund_account_identity(uuid,uuid),
 private.lock_claim_refund_account_session(uuid,uuid),
 private.order_claim_refund_account_blocker(public.order_cancellation_requests,public.orders),
 private.order_claim_refund_account_receipt(uuid,uuid,uuid),private.purge_claim_refund_account_operation_hash(),
 public.get_my_order_claim_refund_account_context(uuid,uuid,uuid,uuid),
 public.set_my_order_claim_refund_account(uuid,uuid,uuid,integer,text,text,text,uuid,uuid),
 public.read_my_order_claim_refund_account_operation(uuid,uuid,uuid,integer,uuid,uuid,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.get_my_order_claim_refund_account_context(uuid,uuid,uuid,uuid),
 public.set_my_order_claim_refund_account(uuid,uuid,uuid,integer,text,text,text,uuid,uuid),
 public.read_my_order_claim_refund_account_operation(uuid,uuid,uuid,integer,uuid,uuid,boolean) to authenticated;

select private.register_operator_internal_contract('private.require_claim_refund_account_identity(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.lock_claim_refund_account_session(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.order_claim_refund_account_blocker(public.order_cancellation_requests,public.orders)'::regprocedure);
select private.register_operator_internal_contract('private.order_claim_refund_account_receipt(uuid,uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.purge_claim_refund_account_operation_hash()'::regprocedure);
select private.register_operator_internal_contract('public.get_my_order_claim_refund_account_context(uuid,uuid,uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('public.set_my_order_claim_refund_account(uuid,uuid,uuid,integer,text,text,text,uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('public.read_my_order_claim_refund_account_operation(uuid,uuid,uuid,integer,uuid,uuid,boolean)'::regprocedure);
notify pgrst,'reload schema';
