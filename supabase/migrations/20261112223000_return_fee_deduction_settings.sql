-- 반품배송비 차감(QNA-033) — 스위치·차감 결정 원장·판정 함수.
--
-- 원래 요청: 서원 회신 E3 "고객 변심은 쇼핑몰에서 택배비 차감 후 환불 진행, 불량의 경우는 물류에서 지급합니다".
-- 2026-11-11 사용자 결정(묶음 8): "차감·부분 취소 모두 (Recommended)" — 단순 변심 반품배송비를 환불금에서 차감하고 결제사
-- 부분 취소로 '결제액 − 차감액'을 돌려준다. ADR-0017의 '전액 환불' 원칙을 반품배송비에 한해 바꾼다(ADR-0031).
--
-- 오케스트레이터 판단(사용자 판단 위임 원칙 ①~④):
--  * 스위치는 DB가 강제하고 기본 꺼짐이다. 켜는 것은 게이트 5개(토스 상점 부분 취소 사용 확인·나이스페이 부분 취소 계약·
--    반품배송비 금액·배송/반품 정책 문서 개정 7일 공지·서원 착불/불량 운임 계약) 뒤의 후속 migration이다
--    (docs/runbooks/return-fee-deduction.md). 꺼져 있으면 판정 함수가 null을 돌려주고 어떤 원장도 바뀌지 않는다.
--  * 차감액 = 반품배송비 정책 금액(편도), 최초 배송비가 0원(무료배송)이면 왕복(편도×2). 환불액을 넘지 않는다 —
--    차감액이 결제액 이상이면 환불액이 0원이 되어 결제사 취소 증거가 없는 '환불'이 생기므로 자동 차감하지 않고 전액 환불한 뒤
--    배송비 청구 원장으로 받게 안내한다(deviation, ADR-0031).
--  * 단순 변심 반품(claim_type='return' and reason_type='change_of_mind')만 차감한다. 하자·오배송(판매자 귀책)·취소·교환은
--    판정 대상이 아니다(판정 함수가 null).
--  * 부분 취소가 안 되는 결제(나이스페이 계약 전·코페이·가상계좌, 토스 isPartialCancelable=false·과세 제외 금액은 결제사
--    조회 때 판정)는 차감하지 않고 전액 환불한 뒤 기존 배송비 청구 원장으로 따로 받는 길을 안내한다. 선물 주문은 결제한 분과
--    요청한 분이 다를 수 있어 자동 차감하지 않는다(배송비 청구 원장이 납부 대상을 고른다).
--  * 같은 요청에 배송비 청구(입금 대기·입금 알림·입금 확인)가 있으면 차감하지 않고, 차감을 결정한 요청에는 새 배송비 청구를
--    만들 수 없다(이중 청구 방지, 다음 migration의 claim_fee_document 치환).
--  * 차감은 환불 접수(filed) 때 한 번 결정되고 그 뒤 바뀌지 않는다(접수 뒤에는 유형·사유 변경이 이미 막혀 있다). 스위치를
--    꺼도 이미 결정한 요청은 그대로 진행한다 — 결제사 부분 취소가 이미 나갔을 수 있어 같은 요청의 금액이 중간에 바뀌면
--    결제사 잔액과 원장이 어긋난다.
begin;

-- 1. 스위치(한 행). 켤 때는 편도 금액·근거(정책 문서 개정 공지 등)·켠 시각이 필요하다.
create table private.return_fee_deduction_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  one_way_amount integer check (one_way_amount is null or one_way_amount between 1 and 1000000),
  evidence text check (evidence is null or (evidence = btrim(evidence) and char_length(evidence) between 2 and 1000 and evidence !~ '[[:cntrl:]]')),
  enabled_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default clock_timestamp(),
  constraint return_fee_deduction_settings_enabled_shape
    check (not enabled or (one_way_amount is not null and evidence is not null and enabled_at is not null))
);
insert into private.return_fee_deduction_settings(singleton) values (true);
alter table private.return_fee_deduction_settings enable row level security;
revoke all on table private.return_fee_deduction_settings from public, anon, authenticated, service_role;

-- 스위치 변경은 누가(migration·SQL 편집기 포함) 언제 바꿨는지 감사 기록에 남기고, 바뀔 때마다 리비전을 올린다. 행은 지우지 못한다.
create function private.audit_return_fee_deduction_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise check_violation using message = 'return_fee_deduction_settings_required'; end if;
  if tg_when = 'BEFORE' then
    new.revision := old.revision + 1;
    new.updated_at := clock_timestamp();
    return new;
  end if;
  insert into public.audit_log(actor_id, action, target, diff)
  values (null, 'system.return_fee_deduction.settings_changed', 'return_fee_deduction_settings',
    jsonb_build_object('before', to_jsonb(old) - 'singleton', 'after', to_jsonb(new) - 'singleton', 'sessionUser', session_user::text));
  return new;
end $$;
revoke all on function private.audit_return_fee_deduction_settings() from public, anon, authenticated, service_role;
create trigger return_fee_deduction_settings_revision before update on private.return_fee_deduction_settings
  for each row execute function private.audit_return_fee_deduction_settings();
create trigger return_fee_deduction_settings_audit after update on private.return_fee_deduction_settings
  for each row execute function private.audit_return_fee_deduction_settings();
create trigger return_fee_deduction_settings_keep before delete on private.return_fee_deduction_settings
  for each row execute function private.audit_return_fee_deduction_settings();

-- 2. 요청별 차감 결정. 환불 접수 때 한 번 적고 금액·근거는 바뀌지 않는다. 상태만 앞으로 간다:
--    planned(결정) → provider_confirmed(결제사 부분 취소를 조회로 확인, 카드) → applied(환불 원장 확정)
--    planned → not_applied(결제사가 부분 취소를 받지 않는 결제라 전액 환불로 돌림, 돈이 움직이기 전).
create table private.claim_refund_deductions (
  claim_id uuid primary key references public.order_cancellation_requests(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  provider public.payment_provider not null check (provider in ('toss', 'bank_transfer')),
  payment_amount bigint not null check (payment_amount > 0),
  one_way_amount integer not null check (one_way_amount between 1 and 1000000),
  basis text not null check (basis in ('one_way', 'round_trip')),
  initial_shipping_fee bigint not null check (initial_shipping_fee >= 0),
  deduction_amount bigint not null check (deduction_amount > 0),
  refund_amount bigint not null check (refund_amount > 0),
  settings_revision integer not null check (settings_revision >= 1),
  state text not null default 'planned' check (state in ('planned', 'provider_confirmed', 'applied', 'not_applied')),
  not_applied_reason text check (not_applied_reason is null or not_applied_reason = 'partial_cancel_unavailable'),
  provider_transaction_key text check (provider_transaction_key is null or provider_transaction_key ~ '^[\x21-\x7e]{1,64}$'),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz not null default clock_timestamp(),
  provider_confirmed_at timestamptz,
  applied_at timestamptz,
  not_applied_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint claim_refund_deductions_amounts check (refund_amount = payment_amount - deduction_amount),
  constraint claim_refund_deductions_basis check (deduction_amount = one_way_amount::bigint * case basis when 'round_trip' then 2 else 1 end),
  constraint claim_refund_deductions_not_applied check ((state = 'not_applied') = (not_applied_reason is not null and not_applied_at is not null)),
  constraint claim_refund_deductions_confirmed check (state not in ('provider_confirmed') or provider_confirmed_at is not null),
  constraint claim_refund_deductions_applied check ((state = 'applied') = (applied_at is not null)),
  constraint claim_refund_deductions_card_confirmation check (provider <> 'bank_transfer' or (provider_confirmed_at is null and provider_transaction_key is null and state <> 'not_applied'))
);
create index claim_refund_deductions_order_idx on private.claim_refund_deductions(order_id);
alter table private.claim_refund_deductions enable row level security;
revoke all on table private.claim_refund_deductions from public, anon, authenticated, service_role;

-- 결정의 금액·근거는 바꾸지 못하고, 상태는 정해진 방향으로만 간다. 행은 지우지 못한다.
create function private.guard_claim_refund_deduction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise check_violation using message = 'refund_deduction_immutable'; end if;
  if (new.claim_id, new.order_id, new.payment_id, new.provider, new.payment_amount, new.one_way_amount, new.basis,
      new.initial_shipping_fee, new.deduction_amount, new.refund_amount, new.settings_revision, new.decided_by, new.decided_at)
    is distinct from
     (old.claim_id, old.order_id, old.payment_id, old.provider, old.payment_amount, old.one_way_amount, old.basis,
      old.initial_shipping_fee, old.deduction_amount, old.refund_amount, old.settings_revision, old.decided_by, old.decided_at)
    or not (old.state = new.state
      or old.state = 'planned' and new.state in ('provider_confirmed', 'applied', 'not_applied')
      or old.state = 'provider_confirmed' and new.state = 'applied')
  then
    raise check_violation using message = 'refund_deduction_immutable';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke all on function private.guard_claim_refund_deduction() from public, anon, authenticated, service_role;
create trigger claim_refund_deductions_guard before update or delete on private.claim_refund_deductions
  for each row execute function private.guard_claim_refund_deduction();

-- 3. 판정(읽기 전용). 스위치가 꺼졌거나 단순 변심 반품이 아니면 null — 부르는 쪽은 아무것도 덧붙이지 않는다.
--    켜져 있고 단순 변심 반품이면 차감할 수 있는지(applicable)와 할 수 없는 이유(reason), 금액을 돌려준다.
create function private.return_fee_deduction_plan(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  settings private.return_fee_deduction_settings;
  claim public.order_cancellation_requests;
  purchase public.orders;
  pay public.payments;
  payment_count integer;
  basis text;
  fee bigint;
  reason text;
begin
  select * into settings from private.return_fee_deduction_settings where singleton;
  if not found or not settings.enabled then return null; end if;
  select * into claim from public.order_cancellation_requests where id = p_claim_id;
  if not found or claim.claim_type <> 'return' or claim.reason_type <> 'change_of_mind' then return null; end if;
  select * into purchase from public.orders where id = claim.order_id;
  -- 왕복은 '최초 배송비를 한 푼도 내지 않은' 주문만이다. 선결제 배송비(shipping_fee)와 착불(shipping_collect_total) 둘 다 0원일 때.
  basis := case when coalesce(purchase.shipping_fee, 0) = 0 and coalesce(purchase.shipping_collect_total, 0) = 0 then 'round_trip' else 'one_way' end;
  fee := settings.one_way_amount::bigint * case when basis = 'round_trip' then 2 else 1 end;
  select count(*) into payment_count from public.payments p
   where p.purpose = 'order' and p.ref_id = claim.order_id and p.status <> 'failed';
  select * into pay from public.payments p
   where p.purpose = 'order' and p.ref_id = claim.order_id and p.status <> 'failed'
   order by p.created_at desc, p.id desc limit 1;
  reason := case
    when payment_count <> 1 or pay.id is null or pay.amount <= 0 then 'payment_unavailable'
    when exists(select 1 from private.gift_intents g where g.order_id = claim.order_id) then 'gift_order'
    when pay.provider not in ('toss', 'bank_transfer') then 'partial_cancel_unsupported'
    -- 정기배송(billing) 결제는 결제사 부분 취소 계약이 없다 — 차감을 결정하지 않고 전액 환불 + 배송비 청구로 간다.
    when exists(select 1 from public.payment_attempts a
      join private.payment_provider_bindings b on b.attempt_id = a.id
      where a.purpose = 'order' and a.ref_id = claim.order_id) then 'partial_cancel_unsupported'
    when pay.provider = 'toss' and exists(select 1 from public.payment_attempts a
      join private.payment_provider_evidence e on e.payment_attempt_id = a.id
      where a.purpose = 'order' and a.ref_id = claim.order_id
        and (e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account')) then 'partial_cancel_unsupported'
    when exists(select 1 from private.claim_fee_invoices i where i.claim_id = claim.id and i.state in ('unpaid', 'reported', 'paid')) then 'claim_fee_invoiced'
    when fee >= pay.amount then 'fee_exceeds_payment'
    else null end;
  return jsonb_build_object(
    'applicable', reason is null,
    'reason', reason,
    'oneWayAmount', settings.one_way_amount,
    'basis', basis,
    'initialShippingFee', coalesce(purchase.shipping_fee, 0) + coalesce(purchase.shipping_collect_total, 0),
    'deductionAmount', fee,
    'paymentId', pay.id,
    'provider', pay.provider,
    'paymentAmount', pay.amount,
    'refundAmount', case when reason is null then pay.amount - fee else pay.amount end,
    'settingsRevision', settings.revision);
end $$;
revoke all on function private.return_fee_deduction_plan(uuid) from public, anon, authenticated, service_role;

-- 4. 결정 기록. 환불 접수(입고완료 → 처리중)를 적는 함수가 주문·요청·결제 잠금 안에서 부른다. 같은 요청은 첫 결정이 이긴다.
create function private.record_return_fee_deduction(p_claim_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare plan jsonb; claim public.order_cancellation_requests; inserted private.claim_refund_deductions;
begin
  plan := private.return_fee_deduction_plan(p_claim_id);
  if plan is null or (plan->>'applicable')::boolean is distinct from true then return; end if;
  select * into claim from public.order_cancellation_requests where id = p_claim_id;
  insert into private.claim_refund_deductions(claim_id, order_id, payment_id, provider, payment_amount, one_way_amount, basis,
    initial_shipping_fee, deduction_amount, refund_amount, settings_revision, decided_by)
  values (p_claim_id, claim.order_id, (plan->>'paymentId')::uuid, (plan->>'provider')::public.payment_provider,
    (plan->>'paymentAmount')::bigint, (plan->>'oneWayAmount')::integer, plan->>'basis', (plan->>'initialShippingFee')::bigint,
    (plan->>'deductionAmount')::bigint, (plan->>'refundAmount')::bigint, (plan->>'settingsRevision')::integer, p_actor)
  on conflict (claim_id) do nothing
  returning * into inserted;
  if inserted.claim_id is not null then
    insert into public.audit_log(actor_id, action, target, diff)
    values (p_actor, 'admin.order.claim_refund_deduction_decided', 'order:' || claim.order_id::text,
      jsonb_build_object('claimId', p_claim_id, 'paymentAmount', inserted.payment_amount, 'deductionAmount', inserted.deduction_amount,
        'refundAmount', inserted.refund_amount, 'basis', inserted.basis, 'oneWayAmount', inserted.one_way_amount,
        'settingsRevision', inserted.settings_revision));
  end if;
end $$;
revoke all on function private.record_return_fee_deduction(uuid, uuid) from public, anon, authenticated, service_role;

-- 5. 결제 한 건의 '확정 환불액'을 정하는 값들. 결정이 없으면 차감 0 — 지금과 같다.
--    active: 결정 뒤 아직 전액 환불로 돌리지 않은 차감(planned·provider_confirmed·applied).
create function private.claim_refund_active_deduction(p_payment_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select d.deduction_amount from private.claim_refund_deductions d
    where d.payment_id = p_payment_id and d.state in ('planned', 'provider_confirmed', 'applied')), 0)::bigint;
$$;
revoke all on function private.claim_refund_active_deduction(uuid) from public, anon, authenticated, service_role;

-- 카드 finalizer가 환불 원장에 적을 금액. 결제사 부분 취소를 확인하지 않은 차감(planned)이 있으면 확정하지 않는다 —
-- 오케스트레이터가 부분 취소 확인을 적거나(provider_confirmed) 전액 환불로 돌린(not_applied) 뒤에만 끝난다.
create function private.claim_refund_settled_amount(p_payment_id uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare d private.claim_refund_deductions; amount bigint;
begin
  select p.amount into amount from public.payments p where p.id = p_payment_id;
  select * into d from private.claim_refund_deductions where payment_id = p_payment_id;
  if not found or d.state = 'not_applied' then return amount; end if;
  if d.state in ('provider_confirmed', 'applied') then return d.refund_amount; end if;
  raise check_violation using message = 'refund_deduction_evidence_required';
end $$;
revoke all on function private.claim_refund_settled_amount(uuid) from public, anon, authenticated, service_role;

-- 6. 화면·감사·알림이 읽는 모양. 결정이 있으면 결정을, 없으면 접수 전 단계의 판정을 보인다(접수 뒤에 결정이 없으면 차감이
--    없으므로 아무것도 보이지 않는다). 스위치가 꺼져 있고 결정이 없으면 null.
create function private.claim_refund_deduction_view(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d private.claim_refund_deductions; claim public.order_cancellation_requests; plan jsonb;
begin
  select * into d from private.claim_refund_deductions where claim_id = p_claim_id;
  if found then
    return jsonb_build_object('source', 'decision', 'state', d.state, 'applicable', d.state <> 'not_applied',
      'reason', case when d.state = 'not_applied' then d.not_applied_reason else null end,
      'oneWayAmount', d.one_way_amount, 'basis', d.basis, 'initialShippingFee', d.initial_shipping_fee,
      'deductionAmount', d.deduction_amount, 'paymentId', d.payment_id, 'provider', d.provider, 'paymentAmount', d.payment_amount,
      'refundAmount', case when d.state = 'not_applied' then d.payment_amount else d.refund_amount end,
      'decidedAt', d.decided_at, 'appliedAt', d.applied_at);
  end if;
  select * into claim from public.order_cancellation_requests where id = p_claim_id;
  if not found or (case when claim.stage = 'on_hold' then coalesce(claim.held_from, 'requested') else claim.stage end)
    not in ('requested', 'in_review', 'collecting', 'collected') then
    return null;
  end if;
  plan := private.return_fee_deduction_plan(p_claim_id);
  if plan is null then return null; end if;
  return jsonb_build_object('source', 'plan', 'state', null) || (plan - 'settingsRevision');
end $$;
revoke all on function private.claim_refund_deduction_view(uuid) from public, anon, authenticated, service_role;

-- 문서에 덧붙일 필드. 보일 것이 없으면 빈 객체라 스위치가 꺼진 동안 문서 모양이 한 글자도 바뀌지 않는다.
create function private.claim_refund_deduction_field(p_claim_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when view is null then '{}'::jsonb else jsonb_build_object('refundDeduction', view) end
  from (select private.claim_refund_deduction_view(p_claim_id) as view) source;
$$;
revoke all on function private.claim_refund_deduction_field(uuid) from public, anon, authenticated, service_role;

-- 감사 기록에 덧붙일 필드. 결정이 없으면 빈 객체.
create function private.claim_refund_deduction_audit(p_claim_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('refundDeduction', jsonb_build_object('state', d.state,
      'paymentAmount', d.payment_amount, 'deductionAmount', d.deduction_amount,
      'refundAmount', case when d.state = 'not_applied' then d.payment_amount else d.refund_amount end,
      'basis', d.basis, 'reason', d.not_applied_reason))
    from private.claim_refund_deductions d where d.claim_id = p_claim_id), '{}'::jsonb);
$$;
revoke all on function private.claim_refund_deduction_audit(uuid) from public, anon, authenticated, service_role;

create function private.format_krw(p_amount bigint) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_amount, 'FM999,999,999,990') || '원';
$$;
revoke all on function private.format_krw(bigint) from public, anon, authenticated, service_role;

-- 구매자 알림 문구. 차감 결정이 없으면 null(부르는 쪽의 기존 문구 그대로).
create function private.claim_refund_deduction_notice(p_claim_id uuid, p_event text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare d private.claim_refund_deductions; reason text;
begin
  select * into d from private.claim_refund_deductions where claim_id = p_claim_id;
  if not found or d.state = 'not_applied' then return null; end if;
  reason := case when d.basis = 'round_trip'
    then format('최초 무료배송이라 왕복 반품배송비 %s', private.format_krw(d.deduction_amount))
    else format('반품배송비 %s', private.format_krw(d.deduction_amount)) end;
  if p_event = 'filed_bank_transfer' then
    return format('단순 변심 반품이라 %s을 뺀 %s을 등록하신 환불계좌로 송금하도록 접수했습니다.', reason, private.format_krw(d.refund_amount));
  elsif p_event = 'filed' then
    return format('환불 절차를 시작했습니다. 단순 변심 반품이라 결제 금액 %s에서 %s을 뺀 %s을 환불합니다. 결제사 취소가 확인되면 다시 알려드립니다.',
      private.format_krw(d.payment_amount), reason, private.format_krw(d.refund_amount));
  elsif p_event = 'provider_completed' and d.state = 'applied' then
    return format('결제 금액 %s 가운데 %s을 뺀 %s을 결제사에서 취소했습니다. 카드 부분 취소는 카드사 처리에 영업일 기준 3~4일이 걸릴 수 있습니다.',
      private.format_krw(d.payment_amount), reason, private.format_krw(d.refund_amount));
  elsif p_event = 'completed' and d.state = 'applied' then
    return format('%s을 뺀 %s의 환급 처리가 완료됐습니다. 결제수단에 따라 반영 시점이 다를 수 있습니다.', reason, private.format_krw(d.refund_amount));
  end if;
  return null;
end $$;
revoke all on function private.claim_refund_deduction_notice(uuid, text) from public, anon, authenticated, service_role;

-- 7. 공개 정책 읽기(구매자 반품 안내·상품 상세가 쓴다). 꺼져 있으면 금액을 싣지 않는다.
create function public.get_return_fee_deduction_policy() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when s.enabled
    then jsonb_build_object('enabled', true, 'oneWayAmount', s.one_way_amount)
    else jsonb_build_object('enabled', false, 'oneWayAmount', null) end
  from private.return_fee_deduction_settings s where s.singleton;
$$;
revoke all on function public.get_return_fee_deduction_policy() from public, anon, authenticated, service_role;
grant execute on function public.get_return_fee_deduction_policy() to anon, authenticated;

-- 8. 구매자 주문 상세의 차감 표시. 본인 주문(결제한 분)의 결정만 돌려준다. 결정이 없으면 null.
create function public.get_my_order_claim_refund_deduction(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('claimId', d.claim_id, 'state', d.state,
    'paymentAmount', d.payment_amount, 'deductionAmount', d.deduction_amount,
    'refundAmount', case when d.state = 'not_applied' then d.payment_amount else d.refund_amount end,
    'basis', d.basis, 'oneWayAmount', d.one_way_amount, 'reason', d.not_applied_reason, 'provider', d.provider)
  from private.claim_refund_deductions d
  join public.orders o on o.id = d.order_id
  where d.order_id = p_order_id and auth.uid() is not null and o.user_id = auth.uid()
  order by d.decided_at desc limit 1;
$$;
revoke all on function public.get_my_order_claim_refund_deduction(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_order_claim_refund_deduction(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
