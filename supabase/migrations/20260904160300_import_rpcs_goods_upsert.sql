-- D-4c ④ — 업로드 RPC 에 굿즈 일괄 등록/수정을 연결한다 (설계서 v2 §1-7)
--
-- 검증(register)과 적용(apply)의 두 단계는 그대로 두고 종류만 하나 더 받는다.
-- 줄 단위 판정은 `private.goods_import_check` 한 곳에 있다 — 검증과 적용이 다른 규칙을 보면
-- 「검증은 통과했는데 적용에서 깨지는」 파일이 생긴다.

create or replace function public.admin_register_import(
  p_kind public.import_kind,
  p_file_name text,
  p_file_sha256 text,
  p_rows jsonb,
  p_atomic boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_existing uuid;
  v_row record;
  v_report jsonb := '[]'::jsonb;
  v_ok integer := 0;
  v_failed integer := 0;
  v_total integer;
  v_job uuid;
  v_seen text[] := '{}';
  v_key text;
  v_variant uuid;
  v_candidates integer;
  v_order uuid;
  v_carrier text;
  v_tracking text;
  v_code text;
begin
  if p_file_sha256 is null or char_length(p_file_sha256) <> 64 then
    raise exception 'invalid_file' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total < 1 or v_total > 1000 then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;

  select job.id into v_existing
  from public.import_jobs as job
  where job.kind = p_kind and job.file_sha256 = p_file_sha256 and job.requested_by = v_actor;
  if found then
    return v_existing;
  end if;

  for v_row in
    -- 줄 번호는 파일의 줄이다. 파서가 실어 보낸 값이 있으면 그것을 쓰고, 없으면 배열 순서를 쓴다 —
    -- 리포트를 보는 사람은 배열이 아니라 파일을 열어 고친다.
    select element.value as row, coalesce((element.value ->> 'line')::integer, element.ordinality::integer) as line
    from jsonb_array_elements(p_rows) with ordinality as element(value, ordinality)
  loop
    if p_kind = 'goods_upsert' then
      v_key := nullif(btrim(coalesce(v_row.row ->> 'good_id', '')), '');
      v_code := private.goods_import_check(v_row.row);
      -- 같은 상품이 파일에 두 번 나오면 어느 줄이 맞는지 파일을 만든 사람만 안다 — 뒤엣줄을 거절한다.
      if v_code is null and v_key = any(v_seen) then
        v_code := 'duplicate_good';
      end if;
      if v_code is not null then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', v_code);
        v_failed := v_failed + 1;
        continue;
      end if;
      v_seen := v_seen || v_key;
      v_ok := v_ok + 1;

    elsif p_kind = 'stock_set' then
      v_key := nullif(btrim(coalesce(v_row.row ->> 'ref', '')), '');
      if v_key is null then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'ref_missing');
        v_failed := v_failed + 1;
        continue;
      end if;
      select variant.id into v_variant from public.good_variants as variant where variant.custom_code = v_key;
      if v_variant is null then
        select variant.id into v_variant from public.good_variants as variant where variant.code = v_key;
      end if;
      if v_variant is null then
        select count(*), min(variant.id::text)::uuid into v_candidates, v_variant
        from public.good_variants as variant
        where variant.good_id = v_key and variant.archived_at is null;
        if v_candidates > 1 then
          v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'variant_ambiguous');
          v_failed := v_failed + 1;
          continue;
        end if;
      end if;
      if v_variant is null then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'variant_not_found');
        v_failed := v_failed + 1;
        continue;
      end if;
      if jsonb_typeof(v_row.row -> 'on_hand_qty') <> 'number'
        or (v_row.row ->> 'on_hand_qty')::numeric < 0
        or (v_row.row ->> 'on_hand_qty')::numeric <> floor((v_row.row ->> 'on_hand_qty')::numeric)
      then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'invalid_qty');
        v_failed := v_failed + 1;
        continue;
      end if;
      v_ok := v_ok + 1;

    else
      v_key := nullif(btrim(coalesce(v_row.row ->> 'order_ref', '')), '');
      v_carrier := nullif(btrim(coalesce(v_row.row ->> 'carrier', '')), '');
      v_tracking := nullif(btrim(coalesce(v_row.row ->> 'tracking', '')), '');
      if v_key is null or v_carrier is null or v_tracking is null then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'missing_cell');
        v_failed := v_failed + 1;
        continue;
      end if;
      if v_tracking !~ '^[0-9A-Za-z-]{6,40}$' then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'invalid_tracking');
        v_failed := v_failed + 1;
        continue;
      end if;
      select ord.id into v_order
      from public.orders as ord
      where ord.id::text = lower(v_key)
         or right(ord.id::text, 8) = lower(replace(v_key, '-', ''));
      if v_order is null then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'order_not_found');
        v_failed := v_failed + 1;
        continue;
      end if;
      if not exists (
        select 1 from public.shipping_carriers as carrier
        where carrier.is_active and (carrier.code = lower(v_carrier) or carrier.label = v_carrier)
      ) then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'carrier_not_found');
        v_failed := v_failed + 1;
        continue;
      end if;
      -- 같은 주문에 두 송장이 적히면 어느 쪽이 맞는지 파일을 만든 사람만 안다 — 둘 다 거절한다.
      if v_order::text = any(v_seen) then
        v_report := v_report || jsonb_build_object('line', v_row.line, 'code', 'duplicate_order');
        v_failed := v_failed + 1;
        continue;
      end if;
      v_seen := v_seen || v_order::text;
      v_ok := v_ok + 1;
    end if;
  end loop;

  insert into public.import_jobs (
    kind, file_name, file_sha256, requested_by, atomic, total_rows, ok_rows, failed_rows, report,
    status
  )
  values (
    p_kind, nullif(btrim(coalesce(p_file_name, '')), ''), p_file_sha256, v_actor, coalesce(p_atomic, false),
    v_total, v_ok, v_failed, v_report,
    'validated'
  )
  returning id into v_job;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.import.registered', 'import_job:' || v_job::text,
          jsonb_build_object('kind', p_kind, 'total', v_total, 'ok', v_ok, 'failed', v_failed));
  return v_job;
end;
$$;

-- 적용. 검증에서 통과한 줄만 적용하고, `atomic` 이면 오류가 하나라도 있으면 아무것도 적용하지 않는다.
create or replace function public.admin_apply_import(p_job_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_job public.import_jobs;
  v_failed_lines integer[];
  v_row record;
  v_applied integer := 0;
  v_stock_rows jsonb := '[]'::jsonb;
  v_result jsonb;
  v_order uuid;
  v_carrier text;
begin
  select * into v_job from public.import_jobs as job where job.id = p_job_id for update;
  if not found then
    raise exception 'import_not_found' using errcode = 'P0002';
  end if;
  if v_job.requested_by <> v_actor and not private.is_admin_actor() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_job.status <> 'validated' then
    raise exception 'not_validated' using errcode = 'P0001';
  end if;
  if v_job.atomic and v_job.failed_rows > 0 then
    raise exception 'atomic_has_errors' using errcode = 'P0001';
  end if;

  select coalesce(array_agg((entry ->> 'line')::integer), '{}')
    into v_failed_lines
  from jsonb_array_elements(v_job.report) as entry;

  for v_row in
    select element.value as row, coalesce((element.value ->> 'line')::integer, element.ordinality::integer) as line
    from jsonb_array_elements(p_rows) with ordinality as element(value, ordinality)
  loop
    if v_row.line = any(v_failed_lines) then
      continue;
    end if;

    if v_job.kind = 'goods_upsert' then
      perform private.apply_goods_import_row(v_row.row, v_actor);
      v_applied := v_applied + 1;
    elsif v_job.kind = 'stock_set' then
      v_stock_rows := v_stock_rows || v_row.row;
    else
      select ord.id into v_order
      from public.orders as ord
      where ord.id::text = lower(v_row.row ->> 'order_ref')
         or right(ord.id::text, 8) = lower(replace(v_row.row ->> 'order_ref', '-', ''));
      select carrier.code into v_carrier
      from public.shipping_carriers as carrier
      where carrier.is_active
        and (carrier.code = lower(v_row.row ->> 'carrier') or carrier.label = v_row.row ->> 'carrier');
      if v_order is not null and v_carrier is not null then
        perform public.admin_update_order_tracking(v_order, v_carrier, v_row.row ->> 'tracking');
        v_applied := v_applied + 1;
      end if;
    end if;
  end loop;

  if v_job.kind = 'stock_set' and jsonb_array_length(v_stock_rows) > 0 then
    -- 재고는 이미 있는 절대값 일괄 RPC 를 그대로 쓴다 — 잠금 순서·이동 기록·경고 규칙이 한 곳에만 있다.
    v_result := public.admin_set_variant_stock_bulk(
      p_job_id, 'excel', v_stock_rows, 'excel_set', v_job.file_name
    );
    v_applied := coalesce((v_result ->> 'applied')::integer, 0);
  end if;

  update public.import_jobs
  set status = 'applied',
      applied_rows = v_applied,
      -- 일괄 RPC 가 「전부 성공 아니면 전부 실패」라 0줄 적용이 나올 수 있다. 이유를 남긴다.
      error = case
        when v_result is not null and jsonb_array_length(coalesce(v_result -> 'errors', '[]'::jsonb)) > 0
          then '재고 일괄 반영 거부: ' || (v_result -> 'errors')::text
      end,
      finished_at = now()
  where id = p_job_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.import.applied', 'import_job:' || p_job_id::text,
          jsonb_build_object('kind', v_job.kind, 'applied', v_applied));
  return jsonb_build_object('applied', v_applied, 'skipped', v_job.failed_rows);
end;
$$;
