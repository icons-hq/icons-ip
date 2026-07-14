-- ============================================================================
-- ICONS · 결제 인프라(#88) — 만료 pending 주문·예매 자동 정리(선점 재고 복원)
-- 근거: docs/ARCHITECTURE.md §9 ④ 실패·만료 시 선점 복원
--
-- 승인 진행 중인 건(payments에 pending/paid 행 존재)은 건너뛴다 — 그 상태의
-- 확정/취소는 웹훅 경로가 책임진다. 만료 직후 승인과의 경합은 5분 유예와
-- confirm_* RPC의 만료 검사 + 웹훅의 토스 자동 취소 경로가 흡수한다.
-- ============================================================================

create extension if not exists pg_cron;

create or replace function public.expire_stale_checkouts()
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer := 0; r record;
begin
  -- 주문: cancel_order가 재고 복원·미사용 뽑기권 회수까지 처리한다.
  -- (auth.uid()가 null인 cron/service 컨텍스트는 소유자 가드를 통과하되
  --  pending/paid 상태 제한은 그대로 적용된다)
  for r in
    select o.id from orders o
    where o.status = 'pending'
      and o.expires_at is not null
      and o.expires_at < now() - interval '5 minutes'
      and not exists (
        select 1 from payments p
        where p.purpose = 'order' and p.ref_id = o.id and p.status in ('pending', 'paid')
      )
    order by o.expires_at
    limit 200
  loop
    perform public.cancel_order(r.id, '결제 시간 만료 자동 취소');
    v_count := v_count + 1;
  end loop;

  -- 예매: refund_ticket_order가 sold 복원·placeholder 티켓 정리까지 처리한다.
  for r in
    select t.id from ticket_orders t
    where t.status = 'pending'
      and t.expires_at is not null
      and t.expires_at < now() - interval '5 minutes'
      and not exists (
        select 1 from payments p
        where p.purpose = 'ticket' and p.ref_id = t.id and p.status in ('pending', 'paid')
      )
    order by t.expires_at
    limit 200
  loop
    perform public.refund_ticket_order(r.id, '결제 시간 만료 자동 취소');
    v_count := v_count + 1;
  end loop;

  return v_count;
end; $$;

-- 매분 sweep이 전체 주문을 훑지 않도록 pending 전용 부분 인덱스
create index orders_pending_expiry_idx on public.orders (expires_at) where status = 'pending';
create index ticket_orders_pending_expiry_idx on public.ticket_orders (expires_at) where status = 'pending';

-- default privileges 봉인(AGENTS.md) — 스케줄러(postgres)와 수동 운영(service_role)만 실행
revoke all on function public.expire_stale_checkouts()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_checkouts() to service_role;

-- 매분 실행 — cron.schedule은 이름 기준 upsert라 재적용에도 안전하다
select cron.schedule('expire-stale-checkouts', '* * * * *', 'select public.expire_stale_checkouts()');
