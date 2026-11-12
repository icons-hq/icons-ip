-- ==========================================================================
-- ICONS · 상품 유형을 대표 카테고리에서 파생한다(SHEET-003, 2026-11-11 사용자 결정 "카테고리에서 파생") — ADR-0037
--
-- 상품 유형 입력을 없애고, 카테고리 관리에서 카테고리마다 '상품 유형'(9종) 연결 칸을 둔다.
-- 상품 유형 = 대표 카테고리(없으면 가까운 상위 카테고리)의 연결값이다. goods.type 열은 그 파생값을
-- 저장해 두는 자리로 남는다(고객 필터 칩·검색·체크아웃 스냅샷·KC 맥락 등 읽는 곳은 그대로).
--
-- 지키는 것(KC·고시 판정이 약해지지 않게):
--   * 연결값이 없으면(대표 카테고리 없음 포함) 공개할 수 없다 — set_good_published가 거절하고 판매 준비는
--     type_missing('카테고리에 상품 유형 연결 필요')을 막는 사유로 보인다. goods_type_check('' 은 초안만)는 그대로다.
--   * 공개 중 상품의 유형은 바뀌지 않는다. 대표 카테고리를 바꿔 유형이 달라지면(연결 없음 포함) 저장 RPC가
--     막는다(초안 전환 후 수정 — 지금 '유형' 잠금과 같다). 유형을 바꾸는 직접 쓰기는 goods_kc_guard가 그대로 막는다.
--   * 초안의 유형이 카테고리 때문에 바뀌면 KC 검토가 미검토로 돌아간다. goods_kc_guard가 category_id 변경에도
--     돌게 해, 카테고리만 바꾸는 쓰기에서 유형이 바뀌어도 무효화가 빠지지 않는다.
--   * 이미 공개된 상품은 연결값이 비거나 달라도 다른 칸 저장을 막지 않고 저장된 유형을 유지한다. 판매 준비가
--     type_category_mismatch를 검토 사유(경고)로 보인다. 공개 전환·카테고리 변경 때만 파생 규칙을 강제한다.
--
-- 배포 직후 공개가 막히지 않게 카테고리별 연결 초기값을 기존 분포로 채운다(그 카테고리를 대표로 쓰는
-- 상품 중 최다 유형). 동률·상품 없음은 비운다. 상품의 유형은 이 migration이 바꾸지 않는다. 비운 카테고리와
-- 연결값과 다른 상품 목록은 supabase/tests/goods_type_from_category.sql 맨 위 읽기 쿼리로 확인한다.
--
-- 유형 목록은 lib/goods-taxonomy.ts GOOD_TYPES·goods_type_check와 같아야 한다(함께 고친다).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. 카테고리의 상품 유형 연결 칸
-- --------------------------------------------------------------------------
alter table public.catalog_categories add column good_type text;
alter table public.catalog_categories add constraint catalog_categories_good_type_check check (
  good_type is null or good_type in ('피규어','인형','키링','아크릴','문구','쿠션','파우치','세트','기타')
);
comment on column public.catalog_categories.good_type is
  '상품 유형 연결값(SHEET-003·ADR-0037). 비우면 가까운 상위 카테고리의 연결값을 따른다. 대표 카테고리 경로 어디에도 없으면 그 상품은 공개할 수 없다.';

-- --------------------------------------------------------------------------
-- 2. 연결 초기값: 그 카테고리를 대표로 쓰는 상품(보관 제외·유형 있음)의 최다 유형. 동률·상품 없음은 비운다.
--    아래 트리거(카테고리 연결 변경 → 초안 갱신)를 만들기 전에 채워 기존 상품의 유형을 바꾸지 않는다.
--    분포 계산은 읽기 전용 함수로 둬 배포 뒤 읽기 확인(동률 목록)과 SQL 시험이 같은 규칙을 쓴다.
-- --------------------------------------------------------------------------
create function private.goods_category_type_majority()
returns table(category_id uuid, good_type text, goods integer, tied_types text[])
language sql
stable
security definer
set search_path = ''
as $function$
  with votes as (
    select good.category_id, good.type, count(*)::integer as goods
    from public.goods as good
    where good.category_id is not null and good.archived_at is null and good.type <> ''
    group by good.category_id, good.type
  ), ranked as (
    select votes.category_id, votes.type, votes.goods,
      rank() over (partition by votes.category_id order by votes.goods desc) as place
    from votes
  )
  select ranked.category_id,
    case when count(*) = 1 then min(ranked.type) end,
    max(ranked.goods),
    case when count(*) > 1 then array_agg(ranked.type order by ranked.type) end
  from ranked
  where ranked.place = 1
  group by ranked.category_id;
$function$;
revoke all on function private.goods_category_type_majority() from public, anon, authenticated, service_role;

update public.catalog_categories as category
set good_type = majority.good_type
from private.goods_category_type_majority() as majority
where majority.category_id = category.id and majority.good_type is not null and category.good_type is null;

-- --------------------------------------------------------------------------
-- 3. 파생값: 대표 카테고리(없으면 가까운 상위)의 연결값. 없으면 ''.
-- --------------------------------------------------------------------------
create function private.goods_category_type(p_category_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  with recursive chain(id, parent_id, good_type, depth) as (
    select category.id, category.parent_id, category.good_type, 1
    from public.catalog_categories as category
    where category.id = p_category_id
    union all
    select parent.id, parent.parent_id, parent.good_type, chain.depth + 1
    from chain
    join public.catalog_categories as parent on parent.id = chain.parent_id
    where chain.good_type is null and chain.depth < 8
  )
  select coalesce((select chain.good_type from chain where chain.good_type is not null order by chain.depth limit 1), '');
$function$;
revoke all on function private.goods_category_type(uuid) from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 4. 초안의 유형은 카테고리 연결값으로 맞춘다.
--    공개 중인 행은 건드리지 않는다(저장된 유형 유지). 연결값이 없으면 들어온 값을 둔다 — 그 초안은 공개할 수 없다.
--    그룹 상품의 공통 칸(유형 포함)은 그룹 공통 저장(이 트랜잭션의 쓰기 허가)에서만 바꾼다.
--    이름 순서상 goods_group_common_information_guard·goods_kc_guard보다 먼저 돈다(둘 다 바뀐 유형을 본다).
-- --------------------------------------------------------------------------
create function private.derive_goods_type_from_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  derived text;
begin
  if new.published_at is not null then return new; end if;
  derived := private.goods_category_type(new.category_id);
  if derived = '' or new.type is not distinct from derived then return new; end if;
  if tg_op = 'UPDATE'
     and exists(select 1 from private.goods_group_members as member where member.good_id = old.id)
     and not exists(select 1 from private.goods_group_write_authorizations as grant_row
       where grant_row.transaction_id = txid_current() and grant_row.good_id = old.id and grant_row.actor_id = auth.uid()) then
    return new;
  end if;
  new.type := derived;
  return new;
end;
$function$;
revoke all on function private.derive_goods_type_from_category() from public, anon, authenticated, service_role;

create trigger goods_category_type_derive
  before insert or update of category_id, type, published_at, archived_at on public.goods
  for each row execute function private.derive_goods_type_from_category();

-- KC 맥락(유형 포함)이 카테고리만 바꾸는 쓰기에서도 다시 확인되게 category_id를 KC 가드 열 목록에 더한다.
-- 위 트리거가 유형을 바꾸는 쓰기의 열 목록은 모두 이 목록 안에 있다(유형이 바뀌면 KC 가드가 반드시 돈다).
drop trigger goods_kc_guard on public.goods;
create trigger goods_kc_guard
  before insert or update of published_at, archived_at, kc_disclosures, id, ip_id, name, type, category_id,
    notice_maker, notice_origin, notice_material, notice_size on public.goods
  for each row execute function private.guard_goods_kc();

-- --------------------------------------------------------------------------
-- 5. 카테고리의 연결값·상위가 바뀌면 그 아래(자기 포함) 초안 상품의 유형을 새 파생값으로 맞춘다.
--    공개 중·보관 상품과 그룹 상품은 바꾸지 않는다(공개 중은 저장된 유형 유지·판매 준비 경고, 그룹은 공통 저장에서).
--    새 파생값이 ''(연결 없음)이면 초안의 유형을 지우지 않는다 — 공개 판정이 막는다.
--    유형이 바뀐 초안은 goods_kc_guard가 KC 검토를 미검토로 돌린다. 바뀐 상품은 감사 기록에 남긴다.
-- --------------------------------------------------------------------------
create function private.refresh_category_good_type_goods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  refreshed jsonb;
begin
  with recursive subtree(id) as (
    select new.id
    union
    select child.id from public.catalog_categories as child join subtree on child.parent_id = subtree.id
  ), targets as (
    select good.id, private.goods_category_type(good.category_id) as derived
    from public.goods as good
    where good.category_id in (select subtree.id from subtree)
      and good.published_at is null and good.archived_at is null
      and not exists(select 1 from private.goods_group_members as member where member.good_id = good.id)
  ), changed as (
    update public.goods as good set type = targets.derived
    from targets
    where good.id = targets.id and targets.derived <> '' and good.type is distinct from targets.derived
    returning good.id
  )
  select coalesce(jsonb_agg(changed.id order by changed.id), '[]'::jsonb) into refreshed from changed;
  if old.good_type is distinct from new.good_type or jsonb_array_length(refreshed) > 0 then
    insert into public.audit_log(actor_id, action, target, diff)
    values (auth.uid(), 'admin.catalog.category.good_type_changed', 'catalog_categories:' || new.id::text,
      jsonb_build_object('before', old.good_type, 'after', new.good_type,
        'parentChanged', old.parent_id is distinct from new.parent_id, 'refreshedDraftGoodIds', refreshed));
  end if;
  return null;
end;
$function$;
revoke all on function private.refresh_category_good_type_goods() from public, anon, authenticated, service_role;

create trigger catalog_categories_good_type_refresh
  after update of parent_id, good_type on public.catalog_categories
  for each row when (old.parent_id is distinct from new.parent_id or old.good_type is distinct from new.good_type)
  execute function private.refresh_category_good_type_goods();

-- --------------------------------------------------------------------------
-- 6. 카테고리 추가·수정 RPC에 상품 유형 연결 칸을 더한다(시그니처가 바뀌어 다시 만든다).
--    target_good_type: null = 그대로 둔다(이전 화면 호환), '' = 연결 해제(상위를 따른다), 9종 중 하나 = 연결.
-- --------------------------------------------------------------------------
drop function public.admin_upsert_category(uuid, uuid, text, text, uuid, integer, timestamp with time zone);
delete from private.operator_rpc_contracts
  where signature = 'public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone)';
delete from private.operator_internal_contracts
  where signature = 'public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone)';

create function public.admin_upsert_category(
  target_operation_id uuid,
  target_category_id uuid,
  target_code text,
  target_name text,
  target_parent_id uuid,
  target_sort_order integer,
  target_expected_updated_at timestamp with time zone,
  target_good_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  category_row public.catalog_categories;
  next_depth integer;
  next_good_type text;
  result_id uuid;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  request_payload jsonb;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor_id is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message = 'forbidden'; end if;
  if target_operation_id is null or target_code is null or target_code !~ '^[a-z0-9][a-z0-9-]*$' or length(target_code) > 80
     or target_name is null or btrim(target_name) = '' or length(target_name) > 120
     or target_sort_order is null or target_sort_order < 0 then
    raise invalid_parameter_value using message = 'invalid_category';
  end if;
  if target_good_type is not null and target_good_type <> ''
     and target_good_type not in ('피규어','인형','키링','아크릴','문구','쿠션','파우치','세트','기타') then
    raise invalid_parameter_value using message = 'invalid_category_good_type';
  end if;
  request_payload := jsonb_build_object(
    'category_id', target_category_id,
    'code', target_code,
    'name', btrim(target_name),
    'parent_id', target_parent_id,
    'sort_order', target_sort_order,
    'expected_updated_at', target_expected_updated_at,
    'good_type', target_good_type
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin.catalog.category.operation:' || target_operation_id::text, 0));
  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;
  if found then
    if existing_actor_id = actor_id
       and existing_action in ('admin.catalog.category.created', 'admin.catalog.category.updated')
       and existing_diff -> 'request' = request_payload
    then
      result_id := coalesce(target_category_id, nullif(existing_diff ->> 'category_id', '')::uuid);
      next_depth := nullif(existing_diff #>> '{after,depth}', '')::integer;
      if result_id is not null and next_depth is not null then
        return jsonb_build_object('id', result_id, 'depth', next_depth, 'goodType', existing_diff #>> '{after,good_type}');
      end if;
    end if;
    raise unique_violation using message = 'operation_conflict';
  end if;
  perform private.lock_catalog_category_tree();

  if target_category_id is null then
    if exists (select 1 from public.catalog_categories where code = target_code) then raise unique_violation using message = 'category_code_taken'; end if;
    result_id := extensions.gen_random_uuid();
    next_depth := private.category_validate_parent(result_id, target_parent_id);
    next_good_type := nullif(target_good_type, '');
    insert into public.catalog_categories (id, code, name, parent_id, depth, sort_order, good_type)
    values (result_id, target_code, btrim(target_name), target_parent_id, next_depth, target_sort_order, next_good_type);
    insert into public.audit_log(id, actor_id, action, target, diff)
    values (target_operation_id, actor_id, 'admin.catalog.category.created', 'catalog_categories:' || result_id::text,
      jsonb_build_object('category_id', result_id, 'request', request_payload,
        'after', jsonb_build_object('code', target_code, 'name', btrim(target_name), 'parent_id', target_parent_id, 'depth', next_depth,
          'good_type', next_good_type)));
  else
    select * into category_row from public.catalog_categories where id = target_category_id for update;
    if not found then raise no_data_found using message = 'category_not_found'; end if;
    if target_expected_updated_at is null or category_row.updated_at is distinct from target_expected_updated_at then raise exception using errcode = 'PT409', message = 'category_changed'; end if;
    if exists (select 1 from public.catalog_categories where code = target_code and id <> target_category_id) then raise unique_violation using message = 'category_code_taken'; end if;
    next_depth := private.category_validate_parent(target_category_id, target_parent_id);
    next_good_type := case when target_good_type is null then category_row.good_type else nullif(target_good_type, '') end;
    -- 연결값·상위가 바뀌면 catalog_categories_good_type_refresh가 그 아래 초안 상품의 유형을 맞춘다.
    update public.catalog_categories
    set code = target_code, name = btrim(target_name), parent_id = target_parent_id, depth = next_depth,
        sort_order = target_sort_order, good_type = next_good_type, updated_at = pg_catalog.now()
    where id = target_category_id;
    with recursive descendants as (
      select category.id, 1 as relative_depth
      from public.catalog_categories as category
      where category.parent_id = target_category_id
      union all
      select child.id, descendants.relative_depth + 1
      from descendants
      join public.catalog_categories as child on child.parent_id = descendants.id
    )
    update public.catalog_categories as child
    set depth = next_depth + descendants.relative_depth, updated_at = pg_catalog.now()
    from descendants
    where child.id = descendants.id;
    result_id := target_category_id;
    insert into public.audit_log(id, actor_id, action, target, diff)
    values (target_operation_id, actor_id, 'admin.catalog.category.updated', 'catalog_categories:' || target_category_id::text,
      jsonb_build_object('category_id', target_category_id, 'request', request_payload,
        'before', jsonb_build_object('good_type', category_row.good_type),
        'after', jsonb_build_object('code', target_code, 'name', btrim(target_name), 'parent_id', target_parent_id, 'depth', next_depth,
          'good_type', next_good_type)));
  end if;
  return jsonb_build_object('id', result_id, 'depth', next_depth, 'goodType', next_good_type);
end;
$function$;
revoke all on function public.admin_upsert_category(uuid, uuid, text, text, uuid, integer, timestamp with time zone, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_category(uuid, uuid, text, text, uuid, integer, timestamp with time zone, text)
  to authenticated;
select private.register_operator_rpc_contract(
  'public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone,text)'::regprocedure,
  'catalog.manage', 'write');

-- --------------------------------------------------------------------------
-- 7. 앵커 치환: 현재 정의에서 앵커가 정확히 한 번 나올 때만 바꾼다(다른 migration이 같은 줄을 고쳤으면 실패한다).
-- --------------------------------------------------------------------------
create function private.goods_type_from_category_patch(p_function regprocedure, p_patches jsonb)
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
      raise exception 'goods_type_from_category_anchor_changed: % (% matches)', p_function, v_found;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.goods_type_from_category_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

-- 7-1. 공개 전환: 필수 입력 확인(goods_publish_incomplete) 뒤에, 대표 카테고리 경로에 연결값이 있고 저장된 유형이 그 값이어야 공개한다.
--      (초안 저장 때 트리거가 맞추므로 다른 경우는 배포 전 초안이나 그룹 개별 저장처럼 아직 맞추지 않은 초안뿐이다.)
select private.goods_type_from_category_patch('private.set_good_published(text,boolean)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$declare selected public.goods; transition_at timestamptz;$anchor$,
    $patched$declare selected public.goods; transition_at timestamptz; category_type text;$patched$),
  jsonb_build_array(
    $anchor$  ) then raise check_violation using message='goods_publish_incomplete'; end if;
$anchor$,
    $patched$  ) then raise check_violation using message='goods_publish_incomplete'; end if;
  -- SHEET-003(ADR-0037): 상품 유형은 대표 카테고리(없으면 가까운 상위)의 연결값이다.
  if publish_requested then
    category_type:=private.goods_category_type(selected.category_id);
    if category_type='' then raise check_violation using message='goods_type_category_required'; end if;
    if selected.type is distinct from category_type then raise check_violation using message='goods_type_category_changed'; end if;
  end if;
$patched$)));

-- 7-2. 상품 저장의 카테고리 층: 공개 중 카테고리 변경은 유형이 그대로일 때만 된다(유형 잠금과 같다).
--      공개 요청은 안쪽 층들처럼 이 층 끝으로 미룬다 — 카테고리를 바꾸며 공개해도 공개 판정이 새 카테고리의 유형을 본다.
select private.goods_type_from_category_patch('private.admin_save_good_before_purchase_cost(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$declare saved jsonb; current_good public.goods; category_value uuid; code_value text; code_id uuid;$anchor$,
    $patched$declare saved jsonb; current_good public.goods; category_value uuid; code_value text; code_id uuid;
  defer_publish boolean := false; next_type text;$patched$),
  jsonb_build_array(
    $anchor$  saved:=private.admin_save_good_before_category(target_good-'category_id'-'category_code');$anchor$,
    $patched$  -- SHEET-003: 첫 공개는 카테고리를 바꾼 뒤에 한다(공개 판정이 새 카테고리 유형을 본다).
  defer_publish:=target_good->>'publish'='true';
  saved:=private.admin_save_good_before_category(case when defer_publish
    then (target_good-'category_id'-'category_code')||'{"publish":null}'::jsonb else target_good-'category_id'-'category_code' end);$patched$),
  jsonb_build_array(
    $anchor$  if current_good.category_id is distinct from category_value then
    update public.goods set category_id=category_value where id=current_good.id;$anchor$,
    $patched$  if current_good.category_id is distinct from category_value then
    -- SHEET-003: 공개 중에는 상품 유형이 바뀌는(연결 없음 포함) 카테고리로 옮길 수 없다. 초안 전환 후 바꾼다.
    if current_good.published_at is not null then
      next_type:=private.goods_category_type(category_value);
      if next_type='' then raise check_violation using message='goods_type_category_required'; end if;
      if next_type is distinct from current_good.type then raise check_violation using message='goods_type_category_locked'; end if;
    end if;
    update public.goods set category_id=category_value where id=current_good.id;$patched$),
  jsonb_build_array(
    $anchor$        jsonb_build_object('before',current_good.category_id,'after',category_value));
  end if;
  return saved;$anchor$,
    $patched$        jsonb_build_object('before',current_good.category_id,'after',category_value));
  end if;
  if defer_publish then perform public.admin_set_good_published(saved->>'id',true); end if;
  return saved;$patched$)));

-- 7-3. 카테고리 화면의 대표 분류 적용도 같은 공개 중 유형 잠금을 지킨다.
select private.goods_type_from_category_patch('private.admin_assign_good_category_before_additional(uuid,text,uuid,timestamp with time zone)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  good_category_id uuid;
$anchor$,
    $patched$  good_category_id uuid;
  good_published_at timestamptz;
  good_type text;
  next_type text;
$patched$),
  jsonb_build_array(
    $anchor$  select updated_at, category_id into good_updated_at, good_category_id
  from public.goods where id = target_good_id for update;$anchor$,
    $patched$  select updated_at, category_id, published_at, type into good_updated_at, good_category_id, good_published_at, good_type
  from public.goods where id = target_good_id for update;$patched$),
  jsonb_build_array(
    $anchor$  update public.goods set category_id = target_category_id, updated_at = pg_catalog.now() where id = target_good_id;$anchor$,
    $patched$  -- SHEET-003: 공개 중에는 상품 유형이 바뀌는(연결 없음 포함) 카테고리로 옮길 수 없다. 초안 전환 후 바꾼다.
  if good_published_at is not null and good_category_id is distinct from target_category_id then
    next_type := private.goods_category_type(target_category_id);
    if next_type = '' then raise check_violation using message = 'goods_type_category_required'; end if;
    if next_type is distinct from good_type then raise check_violation using message = 'goods_type_category_locked'; end if;
  end if;
  update public.goods set category_id = target_category_id, updated_at = pg_catalog.now() where id = target_good_id;$patched$)));

-- 7-4. 판매 준비: 초안은 지금 카테고리 연결값으로 판정하고(없으면 type_missing, 저장된 유형과 다르면
--      type_category_mismatch로 공개를 막는다), 공개 중 상품은 저장된 유형을 유지한 채 다르면 검토 사유로만 알린다.
select private.goods_type_from_category_patch('private.admin_goods_readiness(public.goods)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$kc_current boolean; kc_legacy boolean; notice_complete boolean; unknown_read boolean := false;$anchor$,
    $patched$kc_current boolean; kc_legacy boolean; notice_complete boolean; unknown_read boolean := false;
  category_type text; type_review boolean := false;$patched$),
  jsonb_build_array(
    $anchor$  if nullif(btrim(p_good.type),'') is null then blockers:=array_append(blockers,'type_missing'); end if;$anchor$,
    $patched$  -- SHEET-003(ADR-0037): 상품 유형은 대표 카테고리(없으면 가까운 상위)의 연결값이다.
  category_type:=private.goods_category_type(p_good.category_id);
  if p_good.published_at is null then
    if category_type='' then blockers:=array_append(blockers,'type_missing');
    elsif category_type is distinct from p_good.type then blockers:=array_append(blockers,'type_category_mismatch'); end if;
  elsif category_type is distinct from p_good.type then type_review:=true; end if;$patched$),
  jsonb_build_array(
    $anchor$  reasons:=blockers;
$anchor$,
    $patched$  reasons:=blockers;
  if type_review then reasons:=array_append(reasons,'type_category_mismatch'); end if;
$patched$)));

-- 7-5. 상품 목록의 판매 준비 필터가 새 사유를 받는다.
select private.goods_type_from_category_patch('private.admin_goods_workspace_matches(text,text,text,text,uuid,text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$'type_missing','image_missing'$anchor$,
    $patched$'type_missing','type_category_mismatch','image_missing'$patched$)));

drop function private.goods_type_from_category_patch(regprocedure, jsonb);

-- 앵커 치환은 create or replace라 소유자·권한이 그대로다. 봉인을 다시 확인한다.
revoke all on function private.set_good_published(text,boolean) from public, anon, authenticated, service_role;
revoke all on function private.admin_save_good_before_purchase_cost(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.admin_assign_good_category_before_additional(uuid,text,uuid,timestamp with time zone)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_goods_readiness(public.goods) from public, anon, authenticated, service_role;
revoke all on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 8. 초기값 결과 요약(배포 로그). 목록은 supabase/tests/goods_type_from_category.sql 맨 위 읽기 쿼리로 본다.
-- --------------------------------------------------------------------------
do $$
declare
  linked integer; tied integer; unlinked_with_goods integer; mismatched integer; uncategorized integer;
begin
  select count(*) into linked from public.catalog_categories where good_type is not null;
  select count(*) into tied from private.goods_category_type_majority() as majority where majority.tied_types is not null;
  select count(distinct good.category_id) into unlinked_with_goods from public.goods as good
    where good.category_id is not null and good.archived_at is null and private.goods_category_type(good.category_id) = '';
  select count(*) into mismatched from public.goods as good
    where good.archived_at is null and good.category_id is not null and private.goods_category_type(good.category_id) <> ''
      and good.type is distinct from private.goods_category_type(good.category_id);
  select count(*) into uncategorized from public.goods as good where good.archived_at is null and good.category_id is null;
  raise notice 'goods_type_from_category: linked categories %, tied %, unlinked categories with goods %, goods differing from link %, uncategorized goods %',
    linked, tied, unlinked_with_goods, mismatched, uncategorized;
end $$;
