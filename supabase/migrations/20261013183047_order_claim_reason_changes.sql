-- Reviewed exchange reason corrections preserve original intake, collection and money.
-- A no-op stores only an idempotency receipt, never a change history or notification.
create table private.order_claim_reason_operations (
 id uuid primary key,
 claim_id uuid not null references public.order_cancellation_requests(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 actor_id uuid not null,
 expected_revision integer not null check(expected_revision>=0),
 result_revision integer not null,
 from_reason_type text not null check(from_reason_type in('change_of_mind','defect')),
 from_reason text not null,
 to_reason_type text not null check(to_reason_type in('change_of_mind','defect')),
 to_reason text not null check(char_length(to_reason) between 1 and 200 and to_reason!~'[[:cntrl:]]'),
 agreement text not null check(char_length(agreement) between 2 and 500 and agreement!~'[[:cntrl:]]'),
 fee_reviewed boolean not null,
 changed boolean not null,
 from_stage text not null,
 requested_at timestamptz not null,
 delivered_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 check(changed=((from_reason_type,from_reason) is distinct from(to_reason_type,to_reason))),
 check(result_revision=expected_revision+case when changed then 1 else 0 end)
);
create index order_claim_reason_operations_claim_idx on private.order_claim_reason_operations(claim_id,created_at,id);
alter table private.order_claim_reason_operations enable row level security;
revoke all on private.order_claim_reason_operations from public,anon,authenticated,service_role;

create function private.order_claim_reason_blocker(p_claim public.order_cancellation_requests) returns text
language sql stable security definer set search_path='' as $$
 select case
 when p_claim.claim_type<>'exchange' then 'claim_reason_type_unavailable'
 when p_claim.stage='on_hold' and p_claim.held_from is null then 'claim_reason_stage_unavailable'
 when (case when p_claim.stage='on_hold' then p_claim.held_from else p_claim.stage end)
  not in('requested','in_review','collecting','collected') then 'claim_reason_stage_unavailable'
 when p_claim.reshipped_at is not null or p_claim.reship_tracking_number is not null
  or exists(select 1 from public.order_claim_reshipment_items where claim_id=p_claim.id) then 'claim_reason_reshipped'
 when exists(select 1 from public.order_cancellation_claims where order_id=p_claim.order_id)
  or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.purpose='order' and p.ref_id=p_claim.order_id)
  or exists(select 1 from public.orders where id=p_claim.order_id and status='canceled') then 'claim_reason_finance_started'
 else null end;
$$;
revoke all on function private.order_claim_reason_blocker(public.order_cancellation_requests) from public,anon,authenticated,service_role;

create function private.order_claim_reason_receipt(p_operation_id uuid,p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'actorId',actor_id,'claimId',claim_id,'orderId',order_id,
  'revision',expected_revision,'resultRevision',result_revision,'fromReasonType',from_reason_type,'fromReason',from_reason,
  'toReasonType',to_reason_type,'toReason',to_reason,'agreement',agreement,'feeReviewed',fee_reviewed,
  'changed',changed,'stage',from_stage,'requestedAt',requested_at,'createdAt',created_at)
 from private.order_claim_reason_operations where id=p_operation_id and actor_id=p_actor;
$$;
revoke all on function private.order_claim_reason_receipt(uuid,uuid) from public,anon,authenticated,service_role;

create function public.admin_order_claim_reason_context(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();claim public.order_cancellation_requests;purchase public.orders;blocker text;original private.order_claim_reason_operations;
begin
 if actor is null or not private.has_operator_capability(actor,'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 select * into purchase from public.orders where id=claim.order_id;
 select * into original from private.order_claim_reason_operations where claim_id=claim.id and changed order by created_at,id limit 1;
 blocker:=private.order_claim_reason_blocker(claim);
 return jsonb_build_object('actorId',actor,'claimId',claim.id,'orderId',claim.order_id,'claimType',claim.claim_type,
  'stage',claim.stage,'revision',claim.claim_revision,'reasonType',claim.reason_type,'reason',claim.reason,
  'originalReasonType',coalesce(original.from_reason_type,claim.reason_type),'originalReason',coalesce(original.from_reason,claim.reason),
  'requestedAt',claim.requested_at,'deliveredAt',purchase.delivered_at,'allowed',blocker is null,'blocker',blocker,
  'canUseChangeOfMind',not public.order_withdrawal_deadline_passed(purchase.delivered_at,'change_of_mind',claim.requested_at),
  'canUseDefect',not public.order_withdrawal_deadline_passed(purchase.delivered_at,'defect',claim.requested_at),
  'fee',case when claim.operational_fee_amount is null then null else jsonb_build_object('kind',claim.operational_fee_kind,
    'amount',claim.operational_fee_amount,'note',claim.operational_fee_note,'confirmedAt',claim.operational_fee_confirmed_at) end,
  'history',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'claimId',claim_id,'actorId',actor_id,
   'fromReasonType',from_reason_type,'fromReason',from_reason,'toReasonType',to_reason_type,'toReason',to_reason,
   'requestedAt',requested_at,'createdAt',created_at,'agreement',agreement) order by created_at,id),'[]'::jsonb)
   from private.order_claim_reason_operations where claim_id=claim.id and changed));
end $$;
revoke all on function public.admin_order_claim_reason_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_reason_context(uuid) to authenticated;

create function public.admin_change_order_claim_reason(p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,
 p_expected_actor_id uuid,p_reason_type text,p_reason text,p_agreement text,p_confirmed boolean,p_fee_reviewed boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();claim public.order_cancellation_requests;purchase public.orders;previous private.order_claim_reason_operations;
 order_key uuid;buyer uuid;reason_text text:=btrim(p_reason);agreement_text text:=btrim(p_agreement);blocker text;happened timestamptz;
 changed boolean;result_revision integer;
begin
 if actor is null or actor is distinct from p_expected_actor_id or not private.has_operator_capability(actor,'sales.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 if p_claim_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or p_reason_type is null or p_reason_type not in('change_of_mind','defect') or p_confirmed is distinct from true or p_fee_reviewed is null
  or reason_text is null or char_length(reason_text) not between 1 and 200 or p_reason~'[[:cntrl:]]'
  or agreement_text is null or char_length(agreement_text) not between 2 and 500 or p_agreement~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_claim_reason_change';end if;
 select c.order_id,o.user_id into order_key,buyer from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where c.id=p_claim_id;
 if order_key is null then raise no_data_found using message='claim_not_found';end if;
 perform private.lock_operator_subjects(array[actor,buyer]);
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 perform pg_advisory_xact_lock(hashtextextended('claim-reason-change:'||p_operation_id::text,0));
 select * into previous from private.order_claim_reason_operations where id=p_operation_id;
 if found then
  if previous.actor_id<>actor or previous.claim_id<>p_claim_id or previous.expected_revision<>p_expected_revision
   or previous.to_reason_type<>p_reason_type or previous.to_reason<>reason_text or previous.agreement<>agreement_text
   or previous.fee_reviewed<>p_fee_reviewed then raise unique_violation using message='claim_reason_request_conflict';end if;
  return private.order_claim_reason_receipt(p_operation_id,actor);
 end if;
 select * into purchase from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 perform shipment_id from public.order_claim_collections where claim_id=p_claim_id order by shipment_id for update;
 if claim.claim_revision<>p_expected_revision or claim.order_id is distinct from order_key or purchase.user_id is distinct from buyer then
  raise sqlstate 'PT409' using message='claim_changed';end if;
 blocker:=private.order_claim_reason_blocker(claim);
 if blocker is not null then raise check_violation using message=blocker;end if;
 if claim.operational_fee_amount is not null and not p_fee_reviewed then raise check_violation using message='claim_reason_fee_review_required';end if;
 -- The new classification is evaluated at original intake, never the edit time.
 if claim.reason_type<>p_reason_type and public.order_withdrawal_deadline_passed(purchase.delivered_at,p_reason_type,claim.requested_at) then
  raise check_violation using message='claim_reason_original_deadline_expired';end if;
 changed:=(claim.reason_type,claim.reason) is distinct from(p_reason_type,reason_text);
 happened:=clock_timestamp();result_revision:=claim.claim_revision;
 if changed then
  update public.order_cancellation_requests set reason_type=p_reason_type,reason=reason_text,updated_at=happened
   where id=p_claim_id returning claim_revision into result_revision;
 end if;
 insert into private.order_claim_reason_operations(id,claim_id,order_id,actor_id,expected_revision,result_revision,
  from_reason_type,from_reason,to_reason_type,to_reason,agreement,fee_reviewed,changed,from_stage,requested_at,delivered_at,created_at)
 values(p_operation_id,p_claim_id,order_key,actor,p_expected_revision,result_revision,claim.reason_type,claim.reason,
  p_reason_type,reason_text,agreement_text,p_fee_reviewed,changed,claim.stage,claim.requested_at,purchase.delivered_at,happened);
 if changed then
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.order.claim_reason_changed','order:'||order_key,
   jsonb_build_object('claimId',p_claim_id,'fromReasonType',claim.reason_type,'toReasonType',p_reason_type,
    'descriptionChanged',claim.reason<>reason_text,'customerConfirmed',true,'feeReviewed',p_fee_reviewed));
  insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
   values(buyer,'claim_updated','교환 요청 사유가 정정됐어요',
    case p_reason_type when 'defect' then '상품 하자·오배송' else '단순 변심' end||': '||reason_text,
    '/orders/'||order_key,'order_claim',p_claim_id::text,'claim:reason_changed:'||p_operation_id)
   on conflict(user_id,dedupe_key) do nothing;
 end if;
 return private.order_claim_reason_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean) to authenticated;

create function public.admin_read_order_claim_reason_change(p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();begin
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_claim_reason_change';end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-reason-change:'||p_operation_id::text,0));
 return private.order_claim_reason_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_read_order_claim_reason_change(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_order_claim_reason_change(uuid) to authenticated;

create function public.get_my_order_claim_reason_changes(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise insufficient_privilege using message='auth_required';end if;
 if not exists(select 1 from public.orders where id=p_order_id and user_id=auth.uid()) then raise no_data_found using message='order_not_found';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',id,'claimId',claim_id,'fromReasonType',from_reason_type,'fromReason',from_reason,
  'toReasonType',to_reason_type,'toReason',to_reason,'requestedAt',requested_at,'createdAt',created_at)
  order by created_at,id),'[]'::jsonb) from private.order_claim_reason_operations where order_id=p_order_id and changed);
end $$;
revoke all on function public.get_my_order_claim_reason_changes(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_order_claim_reason_changes(uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_order_claim_reason_context(uuid)','sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean)','sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_read_order_claim_reason_change(uuid)','sales.manage','read',false);
select private.register_operator_internal_contract('private.order_claim_reason_blocker(public.order_cancellation_requests)'::regprocedure);
select private.register_operator_internal_contract('private.order_claim_reason_receipt(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('public.get_my_order_claim_reason_changes(uuid)'::regprocedure);
notify pgrst,'reload schema';
