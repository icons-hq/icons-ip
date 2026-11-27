-- 자동 거래확정: 켜기 전에 "지금 켜면 몇 건이 확정되고 적립금이 얼마 나가는지"를 읽는 조회와,
-- 정책 저장의 근거 글·확인 체크 필수 해제(2026-11-25 결정 — 저장 = 적용, 되돌릴 수 없는 일은 수치를 보여 주는 확인창 한 번).
--
-- 자동 거래확정을 켜서 저장하면 꺼져 있던 동안 배송완료된 주문도 배송완료일 + 설정 기간으로 기한을 받고
-- (private.backfill_purchase_confirmation_due_dates), 기한이 지난 주문은 다음 자동 처리(매일 03:00 KST,
-- public.settle_delivered_orders) 때 거래확정되며 주문 당시 적립 조건대로 적립금이 지급된다
-- (private.store_credit_order_transition). 지금까지 화면은 근거 글과 "확인했습니다" 체크만 받고 건수를 보여 주지 않았다.
--
-- 이 migration은 주문을 확정하거나 적립금을 지급하는 로직(settle_delivered_orders·backfill·store_credit_order_transition)을
-- 고치지 않는다. 더하는 것은 읽기 전용 조회 하나이고, 고치는 것은 정책 저장 함수의 입력 검사 두 줄이다.

-- 1. 정책 저장: 근거(evidence)·확인(acknowledged)을 보내지 않아도 저장한다.
--    - 인자 시그니처는 그대로다. 옛 화면처럼 둘 다 보내는 호출도 전과 같이 저장된다.
--    - 이미 저장된 근거는 지우지 않는다. 근거를 보내지 않은 저장은 저장돼 있던 값을 그대로 둔다.
--    - acknowledged는 받기만 하고 쓰지 않는다. 그 밖의 키는 전처럼 거절한다.
--    - 나머지는 그대로다: 로그인·권한(sales.manage) 확인, 기간 형식, 켤 때 기간 필수, 다른 사람이 먼저 바꿨을 때의 거절(PT409),
--      같은 작업 번호 재시도, 소급 기한 채우기, 감사 기록.
create or replace function public.admin_save_purchase_confirmation_policy(p_values jsonb, p_revision bigint, p_operation_id uuid, p_actor uuid, p_session uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare policy private.purchase_confirmation_policy; prior public.audit_log; request jsonb; result jsonb; field text; retroactive integer;
begin
 perform private.purchase_confirmation_identity(p_actor,p_session,true);
 if p_operation_id is null or p_revision is null or p_revision<1 or jsonb_typeof(p_values) is distinct from 'object'
  or not private.transaction_json_keys(p_values-array['evidence','acknowledged'],array['autoEnabled','autoAfterDays','buyerExtensionDays'])
  or jsonb_typeof(p_values->'autoEnabled') is distinct from 'boolean'
  or p_values ? 'acknowledged' and jsonb_typeof(p_values->'acknowledged') not in('boolean','null')
  or p_values ? 'evidence' and(jsonb_typeof(p_values->'evidence') not in('string','null') or char_length(btrim(coalesce(p_values->>'evidence','')))>2000) then raise invalid_parameter_value;end if;
 foreach field in array array['autoAfterDays','buyerExtensionDays'] loop
  if p_values->field<>'null'::jsonb and (jsonb_typeof(p_values->field)<>'number' or p_values->>field!~'^[1-9][0-9]*$' or (p_values->>field)::numeric>36500) then raise invalid_parameter_value;end if;
 end loop;
 if p_values->'autoEnabled'='true'::jsonb and p_values->'autoAfterDays'='null'::jsonb then raise invalid_parameter_value;end if;
 select * into policy from private.purchase_confirmation_policy where singleton for update;
 request:=jsonb_build_object('values',p_values,'revision',p_revision,'sessionId',p_session);
 select * into prior from public.audit_log where id=p_operation_id;
 if found then
  if prior.actor_id is distinct from p_actor or prior.action<>'admin.purchase_confirmation.policy' or prior.diff->'request' is distinct from request then raise sqlstate 'PT409';end if;
  return prior.diff->'result';end if;
 if policy.revision<>p_revision then raise sqlstate 'PT409' using message='purchase_confirmation_changed';end if;
 -- 근거를 보내지 않았으면 저장돼 있던 근거를 그대로 둔다.
 update private.purchase_confirmation_policy set revision=revision+1,auto_enabled=(p_values->>'autoEnabled')::boolean,auto_after_days=(p_values->>'autoAfterDays')::integer,
  buyer_extension_days=(p_values->>'buyerExtensionDays')::integer,evidence=coalesce(nullif(btrim(p_values->>'evidence'),''),policy.evidence,''),updated_at=clock_timestamp() where singleton;
 retroactive:=private.backfill_purchase_confirmation_due_dates();
 result:=private.purchase_confirmation_policy_document();
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_actor,'admin.purchase_confirmation.policy','purchase_confirmation',
  jsonb_build_object('request',request,'result',result,'retroactiveDueDates',retroactive));
 return result;
end $function$;

-- 2. 켜기 전 미리 읽기: 지금 p_auto_after_days일로 자동 거래확정을 켜면 다음 자동 처리 한 번에서 확정될 주문 수와 지급될 적립금 합계,
--    그리고 그 뒤로 넘어가는 주문 수.
--
--    아무것도 쓰지 않는다(STABLE — 이 함수 안에서는 insert/update/delete를 실행할 수 없다). 잠금도 잡지 않는다.
--
--    세는 범위는 실제 자동 처리의 다음 실행분이다. settle_delivered_orders는 한 번에 1,000건을 고객 → 기한 → 주문 순서로 집어 든다.
--    자동 거래확정이 꺼져 있는 동안 배송완료 주문은 계속 쌓이므로, 쌓인 주문 전부에 후보 검사와 적립금 계산을 하면 조회가 주문 수만큼 느려져
--    제한 시간(authenticated 8초)에 걸린다. 그래서
--      - 값싼 조건(배송완료 상태 · 보류 아님 · 미확정 · 기한이 지금 이전)에 드는 주문을 한 번에 세고 같은 순서로 늘어놓은 뒤,
--      - 앞에서부터 후보 검사를 하며 다음 실행이 집어 들 1,000건이 찰 때까지만 본다. 적립금도 그 주문들만 계산한다.
--      - 보지 않고 남긴 주문 수(remainingDueCount)를 함께 돌려준다. 이 수는 값싼 조건만 본 것이라 후보 검사에서 빠질 주문
--        (진행 중인 취소·반품·교환, 결제 기록 없음, 계정 제한)이 섞여 있을 수 있는 최대치다.
--
--    대상은 실제 자동 처리와 같은 조건으로 고른다.
--      - 기한: 이미 받은 기한(order_purchase_confirmations.auto_due_at)이 있으면 그 값, 없으면 저장할 때 backfill이 채울
--        배송완료일 + p_auto_after_days. 배송완료일이 없는 주문은 backfill이 기한을 주지 않으므로 대상이 아니다.
--      - 후보: private.purchase_confirmation_candidate(자동 처리가 후보를 고를 때 쓰는 바로 그 함수 — 모든 배송 건 도착, 결제 완료,
--        계정 제한 없음, 진행 중인 취소·반품·교환 없음).
--      - 이용 정지 계정: 자동 처리는 1,000건을 집어 든 뒤 주문마다 계정을 다시 보고 이용 정지면 건너뛴다. 그 주문은 자리(1,000건 가운데 하나)는
--        차지하지만 확정되지 않는다. 여기서도 자리는 세고 건수(orderCount)에서는 뺀다.
--
--    적립금은 거래확정 때의 지급 계산(store_credit_order_transition의 done 분기)을 같은 순서(고객 → 기한 → 주문)로 따라간다:
--    주문 당시 적립 조건, 이미 지급한 주문 제외, 배송비·부분 취소 금액을 뺀 기준 금액, 주문당 최대, 보유 한도(만료된 적립금 제외,
--    같은 고객의 앞선 주문에서 받을 적립금 반영), 갚을 적립금 상계. 두 계산이 어긋나지 않는지는
--    supabase/tests/purchase_confirmation_preview.sql이 실제 저장 + 자동 처리 결과와 맞대어 본다(1,000건을 넘는 경우 포함).
--
--    수치는 조회 시점 값이다. 저장하기 전에 배송완료·취소·반품이 생기면 실제 결과는 달라진다.
create function public.admin_preview_purchase_confirmation_auto(p_auto_after_days integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  at_value timestamptz := statement_timestamp();
  -- settle_delivered_orders가 한 번에 집어 드는 건수(그 함수의 limit과 같아야 한다 — 스모크가 고정한다).
  run_limit constant integer := 1000;
  item record;
  ordered record;
  due_total bigint := 0;
  examined bigint := 0;
  slots integer := 0;
  current_user_id uuid;
  user_active boolean := false;
  balance jsonb;
  available bigint := 0;
  reserved bigint := 0;
  debt bigint := 0;
  policy jsonb;
  basis bigint;
  earned bigint;
  take bigint;
  order_count integer := 0;
  credit_total bigint := 0;
begin
  if (select auth.uid()) is null or not coalesce(public.has_operator_capability('sales.manage', false), false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_auto_after_days is null or p_auto_after_days not between 1 and 36500 then
    raise invalid_parameter_value using message = 'invalid_purchase_confirmation_preview_days';
  end if;

  -- 값싼 조건만으로 고르고 자동 처리와 같은 순서로 늘어놓는다. 전체 건수는 같은 질의가 함께 센다.
  -- 후보 검사(주문마다 함수 호출)는 여기 넣지 않는다 — 넣으면 쌓인 주문 전부에 실행된다.
  for item in
    select due.id, due.user_id, count(*) over () as due_total
    from (
      select o.id, o.user_id,
        coalesce(pc.auto_due_at, o.delivered_at + make_interval(days => p_auto_after_days)) as due_at
      from public.orders o
      left join private.order_purchase_confirmations pc on pc.order_id = o.id
      where o.status = 'delivered'
        and not coalesce(pc.held, false)
        and pc.confirmed_at is null
        and coalesce(pc.auto_due_at, o.delivered_at + make_interval(days => p_auto_after_days)) <= at_value
    ) due
    order by due.user_id, due.due_at, due.id
  loop
    due_total := item.due_total;
    exit when slots >= run_limit;
    examined := examined + 1;
    if not private.purchase_confirmation_candidate(item.id) then continue; end if;
    slots := slots + 1;
    if current_user_id is distinct from item.user_id then
      current_user_id := item.user_id;
      user_active := exists(select 1 from public.profiles profile where profile.id = item.user_id and profile.suspended_at is null);
      if user_active then
        -- 거래확정 때는 만료된 적립금을 먼저 만료시키고 잔액을 본다. 여기서는 만료분을 빼고 읽기만 한다.
        balance := private.store_credit_preview_balance(item.user_id);
        available := (balance->>'available')::bigint;
        reserved := (balance->>'reserved')::bigint;
        debt := (balance->>'debt')::bigint;
      end if;
    end if;
    if not user_active then continue; end if;
    order_count := order_count + 1;
    select o.total, o.shipping_fee, o.store_credit_policy_snapshot into ordered from public.orders o where o.id = item.id;
    policy := ordered.store_credit_policy_snapshot;
    if policy is null then continue; end if;
    if exists(select 1 from private.store_credit_lots lot where lot.source_order_id = item.id and lot.source_kind = 'order_done') then continue; end if;
    basis := greatest(0, ordered.total - ordered.shipping_fee - private.order_partial_canceled_goods_amount(item.id));
    if basis = 0 then continue; end if;
    earned := case when policy->>'earnKind' = 'rate_bps' then floor(basis::numeric * (policy->>'earnValue')::numeric / 10000)::bigint else (policy->>'earnValue')::bigint end;
    earned := least(earned, (policy->>'earnMaxPerOrder')::bigint);
    earned := least(earned, greatest(0, (policy->>'maxBalance')::bigint - available - reserved) + debt);
    if earned > 0 then
      credit_total := credit_total + earned;
      -- 지급한 적립금은 갚을 적립금부터 상계하고 남은 만큼이 보유액이 된다(issue_store_credit_lot).
      take := least(earned, debt);
      debt := debt - take;
      available := available + earned - take;
    end if;
  end loop;

  return jsonb_build_object(
    'autoAfterDays', p_auto_after_days,
    'orderCount', order_count,
    'storeCreditTotal', credit_total,
    'perRunLimit', run_limit,
    'remainingDueCount', due_total - examined,
    'asOf', at_value
  );
end
$$;

-- Supabase default privileges가 새 public 함수에 anon·authenticated·service_role 실행 권한을 붙인다. 모두 거둔 뒤 필요한 롤에만 준다.
-- 다시 정의한 저장 함수도 봉인을 한 번 더 적어 둔다(authenticated만 실행).
revoke all on function public.admin_preview_purchase_confirmation_auto(integer),
  public.admin_save_purchase_confirmation_policy(jsonb, bigint, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_preview_purchase_confirmation_auto(integer),
  public.admin_save_purchase_confirmation_policy(jsonb, bigint, uuid, uuid, uuid)
  to authenticated;

-- 운영자 계약: 새 조회는 정책 화면과 같은 권한(sales.manage) 읽기로 등록하고, 다시 정의한 저장 함수는 본문 지문을 재등록한다(권한·구분은 전과 같다).
select private.register_operator_rpc_contract('public.admin_preview_purchase_confirmation_auto(integer)'::regprocedure, 'sales.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_save_purchase_confirmation_policy(jsonb,bigint,uuid,uuid,uuid)'::regprocedure, 'sales.manage', 'write', false);
