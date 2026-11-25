-- 다른 상품 옵션 불러오기 선택창: 불러올 선택형 옵션이 있는 상품만 찾는다.
--
-- 지금까지 선택창은 admin_search_goods_console(p_status => 'active')로 보관하지 않은 상품을 모두 보여 줬다.
-- 옵션 없이 파는 상품도 목록에 나왔고, 고르면 "불러올 수 있는 선택형 옵션이 없습니다"로 거절했다.
-- 고를 수 없는 상품은 조회에서 뺀다(docs/admin-screen-rules.md 규칙 2). 화면에서 거르면 총 개수와 페이지가 어긋나므로 DB가 거른다.
--
-- admin_search_goods_console은 고치지 않는다 — 상품 조회/수정·공용 상품 선택창·복사등록의 결과는 그대로다.
-- 검색(상품명·상품 자동코드와 옵션 자동코드·상품 URL)·카테고리(하위와 추가 카테고리 포함)·보관 제외는 상품 조회/수정과 같은
-- 내부 조회(private.admin_goods_console_matches)를 불러 같은 검색의 결과가 갈라지지 않게 하고, 그 위에 조건 두 개만 더한다.
--   1. 사용 중인(archived_at is null) 옵션 가운데 옵션값이 있는(attributes <> '{}') 옵션이 하나라도 있다.
--      옵션 없이 파는 상품(옵션값 없는 한 줄뿐)·옵션이 모두 사용 중지된 상품이 빠진다.
--   2. p_exclude_good_id(지금 편집 중인 상품)는 자기 옵션을 불러올 수 없으므로 뺀다.
-- 옵션명 구성이 옵션마다 다르거나 같은 옵션값이 겹친 드문 상품은 여기서 거르지 않는다 — 고르면 앱이 원인을 가려 알린다.
--
-- 권한은 옵션을 불러오는 서버 액션(상품 편집 = catalog.manage)과 같다. 정렬은 등록일 최신순(선택창 고정)이다.

create function public.admin_search_goods_option_sources(
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
  if (select auth.uid()) is null or not coalesce(public.has_operator_capability('catalog.manage', false), false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise invalid_parameter_value using message = 'invalid_goods_option_source_page';
  end if;
  if p_field is null or p_field not in ('name', 'code', 'id')
    or char_length(coalesce(p_query, '')) > 100 or char_length(coalesce(p_exclude_good_id, '')) > 100 then
    raise invalid_parameter_value using message = 'invalid_goods_option_source_filter';
  end if;

  with matched as materialized (
    select (source.good).id, (source.good).code, (source.good).name, (source.good).category_id,
      (source.good).image_path, (source.good).published_at, (source.good).archived_at, (source.good).created_at
    from private.admin_goods_console_matches(
      coalesce(p_query, ''), '', 'active', 'all', p_category_id, 'all', jsonb_build_object('field', p_field)
    ) source
    where (p_exclude_good_id is null or (source.good).id <> p_exclude_good_id)
      and exists (
        select 1 from public.goods_variants variant
        where variant.good_id = (source.good).id
          and variant.archived_at is null
          and variant.attributes <> '{}'::jsonb
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
revoke all on function public.admin_search_goods_option_sources(text, text, uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_goods_option_sources(text, text, uuid, text, integer, integer) to authenticated;

select private.register_operator_rpc_contract(
  'public.admin_search_goods_option_sources(text,text,uuid,text,integer,integer)'::regprocedure, 'catalog.manage', 'read', false
);
