-- D-1 ①②③ — 출고지 · 옵션 마스터 · 품목 · 품목×출고지 재고 · 이동 기록 (통합 어드민 설계서 v2 §1-1, 리서치 보고서 A §3·§5)
--
-- 골격: 옵션 마스터 → 품목(옵션값 조합) → 품목×출고지 재고(보유·예약·안전) + 추가 전용 이동 기록.
-- 하위 호환: 옵션 없는 상품 = is_default 품목 1행(코드 <good_id>-01). `goods.stock`·`goods.stock_qty` 는
-- 캐시로 강등한다 — 판매 가능 술어(`archived_at is null and stock<>'soldout' and stock_qty>0`), 재입고 알림
-- 트리거, 카트 검사, 목록 상태(list_status)가 그대로 산다. 캐시 열에 대한 직접 쓰기는 「기본 품목 1개짜리
-- 상품」에 한해 기본 품목의 이동으로 번역한다(브리지) — 기존 RPC·픽스처가 그대로 돌고, 품목이 여러 개인
-- 상품은 품목 단위 RPC 만 허용한다. 이 슬라이스(D-1a)는 주문 경로를 바꾸지 않는다: 주문 시 즉시 차감이
-- 기본 품목의 보유(on_hand) 차감으로 번역되고, 예약(reserved) 의미론은 D-1b(주문 경로)에서 켠다.
--
-- 롤백(1~4 추가 전용): 트리거·함수 drop → 테이블 drop → goods 열 drop. 캐시 열이 살아 있어 읽기 경로 무손실.

-- ---------------------------------------------------------------------------
-- 1. 출고지 마스터
-- ---------------------------------------------------------------------------
create table public.stock_locations (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  address jsonb,
  contact text,
  default_carrier_code text references public.shipping_carriers (code),
  erp_warehouse_code text,
  is_default boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.stock_locations is '출고지(창고) 마스터. 기본 출고지 1행. 상품은 기본값을, 품목은 덮어쓰기를 가진다(ADR-0036 출고지 고정).';
create unique index stock_locations_single_default on public.stock_locations ((true)) where is_default;
create trigger trg_stock_locations_updated before update on public.stock_locations
  for each row execute function public.set_updated_at();

insert into public.stock_locations (id, name, is_default, active, sort_order)
values ('gimpo', '김포', true, true, 1), ('namyangju', '남양주', false, true, 2);

-- ---------------------------------------------------------------------------
-- 2. 상품 확장: 출고지 기본값 · 판매 상태 덮어쓰기 · 자체 상품코드
-- ---------------------------------------------------------------------------
alter table public.goods
  add column default_location_id text not null default 'gimpo' references public.stock_locations (id),
  add column stock_override text not null default 'auto' check (stock_override in ('auto', 'low', 'soldout')),
  add column custom_code text;
comment on column public.goods.stock_override is '운영자 판매 상태 덮어쓰기. auto = 안전재고로 부족 파생 · low = 부족 고정 · soldout = 판매 중지. goods.stock 캐시의 입력.';
comment on column public.goods.stock is '캐시(파생). stock_override 와 품목×출고지 재고에서 트리거가 유지한다. 직접 쓰기는 기본 품목 1개짜리 상품에서만 번역된다.';
comment on column public.goods.stock_qty is '캐시(파생) = 판매 중·진열 중 품목의 가용(보유−예약) 합. 직접 쓰기는 기본 품목 1개짜리 상품에서만 번역된다.';
create unique index goods_custom_code_key on public.goods (custom_code) where custom_code is not null;

-- ---------------------------------------------------------------------------
-- 3. 옵션 마스터 · 값 · 상품이 쓰는 옵션
-- ---------------------------------------------------------------------------
create table public.option_masters (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^O[0-9]{4,}$'),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  display_style text not null default 'select' check (display_style in ('select', 'button', 'radio', 'swatch')),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create sequence public.option_master_code_seq start 1;
create trigger trg_option_masters_updated before update on public.option_masters
  for each row execute function public.set_updated_at();

create table public.option_values (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.option_masters (id),
  value text not null check (char_length(btrim(value)) between 1 and 40),
  sort_order integer not null default 0,
  archived_at timestamptz,
  unique (option_id, value)
);
create index option_values_option_idx on public.option_values (option_id, sort_order);

create table public.good_options (
  good_id text not null references public.goods (id) on delete cascade,
  option_id uuid not null references public.option_masters (id),
  position smallint not null check (position between 1 and 3),
  primary key (good_id, option_id),
  unique (good_id, position)
);

-- ---------------------------------------------------------------------------
-- 4. 품목(옵션값 조합) · 품목의 옵션값
-- ---------------------------------------------------------------------------
-- 상품 하드 삭제(운영은 보관을 쓰지만 정리·픽스처 경로가 있다)를 새 자식 표가 막지 않게 한다.
create table public.good_variants (
  id uuid primary key default gen_random_uuid(),
  good_id text not null references public.goods (id) on delete cascade,
  code text not null unique,
  custom_code text,
  option_signature text not null default '',
  is_default boolean not null default false,
  additional_price integer not null default 0 check (additional_price between -100000000 and 100000000),
  display boolean not null default true,
  sellable boolean not null default true,
  location_id text references public.stock_locations (id),
  image_path text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (good_id, option_signature)
);
comment on table public.good_variants is '품목 = 옵션값 조합 1개. 옵션 없는 상품은 is_default 1행(코드 <good_id>-01). location_id null = 상품 기본 출고지 상속.';
create unique index good_variants_custom_code_key on public.good_variants (custom_code) where custom_code is not null;
create unique index good_variants_single_default on public.good_variants (good_id) where is_default and archived_at is null;
create index good_variants_good_active_idx on public.good_variants (good_id, sort_order) where archived_at is null;
create trigger trg_good_variants_updated before update on public.good_variants
  for each row execute function public.set_updated_at();

create table public.variant_option_values (
  variant_id uuid not null references public.good_variants (id) on delete cascade,
  option_id uuid not null references public.option_masters (id),
  value_id uuid not null references public.option_values (id),
  primary key (variant_id, option_id)
);
create index variant_option_values_value_idx on public.variant_option_values (value_id);

-- ---------------------------------------------------------------------------
-- 5. 재고(품목 × 출고지) · 이동 기록(추가 전용) · 업로드 배치
-- ---------------------------------------------------------------------------
create table public.variant_stocks (
  variant_id uuid not null references public.good_variants (id) on delete cascade,
  location_id text not null references public.stock_locations (id),
  on_hand_qty integer not null default 0 check (on_hand_qty >= 0),
  reserved_qty integer not null default 0 check (reserved_qty >= 0),
  safety_qty integer not null default 0 check (safety_qty >= 0),
  last_source text not null default 'migration'
    check (last_source in ('admin', 'excel', 'wms', 'order', 'claim', 'count', 'system', 'migration')),
  last_movement_at timestamptz,
  counted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (variant_id, location_id)
);
comment on table public.variant_stocks is '품목×출고지 재고. 가용 = on_hand − reserved. 안전재고는 판매 차단이 아니라 경보 임계치. 실사 결과가 예약보다 작을 수 있어 CHECK 로 막지 않는다.';
create index variant_stocks_location_idx on public.variant_stocks (location_id, variant_id);
create index variant_stocks_low_idx on public.variant_stocks (variant_id)
  where safety_qty > 0 and on_hand_qty - reserved_qty <= safety_qty;
create trigger trg_variant_stocks_updated before update on public.variant_stocks
  for each row execute function public.set_updated_at();

create table public.stock_movements (
  id uuid primary key,
  variant_id uuid not null references public.good_variants (id) on delete cascade,
  location_id text not null references public.stock_locations (id),
  delta_on_hand integer not null default 0,
  delta_reserved integer not null default 0,
  on_hand_after integer not null,
  reserved_after integer not null,
  reason_code text not null check (reason_code in (
    'initial', 'count', 'receive', 'return_restock', 'damage', 'transfer_in', 'transfer_out',
    'order_reserve', 'order_release', 'order_ship', 'excel_set', 'wms_sync', 'correction',
    'legacy_write', 'migration_baseline')),
  source text not null check (source in ('admin', 'excel', 'wms', 'order', 'claim', 'count', 'system')),
  ref_type text,
  ref_id text,
  note text,
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (delta_on_hand <> 0 or delta_reserved <> 0),
  check (reason_code <> 'correction' or note is not null)
);
comment on table public.stock_movements is '재고 이동 기록(추가 전용). id = 클라이언트가 만드는 멱등 키. 모든 수량 변화는 여기 1행을 남긴다.';
create index stock_movements_variant_idx on public.stock_movements (variant_id, location_id, created_at desc);
create index stock_movements_ref_idx on public.stock_movements (ref_type, ref_id);
create index stock_movements_created_idx on public.stock_movements (created_at desc);

create table public.stock_upload_batches (
  id uuid primary key,
  kind text not null check (kind in ('excel', 'wms')),
  file_name text,
  row_count integer not null,
  applied_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- 피킹 리스트 정렬(출고지 → 품목 → 주문)은 D-1b 에서 order_items 에 품목·출고지 열이 생긴 뒤 인덱스를 얹는다.

-- ---------------------------------------------------------------------------
-- 6. RLS · 권한 — 마스터·품목은 공개 읽기, 재고·이동·배치는 스태프만 읽기, 쓰기는 전부 RPC
-- ---------------------------------------------------------------------------
alter table public.stock_locations enable row level security;
alter table public.option_masters enable row level security;
alter table public.option_values enable row level security;
alter table public.good_options enable row level security;
alter table public.good_variants enable row level security;
alter table public.variant_option_values enable row level security;
alter table public.variant_stocks enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_upload_batches enable row level security;

create policy stock_locations_read on public.stock_locations for select using (true);
create policy option_masters_read on public.option_masters for select using (true);
create policy option_values_read on public.option_values for select using (true);
create policy good_options_read on public.good_options for select using (true);
create policy good_variants_read on public.good_variants for select using (true);
create policy variant_option_values_read on public.variant_option_values for select using (true);
create policy variant_stocks_staff_read on public.variant_stocks for select to authenticated
  using ((select public.is_staff()));
create policy stock_movements_staff_read on public.stock_movements for select to authenticated
  using ((select public.is_staff()));
create policy stock_upload_batches_staff_read on public.stock_upload_batches for select to authenticated
  using ((select public.is_staff()));

revoke insert, update, delete, truncate on
  public.stock_locations, public.option_masters, public.option_values, public.good_options,
  public.good_variants, public.variant_option_values, public.variant_stocks, public.stock_movements,
  public.stock_upload_batches
from anon, authenticated;
-- 이 프로젝트의 기본 권한은 새 표에 select 를 주지 않는다 — 읽기 범위를 명시한다.
grant select on
  public.stock_locations, public.option_masters, public.option_values, public.good_options,
  public.good_variants, public.variant_option_values
to anon, authenticated;
grant select on public.variant_stocks, public.stock_movements, public.stock_upload_batches to authenticated;
revoke select on public.variant_stocks, public.stock_movements, public.stock_upload_batches from anon;
revoke update, delete, truncate on public.stock_movements from service_role;

-- 이동 기록은 고치지도 지우지도 않는다.
create or replace function private.reject_stock_movement_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'stock_movements_append_only' using errcode = '55000';
end;
$$;
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function private.reject_stock_movement_change();

-- ---------------------------------------------------------------------------
-- 7. 캐시 계산 · 적용 · 이동 적용 (내부)
-- ---------------------------------------------------------------------------

-- 상품의 캐시 값. 판매 중·진열 중·보관 아님 품목의 가용 합과 안전재고 이하 여부.
create or replace function private.good_stock_totals(p_good_id text, p_override text)
returns table (stock text, stock_qty integer, low_count integer, sellable_variant_count integer)
language sql
stable
set search_path = ''
as $$
  with scope as (
    select
      coalesce(sum(greatest(s.on_hand_qty - s.reserved_qty, 0)), 0)::bigint as available_total,
      count(*) filter (
        where s.safety_qty > 0 and s.on_hand_qty - s.reserved_qty <= s.safety_qty
      )::integer as low_count,
      count(distinct v.id)::integer as sellable_variant_count
    from public.good_variants as v
    join public.variant_stocks as s on s.variant_id = v.id
    where v.good_id = p_good_id
      and v.archived_at is null
      and v.sellable
      and v.display
  )
  select
    case p_override
      when 'soldout' then 'soldout'
      when 'low' then 'low'
      else case when scope.low_count > 0 then 'low' else 'ok' end
    end as stock,
    least(scope.available_total, 2147483647)::integer as stock_qty,
    scope.low_count,
    scope.sellable_variant_count
  from scope;
$$;

-- 캐시를 goods 행에 쓴다. 브리지 트리거가 이 쓰기를 통과시키도록 세션 플래그를 켠다.
create or replace function private.apply_good_stock_cache(p_good_id text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_previous text := current_setting('icons.stock_cache_write', true);
  v_override text;
  v_totals record;
begin
  if current_setting('icons.stock_cache_skip', true) = '1' then
    return;
  end if;
  select good.stock_override into v_override from public.goods as good where good.id = p_good_id;
  if v_override is null then
    return;
  end if;
  select * into v_totals from private.good_stock_totals(p_good_id, v_override);
  perform set_config('icons.stock_cache_write', '1', true);
  update public.goods as good
  set stock = v_totals.stock,
      stock_qty = v_totals.stock_qty
  where good.id = p_good_id
    and (good.stock is distinct from v_totals.stock or good.stock_qty is distinct from v_totals.stock_qty);
  perform set_config('icons.stock_cache_write', coalesce(v_previous, '0'), true);
end;
$$;

-- 수량 변화 1건 = 재고 행 갱신 + 이동 기록 1행. 모든 재고 쓰기는 이 함수를 지난다.
create or replace function private.apply_stock_movement(
  p_movement_id uuid,
  p_variant_id uuid,
  p_location_id text,
  p_delta_on_hand integer,
  p_delta_reserved integer,
  p_reason_code text,
  p_source text,
  p_ref_type text,
  p_ref_id text,
  p_note text,
  p_actor_id uuid,
  p_counted boolean default false
)
returns table (on_hand_qty integer, reserved_qty integer)
language plpgsql
set search_path = ''
as $$
declare
  v_good_id text;
  v_on_hand bigint;
  v_reserved bigint;
  v_next_on_hand bigint;
  v_next_reserved bigint;
begin
  select v.good_id into v_good_id from public.good_variants as v where v.id = p_variant_id;
  if v_good_id is null then
    raise exception 'variant_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.stock_locations as l where l.id = p_location_id) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  insert into public.variant_stocks (variant_id, location_id, last_source)
  values (p_variant_id, p_location_id, 'system')
  on conflict (variant_id, location_id) do nothing;

  select s.on_hand_qty, s.reserved_qty
    into v_on_hand, v_reserved
  from public.variant_stocks as s
  where s.variant_id = p_variant_id and s.location_id = p_location_id
  for update;

  v_next_on_hand := v_on_hand + p_delta_on_hand;
  v_next_reserved := v_reserved + p_delta_reserved;
  if v_next_on_hand < 0 or v_next_on_hand > 2147483647
    or v_next_reserved < 0 or v_next_reserved > 2147483647
  then
    raise exception 'stock_out_of_range' using errcode = '22003';
  end if;

  update public.variant_stocks as s
  set on_hand_qty = v_next_on_hand::integer,
      reserved_qty = v_next_reserved::integer,
      last_source = p_source,
      last_movement_at = pg_catalog.now(),
      counted_at = case when p_counted then pg_catalog.now() else s.counted_at end
  where s.variant_id = p_variant_id and s.location_id = p_location_id;

  insert into public.stock_movements (
    id, variant_id, location_id, delta_on_hand, delta_reserved, on_hand_after, reserved_after,
    reason_code, source, ref_type, ref_id, note, actor_id
  )
  values (
    p_movement_id, p_variant_id, p_location_id, p_delta_on_hand, p_delta_reserved,
    v_next_on_hand::integer, v_next_reserved::integer,
    p_reason_code, p_source, p_ref_type, p_ref_id, p_note, p_actor_id
  );

  return query select v_next_on_hand::integer, v_next_reserved::integer;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. 캐시 유지 트리거 — 재고·품목이 바뀌면 상품 캐시를 다시 쓴다
-- ---------------------------------------------------------------------------
create or replace function private.refresh_good_stock_cache_from_variant_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_good_id text;
begin
  select v.good_id into v_good_id
  from public.good_variants as v
  where v.id = coalesce(new.variant_id, old.variant_id);
  if v_good_id is not null then
    perform private.apply_good_stock_cache(v_good_id);
  end if;
  return null;
end;
$$;
create trigger variant_stocks_refresh_good_cache
  after insert or update or delete on public.variant_stocks
  for each row execute function private.refresh_good_stock_cache_from_variant_stock();

create or replace function private.refresh_good_stock_cache_from_variant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.sellable = old.sellable
    and new.display = old.display
    and new.archived_at is not distinct from old.archived_at
    and new.location_id is not distinct from old.location_id
  then
    return null;
  end if;
  perform private.apply_good_stock_cache(coalesce(new.good_id, old.good_id));
  return null;
end;
$$;
create trigger good_variants_refresh_good_cache
  after insert or update or delete on public.good_variants
  for each row execute function private.refresh_good_stock_cache_from_variant();

-- ---------------------------------------------------------------------------
-- 9. goods 브리지 — 캐시 열 직접 쓰기의 번역 · 등록 시 기본 품목 자동 생성
-- ---------------------------------------------------------------------------

-- 등록: 운영 상태(stock) → 덮어쓰기(stock_override) 정규화. 캐시 값도 그 규칙으로 맞춘다.
create or replace function private.normalize_goods_stock_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stock_override = 'auto' then
    new.stock_override := case new.stock when 'soldout' then 'soldout' when 'low' then 'low' else 'auto' end;
  end if;
  new.stock := case new.stock_override when 'soldout' then 'soldout' when 'low' then 'low' else 'ok' end;
  return new;
end;
$$;
create trigger goods_a_normalize_stock_insert before insert on public.goods
  for each row execute function private.normalize_goods_stock_insert();

-- 등록 직후: 기본 품목 1행 + 활성 출고지마다 재고 행. 등록 시 수량은 기본 출고지의 보유로 들어간다.
create or replace function private.create_default_variant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_variant_id uuid := pg_catalog.gen_random_uuid();
  v_previous_skip text := current_setting('icons.stock_cache_skip', true);
begin
  perform set_config('icons.stock_cache_skip', '1', true);
  insert into public.good_variants (id, good_id, code, option_signature, is_default, sort_order)
  values (v_variant_id, new.id, new.id || '-01', '', true, 0);
  insert into public.variant_stocks (variant_id, location_id, on_hand_qty, last_source, last_movement_at)
  select
    v_variant_id,
    location.id,
    case when location.id = new.default_location_id then new.stock_qty else 0 end,
    'system',
    pg_catalog.now()
  from public.stock_locations as location
  where location.active;
  if new.stock_qty <> 0 then
    insert into public.stock_movements (
      id, variant_id, location_id, delta_on_hand, on_hand_after, reserved_after, reason_code, source, ref_type, ref_id, note
    )
    values (
      pg_catalog.gen_random_uuid(), v_variant_id, new.default_location_id, new.stock_qty, new.stock_qty, 0,
      'initial', 'system', 'goods', new.id, '등록 시 수량'
    );
  end if;
  perform set_config('icons.stock_cache_skip', coalesce(v_previous_skip, '0'), true);
  return null;
end;
$$;
create trigger goods_create_default_variant after insert on public.goods
  for each row execute function private.create_default_variant();

-- 수정: stock 직접 쓰기 → stock_override 로, stock_qty 직접 쓰기 → 기본 품목(활성 품목이 1개일 때만)의 보유 이동으로.
-- 마지막에 캐시를 다시 계산해 행에 싣는다. 캐시 적용 함수의 쓰기는 플래그로 통과한다.
create or replace function private.bridge_goods_stock_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_variant_id uuid;
  v_location_id text;
  v_active_variants integer;
  v_delta integer;
  v_previous_skip text;
  v_totals record;
begin
  if current_setting('icons.stock_cache_write', true) = '1' then
    return new;
  end if;

  if new.stock is distinct from old.stock then
    new.stock_override := case new.stock when 'soldout' then 'soldout' when 'low' then 'low' else 'auto' end;
  end if;

  if new.stock_qty is distinct from old.stock_qty then
    v_delta := new.stock_qty - old.stock_qty;
    select count(*) into v_active_variants
    from public.good_variants as v
    where v.good_id = new.id and v.archived_at is null;
    if v_active_variants <> 1 then
      raise exception 'goods_stock_qty_readonly' using errcode = '55000',
        hint = '품목이 여러 개인 상품의 재고는 품목 단위(admin_adjust_variant_stock)로 조정합니다.';
    end if;
    select v.id, coalesce(v.location_id, new.default_location_id)
      into v_variant_id, v_location_id
    from public.good_variants as v
    where v.good_id = new.id and v.archived_at is null;
    v_previous_skip := current_setting('icons.stock_cache_skip', true);
    perform set_config('icons.stock_cache_skip', '1', true);
    perform private.apply_stock_movement(
      pg_catalog.gen_random_uuid(), v_variant_id, v_location_id, v_delta, 0,
      'legacy_write', 'system', 'goods', new.id, 'goods.stock_qty 직접 쓰기를 기본 품목으로 번역', (select auth.uid())
    );
    perform set_config('icons.stock_cache_skip', coalesce(v_previous_skip, '0'), true);
  end if;

  select * into v_totals from private.good_stock_totals(new.id, new.stock_override);
  new.stock := v_totals.stock;
  new.stock_qty := v_totals.stock_qty;
  return new;
end;
$$;
-- 트리거 이름은 알파벳 순으로 돈다 — 보관 의존성 가드(goods_archive_dependency_guard)보다 먼저 캐시가 맞아야
-- 「재고가 남은 상품 보관 금지」 판정이 번역된 수량을 본다.
create trigger goods_aa_bridge_stock_write before update on public.goods
  for each row execute function private.bridge_goods_stock_write();

-- ---------------------------------------------------------------------------
-- 10. 백필 — 상품마다 기본 품목 1행 · 활성 출고지마다 재고 행 · 기준 이동 기록. 검증: Σ가용 = 옛 stock_qty
-- ---------------------------------------------------------------------------
-- 백필 동안은 캐시를 다시 쓰지 않는다 — 품목 행이 먼저 생기면 재고 0 으로 캐시가 덮여 옛 수량이 사라진다.
select set_config('icons.stock_cache_skip', '1', true);

insert into public.good_variants (id, good_id, code, option_signature, is_default, sort_order)
select pg_catalog.gen_random_uuid(), good.id, good.id || '-01', '', true, 0
from public.goods as good;

insert into public.variant_stocks (variant_id, location_id, on_hand_qty, reserved_qty, safety_qty, last_source, last_movement_at)
select
  variant.id,
  location.id,
  case when location.id = good.default_location_id then good.stock_qty else 0 end,
  0,
  0,
  'migration',
  now()
from public.good_variants as variant
join public.goods as good on good.id = variant.good_id
cross join public.stock_locations as location
where location.active;

update public.goods
set stock_override = case stock when 'soldout' then 'soldout' when 'low' then 'low' else 'auto' end
where stock_override = 'auto' and stock in ('soldout', 'low');

insert into public.stock_movements (
  id, variant_id, location_id, delta_on_hand, on_hand_after, reserved_after, reason_code, source, note
)
select
  pg_catalog.gen_random_uuid(), stock.variant_id, stock.location_id, stock.on_hand_qty, stock.on_hand_qty, 0,
  'migration_baseline', 'system', '이관 기준 재고(옵션 도입 전 상품 수량)'
from public.variant_stocks as stock
where stock.on_hand_qty <> 0;

select set_config('icons.stock_cache_skip', '0', true);

do $$
declare
  v_mismatch integer;
begin
  select count(*) into v_mismatch
  from public.goods as good
  join private.good_stock_totals(good.id, good.stock_override) as totals on true
  where good.stock_qty is distinct from totals.stock_qty or good.stock is distinct from totals.stock;
  if v_mismatch <> 0 then
    raise exception 'stock backfill mismatch: % goods', v_mismatch;
  end if;
end;
$$;
