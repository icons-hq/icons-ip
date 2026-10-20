-- A customer's withdrawal closes the request, never the order or its payment.
-- Keep the legacy rejected status projection while distinguishing its terminal stage.
alter table public.order_cancellation_requests
 add column claim_revision integer not null default 0 check(claim_revision>=0),
 add column withdrawn_at timestamptz;
alter table public.order_cancellation_requests drop constraint order_cancellation_requests_stage_check;
alter table public.order_cancellation_requests add constraint order_cancellation_requests_stage_check
 check(stage in('requested','in_review','collecting','collected','on_hold','processing','needs_review','completed','rejected','withdrawn'));
alter table public.order_cancellation_requests drop constraint order_cancellation_requests_stage_projection_check;
alter table public.order_cancellation_requests add constraint order_cancellation_requests_stage_projection_check
 check(case stage when 'processing' then status='processing' when 'needs_review' then status='needs_review'
 when 'completed' then status='completed' when 'rejected' then status='rejected' when 'withdrawn' then status='rejected' else status='requested' end);
alter table public.order_cancellation_requests add constraint order_claim_withdrawn_time_check
 check((stage='withdrawn')=(withdrawn_at is not null));

create or replace function private.order_claim_status_for_stage(p_stage text) returns text
language sql immutable set search_path='' as $$
 select case p_stage when 'processing' then 'processing' when 'needs_review' then 'needs_review'
 when 'completed' then 'completed' when 'rejected' then 'rejected' when 'withdrawn' then 'rejected' else 'requested' end;
$$;
revoke all on function private.order_claim_status_for_stage(text) from public,anon,authenticated,service_role;

create function private.preserve_claim_withdrawal() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.stage='withdrawn' and (new.stage<>old.stage or new.status<>old.status or new.claim_type<>old.claim_type or new.withdrawn_at is distinct from old.withdrawn_at) then
  raise check_violation using message='claim_already_withdrawn';end if;
 new.claim_revision:=old.claim_revision+1;
 return new;
end $$;
revoke all on function private.preserve_claim_withdrawal() from public,anon,authenticated,service_role;
create trigger claims_withdrawal_terminal before update on public.order_cancellation_requests for each row execute function private.preserve_claim_withdrawal();

create or replace function private.seal_order_claim_refund_account() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if new.stage in('completed','rejected','withdrawn') and (tg_op='INSERT' or old.stage is distinct from new.stage) then
  update private.claim_refund_accounts set purge_after=coalesce(purge_after,now()+interval '30 days') where claim_id=new.id and purged_at is null;
 end if;
 return null;
end $$;
revoke all on function private.seal_order_claim_refund_account() from public,anon,authenticated,service_role;

create table private.order_claim_withdrawals (
 id uuid primary key, claim_id uuid not null unique references public.order_cancellation_requests(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade, actor_id uuid not null,
 actor_kind text not null check(actor_kind in('customer','operator')), expected_revision integer not null,
 reason text not null check(char_length(reason) between 2 and 500), from_stage text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.order_claim_withdrawals enable row level security;
revoke all on private.order_claim_withdrawals from public,anon,authenticated,service_role;

create function private.order_claim_withdrawal_blocker(p_claim public.order_cancellation_requests) returns text
language sql stable security definer set search_path='' as $$
 select case
  when p_claim.stage='withdrawn' then 'claim_already_withdrawn'
  when (case when p_claim.stage='on_hold' then coalesce(p_claim.held_from,'requested') else p_claim.stage end) not in('requested','in_review','collecting') then 'claim_withdrawal_started'
  when p_claim.collected_at is not null or p_claim.reshipped_at is not null
   or exists(select 1 from public.order_claim_collections where claim_id=p_claim.id and collected_at is not null)
   or exists(select 1 from private.seller_order_claim_intakes intake cross join lateral jsonb_array_elements(intake.payload->'collections') item
    where intake.claim_id=p_claim.id and item->>'method'='customer_sent') then 'claim_withdrawal_collection_started'
  when exists(select 1 from public.order_cancellation_claims where order_id=p_claim.order_id)
   or exists(select 1 from public.refunds refund join public.payments payment on payment.id=refund.payment_id where payment.purpose='order' and payment.ref_id=p_claim.order_id)
   or exists(select 1 from public.orders where id=p_claim.order_id and status='canceled') then 'claim_withdrawal_finance_started'
  else null end;
$$;
revoke all on function private.order_claim_withdrawal_blocker(public.order_cancellation_requests) from public,anon,authenticated,service_role;

create function private.order_claim_withdrawal_receipt(p_id uuid,p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'claimId',claim_id,'orderId',order_id,'actorKind',actor_kind,
  'reason',reason,'createdAt',created_at,'stage','withdrawn') from private.order_claim_withdrawals where id=p_id and actor_id=p_actor;
$$;
revoke all on function private.order_claim_withdrawal_receipt(uuid,uuid) from public,anon,authenticated,service_role;

create function private.read_order_claim_withdrawal_context(p_claim_id uuid,p_actor uuid,p_as_operator boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare claim public.order_cancellation_requests;purchase public.orders;blocker text;
begin
 if p_actor is null then raise insufficient_privilege using message='auth_required';end if;
 if p_as_operator and not private.has_operator_capability(p_actor,'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 select * into purchase from public.orders where id=claim.order_id;
 if not p_as_operator and purchase.user_id<>p_actor then raise no_data_found using message='claim_not_found';end if;
 blocker:=private.order_claim_withdrawal_blocker(claim);
 return jsonb_build_object('claimId',claim.id,'orderId',claim.order_id,'claimType',claim.claim_type,'stage',claim.stage,
  'revision',claim.claim_revision,'allowed',blocker is null,'blocker',blocker,'orderTotal',purchase.total,
  'withdrawal',(select jsonb_build_object('actorKind',w.actor_kind,'reason',w.reason,'createdAt',w.created_at) from private.order_claim_withdrawals w where w.claim_id=claim.id));
end $$;
revoke all on function private.read_order_claim_withdrawal_context(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.get_my_order_claim_withdrawal_context(p_claim_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$select private.read_order_claim_withdrawal_context(p_claim_id,auth.uid(),false);$$;
create function public.admin_order_claim_withdrawal_context(p_claim_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$select private.read_order_claim_withdrawal_context(p_claim_id,auth.uid(),true);$$;
revoke all on function public.get_my_order_claim_withdrawal_context(uuid),public.admin_order_claim_withdrawal_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_order_claim_withdrawal_context(uuid),public.admin_order_claim_withdrawal_context(uuid) to authenticated;

create function private.apply_order_claim_withdrawal(p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,p_reason text,p_confirmed boolean,p_as_operator boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();purchase public.orders;claim public.order_cancellation_requests;previous private.order_claim_withdrawals;
 order_key uuid;buyer uuid;blocker text;kind text:=case when p_as_operator then 'operator' else 'customer' end;reason text:=btrim(p_reason);happened timestamptz;
begin
 if actor is null then raise insufficient_privilege using message='auth_required';end if;
 if p_as_operator and not private.has_operator_capability(actor,'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_claim_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or p_confirmed is distinct from true
  or reason is null or char_length(reason) not between 2 and 500 or reason~'[[:cntrl:]]' then raise invalid_parameter_value using message='invalid_claim_withdrawal';end if;
 select c.order_id,o.user_id into order_key,buyer from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where c.id=p_claim_id;
 if order_key is null or not p_as_operator and buyer<>actor then raise no_data_found using message='claim_not_found';end if;
 -- Existing-order recovery remains available to its owner, including suspended owners.
 perform private.lock_operator_subjects(array[actor,buyer]);
 if p_as_operator then perform private.require_actor_operator_capability(actor,'sales.manage',false);end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-withdrawal:'||p_operation_id::text,0));
 select * into previous from private.order_claim_withdrawals where id=p_operation_id;
 if found then
  if previous.actor_id<>actor or previous.actor_kind<>kind or previous.claim_id<>p_claim_id or previous.expected_revision<>p_expected_revision or previous.reason<>reason then
   raise unique_violation using message='claim_withdrawal_request_conflict';end if;
  return private.order_claim_withdrawal_receipt(p_operation_id,actor);
 end if;
 select * into purchase from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 perform shipment_id from public.order_claim_collections where claim_id=p_claim_id order by shipment_id for update;
 if claim.claim_revision<>p_expected_revision then raise sqlstate 'PT409' using message='claim_changed';end if;
 blocker:=private.order_claim_withdrawal_blocker(claim);
 if blocker is not null then raise check_violation using message=blocker;end if;
 happened:=clock_timestamp();
 insert into private.order_claim_withdrawals(id,claim_id,order_id,actor_id,actor_kind,expected_revision,reason,from_stage,created_at)
 values(p_operation_id,p_claim_id,order_key,actor,kind,p_expected_revision,reason,claim.stage,happened);
 update public.order_cancellation_requests set stage='withdrawn',withdrawn_at=happened,decided_at=happened,decided_by=actor,
  decision_note=null,held_from=null,hold_reason=null,held_at=null,updated_at=happened where id=p_claim_id;
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'order.claim_withdrawn','order:'||order_key,
  jsonb_build_object('claimId',p_claim_id,'claimType',claim.claim_type,'from',claim.stage,'to','withdrawn','actorKind',kind,'customerConfirmed',true));
 perform private.notify_order_claim(p_claim_id,'withdrawn','요청을 철회했어요',
  case when p_as_operator then '고객님과 확인한 요청 철회를 담당자가 기록했습니다. 주문과 결제는 유지되며 환불을 실행하지 않습니다.'
  else '요청을 철회했습니다. 주문과 결제는 유지되며 환불을 실행하지 않습니다.' end);
 return private.order_claim_withdrawal_receipt(p_operation_id,actor);
end $$;
revoke all on function private.apply_order_claim_withdrawal(uuid,uuid,integer,text,boolean,boolean) from public,anon,authenticated,service_role;

create function public.withdraw_my_order_claim(p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,p_reason text,p_confirmed boolean) returns jsonb
language sql volatile security definer set search_path='' as $$select private.apply_order_claim_withdrawal(p_claim_id,p_operation_id,p_expected_revision,p_reason,p_confirmed,false);$$;
create function public.admin_withdraw_order_claim(p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,p_reason text,p_confirmed boolean) returns jsonb
language sql volatile security definer set search_path='' as $$select private.apply_order_claim_withdrawal(p_claim_id,p_operation_id,p_expected_revision,p_reason,p_confirmed,true);$$;
revoke all on function public.withdraw_my_order_claim(uuid,uuid,integer,text,boolean),public.admin_withdraw_order_claim(uuid,uuid,integer,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.withdraw_my_order_claim(uuid,uuid,integer,text,boolean),public.admin_withdraw_order_claim(uuid,uuid,integer,text,boolean) to authenticated;

create function public.read_my_order_claim_withdrawal(p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();begin
 if actor is null or p_operation_id is null then raise insufficient_privilege using message='auth_required';end if;
 perform private.lock_operator_subjects(array[actor]);
 perform pg_advisory_xact_lock(hashtextextended('claim-withdrawal:'||p_operation_id::text,0));
 if not exists(select 1 from private.order_claim_withdrawals where id=p_operation_id and actor_id=actor and actor_kind='customer') then return null;end if;
 return private.order_claim_withdrawal_receipt(p_operation_id,actor);
end $$;
revoke all on function public.read_my_order_claim_withdrawal(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_my_order_claim_withdrawal(uuid) to authenticated;

create function public.admin_read_order_claim_withdrawal(p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();begin
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_claim_withdrawal';end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-withdrawal:'||p_operation_id::text,0));
 if not exists(select 1 from private.order_claim_withdrawals where id=p_operation_id and actor_id=actor and actor_kind='operator') then return null;end if;
 return private.order_claim_withdrawal_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_read_order_claim_withdrawal(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_order_claim_withdrawal(uuid) to authenticated;

create or replace function public.admin_order_claim_stage_counts_console(p_claim_type text default null,p_reason_type text default null,p_from date default null,p_to date default null,p_query text default null,p_field text default 'all',p_date_field text default 'requested')
returns table(stage text,total bigint) language plpgsql stable security definer set search_path='' as $$
declare needle text:=nullif(btrim(p_query),'');begin
 if not private.has_operator_capability(auth.uid(),'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if (p_claim_type is not null and p_claim_type not in('cancel','return','exchange')) or p_field is null or p_field not in('all','order','buyer','email')
  or p_date_field is null or p_date_field not in('requested','collected','completed') or p_from is not null and p_to is not null and p_from>p_to or char_length(needle)>100 then
  raise invalid_parameter_value using message='invalid_claim_search';end if;
  if p_reason_type is not null and p_reason_type not in('change_of_mind','defect','staff',
    'staff:out_of_stock','staff:customer_request','staff:test_payment_cleanup','staff:other') then
    raise check_violation using message='invalid claim reason filter';
  end if;
 return query select known.value,count(request.id)::bigint from unnest(array['requested','in_review','collecting','collected','on_hold','processing','needs_review','completed','rejected','withdrawn'])known(value)
 left join public.order_cancellation_requests request on request.stage=known.value and(p_claim_type is null or request.claim_type=p_claim_type)
  and private.admin_sales_claim_matches(request,p_reason_type,p_from,p_to,needle,p_field,p_date_field) group by known.value;
end $$;
create or replace function public.admin_order_claim_stage_counts(p_claim_type text default null) returns table(stage text,total bigint)
language sql stable security definer set search_path='' as $$select * from public.admin_order_claim_stage_counts_console(p_claim_type);$$;
revoke all on function public.admin_order_claim_stage_counts(text),public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_stage_counts(text),public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text) to authenticated;

select private.register_operator_rpc_contract('public.admin_order_claim_withdrawal_context(uuid)','sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_withdraw_order_claim(uuid,uuid,integer,text,boolean)','sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_read_order_claim_withdrawal(uuid)','sales.manage','read',false);
do $$declare signature text;begin foreach signature in array array[
 'private.preserve_claim_withdrawal()','private.order_claim_withdrawal_blocker(public.order_cancellation_requests)',
 'private.order_claim_withdrawal_receipt(uuid,uuid)','private.read_order_claim_withdrawal_context(uuid,uuid,boolean)',
 'private.apply_order_claim_withdrawal(uuid,uuid,integer,text,boolean,boolean)','public.get_my_order_claim_withdrawal_context(uuid)',
 'public.withdraw_my_order_claim(uuid,uuid,integer,text,boolean)','public.read_my_order_claim_withdrawal(uuid)'
]loop perform private.register_operator_internal_contract(signature::regprocedure);end loop;end $$;
notify pgrst,'reload schema';

-- Keep withdrawn requests out of the open/rejected statistics.

create or replace function public.admin_claims_report(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order_count bigint;
  v_result jsonb;
begin
  if not public.has_operator_capability('stats.read',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise invalid_parameter_value using message = 'invalid_report_range';
  end if;

  select count(*)
  into v_order_count
  from public.orders
  where orders.status = any (private.revenue_order_statuses())
    and orders.created_at >= p_from
    and orders.created_at < p_to;

  with scoped as (
    select
      request.id,
      request.claim_type,
      request.reason_type,
      request.staff_reason_code,
      request.stage,
      request.requested_at,
      request.completed_at
    from public.order_cancellation_requests as request
    where request.requested_at >= p_from
      and request.requested_at < p_to
  ),
  by_type as (
    select
      scoped.claim_type,
      count(*) as total,
      count(*) filter (where scoped.stage = 'completed') as completed,
      count(*) filter (where scoped.stage = 'rejected') as rejected,
      count(*) filter (where scoped.stage = 'withdrawn') as withdrawn,
      count(*) filter (where scoped.stage not in ('completed', 'rejected', 'withdrawn')) as open_count
    from scoped
    group by scoped.claim_type
  ),
  -- 운영자 전액 취소는 운영 사유별로 나눈다. 구매자 사유 행의 staff_reason_code는
  -- 항상 null이라 기존 묶음은 그대로다.
  by_reason as (
    select
      scoped.claim_type,
      scoped.reason_type,
      scoped.staff_reason_code,
      count(*) as total
    from scoped
    group by scoped.claim_type, scoped.reason_type, scoped.staff_reason_code
  ),
  -- 환급 소요시간은 접수(requested_at)부터 환불 완료(completed_at)까지다.
  -- 배송·반품 정책이 약속한 "반환받은 날부터 3영업일"과 기산점이 다르므로
  -- 화면에서 SLA 준수율이라고 부르지 않고 접수→완료 소요로 적는다.
  refund_speed as (
    select
      count(*) as completed_count,
      avg(extract(epoch from (refund.completed_at - scoped.requested_at)) / 3600.0) as avg_hours,
      count(*) filter (
        where refund.completed_at - scoped.requested_at <= interval '72 hours'
      ) as within_72h
    from public.refunds as refund
    join scoped on scoped.id = refund.cancellation_request_id
    -- refunds.status는 'requested|done|failed'다. 'completed'는 클레임 stage의
    -- 값이라 여기서 쓰면 항상 0건이 된다.
    where refund.status = 'done'
      and refund.completed_at is not null
  )
  select jsonb_build_object(
    'orderCount', v_order_count,
    'claimCount', coalesce((select sum(by_type.total) from by_type), 0),
    'byType', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'claimType', by_type.claim_type,
          'total', by_type.total,
          'completed', by_type.completed,
          'rejected', by_type.rejected,
          'withdrawn', by_type.withdrawn,
          'open', by_type.open_count,
          -- 분모가 0이면 비율이 아니라 null이다. 0%로 적으면 "클레임이 없다"로
          -- 읽히지만 실제로는 "판매가 없었다"이다.
          'ratePerMille', case
            when v_order_count = 0 then null
            else round((by_type.total::numeric / v_order_count) * 1000, 1)
          end
        )
        order by by_type.total desc, by_type.claim_type
      )
      from by_type
    ), '[]'::jsonb),
    'byReason', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'claimType', by_reason.claim_type,
          'reasonType', by_reason.reason_type,
          'staffReasonCode', by_reason.staff_reason_code,
          'total', by_reason.total
        )
        order by by_reason.claim_type, by_reason.total desc, by_reason.reason_type,
          by_reason.staff_reason_code nulls first
      )
      from by_reason
    ), '[]'::jsonb),
    'refunds', (
      select jsonb_build_object(
        'completedCount', refund_speed.completed_count,
        'averageHours', case
          when refund_speed.avg_hours is null then null
          else round(refund_speed.avg_hours::numeric, 1)
        end,
        'within72h', refund_speed.within_72h
      )
      from refund_speed
    )
  )
  into v_result;

  return v_result;
end;
$function$;
revoke all on function public.admin_claims_report(timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_claims_report(timestamptz,timestamptz) to authenticated;
select private.register_operator_rpc_contract('public.admin_order_claim_stage_counts(text)','sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text)','sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_claims_report(timestamptz,timestamptz)','stats.read','read',false);
select private.register_operator_internal_contract('private.order_claim_status_for_stage(text)'::regprocedure);
select private.register_operator_internal_contract('private.seal_order_claim_refund_account()'::regprocedure);
