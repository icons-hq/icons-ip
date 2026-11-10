-- 10/27 회의 D5②(R24) 보강 — 랜덤 판매 굿즈의 옵션별 재고를 고객에게 숨긴다(T6 리뷰 R1).
--
-- 20261028160100은 고객의 order_items 직접 읽기에서 랜덤 행을 뺐지만, 옵션별 재고(goods_variants.stock_qty·
-- goods_variant_supply)는 공개라서 주문 전후 재고 차이로 배정 옵션이 드러났다. 결제 대기 주문은 다시 주문하면 자동 취소되고
-- 재고가 돌아오므로, 원하는 옵션이 나올 때까지 비용 없이 다시 뽑을 수 있었다. 은닉의 목적(재추첨 방지)을 지키려면
-- 고객이 닿는 모든 경로에서 랜덤 굿즈의 재고는 풀 합계(활성 일반재고 옵션의 판매 가능 수량 합)로만 보여야 한다.
--
-- 고객 경로와 처리:
--   1. REST goods_variants(옵션별 stock_qty·updated_at·low_stock_threshold): restrictive 정책으로 랜덤 굿즈의 옵션 행을
--      익명·고객에게서 뺀다(운영자 catalog.read는 그대로 읽는다). 기본 옵션 행도 빼야 한다 — 기본 옵션 재고만 보여도
--      '기본 옵션이 뽑혔는지'가 드러난다.
--   2. 대신 공개 계산 열 public.goods_random_option(goods)가 랜덤 한 줄을 준다: id = 장바구니 키(기본 옵션), 이름 '랜덤',
--      코드 '', stock_qty·supply.availableQty = 풀 합계, pricing = 기본 옵션 가격(랜덤 굿즈는 모든 옵션 가격이 같다).
--      모양은 앱의 goods_variants 행(GoodOptionRow)과 같다. 랜덤이 아니면 null.
--   3. public.goods_variant_supply(v)(옵션 id를 아는 사람이 직접 부를 수 있는 공개 계산 열, 견적·쇼핑 스토리·카테고리 전시가
--      쓴다): 랜덤 굿즈 옵션이면 availableQty = 풀 합계.
--   4. 카테고리 전시 private.category_display_public_variants: 랜덤 굿즈는 랜덤 한 줄만 싣는다.
--   5. 배송비 절약 추천 public.get_product_shipping_savings: 랜덤 후보는 풀 기준으로 고르고 '랜덤'으로 보인다
--      (기본 옵션 재고가 있는지에 따라 다른 옵션이 골라지는 것도 단서다).
--   6. 옵션 재입고 신청 public.request_variant_restock_alert: 옵션별 품절 여부로 판정하면 '이 옵션이 막 품절됐는지'가
--      드러난다. 랜덤 굿즈는 풀 기준으로 판정하고 굿즈 단위로 신청한다.
-- 견적(quote_goods_sales)의 랜덤 줄은 20261028160100에서 이미 풀 합계다. 거래 런타임은 랜덤 굿즈를 막는다.
-- 남는 단서: 한 주문의 랜덤 행 개수·행별 수량(같은 옵션이 겹쳤는지)은 my_order_items·order_shipment_items로 보인다.
begin;

-- 풀 합계. 호출자가 굿즈를 가리지 않는다(랜덤 여부는 호출자가 본다).
create function private.random_option_pool_qty(p_good_id text,p_at timestamptz) returns integer
language sql stable security definer set search_path='' as $$
  select least(coalesce(sum(supply.available_qty::bigint),0),2147483647)::integer
  from public.goods_variants variant
  cross join lateral private.resolve_goods_variant_supply(variant.id,p_at) supply
  where variant.good_id=p_good_id and variant.archived_at is null and supply.mode='stock';
$$;
revoke all on function private.random_option_pool_qty(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.random_option_pool_qty(text,timestamptz) to postgres;

-- 3. 공개 공급 계산 열: 랜덤 굿즈 옵션은 풀 합계.
create or replace function public.goods_variant_supply(variant public.goods_variants) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('mode',supply.mode,
    'availableQty',case when good.option_sale_mode='random' and supply.mode='stock'
      then private.random_option_pool_qty(good.id,statement_timestamp()) else supply.available_qty end,
    'policyId',supply.policy_id,
    'policyRevision',supply.policy_revision,'state',supply.state,'startsAt',supply.starts_at,'endsAt',supply.ends_at,
    'expectedShipDate',supply.expected_ship_date,'calculatedAt',statement_timestamp(),'nextChangeAt',supply.next_change_at)
  from public.goods_variants current_variant join public.goods good on good.id=current_variant.good_id join public.ips ip on ip.id=good.ip_id
    cross join lateral private.resolve_goods_variant_supply(current_variant.id,statement_timestamp()) supply
  where current_variant.id=variant.id and current_variant.archived_at is null and good.published_at is not null and good.archived_at is null
    and good.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null;
$$;
revoke all on function public.goods_variant_supply(public.goods_variants) from public,anon,authenticated,service_role;
grant execute on function public.goods_variant_supply(public.goods_variants) to anon,authenticated;

-- 2. 랜덤 한 줄(고객 화면의 옵션 자리). 옵션 행 공개 조건(goods_variants_public_read)과 같은 범위에서만 준다.
create function public.goods_random_option(good public.goods) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',key_variant.id,'name','랜덤','code','','price',key_variant.price,
    'stock_qty',(select coalesce(sum(pool_variant.stock_qty::bigint),0) from public.goods_variants pool_variant
      where pool_variant.good_id=current_good.id and pool_variant.archived_at is null),
    'is_default',true,'attributes','{}'::jsonb,'archived_at',null,'sort_order',0,
    'pricing',public.goods_variant_pricing(key_variant),'supply',public.goods_variant_supply(key_variant))
  from public.goods current_good
  join public.ips ip on ip.id=current_good.ip_id
  join public.goods_variants key_variant on key_variant.good_id=current_good.id and key_variant.is_default and key_variant.archived_at is null
  where current_good.id=good.id and current_good.option_sale_mode='random' and current_good.archived_at is null
    and current_good.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null;
$$;
revoke all on function public.goods_random_option(public.goods) from public,anon,authenticated,service_role;
grant execute on function public.goods_random_option(public.goods) to anon,authenticated;
comment on function public.goods_random_option(public.goods) is
  '랜덤 판매 굿즈의 고객용 옵션 한 줄(D5②). 옵션 행은 고객에게 숨기므로 이 열로 장바구니 키·풀 합계를 읽는다. 랜덤이 아니면 null.';

-- 1. 옵션 행 은닉. 운영자(catalog.read)는 그대로 읽는다. 정책 안의 goods 조회는 goods_read(전체 공개)라 익명도 판정된다.
create policy goods_variants_random_private_read on public.goods_variants as restrictive for select to anon,authenticated
  using (not exists(select 1 from public.goods good where good.id=goods_variants.good_id and good.option_sale_mode='random')
    or (select public.has_operator_capability('catalog.read')));
select private.register_operator_policy_contract('public.goods_variants'::regclass,'goods_variants_random_private_read','catalog.read');

-- 4. 카테고리 전시: 랜덤 굿즈는 랜덤 한 줄. 옵션 선택 굿즈 분기는 20261020085338 본문 그대로다.
create or replace function private.category_display_public_variants(p_good_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.goods good where good.id=p_good_id and good.option_sale_mode='random')
  then coalesce((select jsonb_build_array(random_option.option) from public.goods good
    cross join lateral (select public.goods_random_option(good) option) random_option
    where good.id=p_good_id and random_option.option is not null),'[]'::jsonb)
  else (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'code',v.code,'price',v.price,'stock_qty',v.stock_qty,
    'is_default',v.is_default,'attributes',v.attributes,'archived_at',v.archived_at,'sort_order',v.sort_order,
    'pricing',public.goods_variant_pricing(v),'supply',public.goods_variant_supply(v)) order by v.sort_order,v.id),'[]'::jsonb)
   from public.goods_variants v where v.good_id=p_good_id and v.archived_at is null) end;
$$;
revoke all on function private.category_display_public_variants(text) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.category_display_public_variants(text)'::regprocedure);

-- 5. 배송비 절약 추천: 랜덤 후보는 풀 기준, 이름 '랜덤'.
do $patch$
declare definition text; anchor text;
  target constant regprocedure:='public.get_product_shipping_savings(text,uuid,integer)'::regprocedure;
begin
  definition:=pg_get_functiondef(target);
  anchor:=$old$cross join lateral private.resolve_goods_variant_supply(v.id,statement_timestamp()) supply$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'shipping_savings_random_supply_anchor_changed'; end if;
  definition:=replace(definition,anchor,$new$cross join lateral (select resolved.mode,case when g.option_sale_mode='random' and resolved.mode='stock'
     then private.random_option_pool_qty(g.id,statement_timestamp()) else resolved.available_qty end available_qty
     from private.resolve_goods_variant_supply(v.id,statement_timestamp()) resolved) supply$new$);
  anchor:=$old$chosen.name variant_name$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'shipping_savings_random_name_anchor_changed'; end if;
  execute replace(definition,anchor,$new$case when g.option_sale_mode='random' then '랜덤'::text else chosen.name end variant_name$new$);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $patch$;

-- 6. 옵션 재입고 신청: 랜덤 굿즈는 풀 기준 판정, 굿즈 단위 신청(variant_id null). 오류 코드는 옵션 신청과 같다.
do $patch$
declare definition text;
  target constant regprocedure:='public.request_variant_restock_alert(text,uuid)'::regprocedure;
  anchor constant text:=$old$    raise exception 'good_missing' using errcode = 'P0002';
  end if;
$old$;
begin
  definition:=pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'variant_restock_random_anchor_changed'; end if;
  execute replace(definition,anchor,anchor||$new$
  -- 랜덤 판매 굿즈(D5②)는 옵션별 재고를 고객에게 숨긴다. 옵션 품절 여부로 판정하면 배정 결과가 드러난다.
  if exists(select 1 from public.goods as good where good.id = target_good_id and good.option_sale_mode = 'random') then
    if not exists(select 1 from public.goods_variants as variant
      where variant.id = target_variant_id and variant.good_id = target_good_id and variant.archived_at is null) then
      raise exception 'variant_missing' using errcode = 'P0002';
    end if;
    if good_stock <> 'soldout' and exists(select 1 from public.goods_variants as variant
      where variant.good_id = target_good_id and variant.archived_at is null
        and variant.preorder_policy_id is null and variant.stock_qty > 0) then
      raise exception 'variant_available' using errcode = '22023';
    end if;
    insert into public.restock_alerts (user_id, good_id, variant_id)
    values (actor_id, target_good_id, null)
    on conflict (user_id, good_id, variant_id)
    do update set status = 'pending', notified_at = null, created_at = now();
    return;
  end if;
$new$);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $patch$;

commit;
notify pgrst,'reload schema';
