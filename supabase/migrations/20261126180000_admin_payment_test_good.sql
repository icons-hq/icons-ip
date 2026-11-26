-- 결제 테스트 한 상품은 항상 초안이다. 공개 검색·추천·주소·선물은 기존 게시 조건을 유지한다.
begin;

alter table public.goods add constraint admin_payment_test_stays_draft check (
  id <> 'admin-payment-test' or (published_at is null and sale_restriction = 'none' and option_sale_mode = 'select')
);

create function private.admin_payment_test_allowed(p_good_id text, p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_good_id = 'admin-payment-test' then exists (
    select 1 from public.profiles where id = p_actor and role = 'admin' and suspended_at is null
      and (private.operator_access_for(p_actor)->'capabilities') ? 'home'
  ) else false end;
$$;
revoke all on function private.admin_payment_test_allowed(text, uuid) from public, anon, authenticated, service_role;

-- RLS는 호출자 본인에 대해서만 판정한다. 서비스 전용 주문 RPC는 인증한 주문 소유자를 명시한다.
create function public.can_use_admin_payment_test()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.admin_payment_test_allowed('admin-payment-test', (select auth.uid()))
    and (not private.operator_mfa_required() or private.operator_mfa_session_verified((select auth.uid())));
$$;
revoke all on function public.can_use_admin_payment_test() from public, anon, authenticated, service_role;
grant execute on function public.can_use_admin_payment_test() to authenticated;

create policy goods_admin_payment_test_only on public.goods as restrictive for select to authenticated
  using (id <> 'admin-payment-test' or (select public.can_use_admin_payment_test()));
create policy goods_admin_payment_test_read on public.goods for select to authenticated
  using (id = 'admin-payment-test' and (select public.can_use_admin_payment_test()));
create policy goods_variants_admin_payment_test_only on public.goods_variants as restrictive for select to authenticated
  using (good_id <> 'admin-payment-test' or (select public.can_use_admin_payment_test()));

-- 기존 주문서의 재고·가격·배송비 계산 및 행 잠금을 그대로 사용한다.
-- 앞선 마이그레이션이 바꾼 본문을 복사하지 않고 정확히 한 곳만 바꾼다.
create function pg_temp.payment_test_patch(p_fn regprocedure, p_old text, p_new text)
returns void language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_fn);
begin
  if (length(definition) - length(replace(definition, p_old, ''))) <> length(p_old) then
    raise exception 'admin payment test migration anchor changed in %', p_fn;
  end if;
  execute replace(definition, p_old, p_new);
  perform private.register_operator_rpc_contract(p_fn, c.capability, c.guard_kind, c.legacy_admin_only)
    from private.operator_rpc_contracts c where c.signature::regprocedure = p_fn;
  if exists (select 1 from private.operator_internal_contracts where signature::regprocedure = p_fn) then
    perform private.register_operator_internal_contract(p_fn);
  end if;
end $$;

select pg_temp.payment_test_patch('private.goods_selection_base_available(text,uuid)',
  'good.published_at is not null',
  '(good.published_at is not null or private.admin_payment_test_allowed(good.id,p_actor))');
select pg_temp.payment_test_patch('public.goods_variant_supply(public.goods_variants)',
  'good.published_at is not null',
  '(good.published_at is not null or private.admin_payment_test_allowed(good.id,(select auth.uid())))');
select pg_temp.payment_test_patch('public.goods_variant_pricing(public.goods_variants)',
  'where variant.id=target_variant.id and',
  'where variant.id=target_variant.id and (good.id <> ''admin-payment-test'' or private.admin_payment_test_allowed(good.id,(select auth.uid()))) and');
select pg_temp.payment_test_patch('private.quote_goods_sales_before_preorder(jsonb)',
  'g.published_at is not null',
  '(g.published_at is not null or private.admin_payment_test_allowed(g.id,actor))');
select pg_temp.payment_test_patch('private.quote_goods_shipping_before_preorder(jsonb)',
  'g.published_at is not null',
  '(g.published_at is not null or private.admin_payment_test_allowed(g.id,(select auth.uid())))');
select pg_temp.payment_test_patch('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)',
  'if r.published_at is null or r.archived_at is not null then',
  'if (r.published_at is null and not private.admin_payment_test_allowed(r.good_id,v_user)) or r.archived_at is not null then');
select pg_temp.payment_test_patch('private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamptz,jsonb,uuid)',
  'g.published_at is not null',
  '(g.published_at is not null or private.admin_payment_test_allowed(g.id,p_actor))');

-- 주문 생성 후 권한 회수·상품 보관이 발생하면 새 결제 준비와 승인 직전 claim을 모두 막는다.
select pg_temp.payment_test_patch('private.assert_order_goods_sale_period(uuid)',
  ' current_at:=clock_timestamp();',
  $new$ if exists (
   select 1 from public.order_items i join public.orders o on o.id = i.order_id
   join public.goods g on g.id = i.good_id
   where i.order_id = p_order_id and i.good_id = 'admin-payment-test'
     and (g.archived_at is not null or not private.admin_payment_test_allowed(g.id,o.user_id))
 ) then raise check_violation using message='catalog_item_unavailable'; end if;
 current_at:=clock_timestamp();$new$);

-- 실결제 키를 사용해도 실물 출고는 없다. 품목에서 파생하므로 수동 해제할 수 없고 주문 취소와 함께 끝난다.
select pg_temp.payment_test_patch('private.order_fulfillment_hold_reasons(uuid)',
  '      select h.reason from private.order_fulfillment_holds',
  $new$      select 'admin_payment_test'::text as reason from public.order_items i
      where i.order_id = p_order_id and i.good_id = 'admin-payment-test'
      union all
      select h.reason from private.order_fulfillment_holds$new$);
select pg_temp.payment_test_patch('private.order_fulfillment_held_orders()',
  '    select h.order_id, h.created_at as placed_at',
  $new$    select i.order_id, o.created_at as placed_at from public.order_items i
    join public.orders o on o.id = i.order_id
    where i.good_id = 'admin-payment-test' and o.status <> 'canceled'
    union all
    select h.order_id, h.created_at as placed_at$new$);

-- 상품 조회/수정 목록과 엑셀 대상 검색은 정의자 권한으로 읽으므로 상품 RLS와 같은 범위로 좁힌다.
select pg_temp.payment_test_patch('public.admin_search_goods(text)',
  '    from public.goods good',
  $new$    from (select g.* from public.goods g where g.id <> 'admin-payment-test'
      or (select public.can_use_admin_payment_test())) good$new$);

-- IP 목록의 공개 상품 건수에도 테스트 상품이 더해지지 않는다.
select pg_temp.payment_test_patch('private.refresh_active_catalog_counts()',
  'where good.ip_id = ip.id', 'where good.ip_id = ip.id and good.id <> ''admin-payment-test''');

select pg_temp.payment_test_patch('private.enforce_active_catalog_counts()',
  'where good.ip_id = new.id', 'where good.ip_id = new.id and good.id <> ''admin-payment-test''');

commit;
