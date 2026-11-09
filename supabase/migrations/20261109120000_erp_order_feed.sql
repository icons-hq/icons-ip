-- ERP(ERPNext) 주문 피드 — AX 서버가 결제된 주문·출고 묶음을 커서로 당겨 ERP 판매 오더·출고로 옮긴다.
-- 읽기 전용이고 service_role 만 부른다(내부 라우트 /api/internal/erp/orders 가 Bearer 비밀 값을 확인한 뒤).
-- 구매자 개인정보(받는 사람·연락처·주소)·결제 식별자는 내보내지 않는다 — ERP 에는 주문번호와 품목·수량·금액만.
-- 커서는 (바뀐 시각, 주문 id) 키셋. 바뀐 시각 = 주문 updated_at 과 출고 묶음 출고·배송 시각 중 가장 늦은 것.

create index if not exists orders_erp_feed_idx on public.orders (updated_at, id) where status <> 'pending';

create or replace function public.service_erp_order_feed(
  p_after_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with changed as (
    select o.id,
      greatest(o.updated_at, coalesce(max(greatest(s.updated_at, s.shipped_at, s.delivered_at)), o.updated_at)) as changed_at
    from public.orders as o
    left join public.order_shipments as s on s.order_id = o.id
    where o.status <> 'pending'
      and (o.status <> 'canceled' or exists (
        select 1 from public.payments as p
        where p.purpose = 'order' and p.ref_id = o.id and p.status in ('paid', 'canceled', 'refunded')
      ))
    group by o.id, o.updated_at
  ),
  page as (
    select c.id, c.changed_at
    from changed as c
    where p_after_at is null
      or c.changed_at > p_after_at
      or (c.changed_at = p_after_at and c.id > coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
    order by c.changed_at, c.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  )
  select jsonb_build_object(
    'orders', coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id,
      'orderNumber', o.order_number,
      'status', o.status,
      'paymentMethod', o.payment_method,
      'createdAt', o.created_at,
      'changedAt', page.changed_at,
      'total', o.total,
      'discountTotal', o.discount_total,
      'shippingCouponDiscountTotal', o.shipping_coupon_discount_total,
      'storeCreditTotal', o.store_credit_total,
      'volumeDiscountTotal', o.volume_discount_total,
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id,
          'productOrderNumber', i.product_order_number,
          'goodName', i.good_name_snapshot,
          'variantName', i.variant_name_snapshot,
          'variantCode', i.variant_code_snapshot,
          'erpCode', x.erp_code,
          'erpName', x.erp_name,
          'barcode', x.barcode,
          'qty', i.qty,
          'unitPrice', i.unit_price
        ) order by i.product_order_number, i.id), '[]'::jsonb)
        from public.order_items as i
        left join private.order_item_external_identity_snapshots as x on x.order_item_id = i.id
        where i.order_id = o.id
      ),
      'shipments', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id,
          'shipmentNumber', s.shipment_number,
          'status', s.status,
          'carrier', s.carrier,
          'trackingNumber', s.tracking_number,
          'shippedAt', s.shipped_at,
          'deliveredAt', s.delivered_at,
          'shippingFee', s.shipping_fee,
          'itemIds', (
            select coalesce(jsonb_agg(si.order_item_id order by si.order_item_id), '[]'::jsonb)
            from public.order_shipment_items as si where si.shipment_id = s.id
          )
        ) order by s.created_at, s.id), '[]'::jsonb)
        from public.order_shipments as s
        where s.order_id = o.id
      )
    ) order by page.changed_at, page.id), '[]'::jsonb),
    'next', (
      select jsonb_build_object('at', last.changed_at, 'id', last.id)
      from page as last order by last.changed_at desc, last.id desc limit 1
    )
  )
  from page
  join public.orders as o on o.id = page.id;
$$;

revoke all on function public.service_erp_order_feed(timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.service_erp_order_feed(timestamptz, uuid, integer) to service_role;
select private.register_operator_internal_contract('public.service_erp_order_feed(timestamptz,uuid,integer)'::regprocedure);
notify pgrst, 'reload schema';
