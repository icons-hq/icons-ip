-- S4 commerce core (#326) migration ②: goods 할인 표기·분류 표준화.
--
-- 1) compare_at_price — "판매가(price)=현재가, 정가(compare_at_price)=취소선" 모델.
--    할인 중일 때만 값을 갖고, 할인이 아니면 null이 규약이다. 그래서 값이 있으면
--    반드시 price보다 커야 한다(0%·음수 할인율 방지 — 앱 PriceBlock과 같은 규칙).
-- 2) badge 값 표준화 — 자유 문자열(신상/한정/예약)을 NEW/EXCLUSIVE 2종으로 좁힌다.
--    SALE 배지는 저장하지 않는다: compare_at_price 존재에서 파생해야 모순(할인 없는
--    SALE 배지)이 생길 수 없다. '예약'은 표준 축에 없어 배지 없음으로 접는다.
-- 3) type 값 표준화 — 자유 문자열이라 필터 축으로 못 쓰던 것을 8종 카테고리로
--    정리하고 CHECK로 봉인한다(분류 마스터 테이블 없이 값 표준화로 시작 — #326
--    승인 기본값). 프로덕션 distinct 실측(2026-08-28)이 시드와 동일한 11종뿐임을
--    확인하고 매핑을 전량 커버로 작성했다. 미지의 값이 있으면 CHECK 추가가
--    실패한다 — 조용한 데이터 소실보다 마이그레이션 실패가 낫다.

alter table public.goods
  add column compare_at_price integer,
  add constraint goods_compare_at_price_above_price
    check (compare_at_price is null or compare_at_price > price);

update public.goods
set badge = case badge
  when '신상' then 'NEW'
  when '한정' then 'EXCLUSIVE'
  when '예약' then null
  else badge
end
where badge is not null;

alter table public.goods
  add constraint goods_badge_check
    check (badge is null or badge in ('NEW', 'EXCLUSIVE'));

update public.goods
set type = case type
  when '봉제인형' then '인형'
  when '아크릴 키링' then '키링'
  when '아크릴 스탠드' then '아크릴'
  when '아크릴 블록' then '아크릴'
  when '한정 세트' then '세트'
  else type
end;

alter table public.goods
  add constraint goods_type_check
    check (type in ('피규어', '인형', '키링', '아크릴', '문구', '쿠션', '파우치', '세트'));

-- admin_upsert_good 에 compare_at_price 를 추가한다.
-- create or replace 는 인자 목록이 다르면 오버로드를 만들므로 drop 후 재생성한다
-- (20260807100002 의 주의문과 동일). 새 인자는 default 를 갖고 맨 끝에 두어
-- 기존 positional 호출(SQL 스모크 3곳)이 그대로 성립한다.
drop function if exists public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text,
  text, text, text, text, text, text, text,
  text, text[], text,
  text
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
  target_description text,
  target_gallery_paths text[],
  target_detail_image_path text,
  target_previous_id text default null,
  target_compare_at_price integer default null
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
  gallery_paths text[] := coalesce(target_gallery_paths, '{}'::text[]);
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

  if coalesce(array_length(gallery_paths, 1), 0) > 4 then
    raise exception 'goods_gallery_limit' using errcode = '23514';
  end if;

  -- 정가는 할인 표기 전용이다 — 판매가 이하의 정가는 CHECK 에 맡기지 않고
  -- 여기서 도메인 이름을 가진 에러로 먼저 거른다.
  if target_compare_at_price is not null and target_compare_at_price <= target_price then
    raise exception 'goods_compare_at_price_invalid' using errcode = '23514';
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
    compare_at_price,
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
    notice_as_contact,
    description,
    gallery_paths,
    detail_image_path
  )
  values (
    target_id,
    target_ip_id,
    target_name,
    target_type,
    target_price,
    target_compare_at_price,
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
    notice_as_contact,
    nullif(btrim(coalesce(target_description, ''), E' \t\n\r\f\v'), ''),
    gallery_paths,
    nullif(btrim(coalesce(target_detail_image_path, ''), E' \t\n\r\f\v'), '')
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id,
    name = excluded.name,
    type = excluded.type,
    price = excluded.price,
    compare_at_price = excluded.compare_at_price,
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
    description = excluded.description,
    gallery_paths = excluded.gallery_paths,
    detail_image_path = excluded.detail_image_path,
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
      'compare_at_price', target_compare_at_price,
      'gallery_count', coalesce(array_length(gallery_paths, 1), 0),
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );
end;
$$;

revoke all on function public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text,
  text, text, text, text, text, text, text,
  text, text[], text,
  text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text,
  text, text, text, text, text, text, text,
  text, text[], text,
  text, integer
) to authenticated;
