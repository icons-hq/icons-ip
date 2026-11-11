-- 12/2 홍실 퀘스트 2차 예약 판매: 랜덤 판매 굿즈(ADR-0027)에 예약판매와 같은 옵션 배정 상한을 붙인다.
--
-- 지금까지 랜덤 굿즈는 일반 재고 옵션만 배정했다(예약 선택 옵션·옵션별 구매 제한이 있으면 random_option_preorder·
-- random_option_variant_limits로 거절). 이 migration 뒤의 규칙:
--
-- 1. 랜덤 예약판매 — 판매 중인 옵션이 모두 예약(선택된 정책)이거나 모두 일반 재고다. 예약이면 접수 시작·종료와 발송 예정일이
--    모든 옵션에서 같고, 승인 예약 물량만 옵션별로 다르다. 옵션마다 일정이 다르면 고객의 발송 예정일로 배정 옵션이 드러나므로
--    섞인 상태는 지연 제약 트리거가 커밋에서 거절한다(random_option_preorder_mismatch). 배정은 남은 예약 물량에 비례한다.
--    배정 행마다 그 옵션 정책의 스냅샷과 예약(goods_preorder_reservations)을 만든다. 실물 재고는 차감하지 않고, 입고 할당·
--    취소 복원·출고 가드는 배정 옵션의 order_items.variant_id로 지금처럼 동작한다.
-- 2. 같은 옵션 배정 상한 — 옵션별 구매 제한(order_max_qty·member_max_qty)을 랜덤 굿즈에서는 '같은 옵션을 한 주문·한 회원에게
--    몇 개까지 배정하는가'로 쓴다. 고객은 옵션을 고르지 않으므로 값은 판매 중인 모든 옵션에서 같아야 한다
--    (random_option_limit_mismatch). 배정은 상한에 닿은 옵션을 빼고 뽑는다. 가능한 수량(옵션별 min(상한 잔여, 남은 물량)의 합)이
--    모자라면 추출 전에 random_option_limit_exceeded로 거절한다 — 추출 결과에 따라 실패가 갈리지 않는다.
-- 3. 고객 은닉 — 랜덤 굿즈의 공개 공급(goods_variant_supply·goods_random_option·배송비 절약 추천·장바구니)은 예약이어도 풀 기준이다
--    (옵션별 남은 예약 물량은 배정 단서다). 견적의 랜덤 줄 한도는 배정에 따라 달라지지 않는 정적 값(옵션 수×상한, 굿즈 누적 수량)으로만
--    판정한다 — 결제 대기 주문의 배정을 견적으로 떠보는 경로를 막는다.
-- 4. 일괄 RPC admin_save_random_goods_preorders — 옵션별 예약 저장을 한 트랜잭션으로 묶는다(초안·활성화·중지·일반 재고 전환).
--    옵션별 RPC를 하나씩 부르면 중간 상태(일부 옵션만 예약)가 커밋에서 거절되기 때문이다. 검증·권한·감사는 기존 옵션별 RPC가 한다.
-- 19금 상품의 랜덤 판매 금지는 그대로다(legacy 주문 코어의 랜덤 분기가 sale_restriction<>'none'을 거절한다).
begin;

-- 1. 랜덤 조건 ------------------------------------------------------------------------------------------
create or replace function private.goods_random_option_problem(p_good_id text) returns text
language plpgsql stable security definer set search_path='' as $$
declare good public.goods;
begin
  select * into good from public.goods where id=p_good_id;
  if not found then return 'good_not_found'; end if;
  if (select count(*) from public.goods_variants where good_id=p_good_id and archived_at is null)<2 then return 'random_option_count'; end if;
  if not exists(select 1 from public.goods_variants where good_id=p_good_id and is_default and archived_at is null) then
    return 'random_option_default_inactive';
  end if;
  -- 예약판매: 판매 중 옵션이 모두 예약을 선택했거나 모두 일반 재고이고, 예약이면 접수 시작·종료·발송 예정일이 같아야 한다.
  if (exists(select 1 from public.goods_variants where good_id=p_good_id and archived_at is null and preorder_policy_id is null)
      and exists(select 1 from public.goods_variants where good_id=p_good_id and archived_at is null and preorder_policy_id is not null))
    or (select count(distinct format('%s|%s|%s',policy.starts_at,policy.ends_at,policy.expected_ship_date))
      from public.goods_variants variant join private.goods_preorder_policies policy on policy.id=variant.preorder_policy_id
      where variant.good_id=p_good_id and variant.archived_at is null)>1 then
    return 'random_option_preorder_mismatch';
  end if;
  if (select count(distinct price) from public.goods_variants where good_id=p_good_id and archived_at is null)>1
    or (select count(distinct coalesce(schedule.signature,'')) from public.goods_variants variant
      cross join lateral (select string_agg(format('%s|%s|%s',period.starts_at,period.ends_at,period.discount_price),','
          order by period.starts_at,period.ends_at,period.discount_price) signature
        from private.goods_variant_price_periods period
        where period.variant_id=variant.id and period.state='active' and period.ends_at>clock_timestamp()) schedule
      where variant.good_id=p_good_id and variant.archived_at is null)>1 then
    return 'random_option_price_mismatch';
  end if;
  -- 같은 옵션 배정 상한: 고객은 옵션을 고르지 않으므로 판매 중 모든 옵션이 같은 값이어야 한다(null = 상한 없음).
  if (select count(distinct format('%s|%s',order_max_qty,member_max_qty)) from public.goods_variants
    where good_id=p_good_id and archived_at is null)>1 then
    return 'random_option_limit_mismatch';
  end if;
  if good.custom_inputs_enabled then return 'random_option_custom_inputs'; end if;
  if exists(select 1 from private.goods_aggregation_members where good_id=p_good_id or root_good_id=p_good_id)
    or exists(select 1 from private.goods_aggregation_roots where root_good_id=p_good_id) then
    return 'random_option_aggregation';
  end if;
  if exists(select 1 from private.goods_group_members where good_id=p_good_id)
    or exists(select 1 from private.goods_groups where common_good_id=p_good_id) then
    return 'random_option_group';
  end if;
  return null;
end $$;
revoke all on function private.goods_random_option_problem(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_random_option_problem(text) to postgres;

-- 2. 풀 공급 -------------------------------------------------------------------------------------------
-- 랜덤 굿즈의 고객용 공급 한 줄. 모양은 private.resolve_goods_variant_supply와 같다.
--   일반 재고: availableQty = 판매 중 옵션 재고 합.
--   예약: 접수 기간·발송 예정일은 모든 옵션이 같다(조건 함수). availableQty = 접수 중인 옵션의 남은 예약 물량 합(접수 중이 아니면 0),
--   state = 모든 정책이 중지면 stopped, 아니면 공통 기간 기준(scheduled·open·closed). policyId·policyRevision은 기본 옵션(장바구니 키)의
--   선택 정책이다(옵션별 정책을 드러내지 않는다). 기본 옵션이 판매 중이 아니면 행이 없다.
create function private.random_option_pool_supply(p_good_id text,p_at timestamptz)
returns table(mode text,available_qty integer,policy_id uuid,policy_revision integer,state text,
  starts_at timestamptz,ends_at timestamptz,expected_ship_date date,next_change_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare key_supply record; total bigint; any_active boolean;
begin
  if p_at is null then raise invalid_parameter_value using message='supply_time_required'; end if;
  select supply.* into key_supply from public.goods_variants key_variant
    cross join lateral private.resolve_goods_variant_supply(key_variant.id,p_at) supply
    where key_variant.good_id=p_good_id and key_variant.is_default and key_variant.archived_at is null
    limit 1;
  if not found then return; end if;
  select least(coalesce(sum(greatest(supply.available_qty,0)::bigint),0),2147483647),coalesce(bool_or(policy.state='active'),false)
    into total,any_active
    from public.goods_variants variant
    cross join lateral private.resolve_goods_variant_supply(variant.id,p_at) supply
    left join private.goods_preorder_policies policy on policy.id=supply.policy_id
    where variant.good_id=p_good_id and variant.archived_at is null and supply.mode=key_supply.mode;
  if key_supply.mode='stock' then
    return query select 'stock'::text,total::integer,null::uuid,null::integer,'stock'::text,
      null::timestamptz,null::timestamptz,null::date,null::timestamptz;
    return;
  end if;
  return query select 'preorder'::text,
    case when any_active and p_at>=key_supply.starts_at and p_at<key_supply.ends_at then total::integer else 0 end,
    key_supply.policy_id,key_supply.policy_revision,
    case when not any_active then 'stopped' when p_at<key_supply.starts_at then 'scheduled'
      when p_at>=key_supply.ends_at then 'closed' else 'open' end,
    key_supply.starts_at,key_supply.ends_at,key_supply.expected_ship_date,
    case when not any_active then null when p_at<key_supply.starts_at then key_supply.starts_at
      when p_at<key_supply.ends_at then key_supply.ends_at else null end;
end $$;
revoke all on function private.random_option_pool_supply(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.random_option_pool_supply(text,timestamptz) to postgres;

-- 풀 합계: 일반 재고·예약 모두 위 공급의 availableQty다(호출자가 랜덤 여부를 본다).
create or replace function private.random_option_pool_qty(p_good_id text,p_at timestamptz) returns integer
language sql stable security definer set search_path='' as $$
  select coalesce((select pool.available_qty from private.random_option_pool_supply(p_good_id,p_at) pool),0);
$$;
revoke all on function private.random_option_pool_qty(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.random_option_pool_qty(text,timestamptz) to postgres;

-- 공개 공급 계산 열: 랜덤 굿즈 옵션은 공급 전체가 풀 기준이다(옵션 id로 직접 불러도 같다). 다른 굿즈는 20261105093418 본문 그대로다.
create or replace function public.goods_variant_supply(variant public.goods_variants) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('mode',supply.mode,'availableQty',supply.available_qty,'policyId',supply.policy_id,
    'policyRevision',supply.policy_revision,'state',supply.state,'startsAt',supply.starts_at,'endsAt',supply.ends_at,
    'expectedShipDate',supply.expected_ship_date,'calculatedAt',statement_timestamp(),'nextChangeAt',supply.next_change_at)
  from public.goods_variants current_variant join public.goods good on good.id=current_variant.good_id join public.ips ip on ip.id=good.ip_id
    cross join lateral (
      select pool.* from private.random_option_pool_supply(good.id,statement_timestamp()) pool where good.option_sale_mode='random'
      union all
      select own.* from private.resolve_goods_variant_supply(current_variant.id,statement_timestamp()) own where good.option_sale_mode<>'random'
    ) supply
  where current_variant.id=variant.id and current_variant.archived_at is null and good.published_at is not null and good.archived_at is null
    and private.good_sale_restriction_visible(good.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null;
$$;
revoke all on function public.goods_variant_supply(public.goods_variants) from public,anon,authenticated,service_role;
grant execute on function public.goods_variant_supply(public.goods_variants) to anon,authenticated;

-- 고객용 랜덤 한 줄. 20261028160200 본문에 한도 두 가지를 더한다.
--   order_max_qty·member_max_qty: 랜덤 줄 하나의 정적 상한(판매 중 옵션 수 × 같은 옵션 배정 상한). 담기 스테퍼·한도 문구가 쓴다.
--   allocation_limit: 같은 옵션 배정 상한 그 자체(상품 상세 안내 문구용).
create or replace function public.goods_random_option(good public.goods) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',key_variant.id,'name','랜덤','code','','price',key_variant.price,
    'stock_qty',(select coalesce(sum(pool_variant.stock_qty::bigint),0) from public.goods_variants pool_variant
      where pool_variant.good_id=current_good.id and pool_variant.archived_at is null),
    'is_default',true,'attributes','{}'::jsonb,'archived_at',null,'sort_order',0,
    'order_max_qty',case when key_variant.order_max_qty is null then null else least(key_variant.order_max_qty::bigint*pool.option_count,2147483647) end,
    'member_max_qty',case when key_variant.member_max_qty is null then null else least(key_variant.member_max_qty::bigint*pool.option_count,2147483647) end,
    'allocation_limit',jsonb_build_object('orderMaxQty',key_variant.order_max_qty,'memberMaxQty',key_variant.member_max_qty),
    'pricing',public.goods_variant_pricing(key_variant),'supply',public.goods_variant_supply(key_variant))
  from public.goods current_good
  join public.ips ip on ip.id=current_good.ip_id
  join public.goods_variants key_variant on key_variant.good_id=current_good.id and key_variant.is_default and key_variant.archived_at is null
  cross join lateral (select count(*) option_count from public.goods_variants counted
    where counted.good_id=current_good.id and counted.archived_at is null) pool
  where current_good.id=good.id and current_good.option_sale_mode='random' and current_good.archived_at is null
    and current_good.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null;
$$;
revoke all on function public.goods_random_option(public.goods) from public,anon,authenticated,service_role;
grant execute on function public.goods_random_option(public.goods) to anon,authenticated;

-- 배송비 절약 추천: 랜덤 후보는 예약이어도 풀 기준이다(옵션별 남은 예약 물량으로 후보가 갈리지 않게).
do $patch$
declare definition text;
  target constant regprocedure:='public.get_product_shipping_savings(text,uuid,integer)'::regprocedure;
  anchor constant text:=$old$case when g.option_sale_mode='random' and resolved.mode='stock'$old$;
begin
  definition:=pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'shipping_savings_random_preorder_anchor_changed'; end if;
  execute replace(definition,anchor,$new$case when g.option_sale_mode='random'$new$);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $patch$;

-- 3. 배정 ------------------------------------------------------------------------------------------------
-- 20261028160100의 배정에 예약 공급과 같은 옵션 배정 상한을 더한다. 호출자(legacy 주문 코어)는 회원·장바구니 잠금과
-- 굿즈 행 FOR UPDATE를 쥐고 있다. 반환값은 배정 행 소계.
--   풀: 판매 중 옵션 전부(id 순 FOR UPDATE). 공급 방식이 섞이거나 옵션 가격이 다르면 random_option_unavailable.
--   예약: 접수 중인 옵션이 없으면 preorder_sale_not_open, 남은 예약 물량 합이 모자라면 preorder_capacity_exceeded.
--   상한: 옵션별 잔여 = min(주문당 상한 - 이 주문의 앞선 행, 1인 상한 - 회원 누적(결제 대기 포함)). 가능 수량이 모자라면 추출 전에
--   random_option_limit_exceeded. 추출은 상한에 닿지 않은 옵션의 남은 물량에 비례한다(상한이 없으면 20261028160100과 같다).
--   한 번 뽑을 때마다 가능 수량이 정확히 1 줄므로 미리 판정한 가능 수량이 있으면 추출 중에 막히지 않는다.
create or replace function private.allocate_random_option_items(p_order_id uuid,p_user_id uuid,p_cart_item_id uuid,p_good_id text,
  p_cart_variant_id uuid,p_qty integer,p_at timestamptz,p_custom_inputs jsonb,p_sales_policy jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare good public.goods; key_price record; candidate record; supply record; price record;
  pool_ids uuid[]:='{}'; pool_left integer[]:='{}'; pool_cap bigint[]:='{}'; pool_before jsonb:='[]'; counts integer[];
  pool_mode text; any_open boolean:=false; remaining bigint:=0; feasible bigint:=0; weight bigint; cap bigint; in_order bigint;
  roll bigint; walk bigint; slot integer; allocated jsonb:='[]';
  draw_rolls bigint[]; draw_bounds bigint[]; draw_slots integer[]; slot_draws jsonb[];
  draw uuid:=pg_catalog.gen_random_uuid(); item_id uuid; subtotal bigint:=0; step integer;
  rng constant text:='pgcrypto.gen_random_bytes:rejection';
begin
  if p_qty is null or p_qty<1 then raise check_violation using message='invalid cart item'; end if;
  select * into good from public.goods where id=p_good_id;
  if not found or good.option_sale_mode<>'random' then
    raise check_violation using message=format('random_option_unavailable: %s',p_good_id);
  end if;
  select * into key_price from private.resolve_goods_variant_price(p_cart_variant_id,p_at);
  for candidate in select v.id,v.order_max_qty,v.member_max_qty from public.goods_variants v
    where v.good_id=p_good_id and v.archived_at is null order by v.id for update loop
    select * into supply from private.resolve_goods_variant_supply(candidate.id,p_at);
    select * into price from private.resolve_goods_variant_price(candidate.id,p_at);
    -- 견적은 장바구니 키 옵션 가격으로 보였다. 배정 옵션 가격이 다르면 청구가 달라지므로 주문하지 않는다.
    -- 일반 재고·예약이 섞이면 배정에 따라 발송 약속이 달라지므로 주문하지 않는다(조건 함수가 저장도 막는다).
    if (pool_mode is not null and supply.mode<>pool_mode) or price.effective_price is distinct from key_price.effective_price
      or price.regular_price is distinct from key_price.regular_price then
      raise check_violation using message=format('random_option_unavailable: %s',p_good_id);
    end if;
    pool_mode:=supply.mode;
    any_open:=any_open or supply.state='open';
    cap:=null;
    if candidate.order_max_qty is not null then
      select coalesce(sum(item.qty::bigint),0) into in_order from public.order_items item
        where item.order_id=p_order_id and item.variant_id=candidate.id;
      cap:=greatest(candidate.order_max_qty-in_order,0);
    end if;
    if candidate.member_max_qty is not null then
      cap:=least(coalesce(cap,9223372036854775807),
        greatest(candidate.member_max_qty-private.member_variant_reserved_qty(p_user_id,candidate.id),0));
    end if;
    pool_ids:=pool_ids||candidate.id;
    pool_left:=pool_left||greatest(supply.available_qty,0);
    pool_cap:=array_append(pool_cap,cap);
    -- 증빙 모양은 상한이 없으면 20261028160100과 같다. 상한이 있으면 그 옵션의 배정 가능 잔여(capQty)를 더한다.
    pool_before:=pool_before||jsonb_build_array(jsonb_build_object('variantId',candidate.id,'availableQty',greatest(supply.available_qty,0))
      ||case when cap is null then '{}'::jsonb else jsonb_build_object('capQty',cap) end);
    remaining:=remaining+greatest(supply.available_qty,0);
    feasible:=feasible+least(greatest(supply.available_qty,0)::bigint,coalesce(cap,9223372036854775807));
  end loop;
  if cardinality(pool_ids)<2 then raise check_violation using message=format('random_option_unavailable: %s',p_good_id); end if;
  if pool_mode='preorder' then
    if not any_open then raise check_violation using message='preorder_sale_not_open'; end if;
    if remaining<p_qty then raise check_violation using message='preorder_capacity_exceeded'; end if;
  elsif remaining<p_qty then
    raise check_violation using message=format('out of stock: %s',p_good_id);
  end if;
  if feasible<p_qty then raise check_violation using message=format('random_option_limit_exceeded: %s',p_good_id); end if;
  counts:=array_fill(0,array[cardinality(pool_ids)]);
  -- 추출 근거는 고정 길이 배열에 모은다(원소 대입은 제자리라 수량에 선형). jsonb 변환은 루프 뒤 한 번이다.
  draw_rolls:=array_fill(0::bigint,array[p_qty]); draw_bounds:=array_fill(0::bigint,array[p_qty]); draw_slots:=array_fill(0,array[p_qty]);
  for step in 1..p_qty loop
    weight:=0;
    for slot in 1..cardinality(pool_ids) loop
      if pool_cap[slot] is null or counts[slot]<pool_cap[slot] then weight:=weight+pool_left[slot]; end if;
    end loop;
    roll:=private.random_below(weight);
    walk:=roll; slot:=1;
    loop
      if pool_cap[slot] is null or counts[slot]<pool_cap[slot] then
        exit when walk<pool_left[slot];
        walk:=walk-pool_left[slot];
      end if;
      slot:=slot+1;
    end loop;
    draw_rolls[step]:=roll; draw_bounds[step]:=weight; draw_slots[step]:=slot;
    pool_left[slot]:=pool_left[slot]-1; counts[slot]:=counts[slot]+1;
  end loop;
  -- 배정 행마다 그 옵션에 떨어진 추출만 담는다(같은 근거를 행마다 복사하지 않는다). 풀 순서(slot)대로 한 번에 묶는다.
  select array_agg(coalesce(grouped.steps,'[]'::jsonb) order by slot_index.value) into slot_draws
  from generate_series(1,cardinality(pool_ids)) slot_index(value)
  left join (select drawn.slot_no,jsonb_agg(jsonb_build_object('step',drawn.step,'roll',drawn.roll,'bound',drawn.bound,
        'variantId',pool_ids[drawn.slot_no]) order by drawn.step) steps
      from unnest(draw_rolls,draw_bounds,draw_slots) with ordinality drawn(roll,bound,slot_no,step)
      group by drawn.slot_no) grouped on grouped.slot_no=slot_index.value;
  for slot in 1..cardinality(pool_ids) loop
    continue when counts[slot]=0;
    select * into supply from private.resolve_goods_variant_supply(pool_ids[slot],p_at);
    select * into price from private.resolve_goods_variant_price(pool_ids[slot],p_at);
    if supply.mode='stock' then
      perform private.change_goods_variant_stock(p_good_id,pool_ids[slot],-counts[slot]::bigint);
    end if;
    insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,
      regular_unit_price_snapshot,price_period_id,price_evaluated_at,sales_policy_snapshot,supply_source,preorder_policy_id,
      preorder_expected_ship_date,preorder_snapshot,custom_inputs_snapshot,option_sale_mode_snapshot)
    values(p_order_id,p_good_id,pool_ids[slot],counts[slot],price.effective_price,good.name,good.type,good.ip_id,
      price.regular_price,price.price_period_id,p_at,p_sales_policy,supply.mode,supply.policy_id,supply.expected_ship_date,
      case when supply.mode='preorder' then jsonb_build_object('version',1,'policyId',supply.policy_id,
        'policyRevision',supply.policy_revision,'startsAt',supply.starts_at,'endsAt',supply.ends_at,
        'expectedShipDate',supply.expected_ship_date) end,
      p_custom_inputs,'random')
    returning id into item_id;
    if supply.mode='preorder' then
      perform private.reserve_goods_preorder_item(item_id,p_at);
    end if;
    insert into private.order_item_random_allocations(order_item_id,order_id,user_id,good_id,draw_id,cart_item_id,cart_variant_id,
      variant_id,qty,pool_before,draws,rng)
    values(item_id,p_order_id,p_user_id,p_good_id,draw,p_cart_item_id,p_cart_variant_id,pool_ids[slot],counts[slot],pool_before,slot_draws[slot],rng);
    allocated:=allocated||jsonb_build_array(jsonb_build_object('orderItemId',item_id,'variantId',pool_ids[slot],'qty',counts[slot]));
    subtotal:=subtotal+price.effective_price::bigint*counts[slot];
  end loop;
  insert into public.audit_log(actor_id,action,target,diff) values(p_user_id,'order.random_option_allocated','order:'||p_order_id,
    jsonb_build_object('drawId',draw,'goodId',p_good_id,'cartVariantId',p_cart_variant_id,'qty',p_qty,'rng',rng,
      'supplySource',pool_mode,'pool',pool_before,'allocations',allocated));
  return subtotal;
end $$;
revoke all on function private.allocate_random_option_items(uuid,uuid,uuid,text,uuid,integer,timestamptz,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.allocate_random_option_items(uuid,uuid,uuid,text,uuid,integer,timestamptz,jsonb,jsonb) to postgres;

-- 4. 장바구니·견적 -----------------------------------------------------------------------------------------
-- 장바구니 담기: 랜덤 굿즈의 가용 수량은 예약이어도 풀 합계다(현재 본문에 앵커 치환).
do $patch$
declare definition text;
  target constant regprocedure:='private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb)'::regprocedure;
  anchor constant text:=$old$    select coalesce(sum(supply.available_qty),0)::integer into available_stock from public.goods_variants variant
      cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
      where variant.good_id=p_good_id and variant.archived_at is null and supply.mode='stock';$old$;
begin
  definition:=pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'set_cart_random_preorder_anchor_changed'; end if;
  execute replace(definition,anchor,$new$    -- 일반 재고·예약 모두 풀 합계(예약은 접수 중일 때만 남은 예약 물량 합).
    available_stock:=private.random_option_pool_qty(p_good_id,statement_timestamp());$new$);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $patch$;

-- legacy 장바구니 견적. 랜덤 줄(20261028160100):
--   supply는 goods_variant_supply가 이미 풀로 답한다(일반 재고·예약). available = 같은 굿즈 줄 수량 합 ≤ 풀.
--   optionLimit = 랜덤 줄의 정적 상한(판매 중 옵션 수 × 같은 옵션 배정 상한)과 회원의 이 굿즈 누적 수량(옵션 합이라 배정과 무관).
--   옵션별 누적은 내보내지 않는다 — 결제 대기 주문의 배정 옵션이 드러난다.
create or replace function public.quote_goods_sales(items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare quote jsonb; lines jsonb:='[]'; line jsonb; supply jsonb; next_change timestamptz; selling boolean; shipping_quote jsonb;
  variant public.goods_variants; actor uuid:=auth.uid(); reserved bigint; limit_reason text; sale_mode text; good_qty bigint; available boolean;
  option_count bigint; order_max bigint; member_max bigint;
begin
  quote:=private.quote_goods_sales_before_preorder(items);
  next_change:=(quote->>'nextChangeAt')::timestamptz;
  for line in select value from jsonb_array_elements(quote->'lines') loop
    select public.goods_variant_supply(v),good.stock<>'soldout',good.option_sale_mode into supply,selling,sale_mode
      from public.goods_variants v join public.goods good on good.id=v.good_id
      where v.id=(line->>'variantId')::uuid and good.id=line->>'goodId';
    if supply is null then raise check_violation using message='sales_quote_variant_unavailable'; end if;
    select * into variant from public.goods_variants where id=(line->>'variantId')::uuid;
    if sale_mode='random' then
      select coalesce(sum((other->>'qty')::bigint),0) into good_qty from jsonb_array_elements(quote->'lines') other where other->>'goodId'=line->>'goodId';
      available:=selling and good_qty<=(supply->>'availableQty')::bigint;
      select count(*) into option_count from public.goods_variants where good_id=variant.good_id and archived_at is null;
      order_max:=case when variant.order_max_qty is null then null else least(variant.order_max_qty::bigint*option_count,2147483647) end;
      member_max:=case when variant.member_max_qty is null then null else least(variant.member_max_qty::bigint*option_count,2147483647) end;
      reserved:=case when actor is null or member_max is null then null else (select coalesce(sum(item.qty::bigint),0)
        from public.orders o join public.order_items item on item.order_id=o.id
        where o.user_id=actor and o.status<>'canceled' and item.good_id=variant.good_id) end;
      limit_reason:=case
        when order_max is not null and good_qty>order_max then 'option_order_limit_exceeded'
        when reserved is not null and reserved+good_qty>member_max then 'option_member_limit_exceeded' end;
    else
      available:=selling and (line->>'qty')::bigint<=(supply->>'availableQty')::integer;
      order_max:=variant.order_max_qty; member_max:=variant.member_max_qty;
      reserved:=case when actor is null or variant.member_max_qty is null then null
        else private.member_variant_reserved_qty(actor,variant.id) end;
      limit_reason:=case
        when variant.order_max_qty is not null and (line->>'qty')::bigint>variant.order_max_qty then 'option_order_limit_exceeded'
        when reserved is not null and reserved+(line->>'qty')::bigint>variant.member_max_qty then 'option_member_limit_exceeded' end;
    end if;
    lines:=lines||jsonb_build_array(line||jsonb_build_object('supply',supply,'available',available,'optionSaleMode',sale_mode,
      'optionLimit',jsonb_build_object('orderMaxQty',order_max,'memberMaxQty',member_max,
        'memberReservedQty',reserved,'memberRemainingQty',case when reserved is null then null else greatest(0,member_max-reserved) end,
        'reason',limit_reason)));
    next_change:=least(next_change,(supply->>'nextChangeAt')::timestamptz);
  end loop;
  shipping_quote:=public.quote_goods_shipping(items);
  return quote||jsonb_build_object('lines',lines,'nextChangeAt',next_change,'shipping',shipping_quote,
    'coupon',private.quote_selected_coupon(lines,(quote->>'subtotal')::bigint,(shipping_quote->>'totalFee')::bigint));
end $$;
revoke all on function public.quote_goods_sales(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_goods_sales(jsonb) to anon,authenticated,postgres;

-- 5. 운영자 일괄 예약 저장 -----------------------------------------------------------------------------------
-- 랜덤 굿즈의 옵션별 예약 저장을 한 트랜잭션으로 묶는다. 옵션마다 기존 RPC(admin_save_goods_preorder·admin_use_stock_supply)를
-- 부르므로 입력 검증·낙관 잠금(정책 revision)·권한(활성화·일반 재고 전환은 platform.manage)·감사는 옵션 단위로 그대로 남는다.
--   p_state draft·active: p_values = 공통 {startsAt, endsAt, expectedShipDate, approvalReference}, p_options = 판매 중 옵션 전부
--     [{variantId, policyId(이어 쓸 초안·없으면 null), expectedRevision, capacityQty}].
--   p_state stopped: p_options = 접수 중(active) 선택 정책이 있는 판매 중 옵션 전부 [{variantId, policyId, expectedRevision}].
--   p_state stock: p_options = 예약을 선택한 판매 중 옵션 전부 [{variantId, policyId, expectedRevision}].
-- 대상 집합이 다르면 random_preorder_options_mismatch. 커밋에서 랜덤 조건(같은 일정)을 다시 판정한다.
create function public.admin_save_random_goods_preorders(p_good_id text,p_state text,p_values jsonb,p_options jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; good public.goods; entry jsonb; listed uuid[]:='{}'; expected uuid[]; saved jsonb; results jsonb:='[]';
  uuid_pattern constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  actor:=private.require_operator_capability('catalog.manage',false);
  if nullif(btrim(p_good_id),'') is null or p_state is null or p_state not in ('draft','active','stopped','stock')
    or jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) not between 1 and 100
    or (p_state in ('draft','active') and (jsonb_typeof(p_values) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(p_values) key where key not in ('startsAt','endsAt','expectedShipDate','approvalReference')))) then
    raise invalid_parameter_value using message='invalid_random_preorder';
  end if;
  for entry in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(entry) key where key not in ('variantId','policyId','expectedRevision','capacityQty'))
      or jsonb_typeof(entry->'variantId') is distinct from 'string' or entry->>'variantId' !~ uuid_pattern
      or (coalesce(entry->'policyId','null'::jsonb)<>'null'::jsonb
        and (jsonb_typeof(entry->'policyId')<>'string' or entry->>'policyId' !~ uuid_pattern))
      or (coalesce(entry->'expectedRevision','null'::jsonb)<>'null'::jsonb
        and (jsonb_typeof(entry->'expectedRevision')<>'number' or entry->>'expectedRevision' !~ '^[1-9][0-9]{0,8}$'))
      or (p_state not in ('draft','active') and entry ? 'capacityQty') then
      raise invalid_parameter_value using message='invalid_random_preorder';
    end if;
    listed:=listed||(entry->>'variantId')::uuid;
  end loop;
  if cardinality(listed)<>(select count(distinct value) from unnest(listed) value) then
    raise invalid_parameter_value using message='invalid_random_preorder';
  end if;
  select * into good from public.goods where id=p_good_id for update;
  if not found or good.archived_at is not null then raise no_data_found using message='good_not_found'; end if;
  if good.option_sale_mode<>'random' then raise check_violation using message='random_option_required'; end if;
  perform 1 from public.goods_variants where good_id=p_good_id order by id for update;
  select coalesce(array_agg(variant.id order by variant.id),'{}') into expected from public.goods_variants variant
    left join private.goods_preorder_policies policy on policy.id=variant.preorder_policy_id
    where variant.good_id=p_good_id and variant.archived_at is null
      and (p_state in ('draft','active') or (p_state='stopped' and policy.state='active')
        or (p_state='stock' and variant.preorder_policy_id is not null));
  if cardinality(expected)=0 or (select array_agg(value order by value) from unnest(listed) value) is distinct from expected then
    raise check_violation using message='random_preorder_options_mismatch';
  end if;
  for entry in select value from jsonb_array_elements(p_options) order by value->>'variantId' loop
    if p_state='stock' then
      saved:=public.admin_use_stock_supply(p_good_id,(entry->>'variantId')::uuid,(entry->>'policyId')::uuid,(entry->>'expectedRevision')::integer);
    elsif p_state='stopped' then
      saved:=public.admin_save_goods_preorder(p_good_id,(entry->>'variantId')::uuid,(entry->>'policyId')::uuid,
        jsonb_build_object('state','stopped'),(entry->>'expectedRevision')::integer);
    else
      saved:=public.admin_save_goods_preorder(p_good_id,(entry->>'variantId')::uuid,(entry->>'policyId')::uuid,
        p_values||jsonb_build_object('state',p_state,'capacityQty',coalesce(entry->'capacityQty','null'::jsonb)),
        (entry->>'expectedRevision')::integer);
    end if;
    results:=results||jsonb_build_array(jsonb_build_object('variantId',entry->>'variantId')||saved);
  end loop;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.random_preorders_saved','goods:'||p_good_id,
    jsonb_build_object('state',p_state,'values',case when p_state in ('draft','active') then p_values end,'results',results));
  return jsonb_build_object('goodId',p_good_id,'state',p_state,'results',results);
end $$;
revoke all on function public.admin_save_random_goods_preorders(text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_random_goods_preorders(text,text,jsonb,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_random_goods_preorders(text,text,jsonb,jsonb)'::regprocedure,'catalog.manage','write',false);

commit;
notify pgrst,'reload schema';
