-- D-1b ① — 주문·카트의 품목 참조 + 예약 백필 (설계서 v2 §1-1 주문과 재고, 리서치 보고서 A §5 4단계)
--
-- 주문 항목은 어떤 품목을 어느 출고지에서 보내는지 확정값으로 들고 있어야 한다(피킹 리스트·ERP 연동).
-- 카트는 품목을 고를 수 있게 열만 열어 둔다 — 스토어프론트에 옵션 선택 UI 가 붙기 전까지는 비어 있고,
-- 그때 place_order 가 기본 품목으로 해석한다. 카트 기본키 교체(사용자 × 품목)는 그 UI 와 함께 온다.
--
-- 예약 백필: 지금까지 주문 생성이 즉시 차감이었으므로 미출고 주문의 수량은 창고에 남아 있는데도
-- 보유에서 빠져 있다. 그 수량을 보유로 되돌리고 같은 만큼 예약으로 묶는다 — 가용(보유 − 예약)은
-- 그대로라 goods 캐시·판매 가능 술어는 변하지 않는다.
--
-- 롤백: 열 drop(추가 전용) + 예약 백필 역산. 앱 롤백만으로도 읽기 경로는 무손상.

/*
 * 이동 기록의 추가 전용 규율을 손질한다: 고친다는 것은 언제나 잘못이라 UPDATE 는 그대로 막고,
 * DELETE 는 명시적 의사표시(`icons.stock_ledger_purge`)가 있을 때만 연다. 픽스처 정리와 훗날의
 * 보존기간 파기가 트리거를 떼어내지 않고도 돌 수 있어야 하되, 실수로는 절대 지워지지 않게 한다.
 * 앱 역할에는 애초에 update/delete 권한이 없다(D-1a).
 */
create or replace function private.reject_stock_movement_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- 명시적 파기 의사표시(보존기간 정리·픽스처 정리)
    if pg_catalog.current_setting('icons.stock_ledger_purge', true) = '1' then
      return old;
    end if;
    -- 품목 자체가 사라지는 연쇄 삭제. 부모 행은 이미 지워진 뒤에 자식 트리거가 돌므로
    -- 참조가 끊긴 기록만 통과한다 — 살아 있는 품목의 기록은 여전히 못 지운다.
    if not exists (
      select 1 from public.good_variants as variant where variant.id = old.variant_id
    ) then
      return old;
    end if;
  end if;
  raise exception 'stock_movements_append_only' using errcode = '55000';
end;
$$;

alter table public.order_items
  add column variant_id uuid references public.good_variants (id),
  add column location_id text references public.stock_locations (id),
  add column variant_code_snapshot text,
  add column option_summary_snapshot text;

comment on column public.order_items.location_id is '출고 확정 출고지(스냅샷). 주문 시점의 품목 덮어쓰기 ∨ 상품 기본값이며 이후 설정이 바뀌어도 불변.';

alter table public.cart_items
  add column variant_id uuid references public.good_variants (id);

comment on column public.cart_items.variant_id is '고른 품목. 비면 주문 시 기본 품목으로 해석한다(옵션이 여러 품목을 만든 상품은 선택 필수).';

-- 백필: 상품의 기본 품목(없으면 활성 품목이 하나뿐인 경우 그 품목) + 그 품목의 유효 출고지
update public.order_items as item
set variant_id = chosen.id,
    location_id = coalesce(chosen.location_id, good.default_location_id),
    variant_code_snapshot = chosen.code,
    option_summary_snapshot = ''
from public.goods as good
join lateral (
  select variant.id, variant.code, variant.location_id
  from public.good_variants as variant
  where variant.good_id = good.id
  order by variant.is_default desc, variant.archived_at nulls first, variant.sort_order, variant.code
  limit 1
) as chosen on true
where item.good_id = good.id
  and item.variant_id is null;

/*
 * 주문 항목은 언제나 품목·출고지를 갖는다. place_order 는 결정된 값을 직접 싣고,
 * 그 밖의 경로(이관·픽스처·수기 보정)는 이 트리거가 상품의 기본 품목과 유효 출고지로 채운다.
 * 여기서 재고를 건드리지는 않는다 — 예약은 주문 RPC 의 일이다.
 */
create or replace function private.fill_order_item_variant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_variant record;
  v_default_location text;
begin
  if new.variant_id is not null and new.location_id is not null then
    return new;
  end if;

  select good.default_location_id into v_default_location
  from public.goods as good
  where good.id = new.good_id;

  if new.variant_id is null then
    select variant.id, variant.code, variant.location_id into v_variant
    from public.good_variants as variant
    where variant.good_id = new.good_id
    order by variant.is_default desc, variant.archived_at nulls first, variant.sort_order, variant.code
    limit 1;
    if v_variant.id is null then
      raise foreign_key_violation using message = pg_catalog.format('variant missing for good: %s', new.good_id);
    end if;
    new.variant_id := v_variant.id;
  else
    select variant.id, variant.code, variant.location_id into v_variant
    from public.good_variants as variant
    where variant.id = new.variant_id;
  end if;

  new.location_id := coalesce(new.location_id, v_variant.location_id, v_default_location);
  new.variant_code_snapshot := coalesce(new.variant_code_snapshot, v_variant.code);
  return new;
end;
$$;

create trigger order_items_fill_variant before insert on public.order_items
  for each row execute function private.fill_order_item_variant();

alter table public.order_items
  alter column variant_id set not null,
  alter column location_id set not null;

-- 피킹 리스트 정렬(출고지 → 품목 → 주문) · 품목별 주문 조회
create index order_items_location_variant_order_idx on public.order_items (location_id, variant_id, order_id);
create index cart_items_variant_idx on public.cart_items (variant_id) where variant_id is not null;

-- 미출고 주문분을 보유로 되돌리고 같은 만큼 예약한다. 가용은 불변이므로 캐시 재계산을 건너뛴다.
select set_config('icons.stock_cache_skip', '1', true);

with pending_items as (
  select item.variant_id, item.location_id, sum(item.qty)::integer as qty
  from public.order_items as item
  join public.orders as ord on ord.id = item.order_id
  where ord.status in ('pending', 'paid', 'confirmed')
  group by item.variant_id, item.location_id
)
update public.variant_stocks as stock
set on_hand_qty = stock.on_hand_qty + pending_items.qty,
    reserved_qty = stock.reserved_qty + pending_items.qty,
    last_source = 'migration',
    last_movement_at = now()
from pending_items
where stock.variant_id = pending_items.variant_id
  and stock.location_id = pending_items.location_id;

insert into public.stock_movements (
  id, variant_id, location_id, delta_on_hand, delta_reserved, on_hand_after, reserved_after,
  reason_code, source, ref_type, note
)
select
  pg_catalog.gen_random_uuid(), stock.variant_id, stock.location_id,
  pending_items.qty, pending_items.qty, stock.on_hand_qty, stock.reserved_qty,
  'migration_baseline', 'system', 'migration', '미출고 주문 수량을 보유로 되돌리고 예약으로 묶음(D-1b 이관)'
from (
  select item.variant_id, item.location_id, sum(item.qty)::integer as qty
  from public.order_items as item
  join public.orders as ord on ord.id = item.order_id
  where ord.status in ('pending', 'paid', 'confirmed')
  group by item.variant_id, item.location_id
) as pending_items
join public.variant_stocks as stock
  on stock.variant_id = pending_items.variant_id and stock.location_id = pending_items.location_id;

select set_config('icons.stock_cache_skip', '0', true);

-- 검증: 가용 합이 goods 캐시와 여전히 같아야 한다(이관이 판매 가능 수량을 흔들지 않았다).
do $$
declare
  v_mismatch integer;
begin
  select count(*) into v_mismatch
  from public.goods as good
  join private.good_stock_totals(good.id, good.stock_override) as totals on true
  where good.stock_qty is distinct from totals.stock_qty or good.stock is distinct from totals.stock;
  if v_mismatch <> 0 then
    raise exception 'reservation backfill changed availability for % goods', v_mismatch;
  end if;
end;
$$;
