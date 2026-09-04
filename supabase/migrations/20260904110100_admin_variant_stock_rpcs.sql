-- D-1 ⑤ — 품목·재고 RPC (통합 어드민 설계서 v2 §1-1 RPC, 리서치 보고서 A §4)
--
-- 쓰기는 전부 여기 RPC 를 지난다(멱등 키 · 감사 · 역할 검사). 잠금 순서 = 상품 → 품목 → (품목, 출고지) 오름차순.
-- `admin_adjust_stock`(상품 단위)은 기본 품목 × 기본 출고지로 위임하는 얇은 래퍼로 남겨 기존 화면·슬라이스 3 이 그대로 돈다.

create or replace function private.require_staff_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function private.effective_variant_location(p_variant_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(variant.location_id, good.default_location_id)
  from public.good_variants as variant
  join public.goods as good on good.id = variant.good_id
  where variant.id = p_variant_id;
$$;

-- 품목 코드 = <good_id>-NN. 보관 품목까지 포함해 가장 큰 번호 다음.
create or replace function private.next_variant_code(p_good_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select p_good_id || '-' || lpad((coalesce(max(nullif(regexp_replace(variant.code, '^.*-', ''), '')::integer), 0) + 1)::text, 2, '0')
  from public.good_variants as variant
  where variant.good_id = p_good_id
    and variant.code ~ ('^' || regexp_replace(p_good_id, '([.^$|()\[\]{}*+?\\])', '\\\1', 'g') || '-[0-9]+$');
$$;

-- 활성 출고지마다 재고 행을 보장한다(0 허용). 캐시는 바뀌지 않으므로 트리거를 건너뛴다.
create or replace function private.ensure_variant_stock_rows(p_variant_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_previous_skip text := current_setting('icons.stock_cache_skip', true);
begin
  perform set_config('icons.stock_cache_skip', '1', true);
  insert into public.variant_stocks (variant_id, location_id, last_source)
  select p_variant_id, location.id, 'system'
  from public.stock_locations as location
  where location.active
  on conflict (variant_id, location_id) do nothing;
  perform set_config('icons.stock_cache_skip', coalesce(v_previous_skip, '0'), true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 재고 조정(품목 × 출고지) — 현행 admin_adjust_stock 골격 승격: 멱등 id · expected · 사유 코드 · 이동 기록
-- ---------------------------------------------------------------------------
create or replace function public.admin_adjust_variant_stock(
  target_movement_id uuid,
  target_variant_id uuid,
  target_location_id text,
  target_expected_on_hand integer,
  target_delta integer,
  target_reason_code text,
  target_note text default null
)
returns table (on_hand_qty integer, reserved_qty integer, available integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_note text := nullif(btrim(coalesce(target_note, ''), E' \t\n\r\f\v'), '');
  v_existing record;
  v_good_id text;
  v_good_archived_at timestamptz;
  v_variant_archived_at timestamptz;
  v_current record;
  v_after record;
begin
  if target_movement_id is null then
    raise exception 'invalid_movement_id' using errcode = '22004';
  end if;
  if target_delta is null or target_delta = 0 then
    raise exception 'invalid_stock_delta' using errcode = '22023';
  end if;
  if target_expected_on_hand is null or target_expected_on_hand < 0 then
    raise exception 'invalid_expected_stock_qty' using errcode = '22023';
  end if;
  if target_reason_code is null
    or target_reason_code not in ('count', 'receive', 'return_restock', 'damage', 'correction')
  then
    raise exception 'invalid_stock_reason' using errcode = '22023';
  end if;
  if target_reason_code = 'correction' and v_note is null then
    raise exception 'stock_note_required' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'invalid_stock_reason' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stock_movement:' || target_movement_id::text, 0)
  );

  select movement.variant_id, movement.location_id, movement.delta_on_hand, movement.reason_code,
         movement.actor_id, movement.on_hand_after, movement.reserved_after
    into v_existing
  from public.stock_movements as movement
  where movement.id = target_movement_id;
  if found then
    if v_existing.variant_id = target_variant_id
      and v_existing.location_id = target_location_id
      and v_existing.delta_on_hand = target_delta
      and v_existing.reason_code = target_reason_code
      and v_existing.actor_id is not distinct from v_actor
    then
      return query select v_existing.on_hand_after, v_existing.reserved_after,
        v_existing.on_hand_after - v_existing.reserved_after;
      return;
    end if;
    raise exception 'adjustment_conflict' using errcode = '23505';
  end if;

  select variant.good_id, variant.archived_at
    into v_good_id, v_variant_archived_at
  from public.good_variants as variant
  where variant.id = target_variant_id;
  if not found then
    raise exception 'variant_not_found' using errcode = 'P0002';
  end if;
  select good.archived_at into v_good_archived_at
  from public.goods as good
  where good.id = v_good_id
  for update;
  if target_delta > 0 and (v_good_archived_at is not null or v_variant_archived_at is not null) then
    raise check_violation using message = 'catalog_item_archived';
  end if;
  if not exists (select 1 from public.stock_locations as location where location.id = target_location_id) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  insert into public.variant_stocks (variant_id, location_id, last_source)
  values (target_variant_id, target_location_id, 'system')
  on conflict (variant_id, location_id) do nothing;
  select stock.on_hand_qty, stock.reserved_qty into v_current
  from public.variant_stocks as stock
  where stock.variant_id = target_variant_id and stock.location_id = target_location_id
  for update;
  if v_current.on_hand_qty <> target_expected_on_hand then
    raise exception 'stock_changed' using errcode = 'P0001';
  end if;

  select * into v_after from private.apply_stock_movement(
    target_movement_id, target_variant_id, target_location_id, target_delta, 0,
    target_reason_code, 'admin', null, null, v_note, v_actor, target_reason_code = 'count'
  );
  return query select v_after.on_hand_qty, v_after.reserved_qty, v_after.on_hand_qty - v_after.reserved_qty;
end;
$$;

-- 상품 단위 조정(래퍼). 활성 품목이 1개일 때만 — 그 품목의 유효 출고지에서 조정한다. 감사 기록·멱등 계약은 그대로.
create or replace function public.admin_adjust_stock(
  target_adjustment_id uuid,
  target_good_id text,
  target_expected_stock_qty integer,
  target_delta integer,
  target_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text;
  previous_stock_qty integer;
  selected_archived_at timestamptz;
  next_stock_qty bigint;
  requested_diff jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  v_active_variants integer;
  v_variant_id uuid;
  v_location_id text;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  normalized_reason := btrim(target_reason, E' \t\n\r\f\v');
  if target_adjustment_id is null then
    raise exception 'invalid_adjustment_id' using errcode = '22004';
  end if;
  if target_expected_stock_qty is null or target_expected_stock_qty < 0 then
    raise exception 'invalid_expected_stock_qty' using errcode = '22023';
  end if;
  if target_delta is null or target_delta = 0 then
    raise exception 'invalid_stock_delta' using errcode = '22023';
  end if;
  if normalized_reason is null or char_length(normalized_reason) < 1 or char_length(normalized_reason) > 200 then
    raise exception 'invalid_stock_reason' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_stock_adjustment:' || target_adjustment_id::text, 0)
  );

  next_stock_qty := target_expected_stock_qty::bigint + target_delta::bigint;
  requested_diff := jsonb_build_object(
    'from', target_expected_stock_qty, 'delta', target_delta, 'to', next_stock_qty, 'reason', normalized_reason
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_adjustment_id;
  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.good.stock_adjusted'
      and existing_target = 'goods:' || target_good_id
      and existing_diff = requested_diff
    then
      return (existing_diff ->> 'to')::integer;
    end if;
    raise exception 'adjustment_conflict' using errcode = '23505';
  end if;

  select good.stock_qty, good.archived_at
    into previous_stock_qty, selected_archived_at
  from public.goods as good
  where good.id = target_good_id
  for update;
  if not found then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;
  if target_delta > 0 and selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;
  if previous_stock_qty <> target_expected_stock_qty then
    raise exception 'stock_changed' using errcode = 'P0001';
  end if;

  next_stock_qty := previous_stock_qty::bigint + target_delta::bigint;
  if next_stock_qty < 0 or next_stock_qty > 2147483647 then
    raise exception 'stock_out_of_range' using errcode = '22003';
  end if;

  select count(*) into v_active_variants
  from public.good_variants as variant
  where variant.good_id = target_good_id and variant.archived_at is null;
  if v_active_variants <> 1 then
    raise exception 'goods_stock_qty_readonly' using errcode = '55000',
      hint = '품목이 여러 개인 상품의 재고는 품목 단위로 조정합니다.';
  end if;
  select variant.id, private.effective_variant_location(variant.id)
    into v_variant_id, v_location_id
  from public.good_variants as variant
  where variant.good_id = target_good_id and variant.archived_at is null;

  perform private.apply_stock_movement(
    target_adjustment_id, v_variant_id, v_location_id, target_delta, 0,
    'correction', 'admin', 'goods', target_good_id, normalized_reason, actor_id, false
  );

  select good.stock_qty into next_stock_qty from public.goods as good where good.id = target_good_id;

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_adjustment_id, actor_id, 'admin.good.stock_adjusted', 'goods:' || target_good_id,
    jsonb_build_object('from', previous_stock_qty, 'delta', target_delta, 'to', next_stock_qty, 'reason', normalized_reason)
  );
  return next_stock_qty::integer;
end;
$$;

-- 안전재고(경보 임계치) — 수량 변화가 아니므로 이동 기록 대신 감사 기록.
create or replace function public.admin_set_variant_safety(
  target_variant_id uuid,
  target_location_id text,
  target_safety_qty integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_previous integer;
begin
  if target_safety_qty is null or target_safety_qty < 0 or target_safety_qty > 2147483647 then
    raise exception 'invalid_safety_qty' using errcode = '22023';
  end if;
  if not exists (select 1 from public.good_variants as variant where variant.id = target_variant_id) then
    raise exception 'variant_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.stock_locations as location where location.id = target_location_id) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  insert into public.variant_stocks (variant_id, location_id, last_source)
  values (target_variant_id, target_location_id, 'system')
  on conflict (variant_id, location_id) do nothing;
  select stock.safety_qty into v_previous
  from public.variant_stocks as stock
  where stock.variant_id = target_variant_id and stock.location_id = target_location_id
  for update;
  if v_previous = target_safety_qty then
    return;
  end if;
  update public.variant_stocks as stock
  set safety_qty = target_safety_qty
  where stock.variant_id = target_variant_id and stock.location_id = target_location_id;
  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor, 'admin.variant.safety_set', 'variant:' || target_variant_id::text,
    jsonb_build_object('location_id', target_location_id, 'from', v_previous, 'to', target_safety_qty)
  );
end;
$$;

-- 재고 이동 — 같은 상품 안에서 (품목, 출고지) → (품목, 출고지). transfer_out / transfer_in 2행(같은 ref_id).
create or replace function public.admin_transfer_variant_stock(
  target_movement_id uuid,
  target_from_variant_id uuid,
  target_from_location_id text,
  target_to_variant_id uuid,
  target_to_location_id text,
  target_qty integer,
  target_note text default null
)
returns table (from_on_hand integer, to_on_hand integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_note text := nullif(btrim(coalesce(target_note, ''), E' \t\n\r\f\v'), '');
  v_in_movement_id uuid := md5(target_movement_id::text || ':transfer_in')::uuid;
  v_existing record;
  v_from_good text;
  v_to_good text;
  v_to_archived_at timestamptz;
  v_out record;
  v_in record;
begin
  if target_movement_id is null then
    raise exception 'invalid_movement_id' using errcode = '22004';
  end if;
  if target_qty is null or target_qty <= 0 then
    raise exception 'invalid_stock_delta' using errcode = '22023';
  end if;
  if target_from_variant_id = target_to_variant_id and target_from_location_id = target_to_location_id then
    raise exception 'transfer_same_slot' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stock_movement:' || target_movement_id::text, 0)
  );
  select movement.variant_id, movement.location_id, movement.delta_on_hand, movement.on_hand_after
    into v_existing
  from public.stock_movements as movement
  where movement.id = target_movement_id;
  if found then
    if v_existing.variant_id = target_from_variant_id
      and v_existing.location_id = target_from_location_id
      and v_existing.delta_on_hand = -target_qty
    then
      return query
        select v_existing.on_hand_after, stock.on_hand_qty
        from public.variant_stocks as stock
        where stock.variant_id = target_to_variant_id and stock.location_id = target_to_location_id;
      return;
    end if;
    raise exception 'adjustment_conflict' using errcode = '23505';
  end if;

  select variant.good_id into v_from_good from public.good_variants as variant where variant.id = target_from_variant_id;
  select variant.good_id, variant.archived_at into v_to_good, v_to_archived_at
  from public.good_variants as variant where variant.id = target_to_variant_id;
  if v_from_good is null or v_to_good is null then
    raise exception 'variant_not_found' using errcode = 'P0002';
  end if;
  if v_from_good <> v_to_good then
    raise exception 'variant_transfer_cross_good' using errcode = '22023';
  end if;
  if v_to_archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;
  perform 1 from public.goods as good where good.id = v_from_good for update;
  perform private.ensure_variant_stock_rows(target_from_variant_id);
  perform private.ensure_variant_stock_rows(target_to_variant_id);
  -- 잠금 순서 = (품목, 출고지) 오름차순
  perform 1 from public.variant_stocks as stock
  where (stock.variant_id, stock.location_id) in (
    (target_from_variant_id, target_from_location_id), (target_to_variant_id, target_to_location_id)
  )
  order by stock.variant_id, stock.location_id
  for update;

  select * into v_out from private.apply_stock_movement(
    target_movement_id, target_from_variant_id, target_from_location_id, -target_qty, 0,
    'transfer_out', 'admin', 'transfer', target_movement_id::text, v_note, v_actor, false
  );
  select * into v_in from private.apply_stock_movement(
    v_in_movement_id, target_to_variant_id, target_to_location_id, target_qty, 0,
    'transfer_in', 'admin', 'transfer', target_movement_id::text, v_note, v_actor, false
  );
  return query select v_out.on_hand_qty, v_in.on_hand_qty;
end;
$$;

-- 엑셀/창고 실적의 절대값 설정. 한 행이라도 식별·검증에 실패하면 아무것도 쓰지 않고 오류 행을 돌려준다.
create or replace function public.admin_set_variant_stock_bulk(
  target_batch_id uuid,
  target_kind text,
  target_rows jsonb,
  target_reason_code text default 'excel_set',
  target_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_existing record;
  v_row record;
  v_ref text;
  v_variant_id uuid;
  v_candidates integer;
  v_location_id text;
  v_on_hand integer;
  v_safety integer;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_resolved jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_slot text;
  v_current record;
  v_applied integer := 0;
  v_row_count integer;
  v_result jsonb;
begin
  if target_batch_id is null then
    raise exception 'invalid_batch_id' using errcode = '22004';
  end if;
  if target_kind is null or target_kind not in ('excel', 'wms') then
    raise exception 'invalid_batch_kind' using errcode = '22023';
  end if;
  if target_reason_code is null or target_reason_code not in ('excel_set', 'wms_sync', 'count') then
    raise exception 'invalid_stock_reason' using errcode = '22023';
  end if;
  if target_rows is null or jsonb_typeof(target_rows) <> 'array' then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;
  v_row_count := jsonb_array_length(target_rows);
  if v_row_count < 1 or v_row_count > 2000 then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stock_upload_batch:' || target_batch_id::text, 0)
  );
  select batch.applied_count, batch.errors, batch.warnings, batch.actor_id into v_existing
  from public.stock_upload_batches as batch
  where batch.id = target_batch_id;
  if found then
    if v_existing.actor_id is distinct from v_actor then
      raise exception 'adjustment_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object('applied', v_existing.applied_count, 'errors', v_existing.errors, 'warnings', v_existing.warnings);
  end if;

  -- 1차: 식별·검증만
  for v_row in
    select element.value as row, element.ordinality as line
    from jsonb_array_elements(target_rows) with ordinality as element(value, ordinality)
  loop
    v_ref := nullif(btrim(coalesce(v_row.row ->> 'ref', '')), '');
    v_location_id := nullif(btrim(coalesce(v_row.row ->> 'location_id', '')), '');
    v_variant_id := null;
    if v_ref is null then
      v_errors := v_errors || jsonb_build_object('row', v_row.line, 'code', 'ref_missing');
      continue;
    end if;
    if v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select variant.id into v_variant_id from public.good_variants as variant where variant.id = v_ref::uuid;
    end if;
    if v_variant_id is null then
      select variant.id into v_variant_id from public.good_variants as variant where variant.custom_code = v_ref;
    end if;
    if v_variant_id is null then
      select variant.id into v_variant_id from public.good_variants as variant where variant.code = v_ref;
    end if;
    if v_variant_id is null then
      select count(*), min(variant.id::text)::uuid into v_candidates, v_variant_id
      from public.good_variants as variant
      where variant.good_id = v_ref and variant.archived_at is null;
      if v_candidates > 1 then
        v_errors := v_errors || jsonb_build_object('row', v_row.line, 'code', 'variant_ambiguous');
        continue;
      end if;
    end if;
    if v_variant_id is null then
      v_errors := v_errors || jsonb_build_object('row', v_row.line, 'code', 'variant_not_found');
      continue;
    end if;
    if v_location_id is null then
      v_location_id := private.effective_variant_location(v_variant_id);
    elsif not exists (select 1 from public.stock_locations as location where location.id = v_location_id) then
      v_errors := v_errors || jsonb_build_object('row', v_row.line, 'code', 'location_not_found');
      continue;
    end if;
    if jsonb_typeof(v_row.row -> 'on_hand_qty') <> 'number'
      or (v_row.row ->> 'on_hand_qty')::numeric <> floor((v_row.row ->> 'on_hand_qty')::numeric)
      or (v_row.row ->> 'on_hand_qty')::numeric < 0
      or (v_row.row ->> 'on_hand_qty')::numeric > 2147483647
    then
      v_errors := v_errors || jsonb_build_object('row', v_row.line, 'code', 'invalid_qty');
      continue;
    end if;
    v_on_hand := (v_row.row ->> 'on_hand_qty')::integer;
    v_safety := null;
    if v_row.row ? 'safety_qty' and jsonb_typeof(v_row.row -> 'safety_qty') = 'number' then
      if (v_row.row ->> 'safety_qty')::numeric < 0 or (v_row.row ->> 'safety_qty')::numeric > 2147483647 then
        v_errors := v_errors || jsonb_build_object('row', v_row.line, 'code', 'invalid_qty');
        continue;
      end if;
      v_safety := (v_row.row ->> 'safety_qty')::integer;
    end if;
    v_slot := v_variant_id::text || '|' || v_location_id;
    if v_slot = any(v_seen) then
      v_errors := v_errors || jsonb_build_object('row', v_row.line, 'code', 'duplicate_row');
      continue;
    end if;
    v_seen := v_seen || v_slot;
    v_resolved := v_resolved || jsonb_build_object(
      'row', v_row.line, 'variant_id', v_variant_id, 'location_id', v_location_id,
      'on_hand_qty', v_on_hand, 'safety_qty', v_safety
    );
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    insert into public.stock_upload_batches (id, kind, file_name, row_count, applied_count, errors, warnings, actor_id)
    values (target_batch_id, target_kind, target_file_name, v_row_count, 0, v_errors, '[]'::jsonb, v_actor);
    return jsonb_build_object('applied', 0, 'errors', v_errors, 'warnings', '[]'::jsonb);
  end if;

  -- 2차: (품목, 출고지) 순으로 잠그고 절대값을 맞춘다
  for v_row in
    select element.value as row
    from jsonb_array_elements(v_resolved) as element(value)
    order by element.value ->> 'variant_id', element.value ->> 'location_id'
  loop
    v_variant_id := (v_row.row ->> 'variant_id')::uuid;
    v_location_id := v_row.row ->> 'location_id';
    v_on_hand := (v_row.row ->> 'on_hand_qty')::integer;
    insert into public.variant_stocks (variant_id, location_id, last_source)
    values (v_variant_id, v_location_id, 'system')
    on conflict (variant_id, location_id) do nothing;
    select stock.on_hand_qty, stock.reserved_qty into v_current
    from public.variant_stocks as stock
    where stock.variant_id = v_variant_id and stock.location_id = v_location_id
    for update;
    if v_current.on_hand_qty <> v_on_hand then
      perform private.apply_stock_movement(
        md5(target_batch_id::text || ':' || (v_row.row ->> 'row'))::uuid,
        v_variant_id, v_location_id, v_on_hand - v_current.on_hand_qty, 0,
        target_reason_code, target_kind, 'upload_batch', target_batch_id::text, null, v_actor,
        target_reason_code = 'count'
      );
      v_applied := v_applied + 1;
    end if;
    if v_row.row ->> 'safety_qty' is not null then
      update public.variant_stocks as stock
      set safety_qty = (v_row.row ->> 'safety_qty')::integer
      where stock.variant_id = v_variant_id and stock.location_id = v_location_id
        and stock.safety_qty <> (v_row.row ->> 'safety_qty')::integer;
    end if;
    if v_on_hand < v_current.reserved_qty then
      v_warnings := v_warnings || jsonb_build_object('row', (v_row.row ->> 'row')::integer, 'code', 'available_negative');
    end if;
  end loop;

  insert into public.stock_upload_batches (id, kind, file_name, row_count, applied_count, errors, warnings, actor_id)
  values (target_batch_id, target_kind, target_file_name, v_row_count, v_applied, '[]'::jsonb, v_warnings, v_actor);
  v_result := jsonb_build_object('applied', v_applied, 'errors', '[]'::jsonb, 'warnings', v_warnings);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 출고지 · 옵션 마스터
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_stock_location(
  target_id text,
  target_name text,
  target_address jsonb default null,
  target_contact text default null,
  target_default_carrier_code text default null,
  target_erp_warehouse_code text default null,
  target_is_default boolean default false,
  target_active boolean default true,
  target_sort_order integer default 0
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_id text := nullif(btrim(coalesce(target_id, '')), '');
  v_name text := nullif(btrim(coalesce(target_name, '')), '');
  v_existing record;
  v_variant record;
begin
  if v_id is null or v_id !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
    raise exception 'invalid_location_id' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) > 60 then
    raise exception 'invalid_location_name' using errcode = '22023';
  end if;
  if target_is_default and not target_active then
    raise exception 'location_default_must_be_active' using errcode = '22023';
  end if;
  if target_default_carrier_code is not null
    and not exists (select 1 from public.shipping_carriers as carrier where carrier.code = target_default_carrier_code)
  then
    raise exception 'carrier_not_found' using errcode = 'P0002';
  end if;

  select location.is_default, location.active into v_existing
  from public.stock_locations as location
  where location.id = v_id
  for update;
  if found then
    if v_existing.is_default and not target_is_default then
      raise exception 'location_default_required' using errcode = '22023';
    end if;
    if v_existing.active and not target_active and exists (
      select 1 from public.variant_stocks as stock
      where stock.location_id = v_id and (stock.on_hand_qty > 0 or stock.reserved_qty > 0)
    ) then
      raise exception 'location_has_stock' using errcode = '22023';
    end if;
  end if;

  if target_is_default then
    update public.stock_locations set is_default = false where is_default and id <> v_id;
  end if;

  insert into public.stock_locations (
    id, name, address, contact, default_carrier_code, erp_warehouse_code, is_default, active, sort_order
  )
  values (
    v_id, v_name, target_address, nullif(btrim(coalesce(target_contact, '')), ''), target_default_carrier_code,
    nullif(btrim(coalesce(target_erp_warehouse_code, '')), ''), target_is_default, target_active, coalesce(target_sort_order, 0)
  )
  on conflict (id) do update set
    name = excluded.name,
    address = excluded.address,
    contact = excluded.contact,
    default_carrier_code = excluded.default_carrier_code,
    erp_warehouse_code = excluded.erp_warehouse_code,
    is_default = excluded.is_default,
    active = excluded.active,
    sort_order = excluded.sort_order;

  if target_active then
    for v_variant in select variant.id from public.good_variants as variant where variant.archived_at is null loop
      perform private.ensure_variant_stock_rows(v_variant.id);
    end loop;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor, 'admin.stock_location.upsert', 'stock_location:' || v_id,
    jsonb_build_object('name', v_name, 'is_default', target_is_default, 'active', target_active)
  );
end;
$$;

create or replace function public.admin_upsert_option_master(
  target_id uuid,
  target_name text,
  target_display_style text default 'select',
  target_sort_order integer default 0,
  target_archived boolean default false,
  target_values jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_name text := nullif(btrim(coalesce(target_name, '')), '');
  v_id uuid := target_id;
  v_code text;
  v_value record;
  v_value_id uuid;
  v_value_text text;
begin
  if v_name is null or char_length(v_name) > 40 then
    raise exception 'invalid_option_name' using errcode = '22023';
  end if;
  if target_display_style not in ('select', 'button', 'radio', 'swatch') then
    raise exception 'invalid_option_style' using errcode = '22023';
  end if;
  if target_values is null or jsonb_typeof(target_values) <> 'array' or jsonb_array_length(target_values) > 100 then
    raise exception 'invalid_option_values' using errcode = '22023';
  end if;

  if v_id is null then
    v_id := gen_random_uuid();
    v_code := 'O' || lpad(nextval('public.option_master_code_seq')::text, 4, '0');
    insert into public.option_masters (id, code, name, display_style, sort_order)
    values (v_id, v_code, v_name, target_display_style, coalesce(target_sort_order, 0));
  else
    perform 1 from public.option_masters as master where master.id = v_id for update;
    if not found then
      raise exception 'option_not_found' using errcode = 'P0002';
    end if;
    if target_archived and exists (
      select 1 from public.good_options as used
      join public.goods as good on good.id = used.good_id
      where used.option_id = v_id and good.archived_at is null
    ) then
      raise exception 'option_in_use' using errcode = '22023';
    end if;
    update public.option_masters as master
    set name = v_name,
        display_style = target_display_style,
        sort_order = coalesce(target_sort_order, 0),
        archived_at = case when target_archived then coalesce(master.archived_at, now()) else null end
    where master.id = v_id;
  end if;

  for v_value in
    select element.value as row, element.ordinality as line
    from jsonb_array_elements(target_values) with ordinality as element(value, ordinality)
  loop
    v_value_text := nullif(btrim(coalesce(v_value.row ->> 'value', '')), '');
    if v_value_text is null or char_length(v_value_text) > 40 then
      raise exception 'invalid_option_values' using errcode = '22023';
    end if;
    v_value_id := nullif(v_value.row ->> 'id', '')::uuid;
    if v_value_id is null then
      insert into public.option_values (option_id, value, sort_order)
      values (v_id, v_value_text, coalesce((v_value.row ->> 'sort_order')::integer, v_value.line::integer))
      on conflict (option_id, value) do update set
        sort_order = excluded.sort_order,
        archived_at = null;
    else
      if coalesce((v_value.row ->> 'archived')::boolean, false) and exists (
        select 1 from public.variant_option_values as used
        join public.good_variants as variant on variant.id = used.variant_id
        where used.value_id = v_value_id and variant.archived_at is null
      ) then
        raise exception 'option_value_in_use' using errcode = '22023';
      end if;
      update public.option_values as value
      set value = v_value_text,
          sort_order = coalesce((v_value.row ->> 'sort_order')::integer, value.sort_order),
          archived_at = case when coalesce((v_value.row ->> 'archived')::boolean, false) then coalesce(value.archived_at, now()) else null end
      where value.id = v_value_id and value.option_id = v_id;
      if not found then
        raise exception 'option_value_not_found' using errcode = 'P0002';
      end if;
    end if;
  end loop;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.option_master.upsert', 'option:' || v_id::text, jsonb_build_object('name', v_name, 'archived', target_archived));

  return (
    select jsonb_build_object(
      'id', master.id, 'code', master.code, 'name', master.name, 'display_style', master.display_style,
      'archived_at', master.archived_at,
      'values', coalesce((
        select jsonb_agg(jsonb_build_object('id', value.id, 'value', value.value, 'sort_order', value.sort_order, 'archived_at', value.archived_at)
                         order by value.sort_order, value.value)
        from public.option_values as value where value.option_id = master.id
      ), '[]'::jsonb)
    )
    from public.option_masters as master where master.id = v_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 품목 일괄 upsert — 상품의 옵션 구성 + 품목 행. 옵션이 비면 기본 품목 1행만.
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_variants(
  target_good_id text,
  target_batch_id uuid,
  target_options jsonb default '[]'::jsonb,
  target_variants jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_options jsonb := coalesce(target_options, '[]'::jsonb);
  v_variants jsonb := coalesce(target_variants, '[]'::jsonb);
  v_digest text;
  v_existing record;
  v_good record;
  v_option record;
  v_option_count integer;
  v_option_ids uuid[] := '{}';
  v_current_option_ids uuid[];
  v_entry record;
  v_entry_id uuid;
  v_signature text;
  v_signatures text[] := '{}';
  v_variant record;
  v_new_id uuid;
  v_code text;
  v_value_pair record;
  v_stock record;
  v_result_variants jsonb := '[]'::jsonb;
  v_archived jsonb := '[]'::jsonb;
  v_stocks_created integer := 0;
  v_default_id uuid;
  v_active_count integer;
  v_archive_ids uuid[] := '{}';
  v_result jsonb;
begin
  if target_batch_id is null then
    raise exception 'invalid_batch_id' using errcode = '22004';
  end if;
  if jsonb_typeof(v_options) <> 'array' or jsonb_typeof(v_variants) <> 'array' then
    raise exception 'invalid_variants' using errcode = '22023';
  end if;
  v_option_count := jsonb_array_length(v_options);
  if v_option_count > 3 then
    raise exception 'variant_limit' using errcode = '22023', hint = '옵션은 3개까지';
  end if;
  if jsonb_array_length(v_variants) > 200 then
    raise exception 'variant_limit' using errcode = '22023', hint = '품목은 200개까지';
  end if;
  v_digest := md5(v_options::text || '|' || v_variants::text);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('variant_batch:' || target_batch_id::text, 0)
  );
  select audit.actor_id, audit.action, audit.target, audit.diff into v_existing
  from public.audit_log as audit where audit.id = target_batch_id;
  if found then
    if v_existing.actor_id = v_actor
      and v_existing.action = 'admin.good.variants_upserted'
      and v_existing.target = 'goods:' || target_good_id
      and v_existing.diff ->> 'request' = v_digest
    then
      return v_existing.diff -> 'result';
    end if;
    raise exception 'adjustment_conflict' using errcode = '23505';
  end if;

  select good.id, good.archived_at into v_good from public.goods as good where good.id = target_good_id for update;
  if not found then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;
  if v_good.archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  -- 옵션 구성 검증
  for v_option in
    select element.value as row, element.ordinality as line
    from jsonb_array_elements(v_options) with ordinality as element(value, ordinality)
    order by (element.value ->> 'position')::integer
  loop
    if (v_option.row ->> 'position')::integer is distinct from v_option.line::integer then
      raise exception 'invalid_option_positions' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.option_masters as master
      where master.id = (v_option.row ->> 'option_id')::uuid and master.archived_at is null
    ) then
      raise exception 'option_not_found' using errcode = 'P0002';
    end if;
    if ((v_option.row ->> 'option_id')::uuid) = any(v_option_ids) then
      raise exception 'option_duplicate' using errcode = '23505';
    end if;
    v_option_ids := v_option_ids || (v_option.row ->> 'option_id')::uuid;
  end loop;

  select coalesce(array_agg(used.option_id order by used.position), '{}') into v_current_option_ids
  from public.good_options as used where used.good_id = target_good_id;

  -- 요청에서 보관되는 품목 id
  select coalesce(array_agg((element.value ->> 'id')::uuid), '{}') into v_archive_ids
  from jsonb_array_elements(v_variants) as element(value)
  where coalesce((element.value ->> 'archived')::boolean, false) and nullif(element.value ->> 'id', '') is not null;

  if v_current_option_ids <> v_option_ids then
    -- 옵션 구성이 바뀌면 기존 옵션 품목은 전부 보관돼야 한다(요청에 포함되지 않은 활성 옵션 품목이 있으면 거부)
    if exists (
      select 1 from public.good_variants as variant
      where variant.good_id = target_good_id and variant.archived_at is null and not variant.is_default
        and not (variant.id = any(v_archive_ids))
    ) then
      raise exception 'variant_options_locked' using errcode = '22023',
        hint = '옵션 구성을 바꾸려면 기존 옵션 품목을 먼저 보관합니다.';
    end if;
    delete from public.good_options where good_id = target_good_id;
    insert into public.good_options (good_id, option_id, position)
    select target_good_id, option_id, ordinality::smallint
    from unnest(v_option_ids) with ordinality as chosen(option_id, ordinality);
  end if;

  select variant.id into v_default_id
  from public.good_variants as variant
  where variant.good_id = target_good_id and variant.is_default and variant.archived_at is null;

  if v_option_count = 0 then
    -- 옵션 없음: 기본 품목 1행이 곧 상품. 없으면 만든다(옵션을 걷어낸 경우).
    if v_default_id is null then
      v_default_id := gen_random_uuid();
      insert into public.good_variants (id, good_id, code, option_signature, is_default, sort_order)
      values (v_default_id, target_good_id, private.next_variant_code(target_good_id), '', true, 0);
      perform private.ensure_variant_stock_rows(v_default_id);
      v_stocks_created := v_stocks_created + 1;
    end if;
    for v_entry in
      select element.value as row from jsonb_array_elements(v_variants) as element(value)
    loop
      v_entry_id := nullif(v_entry.row ->> 'id', '')::uuid;
      if v_entry_id is not null and v_entry_id <> v_default_id then
        raise exception 'variant_options_required' using errcode = '22023',
          hint = '옵션이 없는 상품은 기본 품목 1행만 가진다.';
      end if;
      update public.good_variants as variant
      set custom_code = nullif(btrim(coalesce(v_entry.row ->> 'custom_code', '')), ''),
          additional_price = 0,
          display = coalesce((v_entry.row ->> 'display')::boolean, variant.display),
          sellable = coalesce((v_entry.row ->> 'sellable')::boolean, variant.sellable),
          location_id = nullif(v_entry.row ->> 'location_id', ''),
          image_path = nullif(btrim(coalesce(v_entry.row ->> 'image_path', '')), '')
      where variant.id = v_default_id;
    end loop;
    v_result_variants := (
      select jsonb_agg(jsonb_build_object('id', variant.id, 'code', variant.code, 'signature', variant.option_signature))
      from public.good_variants as variant where variant.id = v_default_id
    );
  else
    -- 옵션 있음: 기본 품목은 보관(재고는 명시적 이동으로만 옮긴다)
    if v_default_id is not null then
      update public.good_variants set archived_at = now(), is_default = false where id = v_default_id;
      v_archived := v_archived || to_jsonb(v_default_id);
    end if;

    for v_entry in
      select element.value as row, element.ordinality as line
      from jsonb_array_elements(v_variants) with ordinality as element(value, ordinality)
    loop
      v_entry_id := nullif(v_entry.row ->> 'id', '')::uuid;

      -- 서명 = 옵션 순서대로 값 id 를 '|' 로 연결
      if jsonb_typeof(v_entry.row -> 'values') <> 'object' then
        raise exception 'variant_values_required' using errcode = '22023';
      end if;
      v_signature := '';
      for v_value_pair in
        select chosen.option_id, chosen.ordinality
        from unnest(v_option_ids) with ordinality as chosen(option_id, ordinality)
        order by chosen.ordinality
      loop
        if nullif(v_entry.row -> 'values' ->> v_value_pair.option_id::text, '') is null then
          raise exception 'variant_values_required' using errcode = '22023';
        end if;
        if not exists (
          select 1 from public.option_values as value
          where value.id = (v_entry.row -> 'values' ->> v_value_pair.option_id::text)::uuid
            and value.option_id = v_value_pair.option_id
            and value.archived_at is null
        ) then
          raise exception 'option_value_not_found' using errcode = 'P0002';
        end if;
        v_signature := v_signature || case when v_value_pair.ordinality > 1 then '|' else '' end
          || (v_entry.row -> 'values' ->> v_value_pair.option_id::text);
      end loop;
      if v_signature = any(v_signatures) then
        raise exception 'variant_duplicate' using errcode = '23505';
      end if;
      v_signatures := v_signatures || v_signature;

      if v_entry_id is not null then
        select variant.id, variant.option_signature, variant.archived_at into v_variant
        from public.good_variants as variant
        where variant.id = v_entry_id and variant.good_id = target_good_id
        for update;
        if not found then
          raise exception 'variant_not_found' using errcode = 'P0002';
        end if;
        if v_variant.option_signature <> v_signature then
          raise exception 'variant_signature_immutable' using errcode = '22023';
        end if;
        if v_entry.row ? 'initial_stocks' and jsonb_array_length(coalesce(v_entry.row -> 'initial_stocks', '[]'::jsonb)) > 0 then
          raise exception 'variant_initial_stock_existing' using errcode = '22023',
            hint = '기존 품목의 수량은 재고 조정으로 바꿉니다.';
        end if;
        begin
          update public.good_variants as variant
          set custom_code = nullif(btrim(coalesce(v_entry.row ->> 'custom_code', '')), ''),
              additional_price = coalesce((v_entry.row ->> 'additional_price')::integer, variant.additional_price),
              display = coalesce((v_entry.row ->> 'display')::boolean, variant.display),
              sellable = coalesce((v_entry.row ->> 'sellable')::boolean, variant.sellable),
              location_id = nullif(v_entry.row ->> 'location_id', ''),
              image_path = nullif(btrim(coalesce(v_entry.row ->> 'image_path', '')), ''),
              sort_order = coalesce((v_entry.row ->> 'sort_order')::integer, v_entry.line::integer),
              archived_at = case
                when coalesce((v_entry.row ->> 'archived')::boolean, false) then coalesce(variant.archived_at, now())
                else null
              end
          where variant.id = v_entry_id;
        exception when unique_violation then
          raise exception 'custom_code_taken' using errcode = '23505';
        end;
        if coalesce((v_entry.row ->> 'archived')::boolean, false) then
          v_archived := v_archived || to_jsonb(v_entry_id);
        end if;
        v_result_variants := v_result_variants || jsonb_build_object('id', v_entry_id, 'code', (select code from public.good_variants where id = v_entry_id), 'signature', v_signature);
      else
        if exists (
          select 1 from public.good_variants as variant
          where variant.good_id = target_good_id and variant.option_signature = v_signature
        ) then
          raise exception 'variant_duplicate' using errcode = '23505';
        end if;
        v_new_id := gen_random_uuid();
        v_code := private.next_variant_code(target_good_id);
        begin
          insert into public.good_variants (
            id, good_id, code, custom_code, option_signature, is_default, additional_price, display, sellable,
            location_id, image_path, sort_order
          )
          values (
            v_new_id, target_good_id, v_code, nullif(btrim(coalesce(v_entry.row ->> 'custom_code', '')), ''), v_signature, false,
            coalesce((v_entry.row ->> 'additional_price')::integer, 0),
            coalesce((v_entry.row ->> 'display')::boolean, true),
            coalesce((v_entry.row ->> 'sellable')::boolean, true),
            nullif(v_entry.row ->> 'location_id', ''),
            nullif(btrim(coalesce(v_entry.row ->> 'image_path', '')), ''),
            coalesce((v_entry.row ->> 'sort_order')::integer, v_entry.line::integer)
          );
        exception when unique_violation then
          raise exception 'custom_code_taken' using errcode = '23505';
        end;
        insert into public.variant_option_values (variant_id, option_id, value_id)
        select v_new_id, chosen.option_id, (v_entry.row -> 'values' ->> chosen.option_id::text)::uuid
        from unnest(v_option_ids) as chosen(option_id);
        perform private.ensure_variant_stock_rows(v_new_id);
        v_stocks_created := v_stocks_created + 1;
        for v_stock in
          select element.value as row, element.ordinality as line
          from jsonb_array_elements(coalesce(v_entry.row -> 'initial_stocks', '[]'::jsonb)) with ordinality as element(value, ordinality)
        loop
          if coalesce((v_stock.row ->> 'on_hand_qty')::integer, 0) < 0 then
            raise exception 'stock_out_of_range' using errcode = '22003';
          end if;
          if coalesce((v_stock.row ->> 'on_hand_qty')::integer, 0) > 0 then
            perform private.apply_stock_movement(
              md5(target_batch_id::text || ':' || v_new_id::text || ':' || (v_stock.row ->> 'location_id'))::uuid,
              v_new_id, v_stock.row ->> 'location_id', (v_stock.row ->> 'on_hand_qty')::integer, 0,
              'initial', 'admin', 'variant_batch', target_batch_id::text, '등록 시 초기 재고', v_actor, false
            );
          end if;
          if coalesce((v_stock.row ->> 'safety_qty')::integer, 0) > 0 then
            update public.variant_stocks as stock
            set safety_qty = (v_stock.row ->> 'safety_qty')::integer
            where stock.variant_id = v_new_id and stock.location_id = v_stock.row ->> 'location_id';
          end if;
        end loop;
        v_result_variants := v_result_variants || jsonb_build_object('id', v_new_id, 'code', v_code, 'signature', v_signature);
      end if;
    end loop;
  end if;

  select count(*) into v_active_count
  from public.good_variants as variant
  where variant.good_id = target_good_id and variant.archived_at is null;
  if v_active_count > 200 then
    raise exception 'variant_limit' using errcode = '22023', hint = '품목은 200개까지';
  end if;

  perform private.apply_good_stock_cache(target_good_id);

  v_result := jsonb_build_object(
    'variants', coalesce(v_result_variants, '[]'::jsonb),
    'archived', v_archived,
    'stocks_created', v_stocks_created
  );
  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_batch_id, v_actor, 'admin.good.variants_upserted', 'goods:' || target_good_id,
    jsonb_build_object('request', v_digest, 'result', v_result, 'option_count', v_option_count)
  );
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 읽기 — 재고 관리 목록(페이지) · 이동 기록
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_variant_stocks(
  p_query text default null,
  p_location_id text default null,
  p_ip_id text default null,
  p_only_low boolean default false,
  p_include_archived boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  variant_id uuid,
  variant_code text,
  custom_code text,
  option_summary text,
  is_default boolean,
  sellable boolean,
  display boolean,
  variant_archived_at timestamptz,
  good_id text,
  good_name text,
  good_archived_at timestamptz,
  ip_id text,
  ip_title text,
  location_id text,
  location_name text,
  on_hand_qty integer,
  reserved_qty integer,
  available integer,
  safety_qty integer,
  last_source text,
  last_movement_at timestamptz,
  counted_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'stock search query too long';
  end if;
  v_pattern := case when v_query is null then null else private.catalog_search_pattern(v_query) end;

  return query
  select
    variant.id,
    variant.code,
    variant.custom_code,
    coalesce((
      select string_agg(master.name || ': ' || value.value, ' / ' order by used.position)
      from public.variant_option_values as chosen
      join public.option_values as value on value.id = chosen.value_id
      join public.option_masters as master on master.id = chosen.option_id
      join public.good_options as used on used.good_id = variant.good_id and used.option_id = chosen.option_id
      where chosen.variant_id = variant.id
    ), '') as option_summary,
    variant.is_default,
    variant.sellable,
    variant.display,
    variant.archived_at,
    good.id,
    good.name,
    good.archived_at,
    good.ip_id,
    ip.title,
    stock.location_id,
    location.name,
    stock.on_hand_qty,
    stock.reserved_qty,
    stock.on_hand_qty - stock.reserved_qty,
    stock.safety_qty,
    stock.last_source,
    stock.last_movement_at,
    stock.counted_at,
    count(*) over()::bigint
  from public.variant_stocks as stock
  join public.good_variants as variant on variant.id = stock.variant_id
  join public.goods as good on good.id = variant.good_id
  join public.ips as ip on ip.id = good.ip_id
  join public.stock_locations as location on location.id = stock.location_id
  where (p_include_archived or (variant.archived_at is null and good.archived_at is null))
    and (p_location_id is null or stock.location_id = p_location_id)
    and (p_ip_id is null or good.ip_id = p_ip_id)
    and (not coalesce(p_only_low, false) or (stock.safety_qty > 0 and stock.on_hand_qty - stock.reserved_qty <= stock.safety_qty))
    and (
      v_pattern is null
      or good.name ilike v_pattern escape '\'
      or good.id ilike v_pattern escape '\'
      or variant.code ilike v_pattern escape '\'
      or coalesce(variant.custom_code, '') ilike v_pattern escape '\'
    )
  order by good.id, variant.sort_order, variant.code, location.sort_order, stock.location_id
  limit v_limit offset v_offset;
end;
$$;

create or replace function public.admin_list_stock_movements(
  p_variant_id uuid,
  p_location_id text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  location_id text,
  delta_on_hand integer,
  delta_reserved integer,
  on_hand_after integer,
  reserved_after integer,
  reason_code text,
  source text,
  ref_type text,
  ref_id text,
  note text,
  actor_nickname text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  return query
  select
    movement.id, movement.location_id, movement.delta_on_hand, movement.delta_reserved,
    movement.on_hand_after, movement.reserved_after, movement.reason_code, movement.source,
    movement.ref_type, movement.ref_id, movement.note, profile.nickname, movement.created_at,
    count(*) over()::bigint
  from public.stock_movements as movement
  left join public.profiles as profile on profile.id = movement.actor_id
  where movement.variant_id = p_variant_id
    and (p_location_id is null or movement.location_id = p_location_id)
  order by movement.created_at desc, movement.id desc
  limit v_limit offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- ACL
-- ---------------------------------------------------------------------------
revoke all on function public.admin_adjust_variant_stock(uuid, uuid, text, integer, integer, text, text) from public, anon, service_role;
grant execute on function public.admin_adjust_variant_stock(uuid, uuid, text, integer, integer, text, text) to authenticated;
revoke all on function public.admin_adjust_stock(uuid, text, integer, integer, text) from public, anon, service_role;
grant execute on function public.admin_adjust_stock(uuid, text, integer, integer, text) to authenticated;
revoke all on function public.admin_set_variant_safety(uuid, text, integer) from public, anon, service_role;
grant execute on function public.admin_set_variant_safety(uuid, text, integer) to authenticated;
revoke all on function public.admin_transfer_variant_stock(uuid, uuid, text, uuid, text, integer, text) from public, anon, service_role;
grant execute on function public.admin_transfer_variant_stock(uuid, uuid, text, uuid, text, integer, text) to authenticated;
revoke all on function public.admin_set_variant_stock_bulk(uuid, text, jsonb, text, text) from public, anon, service_role;
grant execute on function public.admin_set_variant_stock_bulk(uuid, text, jsonb, text, text) to authenticated;
revoke all on function public.admin_upsert_stock_location(text, text, jsonb, text, text, text, boolean, boolean, integer) from public, anon, service_role;
grant execute on function public.admin_upsert_stock_location(text, text, jsonb, text, text, text, boolean, boolean, integer) to authenticated;
revoke all on function public.admin_upsert_option_master(uuid, text, text, integer, boolean, jsonb) from public, anon, service_role;
grant execute on function public.admin_upsert_option_master(uuid, text, text, integer, boolean, jsonb) to authenticated;
revoke all on function public.admin_upsert_variants(text, uuid, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.admin_upsert_variants(text, uuid, jsonb, jsonb) to authenticated;
revoke all on function public.admin_list_variant_stocks(text, text, text, boolean, boolean, integer, integer) from public, anon, service_role;
grant execute on function public.admin_list_variant_stocks(text, text, text, boolean, boolean, integer, integer) to authenticated;
revoke all on function public.admin_list_stock_movements(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.admin_list_stock_movements(uuid, text, integer, integer) to authenticated;
revoke all on function private.require_staff_actor() from public;
revoke all on function private.effective_variant_location(uuid) from public;
revoke all on function private.next_variant_code(text) from public;
revoke all on function private.ensure_variant_stock_rows(uuid) from public;
