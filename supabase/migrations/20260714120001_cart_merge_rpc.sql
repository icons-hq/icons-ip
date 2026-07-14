-- 로그인 시 로컬 장바구니를 서버 장바구니에 원자적으로 병합한다.
-- 재시도와 동시 탭에서도 더 작은 수량이 기존 수량을 덮어쓰지 않는다.
create or replace function public.merge_cart_items(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise check_violation using message = 'cart items must be an array';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(good_id text, qty integer)
    where nullif(btrim(item.good_id), '') is null
       or item.qty is null
       or item.qty <= 0
  ) then
    raise check_violation using message = 'invalid cart item';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(good_id text, qty integer)
    left join public.goods good on good.id = btrim(item.good_id)
    where good.id is null
  ) then
    raise foreign_key_violation using message = 'cart good not found';
  end if;

  insert into public.cart_items (user_id, good_id, qty)
  select v_user, btrim(item.good_id), max(item.qty)
  from jsonb_to_recordset(p_items) as item(good_id text, qty integer)
  group by btrim(item.good_id)
  on conflict (user_id, good_id) do update
  set qty = greatest(public.cart_items.qty, excluded.qty);
end;
$$;

revoke all on function public.merge_cart_items(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.merge_cart_items(jsonb) to authenticated;
