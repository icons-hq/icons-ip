begin;
-- Replacement supply never excuses missing original allocation quantities.
create or replace function private.order_all_items_delivered(target_order uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.orders o where o.id=target_order and o.status in ('delivered','done'))
  and exists(select 1 from public.order_items i where i.order_id=target_order)
  and not exists(select 1 from public.order_items i where i.order_id=target_order and
   coalesce((select sum(link.qty) from public.order_shipment_items link where link.order_item_id=i.id and link.order_id=i.order_id),0)<>i.qty)
  and (not exists(select 1 from public.order_items i where i.order_id=target_order and
    coalesce((select sum(link.qty) from public.order_shipment_items link join public.order_shipments s on s.id=link.shipment_id
     where link.order_item_id=i.id and link.order_id=i.order_id and s.status='delivered' and s.delivered_at is not null),0)<>i.qty)
   or exists(select 1 from public.order_cancellation_requests c where c.order_id=target_order and c.claim_type='exchange' and c.stage='completed'
    and c.reship_delivered_at is not null and c.reship_delivered_by is not null and c.reship_delivery_evidence is not null and private.claim_collections_complete(c.id)))
  and not exists(select 1 from public.order_cancellation_requests c where c.order_id=target_order and c.claim_type='exchange' and c.stage='completed'
    and (c.reshipped_at is null or c.reship_carrier is null or c.reship_tracking_number is null or c.reship_delivered_at is null or c.reship_delivered_by is null or c.reship_delivery_evidence is null));
$$;
revoke all on function private.order_all_items_delivered(uuid) from public,anon,authenticated,service_role;
commit;
