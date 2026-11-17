-- 카테고리 전시 공개 굿즈 투영이 X SQUARE 카드 칩 필드(배송비 유형·옵션 판매 방식)를 싣는다
-- (migration 20261117130300). 앱(`toGood`)은 이 두 값으로 무료배송·캡슐토이 칩을 계산한다.
begin;

do $$
declare
  good_row public.goods;
  projected jsonb;
begin
  select g into good_row from public.goods g order by g.id limit 1;
  if good_row.id is null then
    raise exception 'category_display_card_chips: seed goods missing';
  end if;

  projected := private.category_display_public_good(good_row, '[]'::jsonb);
  if not (projected ? 'shipping_fee_type' and projected ? 'option_sale_mode') then
    raise exception 'category_display_card_chips: projection keys missing: %', projected;
  end if;
  if projected->>'shipping_fee_type' is distinct from good_row.shipping_fee_type then
    raise exception 'category_display_card_chips: shipping_fee_type % <> %', projected->>'shipping_fee_type', good_row.shipping_fee_type;
  end if;
  if projected->>'option_sale_mode' is distinct from good_row.option_sale_mode then
    raise exception 'category_display_card_chips: option_sale_mode % <> %', projected->>'option_sale_mode', good_row.option_sale_mode;
  end if;
  /* 기존 키는 그대로다 — 꼬리 앵커 앞뒤가 바뀌지 않았다. */
  if projected->'goods_variants' is distinct from '[]'::jsonb or not (projected ? 'sale_period') or not (projected ? 'sale_restriction') then
    raise exception 'category_display_card_chips: existing keys changed: %', projected;
  end if;

  /* 앱 롤은 여전히 이 내부 함수를 직접 실행할 수 없다. */
  if has_function_privilege('anon', 'private.category_display_public_good(public.goods,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.category_display_public_good(public.goods,jsonb)', 'execute') then
    raise exception 'category_display_card_chips: app roles can execute private projection';
  end if;
end $$;

rollback;
