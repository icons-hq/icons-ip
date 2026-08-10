-- 트랜잭션 이메일 발송 이력과 멱등 클레임 (#180).
--
-- 앱이 직접 보내는 첫 메일이다. 요구는 두 가지가 겹친다.
--   1) 토스 웹훅은 최대 7회 재전송된다 — 같은 주문에 확인 메일이 여러 번 나가면 안 된다.
--   2) 발송이 실패했을 때 재발송할 수 있어야 한다 — "한 번 시도했다"로 영구히 닫으면 안 된다.
-- 그래서 "보냈다/실패했다"를 한 행에 기록하고, 발송 직전에 그 행을 잠가 클레임한다.
-- 발송 자체는 앱 밖(HTTP)에서 일어나므로 트랜잭션으로 감쌀 수 없다. 클레임 → 발송 →
-- 결과 기록의 2단계로 나누고, 응답이 유실된 클레임은 retry_after 경과 후 다시 잡는다.
--
-- 이 테이블은 주문 확정의 진실원이 아니다. 발송 실패는 결제·주문 상태에 영향을 주지 않는다.

create table public.email_deliveries (
  id             uuid primary key default extensions.gen_random_uuid(),
  dedupe_key     text not null unique check (
    char_length(dedupe_key) between 1 and 200
    and dedupe_key ~ '[^[:space:]]'
  ),
  template       text not null check (template in ('order_confirmation', 'order_shipped')),
  recipient      text not null check (char_length(recipient) between 3 and 320),
  subject        text not null check (char_length(subject) between 1 and 200),
  status         text not null check (status in ('pending', 'sent', 'failed')),
  attempt_count  integer not null default 1 check (attempt_count between 1 and 1000),
  last_error     text check (last_error is null or char_length(last_error) <= 500),
  claimed_at     timestamptz not null default now(),
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index email_deliveries_status_idx
  on public.email_deliveries (status, claimed_at desc);

-- 발송 권한 클레임. true를 받은 호출자만 실제로 메일을 보낸다.
-- 이미 sent이거나 다른 시도가 아직 살아 있으면 false — 웹훅 재전송이 여기서 흡수된다.
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
  if target_template is null or target_template not in ('order_confirmation', 'order_shipped') then
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

-- 클레임한 발송의 결과 기록. 실패는 status='failed'로 남아 재발송 대상이 된다.
create or replace function public.complete_email_delivery(
  target_dedupe_key text,
  target_status text,
  target_error text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_key text := btrim(coalesce(target_dedupe_key, ''), E' \t\n\r\f\v');
begin
  if target_status is null or target_status not in ('sent', 'failed') then
    raise exception 'invalid_email_status' using errcode = '22023';
  end if;

  update public.email_deliveries
  set
    status = target_status,
    last_error = case when target_status = 'failed' then left(target_error, 500) else null end,
    completed_at = now()
  where dedupe_key = normalized_key
    and status = 'pending';
end;
$$;

-- 이력은 RPC로만 다룬다. 테이블 직접 접근 경로를 두지 않는다.
alter table public.email_deliveries enable row level security;
revoke all on table public.email_deliveries
  from public, anon, authenticated, service_role;

-- ⚠️ Supabase default privileges는 신규 함수에 anon/authenticated/service_role execute를
--    자동 부여한다. public만 revoke해서는 봉인되지 않는다.
revoke all on function public.claim_email_delivery(text, text, text, text, interval)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_delivery(text, text, text, text, interval)
  to service_role;

revoke all on function public.complete_email_delivery(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_email_delivery(text, text, text)
  to service_role;
