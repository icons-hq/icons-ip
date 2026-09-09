-- #429/#447: shipping commits an ID-only outbox. Provider calls run outside the order transaction.
create table public.order_shipment_email_jobs (
  shipment_id uuid primary key,
  order_id uuid not null,
  foreign key(order_id,shipment_id) references public.order_shipments(order_id,id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','processing','completed','review')),
  attempts integer not null default 0 check(attempts between 0 and 8),
  available_at timestamptz not null default now(),
  claim_token uuid,
  lease_until timestamptz,
  last_error_code text check(last_error_code in (
    'provider_retryable','provider_not_configured','delivery_in_progress','delivery_outcome_unknown',
    'delivery_rejected','shipment_unavailable','recipient_missing','lease_exhausted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check((status='processing')=(claim_token is not null and lease_until is not null)),
  check((claim_token is null)=(lease_until is null)),
  check((status='completed')=(completed_at is not null))
);
create index order_shipment_email_jobs_due_idx on public.order_shipment_email_jobs(available_at,shipment_id)
  where status in ('pending','processing');
alter table public.order_shipment_email_jobs enable row level security;
revoke all on public.order_shipment_email_jobs from public,anon,authenticated,service_role;
grant select on public.order_shipment_email_jobs to authenticated,service_role;
create policy shipment_email_jobs_staff_read on public.order_shipment_email_jobs for select to authenticated
 using(public.is_staff());

create function private.enqueue_dispatched_shipment_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='ready' and new.status='shipping' then
    insert into public.order_shipment_email_jobs(order_id,shipment_id) values(new.order_id,new.id)
      on conflict(shipment_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.enqueue_dispatched_shipment_email() from public,anon,authenticated,service_role;
create trigger shipment_email_outbox after update of status on public.order_shipments
for each row execute function private.enqueue_dispatched_shipment_email();

create function public.admin_enqueue_shipment_emails(target_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare expected integer; valid integer;
begin
  if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff_required';end if;
  if jsonb_typeof(target_rows) is distinct from 'array' or jsonb_array_length(target_rows)>1000 then
    raise invalid_parameter_value using message='invalid_shipment_email_rows';end if;
  if exists(select 1 from jsonb_array_elements(target_rows) e where jsonb_typeof(e) is distinct from 'object'
    or jsonb_typeof(e->'orderId') is distinct from 'string' or jsonb_typeof(e->'shipmentId') is distinct from 'string') then
    raise invalid_parameter_value using message='invalid_shipment_email_rows';end if;
  if exists(select 1 from jsonb_array_elements(target_rows) e cross join lateral jsonb_object_keys(e) k
    where k not in ('orderId','shipmentId')) then raise invalid_parameter_value using message='invalid_shipment_email_rows';end if;
  perform o.id from public.orders o where o.id in (select (e->>'orderId')::uuid from jsonb_array_elements(target_rows) e)
    order by o.id for update;
  select count(distinct ((e->>'orderId')::uuid,(e->>'shipmentId')::uuid)) into expected from jsonb_array_elements(target_rows) e;
  select count(*) into valid from public.order_shipments s join public.orders o on o.id=s.order_id
    where (s.order_id,s.id) in (select (e->>'orderId')::uuid,(e->>'shipmentId')::uuid from jsonb_array_elements(target_rows) e)
    and s.status in ('shipping','delivered') and o.status in ('shipping','delivered','done');
  if valid<>expected then raise check_violation using message='shipment_email_unavailable';end if;
  insert into public.order_shipment_email_jobs(order_id,shipment_id)
    select distinct (e->>'orderId')::uuid,(e->>'shipmentId')::uuid from jsonb_array_elements(target_rows) e
    order by 1,2 on conflict(shipment_id) do nothing;
  return jsonb_build_object('queued',valid);
end $$;
revoke all on function public.admin_enqueue_shipment_emails(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_enqueue_shipment_emails(jsonb) to authenticated;

create function public.claim_shipment_email_jobs(batch_limit integer default 25)
returns table(order_id uuid,shipment_id uuid,claim_token uuid,delivery_state text)
language plpgsql security definer set search_path='' as $$
begin
  if batch_limit is null or batch_limit not between 1 and 25 then
    raise invalid_parameter_value using message='invalid_shipment_email_batch';end if;
  -- A crashed final attempt stays visible instead of waiting forever on an expired lease.
  with exhausted as (
    select j.shipment_id from public.order_shipment_email_jobs j
    where j.status='processing' and j.lease_until<=clock_timestamp() and j.attempts>=8
    order by j.lease_until,j.shipment_id for update skip locked limit batch_limit
  )
  update public.order_shipment_email_jobs j set status='review',claim_token=null,lease_until=null,
    last_error_code='lease_exhausted',updated_at=clock_timestamp()
    from exhausted e where e.shipment_id=j.shipment_id;
  return query
    with candidates as (
      select j.shipment_id from public.order_shipment_email_jobs j where j.attempts<8
        and ((j.status='pending' and j.available_at<=clock_timestamp())
          or (j.status='processing' and j.lease_until<=clock_timestamp()))
        order by j.available_at,j.shipment_id for update skip locked limit batch_limit
    ), claimed as (
    update public.order_shipment_email_jobs j set status='processing',attempts=j.attempts+1,
      claim_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp()
    from candidates c where c.shipment_id=j.shipment_id returning j.order_id,j.shipment_id,j.claim_token
    )
    select c.order_id,c.shipment_id,c.claim_token,
      case when d.status='sent' then 'sent'
        when d.status='pending' then case when d.claimed_at>clock_timestamp()-interval '10 minutes' then 'busy' else 'unknown' end
        when d.status='failed' and coalesce(d.last_error,'') !~ '^(provider_http_(429|5[0-9]{2})|provider_not_configured)$' then 'unknown'
        else 'ready' end
    from claimed c left join public.email_deliveries d on d.dedupe_key='order_shipped:'||c.order_id||':'||c.shipment_id;
end $$;
revoke all on function public.claim_shipment_email_jobs(integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_shipment_email_jobs(integer) to service_role;

create function public.finish_shipment_email_job(target_shipment uuid,target_claim uuid,outcome text,error_code text default null)
returns text language plpgsql security definer set search_path='' as $$
declare job public.order_shipment_email_jobs; next_status text; code text:=error_code;
begin
  if outcome is null or outcome not in ('sent','already_delivered','retry','review')
    or (error_code is not null and error_code not in ('provider_retryable','provider_not_configured','delivery_in_progress',
      'delivery_outcome_unknown','delivery_rejected','shipment_unavailable','recipient_missing')) then
    raise invalid_parameter_value using message='invalid_shipment_email_outcome';end if;
  select * into job from public.order_shipment_email_jobs where shipment_id=target_shipment for update;
  if not found or job.status<>'processing' or job.claim_token is distinct from target_claim or job.lease_until<=clock_timestamp() then
    return 'stale';end if;
  if outcome='sent' then next_status:='completed';code:=null;
  elsif outcome='already_delivered' then
    -- The existing sender also uses this result while another delivery claim is pending.
    if exists(select 1 from public.email_deliveries d
      where d.dedupe_key='order_shipped:'||job.order_id||':'||job.shipment_id and d.status='sent') then
      next_status:='completed';code:=null;
    else next_status:='pending';code:='delivery_in_progress';end if;
  elsif outcome='retry' then next_status:='pending';
  else next_status:='review';end if;
  if next_status='pending' and job.attempts>=8 then next_status:='review';end if;
  update public.order_shipment_email_jobs set status=next_status,claim_token=null,lease_until=null,last_error_code=code,
    available_at=clock_timestamp()+case when code='delivery_in_progress' then interval '15 minutes'
      else make_interval(secs=>least(3600,60*power(2,job.attempts-1))::integer) end,
    completed_at=case when next_status='completed' then clock_timestamp() end,updated_at=clock_timestamp()
    where shipment_id=target_shipment;
  return next_status;
end $$;
revoke all on function public.finish_shipment_email_job(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_shipment_email_job(uuid,uuid,text,text) to service_role;
