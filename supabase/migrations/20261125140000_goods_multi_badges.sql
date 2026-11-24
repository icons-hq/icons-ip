-- 상품 표시문구 여러 개(2026-11-23 MD 요청: "상품에 다는 뱃지가 지금은 1개씩 밖에 적용이 안되는데 여러 개 적용 가능하게").
--
-- 상품 표시문구는 goods.badge 한 칸(NEW·EXCLUSIVE 중 하나)이었다. 여러 개를 고른 순서대로 카드·상세에 보이도록
-- goods.badges(순서 = 노출 순서, 같은 값 한 번)를 둔다. 고를 수 있는 값은 그대로 NEW·EXCLUSIVE다.
--
-- badge는 지우지 않고 "첫 값" 거울로 남긴다. 저장 최하층(admin_upsert_good 위치 인자)·복제·그룹상품 만들기·옛 엑셀 작업처럼
-- 한 칸만 아는 쓰기가 여럿이기 때문이다. BEFORE 트리거(goods_badges_sync)가 둘을 맞춘다.
--   - badges를 바꾼 쓰기: badge := 첫 값.
--   - badge만 바꾼 옛 쓰기: 목록 := [그 한 값](비우면 빈 목록). 한 값만 아는 쓰기가 첫 값을 바꾸면 그 상품의 표시문구는 그 하나다.
--   - 둘 다 그대로면 손대지 않는다(둘째 값 이후 보존).
--
-- 바꾸는 곳
--   1. 표: 열·허용 값 제약·기존 한 값 이전·동기화 트리거(같은 값 두 번 거절).
--   2. 기본 칸 버전(track_goods_base_revision): 둘째 값만 바꾼 저장도 버전을 올린다(옛 화면이 되돌리지 않게). 정의 전체를 다시 쓴다.
--   3. 상품 저장 래퍼 층(public.admin_save_good): target_good.badges를 받으면 아래 층에는 첫 값을 넘기고 저장 뒤 목록을 쓴다.
--      키가 없으면(옛 화면·배포 전에 검증한 엑셀 작업) 아래 층에 그대로 넘긴다.
--   4. 복제(public.admin_clone_good, 정의 전체)·옵션 분리 그룹상품 만들기(private.create_goods_group_product 래퍼 층)가 목록 전체를 복사한다.
--   5. 공개·어드민 투영에 badges를 싣는다: 카테고리 전시(category_display_public_good), 쇼핑스토리(get_shopping_story·
--      shopping_story_admin_good), 통합 검색의 표시문구 일치(search_public_content)는 모든 값을 본다.
--      이 넷은 읽기 투영이라 병렬 작업(공개 상품 주소 등)이 같은 함수를 고쳐도 겹치지 않게 앵커 한 곳만 바꾼다 — 앵커가 정확히
--      한 번 있어야 하며, 없으면 migration이 실패한다(재정의 경합을 조용히 덮지 않는다).
--
-- 서버 임시저장(admin_save_goods_draft)은 바꾸지 않는다. 화면은 같은 'badge' 칸에 고른 순서를 쉼표로 이어 담는다(문자열 칸 그대로).
begin;

-- --------------------------------------------------------------------------
-- 1. 열·제약·이전·동기화
-- --------------------------------------------------------------------------
alter table public.goods
  add column badges text[] not null default '{}'::text[],
  -- <@는 NULL 원소를 포함으로 보지 않으므로 NULL도 여기서 걸러진다. 허용 값은 goods_badge_check(첫 값 거울)와 같다.
  add constraint goods_badges_allowed check (
    badges <@ array['NEW', 'EXCLUSIVE']::text[]
    and coalesce(pg_catalog.array_ndims(badges), 1) = 1
  );
comment on column public.goods.badges is
  '상품 표시문구(NEW·EXCLUSIVE). 배열 순서가 카드·상세 노출 순서이고 같은 값은 한 번만. badge는 첫 값 거울(goods_badges_sync)';
comment on column public.goods.badge is
  '상품 표시문구 첫 값(badges[1] 거울). 한 값만 아는 옛 쓰기는 이 칸을 쓰고 트리거가 목록을 맞춘다';

create function private.sync_goods_badges() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if pg_catalog.cardinality(new.badges) = 0 and new.badge is not null then
      new.badges := array[new.badge];
    else
      new.badge := new.badges[1];
    end if;
  elsif new.badges is distinct from old.badges then
    new.badge := new.badges[1];
  elsif new.badge is distinct from old.badge then
    new.badges := case when new.badge is null then '{}'::text[] else array[new.badge] end;
  end if;
  -- 같은 표시문구를 두 번 달지 않는다(카드 칩이 겹친다). 허용 값·NULL은 표 제약(goods_badges_allowed)이 거른다.
  if exists(select 1 from pg_catalog.unnest(new.badges) as item(value) group by item.value having pg_catalog.count(*) > 1) then
    raise check_violation using message = 'goods_badges_duplicate';
  end if;
  return new;
end $$;
revoke all on function private.sync_goods_badges() from public, anon, authenticated, service_role;
-- 이름 순으로 기본 칸 버전(zzz_goods_base_revision)·상품번호 발급(zz_goods_assign_product_no)보다 먼저 돌아, 그들이 맞춘 두 칸을 보게 한다.
create trigger goods_badges_sync
  before insert or update of badge, badges on public.goods
  for each row execute function private.sync_goods_badges();

-- 기존 한 값을 목록으로 옮긴다(updated_at·기본 칸 버전은 그대로 둔다 — 값이 바뀐 것이 아니다).
alter table public.goods disable trigger zzz_goods_base_revision;
alter table public.goods disable trigger trg_goods_updated;
update public.goods set badges = array[badge]
  where badge is not null and pg_catalog.cardinality(badges) = 0;
alter table public.goods enable trigger trg_goods_updated;
alter table public.goods enable trigger zzz_goods_base_revision;

-- --------------------------------------------------------------------------
-- 2. 기본 칸 버전: badges를 감시 칸에 더한다. 현재 정의 = 20261118155000 원문 + 20261119170100(긴 상세 이미지 목록).
-- --------------------------------------------------------------------------
create or replace function private.track_goods_base_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.base_revision is distinct from old.base_revision
    or (new.id, new.ip_id, new.name, new.price, new.compare_at_price, new.show_discount_rate, new.badge, new.badges, new.stock, new.bg,
        new.image_path, new.gallery_paths, new.detail_image_path, new.detail_image_paths,
        new.notice_maker, new.notice_origin, new.notice_material, new.notice_size, new.notice_made_on,
        new.notice_as_manager, new.notice_as_contact,
        new.description, new.description_format, new.description_image_paths,
        new.code, new.name_en, new.search_keywords, new.display_order, new.category_id,
        new.origin_id, new.shipping_fee_type, new.individual_fee,
        new.shipping_notice_template_id, new.shipping_notice_template_version,
        new.order_quantity_limit_enabled, new.min_order_qty, new.max_order_qty,
        new.member_purchase_limit_enabled, new.member_lifetime_qty_limit,
        new.claim_return_allowed, new.claim_exchange_allowed, new.claim_restriction_reason,
        new.claim_return_fee, new.claim_return_free_shipping_fee, new.claim_exchange_fee, new.return_address_id,
        new.allow_card_payment, new.allow_bank_transfer, new.sale_restriction)
      is distinct from
       (old.id, old.ip_id, old.name, old.price, old.compare_at_price, old.show_discount_rate, old.badge, old.badges, old.stock, old.bg,
        old.image_path, old.gallery_paths, old.detail_image_path, old.detail_image_paths,
        old.notice_maker, old.notice_origin, old.notice_material, old.notice_size, old.notice_made_on,
        old.notice_as_manager, old.notice_as_contact,
        old.description, old.description_format, old.description_image_paths,
        old.code, old.name_en, old.search_keywords, old.display_order, old.category_id,
        old.origin_id, old.shipping_fee_type, old.individual_fee,
        old.shipping_notice_template_id, old.shipping_notice_template_version,
        old.order_quantity_limit_enabled, old.min_order_qty, old.max_order_qty,
        old.member_purchase_limit_enabled, old.member_lifetime_qty_limit,
        old.claim_return_allowed, old.claim_exchange_allowed, old.claim_restriction_reason,
        old.claim_return_fee, old.claim_return_free_shipping_fee, old.claim_exchange_fee, old.return_address_id,
        old.allow_card_payment, old.allow_bank_transfer, old.sale_restriction) then
    new.base_revision := old.base_revision + 1;
  end if;
  return new;
end $$;
revoke all on function private.track_goods_base_revision() from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 3. 상품 저장 래퍼 층
-- --------------------------------------------------------------------------
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_badges;
revoke all on function private.admin_save_good_before_badges(jsonb) from public, anon, authenticated, service_role;

create function public.admin_save_good(target_good jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  previous public.goods;
  v_badges text[];
  saved jsonb;
  saved_id text;
begin
  perform private.require_operator_capability('catalog.manage', false);
  if pg_catalog.jsonb_typeof(target_good) is distinct from 'object' then
    raise invalid_parameter_value using message = 'invalid_good';
  end if;
  -- 목록을 보내지 않는 저장(옛 화면·배포 전에 검증한 엑셀 작업)은 첫 값 칸만 쓴다. 동기화 트리거가 목록을 맞춘다.
  if not target_good ? 'badges' then
    return private.admin_save_good_before_badges(target_good);
  end if;

  -- 모양만 본다. 허용 값은 표 제약(goods_badges_allowed·goods_badge_check), 같은 값 두 번은 동기화 트리거가 거절한다.
  if pg_catalog.jsonb_typeof(target_good->'badges') is distinct from 'array'
    or exists(select 1 from pg_catalog.jsonb_array_elements(target_good->'badges') item
      where pg_catalog.jsonb_typeof(item) is distinct from 'string') then
    raise check_violation using message = 'goods_badges_invalid';
  end if;
  select coalesce(pg_catalog.array_agg(item.value order by item.position), '{}'::text[]) into v_badges
    from pg_catalog.jsonb_array_elements_text(target_good->'badges') with ordinality as item(value, position);
  -- 첫 값 칸을 함께 보내면 목록의 첫 값과 같아야 한다(두 값이 다르면 어느 쪽이 의도인지 알 수 없다).
  if target_good ? 'badge' and (target_good->>'badge') is distinct from v_badges[1] then
    raise check_violation using message = 'goods_badges_invalid';
  end if;

  -- 위임 저장과 같은 잠금 순서(카테고리 트리 → 상품 행).
  perform private.lock_catalog_category_tree();
  if nullif(target_good->>'previous_id', '') is not null then
    select * into previous from public.goods where id = target_good->>'previous_id' for update;
  end if;

  saved := private.admin_save_good_before_badges(
    (target_good - 'badges') || pg_catalog.jsonb_build_object('badge', v_badges[1]));
  saved_id := saved->>'id';
  update public.goods set badges = v_badges where id = saved_id and badges is distinct from v_badges;

  if coalesce(previous.badges, '{}'::text[]) is distinct from v_badges then
    insert into public.audit_log(actor_id, action, target, diff)
      values(v_actor_id, 'admin.good.badges_saved', 'goods:' || saved_id,
        pg_catalog.jsonb_build_object('before', coalesce(previous.badges, '{}'::text[]), 'after', v_badges));
  end if;
  return saved;
end $function$;
alter function public.admin_save_good(jsonb) owner to postgres;
revoke all on function public.admin_save_good(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_good(jsonb)'::regprocedure, 'catalog.manage', 'write', false);
select private.register_operator_internal_contract('private.admin_save_good_before_badges(jsonb)'::regprocedure);

-- --------------------------------------------------------------------------
-- 4. 복제·그룹상품 만들기: 목록 전체를 같은 순서로 복사한다
-- --------------------------------------------------------------------------
-- 복제: 현재 정의 = 20261020085215(운영자 권한 확인) 원문. 아래 층(admin_clone_good_before_custom_inputs)은 첫 값만 복사한다.
create or replace function public.admin_clone_good(target_operation_id uuid, target_source_good_id text, target_new_id text default null::text, target_new_code text default null::text, target_new_name text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare saved jsonb; replay boolean;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if auth.uid() is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin.goods.clone.operation:'||target_operation_id::text,0));
  select exists(select 1 from public.audit_log where id=target_operation_id) into replay;
  saved:=private.admin_clone_good_before_custom_inputs(target_operation_id,target_source_good_id,target_new_id,target_new_code,target_new_name);
  if not replay then
    update public.goods copied set custom_inputs_enabled=source.custom_inputs_enabled,custom_input_fields=source.custom_input_fields,
      badges=source.badges
      from public.goods source where source.id=saved->>'sourceGoodId' and copied.id=saved->>'id';
  end if;
  return saved;
end $function$;
revoke all on function public.admin_clone_good(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.admin_clone_good(uuid,text,text,text,text) to authenticated;

-- 옵션 분리로 만드는 그룹상품: 아래 층이 첫 값만 복사하므로 원본 목록을 같은 순서로 옮긴다.
alter function private.create_goods_group_product(text,uuid,text,uuid) rename to create_goods_group_product_before_badges;
revoke all on function private.create_goods_group_product_before_badges(text,uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function private.create_goods_group_product_before_badges(text,uuid,text,uuid) to postgres;
create function private.create_goods_group_product(p_source_good_id text,p_source_variant_id uuid,p_name text,p_actor uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare saved_id text;
begin
  saved_id := private.create_goods_group_product_before_badges(p_source_good_id, p_source_variant_id, p_name, p_actor);
  update public.goods copied set badges = source.badges
    from public.goods source
    where source.id = p_source_good_id and copied.id = saved_id and copied.badges is distinct from source.badges;
  return saved_id;
end $$;
revoke all on function private.create_goods_group_product(text,uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function private.create_goods_group_product(text,uuid,text,uuid) to postgres;
select private.register_operator_internal_contract('private.create_goods_group_product_before_badges(text,uuid,text,uuid)'::regprocedure);

-- --------------------------------------------------------------------------
-- 5. 공개·어드민 투영과 통합 검색
-- --------------------------------------------------------------------------
-- 앵커 치환 도구(이 migration 안에서만 쓰고 끝에서 지운다).
create function private.goods_badges_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 'goods badges patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 카테고리 전시 목록·추천 굿즈(앱은 toGood으로 읽는다).
select private.goods_badges_patch_function('private.category_display_public_good(public.goods,jsonb)'::regprocedure, array[
$a$'badge',p_good.badge,$a$,
$a$'badge',p_good.badge,'badges',p_good.badges,$a$
]);
revoke all on function private.category_display_public_good(public.goods,jsonb) from public, anon, authenticated, service_role;

-- 쇼핑스토리 공개 본문의 굿즈 카드.
select private.goods_badges_patch_function('public.get_shopping_story(uuid)'::regprocedure, array[
$a$'badge',g.badge,$a$,
$a$'badge',g.badge,'badges',g.badges,$a$
]);

-- 쇼핑스토리·관련상품 찾기 어드민 후보 행(편집 화면 미리보기가 같은 카드를 그린다).
select private.goods_badges_patch_function('private.shopping_story_admin_good(public.goods,boolean,boolean)'::regprocedure, array[
$a$'badge',p_good.badge,$a$,
$a$'badge',p_good.badge,'badges',p_good.badges,$a$
]);
revoke all on function private.shopping_story_admin_good(public.goods,boolean,boolean) from public, anon, authenticated, service_role;

-- 통합 검색: 검색어가 둘째 값 이후 표시문구와 같아도 찾는다(점수 0.4는 그대로).
select private.goods_badges_patch_function('public.search_public_content(text,integer)'::regprocedure, array[
$a$case when coalesce(goods.badge, '') ilike$a$,
$a$case when coalesce(pg_catalog.array_to_string(goods.badges, ' '), '') ilike$a$,
$a$or coalesce(goods.badge, '') ilike$a$,
$a$or coalesce(pg_catalog.array_to_string(goods.badges, ' '), '') ilike$a$
]);

drop function private.goods_badges_patch_function(regprocedure, text[]);

-- 운영자 계약 지문: 다시 정의한 함수는 기존 분류 그대로 다시 등록한다.
do $$
declare fn regprocedure; contract private.operator_rpc_contracts;
begin
  foreach fn in array array[
    'private.track_goods_base_revision()'::regprocedure,
    'public.admin_clone_good(uuid,text,text,text,text)'::regprocedure,
    'private.create_goods_group_product(text,uuid,text,uuid)'::regprocedure,
    'private.category_display_public_good(public.goods,jsonb)'::regprocedure,
    'public.get_shopping_story(uuid)'::regprocedure,
    'private.shopping_story_admin_good(public.goods,boolean,boolean)'::regprocedure,
    'public.search_public_content(text,integer)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
