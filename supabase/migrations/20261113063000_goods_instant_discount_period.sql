-- TKT-033(ADR-0040): 즉시할인에 기간을 넣는다. 즉시할인과 기간 할인의 가격 계약을 합친다.
--
-- 진실원은 옵션별 기간 할인 원장(private.goods_variant_price_periods) 하나다.
-- - 기간 없는 즉시할인은 지금 계약 그대로다(goods.price = 할인가, goods.compare_at_price = 할인 전 판매가).
-- - 기간 즉시할인은 goods.price = 할인 전 판매가로 두고, 판매 중인 옵션마다 같은 할인 금액을 뺀 기간 할인 행을 원장에 쓴다.
--   resolver(private.resolve_goods_variant_price)가 기간 전·후에는 판매가, 기간 중에는 할인가를 돌려주므로 고객 상세·장바구니·
--   주문서·체크아웃 견적·주문이 같은 값을 본다. T08 promotion_id·guard 트리거와 옵션별 겹침 금지(한 옵션 한 시점 할인 하나)는 그대로다.
-- - 상품 편집이 다루는 기간 즉시할인은 '진행·예정 기간 할인 행이 모두 프로모션 밖이고, 판매 중인 옵션마다 한 행씩, 같은 기간,
--   같은 할인 금액'인 묶음이다. 그 밖(할인 프로모션이 건 할인, 옵션마다 다른 금액, 여러 기간, 기간 없는 즉시할인과 겹침)은
--   상품 편집에서 바꾸지 않고(managed) 기간 할인·할인 프로모션 화면에서 관리한다.
-- - 한 상품에 기간 없는 즉시할인과 진행·예정 기간 할인이 새로 겹치지 않게 한다(저장·일괄 즉시할인·할인 프로모션 모두).
-- - 상품 목록의 '할인 중지 후 판매가 변경'(T17b)은 기간 없는 즉시할인도 멈춘다(상품 1개짜리 discount_stop + includeInstant).

-- --------------------------------------------------------------------------
-- 1. 상품의 진행·예정 기간 할인 묶음 판정(상품 편집·엑셀 반입·저장이 같은 판정을 쓴다)
-- --------------------------------------------------------------------------
create function private.goods_instant_discount_schedule(p_good_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with good as (
    select g.id, g.price, g.compare_at_price from public.goods g where g.id = p_good_id
  ), live as (
    select p.id, p.variant_id, p.revision, p.regular_price, p.discount_price, p.starts_at, p.ends_at, p.promotion_id,
      v.archived_at as variant_archived_at
    from private.goods_variant_price_periods p
    join public.goods_variants v on v.id = p.variant_id
    where p.good_id = p_good_id and p.state = 'active' and p.ends_at > pg_catalog.statement_timestamp()
  ), active_variants as (
    select v.id from public.goods_variants v where v.good_id = p_good_id and v.archived_at is null
  ), facts as (
    select
      (select count(*) from live) as live_count,
      (select count(distinct variant_id) from live) as live_variants,
      (select count(*) from live where variant_archived_at is not null) as archived_rows,
      (select count(*) from active_variants) as active_count,
      (select count(*) from active_variants a where not exists(select 1 from live l where l.variant_id = a.id)) as uncovered,
      (select count(distinct starts_at) from live) as start_count,
      (select count(distinct ends_at) from live) as end_count,
      (select count(distinct regular_price - discount_price) from live) as amount_count,
      (select count(*) from live where promotion_id is not null) as promotion_rows,
      (select min(regular_price - discount_price) from live) as amount,
      (select min(starts_at) from live) as starts_at,
      (select max(ends_at) from live) as ends_at,
      (select min(discount_price) from live) as min_price,
      (select max(discount_price) from live) as max_price,
      (select coalesce(g.compare_at_price > g.price, false) from good g) as instant_active
  ), judged as (
    select f.*,
      case
        when f.live_count = 0 then 'none'
        when f.promotion_rows = 0 and not coalesce(f.instant_active, false) and f.archived_rows = 0 and f.uncovered = 0
          and f.live_count = f.live_variants and f.live_variants = f.active_count
          and f.start_count = 1 and f.end_count = 1 and f.amount_count = 1 then 'editable'
        else 'managed'
      end as state
    from facts f
  )
  select pg_catalog.jsonb_build_object(
    'state', j.state,
    'reason', case when j.state <> 'managed' then null
      when j.promotion_rows > 0 then 'promotion'
      when coalesce(j.instant_active, false) then 'instant'
      else 'mixed' end,
    'fingerprint', case when j.live_count = 0 then 'none' else pg_catalog.md5((
      select pg_catalog.string_agg(l.id::text || ':' || l.revision::text, ',' order by l.id) from live l)) end,
    'period', case when j.state = 'editable' then pg_catalog.jsonb_build_object(
      'amount', j.amount, 'startsAt', j.starts_at, 'endsAt', j.ends_at) end,
    'summary', case when j.live_count = 0 then null else pg_catalog.jsonb_build_object(
      'count', j.live_count, 'minPrice', j.min_price, 'maxPrice', j.max_price, 'startsAt', j.starts_at, 'endsAt', j.ends_at) end,
    'promotions', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', promotion.id, 'name', promotion.name) order by promotion.name, promotion.id)
      from private.discount_promotions promotion
      where promotion.id in (select l.promotion_id from live l where l.promotion_id is not null)), '[]'::jsonb))
  from judged j;
$$;
alter function private.goods_instant_discount_schedule(text) owner to postgres;
revoke all on function private.goods_instant_discount_schedule(text) from public, anon, authenticated, service_role;

-- 상품 편집이 여는 즉시할인 기간 상태(읽기). 결과의 fingerprint를 저장 요청의 expectedFingerprint로 되돌려 받는다.
create function public.admin_goods_instant_discount_period(p_good_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_operator_capability('catalog.read', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_good_id is null or not exists(select 1 from public.goods where id = p_good_id) then return null; end if;
  return private.goods_instant_discount_schedule(p_good_id);
end;
$$;
alter function public.admin_goods_instant_discount_period(text) owner to postgres;
revoke all on function public.admin_goods_instant_discount_period(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_goods_instant_discount_period(text) to authenticated;
select private.register_operator_rpc_contract('public.admin_goods_instant_discount_period(text)'::regprocedure, 'catalog.read', 'read', false);

-- --------------------------------------------------------------------------
-- 2. 상품 저장 래퍼 층: 기간 즉시할인(instant_discount_period)과 '할인 하나' 가드
-- --------------------------------------------------------------------------
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_instant_discount_period;
revoke all on function private.admin_save_good_before_instant_discount_period(jsonb) from public, anon, authenticated, service_role;

create function public.admin_save_good(target_good jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  previous public.goods;
  request jsonb;
  request_mode text;
  amount integer;
  starts timestamptz;
  ends timestamptz;
  schedule jsonb;
  saved jsonb;
  saved_id text;
  target_price bigint;
  target_compare bigint;
  own_ids uuid[] := '{}';
  own_row private.goods_variant_price_periods;
  variant_row public.goods_variants;
  stopped boolean := false;
  inserted boolean := false;
  unchanged boolean;
  failure text;
begin
  perform private.require_operator_capability('catalog.manage', false);
  if pg_catalog.jsonb_typeof(target_good) is distinct from 'object' then
    raise invalid_parameter_value using message = 'invalid_good';
  end if;
  -- 위임 저장과 같은 잠금 순서(카테고리 트리 → 상품 행).
  perform private.lock_catalog_category_tree();
  select * into previous from public.goods
    where id = coalesce(nullif(target_good->>'previous_id', ''), target_good->>'id') for update;

  -- 한 상품에 할인은 하나다: 진행·예정 기간 할인이 있는 상품에 기간 없는 즉시할인(정가 표시)을 새로 걸거나 바꾸지 않는다.
  -- 이미 함께 있던 상품의 다른 입력 저장은 막지 않는다(정가 값이 그대로면 통과). 즉시할인 기간 지시가 있는 저장은 아래에서
  -- 상품 편집이 다루는 기간 할인을 먼저 멈추거나(none) 정가 표시를 거절한다(period).
  if not target_good ? 'instant_discount_period' and target_good ? 'compare_at_price' and coalesce(target_good->>'compare_at_price', '') ~ '^[0-9]{1,10}$' then
    target_compare := (target_good->>'compare_at_price')::bigint;
    target_price := case when coalesce(target_good->>'price', '') ~ '^[0-9]{1,10}$' then (target_good->>'price')::bigint
      else previous.price end;
    if previous.id is not null and target_compare > target_price
      and previous.compare_at_price::bigint is distinct from target_compare
      and exists(select 1 from private.goods_variant_price_periods p
        where p.good_id = previous.id and p.state = 'active' and p.ends_at > pg_catalog.statement_timestamp()) then
      raise check_violation using message = 'instant_discount_period_conflict';
    end if;
  end if;

  if not target_good ? 'instant_discount_period' then
    return private.admin_save_good_before_instant_discount_period(target_good);
  end if;

  request := target_good->'instant_discount_period';
  request_mode := request->>'mode';
  if pg_catalog.jsonb_typeof(request) is distinct from 'object' or request_mode is null or request_mode not in ('none', 'period')
    or pg_catalog.jsonb_typeof(request->'expectedFingerprint') is distinct from 'string'
    or pg_catalog.length(request->>'expectedFingerprint') not between 1 and 64
    or (request_mode = 'none' and (select pg_catalog.array_agg(key order by key) from pg_catalog.jsonb_object_keys(request) key)
      is distinct from array['expectedFingerprint', 'mode'])
    or (request_mode = 'period' and (select pg_catalog.array_agg(key order by key) from pg_catalog.jsonb_object_keys(request) key)
      is distinct from array['amount', 'endsAt', 'expectedFingerprint', 'mode', 'startsAt']) then
    raise check_violation using message = 'invalid_instant_discount_period';
  end if;
  if request_mode = 'period' then
    if pg_catalog.jsonb_typeof(request->'amount') is distinct from 'number' or request->>'amount' !~ '^[1-9][0-9]{0,9}$'
      or (request->>'amount')::numeric > 2147483647
      or pg_catalog.jsonb_typeof(request->'startsAt') is distinct from 'string' or request->>'startsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
      or pg_catalog.jsonb_typeof(request->'endsAt') is distinct from 'string' or request->>'endsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise check_violation using message = 'invalid_instant_discount_period';
    end if;
    amount := (request->>'amount')::integer;
    begin
      starts := (request->>'startsAt')::timestamptz;
      ends := (request->>'endsAt')::timestamptz;
    exception when others then
      raise check_violation using message = 'invalid_instant_discount_period';
    end;
    if not pg_catalog.isfinite(starts) or not pg_catalog.isfinite(ends) or starts >= ends then
      raise check_violation using message = 'invalid_instant_discount_period';
    end if;
    if ends <= pg_catalog.statement_timestamp() then
      raise check_violation using message = 'instant_discount_period_ended';
    end if;
    -- 기간 즉시할인 상품의 판매가는 할인 전 가격이다(정가 표시를 함께 쓰지 않는다).
    if coalesce(target_good->>'compare_at_price', '') <> '' then
      raise check_violation using message = 'instant_discount_period_conflict';
    end if;
  end if;

  -- 화면이 본 할인 묶음과 지금 묶음이 같아야 한다(다른 곳에서 걸거나 멈춘 할인을 덮지 않는다).
  schedule := private.goods_instant_discount_schedule(previous.id);
  if schedule->>'fingerprint' is distinct from request->>'expectedFingerprint' then
    raise sqlstate 'PT409' using message = 'instant_discount_period_changed';
  end if;
  if schedule->>'state' = 'managed' then
    raise check_violation using message = 'instant_discount_period_managed';
  end if;
  if previous.id is not null then
    select coalesce(pg_catalog.array_agg(p.id order by p.id), '{}') into own_ids
    from private.goods_variant_price_periods p
    where p.good_id = previous.id and p.state = 'active' and p.ends_at > pg_catalog.statement_timestamp();
    perform 1 from private.goods_variant_price_periods where id = any(own_ids) order by id for update;
  end if;

  if request_mode = 'none' or pg_catalog.cardinality(own_ids) = 0 then
    if pg_catalog.cardinality(own_ids) > 0 then
      for own_row in select * from private.goods_variant_price_periods where id = any(own_ids) order by id loop
        perform public.admin_save_goods_price_period(own_row.good_id, own_row.variant_id, own_row.id, pg_catalog.jsonb_build_object(
          'state', 'disabled', 'discountPrice', own_row.discount_price, 'startsAt', own_row.starts_at, 'endsAt', own_row.ends_at), own_row.revision);
      end loop;
      stopped := true;
    end if;
    saved := private.admin_save_good_before_instant_discount_period(target_good - 'instant_discount_period');
  else
    -- 판매가·옵션 금액이 그대로면 지금 할인을 그대로 두거나 바꾼 것만 새로 쓴다. 금액이 바뀌면 기간 할인 가드
    -- (active_price_period_requires_reset)가 막으므로, 그때만 이 상품 편집이 다루는 할인을 먼저 멈추고 다시 저장한다.
    begin
      saved := private.admin_save_good_before_instant_discount_period(target_good - 'instant_discount_period');
    exception when check_violation then
      get stacked diagnostics failure = message_text;
      if failure is distinct from 'active_price_period_requires_reset' then raise; end if;
      saved := null;
    end;
    if saved is null then
      for own_row in select * from private.goods_variant_price_periods where id = any(own_ids) order by id loop
        perform public.admin_save_goods_price_period(own_row.good_id, own_row.variant_id, own_row.id, pg_catalog.jsonb_build_object(
          'state', 'disabled', 'discountPrice', own_row.discount_price, 'startsAt', own_row.starts_at, 'endsAt', own_row.ends_at), own_row.revision);
      end loop;
      stopped := true;
      saved := private.admin_save_good_before_instant_discount_period(target_good - 'instant_discount_period');
    end if;
  end if;
  saved_id := saved->>'id';
  if coalesce(saved_id, '') = '' then raise check_violation using message = 'invalid_good'; end if;

  if request_mode = 'period' then
    perform 1 from public.goods_variants where good_id = saved_id order by id for update;
    if exists(select 1 from public.goods_variants v where v.good_id = saved_id and v.archived_at is null and v.price::bigint - amount < 1) then
      raise check_violation using message = 'instant_discount_period_price_invalid';
    end if;
    if not exists(select 1 from public.goods_variants v where v.good_id = saved_id and v.archived_at is null) then
      raise check_violation using message = 'price_period_variant_inactive';
    end if;
    unchanged := not stopped and pg_catalog.cardinality(own_ids) > 0
      and pg_catalog.cardinality(own_ids) = (select count(*) from public.goods_variants v where v.good_id = saved_id and v.archived_at is null)
      and not exists(
        select 1 from public.goods_variants v
        where v.good_id = saved_id and v.archived_at is null and not exists(
          select 1 from private.goods_variant_price_periods p
          where p.id = any(own_ids) and p.variant_id = v.id and p.state = 'active' and p.regular_price = v.price
            and p.discount_price = v.price - amount and p.starts_at = starts and p.ends_at = ends));
    if not unchanged then
      if not stopped then
        for own_row in select * from private.goods_variant_price_periods where id = any(own_ids) order by id loop
          perform public.admin_save_goods_price_period(own_row.good_id, own_row.variant_id, own_row.id, pg_catalog.jsonb_build_object(
            'state', 'disabled', 'discountPrice', own_row.discount_price, 'startsAt', own_row.starts_at, 'endsAt', own_row.ends_at), own_row.revision);
        end loop;
        stopped := pg_catalog.cardinality(own_ids) > 0;
      end if;
      for variant_row in select * from public.goods_variants v where v.good_id = saved_id and v.archived_at is null order by v.id loop
        perform public.admin_save_goods_price_period(saved_id, variant_row.id, null, pg_catalog.jsonb_build_object(
          'state', 'active', 'discountPrice', variant_row.price - amount, 'startsAt', request->'startsAt', 'endsAt', request->'endsAt'), null);
      end loop;
      inserted := true;
    end if;
  end if;

  if stopped or inserted then
    insert into public.audit_log(actor_id, action, target, diff)
    values (auth.uid(), 'admin.good.instant_discount_period_saved', 'goods:' || saved_id, pg_catalog.jsonb_build_object(
      'mode', request_mode, 'amount', amount, 'startsAt', starts, 'endsAt', ends,
      'before', schedule, 'stopped', stopped, 'inserted', inserted));
  end if;
  return saved || pg_catalog.jsonb_build_object('instantDiscountPeriod', private.goods_instant_discount_schedule(saved_id));
end;
$function$;
alter function public.admin_save_good(jsonb) owner to postgres;
revoke all on function public.admin_save_good(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_good(jsonb)'::regprocedure, 'catalog.manage', 'write', false);
select private.register_operator_internal_contract('private.admin_save_good_before_instant_discount_period(jsonb)'::regprocedure);

-- --------------------------------------------------------------------------
-- 3. 앵커 치환(현재 정의에서 앵커가 정확히 한 번 나올 때만 바꾼다)
-- --------------------------------------------------------------------------
create function private.goods_instant_discount_period_patch(p_function regprocedure, p_patches jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $helper$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_function);
  v_patch jsonb;
  v_found integer;
begin
  for v_patch in select value from pg_catalog.jsonb_array_elements(p_patches) loop
    v_found := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_patch->>0, '')))
      / pg_catalog.length(v_patch->>0);
    if v_found <> 1 then
      raise exception 'goods_instant_discount_period_anchor_changed: % (% matches)', p_function, v_found;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.goods_instant_discount_period_patch(regprocedure, jsonb) from public, anon, authenticated, service_role;

-- 3-1. 일괄 변경 요청: '할인 중지'는 상품 1개일 때만 기간 없는 즉시할인도 함께 멈추는 값(includeInstant)을 받는다(목록 판매가 칸 창 전용).
select private.goods_instant_discount_period_patch('private.goods_bulk_validate(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ elsif command<>'period' and v<>'{}'::jsonb then raise invalid_parameter_value using message='goods_bulk_invalid';end if;$anchor$,
    $replacement$ elsif command<>'period' and v<>'{}'::jsonb and not (command='discount_stop' and kind='goods'
  and jsonb_array_length(p_request->'ids')=1 and v='{"includeInstant":true}'::jsonb) then raise invalid_parameter_value using message='goods_bulk_invalid';end if;$replacement$)));

-- 3-2. 가격 지문에 정가 표시(compare_at_price)를 넣는다. 비교 뒤 기간 없는 즉시할인이 바뀌면 할인·할인 중지·할인 프로모션 확정이 멈춘다.
select private.goods_instant_discount_period_patch('private.goods_bulk_price_fingerprint(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$jsonb_build_object('id',g.id,'price',g.price,'archived',g.archived_at,'ip',g.ip_id)$anchor$,
    $replacement$jsonb_build_object('id',g.id,'price',g.price,'compareAt',g.compare_at_price,'archived',g.archived_at,'ip',g.ip_id)$replacement$)));

-- 3-3. 일괄 변경 비교: 즉시할인(기간)은 기간 없는 즉시할인 중인 상품을 건너뛰고, 상품 1개 할인 중지는 그 즉시할인도 멈출 할인으로 보인다.
select private.goods_instant_discount_period_patch('public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ window_range tstzrange;discounts jsonb;$anchor$,
    $replacement$ window_range tstzrange;discounts jsonb;instant jsonb;$replacement$),
  jsonb_build_array(
    $anchor$skip:=null;discounts:=null;$anchor$,
    $replacement$skip:=null;discounts:=null;instant:=null;$replacement$),
  jsonb_build_array(
    $anchor$   if min_price is null then skip:='price_period_variant_inactive';$anchor$,
    $replacement$   if g.compare_at_price is not null and g.compare_at_price>g.price then skip:='instant_discount_active';
   elsif min_price is null then skip:='price_period_variant_inactive';$replacement$),
  jsonb_build_array(
    $anchor$   if discounts is null then skip:='no_active_discount';end if;$anchor$,
    $replacement$   if p_request#>>'{values,includeInstant}'='true' and g.compare_at_price is not null and g.compare_at_price>g.price then
    instant:=jsonb_build_object('regularPrice',g.compare_at_price,'salePrice',g.price);
    next_price:=g.compare_at_price;next_min:=min_price-g.price+g.compare_at_price;next_max:=max_price-g.price+g.compare_at_price;
   end if;
   if discounts is null and instant is null then skip:='no_active_discount';end if;$replacement$),
  jsonb_build_array(
    $anchor$'skip',skip,'discounts',discounts));$anchor$,
    $replacement$'skip',skip,'discounts',discounts)||case when instant is null then '{}'::jsonb else jsonb_build_object('instantDiscount',instant) end);$replacement$)));

-- 3-4. 일괄 변경 확정: 상품 1개 할인 중지(includeInstant)는 기간 할인을 멈춘 뒤 기간 없는 즉시할인을 판매가(할인 전)로 되돌린다.
--      옵션 추가금·재고는 그대로이고, 상품 목록 판매가 변경과 같은 상품 저장 RPC를 같은 페이로드 모양으로 부른다.
select private.goods_instant_discount_period_patch('public.admin_commit_goods_bulk(uuid,uuid,uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$        'discountPrice',p.discount_price,'startsAt',p.starts_at,'endsAt',p.ends_at),p.revision);
      end loop;
     end if;$anchor$,
    $replacement$        'discountPrice',p.discount_price,'startsAt',p.starts_at,'endsAt',p.ends_at),p.revision);
      end loop;
      if values_doc->>'includeInstant'='true' and g.compare_at_price is not null and g.compare_at_price>g.price then
       select jsonb_agg(jsonb_build_object('id',id,'name',name,'attributes',attributes,'code',code,'extraPrice',price-g.price,
        'stockQty',stock_qty,'expectedStockQty',stock_qty,'isActive',archived_at is null,'lowStockThreshold',low_stock_threshold)
        order by is_default desc,sort_order,id) into options from public.goods_variants where good_id=g.id;
       select coalesce(jsonb_agg(id::text order by id),'[]') into baseline from public.goods_variants where good_id=g.id and archived_at is null;
       perform public.admin_save_good(to_jsonb(g)||jsonb_build_object('previous_id',g.id,'publish',null,'custom_inputs_expected_revision',g.custom_inputs_revision,
        'price',g.compare_at_price,'compare_at_price',null,'variants',options,'variant_baseline',baseline));
      end if;
     end if;$replacement$)));

-- 3-5. 할인 프로모션 비교: 기간 없는 즉시할인 중인 상품은 건너뛰고 이유를 남긴다(한 상품 한 시점 할인 하나).
select private.goods_instant_discount_period_patch('public.admin_preview_discount_promotion(uuid,jsonb,uuid,uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    elsif g.archived_at is not null then skip:='good_archived';$anchor$,
    $replacement$    elsif g.archived_at is not null then skip:='good_archived';
    elsif g.compare_at_price is not null and g.compare_at_price>g.price then skip:='instant_discount_active';$replacement$)));

-- 3-6. 상품 엑셀 반입 기록: 진행·예정 기간 할인 요약을 싣는다(기간 할인 상품의 판매가·즉시할인·옵션가 변경을 미리보기에서 거절).
select private.goods_instant_discount_period_patch('public.admin_goods_import_records(text[],text[])'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$then public.admin_get_goods_size_chart(entry.value#>>'{good,id}') else null end)$anchor$,
    $replacement$then public.admin_get_goods_size_chart(entry.value#>>'{good,id}') else null end,
      'livePriceDiscount', private.goods_instant_discount_schedule(entry.value#>>'{good,id}')->'summary')$replacement$)));

drop function private.goods_instant_discount_period_patch(regprocedure, jsonb);

-- 앵커 치환은 create or replace라 소유자·권한이 그대로다. 봉인과 계약 지문을 다시 적는다.
revoke all on function private.goods_bulk_validate(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.goods_bulk_price_fingerprint(text) from public, anon, authenticated, service_role;
revoke all on function public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid) to authenticated;
revoke all on function public.admin_commit_goods_bulk(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_commit_goods_bulk(uuid,uuid,uuid) to authenticated;
revoke all on function public.admin_preview_discount_promotion(uuid,jsonb,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_preview_discount_promotion(uuid,jsonb,uuid,uuid) to authenticated;
revoke all on function public.admin_goods_import_records(text[],text[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_goods_import_records(text[],text[]) to authenticated;
select private.register_operator_internal_contract('private.goods_bulk_validate(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.goods_bulk_price_fingerprint(text)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)'::regprocedure, 'catalog.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_commit_goods_bulk(uuid,uuid,uuid)'::regprocedure, 'catalog.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_preview_discount_promotion(uuid,jsonb,uuid,uuid)'::regprocedure, 'catalog.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_goods_import_records(text[],text[])'::regprocedure, 'catalog.read', 'read', false);

-- --------------------------------------------------------------------------
-- 4. 배포 로그: 기간 없는 즉시할인과 진행·예정 기간 할인이 이미 함께 있는 상품 수(새로 만들지는 않는다. 기존 상품은 그대로 둔다)
-- --------------------------------------------------------------------------
do $$
declare stacked integer;
begin
  select count(*) into stacked from public.goods g
  where g.archived_at is null and g.compare_at_price > g.price and exists(
    select 1 from private.goods_variant_price_periods p where p.good_id = g.id and p.state = 'active' and p.ends_at > pg_catalog.statement_timestamp());
  raise notice 'goods_instant_discount_period: goods with both a no-period instant discount and a live period discount %', stacked;
end $$;
