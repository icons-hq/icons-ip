begin;
-- Packaging requires exact original payment and item-allocation evidence.
CREATE OR REPLACE FUNCTION private.shipment_pack_ready(p_shipment uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.order_shipments;o public.orders;a jsonb;begin
 select * into s from public.order_shipments where id=p_shipment;
 select * into o from public.orders where id=s.order_id;a:=private.shipment_pack_identity(p_shipment)->'address';
 if s.id is null or s.delivery_method<>'parcel' or s.status<>'ready' or o.status not in('confirmed','shipping')
  or s.shipped_at is not null or not private.shipment_preorder_allocation_ready(s.id)
  or coalesce(a->>'recipientName','')='' or coalesce(a->>'address1','')='' or coalesce(a->>'postalCode','')!~'^[0-9]{5}$'
  or coalesce(a->>'phone','')!~'^[0-9]{8,15}$'
  or not exists(select 1 from public.order_shipment_items where shipment_id=s.id)
  or exists(select 1 from public.order_shipment_items a join public.order_items i on i.id=a.order_item_id where a.shipment_id=s.id and (a.order_id<>o.id or i.order_id<>o.id or a.qty<>i.qty))
  or exists(select 1 from private.account_action_fences where subject_user_id=any(private.contact_parties(o.id)))
  or exists(select 1 from public.order_cancellation_requests where order_id=o.id and status in('requested','processing','needs_review'))
  or exists(select 1 from public.order_cancellation_claims where order_id=o.id)
  or not exists(select 1 from public.payments where purpose='order' and ref_id=o.id and user_id=o.user_id and amount=o.total and status='paid') then return false;end if;
 return true;
end $function$;
commit;
