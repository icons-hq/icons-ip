-- ==========================================================================
-- 자동 재확인 후보의 우선순위와 회차당 상한 — 원장 VAC-021·VAC-025(2026-11-25)
--
-- 토스는 가상계좌 입금 기한 만료에 웹훅을 보내지 않는다. 기한이 지난 입금 대기는 자동 재확인 cron이 조회해야
-- 닫히고, 닫히기 전까지 주문이 재고·예약 물량·쿠폰·적립금을 잡는다. 지금까지는 회차(10분)당 3건을 '마지막 확인이
-- 오래된 순'으로 골라, 기한 전 입금 대기의 6시간 정기 점검이 기한 지난 입금 대기와 카드 결과 불명 건을 밀어낼 수
-- 있었다(가상계좌 주문이 수백 건이면 만료 주문이 몇 시간~하루 넘게 결제대기로 남는다).
--
-- 이 migration이 바꾸는 것(고르는 대상·다시 고르는 간격·뽑기 표식은 그대로):
--   1. 회차당 상한을 1~5에서 1~30으로 넓힌다(앱이 30건을 5건씩 동시에 조회한다).
--   2. 우선순위 단계로 고른다.
--        0 결과 불명·멈춘 확인(unknown·리스 만료 confirming) — 돈이 빠졌을 수 있는 결제
--        1 입금 기한 + 30분(앱 DEPOSIT_GRACE_MS)이 지난 입금 대기 — 한 번 조회로 반납·종료된다
--        2 입금 기한 + 2분 ~ + 30분의 입금 대기 — 토스가 계좌를 만료(`expired`)시켰으면 바로 닫힌다.
--          유예 안에서 조회해도 닫히지 않으면 1로 넘어갈 때까지 다시 고르지 않는다(기한 뒤 한 번만)
--        3 기한 전 입금 대기의 6시간 정기 점검(웹훅 누락 대비) — 남는 칸만 쓴다
--      단계 안에서는 1·2는 입금 기한이 이른 순, 그 밖은 지금처럼 마지막 확인이 오래된 순이다.
-- ==========================================================================

begin;

create or replace function public.service_claim_payment_reconciliation_candidates(p_limit integer, p_providers text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare at timestamptz := clock_timestamp(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 30 or p_providers is null or cardinality(p_providers) > 4
    or array_position(p_providers, null) is not null or not (p_providers <@ array['toss', 'nicepay']::text[]) then
    raise invalid_parameter_value using message = 'invalid_reconciliation_candidate_filter';
  end if;
  with candidates as (
    select a.id, a.purpose, a.provider, a.ref_id, a.updated_at, a.state, a.expires_at,
      greatest(
        (select max(g.requested_at) from private.goods_payment_reconciliation_audits g where g.target_id = a.id),
        (select max(t.requested_at) from private.ticket_payment_reconciliation_audits t where t.target_id = a.id),
        (select m.last_picked_at from private.payment_reconciliation_auto_checks m where m.attempt_id = a.id)) as last_checked_at,
      case
        when a.state <> 'awaiting_deposit' then 0
        when a.expires_at <= at - interval '30 minutes' then 1
        when a.expires_at <= at - interval '2 minutes' then 2
        else 3
      end as tier
    from public.payment_attempts a
    where a.provider::text = any(p_providers)
      and a.created_at >= at - interval '7 days'
      and (
        (a.state in ('unknown', 'confirming')
          and private.payment_attempt_unresolved(a.state, a.claim_expires_at, at)
          and ((a.purpose = 'order' and a.provider in ('toss', 'nicepay')) or (a.purpose = 'ticket' and a.provider = 'toss'))
          and a.updated_at <= at - interval '10 minutes')
        or (a.state = 'awaiting_deposit' and a.purpose = 'order' and a.provider = 'toss'
          and (a.expires_at <= at - interval '2 minutes' or a.updated_at <= at - interval '6 hours'))
      )
  ), ranked as (
    select c.*, row_number() over (
      order by c.tier, case when c.tier in (1, 2) then c.expires_at end, c.last_checked_at nulls first, c.updated_at, c.id) as rank
    from candidates c
    where (c.last_checked_at is null
        or c.last_checked_at <= at - case when c.state = 'awaiting_deposit' then interval '10 minutes' else interval '30 minutes' end)
      -- 유예 안 확인은 입금 기한 뒤 한 번만 — 닫히지 않았으면 1단계(기한 + 30분)에서 다시 본다.
      and (c.tier <> 2 or c.last_checked_at is null or c.last_checked_at < c.expires_at)
  ), picked as (
    select r.id, r.purpose, r.provider, r.ref_id, r.rank from ranked r where r.rank <= p_limit
  ), marked as (
    insert into private.payment_reconciliation_auto_checks as m(attempt_id, last_picked_at)
    select id, at from picked
    on conflict (attempt_id) do update set last_picked_at = excluded.last_picked_at, picks = m.picks + 1
    returning m.attempt_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('attemptId', p.id, 'purpose', p.purpose, 'provider', p.provider, 'refId', p.ref_id)
    order by p.rank), '[]'::jsonb)
  into result
  from picked p where p.id in (select attempt_id from marked);
  return result;
end $function$;

commit;

notify pgrst, 'reload schema';
