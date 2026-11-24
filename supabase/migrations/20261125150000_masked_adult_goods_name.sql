-- MD-0048(2026-11-23, 김미주 대리): "카테고리 / 19금 상품 ip명, 제품명, 가격 노출 > 썸네일만 비노출".
-- 성인 인증 전 방문자의 19금 가림 카드가 굿즈 이름도 보이도록 가림 카드 RPC가 이름을 함께 돌려준다.
-- 이미지·배지·설명·옵션은 여전히 돌려주지 않고, 상세·담기·견적·주문 판정(ADR-0024)은 바뀌지 않는다.
-- 반환 열이 바뀌므로 drop 뒤 다시 만든다. 본문·조건·권한은 20261120025700 정의 그대로다.

drop function if exists public.get_masked_adult_goods(text);

create function public.get_masked_adult_goods(p_good_id text default null)
returns table (id text, ip_id text, name text, display_order integer, category_id uuid, price integer, stock text, stock_qty integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.id, g.ip_id, g.name, g.display_order, g.category_id, g.price, g.stock, g.stock_qty, g.created_at
  from public.goods g join public.ips ip on ip.id = g.ip_id
  where (select private.adult_goods_storefront_enabled()) and g.sale_restriction = 'adult'
    and g.published_at is not null and g.archived_at is null
    and ip.published_at is not null and ip.archived_at is null and (p_good_id is null or g.id = p_good_id)
  order by g.id;
$$;
revoke all on function public.get_masked_adult_goods(text) from public, anon, authenticated, service_role;
grant execute on function public.get_masked_adult_goods(text) to anon, authenticated;
