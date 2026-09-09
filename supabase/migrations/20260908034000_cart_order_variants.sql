-- #439: expand cart/order references, preserve existing quantities and paid snapshots.
alter table public.cart_items add column variant_id uuid;
alter table public.order_items add column variant_id uuid, add column variant_name_snapshot text, add column variant_code_snapshot text;
update public.cart_items item set variant_id=variant.id from public.goods_variants variant where variant.good_id=item.good_id and variant.is_default;
update public.order_items item set variant_id=variant.id,variant_code_snapshot=variant.code from public.goods_variants variant where variant.good_id=item.good_id and variant.is_default;
do $$ begin
  if exists(select 1 from public.cart_items where variant_id is null) or exists(select 1 from public.order_items where variant_id is null) then
    raise check_violation using message='existing_item_default_variant_missing';
  end if;
end $$;
alter table public.goods_variants add constraint goods_variants_id_good_key unique(id,good_id);
alter table public.cart_items drop constraint cart_items_pkey, add primary key(user_id,variant_id),
  add constraint cart_items_variant_good_fkey foreign key(variant_id,good_id) references public.goods_variants(id,good_id) on update cascade on delete cascade deferrable initially deferred;
alter table public.order_items add constraint order_items_variant_good_fkey foreign key(variant_id,good_id) references public.goods_variants(id,good_id) on update cascade deferrable initially deferred;
create index order_items_variant_idx on public.order_items(variant_id);

create function private.fill_cart_default_variant() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.variant_id is null then
    select id into new.variant_id from public.goods_variants where good_id=new.good_id and is_default;
  end if;
  return new;
end $$;
revoke all on function private.fill_cart_default_variant() from public,anon,authenticated,service_role;
create trigger cart_items_fill_variant before insert or update of good_id,variant_id on public.cart_items for each row execute function private.fill_cart_default_variant();

create function private.snapshot_order_variant() returns trigger language plpgsql security definer set search_path='' as $$
declare variant public.goods_variants;
begin
  if new.variant_id is null then select id into new.variant_id from public.goods_variants where good_id=new.good_id and is_default; end if;
  select * into variant from public.goods_variants where id=new.variant_id and good_id=new.good_id;
  if not found then raise foreign_key_violation using message='order_variant_not_found'; end if;
  new.variant_code_snapshot:=variant.code;
  new.variant_name_snapshot:=case when variant.is_default and variant.name='기본 옵션' and variant.attributes='{}'
    and not exists(select 1 from public.goods_variants where good_id=new.good_id and id<>variant.id and archived_at is null)
    then null else variant.name end;
  return new;
end $$;
revoke all on function private.snapshot_order_variant() from public,anon,authenticated,service_role;
create trigger order_items_variant_snapshot before insert on public.order_items for each row execute function private.snapshot_order_variant();

create function private.change_goods_variant_stock(target_good_id text,target_variant_id uuid,target_delta bigint)
returns integer language plpgsql security invoker set search_path='' as $$
declare previous_stock integer; next_stock bigint;
begin
  perform 1 from public.goods where id=target_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select stock_qty into previous_stock from public.goods_variants where id=target_variant_id and good_id=target_good_id for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  next_stock:=previous_stock::bigint+target_delta;
  if target_delta is null or next_stock<0 or next_stock>2147483647 then raise numeric_value_out_of_range using message='stock_out_of_range'; end if;
  update public.goods_variants set stock_qty=next_stock::integer where id=target_variant_id;
  return next_stock::integer;
end $$;
revoke all on function private.change_goods_variant_stock(text,uuid,bigint) from public,anon,authenticated,service_role;

create function public.set_cart_item_quantity(p_good_id text,p_variant_id uuid,p_qty integer)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); selected_variant uuid:=p_variant_id; available_stock integer;
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.assert_active_user(actor);
  if nullif(btrim(p_good_id),'') is null or p_qty is null or p_qty<0 then raise invalid_parameter_value using message='invalid cart item'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||actor::text,0));
  if selected_variant is null then select id into selected_variant from public.goods_variants where good_id=p_good_id and is_default; end if;
  if p_qty=0 then delete from public.cart_items where user_id=actor and good_id=p_good_id and variant_id=selected_variant; return; end if;
  select variant.stock_qty into available_stock from public.goods_variants variant
    join public.goods good on good.id=variant.good_id join public.ips ip on ip.id=good.ip_id
    where variant.id=selected_variant and variant.good_id=p_good_id and variant.archived_at is null
      and good.published_at is not null and good.archived_at is null and good.sale_restriction='none'
      and good.stock<>'soldout' and ip.published_at is not null and ip.archived_at is null;
  if not found then raise check_violation using message='catalog_item_unavailable'; end if;
  if p_qty>available_stock then raise check_violation using message='out of stock'; end if;
  insert into public.cart_items(user_id,good_id,variant_id,qty) values(actor,p_good_id,selected_variant,p_qty)
    on conflict(user_id,variant_id) do update set qty=excluded.qty;
end $$;
revoke all on function public.set_cart_item_quantity(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.set_cart_item_quantity(text,uuid,integer) to authenticated;

create or replace function public.merge_cart_items(p_items jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); item record; selected_variant uuid;
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.assert_active_user(actor);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>1000 then raise check_violation using message='cart items must be an array'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||actor::text,0));
  for item in select * from jsonb_to_recordset(p_items) as candidate(good_id text,variant_id uuid,qty integer) order by good_id,variant_id loop
    if nullif(btrim(item.good_id),'') is null or item.qty is null or item.qty<=0 then raise check_violation using message='invalid cart item'; end if;
    select variant.id into selected_variant from public.goods_variants variant
      join public.goods good on good.id=variant.good_id join public.ips ip on ip.id=good.ip_id
      where good.id=btrim(item.good_id) and (case when item.variant_id is null then variant.is_default else variant.id=item.variant_id end)
        and variant.archived_at is null and good.archived_at is null and good.published_at is not null and good.sale_restriction='none'
        and ip.archived_at is null and ip.published_at is not null;
    if not found then raise check_violation using message='catalog_item_unavailable'; end if;
    insert into public.cart_items(user_id,good_id,variant_id,qty) values(actor,btrim(item.good_id),selected_variant,item.qty)
      on conflict(user_id,variant_id) do update set qty=greatest(public.cart_items.qty,excluded.qty);
  end loop;
end $$;
revoke all on function public.merge_cart_items(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.merge_cart_items(jsonb) to authenticated;

-- Preserve the full #421 checkout contract; only option identity/price/stock and the #422 policy source change.
CREATE OR REPLACE FUNCTION public.place_order(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  -- 결제사 최소 결제액(20260813242000 가드·lib/coupons.ts MIN_PAYABLE_TOTAL와 동치).
  -- 할인이 총액을 이 밑으로 내리면 가드가 주문 전체를 롤백하므로, 여기서 캡한다.
  c_min_payable_total constant bigint := 1000;
  v_user uuid := (select auth.uid());
  v_order uuid;
  v_existing_address jsonb;
  v_existing_payment_method public.order_payment_method;
  v_expires_at timestamptz;
  v_subtotal bigint := 0;
  v_shipping_fee bigint := 0;
  v_item_count integer := 0;
  v_recipient_name text;
  v_phone text;
  v_postal_code text;
  v_address1 text;
  v_optional text;
  v_selected_coupon uuid;
  v_coupon_eval record;
  v_discount bigint := 0;
  r record;
  v_variant public.goods_variants;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.id = v_user
      and nullif(btrim(coalesce(profile.email, auth_user.email)), '') is not null
      and nullif(btrim(profile.nickname), '') is not null
      and profile.birth_date is not null
      and profile.birth_date <= current_date
      and profile.onboarded_at is not null
      and profile.consents ->> 'terms' = 'true'
      and profile.consents ->> 'privacy' = 'true'
  ) then
    raise insufficient_privilege using message = 'onboarding required';
  end if;

  if p_checkout_key is null then
    raise not_null_violation using message = 'checkout key required';
  end if;

  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if not (p_address ?& array['recipientName', 'phone', 'postalCode', 'address1'])
     or exists (
       select 1
       from jsonb_object_keys(p_address) as address_key(key)
       where address_key.key not in (
         'recipientName', 'phone', 'postalCode', 'address1', 'address2', 'deliveryNote'
       )
     )
     or exists (
       select 1
       from jsonb_each(p_address) as address_value(key, value)
       where jsonb_typeof(address_value.value) <> 'string'
     ) then
    raise check_violation using message = 'invalid checkout address';
  end if;

  v_recipient_name := p_address ->> 'recipientName';
  v_phone := p_address ->> 'phone';
  v_postal_code := p_address ->> 'postalCode';
  v_address1 := p_address ->> 'address1';

  if v_recipient_name <> btrim(v_recipient_name, E' \t\n\r\f\v')
     or length(v_recipient_name) not between 1 and 50
     or v_phone !~ '^[0-9]{8,15}$'
     or v_postal_code !~ '^[0-9]{5}$'
     or v_address1 <> btrim(v_address1, E' \t\n\r\f\v')
     or length(v_address1) not between 1 and 200 then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if p_address ? 'address2' then
    v_optional := p_address ->> 'address2';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  if p_address ? 'deliveryNote' then
    v_optional := p_address ->> 'deliveryNote';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  -- 같은 사용자의 다른 탭 주문을 직렬화한다. 동일 키 재시도는 먼저 생성된
  -- 주문을 반환하고, 다른 키는 첫 주문이 비운 장바구니를 확인하게 된다.
  -- 쿠폰 적용·해제도 같은 잠금을 잡으므로 선택 교체와 소비가 경합하지 않는다.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select orders.id, orders.address, orders.payment_method
    into v_order, v_existing_address, v_existing_payment_method
  from public.orders
  where orders.user_id = v_user
    and orders.checkout_key = p_checkout_key;

  if found then
    -- 같은 checkout key로 결제수단만 바꿔 다시 부르면 24시간 선점을 15분 주문에
    -- 덧씌우거나 그 반대가 된다. 주소와 같은 등급의 충돌로 막는다.
    if v_existing_address is distinct from p_address
      or v_existing_payment_method is distinct from p_payment_method
    then
      raise unique_violation using message = 'checkout key conflict';
    end if;
    return v_order;
  end if;

  -- 카드 15분 · 무통장 24시간. 무통장은 사람이 은행 앱을 열고 이체할 시간을
  -- 줘야 해서 선점 창이 길고, 그만큼 재고가 오래 묶인다 — 한정 드롭은
  -- goods.allow_bank_transfer로 아예 차단한다(ADR-0007).
  v_expires_at := case
    when p_payment_method = 'bank_transfer' then now() + interval '24 hours'
    else now() + interval '15 minutes'
  end;

  insert into public.orders (
    user_id, status, total, shipping_fee, address, expires_at, checkout_key, payment_method
  )
  values (v_user, 'pending', 0, 0, p_address, v_expires_at, p_checkout_key, p_payment_method)
  returning id into v_order;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||v_user::text,0));
  -- Parent goods are locked before their selected options and cache updates.
  for r in
    select
      cart.good_id,
      cart.variant_id,
      cart.qty,
      good.price,
      good.stock,
      good.stock_qty,
      good.name,
      good.type,
      good.ip_id,
      good.allow_bank_transfer,
      good.sale_restriction,
      good.published_at,
      good.archived_at
    from public.cart_items as cart
    join public.goods as good on good.id = cart.good_id
    where cart.user_id = v_user
    order by cart.good_id, cart.variant_id
    for update of cart, good
  loop
    -- The locked good fixes its parent association. Keep the IP SHARE lock until
    -- this order commits, serializing new purchases with an unpublish UPDATE.
    perform private.assert_ip_purchasable(r.ip_id);
    if r.published_at is null or r.archived_at is not null then
      raise check_violation using message='catalog_item_unavailable';
    end if;
    select * into v_variant from public.goods_variants where id=r.variant_id and good_id=r.good_id for update;
    if not found or v_variant.archived_at is not null then raise check_violation using message='catalog_item_unavailable'; end if;
    v_item_count := v_item_count + 1;

    if r.stock = 'soldout' or v_variant.stock_qty < r.qty then
      raise check_violation using message = format('out of stock: %s', r.good_id);
    end if;

    if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
      raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
    end if;

    -- 성인인증(#209·#210)이 도입되기 전까지 판매 제한 상품은 서버가 구매를
    -- 차단한다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개로 판정한다.
    if r.sale_restriction <> 'none' then
      raise check_violation using message = format('restricted good blocked: %s', r.good_id);
    end if;

    perform private.change_goods_variant_stock(r.good_id, r.variant_id, -r.qty::bigint);

    insert into public.order_items (
      order_id,
      good_id,
      variant_id,
      qty,
      unit_price,
      good_name_snapshot,
      good_type_snapshot,
      good_ip_id_snapshot
    )
    values (
      v_order,
      r.good_id,
      r.variant_id,
      r.qty,
      v_variant.price,
      r.name,
      r.type,
      r.ip_id
    );

    -- 조회 시 잠근 스냅샷 행만 지운다. 동시에 새로 담긴 다른 상품까지
    -- 마지막 broad delete가 없애지 않도록 상품 단위로 소비한다.
    delete from public.cart_items
    where user_id = v_user
      and good_id = r.good_id and variant_id = r.variant_id;

    v_subtotal := v_subtotal + (v_variant.price::bigint * r.qty::bigint);
  end loop;

  if v_item_count = 0 then
    raise check_violation using message = 'cart empty';
  end if;

  -- 배송비 판정은 할인 전 소계 기준이다 — 쿠폰이 무료배송 경계를 흔들면
  -- 카트의 "얼마 더 담으면 무료배송" 안내가 거짓말이 된다.
  v_shipping_fee := private.goods_shipping_fee_for(v_order);

  -- 카트에 적용해 둔 쿠폰을 여기서 최종 검증하고 소비한다. 조건 미달이면 주문
  -- 전체를 거부한다 — 할인을 기대한 사용자를 조용히 정가로 결제시키지 않는다.
  select selection.user_coupon_id
  into v_selected_coupon
  from public.cart_coupon_selections as selection
  where selection.user_id = v_user;

  if v_selected_coupon is not null then
    -- 상태 전이 전에 보유 행을 잠근다. 같은 유저는 advisory lock으로 이미
    -- 직렬화되어 있고, 이 잠금은 향후 다른 경로가 생겨도 이중 사용을 막는 안전벨트다.
    perform held.id
    from public.user_coupons as held
    where held.id = v_selected_coupon
    for update;

    select * into v_coupon_eval
    from private.evaluate_user_coupon(v_selected_coupon, v_user, v_subtotal);
    if v_coupon_eval.o_reason is not null then
      raise check_violation using message = v_coupon_eval.o_reason;
    end if;
    -- 결제사 최소 결제액을 지키도록 할인을 캡한다 — 전액 쿠폰이 주문을
    -- 결제 불가(총액 < 1,000원)로 만들면 혜택이 주문 실패로 둔갑한다.
    v_discount := least(
      v_coupon_eval.o_discount,
      greatest(0, v_subtotal + v_shipping_fee - c_min_payable_total)
    );

    update public.user_coupons
    set status = 'used',
        used_at = now(),
        used_order_id = v_order
    where id = v_selected_coupon;

    insert into public.coupon_redemptions (
      user_coupon_id, coupon_code, user_id, order_id, discount_amount
    )
    values (
      v_selected_coupon, v_coupon_eval.o_coupon_code, v_user, v_order, v_discount
    );

    -- 소비한 선택만 지운다. 주문 진행 중 다른 탭이 교체한 새 선택은 남는다.
    delete from public.cart_coupon_selections
    where user_id = v_user
      and user_coupon_id = v_selected_coupon;
  end if;

  update public.orders
  set total = v_subtotal + v_shipping_fee - v_discount,
      shipping_fee = v_shipping_fee,
      discount_total = v_discount
  where id = v_order;

  -- 무통장에는 결제사 왕복이 없다. 그래서 원장 anchor(payment_attempts)를 여기서
  -- 바로 연다 — 없으면 운영자가 입금을 확인할 대상 자체가 없고, "결제 준비" 버튼을
  -- 눌러야 생기는 구조는 구매자가 이미 이체한 뒤에도 확인이 안 되는 창을 만든다.
  -- 새 함수를 두지 않고 카드와 같은 prepare를 부른다: 소유권·금액·스냅샷·정지
  -- 계정 검사가 한 곳에만 있어야 한다.
  if p_payment_method = 'bank_transfer' then
    perform public.prepare_goods_payment_attempt(v_user, v_order, 'bank_transfer');
  end if;

  -- 무통장 주문은 만든 순간이 안내 시점이다. 금액·입금자명 코드·기한이 모두
  -- 정해졌고, 이 알림을 놓치면 구매자는 어디로 얼마를 보낼지 알 수 없다.
  if p_payment_method = 'bank_transfer' then
    insert into public.notifications (
      user_id, type, title, body, link_path, source_type, source_id, dedupe_key
    )
    values (
      v_user,
      'order_bank_transfer_pending',
      '입금 안내를 확인해주세요',
      format(
        '%s원을 기한 안에 입금해주세요. 입금자명 끝에 주문코드 %s를 붙이면 확인이 빨라집니다.',
        to_char(v_subtotal + v_shipping_fee - v_discount, 'FM999,999,999'),
        private.bank_transfer_deposit_code(v_order)
      ),
      '/checkout/' || v_order::text,
      'order',
      v_order::text,
      'order:bank_transfer_pending:' || v_order::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return v_order;
end;
$function$;
revoke all on function public.place_order(jsonb,uuid,public.order_payment_method) from public,anon,authenticated,service_role;

-- Staff receipts read the same immutable option snapshots.
create or replace function public.admin_order_detail(target_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not public.is_staff() then
  raise insufficient_privilege using message='staff_required';
 end if;
 select jsonb_build_object(
  'order',jsonb_build_object('id',o.id,'userId',o.user_id,'buyerName',p.nickname,'buyerEmail',p.email,
   'status',o.status,'total',o.total,'shippingFee',o.shipping_fee,'discountTotal',o.discount_total,
   'createdAt',o.created_at,'shippingCarrier',o.shipping_carrier,'trackingNumber',o.tracking_number,
   'address',jsonb_build_object('recipientName',o.address->>'recipientName','phone',o.address->>'phone',
    'postalCode',o.address->>'postalCode','address1',o.address->>'address1','address2',o.address->>'address2',
    'deliveryNote',o.address->>'deliveryNote')),
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.good_name_snapshot,
   'variantId',i.variant_id,'variantName',i.variant_name_snapshot,'variantCode',i.variant_code_snapshot,
   'type',i.good_type_snapshot,'qty',i.qty,'unitPrice',i.unit_price) order by i.id)
   from public.order_items i where i.order_id=o.id),'[]'::jsonb),
  'timeline',coalesce((
    select jsonb_agg(e.payload || jsonb_build_object('id',e.id,'occurredAt',e.at) order by e.at,e.id)
    from (
      select 'order:'||o.id id,o.created_at at,jsonb_build_object('source','order','action','created') payload
      union all
      select 'payment:'||p.id,p.created_at,jsonb_build_object('source','payment','action','recorded',
        'status',p.status,'amount',p.amount,'provider',p.provider)
      from public.payment_summaries p where p.purpose='order' and p.ref_id=o.id
      union all
      select 'refund:'||r.id,r.created_at,jsonb_build_object('source','refund','action','requested',
        'status',r.status,'amount',r.amount)
      from public.refunds r join public.payment_summaries p on p.id=r.payment_id
      where p.purpose='order' and p.ref_id=o.id
      union all
      select 'refund-completed:'||r.id,r.completed_at,jsonb_build_object('source','refund','action','completed',
        'status',r.status,'amount',r.amount)
      from public.refunds r join public.payment_summaries p on p.id=r.payment_id
      where p.purpose='order' and p.ref_id=o.id and r.completed_at is not null
      union all
      select 'audit:'||a.id,a.created_at,jsonb_build_object(
        'source',case when a.action='admin.order.note' then 'note'
          when a.action='admin.order.tracking_updated' then 'shipment'
          when a.action like 'admin.order.claim%' or a.action like '%cancellation%' then 'claim'
          else 'status' end,
        'action',a.action,'actorName',actor.nickname,
        'fromStatus',case when a.action='admin.order.status_updated' then a.diff->>'from' end,
        'toStatus',case when a.action='admin.order.status_updated' then a.diff->>'to' end,
        'carrier',case when a.action='admin.order.tracking_updated' then a.diff->>'toCarrier'
          when a.action='admin.order.status_updated' then a.diff->>'carrier' end,
        'trackingNumber',case when a.action='admin.order.tracking_updated' then a.diff->>'toTrackingNumber'
          when a.action='admin.order.status_updated' then a.diff->>'trackingNumber' end,
        'body',case when a.action='admin.order.note' then a.diff->>'body' end)
      from public.audit_log a left join public.profiles actor on actor.id=a.actor_id
      where a.target='order:'||o.id
      union all
      select 'shipped:'||o.id,o.shipped_at,jsonb_build_object('source','shipment','action','shipped',
        'carrier',o.shipping_carrier,'trackingNumber',o.tracking_number)
      where o.shipped_at is not null
      union all
      select 'delivered:'||o.id,o.delivered_at,jsonb_build_object('source','shipment','action','delivered')
      where o.delivered_at is not null
      union all
      select 'claim:'||c.id,c.requested_at,jsonb_build_object('source','claim','action','requested',
        'status',c.stage,'claimType',c.claim_type,'relatedId',c.id)
      from public.order_cancellation_requests c where c.order_id=o.id
      union all
      select 'inquiry:'||i.id,i.created_at,jsonb_build_object('source','inquiry','action','created',
        'status',i.status,'title',i.title,'relatedId',i.id)
      from public.inquiries i where i.order_id=o.id
      union all
      select 'email:'||m.id,coalesce(m.completed_at,m.created_at),jsonb_build_object('source','email',
        'action',m.template,'status',m.status)
      from public.email_deliveries m
      where m.dedupe_key in ('order_confirmation:'||o.id,'order_shipped:'||o.id)
        or exists(select 1 from public.inquiry_messages im join public.inquiries iq on iq.id=im.inquiry_id
          where iq.order_id=o.id and m.dedupe_key='inquiry_answered:'||im.id)
    ) e
  ),'[]'::jsonb)
 ) into result from public.orders o left join public.profiles p on p.id=o.user_id
 where o.id=target_order_id;
 return result;
end;
$$;
revoke all on function public.admin_order_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_detail(uuid) to authenticated;


-- Coupon selection and checkout must evaluate the same selected-option prices.
create or replace function private.cart_subtotal(p_user_id uuid)
returns bigint language sql stable set search_path='' as $$
  select coalesce(sum(cart.qty::bigint * variant.price::bigint),0)
  from public.cart_items cart
  join public.goods_variants variant on variant.id=cart.variant_id and variant.good_id=cart.good_id and variant.archived_at is null
  join public.goods good on good.id=cart.good_id and good.archived_at is null and good.published_at is not null and good.sale_restriction='none'
  join public.ips ip on ip.id=good.ip_id and ip.archived_at is null and ip.published_at is not null
  where cart.user_id=p_user_id;
$$;
revoke all on function private.cart_subtotal(uuid) from public,anon,authenticated,service_role;
