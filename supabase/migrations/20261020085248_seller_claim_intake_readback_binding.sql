-- An unresolved submission is identified by its actor and complete original
-- payload, including the existing private refund-account fingerprint. A null
-- result says only that no committed receipt exists at this read's lock boundary.
create function public.admin_read_seller_claim_intake(p_request_id uuid,p_payload jsonb,p_refund_account jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; previous private.seller_order_claim_intakes; expected_payload jsonb;
begin
 actor:=private.require_operator_capability('sales.manage',false);
 if p_request_id is null then raise invalid_parameter_value using message='invalid_seller_claim_request';end if;
 perform private.validate_seller_claim_intake(p_payload,p_refund_account);
 expected_payload:=p_payload||jsonb_build_object('refundAccountDigest',
  case when p_refund_account is null or p_refund_account='null'::jsonb then null
   else encode(extensions.digest(p_refund_account::text,'sha256'),'hex') end);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('seller_claim_intake:'||p_request_id,0));
 select * into previous from private.seller_order_claim_intakes where claim_id=p_request_id;
 if not found then
  if exists(select 1 from public.order_cancellation_requests where id=p_request_id) then
   raise exception using errcode='PT409',message='seller_claim_request_conflict';
  end if;
  return null;
 end if;
 if previous.actor_id<>actor or previous.payload<>expected_payload then
  raise exception using errcode='PT409',message='seller_claim_request_conflict';
 end if;
 return private.seller_claim_intake_json(p_request_id);
end $$;
revoke all on function public.admin_read_seller_claim_intake(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_seller_claim_intake(uuid,jsonb,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_read_seller_claim_intake(uuid,jsonb,jsonb)'::regprocedure,'sales.manage','read',false);
