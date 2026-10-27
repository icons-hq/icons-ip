-- ==========================================================================
-- ICONS · 19금 굿즈 판매 개방 — 성인 인증이 노출·구매 경계를 연다
--
-- 20260901120000(#392)은 성인 상품('adult')을 스토어 전 표면에서 감추고 주문
-- 생성에서 무조건 막았다. 성인 인증(20261027170000, ADR-0024)이 생겼으므로 그
-- 무조건 차단을 "유효한 성인 인증이 있는 계정" 조건으로 바꾼다.
--
-- 이 마이그레이션이 DB 안에서 고정하는 것:
--   1. 판정은 private.good_sale_restriction_visible(유형, 계정) 하나다. 제한 없음은
--      누구에게나, 성인 상품은 private.adult_verification_valid(계정)인 계정에게만 보인다.
--      다른 제한 유형(추후)은 계속 닫힌다.
--   2. 구매 경로(장바구니 담기·상세의 담기·쿠폰 소계·견적·새 거래 계산·주문 생성)는
--      인증 성인만 성인 상품을 통과시킨다. 19금 굿즈는 추가 구성으로는 쓰지 않는다. 담기와 새 거래 계산은 일반 품절과 구분되는 오류
--      (adult_verification_required)로, 주문 생성은 'adult verification required:'로 알린다.
--   3. 상세 화면 RPC(가격·재고·판매 기간·미디어·고시·배송·혜택 등)는 인증 성인에게만
--      성인 상품 데이터를 돌려준다. 미인증 세션에는 지금처럼 비어 있다.
--   4. 검색·목록 외형·카테고리 전시는 인증 성인에게만 성인 상품을 포함한다. 미인증
--      방문자의 가림 카드는 DB가 아니라 앱이 카탈로그 행을 가려 만든다.
--   5. 옵션 행(goods_variants) 공개 읽기 RLS도 같은 판정이다. 인증 성인만 성인 상품의
--      옵션을 읽어 고르고 담을 수 있다.
--   6. 어드민 준비 상태에서 성인 상품은 더 이상 판매 차단 사유가 아니다(다른 제한 유형은 차단).
--   7. 홈 랭킹·큐레이션·쇼핑스토리·마케팅·리뷰 이벤트·선물·정기배송·추가상품·알림은
--      바꾸지 않는다 — 계속 'none'만 다룬다. 선물은 받는 사람이 성인인지 알 수 없다.
--
-- 판정 계정은 호출 맥락을 따른다. 로그인 세션이 부르는 함수는 auth.uid(), service role
-- 래퍼가 부르는 새 거래 계산은 p_actor, 쿠폰 소계는 p_user_id, 주문 생성은 래퍼가
-- 세운 v_user다. 함수 본문은 최신 정의의 사본이고, 바뀐 것은 판정 조건과 위 두 오류뿐이다.
--
-- 보안 경계는 여전히 2번이다. 목록·상세 노출은 쿼리 레이어이고 goods 테이블은 공개
-- 읽기라, 성인 상품 메타데이터의 Data API 노출 차단은 별도 후속(#210)이다.
-- ==========================================================================

create function private.good_sale_restriction_visible(
  p_restriction public.goods_sale_restriction,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_restriction = 'none'
    or (p_restriction = 'adult' and private.adult_verification_valid(p_user_id));
$function$;

comment on function private.good_sale_restriction_visible(public.goods_sale_restriction, uuid) is
  '판매 제한 상품을 이 계정에 보이거나 팔아도 되는가. 성인 상품은 유효한 성인 인증이 있어야 한다.';

-- 호출자는 모두 함수 소유자로 도는 security definer 본문이다. 브라우저 롤에는 열지 않는다.
revoke all on function private.good_sale_restriction_visible(public.goods_sale_restriction, uuid)
  from public, anon, authenticated, service_role;

-- RLS 정책은 조회하는 롤 권한으로 평가되고 anon에는 private 스키마 사용 권한이 없다.
-- 정책 전용으로 현재 세션(auth.uid())만 판정하는 공개 helper를 둔다. 돌려주는 것은
-- "지금 이 세션이 그 유형을 볼 수 있는가"뿐이라 다른 계정의 인증 여부는 드러나지 않는다.
create function public.good_sale_restriction_visible_to_viewer(p_restriction public.goods_sale_restriction)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.good_sale_restriction_visible(p_restriction, (select auth.uid()));
$function$;

revoke all on function public.good_sale_restriction_visible_to_viewer(public.goods_sale_restriction)
  from public, anon, authenticated, service_role;
grant execute on function public.good_sale_restriction_visible_to_viewer(public.goods_sale_restriction)
  to anon, authenticated;

-- 옵션 행 공개 읽기. 20260908020855 정책이 성인 상품의 옵션을 모두에게 감췄다 — 그대로
-- 두면 인증 성인도 옵션을 고르지 못해 담을 수 없다. 일반 상품 조건을 앞에 두어 기존
-- 행은 helper를 부르지 않고 통과한다.
drop policy goods_variants_public_read on public.goods_variants;
create policy goods_variants_public_read on public.goods_variants
  for select
  to anon, authenticated
  using (
    archived_at is null
    and exists (
      select 1
      from public.goods good
      join public.ips ip on ip.id = good.ip_id
      where good.id = goods_variants.good_id
        and good.archived_at is null
        and (
          good.sale_restriction = 'none'::public.goods_sale_restriction
          or public.good_sale_restriction_visible_to_viewer(good.sale_restriction)
        )
        and ip.archived_at is null
        and ip.published_at is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 구매 경로 — 장바구니 담기·쿠폰 소계·견적·주문
-- ---------------------------------------------------------------------------

-- private.set_cart_quantity_with_inputs
create or replace function private.set_cart_quantity_with_inputs(p_good_id text, p_variant_id uuid, p_qty integer, p_input_revision integer, p_input_values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); available_stock integer; other_qty bigint; key_value text; snapshot jsonb;
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.lock_goods_transaction_actor(actor);
  perform private.assert_active_user(actor);
  if nullif(btrim(p_good_id),'') is null or p_variant_id is null or p_qty is null or p_qty<0
    or p_input_revision is null or p_input_revision<0 or jsonb_typeof(p_input_values) is distinct from 'object' then
    raise invalid_parameter_value using message='invalid cart item';
  end if;
  key_value:=case when p_input_revision=0 and p_input_values='{}' then '' else md5(p_input_revision::text||':'||p_input_values::text) end;
  perform pg_advisory_xact_lock(hashtextextended('cart:'||actor::text,0));
  if exists(select 1 from public.cart_items where user_id=actor and variant_id=p_variant_id and input_key=key_value
    and (input_revision,input_values) is distinct from (p_input_revision,p_input_values)) then raise check_violation using message='cart_input_identity_conflict'; end if;
  -- Removing an obsolete definition must remain possible. A legacy call with
  -- empty inputs can only remove the legacy empty-input row, never custom rows.
  if p_qty=0 then
    delete from public.cart_items where user_id=actor and good_id=p_good_id and variant_id=p_variant_id and input_key=key_value;
    return;
  end if;
  -- 성인 상품은 유효한 성인 인증이 있어야 담긴다. 일반 품절·비공개와 구분되는 오류로
  -- 알려야 화면이 인증 안내로 보낼 수 있다(ADR-0024).
  if exists(select 1 from public.goods restricted where restricted.id=p_good_id and restricted.sale_restriction='adult'
    and not private.adult_verification_valid(actor)) then raise check_violation using message='adult_verification_required'; end if;
  snapshot:=private.resolve_goods_custom_inputs(p_good_id,p_input_revision,p_input_values);
  select supply.available_qty into available_stock from public.goods_variants variant
    join public.goods good on good.id=variant.good_id join public.ips ip on ip.id=good.ip_id
    cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
    where variant.id=p_variant_id and variant.good_id=p_good_id and variant.archived_at is null
      and good.published_at is not null and good.archived_at is null and private.good_sale_restriction_visible(good.sale_restriction,actor)
      and good.stock<>'soldout' and (good.allow_card_payment or good.allow_bank_transfer)
      and ip.published_at is not null and ip.archived_at is null;
  if not found then raise check_violation using message='catalog_item_unavailable'; end if;
  select coalesce(sum(qty::bigint),0) into other_qty from public.cart_items where user_id=actor and variant_id=p_variant_id and input_key<>key_value;
  if other_qty+p_qty>available_stock then raise check_violation using message='out of stock'; end if;
  insert into public.cart_items(user_id,good_id,variant_id,qty,input_revision,input_values,input_snapshot)
    values(actor,p_good_id,p_variant_id,p_qty,p_input_revision,p_input_values,snapshot)
    on conflict(user_id,variant_id,input_key) do update set qty=excluded.qty;
end $function$;

revoke all on function private.set_cart_quantity_with_inputs(p_good_id text, p_variant_id uuid, p_qty integer, p_input_revision integer, p_input_values jsonb)
  from public, anon, authenticated, service_role;

-- private.cart_subtotal
create or replace function private.cart_subtotal(p_user_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(sum(cart.qty::bigint * price.effective_price::bigint),0)
  from public.cart_items cart
  join public.goods_variants variant on variant.id=cart.variant_id and variant.good_id=cart.good_id and variant.archived_at is null
  join public.goods good on good.id=cart.good_id and good.archived_at is null and good.published_at is not null and private.good_sale_restriction_visible(good.sale_restriction,p_user_id)
  join public.ips ip on ip.id=good.ip_id and ip.archived_at is null and ip.published_at is not null
  cross join lateral private.resolve_goods_variant_price(variant.id,statement_timestamp()) price
  where cart.user_id=p_user_id;
$function$;

revoke all on function private.cart_subtotal(p_user_id uuid)
  from public, anon, authenticated, service_role;

-- private.goods_sales_conditions_core
create or replace function private.goods_sales_conditions_core(items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  input record;
  line record;
  good public.goods;
  quantity_policy public.goods;
  variant public.goods_variants;
  price record;
  normalized jsonb:='[]';
  quoted_lines jsonb:='[]';
  quoted_goods jsonb:='[]';
  at_time timestamptz:=statement_timestamp();
  actor uuid:=auth.uid();
  subtotal bigint:=0;
  card_allowed boolean:=true;
  bank_allowed boolean:=true;
  reserved_qty bigint;
  quantity_error text;
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>1000 then
    raise invalid_parameter_value using message='invalid_sales_quote_items';
  end if;
  for input in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(input.value) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(input.value) key where key not in ('goodId','variantId','qty'))
      or jsonb_typeof(input.value->'goodId') is distinct from 'string'
      or nullif(btrim(input.value->>'goodId'),'') is null
      or jsonb_typeof(input.value->'variantId') is distinct from 'string'
      or input.value->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(input.value->'qty') is distinct from 'number'
      or input.value->>'qty' !~ '^[1-9][0-9]*$' then
      raise invalid_parameter_value using message='invalid_sales_quote_items';
    end if;
    if (input.value->>'qty')::numeric>2147483647 then
      raise invalid_parameter_value using message='invalid_sales_quote_items';
    end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('good_id',input.value->>'goodId',
      'variant_id',(input.value->>'variantId')::uuid,'qty',(input.value->>'qty')::integer));
  end loop;
  for line in select good_id,variant_id,sum(qty::bigint)::bigint qty
    from jsonb_to_recordset(normalized) as item(good_id text,variant_id uuid,qty integer)
    group by good_id,variant_id order by good_id,variant_id
  loop
    select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
      where g.id=line.good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
        and ip.archived_at is null and ip.published_at is not null;
    if not found then raise check_violation using message='sales_quote_good_unavailable'; end if;
    select * into variant from public.goods_variants
      where id=line.variant_id and good_id=good.id and archived_at is null;
    if not found then raise check_violation using message='sales_quote_variant_unavailable'; end if;
    select * into price from private.resolve_goods_variant_price(variant.id,at_time);
    quoted_lines:=quoted_lines||jsonb_build_array(jsonb_build_object('goodId',good.id,'variantId',variant.id,'qty',line.qty,
      'regularPrice',price.regular_price,'effectivePrice',price.effective_price,'pricePeriodId',price.price_period_id,
      'startsAt',price.starts_at,'endsAt',price.ends_at,'available',good.stock<>'soldout' and line.qty<=variant.stock_qty));
    subtotal:=subtotal+line.qty*price.effective_price::bigint;
    card_allowed:=card_allowed and good.allow_card_payment;
    bank_allowed:=bank_allowed and good.allow_bank_transfer;
  end loop;
  for line in select good_id,sum(qty::bigint)::bigint qty
    from jsonb_to_recordset(normalized) as item(good_id text,variant_id uuid,qty integer)
    group by good_id order by good_id
  loop
    select * into good from public.goods where id=line.good_id;
    select * into quantity_policy from public.goods where id=private.goods_aggregation_owner(good.id);
    reserved_qty:=case when actor is null then null else private.member_goods_reserved_qty(actor,good.id) end;
    quantity_error:=private.check_goods_purchase_quantity(good,actor,(select sum(item.qty::bigint)::bigint from jsonb_to_recordset(normalized) item(good_id text,qty integer) where private.goods_aggregation_owner(item.good_id)=private.goods_aggregation_owner(good.id)),true);
    quoted_goods:=quoted_goods||jsonb_build_array(jsonb_build_object('goodId',good.id,'qty',line.qty,
      'orderQuantityLimitEnabled',quantity_policy.order_quantity_limit_enabled,'minOrderQty',quantity_policy.min_order_qty,'maxOrderQty',quantity_policy.max_order_qty,
      'memberPurchaseLimitEnabled',quantity_policy.member_purchase_limit_enabled,'memberLifetimeQtyLimit',quantity_policy.member_lifetime_qty_limit,
      'memberReservedQty',reserved_qty,'memberRemainingQty',case when not quantity_policy.member_purchase_limit_enabled or actor is null
        then null else greatest(0,quantity_policy.member_lifetime_qty_limit::bigint-reserved_qty) end,'reason',quantity_error));
  end loop;
  return jsonb_build_object('calculatedAt',at_time,'subtotal',subtotal,'lines',quoted_lines,'goods',quoted_goods,
    'nextChangeAt',(select min(boundary.change_at) from private.goods_variant_price_periods schedule
      cross join lateral (values(schedule.starts_at),(schedule.ends_at)) boundary(change_at)
      where schedule.state='active' and boundary.change_at>at_time
        and schedule.variant_id in (select (value->>'variant_id')::uuid from jsonb_array_elements(normalized))),
    'paymentMethods',jsonb_build_object('card',card_allowed and jsonb_array_length(normalized)>0,
      'bankTransfer',bank_allowed and jsonb_array_length(normalized)>0));
end $function$;

revoke all on function private.goods_sales_conditions_core(items jsonb)
  from public, anon, authenticated, service_role;

-- private.quote_goods_sales_before_preorder
create or replace function private.quote_goods_sales_before_preorder(items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  input record;
  line record;
  good public.goods;
  variant public.goods_variants;
  price record;
  normalized jsonb:='[]';
  quoted_lines jsonb:='[]';
  quoted_goods jsonb:='[]';
  at_time timestamptz:=statement_timestamp();
  actor uuid:=auth.uid();
  subtotal bigint:=0;
  card_allowed boolean:=true;
  bank_allowed boolean:=true;
  reserved_qty bigint;
  quantity_error text;
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>1000 then
    raise invalid_parameter_value using message='invalid_sales_quote_items';
  end if;
  for input in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(input.value) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(input.value) key where key not in ('goodId','variantId','qty'))
      or jsonb_typeof(input.value->'goodId') is distinct from 'string'
      or nullif(btrim(input.value->>'goodId'),'') is null
      or jsonb_typeof(input.value->'variantId') is distinct from 'string'
      or input.value->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(input.value->'qty') is distinct from 'number'
      or input.value->>'qty' !~ '^[1-9][0-9]*$' then
      raise invalid_parameter_value using message='invalid_sales_quote_items';
    end if;
    if (input.value->>'qty')::numeric>2147483647 then
      raise invalid_parameter_value using message='invalid_sales_quote_items';
    end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('good_id',input.value->>'goodId',
      'variant_id',(input.value->>'variantId')::uuid,'qty',(input.value->>'qty')::integer));
  end loop;
  for line in select good_id,variant_id,sum(qty::bigint)::bigint qty
    from jsonb_to_recordset(normalized) as item(good_id text,variant_id uuid,qty integer)
    group by good_id,variant_id order by good_id,variant_id
  loop
    select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
      where g.id=line.good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
        and ip.archived_at is null and ip.published_at is not null;
    if not found then raise check_violation using message='sales_quote_good_unavailable'; end if;
    select * into variant from public.goods_variants
      where id=line.variant_id and good_id=good.id and archived_at is null;
    if not found then raise check_violation using message='sales_quote_variant_unavailable'; end if;
    select * into price from private.resolve_goods_variant_price(variant.id,at_time);
    quoted_lines:=quoted_lines||jsonb_build_array(jsonb_build_object('goodId',good.id,'variantId',variant.id,'qty',line.qty,
      'regularPrice',price.regular_price,'effectivePrice',price.effective_price,'pricePeriodId',price.price_period_id,
      'startsAt',price.starts_at,'endsAt',price.ends_at,'available',good.stock<>'soldout' and line.qty<=variant.stock_qty));
    subtotal:=subtotal+line.qty*price.effective_price::bigint;
    card_allowed:=card_allowed and good.allow_card_payment;
    bank_allowed:=bank_allowed and good.allow_bank_transfer;
  end loop;
  for line in select good_id,sum(qty::bigint)::bigint qty
    from jsonb_to_recordset(normalized) as item(good_id text,variant_id uuid,qty integer)
    group by good_id order by good_id
  loop
    select * into good from public.goods where id=line.good_id;
    reserved_qty:=case when actor is null then null else private.member_goods_reserved_qty(actor,good.id) end;
    quantity_error:=private.check_goods_purchase_quantity(good,actor,line.qty,true);
    quoted_goods:=quoted_goods||jsonb_build_array(jsonb_build_object('goodId',good.id,'qty',line.qty,
      'orderQuantityLimitEnabled',good.order_quantity_limit_enabled,'minOrderQty',good.min_order_qty,'maxOrderQty',good.max_order_qty,
      'memberPurchaseLimitEnabled',good.member_purchase_limit_enabled,'memberLifetimeQtyLimit',good.member_lifetime_qty_limit,
      'memberReservedQty',reserved_qty,'memberRemainingQty',case when not good.member_purchase_limit_enabled or actor is null
        then null else greatest(0,good.member_lifetime_qty_limit::bigint-reserved_qty) end,'reason',quantity_error));
  end loop;
  return jsonb_build_object('calculatedAt',at_time,'subtotal',subtotal,'lines',quoted_lines,'goods',quoted_goods,
    'shipping',public.quote_goods_shipping(items),
    'coupon',private.quote_selected_coupon(quoted_lines,subtotal,(public.quote_goods_shipping(items)->>'totalFee')::bigint),
    'nextChangeAt',(select min(boundary.change_at) from private.goods_variant_price_periods schedule
      cross join lateral (values(schedule.starts_at),(schedule.ends_at)) boundary(change_at)
      where schedule.state='active' and boundary.change_at>at_time
        and schedule.variant_id in (select (value->>'variant_id')::uuid from jsonb_array_elements(normalized))),
    'paymentMethods',jsonb_build_object('card',card_allowed and jsonb_array_length(normalized)>0,
      'bankTransfer',bank_allowed and jsonb_array_length(normalized)>0));
end $function$;

revoke all on function private.quote_goods_sales_before_preorder(items jsonb)
  from public, anon, authenticated, service_role;

-- private.quote_goods_shipping_before_preorder
create or replace function private.quote_goods_shipping_before_preorder(items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input record; good public.goods; variant public.goods_variants; line_qty integer; variant_key uuid; lines jsonb:='[]';
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>1000 then
    raise invalid_parameter_value using message='invalid_shipping_quote_items';
  end if;
  for input in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(input.value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input.value) k where k not in ('goodId','variantId','qty'))
      or jsonb_typeof(input.value->'qty') is distinct from 'number'
      or jsonb_typeof(input.value->'variantId') is distinct from 'string'
      or (input.value->>'variantId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise invalid_parameter_value using message='invalid_shipping_quote_items'; end if;
    line_qty:=(input.value->>'qty')::integer;
    if line_qty not between 1 and 2147483647 then raise invalid_parameter_value using message='invalid_shipping_quote_items'; end if;
    select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
      join public.fulfillment_origins origin on origin.id=g.origin_id and origin.is_active
      where g.id=input.value->>'goodId' and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
        and ip.archived_at is null and ip.published_at is not null;
    if not found then raise check_violation using message='shipping_quote_good_unavailable'; end if;
    variant_key:=(input.value->>'variantId')::uuid;
    select v.* into variant from public.goods_variants v where v.good_id=good.id and v.archived_at is null
      and v.id=variant_key;
    if not found then raise check_violation using message='shipping_quote_variant_unavailable'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'qty',line_qty,
      'unit_price',(select effective_price from private.resolve_goods_variant_price(variant.id,statement_timestamp())),'fee_type',good.shipping_fee_type,'individual_fee',good.individual_fee));
  end loop;
  return private.calculate_goods_shipping(lines);
end $function$;

revoke all on function private.quote_goods_shipping_before_preorder(items jsonb)
  from public, anon, authenticated, service_role;

-- private.calculate_goods_transaction_locked
create or replace function private.calculate_goods_transaction_locked(p_actor uuid, p_selection jsonb, p_address jsonb, p_delivery_choices jsonb, p_user_coupon_id uuid, p_store_credit_amount bigint, p_at timestamp with time zone, p_line_ids jsonb, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare entry jsonb;index integer:=0;good public.goods;owner_row public.goods;variant public.goods_variants;price record;supply record;good_qty numeric;variant_qty numeric;
 custom_inputs jsonb;quantity_error text;priced_lines jsonb:='[]';shipping_lines jsonb:='[]';internal_lines jsonb:='[]';display_lines jsonb:='[]';policies jsonb;volume jsonb;
 discounted jsonb;line jsonb;shipping jsonb;coupon_eval record;coupon_data jsonb;coupon_lines jsonb;coupon_weights jsonb;credit_weights jsonb;
 coupon_allocations jsonb;credit_allocations jsonb;policy private.store_credit_policy;balance jsonb;available numeric;maximum numeric:=0;
 subtotal numeric;volume_total numeric;net numeric;coupon numeric:=0;credit numeric:=p_store_credit_amount;online numeric;customer numeric;
 next_change timestamptz;boundary timestamptz;card_allowed boolean:=true;bank_allowed boolean:=true;selected_policy jsonb;line_coupon numeric;line_credit numeric;
begin
 if p_at is null or not isfinite(p_at) or p_store_credit_amount is null or p_store_credit_amount not between 0 and 999999999999
  or jsonb_typeof(p_line_ids) is distinct from 'array' or jsonb_array_length(p_line_ids)<>jsonb_array_length(p_selection)
  or exists(select 1 from jsonb_array_elements(p_line_ids) id where jsonb_typeof(id) is distinct from 'string'
   or id#>>'{}'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  or (select count(distinct id) from jsonb_array_elements(p_line_ids) id)<>jsonb_array_length(p_line_ids) then
  raise invalid_parameter_value using message='invalid_transaction_calculation';end if;
 begin perform private.assert_goods_purchase_allowed(p_actor);
 exception when check_violation then
  if sqlerrm<>'goods_purchase_restricted' then raise;end if;
  return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','purchase_restricted','goodId',null)));
 end;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'goodId',v.good_id,'revision',v.revision,'status',v.status,'terms',v.terms,'draftValues',v.draft_values)),'[]')
  into policies from private.goods_transaction_configs c join private.goods_volume_discount_versions v on v.id=c.volume_version_id
  where c.good_id in(select private.goods_aggregation_owner(value->>'goodId') from jsonb_array_elements(p_selection));
 for entry in select value from jsonb_array_elements(p_selection) loop
  select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
   join public.goods owner_good on owner_good.id=private.goods_aggregation_owner(g.id)
   join public.fulfillment_origins origin on origin.id=owner_good.origin_id and origin.is_active
   where g.id=entry->>'goodId' and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,p_actor)
    and (g.sale_starts_at is null or g.sale_starts_at<=p_at) and (g.sale_ends_at is null or g.sale_ends_at>p_at)
    and ip.archived_at is null and ip.published_at is not null;
  if not found then
   if exists(select 1 from public.goods restricted where restricted.id=entry->>'goodId' and restricted.sale_restriction='adult'
     and not private.adult_verification_valid(p_actor)) then
    return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','adult_verification_required','goodId',entry->>'goodId')));
   end if;
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',entry->>'goodId')));
  end if;
  select * into owner_row from public.goods where id=private.goods_aggregation_owner(good.id);
  good.origin_id:=owner_row.origin_id;good.shipping_fee_type:=owner_row.shipping_fee_type;good.individual_fee:=owner_row.individual_fee;
  good.order_quantity_limit_enabled:=owner_row.order_quantity_limit_enabled;good.min_order_qty:=owner_row.min_order_qty;good.max_order_qty:=owner_row.max_order_qty;
  good.member_purchase_limit_enabled:=owner_row.member_purchase_limit_enabled;good.member_lifetime_qty_limit:=owner_row.member_lifetime_qty_limit;
  select * into variant from public.goods_variants where id=(entry->>'variantId')::uuid and good_id=good.id and archived_at is null;
  if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',good.id)));end if;
  select sum((value->>'qty')::numeric) into good_qty from jsonb_array_elements(p_selection) where private.goods_aggregation_owner(value->>'goodId')=owner_row.id;
  quantity_error:=private.check_goods_purchase_quantity(good,p_actor,good_qty::bigint,true);
  if quantity_error is not null then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','purchase_limit','goodId',good.id)));end if;
  begin custom_inputs:=private.resolve_goods_custom_inputs(good.id,(entry->>'inputRevision')::integer,entry->'inputValues');
  exception when check_violation or invalid_parameter_value then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','invalid_selection','goodId',good.id)));
  end;
  select * into supply from private.resolve_goods_variant_supply(variant.id,p_at);
  select sum((value->>'qty')::numeric) into variant_qty from jsonb_array_elements(p_selection) where value->>'variantId'=variant.id::text;
  if good.stock='soldout' or supply.available_qty<variant_qty or (supply.mode='preorder' and supply.state<>'open') then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',good.id)));end if;
  select * into price from private.resolve_goods_variant_price(variant.id,p_at);
  priced_lines:=priced_lines||jsonb_build_array(jsonb_build_object('lineId',p_line_ids->>index,'goodId',owner_row.id,'regularUnitPrice',price.regular_price,
   'unitPrice',price.effective_price,'qty',entry->'qty'));
  shipping_lines:=shipping_lines||jsonb_build_array(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'qty',entry->'qty',
   'unit_price',price.effective_price,'fee_type',good.shipping_fee_type,'individual_fee',good.individual_fee));
  select value into selected_policy from jsonb_array_elements(policies) where value->>'goodId'=owner_row.id;
  internal_lines:=internal_lines||jsonb_build_array(entry||jsonb_build_object('lineId',p_line_ids->>index,
   'goodName',good.name,'goodType',good.type,'goodIpId',good.ip_id,'originId',good.origin_id,'variantName',variant.name,
   'customInputsSnapshot',custom_inputs,'regularUnitPrice',price.regular_price,'unitPrice',price.effective_price,'pricePeriodId',price.price_period_id,
   'priceStartsAt',price.starts_at,'priceEndsAt',price.ends_at,'volumePolicySnapshot',selected_policy,
   'supplySource',supply.mode,'preorderPolicyId',supply.policy_id,'preorderPolicyRevision',supply.policy_revision,
   'preorderStartsAt',supply.starts_at,'preorderEndsAt',supply.ends_at,'preorderExpectedShipDate',supply.expected_ship_date,
   'fulfillmentTermsSnapshot',private.goods_fulfillment_selected_terms(good.id,p_delivery_choices->good.id),'productionTermsSnapshot',private.goods_production_terms(good.id),'salesPolicySnapshot',jsonb_build_object('version',2,'allowCardPayment',good.allow_card_payment,'allowBankTransfer',good.allow_bank_transfer,
    'orderQuantityLimitEnabled',good.order_quantity_limit_enabled,'minOrderQty',good.min_order_qty,'maxOrderQty',good.max_order_qty,
    'memberPurchaseLimitEnabled',good.member_purchase_limit_enabled,'memberLifetimeQtyLimit',good.member_lifetime_qty_limit,
    'saleStartsAt',good.sale_starts_at,'saleEndsAt',good.sale_ends_at,'salePeriodRevision',good.sale_period_revision)));
  select min(moment) into boundary from (
   select schedule.starts_at moment from private.goods_variant_price_periods schedule where schedule.variant_id=variant.id and schedule.state='active' and schedule.starts_at>p_at
   union all select schedule.ends_at from private.goods_variant_price_periods schedule where schedule.variant_id=variant.id and schedule.state='active' and schedule.ends_at>p_at
   union all select good.sale_starts_at where good.sale_starts_at>p_at union all select good.sale_ends_at where good.sale_ends_at>p_at
   union all select supply.next_change_at where supply.next_change_at>p_at) moments;
  next_change:=least(next_change,boundary);card_allowed:=card_allowed and good.allow_card_payment;bank_allowed:=bank_allowed and good.allow_bank_transfer;
  index:=index+1;
 end loop;
 if not card_allowed and not bank_allowed then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','payment_method_unavailable','goodId',null)));end if;
 volume:=private.calculate_goods_volume_discounts(priced_lines,policies,p_at);
 -- Restore actual selected IDs before coupon targeting, display and immutable order snapshots.
 select jsonb_agg(v.value||jsonb_build_object('goodId',i.value->>'goodId') order by v.ordinality) into discounted
  from jsonb_array_elements(volume->'lines') with ordinality v(value,ordinality)
  join jsonb_array_elements(internal_lines) i(value) on i.value->>'lineId'=v.value->>'lineId';
 volume:=jsonb_set(volume,'{lines}',discounted);
 subtotal:=(volume->>'subtotal')::numeric;volume_total:=(volume->>'volumeDiscountTotal')::numeric;net:=subtotal-volume_total;
 next_change:=least(next_change,(volume->>'nextChangeAt')::timestamptz);
 shipping:=private.calculate_goods_transaction_shipping(shipping_lines,jsonb_build_object('postalCode',p_address->>'postalCode','address1',p_address->>'address1'),p_delivery_choices,p_at);
 if shipping->>'state'='blocked' then return shipping;end if;
 next_change:=least(next_change,(shipping->>'nextChangeAt')::timestamptz);
 select jsonb_agg(jsonb_build_object('good_id',value->>'goodId','subtotal',(value->>'netSubtotal')::bigint)) into coupon_lines from jsonb_array_elements(volume->'lines');
 if p_user_coupon_id is not null then
  if exists(select 1 from public.user_coupons held join public.coupons c on c.code=held.coupon_code where held.id=p_user_coupon_id and c.benefit_kind='shipping') then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','coupon_unavailable','goodId',null)));end if;
  select * into coupon_eval from private.evaluate_coupon_target_lines_at(p_user_coupon_id,p_actor,coupon_lines,p_order_id,p_at);
  if coupon_eval.o_reason is not null then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','coupon_unavailable','goodId',null)));end if;
  coupon:=least(coupon_eval.o_discount,greatest(0,net+(shipping->>'prepaidFee')::numeric-1000));
  if coupon<=0 then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','coupon_unavailable','goodId',null)));end if;
  coupon_data:=jsonb_build_object('userCouponId',p_user_coupon_id,'couponCode',coupon_eval.o_coupon_code,'eligibleSubtotal',coupon_eval.o_eligible_subtotal,
   'discount',coupon,'termsSnapshot',coupon_eval.o_terms_snapshot||jsonb_build_object('calculationVersion',2,'eligibleNetSubtotal',coupon_eval.o_eligible_subtotal));
  select min(moment) into boundary from public.user_coupons held join public.coupons definition on definition.code=held.coupon_code
   cross join lateral(values(held.usable_from),(held.expires_at),(definition.starts_at),(definition.ends_at)) moments(moment)
   where held.id=p_user_coupon_id and moment>p_at;
  next_change:=least(next_change,boundary);
 end if;
 select jsonb_agg(jsonb_build_object('id',value->>'lineId','weight',case when p_user_coupon_id is null then 0
   when private.coupon_good_matches(coupon_data#>>'{termsSnapshot,goodsScope}',
    array(select jsonb_array_elements_text(coupon_data#>'{termsSnapshot,targetGoodIds}')),
    array(select jsonb_array_elements_text(coalesce(coupon_data#>'{termsSnapshot,targetCategoryIds}','[]'))::uuid),value->>'goodId')
   then (value->>'netSubtotal')::numeric else 0 end)) into coupon_weights from jsonb_array_elements(volume->'lines');
 coupon_allocations:=private.allocate_transaction_amount(coupon,coupon_weights);
 select * into policy from private.store_credit_policy where singleton;
 perform private.expire_store_credit_lots(p_actor,p_at);balance:=private.store_credit_balance(p_actor);available:=(balance->>'available')::numeric;
 if policy.enabled and (balance->>'debt')::numeric=0 then
  maximum:=least(policy.max_use,available,greatest(0,net-coupon),greatest(0,net+(shipping->>'prepaidFee')::numeric-coupon-1000));end if;
 if credit>0 and (credit<policy.min_use or credit>maximum) then
  return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','store_credit_unavailable','goodId',null)));end if;
 if credit>0 then
  select min(expires_at) into boundary from private.store_credit_lots where user_id=p_actor and available_amount>0 and expires_at>p_at and revoked_at is null;
  next_change:=least(next_change,boundary);
 end if;
 online:=net+(shipping->>'prepaidFee')::numeric-coupon-credit;customer:=online+(shipping->>'collectFee')::numeric;
 if online<1000 then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','below_minimum_payment','goodId',null)));end if;
 if customer>9007199254740991 or online>999999999999 then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','amount_overflow','goodId',null)));end if;
 select jsonb_agg(jsonb_build_object('id',value->>'lineId','weight',(value->>'netSubtotal')::numeric-(coupon_allocations->>(value->>'lineId'))::numeric))
  into credit_weights from jsonb_array_elements(volume->'lines');
 credit_allocations:=private.allocate_transaction_amount(credit,credit_weights);
 index:=0;
 for discounted in select value from jsonb_array_elements(volume->'lines') loop
  line:=internal_lines->index;line_coupon:=(coupon_allocations->>(line->>'lineId'))::numeric;line_credit:=(credit_allocations->>(line->>'lineId'))::numeric;
  line:=line||jsonb_build_object('subtotal',(discounted->>'unitPrice')::numeric*(discounted->>'qty')::numeric,
   'volumeUnitDiscount',discounted->'volumeUnitDiscount','volumeDiscountTotal',discounted->'volumeDiscountTotal','netSubtotal',discounted->'netSubtotal',
   'couponDiscount',line_coupon,'storeCreditDiscount',line_credit,'paidGoodsTotal',(discounted->>'netSubtotal')::numeric-line_coupon-line_credit,
   'volumePolicyId',discounted->'policyId');
  internal_lines:=jsonb_set(internal_lines,array[index::text],line);
  display_lines:=display_lines||jsonb_build_array(jsonb_build_object('lineId',line->'lineId','goodId',line->'goodId','variantId',line->'variantId','qty',line->'qty',
   'regularUnitPrice',line->'regularUnitPrice','unitPrice',line->'unitPrice','volumeUnitDiscount',line->'volumeUnitDiscount','subtotal',line->'subtotal',
   'volumeDiscountTotal',line->'volumeDiscountTotal','netSubtotal',line->'netSubtotal','couponDiscount',line->'couponDiscount',
   'storeCreditDiscount',line->'storeCreditDiscount','paidGoodsTotal',line->'paidGoodsTotal','volumePolicyId',line->'volumePolicyId','production',line->'productionTermsSnapshot','fulfillment',line->'fulfillmentTermsSnapshot'));
  index:=index+1;
 end loop;
 return jsonb_build_object('state','calculated','display',jsonb_build_object('calculationVersion',2,'currency','KRW','calculatedAt',p_at,'nextChangeAt',next_change,
  'lines',display_lines,'shipping',shipping->'displayGroups','totals',jsonb_build_object('subtotal',subtotal,'volumeDiscountTotal',volume_total,'netGoodsTotal',net,
   'couponDiscountTotal',coupon,'storeCreditTotal',credit,'prepaidShippingTotal',shipping->'prepaidFee','collectShippingTotal',shipping->'collectFee','onlineTotal',online,'customerTotal',customer),
  'userCouponId',p_user_coupon_id,'storeCreditMaximum',maximum,'paymentMethods',jsonb_build_object('card',card_allowed,'bankTransfer',bank_allowed)),
  'lines',internal_lines,'shippingRaw',shipping->'rawGroups','coupon',coupon_data,'creditPolicy',case when policy.enabled then private.store_credit_policy_for_member(p_actor)-'evidence' else null end);
exception when numeric_value_out_of_range then
 return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','amount_overflow','goodId',null)));
end $function$;

revoke all on function private.calculate_goods_transaction_locked(p_actor uuid, p_selection jsonb, p_address jsonb, p_delivery_choices jsonb, p_user_coupon_id uuid, p_store_credit_amount bigint, p_at timestamp with time zone, p_line_ids jsonb, p_order_id uuid)
  from public, anon, authenticated, service_role;

-- private.place_order_before_shipments
-- 본문 전체를 다시 쓰지 않는다. 20261027120000_cart_retained_until_payment가 이 함수를 현재 정의의
-- 앵커 치환으로 고쳤다 — 여기서도 현재 정의에서 판매 제한 검사 한 곳만 바꿔 두 변경이 함께 남게 한다.
-- 앵커가 정확히 한 번이 아니면 실패한다(조용히 덮어쓰지 않는다).
do $$
declare
  v_definition text;
  v_anchor constant text := E'    -- 성인인증(#209·#210)이 도입되기 전까지 판매 제한 상품은 서버가 구매를\n'
    || E'    -- 차단한다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개로 판정한다.\n'
    || E'    if r.sale_restriction <> ''none'' then\n';
begin
  v_definition := pg_catalog.pg_get_functiondef('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure);
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'adult_goods_place_order_anchor_changed';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor,
    E'    -- 성인 상품은 유효한 성인 인증(ADR-0024)이 있는 계정만 주문한다. 그 밖의 판매\n'
    || E'    -- 제한 유형은 계속 막는다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개다.\n'
    || E'    if r.sale_restriction = ''adult'' and not private.adult_verification_valid(v_user) then\n'
    || E'      raise check_violation using message = format(''adult verification required: %s'', r.good_id);\n'
    || E'    elsif r.sale_restriction not in (''none'', ''adult'') then\n');
end;
$$;

revoke all on function private.place_order_before_shipments(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 상세 화면 — 가격·재고·판매 기간과 상세 구성 RPC
-- ---------------------------------------------------------------------------

-- public.goods_variant_pricing
create or replace function public.goods_variant_pricing(target_variant goods_variants)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('regularPrice',price.regular_price,'effectivePrice',price.effective_price,
    'pricePeriodId',price.price_period_id,'startsAt',price.starts_at,'endsAt',price.ends_at,
    'calculatedAt',statement_timestamp(),'nextChangeAt',(
      select min(boundary.change_at) from private.goods_variant_price_periods schedule
      cross join lateral (values(schedule.starts_at),(schedule.ends_at)) boundary(change_at)
      where schedule.variant_id=variant.id and schedule.state='active' and boundary.change_at>statement_timestamp()
    ))
  from public.goods_variants variant
  join public.goods good on good.id=variant.good_id
  join public.ips ip on ip.id=good.ip_id
  cross join lateral private.resolve_goods_variant_price(variant.id,statement_timestamp()) price
  where variant.id=target_variant.id and (public.has_operator_capability('catalog.read',false) or (
    variant.archived_at is null and good.archived_at is null and good.published_at is not null
    and private.good_sale_restriction_visible(good.sale_restriction,(select auth.uid())) and ip.archived_at is null and ip.published_at is not null
  ));
$function$;

revoke all on function public.goods_variant_pricing(target_variant goods_variants)
  from public, anon, authenticated, service_role;
grant execute on function public.goods_variant_pricing(target_variant goods_variants)
  to anon, authenticated;

-- public.goods_variant_supply
create or replace function public.goods_variant_supply(variant goods_variants)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('mode',supply.mode,'availableQty',supply.available_qty,'policyId',supply.policy_id,
    'policyRevision',supply.policy_revision,'state',supply.state,'startsAt',supply.starts_at,'endsAt',supply.ends_at,
    'expectedShipDate',supply.expected_ship_date,'calculatedAt',statement_timestamp(),'nextChangeAt',supply.next_change_at)
  from public.goods_variants current_variant join public.goods good on good.id=current_variant.good_id join public.ips ip on ip.id=good.ip_id
    cross join lateral private.resolve_goods_variant_supply(current_variant.id,statement_timestamp()) supply
  where current_variant.id=variant.id and current_variant.archived_at is null and good.published_at is not null and good.archived_at is null
    and private.good_sale_restriction_visible(good.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null;
$function$;

revoke all on function public.goods_variant_supply(variant goods_variants)
  from public, anon, authenticated, service_role;
grant execute on function public.goods_variant_supply(variant goods_variants)
  to anon, authenticated;

-- public.goods_sale_period
create or replace function public.goods_sale_period(good goods)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.goods_sale_period_json(current_good,statement_timestamp())
 from public.goods current_good join public.ips ip on ip.id=current_good.ip_id
 where current_good.id=good.id and current_good.published_at is not null and current_good.archived_at is null
  and private.good_sale_restriction_visible(current_good.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null;
$function$;

revoke all on function public.goods_sale_period(good goods)
  from public, anon, authenticated, service_role;
grant execute on function public.goods_sale_period(good goods)
  to anon, authenticated;

-- public.get_product_detail_presentation
create or replace function public.get_product_detail_presentation(p_good_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_good public.goods%rowtype; banner_config jsonb; modules jsonb; banner jsonb:=null; reviews jsonb:=null;
 recommendations jsonb:='{"similar":[],"together":[],"categoryPopular":[],"storePopular":[]}';
 starts_at timestamptz; ends_at timestamptz; next_change timestamptz; target_matches boolean:=false;
 today timestamptz:=date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
 select g.* into current_good from public.goods g join public.ips ip on ip.id=g.ip_id
 where g.id=p_good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
  and ip.archived_at is null and ip.published_at is not null;
 if not found then return null;end if;
 select values into banner_config from private.product_detail_settings where section='banner';
 select values into modules from private.product_detail_settings where section='modules';
 if (banner_config->>'enabled')::boolean then
  target_matches:=banner_config->>'targetType'='all' or (banner_config->>'targetType'='goods'
   and exists(select 1 from private.product_detail_banner_goods where good_id=p_good_id));
  if banner_config->>'targetType'='categories' then
   with recursive public_categories as materialized (select * from public.get_catalog_categories()),
   descendants as (
    select c.id from public_categories c join private.product_detail_banner_categories selected on selected.category_id=c.id
    union select c.id from public_categories c join descendants parent on c.parent_id=parent.id
   ) select exists(select 1 from descendants c where c.id=current_good.category_id
    or exists(select 1 from public.goods_additional_categories a where a.good_id=p_good_id and a.category_id=c.id)) into target_matches;
  end if;
  if (banner_config->>'periodEnabled')::boolean then
   starts_at:=(banner_config->>'startsOn')::date::timestamp at time zone 'Asia/Seoul';
   ends_at:=((banner_config->>'endsOn')::date+1)::timestamp at time zone 'Asia/Seoul';
   if target_matches then select min(moment) into next_change from unnest(array[starts_at,ends_at]) moment where moment>statement_timestamp();end if;
  end if;
  if target_matches and (starts_at is null or starts_at<=statement_timestamp()) and (ends_at is null or ends_at>statement_timestamp()) then
   banner:=jsonb_build_object('style',banner_config->>'style','title',banner_config->>'title','text',banner_config->>'text');
  end if;
 end if;
 if (modules->>'reviewSummary')::boolean then
  select jsonb_build_object('count',count(*),'positiveCount',count(*) filter(where rating>=4),
   'cards',coalesce((select jsonb_agg(card order by has_photo desc,rating desc,created_at desc,id) from (
    select r.id,r.rating,r.created_at,cardinality(r.image_paths)>0 has_photo,
     jsonb_build_object('id',r.id,'rating',r.rating,'body',r.body,'authorName',coalesce(nullif(btrim(p.nickname),''),'구매자'),
      'createdAt',r.created_at,'imagePaths',coalesce(to_jsonb(r.image_paths),'[]'::jsonb)) card
    from public.reviews r left join public.public_profiles p on p.id=r.user_id
    where r.good_id=p_good_id and r.status='visible' and r.rating>=4
    order by cardinality(r.image_paths)>0 desc,r.rating desc,r.created_at desc,r.id limit 10
   ) selected),'[]'::jsonb)) into reviews from public.reviews where good_id=p_good_id and status='visible';
 end if;
 if (modules->>'similar')::boolean or (modules->>'together')::boolean or (modules->>'categoryPopular')::boolean or (modules->>'storePopular')::boolean then
  with eligible as materialized (
   select g.id,g.ip_id,g.category_id,g.created_at from public.goods g join public.ips ip on ip.id=g.ip_id
   where g.id<>p_good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
    and ip.archived_at is null and ip.published_at is not null
  ), category as (
   select c.id from public.get_catalog_categories() c where c.id=current_good.category_id and c.depth>=2
    and not exists(select 1 from public.catalog_categories child where child.parent_id=c.id and child.archived_at is null)
  ), paid as materialized (
   select * from private.product_detail_paid_orders(today-interval '30 days',today)
   where (modules->>'together')::boolean or (modules->>'categoryPopular')::boolean or (modules->>'storePopular')::boolean
  ), quantities as (
   select item.good_id,sum(item.qty::bigint) qty from paid join public.order_items item on item.order_id=paid.id
   join eligible e on e.id=item.good_id group by item.good_id
  ), wishes as (
   select w.good_id,count(*) qty from public.wishlists w join eligible e on e.id=w.good_id group by w.good_id
  ), popular as (
   select e.*,coalesce(q.qty,0) sale_qty,coalesce(w.qty,0) wish_qty from eligible e
   left join quantities q on q.good_id=e.id left join wishes w on w.good_id=e.id
   where coalesce(q.qty,0)>0 or coalesce(w.qty,0)>0
  ), together as (
   select item.good_id,count(distinct paid.id) co_orders,sum(item.qty::bigint) qty
   from paid join public.order_items item on item.order_id=paid.id join eligible e on e.id=item.good_id
   where exists(select 1 from public.order_items source where source.order_id=paid.id and source.good_id=p_good_id)
   group by item.good_id
  ), similar_ids as (
   select e.id from eligible e where (modules->>'similar')::boolean and (e.category_id in(select id from category) or e.ip_id=current_good.ip_id)
   order by coalesce(e.category_id in(select id from category),false) desc,e.created_at desc,e.id limit 30
  ), together_ids as (
   select good_id id from together where (modules->>'together')::boolean order by co_orders desc,qty desc,good_id limit 30
  ), category_ids as (
   select id from popular where (modules->>'categoryPopular')::boolean and category_id in(select id from category)
   order by sale_qty desc,wish_qty desc,created_at desc,id limit 12
  ), store_ids as (
   select id from popular where (modules->>'storePopular')::boolean order by sale_qty desc,wish_qty desc,created_at desc,id limit 12
  ) select jsonb_build_object(
   'similar',case when (select count(*) from similar_ids)>=5 then (select jsonb_agg(id) from similar_ids) else '[]'::jsonb end,
   'together',case when (select count(*) from together_ids)>=5 then (select jsonb_agg(id) from together_ids) else '[]'::jsonb end,
   'categoryPopular',coalesce((select jsonb_agg(id) from category_ids),'[]'::jsonb),
   'storePopular',coalesce((select jsonb_agg(id) from store_ids),'[]'::jsonb)) into recommendations;
  next_change:=least(next_change,today+interval '1 day');
 end if;
 return jsonb_build_object('banner',banner,'reviews',reviews,'recommendations',recommendations,'nextChangeAt',next_change);
end $function$;

revoke all on function public.get_product_detail_presentation(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_product_detail_presentation(p_good_id text)
  to anon, authenticated;

-- public.get_product_detail_experience
create or replace function public.get_product_detail_experience(p_good_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_good public.goods%rowtype; config jsonb; messages jsonb:='[]'; window_row record; customer_count bigint; sale_rank bigint;
 at_time timestamptz:=statement_timestamp(); today timestamptz:=date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
 next_change timestamptz;
begin
 select g.* into current_good from public.goods g join public.ips ip on ip.id=g.ip_id
 where g.id=p_good_id and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
  and ip.published_at is not null and ip.archived_at is null;
 if not found then return null;end if;
 select values into config from private.product_detail_experience_settings where section='messages';
 if (config->>'buyers')::boolean then
  for window_row in select * from (values
   (1,'today',today),(2,'week',today-interval '6 days'),(3,'sixMonths',today-interval '6 months'),
   (4,'year',today-interval '1 year'),(5,'twoYears',today-interval '2 years')
  ) periods(position,key,starts_at) where key<>'twoYears' or (config->>'twoYears')::boolean order by position loop
   select count(distinct o.user_id) into customer_count from private.product_detail_paid_orders(window_row.starts_at,at_time) paid
    join public.orders o on o.id=paid.id where exists(select 1 from public.order_items i where i.order_id=o.id and i.good_id=p_good_id);
   if customer_count >= (case when window_row.key='twoYears' then 1 else (config->>'minBuyers')::integer end) then
    messages:=messages||jsonb_build_array(jsonb_build_object('kind','buyers','window',window_row.key,'count',customer_count));exit;
   end if;
  end loop;
 end if;
 if (config->>'repeatBuyers')::boolean then
  for window_row in select * from (values
   (1,'threeMonths',today-interval '3 months'),(2,'sixMonths',today-interval '6 months'),(3,'year',today-interval '1 year')
  ) periods(position,key,starts_at) order by position loop
   select count(*) into customer_count from (
    select o.user_id from private.product_detail_paid_orders(window_row.starts_at,at_time) paid
     join public.orders o on o.id=paid.id where exists(select 1 from public.order_items i where i.order_id=o.id and i.good_id=p_good_id)
     group by o.user_id having count(distinct o.id)>=2
   ) repeated;
   if customer_count >= (config->>'minRepeatBuyers')::integer then
    messages:=messages||jsonb_build_array(jsonb_build_object('kind','repeatBuyers','window',window_row.key,'count',customer_count));exit;
   end if;
  end loop;
 end if;
 if (config->>'bestSeller')::boolean then
  with sales as (
   select item.good_id,sum(item.qty::bigint) quantity from private.product_detail_paid_orders(today-interval '3 days',today) paid
    join public.order_items item on item.order_id=paid.id join public.goods g on g.id=item.good_id join public.ips ip on ip.id=g.ip_id
   where g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
    and ip.published_at is not null and ip.archived_at is null group by item.good_id
  ), ranked as (select good_id,row_number() over(order by quantity desc,good_id) rank from sales where quantity>0)
  select rank into sale_rank from ranked where good_id=p_good_id and rank<=10;
  if sale_rank is not null then messages:=messages||jsonb_build_array(jsonb_build_object('kind','bestSeller','rank',sale_rank));end if;
 end if;
 if (config->>'newProduct')::boolean and current_good.created_at<=at_time and current_good.created_at>at_time-interval '7 days' then
  messages:=messages||jsonb_build_array(jsonb_build_object('kind','newProduct'));
  next_change:=current_good.created_at+interval '7 days';
 end if;
 if (config->>'buyers')::boolean or (config->>'repeatBuyers')::boolean or (config->>'bestSeller')::boolean then next_change:=least(next_change,today+interval '1 day');end if;
 return jsonb_build_object('messages',messages,'discovery',public.get_product_detail_experience_config(),'nextChangeAt',next_change);
end $function$;

revoke all on function public.get_product_detail_experience(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_product_detail_experience(p_good_id text)
  to anon, authenticated;

-- public.get_good_media
create or replace function public.get_good_media(p_good_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('settings',public.get_goods_media_settings(),'video',private.goods_media_asset_json(b.video_asset_id,b.video_title),'shortclip',private.goods_media_asset_json(b.shortclip_asset_id,b.shortclip_title))
 from public.goods g join public.ips ip on ip.id=g.ip_id left join private.goods_media_bindings b on b.good_id=g.id
 where g.id=p_good_id and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null;
$function$;

revoke all on function public.get_good_media(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_good_media(p_good_id text)
  to anon, authenticated;

-- public.get_good_attribute_rows
create or replace function public.get_good_attribute_rows(p_good_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare fields jsonb; entries jsonb; field jsonb; entry jsonb; label text; result jsonb:='[]';
begin
  select schema.fields,vals.entries into fields,entries from public.goods g join public.ips ip on ip.id=g.ip_id
    join public.catalog_category_attribute_schemas schema on schema.category_id=g.category_id
    join public.goods_attribute_values vals on vals.good_id=g.id
    where g.id=p_good_id and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null;
  if fields is null then return result; end if;
  for field in select value from jsonb_array_elements(fields) loop
    select e into entry from jsonb_array_elements(entries) e where e#>>'{field,id}'=field->>'id'
      and e#>>'{field,kind}'=field->>'kind' and e#>>'{field,unit}'=field->>'unit' and private.goods_attribute_value_valid(field,e->'value');
    if entry is null then continue; end if;
    if field->>'kind'='single' then select opt->>'label' into label from jsonb_array_elements(field->'options') opt where opt->'id'=entry->'value';
    elsif field->>'kind'='multi' then select string_agg(opt->>'label',', ' order by v.ordinality) into label
      from jsonb_array_elements(entry->'value') with ordinality v(value,ordinality) join jsonb_array_elements(field->'options') opt on opt->'id'=v.value;
    else label:=(entry->'value'#>>'{}')||case when field->>'unit'<>'' then ' '||(field->>'unit') else '' end; end if;
    result:=result||jsonb_build_array(jsonb_build_object('id',field->>'id','name',field->>'name','value',label));
  end loop;
  return result;
end $function$;

revoke all on function public.get_good_attribute_rows(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_good_attribute_rows(p_good_id text)
  to anon, authenticated;

-- public.get_good_size_chart
create or replace function public.get_good_size_chart(p_good_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select s.chart from private.goods_size_charts s join public.goods g on g.id=s.good_id join public.ips i on i.id=g.ip_id
 where s.enabled and g.id=p_good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
  and i.archived_at is null and i.published_at is not null;
$function$;

revoke all on function public.get_good_size_chart(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_good_size_chart(p_good_id text)
  to anon, authenticated;

-- public.get_good_after_sales_content
create or replace function public.get_good_after_sales_content(p_good_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('phone',a.phone,'guide',a.guide,'sellerSpecialNotes',a.seller_special_notes)
 from private.goods_after_sales_content a join public.goods g on g.id=a.good_id join public.ips i on i.id=g.ip_id
 where a.phone<>'' and g.id=p_good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
 and i.archived_at is null and i.published_at is not null;
$function$;

revoke all on function public.get_good_after_sales_content(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_good_after_sales_content(p_good_id text)
  to anon, authenticated;

-- public.get_good_benefit_content
create or replace function public.get_good_benefit_content(p_good_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('eventText',b.event_text,'giftText',b.gift_text,'giftImagePaths',b.gift_image_paths)
 from private.goods_benefit_content b join public.goods g on g.id=b.good_id join public.ips i on i.id=g.ip_id
 where g.id=p_good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
 and i.archived_at is null and i.published_at is not null;
$function$;

revoke all on function public.get_good_benefit_content(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_good_benefit_content(p_good_id text)
  to anon, authenticated;

-- public.get_good_announcements
create or replace function public.get_good_announcements(p_good_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with eligible as materialized (
  select n.*,n.important and (n.important_starts_at is null or n.important_starts_at<=statement_timestamp())
    and (n.important_ends_at is null or n.important_ends_at>statement_timestamp()) as effective_important,
   greatest(n.starts_at,n.important_starts_at) as importance_starts,least(n.ends_at,n.important_ends_at) as importance_ends
  from public.goods_announcements n where n.enabled
   and exists(select 1 from public.goods g join public.ips ip on ip.id=g.ip_id where g.id=p_good_id
    and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.archived_at is null and ip.published_at is not null)
   and (n.all_goods or exists(select 1 from public.goods_announcement_goods links where links.announcement_id=n.id and links.good_id=p_good_id))
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'format',body_format,
   'category',category,'device',device,'important',effective_important) order by effective_important desc,updated_at desc,id)
  from eligible where (starts_at is null or starts_at<=statement_timestamp()) and (ends_at is null or ends_at>statement_timestamp())),'[]'),
  'nextChangeAt',(select min(at) from eligible cross join lateral(values(starts_at),(ends_at),
   (case when important and coalesce(importance_starts,'-infinity')<coalesce(importance_ends,'infinity') then importance_starts end),
   (case when important and coalesce(importance_starts,'-infinity')<coalesce(importance_ends,'infinity') then importance_ends end))boundary(at)
   where at>statement_timestamp() and isfinite(at)));
$function$;

revoke all on function public.get_good_announcements(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_good_announcements(p_good_id text)
  to anon, authenticated;

-- public.get_good_shipping_policy
create or replace function public.get_good_shipping_policy(target_good_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'originId', origin.id,
    'originName', origin.name,
    'returnAddress', origin.return_address,
    'baseFee', origin.base_fee,
    'freeThreshold', origin.free_threshold,
    'feeType', policy_good.shipping_fee_type,
    'individualFee', policy_good.individual_fee,
    'shippingNoticeTemplateId', good.shipping_notice_template_id,
    'shippingNoticeTemplateVersion', good.shipping_notice_template_version,
    'shippingNotice', coalesce(good.shipping_notice_snapshot->>'shippingNotice', ''),
    'returnExchangeNotice', coalesce(good.shipping_notice_snapshot->>'returnExchangeNotice', ''),
    'cs', jsonb_build_object(
      'name', coalesce(good.shipping_notice_snapshot->>'csName', ''),
      'phone', coalesce(good.shipping_notice_snapshot->>'csPhone', ''),
      'email', coalesce(good.shipping_notice_snapshot->>'csEmail', '')
    ),
    'claimPolicy', jsonb_build_object(
      'returnAllowed', good.claim_return_allowed,
      'exchangeAllowed', good.claim_exchange_allowed,
      'restrictionReason', good.claim_restriction_reason,
      'returnFee', good.claim_return_fee,
      'returnFreeShippingFee', good.claim_return_free_shipping_fee,
      'exchangeFee', good.claim_exchange_fee
    )
  )
  from public.goods good
  join public.ips ip on ip.id = good.ip_id
  join public.goods policy_good on policy_good.id = private.goods_aggregation_owner(good.id)
  join public.fulfillment_origins origin on origin.id = policy_good.origin_id and origin.is_active
  where good.id = target_good_id and good.archived_at is null and good.published_at is not null
    and private.good_sale_restriction_visible(good.sale_restriction,(select auth.uid()))
    and ip.archived_at is null and ip.published_at is not null;
$function$;

revoke all on function public.get_good_shipping_policy(target_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_good_shipping_policy(target_good_id text)
  to anon, authenticated;

-- public.get_product_shipping_savings
create or replace function public.get_product_shipping_savings(p_good_id text, p_variant_id uuid, p_qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_good public.goods%rowtype; candidate record; base_items jsonb; other_items jsonb; base_quote jsonb; other_quote jsonb; combined_quote jsonb;
 rows jsonb:='[]'; separate_fee bigint; combined_fee bigint; result jsonb; next_change timestamptz;
begin
 if p_good_id is null or p_variant_id is null or p_qty is null or p_qty not between 1 and 1000 then raise invalid_parameter_value using message='invalid_shipping_savings_selection';end if;
 if not (public.get_product_detail_experience_config()->>'shippingSavings')::boolean then return jsonb_build_object('items','[]'::jsonb,'nextChangeAt',null);end if;
 select g.* into current_good from public.goods g join public.ips ip on ip.id=g.ip_id join public.goods policy on policy.id=private.goods_aggregation_owner(g.id)
 where g.id=p_good_id and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
  and ip.published_at is not null and ip.archived_at is null;
 if not found then return null;end if;
 base_items:=jsonb_build_array(jsonb_build_object('goodId',p_good_id,'variantId',p_variant_id,'qty',p_qty));
 base_quote:=private.shipping_savings_sales_quote(base_items);
 if exists(select 1 from jsonb_array_elements(base_quote->'lines') l where not (l->>'available')::boolean)
  or exists(select 1 from jsonb_array_elements(base_quote->'goods') g where g->'reason'<>'null'::jsonb) then
  return jsonb_build_object('items','[]'::jsonb,'selectionUnavailable',true,'nextChangeAt',base_quote->'nextChangeAt');end if;
 next_change:=(base_quote->>'nextChangeAt')::timestamptz;
 for candidate in
  select g.id,chosen.id variant_id,chosen.name variant_name,case when policy.order_quantity_limit_enabled then policy.min_order_qty else 1 end qty
  from public.goods g join public.ips ip on ip.id=g.ip_id join public.goods policy on policy.id=private.goods_aggregation_owner(g.id)
  join lateral (
   select v.id,v.name from public.goods_variants v cross join lateral private.resolve_goods_variant_supply(v.id,statement_timestamp()) supply
    cross join lateral private.resolve_goods_variant_price(v.id,statement_timestamp()) pricing
   where v.good_id=g.id and v.archived_at is null and (supply.available_qty is null or supply.available_qty>=case when policy.order_quantity_limit_enabled then policy.min_order_qty else 1 end)
   order by v.is_default desc,pricing.effective_price,v.id limit 1
  ) chosen on true
  where g.id<>p_good_id and policy.origin_id=(select origin_id from public.goods where id=private.goods_aggregation_owner(current_good.id)) and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
   and ip.published_at is not null and ip.archived_at is null and (not policy.order_quantity_limit_enabled or policy.min_order_qty between 1 and 1000)
  order by md5(g.id||(statement_timestamp() at time zone 'Asia/Seoul')::date::text),g.id limit 50
 loop
  other_items:=jsonb_build_array(jsonb_build_object('goodId',candidate.id,'variantId',candidate.variant_id,'qty',candidate.qty));
  begin
   other_quote:=private.shipping_savings_sales_quote(other_items);combined_quote:=private.shipping_savings_sales_quote(base_items||other_items);
  exception when check_violation or no_data_found then continue;end;
  if exists(select 1 from jsonb_array_elements(combined_quote->'lines') l where not (l->>'available')::boolean)
   or exists(select 1 from jsonb_array_elements(combined_quote->'goods') g where g->'reason'<>'null'::jsonb) then continue;end if;
  separate_fee:=(base_quote#>>'{shipping,totalFee}')::bigint+(other_quote#>>'{shipping,totalFee}')::bigint;
  combined_fee:=(combined_quote#>>'{shipping,totalFee}')::bigint;
  if combined_fee<separate_fee then
   rows:=rows||jsonb_build_array(jsonb_build_object('goodId',candidate.id,'variantId',candidate.variant_id,'variantName',candidate.variant_name,'qty',candidate.qty,
    'separateFee',separate_fee,'combinedFee',combined_fee,'savings',separate_fee-combined_fee));
   next_change:=least(next_change,(combined_quote->>'nextChangeAt')::timestamptz);
  end if;
  exit when jsonb_array_length(rows)>=12;
 end loop;
 result:=jsonb_build_object('items',rows,'nextChangeAt',next_change,'calculatedAt',statement_timestamp());
 return result;
end $function$;

revoke all on function public.get_product_shipping_savings(p_good_id text, p_variant_id uuid, p_qty integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_product_shipping_savings(p_good_id text, p_variant_id uuid, p_qty integer)
  to anon, authenticated;

-- public.get_goods_transaction_offers
create or replace function public.get_goods_transaction_offers(p_good_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare result jsonb;begin
 if p_good_ids is null or cardinality(p_good_ids)>1000 or array_position(p_good_ids,null) is not null
  or exists(select 1 from unnest(p_good_ids) id where char_length(id) not between 1 and 200 or id<>btrim(id) or id~'[[:cntrl:]]') then
  raise invalid_parameter_value using message='invalid_goods_transaction_offer_ids';end if;
 select coalesce(jsonb_agg(jsonb_build_object('goodId',g.id,
  'volume',case when v.status='active' then jsonb_build_object('id',v.id,'goodId',g.id,'revision',v.revision,'status',v.status,'terms',v.terms,'draftValues','{}'::jsonb) end,
  'delivery',case when d.status='active' then jsonb_build_object('id',d.id,'goodId',g.id,'revision',d.revision,'status',d.status,
   'paymentMode',d.payment_mode,'quantityTerms',d.quantity_terms,'draftValues','{}'::jsonb) end,
  'collectReady',coalesce(contract.status='active' and origin.is_active,false),
  'collector',case when contract.status='active' and origin.is_active then jsonb_build_object('name',contract.contract_values->>'collectorName',
   'method',contract.contract_values->>'collectionMethod','refundContact',contract.contract_values->>'refundContact','instructions',contract.contract_values->>'customerInstructions') end)
  ||case when family.aggregation_id is null then '{}'::jsonb else jsonb_build_object('aggregation',jsonb_build_object('id',family.aggregation_id,'requiresV2',true,
   'runtimeEnabled',(select enabled from private.goods_transaction_runtime where singleton)),'sharedPolicy',private.goods_aggregation_shared_policy(g.id)) end
  ||case when private.shipping_charge_group_public_offer(g.id) is null then '{}'::jsonb else jsonb_build_object('chargeGroup',private.shipping_charge_group_public_offer(g.id)) end
  order by g.id),'[]') into result from public.goods g join public.ips ip on ip.id=g.ip_id
  left join private.goods_aggregation_members member on member.good_id=g.id
  left join private.goods_aggregation_roots family on family.root_good_id=member.root_good_id
  join public.goods owner_good on owner_good.id=coalesce(member.root_good_id,g.id)
  left join private.goods_transaction_configs c on c.good_id=owner_good.id left join private.goods_volume_discount_versions v on v.id=c.volume_version_id
  left join private.goods_delivery_versions d on d.id=c.delivery_version_id left join public.fulfillment_origins origin on origin.id=owner_good.origin_id
  left join private.shipping_collect_contracts collector on collector.origin_id=origin.id
  left join private.shipping_collect_contract_versions contract on contract.id=collector.version_id
 where g.id=any(p_good_ids) and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
  and ip.published_at is not null and ip.archived_at is null;
 return result;
end $function$;

revoke all on function public.get_goods_transaction_offers(p_good_ids text[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_goods_transaction_offers(p_good_ids text[])
  to anon, authenticated, service_role;

-- public.get_good_relations
create or replace function public.get_good_relations(p_good_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with matching as materialized (
    select r.* from public.goods_relations r
    where r.enabled and ((r.kind='together' and r.representative_good_id=p_good_id)
      or (r.kind='similar' and exists(select 1 from public.goods_relation_members m where m.relation_id=r.id and m.good_id=p_good_id)))
  ), public_members as materialized (
    select m.relation_id,m.good_id,m.position from public.goods_relation_members m join matching r on r.id=m.relation_id
      join public.goods g on g.id=m.good_id join public.ips i on i.id=g.ip_id
    where g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and i.archived_at is null and i.published_at is not null
  ), eligible as materialized (
    select r.* from matching r where (select count(*) from public_members m where m.relation_id=r.id)>=2
      and exists(select 1 from public_members m where m.relation_id=r.id and m.good_id=p_good_id)
      and exists(select 1 from public_members m where m.relation_id=r.id and m.good_id=r.representative_good_id)
  ), active as (
    select * from eligible where (starts_at is null or starts_at<=statement_timestamp()) and (ends_at is null or ends_at>statement_timestamp())
  )
  select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,
    'goodIds',(select jsonb_agg(m.good_id order by m.position) from public_members m where m.relation_id=r.id and m.good_id<>p_good_id))
    order by case when r.kind='together' then 0 else 1 end,r.created_at,r.id) from active r),'[]'::jsonb),
    'nextChangeAt',(select min(boundary) from eligible r cross join lateral(values(r.starts_at),(r.ends_at)) changes(boundary) where boundary>statement_timestamp()));
$function$;

revoke all on function public.get_good_relations(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_good_relations(p_good_id text)
  to anon, authenticated;

-- public.get_good_relation_compositions
create or replace function public.get_good_relation_compositions(p_good_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with matching as materialized(
  select r.* from public.goods_relations r where r.enabled and
   ((r.kind='together' and r.image_path is null and r.representative_good_id=p_good_id)
    or ((r.kind in ('similar','codi') or r.image_path is not null) and exists(select 1 from public.goods_relation_members m where m.relation_id=r.id and m.good_id=p_good_id)))
 ),public_members as materialized(
  select m.relation_id,m.good_id,m.position from public.goods_relation_members m join matching r on r.id=m.relation_id join public.goods g on g.id=m.good_id join public.ips i on i.id=g.ip_id
  where g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and i.archived_at is null and i.published_at is not null
 ),eligible as materialized(
  select r.* from matching r where (select count(*) from public_members m where m.relation_id=r.id)>=2
   and exists(select 1 from public_members m where m.relation_id=r.id and m.good_id=p_good_id)
   and exists(select 1 from public_members m where m.relation_id=r.id and m.good_id=r.representative_good_id)
 ),active as(select * from eligible where (starts_at is null or starts_at<=statement_timestamp()) and (ends_at is null or ends_at>statement_timestamp()))
 select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,'representativeGoodId',r.representative_good_id,
  'goodIds',(select jsonb_agg(m.good_id order by m.position) from public_members m where m.relation_id=r.id and m.good_id<>p_good_id),
  'allGoodIds',(select jsonb_agg(m.good_id order by m.position) from public_members m where m.relation_id=r.id),
  'visual',case when r.image_path is null then null else jsonb_build_object('imagePath',r.image_path,'alt',r.image_alt,'description',r.description,
   'hotspots',coalesce((select jsonb_agg(jsonb_build_object('goodId',h.good_id,'x',h.x,'y',h.y) order by m.position)
    from public.goods_relation_hotspots h join public_members m using(relation_id,good_id) where h.relation_id=r.id),'[]'::jsonb)) end)
  order by case r.kind when 'codi' then 0 when 'together' then 1 else 2 end,r.created_at,r.id) from active r),'[]'::jsonb),
  'nextChangeAt',(select min(boundary) from eligible r cross join lateral(values(r.starts_at),(r.ends_at))changes(boundary) where boundary>statement_timestamp()));
$function$;

revoke all on function public.get_good_relation_compositions(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_good_relation_compositions(p_good_id text)
  to anon, authenticated;

-- public.get_good_other_compositions
create or replace function public.get_good_other_compositions(p_good_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; enabled boolean;
begin
 if p_good_id is null or p_good_id !~ '^[a-z0-9][a-z0-9-]{0,119}$' then
  raise invalid_parameter_value using message='invalid_other_composition_good';end if;
 select (values->>'enabled')::boolean into enabled from private.product_detail_settings where section='otherComposition';
 if not coalesce(enabled,false) then return jsonb_build_object('groups','[]'::jsonb,'nextChangeAt',null);end if;
 with matching as materialized(
  select r.* from public.goods_relations r where r.kind='other_composition' and r.enabled
   and exists(select 1 from public.goods_relation_members m where m.relation_id=r.id and m.good_id=p_good_id)
 ),public_members as materialized(
  select m.relation_id,m.good_id,m.position,m.composition_label
  from public.goods_relation_members m join matching r on r.id=m.relation_id
  join public.goods g on g.id=m.good_id join public.ips ip on ip.id=g.ip_id
  where g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
   and ip.archived_at is null and ip.published_at is not null
 ),eligible as materialized(
  select r.* from matching r where exists(select 1 from public_members m where m.relation_id=r.id and m.good_id=p_good_id)
   and exists(select 1 from public_members m where m.relation_id=r.id and m.good_id<>p_good_id)
 ),active as(
  select * from eligible where (starts_at is null or starts_at<=statement_timestamp())
   and (ends_at is null or ends_at>statement_timestamp())
 )
 select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,
  'goods',(select jsonb_agg(jsonb_build_object('goodId',m.good_id,'compositionLabel',m.composition_label) order by m.position)
   from public_members m where m.relation_id=r.id and m.good_id<>p_good_id)) order by r.created_at,r.id) from active r),'[]'::jsonb),
  'nextChangeAt',(select min(boundary) from eligible r cross join lateral(values(r.starts_at),(r.ends_at))changes(boundary)
   where boundary>statement_timestamp())) into result;
 return result;
end $function$;

revoke all on function public.get_good_other_compositions(p_good_id text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_good_other_compositions(p_good_id text)
  to anon, authenticated;

-- private.goods_relation_document
create or replace function private.goods_relation_document(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,'representativeGoodId',r.representative_good_id,
  'enabled',r.enabled,'startsAt',r.starts_at,'endsAt',r.ends_at,'revision',r.revision,'createdAt',r.created_at,'updatedAt',r.updated_at,
  'state',case when not r.enabled then 'stopped' when r.starts_at>statement_timestamp() then 'scheduled' when r.ends_at<=statement_timestamp() then 'ended' else 'active' end,
  'visual',case when r.image_path is null then null else jsonb_build_object('imagePath',r.image_path,'alt',r.image_alt,'description',r.description,
   'hotspots',coalesce((select jsonb_agg(jsonb_build_object('goodId',h.good_id,'x',h.x,'y',h.y) order by m.position)
    from public.goods_relation_hotspots h join public.goods_relation_members m using(relation_id,good_id) where h.relation_id=r.id),'[]'::jsonb)) end,
  'goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'imagePath',g.image_path,
   'public',g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and i.archived_at is null and i.published_at is not null)||case when r.kind='other_composition' then jsonb_build_object('compositionLabel',m.composition_label) else '{}'::jsonb end order by m.position)
   from public.goods_relation_members m join public.goods g on g.id=m.good_id join public.ips i on i.id=g.ip_id where m.relation_id=r.id),'[]'::jsonb))
 from public.goods_relations r where r.id=p_id;
$function$;

revoke all on function private.goods_relation_document(p_id uuid)
  from public, anon, authenticated, service_role;

-- private.goods_group_public_good
create or replace function private.goods_group_public_good(p_good_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.goods g join public.ips ip on ip.id=g.ip_id where g.id=p_good_id
  and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))
  and ip.archived_at is null and ip.published_at is not null);
$function$;

revoke all on function private.goods_group_public_good(p_good_id text)
  from public, anon, authenticated, service_role;

-- public.get_my_product_detail_interests
create or replace function public.get_my_product_detail_interests()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); result jsonb;
begin
 if actor is null or not (public.get_product_detail_experience_config()->>'interests')::boolean then
  return jsonb_build_object('ownerId',actor,'cart','[]'::jsonb,'wishlist','[]'::jsonb,'repurchase','[]'::jsonb);end if;
 with eligible as materialized (
  select g.id from public.goods g join public.ips ip on ip.id=g.ip_id where g.published_at is not null and g.archived_at is null
   and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null
 ), cart as (
  select c.good_id id,max(c.created_at) moment from public.cart_items c join eligible g on g.id=c.good_id where c.user_id=actor
   group by c.good_id order by moment desc,c.good_id limit 30
 ), wishes as (
  select w.good_id id,w.created_at moment from public.wishlists w join eligible g on g.id=w.good_id where w.user_id=actor
   order by moment desc,w.good_id limit 30
 ), repeated as (
  select i.good_id id,max(paid.approved_at) moment from private.product_detail_paid_orders(statement_timestamp()-interval '2 years',statement_timestamp()) paid
   join public.orders o on o.id=paid.id and o.user_id=actor join public.order_items i on i.order_id=o.id join eligible g on g.id=i.good_id
   group by i.good_id having count(distinct o.id)>=2 order by moment desc,i.good_id limit 30
 ) select jsonb_build_object('ownerId',actor,
  'cart',coalesce((select jsonb_agg(id order by moment desc,id) from cart),'[]'::jsonb),
  'wishlist',coalesce((select jsonb_agg(id order by moment desc,id) from wishes),'[]'::jsonb),
  'repurchase',coalesce((select jsonb_agg(id order by moment desc,id) from repeated),'[]'::jsonb)) into result;
 return result;
end $function$;

revoke all on function public.get_my_product_detail_interests()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_product_detail_interests()
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 목록·검색 — 인증 성인에게만 19금 굿즈를 포함한다
-- ---------------------------------------------------------------------------

-- public.search_public_content
create or replace function public.search_public_content(search_query text, per_group_limit integer DEFAULT 6)
 RETURNS TABLE(kind text, id text, label text, subtitle text, ip_id text, ip_title text, image_path text, bg text, accent text, score real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  with raw_params as (
    select
      nullif(left(btrim(search_query), 80), '') as q,
      greatest(1, least(coalesce(per_group_limit, 6), 20)) as result_limit,
      auth.uid() as actor_id
  ),
  params as (
    select
      raw_params.q,
      case
        when raw_params.q is null then null
        else '%' || replace(replace(replace(raw_params.q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
      end as q_like,
      raw_params.result_limit,
      raw_params.actor_id
    from raw_params
  ),
  visible_posts as (
    select
      posts.id,
      posts.user_id,
      posts.ip_id,
      posts.text,
      posts.tag,
      posts.image_path,
      ips.title as ip_title,
      verticals.color as accent
    from public.posts
    left join public.ips on ips.id = posts.ip_id
    left join public.verticals on verticals.key = ips.vertical_key
    cross join params
    where params.q is not null
      and posts.status = 'visible'
      and not exists (
        select 1
        from public.blocks
        where blocks.user_id = params.actor_id
          and blocks.blocked_user_id = posts.user_id
      )
  ),
  all_matches as (
    select
      'ip'::text as kind,
      ips.id::text as id,
      ips.title as label,
      concat_ws(' · ', verticals.label, ips.sub) as subtitle,
      ips.id::text as ip_id,
      ips.title as ip_title,
      ips.image_path,
      ips.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(ips.title, params.q),
        case when ips.title ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(ips.sub, '') ilike params.q_like escape E'\\' then 0.7 else 0 end,
        case when coalesce(ips.tagline, '') ilike params.q_like escape E'\\' then 0.6 else 0 end,
        case when coalesce(ips.synopsis, '') ilike params.q_like escape E'\\' then 0.4 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.ips on params.q is not null
    join public.verticals on verticals.key = ips.vertical_key
    where ips.archived_at is null
      and ips.published_at is not null
      and (
        ips.title ilike params.q_like escape E'\\'
        or coalesce(ips.sub, '') ilike params.q_like escape E'\\'
        or coalesce(ips.tagline, '') ilike params.q_like escape E'\\'
        or coalesce(ips.synopsis, '') ilike params.q_like escape E'\\'
        or extensions.similarity(ips.title, params.q) > 0.15
      )

    union all

    select
      'good'::text as kind,
      goods.id::text as id,
      goods.name as label,
      concat_ws(' · ', ips.title, goods.type) as subtitle,
      goods.ip_id::text,
      ips.title as ip_title,
      goods.image_path,
      goods.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(goods.name, params.q),
        case when goods.name ilike params.q_like escape E'\\' then 1 else 0 end,
        case when goods.type ilike params.q_like escape E'\\' then 0.7 else 0 end,
        case when coalesce(goods.badge, '') ilike params.q_like escape E'\\' then 0.4 else 0 end,
        case when ips.title ilike params.q_like escape E'\\' then 0.35 else 0 end,
        case when coalesce(goods.name_en, '') ilike params.q_like escape E'\\' then 0.8 else 0 end,
        coalesce((
          select max(greatest(
            case when keyword ilike params.q_like escape E'\\' then 1 else 0 end,
            extensions.similarity(keyword, params.q)
          ))
          from unnest(goods.search_keywords) as keyword
        ), 0)
      )::real as score,
      params.result_limit
    from params
    join public.goods on params.q is not null
    join public.ips on ips.id = goods.ip_id
    join public.verticals on verticals.key = ips.vertical_key
    where goods.archived_at is null
      and goods.published_at is not null
      and ips.archived_at is null
      and ips.published_at is not null
      and private.good_sale_restriction_visible(goods.sale_restriction,params.actor_id)
      and (
        goods.name ilike params.q_like escape E'\\'
        or goods.type ilike params.q_like escape E'\\'
        or coalesce(goods.badge, '') ilike params.q_like escape E'\\'
        or ips.title ilike params.q_like escape E'\\'
        or coalesce(goods.name_en, '') ilike params.q_like escape E'\\'
        or extensions.similarity(goods.name, params.q) > 0.15
        or exists (
          select 1
          from unnest(goods.search_keywords) as keyword
          where keyword ilike params.q_like escape E'\\'
            or extensions.similarity(keyword, params.q) > 0.15
        )
      )

    union all

    select
      'card'::text as kind,
      cards.id::text as id,
      cards.name as label,
      concat_ws(' · ', ips.title, cards.rarity::text, cards.no) as subtitle,
      cards.ip_id::text,
      ips.title as ip_title,
      cards.image_path,
      cards.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(cards.name, params.q),
        case when cards.name ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(cards.no, '') ilike params.q_like escape E'\\' then 0.5 else 0 end,
        case when cards.rarity::text ilike params.q_like escape E'\\' then 0.5 else 0 end,
        case when ips.title ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.cards on params.q is not null
    join public.ips on ips.id = cards.ip_id
    join public.verticals on verticals.key = ips.vertical_key
    where cards.archived_at is null
      and ips.archived_at is null
      and ips.published_at is not null
      and (
        cards.name ilike params.q_like escape E'\\'
        or coalesce(cards.no, '') ilike params.q_like escape E'\\'
        or cards.rarity::text ilike params.q_like escape E'\\'
        or ips.title ilike params.q_like escape E'\\'
        or extensions.similarity(cards.name, params.q) > 0.15
      )

    union all

    select
      'post'::text as kind,
      visible_posts.id::text as id,
      visible_posts.text as label,
      concat_ws(' · ', visible_posts.ip_title, case when visible_posts.tag is null then null else '#' || visible_posts.tag end) as subtitle,
      visible_posts.ip_id::text,
      visible_posts.ip_title,
      null::text as image_path,
      null::text as bg,
      visible_posts.accent,
      greatest(
        extensions.similarity(visible_posts.text, params.q),
        case when visible_posts.text ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(visible_posts.tag, '') ilike params.q_like escape E'\\' then 0.8 else 0 end,
        case when coalesce(visible_posts.ip_title, '') ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join visible_posts on true
    where visible_posts.text ilike params.q_like escape E'\\'
      or coalesce(visible_posts.tag, '') ilike params.q_like escape E'\\'
      or coalesce(visible_posts.ip_title, '') ilike params.q_like escape E'\\'
      or extensions.similarity(visible_posts.text, params.q) > 0.15

    union all

    select
      'tag'::text as kind,
      visible_posts.tag as id,
      '#' || visible_posts.tag as label,
      '커뮤니티 태그'::text as subtitle,
      null::text as ip_id,
      null::text as ip_title,
      null::text as image_path,
      null::text as bg,
      max(visible_posts.accent) as accent,
      max(greatest(
        extensions.similarity(visible_posts.tag, params.q),
        case when visible_posts.tag ilike params.q_like escape E'\\' then 1 else 0 end
      ))::real as score,
      params.result_limit
    from params
    join visible_posts on visible_posts.tag is not null
    where visible_posts.tag ilike params.q_like escape E'\\'
      or extensions.similarity(visible_posts.tag, params.q) > 0.15
    group by visible_posts.tag, params.result_limit
  ),
  ranked as (
    select
      all_matches.*,
      row_number() over (
        partition by all_matches.kind
        order by all_matches.score desc, all_matches.label asc, all_matches.id asc
      ) as group_rank
    from all_matches
  )
  select
    ranked.kind,
    ranked.id,
    ranked.label,
    ranked.subtitle,
    ranked.ip_id,
    ranked.ip_title,
    ranked.image_path,
    ranked.bg,
    ranked.accent,
    ranked.score
  from ranked
  where ranked.group_rank <= ranked.result_limit
  order by
    case ranked.kind
      when 'ip' then 1
      when 'good' then 2
      when 'card' then 3
      when 'post' then 4
      when 'tag' then 5
      else 6
    end,
    ranked.score desc,
    ranked.label asc,
    ranked.id asc;
$function$;

revoke all on function public.search_public_content(search_query text, per_group_limit integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_public_content(search_query text, per_group_limit integer)
  to anon, authenticated;

-- public.get_goods_listing_appearance
create or replace function public.get_goods_listing_appearance(p_good_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if p_good_ids is null or cardinality(p_good_ids)>1000 or coalesce(array_ndims(p_good_ids),1)<>1 then raise invalid_parameter_value using message='invalid_listing_ids';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'galleryPaths',to_jsonb(coalesce(g.gallery_paths[1:9],'{}'::text[])),
  'descriptionFormat',g.description_format,'description',left(btrim(regexp_replace(case when g.description_format='html' then regexp_replace(regexp_replace(coalesce(g.description,''),'<(script|style)\y[^>]*>.*?</\1\s*>',' ','gis'),'<[^>]*>',' ','g') else coalesce(g.description,'') end,'\s+',' ','g')),240),
  'colors',coalesce(c.colors,'[]'::jsonb)) order by g.id),'[]'::jsonb)
  from public.goods g join public.ips ip on ip.id=g.ip_id left join private.goods_listing_colors c on c.good_id=g.id
  where g.id=any(p_good_ids) and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.archived_at is null and ip.published_at is not null);
end $function$;

revoke all on function public.get_goods_listing_appearance(p_good_ids text[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_goods_listing_appearance(p_good_ids text[])
  to anon, authenticated;

-- private.category_display_matching_goods
create or replace function private.category_display_matching_goods(p_values jsonb)
 RETURNS TABLE(id text, ordinal_position bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with recursive selected_categories as (
  select c.id from public.catalog_categories c where c.id in(select value::uuid from jsonb_array_elements_text(p_values->'categoryIds'))
   and coalesce((private.category_display_source_category(c.id)->>'publicEnabled')::boolean,false)
  union select c.id from public.catalog_categories c join selected_categories p on c.parent_id=p.id where c.archived_at is null
 ), manual as (select value id,ordinality-1 ordinal_position from jsonb_array_elements_text(p_values->'goodIds') with ordinality)
 select g.id,m.ordinal_position from public.goods g join public.ips ip on ip.id=g.ip_id left join manual m on m.id=g.id
 where g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.archived_at is null and ip.published_at is not null
  and case when p_values->>'mode'='manual' then m.id is not null else
   g.category_id in(select id from selected_categories) or exists(select 1 from public.goods_additional_categories extra where extra.good_id=g.id and extra.category_id in(select id from selected_categories)) end;
$function$;

revoke all on function private.category_display_matching_goods(p_values jsonb)
  from public, anon, authenticated, service_role;

-- private.category_display_page
-- 본문은 20261023040100_category_display_sorts_preorder(정렬 7종·예약판매)의 정의다. 바꾼 것은 추천 블록의
-- 판매 제한 판정 한 줄뿐이다 — 이 migration이 뒤에 적용되므로 그 정의를 기준으로 다시 쓴다.
create or replace function private.category_display_page(p_category_id uuid,p_values jsonb,p_query jsonb,p_offset integer,p_token text,p_revision bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare category jsonb;result jsonb;fingerprint text;b jsonb;r jsonb;video jsonb;recommendations jsonb;keys text[]:=array['ips','types','min','max','sort'];
begin
 category:=private.category_display_category(p_category_id);
 if category is null or not (category->>'publicEnabled')::boolean then return null;end if;
 if p_offset is null or p_offset<0 or p_offset>10000000 or p_offset%20<>0 or p_offset>0 and (p_token is null or p_token !~ '^[0-9a-f]{32}$')
  or jsonb_typeof(p_query) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_query))<>5 or not p_query ?& keys
  or jsonb_typeof(p_query->'ips') is distinct from 'array' or jsonb_typeof(p_query->'types') is distinct from 'array'
  or jsonb_typeof(p_query->'sort') is distinct from 'string' or p_query->>'sort' not in('recommended','name_asc','name_desc','price_asc','price_desc','oldest','newest')
  or jsonb_typeof(p_query->'min') not in('null','number') or jsonb_typeof(p_query->'max') not in('null','number') then raise invalid_parameter_value using message='invalid_category_display_query';end if;
 if jsonb_array_length(p_query->'ips')>100 or jsonb_array_length(p_query->'types')>9
  or exists(select 1 from jsonb_array_elements(p_query->'ips') value where jsonb_typeof(value)<>'string' or value#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,199}$')
  or exists(select 1 from jsonb_array_elements(p_query->'types') value where jsonb_typeof(value)<>'string' or value#>>'{}' not in('피규어','인형','키링','아크릴','문구','쿠션','파우치','세트','예약판매'))
  or exists(select 1 from jsonb_each_text(p_query) e where e.key in('min','max') and e.value is not null and (e.value !~ '^[0-9]{1,9}$' or e.value::numeric>100000000))
  or (p_query->>'min')::numeric>(p_query->>'max')::numeric then raise invalid_parameter_value using message='invalid_category_display_query';end if;
 -- Materialize the complete option quote once per candidate. A flattenable
 -- lateral SELECT would run the price/supply helper separately for each of the
 -- JSON projection, minimum price and available-stock expressions.
 with quoted as materialized (
  select g as good,g.id,g.ip_id,g.name,g.type,g.created_at,g.updated_at,g.display_order,m.ordinal_position,ip.title ip_name,
   private.category_display_public_variants(g.id) variants
  from private.category_display_matching_goods(p_values) m join public.goods g on g.id=m.id join public.ips ip on ip.id=g.ip_id
 ), base as materialized (
  select quoted.*,
   coalesce((select min((v#>>'{pricing,effectivePrice}')::numeric) from jsonb_array_elements(variants) v),(good).price) current_price,
   coalesce((select sum((v#>>'{supply,availableQty}')::bigint) from jsonb_array_elements(variants) v),0) available,
   exists(select 1 from jsonb_array_elements(variants) v where v#>>'{supply,mode}'='preorder') preorder
  from quoted
 ), filtered as materialized (
  select * from base where (jsonb_array_length(p_query->'ips')=0 or ip_id in(select value from jsonb_array_elements_text(p_query->'ips')))
   and (jsonb_array_length(p_query->'types')=0 or type in(select value from jsonb_array_elements_text(p_query->'types')) or preorder and p_query->'types' ? '예약판매')
   and (p_query->>'min' is null or current_price>=(p_query->>'min')::numeric) and (p_query->>'max' is null or current_price<=(p_query->>'max')::numeric)
 ), ranked as materialized (
  select *,row_number() over(order by
   case when p_query->>'sort'='price_asc' then current_price end asc,
   case when p_query->>'sort'='price_desc' then current_price end desc,
   (case when p_query->>'sort'='name_asc' then name end) collate private.category_display_name_ko asc,
   (case when p_query->>'sort'='name_desc' then name end) collate private.category_display_name_ko desc,
   case when p_query->>'sort'='newest' then created_at end desc nulls last,
   case when p_query->>'sort'='oldest' then created_at end asc nulls last,
   case when p_values->>'mode'='manual' then ordinal_position end asc nulls last,
   case when p_values->>'mode'='categories' then display_order end asc nulls last,
   case when p_values->>'mode'='categories' then private.category_display_natural_key(id) end collate "C" asc,
   id collate "C") rank from filtered
 ), page as (select * from ranked order by rank limit 20 offset p_offset)
 select jsonb_build_object('category',jsonb_build_object('id',category->'id','name',category->'name'),'checkedAt',statement_timestamp(),
  'total',(select count(*) from base),'filteredTotal',(select count(*) from filtered),'priceCeil',coalesce((select max(current_price) from base),0),
  'token',md5(jsonb_build_array(p_category_id,p_revision,category,p_query,coalesce((select string_agg(id||':'||current_price||':'||available||':'||updated_at,',' order by rank) from ranked),'') )::text),
  'offset',p_offset,'nextOffset',case when (select count(*) from filtered)>p_offset+20 then p_offset+20 else null end,
  'ipFacets',coalesce((select jsonb_agg(jsonb_build_object('value',ip_id,'label',ip_name,'count',n) order by ip_name,ip_id) from (select ip_id,ip_name,count(*) n from base group by ip_id,ip_name) f),'[]'::jsonb),
  'typeFacets',coalesce((select jsonb_agg(jsonb_build_object('value',type,'label',type,'count',n) order by array_position(array['피규어','인형','키링','아크릴','문구','쿠션','파우치','세트'],type)) from (select type,count(*) n from base group by type) f),'[]'::jsonb)
   ||coalesce((select jsonb_build_array(jsonb_build_object('value','예약판매','label','예약판매','count',count(*))) from base where preorder having count(*)>0),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(private.category_display_public_good(good,variants) order by rank) from page),'[]'::jsonb)) into result;
 fingerprint:=result->>'token';if p_token is not null and p_token is distinct from fingerprint then raise sqlstate 'PT409' using message='category_display_page_changed';end if;
 if (result->>'total')::bigint=0 then return result||jsonb_build_object('banner',null,'video',null,'recommendations',null);end if;
 b:=p_values->'banner';r:=p_values->'recommendations';
 if not (b->>'enabled')::boolean then b:=null;else
  b:=jsonb_build_object('title',b->'title','content',b->'content','imagePath',b->'imagePath','mobileImagePath',b->'mobileImagePath',
   'linkPath',b->'linkPath','imageDim',b->'imageDim','textColor',b->'textColor','altText',case when (b->>'altEnabled')::boolean then concat_ws(' · ',nullif(btrim(b->>'altTitle'),''),nullif(btrim(b->>'altContent'),'')) else '' end);
 end if;
 if (p_values#>>'{video,enabled}')::boolean then
  video:=public.get_good_media(p_values#>>'{video,goodId}')->'video';
  if video='null'::jsonb then video:=null;end if;
  if video is not null then video:=jsonb_build_object('asset',video,'poster',(select image_path from public.goods where id=p_values#>>'{video,goodId}'));end if;
 end if;
 if (r->>'enabled')::boolean then
  select jsonb_build_object('title',r->'title','rows',coalesce(jsonb_agg(private.category_display_public_good(good,variants) order by position),'[]'::jsonb)) into recommendations
  from (select g as good,ordinality position,private.category_display_public_variants(g.id) variants
   from jsonb_array_elements_text(r->'goodIds') with ordinality ids join public.goods g on g.id=ids.value join public.ips ip on ip.id=g.ip_id
   where g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.archived_at is null and ip.published_at is not null
   order by ordinality limit (r->>'itemCount')::integer) selected;
 end if;
 return result||jsonb_build_object('banner',b,'video',video,'recommendations',recommendations);
end $$;

revoke all on function private.category_display_page(p_category_id uuid, p_values jsonb, p_query jsonb, p_offset integer, p_token text, p_revision bigint)
  from public, anon, authenticated, service_role;

-- private.category_display_public_good
create or replace function private.category_display_public_good(p_good goods, p_variants jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('id',p_good.id,'ip_id',p_good.ip_id,'ip_name',(select title from public.ips where id=p_good.ip_id),'name',p_good.name,'type',p_good.type,'price',p_good.price,
  'compare_at_price',p_good.compare_at_price,'show_discount_rate',p_good.show_discount_rate,'display_order',p_good.display_order,'category_id',p_good.category_id,
  'created_at',p_good.created_at,'badge',p_good.badge,'stock',p_good.stock,'stock_qty',p_good.stock_qty,'bg',p_good.bg,'image_path',p_good.image_path,
  'allow_bank_transfer',p_good.allow_bank_transfer,'allow_card_payment',p_good.allow_card_payment,'sale_restriction',p_good.sale_restriction,
  'order_quantity_limit_enabled',p_good.order_quantity_limit_enabled,'min_order_qty',p_good.min_order_qty,'max_order_qty',p_good.max_order_qty,
  'member_purchase_limit_enabled',p_good.member_purchase_limit_enabled,'member_lifetime_qty_limit',p_good.member_lifetime_qty_limit,
  'origin_id',p_good.origin_id,'custom_inputs_enabled',p_good.custom_inputs_enabled,'custom_inputs_revision',p_good.custom_inputs_revision,
  'custom_input_fields',p_good.custom_input_fields,'additional_good_ids',public.goods_additional_ids(p_good),
  'sale_period',public.goods_sale_period(p_good),'goods_variants',p_variants);
$function$;

revoke all on function private.category_display_public_good(p_good goods, p_variants jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 어드민 준비 상태 — 성인 상품은 더 이상 판매 차단 사유가 아니다
-- ---------------------------------------------------------------------------

-- private.admin_goods_readiness
create or replace function private.admin_goods_readiness(p_good goods)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  reasons text[] := array[]::text[]; blockers text[] := array[]::text[];
  available bigint; active_qty bigint; active_options integer; low_options integer;
  min_price integer; max_price integer; ip public.ips;
  kc_current boolean; kc_legacy boolean; notice_complete boolean; unknown_read boolean := false;
begin
  select * into ip from public.ips where id=p_good.ip_id;
  select count(*)::integer into active_options from public.goods_variants where good_id=p_good.id and archived_at is null;
  active_qty:=public.admin_goods_active_stock_qty(p_good);
  low_options:=public.admin_goods_low_stock_option_count(p_good);
  notice_complete := not exists(select 1 from unnest(array[p_good.notice_maker,p_good.notice_origin,p_good.notice_material,
    p_good.notice_size,p_good.notice_made_on,p_good.notice_as_manager,p_good.notice_as_contact]) value where nullif(btrim(value),'') is null);
  -- A malformed supply/review must remain an unknown item in the queue, never 0/ready.
  begin
    available := public.goods_sale_available_qty(p_good);
    select min(price.effective_price),max(price.effective_price) into min_price,max_price
      from public.goods_variants variant cross join lateral private.resolve_goods_variant_price(variant.id,statement_timestamp()) price
      where variant.good_id=p_good.id and variant.archived_at is null;
    kc_current := private.goods_kc_review_current(p_good.id);
    kc_legacy := p_good.published_at is not null and not exists(select 1 from private.goods_kc_reviews where good_id=p_good.id);
  exception when others then
    available:=null; min_price:=null; max_price:=null; kc_current:=null; kc_legacy:=false; unknown_read:=true;
  end;
  if p_good.archived_at is not null then blockers:=array_append(blockers,'archived');
  elsif p_good.published_at is null then blockers:=array_append(blockers,'draft'); end if;
  if p_good.stock='soldout' then blockers:=array_append(blockers,'stopped'); end if;
  if ip.archived_at is not null then blockers:=array_append(blockers,'ip_archived');
  elsif ip.published_at is null then blockers:=array_append(blockers,'ip_unpublished'); end if;
  if nullif(btrim(p_good.type),'') is null then blockers:=array_append(blockers,'type_missing'); end if;
  if nullif(btrim(p_good.image_path),'') is null then blockers:=array_append(blockers,'image_missing'); end if;
  if not notice_complete then blockers:=array_append(blockers,'notice_missing'); end if;
  if active_options=0 then blockers:=array_append(blockers,'no_active_options');
  elsif available=0 and p_good.stock<>'soldout' and p_good.archived_at is null then blockers:=array_append(blockers,'stock_unavailable'); end if;
  if not p_good.allow_card_payment and not p_good.allow_bank_transfer then blockers:=array_append(blockers,'payment_disabled'); end if;
  -- 성인 상품은 인증 성인에게 판매된다(ADR-0024). 그 밖의 판매 제한 유형만 차단 사유다.
  if p_good.sale_restriction not in ('none','adult') then blockers:=array_append(blockers,'restricted_sale'); end if;
  if not exists(select 1 from public.fulfillment_origins where id=p_good.origin_id and is_active) then blockers:=array_append(blockers,'shipping_unavailable'); end if;
  reasons:=blockers;
  if unknown_read then reasons:=array_append(reasons,'readiness_unknown');
  elsif kc_legacy then reasons:=array_append(reasons,'kc_legacy_unrecorded');
  elsif not kc_current then reasons:=array_append(reasons,'kc_required'); end if;
  return jsonb_build_object(
    'state',case when unknown_read then 'unknown' when cardinality(blockers)>0 then 'blocked' when cardinality(reasons)>0 then 'review_required' else 'ready' end,
    'checkedAt',statement_timestamp(),
    'publication',case when p_good.archived_at is not null then 'archived' when p_good.published_at is null then 'draft' else 'published' end,
    'operation',case when p_good.stock='soldout' then 'stopped' else 'active' end,
    'availableQty',available,'activeStockQty',active_qty,'activeOptionCount',active_options,'lowStockOptionCount',low_options,
    'priceMin',min_price,'priceMax',max_price,'noticeComplete',notice_complete,
    'publicReview',case when unknown_read then 'unknown' when kc_current then 'current' when kc_legacy then 'legacy_unrecorded' else 'required' end,
    'saleSettings',case when unknown_read then 'unknown' when cardinality(blockers)>0 then 'blocked' else 'ready' end,
    'reviewRequired',cardinality(reasons)>0,'reasonCodes',to_jsonb(reasons),'blockingCodes',to_jsonb(blockers));
end $function$;

revoke all on function private.admin_goods_readiness(p_good goods)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 상세의 담기(add_cart_selection) — 19금 본품은 인증 성인만, 추가 구성은 일반 굿즈만
-- ---------------------------------------------------------------------------
-- 상세의 장바구니·구매하기는 본품과 추가 구성을 한 번에 담는다. 그 판정
-- (goods_additional_available)은 일반 굿즈만 참이라 인증 성인도 19금 본품을 담지 못했다.
-- 본품만 같은 조건에 성인 인증 판정을 더한 helper로 보고, 추가 구성은 그대로 둔다 —
-- 19금 굿즈는 다른 굿즈의 추가 구성으로 노출·판매하지 않는다.
create function private.goods_selection_base_available(p_good_id text, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists(select 1 from public.goods good join public.ips ip on ip.id=good.ip_id
    where good.id=p_good_id and good.published_at is not null and good.archived_at is null
      and private.good_sale_restriction_visible(good.sale_restriction,p_actor)
      and good.stock<>'soldout' and (good.allow_card_payment or good.allow_bank_transfer)
      and ip.published_at is not null and ip.archived_at is null
      and exists(select 1 from public.goods_variants variant cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
        where variant.good_id=good.id and variant.archived_at is null and supply.available_qty>0));
$function$;

revoke all on function private.goods_selection_base_available(text, uuid)
  from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.add_cart_selection(p_base_good_id text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); item record; actual_qty integer; next_qty bigint; key_value text; seen text[]:='{}';
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.lock_goods_transaction_actor(actor);
  perform private.assert_active_user(actor);
  if nullif(btrim(p_base_good_id),'') is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 51 then
    raise invalid_parameter_value using message='invalid cart selection';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) line where jsonb_typeof(line)<>'object'
    or not line ?& array['good_id','variant_id','qty','expected_qty']
    or exists(select 1 from jsonb_object_keys(line) key where key not in ('good_id','variant_id','qty','expected_qty','input_revision','input_values'))
    or jsonb_typeof(line->'good_id')<>'string' or jsonb_typeof(line->'variant_id')<>'string'
    or jsonb_typeof(line->'qty')<>'number' or jsonb_typeof(line->'expected_qty')<>'number'
    or line->>'qty' !~ '^[1-9][0-9]*$' or line->>'expected_qty' !~ '^(0|[1-9][0-9]*)$') then
    raise invalid_parameter_value using message='invalid cart selection';
  end if;
  if not exists(select 1 from jsonb_to_recordset(p_items) input(good_id text) where input.good_id=p_base_good_id) then raise invalid_parameter_value using message='invalid cart selection'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cart:'||actor::text,0));
  for item in select good_id,variant_id,qty,expected_qty,coalesce(input_revision,0) input_revision,coalesce(input_values,'{}') input_values
    from jsonb_to_recordset(p_items) input(good_id text,variant_id uuid,qty integer,expected_qty integer,input_revision integer,input_values jsonb)
    order by good_id,variant_id loop
    if nullif(btrim(item.good_id),'') is null or item.variant_id is null or item.qty<1 or item.expected_qty<0 then raise invalid_parameter_value using message='invalid cart selection'; end if;
    key_value:=case when item.input_revision=0 and item.input_values='{}' then '' else md5(item.input_revision::text||':'||item.input_values::text) end;
    if item.variant_id::text||':'||key_value=any(seen) then raise invalid_parameter_value using message='invalid cart selection'; end if;
    seen:=array_append(seen,item.variant_id::text||':'||key_value);
    if item.good_id<>p_base_good_id and not exists(select 1 from private.goods_additional_links where base_good_id=p_base_good_id and target_good_id=item.good_id) then
      raise check_violation using message='additional_good_unavailable';
    end if;
    -- 19금 본품은 인증 성인만 담는다(ADR-0024). 추가 구성은 계속 일반 굿즈만이다.
    if item.good_id=p_base_good_id then
      if not private.goods_selection_base_available(item.good_id,actor) then
        if exists(select 1 from public.goods good where good.id=item.good_id and good.sale_restriction='adult')
          and not private.adult_verification_valid(actor) then
          raise check_violation using message='adult_verification_required';
        end if;
        raise check_violation using message='additional_good_unavailable';
      end if;
    elsif not private.goods_additional_available(item.good_id) then
      raise check_violation using message='additional_good_unavailable';
    end if;
    select coalesce((select qty from public.cart_items where user_id=actor and good_id=item.good_id and variant_id=item.variant_id and input_key=key_value),0) into actual_qty;
    if actual_qty<>item.expected_qty then raise sqlstate 'PT409' using message='cart_selection_changed'; end if;
    next_qty:=actual_qty::bigint+item.qty;
    if next_qty>2147483647 then raise check_violation using message='invalid cart selection'; end if;
    perform private.set_cart_quantity_with_inputs(item.good_id,item.variant_id,next_qty::integer,item.input_revision,item.input_values);
  end loop;
  return (select coalesce(jsonb_agg(jsonb_build_object('goodId',good_id,'variantId',variant_id,'qty',qty)
    ||case when input_snapshot is null then '{}' else jsonb_build_object('customInputs',input_snapshot) end
    order by created_at,good_id,variant_id,input_key),'[]') from public.cart_items where user_id=actor);
end $function$;

revoke all on function public.add_cart_selection(text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.add_cart_selection(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 운영자 계약 지문 갱신
-- ---------------------------------------------------------------------------
-- 위에서 다시 정의한 함수 중 운영자 계약 레지스트리에 오른 것의 본문·ACL 지문을 새 정의로
-- 다시 적는다(operator_capability_coverage가 대조한다). 권한 분류(capability·guard)는 그대로다.
select private.register_operator_rpc_contract('public.goods_variant_pricing(public.goods_variants)'::regprocedure, 'catalog.read', 'mixed', false);

select private.register_operator_internal_contract('public.goods_variant_pricing(public.goods_variants)'::regprocedure);
select private.register_operator_internal_contract('public.goods_sale_period(public.goods)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_relation_compositions(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_goods_listing_appearance(text[])'::regprocedure);
select private.register_operator_internal_contract('public.get_product_detail_presentation(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_my_product_detail_interests()'::regprocedure);
select private.register_operator_internal_contract('public.get_product_detail_experience(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_product_shipping_savings(text,uuid,integer)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_media(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_benefit_content(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_after_sales_content(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_size_chart(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_announcements(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_shipping_policy(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_good_other_compositions(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_goods_transaction_offers(text[])'::regprocedure);
select private.register_operator_internal_contract('private.goods_relation_document(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.goods_group_public_good(text)'::regprocedure);
select private.register_operator_internal_contract('private.goods_sales_conditions_core(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_public_good(public.goods,jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure);
select private.register_operator_internal_contract('private.category_display_matching_goods(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure);
select private.register_operator_internal_contract('private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)'::regprocedure);
select private.register_operator_internal_contract('public.add_cart_selection(text,jsonb)'::regprocedure);
