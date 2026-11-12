-- ============================================================================
-- 바로구매: 상품 상세·위시의 [구매하기]는 그 상품만 주문한다 (10/14 회의 1014-033·034·037·038·039, ADR-0030)
--
-- 지금까지 [구매하기]는 담기와 같은 장바구니 계약으로 담은 뒤 장바구니로 갔고, 주문은 장바구니 전체였다. 그래서
-- 장바구니에 다른 상품이 있으면 함께 결제됐고, 같은 상품이 이미 있으면 수량이 합산됐다(1014-033·037).
--
-- 1. 바로구매 초안(service_create_checkout_direct_draft): 상세에서 고른 옵션·수량·추가 구성·직접입력값만 담는다.
--    장바구니를 읽지도 바꾸지도 않는다. 추가 구성은 담기(add_cart_selection)와 같은 규칙으로 검증한다(본품 필수,
--    연결된 추가 구성만, 19금 본품은 인증 성인만). 랜덤 판매 굿즈는 장바구니 키 옵션으로 모은다.
-- 2. 바로구매 주문(place_direct_order): 사용자 advisory → 이전 미결제 주문 닫기(출처 무관, ADR-0026 확장) →
--    account-action → 코어(원본 = 초안 줄, 장바구니 행 없음). 쿠폰은 주문서에서 고른 쿠폰이다 — 장바구니 쿠폰
--    선택은 바꾸지 않는다. 같은 쿠폰이 장바구니에 선택돼 있으면 결제 확정(카드)·접수(무통장) 때 선택을 해제한다.
-- 3. 보류: 카드 바로구매도 보류(source direct_checkout)를 남긴다 — 다른 탭·다음 주문이 이전 미결제 점유(쿠폰·첫구매
--    예약·1인 한도·재고)를 닫는 색인이다. 장바구니 효과는 없다(결제 확정 정산은 줄을 건너뛰고 쿠폰 선택만 정리).
-- 4. 닫기 범위: 새 주문은 출처와 무관하게 이전 미결제 점유를 모두 닫는다. 장바구니·장바구니 주문서 진입 때의
--    release는 지금처럼 장바구니 출처만 닫는다(장바구니를 열기만 해도 다른 탭의 바로구매 결제창이 끊기지 않게).
--    바로구매 주문서 진입은 아무것도 닫지 않는다(보기만으로 다른 탭 결제를 끊지 않게). 견적이 결제 대기 주문의 쿠폰·
--    첫구매 예약·구매 한도·재고 때문에 막히면 화면이 결제 대기 주문(service_list_unpaid_checkout_orders)을 확인창에
--    보이고, 고객이 '결제 대기 주문 취소하고 계속'을 확인했을 때만 release_unpaid_checkout_orders가 그 주문들을 출처와
--    무관하게 닫는다(결제 승인 확인 중이면 닫지 않는다).
-- 5. 다시 구매: 바로구매 주문의 보류는 장바구니를 남긴 주문이 아니다 — 결제가 승인 전에 끝나면 결제 화면의 '다시
--    구매하기'(service_retry_direct_order)가 그 주문을 닫고 같은 줄로 바로구매 초안을 다시 만들어 주문서로 보낸다
--    (service_get_order_cart_retention이 출처와 상품을 함께 돌려준다). 보조 동작 '이 주문 닫고 굿즈 상세에서 다시
--    고르기'(service_close_direct_order)는 같은 닫기만 하고 그 상품 상세로 보낸다.
-- ============================================================================

-- ── 보류: 바로구매 출처 ───────────────────────────────────────────────────────────
alter table private.cart_order_holds drop constraint cart_order_holds_source_check;
alter table private.cart_order_holds add constraint cart_order_holds_source_check
  check (source in ('legacy_checkout', 'cart_transaction', 'direct_checkout', 'direct_transaction'));
alter table private.cart_order_holds add column base_good_id text;
alter table private.cart_order_holds add constraint cart_order_holds_direct_base_check
  check ((source in ('direct_checkout', 'direct_transaction')) = (base_good_id is not null));
comment on column private.cart_order_holds.base_good_id is
  '바로구매 보류의 상품 상세 굿즈(ADR-0030). 다시 구매하기 목적지다. 장바구니 출처는 null.';

-- 바로구매 줄은 장바구니 행이 아니다. 보류 줄은 감사·다시 구매 판단용이고 결제 확정 정산은 장바구니를 건드리지 않는다.
create function private.record_direct_order_hold(p_order_id uuid, p_user_id uuid, p_source text, p_lines jsonb, p_base_good_id text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_source not in ('direct_checkout', 'direct_transaction') or nullif(btrim(p_base_good_id), '') is null then
    raise invalid_parameter_value using message = 'direct_order_hold_invalid';
  end if;
  if not exists (
    select 1 from public.orders as o
    where o.id = p_order_id and o.user_id = p_user_id
      and o.status = 'pending' and o.payment_method = 'card'
  ) then
    raise check_violation using message = 'cart_order_hold_order_invalid';
  end if;
  if pg_catalog.jsonb_typeof(p_lines) is distinct from 'array' or pg_catalog.jsonb_array_length(p_lines) = 0 then
    raise check_violation using message = 'cart_order_hold_empty';
  end if;
  insert into private.cart_order_holds (order_id, user_id, source, lines, base_good_id)
  values (p_order_id, p_user_id, p_source,
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('goodId', line ->> 'goodId', 'variantId', line ->> 'variantId',
        'inputKey', case when (line ->> 'inputRevision')::integer = 0 and line -> 'inputValues' = '{}'::jsonb then ''
          else pg_catalog.md5((line ->> 'inputRevision') || ':' || (line -> 'inputValues')::text) end,
        'inputRevision', (line ->> 'inputRevision')::integer, 'inputValues', line -> 'inputValues', 'qty', (line ->> 'qty')::integer)
        order by position)
      from pg_catalog.jsonb_array_elements(p_lines) with ordinality as entries(line, position)),
    p_base_good_id)
  on conflict (order_id) do nothing;
end;
$$;
revoke all on function private.record_direct_order_hold(uuid, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function private.record_direct_order_hold(uuid, uuid, text, jsonb, text) to postgres;

-- 결제 확정 정산: 바로구매 보류는 장바구니 줄을 건너뛰고(장바구니 효과 없음) 쓴 쿠폰의 장바구니 선택만 정리한다.
do $$
declare
  v_definition text;
  v_anchor text := E'    for v_line in select value from pg_catalog.jsonb_array_elements(v_hold.lines) loop';
begin
  v_definition := pg_catalog.pg_get_functiondef('private.settle_cart_order_hold()'::regprocedure);
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'direct_order_settle_anchor_changed';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_anchor,
    E'    -- 바로구매 보류(ADR-0030)는 장바구니 줄을 건너뛴다 — 장바구니를 읽지도 바꾸지도 않은 주문이다.\n'
    || E'    for v_line in select value from pg_catalog.jsonb_array_elements(case when v_hold.source in (''direct_checkout'', ''direct_transaction'') then ''[]''::jsonb else v_hold.lines end) loop');
  execute v_definition;
end;
$$;
revoke all on function private.settle_cart_order_hold() from public, anon, authenticated, service_role;

-- ── 이전 미결제 주문 닫기: 출처 범위 ───────────────────────────────────────────────
-- 20261027120000 supersede_unpaid_cart_orders의 본문에 닫을 출처(p_sources, null = 모두)와 계기(p_trigger)를 더했다.
-- 잠금 순서(계정 advisory → 대상 주문 행 → account-action)와 닫기 판정은 그대로다.
create function private.supersede_unpaid_checkout_orders(p_user_id uuid, p_new_order boolean, p_sources text[], p_trigger text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_result text;
  v_closed integer := 0;
  v_reason text;
begin
  if p_user_id is null or p_new_order is null
    or p_trigger is null or p_trigger not in ('new_cart_order', 'returned_to_cart', 'new_direct_order', 'customer_released') then
    raise invalid_parameter_value using message = 'cart_order_supersede_invalid';
  end if;
  v_reason := case p_trigger
    when 'new_cart_order' then '같은 장바구니로 새 주문을 만들어 결제 대기 주문 자동 취소'
    when 'returned_to_cart' then '장바구니로 돌아와 결제 대기 주문 자동 취소'
    when 'new_direct_order' then '바로구매로 새 주문을 만들어 결제 대기 주문 자동 취소'
    else '고객이 진행 중인 미결제 주문을 취소하고 주문을 계속함' end;
  perform 1
  from public.orders as o
  join private.cart_order_holds as hold on hold.order_id = o.id
  where hold.user_id = p_user_id and hold.state = 'awaiting_payment'
    and (p_sources is null or hold.source = any (p_sources))
  order by o.id
  for update of o;
  if not found then
    return 0;
  end if;
  perform private.lock_account_action_subject(p_user_id);
  for r in
    select hold.order_id
    from private.cart_order_holds as hold
    where hold.user_id = p_user_id and hold.state = 'awaiting_payment'
      and (p_sources is null or hold.source = any (p_sources))
    order by hold.created_at, hold.order_id
  loop
    v_result := private.close_unpaid_cart_order(r.order_id, v_reason, p_trigger);
    if v_result = 'closed' then
      v_closed := v_closed + 1;
    elsif v_result = 'payment_confirming' and p_new_order then
      -- detail = 승인 확인 중인 주문. 주문서가 '결제 확인 중인 주문이 있어요'와 그 주문으로 안내한다.
      raise sqlstate 'PT409' using message = 'checkout_payment_in_progress', detail = r.order_id::text;
    elsif v_result = 'unresolved' and p_new_order then
      update private.cart_order_holds
      set state = 'released', settled_at = pg_catalog.clock_timestamp(), release_reason = 'detached'
      where order_id = r.order_id and state = 'awaiting_payment';
      insert into public.audit_log (actor_id, action, target, diff)
      values (null, 'system.order.cart_hold_detached', 'order:' || r.order_id::text,
        pg_catalog.jsonb_build_object('trigger', p_trigger, 'actor', 'system'));
    end if;
  end loop;
  return v_closed;
end;
$$;
revoke all on function private.supersede_unpaid_checkout_orders(uuid, boolean, text[], text) from public, anon, authenticated, service_role;
grant execute on function private.supersede_unpaid_checkout_orders(uuid, boolean, text[], text) to postgres;

-- 기존 진입점의 계약: 새 장바구니 주문(true)은 출처와 무관하게 모두 닫고, 장바구니·주문서 복귀(false)는 지금처럼
-- 장바구니 출처만 닫는다 — 장바구니를 열기만 해도 다른 탭의 바로구매 결제창이 끊기지 않는다.
create or replace function private.supersede_unpaid_cart_orders(p_user_id uuid, p_new_order boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_new_order is null then
    raise invalid_parameter_value using message = 'cart_order_supersede_invalid';
  end if;
  return private.supersede_unpaid_checkout_orders(p_user_id, p_new_order,
    case when p_new_order then null else array['legacy_checkout', 'cart_transaction'] end,
    case when p_new_order then 'new_cart_order' else 'returned_to_cart' end);
end;
$$;
revoke all on function private.supersede_unpaid_cart_orders(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function private.supersede_unpaid_cart_orders(uuid, boolean) to postgres;

-- 고객이 '결제 대기 주문 취소하고 계속'을 누르기 전에 확인창에 보일 주문(ADR-0030). 이 계정의 결제를 마치지 않은 카드
-- 주문(보류가 남은 주문, 출처 무관) 가운데 닫을 수 있는 주문(releasable — 결제 승인 확인·결과 불명·결제 진행·처리 중인
-- 취소가 없다, close_unpaid_cart_order가 closed로 끝나는 조건)과 결제를 확인하고 있어 닫지 않는 주문을 나눠, 주문번호·
-- 첫 굿즈 이름·품목 수·금액·담긴 굿즈·옵션·쓴 보유 쿠폰과 함께 최근 것부터 돌려준다. 화면은 막힘의 원인일 수 있는 주문만
-- 고른다(재고·회원 누적 한도는 그 굿즈·옵션을 담은 주문, 쿠폰 사용은 그 쿠폰을 쓴 주문, 첫구매 예약만 모든 주문). 무통장
-- 입금 대기는 보류가 없어 여기 없다.
create function public.service_list_unpaid_checkout_orders(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', unpaid.id, 'orderNumber', unpaid.order_number, 'total', unpaid.total, 'createdAt', unpaid.created_at,
      'itemName', unpaid.item_name, 'itemCount', unpaid.item_count, 'goodIds', unpaid.good_ids, 'variantIds', unpaid.variant_ids,
      'userCouponIds', unpaid.user_coupon_ids, 'releasable', unpaid.releasable)
    order by unpaid.created_at desc, unpaid.id desc), '[]'::jsonb)
  from (
    select o.id, o.order_number, o.total, o.created_at,
      (select item.good_name_snapshot from public.order_items as item where item.order_id = o.id
        order by item.product_order_number nulls last, item.id limit 1) as item_name,
      (select pg_catalog.count(*)::integer from public.order_items as item where item.order_id = o.id) as item_count,
      (select coalesce(pg_catalog.jsonb_agg(distinct item.good_id), '[]'::jsonb) from public.order_items as item where item.order_id = o.id) as good_ids,
      (select coalesce(pg_catalog.jsonb_agg(distinct item.variant_id), '[]'::jsonb) from public.order_items as item
        where item.order_id = o.id and item.variant_id is not null) as variant_ids,
      (select coalesce(pg_catalog.jsonb_agg(distinct used.id), '[]'::jsonb) from (
        select redemption.user_coupon_id as id from public.coupon_redemptions as redemption
        where redemption.order_id = o.id and redemption.status = 'applied'
        union
        select held.id from public.user_coupons as held where held.used_order_id = o.id
      ) as used) as user_coupon_ids,
      not private.checkout_draft_order_payment_unresolved(o.id) as releasable
    from private.cart_order_holds as hold
    join public.orders as o on o.id = hold.order_id
    where p_user_id is not null and hold.user_id = p_user_id and hold.state = 'awaiting_payment'
      and o.user_id = p_user_id and o.status = 'pending' and o.payment_method = 'card'
    order by o.created_at desc, o.id desc
    limit 20
  ) as unpaid;
$$;
revoke all on function public.service_list_unpaid_checkout_orders(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_list_unpaid_checkout_orders(uuid) to service_role;

-- 고객이 확인창에서 본 결제 대기 주문을 확인한 뒤에만 부른다(서버가 로그인 사용자로만 부른다 — 주문서·장바구니를 열기만
-- 해서는 다른 탭의 결제창을 끊지 않는다). 견적이 결제 대기 주문의 쿠폰·첫구매 예약·구매 한도·재고 때문에 막혔을 때 고객이
-- 고른 주문(p_order_ids — 확인창에 보인 주문, 출처 무관)만 ADR-0026 닫기 경로로 닫는다. 확인창 뒤에 새로 생긴 주문은 닫지
-- 않는다. 잠금 순서는 supersede와 같다(계정 advisory → 대상 주문 행 → account-action). 결제 승인을 확인 중이거나 결과를
-- 알 수 없는 주문은 닫지 않고 confirming으로 센다(새 주문의 checkout_payment_in_progress 거절과 같은 판단).
create function public.release_unpaid_checkout_orders(p_user_id uuid, p_order_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_result text;
  v_released integer := 0;
  v_confirming integer := 0;
begin
  if p_user_id is null or p_order_ids is null or pg_catalog.cardinality(p_order_ids) not between 1 and 20
    or pg_catalog.array_position(p_order_ids, null) is not null then
    raise invalid_parameter_value using message = 'cart_order_supersede_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  perform 1
  from public.orders as o
  join private.cart_order_holds as hold on hold.order_id = o.id
  where hold.user_id = p_user_id and hold.state = 'awaiting_payment' and o.id = any (p_order_ids)
  order by o.id
  for update of o;
  if found then
    perform private.lock_account_action_subject(p_user_id);
    for r in
      select hold.order_id
      from private.cart_order_holds as hold
      where hold.user_id = p_user_id and hold.state = 'awaiting_payment' and hold.order_id = any (p_order_ids)
      order by hold.created_at, hold.order_id
    loop
      v_result := private.close_unpaid_cart_order(r.order_id, '고객이 진행 중인 미결제 주문을 취소하고 주문을 계속함', 'customer_released');
      if v_result = 'closed' then
        v_released := v_released + 1;
      elsif v_result in ('payment_confirming', 'unresolved') then
        v_confirming := v_confirming + 1;
      end if;
    end loop;
  end if;
  return pg_catalog.jsonb_build_object('released', v_released, 'confirming', v_confirming);
end;
$$;
revoke all on function public.release_unpaid_checkout_orders(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.release_unpaid_checkout_orders(uuid, uuid[]) to service_role;

-- 결제 화면의 '다시 결제' 판단. 장바구니 출처는 지금 모양 그대로, 바로구매는 출처와 상품 상세 굿즈를 더한다.
create or replace function public.service_get_order_cart_retention(p_user_id uuid, p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('state', hold.state, 'releaseReason', hold.release_reason)
    || case when hold.source in ('direct_checkout', 'direct_transaction')
      then pg_catalog.jsonb_build_object('source', 'direct', 'baseGoodId', hold.base_good_id) else '{}'::jsonb end
  from private.cart_order_holds as hold
  where hold.order_id = p_order_id and hold.user_id = p_user_id;
$$;
revoke all on function public.service_get_order_cart_retention(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_get_order_cart_retention(uuid, uuid) to service_role;

-- ── 바로구매 초안 ─────────────────────────────────────────────────────────────────
-- 다시 구매하기(service_retry_direct_order)로 만든 초안의 원 주문. 같은 주문의 다시 구매는 한 번이다 — 두 탭·뒤로 가기의
-- 재호출은 살아 있는 그 초안을 돌려주고, 그 초안이 이미 무통장 접수·결제 완료 주문을 만들었으면 그 주문으로 안내한다.
alter table private.checkout_drafts add column retry_order_id uuid references public.orders (id);
create unique index checkout_drafts_retry_order_key on private.checkout_drafts (retry_order_id) where retry_order_id is not null;
comment on column private.checkout_drafts.retry_order_id is
  '바로구매 다시 구매하기의 원 주문(ADR-0030). 주문당 다시 구매 초안 하나 — 재호출은 살아 있는 이 초안을 돌려준다.';

create function public.service_create_checkout_direct_draft(p_user_id uuid, p_base_good_id text, p_lines jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item record;
  v_variant uuid;
  v_key text;
  v_seen text[] := '{}';
  v_snapshot jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_draft uuid;
begin
  if p_user_id is null or nullif(btrim(p_base_good_id), '') is null
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 51
    or exists (
      select 1 from jsonb_array_elements(p_lines) as line
      where jsonb_typeof(line) <> 'object' or not line ?& array['good_id', 'variant_id', 'qty']
        or exists (select 1 from jsonb_object_keys(line) as key where key not in ('good_id', 'variant_id', 'qty', 'input_revision', 'input_values'))
        or jsonb_typeof(line -> 'good_id') <> 'string' or nullif(btrim(line ->> 'good_id'), '') is null
        or jsonb_typeof(line -> 'variant_id') <> 'string'
        or line ->> 'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(line -> 'qty') <> 'number' or line ->> 'qty' !~ '^[1-9][0-9]{0,8}$'
        or (line ? 'input_revision' and (jsonb_typeof(line -> 'input_revision') <> 'number' or line ->> 'input_revision' !~ '^(0|[1-9][0-9]*)$'))
        or (line ? 'input_values' and jsonb_typeof(line -> 'input_values') <> 'object')
    )
    or not exists (select 1 from jsonb_array_elements(p_lines) as line where line ->> 'good_id' = p_base_good_id)
  then
    raise invalid_parameter_value using message = 'invalid_checkout_direct';
  end if;
  perform private.assert_active_user(p_user_id);
  for item in
    select line ->> 'good_id' as good_id, (line ->> 'variant_id')::uuid as variant_id, (line ->> 'qty')::integer as qty,
      coalesce((line ->> 'input_revision')::integer, 0) as input_revision, coalesce(line -> 'input_values', '{}'::jsonb) as input_values,
      position
    from jsonb_array_elements(p_lines) with ordinality as entries(line, position)
    order by position
  loop
    -- 랜덤 판매 굿즈(D5②)는 장바구니 키(기본 옵션)로 모은다. 배정은 주문 생성이 한다.
    v_variant := private.cart_variant_key(item.good_id, item.variant_id);
    v_key := v_variant::text || ':' || case when item.input_revision = 0 and item.input_values = '{}'::jsonb then ''
      else md5(item.input_revision::text || ':' || item.input_values::text) end;
    if v_key = any (v_seen) then
      raise invalid_parameter_value using message = 'invalid_checkout_direct';
    end if;
    v_seen := array_append(v_seen, v_key);
    -- 담기(add_cart_selection)와 같은 규칙: 본품은 판매 중(19금은 인증 성인만), 추가 구성은 연결된 일반 굿즈만.
    if item.good_id = p_base_good_id then
      if not private.goods_selection_base_available(item.good_id, p_user_id) then
        if exists (select 1 from public.goods as good where good.id = item.good_id and good.sale_restriction = 'adult')
          and not private.adult_verification_valid(p_user_id) then
          raise check_violation using message = 'adult_verification_required';
        end if;
        raise check_violation using message = 'catalog_item_unavailable';
      end if;
    elsif not exists (select 1 from private.goods_additional_links as link where link.base_good_id = p_base_good_id and link.target_good_id = item.good_id)
      or not private.goods_additional_available(item.good_id) then
      raise check_violation using message = 'additional_good_unavailable';
    end if;
    if not exists (
      select 1 from public.goods_variants as variant
      where variant.id = v_variant and variant.good_id = item.good_id and variant.archived_at is null
    ) then
      raise check_violation using message = 'catalog_item_unavailable';
    end if;
    v_snapshot := private.resolve_goods_custom_inputs(item.good_id, item.input_revision, item.input_values);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('goodId', item.good_id, 'variantId', v_variant, 'qty', item.qty,
      'inputRevision', item.input_revision, 'inputValues', item.input_values, 'inputSnapshot', v_snapshot));
  end loop;
  perform private.trim_checkout_drafts(p_user_id);
  insert into private.checkout_drafts (user_id, source, base_good_id, lines, expires_at)
  values (p_user_id, 'direct', p_base_good_id, v_lines, pg_catalog.clock_timestamp() + private.checkout_draft_ttl())
  returning id into v_draft;
  return v_draft;
end;
$$;
revoke all on function public.service_create_checkout_direct_draft(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.service_create_checkout_direct_draft(uuid, text, jsonb) to service_role;

-- 바로구매 결제가 승인 전에 끝난 주문을 닫는다 — '다시 구매하기'와 '이 주문 닫고 굿즈 상세에서 다시 고르기'의 공용 판정.
-- 잠금 순서는 계정 advisory → 주문 행 → account-action → profiles다(close_unpaid_cart_order가 주문 행부터 잠그고, 취소 전이의
-- 등급 재계산이 profiles를 FOR UPDATE로 잡는다 — 결제 확정과 같은 방향). 그래서 정지 계정 확인은 profiles를 잠그지 않는 단순
-- 조회로 맨 앞에서 한다(assert_active_user의 FOR SHARE를 advisory보다 먼저 잡으면 다른 탭의 새 주문·결제 확정과 교착한다).
-- 초안을 만드는 service_create_checkout_direct_draft가 assert_active_user로 다시 막는다. 반환: closed(닫았거나 이미 결제 없이
-- 취소됨) | payment_in_progress(승인 확인 중·결과 불명 — 닫지 않는다) | not_retryable(결제가 끝났거나 아직 결제할 수 있는 주문이
-- 아니다). 이 계정의 바로구매 주문이 아니면 null. 닫는 감사 기록의 trigger는 고객 동작(customer_released)이다.
create function private.close_direct_order_for_retry(p_user_id uuid, p_order_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hold private.cart_order_holds%rowtype;
  v_result text;
  v_status public.order_status;
  v_suspended_at timestamptz;
begin
  if p_user_id is null or p_order_id is null then
    raise invalid_parameter_value using message = 'invalid_checkout_retry';
  end if;
  select profile.suspended_at into v_suspended_at from public.profiles as profile where profile.id = p_user_id;
  if not found then
    raise exception 'profile_not_found' using errcode = '22023';
  end if;
  if v_suspended_at is not null then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  select hold.* into v_hold from private.cart_order_holds as hold
  where hold.order_id = p_order_id and hold.user_id = p_user_id and hold.source in ('direct_checkout', 'direct_transaction');
  if not found then
    return null;
  end if;
  if v_hold.state = 'awaiting_payment' then
    v_result := private.close_unpaid_cart_order(p_order_id, '고객이 진행 중인 미결제 주문을 취소하고 주문을 계속함', 'customer_released');
    if v_result in ('payment_confirming', 'unresolved') then
      return 'payment_in_progress';
    end if;
  end if;
  select o.status into v_status from public.orders as o where o.id = p_order_id;
  if v_status = 'pending' and private.checkout_draft_order_payment_unresolved(p_order_id) then
    return 'payment_in_progress';
  end if;
  return case when v_status = 'canceled' then 'closed' else 'not_retryable' end;
end;
$$;
revoke all on function private.close_direct_order_for_retry(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.close_direct_order_for_retry(uuid, uuid) to postgres;

-- 바로구매 결제가 승인 전에 끝난 주문의 '다시 구매하기'(ADR-0030 확정 동작 8). 그 주문을 닫아 재고·쿠폰·적립금·첫구매 예약·
-- 구매 한도를 돌려준 뒤, 같은 줄(옵션·수량·추가 구성·직접입력값)로 바로구매 초안을 다시 만든다 — 고객은 굿즈 상세에서 다시
-- 고르지 않고 주문서로 간다(장바구니는 읽지도 바꾸지도 않는다). 본인 결제 대기 주문이 그 굿즈 재고를 잡고 있어 상세가 품절로
-- 보이던 문제도 함께 풀린다.
-- 같은 주문의 다시 구매는 한 번이다(두 탭·뒤로 가기): 그 주문에 연결된 다시 구매 초안(retry_order_id)이 살아 있으면 그 초안을
-- 돌려주고, 그 초안이 이미 무통장 접수·결제 완료 주문을 만들었으면 not_retryable(orderId = 그 주문), 그 주문의 결제를 확인하고
-- 있으면 payment_in_progress(orderId = 그 주문)다. 초안이 만료됐으면 연결을 풀고 새로 만든다. 두 호출은 계정 advisory에서
-- 차례로 오므로 초안은 하나다(부분 유일 색인이 한 번 더 막는다).
-- 반환: {"result":"draft","draftId"} | {"result":"payment_in_progress"[,"orderId"]} | {"result":"not_retryable"[,"orderId"]}
--      | {"result":"unavailable","baseGoodId","reason"}(닫았지만 지금 같은 줄로 초안을 만들 수 없다 — 굿즈 상세에서 다시
--      고른다). 이 계정의 바로구매 주문이 아니면 null.
create function public.service_retry_direct_order(p_user_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result text;
  v_hold private.cart_order_holds%rowtype;
  v_existing private.checkout_drafts%rowtype;
  v_lines jsonb;
  v_draft uuid;
begin
  v_result := private.close_direct_order_for_retry(p_user_id, p_order_id);
  if v_result is null then
    return null;
  end if;
  if v_result <> 'closed' then
    return pg_catalog.jsonb_build_object('result', v_result);
  end if;
  select draft.* into v_existing from private.checkout_drafts as draft
  where draft.retry_order_id = p_order_id and draft.user_id = p_user_id
  for update;
  if found then
    if v_existing.order_id is not null and private.checkout_draft_order_settled(v_existing.order_id) then
      return pg_catalog.jsonb_build_object('result', 'not_retryable', 'orderId', v_existing.order_id);
    end if;
    if v_existing.order_id is not null and private.checkout_draft_order_payment_unresolved(v_existing.order_id) then
      return pg_catalog.jsonb_build_object('result', 'payment_in_progress', 'orderId', v_existing.order_id);
    end if;
    if v_existing.scrubbed_at is null and v_existing.expires_at > pg_catalog.clock_timestamp() then
      return pg_catalog.jsonb_build_object('result', 'draft', 'draftId', v_existing.id);
    end if;
    update private.checkout_drafts set retry_order_id = null where id = v_existing.id;
  end if;
  select hold.* into v_hold from private.cart_order_holds as hold where hold.order_id = p_order_id;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('good_id', line ->> 'goodId', 'variant_id', line ->> 'variantId',
      'qty', (line ->> 'qty')::integer, 'input_revision', coalesce((line ->> 'inputRevision')::integer, 0),
      'input_values', coalesce(line -> 'inputValues', '{}'::jsonb)) order by position)
    into v_lines
  from pg_catalog.jsonb_array_elements(v_hold.lines) with ordinality as entries(line, position);
  -- 닫기는 남기고 초안만 되돌린다 — 지금 같은 줄을 살 수 없으면(판매 중지·옵션 정리·직접입력 설정 변경·성인 인증) 굿즈 상세로.
  begin
    v_draft := public.service_create_checkout_direct_draft(p_user_id, v_hold.base_good_id, v_lines);
  exception when check_violation or invalid_parameter_value then
    return pg_catalog.jsonb_build_object('result', 'unavailable', 'baseGoodId', v_hold.base_good_id, 'reason', sqlerrm);
  end;
  update private.checkout_drafts set retry_order_id = p_order_id where id = v_draft;
  return pg_catalog.jsonb_build_object('result', 'draft', 'draftId', v_draft);
end;
$$;
revoke all on function public.service_retry_direct_order(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_retry_direct_order(uuid, uuid) to service_role;

-- '이 주문 닫고 굿즈 상세에서 다시 고르기': 같은 닫기만 하고 초안은 만들지 않는다 — 마지막 재고를 잡은 본인 주문 때문에 상세가
-- 품절로 보이지 않게, 상세로 가기 전에 닫는다. 반환은 {"result":"closed"|"payment_in_progress"|"not_retryable","baseGoodId"}.
-- 이 계정의 바로구매 주문이 아니면 null.
create function public.service_close_direct_order(p_user_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result text;
begin
  v_result := private.close_direct_order_for_retry(p_user_id, p_order_id);
  if v_result is null then
    return null;
  end if;
  return pg_catalog.jsonb_build_object('result', v_result, 'baseGoodId',
    (select hold.base_good_id from private.cart_order_holds as hold where hold.order_id = p_order_id));
end;
$$;
revoke all on function public.service_close_direct_order(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_close_direct_order(uuid, uuid) to service_role;

-- ── 바로구매 주문서 견적: 주문서에서 고른 쿠폰 ─────────────────────────────────────
create function public.quote_goods_sales_for_address_with_coupon(items jsonb, destination jsonb, p_user_coupon_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare quote jsonb;
begin
  quote := public.quote_goods_sales_for_address(items, destination);
  return quote || jsonb_build_object('coupon', private.quote_user_coupon(p_user_coupon_id, quote -> 'lines',
    (quote ->> 'subtotal')::bigint, (quote -> 'shipping' ->> 'totalFee')::bigint));
end;
$$;
revoke all on function public.quote_goods_sales_for_address_with_coupon(jsonb, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.quote_goods_sales_for_address_with_coupon(jsonb, jsonb, uuid) to authenticated;

create function public.get_my_store_credit_checkout_for_direct(p_requested_amount bigint, p_destination jsonb, p_items jsonb, p_user_coupon_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.store_credit_checkout_quote_for_items(p_requested_amount, p_destination, p_items, false, p_user_coupon_id); $$;
revoke all on function public.get_my_store_credit_checkout_for_direct(bigint, jsonb, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_store_credit_checkout_for_direct(bigint, jsonb, jsonb, uuid) to authenticated;

-- ── 바로구매 주문 진입점 ─────────────────────────────────────────────────────────────
create function public.place_direct_order(
  p_user_id uuid, p_draft_id uuid, p_address jsonb, p_checkout_key uuid,
  p_payment_method public.order_payment_method, p_store_credit_amount bigint, p_user_coupon_id uuid
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft private.checkout_drafts%rowtype;
  placed uuid;
begin
  if p_user_id is null or p_checkout_key is null or p_draft_id is null then
    raise invalid_parameter_value using message = 'invalid_checkout_direct';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  -- 같은 키 재요청은 초안·장바구니를 다시 보지 않고 원래 주문(쓴 쿠폰까지)을 돌려준다.
  if exists (select 1 from public.orders where user_id = p_user_id and checkout_key = p_checkout_key) then
    return public.place_order_with_store_credits(p_user_id, p_address, p_checkout_key, p_payment_method, p_store_credit_amount, p_user_coupon_id);
  end if;
  -- 이 초안으로 만든 주문을 먼저 잠근 뒤, 이미 무통장 접수·결제 완료면 새 키의 재제출(다른 탭·뒤로 가기)을 PT409
  -- checkout_draft_used로, 결제가 아직 확정되지 않았으면(승인 확인 중·결과 불명) PT409 checkout_payment_in_progress로
  -- 거절한다. 승인 전에 끝난 카드 미결제 주문이면 아래 supersede가 그 주문을 닫고 새 주문을 만든다.
  v_draft := private.checkout_draft_for_order(p_user_id, p_draft_id, 'direct', true);
  -- 배송비 쿠폰은 legacy 주문서가 받지 않는다(장바구니 쿠폰 선택과 같은 거절).
  if p_user_coupon_id is not null and exists (
    select 1 from public.user_coupons as held join public.coupons as c on c.code = held.coupon_code
    where held.id = p_user_coupon_id and c.benefit_kind = 'shipping'
  ) then
    raise check_violation using message = 'coupon_checkout_required';
  end if;
  -- 이전 미결제 주문(장바구니·바로구매 모두)의 재고·쿠폰·적립금·첫구매 예약·구매 한도를 먼저 돌려준다(ADR-0026·0030).
  perform private.supersede_unpaid_checkout_orders(p_user_id, true, null, 'new_direct_order');
  perform private.lock_account_action_subject(p_user_id);
  update private.checkout_drafts set user_coupon_id = p_user_coupon_id where id = p_draft_id;
  -- 카드는 쿠폰의 장바구니 선택을 결제 확정 때 정리한다(보류). 무통장은 접수 때 코어가 같은 쿠폰 선택만 지운다.
  if p_payment_method = 'card' then perform set_config('icons.cart_order_retention', 'on', true); end if;
  perform set_config('icons.checkout_draft', p_draft_id::text, true);
  placed := public.place_order_with_store_credits(p_user_id, p_address, p_checkout_key, p_payment_method, p_store_credit_amount);
  perform set_config('icons.checkout_draft', '', true);
  perform set_config('icons.cart_order_retention', '', true);
  update private.checkout_drafts set order_id = placed where id = p_draft_id;
  if p_payment_method = 'card' then
    perform private.record_direct_order_hold(placed, p_user_id, 'direct_checkout', v_draft.lines, v_draft.base_good_id);
  end if;
  return placed;
end;
$$;
revoke all on function public.place_direct_order(uuid, uuid, jsonb, uuid, public.order_payment_method, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.place_direct_order(uuid, uuid, jsonb, uuid, public.order_payment_method, bigint, uuid) to service_role;

select private.register_operator_internal_contract('public.place_direct_order(uuid,uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)'::regprocedure);

notify pgrst, 'reload schema';
