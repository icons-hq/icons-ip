-- ============================================================================
-- 주문 내역·주문 상세의 다시 결제 진입 (QA 라운드 1 고객 S-D2-15, ADR-0030 '다시 결제')
--
-- 결제 실패·만료·취소된 주문의 다시 결제는 결제 화면(/checkout/<id>)에만 있었다. 그 화면을 닫은 고객은 주문 내역에서 다시 찾을
-- 수 없었고(결제 대기 카드 주문은 목록에서 숨었다), 취소된 장바구니 주문은 '장바구니 보기'로 모든 줄이 체크된 장바구니에 보냈다.
-- 주문 내역·주문 상세가 그 주문의 출처를 한 번에 읽어 같은 진입을 둔다: 장바구니 출처는 그 주문의 줄 가운데 장바구니에 남은
-- 것만 고른 주문서(service_create_checkout_retry_draft), 바로구매 출처는 같은 굿즈·옵션의 주문서(service_retry_direct_order).
--
-- public.service_list_order_retry_sources(user, order_ids): 이 계정 카드 주문 가운데 결제 대기(보류 awaiting_payment)이거나 결제
-- 없이 닫힌(보류 released — 떼어 낸 detached 제외, 주문 canceled) 장바구니·바로구매 주문의 출처·상품 상세 굿즈·이미 다시 구매한
-- 주문(retryOrderId, service_get_order_cart_retention과 같은 판정). 결제한 주문(보류 consumed)·보류 없는 주문은 돌려주지 않는다.
-- service role 전용, 본인 주문만, 한 번에 500건까지.
-- ============================================================================

create function public.service_list_order_retry_sources(p_user_id uuid, p_order_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'orderId', hold.order_id,
      'source', case when hold.source in ('direct_checkout', 'direct_transaction') then 'direct' else 'cart' end,
      'awaitingPayment', hold.state = 'awaiting_payment',
      'baseGoodId', case when hold.source in ('direct_checkout', 'direct_transaction') then hold.base_good_id end,
      'retryOrderId', case when hold.source in ('direct_checkout', 'direct_transaction') then (
        select draft.order_id from private.checkout_drafts as draft
        where draft.retry_order_id = hold.order_id and draft.user_id = p_user_id and draft.order_id is not null
          and (private.checkout_draft_order_settled(draft.order_id) or private.checkout_draft_order_payment_unresolved(draft.order_id))) end)
    order by hold.order_id), '[]'::jsonb)
  from private.cart_order_holds as hold
  join public.orders as o on o.id = hold.order_id
  where p_user_id is not null and p_order_ids is not null and pg_catalog.cardinality(p_order_ids) <= 500
    and hold.user_id = p_user_id and o.user_id = p_user_id and hold.order_id = any (p_order_ids)
    and o.payment_method = 'card'
    and ((hold.state = 'awaiting_payment' and o.status = 'pending')
      or (hold.state = 'released' and hold.release_reason is distinct from 'detached' and o.status = 'canceled'));
$$;
revoke all on function public.service_list_order_retry_sources(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.service_list_order_retry_sources(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
