-- Only a versioned, actor-bound request may hold or resume a claim. Keep the
-- existing decision implementation (including approval and finance) unchanged.
alter function public.admin_decide_order_claim(uuid,text,text) set schema private;
alter function private.admin_decide_order_claim(uuid,text,text) rename to decide_order_claim;
revoke all on function private.decide_order_claim(uuid,text,text) from public,anon,authenticated,service_role;

create function public.admin_decide_order_claim(p_claim_id uuid,p_decision text,p_note text)
returns text language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.require_operator_capability('sales.manage',false);
 if p_decision in('hold','resume') then
  raise invalid_parameter_value using message='claim_hold_version_required';
 end if;
 return private.decide_order_claim(p_claim_id,p_decision,p_note);
end $$;
revoke all on function public.admin_decide_order_claim(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_decide_order_claim(uuid,text,text) to authenticated;

create table private.order_claim_hold_operations (
 id uuid primary key,
 actor_id uuid not null,
 claim_id uuid not null references public.order_cancellation_requests(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 claim_type text not null check(claim_type in('cancel','return','exchange')),
 expected_revision integer not null check(expected_revision>=0),
 decision text not null check(decision in('hold','resume')),
 note text,
 from_stage text not null,
 to_stage text not null,
 result_revision integer not null check(result_revision=expected_revision+1),
 created_at timestamptz not null default clock_timestamp(),
 check((decision='hold' and note is not null and char_length(note) between 10 and 200 and to_stage='on_hold')
  or(decision='resume' and note is null and from_stage='on_hold'))
);
alter table private.order_claim_hold_operations enable row level security;
revoke all on private.order_claim_hold_operations from public,anon,authenticated,service_role;

create function private.order_claim_hold_receipt(p_id uuid,p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'actorId',actor_id,'claimId',claim_id,'orderId',order_id,
  'claimType',claim_type,'revision',expected_revision,'decision',decision,'note',note,
  'fromStage',from_stage,'stage',to_stage,'resultRevision',result_revision,'createdAt',created_at)
 from private.order_claim_hold_operations where id=p_id and actor_id=p_actor;
$$;
revoke all on function private.order_claim_hold_receipt(uuid,uuid) from public,anon,authenticated,service_role;

create function public.admin_order_claim_hold_context(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();claim public.order_cancellation_requests;
begin
 if not private.has_operator_capability(actor,'sales.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 return jsonb_build_object('actorId',actor,'claimId',claim.id,'orderId',claim.order_id,
  'claimType',claim.claim_type,'stage',claim.stage,'revision',claim.claim_revision,
  'heldFrom',claim.held_from,'holdReason',claim.hold_reason,
  'canHold',claim.stage in('requested','in_review','collecting','collected','processing','needs_review'),
  'canResume',claim.stage='on_hold' and coalesce(claim.held_from,'requested') in('requested','in_review','collecting','collected','processing','needs_review'));
end $$;
revoke all on function public.admin_order_claim_hold_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_hold_context(uuid) to authenticated;

create function public.admin_change_order_claim_hold(
 p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,p_expected_claim_type text,
 p_decision text,p_note text,p_expected_actor_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();order_key uuid;buyer uuid;claim public.order_cancellation_requests;
 previous private.order_claim_hold_operations;next_stage text;note text:=btrim(p_note);result_revision integer;
begin
 if actor is null or p_expected_actor_id is distinct from actor
  or not private.has_operator_capability(actor,'sales.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 if p_claim_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or p_expected_claim_type is null or p_expected_claim_type not in('cancel','return','exchange')
  or p_decision is null or p_decision not in('hold','resume') then
  raise invalid_parameter_value using message='invalid_claim_hold';end if;
 if p_decision='hold' and(note is null or char_length(note) not between 10 and 200 or note~'[[:cntrl:]]') then
  raise check_violation using message='invalid hold reason';end if;
 if p_decision='resume' and p_note is not null then raise invalid_parameter_value using message='invalid_claim_hold';end if;
 select c.order_id,o.user_id into order_key,buyer from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where c.id=p_claim_id;
 if order_key is null then raise no_data_found using message='claim_not_found';end if;
 -- Account fences precede operation and parent locks, matching conversion and withdrawal.
 perform private.lock_operator_subjects(array[actor,buyer]);
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 perform pg_advisory_xact_lock(hashtextextended('claim-hold:'||p_operation_id::text,0));
 select * into previous from private.order_claim_hold_operations where id=p_operation_id;
 if found then
  if previous.actor_id<>actor or previous.claim_id<>p_claim_id or previous.expected_revision<>p_expected_revision
   or previous.claim_type<>p_expected_claim_type or previous.decision<>p_decision or previous.note is distinct from note then
   raise unique_violation using message='claim_hold_request_conflict';end if;
  return private.order_claim_hold_receipt(p_operation_id,actor);
 end if;
 perform id from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 if claim.claim_revision<>p_expected_revision or claim.claim_type<>p_expected_claim_type then
  raise sqlstate 'PT409' using message='claim_changed';end if;
 if claim.stage in('completed','rejected','withdrawn') then raise check_violation using message='claim_hold_unavailable';end if;
 if p_decision='hold' and claim.stage='on_hold' then raise check_violation using message='claim_already_held';end if;
 if p_decision='resume' and (claim.stage<>'on_hold' or coalesce(claim.held_from,'requested') not in('requested','in_review','collecting','collected','processing','needs_review')) then
  raise check_violation using message='claim_not_held';end if;
 -- Reuse the single stage/held_from, buyer notification and audit implementation.
 next_stage:=private.decide_order_claim(p_claim_id,p_decision,note);
 select claim_revision into result_revision from public.order_cancellation_requests where id=p_claim_id;
 insert into private.order_claim_hold_operations(id,actor_id,claim_id,order_id,claim_type,expected_revision,
  decision,note,from_stage,to_stage,result_revision)
 values(p_operation_id,actor,p_claim_id,order_key,claim.claim_type,p_expected_revision,p_decision,note,
  claim.stage,next_stage,result_revision);
 return private.order_claim_hold_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_change_order_claim_hold(uuid,uuid,integer,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_change_order_claim_hold(uuid,uuid,integer,text,text,text,uuid) to authenticated;

create function public.admin_read_order_claim_hold(p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();begin
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_claim_hold';end if;
 -- A retry read waits for an in-flight write before deciding that no result exists.
 perform pg_advisory_xact_lock(hashtextextended('claim-hold:'||p_operation_id::text,0));
 return private.order_claim_hold_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_read_order_claim_hold(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_order_claim_hold(uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_decide_order_claim(uuid,text,text)','sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_order_claim_hold_context(uuid)','sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_change_order_claim_hold(uuid,uuid,integer,text,text,text,uuid)','sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_read_order_claim_hold(uuid)','sales.manage','read',false);
select private.register_operator_internal_contract('private.decide_order_claim(uuid,text,text)'::regprocedure);
select private.register_operator_internal_contract('private.order_claim_hold_receipt(uuid,uuid)'::regprocedure);
notify pgrst,'reload schema';
