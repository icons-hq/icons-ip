-- 2026-10-07 MD 피드백 ⑤ 보완: 추가 이미지(gallery_paths) 상한을 4장에서 9장으로 늘린다.
-- 스마트스토어와 같은 대표 이미지 1장 + 추가 이미지 최대 9장이다. 앱 상수
-- `GOODS_GALLERY_MAX`(lib/admin/catalog.ts)와 같은 값이어야 한다.
--
-- 4장을 가정한 곳은 네 군데다.
--   1. 표 제약 goods_gallery_paths_limit(20260807100002) — 같은 이름으로 다시 만든다.
--      goods_gallery_paths_dense(빈 값·null 금지)는 그대로 둔다.
--   2. public.admin_upsert_good 의 goods_gallery_limit 검사. 최신 정의(20260908031346)를
--      그대로 다시 적고 상한 숫자만 바꾼다. 상위 래퍼 admin_save_good·엑셀 반입 커밋은
--      이 함수를 거치므로 따로 고치지 않는다.
--   3·4. 아트워크 업로드 예산(service_prepare_admin_artwork_upload 동시 업로드 12,
--      service_begin_admin_artwork_verification 1분 창 12) — 굿즈 폼 칸 수에서 나온 값이라
--      같이 맞춘다(아래 설명).
-- 기존 행은 모두 4장 이하라 새 제약 검증을 통과한다.

alter table public.goods drop constraint goods_gallery_paths_limit;
alter table public.goods
  add constraint goods_gallery_paths_limit
    check (coalesce(array_length(gallery_paths, 1), 0) <= 9);

create or replace function public.admin_upsert_good(
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
  target_compare_at_price integer default null,
  target_publish boolean default null
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

  if nullif(btrim(target_name),'') is null then raise check_violation using message='goods_name_required'; end if;

  -- 고시정보 누락은 앱 폼에서도 막지만, RPC 를 직접 부르는 경로에서도 막는다.
  if (target_publish is true or exists(select 1 from public.goods where id=target_id and published_at is not null)) and (notice_maker is null
    or notice_origin is null
    or notice_material is null
    or notice_size is null
    or notice_made_on is null
    or notice_as_manager is null
    or notice_as_contact is null)
  then
    raise exception 'goods_notice_required' using errcode = '23514';
  end if;

  if coalesce(array_length(gallery_paths, 1), 0) > 9 then
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
    coalesce(target_type,''),
    coalesce(target_price,0),
    target_compare_at_price,
    target_badge,
    coalesce(target_stock,'ok'),
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

  if target_publish is not null then perform private.set_good_published(target_id,target_publish); end if;

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

revoke all on function public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean) to authenticated;

-- 아트워크 업로드 예산도 굿즈 폼 칸 수에서 나온다. 20260807140005·20260807150002 는
-- "대표 1 + 갤러리 4 + 상세 1 = 6칸을 한 번 채우고 한 번 갈아끼우기 = 12"로 잡았다.
-- 추가 이미지가 9장이면 폼은 대표 1 + 추가 9 + 상세 1 = 11칸이므로 같은 근거로 22다.
-- 12에 그대로 두면 MD가 추가 이미지 9장을 한 번에 고른 뒤 두어 장을 바로 바꿀 때
-- 1분 창에 걸려 파일에 문제가 없는데도 "이미지 파일을 확인하지 못했습니다"가 다시 뜬다
-- (20260807150002 가 고친 증상). 동시 processing 1개 직렬화와 저장 대기 승격본
-- 상한 60은 칸 수와 무관하므로 그대로 둔다. 두 함수 모두 최신 정의를 그대로 다시 적고
-- 숫자 12와 그 주석만 바꾼다.

create or replace function public.service_prepare_admin_artwork_upload(
  p_actor_id uuid,
  p_path text,
  p_kind text,
  p_mime_type text,
  p_source_size integer,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null
    or p_path is null
    or p_kind is null
    or p_kind not in ('ip', 'good', 'card', 'event', 'curation')
    or p_mime_type is null
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_source_size is null
    or p_source_size < 1
    or p_source_size > 5 * 1024 * 1024
    or p_expires_at is null
    or p_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at > pg_catalog.clock_timestamp() + interval '15 minutes'
    or p_path !~ '^catalog/(ip|good|card|event|curation)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    or p_path not like 'catalog/' || p_kind || '/%'
    or not (
      (p_mime_type = 'image/jpeg' and p_path like '%.jpg')
      or (p_mime_type = 'image/png' and p_path like '%.png')
      or (p_mime_type = 'image/webp' and p_path like '%.webp')
    )
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-artwork-upload:' || p_actor_id::text, 0)
  );

  -- staging 에 동시에 쓰고 있는 업로드. 가장 큰 폼(굿즈 11칸: 대표 1 + 추가 이미지 9 + 상세 1)을
  -- 한 번 채우고 한 번 갈아끼울 수 있어야 한다.
  if (
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status in ('pending', 'processing')
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) >= 22 then
    return false;
  end if;

  -- 저장을 기다리는 승격본. 폼을 몇 장 열어둬도 걸리지 않되 무한히 쌓이지는 않는다.
  if (
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status = 'verified'
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) >= 60 then
    return false;
  end if;

  insert into public.admin_artwork_upload_claims (
    path, actor_id, kind, mime_type, source_size, expires_at
  )
  values (
    p_path, p_actor_id, p_kind, p_mime_type, p_source_size, p_expires_at
  )
  on conflict (path) do nothing;

  return found;
end;
$$;

revoke all on function public.service_prepare_admin_artwork_upload(
  uuid, text, text, text, integer, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.service_prepare_admin_artwork_upload(
  uuid, text, text, text, integer, timestamptz
) to service_role;

create or replace function public.service_begin_admin_artwork_verification(
  p_actor_id uuid,
  p_path text
)
returns table (
  kind text,
  mime_type text,
  source_size integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null
    or p_path is null
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-artwork-upload:' || p_actor_id::text, 0)
  );

  -- actor 별 동시 processing 은 1개다. 이 직렬화는 그대로 유지한다.
  if exists (
    select 1
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status = 'processing'
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) or (
    -- 남용 억제 창. 굿즈 폼 11칸(대표 1 + 추가 이미지 9 + 상세 1)을 채우고 한 번 갈아끼울 수 있어야 한다.
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.processing_started_at >= pg_catalog.clock_timestamp() - interval '1 minute'
  ) >= 22 then
    return;
  end if;

  return query
  update public.admin_artwork_upload_claims as claim
  set
    status = 'processing',
    processing_started_at = pg_catalog.clock_timestamp()
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status = 'pending'
    and claim.expires_at > pg_catalog.clock_timestamp()
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = claim.actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  returning claim.kind, claim.mime_type, claim.source_size;
end;
$$;

revoke all on function public.service_begin_admin_artwork_verification(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_begin_admin_artwork_verification(uuid, text)
  to service_role;
