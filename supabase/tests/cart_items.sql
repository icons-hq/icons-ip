\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000401',
    'authenticated', 'authenticated', 'cart-one@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000402',
    'authenticated', 'authenticated', 'cart-two@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

select 1 / case when not has_function_privilege('anon', 'public.merge_cart_items(jsonb)', 'execute') then 1 else 0 end
  as assert_anon_cannot_merge_cart;
select 1 / case when has_function_privilege('authenticated', 'public.merge_cart_items(jsonb)', 'execute') then 1 else 0 end
  as assert_authenticated_can_merge_cart;
select 1 / case when not has_function_privilege('service_role', 'public.merge_cart_items(jsonb)', 'execute') then 1 else 0 end
  as assert_service_role_cannot_merge_cart;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000401', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.merge_cart_items('[{"good_id":"g1","qty":2},{"good_id":"g2","qty":1}]'::jsonb);
select public.merge_cart_items('[{"good_id":"g1","qty":1},{"good_id":"g1","qty":2}]'::jsonb);

select 1 / case when (
  select jsonb_object_agg(good_id, qty order by good_id)
  from public.cart_items
  where user_id = '00000000-0000-4000-8000-000000000401'
) = '{"g1":2,"g2":1}'::jsonb then 1 else 0 end as assert_merge_is_max_and_retry_idempotent;

select public.merge_cart_items('[{"good_id":"g1","qty":4}]'::jsonb);
select 1 / case when (
  select qty from public.cart_items
  where user_id = '00000000-0000-4000-8000-000000000401' and good_id = 'g1'
) = 4 then 1 else 0 end as assert_merge_can_raise_quantity;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000402', true);
select 1 / case when not exists (
  select 1 from public.cart_items
) then 1 else 0 end as assert_cart_rls_isolates_users;

do $$
begin
  begin
    perform public.merge_cart_items('[{"good_id":"g1","qty":0}]'::jsonb);
    raise exception 'zero quantity should be rejected';
  exception
    when check_violation then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

do $$
begin
  begin
    perform public.merge_cart_items('[{"good_id":"g1","qty":1}]'::jsonb);
    raise exception 'unauthenticated merge should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

rollback;
