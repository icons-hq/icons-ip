-- ==========================================================================
-- ICONS · 공개 상품 주소를 상품 자동코드로 연다 (MD-0051 · ADR-0050)
--
-- 고객 상세 주소는 `/shop/<상품 자동코드 소문자>`다(예: /shop/hsq-0059). 내부 식별자 goods.id는
-- 그대로이고(PK·외래키·주문·재고 불변), 옛 주소 `/shop/<goods.id>`는 앱이 새 주소로 영구 이동시킨다.
--
-- 상세 라우트가 주소 끝 값 하나를 상품으로 바꾸는 읽기가 필요하다. 일반 상품은 goods RLS로 읽히지만
-- 인증 전 방문자의 19금 상품 행은 RLS가 닫으므로(20261118160000) 좁은 security definer 읽기로 둔다.
--
-- resolve_public_goods_address(p_value):
--   - 상품 자동코드(저장 규칙과 같은 upper(btrim()) 비교, 대소문자 무시) 또는 내부 id가 같은 상품 하나.
--     둘 다 맞는 상품이 따로 있으면 코드가 이긴다 — 주소 끝 값의 정식 의미가 코드이기 때문이다.
--   - 공개 상품만 답한다: 게시·미보관·부모 IP 게시·미보관, 판매 제한은 없음 또는 19금 판매 표면이 켜진
--     19금(인증 전 방문자의 가림 카드·인증 안내와 같은 범위, get_masked_adult_goods와 같은 조건).
--   - 돌려주는 값은 id와 상품 자동코드뿐이다. 이름·이미지·가격은 없다 — 19금 상품의 코드는 공개해도 된다
--     (사용자 결정, ADR-0050). 공개 여부 밖의 판정(성인 인증 gate·인증 여부)은 상세 로더가 그대로 한다.
--   - 호출자를 보지 않으므로 쇼핑 화면 공개 조회 캐시의 public 등급이다(lib/supabase/storefront-read-cache.ts).
--
-- private.category_display_public_good: 카테고리 전시 투영에 'code'를 더한다(공개 굿즈만 싣는 기존 판정 그대로).
-- ==========================================================================

begin;

create function public.resolve_public_goods_address(p_value text)
returns table (id text, code text)
language sql
stable
security definer
set search_path = ''
as $function$
  select g.id, g.code
  from public.goods g
  join public.ips ip on ip.id = g.ip_id
  where char_length(p_value) between 1 and 200
    and (g.code = upper(btrim(p_value)) or g.id = p_value)
    and g.published_at is not null
    and g.archived_at is null
    and ip.published_at is not null
    and ip.archived_at is null
    and (
      g.sale_restriction = 'none'::public.goods_sale_restriction
      or (g.sale_restriction = 'adult'::public.goods_sale_restriction and (select private.adult_goods_storefront_enabled()))
    )
  order by (g.code = upper(btrim(p_value))) desc, g.id
  limit 1;
$function$;

comment on function public.resolve_public_goods_address(text) is
  '공개 상품 주소(/shop/<값>)의 끝 값을 상품으로 푼다(ADR-0050). 상품 자동코드(대소문자 무시)가 내부 id보다 먼저다. 공개 상품의 id·상품 자동코드만 돌려준다.';

revoke all on function public.resolve_public_goods_address(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_public_goods_address(text) to anon, authenticated;

-- 카테고리 전시(/shop?category=…) 목록·추천의 공개 굿즈 투영에도 상품 자동코드를 싣는다 — 카드 링크가 코드 주소로 바로 간다.
-- 현재 정의 = 20261020085338 원문 + 20261105093418·20261117130300·20261120081200 앵커 패치. 머리 앵커가 정확히 한 번 있을 때만 바꾼다.
do $$
declare
  body text;
  anchor constant text := $a$jsonb_build_object('id',p_good.id,'ip_id',p_good.ip_id,$a$;
  replacement constant text := $a$jsonb_build_object('id',p_good.id,'code',p_good.code,'ip_id',p_good.ip_id,$a$;
begin
  body := pg_get_functiondef('private.category_display_public_good(public.goods,jsonb)'::regprocedure);
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'goods_public_code_address_category_anchor_missing';
  end if;
  execute replace(body, anchor, replacement);
end $$;
revoke all on function private.category_display_public_good(public.goods,jsonb) from public, anon, authenticated, service_role;
select private.register_operator_internal_contract('private.category_display_public_good(public.goods,jsonb)'::regprocedure);

commit;
