-- ADR-0010 bank-transfer refunds.
-- Cancellation confirmation restores stock, but only immutable transfer evidence
-- closes the payment, refund and claim. Card-provider evidence remains unchanged.

alter table public.refunds drop constraint refunds_status_check;
alter table public.refunds add constraint refunds_status_check
 check(status in('requested','awaiting_transfer','done','failed'));

create table private.bank_transfer_claim_refunds (
 claim_id uuid primary key references public.order_cancellation_requests(id),
 order_id uuid not null unique references public.orders(id),
 payment_id uuid not null unique references public.payments(id),
 payer_id uuid not null,
 amount integer not null check(amount>0),
 state text not null check(state in('awaiting_transfer','completed')),
 confirmation_operation_id uuid not null unique,
 confirmed_by uuid not null,
 confirmed_at timestamptz not null,
 confirmation_evidence text not null check(char_length(confirmation_evidence) between 2 and 300),
 confirmation_note text not null check(char_length(confirmation_note) between 2 and 300),
 transfer_operation_id uuid unique,
 transferred_by uuid,
 transferred_at timestamptz,
 transfer_evidence text,
 transfer_note text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((state='awaiting_transfer' and transfer_operation_id is null and transferred_by is null and transferred_at is null
   and transfer_evidence is null and transfer_note is null)
  or(state='completed' and transfer_operation_id is not null and transferred_by is not null and transferred_at is not null
   and transfer_evidence is not null and transfer_note is not null
   and char_length(transfer_evidence) between 2 and 300 and char_length(transfer_note) between 2 and 300))
);
create table private.bank_transfer_refund_operations (
 id uuid primary key,
 actor_id uuid not null,
 session_id uuid not null,
 order_id uuid not null references public.orders(id),
 claim_id uuid not null references public.order_cancellation_requests(id),
 kind text not null check(kind in('confirm_cancellation','file_transfer','complete_transfer')),
 expected_revision integer not null check(expected_revision>=0),
 amount integer not null check(amount>0),
 state text not null check(state in('recorded','sealed')),
 request_hash text check(request_hash~'^[0-9a-f]{64}$'),
 occurred_at timestamptz,
 evidence text,
 note text,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 check((state='sealed' and request_hash is null and occurred_at is null and evidence is null and note is null)
  or(state='recorded' and request_hash is not null and occurred_at is not null
   and evidence is not null and note is not null
   and char_length(evidence) between 2 and 300 and char_length(note) between 2 and 300))
);
create index bank_transfer_refund_operations_claim on private.bank_transfer_refund_operations(claim_id,created_at,id);
create table private.bank_transfer_refund_account_views (
 id uuid primary key,
 actor_id uuid not null,
 session_id uuid not null,
 order_id uuid not null references public.orders(id),
 claim_id uuid not null references public.order_cancellation_requests(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table private.bank_transfer_claim_refunds enable row level security;
alter table private.bank_transfer_refund_operations enable row level security;
alter table private.bank_transfer_refund_account_views enable row level security;
revoke all on private.bank_transfer_claim_refunds,private.bank_transfer_refund_operations,
 private.bank_transfer_refund_account_views from public,anon,authenticated,service_role;
-- Existing protected functions are owned by postgres on supported databases.
-- Their narrow read/dispatch grants are internal; no API role gets table access.
grant select on private.bank_transfer_claim_refunds to postgres;

create function private.require_bank_transfer_refund_identity(p_actor uuid,p_session uuid) returns void
language plpgsql stable security definer set search_path='' as $$begin
 perform private.require_claim_refund_account_identity(p_actor,p_session);
 -- The current payment-operations gate is sales.manage with legacy admin-only;
 -- there is no payments.manage capability in the accepted capability registry.
 if not private.has_operator_capability(p_actor,'sales.manage',true) then
  raise insufficient_privilege using message='bank_refund_permission_required';end if;
end $$;

create function private.lock_bank_transfer_refund_identity(p_order uuid,p_claim uuid,p_actor uuid,p_session uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare payer uuid;recipient uuid;
begin
 perform private.require_bank_transfer_refund_identity(p_actor,p_session);
 select o.user_id,g.recipient_id into payer,recipient from public.orders o
  join public.order_cancellation_requests c on c.order_id=o.id and c.id=p_claim
  left join private.gift_intents g on g.order_id=o.id where o.id=p_order;
 if payer is null then raise sqlstate 'PT404' using message='claim_not_found';end if;
 -- Include the payer/recipient account fence before any order lock, in the same
 -- sorted order used by gift requests and account-deletion admission.
 perform private.lock_operator_subjects(array[p_actor,payer,recipient]);
 perform private.require_operator_capability('sales.manage',true);
 perform private.lock_claim_refund_account_session(p_actor,p_session);
 perform private.require_bank_transfer_refund_identity(p_actor,p_session);
end $$;

create function private.bank_transfer_refund_blocker(p_claim public.order_cancellation_requests,p_order public.orders,p_kind text) returns text
language plpgsql stable security definer set search_path='' as $$
declare payment public.payments;refund public.refunds;lifecycle private.bank_transfer_claim_refunds;gift private.gift_intents;
begin
 if p_order.id is null or p_claim.id is null or p_claim.order_id is distinct from p_order.id then return 'claim_not_found';end if;
 if p_order.payment_method is distinct from 'bank_transfer' or p_order.total<=0 then return 'bank_refund_payment_unavailable';end if;
 if p_claim.claim_type not in('cancel','return') then return 'bank_refund_claim_unavailable';end if;
 select * into gift from private.gift_intents where order_id=p_order.id;
 if gift.id is not null and not exists(select 1 from private.gift_claim_parties party where party.claim_id=p_claim.id
  and party.gift_id=gift.id and party.payer_id=gift.sender_id and party.payer_id=p_order.user_id
  and party.payer_id=p_claim.requested_by and party.recipient_id=gift.recipient_id
  and party.actual_requester in(party.payer_id,party.recipient_id)) then return 'bank_refund_gift_parties_invalid';end if;
 if (select count(*) from public.payments where purpose='order' and ref_id=p_order.id)<>1 then return 'bank_refund_payment_unavailable';end if;
 select * into payment from public.payments where purpose='order' and ref_id=p_order.id;
 if payment.provider<>'bank_transfer' or payment.user_id is distinct from p_order.user_id or payment.amount<>p_order.total
  or payment.amount<=0 or payment.payment_key is null or payment.payment_key not like 'bank_transfer:%'
  or payment.status<>'paid' then return 'bank_refund_payment_unavailable';end if;
 if exists(select 1 from public.payment_attempts attempt where attempt.purpose='order' and attempt.ref_id=p_order.id
  and(attempt.state in('prepared','confirming','unknown','needs_review')
   or attempt.state='approved' and(attempt.provider<>'bank_transfer' or attempt.payment_id is distinct from payment.id or attempt.amount<>payment.amount)))
 then return 'bank_refund_payment_unavailable';end if;
 if not private.claim_collections_complete(p_claim.id) then return 'claim_collections_incomplete';end if;
 if not exists(select 1 from private.claim_refund_accounts where claim_id=p_claim.id and purged_at is null
  and bank_name is not null and account_number is not null and account_holder is not null) then return 'claim_refund_account_missing';end if;
 select * into refund from public.refunds where payment_id=payment.id;
 if refund.id is not null and(refund.cancellation_request_id is distinct from p_claim.id or refund.amount<>payment.amount
  or refund.method is not null and refund.method<>'bank_transfer' or refund.completed_at is not null or refund.status='done') then
  return 'bank_refund_ledger_unavailable';end if;
 select * into lifecycle from private.bank_transfer_claim_refunds where claim_id=p_claim.id;
 if p_claim.stage not in('collected','processing','needs_review') or p_claim.status not in('requested','processing','needs_review') then
  return 'bank_refund_claim_unavailable';end if;
 if p_kind='file_transfer' then
  if refund.filed_at is not null then return 'bank_refund_already_filed';end if;
  if p_claim.claim_type='cancel' and lifecycle.state is distinct from 'awaiting_transfer' then return 'bank_refund_confirmation_required';end if;
  if p_claim.claim_type='return' and p_claim.stage not in('collected','processing') then return 'bank_refund_claim_unavailable';end if;
  if lifecycle.claim_id is null and p_order.status not in('paid','confirmed','shipping','delivered','done') then return 'bank_refund_claim_unavailable';end if;
 elsif p_kind='confirm_cancellation' then
  if lifecycle.claim_id is not null then return 'bank_refund_already_confirmed';end if;
  if p_order.status not in('paid','confirmed','shipping','delivered','done') or p_claim.stage not in('processing','needs_review') then return 'bank_refund_claim_unavailable';end if;
  if p_claim.claim_type='return' and(refund.filed_at is null or refund.method is distinct from 'bank_transfer') then return 'bank_refund_filing_required';end if;
  if not exists(select 1 from public.order_cancellation_claims where order_id=p_order.id) then return 'bank_refund_approval_required';end if;
  if p_claim.claim_type='cancel' and not p_claim.collection_required and not private.order_cancel_eligible(p_order.id) then return 'order_not_cancelable';end if;
 elsif p_kind in('complete_transfer','view_account') then
  if lifecycle.state is distinct from 'awaiting_transfer' or p_order.status<>'canceled'
   or lifecycle.payment_id<>payment.id or lifecycle.payer_id is distinct from p_order.user_id or lifecycle.amount<>payment.amount
   or refund.status is distinct from 'awaiting_transfer' then return 'bank_refund_confirmation_required';end if;
  if refund.filed_at is null or refund.method is distinct from 'bank_transfer' then return 'bank_refund_filing_required';end if;
 else return 'invalid_bank_refund_operation';end if;
 return null;
end $$;

-- One bank-only implementation. The existing public finalizer dispatches here
-- only when the durable payment is bank_transfer, never from browser input.
create function private.bank_transfer_refund_legacy_completed(p_order_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders purchase where purchase.id=p_order_id
  and purchase.status='canceled' and purchase.payment_method='bank_transfer'
  and not exists(select 1 from private.bank_transfer_claim_refunds where order_id=purchase.id)
  and(select count(*) from public.payments where purpose='order' and ref_id=purchase.id and status<>'failed')=1
  and exists(select 1 from public.payments p join public.refunds r on r.payment_id=p.id
   join public.order_cancellation_requests c on c.id=r.cancellation_request_id and c.order_id=purchase.id
   where p.purpose='order' and p.ref_id=purchase.id and p.provider='bank_transfer' and p.user_id=purchase.user_id
    and p.status='refunded' and p.amount=purchase.total and p.amount>0
    and r.amount=p.amount and r.status='done' and r.method='bank_transfer' and r.filed_at is not null and r.completed_at is not null
    and c.stage='completed' and c.status='completed')
  and not exists(select 1 from public.order_cancellation_claims where order_id=purchase.id));
$$;

create function private.bank_transfer_refund_pending_evidence_valid(p_order_id uuid,p_payment_id uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.bank_transfer_claim_refunds lifecycle
  join public.orders purchase on purchase.id=lifecycle.order_id
  join public.order_cancellation_requests claim on claim.id=lifecycle.claim_id and claim.order_id=purchase.id
  join public.payments payment on payment.id=lifecycle.payment_id
  join public.refunds refund on refund.payment_id=payment.id
  where purchase.id=p_order_id and purchase.payment_method='bank_transfer' and lifecycle.state='awaiting_transfer'
   and(p_payment_id is null or payment.id=p_payment_id)
   and payment.purpose='order' and payment.ref_id=purchase.id and payment.provider='bank_transfer' and payment.status='paid'
   and payment.user_id=lifecycle.payer_id and purchase.user_id=lifecycle.payer_id and claim.requested_by=lifecycle.payer_id
   and payment.amount=lifecycle.amount and purchase.total=lifecycle.amount and lifecycle.amount>0
   and refund.status='awaiting_transfer' and refund.method='bank_transfer' and refund.amount=lifecycle.amount
   and refund.cancellation_request_id=claim.id and refund.completed_at is null
   and claim.claim_type in('cancel','return') and claim.stage in('processing','needs_review')
   and private.claim_collections_complete(claim.id)
   and(select count(*) from public.payments where purpose='order' and ref_id=purchase.id)=1);
$$;

-- The order-level helper is valid for the finalizer. A claim reader/replay must
-- also prove that this particular claim owns the completed historical refund.
create function private.bank_transfer_refund_legacy_completed_claim(p_order_id uuid,p_claim_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.bank_transfer_refund_legacy_completed(p_order_id) and exists(
  select 1 from public.order_cancellation_requests c join public.refunds r on r.cancellation_request_id=c.id
  join public.payments p on p.id=r.payment_id
  where c.id=p_claim_id and c.order_id=p_order_id and c.stage='completed' and c.status='completed'
   and p.purpose='order' and p.ref_id=p_order_id and p.provider='bank_transfer' and p.status='refunded'
   and r.status='done' and r.method='bank_transfer' and r.filed_at is not null and r.completed_at is not null);
$$;

create function private.finalize_bank_transfer_claim_refund(p_order_id uuid,p_reason text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare purchase public.orders;payment public.payments;lifecycle private.bank_transfer_claim_refunds;item record;
begin
 select * into purchase from public.orders where id=p_order_id for update;
 perform id from public.order_shipments where order_id=p_order_id order by id for update;
 select * into lifecycle from private.bank_transfer_claim_refunds where order_id=p_order_id for update;
 if not found and private.bank_transfer_refund_legacy_completed(p_order_id) then
  -- Preserve a completely finished historical ledger as an exact no-op. This
  -- cannot advance any active claim, create transfer proof or restore stock.
  return;
 end if;
 if not found or purchase.payment_method is distinct from 'bank_transfer' or purchase.total<>lifecycle.amount then
  raise check_violation using message='bank_refund_operator_evidence_required';end if;
 perform id from public.order_cancellation_requests where id=lifecycle.claim_id and order_id=p_order_id for update;
 perform private.assert_claim_collections_complete(lifecycle.claim_id);
 perform id from public.payments where purpose='order' and ref_id=p_order_id order by id for update;
 if (select count(*) from public.payments where purpose='order' and ref_id=p_order_id)<>1 then
  raise check_violation using message='bank_refund_payment_unavailable';end if;
 select * into payment from public.payments where id=lifecycle.payment_id;
 if payment.provider<>'bank_transfer' or payment.purpose<>'order' or payment.ref_id<>p_order_id
  or payment.user_id is distinct from lifecycle.payer_id or purchase.user_id is distinct from lifecycle.payer_id
  or payment.amount<>lifecycle.amount or payment.status not in('paid','refunded') then
  raise check_violation using message='bank_refund_payment_unavailable';end if;
 if lifecycle.state='awaiting_transfer' and payment.status<>'paid' then raise check_violation using message='bank_refund_payment_unavailable';end if;
 if purchase.status not in('paid','confirmed','shipping','delivered','done','canceled') then
  raise check_violation using message='bank_refund_claim_unavailable';end if;
 if not exists(select 1 from public.order_cancellation_claims where order_id=p_order_id) and purchase.status<>'canceled' then
  raise check_violation using message='bank_refund_approval_required';end if;
 if purchase.status<>'canceled' then
  for item in select id from public.order_items where order_id=p_order_id order by good_id,id loop
   perform private.restore_order_item_supply(item.id,p_reason);
  end loop;
  perform id from public.draw_tickets where source='order_paid' and source_id=p_order_id and consumed_at is null and revoked_at is null order by id for update;
  update public.draw_tickets set revoked_at=clock_timestamp() where source='order_paid' and source_id=p_order_id and consumed_at is null and revoked_at is null;
 end if;
 insert into public.refunds(payment_id,amount,reason,status,cancellation_request_id,method)
 values(payment.id,payment.amount,p_reason,case when lifecycle.state='completed' then 'done' else 'awaiting_transfer' end,lifecycle.claim_id,'bank_transfer')
 on conflict(payment_id) do update set status=excluded.status,method='bank_transfer',cancellation_request_id=excluded.cancellation_request_id;
 if lifecycle.state='completed' then update public.payments set status='refunded' where id=payment.id and status<>'refunded';end if;
 if purchase.status<>'canceled' then update public.orders set status='canceled',expires_at=null where id=p_order_id;end if;
 if lifecycle.state='completed' then delete from public.order_cancellation_claims where order_id=p_order_id;end if;
end $$;

do $patch$ declare definition text;anchor text:=E'begin\n  select orders.status';begin
 definition:=pg_get_functiondef('public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'bank_finalizer_anchor_changed';end if;
 execute replace(definition,anchor,E'begin\n  if exists(select 1 from public.payments where purpose=''order'' and ref_id=p_order_id and provider=''bank_transfer'' and status<>''failed'') then\n    perform private.finalize_bank_transfer_claim_refund(p_order_id,p_reason);\n    return;\n  end if;\n  select orders.status');
end $patch$;

-- A returned bank order can be canceled while the actual transfer is pending.
-- The exception is the confirmed, exact bank ledger above; provider-card and
-- unknown/prepared attempt evidence rules remain byte-for-byte unchanged.
do $patch$ declare definition text;anchor text;begin
 definition:=pg_get_functiondef('private.guard_order_claim_cancellation_transition()'::regprocedure);
 anchor:='if not private.order_cancel_eligible(old.id) and (';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'bank_claim_transition_anchor_changed';end if;
 execute replace(definition,anchor,'if not private.order_cancel_eligible(old.id) and not private.bank_transfer_refund_pending_evidence_valid(old.id,null) and (');
 definition:=pg_get_functiondef('private.guard_unresolved_goods_payment_cancellation()'::regprocedure);
 anchor:='        and attempt.ref_id = old.id';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'bank_attempt_transition_anchor_changed';end if;
 execute replace(definition,anchor,anchor||$new$
        and not(attempt.provider='bank_transfer' and attempt.state='approved'
          and private.bank_transfer_refund_pending_evidence_valid(old.id,attempt.payment_id))
$new$);
end $patch$;

create function private.guard_bank_transfer_refund_ledger() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare lifecycle private.bank_transfer_claim_refunds;payment public.payments;
begin
 select * into payment from public.payments where id=new.payment_id;
 if payment.provider='bank_transfer' and payment.purpose='order' then
  if new.method is not null and new.method<>'bank_transfer' then raise check_violation using message='bank_refund_method_required';end if;
  select * into lifecycle from private.bank_transfer_claim_refunds where payment_id=payment.id;
  if new.status='awaiting_transfer' and lifecycle.state is distinct from 'awaiting_transfer'
   or new.status='done' and lifecycle.state is distinct from 'completed'
   or lifecycle.state='awaiting_transfer' and new.status<>'awaiting_transfer'
   or lifecycle.state='completed' and new.status<>'done'
   or lifecycle.claim_id is not null and(new.cancellation_request_id is distinct from lifecycle.claim_id or new.amount<>lifecycle.amount)
  then raise check_violation using message='bank_refund_evidence_required';end if;
 elsif new.status='awaiting_transfer' then raise check_violation using message='bank_refund_payment_unavailable';end if;
 return new;
end $$;
create trigger refunds_bank_transfer_evidence before insert or update on public.refunds
 for each row execute function private.guard_bank_transfer_refund_ledger();

create function private.guard_bank_transfer_refund_lifecycle() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare lifecycle private.bank_transfer_claim_refunds;
begin
 if tg_table_name='payments' then
  select * into lifecycle from private.bank_transfer_claim_refunds where payment_id=old.id;
  if lifecycle.claim_id is not null and(new.user_id is distinct from old.user_id or new.provider is distinct from old.provider
   or new.purpose is distinct from old.purpose or new.ref_id is distinct from old.ref_id or new.amount is distinct from old.amount
   or new.payment_key is distinct from old.payment_key or lifecycle.state='awaiting_transfer' and new.status<>'paid'
   or lifecycle.state='completed' and new.status<>'refunded') then raise check_violation using message='bank_refund_evidence_required';end if;
 elsif tg_table_name='order_cancellation_requests' then
  select * into lifecycle from private.bank_transfer_claim_refunds where claim_id=old.id;
  if lifecycle.state='awaiting_transfer' and(new.stage in('completed','rejected','withdrawn') or new.status in('completed','rejected')
   or new.claim_type is distinct from old.claim_type or new.requested_by is distinct from old.requested_by or new.order_id is distinct from old.order_id)
  then raise check_violation using message='bank_refund_transfer_pending';end if;
 elsif tg_table_name='claim_refund_accounts' then
  select * into lifecycle from private.bank_transfer_claim_refunds where claim_id=old.claim_id;
  if lifecycle.state='awaiting_transfer' and(new.bank_name is distinct from old.bank_name or new.account_number is distinct from old.account_number
   or new.account_holder is distinct from old.account_holder or new.purged_at is not null or new.purge_after is not null)
  then raise check_violation using message='bank_refund_transfer_pending';end if;
 end if;
 return new;
end $$;
create trigger payments_bank_transfer_evidence before update on public.payments for each row execute function private.guard_bank_transfer_refund_lifecycle();
create trigger claims_bank_transfer_evidence before update on public.order_cancellation_requests for each row execute function private.guard_bank_transfer_refund_lifecycle();
create trigger accounts_bank_transfer_pending before update on private.claim_refund_accounts for each row execute function private.guard_bank_transfer_refund_lifecycle();

-- Existing refund recording remains the shared notification/audit path. A bank
-- cancellation must have been confirmed first; bank completion needs the new
-- durable transfer evidence even when a caller reaches this older public RPC.
do $patch$ declare definition text;anchor text:='  perform private.assert_claim_collections_complete(p_claim_id);';begin
 definition:=pg_get_functiondef('public.admin_record_order_claim_refund(uuid,text,text,text)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'bank_refund_record_anchor_changed';end if;
 execute replace(definition,anchor,anchor||$new$
  if exists(select 1 from public.orders where id=v_claim.order_id and payment_method='bank_transfer') then
    perform private.require_operator_capability('sales.manage',true);
    if p_method<>'bank_transfer' then raise check_violation using message='bank_refund_method_required';end if;
    if p_stage='completed' and private.bank_transfer_refund_legacy_completed_claim(v_claim.order_id,p_claim_id) then return 'completed';end if;
    if p_stage='filed' and v_claim.claim_type='cancel' and not exists(select 1 from private.bank_transfer_claim_refunds where claim_id=p_claim_id and state='awaiting_transfer') then
      raise check_violation using message='bank_refund_confirmation_required';end if;
    if p_stage='completed' and not exists(select 1 from private.bank_transfer_claim_refunds where claim_id=p_claim_id and state='completed') then
      raise check_violation using message='bank_refund_evidence_required';end if;
  end if;
$new$);
end $patch$;

create function public.admin_bank_transfer_refund_context(p_order_id uuid,p_claim_id uuid,p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare purchase public.orders;claim public.order_cancellation_requests;payment public.payments;refund public.refunds;
 lifecycle private.bank_transfer_claim_refunds;account private.claim_refund_accounts;
begin
 perform private.require_bank_transfer_refund_identity(p_expected_actor_id,p_expected_session_id);
 select * into purchase from public.orders where id=p_order_id;
 select * into claim from public.order_cancellation_requests where id=p_claim_id and order_id=purchase.id;
 if purchase.id is null or claim.id is null then raise sqlstate 'PT404' using message='claim_not_found';end if;
 select * into payment from public.payments where purpose='order' and ref_id=p_order_id order by id limit 1;
 select * into refund from public.refunds where payment_id=payment.id and cancellation_request_id=claim.id;
 select * into lifecycle from private.bank_transfer_claim_refunds where claim_id=claim.id;
 select * into account from private.claim_refund_accounts where claim_id=claim.id;
 return jsonb_build_object('actorId',p_expected_actor_id,'orderId',purchase.id,'claimId',claim.id,'claimType',claim.claim_type,
  'revision',claim.claim_revision,'amount',purchase.total,'stage',claim.stage,
  'phase',coalesce(lifecycle.state,case when private.bank_transfer_refund_legacy_completed_claim(purchase.id,claim.id) then 'completed' else 'not_confirmed' end),'filedAt',refund.filed_at,
  'confirmedAt',lifecycle.confirmed_at,'transferredAt',lifecycle.transferred_at,
  'confirmationNotBefore',greatest(payment.created_at,claim.requested_at),
  'transferNotBefore',greatest(payment.created_at,refund.filed_at,lifecycle.confirmed_at),
  'maskedAccount',account.masked_account,'maskedHolder',account.masked_holder,
  'confirmBlocker',private.bank_transfer_refund_blocker(claim,purchase,'confirm_cancellation'),
  'fileBlocker',private.bank_transfer_refund_blocker(claim,purchase,'file_transfer'),
  'completeBlocker',private.bank_transfer_refund_blocker(claim,purchase,'complete_transfer'),
  'viewBlocker',private.bank_transfer_refund_blocker(claim,purchase,'view_account'),
  'gift',exists(select 1 from private.gift_intents where order_id=purchase.id));
end $$;

create function public.admin_record_bank_transfer_refund(p_order_id uuid,p_claim_id uuid,p_operation_id uuid,p_kind text,
 p_expected_revision integer,p_expected_amount integer,p_occurred_at timestamptz,p_evidence text,p_note text,p_confirmed boolean,
 p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare purchase public.orders;claim public.order_cancellation_requests;payment public.payments;refund public.refunds;
 previous private.bank_transfer_refund_operations;lifecycle private.bank_transfer_claim_refunds;blocker text;request_hash text;
 result_revision integer;receipt jsonb;happened timestamptz;
begin
 perform private.lock_bank_transfer_refund_identity(p_order_id,p_claim_id,p_expected_actor_id,p_expected_session_id);
 if p_operation_id is null or p_kind is null or p_kind not in('confirm_cancellation','file_transfer','complete_transfer')
  or p_expected_revision is null or p_expected_revision<0 or p_expected_amount is null or p_expected_amount<=0
  or p_occurred_at is null or not isfinite(p_occurred_at) or p_confirmed is distinct from true
  or p_evidence is null or p_evidence<>btrim(p_evidence) or char_length(p_evidence) not between 2 and 300 or p_evidence~'[[:cntrl:]]'
  or p_note is null or p_note<>btrim(p_note) or char_length(p_note) not between 2 and 300 or p_note~'[[:cntrl:]]'
 then raise invalid_parameter_value using message='invalid_bank_refund_operation';end if;
 perform pg_advisory_xact_lock(hashtextextended('bank-transfer-refund:'||p_operation_id::text,0));
 request_hash:=encode(extensions.digest(jsonb_build_array(p_order_id,p_claim_id,p_operation_id,p_kind,p_expected_revision,p_expected_amount,
  p_occurred_at,p_evidence,p_note,p_confirmed,p_expected_actor_id,p_expected_session_id)::text,'sha256'),'hex');
 select * into previous from private.bank_transfer_refund_operations where id=p_operation_id;
 if found then
  if previous.actor_id<>p_expected_actor_id or previous.session_id<>p_expected_session_id or previous.order_id<>p_order_id
   or previous.claim_id<>p_claim_id or previous.kind<>p_kind or previous.expected_revision<>p_expected_revision or previous.amount<>p_expected_amount then
   raise unique_violation using message='bank_refund_request_conflict';end if;
  if previous.state='sealed' then raise check_violation using message='bank_refund_request_sealed';end if;
  if previous.request_hash<>request_hash then raise unique_violation using message='bank_refund_request_conflict';end if;
  return previous.receipt;
 end if;
 select * into purchase from public.orders where id=p_order_id for update;
 perform id from public.order_shipments where order_id=p_order_id order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id and order_id=p_order_id for update;
 if not found then raise sqlstate 'PT404' using message='claim_not_found';end if;
 if claim.claim_revision<>p_expected_revision or purchase.total<>p_expected_amount then raise sqlstate 'PT409' using message='claim_changed';end if;
 perform shipment_id from public.order_claim_collections where claim_id=claim.id order by shipment_id for update;
 perform id from public.payments where purpose='order' and ref_id=p_order_id order by id for update;
 perform r.id from public.refunds r join public.payments p on p.id=r.payment_id where p.purpose='order' and p.ref_id=p_order_id order by r.id for update of r;
 select * into lifecycle from private.bank_transfer_claim_refunds where claim_id=claim.id for update;
 perform claim_id from private.claim_refund_accounts where claim_id=claim.id for update;
 blocker:=private.bank_transfer_refund_blocker(claim,purchase,p_kind);
 if blocker is not null then raise check_violation using message=blocker;end if;
 select * into payment from public.payments where purpose='order' and ref_id=p_order_id;
 select * into refund from public.refunds where payment_id=payment.id;
 happened:=clock_timestamp();
 if p_occurred_at>happened or p_occurred_at<greatest(payment.created_at,claim.requested_at)
  or p_kind='complete_transfer' and p_occurred_at<greatest(refund.filed_at,lifecycle.confirmed_at) then
  raise invalid_parameter_value using message='bank_refund_occurred_at_invalid';end if;
 if p_kind='file_transfer' then
  perform public.admin_record_order_claim_refund(claim.id,'bank_transfer','filed',p_note);
 elsif p_kind='confirm_cancellation' then
  insert into private.bank_transfer_claim_refunds(claim_id,order_id,payment_id,payer_id,amount,state,confirmation_operation_id,
   confirmed_by,confirmed_at,confirmation_evidence,confirmation_note)
  values(claim.id,purchase.id,payment.id,purchase.user_id,payment.amount,'awaiting_transfer',p_operation_id,
   p_expected_actor_id,p_occurred_at,p_evidence,p_note);
  perform public.finalize_order_cancellation_with_provider_evidence(purchase.id,claim.reason,array[]::text[]);
 elsif p_kind='complete_transfer' then
  update private.bank_transfer_claim_refunds set state='completed',transfer_operation_id=p_operation_id,transferred_by=p_expected_actor_id,
   transferred_at=p_occurred_at,transfer_evidence=p_evidence,transfer_note=p_note,updated_at=happened where claim_id=claim.id;
  -- The accepted transfer evidence unlocks the existing idempotent finalizer.
  -- Its bank branch changes money status; its card branch is never entered.
  if claim.status<>'processing' then update public.order_cancellation_requests set stage='processing',last_error_code=null where id=claim.id;end if;
  perform public.complete_order_cancellation_request(claim.id,array[payment.payment_key],p_expected_actor_id);
  perform public.admin_record_order_claim_refund(claim.id,'bank_transfer','completed',p_note);
 end if;
 if p_kind<>'complete_transfer' then
  update public.order_cancellation_requests set stage='processing',last_error_code=null,updated_at=happened where id=claim.id;
 end if;
 select claim_revision into result_revision from public.order_cancellation_requests where id=claim.id;
 receipt:=jsonb_build_object('operationId',p_operation_id,'actorId',p_expected_actor_id,'orderId',purchase.id,'claimId',claim.id,
  'kind',p_kind,'revision',p_expected_revision,'resultRevision',result_revision,'amount',payment.amount,'state','recorded','createdAt',happened);
 insert into private.bank_transfer_refund_operations(id,actor_id,session_id,order_id,claim_id,kind,expected_revision,amount,state,request_hash,occurred_at,evidence,note,receipt,created_at)
 values(p_operation_id,p_expected_actor_id,p_expected_session_id,purchase.id,claim.id,p_kind,p_expected_revision,payment.amount,'recorded',request_hash,p_occurred_at,p_evidence,p_note,receipt,happened);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_expected_actor_id,'admin.order.bank_refund_'||p_kind,'order:'||purchase.id,
  jsonb_build_object('claimId',claim.id,'kind',p_kind,'amount',payment.amount,'occurredAt',p_occurred_at,'revision',p_expected_revision,'resultRevision',result_revision));
 return receipt;
end $$;

create function public.admin_read_bank_transfer_refund(p_order_id uuid,p_claim_id uuid,p_operation_id uuid,p_kind text,
 p_expected_revision integer,p_expected_amount integer,p_expected_actor_id uuid,p_expected_session_id uuid,p_seal boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare previous private.bank_transfer_refund_operations;receipt jsonb;
begin
 perform private.lock_bank_transfer_refund_identity(p_order_id,p_claim_id,p_expected_actor_id,p_expected_session_id);
 if p_operation_id is null or p_kind is null or p_kind not in('confirm_cancellation','file_transfer','complete_transfer')
  or p_expected_revision is null or p_expected_revision<0 or p_expected_amount is null or p_expected_amount<=0 or p_seal is null then
  raise invalid_parameter_value using message='invalid_bank_refund_operation';end if;
 perform pg_advisory_xact_lock(hashtextextended('bank-transfer-refund:'||p_operation_id::text,0));
 select * into previous from private.bank_transfer_refund_operations where id=p_operation_id;
 if found then
  if previous.actor_id<>p_expected_actor_id or previous.session_id<>p_expected_session_id or previous.order_id<>p_order_id
   or previous.claim_id<>p_claim_id or previous.kind<>p_kind or previous.expected_revision<>p_expected_revision or previous.amount<>p_expected_amount then
   raise unique_violation using message='bank_refund_request_conflict';end if;
  return previous.receipt;
 end if;
 if not p_seal then return null;end if;
 receipt:=jsonb_build_object('operationId',p_operation_id,'actorId',p_expected_actor_id,'orderId',p_order_id,'claimId',p_claim_id,
  'kind',p_kind,'revision',p_expected_revision,'resultRevision',p_expected_revision,'amount',p_expected_amount,'state','sealed','createdAt',clock_timestamp());
 insert into private.bank_transfer_refund_operations(id,actor_id,session_id,order_id,claim_id,kind,expected_revision,amount,state,receipt)
 values(p_operation_id,p_expected_actor_id,p_expected_session_id,p_order_id,p_claim_id,p_kind,p_expected_revision,p_expected_amount,'sealed',receipt);
 return receipt;
end $$;

create function public.admin_view_bank_transfer_refund_account(p_order_id uuid,p_claim_id uuid,p_view_id uuid,p_expected_revision integer,
 p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare purchase public.orders;claim public.order_cancellation_requests;account private.claim_refund_accounts;blocker text;happened timestamptz;
begin
 perform private.lock_bank_transfer_refund_identity(p_order_id,p_claim_id,p_expected_actor_id,p_expected_session_id);
 if p_view_id is null or p_expected_revision is null or p_expected_revision<0 then raise invalid_parameter_value using message='invalid_bank_refund_operation';end if;
 select * into purchase from public.orders where id=p_order_id for update;
 perform id from public.order_shipments where order_id=p_order_id order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id and order_id=p_order_id for update;
 if not found then raise sqlstate 'PT404' using message='claim_not_found';end if;
 if claim.claim_revision<>p_expected_revision then raise sqlstate 'PT409' using message='claim_changed';end if;
 perform id from public.payments where purpose='order' and ref_id=p_order_id order by id for update;
 perform r.id from public.refunds r join public.payments p on p.id=r.payment_id where p.purpose='order' and p.ref_id=p_order_id order by r.id for update of r;
 select * into account from private.claim_refund_accounts where claim_id=claim.id for share;
 blocker:=private.bank_transfer_refund_blocker(claim,purchase,'view_account');
 if blocker is not null then raise check_violation using message=blocker;end if;
 happened:=clock_timestamp();
 -- No account data enters the audit payload or durable response receipts. A
 -- duplicate view UUID is rejected rather than returning a cached plaintext.
 insert into private.bank_transfer_refund_account_views(id,actor_id,session_id,order_id,claim_id,created_at)
 values(p_view_id,p_expected_actor_id,p_expected_session_id,p_order_id,p_claim_id,happened);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_view_id,p_expected_actor_id,'admin.order.bank_refund_account_viewed','order:'||p_order_id,
  jsonb_build_object('claimId',p_claim_id,'purpose','prepare_bank_transfer','revision',p_expected_revision));
 perform set_config('response.headers','[{"Cache-Control":"no-store, private"},{"Pragma":"no-cache"}]',true);
 return jsonb_build_object('viewId',p_view_id,'actorId',p_expected_actor_id,'orderId',p_order_id,'claimId',p_claim_id,'revision',p_expected_revision,
  'bankName',account.bank_name,'accountNumber',account.account_number,'accountHolder',account.account_holder,'viewedAt',happened);
end $$;

create function public.admin_list_bank_transfer_refunds(p_limit integer default 50,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();session_id uuid;rows jsonb;total bigint;
begin
 begin session_id:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then raise insufficient_privilege using message='bank_refund_permission_required';end;
 perform private.require_bank_transfer_refund_identity(actor,session_id);
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then
  raise invalid_parameter_value using message='invalid_bank_refund_page';end if;
 select count(*) into total from private.bank_transfer_claim_refunds where state='awaiting_transfer';
 select coalesce(jsonb_agg(row_data order by confirmed_at,claim_id),'[]') into rows from(
  select lifecycle.confirmed_at,lifecycle.claim_id,jsonb_build_object('claimId',claim.id,'orderId',purchase.id,'reference',claim.reference,
   'claimType',claim.claim_type,'amount',lifecycle.amount,'confirmedAt',lifecycle.confirmed_at,'filedAt',refund.filed_at,
   'updatedAt',greatest(lifecycle.updated_at,claim.updated_at),'revision',claim.claim_revision,
   'gift',parties.claim_id is not null,'payerName',payer.nickname,'requesterName',requester.nickname) row_data
  from private.bank_transfer_claim_refunds lifecycle join public.order_cancellation_requests claim on claim.id=lifecycle.claim_id
  join public.orders purchase on purchase.id=lifecycle.order_id
  join public.refunds refund on refund.payment_id=lifecycle.payment_id
  left join private.gift_claim_parties parties on parties.claim_id=claim.id
  left join public.profiles payer on payer.id=lifecycle.payer_id
  left join public.profiles requester on requester.id=coalesce(parties.actual_requester,claim.requested_by)
  where lifecycle.state='awaiting_transfer' order by lifecycle.confirmed_at,lifecycle.claim_id limit p_limit offset p_offset
 ) queue;
 return jsonb_build_object('rows',rows,'total',total,'limit',p_limit,'offset',p_offset);
end $$;

-- Awaiting transfers remain unresolved for account deletion even after the
-- order has been canceled and its stock restored. Existing blocker codes stay.
do $patch$ declare definition text;anchor text:='refund.status in (''requested'', ''failed'')';begin
 definition:=pg_get_functiondef('private.account_deletion_blockers(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'bank_refund_account_blocker_anchor_changed';end if;
 execute replace(definition,anchor,'refund.status in (''requested'', ''failed'', ''awaiting_transfer'')');
end $patch$;

-- Preserve financial proof in the existing legal refund snapshot. Account
-- numbers, holder names, session identifiers and request hashes are excluded.
create function private.bank_transfer_refund_legal_proof(p_payment_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('claimId',claim_id,'amount',amount,'state',state,'confirmationOperationId',confirmation_operation_id,
  'confirmedBy',confirmed_by,'confirmedAt',confirmed_at,'confirmationEvidence',confirmation_evidence,'confirmationNote',confirmation_note,
  'transferOperationId',transfer_operation_id,'transferredBy',transferred_by,'transferredAt',transferred_at,
  'transferEvidence',transfer_evidence,'transferNote',transfer_note)
 from private.bank_transfer_claim_refunds where payment_id=p_payment_id;
$$;
do $patch$ declare definition text;anchor text:='''status'', refund.status,';begin
 definition:=pg_get_functiondef('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'bank_refund_legal_snapshot_anchor_changed';end if;
 execute replace(definition,anchor,anchor||E'\n      ''bankTransferProof'', private.bank_transfer_refund_legal_proof(refund.payment_id),');
end $patch$;

-- A payer may supply an absent gift account after approval, until filing or a
-- bank cancellation confirmation starts. The recipient/payer checks, locking,
-- immutable first account and gift-specific retention stay in the existing RPC.
do $patch$ declare definition text;anchor text:='claim.stage not in(''requested'',''in_review'',''collecting'',''collected'',''on_hold'',''needs_review'')';begin
 definition:=pg_get_functiondef('public.set_my_gift_claim_refund_account(uuid,uuid,uuid,text,text,text,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'bank_gift_account_stage_anchor_changed';end if;
 definition:=replace(definition,anchor,'claim.stage not in(''requested'',''in_review'',''collecting'',''collected'',''on_hold'',''processing'',''needs_review'')');
 anchor:=' if exists(select 1 from private.claim_refund_accounts where claim_id=claim.id) then';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'bank_gift_account_filing_anchor_changed';end if;
 execute replace(definition,anchor,$new$ if exists(select 1 from private.bank_transfer_claim_refunds where claim_id=claim.id)
  or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.purpose='order' and p.ref_id=purchase.id
   and(r.filed_at is not null or r.completed_at is not null or r.method is not null)) then raise check_violation using message='gift_refund_account_closed';end if;
$new$||anchor);
end $patch$;

do $permissions$ declare signature text;begin
 foreach signature in array array[
  'private.require_bank_transfer_refund_identity(uuid,uuid)',
  'private.lock_bank_transfer_refund_identity(uuid,uuid,uuid,uuid)',
  'private.bank_transfer_refund_blocker(public.order_cancellation_requests,public.orders,text)',
  'private.bank_transfer_refund_legacy_completed(uuid)',
  'private.bank_transfer_refund_legacy_completed_claim(uuid,uuid)',
  'private.bank_transfer_refund_pending_evidence_valid(uuid,uuid)',
  'private.finalize_bank_transfer_claim_refund(uuid,text)',
  'private.guard_bank_transfer_refund_ledger()',
  'private.guard_bank_transfer_refund_lifecycle()',
  'private.bank_transfer_refund_legal_proof(uuid)',
  'public.admin_bank_transfer_refund_context(uuid,uuid,uuid,uuid)',
  'public.admin_record_bank_transfer_refund(uuid,uuid,uuid,text,integer,integer,timestamptz,text,text,boolean,uuid,uuid)',
  'public.admin_read_bank_transfer_refund(uuid,uuid,uuid,text,integer,integer,uuid,uuid,boolean)',
  'public.admin_view_bank_transfer_refund_account(uuid,uuid,uuid,integer,uuid,uuid)',
  'public.admin_list_bank_transfer_refunds(integer,integer)'
 ] loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
  if signature in('private.finalize_bank_transfer_claim_refund(uuid,text)','private.bank_transfer_refund_legal_proof(uuid)',
   'private.bank_transfer_refund_pending_evidence_valid(uuid,uuid)','private.bank_transfer_refund_legacy_completed(uuid)',
   'private.bank_transfer_refund_legacy_completed_claim(uuid,uuid)') then
   execute format('grant execute on function %s to postgres',signature);
  end if;
  if signature like 'public.%' then
   execute format('grant execute on function %s to authenticated',signature);
   perform private.register_operator_rpc_contract(signature::regprocedure,'sales.manage',
    case when signature like 'public.admin_bank_transfer_refund_context%' or signature like 'public.admin_list_bank_transfer_refunds%' then 'read' else 'write' end,true);
  else perform private.register_operator_internal_contract(signature::regprocedure);end if;
 end loop;
 -- Modified existing functions retain their owner and ACL. Refresh their exact
 -- metadata receipts; no existing capability or policy grant is changed.
 perform private.register_operator_internal_contract('public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])'::regprocedure);
 perform private.register_operator_internal_contract('private.guard_order_claim_cancellation_transition()'::regprocedure);
 perform private.register_operator_internal_contract('private.guard_unresolved_goods_payment_cancellation()'::regprocedure);
 perform private.register_operator_rpc_contract('public.admin_record_order_claim_refund(uuid,text,text,text)'::regprocedure,'sales.manage','write',false);
 perform private.register_operator_internal_contract('private.account_deletion_blockers(uuid)'::regprocedure);
 perform private.register_operator_internal_contract('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
 perform private.register_operator_internal_contract('public.set_my_gift_claim_refund_account(uuid,uuid,uuid,text,text,text,uuid)'::regprocedure);
end $permissions$;
notify pgrst,'reload schema';
