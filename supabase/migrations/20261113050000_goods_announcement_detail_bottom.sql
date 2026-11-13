-- ==========================================================================
-- ICONS · 상품공지사항 노출 위치 — '상세 하단'(1027T-005·1027T-009, 묶음 15)
--
-- 공지마다 위치 하나를 고른다.
--   top    = 지금처럼 하부 탭 위 '굿즈 공지사항'(기존 공지는 모두 여기에 남는다)
--   bottom = 상세정보 탭의 상세설명 바로 아래(전 상품 공통 교환·반품·배송 안내 HTML 자리)
-- 홈 팝업 선택·전시 기간·중요 표시·연결 상품 규칙은 위치와 무관하게 그대로다.
--
-- 저장 v2는 'placement' 키를 선택 값으로 받는다. 키가 없으면 새 공지는 top, 기존
-- 공지는 저장된 위치를 지킨다 — 배포 사이 이전 화면이나 보관된 미확인 저장 요청이
-- 하단 공지를 상단으로 옮기지 않는다. 구 3인자 저장(admin_save_goods_announcement)은
-- 위치를 받지 않고 고치지도 않는다.
--
-- 기존 함수는 본문을 통째로 다시 쓰지 않는다. 현재 정의(pg_get_functiondef)에서 앵커만
-- 치환해 다시 실행하고, 앵커가 사라졌으면 조용히 덮어쓰지 않고 실패한다(20261105093418과
-- 같은 방식). create or replace라 실행 권한은 그대로다.
-- ==========================================================================

alter table public.goods_announcements add column placement text not null default 'top'
  constraint goods_announcements_placement_check check (placement in ('top','bottom'));

comment on column public.goods_announcements.placement is
  '상품 상세 노출 위치: top=하부 탭 위 굿즈 공지사항, bottom=상세정보 탭의 상세설명 바로 아래.';

create function private.goods_announcement_placement_patch(p_function regprocedure, p_patches jsonb)
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
      raise exception 'goods_announcement_placement_anchor_changed: % (% matches)', p_function, v_found;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;

revoke all on function private.goods_announcement_placement_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

-- public.admin_save_goods_announcement_v2 — 선택 키 placement(top|bottom)
select private.goods_announcement_placement_patch(
  'public.admin_save_goods_announcement_v2(uuid,uuid,integer,jsonb,text,bigint)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array(
      $anchor$'importantStartsAt','importantEndsAt','popupStartsAt','popupEndsAt'))$anchor$,
      $patched$'importantStartsAt','importantEndsAt','popupStartsAt','popupEndsAt','placement'))$patched$),
    jsonb_build_array(
      $anchor$or exists(select 1 from unnest(array['startsAt','endsAt']) key where coalesce(jsonb_typeof(p_values->key),'null') not in ('string','null')) then$anchor$,
      $patched$or exists(select 1 from unnest(array['startsAt','endsAt']) key where coalesce(jsonb_typeof(p_values->key),'null') not in ('string','null'))
    or (p_values ? 'placement' and (jsonb_typeof(p_values->'placement') is distinct from 'string' or p_values->>'placement' not in ('top','bottom'))) then$patched$),
    jsonb_build_array(
      $anchor$important_starts_at,important_ends_at,created_by,updated_by)$anchor$,
      $patched$important_starts_at,important_ends_at,placement,created_by,updated_by)$patched$),
    jsonb_build_array(
      $anchor$important_starts,important_ends,actor,actor)$anchor$,
      $patched$important_starts,important_ends,coalesce(p_values->>'placement','top'),actor,actor)$patched$),
    jsonb_build_array(
      $anchor$important_ends_at=excluded.important_ends_at,$anchor$,
      $patched$important_ends_at=excluded.important_ends_at,
  placement=case when p_values ? 'placement' then excluded.placement else public.goods_announcements.placement end,$patched$)));

-- public.admin_get_goods_announcement_editor_context — 편집 화면이 저장된 위치를 연다
select private.goods_announcement_placement_patch(
  'public.admin_get_goods_announcement_editor_context(uuid)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array(
      $anchor$jsonb_build_object('importantStartsAt',important_starts_at,'importantEndsAt',important_ends_at)$anchor$,
      $patched$jsonb_build_object('importantStartsAt',important_starts_at,'importantEndsAt',important_ends_at,'placement',placement)$patched$)));

-- public.admin_list_goods_announcements — 목록 '노출 위치' 칸
select private.goods_announcement_placement_patch(
  'public.admin_list_goods_announcements(text,text,text,text,date,date,integer,integer)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array(
      $anchor$'important',important,'allGoods',all_goods,$anchor$,
      $patched$'important',important,'allGoods',all_goods,'placement',placement,$patched$)));

-- public.get_good_announcements — 공개 항목에 위치만 더한다(작성자·버전 등은 계속 싣지 않는다)
select private.goods_announcement_placement_patch(
  'public.get_good_announcements(text)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array(
      $anchor$'important',effective_important)$anchor$,
      $patched$'important',effective_important,'placement',placement)$patched$)));

drop function private.goods_announcement_placement_patch(regprocedure, jsonb);

-- 다시 만든 함수의 운영자 계약 지문을 현재 본문으로 갱신한다(분류·권한 값은 기존 그대로).
select private.register_operator_rpc_contract(pg_catalog.to_regprocedure(contract.signature),
  contract.capability, contract.guard_kind, contract.legacy_admin_only)
from private.operator_rpc_contracts as contract
where contract.signature in (
  'public.admin_save_goods_announcement_v2(uuid,uuid,integer,jsonb,text,bigint)',
  'public.admin_get_goods_announcement_editor_context(uuid)',
  'public.admin_list_goods_announcements(text,text,text,text,date,date,integer,integer)');

select private.register_operator_internal_contract(target.oid::regprocedure)
from pg_catalog.pg_proc as target
where target.oid = 'public.get_good_announcements(text)'::regprocedure::oid
  and exists (
    select 1 from private.operator_internal_contracts as contract
    where pg_catalog.to_regprocedure(contract.signature) = target.oid
  );

notify pgrst, 'reload schema';
