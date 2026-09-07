\set ON_ERROR_STOP on

-- 현업 요청 슬라이스 2 — 배송·교환반품 정책 (D-2 승격)

begin;

insert into public.verticals (key, label, color) values ('ship-test', '배송 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('ship-ip', '배송 테스트 IP', 'ship-test') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('ship-g1', 'ship-ip', '기본 정책 굿즈', '문구', 10000, 'ok', 50),
  ('ship-g2', 'ship-ip', '부피 큰 굿즈 A', '쿠션', 20000, 'ok', 50),
  ('ship-g3', 'ship-ip', '부피 큰 굿즈 B', '쿠션', 20000, 'ok', 50),
  ('ship-g4', 'ship-ip', '무료배송 굿즈', '문구', 1000, 'ok', 50)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A. 기본 정책은 옛 상수와 같다 — 정책을 도입해도 금액이 그대로여야 한다
-- ---------------------------------------------------------------------------
select 1 / case when (
  select fee_kind = 'conditional' and fee_amount = 3000 and free_threshold = 50000 and remote_surcharge = 0
  from public.shipping_policies where is_default and archived_at is null
) then 1 else 0 end as assert_default_policy_matches_old_constants;

select 1 / case when (
  public.shipping_fee_for_lines('[{"goodId":"ship-g1","qty":1}]'::jsonb) = 3000
  and public.shipping_fee_for_lines('[{"goodId":"ship-g1","qty":5}]'::jsonb) = 0
  and public.shipping_fee_for_lines('[]'::jsonb) = 0
  and public.shipping_fee_for_lines(null) = 0
) then 1 else 0 end as assert_conditional_free_threshold;

-- 정책을 비운 상품은 기본 정책을 쓴다.
select 1 / case when (
  select (policy).is_default from public.shipping_policy_for('ship-g1') as policy
) then 1 else 0 end as assert_empty_policy_falls_back_to_default;

-- ---------------------------------------------------------------------------
-- B. 묶음배송 — 켜면 정책끼리 한 번, 끄면 상품마다
-- ---------------------------------------------------------------------------
insert into public.shipping_policies (id, name, bundling, fee_kind, fee_amount, free_threshold)
values ('ship-bundled', '묶음 정책', true, 'paid', 4000, null)
on conflict (id) do nothing;
insert into public.shipping_policies (id, name, bundling, fee_kind, fee_amount, free_threshold)
values ('ship-solo', '개별 정책', false, 'paid', 4000, null)
on conflict (id) do nothing;

update public.goods set shipping_policy_id = 'ship-bundled' where id in ('ship-g2', 'ship-g3');
select 1 / case when (
  public.shipping_fee_for_lines('[{"goodId":"ship-g2","qty":1},{"goodId":"ship-g3","qty":1}]'::jsonb) = 4000
) then 1 else 0 end as assert_bundling_charges_once;

update public.goods set shipping_policy_id = 'ship-solo' where id in ('ship-g2', 'ship-g3');
select 1 / case when (
  public.shipping_fee_for_lines('[{"goodId":"ship-g2","qty":1},{"goodId":"ship-g3","qty":1}]'::jsonb) = 8000
) then 1 else 0 end as assert_no_bundling_charges_per_good;

-- 정책이 섞이면 그룹마다 매긴다.
update public.goods set shipping_policy_id = 'ship-bundled' where id = 'ship-g3';
select 1 / case when (
  public.shipping_fee_for_lines('[{"goodId":"ship-g2","qty":1},{"goodId":"ship-g3","qty":1}]'::jsonb) = 8000
) then 1 else 0 end as assert_mixed_policies_charge_per_group;

-- ---------------------------------------------------------------------------
-- C. 도서산간 — 주문에 한 번, 정책들 중 최대값
-- ---------------------------------------------------------------------------
update public.shipping_policies set remote_surcharge = 3000 where id = 'ship-bundled';
update public.shipping_policies set remote_surcharge = 5000 where id = 'ship-solo';

-- 그룹이 둘인데 추가비는 한 번, 그중 큰 값(5,000)만 붙는다.
select 1 / case when (
  public.shipping_fee_for_lines('[{"goodId":"ship-g2","qty":1},{"goodId":"ship-g3","qty":1}]'::jsonb, '63000') = 13000
  and public.shipping_fee_for_lines('[{"goodId":"ship-g2","qty":1},{"goodId":"ship-g3","qty":1}]'::jsonb, '06236') = 8000
) then 1 else 0 end as assert_remote_surcharge_once_at_max;

select 1 / case when (
  public.postal_is_remote('63000') and public.postal_is_remote('63-000')
  and not public.postal_is_remote('06236') and not public.postal_is_remote(null)
) then 1 else 0 end as assert_remote_lookup_uses_the_shared_table;

-- ---------------------------------------------------------------------------
-- D. 무료 정책과 소계 0 — 옛 규칙 그대로
-- ---------------------------------------------------------------------------
insert into public.shipping_policies (id, name, fee_kind, fee_amount, free_threshold)
values ('ship-free', '무료배송 정책', 'free', 0, null)
on conflict (id) do nothing;
update public.goods set shipping_policy_id = 'ship-free' where id = 'ship-g4';

select 1 / case when (
  public.shipping_fee_for_lines('[{"goodId":"ship-g4","qty":1}]'::jsonb) = 0
) then 1 else 0 end as assert_free_policy_charges_nothing;

-- 0원 상품만 담긴 그룹은 청구하지 않는다(결제 최소액 계약과 맞물린다).
update public.goods set price = 0, shipping_policy_id = null where id = 'ship-g4';
select 1 / case when (
  public.shipping_fee_for_lines('[{"goodId":"ship-g4","qty":1}]'::jsonb) = 0
) then 1 else 0 end as assert_zero_subtotal_group_is_not_charged;

-- 할인이 걸리면 배송비 판정도 **할인가**로 본다 — 화면이 보여 준 값과 같아야 한다.
update public.goods set price = 60000, shipping_policy_id = null where id = 'ship-g1';
select 1 / case when (
  public.shipping_fee_for_lines('[{"goodId":"ship-g1","qty":1}]'::jsonb) = 0
) then 1 else 0 end as assert_threshold_uses_price_before_discount;

update public.goods set discount_kind = 'percent', discount_value = 50 where id = 'ship-g1';
select 1 / case when (
  public.shipping_fee_for_lines('[{"goodId":"ship-g1","qty":1}]'::jsonb) = 3000
) then 1 else 0 end as assert_threshold_uses_the_discounted_price;

-- ---------------------------------------------------------------------------
-- D-2. 화면 견적 — 청구와 같은 함수를 보고, 답이 하나가 아니면 안내를 감춘다
-- ---------------------------------------------------------------------------
update public.goods set price = 10000, discount_kind = 'none', discount_value = 0, shipping_policy_id = null where id = 'ship-g1';

select 1 / case when (
  select fee = 3000 and free_remaining = 40000
  from public.shipping_quote_for_lines('[{"goodId":"ship-g1","qty":1}]'::jsonb)
) then 1 else 0 end as assert_quote_reports_remaining_for_free_shipping;

select 1 / case when (
  select fee = 0 and free_remaining = 0
  from public.shipping_quote_for_lines('[{"goodId":"ship-g1","qty":5}]'::jsonb)
) then 1 else 0 end as assert_quote_reports_zero_when_already_free;

-- 정책이 섞이면 「얼마 더 담으면」에 답이 하나가 아니다 — 숫자를 지어내지 않는다.
select 1 / case when (
  select free_remaining is null
  from public.shipping_quote_for_lines('[{"goodId":"ship-g1","qty":1},{"goodId":"ship-g2","qty":1}]'::jsonb)
) then 1 else 0 end as assert_quote_hides_remaining_when_policies_mix;

-- 견적과 청구가 같은 값이어야 한다.
select 1 / case when (
  select fee = public.shipping_fee_for_lines('[{"goodId":"ship-g1","qty":1},{"goodId":"ship-g2","qty":1}]'::jsonb, '63000')
  from public.shipping_quote_for_lines('[{"goodId":"ship-g1","qty":1},{"goodId":"ship-g2","qty":1}]'::jsonb, '63000')
) then 1 else 0 end as assert_quote_matches_the_charge;

-- ---------------------------------------------------------------------------
-- E. 제약 — 기본은 하나, 요금 형태는 짝이 맞아야 한다
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.shipping_policies (id, name, fee_kind, fee_amount, is_default)
    values ('ship-second-default', '두 번째 기본', 'paid', 3000, true);
    raise exception 'expected a second default policy to be rejected';
  exception when unique_violation then null;
  end;

  begin
    insert into public.shipping_policies (id, name, fee_kind, fee_amount, free_threshold)
    values ('ship-bad-conditional', '임계 없는 조건부', 'conditional', 3000, null);
    raise exception 'expected a conditional policy without a threshold to be rejected';
  exception when check_violation then null;
  end;

  begin
    insert into public.shipping_policies (id, name, fee_kind, fee_amount)
    values ('ship-bad-free', '금액 있는 무료', 'free', 3000);
    raise exception 'expected a free policy with a fee to be rejected';
  exception when check_violation then null;
  end;

  begin
    insert into public.shipping_policies (id, name, method, fee_kind, fee_amount)
    values ('ship-bad-method', '없는 방법', 'drone', 'paid', 3000);
    raise exception 'expected an unknown shipping method to be rejected';
  exception when check_violation then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- F. 권한 — 정책은 공개 읽기, 쓰기는 staff
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_table_privilege('anon', 'public.shipping_policies', 'select')
  and not has_table_privilege('anon', 'public.shipping_policies', 'insert')
  and has_function_privilege('anon', 'public.shipping_fee_for_lines(jsonb,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_upsert_shipping_policy(text,text,text,boolean,text,integer,integer,integer,text,text,text,integer,integer,text,text,boolean,boolean,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_upsert_shipping_policy(text,text,text,boolean,text,integer,integer,integer,text,text,text,integer,integer,text,text,boolean,boolean,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_archive_shipping_policy(text,uuid)', 'execute')
) then 1 else 0 end as assert_shipping_policy_acl;

rollback;
