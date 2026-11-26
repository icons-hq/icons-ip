-- 상품정보제공고시 [다른 상품에서 복사] 선택창: 고시를 적어 둔 상품만 찾는다.
--
-- 지금까지 선택창은 admin_search_goods_console(p_status => 'active')로 보관하지 않은 상품을 모두 보여 줬다.
-- 고시를 한 칸도 적지 않은 상품도 목록에 나왔고, 고르면 "이 상품에는 적어 둔 상품정보제공고시가 없습니다"로 거절했다.
-- 지금 편집 중인 상품(자기 자신)도 목록에 나왔다.
-- 고를 수 없는 상품은 조회에서 뺀다(docs/admin-screen-rules.md 규칙 2). 화면에서 거르면 총 개수와 페이지가 어긋나므로 DB가 거른다.
--
-- admin_search_goods_console은 고치지 않는다 — 상품 조회/수정·공용 상품 선택창·복사등록의 결과는 그대로다.
-- 검색(상품명·상품 자동코드와 옵션 자동코드·상품 URL)·카테고리(하위와 추가 카테고리 포함)·보관 제외는 상품 조회/수정과 같은
-- 내부 조회(private.admin_goods_console_matches)를 불러 같은 검색의 결과가 갈라지지 않게 하고, 그 위에 조건 두 개만 더한다.
--   1. 고시 7칸(제조사 / 수입사·원산지·소재·크기 · 중량·제조연월·A/S 책임자·A/S 연락처) 가운데 하나라도 적혀 있다.
--      공백만 있는 칸은 빈 칸이다(저장 함수 admin_upsert_good이 다듬는 공백 문자와 같다).
--   2. p_exclude_good_id(지금 편집 중인 상품)는 자기 고시를 복사할 수 없으므로 뺀다. 저장 전인 새 상품은 null이다.
--
-- 권한은 지금까지 이 선택창이 쓰던 상품 검색(admin_search_goods_console)·최근 고시 읽기(admin_last_good_notice)와 같은
-- catalog.read 읽기다. 정렬은 등록일 최신순(선택창 고정)이다.

create function public.admin_search_goods_notice_sources(
  p_query text default '',
  p_field text default 'name',
  p_category_id uuid default null,
  p_exclude_good_id text default null,
  p_limit integer default 20,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is null or not coalesce(public.has_operator_capability('catalog.read', false), false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise invalid_parameter_value using message = 'invalid_goods_notice_source_page';
  end if;
  if p_field is null or p_field not in ('name', 'code', 'id')
    or char_length(coalesce(p_query, '')) > 100 or char_length(coalesce(p_exclude_good_id, '')) > 100 then
    raise invalid_parameter_value using message = 'invalid_goods_notice_source_filter';
  end if;

  with matched as materialized (
    select (source.good).id, (source.good).code, (source.good).name, (source.good).category_id,
      (source.good).image_path, (source.good).published_at, (source.good).archived_at, (source.good).created_at
    from private.admin_goods_console_matches(
      coalesce(p_query, ''), '', 'active', 'all', p_category_id, 'all', jsonb_build_object('field', p_field)
    ) source
    where (p_exclude_good_id is null or (source.good).id <> p_exclude_good_id)
      and exists (
        select 1
        from unnest(array[
          (source.good).notice_maker, (source.good).notice_origin, (source.good).notice_material, (source.good).notice_size,
          (source.good).notice_made_on, (source.good).notice_as_manager, (source.good).notice_as_contact
        ]) as notice(value)
        where btrim(coalesce(notice.value, ''), E' \t\n\r\f\v') <> ''
      )
  ), page as (
    select * from matched order by created_at desc nulls last, id asc limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id, 'code', page.code, 'name', page.name,
        'categoryName', (select category.name from public.catalog_categories category where category.id = page.category_id),
        'imagePath', page.image_path, 'publishedAt', page.published_at, 'archivedAt', page.archived_at
      ) order by page.created_at desc nulls last, page.id asc)
      from page
    ), '[]'::jsonb)
  ) into result;
  return result;
end
$$;

-- Supabase default privileges가 새 public 함수에 anon·authenticated·service_role 실행 권한을 붙인다. 모두 거둔 뒤 필요한 롤에만 준다.
revoke all on function public.admin_search_goods_notice_sources(text, text, uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_goods_notice_sources(text, text, uuid, text, integer, integer) to authenticated;

select private.register_operator_rpc_contract(
  'public.admin_search_goods_notice_sources(text,text,uuid,text,integer,integer)'::regprocedure, 'catalog.read', 'read', false
);
