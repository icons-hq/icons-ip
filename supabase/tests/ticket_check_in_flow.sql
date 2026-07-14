\set ON_ERROR_STOP on

begin;

select 1 / case when to_regprocedure(
  'public.check_in_ticket(uuid,text)'
) is not null then 1 else 0 end as assert_check_in_rpc_exists;

select 1 / case when to_regprocedure(
  'public.check_in_ticket(text)'
) is null then 1 else 0 end as assert_legacy_check_in_rpc_is_removed;

select 1 / case when (
  not has_function_privilege(
    'anon', 'public.check_in_ticket(uuid,text)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'public.check_in_ticket(uuid,text)', 'execute'
  )
  and has_function_privilege(
    'service_role', 'public.check_in_ticket(uuid,text)', 'execute'
  )
  and not exists (
    select 1
    from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name = 'check_in_ticket'
      and grantee = 'PUBLIC'
      and privilege_type = 'EXECUTE'
  )
) then 1 else 0 end as assert_check_in_rpc_is_service_only;

select 1 / case when (
  select procedure.prosecdef
    and procedure.provolatile = 'v'
    and procedure.proconfig = array['search_path=public, pg_temp']::text[]
    and pg_get_function_identity_arguments(procedure.oid)
      = 'p_staff_id uuid, p_qr_token text'
    and pg_get_function_result(procedure.oid)
      = 'TABLE(result text, checked_at timestamp with time zone, event_id text, event_title text, ticket_type_id uuid, ticket_type_name text)'
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.check_in_ticket(uuid,text)'::regprocedure
) then 1 else 0 end as assert_check_in_rpc_contract_is_fixed;

select lower(pg_get_functiondef(
  'public.check_in_ticket(uuid,text)'::regprocedure
)) as check_in_definition \gset

select 1 / case when (
  strpos(:'check_in_definition', 'from public.profiles') > 0
  and strpos(:'check_in_definition', 'from public.tickets') > 0
  and strpos(:'check_in_definition', 'from public.ticket_orders') > 0
  and strpos(:'check_in_definition', 'from public.ticket_cancellation_requests') > 0
  and strpos(
    :'check_in_definition',
    $$request.status in ('requested', 'processing', 'needs_review')$$
  ) > 0
  and strpos(:'check_in_definition', 'from public.tickets')
    < strpos(:'check_in_definition', 'from public.ticket_orders')
  and strpos(:'check_in_definition', 'from public.ticket_orders')
    < strpos(:'check_in_definition', 'from public.ticket_cancellation_requests')
  and strpos(:'check_in_definition', 'from public.ticket_cancellation_requests')
    < strpos(:'check_in_definition', 'for update of ticket;')
  and strpos(
    substring(
      :'check_in_definition'
      from strpos(:'check_in_definition', 'from public.tickets')
      for strpos(:'check_in_definition', 'from public.ticket_orders')
        - strpos(:'check_in_definition', 'from public.tickets')
    ),
    'for update'
  ) = 0
) then 1 else 0 end as assert_check_in_lock_order_and_nonlocking_lookup;

select 1 / case when (
  strpos(:'check_in_definition', 'on conflict') = 0
  and strpos(:'check_in_definition', $$'^[0-9a-f]{32}$'$$) > 0
) then 1 else 0 end as assert_check_in_does_not_mask_ledger_conflicts_and_validates_qr;

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000009701',
    'authenticated',
    'authenticated',
    'ticket-check-in-staff@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000009702',
    'authenticated',
    'authenticated',
    'ticket-check-in-admin@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000009703',
    'authenticated',
    'authenticated',
    'ticket-check-in-user@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000009704',
    'authenticated',
    'authenticated',
    'ticket-check-in-owner@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id,
  email,
  nickname,
  birth_date,
  consents,
  onboarded_at,
  role
)
values
  (
    '00000000-0000-4000-8000-000000009701',
    'ticket-check-in-staff@example.test',
    'ticket_check_in_staff',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'staff'
  ),
  (
    '00000000-0000-4000-8000-000000009702',
    'ticket-check-in-admin@example.test',
    'ticket_check_in_admin',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'admin'
  ),
  (
    '00000000-0000-4000-8000-000000009703',
    'ticket-check-in-user@example.test',
    'ticket_check_in_user',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'user'
  ),
  (
    '00000000-0000-4000-8000-000000009704',
    'ticket-check-in-owner@example.test',
    'ticket_check_in_owner',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.events (id, title, mode, status, starts_at)
values (
  'ticket-check-in-event',
  '티켓 검표 테스트 이벤트',
  '오프라인',
  '예매중',
  now() + interval '7 days'
)
on conflict (id) do update set
  title = excluded.title,
  starts_at = excluded.starts_at;

insert into public.ticket_types (
  id,
  event_id,
  name,
  price,
  capacity,
  sold
)
values (
  '97000000-0000-4000-8000-000000000001',
  'ticket-check-in-event',
  '7월 22일 1회차',
  10000,
  20,
  6
);

insert into public.ticket_orders (
  id,
  user_id,
  event_id,
  status,
  total,
  expires_at
)
values
  (
    '97100000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000009704',
    'ticket-check-in-event',
    'paid',
    10000,
    null
  ),
  (
    '97100000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000009704',
    'ticket-check-in-event',
    'paid',
    10000,
    null
  ),
  (
    '97100000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000009704',
    'ticket-check-in-event',
    'paid',
    10000,
    null
  ),
  (
    '97100000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000009704',
    'ticket-check-in-event',
    'canceled',
    10000,
    null
  ),
  (
    '97100000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000009704',
    'ticket-check-in-event',
    'paid',
    10000,
    null
  ),
  (
    '97100000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000009704',
    'ticket-check-in-event',
    'pending',
    10000,
    now() + interval '10 minutes'
  );

insert into public.tickets (
  id,
  ticket_order_id,
  ticket_type_id,
  qr_token,
  status
)
values
  (
    '97200000-0000-4000-8000-000000000001',
    '97100000-0000-4000-8000-000000000001',
    '97000000-0000-4000-8000-000000000001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
    'valid'
  ),
  (
    '97200000-0000-4000-8000-000000000002',
    '97100000-0000-4000-8000-000000000002',
    '97000000-0000-4000-8000-000000000001',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2',
    'used'
  ),
  (
    '97200000-0000-4000-8000-000000000003',
    '97100000-0000-4000-8000-000000000003',
    '97000000-0000-4000-8000-000000000001',
    'ccccccccccccccccccccccccccccccc3',
    'used'
  ),
  (
    '97200000-0000-4000-8000-000000000004',
    '97100000-0000-4000-8000-000000000004',
    '97000000-0000-4000-8000-000000000001',
    'ddddddddddddddddddddddddddddddd4',
    'refunded'
  ),
  (
    '97200000-0000-4000-8000-000000000005',
    '97100000-0000-4000-8000-000000000005',
    '97000000-0000-4000-8000-000000000001',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee5',
    'valid'
  ),
  (
    '97200000-0000-4000-8000-000000000006',
    '97100000-0000-4000-8000-000000000006',
    '97000000-0000-4000-8000-000000000001',
    'fffffffffffffffffffffffffffffff6',
    'valid'
  );

insert into public.check_ins (ticket_id, checked_at, by_staff)
values (
  '97200000-0000-4000-8000-000000000002',
  '2026-07-01 01:02:03+00',
  '00000000-0000-4000-8000-000000009701'
);

insert into public.ticket_cancellation_requests (
  id,
  ticket_order_id,
  requested_by,
  source,
  status,
  cutoff_at,
  gross_amount,
  refund_amount,
  reason
)
values (
  '97300000-0000-4000-8000-000000000001',
  '97100000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000009704',
  'user',
  'requested',
  now() + interval '7 days',
  10000,
  10000,
  '검표 경합 테스트'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  invalid_token text;
begin
  for invalid_token in
    select token
    from unnest(array[
      null::text,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'gggggggggggggggggggggggggggggggg',
      ' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
    ]) as input(token)
  loop
    begin
      perform *
      from public.check_in_ticket(
        '00000000-0000-4000-8000-000000009701',
        invalid_token
      );
      raise exception 'invalid QR token should be rejected';
    exception
      when check_violation then
        if sqlerrm <> 'invalid qr token' then
          raise;
        end if;
    end;
  end loop;
end;
$$;

do $$
begin
  begin
    perform *
    from public.check_in_ticket(
      '00000000-0000-4000-8000-000000009703',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
    );
    raise exception 'non-staff caller identity should be rejected';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'staff access required' then
        raise;
      end if;
  end;
end;
$$;

select 1 / case when (
  select result = 'not_found'
    and checked_at is null
    and event_id is null
    and event_title is null
    and ticket_type_id is null
    and ticket_type_name is null
  from public.check_in_ticket(
    '00000000-0000-4000-8000-000000009702',
    '0123456789abcdef0123456789abcdef'
  )
) then 1 else 0 end as assert_admin_gets_safe_not_found_result;

create temporary table checked_in_result on commit drop as
select *
from public.check_in_ticket(
  '00000000-0000-4000-8000-000000009701',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
);

select 1 / case when (
  select result = 'checked_in'
    and checked_at is not null
    and event_id = 'ticket-check-in-event'
    and event_title = '티켓 검표 테스트 이벤트'
    and ticket_type_id = '97000000-0000-4000-8000-000000000001'
    and ticket_type_name = '7월 22일 1회차'
  from checked_in_result
) then 1 else 0 end as assert_valid_paid_ticket_returns_safe_metadata;

select 1 / case when (
  select ticket.status = 'used'
    and check_in.checked_at = result.checked_at
    and check_in.by_staff = '00000000-0000-4000-8000-000000009701'
  from public.tickets as ticket
  join public.check_ins as check_in on check_in.ticket_id = ticket.id
  cross join checked_in_result as result
  where ticket.id = '97200000-0000-4000-8000-000000000001'
) then 1 else 0 end as assert_check_in_transition_and_ledger_are_atomic;

select 1 / case when (
  select count(*) = 1
    and bool_and(actor_id = '00000000-0000-4000-8000-000000009701')
    and bool_and(diff = '{"before":{"status":"valid"},"after":{"status":"used"}}'::jsonb)
  from public.audit_log
  where action = 'admin.ticket.checked_in'
    and target = 'tickets:97200000-0000-4000-8000-000000000001'
) then 1 else 0 end as assert_check_in_writes_one_privacy_safe_audit;

create temporary table replay_result on commit drop as
select *
from public.check_in_ticket(
  '00000000-0000-4000-8000-000000009702',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
);

select 1 / case when (
  select replay.result = 'already_used'
    and replay.checked_at = original.checked_at
    and replay.event_id = original.event_id
    and replay.event_title = original.event_title
    and replay.ticket_type_id = original.ticket_type_id
    and replay.ticket_type_name = original.ticket_type_name
  from replay_result as replay
  cross join checked_in_result as original
) then 1 else 0 end as assert_replay_returns_original_check_in_result;

select 1 / case when (
  select count(*) = 1
  from public.check_ins
  where ticket_id = '97200000-0000-4000-8000-000000000001'
) and (
  select count(*) = 1
  from public.audit_log
  where action = 'admin.ticket.checked_in'
    and target = 'tickets:97200000-0000-4000-8000-000000000001'
) then 1 else 0 end as assert_replay_is_write_free;

select 1 / case when (
  select result = 'already_used'
    and checked_at = '2026-07-01 01:02:03+00'::timestamptz
    and event_id = 'ticket-check-in-event'
    and event_title = '티켓 검표 테스트 이벤트'
    and ticket_type_id = '97000000-0000-4000-8000-000000000001'
    and ticket_type_name = '7월 22일 1회차'
  from public.check_in_ticket(
    '00000000-0000-4000-8000-000000009701',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2'
  )
) then 1 else 0 end as assert_used_ticket_returns_original_ledger_time;

do $$
begin
  begin
    perform *
    from public.check_in_ticket(
      '00000000-0000-4000-8000-000000009701',
      'ccccccccccccccccccccccccccccccc3'
    );
    raise exception 'used ticket without ledger should fail closed';
  exception
    when check_violation then
      if sqlerrm <> 'used ticket check-in ledger missing' then
        raise;
      end if;
  end;
end;
$$;

select 1 / case when (
  select result = 'refunded'
    and checked_at is null
    and event_id = 'ticket-check-in-event'
    and event_title = '티켓 검표 테스트 이벤트'
    and ticket_type_id = '97000000-0000-4000-8000-000000000001'
    and ticket_type_name = '7월 22일 1회차'
  from public.check_in_ticket(
    '00000000-0000-4000-8000-000000009701',
    'ddddddddddddddddddddddddddddddd4'
  )
) then 1 else 0 end as assert_refunded_ticket_is_read_only;

select 1 / case when not exists (
  select 1
  from public.check_ins
  where ticket_id in (
    '97200000-0000-4000-8000-000000000003',
    '97200000-0000-4000-8000-000000000004'
  )
) and not exists (
  select 1
  from public.audit_log
  where target in (
    'tickets:97200000-0000-4000-8000-000000000003',
    'tickets:97200000-0000-4000-8000-000000000004'
  )
) then 1 else 0 end as assert_invalid_ledgers_and_refunds_do_not_write;

do $$
begin
  begin
    perform *
    from public.check_in_ticket(
      '00000000-0000-4000-8000-000000009701',
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee5'
    );
    raise exception 'active cancellation should block check-in';
  exception
    when check_violation then
      if sqlerrm <> 'ticket cancellation in progress' then
        raise;
      end if;
  end;
end;
$$;

do $$
begin
  begin
    perform *
    from public.check_in_ticket(
      '00000000-0000-4000-8000-000000009701',
      'fffffffffffffffffffffffffffffff6'
    );
    raise exception 'unpaid valid ticket should not be consumed';
  exception
    when check_violation then
      if sqlerrm <> 'ticket order not paid' then
        raise;
      end if;
  end;
end;
$$;

select 1 / case when (
  select status = 'valid'
  from public.tickets
  where id = '97200000-0000-4000-8000-000000000005'
) and (
  select status = 'valid'
  from public.tickets
  where id = '97200000-0000-4000-8000-000000000006'
) and not exists (
  select 1
  from public.check_ins
  where ticket_id in (
    '97200000-0000-4000-8000-000000000005',
    '97200000-0000-4000-8000-000000000006'
  )
) then 1 else 0 end as assert_blocked_check_ins_preserve_ticket_state;

select 1 / case when not exists (
  select 1
  from public.audit_log
  where action = 'admin.ticket.checked_in'
    and (
      diff::text like '%aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1%'
      or diff::text like '%00000000-0000-4000-8000-000000009704%'
      or diff::text like '%97100000-0000-4000-8000-000000000001%'
      or target like '%aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1%'
    )
) then 1 else 0 end as assert_check_in_audit_contains_no_qr_owner_or_order_data;

rollback;
