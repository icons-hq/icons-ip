-- ============================================================================
-- ICONS · 인앱 1:1 문의 스레드와 어드민 문의 큐 (#253)
--
-- 문의는 "대화"다 — 사용자가 묻고 운영자가 답하고 종결한다. 처리 절차와 상태기계를
-- 가진 클레임(취소·반품·교환)과는 개념도 기록도 분리한다(CONTEXT.md). 문의에서
-- 클레임이 필요해지면 운영자가 주문의 클레임 접수 경로를 안내할 뿐, 이 테이블이
-- 환불이나 재출고를 만들지 않는다.
--
-- 쓰기 경로는 전부 RPC다(email_deliveries 선례). 테이블에는 select 정책만 둔다 —
-- 상태 전이 규칙(사용자 메시지 → open, 운영자 답변 → answered, 종결 → closed)이
-- 앱 코드에 흩어지면 재오픈 한 줄을 빠뜨린 호출자가 답변된 문의를 조용히 묻어버린다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 기존 CHECK 확장 — 알림 타입과 메일 템플릿
-- ---------------------------------------------------------------------------
-- 새 메일 템플릿은 세 곳을 함께 고쳐야 한다: 이 CHECK · lib/email/dedupe.ts의
-- EMAIL_TEMPLATE_NAMES · lib/email/templates.ts의 렌더러. 한 곳만 바뀌면 클레임이
-- invalid_email_template로 막히거나(DB) 발송 이력에서 행이 사라진다(앱).
alter table public.notifications
  drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type in (
      'order_paid',
      'order_shipping',
      'order_delivered',
      'draw_ticket_issued',
      'drop_published',
      'event_published',
      'announcement',
      'inquiry_answered'
    )
  );

-- 이 CHECK는 인라인 컬럼 제약이라 이름이 자동 생성됐다(20260807130001). 이름을 짐작해
-- drop하면 실제 이름이 다를 때 조용히 남아 새 템플릿 insert가 런타임에 막힌다.
-- 정의로 찾아 지우고, 못 찾으면 여기서 크게 실패시킨다.
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
    template in ('order_confirmation', 'order_shipped', 'inquiry_answered')
  );

-- 클레임 함수는 허용 템플릿을 본문에 박아 두고 있다. CHECK만 넓히면 문의 답변 메일이
-- invalid_email_template로 막혀 한 통도 나가지 않는다.
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
    or target_template not in ('order_confirmation', 'order_shipped', 'inquiry_answered')
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

-- 재발송 게이트는 "모든 dedupe_key가 주문 uuid를 담는다"를 전제로 만들어졌다.
-- 문의 답변 메일의 키는 메시지 id라 그 전제가 깨진다. 지금 그대로 두면 게이트가
-- 메시지 id로 orders를 조회해 order_missing을 던진다 — 실패 이유가 거짓말이 된다.
-- 주문에 매이지 않는 템플릿은 명시적으로 재발송 대상이 아니라고 답한다(fail-closed).
create or replace function public.admin_request_email_resend(p_dedupe_key text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text := nullif(btrim(coalesce(p_dedupe_key, ''), E' \t\n\r\f\v'), '');
  v_template text;
  v_status text;
  v_attempt_count integer;
  v_order_id text;
  v_order_status text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if v_key is null then
    raise check_violation using message = 'invalid_dedupe_key';
  end if;

  select delivery.template, delivery.status, delivery.attempt_count
  into v_template, v_status, v_attempt_count
  from public.email_deliveries as delivery
  where delivery.dedupe_key = v_key
  for update;

  if not found then
    raise no_data_found using message = 'email_delivery_not_found';
  end if;

  if v_status = 'sent' then
    raise check_violation using message = 'email_already_sent';
  end if;

  -- 주문 메일이 아닌 템플릿은 이 게이트가 판정할 근거가 없다. 문의 답변 메일의
  -- 재발송 경로는 운영자가 문의 상세에서 답변을 다시 등록하는 것이다.
  if v_template not in ('order_confirmation', 'order_shipped') then
    raise check_violation using message = 'email_delivery_not_resendable';
  end if;

  -- dedupe_key는 '<template>:<order uuid>'다(lib/email/dedupe.ts).
  v_order_id := split_part(v_key, ':', 2);
  if v_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise check_violation using message = 'email_delivery_target_unresolved';
  end if;

  select target.status::text
  into v_order_status
  from public.orders as target
  where target.id = lower(v_order_id)::uuid;

  if not found then
    raise no_data_found using message = 'order_missing';
  end if;

  -- 본문이 지금도 사실인 상태에서만 통과시킨다.
  -- lib/email/transactional.server.ts의 ACCURATE_ORDER_STATUSES와 같은 집합이다.
  if v_template = 'order_confirmation'
    and v_order_status not in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
  then
    raise check_violation using message = 'email_no_longer_accurate';
  end if;
  if v_template = 'order_shipped'
    and v_order_status not in ('shipping', 'delivered', 'done')
  then
    raise check_violation using message = 'email_no_longer_accurate';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.email_delivery.resend_requested',
    'email_delivery:' || v_key,
    jsonb_build_object(
      'template', v_template,
      'status', v_status,
      'attemptCount', v_attempt_count,
      'orderStatus', v_order_status
    )
  );

  return v_template;
end;
$$;

revoke all on function public.admin_request_email_resend(text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_request_email_resend(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 1. 첨부 경로 형식
-- ---------------------------------------------------------------------------
-- 커뮤니티 업로드 인프라(user-uploads 버킷)를 그대로 쓰되 접두는 `<uid>/inquiry/`로
-- 새로 연다. 커뮤니티 경로를 재사용하면 community_write_control이 커뮤니티 글쓰기를
-- 닫는 순간 문의 첨부까지 함께 막힌다 — 서로 다른 운영 판단이 한 스위치에 묶인다.
--
-- CHECK 안에서는 서브쿼리를 쓸 수 없으므로 배열 검사를 immutable 함수로 감싼다.
create function private.is_safe_inquiry_image_paths(candidate text[])
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.cardinality(candidate) <= 3
    and not exists (
      select 1
      from pg_catalog.unnest(candidate) as entry(path)
      where entry.path !~ (
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        || '/inquiry/'
        || '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
        || '[.](jpg|png|webp|gif)$'
      )
    );
$$;

revoke all on function private.is_safe_inquiry_image_paths(text[])
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. 테이블
-- ---------------------------------------------------------------------------
create table public.inquiries (
  id uuid primary key default extensions.gen_random_uuid(),
  -- 문의번호. 운영자와 구매자가 전화·메일에서 서로 불러야 하는 값이라 uuid 축약이
  -- 아니라 순번을 쓴다. 주문번호(uuid 뒤 8자리)와 헷갈릴 여지도 없다.
  reference bigint generated always as identity,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 취소/반품/교환 카테고리는 그 주제의 "질문"이지 클레임 레코드가 아니다.
  category text not null
    constraint inquiries_category_check
    check (category in ('order', 'claim', 'good', 'account', 'etc')),
  title text not null
    constraint inquiries_title_check
    check (
      title = pg_catalog.btrim(title)
      and pg_catalog.char_length(title) between 1 and 80
      and title ~ '[^[:space:]]'
    ),
  status text not null default 'open'
    constraint inquiries_status_check
    check (status in ('open', 'answered', 'closed')),
  -- 연결은 맥락이지 소유가 아니다. 주문이나 굿즈가 사라져도 대화 기록은 남아야 한다.
  order_id uuid references public.orders (id) on delete set null,
  good_id text references public.goods (id) on delete set null,
  -- 처리자. 전담 배정·교대는 범위 밖이고(#253) 마지막으로 답한 운영자만 기록한다.
  handled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  answered_at timestamptz,
  closed_at timestamptz,
  constraint inquiries_reference_unique unique (reference),
  constraint inquiries_closed_at_check check (
    (status = 'closed' and closed_at is not null)
    or (status <> 'closed' and closed_at is null)
  )
);

-- 어드민 큐의 기본 정렬은 "미답변 먼저, 그중에서도 오래 기다린 것 먼저"다.
create index inquiries_status_queue_idx
  on public.inquiries (status, last_message_at, id);

create index inquiries_user_recent_idx
  on public.inquiries (user_id, last_message_at desc, id desc);

create index inquiries_order_idx
  on public.inquiries (order_id)
  where order_id is not null;

create index inquiries_good_idx
  on public.inquiries (good_id)
  where good_id is not null;

-- 자동 종결 잡이 훑는 후보 집합. answered 행만 담아 스캔 폭을 좁힌다.
create index inquiries_answered_sweep_idx
  on public.inquiries (last_message_at)
  where status = 'answered';

create table public.inquiry_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id) on delete cascade,
  author text not null
    constraint inquiry_messages_author_check
    check (author in ('user', 'staff')),
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null
    constraint inquiry_messages_body_check
    check (
      pg_catalog.char_length(body) between 1 and 2000
      and body ~ '[^[:space:]]'
    ),
  image_paths text[] not null default '{}'
    constraint inquiry_messages_image_paths_check
    check (private.is_safe_inquiry_image_paths(image_paths)),
  created_at timestamptz not null default now()
);

create index inquiry_messages_thread_idx
  on public.inquiry_messages (inquiry_id, created_at, id);

-- 답변 템플릿. 소수 운영이라 개인 소유로 나누지 않고 staff가 공유한다.
create table public.inquiry_reply_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null
    constraint inquiry_reply_templates_title_check
    check (
      title = pg_catalog.btrim(title)
      and pg_catalog.char_length(title) between 1 and 40
      and title ~ '[^[:space:]]'
    ),
  body text not null
    constraint inquiry_reply_templates_body_check
    check (
      pg_catalog.char_length(body) between 1 and 2000
      and body ~ '[^[:space:]]'
    ),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_inquiry_reply_templates_updated
before update on public.inquiry_reply_templates
for each row execute function public.set_updated_at();

create index inquiry_reply_templates_recent_idx
  on public.inquiry_reply_templates (title, id);

-- ---------------------------------------------------------------------------
-- 3. RLS — 읽기는 본인 + staff, 쓰기 경로는 없다
-- ---------------------------------------------------------------------------
alter table public.inquiries enable row level security;
alter table public.inquiry_messages enable row level security;
alter table public.inquiry_reply_templates enable row level security;

create policy inquiries_owner_staff_read
on public.inquiries
for select
to authenticated
using ((select auth.uid()) = user_id or (select public.is_staff()));

create policy inquiry_messages_owner_staff_read
on public.inquiry_messages
for select
to authenticated
using (
  (select public.is_staff())
  or exists (
    select 1
    from public.inquiries as thread
    where thread.id = inquiry_messages.inquiry_id
      and thread.user_id = (select auth.uid())
  )
);

create policy inquiry_reply_templates_staff_read
on public.inquiry_reply_templates
for select
to authenticated
using ((select public.is_staff()));

revoke all on table public.inquiries
  from public, anon, authenticated, service_role;
revoke all on table public.inquiry_messages
  from public, anon, authenticated, service_role;
revoke all on table public.inquiry_reply_templates
  from public, anon, authenticated, service_role;

grant select on table public.inquiries to authenticated;
grant select on table public.inquiry_messages to authenticated;
grant select on table public.inquiry_reply_templates to authenticated;

-- ---------------------------------------------------------------------------
-- 4. 첨부 스토리지 정책
-- ---------------------------------------------------------------------------
-- 쓰기: 기존 permissive 정책에 `<uid>/inquiry/` 가지를 더한다. 정지 계정은 커뮤니티
-- 업로드와 같은 이유로 막는다 — 첨부만 열어 두면 정지가 반쪽이 된다.
drop policy if exists user_uploads_write on storage.objects;
create policy user_uploads_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'user-uploads'
    and (select auth.uid()) is not null
    and (
      (
        name ~ (
          '^'
          || (select auth.uid())::text
          || '/profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
        )
        and private.has_pending_profile_avatar_claim(name)
      )
      or (
        name ~ (
          '^'
          || (select auth.uid())::text
          || '/community/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp|gif)$'
        )
        and exists (
          select 1
          from public.profiles as profile
          where profile.id = (select auth.uid())
            and profile.suspended_at is null
        )
      )
      or (
        name ~ (
          '^'
          || (select auth.uid())::text
          || '/inquiry/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp|gif)$'
        )
        and exists (
          select 1
          from public.profiles as profile
          where profile.id = (select auth.uid())
            and profile.suspended_at is null
        )
      )
    )
  );

-- 읽기: 기본 정책은 소유자 폴더만 본다. 문의는 상대가 올린 첨부를 봐야 대화가 성립한다.
-- 스레드에 실제로 붙은 파일만 열고, 업로드만 하고 전송하지 않은 파일은 열지 않는다.
create policy user_uploads_inquiry_staff_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'user-uploads'
  and (select public.is_staff())
  and exists (
    select 1
    from public.inquiry_messages as message
    where storage.objects.name = any (message.image_paths)
  )
);

create policy user_uploads_inquiry_owner_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'user-uploads'
  and exists (
    select 1
    from public.inquiry_messages as message
    join public.inquiries as thread on thread.id = message.inquiry_id
    where storage.objects.name = any (message.image_paths)
      and thread.user_id = (select auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- 5. 공통 헬퍼
-- ---------------------------------------------------------------------------
-- 첨부 경로가 호출자 소유인지. CHECK는 형식만 보고, 소유는 여기서 본다 —
-- 형식만 맞으면 남의 uuid 폴더를 가리키는 경로도 통과하기 때문이다.
create function private.assert_own_inquiry_image_paths(
  target_paths text[],
  target_owner uuid
)
returns text[]
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized text[] := coalesce(target_paths, '{}'::text[]);
begin
  if pg_catalog.cardinality(normalized) > 3 then
    raise check_violation using message = 'inquiry_image_limit';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(normalized) as entry(path)
    where entry.path is null
      or pg_catalog.left(entry.path, pg_catalog.char_length(target_owner::text) + 9)
        <> target_owner::text || '/inquiry/'
  ) then
    raise check_violation using message = 'invalid_inquiry_image_path';
  end if;

  if not private.is_safe_inquiry_image_paths(normalized) then
    raise check_violation using message = 'invalid_inquiry_image_path';
  end if;

  return normalized;
end;
$$;

revoke all on function private.assert_own_inquiry_image_paths(text[], uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. 사용자 RPC
-- ---------------------------------------------------------------------------
create function public.create_inquiry(
  target_category text,
  target_title text,
  target_body text,
  target_order_id uuid default null,
  target_good_id text default null,
  target_image_paths text[] default '{}'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_category text := btrim(coalesce(target_category, ''));
  v_title text := btrim(coalesce(target_title, ''));
  v_body text := btrim(coalesce(target_body, ''));
  v_paths text[];
  v_inquiry_id uuid;
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = v_actor
      and profile.suspended_at is not null
  ) then
    raise insufficient_privilege using message = 'account_suspended';
  end if;

  if v_category not in ('order', 'claim', 'good', 'account', 'etc') then
    raise invalid_parameter_value using message = 'invalid_inquiry_category';
  end if;
  if char_length(v_title) not between 1 and 80 then
    raise invalid_parameter_value using message = 'invalid_inquiry_title';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise invalid_parameter_value using message = 'invalid_inquiry_body';
  end if;

  -- 연결은 본인 주문에만 허용한다. 남의 주문번호를 실어 문의를 열면 어드민 컨텍스트
  -- 패널이 그 주문 요약을 그려 준다 — 문의 접수만으로 타인 주문을 들여다보는 창이 된다.
  if target_order_id is not null and not exists (
    select 1
    from public.orders as target
    where target.id = target_order_id
      and target.user_id = v_actor
  ) then
    raise no_data_found using message = 'inquiry_order_not_found';
  end if;

  if target_good_id is not null and not exists (
    select 1
    from public.goods as target
    where target.id = target_good_id
  ) then
    raise no_data_found using message = 'inquiry_good_not_found';
  end if;

  -- 하루 접수 상한. 스레드 자체가 공개 표면은 아니지만 무제한 생성은 운영 큐를 마비시킨다.
  if (
    select count(*)
    from public.inquiries as thread
    where thread.user_id = v_actor
      and thread.created_at > now() - interval '1 day'
  ) >= 20 then
    raise check_violation using message = 'inquiry_rate_limited';
  end if;

  v_paths := private.assert_own_inquiry_image_paths(target_image_paths, v_actor);

  insert into public.inquiries (
    user_id,
    category,
    title,
    status,
    order_id,
    good_id
  )
  values (
    v_actor,
    v_category,
    v_title,
    'open',
    target_order_id,
    target_good_id
  )
  returning id into v_inquiry_id;

  insert into public.inquiry_messages (inquiry_id, author, author_id, body, image_paths)
  values (v_inquiry_id, 'user', v_actor, v_body, v_paths);

  return v_inquiry_id;
end;
$$;

-- 사용자 추가 메시지. 답변된 문의는 여기서 다시 열린다 — 재오픈이 별도 호출이면
-- 그 호출을 빠뜨린 화면에서 추가 질문이 어드민 큐에 뜨지 않는다.
create function public.append_inquiry_message(
  target_inquiry_id uuid,
  target_body text,
  target_image_paths text[] default '{}'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_body text := btrim(coalesce(target_body, ''));
  v_paths text[];
  v_status text;
  v_message_id uuid;
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise invalid_parameter_value using message = 'invalid_inquiry_body';
  end if;

  select thread.status
  into v_status
  from public.inquiries as thread
  where thread.id = target_inquiry_id
    and thread.user_id = v_actor
  for update;

  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;

  -- 종결 후 재문의는 새 스레드다. 닫힌 대화를 되살리면 어드민 큐의 처리 이력과
  -- 자동 종결 기준(마지막 답변 시각)이 한 행 안에서 여러 번 뒤집힌다.
  if v_status = 'closed' then
    raise check_violation using message = 'inquiry_closed';
  end if;

  v_paths := private.assert_own_inquiry_image_paths(target_image_paths, v_actor);

  insert into public.inquiry_messages (inquiry_id, author, author_id, body, image_paths)
  values (target_inquiry_id, 'user', v_actor, v_body, v_paths)
  returning id into v_message_id;

  update public.inquiries as thread
  set
    status = 'open',
    last_message_at = now()
  where thread.id = target_inquiry_id;

  return v_message_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 운영자 RPC
-- ---------------------------------------------------------------------------
-- 답변 발송. 인앱 알림은 이 트랜잭션 안에서 남기고, 메일은 밖에서 보낸다 —
-- 메일 발송은 HTTP라 트랜잭션으로 감쌀 수 없다(email_deliveries 2단계 클레임).
create function public.admin_answer_inquiry(
  target_inquiry_id uuid,
  target_body text,
  target_image_paths text[] default '{}'
)
returns table (
  message_id uuid,
  recipient_id uuid,
  recipient_email text,
  inquiry_reference bigint,
  inquiry_title text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_body text := btrim(coalesce(target_body, ''));
  v_paths text[];
  v_thread public.inquiries%rowtype;
  v_message_id uuid;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise invalid_parameter_value using message = 'invalid_inquiry_body';
  end if;

  select *
  into v_thread
  from public.inquiries as thread
  where thread.id = target_inquiry_id
  for update;

  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;
  if v_thread.status = 'closed' then
    raise check_violation using message = 'inquiry_closed';
  end if;

  v_paths := private.assert_own_inquiry_image_paths(target_image_paths, v_actor);

  insert into public.inquiry_messages (inquiry_id, author, author_id, body, image_paths)
  values (target_inquiry_id, 'staff', v_actor, v_body, v_paths)
  returning id into v_message_id;

  update public.inquiries as thread
  set
    status = 'answered',
    handled_by = v_actor,
    answered_at = coalesce(thread.answered_at, now()),
    last_message_at = now()
  where thread.id = target_inquiry_id;

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
  values (
    v_thread.user_id,
    'inquiry_answered',
    '문의에 답변이 등록됐어요',
    left('문의 #' || v_thread.reference::text || ' — ' || v_thread.title, 500),
    '/my/inquiries/' || target_inquiry_id::text,
    'inquiry',
    target_inquiry_id::text,
    'inquiry:answered:' || v_message_id::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.inquiry.answered',
    'inquiries:' || target_inquiry_id::text,
    jsonb_build_object(
      'messageId', v_message_id,
      'previousStatus', v_thread.status,
      'attachmentCount', cardinality(v_paths)
    )
  );

  return query
    select
      v_message_id,
      v_thread.user_id,
      profile.email,
      v_thread.reference,
      v_thread.title
    from public.profiles as profile
    where profile.id = v_thread.user_id;
end;
$$;

create function public.admin_close_inquiry(target_inquiry_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_status text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  select thread.status
  into v_status
  from public.inquiries as thread
  where thread.id = target_inquiry_id
  for update;

  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;

  -- 이미 닫힌 문의를 다시 닫아도 실패로 만들지 않는다. 목록에서 두 번 눌린 종결이
  -- 오류 배너로 돌아오면 운영자가 "안 닫혔다"고 읽는다.
  if v_status = 'closed' then
    return;
  end if;

  update public.inquiries as thread
  set
    status = 'closed',
    closed_at = now(),
    handled_by = coalesce(thread.handled_by, v_actor)
  where thread.id = target_inquiry_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.inquiry.closed',
    'inquiries:' || target_inquiry_id::text,
    jsonb_build_object('previousStatus', v_status)
  );
end;
$$;

-- 어드민 큐. 검색 대상은 제목·구매자(닉네임/이메일)·주문번호·문의번호다.
-- LIKE가 아니라 position()을 쓴다 — 사용자 입력의 %와 _를 이스케이프할 일이 없다.
create function public.admin_search_inquiries(
  p_status text default null,
  p_category text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_field text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  reference bigint,
  category text,
  title text,
  status text,
  user_id uuid,
  buyer_name text,
  buyer_email text,
  order_id uuid,
  good_id text,
  good_name text,
  handled_by uuid,
  handler_name text,
  created_at timestamptz,
  last_message_at timestamptz,
  answered_at timestamptz,
  closed_at timestamptz,
  message_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_field text := coalesce(nullif(btrim(coalesce(p_field, '')), ''), 'all');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if p_status is not null and p_status not in ('open', 'answered', 'closed') then
    raise check_violation using message = 'invalid_inquiry_status_filter';
  end if;
  if p_category is not null
    and p_category not in ('order', 'claim', 'good', 'account', 'etc')
  then
    raise check_violation using message = 'invalid_inquiry_category_filter';
  end if;
  if v_field not in ('all', 'title', 'buyer', 'order') then
    raise check_violation using message = 'invalid_inquiry_search_field';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid_inquiry_date_range';
  end if;
  if v_query is not null and char_length(v_query) > 100 then
    raise check_violation using message = 'inquiry_search_query_too_long';
  end if;

  return query
  select
    thread.id,
    thread.reference,
    thread.category,
    thread.title,
    thread.status,
    thread.user_id,
    buyer.nickname as buyer_name,
    buyer.email as buyer_email,
    thread.order_id,
    thread.good_id,
    good.name as good_name,
    thread.handled_by,
    handler.nickname as handler_name,
    thread.created_at,
    thread.last_message_at,
    thread.answered_at,
    thread.closed_at,
    (
      select count(*)
      from public.inquiry_messages as message
      where message.inquiry_id = thread.id
    ) as message_count,
    count(*) over()::bigint as total_count
  from public.inquiries as thread
  join public.profiles as buyer on buyer.id = thread.user_id
  left join public.profiles as handler on handler.id = thread.handled_by
  left join public.goods as good on good.id = thread.good_id
  where (p_status is null or thread.status = p_status)
    and (p_category is null or thread.category = p_category)
    and (
      p_from is null
      or thread.created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or thread.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    and (
      v_query is null
      or (
        v_field in ('all', 'title')
        and position(lower(v_query) in lower(thread.title)) > 0
      )
      or (
        v_field in ('all', 'buyer')
        and (
          position(lower(v_query) in lower(coalesce(buyer.nickname, ''))) > 0
          or position(lower(v_query) in lower(coalesce(buyer.email, ''))) > 0
        )
      )
      or (
        v_field in ('all', 'order')
        and (
          position(lower(v_query) in lower(coalesce(thread.order_id::text, ''))) > 0
          or lower(v_query) = lower(thread.reference::text)
        )
      )
    )
  /* 미답변이 먼저, 그중에서도 오래 기다린 것이 위로. 종결은 맨 아래다. */
  order by
    case thread.status when 'open' then 0 when 'answered' then 1 else 2 end,
    thread.last_message_at,
    thread.id
  limit v_limit
  offset v_offset;
end;
$$;

-- 상태별 건수. 칩과 사이드바 배지가 같은 집계를 본다 — 두 숫자가 어긋나면
-- 운영자가 어느 쪽을 믿어야 할지 알 수 없다. 0건도 행으로 돌려준다.
-- OUT 파라미터를 `count`로 두면 plpgsql이 본문의 `count(*)`를 그 변수로 읽으려 해
-- 모호성 오류가 난다. 이름을 `total`로 둔다 — 앱도 같은 키를 읽는다.
create function public.admin_inquiry_status_counts()
returns table (status text, total bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  return query
  select
    allowed.value::text,
    coalesce(counted.tally, 0)::bigint
  from (values ('open'), ('answered'), ('closed')) as allowed(value)
  left join (
    select thread.status as value, pg_catalog.count(*) as tally
    from public.inquiries as thread
    group by thread.status
  ) as counted on counted.value = allowed.value;
end;
$$;

-- 컨텍스트 패널. 연결 주문 요약과 구매자 이력을 한 번에 돌려준다 —
-- CS가 화면을 옮기지 않고 맥락을 보는 것이 문의 상세의 존재 이유다.
create function public.admin_inquiry_context(target_inquiry_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread public.inquiries%rowtype;
  v_order jsonb := 'null'::jsonb;
  v_buyer jsonb;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  select * into v_thread
  from public.inquiries as thread
  where thread.id = target_inquiry_id;

  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;

  if v_thread.order_id is not null then
    select jsonb_build_object(
      'id', target.id,
      'status', target.status::text,
      'total', target.total,
      'createdAt', target.created_at,
      'shippingCarrier', target.shipping_carrier,
      'trackingNumber', target.tracking_number,
      'itemCount', (
        select coalesce(sum(item.qty), 0)
        from public.order_items as item
        where item.order_id = target.id
      ),
      'leadItemName', (
        select item.good_name_snapshot
        from public.order_items as item
        where item.order_id = target.id
        order by item.id
        limit 1
      ),
      'payment', (
        select jsonb_build_object(
          'provider', summary.provider,
          'status', summary.status,
          'amount', summary.amount
        )
        from public.payment_summaries as summary
        where summary.purpose = 'order'
          and summary.ref_id = target.id
        order by (summary.status = 'paid') desc, summary.created_at desc
        limit 1
      ),
      'claims', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'status', request.status,
            'requestedAt', request.requested_at,
            'decidedAt', request.decided_at,
            'reasonType', request.reason_type
          )
          order by request.requested_at desc
        )
        from public.order_cancellation_requests as request
        where request.order_id = target.id
      ), '[]'::jsonb)
    )
    into v_order
    from public.orders as target
    where target.id = v_thread.order_id;
  end if;

  select jsonb_build_object(
    'id', buyer.id,
    'nickname', buyer.nickname,
    'email', buyer.email,
    'suspendedAt', buyer.suspended_at,
    'orderCount', (
      select count(*)
      from public.orders as target
      where target.user_id = buyer.id
        and target.status <> 'pending'
    ),
    'inquiryCount', (
      select count(*)
      from public.inquiries as other
      where other.user_id = buyer.id
    ),
    'openInquiryCount', (
      select count(*)
      from public.inquiries as other
      where other.user_id = buyer.id
        and other.status <> 'closed'
    )
  )
  into v_buyer
  from public.profiles as buyer
  where buyer.id = v_thread.user_id;

  return jsonb_build_object('order', coalesce(v_order, 'null'::jsonb), 'buyer', v_buyer);
end;
$$;

create function public.admin_upsert_inquiry_reply_template(
  target_template_id uuid,
  target_title text,
  target_body text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_title text := btrim(coalesce(target_title, ''));
  v_body text := btrim(coalesce(target_body, ''));
  v_id uuid := coalesce(target_template_id, extensions.gen_random_uuid());
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_title) not between 1 and 40 then
    raise invalid_parameter_value using message = 'invalid_template_title';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise invalid_parameter_value using message = 'invalid_template_body';
  end if;

  insert into public.inquiry_reply_templates (id, title, body, created_by)
  values (v_id, v_title, v_body, v_actor)
  on conflict (id) do update set
    title = excluded.title,
    body = excluded.body;

  return v_id;
end;
$$;

create function public.admin_delete_inquiry_reply_template(target_template_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  delete from public.inquiry_reply_templates
  where id = target_template_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. 자동 종결
-- ---------------------------------------------------------------------------
-- 마지막 답변 후 7일이 지난 answered 문의를 닫는다. 사용자가 추가 메시지를 보내면
-- append_inquiry_message가 status를 open으로 되돌리고 last_message_at을 갱신하므로
-- 대화가 살아 있는 스레드는 이 후보 집합에 들어오지 않는다.
--
-- 종결은 대화의 끝일 뿐 권리의 끝이 아니다 — 종결된 문의도 계속 열람할 수 있고,
-- 재문의는 새 스레드로 접수된다.
create function public.close_stale_answered_inquiries()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select thread.id
    from public.inquiries as thread
    where thread.status = 'answered'
      and thread.last_message_at + interval '7 days' < now()
    order by thread.last_message_at, thread.id
    limit 1000
    for update of thread skip locked
  loop
    update public.inquiries
    set
      status = 'closed',
      closed_at = now()
    where id = r.id
      and status = 'answered';

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. 권한 봉인
-- ---------------------------------------------------------------------------
-- ⚠️ Supabase default privileges가 신규 함수에 anon/authenticated/service_role execute를
--    자동 부여한다. `from public`만으로는 봉인되지 않는다(AGENTS.md).
revoke all on function public.create_inquiry(text, text, text, uuid, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_inquiry(text, text, text, uuid, text, text[])
  to authenticated;

revoke all on function public.append_inquiry_message(uuid, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.append_inquiry_message(uuid, text, text[])
  to authenticated;

revoke all on function public.admin_answer_inquiry(uuid, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.admin_answer_inquiry(uuid, text, text[])
  to authenticated;

revoke all on function public.admin_close_inquiry(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_close_inquiry(uuid) to authenticated;

revoke all on function public.admin_search_inquiries(text, text, date, date, text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_inquiries(text, text, date, date, text, text, integer, integer)
  to authenticated;

revoke all on function public.admin_inquiry_status_counts()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_inquiry_status_counts() to authenticated;

revoke all on function public.admin_inquiry_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_inquiry_context(uuid) to authenticated;

revoke all on function public.admin_upsert_inquiry_reply_template(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_inquiry_reply_template(uuid, text, text)
  to authenticated;

revoke all on function public.admin_delete_inquiry_reply_template(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_inquiry_reply_template(uuid)
  to authenticated;

-- 스케줄러(postgres)와 수동 운영(service_role)만.
revoke all on function public.close_stale_answered_inquiries()
  from public, anon, authenticated, service_role;
grant execute on function public.close_stale_answered_inquiries() to service_role;

-- UTC 19:00 = KST 04:00. 하루 한 번이면 충분하다 — 7일 경계는 시각 단위로 다투는
-- 값이 아니고, 늦게 닫히는 쪽이 사용자에게 유리하다.
-- cron.schedule은 이름 기준 upsert라 재적용에도 안전하다.
select cron.schedule(
  'close-stale-answered-inquiries',
  '0 19 * * *',
  'select public.close_stale_answered_inquiries()'
);
