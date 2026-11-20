begin;

-- 저장한 상품을 지우지 않고 고객 목록에서만 뺀다. 다시 노출하면 기존 수량·옵션·찜 시각이 복원된다.
-- 외부에 제공하는 카탈로그 목록이 아니라 현재 로그인한 회원이 이미 담은 항목만 읽는다.
create function private.hidden_saved_adult_goods() returns setof text
language sql stable security definer set search_path = '' as $$
  select saved.good_id
  from (
    select c.good_id from public.cart_items c where c.user_id = (select auth.uid())
    union
    select w.good_id from public.wishlists w where w.user_id = (select auth.uid())
  ) saved
  join public.goods g on g.id = saved.good_id and g.sale_restriction = 'adult'
  where not (select private.adult_goods_storefront_enabled());
$$;
revoke all on function private.hidden_saved_adult_goods() from public, anon, authenticated, service_role;
grant execute on function private.hidden_saved_adult_goods() to authenticated;

create policy cart_items_adult_storefront on public.cart_items as restrictive for select to authenticated
  using (good_id not in (select private.hidden_saved_adult_goods()));
create policy wishlists_adult_storefront on public.wishlists as restrictive for select to authenticated
  using (good_id not in (select private.hidden_saved_adult_goods()));

commit;
