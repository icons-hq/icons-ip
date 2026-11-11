-- ============================================================================
-- 장바구니 선택 주문 (10/14 실사용 QA 회의 1014-031·032, ADR-0030)
--
-- 지금까지 legacy 주문은 "주문 = 장바구니 전체"였다(place_order_with_cart_snapshot이 기대 장바구니와 계정
-- 장바구니 전체를 비교). 고객이 체크한 줄만 주문하고 나머지는 결제 뒤에도 장바구니에 남게 한다.
--
-- 1. 주문서 초안(private.checkout_drafts): 장바구니 화면이 고른 줄(selection)이나 상품 상세의 바로구매 선택
--    (direct, 다음 migration)을 서버에 둔다. 직접입력값(각인 문구 등)을 URL에 싣지 않고, 새로고침·다른 탭에서도
--    같은 주문서를 보이며, 소유·만료를 서버가 판정한다. 만료 행은 cron이 지운다.
-- 2. 주문 줄 원본(private.checkout_source_lines): legacy 주문 코어(place_order_before_shipments)가 장바구니를
--    직접 읽던 다섯 곳(굿즈 잠금·커서·굿즈별 수량 합·쿠폰 선택·래퍼의 그룹상품 판정)을 원본 함수로 모은다.
--    트랜잭션 로컬 설정 icons.checkout_draft가 비어 있으면 지금처럼 장바구니 전체다 — 옛 진입점
--    (place_order_with_cart_snapshot)과 신뢰 경로(place_order*)는 한 글자도 바뀌지 않는다. 코어를 복제하지
--    않고 앵커 치환으로만 고친다(각 앵커가 정확히 한 번 나와야 한다).
-- 3. 선택 주문 진입점(place_order_with_cart_selection): 사용자 advisory → 이전 미결제 주문 닫기(ADR-0026) →
--    account-action → 'cart:' → 선택 cart 행 id순 FOR UPDATE·정확 일치 검증(아니면 PT409 cart_snapshot_changed)
--    → 코어(원본 = 선택 줄) → 카드면 선택 줄만 보류. 결제 확정 정산은 줄 단위라 그대로 선택 줄만 뺀다. 무통장은
--    코어가 선택 줄만 돌므로 선택 줄만 접수 때 빠진다. 같은 checkout_key 재요청은 지금처럼 맨 앞에서 원래 주문을
--    돌려준다(지금 장바구니·초안과 비교하지 않는다).
-- 4. 적립금 사용 한도 견적도 고른 품목 기준이다(get_my_store_credit_checkout_for_items).
-- ============================================================================

create table private.checkout_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('selection', 'direct')),
  base_good_id text,
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 19239),
  user_coupon_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check ((source = 'direct') = (base_good_id is not null)),
  check (source = 'direct' or user_coupon_id is null),
  check (expires_at > created_at)
);
comment on table private.checkout_drafts is
  '주문서 초안(ADR-0030): 장바구니 선택 줄(selection)·바로구매 선택(direct). 직접입력값을 URL에 싣지 않으려고 서버에 둔다. 만료 행은 cron이 지운다.';
create index checkout_drafts_user_idx on private.checkout_drafts (user_id, created_at);
create index checkout_drafts_expiry_idx on private.checkout_drafts (expires_at);
alter table private.checkout_drafts enable row level security;
revoke all on table private.checkout_drafts from public, anon, authenticated, service_role;

-- ── 주문 줄 원본 ─────────────────────────────────────────────────────────────
-- 설정이 비어 있으면 계정 장바구니 전체(지금 계약). p_lock이면 줄을 굿즈·옵션·행 순서로 잠근다 — 코어는 굿즈
-- 부모 행을 먼저 잠근 뒤 커서에서 이 함수를 부르므로 잠금 순서(굿즈 → 장바구니 행 → 옵션)가 그대로다.
-- selection은 초안이 고른 장바구니 행만, direct는 초안 줄(장바구니 행 없음, cart_item_id null)이다.
create function private.checkout_source_lines(p_user_id uuid, p_lock boolean)
returns table (cart_item_id uuid, good_id text, variant_id uuid, qty integer, input_revision integer, input_values jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_setting text := coalesce(pg_catalog.current_setting('icons.checkout_draft', true), '');
  v_draft private.checkout_drafts%rowtype;
begin
  if v_setting = '' then
    if p_lock then
      return query select cart.id, cart.good_id, cart.variant_id, cart.qty, cart.input_revision, cart.input_values
        from public.cart_items as cart where cart.user_id = p_user_id
        order by cart.good_id, cart.variant_id, cart.id for update;
    else
      return query select cart.id, cart.good_id, cart.variant_id, cart.qty, cart.input_revision, cart.input_values
        from public.cart_items as cart where cart.user_id = p_user_id;
    end if;
    return;
  end if;
  select draft.* into v_draft from private.checkout_drafts as draft
  where draft.id = v_setting::uuid and draft.user_id = p_user_id;
  if not found then
    raise check_violation using message = 'checkout_draft_unavailable';
  end if;
  if v_draft.source = 'selection' then
    if p_lock then
      return query select cart.id, cart.good_id, cart.variant_id, cart.qty, cart.input_revision, cart.input_values
        from public.cart_items as cart
        where cart.user_id = p_user_id
          and cart.id in (select (line ->> 'cartItemId')::uuid from pg_catalog.jsonb_array_elements(v_draft.lines) as line)
        order by cart.good_id, cart.variant_id, cart.id for update;
    else
      return query select cart.id, cart.good_id, cart.variant_id, cart.qty, cart.input_revision, cart.input_values
        from public.cart_items as cart
        where cart.user_id = p_user_id
          and cart.id in (select (line ->> 'cartItemId')::uuid from pg_catalog.jsonb_array_elements(v_draft.lines) as line);
    end if;
    return;
  end if;
  return query select null::uuid, line ->> 'goodId', (line ->> 'variantId')::uuid, (line ->> 'qty')::integer,
      (line ->> 'inputRevision')::integer, line -> 'inputValues'
    from pg_catalog.jsonb_array_elements(v_draft.lines) as line;
end;
$$;
revoke all on function private.checkout_source_lines(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function private.checkout_source_lines(uuid, boolean) to postgres;

-- 주문이 쓸 쿠폰. 장바구니·선택 주문은 지금처럼 장바구니 쿠폰 선택(한 장), 바로구매는 주문서에서 고른 쿠폰이다.
create function private.checkout_source_coupon(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_setting text := coalesce(pg_catalog.current_setting('icons.checkout_draft', true), '');
  v_draft private.checkout_drafts%rowtype;
begin
  if v_setting <> '' then
    select draft.* into v_draft from private.checkout_drafts as draft
    where draft.id = v_setting::uuid and draft.user_id = p_user_id;
    if not found then
      raise check_violation using message = 'checkout_draft_unavailable';
    end if;
    if v_draft.source = 'direct' then
      return v_draft.user_coupon_id;
    end if;
  end if;
  return (select selection.user_coupon_id from public.cart_coupon_selections as selection where selection.user_id = p_user_id);
end;
$$;
revoke all on function private.checkout_source_coupon(uuid) from public, anon, authenticated, service_role;
grant execute on function private.checkout_source_coupon(uuid) to postgres;

-- ── legacy 주문 코어·래퍼: 장바구니 직접 읽기를 원본 함수로 바꾼다 ───────────────────
do $$
declare
  v_definition text;
  v_anchor record;
begin
  v_definition := pg_catalog.pg_get_functiondef('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure);
  for v_anchor in
    select * from (values
      (1, E'    join (select distinct good_id from public.cart_items where user_id=v_user) selected on selected.good_id=good.id',
          E'    join (select distinct source.good_id from private.checkout_source_lines(v_user,false) as source) selected on selected.good_id=good.id'),
      (2, E'      cart.id as cart_item_id,',
          E'      cart.cart_item_id,'),
      (3, E'    from public.cart_items as cart\n    join public.goods as good on good.id = cart.good_id\n    where cart.user_id = v_user\n    order by cart.good_id, cart.variant_id, cart.id\n    for update of cart',
          E'    -- 주문 줄 원본(ADR-0030): 장바구니 전체·선택 줄·바로구매 초안. 장바구니 행은 원본 함수가 이 순서로 잠근다.\n    from private.checkout_source_lines(v_user,true) as cart\n    join public.goods as good on good.id = cart.good_id\n    order by cart.good_id, cart.variant_id, cart.cart_item_id'),
      (4, E'      select sum(qty::bigint) into v_good_qty from public.cart_items where user_id=v_user and good_id=r.good_id;',
          E'      select sum(source.qty::bigint) into v_good_qty from private.checkout_source_lines(v_user,false) as source where source.good_id=r.good_id;'),
      (5, E'  select selection.user_coupon_id\n  into v_selected_coupon\n  from public.cart_coupon_selections as selection\n  where selection.user_id = v_user;',
          E'  -- 장바구니·선택 주문은 장바구니 쿠폰 선택, 바로구매는 주문서에서 고른 쿠폰이다(ADR-0030).\n  v_selected_coupon := private.checkout_source_coupon(v_user);')
    ) as anchors(position, anchor, replacement)
    order by position
  loop
    if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor.anchor, ''))) / pg_catalog.length(v_anchor.anchor) <> 1 then
      raise exception 'checkout_source_place_order_anchor_changed: %', v_anchor.position;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_anchor.anchor, v_anchor.replacement);
  end loop;
  execute v_definition;

  v_definition := pg_catalog.pg_get_functiondef('public.place_order(jsonb,uuid,public.order_payment_method)'::regprocedure);
  for v_anchor in
    select * from (values
      (1, 'exists(select 1 from public.cart_items cart join private.goods_aggregation_members family on family.good_id=cart.good_id where cart.user_id=auth.uid())',
          'exists(select 1 from private.checkout_source_lines(auth.uid(),false) cart join private.goods_aggregation_members family on family.good_id=cart.good_id)'),
      (2, 'exists(select 1 from public.cart_items c join private.shipping_charge_group_assignments a on a.owner_good_id=private.goods_aggregation_owner(c.good_id) and a.group_id is not null where c.user_id=auth.uid())',
          'exists(select 1 from private.checkout_source_lines(auth.uid(),false) c join private.shipping_charge_group_assignments a on a.owner_good_id=private.goods_aggregation_owner(c.good_id) and a.group_id is not null)')
    ) as anchors(position, anchor, replacement)
    order by position
  loop
    if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor.anchor, ''))) / pg_catalog.length(v_anchor.anchor) <> 1 then
      raise exception 'checkout_source_place_order_wrapper_anchor_changed: %', v_anchor.position;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_anchor.anchor, v_anchor.replacement);
  end loop;
  execute v_definition;
end;
$$;
revoke all on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) from public, anon, authenticated, service_role;
grant execute on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) to postgres;
revoke all on function public.place_order(jsonb,uuid,public.order_payment_method) from public, anon, authenticated, service_role;
grant execute on function public.place_order(jsonb,uuid,public.order_payment_method) to postgres;

-- ── 보류: 주문에 들어간 줄을 그대로 받는다 ─────────────────────────────────────────
-- record_cart_order_hold(장바구니 전체)는 옛 진입점이 그대로 쓴다. 선택 주문은 선택 줄만 넘긴다.
create function private.record_checkout_order_hold(p_order_id uuid, p_user_id uuid, p_source text, p_lines jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
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
  insert into private.cart_order_holds (order_id, user_id, source, lines)
  values (p_order_id, p_user_id, p_source, p_lines)
  on conflict (order_id) do nothing;
end;
$$;
revoke all on function private.record_checkout_order_hold(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.record_checkout_order_hold(uuid, uuid, text, jsonb) to postgres;

-- ── 주문서 초안 ─────────────────────────────────────────────────────────────────
-- 만료 시간은 주문서에서 배송지를 적고 결제창(10분)을 거치는 한 번의 주문 흐름을 덮는다.
create function private.checkout_draft_ttl()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '60 minutes' $$;
revoke all on function private.checkout_draft_ttl() from public, anon, authenticated, service_role;
grant execute on function private.checkout_draft_ttl() to postgres;

-- 같은 계정의 만료 초안을 지우고, 살아 있는 초안이 너무 많으면 오래된 것부터 지운다(개인정보 최소 보관).
create function private.trim_checkout_drafts(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from private.checkout_drafts as draft
  where draft.user_id = p_user_id and draft.expires_at <= pg_catalog.clock_timestamp();
  delete from private.checkout_drafts as draft
  where draft.id in (
    select live.id from private.checkout_drafts as live
    where live.user_id = p_user_id
    order by live.created_at desc, live.id desc
    offset 19
  );
end;
$$;
revoke all on function private.trim_checkout_drafts(uuid) from public, anon, authenticated, service_role;
grant execute on function private.trim_checkout_drafts(uuid) to postgres;

-- 장바구니 화면이 체크한 줄로 선택 주문 초안을 만든다(서버가 로그인 사용자로만 부른다). 줄은 화면이 본
-- 장바구니 줄(굿즈·옵션·수량·직접입력값)과 정확히 같아야 한다 — 다른 탭에서 바뀌었으면 PT409다.
create function public.service_create_checkout_selection_draft(p_user_id uuid, p_lines jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_count integer;
  v_draft uuid;
begin
  if p_user_id is null or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 19239
    or exists (
      select 1 from jsonb_array_elements(p_lines) as entry
      where jsonb_typeof(entry) <> 'object' or not (entry ?& array['good_id', 'variant_id', 'qty', 'input_revision', 'input_values'])
        or exists (select 1 from jsonb_object_keys(entry) as key where key not in ('good_id', 'variant_id', 'qty', 'input_revision', 'input_values'))
        or jsonb_typeof(entry -> 'good_id') <> 'string' or nullif(btrim(entry ->> 'good_id'), '') is null
        or jsonb_typeof(entry -> 'variant_id') <> 'string'
        or entry ->> 'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(entry -> 'qty') <> 'number' or entry ->> 'qty' !~ '^[1-9][0-9]*$'
        or jsonb_typeof(entry -> 'input_revision') <> 'number' or entry ->> 'input_revision' !~ '^(0|[1-9][0-9]*)$'
        or jsonb_typeof(entry -> 'input_values') <> 'object'
    )
  then
    raise invalid_parameter_value using message = 'invalid_checkout_selection';
  end if;
  perform private.assert_active_user(p_user_id);
  select coalesce(jsonb_agg(jsonb_build_object('cartItemId', cart.id, 'goodId', cart.good_id, 'variantId', cart.variant_id,
      'qty', cart.qty, 'inputRevision', cart.input_revision, 'inputValues', cart.input_values, 'inputSnapshot', cart.input_snapshot)
      order by cart.good_id, cart.variant_id, cart.input_key), '[]'::jsonb),
    count(*)
    into v_lines, v_count
  from public.cart_items as cart
  where cart.user_id = p_user_id
    and exists (
      select 1 from jsonb_to_recordset(p_lines) as entry(good_id text, variant_id uuid, qty integer, input_revision integer, input_values jsonb)
      where entry.good_id = cart.good_id and entry.variant_id = cart.variant_id and entry.qty = cart.qty
        and entry.input_revision = cart.input_revision and entry.input_values = cart.input_values
    );
  -- 화면이 넘긴 줄마다 같은 장바구니 행이 하나씩 있어야 한다(중복 줄·사라진 줄·바뀐 수량은 모두 불일치).
  if v_count <> jsonb_array_length(p_lines) then
    raise sqlstate 'PT409' using message = 'cart_snapshot_changed';
  end if;
  perform private.trim_checkout_drafts(p_user_id);
  insert into private.checkout_drafts (user_id, source, lines, expires_at)
  values (p_user_id, 'selection', v_lines, pg_catalog.clock_timestamp() + private.checkout_draft_ttl())
  returning id into v_draft;
  return v_draft;
end;
$$;
revoke all on function public.service_create_checkout_selection_draft(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.service_create_checkout_selection_draft(uuid, jsonb) to service_role;

-- 주문서가 초안을 읽는다. 다른 계정·만료 초안은 null이다. 선택 초안은 지금 장바구니와 달라졌는지(stale)도 알린다.
create function public.service_get_checkout_draft(p_user_id uuid, p_draft_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', draft.id,
    'source', draft.source,
    'baseGoodId', draft.base_good_id,
    'expiresAt', draft.expires_at,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('goodId', line ->> 'goodId', 'variantId', line ->> 'variantId',
        'qty', (line ->> 'qty')::integer, 'customInputs', line -> 'inputSnapshot') order by position), '[]'::jsonb)
      from jsonb_array_elements(draft.lines) with ordinality as entries(line, position)),
    'stale', draft.source = 'selection' and exists (
      select 1 from jsonb_array_elements(draft.lines) as line
      where not exists (
        select 1 from public.cart_items as cart
        where cart.user_id = draft.user_id and cart.id = (line ->> 'cartItemId')::uuid
          and cart.good_id = line ->> 'goodId' and cart.variant_id = (line ->> 'variantId')::uuid
          and cart.qty = (line ->> 'qty')::integer and cart.input_revision = (line ->> 'inputRevision')::integer
          and cart.input_values = line -> 'inputValues')))
  from private.checkout_drafts as draft
  where draft.id = p_draft_id and draft.user_id = p_user_id and draft.expires_at > statement_timestamp();
$$;
revoke all on function public.service_get_checkout_draft(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_get_checkout_draft(uuid, uuid) to service_role;

-- 결제 없이 끝난 장바구니 주문의 '다시 결제하기'(ADR-0026 retry_from_cart). 그 주문의 보류 줄 가운데 아직 장바구니에
-- 있는 줄(옵션·직접입력값 기준, 수량은 지금 장바구니 값)로 선택 초안을 만든다 — 선택 주문을 다시 결제할 때
-- 고르지 않았던 줄이 주문서에 끼어들지 않는다. 남은 줄이 없거나 장바구니 주문이 아니면 null.
create function public.service_create_checkout_retry_draft(p_user_id uuid, p_order_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hold private.cart_order_holds%rowtype;
  v_lines jsonb;
  v_draft uuid;
begin
  if p_user_id is null or p_order_id is null then
    raise invalid_parameter_value using message = 'invalid_checkout_retry';
  end if;
  perform private.assert_active_user(p_user_id);
  select hold.* into v_hold from private.cart_order_holds as hold
  where hold.order_id = p_order_id and hold.user_id = p_user_id
    and hold.source in ('legacy_checkout', 'cart_transaction')
    and (hold.state = 'awaiting_payment' or (hold.state = 'released' and hold.release_reason <> 'detached'));
  if not found then
    return null;
  end if;
  select jsonb_agg(jsonb_build_object('cartItemId', cart.id, 'goodId', cart.good_id, 'variantId', cart.variant_id,
      'qty', cart.qty, 'inputRevision', cart.input_revision, 'inputValues', cart.input_values, 'inputSnapshot', cart.input_snapshot)
      order by cart.good_id, cart.variant_id, cart.input_key)
    into v_lines
  from public.cart_items as cart
  where cart.user_id = p_user_id
    and exists (select 1 from jsonb_array_elements(v_hold.lines) as line
      where (line ->> 'variantId')::uuid = cart.variant_id and line ->> 'inputKey' = cart.input_key);
  if v_lines is null then
    return null;
  end if;
  perform private.trim_checkout_drafts(p_user_id);
  insert into private.checkout_drafts (user_id, source, lines, expires_at)
  values (p_user_id, 'selection', v_lines, pg_catalog.clock_timestamp() + private.checkout_draft_ttl())
  returning id into v_draft;
  return v_draft;
end;
$$;
revoke all on function public.service_create_checkout_retry_draft(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_create_checkout_retry_draft(uuid, uuid) to service_role;

create function public.purge_expired_checkout_drafts(p_limit integer default 1000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare deleted integer;
begin
  if p_limit is null or p_limit not between 1 and 10000 then
    raise invalid_parameter_value using message = 'invalid_checkout_draft_cleanup_limit';
  end if;
  with expired as (
    select draft.id from private.checkout_drafts as draft
    where draft.expires_at <= pg_catalog.clock_timestamp()
    order by draft.expires_at, draft.id
    for update skip locked
    limit p_limit
  )
  delete from private.checkout_drafts as draft using expired where draft.id = expired.id;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;
revoke all on function public.purge_expired_checkout_drafts(integer) from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_checkout_drafts(integer) to service_role;

-- ── 선택 주문 진입점 ─────────────────────────────────────────────────────────────
create function public.place_order_with_cart_selection(
  p_user_id uuid, p_draft_id uuid, p_address jsonb, p_checkout_key uuid,
  p_payment_method public.order_payment_method, p_store_credit_amount bigint, p_expected_user_coupon_id uuid
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_draft private.checkout_drafts%rowtype;
  v_hold_lines jsonb;
  v_matched integer;
  placed uuid;
begin
  if p_user_id is null or p_checkout_key is null or p_draft_id is null then
    raise invalid_parameter_value using message = 'invalid_checkout_selection';
  end if;
  -- 주문 생성·쿠폰 선택과 같은 계정 잠금. 같은 키 재요청은 지금 장바구니·초안을 보지 않고 원래 주문을 돌려준다.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if exists (select 1 from public.orders where user_id = p_user_id and checkout_key = p_checkout_key) then
    return public.place_order_with_store_credits(p_user_id, p_address, p_checkout_key, p_payment_method, p_store_credit_amount, p_expected_user_coupon_id);
  end if;
  select draft.* into v_draft from private.checkout_drafts as draft
  where draft.id = p_draft_id and draft.user_id = p_user_id and draft.source = 'selection'
    and draft.expires_at > pg_catalog.clock_timestamp();
  if not found then
    raise sqlstate 'PT409' using message = 'checkout_draft_expired';
  end if;
  -- 이전 미결제 주문의 재고·쿠폰·적립금·구매 한도를 먼저 돌려준다(ADR-0026, 출처 무관).
  perform private.supersede_unpaid_cart_orders(p_user_id, true);
  -- 주문 → account-action → 장바구니 순서. 새 주문 INSERT의 계정 fence도 같은 키를 다시 잡는다.
  perform private.lock_account_action_subject(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('cart:' || p_user_id::text, 0));
  -- 고른 장바구니 행을 id 순으로 잠그고, 초안의 줄과 정확히 같은지 본다(수량·직접입력값까지).
  perform 1 from public.cart_items as cart
  where cart.user_id = p_user_id
    and cart.id in (select (line ->> 'cartItemId')::uuid from jsonb_array_elements(v_draft.lines) as line)
  order by cart.id
  for update;
  select count(*),
    coalesce(jsonb_agg(jsonb_build_object('goodId', cart.good_id, 'variantId', cart.variant_id, 'inputKey', cart.input_key,
      'inputRevision', cart.input_revision, 'inputValues', cart.input_values, 'qty', cart.qty)
      order by cart.good_id, cart.variant_id, cart.input_key), '[]'::jsonb)
    into v_matched, v_hold_lines
  from public.cart_items as cart
  join jsonb_array_elements(v_draft.lines) as line on (line ->> 'cartItemId')::uuid = cart.id
  where cart.user_id = p_user_id
    and cart.good_id = line ->> 'goodId' and cart.variant_id = (line ->> 'variantId')::uuid
    and cart.qty = (line ->> 'qty')::integer and cart.input_revision = (line ->> 'inputRevision')::integer
    and cart.input_values = line -> 'inputValues';
  if v_matched <> jsonb_array_length(v_draft.lines) then
    raise sqlstate 'PT409' using message = 'cart_snapshot_changed';
  end if;
  if p_payment_method = 'card' then perform set_config('icons.cart_order_retention', 'on', true); end if;
  perform set_config('icons.checkout_draft', p_draft_id::text, true);
  placed := public.place_order_with_store_credits(p_user_id, p_address, p_checkout_key, p_payment_method, p_store_credit_amount, p_expected_user_coupon_id);
  perform set_config('icons.checkout_draft', '', true);
  perform set_config('icons.cart_order_retention', '', true);
  -- 카드는 결제 확정 때 장바구니에서 뺀다(ADR-0026). 보류 줄 = 고른 줄이라 고르지 않은 줄은 결제 뒤에도 남는다.
  if p_payment_method = 'card' then
    perform private.record_checkout_order_hold(placed, p_user_id, 'legacy_checkout', v_hold_lines);
  end if;
  return placed;
end;
$$;
revoke all on function public.place_order_with_cart_selection(uuid, uuid, jsonb, uuid, public.order_payment_method, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.place_order_with_cart_selection(uuid, uuid, jsonb, uuid, public.order_payment_method, bigint, uuid) to service_role;

-- ── 고른 품목 기준 쿠폰·적립금 견적 ───────────────────────────────────────────────
-- quote_selected_coupon(장바구니 쿠폰 선택)과 같은 모양으로 쿠폰 한 장을 평가한다. 쿠폰이 없으면 null.
create function private.quote_user_coupon(p_user_coupon_id uuid, p_lines jsonb, p_subtotal bigint, p_shipping_fee bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); lines jsonb; evaluated record; discount bigint;
begin
  if actor is null or p_user_coupon_id is null then return null; end if;
  -- 배송비 쿠폰은 legacy 주문서가 받지 않는다(장바구니 선택 RPC와 같은 거절).
  if exists (select 1 from public.user_coupons as held join public.coupons as c on c.code = held.coupon_code
    where held.id = p_user_coupon_id and c.benefit_kind = 'shipping') then
    return jsonb_build_object('userCouponId', p_user_coupon_id, 'couponCode', '', 'eligibleSubtotal', 0, 'discount', 0, 'reason', 'coupon_checkout_required');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('good_id', line ->> 'goodId', 'subtotal', (line ->> 'qty')::bigint * (line ->> 'effectivePrice')::bigint)), '[]')
    into lines from jsonb_array_elements(p_lines) as line;
  select * into evaluated from private.evaluate_coupon_target_lines(p_user_coupon_id, actor, lines, null);
  discount := case when evaluated.o_reason is null then least(evaluated.o_discount, greatest(0, p_subtotal + p_shipping_fee - 1000)) else 0 end;
  return jsonb_build_object('userCouponId', p_user_coupon_id, 'couponCode', coalesce(evaluated.o_coupon_code, ''),
    'eligibleSubtotal', evaluated.o_eligible_subtotal, 'discount', discount,
    'reason', case when evaluated.o_reason is null and discount = 0 then 'coupon_no_discount' else evaluated.o_reason end);
end;
$$;
revoke all on function private.quote_user_coupon(uuid, jsonb, bigint, bigint) from public, anon, authenticated, service_role;
grant execute on function private.quote_user_coupon(uuid, jsonb, bigint, bigint) to postgres;

-- store_credit_checkout_quote(장바구니 전체)와 같은 판정을 넘겨받은 품목으로 한다. p_cart_coupon이면 장바구니 쿠폰
-- 선택(선택 주문), 아니면 p_user_coupon_id(바로구매 주문서에서 고른 쿠폰)로 쿠폰 할인을 뺀다.
create function private.store_credit_checkout_quote_for_items(
  p_requested_amount bigint, p_destination jsonb, p_items jsonb, p_cart_coupon boolean, p_user_coupon_id uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); policy private.store_credit_policy; balance jsonb; sales jsonb;
  subtotal bigint; shipping bigint; coupon_quote jsonb; coupon bigint := 0; maximum bigint := 0; reason text;
begin
  if actor is null then raise insufficient_privilege using message = 'auth_required'; end if;
  if p_requested_amount is null or p_requested_amount not between 0 and 999999999999 then
    raise invalid_parameter_value using message = 'store_credit_amount_invalid'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 19239 or p_cart_coupon is null then
    raise invalid_parameter_value using message = 'invalid_store_credit_items'; end if;
  select * into policy from private.store_credit_policy where singleton;
  perform private.expire_store_credit_lots(actor, clock_timestamp()); balance := private.store_credit_balance(actor);
  if not policy.enabled then reason := 'store_credit_disabled';
  elsif (balance ->> 'debt')::bigint > 0 then reason := 'store_credit_debt';
  else
    sales := public.quote_goods_sales_for_address(p_items, p_destination);
    subtotal := (sales ->> 'subtotal')::bigint; shipping := (sales -> 'shipping' ->> 'totalFee')::bigint;
    coupon_quote := case when p_cart_coupon then sales -> 'coupon' else private.quote_user_coupon(p_user_coupon_id, sales -> 'lines', subtotal, shipping) end;
    if not (sales -> 'shipping' ->> 'checkoutAllowed')::boolean then reason := 'shipping_region_unresolved';
    elsif coupon_quote ->> 'reason' is not null then reason := coupon_quote ->> 'reason';
    else coupon := coalesce((coupon_quote ->> 'discount')::bigint, 0); end if;
    if reason is null then
      maximum := least(policy.max_use, (balance ->> 'available')::bigint, greatest(0, subtotal - coupon), greatest(0, subtotal + shipping - coupon - 1000));
      if p_requested_amount > 0 and (p_requested_amount < policy.min_use or p_requested_amount > maximum) then reason := 'store_credit_amount_invalid'; end if;
    end if;
  end if;
  return balance || jsonb_build_object('enabled', policy.enabled, 'minUse', policy.min_use, 'maxUse', maximum,
    'requestedAmount', p_requested_amount, 'valid', p_requested_amount = 0 or reason is null, 'reason', reason);
end;
$$;
revoke all on function private.store_credit_checkout_quote_for_items(bigint, jsonb, jsonb, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function private.store_credit_checkout_quote_for_items(bigint, jsonb, jsonb, boolean, uuid) to postgres;

-- 선택 주문 주문서의 적립금 사용 한도(고른 품목 + 장바구니 쿠폰 선택).
create function public.get_my_store_credit_checkout_for_items(p_requested_amount bigint, p_destination jsonb, p_items jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.store_credit_checkout_quote_for_items(p_requested_amount, p_destination, p_items, true, null); $$;
revoke all on function public.get_my_store_credit_checkout_for_items(bigint, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.get_my_store_credit_checkout_for_items(bigint, jsonb, jsonb) to authenticated;

-- 운영 계약 지문: 재정의한 코어·래퍼는 같은 migration 끝에서 다시 등록한다(operator_capability_coverage drift).
select private.register_operator_internal_contract('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure);
select private.register_operator_internal_contract('public.place_order(jsonb,uuid,public.order_payment_method)'::regprocedure);
select private.register_operator_internal_contract('public.place_order_with_cart_selection(uuid,uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.checkout_source_lines(uuid,boolean)'::regprocedure);

-- pg_cron이 있는 배포만 등록한다. cron.schedule은 이름 기준 upsert라 재적용에 안전하다. 일회용 복제본은 cron이 없다.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('checkout-draft-cleanup', '*/10 * * * *', 'select public.purge_expired_checkout_drafts(10000)');
  end if;
end;
$$;

notify pgrst, 'reload schema';
