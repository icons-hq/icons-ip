-- 긴 상세 이미지 여러 장(2026-11-19 MD 요청: "썸네일처럼 상세 이미지를 여러 장 등록할 수 있게, 잘라서 올리겠다").
--
-- 상세 설명 아래에 원래 비율로 붙는 긴 상세 이미지는 goods.detail_image_path 한 장이었다. 세로 9,000px가 넘는 통이미지를
-- 잘라 여러 장으로 올릴 수 있게 goods.detail_image_paths(순서 = 노출 순서, 최대 10장)를 둔다.
--
-- detail_image_path는 지우지 않고 "첫 장" 거울로 남긴다. 저장·복제·엑셀 반입·그룹상품·사진 참조 등 열 곳이 넘는 함수가
-- 이 칸을 읽고 쓰기 때문이다. BEFORE 트리거(goods_detail_image_paths_sync)가 둘을 맞춘다.
--   - detail_image_paths를 바꾼 쓰기: detail_image_path := 첫 장.
--   - detail_image_path만 바꾼 옛 쓰기(엑셀 반입 커밋·옛 화면): 목록 := [그 한 장](비우면 빈 목록). 한 장만 아는 쓰기가
--     첫 장을 바꾸면 그 상품의 상세 이미지는 그 한 장이다. 엑셀은 여러 장인 상품의 상세 이미지 칸 변경을 미리보기에서 막는다.
--   - 둘 다 그대로면 손대지 않는다(두 장째 이후 보존).
--
-- 바꾸는 곳
--   1. 표: 열·제약·기존 한 장 이전·동기화 트리거.
--   2. 상품 저장 래퍼 층(public.admin_save_good): target_good.detail_image_paths를 받으면 아래 층에는 첫 장을 넘기고,
--      저장 뒤 목록을 쓴다. 키가 없으면(엑셀 반입·옛 화면) 아래 층에 그대로 넘긴다.
--   3. 이미지 소유 검사: 새로 붙는 경로는 검증 claim이 있어야 하고(enforce_admin_goods_content_artwork_claim), 이미 이 상품에
--      붙은 상세 이미지를 대표 이미지로 옮기는 것은 claim 없이 허용한다(enforce_admin_catalog_artwork_claim).
--   4. 사진 보관함 사용처(goods_photo_references), 기본 칸 버전(track_goods_base_revision), 저장 층의 자기 복사 허가
--      (admin_save_good_before_discount_display), 복제·그룹상품 만들기의 이미지 복사, 그룹 공통정보 저장의 복사 허가.
--   5. 서버 임시저장: 상세 이미지 칸 detailImagePath(첫 장)·detailImagePath1…9.
--   6. 업로드 확인 1분 한도 22 → 40: 굿즈 폼 20칸(대표 1 + 추가 9 + 상세 10) × 2(lib/admin/artwork.ts와 같은 값).
--
-- 앵커 치환은 정의에 앵커가 정확히 한 번 있어야 하며, 없으면 migration이 실패한다(재정의 경합을 조용히 덮지 않는다).
begin;

-- --------------------------------------------------------------------------
-- 1. 열·제약·이전·동기화
-- --------------------------------------------------------------------------
alter table public.goods
  add column detail_image_paths text[] not null default '{}'::text[],
  add constraint goods_detail_image_paths_limit check (coalesce(array_length(detail_image_paths, 1), 0) <= 10),
  add constraint goods_detail_image_paths_dense check (
    array_position(detail_image_paths, null::text) is null
    and not ('' = any (detail_image_paths))
  );
comment on column public.goods.detail_image_paths is
  '긴 상세 이미지 경로. 배열 순서가 상세 설명 아래 노출 순서이며 최대 10장. detail_image_path는 첫 장 거울(goods_detail_image_paths_sync)';
comment on column public.goods.detail_image_path is
  '긴 상세 이미지 첫 장(detail_image_paths[1] 거울). 한 장만 아는 옛 쓰기는 이 칸을 쓰고 트리거가 목록을 맞춘다';

create function private.sync_goods_detail_image_paths() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if pg_catalog.cardinality(new.detail_image_paths) = 0 and new.detail_image_path is not null then
      new.detail_image_paths := array[new.detail_image_path];
    else
      new.detail_image_path := new.detail_image_paths[1];
    end if;
  elsif new.detail_image_paths is distinct from old.detail_image_paths then
    new.detail_image_path := new.detail_image_paths[1];
  elsif new.detail_image_path is distinct from old.detail_image_path then
    new.detail_image_paths := case when new.detail_image_path is null then '{}'::text[] else array[new.detail_image_path] end;
  end if;
  return new;
end $$;
revoke all on function private.sync_goods_detail_image_paths() from public, anon, authenticated, service_role;
-- 이름 순으로 다른 BEFORE 트리거(기본 칸 버전 zzz_goods_base_revision 포함)보다 먼저 돌아, 그들이 맞춘 두 칸을 보게 한다.
create trigger goods_detail_image_paths_sync
  before insert or update of detail_image_path, detail_image_paths on public.goods
  for each row execute function private.sync_goods_detail_image_paths();

-- 기존 한 장을 목록으로 옮긴다. 트리거가 아니라 직접 쓴다(updated_at·기본 칸 버전은 트리거가 다룬다 — 아래에서 잠시 끈다).
alter table public.goods disable trigger zzz_goods_base_revision;
alter table public.goods disable trigger trg_goods_updated;
update public.goods set detail_image_paths = array[detail_image_path]
  where detail_image_path is not null and pg_catalog.cardinality(detail_image_paths) = 0;
alter table public.goods enable trigger trg_goods_updated;
alter table public.goods enable trigger zzz_goods_base_revision;

-- 앵커 치환 도구(이 migration 안에서만 쓰고 끝에서 지운다).
create function private.detail_images_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 'detail images patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- --------------------------------------------------------------------------
-- 2. 상품 저장 래퍼 층
-- --------------------------------------------------------------------------
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_detail_images;
revoke all on function private.admin_save_good_before_detail_images(jsonb) from public, anon, authenticated, service_role;

create function public.admin_save_good(target_good jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  previous public.goods;
  paths text[];
  saved jsonb;
  saved_id text;
begin
  perform private.require_operator_capability('catalog.manage', false);
  if pg_catalog.jsonb_typeof(target_good) is distinct from 'object' then
    raise invalid_parameter_value using message = 'invalid_good';
  end if;
  -- 목록을 보내지 않는 저장(엑셀 반입·옛 화면)은 한 장 칸만 쓴다. 동기화 트리거가 목록을 맞춘다.
  if not target_good ? 'detail_image_paths' then
    return private.admin_save_good_before_detail_images(target_good);
  end if;

  if pg_catalog.jsonb_typeof(target_good->'detail_image_paths') is distinct from 'array'
    or pg_catalog.jsonb_array_length(target_good->'detail_image_paths') > 10
    or exists(select 1 from pg_catalog.jsonb_array_elements(target_good->'detail_image_paths') item
      where pg_catalog.jsonb_typeof(item) <> 'string' or pg_catalog.btrim(item #>> '{}') = '') then
    raise check_violation using message = 'goods_detail_images';
  end if;
  select coalesce(pg_catalog.array_agg(item.value order by item.position), '{}'::text[]) into paths
    from pg_catalog.jsonb_array_elements_text(target_good->'detail_image_paths') with ordinality as item(value, position);
  -- 한 장 칸을 함께 보내면 첫 장과 같아야 한다(두 값이 다르면 어느 쪽이 의도인지 알 수 없다).
  if target_good ? 'detail_image_path' and (target_good->>'detail_image_path') is distinct from paths[1] then
    raise check_violation using message = 'goods_detail_images';
  end if;

  -- 위임 저장과 같은 잠금 순서(카테고리 트리 → 상품 행).
  perform private.lock_catalog_category_tree();
  if nullif(target_good->>'previous_id', '') is not null then
    select * into previous from public.goods where id = target_good->>'previous_id' for update;
  end if;

  saved := private.admin_save_good_before_detail_images(
    (target_good - 'detail_image_paths') || pg_catalog.jsonb_build_object('detail_image_path', paths[1]));
  saved_id := saved->>'id';

  -- 아래 층이 첫 장을 바꾸면 트리거가 목록을 그 한 장으로 줄인다. 이 상품에 이미 붙어 있던(검증 claim을 이미 쓴) 경로는
  -- 목록에 다시 넣어도 claim을 다시 요구하지 않게, 잠근 이전 행의 경로만 이 트랜잭션 동안 허가한다.
  if previous.id is not null then
    insert into private.goods_artwork_copy_authorizations(transaction_id, target_good_id, source_good_id, actor_id, allowed_paths)
      values(pg_catalog.txid_current(), saved_id, saved_id, v_actor_id,
        array_remove(array[previous.image_path, previous.detail_image_path]
          || coalesce(previous.detail_image_paths, '{}') || coalesce(previous.gallery_paths, '{}')
          || coalesce(previous.description_image_paths, '{}'), null))
      on conflict (transaction_id, target_good_id) do nothing;
  end if;
  update public.goods set detail_image_paths = paths where id = saved_id and detail_image_paths is distinct from paths;
  if previous.id is not null then
    delete from private.goods_artwork_copy_authorizations permission
      where permission.transaction_id = pg_catalog.txid_current() and permission.target_good_id = saved_id
        and permission.source_good_id = saved_id and permission.actor_id = v_actor_id;
  end if;

  if coalesce(previous.detail_image_paths, '{}'::text[]) is distinct from paths then
    insert into public.audit_log(actor_id, action, target, diff)
      values(v_actor_id, 'admin.good.detail_images_saved', 'goods:' || saved_id,
        pg_catalog.jsonb_build_object('before', coalesce(previous.detail_image_paths, '{}'::text[]), 'after', paths));
  end if;
  return saved;
end $function$;
alter function public.admin_save_good(jsonb) owner to postgres;
revoke all on function public.admin_save_good(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_good(jsonb)'::regprocedure, 'catalog.manage', 'write', false);
select private.register_operator_internal_contract('private.admin_save_good_before_detail_images(jsonb)'::regprocedure);

-- --------------------------------------------------------------------------
-- 3. 이미지 소유 검사
-- --------------------------------------------------------------------------
-- 전문을 다시 쓰지 않는다. 임시저장 migration(20261020085201)이 덧붙인 "내 임시저장 이미지 재사용" 예외 같은 뒤 패치를 지우지 않게,
-- 현재 정의의 기존·새 경로 목록에만 detail_image_paths를 더한다.
select private.detail_images_patch_function('public.enforce_admin_goods_content_artwork_claim()'::regprocedure, array[
$a$array[old.image_path,old.detail_image_path]$a$,
$a$array[old.image_path,old.detail_image_path] || coalesce(old.detail_image_paths,'{}')$a$,
$a$array_remove(array[new.detail_image_path]$a$,
$a$array_remove(array[new.detail_image_path] || coalesce(new.detail_image_paths,'{}')$a$
]);
revoke all on function public.enforce_admin_goods_content_artwork_claim() from public,anon,authenticated,service_role;
drop trigger enforce_admin_goods_content_artwork_claim on public.goods;
create trigger enforce_admin_goods_content_artwork_claim
  after insert or update of gallery_paths,detail_image_path,detail_image_paths,description_image_paths on public.goods
  for each row execute function public.enforce_admin_goods_content_artwork_claim();

select private.detail_images_patch_function('public.enforce_admin_catalog_artwork_claim()'::regprocedure, array[
$a$array_remove(array[old.detail_image_path]||coalesce(old.gallery_paths,'{}')$a$,
$a$array_remove(array[old.detail_image_path]||coalesce(old.detail_image_paths,'{}')||coalesce(old.gallery_paths,'{}')$a$
]);

-- --------------------------------------------------------------------------
-- 4. 사진 사용처·기본 칸 버전·자기 복사 허가·복제·그룹상품·그룹 공통정보
-- --------------------------------------------------------------------------
select private.detail_images_patch_function('private.goods_photo_references(text)'::regprocedure, array[
$a$array_remove(array[g.image_path,g.detail_image_path]||coalesce(g.gallery_paths,'{}'::text[])$a$,
$a$array_remove(array[g.image_path,g.detail_image_path]||coalesce(g.detail_image_paths,'{}'::text[])||coalesce(g.gallery_paths,'{}'::text[])$a$
]);

select private.detail_images_patch_function('private.track_goods_base_revision()'::regprocedure, array[
$a$new.image_path, new.gallery_paths, new.detail_image_path,$a$,
$a$new.image_path, new.gallery_paths, new.detail_image_path, new.detail_image_paths,$a$,
$a$old.image_path, old.gallery_paths, old.detail_image_path,$a$,
$a$old.image_path, old.gallery_paths, old.detail_image_path, old.detail_image_paths,$a$
]);

select private.detail_images_patch_function('private.admin_save_good_before_discount_display(jsonb)'::regprocedure, array[
$a$array_remove(array[previous_good.image_path,previous_good.detail_image_path]$a$,
$a$array_remove(array[previous_good.image_path,previous_good.detail_image_path] || coalesce(previous_good.detail_image_paths,'{}')$a$
]);

select private.detail_images_patch_function('private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure, array[
$a$array_remove(array[source_good.image_path,source_good.detail_image_path]||coalesce(source_good.gallery_paths,'{}')$a$,
$a$array_remove(array[source_good.image_path,source_good.detail_image_path]||coalesce(source_good.detail_image_paths,'{}')||coalesce(source_good.gallery_paths,'{}')$a$,
$a$detail_image_path=source_good.detail_image_path,description_image_paths=$a$,
$a$detail_image_path=source_good.detail_image_path,detail_image_paths=source_good.detail_image_paths,description_image_paths=$a$,
$a$'detailImagePath',source_good.detail_image_path,$a$,
$a$'detailImagePath',source_good.detail_image_path,'detailImagePaths',source_good.detail_image_paths,$a$
]);

select private.detail_images_patch_function('private.create_goods_group_product(text,uuid,text,uuid)'::regprocedure, array[
$a$array_remove(array[source_good.image_path,source_good.detail_image_path]||coalesce(source_good.gallery_paths,'{}')$a$,
$a$array_remove(array[source_good.image_path,source_good.detail_image_path]||coalesce(source_good.detail_image_paths,'{}')||coalesce(source_good.gallery_paths,'{}')$a$,
$a$detail_image_path=source_good.detail_image_path,description_image_paths=$a$,
$a$detail_image_path=source_good.detail_image_path,detail_image_paths=source_good.detail_image_paths,description_image_paths=$a$
]);

select private.detail_images_patch_function('public.admin_save_goods_group_common(uuid,bigint,jsonb,uuid,uuid,uuid)'::regprocedure, array[
$a$array_remove(array[item.image_path,item.detail_image_path]||coalesce(item.gallery_paths,'{}')$a$,
$a$array_remove(array[item.image_path,item.detail_image_path]||coalesce(item.detail_image_paths,'{}')||coalesce(item.gallery_paths,'{}')$a$
]);

-- --------------------------------------------------------------------------
-- 5. 서버 임시저장: 상세 이미지 칸(detailImagePath = 첫 장, detailImagePath1…9)
-- --------------------------------------------------------------------------
select private.detail_images_patch_function('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure, array[
$a$'galleryPath0','galleryPath1','galleryPath2','galleryPath3','galleryPath4','galleryPath5','galleryPath6','galleryPath7','galleryPath8'];$a$,
$a$'galleryPath0','galleryPath1','galleryPath2','galleryPath3','galleryPath4','galleryPath5','galleryPath6','galleryPath7','galleryPath8',
    'detailImagePath1','detailImagePath2','detailImagePath3','detailImagePath4','detailImagePath5','detailImagePath6','detailImagePath7','detailImagePath8','detailImagePath9'];$a$,
$a$(e.key in ('imagePath','detailImagePath','descriptionUploadPath') or e.key like 'galleryPath%')$a$,
$a$(e.key in ('imagePath','detailImagePath','descriptionUploadPath') or e.key like 'galleryPath%' or e.key like 'detailImagePath%')$a$
]);

-- --------------------------------------------------------------------------
-- 6. 업로드 확인 1분 한도 22 → 40(굿즈 폼 20칸 × 2)
-- --------------------------------------------------------------------------
select private.detail_images_patch_function('public.service_begin_admin_artwork_verification(uuid,text)'::regprocedure, array[
$a$굿즈 폼 11칸(대표 1 + 추가 이미지 9 + 상세 1)$a$,
$a$굿즈 폼 20칸(대표 1 + 추가 이미지 9 + 긴 상세 이미지 10)$a$,
$a$interval '1 minute'
  ) >= 22 then$a$,
$a$interval '1 minute'
  ) >= 40 then$a$
]);

select private.detail_images_patch_function('public.service_admin_artwork_upload_block_reason(uuid,text)'::regprocedure, array[
$a$) >= 22 then 'verification_rate_limited'$a$,
$a$) >= 40 then 'verification_rate_limited'$a$
]);

-- 운영자 계약 지문: 다시 정의한 함수는 기존 분류 그대로 다시 등록한다.
do $$
declare fn regprocedure; contract private.operator_rpc_contracts;
begin
  foreach fn in array array[
    'public.enforce_admin_catalog_artwork_claim()'::regprocedure,
    'public.enforce_admin_goods_content_artwork_claim()'::regprocedure,
    'private.goods_photo_references(text)'::regprocedure,
    'private.track_goods_base_revision()'::regprocedure,
    'private.admin_save_good_before_discount_display(jsonb)'::regprocedure,
    'private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure,
    'private.create_goods_group_product(text,uuid,text,uuid)'::regprocedure,
    'public.admin_save_goods_group_common(uuid,bigint,jsonb,uuid,uuid,uuid)'::regprocedure,
    'public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure,
    'public.service_begin_admin_artwork_verification(uuid,text)'::regprocedure,
    'public.service_admin_artwork_upload_block_reason(uuid,text)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.detail_images_patch_function(regprocedure, text[]);

commit;
