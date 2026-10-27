begin;
-- 자동 발주확인(ADR-0025). 매일 운영자가 정한 KST 시각(기본 16:30)까지 결제 완료된
-- 신규주문을 시스템이 발주확인한다. 켠 시각(enabled_at) 이전에 결제된 주문은 대상이
-- 아니다 — 운영 DB의 기존 가주문은 사람이 처리한다. 수동 발주확인과 같은 내부 함수로
-- 전이해 confirmed_at·발송지연 시계·고객 직접 취소 종료·감사 기록이 갈라지지 않는다.

-- 1. 결제 완료 시각. 주문이 처음 paid가 된 DB 시각이다. 이 migration 이전에 결제된
--    주문은 행이 없어 자동 발주확인 대상이 되지 않는다.
create table private.order_paid_marks (
 order_id uuid primary key references public.orders(id) on delete cascade,
 paid_at timestamptz not null
);
create index order_paid_marks_paid_at on private.order_paid_marks(paid_at,order_id);
alter table private.order_paid_marks enable row level security;
revoke all on private.order_paid_marks from public,anon,authenticated,service_role;

create function private.record_order_paid_mark() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='paid' and old.status is distinct from 'paid' then
  insert into private.order_paid_marks(order_id,paid_at) values(new.id,clock_timestamp()) on conflict(order_id) do nothing;
 end if;
 return null;
end $$;
revoke all on function private.record_order_paid_mark() from public,anon,authenticated,service_role;
create trigger order_paid_mark after update of status on public.orders for each row execute function private.record_order_paid_mark();

-- 2. 설정·실행 기록. 설정은 켜진 상태(16:30, 이 migration 시각부터)로 시작한다.
create table private.auto_order_confirmation_settings (
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 1 check(revision>0),
 enabled boolean not null,
 run_time time(0) not null check(extract(second from run_time)=0),
 enabled_at timestamptz,
 updated_by uuid references public.profiles(id) on delete set null,
 updated_at timestamptz not null default clock_timestamp(),
 check(not enabled or enabled_at is not null)
);
insert into private.auto_order_confirmation_settings(singleton,enabled,run_time,enabled_at) values(true,true,'16:30',clock_timestamp());
create table private.auto_order_confirmation_runs (
 run_date date primary key,
 cutoff_at timestamptz not null,
 enabled_at timestamptz not null,
 settings_revision bigint not null,
 started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 confirmed_count integer not null default 0 check(confirmed_count>=0),
 excluded_count integer not null default 0 check(excluded_count>=0),
 batch_count integer not null default 0 check(batch_count>=0),
 check(enabled_at<cutoff_at)
);
create table private.auto_order_confirmation_outcomes (
 run_date date not null references private.auto_order_confirmation_runs(run_date),
 order_id uuid not null references public.orders(id) on delete cascade,
 outcome text not null check(outcome in ('confirmed','cancellation_in_progress','preorder_unallocated','status_changed','locked','failed')),
 detail text check(detail is null or char_length(detail)<=300),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(run_date,order_id)
);
create index auto_order_confirmation_outcomes_order on private.auto_order_confirmation_outcomes(order_id);
alter table private.auto_order_confirmation_settings enable row level security;
alter table private.auto_order_confirmation_runs enable row level security;
alter table private.auto_order_confirmation_outcomes enable row level security;
revoke all on private.auto_order_confirmation_settings,private.auto_order_confirmation_runs,private.auto_order_confirmation_outcomes
 from public,anon,authenticated,service_role;

-- 3. 수동·자동 공통 전이. 호출자는 주문 → 배송 건 순서로 잠그고 paid임을 확인한 뒤 부른다.
create function private.confirm_paid_order(p_order_id uuid,p_actor uuid,p_context jsonb) returns void
language plpgsql set search_path='' as $$
begin
 perform private.assert_order_dispatch_allowed(p_order_id);
 update public.orders set status='confirmed',confirmed_at=clock_timestamp() where id=p_order_id and status='paid';
 if not found then raise exception using message='invalid_order_transition';end if;
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'admin.order.status_updated','order:'||p_order_id,
  jsonb_build_object('from','paid','to','confirmed')||coalesce(p_context,'{}'::jsonb));
end $$;
revoke all on function private.confirm_paid_order(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_update_order_status(p_order_id uuid, p_status order_status, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());purchase public.orders;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if p_status in ('shipping','delivered') then
   perform public.admin_update_shipment_status(private.single_order_shipment(p_order_id),p_status::text,p_carrier,p_tracking_number);return;
 end if;
 select * into purchase from public.orders where id=p_order_id for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 perform id from public.order_shipments where order_id=p_order_id order by id for update;
 if p_status is null or p_status not in ('confirmed','shipping','delivered') then raise check_violation using message='invalid_order_status';end if;
 if p_status in ('shipping','delivered') then
   perform public.admin_update_shipment_status(private.single_order_shipment(p_order_id),p_status::text,p_carrier,p_tracking_number);return;
 end if;
 if purchase.status='confirmed' then return;end if;
 if purchase.status<>'paid' then raise exception using message='invalid_order_transition';end if;
 perform private.confirm_paid_order(p_order_id,actor,'{}'::jsonb);
end $function$;

-- 4. 화면 문서. 다음 실행은 오늘 실행이 끝나지 않았고 켠 시각이 오늘 마감보다 앞서면 오늘 마감이다.
create function private.auto_order_confirmation_document(p_now timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 with s as (select * from private.auto_order_confirmation_settings where singleton),
 day as (select (p_now at time zone 'Asia/Seoul')::date today),
 cut as (select ((day.today+s.run_time) at time zone 'Asia/Seoul') today_cutoff,((day.today+1+s.run_time) at time zone 'Asia/Seoul') next_cutoff from s,day),
 today_run as (select r.* from private.auto_order_confirmation_runs r,day where r.run_date=day.today),
 last_run as (select * from private.auto_order_confirmation_runs order by run_date desc limit 1)
 select jsonb_build_object(
  'revision',s.revision,'enabled',s.enabled,'runTime',to_char(s.run_time,'HH24:MI'),'enabledAt',s.enabled_at,'updatedAt',s.updated_at,
  'nextRunAt',case when not s.enabled then null
   when s.enabled_at<cut.today_cutoff and not exists(select 1 from today_run where finished_at is not null) then cut.today_cutoff
   else cut.next_cutoff end,
  'lastRun',(select jsonb_build_object('runDate',l.run_date,'cutoffAt',l.cutoff_at,'startedAt',l.started_at,'finishedAt',l.finished_at,
    'confirmedCount',l.confirmed_count,'excludedCount',l.excluded_count) from last_run l),
  'lastExclusions',coalesce((select jsonb_agg(jsonb_build_object('orderId',x.order_id,'orderNumber',o.order_number,'outcome',x.outcome) order by x.recorded_at,x.order_id)
    from (select x.* from private.auto_order_confirmation_outcomes x join last_run l on l.run_date=x.run_date
     where x.outcome not in ('confirmed','status_changed') order by x.recorded_at,x.order_id limit 20) x
    join public.orders o on o.id=x.order_id),'[]'::jsonb))
 from s cross join cut;
$$;
revoke all on function private.auto_order_confirmation_document(timestamptz) from public,anon,authenticated,service_role;

create function public.admin_get_auto_order_confirmation() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_operator_capability('sales.manage',false);
 return private.auto_order_confirmation_document(clock_timestamp());
end $$;
revoke all on function public.admin_get_auto_order_confirmation() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_auto_order_confirmation() to authenticated;

-- 5. 운영자 설정 변경. 켤 때마다 enabled_at을 새로 잡아 그 뒤 결제분만 대상이 된다.
create function public.admin_save_auto_order_confirmation(p_enabled boolean,p_run_time text,p_expected_revision bigint,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;previous private.auto_order_confirmation_settings;request jsonb;receipt jsonb;at_value timestamptz;
begin
 actor:=private.require_operator_capability('sales.manage',false);
 if p_enabled is null or p_run_time is null or p_run_time!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or p_expected_revision is null or p_expected_revision<1 or p_operation_id is null then
  raise invalid_parameter_value using message='invalid_auto_order_confirmation';end if;
 request:=jsonb_build_object('enabled',p_enabled,'runTime',p_run_time,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('auto-order-confirmation-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.auto_order_confirmation.settings',request);
 if receipt is not null then return receipt;end if;
 select * into previous from private.auto_order_confirmation_settings where singleton for update;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='auto_order_confirmation_changed';end if;
 at_value:=clock_timestamp();
 update private.auto_order_confirmation_settings set revision=revision+1,enabled=p_enabled,run_time=p_run_time::time,
  enabled_at=case when p_enabled and not previous.enabled then at_value else previous.enabled_at end,
  updated_by=actor,updated_at=at_value where singleton;
 -- 끄면 이어 가던 실행도 닫는다. 다시 켜면 새 켠 시각 기준의 실행이 새로 시작된다.
 if not p_enabled then update private.auto_order_confirmation_runs set finished_at=at_value where finished_at is null;end if;
 receipt:=private.auto_order_confirmation_document(at_value);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.auto_order_confirmation.settings','auto_order_confirmation',
  jsonb_build_object('request',request,'before',jsonb_build_object('enabled',previous.enabled,'runTime',to_char(previous.run_time,'HH24:MI'),'enabledAt',previous.enabled_at),'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_save_auto_order_confirmation(boolean,text,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_auto_order_confirmation(boolean,text,bigint,uuid) to authenticated;

-- 6. 실행. p_now 기준 KST 날짜의 마감이 지났고 그날 실행이 끝나지 않았으면 한 묶음을 처리한다.
--    대상 = paid + 켠 시각 ≤ 결제 시각 ≤ 마감. 날짜당 실행 행 하나(멱등)이며, 묶음이 가득 차면
--    다음 틱이 같은 실행을 이어 간다. 이미 판정한 주문은 같은 실행에서 다시 보지 않는다.
create function private.run_auto_order_confirmation(p_now timestamptz,p_batch integer default 200) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.auto_order_confirmation_settings;run private.auto_order_confirmation_runs;run_day date;cutoff timestamptz;
 candidate record;purchase public.orders;outcome text;detail text;confirmed integer:=0;excluded integer:=0;seen integer:=0;
begin
 if p_now is null or p_batch is null or p_batch not between 1 and 1000 then raise invalid_parameter_value using message='invalid_auto_order_confirmation_run';end if;
 -- 잠금 없는 사전 확인: 대부분의 틱은 여기서 끝난다.
 select * into s from private.auto_order_confirmation_settings where singleton;
 if not found or not s.enabled then return jsonb_build_object('status','disabled');end if;
 run_day:=(p_now at time zone 'Asia/Seoul')::date;
 cutoff:=(run_day+s.run_time) at time zone 'Asia/Seoul';
 if p_now<cutoff then return jsonb_build_object('status','before_cutoff','cutoffAt',cutoff);end if;
 if s.enabled_at>=cutoff then return jsonb_build_object('status','enabled_after_cutoff','cutoffAt',cutoff);end if;
 if exists(select 1 from private.auto_order_confirmation_runs where run_date=run_day and finished_at is not null) then
  return jsonb_build_object('status','already_ran','runDate',run_day);end if;
 -- 동시 틱을 직렬화하고, 실행 중에는 설정 변경을 기다리게 한다.
 perform pg_advisory_xact_lock(hashtextextended('auto-order-confirmation-run',0));
 select * into s from private.auto_order_confirmation_settings where singleton for share;
 if not s.enabled then return jsonb_build_object('status','disabled');end if;
 cutoff:=(run_day+s.run_time) at time zone 'Asia/Seoul';
 if p_now<cutoff then return jsonb_build_object('status','before_cutoff','cutoffAt',cutoff);end if;
 if s.enabled_at>=cutoff then return jsonb_build_object('status','enabled_after_cutoff','cutoffAt',cutoff);end if;
 insert into private.auto_order_confirmation_runs(run_date,cutoff_at,enabled_at,settings_revision)
  values(run_day,cutoff,s.enabled_at,s.revision) on conflict(run_date) do nothing;
 select * into run from private.auto_order_confirmation_runs where run_date=run_day for update;
 if run.finished_at is not null then return jsonb_build_object('status','already_ran','runDate',run_day);end if;
 -- 실행 도중 껐다 켜면 새 켠 시각 이전 결제분을 더 처리하지 않고 이 실행을 닫는다.
 if s.enabled_at is distinct from run.enabled_at then
  update private.auto_order_confirmation_runs set finished_at=clock_timestamp() where run_date=run_day;
  return jsonb_build_object('status','settings_changed','runDate',run_day);end if;
 perform set_config('lock_timeout','3s',true);
 for candidate in
  select o.id from public.orders o join private.order_paid_marks m on m.order_id=o.id
  where o.status='paid' and m.paid_at>=run.enabled_at and m.paid_at<=run.cutoff_at
   and not exists(select 1 from private.auto_order_confirmation_outcomes x where x.run_date=run_day and x.order_id=o.id)
  order by m.paid_at,o.id limit p_batch
 loop
  seen:=seen+1;detail:=null;
  begin
   -- 고객 직접 취소·수동 발주확인과 같은 주문 → 배송 건 잠금 순서. 먼저 잠근 쪽만 반영된다.
   select * into purchase from public.orders where id=candidate.id for update;
   perform id from public.order_shipments where order_id=candidate.id order by id for update;
   if purchase.status<>'paid' then outcome:='status_changed';
   elsif exists(select 1 from public.order_cancellation_requests c where c.order_id=candidate.id and c.status in ('requested','processing','needs_review'))
    or exists(select 1 from public.order_cancellation_claims c where c.order_id=candidate.id) then outcome:='cancellation_in_progress';
   elsif exists(select 1 from public.order_items i left join private.goods_preorder_reservations r on r.order_item_id=i.id
    where i.order_id=candidate.id and i.supply_source='preorder' and (r.order_item_id is null or r.state<>'allocated')) then outcome:='preorder_unallocated';
   else
    perform private.confirm_paid_order(candidate.id,null,jsonb_build_object('trigger','auto_order_confirmation','runDate',run_day,'cutoffAt',run.cutoff_at));
    outcome:='confirmed';
   end if;
  exception
   when lock_not_available then outcome:='locked';
   when others then outcome:='failed';detail:=left(sqlstate||' '||sqlerrm,300);
  end;
  insert into private.auto_order_confirmation_outcomes(run_date,order_id,outcome,detail) values(run_day,candidate.id,outcome,detail);
  if outcome='confirmed' then confirmed:=confirmed+1;elsif outcome<>'status_changed' then excluded:=excluded+1;end if;
 end loop;
 update private.auto_order_confirmation_runs set confirmed_count=confirmed_count+confirmed,excluded_count=excluded_count+excluded,
  batch_count=batch_count+1,finished_at=case when seen<p_batch then clock_timestamp() end
 where run_date=run_day returning * into run;
 if run.finished_at is not null then
  insert into public.audit_log(actor_id,action,target,diff) values(null,'system.order.auto_confirmation_run','auto_order_confirmation:'||run_day,
   jsonb_build_object('runDate',run_day,'cutoffAt',run.cutoff_at,'enabledAt',run.enabled_at,'settingsRevision',run.settings_revision,
    'confirmed',run.confirmed_count,'excluded',run.excluded_count,'batches',run.batch_count));
 end if;
 return jsonb_build_object('status',case when run.finished_at is null then 'continuing' else 'finished' end,'runDate',run_day,
  'confirmed',confirmed,'excluded',excluded);
end $$;
revoke all on function private.run_auto_order_confirmation(timestamptz,integer) from public,anon,authenticated,service_role;

create function private.tick_auto_order_confirmation() returns jsonb
language sql security definer set search_path='' as $$ select private.run_auto_order_confirmation(clock_timestamp(),200) $$;
revoke all on function private.tick_auto_order_confirmation() from public,anon,authenticated,service_role;

-- 매분. cron.schedule은 이름 기준 upsert라 재적용에도 안전하다.
select cron.schedule('auto-order-confirmation','* * * * *','select private.tick_auto_order_confirmation()');

-- 등록 함수 재정의·신규 RPC 지문(ACL 확정 뒤).
select private.register_operator_rpc_contract('public.admin_update_order_status(uuid,order_status,text,text)'::regprocedure,'sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_get_auto_order_confirmation()'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_auto_order_confirmation(boolean,text,bigint,uuid)'::regprocedure,'sales.manage','write',false);
commit;
