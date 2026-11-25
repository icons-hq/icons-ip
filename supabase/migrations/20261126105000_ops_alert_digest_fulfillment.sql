-- 운영 알림 요약 메일 — 출고 보류·발송 지연 (원장 SHP-107·SHP-135).
--
-- 운영 알림 요약 메일(20261119107000)에는 두 가지가 없었다.
--   · 해제되지 않은 출고 보류: 이미 창고로 넘어간 출고지시는 시스템이 붙잡지 못한다. 창고 전달 뒤에 걸린 보류(결제사 취소·입금 되돌림·
--     에스크로 취소 요청)는 사람이 창고에 연락해야 해서, 화면을 열지 않는 시간에도 알아야 한다.
--   · 발송 지연: 관리자 첫 화면 '처리할 업무'의 발송 지연(발주·발송 목록 '발송 지연' 탭)과 같은 기준이다 — 발주확인된(확정·배송중) 주문의
--     발송 전(ready) 배송 건 중 처음 약속한 출고 예정일이 있으면 그 예정일이 오늘(KST)보다 앞선 건, 없으면 발주확인 3일이 지난 건.
-- 새 범주를 만들지 않고 기존 '시스템' 범주(설정·카운트 키 그대로)에 알림 행으로 올린다. 같은 건을 반복 알리지 않는 규칙은 메일 발송 실패와 같다:
-- event_key에 '가장 늦게 생긴 건의 시각'을 넣고, 지금까지 알린 가장 늦은 시각(기존 알림 행의 키)보다 늦은 건이 있을 때만 새 알림 행이 올라온다(건수는 그 시점의
-- 전체 건수, 보류는 주문 수). 같은 상태가 이어지거나 늦은 건이 먼저 풀려도 다시 올라오지 않는다. 센 알림 표식·켠 시각 이후·6시간 안 규칙은 그대로다. 메일에는 건수와 한 줄 안내만 싣는다
-- (주문번호·고객 정보 없음). 이 함수는 요약을 만들 때(prepare_ops_alert_digest, 같은 잠금 안) 불린다 — '시스템' 범주를 껐으면 불리지 않는다.
begin;

create function private.raise_fulfillment_digest_alerts(p_now timestamptz)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare today_kst date:=(p_now at time zone 'Asia/Seoul')::date;made integer:=0;rows integer;
  holds integer;last_hold timestamptz;delayed integer;last_delay timestamptz;seen_us bigint;now_us bigint;
begin
  -- 해제되지 않은 출고 보류(취소된 주문의 보류는 취소 때 자동으로 닫힌다).
  select count(distinct h.order_id),max(h.created_at) into holds,last_hold
    from private.order_fulfillment_holds h join public.orders o on o.id=h.order_id
    where h.released_at is null and o.status<>'canceled';
  -- 지금까지 알린 가장 늦은 시각(기존 알림 행의 키)보다 늦은 보류가 있을 때만 올린다. 늦은 건이 먼저 풀려 '남은 건의 가장 늦은 시각'이
  -- 줄어도 새 건이 아니므로 다시 알리지 않는다.
  select max(substring(a.event_key from ':([0-9]+)$')::bigint) into seen_us
    from private.admin_operation_alerts a where a.event_key like 'system_fulfillment_holds:%';
  now_us:=(extract(epoch from last_hold)*1000000)::bigint;
  if holds>0 and (seen_us is null or now_us>seen_us) then
    insert into private.admin_operation_alerts(event_key,category,title,href)
      values('system_fulfillment_holds:'||(extract(epoch from last_hold)*1000000)::bigint,'system',
        left('출고 보류 '||holds||'건이 풀리지 않았습니다 · 창고에 넘어간 주문은 창고에 직접 연락하세요',120),'/admin/sales/orders')
      on conflict(event_key) do nothing;
    get diagnostics rows=row_count;made:=made+rows;
  end if;
  -- 발송 지연: '처리할 업무'의 발송 지연과 같은 기준. 늦어진 시각 = 예정일 다음 날 0시(KST) 또는 발주확인 + 3일.
  select count(*),max(case when s.original_expected_ship_date is not null
      then (s.expected_ship_date+1)::timestamp at time zone 'Asia/Seoul' else o.confirmed_at+interval '3 days' end)
    into delayed,last_delay
    from public.order_shipments s join public.orders o on o.id=s.order_id
    where o.status in ('confirmed','shipping') and s.status='ready'
      and case when s.original_expected_ship_date is not null then s.expected_ship_date<today_kst
        else o.confirmed_at<p_now-interval '3 days' end;
  select max(substring(a.event_key from ':([0-9]+)$')::bigint) into seen_us
    from private.admin_operation_alerts a where a.event_key like 'system_shipment_delays:%';
  now_us:=(extract(epoch from last_delay)*1000000)::bigint;
  if delayed>0 and last_delay is not null and (seen_us is null or now_us>seen_us) then
    insert into private.admin_operation_alerts(event_key,category,title,href)
      values('system_shipment_delays:'||(extract(epoch from last_delay)*1000000)::bigint,'system',
        left('발송 지연 '||delayed||'건이 있습니다 · 발주확인 뒤 발송이 늦어진 배송 건',120),'/admin/sales/dispatch')
      on conflict(event_key) do nothing;
    get diagnostics rows=row_count;made:=made+rows;
  end if;
  return made;
end $$;
revoke all on function private.raise_fulfillment_digest_alerts(timestamptz) from public,anon,authenticated,service_role;

-- prepare_ops_alert_digest는 현재 정의에서 호출 한 줄만 바꾼다(앵커가 정확히 한 번이 아니면 멈춘다).
create function private.ofd_patch(p_function regprocedure,p_anchor text,p_replacement text) returns void
language plpgsql volatile set search_path='' as $$
declare body text:=pg_get_functiondef(p_function);found_count integer;
begin
  found_count:=(length(body)-length(replace(body,p_anchor,'')))/length(p_anchor);
  if found_count<>1 then raise exception 'ofd_anchor_changed: % (found %)',p_function,found_count;end if;
  execute replace(body,p_anchor,p_replacement);
end $$;
revoke all on function private.ofd_patch(regprocedure,text,text) from public,anon,authenticated,service_role;

select private.ofd_patch('private.prepare_ops_alert_digest(timestamptz)'::regprocedure,
  'perform private.raise_system_health_alerts(p_now);',
  'perform private.raise_system_health_alerts(p_now);perform private.raise_fulfillment_digest_alerts(p_now);');
drop function private.ofd_patch(regprocedure,text,text);

revoke all on function private.prepare_ops_alert_digest(timestamptz) from public,anon,authenticated,service_role;
-- 재정의한 함수의 운영자 계약을 새 본문·ACL로 다시 등록한다(등록돼 있지 않으면 아무것도 하지 않는다).
do $$declare fn regprocedure:='private.prepare_ops_alert_digest(timestamptz)'::regprocedure;contract record;begin
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);end if;
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
    perform private.register_operator_internal_contract(fn);
  end if;
end $$;

commit;
notify pgrst,'reload schema';
