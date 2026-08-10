-- 굿즈 상세 콘텐츠 — #172 · 계획 D6
--
-- 상세페이지에 실을 내용물이 없었다. 대표 이미지 1장(image_path)이 전부였다.
--   description        텍스트 설명(단문 서술). 리치 텍스트는 채택하지 않는다 —
--                      운영자 학습비용, XSS 표면, 붙여넣은 HTML 의 테마 파손.
--   gallery_paths      대표 이미지 외 최대 4장. 순서를 가지므로 배열 인덱스가
--                      곧 노출 순서다. 4장 상한과 순서만 있으면 되는 관계에
--                      테이블·RLS·조인을 새로 만들 이유가 없다.
--   detail_image_path  한국 쇼핑몰 관행의 긴 세로 이미지 1장.

alter table public.goods
  add column description       text,
  add column gallery_paths     text[] not null default '{}'::text[],
  add column detail_image_path text;

alter table public.goods
  add constraint goods_gallery_paths_limit
    check (coalesce(array_length(gallery_paths, 1), 0) <= 4),
  -- 빈 슬롯은 배열에서 아예 빼둔다. null·빈 문자열이 섞이면 순서가 곧 노출
  -- 순서라는 규약이 무너진다. (check 제약에는 서브쿼리를 쓸 수 없다)
  add constraint goods_gallery_paths_dense
    check (
      array_position(gallery_paths, null::text) is null
      and not ('' = any (gallery_paths))
    );

comment on column public.goods.description is '굿즈 상세 텍스트 설명';
comment on column public.goods.gallery_paths is '갤러리 이미지 경로. 배열 순서가 노출 순서이며 최대 4장';
comment on column public.goods.detail_image_path is '상세 이미지(긴 세로) 경로';

-- 대표 이미지와 같은 업로드 클레임을 상세·갤러리 이미지에도 강제한다.
-- 이게 없으면 스태프가 검증되지 않은 임의 경로를 굿즈에 붙일 수 있다.
create or replace function public.enforce_admin_goods_content_artwork_claim()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := (select auth.uid());
  old_paths text[] := '{}'::text[];
  new_paths text[] := '{}'::text[];
  candidate text;
  object_path text;
begin
  if tg_op = 'UPDATE' then
    old_paths := coalesce(old.gallery_paths, '{}'::text[])
      || case
           when old.detail_image_path is null then '{}'::text[]
           else array[old.detail_image_path]
         end;
  end if;

  new_paths := coalesce(new.gallery_paths, '{}'::text[])
    || case
         when new.detail_image_path is null then '{}'::text[]
         else array[new.detail_image_path]
       end;

  foreach candidate in array new_paths loop
    -- 이미 붙어 있던 경로는 클레임을 다시 소비하지 않는다.
    continue when candidate = any(old_paths);

    if current_actor_id is null then
      if session_user = 'postgres' then
        continue;
      end if;
      raise exception 'unverified_artwork' using errcode = '23514';
    end if;

    if not public.is_staff()
      or candidate !~ '^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    then
      raise exception 'unverified_artwork' using errcode = '23514';
    end if;

    object_path := substring(candidate from length('public-media/') + 1);

    update public.admin_artwork_upload_claims as claim
    set
      status = 'attached',
      attached_at = clock_timestamp(),
      resolved_at = clock_timestamp()
    where claim.actor_id = current_actor_id
      and claim.path = object_path
      and claim.kind = 'good'
      and claim.status = 'verified'
      and claim.verified_at is not null
      and claim.final_size is not null
      and claim.attached_at is null
      and claim.expires_at > clock_timestamp();

    if not found then
      raise exception 'unverified_artwork' using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.enforce_admin_goods_content_artwork_claim()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_admin_goods_content_artwork_claim on public.goods;
create trigger enforce_admin_goods_content_artwork_claim
after insert or update of gallery_paths, detail_image_path on public.goods
for each row execute function public.enforce_admin_goods_content_artwork_claim();

-- 파라미터가 늘어나므로 drop 후 create 한다.
drop function if exists public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text,
  text, text, text, text, text, text, text,
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
  text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_good(
  text, text, text, text, integer, text, text, text, text,
  text, text, text, text, text, text, text,
  text, text[], text,
  text
) to authenticated;
