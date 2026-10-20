begin;
create table private.claim_collection_plans (
 claim_id uuid not null references public.order_cancellation_requests(id), shipment_id uuid not null references public.order_shipments(id),
 revision bigint not null check(revision>0), method text not null check(method in('not_requested','seller_arranged','customer_sent')),
 carrier text references public.shipping_carriers(code), tracking_number text, evidence text not null,
 requested_once boolean not null default false, customer_sent_once boolean not null default false,
 updated_at timestamptz not null default clock_timestamp(), primary key(claim_id,shipment_id),
 check((carrier is null)=(tracking_number is null)),check(method<>'not_requested' or carrier is null),
 check(method<>'customer_sent' or carrier is not null)
);
create table private.claim_collection_events (
 id uuid primary key,claim_id uuid not null references public.order_cancellation_requests(id),shipment_id uuid not null references public.order_shipments(id),
 actor_id uuid not null,session_id uuid not null,request jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index claim_collection_events_history on private.claim_collection_events(claim_id,created_at desc,id);
alter table private.claim_collection_plans enable row level security;
alter table private.claim_collection_events enable row level security;
revoke all on private.claim_collection_plans,private.claim_collection_events from public,anon,authenticated,service_role;

create function private.claim_collection_document(p_claim uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('claimId',c.id,'orderId',c.order_id,'claimRevision',c.claim_revision,'editable',
  (case when c.stage='on_hold' then c.held_from else c.stage end) in('requested','in_review','collecting','collected')
  and c.reshipped_at is null and not exists(select 1 from public.order_cancellation_claims where order_id=c.order_id)
  and not exists(select 1 from public.refunds r join public.payments py on py.id=r.payment_id where py.ref_id=c.order_id and py.purpose='order'),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('shipmentId',s.id,'originName',s.origin_name_snapshot,'revision',coalesce(p.revision,0),
  'method',coalesce(p.method,i->>'method','not_requested'),'carrier',case when p.revision is not null then p.carrier else i->>'carrier' end,'trackingNumber',case when p.revision is not null then p.tracking_number else i->>'trackingNumber' end,
  'evidence',coalesce(p.evidence,i->>'note',''),'requestedOnce',coalesce(p.requested_once,false) or coalesce(i->>'method','not_requested')<>'not_requested',
  'collectedAt',x.collected_at,'updatedAt',p.updated_at) order by s.id)
  from public.order_shipments s left join private.claim_collection_plans p on p.claim_id=c.id and p.shipment_id=s.id
  left join public.order_claim_collections x on x.claim_id=c.id and x.shipment_id=s.id
  left join lateral (select value from private.seller_order_claim_intakes z cross join lateral jsonb_array_elements(z.payload->'collections') where z.claim_id=c.id and value->>'shipmentId'=s.id::text) original(i) on true
  where s.order_id=c.order_id),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'shipmentId',e.shipment_id,'createdAt',e.created_at,'method',e.request#>'{values,method}',
  'carrier',e.request#>'{values,carrier}','trackingNumber',e.request#>'{values,trackingNumber}','evidence',e.request#>'{values,evidence}') order by e.created_at desc,e.id)
  from(select * from private.claim_collection_events where claim_id=c.id order by created_at desc,id limit 20)e),'[]'::jsonb))
 from public.order_cancellation_requests c where c.id=p_claim and c.claim_type in('return','exchange');
$$;
revoke all on function private.claim_collection_document(uuid) from public,anon,authenticated,service_role;
create function public.admin_read_claim_collection_plan(p_claim uuid,p_actor uuid,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.purchase_confirmation_identity(p_actor,p_session,true);
 return private.claim_collection_document(p_claim);
end $$;
revoke all on function public.admin_read_claim_collection_plan(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_claim_collection_plan(uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_read_claim_collection_plan(uuid,uuid,uuid)'::regprocedure,'sales.manage','read',false);

create function public.admin_save_claim_collection_plan(p_claim uuid,p_shipment uuid,p_revision bigint,p_claim_revision integer,p_values jsonb,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare order_key uuid;parties uuid[];c public.order_cancellation_requests;plan private.claim_collection_plans;prior private.claim_collection_events;
 request jsonb;result jsonb;original jsonb;requested boolean;sent boolean;begin
 perform private.purchase_confirmation_identity(p_actor,p_session,true);
 if p_claim is null or p_shipment is null or p_operation is null or p_revision is null or p_revision<0 or p_claim_revision is null or p_claim_revision<0
  or not private.transaction_json_keys(p_values,array['method','carrier','trackingNumber','evidence','confirmed'])
  or coalesce(p_values->>'method','') not in('not_requested','seller_arranged','customer_sent') or p_values->'confirmed' is distinct from 'true'::jsonb
  or jsonb_typeof(p_values->'evidence') is distinct from 'string' or char_length(btrim(p_values->>'evidence')) not between 2 and 500
  or (p_values->>'evidence')~'[[:cntrl:]]'
  or (p_values->'carrier'='null'::jsonb) is distinct from (p_values->'trackingNumber'='null'::jsonb)
  or not(p_values->'carrier'='null'::jsonb or jsonb_typeof(p_values->'carrier')='string' and jsonb_typeof(p_values->'trackingNumber')='string' and p_values->>'trackingNumber'~'^[A-Z0-9]{8,40}$')
  or p_values->>'method'='not_requested' and p_values->'carrier'<>'null'::jsonb
  or p_values->>'method'='customer_sent' and p_values->'carrier'='null'::jsonb then raise invalid_parameter_value using message='claim_collection_invalid';end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_claim;
 if order_key is null then raise no_data_found using message='claim_not_found';end if;
 parties:=private.contact_parties(order_key);perform private.lock_operator_subjects(parties);
 if exists(select 1 from private.account_action_fences where subject_user_id=any(parties)) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-collection:'||p_operation,0));
 request:=jsonb_build_object('claimId',p_claim,'shipmentId',p_shipment,'revision',p_revision,'claimRevision',p_claim_revision,'values',p_values);
 select * into prior from private.claim_collection_events where id=p_operation;
 if found then
  if prior.actor_id<>p_actor or prior.session_id<>p_session or prior.request<>request then raise sqlstate 'PT409' using message='claim_collection_conflict';end if;
  return prior.result;
 end if;
 c:=private.contact_lock_scope(order_key,p_claim,parties);
 if c.claim_revision<>p_claim_revision then raise sqlstate 'PT409' using message='claim_collection_changed';end if;
 if (private.claim_collection_document(p_claim)->>'editable')::boolean is distinct from true or not exists(select 1 from public.order_shipments where id=p_shipment and order_id=order_key) then
  raise sqlstate 'PT409' using message='claim_collection_blocked';end if;
 select * into plan from private.claim_collection_plans where claim_id=p_claim and shipment_id=p_shipment for update;
 if coalesce(plan.revision,0)<>p_revision then raise sqlstate 'PT409' using message='claim_collection_changed';end if;
 if p_values->>'carrier' is not null and not exists(select 1 from public.shipping_carriers where code=p_values->>'carrier' and is_active) then raise invalid_parameter_value using message='claim_collection_invalid';end if;
 select value into original from private.seller_order_claim_intakes z cross join lateral jsonb_array_elements(z.payload->'collections') where z.claim_id=p_claim and value->>'shipmentId'=p_shipment::text;
 requested:=coalesce(plan.requested_once,false) or coalesce(original->>'method','not_requested')<>'not_requested' or c.collecting_at is not null or c.collected_at is not null;
 sent:=coalesce(plan.customer_sent_once,false) or original->>'method'='customer_sent';
 if requested and p_values->>'method'='not_requested' then raise sqlstate 'PT409' using message='claim_collection_already_started';end if;
 insert into private.claim_collection_plans(claim_id,shipment_id,revision,method,carrier,tracking_number,evidence,requested_once,customer_sent_once)
 values(p_claim,p_shipment,p_revision+1,p_values->>'method',p_values->>'carrier',p_values->>'trackingNumber',btrim(p_values->>'evidence'),
  requested or p_values->>'method'<>'not_requested',coalesce(sent,false) or p_values->>'method'='customer_sent')
 on conflict(claim_id,shipment_id) do update set revision=excluded.revision,method=excluded.method,carrier=excluded.carrier,tracking_number=excluded.tracking_number,
  evidence=excluded.evidence,requested_once=excluded.requested_once,customer_sent_once=excluded.customer_sent_once,updated_at=clock_timestamp();
 update public.order_cancellation_requests set updated_at=clock_timestamp() where id=p_claim;
 result:=private.claim_collection_document(p_claim);
 insert into private.claim_collection_events(id,claim_id,shipment_id,actor_id,session_id,request,result) values(p_operation,p_claim,p_shipment,p_actor,p_session,request,result);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation,p_actor,'admin.order.claim_collection_corrected','order:'||order_key,
  jsonb_build_object('claimId',p_claim,'shipmentId',p_shipment,'method',p_values->>'method','revision',p_revision+1));
 perform private.notify_order_claim(p_claim,'claim_updated','회수 안내가 변경됐어요','판매자가 확인한 회수 방식과 송장 정보가 반영됐습니다.');
 return result;
end $$;
revoke all on function public.admin_save_claim_collection_plan(uuid,uuid,bigint,integer,jsonb,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_claim_collection_plan(uuid,uuid,bigint,integer,jsonb,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_claim_collection_plan(uuid,uuid,bigint,integer,jsonb,uuid,uuid,uuid)'::regprocedure,'sales.manage','write',false);

CREATE OR REPLACE FUNCTION private.contact_blocker(p_claim order_cancellation_requests, p_target text, p_command text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare stage text:=case when p_claim.stage='on_hold' then p_claim.held_from else p_claim.stage end;intake jsonb;row jsonb;
begin
 if p_claim.claim_type not in('return','exchange') or(p_target='reshipment' and p_claim.claim_type<>'exchange') then return 'not_applicable';end if;
 if exists(select 1 from public.orders where id=p_claim.order_id and status='canceled') or exists(select 1 from public.order_cancellation_claims where order_id=p_claim.order_id)
 or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=p_claim.order_id and p.purpose='order') then return 'financial_state';end if;
 if stage is null or stage not in('requested','in_review','collecting','collected') then return 'claim_stage';end if;
 if p_target='reshipment' then
  if p_claim.reshipped_at is not null or p_claim.reship_carrier is not null or p_claim.reship_tracking_number is not null or p_claim.reship_delivered_at is not null
  or exists(select 1 from private.claim_reshipment_items_read(p_claim.id)) or exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim.id)
  or exists(select 1 from private.order_claim_reshipment_destinations where claim_id=p_claim.id) then return 'reshipment_started';end if;
  if p_command='reshipment' then
   if p_claim.stage<>'collected' then return 'claim_stage';end if;
   begin perform private.assert_claim_collections_complete(p_claim.id);exception when others then return 'collection_incomplete';end;
  end if;
 else
  if stage not in('requested','in_review') or p_claim.collecting_at is not null or p_claim.collected_at is not null
  or exists(select 1 from public.order_claim_collections where claim_id=p_claim.id and(collected_at is not null or collected_by is not null or evidence is not null)) then return 'collection_started';end if;
  if exists(select 1 from private.claim_collection_plans where claim_id=p_claim.id and requested_once) then return 'collection_started';end if;
  select payload->'collections' into intake from private.seller_order_claim_intakes where claim_id=p_claim.id;
  if found then
   if jsonb_typeof(intake) is distinct from 'array' or jsonb_array_length(intake)=0 then return 'collection_unknown';end if;
   for row in select value from jsonb_array_elements(intake) loop
    if not private.contact_keys(row,array['shipmentId','method','carrier','trackingNumber','note']) or not private.contact_uuid(row->'shipmentId')
    or row->>'method' is distinct from 'not_requested' or row->'carrier' is distinct from 'null'::jsonb or row->'trackingNumber' is distinct from 'null'::jsonb then return 'collection_started';end if;
   end loop;
  end if;
 end if;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION private.order_claim_withdrawal_blocker(p_claim order_cancellation_requests)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case
  when p_claim.stage='withdrawn' then 'claim_already_withdrawn'
  when (case when p_claim.stage='on_hold' then coalesce(p_claim.held_from,'requested') else p_claim.stage end) not in('requested','in_review','collecting') then 'claim_withdrawal_started'
  when p_claim.collected_at is not null or p_claim.reshipped_at is not null
   or exists(select 1 from public.order_claim_collections where claim_id=p_claim.id and collected_at is not null)
   or exists(select 1 from private.claim_collection_plans where claim_id=p_claim.id and customer_sent_once)
   or exists(select 1 from private.seller_order_claim_intakes intake cross join lateral jsonb_array_elements(intake.payload->'collections') item
    where intake.claim_id=p_claim.id and item->>'method'='customer_sent') then 'claim_withdrawal_collection_started'
  when exists(select 1 from public.order_cancellation_claims where order_id=p_claim.order_id)
   or exists(select 1 from public.refunds refund join public.payments payment on payment.id=refund.payment_id where payment.purpose='order' and payment.ref_id=p_claim.order_id)
   or exists(select 1 from public.orders where id=p_claim.order_id and status='canceled') then 'claim_withdrawal_finance_started'
  else null end;
$function$;


create function public.read_my_claim_collection_plan(p_claim uuid,p_actor uuid,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare doc jsonb;order_key uuid;viewer text;begin
 perform private.purchase_confirmation_identity(p_actor,p_session,false);
 select c.order_id,case when g.recipient_id=p_actor then 'recipient' when g.sender_id=p_actor then 'sender' when g.id is null and o.user_id=p_actor then 'buyer' end
 into order_key,viewer from public.order_cancellation_requests c join public.orders o on o.id=c.order_id left join private.gift_intents g on g.order_id=o.id where c.id=p_claim;
 if viewer is null then raise no_data_found using message='claim_not_found';end if;
 if viewer='sender' then return null;end if;
 doc:=private.claim_collection_document(p_claim);
 return doc||jsonb_build_object('editable',false,'history','[]'::jsonb,'rows',(select coalesce(jsonb_agg(value||jsonb_build_object('evidence','')),'[]') from jsonb_array_elements(doc->'rows')));
end $$;
revoke all on function public.read_my_claim_collection_plan(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_my_claim_collection_plan(uuid,uuid,uuid) to authenticated;
commit;
