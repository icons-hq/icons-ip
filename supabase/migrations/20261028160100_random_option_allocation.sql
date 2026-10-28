-- 10/27 회의 D5②(R24): 랜덤 판매 굿즈의 주문 시점 시스템 배정.
--
-- 판매 방식 goods.option_sale_mode = 'select'(지금처럼 고객이 옵션을 고름) | 'random'(고객은 '랜덤' 한 줄로 담고,
-- 주문을 만들 때 DB가 같은 굿즈의 활성 옵션 재고에서 무작위로 배정). 기존 굿즈·주문은 바뀌지 않는다(기본값 'select', 품목 스냅샷 null).
--
-- 배정(legacy 주문 코어 private.place_order_before_shipments의 랜덤 분기 → private.allocate_random_option_items):
--   굿즈 행은 코어가 이미 FOR UPDATE로 잡고 있다. 같은 굿즈의 활성 옵션 전체를 id 순 FOR UPDATE하고(잠금 순서 규약
--   goods → goods_variants(id)와 같다), 단위마다 남은 재고에 비례해 비복원 추출한다. 난수는 pgcrypto
--   extensions.gen_random_bytes 4바이트를 거부 추출해 [0, 남은 합계) 균등 정수로 쓴다(random()은 암호학적 난수가 아니다).
--   옵션별로 묶어 change_goods_variant_stock(-k)와 order_items(variant_id=배정 옵션, option_sale_mode_snapshot='random')를
--   만들고, 증빙 private.order_item_random_allocations(풀 스냅샷·추출 근거)와 감사 order.random_option_allocated를 남긴다.
--   추출 근거는 루프에서 배열로 모아 끝에 한 번만 jsonb로 만들고, 배정 행마다 그 옵션에 떨어진 추출만 담는다(중복 저장 없음).
--   같은 draw_id의 행을 step 순으로 합치면 전체 추출 순서다. 그래서 비용은 수량에 선형이고 잠금을 오래 쥐지 않는다.
--   checkout_key 재생은 배정보다 앞에서 끝나므로 같은 요청 재시도는 다시 뽑지 않는다. 실패하면 트랜잭션 전체가 롤백된다.
--   재고 복원·어드민 주문·출고 파일·ERP 식별자는 order_items.variant_id(배정 옵션)를 그대로 쓴다.
--
-- 랜덤 조건(전용 setter와 지연 제약 트리거가 같은 함수 private.goods_random_option_problem으로 판정):
--   활성 옵션 2개 이상, 기본 옵션(장바구니 키) 활성, 예약판매 옵션 없음, 활성 옵션 가격 동일(옵션가와 진행·예정 기간 할인의
--   시작·종료·할인가 묶음이 모든 옵션에서 같음), 옵션별 구매 제한 없음, 직접입력 없음, 합산 패밀리·그룹상품 아님.
--   랜덤 굿즈에서 이 조건을 깨는 저장(옵션 가격·판매 중지·기간 할인 한 옵션만 저장 등)은 커밋에서 거절된다.
--   기간 할인은 모든 활성 옵션에 같은 값을 한 트랜잭션으로 넣어야 한다(상품 목록 일괄 할인 경로).
--
-- 장바구니 키: 랜덤 굿즈는 기본 옵션(is_default) 한 줄이다. 다른 옵션 id로 담아도 기본 옵션 줄로 모은다. 가용 수량은 풀 합계.
-- 견적 public.quote_goods_sales: line.optionSaleMode, 랜덤 줄의 supply.availableQty = 풀 합계, available = 같은 굿즈 수량 합 ≤ 풀.
-- 거래 런타임(선물·정기구독 포함)은 랜덤 굿즈를 goods_unavailable 이슈로 막고, order_items 가드가 배정 없는 랜덤 행을 거절한다.
--
-- 고객 은닉(배정 결과는 DB에서도 고객에게 숨긴다 — 결제 대기 주문을 닫고 다시 주문하는 재추첨을 막는다):
--   order_items에 restrictive select 정책(랜덤 행은 sales.read 운영자만). 고객 화면은 마스킹 RPC public.my_order_items(uuid[])로 읽는다
--   (랜덤 행은 옵션명 '랜덤', variant_id = 주문 때의 장바구니 키(기본 옵션), 옵션 코드 null). 공개 리뷰의 구매 옵션명도 '랜덤'이다.
--   service role 경로(메일)는 앱 코드가 option_sale_mode_snapshot으로 마스킹한다.
--   옵션별 재고(배정 전후 차이로 배정 옵션이 드러나는 경로)의 은닉은 20261028160200이 맡는다.
begin;

-- 1. 스키마 ---------------------------------------------------------------------------------------------
alter table public.goods add column option_sale_mode text not null default 'select'
  constraint goods_option_sale_mode_check check (option_sale_mode in ('select','random'));
comment on column public.goods.option_sale_mode is '옵션 판매 방식. select = 고객이 옵션 선택, random = 주문 때 재고 비례 무작위 배정(D5②).';

alter table public.order_items add column option_sale_mode_snapshot text
  constraint order_items_option_sale_mode_snapshot_check check (option_sale_mode_snapshot is null or option_sale_mode_snapshot='random');
comment on column public.order_items.option_sale_mode_snapshot is '랜덤 배정 행이면 random. 고객 직접 읽기에서 숨기는 근거다.';

create table private.order_item_random_allocations (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null,
  good_id text not null,
  draw_id uuid not null,
  cart_item_id uuid,
  cart_variant_id uuid not null,
  variant_id uuid not null,
  qty integer not null check (qty>0),
  pool_before jsonb not null check (jsonb_typeof(pool_before)='array'),
  draws jsonb not null check (jsonb_typeof(draws)='array'),
  rng text not null,
  allocated_at timestamptz not null default clock_timestamp()
);
create index order_item_random_allocations_order_idx on private.order_item_random_allocations(order_id);
comment on column private.order_item_random_allocations.pool_before is '배정 직전 활성 옵션 풀(variantId·availableQty, id 순). 같은 draw_id의 행은 같은 값이다.';
comment on column private.order_item_random_allocations.draws is
  '이 행(배정 옵션)에 떨어진 추출만 step 순으로 담는다({step,roll,bound,variantId}). 같은 draw_id의 행을 step 순으로 합치면 전체 추출 순서다.';
alter table private.order_item_random_allocations enable row level security;
revoke all on table private.order_item_random_allocations from public,anon,authenticated,service_role;

-- 2. 난수: [0, p_bound) 균등 정수. 4바이트(0..2^32-1)에서 p_bound의 배수 구간만 받아 나머지를 쓴다.
create function private.random_below(p_bound bigint) returns bigint
language plpgsql volatile set search_path='' as $$
declare accept_below bigint; drawn bigint;
begin
  if p_bound is null or p_bound<1 or p_bound>4294967296 then raise invalid_parameter_value using message='invalid_random_bound'; end if;
  accept_below:=4294967296-(4294967296%p_bound);
  loop
    drawn:=('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint;
    if drawn<accept_below then return drawn%p_bound; end if;
  end loop;
end $$;
revoke all on function private.random_below(bigint) from public,anon,authenticated,service_role;
grant execute on function private.random_below(bigint) to postgres;

-- 3. 랜덤 조건 ------------------------------------------------------------------------------------------
create function private.goods_random_option_problem(p_good_id text) returns text
language plpgsql stable security definer set search_path='' as $$
declare good public.goods;
begin
  select * into good from public.goods where id=p_good_id;
  if not found then return 'good_not_found'; end if;
  if (select count(*) from public.goods_variants where good_id=p_good_id and archived_at is null)<2 then return 'random_option_count'; end if;
  if not exists(select 1 from public.goods_variants where good_id=p_good_id and is_default and archived_at is null) then
    return 'random_option_default_inactive';
  end if;
  if exists(select 1 from public.goods_variants where good_id=p_good_id and archived_at is null and preorder_policy_id is not null) then
    return 'random_option_preorder';
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
  if exists(select 1 from public.goods_variants where good_id=p_good_id and archived_at is null
    and (order_max_qty is not null or member_max_qty is not null)) then
    return 'random_option_variant_limits';
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

-- 랜덤 굿즈의 조건을 깨는 쓰기를 커밋에서 거절한다. 옵션 저장은 행을 하나씩 바꾸므로 문장 끝이 아니라 커밋에서 판정한다.
create function private.guard_goods_option_sale_mode() returns trigger
language plpgsql security definer set search_path='' as $$
declare target text; problem text; candidates text[];
begin
  if tg_table_name='goods' then
    candidates:=array[new.id];
  else
    candidates:=array[
      case when tg_op<>'DELETE' then to_jsonb(new)->>'good_id' end,
      case when tg_op<>'INSERT' then to_jsonb(old)->>'good_id' end,
      case when tg_op<>'DELETE' then to_jsonb(new)->>'root_good_id' end,
      case when tg_op<>'DELETE' then to_jsonb(new)->>'common_good_id' end];
  end if;
  for target in select distinct candidate from unnest(candidates) candidate where candidate is not null loop
    if exists(select 1 from public.goods where id=target and option_sale_mode='random') then
      problem:=private.goods_random_option_problem(target);
      if problem is not null then raise check_violation using message=problem; end if;
    end if;
  end loop;
  return null;
end $$;
revoke all on function private.guard_goods_option_sale_mode() from public,anon,authenticated,service_role;
grant execute on function private.guard_goods_option_sale_mode() to postgres;

create constraint trigger goods_variants_option_sale_mode_guard
  after insert or delete or update of price,archived_at,is_default,preorder_policy_id,order_max_qty,member_max_qty,good_id on public.goods_variants
  deferrable initially deferred for each row execute function private.guard_goods_option_sale_mode();
create constraint trigger goods_variant_price_periods_option_sale_mode_guard
  after insert or update or delete on private.goods_variant_price_periods
  deferrable initially deferred for each row execute function private.guard_goods_option_sale_mode();
create constraint trigger goods_option_sale_mode_guard
  after update of option_sale_mode,custom_inputs_enabled on public.goods
  deferrable initially deferred for each row when (new.option_sale_mode='random') execute function private.guard_goods_option_sale_mode();
create constraint trigger goods_aggregation_members_option_sale_mode_guard after insert on private.goods_aggregation_members
  deferrable initially deferred for each row execute function private.guard_goods_option_sale_mode();
create constraint trigger goods_aggregation_roots_option_sale_mode_guard after insert on private.goods_aggregation_roots
  deferrable initially deferred for each row execute function private.guard_goods_option_sale_mode();
create constraint trigger goods_group_members_option_sale_mode_guard after insert or update on private.goods_group_members
  deferrable initially deferred for each row execute function private.guard_goods_option_sale_mode();
create constraint trigger goods_groups_option_sale_mode_guard after insert or update of common_good_id on private.goods_groups
  deferrable initially deferred for each row execute function private.guard_goods_option_sale_mode();

-- 4. 운영자 setter·조회 -------------------------------------------------------------------------------------
create function public.admin_set_goods_option_sale_mode(p_good_id text,p_mode text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; good public.goods; problem text; before_mode text;
begin
  actor:=private.require_operator_capability('catalog.manage',false);
  if nullif(btrim(p_good_id),'') is null or p_mode is null or p_mode not in ('select','random') or p_expected_updated_at is null then
    raise invalid_parameter_value using message='invalid_option_sale_mode';
  end if;
  select * into good from public.goods where id=p_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  if good.archived_at is not null then raise check_violation using message='catalog_archived'; end if;
  if good.updated_at is distinct from p_expected_updated_at then raise sqlstate 'PT409' using message='goods_changed'; end if;
  perform 1 from public.goods_variants where good_id=p_good_id order by id for update;
  if good.option_sale_mode<>p_mode then
    if p_mode='random' then
      problem:=private.goods_random_option_problem(p_good_id);
      if problem is not null then raise check_violation using message=problem; end if;
    end if;
    before_mode:=good.option_sale_mode;
    update public.goods set option_sale_mode=p_mode where id=p_good_id returning * into good;
    insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.option_sale_mode_changed','goods:'||p_good_id,
      jsonb_build_object('before',before_mode,'after',p_mode));
  end if;
  return jsonb_build_object('goodId',good.id,'optionSaleMode',good.option_sale_mode,'updatedAt',good.updated_at,'ipId',good.ip_id);
end $$;
revoke all on function public.admin_set_goods_option_sale_mode(text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_goods_option_sale_mode(text,text,timestamptz) to authenticated;
select private.register_operator_rpc_contract('public.admin_set_goods_option_sale_mode(text,text,timestamptz)'::regprocedure,'catalog.manage','write',false);

-- 판매 방식 패널용 조회. STABLE 조회는 읽기 전용 트랜잭션이라 잠금 없는 판정을 쓴다.
create function public.admin_goods_option_sale_mode(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare good public.goods;
begin
  if not coalesce(private.has_operator_capability(auth.uid(),'catalog.read',false),false) then
    raise insufficient_privilege using message='operator_capability_required';
  end if;
  select * into good from public.goods where id=p_good_id;
  if not found then raise no_data_found using message='good_not_found'; end if;
  return jsonb_build_object('goodId',good.id,'optionSaleMode',good.option_sale_mode,'updatedAt',good.updated_at,
    'randomProblem',private.goods_random_option_problem(good.id),
    'activeOptionCount',(select count(*) from public.goods_variants where good_id=good.id and archived_at is null));
end $$;
revoke all on function public.admin_goods_option_sale_mode(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_option_sale_mode(text) to authenticated;
select private.register_operator_rpc_contract('public.admin_goods_option_sale_mode(text)'::regprocedure,'catalog.read','read',false);

-- 랜덤 굿즈의 판매가는 하나다. 상품 판매가를 바꾸면(목록 인라인·일괄 변경) 기본 옵션만이 아니라 판매 중인 모든 옵션 가격을
-- 함께 바꿔 가격 균일 조건을 지킨다. 옵션 선택 굿즈는 지금처럼 기본 옵션만 따라간다.
do $patch$
declare definition text;
  target constant regprocedure:='private.sync_goods_default_variant()'::regprocedure;
  anchor constant text:=$old$where good_id = new.id and is_default and price is distinct from new.price;$old$;
begin
  definition:=pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'sync_default_variant_random_anchor_changed'; end if;
  execute replace(definition,anchor,$new$where good_id = new.id and (is_default or (new.option_sale_mode = 'random' and archived_at is null))
        and price is distinct from new.price;$new$);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $patch$;

-- 5. 배정 ------------------------------------------------------------------------------------------------
-- 호출자(legacy 주문 코어)는 회원·장바구니 잠금과 굿즈 행 FOR UPDATE를 쥐고 있다. 반환값은 배정 행 소계.
create function private.allocate_random_option_items(p_order_id uuid,p_user_id uuid,p_cart_item_id uuid,p_good_id text,
  p_cart_variant_id uuid,p_qty integer,p_at timestamptz,p_custom_inputs jsonb,p_sales_policy jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare good public.goods; key_price record; candidate record; supply record; price record;
  pool_ids uuid[]:='{}'; pool_left integer[]:='{}'; pool_before jsonb:='[]'; counts integer[];
  remaining bigint:=0; roll bigint; walk bigint; slot integer; allocated jsonb:='[]';
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
  for candidate in select v.id from public.goods_variants v where v.good_id=p_good_id and v.archived_at is null order by v.id for update loop
    select * into supply from private.resolve_goods_variant_supply(candidate.id,p_at);
    select * into price from private.resolve_goods_variant_price(candidate.id,p_at);
    -- 견적은 장바구니 키 옵션 가격으로 보였다. 배정 옵션 가격이 다르면 청구가 달라지므로 주문하지 않는다.
    if supply.mode<>'stock' or price.effective_price is distinct from key_price.effective_price
      or price.regular_price is distinct from key_price.regular_price then
      raise check_violation using message=format('random_option_unavailable: %s',p_good_id);
    end if;
    pool_ids:=pool_ids||candidate.id;
    pool_left:=pool_left||greatest(supply.available_qty,0);
    pool_before:=pool_before||jsonb_build_array(jsonb_build_object('variantId',candidate.id,'availableQty',greatest(supply.available_qty,0)));
    remaining:=remaining+greatest(supply.available_qty,0);
  end loop;
  if cardinality(pool_ids)<2 then raise check_violation using message=format('random_option_unavailable: %s',p_good_id); end if;
  if remaining<p_qty then raise check_violation using message=format('out of stock: %s',p_good_id); end if;
  counts:=array_fill(0,array[cardinality(pool_ids)]);
  -- 추출 근거는 고정 길이 배열에 모은다(원소 대입은 제자리라 수량에 선형). jsonb 변환은 루프 뒤 한 번이다.
  draw_rolls:=array_fill(0::bigint,array[p_qty]); draw_bounds:=array_fill(0::bigint,array[p_qty]); draw_slots:=array_fill(0,array[p_qty]);
  for step in 1..p_qty loop
    roll:=private.random_below(remaining);
    walk:=roll; slot:=1;
    while walk>=pool_left[slot] loop walk:=walk-pool_left[slot]; slot:=slot+1; end loop;
    draw_rolls[step]:=roll; draw_bounds[step]:=remaining; draw_slots[step]:=slot;
    pool_left[slot]:=pool_left[slot]-1; counts[slot]:=counts[slot]+1; remaining:=remaining-1;
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
    select * into price from private.resolve_goods_variant_price(pool_ids[slot],p_at);
    perform private.change_goods_variant_stock(p_good_id,pool_ids[slot],-counts[slot]::bigint);
    insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,
      regular_unit_price_snapshot,price_period_id,price_evaluated_at,sales_policy_snapshot,supply_source,preorder_policy_id,
      preorder_expected_ship_date,preorder_snapshot,custom_inputs_snapshot,option_sale_mode_snapshot)
    values(p_order_id,p_good_id,pool_ids[slot],counts[slot],price.effective_price,good.name,good.type,good.ip_id,
      price.regular_price,price.price_period_id,p_at,p_sales_policy,'stock',null,null,null,p_custom_inputs,'random')
    returning id into item_id;
    insert into private.order_item_random_allocations(order_item_id,order_id,user_id,good_id,draw_id,cart_item_id,cart_variant_id,
      variant_id,qty,pool_before,draws,rng)
    values(item_id,p_order_id,p_user_id,p_good_id,draw,p_cart_item_id,p_cart_variant_id,pool_ids[slot],counts[slot],pool_before,slot_draws[slot],rng);
    allocated:=allocated||jsonb_build_array(jsonb_build_object('orderItemId',item_id,'variantId',pool_ids[slot],'qty',counts[slot]));
    subtotal:=subtotal+price.effective_price::bigint*counts[slot];
  end loop;
  insert into public.audit_log(actor_id,action,target,diff) values(p_user_id,'order.random_option_allocated','order:'||p_order_id,
    jsonb_build_object('drawId',draw,'goodId',p_good_id,'cartVariantId',p_cart_variant_id,'qty',p_qty,'rng',rng,
      'pool',pool_before,'allocations',allocated));
  return subtotal;
end $$;
revoke all on function private.allocate_random_option_items(uuid,uuid,uuid,text,uuid,integer,timestamptz,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.allocate_random_option_items(uuid,uuid,uuid,text,uuid,integer,timestamptz,jsonb,jsonb) to postgres;

-- legacy 주문 코어: 장바구니 커서에 판매 방식을 싣고, 랜덤 굿즈 줄은 배정 함수로 보낸다(현재 유효 본문에 앵커 치환).
do $patch$
declare definition text; anchor text;
  target constant regprocedure:='private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure;
begin
  definition:=pg_get_functiondef(target);
  anchor:=$old$      good.archived_at
    from public.cart_items as cart$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'place_order_random_cursor_anchor_changed'; end if;
  definition:=replace(definition,anchor,$new$      good.archived_at,
      good.option_sale_mode
    from public.cart_items as cart$new$);

  anchor:=$old$    select * into v_price from private.resolve_goods_variant_price(v_variant.id,v_price_at);$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'place_order_random_branch_anchor_changed'; end if;
  definition:=replace(definition,anchor,$new$    -- 랜덤 판매 굿즈(D5②): 장바구니 키 옵션 대신 같은 굿즈의 활성 옵션 풀에서 배정한다.
    -- 굿즈 단위 수량 판정은 위에서 끝났고, 결제수단·판매 제한 판정은 일반 줄과 같다.
    if r.option_sale_mode = 'random' then
      if r.stock = 'soldout' then
        raise check_violation using message = format('out of stock: %s', r.good_id);
      end if;
      if p_payment_method = 'card' and not r.allow_card_payment then
        raise check_violation using message=format('card payment blocked: %s',r.good_id);
      end if;
      if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
        raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
      end if;
      if r.sale_restriction <> 'none' then
        raise check_violation using message = format('restricted good blocked: %s', r.good_id);
      end if;
      v_subtotal := v_subtotal + private.allocate_random_option_items(v_order, v_user, r.cart_item_id, r.good_id, r.variant_id, r.qty,
        v_price_at, v_custom_inputs_snapshot,
        jsonb_build_object('version',1,'allowCardPayment',r.allow_card_payment,'allowBankTransfer',r.allow_bank_transfer,
          'orderQuantityLimitEnabled',v_limit_good.order_quantity_limit_enabled,
          'minOrderQty',v_limit_good.min_order_qty,'maxOrderQty',v_limit_good.max_order_qty,
          'memberPurchaseLimitEnabled',v_limit_good.member_purchase_limit_enabled,
          'memberLifetimeQtyLimit',v_limit_good.member_lifetime_qty_limit));
      if not (p_payment_method = 'card' and private.cart_retention_active()) then
        delete from public.cart_items
        where user_id = v_user
          and id = r.cart_item_id;
      end if;
      continue;
    end if;
$new$||anchor);
  execute definition;
  perform private.register_operator_internal_contract(target);
end $patch$;

-- 배정 없는 랜덤 굿즈 행(거래 런타임·선물·구독·직접 INSERT)과, 랜덤이 아닌 굿즈의 랜덤 표시를 막는다.
create function private.guard_order_item_option_sale_mode() returns trigger
language plpgsql security definer set search_path='' as $$
declare sale_mode text;
begin
  select good.option_sale_mode into sale_mode from public.goods good where good.id=new.good_id;
  if new.option_sale_mode_snapshot is null and sale_mode='random' then
    raise check_violation using message=format('random_option_checkout_unsupported: %s',new.good_id);
  end if;
  if new.option_sale_mode_snapshot='random' and sale_mode is distinct from 'random' then
    raise check_violation using message=format('random_option_unavailable: %s',new.good_id);
  end if;
  return new;
end $$;
revoke all on function private.guard_order_item_option_sale_mode() from public,anon,authenticated,service_role;
grant execute on function private.guard_order_item_option_sale_mode() to postgres;
create trigger order_item_option_sale_mode_guard before insert on public.order_items
  for each row execute function private.guard_order_item_option_sale_mode();

create function private.guard_order_item_option_sale_mode_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.option_sale_mode_snapshot is distinct from old.option_sale_mode_snapshot then
    raise check_violation using message='order_item_option_sale_mode_immutable';
  end if;
  return new;
end $$;
revoke all on function private.guard_order_item_option_sale_mode_snapshot() from public,anon,authenticated,service_role;
grant execute on function private.guard_order_item_option_sale_mode_snapshot() to postgres;
create trigger order_item_option_sale_mode_immutable before update of option_sale_mode_snapshot on public.order_items
  for each row execute function private.guard_order_item_option_sale_mode_snapshot();

-- 거래 런타임 계산: 랜덤 굿즈는 지원하지 않는다(견적 line id와 품목이 1:1인 계약).
do $patch$
declare definition text;
  target constant regprocedure:='private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)'::regprocedure;
  anchor constant text:=$old$  select * into variant from public.goods_variants where id=(entry->>'variantId')::uuid and good_id=good.id and archived_at is null;$old$;
begin
  definition:=pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'transaction_random_anchor_changed'; end if;
  execute replace(definition,anchor,$new$  if good.option_sale_mode='random' then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',good.id)));end if;
$new$||anchor);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $patch$;

-- 6. 장바구니 키 ------------------------------------------------------------------------------------------
-- 랜덤 굿즈의 옵션 id는 기본 옵션으로 모은다. 랜덤이 아니거나 굿즈에 속하지 않는 옵션은 그대로 돌려준다(뒤 검증이 거절).
create function private.cart_variant_key(p_good_id text,p_variant_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select coalesce((select default_variant.id from public.goods good
    join public.goods_variants default_variant on default_variant.good_id=good.id and default_variant.is_default
    where good.id=p_good_id and good.option_sale_mode='random'
      and exists(select 1 from public.goods_variants requested where requested.id=p_variant_id and requested.good_id=good.id)
    limit 1),p_variant_id);
$$;
revoke all on function private.cart_variant_key(text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.cart_variant_key(text,uuid) to postgres;

create or replace function private.set_cart_quantity_with_inputs(p_good_id text,p_variant_id uuid,p_qty integer,p_input_revision integer,p_input_values jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); available_stock integer; other_qty bigint; key_value text; snapshot jsonb;
  sale_mode text; cart_variant uuid; target_qty bigint:=p_qty;
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
  -- 랜덤 판매 굿즈는 기본 옵션 한 줄로 담는다(D5②). 배정은 주문 때 DB가 한다.
  select good.option_sale_mode into sale_mode from public.goods good where good.id=p_good_id;
  cart_variant:=case when sale_mode='random' then private.cart_variant_key(p_good_id,p_variant_id) else p_variant_id end;
  if exists(select 1 from public.cart_items where user_id=actor and variant_id=cart_variant and input_key=key_value
    and (input_revision,input_values) is distinct from (p_input_revision,p_input_values)) then raise check_violation using message='cart_input_identity_conflict'; end if;
  -- Removing an obsolete definition must remain possible. A legacy call with
  -- empty inputs can only remove the legacy empty-input row, never custom rows.
  if p_qty=0 then
    delete from public.cart_items where user_id=actor and good_id=p_good_id and variant_id=p_variant_id and input_key=key_value;
    return;
  end if;
  snapshot:=private.resolve_goods_custom_inputs(p_good_id,p_input_revision,p_input_values);
  select supply.available_qty into available_stock from public.goods_variants variant
    join public.goods good on good.id=variant.good_id join public.ips ip on ip.id=good.ip_id
    cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
    where variant.id=cart_variant and variant.good_id=p_good_id and variant.archived_at is null
      and good.published_at is not null and good.archived_at is null and good.sale_restriction='none'
      and good.stock<>'soldout' and (good.allow_card_payment or good.allow_bank_transfer)
      and ip.published_at is not null and ip.archived_at is null;
  if not found then raise check_violation using message='catalog_item_unavailable'; end if;
  if sale_mode='random' then
    -- 가용 = 활성 일반재고 옵션 풀 합계. 같은 굿즈의 다른 줄(키가 바뀌기 전 줄 포함)과 합쳐 판정한다.
    select coalesce(sum(supply.available_qty),0)::integer into available_stock from public.goods_variants variant
      cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
      where variant.good_id=p_good_id and variant.archived_at is null and supply.mode='stock';
    select coalesce(sum(qty::bigint),0) into other_qty from public.cart_items where user_id=actor and good_id=p_good_id
      and not (variant_id in (cart_variant,p_variant_id) and input_key=key_value);
    -- 랜덤 전환 전에 담긴 비기본 옵션 줄(p_variant_id)을 고객이 바꾸면 그 줄의 새 수량을 기본 옵션(키) 줄에 더해 합친다.
    -- 키 줄의 기존 수량은 보존한다. 병합·추가 담기는 키 줄 기준 수량을 키 id로 넘기므로 이 분기를 타지 않는다.
    if cart_variant<>p_variant_id and exists(select 1 from public.cart_items
      where user_id=actor and good_id=p_good_id and variant_id=p_variant_id and input_key=key_value) then
      select p_qty+coalesce(sum(qty::bigint),0) into target_qty from public.cart_items
        where user_id=actor and variant_id=cart_variant and input_key=key_value;
      delete from public.cart_items where user_id=actor and good_id=p_good_id and variant_id=p_variant_id and input_key=key_value;
    end if;
  else
    select coalesce(sum(qty::bigint),0) into other_qty from public.cart_items where user_id=actor and variant_id=p_variant_id and input_key<>key_value;
  end if;
  if other_qty+target_qty>available_stock or target_qty>2147483647 then raise check_violation using message='out of stock'; end if;
  insert into public.cart_items(user_id,good_id,variant_id,qty,input_revision,input_values,input_snapshot)
    values(actor,p_good_id,cart_variant,target_qty::integer,p_input_revision,p_input_values,snapshot)
    on conflict(user_id,variant_id,input_key) do update set qty=excluded.qty;
end $$;
revoke all on function private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb) to postgres;
select private.register_operator_internal_contract('private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb)'::regprocedure);

-- 병합·추가 담기가 현재 수량을 읽는 줄도 장바구니 키로 찾고, 그 키 줄의 새 수량을 키 id로 넘긴다
-- (랜덤 전환 전에 남은 비기본 옵션 줄을 합치는 분기는 고객이 그 줄을 직접 바꿀 때만 탄다).
do $patch$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.merge_cart_items(jsonb)'::regprocedure);
  anchor:=$old$select qty into current_qty from public.cart_items where user_id=actor and variant_id=item.variant_id and input_key=key_value;$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'merge_cart_random_anchor_changed'; end if;
  definition:=replace(definition,anchor,$new$select qty into current_qty from public.cart_items where user_id=actor and variant_id=private.cart_variant_key(item.good_id,item.variant_id) and input_key=key_value;$new$);
  anchor:=$old$perform private.set_cart_quantity_with_inputs(item.good_id,item.variant_id,$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'merge_cart_random_set_anchor_changed'; end if;
  execute replace(definition,anchor,$new$perform private.set_cart_quantity_with_inputs(item.good_id,private.cart_variant_key(item.good_id,item.variant_id),$new$);
  perform private.register_operator_internal_contract('public.merge_cart_items(jsonb)'::regprocedure);

  definition:=pg_get_functiondef('public.add_cart_selection(text,jsonb)'::regprocedure);
  anchor:=$old$item.variant_id::text||':'||key_value$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>2 then raise exception 'add_cart_random_seen_anchor_changed'; end if;
  definition:=replace(definition,anchor,$new$private.cart_variant_key(item.good_id,item.variant_id)::text||':'||key_value$new$);
  anchor:=$old$and good_id=item.good_id and variant_id=item.variant_id and input_key=key_value),0) into actual_qty;$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'add_cart_random_qty_anchor_changed'; end if;
  definition:=replace(definition,anchor,$new$and good_id=item.good_id and variant_id=private.cart_variant_key(item.good_id,item.variant_id) and input_key=key_value),0) into actual_qty;$new$);
  anchor:=$old$perform private.set_cart_quantity_with_inputs(item.good_id,item.variant_id,$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'add_cart_random_set_anchor_changed'; end if;
  execute replace(definition,anchor,$new$perform private.set_cart_quantity_with_inputs(item.good_id,private.cart_variant_key(item.good_id,item.variant_id),$new$);
  perform private.register_operator_internal_contract('public.add_cart_selection(text,jsonb)'::regprocedure);
end $patch$;

-- 7. legacy 장바구니 견적 ----------------------------------------------------------------------------------
-- 20261028160000의 optionLimit에 판매 방식을 더한다. 랜덤 줄은 supply.availableQty를 풀 합계로 바꾸고,
-- available은 같은 굿즈 줄의 수량 합이 풀 이하일 때만 참이다(앱 파서는 available이면 qty ≤ availableQty를 요구한다).
create or replace function public.quote_goods_sales(items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare quote jsonb; lines jsonb:='[]'; line jsonb; supply jsonb; next_change timestamptz; selling boolean; shipping_quote jsonb;
  variant public.goods_variants; actor uuid:=auth.uid(); reserved bigint; limit_reason text; sale_mode text; pool bigint; good_qty bigint; available boolean;
begin
  quote:=private.quote_goods_sales_before_preorder(items);
  next_change:=(quote->>'nextChangeAt')::timestamptz;
  for line in select value from jsonb_array_elements(quote->'lines') loop
    select public.goods_variant_supply(v),good.stock<>'soldout',good.option_sale_mode into supply,selling,sale_mode
      from public.goods_variants v join public.goods good on good.id=v.good_id
      where v.id=(line->>'variantId')::uuid and good.id=line->>'goodId';
    if supply is null then raise check_violation using message='sales_quote_variant_unavailable'; end if;
    select * into variant from public.goods_variants where id=(line->>'variantId')::uuid;
    if sale_mode='random' and supply->>'mode'='stock' then
      select coalesce(sum(pool_supply.available_qty),0) into pool from public.goods_variants pool_variant
        cross join lateral private.resolve_goods_variant_supply(pool_variant.id,statement_timestamp()) pool_supply
        where pool_variant.good_id=variant.good_id and pool_variant.archived_at is null and pool_supply.mode='stock';
      select coalesce(sum((other->>'qty')::bigint),0) into good_qty from jsonb_array_elements(quote->'lines') other where other->>'goodId'=line->>'goodId';
      supply:=supply||jsonb_build_object('availableQty',pool);
      available:=selling and good_qty<=pool;
    else
      available:=selling and (line->>'qty')::bigint<=(supply->>'availableQty')::integer;
    end if;
    reserved:=case when actor is null or variant.member_max_qty is null then null
      else private.member_variant_reserved_qty(actor,variant.id) end;
    limit_reason:=case
      when variant.order_max_qty is not null and (line->>'qty')::bigint>variant.order_max_qty then 'option_order_limit_exceeded'
      when reserved is not null and reserved+(line->>'qty')::bigint>variant.member_max_qty then 'option_member_limit_exceeded' end;
    lines:=lines||jsonb_build_array(line||jsonb_build_object('supply',supply,'available',available,'optionSaleMode',sale_mode,
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

-- 8. 고객 은닉 -------------------------------------------------------------------------------------------
-- 고객 직접 select에서 랜덤 배정 행을 뺀다. 운영자(sales.read)는 그대로 읽는다. 선물 주문 선례(gift_items_private_read)와 같은 restrictive 정책.
create policy random_items_private_read on public.order_items as restrictive for select to authenticated
  using (option_sale_mode_snapshot is null or (select public.has_operator_capability('sales.read')));
select private.register_operator_policy_contract('public.order_items'::regclass,'random_items_private_read','sales.read');

-- 고객 주문 품목 마스킹 조회. 본인 주문(선물 수령 주문 제외 — 기존 직접 읽기와 같은 범위)만 돌려준다.
-- 랜덤 행: variant_name_snapshot='랜덤', variant_id=주문 때의 장바구니 키(기본 옵션), variant_code_snapshot=null, option_sale_mode='random'.
-- 행은 order_items와 1:1이다(배송 건의 order_item_id와 맞춘다). PostgREST에서 .order('id')·.gt('id',…)·.limit()로 페이지를 읽을 수 있다.
create function public.my_order_items(p_order_ids uuid[]) returns table(
  id uuid, order_id uuid, product_order_number text, good_id text, qty integer, unit_price integer,
  good_name_snapshot text, good_type_snapshot text, variant_id uuid, variant_name_snapshot text, variant_code_snapshot text,
  custom_inputs_snapshot jsonb, supply_source text, preorder_expected_ship_date date, option_sale_mode text)
language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare actor uuid:=auth.uid();
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  if p_order_ids is null or cardinality(p_order_ids)>1000 then raise invalid_parameter_value using message='invalid_order_item_ids'; end if;
  return query
  select item.id,item.order_id,item.product_order_number,item.good_id,item.qty,item.unit_price,item.good_name_snapshot,item.good_type_snapshot,
    case when item.option_sale_mode_snapshot='random' then coalesce(allocation.cart_variant_id,
      (select default_variant.id from public.goods_variants default_variant where default_variant.good_id=item.good_id and default_variant.is_default limit 1))
      else item.variant_id end,
    case when item.option_sale_mode_snapshot='random' then '랜덤' else item.variant_name_snapshot end,
    case when item.option_sale_mode_snapshot='random' then null else item.variant_code_snapshot end,
    item.custom_inputs_snapshot,item.supply_source,item.preorder_expected_ship_date,
    coalesce(item.option_sale_mode_snapshot,'select')
  from public.order_items item
  join public.orders o on o.id=item.order_id
  left join private.order_item_random_allocations allocation on allocation.order_item_id=item.id
  where item.order_id=any(p_order_ids) and o.user_id=actor and private.gift_direct_order_read_allowed(o.id,actor);
end $$;
revoke all on function public.my_order_items(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.my_order_items(uuid[]) to authenticated;

-- 공개 리뷰의 구매 옵션명: 랜덤 행은 '랜덤'으로 보인다.
do $patch$
declare target regprocedure; definition text; hits integer;
  anchor constant text:=$old$array_agg(distinct item.variant_name_snapshot order by item.variant_name_snapshot)$old$;
begin
  foreach target in array array['public.get_good_group_reviews(text,text,boolean,integer,integer)'::regprocedure,
    'public.get_good_group_reviews_v2(text,text,boolean,integer,integer)'::regprocedure,
    'public.get_good_group_reviews_v3(text,text,boolean,integer,integer,text,text)'::regprocedure] loop
    definition:=pg_get_functiondef(target);
    hits:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
    if hits=0 then continue; end if;
    if hits<>1 then raise exception 'review_variant_names_anchor_changed: %',target; end if;
    execute replace(definition,anchor,$new$array_agg(distinct case when item.option_sale_mode_snapshot='random' then '랜덤' else item.variant_name_snapshot end
     order by case when item.option_sale_mode_snapshot='random' then '랜덤' else item.variant_name_snapshot end)$new$);
    if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=target) then
      perform private.register_operator_internal_contract(target);
    end if;
  end loop;
end $patch$;

commit;
notify pgrst,'reload schema';
