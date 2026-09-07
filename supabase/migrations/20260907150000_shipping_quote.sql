-- 현업 슬라이스 2 후속 — 화면 견적을 서버가 만든다
--
-- 배송비 계산이 정책으로 옮겨 가면서, 장바구니·주문서가 쓰던 코드 상수 근사치는
-- **정책이 섞인 장바구니에서 실제 청구와 어긋난다**(묶음배송 꺼진 상품·도서산간).
-- 표시와 청구가 다른 경로로 계산되면 언젠가 갈린다 — 견적도 같은 함수를 보게 한다.

/*
 * 배송비 견적. 금액과 함께 「얼마 더 담으면 무료인가」를 돌려준다.
 *
 * `free_remaining` 은 **한 조건부 정책만 걸린 장바구니에서만** 값을 준다. 정책이 섞이면
 * 「얼마 더 담으면」에 답이 하나가 아니고, 아무 숫자나 보여 주면 그게 거짓말이 된다 —
 * 그때는 null 을 주고 화면이 안내를 감춘다.
 */
create or replace function public.shipping_quote_for_lines(
  p_lines jsonb,
  p_postal_code text default null
)
returns table (fee integer, free_remaining integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_groups integer := 0;
  v_kind text;
  v_threshold integer;
  v_subtotal bigint;
begin
  fee := public.shipping_fee_for_lines(p_lines, p_postal_code);
  free_remaining := null;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return next;
    return;
  end if;

  with lines as (
    select
      entry ->> 'goodId' as good_id,
      greatest(coalesce((entry ->> 'qty')::integer, 0), 0) as qty
    from jsonb_array_elements(p_lines) as entry
  ),
  priced as (
    select
      lines.good_id,
      lines.qty,
      public.good_effective_price(good) as unit_price,
      policy.*
    from lines
    join public.goods as good on good.id = lines.good_id
    cross join lateral public.shipping_policy_for(lines.good_id) as policy
    where lines.qty > 0
  ),
  grouped as (
    select
      case when priced.bundling then priced.id else priced.id || ':' || priced.good_id end as group_key,
      min(priced.fee_kind) as fee_kind,
      min(priced.free_threshold) as free_threshold,
      sum(priced.unit_price::bigint * priced.qty::bigint) as subtotal
    from priced
    group by group_key, priced.bundling
  )
  select count(*), min(grouped.fee_kind), min(grouped.free_threshold), min(grouped.subtotal)
  into v_groups, v_kind, v_threshold, v_subtotal
  from grouped;

  if v_groups = 1 and v_kind = 'conditional' and v_threshold is not null and v_subtotal > 0 then
    free_remaining := greatest(v_threshold - v_subtotal, 0)::integer;
  end if;

  return next;
end;
$$;

comment on function public.shipping_quote_for_lines(jsonb, text) is
  '화면 견적. 청구와 같은 함수를 본다. free_remaining 은 조건부 정책 하나짜리 장바구니에서만 값을 준다.';

grant execute on function public.shipping_quote_for_lines(jsonb, text) to anon, authenticated;
