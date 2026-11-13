-- 1027T-X04 ERP 붙여넣기 값을 연결 상품의 판매가·바코드에 반영한다. 10/27 회의 "그 안에 들어가는 게 판매가랑 바코드
-- 이런 거였는데 … 붙여넣기 하면은 자동으로 저기도 연동이 되게"(줄 46~47)에 대한 사용자 결정(2026-11-11, 묶음 13)
-- "빈 칸 자동+확정 반영": 붙여넣은 값이 연결 상품과 다르면 미리보기 뒤 확정해 판매가·바코드를 반영한다(반영 RPC·감사).
--
-- 연결 상품: 옵션의 ERP 코드(private.goods_variant_external_identity.erp_code)가 반입한 ERP 품목 코드와 같은
-- 판매 중인(보관하지 않은) 상품의 사용 중인 옵션이다. 미리보기는 값이 다른 행만 보인다. 한 행은 옵션 하나의 판매가 또는 바코드다.
-- * 판매가: ERP 판매가를 그 옵션의 판매 금액(할인 전)으로 맞춘다. 기본 옵션이면 상품 판매가, 다른 옵션이면 옵션가(판매가에 더하는 금액)가 바뀐다.
--   반영은 기존 상품 저장 RPC(admin_save_good — 상품 편집 저장과 상품 목록 판매가 바로 수정이 쓰는 RPC)를 상품마다 부른다.
--   옵션 행은 상품 편집 저장과 같이 사용 중인 옵션과 사용 중지된 기본 옵션을 기본 옵션부터 싣는다(기본 옵션 유지).
--   그래서 가격 규칙(할인 기간 가드·표시용 정가·옵션가 0원 이상·랜덤 판매 균일가·공개 상품 고시 등)과 감사 기록이 그대로 적용된다.
--   다음은 미리보기에서 건너뛰고 이유를 보인다(오케스트레이터 판단: 할인 중 상품 판매가는 건너뛰고 이유 표시).
--   - 기간 할인이 진행 중이거나 예정된 상품(DB 가드 active_price_period_requires_reset과 같은 판정을 상품 단위로)
--   - 상품 할인(할인가)이 설정된 상품: 상품 편집은 할인을 compare_at_price=판매가(할인 전), price=할인가로 저장한다
--     (lib/admin/goods-price-editor.ts). ERP 판매가(할인 전)는 compare_at_price+옵션가와 견주고, 다를 때만 건너뜀 행을 보인다
--     (price에 넣으면 할인이 사라지고 할인가·할인율이 함께 바뀌므로 상품 화면에서 바꾼다).
--   - ERP 판매가 0원(빈 값일 수 있어 상품을 0원으로 만들지 않는다), 랜덤 판매 상품(판매가가 하나라 상품 화면에서 한 번에 바꾼다)
--   - 반영하면 옵션 판매 금액이 상품 판매가보다 낮아지는 상품(옵션가 0원 이상), 상품정보제공고시가 빈 공개 상품(상품 저장 규칙)
-- * 바코드: ERP 바코드가 있을 때만 그 옵션의 바코드로 맞춘다(ERP에 바코드가 없다고 상품 바코드를 지우지 않는다).
--   바코드는 출고 파일·창고 대조 키라 이미 있던 바코드가 바뀌는 행에는 경고를 붙인다. 다른 옵션이 이미 쓰는 바코드거나
--   같은 바코드를 두 옵션에 넣게 되면 건너뛴다. 반영은 옵션 ERP 식별자 저장 함수(private.save_goods_variant_external_identity)로 한다.
--
-- 미리보기는 operation 행에 고정해 두고(15분), 확정은 운영자가 고른 행만 같은 operation으로 반영한다. 확정은 잠금을 잡고
-- 같은 계산을 다시 해 미리보기 뒤 값이 바뀐 행이 있으면 아무것도 반영하지 않는다. 결과(영수증)를 operation에 남겨
-- 같은 확정을 다시 보내면 같은 결과를 돌려준다(이중 반영 없음). 상품 저장 규칙에 막힌 상품은 그 상품만 빼고 사유를 남긴다.
-- 능력은 상품 편집과 같은 catalog.manage다(MD 반입 권한, 20261113040000).
begin;

create table private.erp_goods_apply_operations (
  id uuid primary key,
  actor_id uuid not null,
  -- 비교한 ERP 코드. null이면 반입한 전체 ERP 품목.
  scope_codes text[],
  preview jsonb not null,
  expires_at timestamptz not null default (clock_timestamp() + interval '15 minutes'),
  receipt jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index erp_goods_apply_operations_created_idx on private.erp_goods_apply_operations (created_at);
alter table private.erp_goods_apply_operations enable row level security;
revoke all on private.erp_goods_apply_operations from public, anon, authenticated, service_role;

-- 연결 상품 반영 계획. 미리보기와 확정이 같은 계산을 쓴다. 값이 다른 행만 돌려준다.
-- {linked: 비교한 연결 옵션 수, rows: [{key, field, goodId, goodName, goodCode, published, variantId, optionName, isDefault,
--   sortOrder, erpCode, erpName, current, next, status: apply|skip, reason, warning}]}
create function private.erp_linked_goods_plan(p_codes text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  with linked as (
    select
      item.code as erp_code,
      item.name as erp_name,
      item.sale_price as erp_price,
      item.barcode as erp_barcode,
      ident.variant_id,
      ident.barcode as current_barcode,
      variant.good_id,
      variant.name as option_name,
      -- ERP 판매가와 견줄 이 옵션의 할인 전 판매 금액. 상품 할인(할인가) 상품은 price가 할인가라
      -- 표시용 정가(할인 전 판매가)에 옵션가(옵션 price − 상품 price)를 더한 값이다(lib/admin/goods-price-editor.ts).
      case
        when good.compare_at_price is null then variant.price::bigint
        else greatest(good.compare_at_price::bigint + variant.price::bigint - good.price::bigint, 0)
      end as current_price,
      variant.is_default,
      variant.sort_order,
      good.name as good_name,
      good.code as good_code,
      good.published_at is not null as published
    from public.erp_items as item
    join private.goods_variant_external_identity as ident
      on lower(ident.erp_code) = lower(item.code) and ident.erp_code = item.code
    join public.goods_variants as variant on variant.id = ident.variant_id and variant.archived_at is null
    join public.goods as good on good.id = variant.good_id and good.archived_at is null
    where p_codes is null or item.code = any(p_codes)
  ),
  price_candidates as (
    select
      linked.*,
      case
        when linked.erp_price = 0 then 'zero_price'
        when good.option_sale_mode = 'random' then 'random_option'
        -- private.guard_goods_variant_period_price와 같은 판정(진행 중이거나 예정된 활성 기간)을 상품 단위로 본다.
        when exists (
          select 1
          from public.goods_variants as sibling
          join private.goods_variant_price_periods as period on period.variant_id = sibling.id
          where sibling.good_id = linked.good_id
            and period.state = 'active'
            and period.ends_at > pg_catalog.statement_timestamp()
        ) then 'active_discount'
        -- 상품 할인(표시용 정가 = 할인 전 판매가)이 설정된 상품. 할인 전 금액이 ERP 판매가와 다를 때만 이 행이 생기고,
        -- 판매가를 바꾸면 할인가·할인율이 함께 달라지므로 상품 화면에서 바꾼다.
        when good.compare_at_price is not null then 'instant_discount'
        -- admin_upsert_good의 고시 필수 규칙(공개 상품). 상품 저장이 거절되므로 미리 건너뛴다.
        when good.published_at is not null and (good.notice_maker is null or good.notice_origin is null
          or good.notice_material is null or good.notice_size is null or good.notice_made_on is null
          or good.notice_as_manager is null or good.notice_as_contact is null) then 'notice_required'
      end as early_reason
    from linked
    join public.goods as good on good.id = linked.good_id
    where linked.erp_price is not null
      and linked.erp_price is distinct from linked.current_price
  ),
  -- 같은 상품의 반영 가능한 판매가 행을 모두 반영한 뒤의 상품 판매가(기본 옵션)와 옵션별 판매 금액으로 상품 단위 규칙을 본다.
  -- 저장에 싣는 옵션(사용 중인 옵션 + 사용 중지된 기본 옵션, 상품 편집 저장과 같은 행)의 옵션가가 0원 이상이어야 한다.
  good_final as (
    select
      good.id as good_id,
      coalesce((
        select candidate.erp_price
        from price_candidates as candidate
        where candidate.good_id = good.id and candidate.is_default and candidate.early_reason is null
      ), good.price) as final_base
    from public.goods as good
    where good.id in (select candidate.good_id from price_candidates as candidate where candidate.early_reason is null)
  ),
  good_check as (
    select
      final.good_id,
      case
        when exists (
          select 1
          from public.goods_variants as variant
          left join price_candidates as candidate on candidate.variant_id = variant.id and candidate.early_reason is null
          where variant.good_id = final.good_id
            and (variant.archived_at is null or variant.is_default)
            and coalesce(candidate.erp_price, variant.price) < final.final_base
        ) then 'option_price_order'
      end as group_reason
    from good_final as final
  ),
  price_rows as (
    select candidate.*, coalesce(candidate.early_reason, checked.group_reason) as reason
    from price_candidates as candidate
    left join good_check as checked on checked.good_id = candidate.good_id
  ),
  barcode_candidates as (
    select
      linked.*,
      -- 같은 바코드를 넣게 되는 옵션 수(바코드 고유 색인과 같은 대소문자 무시).
      pg_catalog.count(*) over (partition by lower(linked.erp_barcode)) as same_barcode_count
    from linked
    where linked.erp_barcode is not null
      and linked.erp_barcode is distinct from linked.current_barcode
  ),
  barcode_rows as (
    select
      candidate.*,
      case
        when candidate.same_barcode_count > 1 then 'barcode_duplicate'
        when exists (
          select 1 from private.goods_variant_external_identity as other
          where other.variant_id <> candidate.variant_id
            and lower(other.barcode) = lower(candidate.erp_barcode)
        ) then 'barcode_taken'
      end as reason
    from barcode_candidates as candidate
  ),
  plan_rows as (
    select
      price.good_name, price.good_id, price.is_default, price.sort_order, price.variant_id, 0 as field_order,
      pg_catalog.jsonb_build_object(
        'key', price.variant_id::text || ':price', 'field', 'price',
        'goodId', price.good_id, 'goodName', price.good_name, 'goodCode', price.good_code, 'published', price.published,
        'variantId', price.variant_id, 'optionName', price.option_name, 'isDefault', price.is_default, 'sortOrder', price.sort_order,
        'erpCode', price.erp_code, 'erpName', price.erp_name,
        'current', price.current_price, 'next', price.erp_price,
        'status', case when price.reason is null then 'apply' else 'skip' end,
        'reason', price.reason, 'warning', null) as row
    from price_rows as price
    union all
    select
      barcode.good_name, barcode.good_id, barcode.is_default, barcode.sort_order, barcode.variant_id, 1,
      pg_catalog.jsonb_build_object(
        'key', barcode.variant_id::text || ':barcode', 'field', 'barcode',
        'goodId', barcode.good_id, 'goodName', barcode.good_name, 'goodCode', barcode.good_code, 'published', barcode.published,
        'variantId', barcode.variant_id, 'optionName', barcode.option_name, 'isDefault', barcode.is_default, 'sortOrder', barcode.sort_order,
        'erpCode', barcode.erp_code, 'erpName', barcode.erp_name,
        'current', barcode.current_barcode, 'next', barcode.erp_barcode,
        'status', case when barcode.reason is null then 'apply' else 'skip' end,
        'reason', barcode.reason,
        'warning', case when barcode.reason is null and barcode.current_barcode is not null then 'barcode_changed' end)
    from barcode_rows as barcode
  )
  select pg_catalog.jsonb_build_object(
    'linked', (select pg_catalog.count(*) from linked),
    'rows', coalesce((
      select pg_catalog.jsonb_agg(plan_rows.row order by plan_rows.good_name, plan_rows.good_id, plan_rows.is_default desc,
        plan_rows.sort_order, plan_rows.variant_id, plan_rows.field_order)
      from plan_rows), '[]'::jsonb))
$$;
revoke all on function private.erp_linked_goods_plan(text[]) from public, anon, authenticated, service_role;

-- 미리보기: 비교 범위(붙여넣은 ERP 코드 또는 전체)의 계획을 operation에 고정하고 돌려준다. 상품은 바꾸지 않는다.
-- 같은 operation id로 다시 부르면 고정해 둔 미리보기를 돌려준다. 값이 다른 행이 없으면 operation을 남기지 않는다.
create function public.admin_preview_erp_linked_goods(p_operation_id uuid, p_codes text[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing private.erp_goods_apply_operations;
  v_codes text[];
  v_plan jsonb;
  v_rows jsonb;
  v_total integer;
  v_expires timestamptz := pg_catalog.clock_timestamp() + interval '15 minutes';
  v_result jsonb;
begin
  perform private.require_operator_capability('catalog.manage', false);
  if v_actor is null or not public.has_operator_capability('catalog.manage', false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_operation_id is null then
    raise invalid_parameter_value using message = 'invalid_erp_goods_apply_request';
  end if;
  if p_codes is not null then
    if pg_catalog.cardinality(p_codes) not between 1 and 5000
       or exists (select 1 from pg_catalog.unnest(p_codes) as code(value)
                  where code.value is null or pg_catalog.length(code.value) > 200) then
      raise invalid_parameter_value using message = 'invalid_erp_goods_apply_request';
    end if;
    -- 반입과 같은 규칙으로 다듬어 저장된 ERP 코드와 맞춘다.
    select coalesce(pg_catalog.array_agg(distinct normalized.value), array[]::text[]) into v_codes
    from (select private.erp_item_text(code.value, false) as value from pg_catalog.unnest(p_codes) as code(value)) as normalized
    where normalized.value is not null;
  end if;

  select * into v_existing from private.erp_goods_apply_operations where id = p_operation_id;
  if found then
    if v_existing.actor_id <> v_actor then
      raise insufficient_privilege using message = 'erp_goods_apply_unavailable';
    end if;
    return v_existing.preview;
  end if;

  -- 지난 미리보기·영수증은 30일만 둔다(반영 내역은 감사 기록에 남는다).
  delete from private.erp_goods_apply_operations where created_at < pg_catalog.clock_timestamp() - interval '30 days';

  v_plan := private.erp_linked_goods_plan(v_codes);
  v_total := pg_catalog.jsonb_array_length(v_plan -> 'rows');
  select coalesce(pg_catalog.jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb) into v_rows
  from pg_catalog.jsonb_array_elements(v_plan -> 'rows') with ordinality as entry(value, ordinality)
  where entry.ordinality <= 500;

  v_result := pg_catalog.jsonb_build_object(
    'operationId', p_operation_id,
    'expiresAt', v_expires,
    'scopeCount', case when v_codes is null then null else pg_catalog.cardinality(v_codes) end,
    'linked', v_plan -> 'linked',
    'total', v_total,
    'truncated', v_total > 500,
    'rows', v_rows);

  if v_total > 0 then
    insert into private.erp_goods_apply_operations (id, actor_id, scope_codes, preview, expires_at)
    values (p_operation_id, v_actor, v_codes, v_result, v_expires);
  end if;
  return v_result;
end;
$$;
revoke all on function public.admin_preview_erp_linked_goods(uuid, text[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_preview_erp_linked_goods(uuid, text[]) to authenticated;

-- 확정: 미리보기에서 고른 행(key)만 반영한다. 같은 operation을 다시 보내면 남겨 둔 결과를 돌려준다.
-- 고른 행이 미리보기에 없거나 건너뛰는 행이면 요청 오류, 같은 상품의 판매가 행을 일부만 골라 옵션 판매가가 상품 판매가보다
-- 낮아지면 erp_goods_apply_partial_price(상품 이름은 detail), 다른 작업이 같은 상품을 저장 중이면 erp_goods_apply_busy로 거절하고
-- operation은 그대로 둔다(고쳐서 다시 확정할 수 있다). 미리보기 뒤 값이 바뀌었거나 15분이 지났으면 아무것도 바꾸지 않은
-- 거절 결과를 남긴다(다시 비교해야 한다).
create function public.admin_commit_erp_linked_goods(p_operation_id uuid, p_keys text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_operation private.erp_goods_apply_operations;
  v_keys text[];
  v_selected jsonb;
  v_current jsonb;
  v_good_ids text[];
  v_variant_ids uuid[];
  v_good_id text;
  v_good public.goods;
  v_final_base integer;
  v_options jsonb;
  v_baseline jsonb;
  v_row jsonb;
  v_identity private.goods_variant_external_identity;
  v_failure text;
  v_applied jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_receipt jsonb;
begin
  perform private.require_operator_capability('catalog.manage', false);
  if v_actor is null or not public.has_operator_capability('catalog.manage', false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_operation_id is null or p_keys is null
     or pg_catalog.cardinality(p_keys) not between 1 and 500
     or pg_catalog.array_position(p_keys, null) is not null then
    raise invalid_parameter_value using message = 'invalid_erp_goods_apply_keys';
  end if;
  select pg_catalog.array_agg(distinct key.value) into v_keys from pg_catalog.unnest(p_keys) as key(value);

  select * into v_operation from private.erp_goods_apply_operations where id = p_operation_id for update;
  if not found or v_operation.actor_id <> v_actor then
    raise insufficient_privilege using message = 'erp_goods_apply_unavailable';
  end if;
  if v_operation.receipt is not null then
    return v_operation.receipt;
  end if;

  select coalesce(pg_catalog.jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb) into v_selected
  from pg_catalog.jsonb_array_elements(v_operation.preview -> 'rows') with ordinality as entry(value, ordinality)
  where entry.value ->> 'key' = any(v_keys) and entry.value ->> 'status' = 'apply';
  if pg_catalog.jsonb_array_length(v_selected) <> pg_catalog.cardinality(v_keys) then
    raise invalid_parameter_value using message = 'invalid_erp_goods_apply_keys';
  end if;

  if v_operation.expires_at <= pg_catalog.clock_timestamp() then
    v_receipt := pg_catalog.jsonb_build_object('state', 'rejected', 'operationId', p_operation_id, 'error', 'erp_goods_apply_expired');
    update private.erp_goods_apply_operations set receipt = v_receipt where id = p_operation_id;
    return v_receipt;
  end if;

  select pg_catalog.array_agg(distinct row.value ->> 'goodId' order by row.value ->> 'goodId'),
         pg_catalog.array_agg(distinct (row.value ->> 'variantId')::uuid)
  into v_good_ids, v_variant_ids
  from pg_catalog.jsonb_array_elements(v_selected) as row(value);

  -- 잠금 순서: ERP 반입(값 고정) → 카테고리 트리 → 상품별 편집 잠금 → 상품 행 → 옵션 행 → 옵션 ERP 식별자.
  -- 상품 저장(admin_save_good)과 같은 순서라 편집 화면 저장과 교착하지 않는다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.erp_items.import', 0));
  perform private.lock_catalog_category_tree();
  foreach v_good_id in array v_good_ids loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('admin_good:' || v_good_id, 0)) then
      raise sqlstate 'PT409' using message = 'erp_goods_apply_busy';
    end if;
  end loop;
  perform 1 from public.goods where id = any(v_good_ids) order by id for update;
  perform 1 from public.goods_variants where good_id = any(v_good_ids) order by id for update;
  perform 1 from private.goods_variant_external_identity where variant_id = any(v_variant_ids) order by variant_id for update;

  -- 잠근 뒤 같은 계산을 다시 해 고른 행이 미리보기와 같은지 본다. 하나라도 다르면 아무것도 바꾸지 않는다.
  -- 행 키로 찾을 수 있게 key → 행 객체로 묶는다(고른 행마다 전체 계획을 다시 펼치지 않는다).
  select coalesce(pg_catalog.jsonb_object_agg(fresh.value ->> 'key', fresh.value), '{}'::jsonb) into v_current
  from pg_catalog.jsonb_array_elements(private.erp_linked_goods_plan(v_operation.scope_codes) -> 'rows') as fresh(value);
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_selected) as chosen(value)
    where v_current -> (chosen.value ->> 'key') is null
       or (v_current -> (chosen.value ->> 'key') -> 'goodId') is distinct from chosen.value -> 'goodId'
       or (v_current -> (chosen.value ->> 'key') -> 'current') is distinct from chosen.value -> 'current'
       or (v_current -> (chosen.value ->> 'key') -> 'next') is distinct from chosen.value -> 'next'
       or (v_current -> (chosen.value ->> 'key') -> 'status') is distinct from chosen.value -> 'status'
  ) then
    v_receipt := pg_catalog.jsonb_build_object('state', 'rejected', 'operationId', p_operation_id, 'error', 'erp_goods_apply_changed');
    update private.erp_goods_apply_operations set receipt = v_receipt where id = p_operation_id;
    return v_receipt;
  end if;

  -- 같은 상품의 판매가 행을 일부만 고르면 미리보기에서 본 상품 단위 검사와 결과가 달라질 수 있다. 고른 행만으로 다시 본다.
  foreach v_good_id in array v_good_ids loop
    if not exists (select 1 from pg_catalog.jsonb_array_elements(v_selected) as row(value)
                   where row.value ->> 'goodId' = v_good_id and row.value ->> 'field' = 'price') then
      continue;
    end if;
    select * into v_good from public.goods where id = v_good_id;
    v_final_base := coalesce((
      select (row.value ->> 'next')::integer
      from pg_catalog.jsonb_array_elements(v_selected) as row(value)
      join public.goods_variants as variant on variant.id = (row.value ->> 'variantId')::uuid
      where row.value ->> 'goodId' = v_good_id and row.value ->> 'field' = 'price' and variant.is_default
    ), v_good.price);
    if exists (
         select 1
         from public.goods_variants as variant
         left join pg_catalog.jsonb_array_elements(v_selected) as row(value)
           on row.value ->> 'field' = 'price' and (row.value ->> 'variantId')::uuid = variant.id
         where variant.good_id = v_good_id
           and (variant.archived_at is null or variant.is_default)
           and coalesce((row.value ->> 'next')::integer, variant.price) < v_final_base
       ) then
      raise check_violation using message = 'erp_goods_apply_partial_price', detail = v_good.name;
    end if;
  end loop;

  foreach v_good_id in array v_good_ids loop
    select * into v_good from public.goods where id = v_good_id;

    -- 판매가: 상품 목록의 판매가 바로 수정과 같은 상품 저장 RPC(admin_save_good)를 부른다. 고르지 않은 옵션의 판매 금액은 그대로 둔다.
    -- 옵션 행은 상품 편집 저장과 같다(lib/admin/goods-option-editor.ts initialGoodsOptionRows: 사용 중인 옵션 + 사용 중지된 기본 옵션,
    -- 기본 옵션이 첫 행). private.save_goods_options는 첫 행을 기본 옵션으로 정하므로, 사용 중지된 기본 옵션을 isActive=false로
    -- 첫 행에 실어 기본 옵션이 다른 옵션으로 바뀌지 않게 한다. 그 밖의 사용 중지 옵션은 싣지 않아 그대로 남는다.
    if exists (select 1 from pg_catalog.jsonb_array_elements(v_selected) as row(value)
               where row.value ->> 'goodId' = v_good_id and row.value ->> 'field' = 'price') then
      v_final_base := coalesce((
        select (row.value ->> 'next')::integer
        from pg_catalog.jsonb_array_elements(v_selected) as row(value)
        join public.goods_variants as variant on variant.id = (row.value ->> 'variantId')::uuid
        where row.value ->> 'goodId' = v_good_id and row.value ->> 'field' = 'price' and variant.is_default
      ), v_good.price);
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', variant.id, 'name', variant.name, 'attributes', variant.attributes, 'code', variant.code,
          'extraPrice', coalesce((chosen.value ->> 'next')::integer, variant.price) - v_final_base,
          'stockQty', variant.stock_qty, 'expectedStockQty', variant.stock_qty, 'isActive', variant.archived_at is null,
          'lowStockThreshold', variant.low_stock_threshold)
        order by variant.is_default desc, variant.sort_order, variant.id)
      into v_options
      from public.goods_variants as variant
      left join pg_catalog.jsonb_array_elements(v_selected) as chosen(value)
        on chosen.value ->> 'field' = 'price' and (chosen.value ->> 'variantId')::uuid = variant.id
      where variant.good_id = v_good_id and (variant.archived_at is null or variant.is_default);
      select coalesce(pg_catalog.jsonb_agg(variant.id::text order by variant.id), '[]'::jsonb) into v_baseline
      from public.goods_variants as variant
      where variant.good_id = v_good_id and variant.archived_at is null;
      begin
        perform public.admin_save_good(pg_catalog.to_jsonb(v_good) || pg_catalog.jsonb_build_object(
          'previous_id', v_good.id, 'publish', null, 'custom_inputs_expected_revision', v_good.custom_inputs_revision,
          'price', v_final_base, 'variants', v_options, 'variant_baseline', v_baseline));
        select v_applied || coalesce(pg_catalog.jsonb_agg(row.value order by row.value ->> 'key'), '[]'::jsonb) into v_applied
        from pg_catalog.jsonb_array_elements(v_selected) as row(value)
        where row.value ->> 'goodId' = v_good_id and row.value ->> 'field' = 'price';
      exception when others then
        get stacked diagnostics v_failure = message_text;
        select v_failed || coalesce(pg_catalog.jsonb_agg(row.value || pg_catalog.jsonb_build_object('error',
            case when v_failure ~ '^[a-z][a-z0-9_]{0,100}$' then v_failure else 'goods_save_rejected' end)
          order by row.value ->> 'key'), '[]'::jsonb) into v_failed
        from pg_catalog.jsonb_array_elements(v_selected) as row(value)
        where row.value ->> 'goodId' = v_good_id and row.value ->> 'field' = 'price';
      end;
    end if;

    -- 바코드: 옵션 ERP 식별자 저장 함수로 바꾼다(잠금·낙관적 확인·감사 기록이 그 함수에 있다). ERP 코드·품명은 그대로 둔다.
    for v_row in
      select row.value from pg_catalog.jsonb_array_elements(v_selected) as row(value)
      where row.value ->> 'goodId' = v_good_id and row.value ->> 'field' = 'barcode'
      order by row.value ->> 'key'
    loop
      begin
        select * into v_identity from private.goods_variant_external_identity
        where variant_id = (v_row ->> 'variantId')::uuid;
        perform private.save_goods_variant_external_identity(
          v_good_id, (v_row ->> 'variantId')::uuid, v_identity.erp_code, v_identity.erp_name,
          v_row ->> 'next', v_identity.updated_at, v_actor);
        v_applied := v_applied || pg_catalog.jsonb_build_array(v_row);
      exception when others then
        get stacked diagnostics v_failure = message_text;
        v_failed := v_failed || pg_catalog.jsonb_build_array(v_row || pg_catalog.jsonb_build_object('error',
          case when v_failure ~ '^[a-z][a-z0-9_]{0,100}$' then v_failure else 'goods_save_rejected' end));
      end;
    end loop;
  end loop;

  v_receipt := pg_catalog.jsonb_build_object(
    'state', 'completed',
    'operationId', p_operation_id,
    'applied', pg_catalog.jsonb_build_object(
      'price', (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_applied) as row(value) where row.value ->> 'field' = 'price'),
      'barcode', (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_applied) as row(value) where row.value ->> 'field' = 'barcode'),
      'goods', (select pg_catalog.count(distinct row.value ->> 'goodId') from pg_catalog.jsonb_array_elements(v_applied) as row(value))),
    'failed', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'key', row.value ->> 'key', 'field', row.value ->> 'field', 'goodId', row.value ->> 'goodId',
          'goodName', row.value ->> 'goodName', 'optionName', row.value ->> 'optionName', 'error', row.value ->> 'error')
        order by row.value ->> 'key'), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_failed) as row(value)));

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.erp_items.linked_goods_applied', 'erp_items', pg_catalog.jsonb_build_object(
    'operationId', p_operation_id,
    'scopeCount', case when v_operation.scope_codes is null then null else pg_catalog.cardinality(v_operation.scope_codes) end,
    'applied', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'key', row.value ->> 'key', 'field', row.value ->> 'field', 'goodId', row.value ->> 'goodId',
          'variantId', row.value ->> 'variantId', 'erpCode', row.value ->> 'erpCode',
          'before', row.value -> 'current', 'after', row.value -> 'next', 'warning', row.value -> 'warning')
        order by row.value ->> 'key'), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_applied) as row(value)),
    'failed', v_receipt -> 'failed'));

  update private.erp_goods_apply_operations set receipt = v_receipt where id = p_operation_id;
  return v_receipt;
end;
$$;
revoke all on function public.admin_commit_erp_linked_goods(uuid, text[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_commit_erp_linked_goods(uuid, text[]) to authenticated;

select private.register_operator_rpc_contract('public.admin_preview_erp_linked_goods(uuid,text[])'::regprocedure, 'catalog.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_commit_erp_linked_goods(uuid,text[])'::regprocedure, 'catalog.manage', 'write', false);
-- 계획 함수도 능력 검사 뒤에서만 불리는 내부 함수라 지문을 남겨 뒤 migration이 조용히 바꾸면 coverage가 잡게 한다.
select private.register_operator_internal_contract('private.erp_linked_goods_plan(text[])'::regprocedure);

notify pgrst, 'reload schema';
commit;
