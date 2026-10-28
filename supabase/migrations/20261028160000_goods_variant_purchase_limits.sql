-- 10/27 회의 D7②: 옵션별 구매 제한.
-- 옵션(goods_variants)마다 주문당 최대 수량(order_max_qty)과 1인 누적 최대 수량(member_max_qty)을 둔다.
-- null은 제한 없음이다. 기존 행과 신규 옵션은 null이라 지금 동작은 바뀌지 않는다. 상품 단위 제한
-- (order_quantity_limit_enabled·min/max_order_qty·member_lifetime_qty_limit)은 그대로이고, 두 판정을 모두 통과해야 주문된다.
--
-- 의미는 상품 단위 제한과 같다.
--   주문당: 한 주문 안 같은 옵션 행의 수량 합(직접입력 여러 줄·랜덤 분할 행 포함).
--   1인 누적: 같은 회원의 canceled가 아닌 주문(결제 대기 포함)의 같은 옵션 수량 합. 정기구독 갱신 주문도 들어간다.
-- 강제는 order_items BEFORE INSERT 트리거 하나다. legacy·거래 런타임·선물·구독 주문 생성 경로가 모두 이 행을 만든다.
-- 같은 회원의 주문 생성은 모든 진입점이 회원 advisory 잠금으로 직렬화하므로 별도 잠금은 두지 않는다.
-- 안내는 legacy 장바구니 견적 public.quote_goods_sales의 line.optionLimit과 거래 런타임 계산의 purchase_limit 이슈다.
-- 저장은 private.save_goods_options가 orderMaxQty·memberMaxQty 키를 받는다. 키가 없으면 기존 값을 유지한다
-- (복제·그룹·일괄 경로가 새 키 없이 행을 넘긴다 — lowStockThreshold와 같은 규칙).
begin;

alter table public.goods_variants
  add column order_max_qty integer constraint goods_variants_order_max_qty_positive check (order_max_qty is null or order_max_qty>0),
  add column member_max_qty integer constraint goods_variants_member_max_qty_positive check (member_max_qty is null or member_max_qty>0);
comment on column public.goods_variants.order_max_qty is '옵션 주문당 최대 구매 수량. null = 제한 없음.';
comment on column public.goods_variants.member_max_qty is '옵션 1인 누적 최대 구매 수량(결제 대기 포함, 취소 완료 제외). null = 제한 없음.';

-- 회원의 이 옵션 누적 수량. 상품 단위 private.member_goods_reserved_qty와 같은 의미다.
create function private.member_variant_reserved_qty(p_user_id uuid,p_variant_id uuid) returns bigint
language sql stable security definer set search_path='' as $$
  select coalesce(sum(item.qty::bigint),0)::bigint
  from public.orders o join public.order_items item on item.order_id=o.id
  where o.user_id=p_user_id and o.status<>'canceled' and item.variant_id=p_variant_id;
$$;
revoke all on function private.member_variant_reserved_qty(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.member_variant_reserved_qty(uuid,uuid) to postgres;

-- 주문 전 판정(견적·거래 런타임 계산). p_qty는 이번 주문의 이 옵션 수량 합이다. 사유 코드 또는 null.
create function private.goods_variant_purchase_limit_problem(p_variant_id uuid,p_user_id uuid,p_qty bigint) returns text
language plpgsql stable security definer set search_path='' as $$
declare variant public.goods_variants;
begin
  select * into variant from public.goods_variants where id=p_variant_id;
  if not found or p_qty is null then return null; end if;
  if variant.order_max_qty is not null and p_qty>variant.order_max_qty then return 'option_order_limit_exceeded'; end if;
  if variant.member_max_qty is not null and p_user_id is not null
    and private.member_variant_reserved_qty(p_user_id,p_variant_id)+p_qty>variant.member_max_qty then
    return 'option_member_limit_exceeded';
  end if;
  return null;
end $$;
revoke all on function private.goods_variant_purchase_limit_problem(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function private.goods_variant_purchase_limit_problem(uuid,uuid,bigint) to postgres;

-- 주문 생성 경계. 같은 주문의 앞선 행과 회원의 다른 주문을 합해 판정한다.
-- 오류 문구는 기존 부분 문자열(order_quantity_above_maximum·member_purchase_limit_exceeded·out of stock 등)과 겹치지 않는다.
create function private.guard_order_item_variant_purchase_limit() returns trigger
language plpgsql security definer set search_path='' as $$
declare variant public.goods_variants; buyer uuid; in_order bigint;
begin
  select * into variant from public.goods_variants where id=new.variant_id;
  if not found or (variant.order_max_qty is null and variant.member_max_qty is null) then return new; end if;
  if variant.order_max_qty is not null then
    select coalesce(sum(item.qty::bigint),0) into in_order from public.order_items item
      where item.order_id=new.order_id and item.variant_id=new.variant_id;
    if in_order+new.qty>variant.order_max_qty then
      raise check_violation using message=format('option_order_limit_exceeded: %s',new.variant_id);
    end if;
  end if;
  if variant.member_max_qty is not null then
    select o.user_id into buyer from public.orders o where o.id=new.order_id;
    if buyer is not null and private.member_variant_reserved_qty(buyer,new.variant_id)+new.qty>variant.member_max_qty then
      raise check_violation using message=format('option_member_limit_exceeded: %s',new.variant_id);
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_order_item_variant_purchase_limit() from public,anon,authenticated,service_role;
grant execute on function private.guard_order_item_variant_purchase_limit() to postgres;
create trigger order_items_variant_purchase_limit before insert on public.order_items
  for each row execute function private.guard_order_item_variant_purchase_limit();

-- 옵션 저장: orderMaxQty·memberMaxQty(양의 정수 또는 null). 키가 없으면 기존 값을 유지한다.
do $patch$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.save_goods_options(text,jsonb,jsonb,boolean)'::regprocedure);

  anchor:=$old$   if item?'isActive' and jsonb_typeof(item->'isActive') is distinct from 'boolean' then$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'save_goods_options_validation_anchor_changed'; end if;
  definition:=replace(definition,anchor,$new$   if exists(select 1 from unnest(array['orderMaxQty','memberMaxQty']) limit_key
     where item?limit_key and item->limit_key<>'null'::jsonb and (jsonb_typeof(item->limit_key)<>'number'
       or item->>limit_key !~ '^[1-9][0-9]*$' or (item->>limit_key)::numeric>2147483647)) then
     raise check_violation using message='invalid_goods_options'; end if;
$new$||anchor);

  anchor:=$old$       low_stock_threshold=case when item?'lowStockThreshold' then (item->>'lowStockThreshold')::integer else variant.low_stock_threshold end,$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'save_goods_options_update_anchor_changed'; end if;
  definition:=replace(definition,anchor,anchor||$new$
       order_max_qty=case when item?'orderMaxQty' then (item->>'orderMaxQty')::integer else variant.order_max_qty end,
       member_max_qty=case when item?'memberMaxQty' then (item->>'memberMaxQty')::integer else variant.member_max_qty end,$new$);

  anchor:=$old$insert into public.goods_variants(good_id,name,attributes,price,code,sort_order,is_default,low_stock_threshold,archived_at)$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'save_goods_options_insert_anchor_changed'; end if;
  definition:=replace(definition,anchor,$new$insert into public.goods_variants(good_id,name,attributes,price,code,sort_order,is_default,low_stock_threshold,archived_at,order_max_qty,member_max_qty)$new$);

  anchor:=$old$case when coalesce((item->>'isActive')::boolean,true) then null else clock_timestamp() end)$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'save_goods_options_values_anchor_changed'; end if;
  definition:=replace(definition,anchor,$new$case when coalesce((item->>'isActive')::boolean,true) then null else clock_timestamp() end,
         (item->>'orderMaxQty')::integer,(item->>'memberMaxQty')::integer)$new$);

  execute definition;
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure='private.save_goods_options(text,jsonb,jsonb,boolean)'::regprocedure) then
    perform private.register_operator_internal_contract('private.save_goods_options(text,jsonb,jsonb,boolean)'::regprocedure);
  end if;
end $patch$;
revoke all on function private.save_goods_options(text,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function private.save_goods_options(text,jsonb,jsonb,boolean) to postgres;

-- 복제는 옵션 운영 값(lowStockThreshold)과 함께 옵션별 제한도 옮긴다.
do $patch$
declare definition text; anchor constant text:=$old$'lowStockThreshold', variant.low_stock_threshold$old$;
  target constant regprocedure:='private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure;
begin
  definition:=pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'clone_good_option_limits_anchor_changed'; end if;
  execute replace(definition,anchor,anchor||$new$,
        'orderMaxQty', variant.order_max_qty,
        'memberMaxQty', variant.member_max_qty$new$);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $patch$;

-- legacy 장바구니 견적: line마다 옵션 한도와 사유를 덧붙인다(앱 파서는 추가 키를 거부하지 않는다).
-- optionLimit = {orderMaxQty, memberMaxQty, memberReservedQty, memberRemainingQty, reason}
--   memberReservedQty·memberRemainingQty는 로그인했고 memberMaxQty가 있을 때만 값이 있다.
--   reason = option_order_limit_exceeded | option_member_limit_exceeded | null.
-- line.qty는 같은 (굿즈, 옵션) 장바구니 줄의 합이라 주문 트리거와 같은 기준이다.
create or replace function public.quote_goods_sales(items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare quote jsonb; lines jsonb:='[]'; line jsonb; supply jsonb; next_change timestamptz; selling boolean; shipping_quote jsonb;
  variant public.goods_variants; actor uuid:=auth.uid(); reserved bigint; limit_reason text;
begin
  quote:=private.quote_goods_sales_before_preorder(items);
  next_change:=(quote->>'nextChangeAt')::timestamptz;
  for line in select value from jsonb_array_elements(quote->'lines') loop
    select public.goods_variant_supply(v),good.stock<>'soldout' into supply,selling
      from public.goods_variants v join public.goods good on good.id=v.good_id
      where v.id=(line->>'variantId')::uuid and good.id=line->>'goodId';
    if supply is null then raise check_violation using message='sales_quote_variant_unavailable'; end if;
    select * into variant from public.goods_variants where id=(line->>'variantId')::uuid;
    reserved:=case when actor is null or variant.member_max_qty is null then null
      else private.member_variant_reserved_qty(actor,variant.id) end;
    limit_reason:=case
      when variant.order_max_qty is not null and (line->>'qty')::bigint>variant.order_max_qty then 'option_order_limit_exceeded'
      when reserved is not null and reserved+(line->>'qty')::bigint>variant.member_max_qty then 'option_member_limit_exceeded' end;
    lines:=lines||jsonb_build_array(line||jsonb_build_object('supply',supply,
      'available',selling and (line->>'qty')::bigint<=(supply->>'availableQty')::integer,
      'optionLimit',jsonb_build_object('orderMaxQty',variant.order_max_qty,'memberMaxQty',variant.member_max_qty,
        'memberReservedQty',reserved,'memberRemainingQty',case when reserved is null then null else greatest(0,variant.member_max_qty-reserved) end,
        'reason',limit_reason)));
    next_change:=least(next_change,(supply->>'nextChangeAt')::timestamptz);
  end loop;
  shipping_quote:=public.quote_goods_shipping(items);
  return quote||jsonb_build_object('lines',lines,'nextChangeAt',next_change,'shipping',shipping_quote,
    'coupon',private.quote_selected_coupon(lines,(quote->>'subtotal')::bigint,(shipping_quote->>'totalFee')::bigint));
end $$;
revoke all on function public.quote_goods_sales(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_goods_sales(jsonb) to anon,authenticated,postgres;

-- 거래 런타임 계산: 옵션 한도를 넘는 선택은 기존 purchase_limit 이슈로 막는다(주문 트리거가 최종 경계).
do $patch$
declare definition text;
  target constant regprocedure:='private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)'::regprocedure;
  anchor constant text:=$old$  select sum((value->>'qty')::numeric) into variant_qty from jsonb_array_elements(p_selection) where value->>'variantId'=variant.id::text;$old$;
begin
  definition:=pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'transaction_option_limit_anchor_changed'; end if;
  execute replace(definition,anchor,anchor||$new$
  if private.goods_variant_purchase_limit_problem(variant.id,p_actor,variant_qty::bigint) is not null then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','purchase_limit','goodId',good.id)));end if;$new$);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $patch$;

commit;
notify pgrst,'reload schema';
