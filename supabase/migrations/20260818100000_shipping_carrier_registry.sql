-- ============================================================================
-- ICONS · 택배사 레지스트리 (#251)
--
-- 20260807140004는 `shipping_carrier in ('hanjin')` CHECK로 코드를 강제했다.
-- 그때의 판단은 "표시할 수 없는 코드를 저장하지 않는다"였고 그건 지금도 맞지만,
-- 대가로 택배사 추가가 앱 상수 + 마이그레이션 동시 변경을 요구했다. 계약 택배사가
-- 하나 늘 때마다 배포가 필요한 구조는 운영이 감당할 값이 아니다.
--
-- 그래서 허용 목록을 데이터로 내린다. 진실원은 이 테이블 하나이고, 앱의
-- lib/orders/shipment.ts는 상수를 들고 있지 않고 이 테이블을 읽는다. 택배사 추가는
-- insert 한 줄이다.
--
-- ## CHECK를 FK로 바꾸는 이유
--
-- 검증 함수(`check (public.is_shipping_carrier(...))`)도 가능하지만 CHECK 안의
-- 함수는 행이 쓰일 때만 평가된다 — 레지스트리에서 코드를 지워도 기존 주문은
-- 조용히 남아 배송조회가 깨진다. FK는 그 삭제 자체를 restrict로 막는다.
-- 비활성화(is_active=false)는 삭제가 아니므로 기존 주문의 조회 링크를 유지한다.
--
-- ## 유지하는 것
--
--   orders_tracking_number_check  운송장 형식 ^[A-Z0-9]{8,30}$
--   orders_shipment_pairing_check 택배사·운송장 쌍 제약
--
-- 둘 다 택배사 목록과 무관한 규칙이라 그대로 둔다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 레지스트리 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.shipping_carriers (
  code text primary key,
  label text not null,
  is_active boolean not null default true,
  -- 운송장번호가 들어갈 자리를 `{trackingNumber}`로 표시한 조회 URL.
  -- 운송장번호는 ^[A-Z0-9]{8,30}$ 라 URL 인코딩 없이 그대로 끼워도 안전하다.
  tracking_url_template text not null,
  -- 드롭다운 순서. 운영자가 가장 자주 고르는 택배사를 위로 올릴 수 있어야 한다.
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_carriers_code_check
    check (code ~ '^[a-z0-9_]{2,32}$'),
  constraint shipping_carriers_label_check
    check (btrim(label) <> '' and length(label) <= 60),
  -- 템플릿에 자리표시자가 없으면 모든 주문이 같은 URL로 간다. https도 강제한다 —
  -- 고객 주문 상세에 실리는 외부 링크다.
  constraint shipping_carriers_tracking_url_template_check
    check (
      tracking_url_template like 'https://%'
      and position('{trackingNumber}' in tracking_url_template) > 0
      and length(tracking_url_template) <= 500
    )
);

drop trigger if exists shipping_carriers_touch on public.shipping_carriers;
create trigger shipping_carriers_touch
  before update on public.shipping_carriers
  for each row execute function public.set_updated_at();

alter table public.shipping_carriers enable row level security;

-- 카탈로그성 데이터다. 배송조회 링크는 고객 주문 상세가 그리므로 읽기는 공개다.
drop policy if exists shipping_carriers_public_read on public.shipping_carriers;
create policy shipping_carriers_public_read on public.shipping_carriers
  for select using (true);

-- 등록·수정·비활성화는 staff만. 택배사 추가가 "레지스트리 등록만"으로 끝나려면
-- 운영자가 배포 없이 이 테이블을 쓸 수 있어야 한다.
drop policy if exists shipping_carriers_staff_write on public.shipping_carriers;
create policy shipping_carriers_staff_write on public.shipping_carriers
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

grant select on public.shipping_carriers to anon, authenticated;
grant insert, update, delete on public.shipping_carriers to authenticated;

-- ---------------------------------------------------------------------------
-- 2. 시작값 — 실제 계약 택배사
-- ---------------------------------------------------------------------------
-- 계약하지 않은 택배사를 미리 넣지 않는다. 운영자가 고를 수 있는 목록에 있는
-- 것만으로 "보낼 수 있다"는 신호가 되고, 잘못 고르면 조회되지 않는 운송장이 고객
-- 주문 상세에 걸린다. 김포 창고는 한진택배 단독 계약이다(#177).
insert into public.shipping_carriers (code, label, tracking_url_template, sort_order)
values (
  'hanjin',
  '한진택배',
  'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do'
    || '?mCode=MN038&schLang=KR&wblnumText2={trackingNumber}',
  10
)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. orders.shipping_carrier — CHECK를 FK로 교체
-- ---------------------------------------------------------------------------
alter table public.orders
  drop constraint if exists orders_shipping_carrier_check;

-- on update cascade: 코드 오타 정정이 기존 주문을 고아로 만들지 않는다.
-- on delete restrict: 주문이 참조하는 택배사는 지울 수 없다. 목록에서 내리려면
-- is_active=false로 비활성화한다 — 그래야 기존 주문의 조회 링크가 살아 있다.
alter table public.orders
  add constraint orders_shipping_carrier_fkey
    foreign key (shipping_carrier) references public.shipping_carriers (code)
    on update cascade on delete restrict;

-- FK 참조 검사(restrict)가 orders 전체를 훑지 않게 한다.
create index if not exists orders_shipping_carrier_idx
  on public.orders (shipping_carrier)
  where shipping_carrier is not null;

-- ---------------------------------------------------------------------------
-- 4. 상태 전이·운송장 정정의 활성 택배사 게이트
-- ---------------------------------------------------------------------------
-- FK는 "등록된 코드인가"만 본다. "지금 고를 수 있는 택배사인가"는 FK로 표현할 수
-- 없다 — 비활성 택배사는 기존 주문에는 남아야 하고 새 등록에는 쓰이면 안 된다.
-- 그 구분을 쓰기 경로에서 건다. 20260818090001(#250) 본문에 게이트만 더한다.
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

  if p_status not in ('confirmed', 'shipping', 'delivered') then
    raise check_violation using message = 'invalid_order_status';
  end if;

  if v_current_status = p_status then
    return;
  end if;

  if not (
    (v_current_status = 'paid' and p_status = 'confirmed')
    or (v_current_status = 'confirmed' and p_status = 'shipping')
    or (v_current_status = 'shipping' and p_status = 'delivered')
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

  -- 승인된 청약철회는 durable claim으로 남아 finalizer를 기다린다. 그 사이
  -- 주문을 앞으로 미는 것은 환불 대상 주문을 계속 처리하는 것이라 막는다.
  if exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
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

  -- 새로 붙는 택배사만 활성 여부를 본다. 이미 붙어 있던 코드가 그 사이
  -- 비활성화됐다고 배송완료 전이가 막히면 안 된다.
  if v_carrier is not null and v_carrier is distinct from v_current_carrier then
    if not exists (
      select 1
      from public.shipping_carriers as carrier
      where carrier.code = v_carrier
        and carrier.is_active
    ) then
      raise check_violation using message = 'inactive_shipping_carrier';
    end if;
  end if;

  update public.orders
  set
    status = p_status,
    shipping_carrier = v_carrier,
    tracking_number = v_tracking,
    confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
    shipped_at = case when p_status = 'shipping' then now() else shipped_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end
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

create or replace function public.admin_update_order_tracking(
  p_order_id uuid,
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

  if v_carrier is null or v_tracking is null then
    raise check_violation using message = 'tracking_required';
  end if;

  select orders.status, orders.shipping_carrier, orders.tracking_number
  into v_current_status, v_current_carrier, v_current_tracking
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  -- 출고 전 주문에는 운송장이 없다. 배송이 시작된 주문만 정정 대상이다.
  if v_current_status not in ('shipping', 'delivered', 'done') then
    raise check_violation using message = 'order_not_shipped';
  end if;

  if v_current_carrier is not distinct from v_carrier
    and v_current_tracking is not distinct from v_tracking
  then
    return;
  end if;

  -- 정정으로 택배사를 바꾸는 경우도 활성 택배사여야 한다.
  if v_carrier is distinct from v_current_carrier then
    if not exists (
      select 1
      from public.shipping_carriers as carrier
      where carrier.code = v_carrier
        and carrier.is_active
    ) then
      raise check_violation using message = 'inactive_shipping_carrier';
    end if;
  end if;

  update public.orders
  set
    shipping_carrier = v_carrier,
    tracking_number = v_tracking
  where id = p_order_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.tracking_updated',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'fromCarrier', v_current_carrier,
      'fromTrackingNumber', v_current_tracking,
      'toCarrier', v_carrier,
      'toTrackingNumber', v_tracking
    )
  );
end;
$$;

revoke all on function public.admin_update_order_tracking(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_update_order_tracking(uuid, text, text)
  to authenticated;
