-- 카테고리 전시 목록의 정렬에 인기도순·판매량순·리뷰 많은순을 더한다(스펙 C §4.2).
--
-- 화이트리스트 7종 → 10종. 세 정렬은 private.goods_listing_metrics()(20261117130000)의 원수치로 줄 세운다:
--   popular = 최근 30일 유효 판매 수량 + 위시 수, sales = 누적 유효 판매 수량, reviews = 공개 리뷰 수.
-- 동률(원수치가 없는 굿즈 포함 — 성인 굿즈처럼 metrics 에 없으면 맨 뒤)은 기존 꼬리 정렬식 = 구성 순서·id 로 떨어진다.
-- 클라이언트 정렬 목록(전체·NEW·BEST)의 2차 키(리뷰·위시·등록 최신)는 서버 정렬식 복잡도 대비 이득이 작아 전시 목록에서는 생략한다.
-- metrics CTE 는 세 정렬 중 하나가 고른 행에서만 읽힌다(그 외 정렬은 원수치 집계를 돌리지 않는다).
--
-- 현재 유효 본문(20261023040100 → 20261028131000 → 20261105093418)에서 세 곳만 바꾼다. 앵커는 현재 본문에 정확히 한 번씩 있어야 한다.
-- goods_type_other 와 같은 방식: pg_get_functiondef → replace → execute, 앵커가 한 번이 아니면 예외.
begin;

do $$
declare
  body text;
  anchors text[] := array[
    $a$'recommended','name_asc','name_desc','price_asc','price_desc','oldest','newest'$a$,
    $a$), ranked as materialized ($a$,
    $a$   case when p_query->>'sort'='price_asc' then current_price end asc,$a$
  ];
  replacements text[] := array[
    $a$'recommended','name_asc','name_desc','price_asc','price_desc','oldest','newest','popular','sales','reviews'$a$,
    $a$), metrics as materialized (select * from private.goods_listing_metrics()), ranked as materialized ($a$,
    $a$   case when p_query->>'sort'='popular' then (select coalesce(m.sales_30d,0)+coalesce(m.wish_count,0) from metrics m where m.good_id=filtered.id) end desc nulls last,
   case when p_query->>'sort'='sales' then (select m.sales_total from metrics m where m.good_id=filtered.id) end desc nulls last,
   case when p_query->>'sort'='reviews' then (select m.review_count from metrics m where m.good_id=filtered.id) end desc nulls last,
   case when p_query->>'sort'='price_asc' then current_price end asc,$a$
  ];
  i integer;
begin
  body := pg_get_functiondef('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure);
  for i in 1..array_length(anchors, 1) loop
    if (length(body) - length(replace(body, anchors[i], ''))) / length(anchors[i]) <> 1 then
      raise exception 'category_display_listing_sorts_anchor_missing: %', anchors[i];
    end if;
    body := replace(body, anchors[i], replacements[i]);
  end loop;
  execute body;
end $$;
revoke all on function private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure);

commit;
