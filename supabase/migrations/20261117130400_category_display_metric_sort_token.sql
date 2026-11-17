-- 카테고리 전시 인기도순·판매량순·리뷰 많은순의 VIEW MORE 가 위시·판매·리뷰 한 건에 PT409 로 깨지던 것을 고친다(PR2 리뷰 C M1).
--
-- 조회 토큰(fingerprint)은 `string_agg(id:가격:재고:updated_at ... order by rank)` 로 전체 순위 순서를 해시했다.
-- 세 정렬은 원수치(최근 30일 판매+위시 / 누적 판매 / 공개 리뷰)가 순위를 만들기 때문에 위시 한 건만 생겨도 순서가 바뀌어
-- 첫 페이지의 토큰과 둘째 페이지의 토큰이 어긋났다. 이제 세 정렬일 때는 토큰이 순위가 아니라 구성(굿즈 id 집합, id 순)을 해시한다.
-- 구성이 같으면 순위가 움직여도 페이징이 이어지고(클라이언트가 이미 받은 id 는 거르므로 어긋남은 중복·누락 한두 건에 그친다),
-- 굿즈가 더해지거나 빠지거나 가격·재고·수정 시각이 바뀌면 지금처럼 PT409 다. 다른 정렬(추천·이름·가격·최신·오래된)은 한 글자도 바뀌지 않는다.
--
-- 현재 유효 본문(20261023040100 → 20261028131000 → 20261105093418 → 20261117130100)에서 한 곳만 바꾼다.
-- 앵커는 현재 본문에 정확히 한 번 있어야 한다(없거나 둘 이상이면 예외). pg_get_functiondef → replace → execute.
begin;

do $$
declare
  body text;
  anchor constant text := $a$string_agg(id||':'||current_price||':'||available||':'||updated_at,',' order by rank)$a$;
  replacement constant text := $a$string_agg(id||':'||current_price||':'||available||':'||updated_at,',' order by (case when p_query->>'sort' in('popular','sales','reviews') then id end) collate "C",rank)$a$;
begin
  body := pg_get_functiondef('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure);
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'category_display_metric_sort_token_anchor_missing: %', anchor;
  end if;
  execute replace(body, anchor, replacement);
end $$;
revoke all on function private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure);

commit;
