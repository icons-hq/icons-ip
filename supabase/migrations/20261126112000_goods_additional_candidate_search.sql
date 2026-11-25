-- 추가구성상품 선택창: 지금 연결할 수 있는 상품만 찾는다.
--
-- 추가구성상품 선택창을 공용 상품 선택창(검색·사진·20개씩 페이지)으로 바꾸면서 조회가 보관하지 않은 모든 상품을 보여 주게 됐다.
-- 품절·판매기간 밖·판매 중지·공개 전 상품도 목록과 총 개수에 들어가고, 고른 뒤에야 거절했다.
-- 고를 수 없는 상품은 조회에서 뺀다(docs/admin-screen-rules.md 규칙 2). 화면에서 거르면 총 개수와 페이지가 어긋나므로 DB가 거른다.
--
-- 기존 후보 검색 admin_search_goods_additional(text,text)은 고치지 않는다(이름·내부 번호 검색, 50개까지, 페이지 없음 — 고른 상품을
-- 저장 전에 한 번 더 확인하는 데 계속 쓴다). 여기서는 검색(상품명·상품 자동코드와 옵션 자동코드·상품 URL)·카테고리(하위와 추가 카테고리 포함)·
-- 보관 제외를 상품 조회/수정과 같은 내부 조회(private.admin_goods_console_matches)로 하고, 그 위에 조건 두 개만 더한다.
--   1. private.goods_additional_available: 저장 함수(admin_save_goods_additional)와 주문이 쓰는 '지금 고객이 살 수 있음'과 같은 판정이다
--      (공개 중·IP 공개·판매 제한 없음·판매 중지 아님·결제수단 있음·살 수 있는 수량이 있는 옵션 있음).
--   2. p_base_good_id(지금 편집 중인 상품)는 자기 자신을 연결할 수 없으므로 뺀다. 저장 전인 새 상품은 null이다.
--
-- 권한은 기존 후보 검색과 같은 catalog.read 읽기다. 정렬은 등록일 최신순(선택창 고정)이다.

create function public.admin_search_goods_additional_candidates(
  p_base_good_id text default null,
  p_query text default '',
  p_field text default 'name',
  p_category_id uuid default null,
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
    raise invalid_parameter_value using message = 'invalid_goods_additional_candidate_page';
  end if;
  if p_field is null or p_field not in ('name', 'code', 'id')
    or char_length(coalesce(p_query, '')) > 100 or char_length(coalesce(p_base_good_id, '')) > 200 then
    raise invalid_parameter_value using message = 'invalid_goods_additional_candidate_filter';
  end if;

  with matched as materialized (
    select (source.good).id, (source.good).code, (source.good).name, (source.good).category_id,
      (source.good).image_path, (source.good).published_at, (source.good).archived_at, (source.good).created_at
    from private.admin_goods_console_matches(
      coalesce(p_query, ''), '', 'active', 'all', p_category_id, 'all', jsonb_build_object('field', p_field)
    ) source
    where (p_base_good_id is null or (source.good).id <> p_base_good_id)
      and private.goods_additional_available((source.good).id)
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
revoke all on function public.admin_search_goods_additional_candidates(text, text, text, uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_goods_additional_candidates(text, text, text, uuid, integer, integer) to authenticated;

select private.register_operator_rpc_contract(
  'public.admin_search_goods_additional_candidates(text,text,text,uuid,integer,integer)'::regprocedure, 'catalog.read', 'read', false
);
