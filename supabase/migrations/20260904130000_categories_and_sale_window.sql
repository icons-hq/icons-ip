-- D-9 상품 분류 · D-10 판매 기간 · 스키마 보강 ① — 표·컬럼·트리거 (설계서 v2 §1-2, 리서치 보고서 B §5)
--
-- 분류는 인접 리스트(parent_id) + 트리거가 유지하는 path/depth 다. 깊이 4 상한은 카페24 동등.
-- 판매 기간은 상태를 저장하지 않고 조회 시 파생한다 — `now()` 가 immutable 이 아니라 생성 컬럼이 불가하고,
-- 무엇보다 저장하면 "정각에 누가 바꾸는가"라는 배치가 필요해진다. 파생이면 초 단위로 정확하다.
--
-- 롤백: 트리거·인덱스 drop → goods 열 drop → 표 drop(추가 전용이라 앱 롤백만으로 읽기 경로 무손상).

-- ---------------------------------------------------------------------------
-- 1. 분류 트리
-- ---------------------------------------------------------------------------
create table public.categories (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  kind text not null default 'catalog' check (kind in ('catalog', 'collection')),
  parent_id text references public.categories (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (char_length(description) <= 300),
  path text not null,
  depth smallint not null check (depth between 1 and 4),
  position integer not null default 0,
  status text not null default 'active' check (status in ('active', 'hidden')),
  is_internal boolean not null default false,
  display_mode text not null default 'manual' check (display_mode in ('manual', 'auto', 'mixed')),
  auto_sort_key text not null default 'newest'
    check (auto_sort_key in ('newest', 'updated', 'name', 'price_asc', 'price_desc')),
  soldout_last boolean not null default true,
  include_descendants boolean not null default true,
  hero_image_path text,
  seo_title text check (char_length(seo_title) <= 70),
  seo_description text check (char_length(seo_description) <= 160),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 기획전(collection)은 평면이다. 트리는 상품 분류(catalog) 축 하나만 갖는다.
  check (kind = 'catalog' or parent_id is null)
);
comment on table public.categories is '상품 분류 트리(깊이 ≤ 4). path/depth 는 트리거가 유지한다. 유형(goods.type)·버티컬은 속성 축이라 노드로 만들지 않는다.';
comment on column public.categories.position is '형제 안의 순서. 재정렬 RPC 가 0..n-1 로 다시 매긴다 — 유일성을 DB 로 강제하지 않는 이유는 재번호 도중의 중간 충돌을 피하기 위해서다(정렬은 (position, id)로 안정).';

create index categories_parent_position_idx on public.categories (parent_id, position, id);
create index categories_path_idx on public.categories (path text_pattern_ops);
create index categories_kind_idx on public.categories (kind, status) where archived_at is null;

create table public.good_categories (
  good_id text not null references public.goods (id) on delete cascade,
  category_id text not null references public.categories (id) on delete restrict,
  is_primary boolean not null default false,
  position integer not null default 0,
  pinned boolean not null default false,
  display_from timestamptz,
  display_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (good_id, category_id),
  check (display_from is null or display_until is null or display_until > display_from)
);
comment on table public.good_categories is '상품 ↔ 분류. 대표 분류 1개(부분 유일) + 추가 n. 분류별 진열 순서·고정 핀·진열 기간을 이 한 표가 갖는다.';
create unique index good_categories_primary_key on public.good_categories (good_id) where is_primary;
create index good_categories_category_idx on public.good_categories (category_id, pinned desc, position, good_id);

-- 트리 유지: path = 부모 path ⧺ id ⧺ '/', depth = 조각 수. 순환·깊이 초과는 여기서 막는다.
create or replace function private.apply_category_path()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent record;
begin
  if new.parent_id is null then
    new.path := '/' || new.id || '/';
    new.depth := 1;
  else
    if new.parent_id = new.id then
      raise exception 'category_cycle' using errcode = '23514';
    end if;
    select category.path, category.depth into v_parent
    from public.categories as category
    where category.id = new.parent_id;
    if not found then
      raise exception 'category_parent_missing' using errcode = 'P0002';
    end if;
    -- `position(x in y)` 는 구문이라 스키마 한정이 안 된다 — strpos 로 쓴다.
    if pg_catalog.strpos(v_parent.path, '/' || new.id || '/') > 0 then
      raise exception 'category_cycle' using errcode = '23514';
    end if;
    new.path := v_parent.path || new.id || '/';
    new.depth := (v_parent.depth + 1)::smallint;
  end if;

  if new.depth > 4 then
    raise exception 'category_depth_exceeded' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger categories_apply_path before insert or update of parent_id, id on public.categories
  for each row execute function private.apply_category_path();

-- 부모가 옮겨지면 자손의 path/depth 도 따라 옮긴다. 서브트리 최대 깊이가 4를 넘으면 이동 자체를 거부한다.
create or replace function private.reparent_category_descendants()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max_depth smallint;
begin
  if new.path = old.path then
    return null;
  end if;
  select max(descendant.depth) into v_max_depth
  from public.categories as descendant
  where descendant.path like old.path || '%' and descendant.id <> old.id;
  if v_max_depth is not null and (v_max_depth - old.depth + new.depth) > 4 then
    raise exception 'category_depth_exceeded' using errcode = '23514';
  end if;

  update public.categories as descendant
  set path = new.path || pg_catalog.right(descendant.path, -pg_catalog.length(old.path)),
      depth = (descendant.depth - old.depth + new.depth)::smallint
  where descendant.path like old.path || '%'
    and descendant.id <> old.id;
  return null;
end;
$$;
create trigger categories_reparent_descendants after update of parent_id on public.categories
  for each row execute function private.reparent_category_descendants();

create trigger trg_categories_updated before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. 상품 컬럼 — 판매 기간 · 스위치 · 요약/검색어/SEO · 공급가/과세
-- ---------------------------------------------------------------------------
alter table public.goods
  add column hidden_at timestamptz,
  add column stopped_at timestamptz,
  add column sale_starts_at timestamptz,
  add column sale_ends_at timestamptz,
  add column sale_mode text not null default 'regular' check (sale_mode in ('regular', 'preorder')),
  add column preorder_ships_at date,
  add column summary text check (char_length(summary) <= 120),
  add column search_keywords text[] not null default '{}' check (cardinality(search_keywords) <= 50),
  add column search_text text not null default '',
  add column seo_title text check (char_length(seo_title) <= 70),
  add column seo_description text check (char_length(seo_description) <= 160),
  add column image_alt text check (char_length(image_alt) <= 125),
  add column gallery_alts text[],
  add column supply_price integer check (supply_price is null or supply_price >= 0),
  add column tax_type text not null default 'taxable' check (tax_type in ('taxable', 'exempt', 'zero_rated')),
  add constraint goods_sale_window_check
    check (sale_starts_at is null or sale_ends_at is null or sale_ends_at > sale_starts_at),
  add constraint goods_preorder_ship_check
    check (sale_mode <> 'preorder' or preorder_ships_at is not null),
  add constraint goods_gallery_alts_check
    check (gallery_alts is null or cardinality(gallery_alts) = cardinality(gallery_paths));

comment on column public.goods.hidden_at is '진열 안 함 — 목록·검색·상세에서 빠진다. 보안 경계가 아니므로 주문 게이트가 따로 재검사한다.';
comment on column public.goods.stopped_at is '판매 중지 — 보이되 살 수 없다(카페24 판매안함).';
comment on column public.goods.search_text is '검색 원문(트리거 유지) = 이름 ⧺ 검색어 ⧺ 요약. array_to_string 이 immutable 이 아니라 생성 컬럼으로 못 만든다.';

alter table public.goods
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('simple', search_text), 'A')
    || setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) stored;

-- 검색어 정규화(공백 정리·소문자·중복 제거·빈 값 제거)와 검색 원문 유지.
create or replace function private.apply_goods_search_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_keywords := coalesce((
    select pg_catalog.array_agg(distinct keyword order by keyword)
    from pg_catalog.unnest(coalesce(new.search_keywords, '{}'::text[])) as raw(value)
    cross join lateral (select pg_catalog.lower(pg_catalog.btrim(raw.value)) as keyword) as normalized
    where pg_catalog.length(normalized.keyword) between 1 and 40
  ), '{}'::text[]);

  if cardinality(new.search_keywords) > 50 then
    raise exception 'goods_keywords_limit' using errcode = '23514';
  end if;

  new.search_text := pg_catalog.btrim(
    coalesce(new.name, '') || ' '
    || pg_catalog.array_to_string(new.search_keywords, ' ') || ' '
    || coalesce(new.summary, '')
  );
  return new;
end;
$$;
create trigger goods_apply_search_text before insert or update of name, search_keywords, summary on public.goods
  for each row execute function private.apply_goods_search_text();

update public.goods set search_text = btrim(name);

create index goods_sale_window_idx on public.goods (sale_starts_at, sale_ends_at) where archived_at is null;
create index goods_search_tsv_idx on public.goods using gin (search_tsv);
create index goods_search_text_trgm on public.goods using gin (search_text extensions.gin_trgm_ops);
create index goods_hidden_at_idx on public.goods (hidden_at) where hidden_at is null;

-- ---------------------------------------------------------------------------
-- 3. RLS · 권한 — 분류는 공개 읽기(숨김·내부·보관 제외), 쓰기는 RPC 전용
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.good_categories enable row level security;

create policy categories_read on public.categories for select
  using ((archived_at is null and status = 'active' and not is_internal) or (select public.is_staff()));
-- 소속 행 자체는 비밀이 아니다(분류 id 노출은 무해). 숨김 분류의 이름·설명은 categories 정책이 가린다.
create policy good_categories_read on public.good_categories for select using (true);

grant select on public.categories, public.good_categories to anon, authenticated;
revoke insert, update, delete, truncate on public.categories, public.good_categories from anon, authenticated;
