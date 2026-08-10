-- 굿즈 고시정보 (전자상거래 상품정보제공고시) — #171 · 계획 D7
--
-- 자유 텍스트 한 칸도, JSONB key-value 도 아닌 고정 컬럼이다. 라벨 붙은 폼과
-- 필수값 검증이 목적이라 key 를 운영자가 타이핑하게 만들면 안 된다.
--
-- 컬럼 자체는 nullable 로 둔다. 이미 등록된 굿즈 15종이 값을 갖고 있지 않아서
-- not null 을 걸면 마이그레이션이 가짜 값을 backfill 해야 한다. 대신 저장 경로인
-- admin_upsert_good 이 전 항목을 요구한다 — 운영자가 굿즈를 한 번이라도 저장하면
-- 고시정보 없이 지나갈 수 없다.

alter table public.goods
  add column notice_maker      text,   -- 제조사 / 수입사
  add column notice_origin     text,   -- 원산지
  add column notice_material   text,   -- 소재
  add column notice_size       text,   -- 크기 · 중량
  add column notice_made_on    text,   -- 제조연월
  add column notice_as_manager text,   -- A/S 책임자
  add column notice_as_contact text;   -- A/S 연락처

comment on column public.goods.notice_maker is '고시정보 — 제조사 / 수입사';
comment on column public.goods.notice_origin is '고시정보 — 원산지';
comment on column public.goods.notice_material is '고시정보 — 소재';
comment on column public.goods.notice_size is '고시정보 — 크기 · 중량';
comment on column public.goods.notice_made_on is '고시정보 — 제조연월';
comment on column public.goods.notice_as_manager is '고시정보 — A/S 책임자';
comment on column public.goods.notice_as_contact is '고시정보 — A/S 연락처';

-- 파라미터가 늘어나므로 drop 후 create 한다. create or replace 는 오버로드를 만든다.
drop function if exists public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text, text
);

create function public.admin_upsert_good(
  target_id text,
  target_ip_id text,
  target_name text,
  target_type text,
  target_price integer,
  target_badge text,
  target_stock text,
  target_bg text,
  target_image_path text,
  target_notice_maker text,
  target_notice_origin text,
  target_notice_material text,
  target_notice_size text,
  target_notice_made_on text,
  target_notice_as_manager text,
  target_notice_as_contact text,
  target_previous_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
  previous_ip_id text;
  notice_maker text := nullif(btrim(coalesce(target_notice_maker, ''), E' \t\n\r\f\v'), '');
  notice_origin text := nullif(btrim(coalesce(target_notice_origin, ''), E' \t\n\r\f\v'), '');
  notice_material text := nullif(btrim(coalesce(target_notice_material, ''), E' \t\n\r\f\v'), '');
  notice_size text := nullif(btrim(coalesce(target_notice_size, ''), E' \t\n\r\f\v'), '');
  notice_made_on text := nullif(btrim(coalesce(target_notice_made_on, ''), E' \t\n\r\f\v'), '');
  notice_as_manager text := nullif(btrim(coalesce(target_notice_as_manager, ''), E' \t\n\r\f\v'), '');
  notice_as_contact text := nullif(btrim(coalesce(target_notice_as_contact, ''), E' \t\n\r\f\v'), '');
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_id is not null and normalized_previous_id is distinct from target_id then
    raise exception 'catalog_id_immutable' using errcode = '22023';
  end if;

  -- 고시정보 누락은 앱 폼에서도 막지만, RPC 를 직접 부르는 경로에서도 막는다.
  if notice_maker is null
    or notice_origin is null
    or notice_material is null
    or notice_size is null
    or notice_made_on is null
    or notice_as_manager is null
    or notice_as_contact is null
  then
    raise exception 'goods_notice_required' using errcode = '23514';
  end if;

  select ip_id into previous_ip_id from public.goods where id = target_id for update;

  if normalized_previous_id is not null and not found then
    raise exception 'catalog_record_missing' using errcode = 'P0002';
  end if;

  insert into public.goods (
    id,
    ip_id,
    name,
    type,
    price,
    badge,
    stock,
    bg,
    image_path,
    notice_maker,
    notice_origin,
    notice_material,
    notice_size,
    notice_made_on,
    notice_as_manager,
    notice_as_contact
  )
  values (
    target_id,
    target_ip_id,
    target_name,
    target_type,
    target_price,
    target_badge,
    target_stock,
    target_bg,
    target_image_path,
    notice_maker,
    notice_origin,
    notice_material,
    notice_size,
    notice_made_on,
    notice_as_manager,
    notice_as_contact
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id,
    name = excluded.name,
    type = excluded.type,
    price = excluded.price,
    badge = excluded.badge,
    stock = excluded.stock,
    bg = excluded.bg,
    image_path = excluded.image_path,
    notice_maker = excluded.notice_maker,
    notice_origin = excluded.notice_origin,
    notice_material = excluded.notice_material,
    notice_size = excluded.notice_size,
    notice_made_on = excluded.notice_made_on,
    notice_as_manager = excluded.notice_as_manager,
    notice_as_contact = excluded.notice_as_contact,
    updated_at = now()
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  update public.ips
  set goods_count = (
      select count(*)::integer from public.goods where goods.ip_id = ips.id
    ),
    updated_at = now()
  where id in (target_ip_id, previous_ip_id);

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.good.upsert',
    'goods:' || target_id,
    jsonb_build_object(
      'id', target_id,
      'ip_id', target_ip_id,
      'name', target_name,
      'price', target_price,
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );
end;
$$;

revoke all on function public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text,
  text, text, text, text, text, text, text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text,
  text, text, text, text, text, text, text,
  text
) to authenticated;
