-- 카테고리 전시 목록의 굿즈 카드도 X SQUARE 카드 칩(무료배송·캡슐토이)을 그릴 수 있게
-- 공개 굿즈 투영에 배송비 유형과 옵션 판매 방식을 싣는다. 앱은 이 행을 `toGood`으로 읽으며
-- 두 값은 전체 카탈로그 select(lib/catalog.ts)가 이미 읽는 열이다.
-- 현재 정의 = 20261020085338 원문 + 20261105093418 성인 굿즈 앵커 패치. 꼬리 앵커가 정확히 한 번 있을 때만 바꾼다.
begin;

do $$
declare
  body text;
  anchor constant text := $a$'sale_period',public.goods_sale_period(p_good),'goods_variants',p_variants);$a$;
  replacement constant text := $a$'sale_period',public.goods_sale_period(p_good),'shipping_fee_type',p_good.shipping_fee_type,'option_sale_mode',p_good.option_sale_mode,'goods_variants',p_variants);$a$;
begin
  body := pg_get_functiondef('private.category_display_public_good(public.goods,jsonb)'::regprocedure);
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'category_display_card_chips_anchor_missing';
  end if;
  execute replace(body, anchor, replacement);
end $$;
revoke all on function private.category_display_public_good(public.goods,jsonb) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.category_display_public_good(public.goods,jsonb)'::regprocedure);

commit;
