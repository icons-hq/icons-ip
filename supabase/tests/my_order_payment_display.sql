\set ON_ERROR_STOP on

begin;

-- 고객 주문 상세의 결제수단 표시(MD-0037): get_my_order_payment_display.
-- private 근거(payment_provider_evidence)에서 method·마스킹 표기·승인 시각만 꺼내고,
-- 본인 결제가 아니면 null이며, anon·service_role은 부를 수 없다.

-- 권한 표면: authenticated만 실행하고 PUBLIC·anon·service_role은 막힌다. 보안 정의자·stable·빈 search_path.
select 1 / case when (
  has_function_privilege('authenticated', 'public.get_my_order_payment_display(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.get_my_order_payment_display(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.get_my_order_payment_display(uuid)', 'execute')
  and not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(procedure.proacl) as privilege
    where procedure.oid = 'public.get_my_order_payment_display(uuid)'::regprocedure
      and privilege.grantee = 0
  )
) then 1 else 0 end as assert_display_rpc_is_authenticated_only;

select 1 / case when (
  select procedure.prosecdef
    and procedure.provolatile = 's'
    and procedure.proconfig = array['search_path=""']
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.get_my_order_payment_display(uuid)'::regprocedure
) then 1 else 0 end as assert_display_rpc_is_stable_definer_with_empty_search_path;

-- 픽스처: 결제자 A·다른 결제자 B.
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000002101',
    'authenticated', 'authenticated', 'order-display-owner@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000002102',
    'authenticated', 'authenticated', 'order-display-other@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at
)
values
  (
    '00000000-0000-4000-8000-000000002101',
    'order-display-owner@example.test', 'order_display_owner', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  ),
  (
    '00000000-0000-4000-8000-000000002102',
    'order-display-other@example.test', 'order_display_other', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  suspended_at = null,
  suspension_reason = null;

-- 주문 10건: 번호 끝자리 = 시나리오.
--   2111 토스 카드 / 2112 토스 간편결제 / 2113 무통장(근거 없음) / 2114 근거 여러 줄(가장 늦은 유효 근거)
--   2115 결제 2건(나중 결제에 근거 없음) / 2120 결제 2건(나중 결제에 근거 있음) / 2116 결제 없음
--   2117 다른 회원(B)의 주문 / 2118 코페이 CARD / 2119 방식 없는 근거
insert into public.orders (id, user_id, status, total)
values
  ('20000000-0000-4000-8000-000000002111', '00000000-0000-4000-8000-000000002101', 'paid', 31000),
  ('20000000-0000-4000-8000-000000002112', '00000000-0000-4000-8000-000000002101', 'paid', 31000),
  ('20000000-0000-4000-8000-000000002113', '00000000-0000-4000-8000-000000002101', 'paid', 31000),
  ('20000000-0000-4000-8000-000000002114', '00000000-0000-4000-8000-000000002101', 'paid', 31000),
  ('20000000-0000-4000-8000-000000002115', '00000000-0000-4000-8000-000000002101', 'paid', 31000),
  ('20000000-0000-4000-8000-000000002116', '00000000-0000-4000-8000-000000002101', 'paid', 31000),
  ('20000000-0000-4000-8000-000000002117', '00000000-0000-4000-8000-000000002102', 'paid', 31000),
  ('20000000-0000-4000-8000-000000002118', '00000000-0000-4000-8000-000000002101', 'paid', 31000),
  ('20000000-0000-4000-8000-000000002119', '00000000-0000-4000-8000-000000002101', 'paid', 31000),
  ('20000000-0000-4000-8000-000000002120', '00000000-0000-4000-8000-000000002101', 'paid', 31000);

-- 결제 1건과(선택) 그 승인 attempt를 만든다. n = 결제 번호(id·키 끝자리).
create function pg_temp.fixture_payment(
  n integer,
  payer uuid,
  order_id uuid,
  payment_provider public.payment_provider,
  payment_status public.payment_status,
  created timestamptz,
  with_attempt boolean default true
) returns void language plpgsql as $$
declare
  payment_id uuid := ('30000000-0000-4000-8000-00000000' || lpad(n::text, 4, '0'))::uuid;
begin
  insert into public.payments (id, user_id, purpose, ref_id, amount, status, payment_key, idempotency_key, provider, created_at)
  values (payment_id, payer, 'order', order_id, 31000, payment_status,
          'tgen_secret_payment_key_' || n, 'order-display-payment-' || n, payment_provider, created);
  if with_attempt then
    insert into public.payment_attempts (
      id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key,
      provider_order_id, provider_product_code, payment_id, expires_at
    )
    values (
      ('40000000-0000-4000-8000-00000000' || lpad(n::text, 4, '0'))::uuid,
      payment_provider, payer, 'order', order_id, 31000, 'KRW', 'approved',
      'order-display-attempt-' || n, 'order-display-provider-order-' || n,
      'order-display-product-' || n, payment_id, now() + interval '1 day'
    );
  end if;
end $$;

select pg_temp.fixture_payment(2111, '00000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002111', 'toss', 'paid', '2026-11-17 05:00:00+00');
select pg_temp.fixture_payment(2112, '00000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002112', 'toss', 'paid', '2026-11-17 05:00:00+00');
select pg_temp.fixture_payment(2113, '00000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002113', 'bank_transfer', 'paid', '2026-11-17 05:00:00+00', false);
select pg_temp.fixture_payment(2114, '00000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002114', 'toss', 'paid', '2026-11-17 05:00:00+00');
-- 굿즈 주문의 attempt는 하나라(payment_attempts_one_goods_order_idx) 한 주문의 결제 2건 중 하나는 attempt가 없다.
-- 2115: 먼저 결제한 토스 카드 건(근거 있음)과 나중에 만든 무통장 건(근거 없음) → 나중 결제를 본다.
select pg_temp.fixture_payment(2151, '00000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002115', 'toss', 'canceled', '2026-11-17 04:00:00+00');
select pg_temp.fixture_payment(2152, '00000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002115', 'bank_transfer', 'paid', '2026-11-17 05:00:00+00', false);
-- 2120: 먼저 만든 무통장 건(근거 없음)과 나중에 결제한 토스 간편결제 건(근거 있음) → 나중 결제를 본다.
select pg_temp.fixture_payment(2201, '00000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002120', 'bank_transfer', 'canceled', '2026-11-17 04:00:00+00', false);
select pg_temp.fixture_payment(2202, '00000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002120', 'toss', 'paid', '2026-11-17 05:00:00+00');
select pg_temp.fixture_payment(2117, '00000000-0000-4000-8000-000000002102', '20000000-0000-4000-8000-000000002117', 'toss', 'paid', '2026-11-17 05:00:00+00');
select pg_temp.fixture_payment(2118, '00000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002118', 'korpay', 'paid', '2026-11-17 05:00:00+00');
select pg_temp.fixture_payment(2119, '00000000-0000-4000-8000-000000002101', '20000000-0000-4000-8000-000000002119', 'toss', 'paid', '2026-11-17 05:00:00+00');

insert into private.payment_provider_evidence (
  payment_attempt_id, evidence_kind, provider_payment_key, provider_transaction_id,
  provider_approval_reference, result_code, payment_method, masked_payment_method, approved_at, recorded_at
)
values
  -- 2111 토스 카드: 마스킹 카드번호.
  ('40000000-0000-4000-8000-000000002111', 'confirm_approved', 'tgen_secret_payment_key_2111', 'tgen_secret_tx_2111',
   '30011234', 'DONE', '카드', '43301234****123*', '2026-11-17 05:00:00+00', '2026-11-17 05:00:01+00'),
  -- 2112 토스 간편결제: 결제사 이름이 표기다.
  ('40000000-0000-4000-8000-000000002112', 'confirm_approved', 'tgen_secret_payment_key_2112', 'tgen_secret_tx_2112',
   null, 'DONE', '간편결제', '네이버페이', '2026-11-17 05:00:00+00', '2026-11-17 05:00:01+00'),
  -- 2114 근거 여러 줄: 오래된 카드 근거 < 가장 늦은 유효 근거(간편결제) / 더 늦지만 방식·표기가 모두 없는 근거는 건너뛴다.
  ('40000000-0000-4000-8000-000000002114', 'confirm_approved', 'tgen_secret_payment_key_2114', null,
   null, 'DONE', '카드', '43301234****123*', '2026-11-17 05:00:00+00', '2026-11-17 05:00:01+00'),
  ('40000000-0000-4000-8000-000000002114', 'reconcile_approved', 'tgen_secret_payment_key_2114', null,
   null, 'DONE', '간편결제', '카카오페이', '2026-11-17 05:10:00+00', '2026-11-17 05:10:01+00'),
  ('40000000-0000-4000-8000-000000002114', 'reconcile_checked', 'tgen_secret_payment_key_2114', null,
   null, 'DONE', null, null, '2026-11-17 05:20:00+00', '2026-11-17 05:20:01+00'),
  -- 2115 두 결제: 먼저 만든 건(2151)에만 카드 근거가 있다.
  ('40000000-0000-4000-8000-000000002151', 'confirm_approved', 'tgen_secret_payment_key_2151', null,
   null, 'DONE', '카드', '43301234****999*', '2026-11-17 04:00:00+00', '2026-11-17 04:00:01+00'),
  -- 2120 두 결제: 나중 결제(2202)에만 간편결제 근거가 있다.
  ('40000000-0000-4000-8000-000000002202', 'confirm_approved', 'tgen_secret_payment_key_2202', null,
   null, 'DONE', '간편결제', '토스페이', '2026-11-17 05:00:00+00', '2026-11-17 05:00:01+00'),
  -- 2117 다른 회원의 결제.
  ('40000000-0000-4000-8000-000000002117', 'confirm_approved', 'tgen_secret_payment_key_2117', null,
   null, 'DONE', '카드', '55550000****0000', '2026-11-17 05:00:00+00', '2026-11-17 05:00:01+00'),
  -- 2118 코페이: 영문 CARD + 마스킹 카드번호.
  ('40000000-0000-4000-8000-000000002118', 'confirm_approved', 'tgen_secret_payment_key_2118', 'korpay-tx-2118',
   null, '0000', 'CARD', '1234-****-****-5678', '2026-11-17 05:00:00+00', '2026-11-17 05:00:01+00'),
  -- 2119 방식·표기 없는 근거만 있다(승인 시각만).
  ('40000000-0000-4000-8000-000000002119', 'confirm_approved', 'tgen_secret_payment_key_2119', null,
   null, 'DONE', null, null, '2026-11-17 05:00:00+00', '2026-11-17 05:00:01+00');

-- ---------------------------------------------------------------------------
-- 호출자 검증: 로그인 없는 authenticated는 auth_required, anon·service_role은 권한 오류.
-- ---------------------------------------------------------------------------
set local role authenticated;

do $display_auth_required$
declare
  rejected boolean := false;
begin
  begin
    perform public.get_my_order_payment_display('20000000-0000-4000-8000-000000002111');
  exception when insufficient_privilege then
    rejected := sqlerrm = 'auth_required';
  end;
  if not rejected then
    raise exception 'authenticated role without a user must fail with auth_required';
  end if;
end;
$display_auth_required$;

reset role;
set local role anon;

do $display_anon_denied$
declare
  rejected boolean := false;
begin
  begin
    perform public.get_my_order_payment_display('20000000-0000-4000-8000-000000002111');
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'anon must not execute get_my_order_payment_display';
  end if;
end;
$display_anon_denied$;

reset role;
set local role service_role;

do $display_service_role_denied$
declare
  rejected boolean := false;
begin
  begin
    perform public.get_my_order_payment_display('20000000-0000-4000-8000-000000002111');
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'service_role must not execute get_my_order_payment_display';
  end if;
end;
$display_service_role_denied$;

reset role;

-- ---------------------------------------------------------------------------
-- 결제자 A로 읽는다.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002101', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- ① 본인 토스 카드 결제 → method 카드 + 마스킹 카드번호 + 승인 시각, 키는 정확히 4개.
select 1 / case when (
  select v ->> 'provider' = 'toss'
    and v ->> 'method' = '카드'
    and v ->> 'detail' = '43301234****123*'
    and (v ->> 'approvedAt')::timestamptz = '2026-11-17 05:00:00+00'::timestamptz
    and (select array_agg(key order by key) from jsonb_object_keys(v) as key)
        = array['approvedAt', 'detail', 'method', 'provider']
  from (select public.get_my_order_payment_display('20000000-0000-4000-8000-000000002111') as v) as result
) then 1 else 0 end as assert_owner_toss_card_payment_shows_method_and_masked_card;

-- ② 간편결제 → detail은 결제사 이름.
select 1 / case when (
  select v ->> 'provider' = 'toss'
    and v ->> 'method' = '간편결제'
    and v ->> 'detail' = '네이버페이'
  from (select public.get_my_order_payment_display('20000000-0000-4000-8000-000000002112') as v) as result
) then 1 else 0 end as assert_easy_pay_shows_provider_name_as_detail;

-- ③ 다른 회원의 주문(결제자 B)은 null. 존재하지 않는 주문·null 주문 id도 null.
select 1 / case when (
  public.get_my_order_payment_display('20000000-0000-4000-8000-000000002117') is null
  and public.get_my_order_payment_display('20000000-0000-4000-8000-0000000099ff') is null
  and public.get_my_order_payment_display(null) is null
) then 1 else 0 end as assert_other_members_orders_and_unknown_orders_return_null;

-- 결제가 없는 주문은 null.
select 1 / case when (
  public.get_my_order_payment_display('20000000-0000-4000-8000-000000002116') is null
) then 1 else 0 end as assert_order_without_payment_returns_null;

-- ④ 무통장(근거 없음): 객체는 오되 method·detail·approvedAt이 JSON null로 키를 유지한다.
select 1 / case when (
  select v ->> 'provider' = 'bank_transfer'
    and jsonb_typeof(v -> 'method') = 'null'
    and jsonb_typeof(v -> 'detail') = 'null'
    and jsonb_typeof(v -> 'approvedAt') = 'null'
    and (select array_agg(key order by key) from jsonb_object_keys(v) as key)
        = array['approvedAt', 'detail', 'method', 'provider']
  from (select public.get_my_order_payment_display('20000000-0000-4000-8000-000000002113') as v) as result
) then 1 else 0 end as assert_bank_transfer_without_evidence_keeps_keys_with_json_null;

-- 방식·표기가 없는 근거만 있는 결제도 같은 모양(승인 시각 없음 — 유효 근거로 치지 않는다).
select 1 / case when (
  select v ->> 'provider' = 'toss'
    and jsonb_typeof(v -> 'method') = 'null'
    and jsonb_typeof(v -> 'detail') = 'null'
    and jsonb_typeof(v -> 'approvedAt') = 'null'
  from (select public.get_my_order_payment_display('20000000-0000-4000-8000-000000002119') as v) as result
) then 1 else 0 end as assert_evidence_without_method_or_masked_is_not_used;

-- 근거가 여러 줄이면 방식·표기가 있는 가장 늦은 근거(카카오페이), 방식·표기 없는 더 늦은 근거는 건너뛴다.
select 1 / case when (
  select v ->> 'method' = '간편결제'
    and v ->> 'detail' = '카카오페이'
    and (v ->> 'approvedAt')::timestamptz = '2026-11-17 05:10:00+00'::timestamptz
  from (select public.get_my_order_payment_display('20000000-0000-4000-8000-000000002114') as v) as result
) then 1 else 0 end as assert_latest_usable_evidence_wins;

-- 같은 주문에 결제가 둘이면 가장 늦게 만든 결제를 본다 — 나중 결제에 근거가 없으면 이전 결제의 카드 정보를 끌어오지 않는다.
select 1 / case when (
  select v ->> 'provider' = 'bank_transfer'
    and jsonb_typeof(v -> 'method') = 'null'
    and jsonb_typeof(v -> 'detail') = 'null'
  from (select public.get_my_order_payment_display('20000000-0000-4000-8000-000000002115') as v) as result
) then 1 else 0 end as assert_latest_payment_without_evidence_keeps_null;

select 1 / case when (
  select v ->> 'provider' = 'toss'
    and v ->> 'method' = '간편결제'
    and v ->> 'detail' = '토스페이'
  from (select public.get_my_order_payment_display('20000000-0000-4000-8000-000000002120') as v) as result
) then 1 else 0 end as assert_latest_payment_with_evidence_wins;

-- 코페이: 영문 CARD + 마스킹 카드번호 그대로.
select 1 / case when (
  select v ->> 'provider' = 'korpay'
    and v ->> 'method' = 'CARD'
    and v ->> 'detail' = '1234-****-****-5678'
  from (select public.get_my_order_payment_display('20000000-0000-4000-8000-000000002118') as v) as result
) then 1 else 0 end as assert_korpay_card_shows_upper_case_method;

-- 결제 키·거래 id·승인 번호·결과 코드는 어떤 결과에도 섞이지 않는다.
select 1 / case when not exists (
  select 1
  from (
    values
      ('20000000-0000-4000-8000-000000002111'::uuid),
      ('20000000-0000-4000-8000-000000002112'::uuid),
      ('20000000-0000-4000-8000-000000002113'::uuid),
      ('20000000-0000-4000-8000-000000002114'::uuid),
      ('20000000-0000-4000-8000-000000002115'::uuid),
      ('20000000-0000-4000-8000-000000002118'::uuid),
      ('20000000-0000-4000-8000-000000002119'::uuid),
      ('20000000-0000-4000-8000-000000002120'::uuid)
  ) as scenario(order_id)
  cross join lateral (select public.get_my_order_payment_display(scenario.order_id)::text as body) as result
  where result.body ~* '(secret|tgen_|korpay-tx|30011234|DONE|0000)'
) then 1 else 0 end as assert_result_never_leaks_keys_transaction_ids_or_result_codes;

-- ---------------------------------------------------------------------------
-- 결제자 B는 자기 주문만 본다.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002102', true);

select 1 / case when (
  select v ->> 'method' = '카드' and v ->> 'detail' = '55550000****0000'
  from (select public.get_my_order_payment_display('20000000-0000-4000-8000-000000002117') as v) as result
) and public.get_my_order_payment_display('20000000-0000-4000-8000-000000002111') is null
  then 1 else 0 end as assert_each_member_sees_only_own_payment_display;

reset role;

-- 직접 읽기 표면은 그대로 닫혀 있다: 근거 테이블은 고객·익명 롤에 열리지 않았다.
select 1 / case when (
  not has_table_privilege('authenticated', 'private.payment_provider_evidence', 'select')
  and not has_table_privilege('anon', 'private.payment_provider_evidence', 'select')
  and has_table_privilege('service_role', 'private.payment_provider_evidence', 'select')
) then 1 else 0 end as assert_evidence_table_stays_closed_to_client_roles;

rollback;
