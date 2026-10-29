-- ==========================================================================
-- ICONS · 19금 굿즈 판매 개방 — 성인 인증이 노출·구매 경계를 연다
--
-- 20260901120000(#392)은 성인 상품('adult')을 스토어 전 표면에서 감추고 주문
-- 생성에서 무조건 막았다. 성인 인증(20261028235317, ADR-0024)이 생겼으므로 그
-- 무조건 차단을 "유효한 성인 인증이 있는 계정" 조건으로 바꾼다.
--
-- 이 마이그레이션이 DB 안에서 고정하는 것:
--   1. 판정은 private.good_sale_restriction_visible(유형, 계정) 하나다. 제한 없음은
--      누구에게나, 성인 상품은 private.adult_verification_valid(계정)인 계정에게만 보인다.
--      다른 제한 유형(추후)은 계속 닫힌다.
--   2. 구매 경로(장바구니 담기·상세의 담기·쿠폰 소계·견적·새 거래 계산·주문 생성)는
--      인증 성인만 성인 상품을 통과시킨다. 19금 굿즈는 추가 구성으로는 쓰지 않는다. 담기와 새 거래 계산은 일반 품절과 구분되는 오류
--      (adult_verification_required)로, 주문 생성은 'adult verification required:'로 알린다.
--   3. 상세 화면 RPC(가격·재고·판매 기간·미디어·고시·배송·혜택 등)는 인증 성인에게만
--      성인 상품 데이터를 돌려준다. 미인증 세션에는 지금처럼 비어 있다.
--   4. 검색·목록 외형·카테고리 전시는 인증 성인에게만 성인 상품을 포함한다. 미인증
--      방문자의 가림 카드는 DB가 아니라 앱이 카탈로그 행을 가려 만든다.
--   5. 옵션 행(goods_variants) 공개 읽기 RLS도 같은 판정이다. 인증 성인만 성인 상품의
--      옵션을 읽어 고르고 담을 수 있다.
--   6. 어드민 준비 상태에서 성인 상품은 더 이상 판매 차단 사유가 아니다(다른 제한 유형은 차단).
--   7. 홈 랭킹·큐레이션·쇼핑스토리·마케팅·리뷰 이벤트·선물·정기배송·추가상품·알림은
--      바꾸지 않는다 — 계속 'none'만 다룬다. 선물은 받는 사람이 성인인지 알 수 없다.
--
-- 판정 계정은 호출 맥락을 따른다. 로그인 세션이 부르는 함수는 auth.uid(), service role
-- 래퍼가 부르는 새 거래 계산은 p_actor, 쿠폰 소계는 p_user_id, 주문 생성은 래퍼가
-- 세운 v_user다.
--
-- 기존 함수는 본문을 통째로 다시 쓰지 않는다. 현재 정의(pg_get_functiondef)에서 판정 줄만
-- 앵커 치환해 다시 실행한다 — 다른 migration이 같은 함수를 고친 내용(쿠폰 IP 대상·장바구니
-- 유지·랜덤 판매·구매 한도 등)이 함께 남고, 앵커가 사라지면 조용히 덮어쓰지 않고 실패한다.
-- create or replace라 실행 권한은 그대로다. 랜덤 판매 옵션은 계속 판매 제한 굿즈를 막는다.
--
-- 보안 경계는 여전히 2번이다. 목록·상세 노출은 쿼리 레이어이고 goods 테이블은 공개
-- 읽기라, 성인 상품 메타데이터의 Data API 노출 차단은 별도 후속(#210)이다.
-- ==========================================================================

create function private.good_sale_restriction_visible(
  p_restriction public.goods_sale_restriction,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_restriction = 'none'
    or (p_restriction = 'adult' and private.adult_verification_valid(p_user_id));
$function$;

comment on function private.good_sale_restriction_visible(public.goods_sale_restriction, uuid) is
  '판매 제한 상품을 이 계정에 보이거나 팔아도 되는가. 성인 상품은 유효한 성인 인증이 있어야 한다.';

-- 호출자는 모두 함수 소유자로 도는 security definer 본문이다. 브라우저 롤에는 열지 않는다.
revoke all on function private.good_sale_restriction_visible(public.goods_sale_restriction, uuid)
  from public, anon, authenticated, service_role;

-- RLS 정책은 조회하는 롤 권한으로 평가되고 anon에는 private 스키마 사용 권한이 없다.
-- 정책 전용으로 현재 세션(auth.uid())만 판정하는 공개 helper를 둔다. 돌려주는 것은
-- "지금 이 세션이 그 유형을 볼 수 있는가"뿐이라 다른 계정의 인증 여부는 드러나지 않는다.
create function public.good_sale_restriction_visible_to_viewer(p_restriction public.goods_sale_restriction)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.good_sale_restriction_visible(p_restriction, (select auth.uid()));
$function$;

revoke all on function public.good_sale_restriction_visible_to_viewer(public.goods_sale_restriction)
  from public, anon, authenticated, service_role;
grant execute on function public.good_sale_restriction_visible_to_viewer(public.goods_sale_restriction)
  to anon, authenticated;

-- 옵션 행 공개 읽기. 20260908020855 정책이 성인 상품의 옵션을 모두에게 감췄다 — 그대로
-- 두면 인증 성인도 옵션을 고르지 못해 담을 수 없다. 일반 상품 조건을 앞에 두어 기존
-- 행은 helper를 부르지 않고 통과한다.
drop policy goods_variants_public_read on public.goods_variants;
create policy goods_variants_public_read on public.goods_variants
  for select
  to anon, authenticated
  using (
    archived_at is null
    and exists (
      select 1
      from public.goods good
      join public.ips ip on ip.id = good.ip_id
      where good.id = goods_variants.good_id
        and good.archived_at is null
        and (
          good.sale_restriction = 'none'::public.goods_sale_restriction
          or public.good_sale_restriction_visible_to_viewer(good.sale_restriction)
        )
        and ip.archived_at is null
        and ip.published_at is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 판정 치환 helper(이 migration 안에서만 쓰고 끝에서 지운다)
-- ---------------------------------------------------------------------------
create function private.adult_goods_patch(p_function regprocedure, p_patches jsonb)
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
      raise exception 'adult_goods_anchor_changed: % (% matches)', p_function, v_found;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;

revoke all on function private.adult_goods_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 구매 경로 — 장바구니 담기·쿠폰 소계·견적·주문
-- ---------------------------------------------------------------------------

-- private.set_cart_quantity_with_inputs
select private.adult_goods_patch('private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  snapshot:=private.resolve_goods_custom_inputs(p_good_id,p_input_revision,p_input_values);$anchor$,
    $patched$  -- 성인 상품은 유효한 성인 인증이 있어야 담긴다. 일반 품절·비공개와 구분되는 오류로
  -- 알려야 화면이 인증 안내로 보낼 수 있다(ADR-0024).
  if exists(select 1 from public.goods restricted where restricted.id=p_good_id and restricted.sale_restriction='adult'
    and not private.adult_verification_valid(actor)) then raise check_violation using message='adult_verification_required'; end if;
  snapshot:=private.resolve_goods_custom_inputs(p_good_id,p_input_revision,p_input_values);$patched$),
  jsonb_build_array(
    $anchor$      and good.published_at is not null and good.archived_at is null and good.sale_restriction='none'$anchor$,
    $patched$      and good.published_at is not null and good.archived_at is null and private.good_sale_restriction_visible(good.sale_restriction,actor)$patched$)));

-- private.cart_subtotal
select private.adult_goods_patch('private.cart_subtotal(uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  join public.goods good on good.id=cart.good_id and good.archived_at is null and good.published_at is not null and good.sale_restriction='none'$anchor$,
    $patched$  join public.goods good on good.id=cart.good_id and good.archived_at is null and good.published_at is not null and private.good_sale_restriction_visible(good.sale_restriction,p_user_id)$patched$)));

-- private.goods_sales_conditions_core
select private.adult_goods_patch('private.goods_sales_conditions_core(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$      where g.id=line.good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$      where g.id=line.good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- private.quote_goods_sales_before_preorder
select private.adult_goods_patch('private.quote_goods_sales_before_preorder(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$      where g.id=line.good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$      where g.id=line.good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- private.quote_goods_shipping_before_preorder
select private.adult_goods_patch('private.quote_goods_shipping_before_preorder(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$      where g.id=input.value->>'goodId' and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$      where g.id=input.value->>'goodId' and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- private.calculate_goods_transaction_locked
select private.adult_goods_patch('private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$   where g.id=entry->>'goodId' and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$   where g.id=entry->>'goodId' and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,p_actor)$patched$),
  jsonb_build_array(
    $anchor$  if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',entry->>'goodId')));end if;$anchor$,
    $patched$  if not found then
   if exists(select 1 from public.goods restricted where restricted.id=entry->>'goodId' and restricted.sale_restriction='adult'
     and not private.adult_verification_valid(p_actor)) then
    return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','adult_verification_required','goodId',entry->>'goodId')));
   end if;
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',entry->>'goodId')));
  end if;$patched$)));

-- private.place_order_before_shipments
select private.adult_goods_patch('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    -- 성인인증(#209·#210)이 도입되기 전까지 판매 제한 상품은 서버가 구매를
    -- 차단한다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개로 판정한다.
    if r.sale_restriction <> 'none' then
$anchor$,
    $patched$    -- 성인 상품은 유효한 성인 인증(ADR-0024)이 있는 계정만 주문한다. 그 밖의 판매
    -- 제한 유형은 계속 막는다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개다.
    if r.sale_restriction = 'adult' and not private.adult_verification_valid(v_user) then
      raise check_violation using message = format('adult verification required: %s', r.good_id);
    elsif r.sale_restriction not in ('none', 'adult') then
$patched$)));

-- ---------------------------------------------------------------------------
-- 상세 화면 — 가격·재고·판매 기간과 상세 구성 RPC
-- ---------------------------------------------------------------------------

-- public.goods_variant_pricing
select private.adult_goods_patch('goods_variant_pricing(goods_variants)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    and good.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null$anchor$,
    $patched$    and private.good_sale_restriction_visible(good.sale_restriction,(select auth.uid())) and ip.archived_at is null and ip.published_at is not null$patched$)));

-- public.goods_variant_supply
select private.adult_goods_patch('goods_variant_supply(goods_variants)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    and good.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null;$anchor$,
    $patched$    and private.good_sale_restriction_visible(good.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null;$patched$)));

-- public.goods_sale_period
select private.adult_goods_patch('goods_sale_period(goods)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  and current_good.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null;$anchor$,
    $patched$  and private.good_sale_restriction_visible(current_good.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null;$patched$)));

-- public.get_product_detail_presentation
select private.adult_goods_patch('get_product_detail_presentation(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ where g.id=p_good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$ where g.id=p_good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$),
  jsonb_build_array(
    $anchor$   where g.id<>p_good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$   where g.id<>p_good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- public.get_product_detail_experience
select private.adult_goods_patch('get_product_detail_experience(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ where g.id=p_good_id and g.published_at is not null and g.archived_at is null and g.sale_restriction='none'$anchor$,
    $patched$ where g.id=p_good_id and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$),
  jsonb_build_array(
    $anchor$   where g.published_at is not null and g.archived_at is null and g.sale_restriction='none'$anchor$,
    $patched$   where g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- public.get_good_media
select private.adult_goods_patch('get_good_media(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ where g.id=p_good_id and g.published_at is not null and g.archived_at is null and g.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null;$anchor$,
    $patched$ where g.id=p_good_id and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null;$patched$)));

-- public.get_good_attribute_rows
select private.adult_goods_patch('get_good_attribute_rows(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    where g.id=p_good_id and g.published_at is not null and g.archived_at is null and g.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null;$anchor$,
    $patched$    where g.id=p_good_id and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null;$patched$)));

-- public.get_good_size_chart
select private.adult_goods_patch('get_good_size_chart(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ where s.enabled and g.id=p_good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$ where s.enabled and g.id=p_good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- public.get_good_after_sales_content
select private.adult_goods_patch('get_good_after_sales_content(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ where a.phone<>'' and g.id=p_good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$ where a.phone<>'' and g.id=p_good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- public.get_good_benefit_content
select private.adult_goods_patch('get_good_benefit_content(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ where g.id=p_good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$ where g.id=p_good_id and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- public.get_good_announcements
select private.adult_goods_patch('get_good_announcements(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    and g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null)$anchor$,
    $patched$    and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.archived_at is null and ip.published_at is not null)$patched$)));

-- public.get_good_shipping_policy
select private.adult_goods_patch('get_good_shipping_policy(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    and good.sale_restriction = 'none'$anchor$,
    $patched$    and private.good_sale_restriction_visible(good.sale_restriction,(select auth.uid()))$patched$)));

-- public.get_product_shipping_savings
select private.adult_goods_patch('get_product_shipping_savings(text,uuid,integer)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ where g.id=p_good_id and g.published_at is not null and g.archived_at is null and g.sale_restriction='none'$anchor$,
    $patched$ where g.id=p_good_id and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$),
  jsonb_build_array(
    $anchor$  where g.id<>p_good_id and policy.origin_id=(select origin_id from public.goods where id=private.goods_aggregation_owner(current_good.id)) and g.published_at is not null and g.archived_at is null and g.sale_restriction='none'$anchor$,
    $patched$  where g.id<>p_good_id and policy.origin_id=(select origin_id from public.goods where id=private.goods_aggregation_owner(current_good.id)) and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- public.get_goods_transaction_offers
select private.adult_goods_patch('get_goods_transaction_offers(text[])'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ where g.id=any(p_good_ids) and g.published_at is not null and g.archived_at is null and g.sale_restriction='none'$anchor$,
    $patched$ where g.id=any(p_good_ids) and g.published_at is not null and g.archived_at is null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- public.get_good_relations
select private.adult_goods_patch('get_good_relations(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null$anchor$,
    $patched$    where g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and i.archived_at is null and i.published_at is not null$patched$)));

-- public.get_good_relation_compositions
select private.adult_goods_patch('get_good_relation_compositions(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null$anchor$,
    $patched$  where g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and i.archived_at is null and i.published_at is not null$patched$)));

-- public.get_good_other_compositions
select private.adult_goods_patch('get_good_other_compositions(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  where g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$  where g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- private.goods_relation_document
select private.adult_goods_patch('private.goods_relation_document(uuid)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$   'public',g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null)||case when r.kind='other_composition' then jsonb_build_object('compositionLabel',m.composition_label) else '{}'::jsonb end order by m.position)$anchor$,
    $patched$   'public',g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and i.archived_at is null and i.published_at is not null)||case when r.kind='other_composition' then jsonb_build_object('compositionLabel',m.composition_label) else '{}'::jsonb end order by m.position)$patched$)));

-- private.goods_group_public_good
select private.adult_goods_patch('private.goods_group_public_good(text)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'$anchor$,
    $patched$  and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid()))$patched$)));

-- public.get_my_product_detail_interests
select private.adult_goods_patch('get_my_product_detail_interests()'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$   and g.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null$anchor$,
    $patched$   and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.published_at is not null and ip.archived_at is null$patched$)));

-- ---------------------------------------------------------------------------
-- 목록·검색 — 인증 성인에게만 19금 굿즈를 포함한다
-- ---------------------------------------------------------------------------

-- public.search_public_content
select private.adult_goods_patch('search_public_content(text,integer)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$      and goods.sale_restriction = 'none'$anchor$,
    $patched$      and private.good_sale_restriction_visible(goods.sale_restriction,params.actor_id)$patched$)));

-- public.get_goods_listing_appearance
select private.adult_goods_patch('get_goods_listing_appearance(text[])'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  where g.id=any(p_good_ids) and g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null);$anchor$,
    $patched$  where g.id=any(p_good_ids) and g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.archived_at is null and ip.published_at is not null);$patched$)));

-- private.category_display_matching_goods
select private.adult_goods_patch('private.category_display_matching_goods(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$ where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null$anchor$,
    $patched$ where g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.archived_at is null and ip.published_at is not null$patched$)));

-- private.category_display_page
select private.adult_goods_patch('private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$   where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null$anchor$,
    $patched$   where g.archived_at is null and g.published_at is not null and private.good_sale_restriction_visible(g.sale_restriction,(select auth.uid())) and ip.archived_at is null and ip.published_at is not null$patched$)));

-- private.category_display_public_good
select private.adult_goods_patch('private.category_display_public_good(goods,jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  'allow_bank_transfer',p_good.allow_bank_transfer,'allow_card_payment',p_good.allow_card_payment,'sale_restriction','none',$anchor$,
    $patched$  'allow_bank_transfer',p_good.allow_bank_transfer,'allow_card_payment',p_good.allow_card_payment,'sale_restriction',p_good.sale_restriction,$patched$)));

-- ---------------------------------------------------------------------------
-- 어드민 준비 상태 — 성인 상품은 더 이상 판매 차단 사유가 아니다
-- ---------------------------------------------------------------------------

-- private.admin_goods_readiness
select private.adult_goods_patch('private.admin_goods_readiness(goods)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  if p_good.sale_restriction<>'none' then blockers:=array_append(blockers,'restricted_sale'); end if;$anchor$,
    $patched$  -- 성인 상품은 인증 성인에게 판매된다(ADR-0024). 그 밖의 판매 제한 유형만 차단 사유다.
  if p_good.sale_restriction not in ('none','adult') then blockers:=array_append(blockers,'restricted_sale'); end if;$patched$)));

-- ---------------------------------------------------------------------------
-- 상세의 담기(add_cart_selection) — 19금 본품은 인증 성인만, 추가 구성은 일반 굿즈만
-- ---------------------------------------------------------------------------
-- 상세의 장바구니·구매하기는 본품과 추가 구성을 한 번에 담는다. 그 판정
-- (goods_additional_available)은 일반 굿즈만 참이라 인증 성인도 19금 본품을 담지 못했다.
-- 본품만 같은 조건에 성인 인증 판정을 더한 helper로 보고, 추가 구성은 그대로 둔다 —
-- 19금 굿즈는 다른 굿즈의 추가 구성으로 노출·판매하지 않는다.
create function private.goods_selection_base_available(p_good_id text, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists(select 1 from public.goods good join public.ips ip on ip.id=good.ip_id
    where good.id=p_good_id and good.published_at is not null and good.archived_at is null
      and private.good_sale_restriction_visible(good.sale_restriction,p_actor)
      and good.stock<>'soldout' and (good.allow_card_payment or good.allow_bank_transfer)
      and ip.published_at is not null and ip.archived_at is null
      and exists(select 1 from public.goods_variants variant cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
        where variant.good_id=good.id and variant.archived_at is null and supply.available_qty>0));
$function$;

revoke all on function private.goods_selection_base_available(text, uuid)
  from public, anon, authenticated, service_role;

-- public.add_cart_selection
select private.adult_goods_patch('add_cart_selection(text,jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$    if not private.goods_additional_available(item.good_id) then raise check_violation using message='additional_good_unavailable'; end if;$anchor$,
    $patched$    -- 19금 본품은 인증 성인만 담는다(ADR-0024). 추가 구성은 계속 일반 굿즈만이다.
    if item.good_id=p_base_good_id then
      if not private.goods_selection_base_available(item.good_id,actor) then
        if exists(select 1 from public.goods good where good.id=item.good_id and good.sale_restriction='adult')
          and not private.adult_verification_valid(actor) then
          raise check_violation using message='adult_verification_required';
        end if;
        raise check_violation using message='additional_good_unavailable';
      end if;
    elsif not private.goods_additional_available(item.good_id) then
      raise check_violation using message='additional_good_unavailable';
    end if;$patched$)));

-- ---------------------------------------------------------------------------
-- 운영자 계약 지문 갱신
-- ---------------------------------------------------------------------------
-- 위에서 바꾼 함수 중 운영자 계약 레지스트리에 오른 것만 새 정의로 지문을 다시 적는다
-- (operator_capability_coverage가 대조한다). 권한 분류(capability·guard)는 등록된 값 그대로다.
select private.register_operator_rpc_contract(target.oid::regprocedure, contract.capability, contract.guard_kind, contract.legacy_admin_only)
from private.operator_rpc_contracts as contract
join pg_catalog.pg_proc as target on target.oid = pg_catalog.to_regprocedure(contract.signature)
where target.oid = any(array[
  'private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb)',
  'private.cart_subtotal(uuid)',
  'private.goods_sales_conditions_core(jsonb)',
  'private.quote_goods_sales_before_preorder(jsonb)',
  'private.quote_goods_shipping_before_preorder(jsonb)',
  'private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)',
  'private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)',
  'goods_variant_pricing(goods_variants)',
  'goods_variant_supply(goods_variants)',
  'goods_sale_period(goods)',
  'get_product_detail_presentation(text)',
  'get_product_detail_experience(text)',
  'get_good_media(text)',
  'get_good_attribute_rows(text)',
  'get_good_size_chart(text)',
  'get_good_after_sales_content(text)',
  'get_good_benefit_content(text)',
  'get_good_announcements(text)',
  'get_good_shipping_policy(text)',
  'get_product_shipping_savings(text,uuid,integer)',
  'get_goods_transaction_offers(text[])',
  'get_good_relations(text)',
  'get_good_relation_compositions(text)',
  'get_good_other_compositions(text)',
  'private.goods_relation_document(uuid)',
  'private.goods_group_public_good(text)',
  'get_my_product_detail_interests()',
  'search_public_content(text,integer)',
  'get_goods_listing_appearance(text[])',
  'private.category_display_matching_goods(jsonb)',
  'private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)',
  'private.category_display_public_good(goods,jsonb)',
  'private.admin_goods_readiness(goods)',
  'add_cart_selection(text,jsonb)'
]::regprocedure[]::oid[]);

select private.register_operator_internal_contract(target.oid::regprocedure)
from pg_catalog.pg_proc as target
where target.oid = any(array[
  'private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb)',
  'private.cart_subtotal(uuid)',
  'private.goods_sales_conditions_core(jsonb)',
  'private.quote_goods_sales_before_preorder(jsonb)',
  'private.quote_goods_shipping_before_preorder(jsonb)',
  'private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)',
  'private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)',
  'goods_variant_pricing(goods_variants)',
  'goods_variant_supply(goods_variants)',
  'goods_sale_period(goods)',
  'get_product_detail_presentation(text)',
  'get_product_detail_experience(text)',
  'get_good_media(text)',
  'get_good_attribute_rows(text)',
  'get_good_size_chart(text)',
  'get_good_after_sales_content(text)',
  'get_good_benefit_content(text)',
  'get_good_announcements(text)',
  'get_good_shipping_policy(text)',
  'get_product_shipping_savings(text,uuid,integer)',
  'get_goods_transaction_offers(text[])',
  'get_good_relations(text)',
  'get_good_relation_compositions(text)',
  'get_good_other_compositions(text)',
  'private.goods_relation_document(uuid)',
  'private.goods_group_public_good(text)',
  'get_my_product_detail_interests()',
  'search_public_content(text,integer)',
  'get_goods_listing_appearance(text[])',
  'private.category_display_matching_goods(jsonb)',
  'private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)',
  'private.category_display_public_good(goods,jsonb)',
  'private.admin_goods_readiness(goods)',
  'add_cart_selection(text,jsonb)'
]::regprocedure[]::oid[])
  and exists (
    select 1 from private.operator_internal_contracts as contract
    where pg_catalog.to_regprocedure(contract.signature) = target.oid
  );

drop function private.adult_goods_patch(regprocedure, jsonb);
