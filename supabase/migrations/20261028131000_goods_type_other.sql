-- R10 (MD-0003): 상품 유형에 '기타'를 더한다.
-- lib/goods-taxonomy.ts의 GOOD_TYPES와 같은 목록이어야 한다. CHECK와 고객 분류 필터 RPC(화이트리스트·개수 상한·
-- 필터 칩 정렬)를 한 migration에서 함께 바꾼다. 고객 필터 칩은 '기타' 상품이 공개되면 자동으로 나온다(개수 > 0).
-- 추가 유형(H7)도 같은 방식으로 넣는다.
begin;

alter table public.goods drop constraint goods_type_check;
alter table public.goods add constraint goods_type_check check (
 type in ('피규어','인형','키링','아크릴','문구','쿠션','파우치','세트','기타') or (published_at is null and type='')
);

-- 현재 유효 본문(20261023040100)에서 유형 목록 세 곳만 바꾼다: 개수 상한(9종+예약판매 → 10), 화이트리스트, 칩 정렬.
do $$
declare
  body text;
  anchors text[] := array[
    $a$jsonb_array_length(p_query->'types')>9$a$,
    $a$not in('피규어','인형','키링','아크릴','문구','쿠션','파우치','세트','예약판매')$a$,
    $a$array['피규어','인형','키링','아크릴','문구','쿠션','파우치','세트']$a$
  ];
  replacements text[] := array[
    $a$jsonb_array_length(p_query->'types')>10$a$,
    $a$not in('피규어','인형','키링','아크릴','문구','쿠션','파우치','세트','기타','예약판매')$a$,
    $a$array['피규어','인형','키링','아크릴','문구','쿠션','파우치','세트','기타']$a$
  ];
  i integer;
begin
  body := pg_get_functiondef('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure);
  for i in 1..array_length(anchors, 1) loop
    if (length(body) - length(replace(body, anchors[i], ''))) / length(anchors[i]) <> 1 then
      raise exception 'goods_type_other_anchor_missing: %', anchors[i];
    end if;
    body := replace(body, anchors[i], replacements[i]);
  end loop;
  execute body;
end $$;
revoke all on function private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure);

commit;
