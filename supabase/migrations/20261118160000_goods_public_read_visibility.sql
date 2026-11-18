-- ==========================================================================
-- ICONS · 공개 Data API의 상품 읽기를 공개 상태로 좁힌다 (CAT-063 · CUS-045 · #451 · #210)
--
-- 20260617090001의 goods_read(using true)가 재정의 없이 남아, 공개 anon 키로 REST를 직접
-- 부르면 초안·보관·19금 상품의 이름·가격·이미지 경로·상세 설명·고시가 그대로 읽혔다. 목록·
-- 상세·검색의 비노출은 앱 쿼리 층에만 있었다(20261105093418 머리말의 "별도 후속").
--
-- 이 migration이 DB 경계로 고정하는 것:
--   1. 고객·익명(anon·authenticated)은 공개 상품만 읽는다. 공개 = 게시됨(published_at)·
--      미보관·부모 IP 게시·미보관·판매 제한 판정 통과(19금은 유효한 성인 인증이 있는 본인만,
--      private.good_sale_restriction_visible). 이 판정은 goods_public_read 정책 한 곳에 있다.
--   2. 운영자(catalog.read)는 지금처럼 초안·보관·19금을 모두 읽는다. 운영 화면은 사용자
--      세션으로 goods를 읽으므로 이 갈래가 없으면 상품 목록·편집·미리보기가 비어 보인다.
--   3. 옵션(goods_variants) 공개 읽기는 부모 상품이 그 세션에 보일 때만이다. 정책 안의
--      goods 조회에도 goods RLS가 그대로 적용되므로 판정을 다시 쓰지 않고 상속한다 —
--      기존 정책에 없던 "초안 상품의 옵션" 차단이 함께 생긴다.
--   4. 사용자 세션이 goods를 직접 읽던 고객 표면 중 공개가 아닌 상품을 읽어야 하는 곳은
--      좁은 security definer 읽기로 옮긴다.
--        - get_masked_adult_goods: 인증 전 방문자의 19금 가림 카드(ADR-0024). 화면이 이미
--          내보내는 값(IP·판매가·재고 상태·순서·분류)만 돌려준다 — 이름·이미지·배지는 없다.
--        - my_order_line_goods: 본인 주문 품목 줄의 썸네일·IP·판매 제한(MD-0036). 상품이
--          나중에 내려가거나 19금 인증이 만료돼도 본인이 산 줄은 지금처럼 보강된다.
--        - get_random_option_good_ids: 선물 품목의 랜덤 판매 옵션명 가림(ADR-0027). 상품이
--          내려가도 실제 배정 옵션명이 새지 않게 판매 방식만 돌려준다(fail-closed 유지). 공개가
--          아닌 상품은 호출자 본인의 선물(보낸·받은·초대 세션) 품목에 있을 때만 답한다.
--   5. 같은 경계를 우회하던 공개 읽기를 닫는다.
--        - 계산 열 goods_random_option(goods)은 위조한 goods 행으로 RPC를 직접 부르면 초안 랜덤
--          상품의 가격·재고를 돌려줬다(게시 조건이 없었다). 게시 조건을 더한다. goods·옵션 행을
--          인자로 받는 다른 공개 계산 열(가격·공급·판매 기간·추가 구성)은 이미 공개 판정이 있고,
--          재고 합계·운영자 계산 열은 catalog.read를 요구한다.
--        - reward_policies(using true)는 초안·19금 대상 상품 id를 익명에게 나열했다. 고객 화면은
--          이 표를 읽지 않으므로(운영 콘솔은 정의자 RPC) 대상 상품이 그 세션에 보이는 행만 연다.
--
-- 범위 밖(이 migration이 바꾸지 않는 것):
--   - ips·cards·events 공개 읽기(#451의 나머지)와 public-media 공개 버킷의 직접 URL.
--   - reviews·product_questions 공개 읽기. 묶음 상품 리뷰(get_good_group_reviews_v3)는 보관된
--     구성 상품의 리뷰도 함께 보이고, 그 사진은 열람자 세션으로 서명한다. 리뷰 공개 읽기를
--     부모 공개에 묶으면 그 사진이 깨진다 — 별도 설계가 필요하다.
--   - 주문·장바구니·찜·리뷰·선물·정기구매·클레임·알림·영수증 RPC. 모두 security definer라
--     RLS를 우회하고 주문 시점 스냅샷을 읽으므로 이 정책과 무관하다.
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1. goods 읽기
-- ---------------------------------------------------------------------------
drop policy goods_read on public.goods;

-- 판정 순서: 열 조건 → 판매 제한(일반 상품은 helper를 부르지 않고 통과) → 부모 IP. 목록
-- 쿼리에서 행마다 도는 비용을 줄이려고 함수 한 번 호출 대신 인라인으로 쓴다(3,000행 실측
-- 기준 security definer 함수 정책보다 약 5배 빠르다).
create policy goods_public_read on public.goods
  for select
  to anon, authenticated
  using (
    published_at is not null
    and archived_at is null
    and (
      sale_restriction = 'none'::public.goods_sale_restriction
      or public.good_sale_restriction_visible_to_viewer(sale_restriction)
    )
    and exists (
      select 1
      from public.ips ip
      where ip.id = goods.ip_id
        and ip.published_at is not null
        and ip.archived_at is null
    )
  );

create policy goods_operator_read on public.goods
  for select
  to authenticated
  using ((select public.has_operator_capability('catalog.read')));

-- ---------------------------------------------------------------------------
-- 2. 옵션 공개 읽기 — 부모 상품의 공개 판정을 상속한다
-- ---------------------------------------------------------------------------
-- 이 하위 조회는 조회하는 롤의 goods RLS를 거친다. 그래서 익명·회원에게는 goods_public_read가,
-- 운영자에게는 goods_operator_read가 적용된다. 보관 옵션은 계속 운영자 정책으로만 보인다.
-- goods_variants_random_private_read(restrictive)는 그대로다 — 보이지 않는 랜덤 상품은 이
-- 정책이 먼저 막고, 보이는 랜덤 상품은 그 정책이 막는다.
drop policy goods_variants_public_read on public.goods_variants;
create policy goods_variants_public_read on public.goods_variants
  for select
  to anon, authenticated
  using (
    archived_at is null
    and exists (
      select 1
      from public.goods good
      where good.id = goods_variants.good_id
    )
  );

-- ---------------------------------------------------------------------------
-- 3. 19금 가림 카드 읽기
-- ---------------------------------------------------------------------------
-- 성인 인증이 열려 있고 인증 전인 방문자의 목록에는 이름·이미지 없는 "19" 카드가 놓인다.
-- 지금까지 앱은 goods 행 전체를 읽어 서버에서 가렸다. 이제 그 행은 RLS가 막으므로 가림
-- 카드가 쓰는 열만 돌려준다. 상세의 인증 안내 판정(p_good_id)도 같은 함수다.
create function public.get_masked_adult_goods(p_good_id text default null)
returns table (
  id text,
  ip_id text,
  display_order integer,
  category_id uuid,
  price integer,
  stock text,
  stock_qty integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select good.id, good.ip_id, good.display_order, good.category_id, good.price, good.stock, good.stock_qty, good.created_at
  from public.goods good
  join public.ips ip on ip.id = good.ip_id
  where good.sale_restriction = 'adult'::public.goods_sale_restriction
    and good.published_at is not null
    and good.archived_at is null
    and ip.published_at is not null
    and ip.archived_at is null
    and (p_good_id is null or good.id = p_good_id)
  order by good.id;
$function$;

comment on function public.get_masked_adult_goods(text) is
  '인증 전 방문자의 19금 가림 카드(ADR-0024)가 쓰는 공개 성인 상품의 최소 열. 이름·이미지·배지·옵션은 돌려주지 않는다.';

revoke all on function public.get_masked_adult_goods(text) from public, anon, authenticated, service_role;
grant execute on function public.get_masked_adult_goods(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 본인 주문 품목 줄의 상품 보강
-- ---------------------------------------------------------------------------
-- 주문 목록·상세·선물 보낸 내역의 품목 줄은 썸네일·IP명·19금 가림을 goods에서 읽는다.
-- 본인 주문에 담긴 상품이면 지금 공개 상태와 상관없이 돌려준다. 주문은 공개 상태를 검사하는
-- 주문 RPC로만 생기므로 이 관계로 초안 상품을 새로 열 수 없다(찜·장바구니·문의 행은 직접
-- 쓸 수 있어 관계 근거로 쓰지 않는다). 19금 이미지는 앱이 sale_restriction으로 계속 가린다.
create function public.my_order_line_goods(p_good_ids text[])
returns table (
  id text,
  ip_id text,
  image_path text,
  bg text,
  sale_restriction public.goods_sale_restriction
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    raise insufficient_privilege using message = 'auth required';
  end if;
  if p_good_ids is null or cardinality(p_good_ids) > 1000 then
    raise invalid_parameter_value using message = 'invalid_order_line_goods';
  end if;
  return query
  select good.id, good.ip_id, good.image_path, good.bg, good.sale_restriction
  from public.goods good
  where good.id = any(p_good_ids)
    and good.id in (
      select item.good_id
      from public.orders parent
      join public.order_items item on item.order_id = parent.id
      where parent.user_id = actor
        and item.good_id = any(p_good_ids)
    )
  order by good.id;
end;
$function$;

comment on function public.my_order_line_goods(text[]) is
  '본인 주문(선물로 보낸 주문 포함)에 담긴 상품의 품목 줄 보강 값. 공개 상태와 무관하게 돌려준다(MD-0036).';

revoke all on function public.my_order_line_goods(text[]) from public, anon, authenticated, service_role;
grant execute on function public.my_order_line_goods(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 선물 품목의 랜덤 판매 여부
-- ---------------------------------------------------------------------------
-- 선물 화면은 랜덤 판매로 바뀐 상품의 품목 스냅샷 옵션명을 '랜덤'으로 가린다. 판매 방식을
-- 못 읽으면 가리지 못하므로, 상품이 내려가도 판매 방식은 읽혀야 한다. 다만 아무 id나 넣어
-- 초안·보관 랜덤 상품의 존재를 확인하지 못하게, 넘긴 id 중 다음에 해당하는 랜덤 판매 상품만
-- 답한다: 지금 그 세션에 공개인 상품, 호출자가 보내거나 받은 선물의 품목, 호출자가 연 선물
-- 초대 세션(p_gift_session_hash)의 품목. 선물 화면은 모두 로그인 뒤라 익명에는 열지 않는다.
create function public.get_random_option_good_ids(p_good_ids text[], p_gift_session_hash text default null)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
  invited_gift uuid;
begin
  if actor is null then
    raise insufficient_privilege using message = 'auth required';
  end if;
  if p_good_ids is null or cardinality(p_good_ids) > 1000 then
    raise invalid_parameter_value using message = 'invalid_random_option_goods';
  end if;
  if p_gift_session_hash is not null then
    invited_gift := private.gift_session_id(p_gift_session_hash, statement_timestamp());
  end if;
  return query
  select good.id
  from public.goods good
  join public.ips ip on ip.id = good.ip_id
  where good.id = any(p_good_ids)
    and good.option_sale_mode = 'random'
    and (
      (good.published_at is not null and good.archived_at is null
        and ip.published_at is not null and ip.archived_at is null
        and private.good_sale_restriction_visible(good.sale_restriction, actor))
      or exists (
        select 1
        from private.gift_items item
        join private.gift_intents gift on gift.id = item.gift_id
        where item.good_id = good.id
          and (gift.sender_id = actor or gift.recipient_id = actor or gift.id = invited_gift)
      )
    )
  order by good.id;
end;
$function$;

comment on function public.get_random_option_good_ids(text[], text) is
  '넘긴 상품 id 중 랜덤 판매(ADR-0027)인 것. 공개 상품이거나 호출자 본인 선물(보낸·받은·초대 세션)의 품목일 때만 답한다.';

revoke all on function public.get_random_option_good_ids(text[], text) from public, anon, authenticated, service_role;
grant execute on function public.get_random_option_good_ids(text[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. 계산 열 goods_random_option — 게시 조건
-- ---------------------------------------------------------------------------
-- 계산 열은 PostgREST에서 RPC로도 불린다(POST /rpc/goods_random_option {"good":{"id":...}}).
-- 인자 행은 호출자가 지어낼 수 있으므로 본문이 id로 다시 읽은 행에 공개 판정을 건다. 지금
-- 본문에는 보관·IP·판매 제한 조건만 있고 게시 조건이 빠져 있다. 본문은 앵커 치환으로만 고친다.
create function private.t5_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $helper$
declare definition text := pg_catalog.pg_get_functiondef(p_function); i integer;
begin
  if pg_catalog.array_length(p_pairs, 1) is null or pg_catalog.array_length(p_pairs, 1) % 2 <> 0 then
    raise exception 't5 patch pairs';
  end if;
  for i in 1 .. pg_catalog.array_length(p_pairs, 1) / 2 loop
    if (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, p_pairs[2 * i - 1], '')))
      / pg_catalog.length(p_pairs[2 * i - 1]) <> 1 then
      raise exception 't5_anchor_changed: % anchor % must appear once', p_function, i;
    end if;
    definition := pg_catalog.replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
  if exists (select 1 from private.operator_internal_contracts contract where contract.signature::regprocedure = p_function) then
    perform private.register_operator_internal_contract(p_function);
  end if;
end $helper$;
revoke all on function private.t5_patch_function(regprocedure, text[]) from public, anon, authenticated, service_role;

select private.t5_patch_function('public.goods_random_option(public.goods)'::regprocedure, array[
$a$  where current_good.id=good.id and current_good.option_sale_mode='random' and current_good.archived_at is null$a$,
$a$  where current_good.id=good.id and current_good.option_sale_mode='random' and current_good.archived_at is null
    and current_good.published_at is not null$a$
]);

drop function private.t5_patch_function(regprocedure, text[]);

-- ---------------------------------------------------------------------------
-- 7. 뽑기권 발급 정책 — 대상 상품이 보이는 행만
-- ---------------------------------------------------------------------------
-- 고객 화면은 이 표를 읽지 않는다(발급은 주문 확정 정의자 경로, 운영 콘솔은 admin_list_reward_policies).
-- 상품 대상 정책은 대상 상품이 그 세션에 보일 때만(하위 조회가 goods RLS를 거친다), IP 단위 정책은 그대로다.
drop policy reward_policies_read on public.reward_policies;
create policy reward_policies_public_read on public.reward_policies
  for select
  to anon, authenticated
  using (
    target_good_id is null
    or exists (
      select 1
      from public.goods good
      where good.id = reward_policies.target_good_id
    )
  );
create policy reward_policies_operator_read on public.reward_policies
  for select
  to authenticated
  using ((select public.has_operator_capability('catalog.read')));

-- ---------------------------------------------------------------------------
-- 8. 운영자 정책 계약
-- ---------------------------------------------------------------------------
select private.register_operator_policy_contract('public.goods'::regclass, 'goods_operator_read', 'catalog.read');
select private.register_operator_policy_contract('public.reward_policies'::regclass, 'reward_policies_operator_read', 'catalog.read');
