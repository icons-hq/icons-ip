-- ADR-0044: 상품 유형 층을 걷어낸다(ADR-0037 대체).
--
-- 상품 유형(피규어·인형·키링·아크릴·문구·쿠션·파우치·세트·기타)은 대표 카테고리에 연결한 값에서 파생됐고, 연결이 없으면
-- 공개할 수 없었다. 카테고리마다 유형을 따로 연결해야 해서 MD가 상품을 공개하지 못하는 일이 생겼다. 이제
--   1. 공개 조건은 "대표 카테고리가 있다"이다(유형 조건 없음).
--   2. 상품 유형을 카테고리에서 파생하지 않고, 공개·저장·판매 준비가 유형을 판정하지 않는다.
--   3. 공개 중인 상품도 다른 대표 카테고리로 옮길 수 있다(비울 수는 없다). 카테고리 이동은 KC 재검토 대상이 아니다.
--   4. 검색의 굿즈 부제·검색어 일치는 유형 대신 대표 카테고리 이름을 쓴다.
--
-- 이 migration은 동작만 바꾼다. 저장 칸(`goods.type`, `order_items.good_type_snapshot`, `catalog_categories.good_type`,
-- `goods_type_category_migrations`, `admin_upsert_category`의 `target_good_type` 인자)은 배포 순간의 이전 앱이 계속 읽고
-- 쓰므로 남겨 두고, 새 앱이 배포된 뒤 후속 migration에서 지운다. 그때까지
--   - `goods.type`은 새 상품에서 ''이고 기존 값은 바뀌지 않는다(앱이 저장된 값을 그대로 다시 보낸다).
--     KC 지문(`private.goods_kc_context`)은 그대로라 값이 바뀌지 않는 한 KC 검토 상태에 영향이 없다.
--   - `catalog_categories.good_type`은 어디에서도 읽지 않는다.

-- --------------------------------------------------------------------------
-- 1. 파생 장치를 없앤다: 초안 유형 맞춤 트리거, 카테고리 연결·상위 변경 때 하위 초안을 맞추던 트리거.
-- --------------------------------------------------------------------------
drop trigger catalog_categories_good_type_refresh on public.catalog_categories;
drop function private.refresh_category_good_type_goods();

drop trigger goods_category_type_derive on public.goods;
drop function private.derive_goods_type_from_category();

-- ADR-0037이 KC 가드 열 목록에 더한 category_id를 뺀다(카테고리만 바꾸는 쓰기는 이제 KC 맥락을 바꾸지 않는다).
drop trigger goods_kc_guard on public.goods;
create trigger goods_kc_guard
  before insert or update of published_at, archived_at, kc_disclosures, id, ip_id, name, type,
    notice_maker, notice_origin, notice_material, notice_size on public.goods
  for each row execute function private.guard_goods_kc();

-- --------------------------------------------------------------------------
-- 2. 공개 중인 상품도 유형이 비어 있을 수 있다(새 상품). 값 목록은 그대로 두되 공개 여부와 묶지 않는다.
-- --------------------------------------------------------------------------
alter table public.goods drop constraint goods_type_check;
alter table public.goods add constraint goods_type_check check (
  type = any (array['', '피규어', '인형', '키링', '아크릴', '문구', '쿠션', '파우치', '세트', '기타'])
);
comment on column public.goods.type is
  'ADR-0044로 쓰지 않는 칸(후속 migration에서 삭제). 새 상품은 ''''이고 운영 화면은 저장된 값을 그대로 다시 보낸다. KC 지문에 포함된다.';
comment on column public.catalog_categories.good_type is
  'ADR-0044로 쓰지 않는 칸(후속 migration에서 삭제). 상품 유형을 파생하지 않는다.';

-- --------------------------------------------------------------------------
-- 3. 앵커 치환: 현재 정의에서 앵커가 정확히 한 번 나올 때만 바꾼다(다른 migration이 같은 줄을 고쳤으면 실패한다).
-- --------------------------------------------------------------------------
create function private.goods_type_retire_patch(p_function regprocedure, p_patches jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $helper$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_function);
  v_patch jsonb;
  v_found integer;
begin
  for v_patch in select value from pg_catalog.jsonb_array_elements(p_patches) loop
    v_found := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_patch->>0, '')))
      / pg_catalog.length(v_patch->>0);
    if v_found <> 1 then
      raise exception 'goods_type_retire_anchor_changed: % (% matches)', p_function, v_found;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.goods_type_retire_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

-- 3-1. 공개 전환: 필수 입력에서 유형을 빼고, 대표 카테고리가 있어야 공개한다.
select private.goods_type_retire_patch('private.set_good_published(text,boolean)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$declare selected public.goods; transition_at timestamptz; category_type text;$anchor$,
    $patched$declare selected public.goods; transition_at timestamptz;$patched$),
  jsonb_build_array(
    $anchor$nullif(btrim(selected.name),'') is null or nullif(btrim(selected.type),'') is null$anchor$,
    $patched$nullif(btrim(selected.name),'') is null$patched$),
  jsonb_build_array(
    $anchor$  -- SHEET-003(ADR-0037): 상품 유형은 대표 카테고리(없으면 가까운 상위)의 연결값이다.
  if publish_requested then
    category_type:=private.goods_category_type(selected.category_id);
    if category_type='' then raise check_violation using message='goods_type_category_required'; end if;
    if selected.type is distinct from category_type then raise check_violation using message='goods_type_category_changed'; end if;
  end if;
$anchor$,
    $patched$  -- ADR-0044: 상품 유형은 없다. 공개하려면 대표 카테고리가 있어야 한다.
  if publish_requested and selected.category_id is null then
    raise check_violation using message='goods_category_required';
  end if;
$patched$)));

-- 3-2. 상품 저장의 카테고리 단계: 공개 중에도 다른 대표 카테고리로 옮길 수 있고, 비우는 것만 막는다.
--      저장과 함께 공개하는 요청은 지금처럼 카테고리를 바꾼 뒤에 공개한다(공개 판정이 새 대표 카테고리를 본다).
select private.goods_type_retire_patch('private.admin_save_good_before_purchase_cost(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  defer_publish boolean := false; next_type text;$anchor$,
    $patched$  defer_publish boolean := false;$patched$),
  jsonb_build_array(
    $anchor$  -- SHEET-003: 첫 공개는 카테고리를 바꾼 뒤에 한다(공개 판정이 새 카테고리 유형을 본다).$anchor$,
    $patched$  -- 첫 공개는 카테고리를 바꾼 뒤에 한다(공개 판정이 새 대표 카테고리를 본다, ADR-0044).$patched$),
  jsonb_build_array(
    $anchor$    -- SHEET-003: 공개 중에는 상품 유형이 바뀌는(연결 없음 포함) 카테고리로 옮길 수 없다. 초안 전환 후 바꾼다.
    if current_good.published_at is not null then
      next_type:=private.goods_category_type(category_value);
      if next_type='' then raise check_violation using message='goods_type_category_required'; end if;
      if next_type is distinct from current_good.type then raise check_violation using message='goods_type_category_locked'; end if;
    end if;
$anchor$,
    $patched$    -- ADR-0044: 공개 중 상품은 다른 대표 카테고리로 옮길 수 있지만 비울 수는 없다(공개 조건).
    if current_good.published_at is not null and category_value is null then
      raise check_violation using message='goods_published_category_clear';
    end if;
$patched$)));

-- 3-3. 카테고리 화면의 대표 분류 적용도 같은 규칙을 따른다.
select private.goods_type_retire_patch('private.admin_assign_good_category_before_additional(uuid,text,uuid,timestamp with time zone)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  good_published_at timestamptz;
  good_type text;
  next_type text;
$anchor$,
    $patched$  good_published_at timestamptz;
$patched$),
  jsonb_build_array(
    $anchor$  select updated_at, category_id, published_at, type into good_updated_at, good_category_id, good_published_at, good_type$anchor$,
    $patched$  select updated_at, category_id, published_at into good_updated_at, good_category_id, good_published_at$patched$),
  jsonb_build_array(
    $anchor$  -- SHEET-003: 공개 중에는 상품 유형이 바뀌는(연결 없음 포함) 카테고리로 옮길 수 없다. 초안 전환 후 바꾼다.
  if good_published_at is not null and good_category_id is distinct from target_category_id then
    next_type := private.goods_category_type(target_category_id);
    if next_type = '' then raise check_violation using message = 'goods_type_category_required'; end if;
    if next_type is distinct from good_type then raise check_violation using message = 'goods_type_category_locked'; end if;
  end if;
$anchor$,
    $patched$  -- ADR-0044: 공개 중 상품은 다른 대표 카테고리로 옮길 수 있지만 비울 수는 없다(공개 조건).
  if good_published_at is not null and good_category_id is not null and target_category_id is null then
    raise check_violation using message = 'goods_published_category_clear';
  end if;
$patched$)));

-- 3-4. 판매 준비: 유형 사유 3종(type_missing·type_category_mismatch·type_no_category)을 category_missing 하나로 바꾼다.
--      초안은 공개를 막고(blocking), 공개 중이면 검토 사유로 알린다.
select private.goods_type_retire_patch('private.admin_goods_readiness(public.goods)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  category_type text; type_review boolean := false; type_no_category boolean := false;$anchor$,
    $patched$  category_review boolean := false;$patched$),
  jsonb_build_array(
    $anchor$  -- SHEET-003(ADR-0037): 상품 유형은 대표 카테고리(없으면 가까운 상위)의 연결값이다.
  category_type:=private.goods_category_type(p_good.category_id);
  if p_good.published_at is null then
    if category_type='' then blockers:=array_append(blockers,'type_missing');
    elsif category_type is distinct from p_good.type then blockers:=array_append(blockers,'type_category_mismatch'); end if;
  elsif category_type is distinct from p_good.type then
    -- 대표 카테고리가 아예 없는 공개 상품은 '연결 안내'가 아니라 '대표 카테고리 지정'이 할 일이다.
    type_review:=true; type_no_category:=p_good.category_id is null;
  end if;
$anchor$,
    $patched$  -- ADR-0044: 상품 유형은 없다. 대표 카테고리가 있어야 공개하고, 공개 중인데 없으면 검토 사유로 알린다.
  if p_good.category_id is null then
    if p_good.published_at is null then blockers:=array_append(blockers,'category_missing');
    else category_review:=true; end if;
  end if;
$patched$),
  jsonb_build_array(
    $anchor$  if type_review then reasons:=array_append(reasons,case when type_no_category then 'type_no_category' else 'type_category_mismatch' end); end if;$anchor$,
    $patched$  if category_review then reasons:=array_append(reasons,'category_missing'); end if;$patched$)));

-- 3-5. 상품 목록의 판매 준비 필터가 새 사유를 받는다. 옛 유형 사유 3종은 배포 사이 이전 앱이 보내도 목록이 오류 나지 않게
--      후속 칸 정리 migration까지 받아 둔다(판매 준비가 더는 내지 않으므로 아무 상품도 걸리지 않는다).
select private.goods_type_retire_patch('private.admin_goods_workspace_matches(text,text,text,text,uuid,text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$'type_missing','type_category_mismatch','type_no_category','image_missing'$anchor$,
    $patched$'category_missing','type_missing','type_category_mismatch','type_no_category','image_missing'$patched$)));

-- 3-6. 등록 화면 원자 저장: 화면이 확인한 유형과 파생 유형을 대조하던 확인을 없앤다(유형을 파생하지 않는다).
select private.goods_type_retire_patch('public.admin_save_good_workspace(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    if kc is not null and good->>'type' is not null and exists(
      select 1 from public.goods as saved_good
      where saved_good.id=saved_id and saved_good.published_at is null
        and saved_good.type is distinct from good->>'type'
        and not exists(select 1 from private.goods_group_members as member where member.good_id=saved_good.id)) then
      raise sqlstate 'PT409' using message='goods_type_category_changed';
    end if;
$anchor$,
    '')));

-- 3-7. 검색의 굿즈 부제·검색어 일치는 유형 대신 대표 카테고리 이름을 쓴다.
--      고객 카테고리 기능이 꺼져 있거나 보관된 카테고리면 이름을 쓰지 않는다(카테고리 공개 읽기 정책과 같은 조건).
select private.goods_type_retire_patch('public.search_public_content(text,integer)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$      concat_ws(' · ', ips.title, goods.type) as subtitle,$anchor$,
    $patched$      concat_ws(' · ', ips.title, nullif(good_category.name, '')) as subtitle,$patched$),
  jsonb_build_array(
    $anchor$        case when goods.type ilike params.q_like escape E'\\' then 0.7 else 0 end,$anchor$,
    $patched$        case when coalesce(good_category.name, '') ilike params.q_like escape E'\\' then 0.7 else 0 end,$patched$),
  jsonb_build_array(
    $anchor$    join public.ips on ips.id = goods.ip_id
$anchor$,
    $patched$    join public.ips on ips.id = goods.ip_id
    left join public.catalog_categories as good_category
      on good_category.id = goods.category_id and good_category.archived_at is null and private.category_customer_enabled()
$patched$),
  jsonb_build_array(
    $anchor$        or goods.type ilike params.q_like escape E'\\'$anchor$,
    $patched$        or coalesce(good_category.name, '') ilike params.q_like escape E'\\'$patched$)));

drop function private.goods_type_retire_patch(regprocedure, jsonb);

-- 앵커 치환은 create or replace라 소유자·권한이 그대로다. 봉인을 다시 확인한다.
revoke all on function private.set_good_published(text,boolean) from public, anon, authenticated, service_role;
revoke all on function private.admin_save_good_before_purchase_cost(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.admin_assign_good_category_before_additional(uuid,text,uuid,timestamp with time zone)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_goods_readiness(public.goods) from public, anon, authenticated, service_role;
revoke all on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.admin_save_good_workspace(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good_workspace(jsonb) to authenticated;
-- 앵커 치환한 원자 저장의 본문 지문을 다시 적는다(분류는 기존 행 그대로).
select private.register_operator_rpc_contract('public.admin_save_good_workspace(jsonb)'::regprocedure,'catalog.manage','write',false);

-- --------------------------------------------------------------------------
-- 4. 유형 파생 함수를 없앤다. 남은 함수가 부르고 있으면 여기서 멈춘다(plpgsql은 의존을 추적하지 않는다).
-- --------------------------------------------------------------------------
do $$
declare
  callers text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into callers
  from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.proname not in ('goods_category_type', 'goods_category_type_majority')
    and (p.prosrc ~ 'goods_category_type' or p.prosrc ~ 'goods_type_category_(required|locked|changed)'
      -- 목록 필터는 옛 사유 값을 이전 앱 호환으로만 받는다(3-5).
      or (p.prosrc ~ '''type_(missing|category_mismatch|no_category)'''
        and p.oid <> 'private.admin_goods_workspace_matches(text,text,text,text,uuid,text)'::regprocedure));
  if callers is not null then
    raise exception 'goods_type_retire_remaining_callers: %', callers;
  end if;
end $$;

drop function private.goods_category_type(uuid);
drop function private.goods_category_type_majority();
