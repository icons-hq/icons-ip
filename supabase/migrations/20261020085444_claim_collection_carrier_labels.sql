-- Keep historical operation receipts readable while current views use registry labels.
begin;
create or replace function private.claim_collection_document(p_claim uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('claimId',c.id,'orderId',c.order_id,'claimRevision',c.claim_revision,'editable',
  (case when c.stage='on_hold' then c.held_from else c.stage end) in('requested','in_review','collecting','collected')
  and c.reshipped_at is null and not exists(select 1 from public.order_cancellation_claims where order_id=c.order_id)
  and not exists(select 1 from public.refunds r join public.payments py on py.id=r.payment_id where py.ref_id=c.order_id and py.purpose='order'),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('shipmentId',s.id,'originName',s.origin_name_snapshot,'revision',coalesce(p.revision,0),
  'method',coalesce(p.method,i->>'method','not_requested'),'carrier',case when p.revision is not null then p.carrier else i->>'carrier' end,'trackingNumber',case when p.revision is not null then p.tracking_number else i->>'trackingNumber' end,
  'carrierLabel',(select label from public.shipping_carriers where code=case when p.revision is not null then p.carrier else i->>'carrier' end),'evidence',coalesce(p.evidence,i->>'note',''),'requestedOnce',coalesce(p.requested_once,false) or coalesce(i->>'method','not_requested')<>'not_requested',
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

commit;
