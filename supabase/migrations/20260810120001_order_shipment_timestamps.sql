-- ============================================================================
-- ICONS · 배송 시점 기록 (#189)
-- 청약철회 기한의 법정 기준은 "재화를 공급받은 날"이다. 지금까지 orders는 상태만
-- 남기고 그 날짜를 기록하지 않아 기한을 판정할 근거 자체가 없었다.
-- 발송(shipping)과 공급(done)을 나눠 기록한다 — 기한 기산점은 delivered_at이고,
-- shipped_at은 배송 소요 확인과 CS 대응에 쓴다.
-- 기존 행은 백필하지 않는다. delivered_at이 비어 있으면 기한이 아직 시작하지
-- 않은 것으로 보는 편이 고객에게 유리하고, 잘못된 기산점으로 환급 의무를
-- 조기 종료시키는 것보다 안전하다.
-- ============================================================================

alter table public.orders
  add column shipped_at timestamptz,
  add column delivered_at timestamptz;

-- 상태 전이가 시점을 함께 남긴다. 전이는 paid→shipping→done 단방향이고 같은
-- 상태로의 재호출은 조기 반환하므로, 각 시점은 한 번만 기록된다.
create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_status public.order_status,
  p_carrier text,
  p_tracking_number text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_current_status public.order_status;
  v_current_carrier text;
  v_current_tracking text;
  v_carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
  v_tracking text := nullif(btrim(coalesce(p_tracking_number, '')), '');
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select orders.status, orders.shipping_carrier, orders.tracking_number
  into v_current_status, v_current_carrier, v_current_tracking
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if p_status not in ('shipping', 'done') then
    raise check_violation using message = 'invalid_order_status';
  end if;

  if v_current_status = p_status then
    return;
  end if;

  if not (
    (v_current_status = 'paid' and p_status = 'shipping')
    or (v_current_status = 'shipping' and p_status = 'done')
  ) then
    raise exception using message = 'invalid_order_transition';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    raise check_violation using message = 'order cancellation in progress';
  end if;

  -- 입력을 생략하면 이미 등록된 운송장을 유지한다. 배송 완료 전이가 송장을
  -- 조용히 지우지 않게 하는 장치다.
  v_carrier := coalesce(v_carrier, v_current_carrier);
  v_tracking := coalesce(v_tracking, v_current_tracking);

  if (v_carrier is null) <> (v_tracking is null) then
    raise check_violation using message = 'invalid_tracking_input';
  end if;

  -- 운송장 없이 배송을 시작하면 고객이 배송을 추적할 수 없다. fail closed한다.
  if p_status = 'shipping' and v_tracking is null then
    raise check_violation using message = 'tracking_required';
  end if;

  update public.orders
  set
    status = p_status,
    shipping_carrier = v_carrier,
    tracking_number = v_tracking,
    shipped_at = case when p_status = 'shipping' then now() else shipped_at end,
    delivered_at = case when p_status = 'done' then now() else delivered_at end
  where id = p_order_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.status_updated',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'from', v_current_status::text,
      'to', p_status::text,
      'carrier', v_carrier,
      'trackingNumber', v_tracking
    )
  );
end;
$$;

revoke all on function public.admin_update_order_status(
  uuid, public.order_status, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_order_status(
  uuid, public.order_status, text, text
) to authenticated;
