-- #137 phase one: additive, default-off self-service request, legal
-- snapshot and write fence. This migration deliberately stops before email,
-- Storage, DB/Auth deletion and the external compliance tombstone.

create table private.account_deletion_control (
  singleton boolean primary key default true,
  phase_one_enabled boolean not null default false,
  changed_at timestamptz not null default pg_catalog.now(),
  constraint account_deletion_control_singleton_check check (singleton)
);

insert into private.account_deletion_control (singleton, phase_one_enabled)
values (true, false);

create table private.account_deletion_requests (
  deletion_event_id uuid primary key default extensions.gen_random_uuid(),
  subject_user_id uuid not null unique,
  idempotency_key uuid not null unique,
  status text not null check (
    status in ('blocked_active_obligation', 'awaiting_email_intent')
  ),
  blocker_summary jsonb not null default '[]'::jsonb check (
    pg_catalog.jsonb_typeof(blocker_summary) = 'array'
  ),
  requested_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (subject_user_id, deletion_event_id)
);

create table private.account_action_fences (
  subject_user_id uuid primary key,
  deletion_event_id uuid not null unique,
  reason text not null default 'member_withdrawal' check (
    reason = 'member_withdrawal'
  ),
  fenced_at timestamptz not null default pg_catalog.now(),
  foreign key (subject_user_id, deletion_event_id)
    references private.account_deletion_requests (
      subject_user_id,
      deletion_event_id
    )
    on delete restrict
);

create table private.account_deletion_legal_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  deletion_event_id uuid not null
    references private.account_deletion_requests(deletion_event_id)
    on delete restrict,
  record_type text not null check (
    record_type in ('order', 'payment', 'refund', 'ticket_order')
  ),
  record_ref text not null,
  snapshot_data jsonb not null check (
    pg_catalog.jsonb_typeof(snapshot_data) = 'object'
  ),
  legal_basis text not null check (
    legal_basis in ('ecommerce_transaction_v1', 'ticket_transaction_v1')
  ),
  access_purpose text not null default 'consumer_dispute' check (
    access_purpose = 'consumer_dispute'
  ),
  retain_until timestamptz not null,
  legal_hold boolean not null default false,
  destroyed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  unique (deletion_event_id, record_type, record_ref),
  constraint account_deletion_legal_snapshot_retention_check check (
    retain_until > created_at
  ),
  constraint account_deletion_legal_snapshot_destroy_check check (
    destroyed_at is null or destroyed_at >= created_at
  )
);

alter table private.account_deletion_control enable row level security;
alter table private.account_deletion_requests enable row level security;
alter table private.account_action_fences enable row level security;
alter table private.account_deletion_legal_snapshots enable row level security;

revoke all on table private.account_deletion_control
  from public, anon, authenticated, service_role;
revoke all on table private.account_deletion_requests
  from public, anon, authenticated, service_role;
revoke all on table private.account_action_fences
  from public, anon, authenticated, service_role;
revoke all on table private.account_deletion_legal_snapshots
  from public, anon, authenticated, service_role;

create function private.account_deletion_blockers(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with blocker_counts as (
    select
      1 as priority,
      'active_order'::text as code,
      pg_catalog.count(*)::integer as blocker_count,
      '/orders'::text as path
    from public.orders as order_record
    where order_record.user_id = p_user_id
      and order_record.status in ('pending', 'paid', 'shipping')

    union all

    select
      2,
      'active_cancellation',
      pg_catalog.count(*)::integer,
      '/orders'
    from (
      select request.id::text as blocker_ref
      from public.order_cancellation_requests as request
      join public.orders as order_record on order_record.id = request.order_id
      where order_record.user_id = p_user_id
        and request.status in ('requested', 'processing', 'needs_review')

      union all

      select claim.order_id::text
      from public.order_cancellation_claims as claim
      join public.orders as order_record on order_record.id = claim.order_id
      where order_record.user_id = p_user_id
    ) as active_cancellation

    union all

    select
      3,
      'active_payment_attempt',
      pg_catalog.count(*)::integer,
      '/settings'
    from public.payment_attempts as attempt
    where attempt.user_id = p_user_id
      and (
        attempt.state in ('prepared', 'confirming', 'unknown', 'needs_review')
        or (attempt.state = 'approved' and attempt.payment_id is null)
      )

    union all

    select
      4,
      'active_refund',
      pg_catalog.count(*)::integer,
      '/orders'
    from public.refunds as refund
    join public.payments as payment on payment.id = refund.payment_id
    where payment.user_id = p_user_id
      and refund.status in ('requested', 'failed')

    union all

    select
      5,
      'active_ticket',
      pg_catalog.count(*)::integer,
      '/tickets'
    from public.ticket_orders as ticket_order
    join public.events as event on event.id = ticket_order.event_id
    where ticket_order.user_id = p_user_id
      and (
        ticket_order.status = 'pending'
        or (
          ticket_order.status = 'paid'
          and (event.ends_at is null or event.ends_at > pg_catalog.now())
          and exists (
            select 1
            from public.tickets as ticket
            where ticket.ticket_order_id = ticket_order.id
              and ticket.status = 'valid'
          )
        )
      )

    union all

    select
      6,
      'active_ticket_cancellation',
      pg_catalog.count(*)::integer,
      '/tickets'
    from public.ticket_cancellation_requests as request
    join public.ticket_orders as ticket_order
      on ticket_order.id = request.ticket_order_id
    where ticket_order.user_id = p_user_id
      and request.status in ('requested', 'processing', 'needs_review')

    union all

    select
      7,
      'staff_handover',
      pg_catalog.count(*)::integer,
      '/settings'
    from public.profiles as profile
    where profile.id = p_user_id
      and profile.role in ('staff', 'admin')
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'code', blocker.code,
        'count', blocker.blocker_count,
        'path', blocker.path
      )
      order by blocker.priority
    ) filter (where blocker.blocker_count > 0),
    '[]'::jsonb
  )
  from blocker_counts as blocker;
$$;

create function private.account_deletion_public_status(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'status', case request.status
      when 'blocked_active_obligation' then 'blocked'
      else 'processing'
    end,
    'phase', case request.status
      when 'blocked_active_obligation' then 'fenced'
      else 'awaiting_notification'
    end,
    'nextAction', case request.status
      when 'blocked_active_obligation'
        then coalesce(request.blocker_summary -> 0 ->> 'path', '/settings')
      else 'retry_later'
    end,
    'blockers', request.blocker_summary
  )
  from private.account_deletion_requests as request
  where request.subject_user_id = p_user_id;
$$;

create function private.snapshot_account_deletion_legal_records(
  p_deletion_event_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'order',
    order_record.id::text,
    pg_catalog.jsonb_build_object(
      'orderRef', order_record.id::text,
      'status', order_record.status,
      'total', order_record.total,
      'shippingFee', order_record.shipping_fee,
      'createdAt', order_record.created_at,
      'items', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'goodRef', item.good_id,
              'goodName', item.good_name_snapshot,
              'goodType', item.good_type_snapshot,
              'ipRef', item.good_ip_id_snapshot,
              'quantity', item.qty,
              'unitPrice', item.unit_price
            )
            order by item.id
          )
          from public.order_items as item
          where item.order_id = order_record.id
        ),
        '[]'::jsonb
      )
    ),
    'ecommerce_transaction_v1',
    order_record.created_at + interval '5 years'
  from public.orders as order_record
  where order_record.user_id = p_user_id
    and order_record.created_at + interval '5 years' > pg_catalog.now();

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'payment',
    payment.id::text,
    pg_catalog.jsonb_build_object(
      'paymentRef', payment.id::text,
      'provider', coalesce(pg_catalog.to_jsonb(payment) ->> 'provider', 'toss'),
      'purpose', payment.purpose,
      'relatedRef', payment.ref_id,
      'amount', payment.amount,
      'currency', 'KRW',
      'status', payment.status,
      'createdAt', payment.created_at
    ),
    case when payment.purpose = 'ticket'
      then 'ticket_transaction_v1'
      else 'ecommerce_transaction_v1'
    end,
    payment.created_at + interval '5 years'
  from public.payments as payment
  where payment.user_id = p_user_id
    and payment.created_at + interval '5 years' > pg_catalog.now();

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'refund',
    refund.id::text,
    pg_catalog.jsonb_build_object(
      'refundRef', refund.id::text,
      'paymentRef', refund.payment_id::text,
      'amount', refund.amount,
      'status', refund.status,
      'createdAt', refund.created_at
    ),
    case when payment.purpose = 'ticket'
      then 'ticket_transaction_v1'
      else 'ecommerce_transaction_v1'
    end,
    refund.created_at + interval '5 years'
  from public.refunds as refund
  join public.payments as payment on payment.id = refund.payment_id
  where payment.user_id = p_user_id
    and refund.created_at + interval '5 years' > pg_catalog.now();

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'ticket_order',
    ticket_order.id::text,
    pg_catalog.jsonb_build_object(
      'ticketOrderRef', ticket_order.id::text,
      'eventRef', ticket_order.event_id,
      'eventTitle', event.title,
      'status', ticket_order.status,
      'total', ticket_order.total,
      'createdAt', ticket_order.created_at,
      'tickets', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'ticketRef', ticket.id::text,
              'ticketTypeRef', ticket.ticket_type_id::text,
              'ticketTypeName', ticket_type.name,
              'unitPrice', ticket_type.price,
              'status', ticket.status
            )
            order by ticket.id
          )
          from public.tickets as ticket
          join public.ticket_types as ticket_type
            on ticket_type.id = ticket.ticket_type_id
          where ticket.ticket_order_id = ticket_order.id
        ),
        '[]'::jsonb
      )
    ),
    'ticket_transaction_v1',
    ticket_order.created_at + interval '5 years'
  from public.ticket_orders as ticket_order
  join public.events as event on event.id = ticket_order.event_id
  where ticket_order.user_id = p_user_id
    and ticket_order.created_at + interval '5 years' > pg_catalog.now();
end;
$$;

revoke all on function private.account_deletion_blockers(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.account_deletion_public_status(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.snapshot_account_deletion_legal_records(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.preview_my_account_deletion()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_enabled boolean := false;
  v_blockers jsonb;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;

  if not exists (
    select 1 from public.profiles as profile where profile.id = v_user_id
  ) then
    raise no_data_found using message = 'account_not_found';
  end if;

  select control.phase_one_enabled
    into v_enabled
  from private.account_deletion_control as control
  where control.singleton;

  if not coalesce(v_enabled, false) then
    return pg_catalog.jsonb_build_object(
      'available', false,
      'eligible', false,
      'blockers', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', 'not_available',
          'count', 1,
          'path', '/settings'
        )
      )
    );
  end if;

  v_blockers := private.account_deletion_blockers(v_user_id);
  return pg_catalog.jsonb_build_object(
    'available', true,
    'eligible', v_blockers = '[]'::jsonb,
    'blockers', v_blockers
  );
end;
$$;

create function public.request_my_account_deletion(
  p_confirmation text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_enabled boolean := false;
  v_existing private.account_deletion_requests%rowtype;
  v_blockers jsonb;
  v_internal_status text;
  v_deletion_event_id uuid;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;
  if p_confirmation is distinct from '회원 탈퇴를 신청합니다' then
    raise check_violation using message = 'account_deletion_confirmation_mismatch';
  end if;
  if p_idempotency_key is null then
    raise not_null_violation using message = 'account_deletion_idempotency_key_required';
  end if;

  select control.phase_one_enabled
    into v_enabled
  from private.account_deletion_control as control
  where control.singleton
  for share;
  if not coalesce(v_enabled, false) then
    raise object_not_in_prerequisite_state
      using message = 'account_deletion_not_available';
  end if;

  if not exists (
    select 1 from public.profiles as profile where profile.id = v_user_id
  ) then
    raise no_data_found using message = 'account_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('account_deletion:' || v_user_id::text, 0)
  );

  select request.*
    into v_existing
  from private.account_deletion_requests as request
  where request.subject_user_id = v_user_id;

  if found then
    if v_existing.idempotency_key is distinct from p_idempotency_key then
      raise unique_violation using message = 'account_deletion_idempotency_conflict';
    end if;
    return private.account_deletion_public_status(v_user_id);
  end if;

  v_blockers := private.account_deletion_blockers(v_user_id);
  v_internal_status := case
    when v_blockers = '[]'::jsonb then 'awaiting_email_intent'
    else 'blocked_active_obligation'
  end;

  insert into private.account_deletion_requests (
    subject_user_id,
    idempotency_key,
    status,
    blocker_summary
  )
  values (v_user_id, p_idempotency_key, v_internal_status, v_blockers)
  returning deletion_event_id into v_deletion_event_id;

  perform private.snapshot_account_deletion_legal_records(
    v_deletion_event_id,
    v_user_id
  );

  insert into private.account_action_fences (
    subject_user_id,
    deletion_event_id
  )
  values (v_user_id, v_deletion_event_id);

  return private.account_deletion_public_status(v_user_id);
end;
$$;

create function public.get_my_account_deletion_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;
  if not exists (
    select 1 from public.profiles as profile where profile.id = v_user_id
  ) then
    raise no_data_found using message = 'account_not_found';
  end if;

  return coalesce(
    private.account_deletion_public_status(v_user_id),
    pg_catalog.jsonb_build_object(
      'status', 'not_requested',
      'phase', 'none',
      'nextAction', '/settings',
      'blockers', '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.preview_my_account_deletion()
  from public, anon, authenticated, service_role;
revoke all on function public.request_my_account_deletion(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_account_deletion_status()
  from public, anon, authenticated, service_role;
grant execute on function public.preview_my_account_deletion()
  to authenticated;
grant execute on function public.request_my_account_deletion(text, uuid)
  to authenticated;
grant execute on function public.get_my_account_deletion_status()
  to authenticated;

create function private.is_account_write_fenced(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from private.account_action_fences as fence
    where fence.subject_user_id = p_user_id
  );
$$;

create function private.guard_account_insert_or_update()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (pg_catalog.to_jsonb(new) ->> tg_argv[0])::uuid;
  if private.is_account_write_fenced(v_user_id) then
    raise object_not_in_prerequisite_state
      using message = 'account_deletion_write_fenced';
  end if;
  return new;
end;
$$;

create function private.guard_account_profile_update()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if private.is_account_write_fenced(new.id)
    and (
      new.email is distinct from old.email
      or new.nickname is distinct from old.nickname
      or new.birth_date is distinct from old.birth_date
      or new.avatar_path is distinct from old.avatar_path
      or new.consents is distinct from old.consents
      or new.onboarded_at is distinct from old.onboarded_at
    )
  then
    raise object_not_in_prerequisite_state
      using message = 'account_deletion_write_fenced';
  end if;
  return new;
end;
$$;

create function private.guard_account_community_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_moderation_hide_only boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_moderation_hide_only := new.status = 'hidden'
      and (pg_catalog.to_jsonb(new) - 'status' - 'updated_at')
        is not distinct from
        (pg_catalog.to_jsonb(old) - 'status' - 'updated_at');
  end if;

  if not v_moderation_hide_only
    and private.is_account_write_fenced(new.user_id)
  then
    raise object_not_in_prerequisite_state
      using message = 'account_deletion_write_fenced';
  end if;
  return new;
end;
$$;

create function private.guard_account_draw_ticket_consumption()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.consumed_at is null
    and new.consumed_at is not null
    and private.is_account_write_fenced(new.user_id)
  then
    raise object_not_in_prerequisite_state
      using message = 'account_deletion_write_fenced';
  end if;
  return new;
end;
$$;

revoke all on function private.is_account_write_fenced(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_account_insert_or_update()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_account_profile_update()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_account_community_write()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_account_draw_ticket_consumption()
  from public, anon, authenticated, service_role;

create trigger trg_account_fence_orders
before insert on public.orders
for each row execute function private.guard_account_insert_or_update('user_id');

create trigger trg_account_fence_ticket_orders
before insert on public.ticket_orders
for each row execute function private.guard_account_insert_or_update('user_id');

create trigger trg_account_fence_posts
before insert or update on public.posts
for each row execute function private.guard_account_community_write();

create trigger trg_account_fence_comments
before insert or update on public.comments
for each row execute function private.guard_account_community_write();

create trigger trg_account_fence_likes
before insert on public.likes
for each row execute function private.guard_account_insert_or_update('user_id');

create trigger trg_account_fence_ip_follows
before insert or update on public.ip_follows
for each row execute function private.guard_account_insert_or_update('user_id');

create trigger trg_account_fence_cart_items
before insert or update on public.cart_items
for each row execute function private.guard_account_insert_or_update('user_id');

create trigger trg_account_fence_game_plays
before insert on public.game_plays
for each row execute function private.guard_account_insert_or_update('user_id');

create trigger trg_account_fence_profile_avatar_claims
before insert on public.profile_avatar_claims
for each row execute function private.guard_account_insert_or_update('user_id');

create trigger trg_account_fence_profiles
before update on public.profiles
for each row execute function private.guard_account_profile_update();

create trigger trg_account_fence_draw_ticket_consumption
before update on public.draw_tickets
for each row execute function private.guard_account_draw_ticket_consumption();

comment on table private.account_deletion_requests is
  'Phase-one pre-destruction locator. Never expose directly or treat as completion.';
comment on table private.account_deletion_legal_snapshots is
  'Allowlisted legal transaction snapshot; no address, raw provider payload, email or DOB.';
