-- Type conversion preserves the original request, collection evidence and SLA.
create table private.order_claim_type_changes (
 id uuid primary key, claim_id uuid not null references public.order_cancellation_requests(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade, actor_id uuid not null,
 expected_revision integer not null check(expected_revision>=0),
 from_type text not null check(from_type in('return','exchange')),
 to_type text not null check(to_type in('return','exchange') and to_type<>from_type),
 agreement text not null check(char_length(agreement) between 2 and 500),
 refund_account_digest text check(refund_account_digest~'^[0-9a-f]{64}$'),
 from_stage text not null, created_at timestamptz not null default clock_timestamp()
);
create index order_claim_type_changes_claim_idx on private.order_claim_type_changes(claim_id,created_at,id);
alter table private.order_claim_type_changes enable row level security;
revoke all on private.order_claim_type_changes from public,anon,authenticated,service_role;

create function private.order_claim_type_change_blocker(p_claim public.order_cancellation_requests) returns text
language sql stable security definer set search_path='' as $$
 select case
 when p_claim.claim_type not in('return','exchange') then 'claim_conversion_type_unavailable'
 when (case when p_claim.stage='on_hold' then coalesce(p_claim.held_from,'requested') else p_claim.stage end)
  not in('requested','in_review','collecting','collected') then 'claim_conversion_stage_unavailable'
 when p_claim.reshipped_at is not null or p_claim.reship_tracking_number is not null
  or exists(select 1 from public.order_claim_reshipment_items where claim_id=p_claim.id) then 'claim_conversion_reshipped'
 when exists(select 1 from public.order_cancellation_claims where order_id=p_claim.order_id)
  or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.purpose='order' and p.ref_id=p_claim.order_id)
  or exists(select 1 from public.orders where id=p_claim.order_id and status='canceled') then 'claim_conversion_finance_started'
 else null end;
$$;
revoke all on function private.order_claim_type_change_blocker(public.order_cancellation_requests) from public,anon,authenticated,service_role;

create function private.order_claim_type_change_receipt(p_operation_id uuid,p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'claimId',claim_id,'orderId',order_id,'revision',expected_revision,
  'fromType',from_type,'toType',to_type,'agreement',agreement,'createdAt',created_at,'stage',from_stage,
  'accountSupplied',refund_account_digest is not null)
 from private.order_claim_type_changes where id=p_operation_id and actor_id=p_actor;
$$;
revoke all on function private.order_claim_type_change_receipt(uuid,uuid) from public,anon,authenticated,service_role;

create function public.admin_order_claim_type_change_context(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare claim public.order_cancellation_requests;purchase public.orders;blocker text;account private.claim_refund_accounts;
begin
 if not private.has_operator_capability(auth.uid(),'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 select * into purchase from public.orders where id=claim.order_id;
 select * into account from private.claim_refund_accounts where claim_id=claim.id and purged_at is null
  and bank_name is not null and account_number is not null and account_holder is not null;
 blocker:=private.order_claim_type_change_blocker(claim);
 return jsonb_build_object('claimId',claim.id,'orderId',claim.order_id,'claimType',claim.claim_type,'stage',claim.stage,
  'revision',claim.claim_revision,'allowed',blocker is null,'blocker',blocker,
  'bankRequired',purchase.payment_method='bank_transfer' and purchase.total>0,
  'savedAccount',case when account.claim_id is not null then jsonb_build_object('account',account.masked_account,'holder',account.masked_holder) else null end,
  'history',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'claimId',claim_id,'fromType',from_type,'toType',to_type,
    'agreement',agreement,'createdAt',created_at) order by created_at,id),'[]'::jsonb) from private.order_claim_type_changes where claim_id=claim.id));
end $$;
revoke all on function public.admin_order_claim_type_change_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_type_change_context(uuid) to authenticated;

create function public.admin_convert_order_claim_type(p_claim_id uuid,p_operation_id uuid,p_expected_revision integer,
 p_to_type text,p_agreement text,p_confirmed boolean,p_refund_account jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();claim public.order_cancellation_requests;purchase public.orders;previous private.order_claim_type_changes;
 order_key uuid;buyer uuid;agreement text:=btrim(p_agreement);blocker text;account_digest text;field text;happened timestamptz;
begin
 if not private.has_operator_capability(actor,'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_claim_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or p_to_type is null or p_to_type not in('return','exchange') or p_confirmed is distinct from true
  or agreement is null or char_length(agreement) not between 2 and 500 or agreement~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_claim_conversion';end if;
 if p_refund_account is not null and p_refund_account<>'null'::jsonb then
  if p_to_type<>'return' or jsonb_typeof(p_refund_account) is distinct from 'object'
   or not(p_refund_account?&array['bankName','accountNumber','accountHolder'])
   or exists(select 1 from jsonb_object_keys(p_refund_account)k where k not in('bankName','accountNumber','accountHolder'))
   or exists(select 1 from jsonb_each(p_refund_account)x where jsonb_typeof(x.value)<>'string')
   or coalesce(p_refund_account->>'accountNumber','')!~'^[0-9-]{8,30}$' then raise invalid_parameter_value using message='invalid_claim_conversion_account';end if;
  foreach field in array array['bankName','accountHolder'] loop
   if p_refund_account->>field<>btrim(p_refund_account->>field) or char_length(p_refund_account->>field) not between 1 and 40
    or p_refund_account->>field~'[[:cntrl:]]' then raise invalid_parameter_value using message='invalid_claim_conversion_account';end if;
  end loop;
  account_digest:=encode(extensions.digest(p_refund_account::text,'sha256'),'hex');
 end if;
 select c.order_id,o.user_id into order_key,buyer from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where c.id=p_claim_id;
 if order_key is null then raise no_data_found using message='claim_not_found';end if;
 perform private.lock_operator_subjects(array[actor,buyer]);
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 perform pg_advisory_xact_lock(hashtextextended('claim-type-change:'||p_operation_id::text,0));
 select * into previous from private.order_claim_type_changes where id=p_operation_id;
 if found then
  if previous.actor_id<>actor or previous.claim_id<>p_claim_id or previous.expected_revision<>p_expected_revision
   or previous.to_type<>p_to_type or previous.agreement<>agreement or previous.refund_account_digest is distinct from account_digest then
   raise unique_violation using message='claim_conversion_request_conflict';end if;
  return private.order_claim_type_change_receipt(p_operation_id,actor);
 end if;
 select * into purchase from public.orders where id=order_key for update;
 perform id from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 perform shipment_id from public.order_claim_collections where claim_id=p_claim_id order by shipment_id for update;
 if claim.claim_revision<>p_expected_revision then raise sqlstate 'PT409' using message='claim_changed';end if;
 blocker:=private.order_claim_type_change_blocker(claim);
 if blocker is not null then raise check_violation using message=blocker;end if;
 if claim.claim_type=p_to_type then raise check_violation using message='claim_conversion_same_type';end if;
 -- Account purging takes only this row lock. Re-check after waiting for it, so
 -- a concurrent purge cannot turn a successful conversion into a missing account.
 perform claim_id from private.claim_refund_accounts where claim_id=p_claim_id for update;
 if p_to_type='return' and purchase.payment_method='bank_transfer' and purchase.total>0 and account_digest is null
  and not exists(select 1 from private.claim_refund_accounts where claim_id=p_claim_id and purged_at is null
   and bank_name is not null and account_number is not null and account_holder is not null) then
  raise check_violation using message='claim_conversion_account_required';end if;
 happened:=clock_timestamp();
 if account_digest is not null then
  insert into private.claim_refund_accounts(claim_id,bank_name,account_number,account_holder,masked_account,masked_holder)
  values(p_claim_id,p_refund_account->>'bankName',p_refund_account->>'accountNumber',p_refund_account->>'accountHolder',
   (p_refund_account->>'bankName')||' '||public.mask_refund_account_number(p_refund_account->>'accountNumber'),public.mask_refund_account_holder(p_refund_account->>'accountHolder'))
  on conflict(claim_id) do update set bank_name=excluded.bank_name,account_number=excluded.account_number,account_holder=excluded.account_holder,
   masked_account=excluded.masked_account,masked_holder=excluded.masked_holder,created_at=happened,purge_after=null,purged_at=null;
 elsif p_to_type='return' then
  update private.claim_refund_accounts set purge_after=null where claim_id=p_claim_id and purged_at is null;
 end if;
 if p_to_type='exchange' then
  update private.claim_refund_accounts set purge_after=coalesce(purge_after,happened+interval '30 days') where claim_id=p_claim_id and purged_at is null;
 end if;
 insert into private.order_claim_type_changes(id,claim_id,order_id,actor_id,expected_revision,from_type,to_type,agreement,refund_account_digest,from_stage,created_at)
 values(p_operation_id,p_claim_id,order_key,actor,p_expected_revision,claim.claim_type,p_to_type,agreement,account_digest,claim.stage,happened);
 update public.order_cancellation_requests set claim_type=p_to_type,updated_at=happened where id=p_claim_id;
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.order.claim_type_changed','order:'||order_key,
  jsonb_build_object('claimId',p_claim_id,'fromType',claim.claim_type,'toType',p_to_type,'customerConfirmed',true,'accountSupplied',account_digest is not null));
 perform private.notify_order_claim(p_claim_id,'type_changed','반품·교환 요청이 변경됐어요',
  case when p_to_type='exchange' then '고객님과 확인한 반품 요청을 교환으로 변경했습니다. 기존 접수와 수거 이력은 유지됩니다.'
  else '고객님과 확인한 교환 요청을 반품으로 변경했습니다. 환불은 이후 승인·회수 확인 절차에 따라 별도로 처리됩니다.' end);
 return private.order_claim_type_change_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_convert_order_claim_type(uuid,uuid,integer,text,text,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_convert_order_claim_type(uuid,uuid,integer,text,text,boolean,jsonb) to authenticated;

create function public.admin_read_order_claim_type_change(p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();begin
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_claim_conversion';end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-type-change:'||p_operation_id::text,0));
 return private.order_claim_type_change_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_read_order_claim_type_change(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_order_claim_type_change(uuid) to authenticated;

create function public.get_my_order_claim_type_changes(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise insufficient_privilege using message='auth_required';end if;
 if not exists(select 1 from public.orders where id=p_order_id and user_id=auth.uid()) then raise no_data_found using message='order_not_found';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',id,'claimId',claim_id,'fromType',from_type,'toType',to_type,'createdAt',created_at)
  order by created_at,id),'[]'::jsonb) from private.order_claim_type_changes where order_id=p_order_id);
end $$;
revoke all on function public.get_my_order_claim_type_changes(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_order_claim_type_changes(uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_order_claim_type_change_context(uuid)','sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_convert_order_claim_type(uuid,uuid,integer,text,text,boolean,jsonb)','sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_read_order_claim_type_change(uuid)','sales.manage','read',false);
select private.register_operator_internal_contract('private.order_claim_type_change_blocker(public.order_cancellation_requests)'::regprocedure);
select private.register_operator_internal_contract('private.order_claim_type_change_receipt(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('public.get_my_order_claim_type_changes(uuid)'::regprocedure);
notify pgrst,'reload schema';
