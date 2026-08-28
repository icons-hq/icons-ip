-- S4 commerce core (#326) migration ④: 재입고 알림.
--
-- 품절 굿즈가 다시 판매되면 알려달라는 신청(CONTEXT.md "재입고 알림"). 발송 채널은
-- 기존 알림함(notifications)과 트랜잭셔널 메일(email_deliveries) 재사용이다.
--
-- 발화 지점은 RPC 가 아니라 goods AFTER UPDATE 트리거다. "판매 가능"
-- (archived_at is null and stock <> 'soldout' and stock_qty > 0 — 앱 표시·카트·
-- 주문 게이트와 동일 술어)이 거짓→참으로 전이하는 순간만 잡는다. 재고 전이는
-- 어드민 RPC(admin_adjust_stock, admin_upsert_good)만이 아니라 주문 취소·반품의
-- 재고 복원(service role)에서도 일어나므로, 특정 RPC 에 걸지 않고 행 전이 자체에
-- 건다. staff 게이트도 두지 않는다 — pending 신청자가 있을 때만 의미가 생기는
-- 구조라 where 절이 자연 게이트다.
--
-- 이메일은 DB 가 직접 보내지 않는다. 트리거는 행을 notified 로 전이하고 알림함에
-- 팬아웃할 뿐, 실제 발송은 앱 producer(lib/email/transactional.server.ts)가
-- claim_email_delivery 멱등 게이트를 통해 수행한다.

create table public.restock_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  good_id text not null references public.goods (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'notified')),
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  -- 상태와 발송 시각은 항상 함께 움직인다 — 어긋난 조합은 존재할 수 없다.
  constraint restock_alerts_notified_at_state
    check ((status = 'notified') = (notified_at is not null)),
  -- 사용자×굿즈 1행. 재신청은 새 행이 아니라 기존 행을 pending 으로 되돌린다.
  constraint restock_alerts_user_good_key unique (user_id, good_id)
);

-- 트리거의 pending 조회와 good_id FK cascade 를 함께 받는다.
create index restock_alerts_good_status_idx on public.restock_alerts (good_id, status);

alter table public.restock_alerts enable row level security;

create policy restock_alerts_self_read on public.restock_alerts
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- 클라이언트에는 읽기만 연다. status·notified_at 은 전이 트리거가 소유하는 상태라,
-- 테이블 update 를 열면 자기 행이라도 notified 를 조작해 알림을 스스로 끄거나 가짜
-- 발송 사이클(새 notified_at = 새 dedupe 키)을 만들 수 있다. 신청·재신청은 아래
-- request_restock_alert RPC 만이 쓴다. delete 는 없다 — 신청·발송 이력은 남긴다.
-- 이메일 producer 는 service role 로 notified 행을 읽는다(BYPASSRLS 는 테이블
-- privilege 를 면제하지 않는다).
revoke all on table public.restock_alerts from public, anon, authenticated, service_role;
grant select on table public.restock_alerts to authenticated;
grant select on table public.restock_alerts to service_role;

-- 신청·재신청. 품절 판정과 upsert 를 한 트랜잭션에서 goods 행 잠금(for share)과 함께
-- 수행한다 — 판정과 신청 사이에 재입고 전이(goods UPDATE, for update)가 끼어들면
-- 트리거는 신청자를 못 보고 신청은 pending 으로 남아 다음 사이클까지 침묵하는
-- 경합이 있었다. 잠금으로 전이 트랜잭션과 직렬화한다.
create function public.request_restock_alert(target_good_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  good_stock text;
  good_stock_qty integer;
  good_archived_at timestamptz;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select stock, stock_qty, archived_at
  into good_stock, good_stock_qty, good_archived_at
  from public.goods
  where id = target_good_id
  for share;

  if not found or good_archived_at is not null then
    raise exception 'good_missing' using errcode = 'P0002';
  end if;

  -- 판매 가능 술어는 앱 표시·카트·주문 게이트와 같다. 판매 중인 굿즈에 신청이
  -- 붙으면 전이 조건(거짓→참)이 영영 성립하지 않아 신청자가 기다리다 끝난다.
  if good_stock <> 'soldout' and good_stock_qty > 0 then
    raise exception 'good_available' using errcode = '22023';
  end if;

  insert into public.restock_alerts (user_id, good_id)
  values (actor_id, target_good_id)
  on conflict (user_id, good_id)
  do update set status = 'pending', notified_at = null, created_at = now();
end;
$$;

revoke all on function public.request_restock_alert(text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_restock_alert(text) to authenticated;

-- 알림함 type 에 restock_available 을 덧붙인다. 목록을 통째로 다시 쓰면 브랜치가
-- 갈라졌을 때 다른 타입을 조용히 지우므로, 기존 정의를 읽어 덧붙인다
-- (20260818130001 goods_reviews 의 확장 패턴).
do $$
declare
  v_def text;
  v_values text;
begin
  select pg_get_constraintdef(constraint_row.oid)
  into strict v_def
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.notifications'::regclass
    and constraint_row.conname = 'notifications_type_check';

  select string_agg(distinct quote_literal(matched[1]), ', ')
  into v_values
  from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') as matched;

  if v_values is null then
    raise exception 'notifications_type_check has no readable type list';
  end if;

  if position('''restock_available''' in v_values) = 0 then
    v_values := v_values || ', ' || quote_literal('restock_available');
  end if;

  execute 'alter table public.notifications drop constraint notifications_type_check';
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type in (%s))',
    v_values
  );
end;
$$;

create or replace function private.notify_goods_restock()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- 판매 가능 술어가 거짓→참으로 전이할 때만 발화한다.
  if not (
    new.archived_at is null
    and new.stock <> 'soldout'
    and new.stock_qty > 0
  ) or (
    old.archived_at is null
    and old.stock <> 'soldout'
    and old.stock_qty > 0
  ) then
    return new;
  end if;

  with flipped as (
    update public.restock_alerts
    set status = 'notified', notified_at = now()
    where good_id = new.id and status = 'pending'
    returning user_id
  )
  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  select
    flipped.user_id,
    'restock_available',
    '재입고 알림',
    left(new.name || ' 굿즈가 다시 판매를 시작했어요.', 500),
    '/shop/' || new.id,
    'good',
    new.id,
    -- 재신청→재품절→재입고 사이클마다 새 알림이어야 하므로 시각을 키에 넣는다.
    -- now() 는 트랜잭션 시작에 고정되어 같은 트랜잭션(또는 같은 초)의 두 사이클이
    -- 충돌하므로, 문장 시각(clock_timestamp) 밀리초로 사이클을 구분한다.
    'restock:' || new.id || ':'
      || (extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint::text
  from flipped
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

revoke all on function private.notify_goods_restock() from public, anon, authenticated, service_role;

create trigger trg_goods_notify_restock
after update of stock, stock_qty, archived_at on public.goods
for each row
execute function private.notify_goods_restock();

-- 트랜잭셔널 메일 template 에 restock_alert 를 덧붙인다. CHECK 는 이름을 정의로
-- 찾아 지우고(20260818110000 의 주의문 — 이름을 짐작해 drop 하면 실제 이름이 다를 때
-- 조용히 남는다), 클레임 함수 본문의 허용 목록도 함께 넓힌다 — CHECK 만 넓히면
-- invalid_email_template 로 한 통도 나가지 않는다.
do $$
declare
  v_name text;
begin
  select constraint_check.conname
  into v_name
  from pg_catalog.pg_constraint as constraint_check
  where constraint_check.conrelid = 'public.email_deliveries'::regclass
    and constraint_check.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_check.oid) like '%order_confirmation%';

  if v_name is null then
    raise exception 'email_deliveries template check not found';
  end if;

  execute pg_catalog.format(
    'alter table public.email_deliveries drop constraint %I',
    v_name
  );
end;
$$;

alter table public.email_deliveries
  add constraint email_deliveries_template_check check (
    template in ('order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert')
  );

create or replace function public.claim_email_delivery(
  target_dedupe_key text,
  target_template text,
  target_recipient text,
  target_subject text,
  target_retry_after interval default interval '10 minutes'
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_key text := btrim(coalesce(target_dedupe_key, ''), E' \t\n\r\f\v');
  normalized_subject text := btrim(coalesce(target_subject, ''), E' \t\n\r\f\v');
  normalized_recipient text := btrim(coalesce(target_recipient, ''), E' \t\n\r\f\v');
  existing record;
begin
  if char_length(normalized_key) < 1 or char_length(normalized_key) > 200 then
    raise exception 'invalid_dedupe_key' using errcode = '22023';
  end if;
  if target_template is null
    or target_template not in ('order_confirmation', 'order_shipped', 'inquiry_answered', 'restock_alert')
  then
    raise exception 'invalid_email_template' using errcode = '22023';
  end if;
  if char_length(normalized_recipient) < 3 or char_length(normalized_recipient) > 320 then
    raise exception 'invalid_email_recipient' using errcode = '22023';
  end if;
  if char_length(normalized_subject) < 1 or char_length(normalized_subject) > 200 then
    raise exception 'invalid_email_subject' using errcode = '22023';
  end if;

  -- 응답이 유실된 재시도는 먼저 커밋된 클레임을 관측한 뒤에 판단해야 한다.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('email_delivery:' || normalized_key, 0)
  );

  select delivery.id, delivery.status, delivery.attempt_count, delivery.claimed_at
    into existing
  from public.email_deliveries as delivery
  where delivery.dedupe_key = normalized_key
  for update;

  if found then
    if existing.status = 'sent' then
      return false;
    end if;
    if existing.status = 'pending'
      and existing.claimed_at > now() - coalesce(target_retry_after, interval '10 minutes')
    then
      return false;
    end if;
    if existing.attempt_count >= 1000 then
      return false;
    end if;

    update public.email_deliveries
    set
      status = 'pending',
      attempt_count = existing.attempt_count + 1,
      subject = normalized_subject,
      recipient = normalized_recipient,
      claimed_at = now(),
      completed_at = null
    where id = existing.id;

    return true;
  end if;

  insert into public.email_deliveries (
    dedupe_key,
    template,
    recipient,
    subject,
    status
  )
  values (
    normalized_key,
    target_template,
    normalized_recipient,
    normalized_subject,
    'pending'
  );

  return true;
end;
$$;

revoke all on function public.claim_email_delivery(text, text, text, text, interval)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_delivery(text, text, text, text, interval)
  to service_role;
