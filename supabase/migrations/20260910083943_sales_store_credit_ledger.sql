-- #488: KRW order discount credits, independent from coins/card rewards.
-- Business values intentionally start NULL. No policy is enabled by this migration.
create table private.store_credit_policy (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  earn_kind text check(earn_kind in ('rate_bps','fixed')),
  earn_value bigint check(earn_value between 0 and 999999999999),
  earn_max_per_order bigint check(earn_max_per_order between 0 and 999999999999),
  max_balance bigint check(max_balance between 0 and 999999999999),
  validity_days integer check(validity_days between 1 and 36500),
  min_use bigint check(min_use between 0 and 999999999999),
  max_use bigint check(max_use between 0 and 999999999999),
  restore_grace_days integer check(restore_grace_days between 0 and 36500),
  refund_earned_credit_mode text check(refund_earned_credit_mode='offset_future_credits'),
  evidence text not null default '' check(length(evidence)<=2000),
  version integer not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  check(min_use is null or max_use is null or min_use<=max_use),
  check(earn_kind is distinct from 'rate_bps' or earn_value<=10000),
  check(not enabled or (
    earn_kind is not null and earn_value is not null
    and earn_max_per_order is not null and max_balance is not null
    and validity_days is not null and min_use is not null and max_use is not null
    and restore_grace_days is not null and refund_earned_credit_mode is not null
    and length(btrim(evidence))>0
  ))
);
insert into private.store_credit_policy(singleton) values(true);

-- Private history uses stable UUID attribution, without auth/profile/order cascade
-- FKs. Trusted RPCs validate targets before writing. Account deletion cannot erase
-- financial history, and locking an account never takes a source order FK lock.
create table private.store_credit_accounts (
  user_id uuid primary key,
  created_at timestamptz not null default clock_timestamp()
);
create table private.store_credit_lots (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  root_lot_id uuid not null,
  source_order_id uuid,
  source_kind text not null check(source_kind in ('order_done','admin','restoration')),
  issued_amount bigint not null check(issued_amount>0),
  available_amount bigint not null default 0 check(available_amount>=0),
  reserved_amount bigint not null default 0 check(reserved_amount>=0),
  spent_amount bigint not null default 0 check(spent_amount>=0),
  expired_amount bigint not null default 0 check(expired_amount>=0),
  revoked_amount bigint not null default 0 check(revoked_amount>=0),
  offset_amount bigint not null default 0 check(offset_amount>=0),
  transferred_amount bigint not null default 0 check(transferred_amount>=0),
  debt_amount bigint not null default 0 check(debt_amount>=0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check(issued_amount=available_amount+reserved_amount+spent_amount+expired_amount+revoked_amount+offset_amount+transferred_amount)
);
create index store_credit_lots_user_expiry on private.store_credit_lots(user_id,expires_at,id);
create index store_credit_lots_root on private.store_credit_lots(root_lot_id);
create unique index store_credit_order_earning_once on private.store_credit_lots(source_order_id) where source_kind='order_done';
create table private.store_credit_operations (
  operation_id uuid primary key,
  actor_id uuid not null,
  kind text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create table public.store_credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null check(kind in ('grant','adjustment_credit','adjustment_debit','expire','reserve','consume','restore','earned_reversal','debt_offset','restoration_expired')),
  amount bigint not null,
  available_delta bigint not null default 0,
  reserved_delta bigint not null default 0,
  debt_delta bigint not null default 0,
  order_id uuid,
  lot_id uuid,
  actor_id uuid,
  operation_id uuid,
  reason text not null default '' check(length(reason)<=1000),
  expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index store_credit_ledger_user_history on public.store_credit_ledger(user_id,created_at desc,id desc);
alter table private.store_credit_policy enable row level security;
alter table private.store_credit_accounts enable row level security;
alter table private.store_credit_lots enable row level security;
alter table private.store_credit_operations enable row level security;
alter table public.store_credit_ledger enable row level security;
revoke all on private.store_credit_policy,private.store_credit_accounts,private.store_credit_lots,private.store_credit_operations,public.store_credit_ledger from public,anon,authenticated,service_role;
revoke all on sequence public.store_credit_ledger_id_seq from public,anon,authenticated,service_role;
grant select on public.store_credit_ledger to authenticated;
create policy store_credit_ledger_owner_read on public.store_credit_ledger for select to authenticated using(user_id=(select auth.uid()));

create function private.assert_store_credit_admin() returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());
begin
  perform 1 from public.profiles where id=actor and role='admin' and suspended_at is null for share;
  if not found or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='admin_required'; end if;
  return actor;
end $$;
revoke all on function private.assert_store_credit_admin() from public,anon,authenticated,service_role;

create function private.lock_store_credit_account(p_user_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if p_user_id is null then raise invalid_parameter_value using message='store_credit_user_required'; end if;
  insert into private.store_credit_accounts(user_id) values(p_user_id) on conflict do nothing;
  perform 1 from private.store_credit_accounts where user_id=p_user_id for update;
end $$;
revoke all on function private.lock_store_credit_account(uuid) from public,anon,authenticated,service_role;

create function private.expire_store_credit_lots(p_user_id uuid,p_at timestamptz) returns void
language plpgsql volatile security definer set search_path='' as $$
declare lot private.store_credit_lots;
begin
  perform private.lock_store_credit_account(p_user_id);
  for lot in select * from private.store_credit_lots where user_id=p_user_id and available_amount>0 and expires_at<=p_at order by expires_at,id for update loop
    update private.store_credit_lots set available_amount=0,expired_amount=expired_amount+lot.available_amount where id=lot.id;
    insert into public.store_credit_ledger(user_id,kind,amount,available_delta,lot_id,expires_at)
      values(p_user_id,'expire',-lot.available_amount,-lot.available_amount,lot.id,lot.expires_at);
  end loop;
end $$;
revoke all on function private.expire_store_credit_lots(uuid,timestamptz) from public,anon,authenticated,service_role;

create function private.store_credit_balance(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('available',coalesce(sum(available_amount),0),'reserved',coalesce(sum(reserved_amount),0),'debt',coalesce(sum(debt_amount),0))
    from private.store_credit_lots where user_id=p_user_id;
$$;
revoke all on function private.store_credit_balance(uuid) from public,anon,authenticated,service_role;

-- New grants first discharge reversed, already-used earnings. No cash charge or
-- reduction of provider refund amounts is ever created by this ledger.
create function private.issue_store_credit_lot(
  p_user_id uuid,p_amount bigint,p_expires_at timestamptz,p_source text,p_order_id uuid,
  p_actor uuid,p_operation uuid,p_reason text,p_root uuid default null
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare new_id uuid:=extensions.gen_random_uuid(); outstanding bigint:=p_amount; take bigint; debt_lot private.store_credit_lots;
begin
  perform private.lock_store_credit_account(p_user_id);
  if p_amount<=0 or p_expires_at is null then raise invalid_parameter_value using message='invalid_store_credit_grant'; end if;
  if p_root is not null and not exists(select 1 from private.store_credit_lots where id=p_root and root_lot_id=id and user_id=p_user_id and revoked_at is null)
    then raise check_violation using message='store_credit_source_mismatch'; end if;
  insert into private.store_credit_lots(id,user_id,root_lot_id,source_order_id,source_kind,issued_amount,available_amount,expires_at)
    values(new_id,p_user_id,coalesce(p_root,new_id),p_order_id,p_source,p_amount,p_amount,p_expires_at);
  insert into public.store_credit_ledger(user_id,kind,amount,available_delta,order_id,lot_id,actor_id,operation_id,reason,expires_at)
    values(p_user_id,case p_source when 'admin' then 'adjustment_credit' when 'restoration' then 'restore' else 'grant' end,p_amount,p_amount,p_order_id,new_id,p_actor,p_operation,p_reason,p_expires_at);
  for debt_lot in select * from private.store_credit_lots where user_id=p_user_id and debt_amount>0 order by created_at,id for update loop
    take:=least(outstanding,debt_lot.debt_amount);
    update private.store_credit_lots set debt_amount=debt_amount-take where id=debt_lot.id;
    update private.store_credit_lots set available_amount=available_amount-take,offset_amount=offset_amount+take where id=new_id;
    insert into public.store_credit_ledger(user_id,kind,amount,available_delta,debt_delta,order_id,lot_id,actor_id,operation_id)
      values(p_user_id,'debt_offset',-take,-take,-take,p_order_id,debt_lot.id,p_actor,p_operation);
    outstanding:=outstanding-take;
    exit when outstanding=0;
  end loop;
  return new_id;
end $$;
revoke all on function private.issue_store_credit_lot(uuid,bigint,timestamptz,text,uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

create function private.store_credit_policy_json() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'earnKind',earn_kind,'earnValue',earn_value,
   'earnMaxPerOrder',earn_max_per_order,'maxBalance',max_balance,'validityDays',validity_days,
   'minUse',min_use,'maxUse',max_use,'restoreGraceDays',restore_grace_days,
   'refundEarnedCreditMode',refund_earned_credit_mode,'evidence',evidence,'version',version,'updatedAt',updated_at)
 from private.store_credit_policy where singleton;
$$;
revoke all on function private.store_credit_policy_json() from public,anon,authenticated,service_role;

create function public.admin_get_store_credit_policy() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin perform private.assert_store_credit_admin(); return private.store_credit_policy_json(); end $$;
revoke all on function public.admin_get_store_credit_policy() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_store_credit_policy() to authenticated;

create function public.admin_save_store_credit_policy(p_operation_id uuid,p_expected_version integer,p_policy jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; previous private.store_credit_policy; operation private.store_credit_operations; saved jsonb;
begin
  actor:=private.assert_store_credit_admin();
  if p_operation_id is null or jsonb_typeof(p_policy) is distinct from 'object' or p_expected_version is null
    or exists(select 1 from jsonb_object_keys(p_policy) k where k not in ('enabled','earnKind','earnValue','earnMaxPerOrder','maxBalance','validityDays','minUse','maxUse','restoreGraceDays','refundEarnedCreditMode','evidence'))
    or jsonb_typeof(p_policy->'enabled') is distinct from 'boolean'
    or jsonb_typeof(p_policy->'evidence') is distinct from 'string'
    or exists(select 1 from jsonb_each(p_policy) where key in ('earnValue','earnMaxPerOrder','maxBalance','validityDays','minUse','maxUse','restoreGraceDays') and (jsonb_typeof(value) not in ('number','null') or (jsonb_typeof(value)='number' and value::text !~ '^[0-9]+$')))
    then raise invalid_parameter_value using message='invalid_store_credit_policy'; end if;
  perform pg_advisory_xact_lock(hashtextextended('store_credit_operation:'||p_operation_id::text,0));
  select * into operation from private.store_credit_operations where operation_id=p_operation_id;
  if found then
    if operation.actor_id<>actor or operation.kind<>'policy' or operation.payload is distinct from jsonb_build_object('expectedVersion',p_expected_version,'policy',p_policy) then raise exception using errcode='PT409',message='store_credit_operation_conflict'; end if;
    return operation.result;
  end if;
  select * into previous from private.store_credit_policy where singleton for update;
  if previous.version<>p_expected_version then raise exception using errcode='PT409',message='store_credit_policy_conflict'; end if;
  update private.store_credit_policy set enabled=(p_policy->>'enabled')::boolean,
    earn_kind=p_policy->>'earnKind',earn_value=(p_policy->>'earnValue')::bigint,
    earn_max_per_order=(p_policy->>'earnMaxPerOrder')::bigint,max_balance=(p_policy->>'maxBalance')::bigint,
    validity_days=(p_policy->>'validityDays')::integer,min_use=(p_policy->>'minUse')::bigint,
    max_use=(p_policy->>'maxUse')::bigint,restore_grace_days=(p_policy->>'restoreGraceDays')::integer,
    refund_earned_credit_mode=p_policy->>'refundEarnedCreditMode',evidence=btrim(p_policy->>'evidence'),
    version=previous.version+1,updated_at=clock_timestamp() where singleton;
  saved:=private.store_credit_policy_json();
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.store_credit.policy_saved','store_credit_policy',jsonb_build_object('before',to_jsonb(previous),'after',saved,'operationId',p_operation_id));
  insert into private.store_credit_operations(operation_id,actor_id,kind,payload,result)
    values(p_operation_id,actor,'policy',jsonb_build_object('expectedVersion',p_expected_version,'policy',p_policy),saved);
  return saved;
end $$;
revoke all on function public.admin_save_store_credit_policy(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_store_credit_policy(uuid,integer,jsonb) to authenticated;

create function public.admin_adjust_store_credit(p_operation_id uuid,p_user_id uuid,p_amount bigint,p_expires_at timestamptz,p_reason text,p_expected_available bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; policy private.store_credit_policy; operation private.store_credit_operations; payload jsonb; before_balance jsonb; after_balance jsonb; outstanding bigint; take bigint; lot private.store_credit_lots;
begin
  actor:=private.assert_store_credit_admin();
  if p_operation_id is null or p_user_id is null or p_amount is null or p_amount=0 or abs(p_amount::numeric)>999999999999
    or p_expected_available is null or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
    or not exists(select 1 from public.profiles where id=p_user_id) then raise invalid_parameter_value using message='invalid_store_credit_adjustment'; end if;
  payload:=jsonb_build_object('userId',p_user_id,'amount',p_amount,'expiresAt',p_expires_at,'reason',btrim(p_reason),'expectedAvailable',p_expected_available);
  perform pg_advisory_xact_lock(hashtextextended('store_credit_operation:'||p_operation_id::text,0));
  select * into operation from private.store_credit_operations where operation_id=p_operation_id;
  if found then
    if operation.actor_id<>actor or operation.kind<>'adjustment' or operation.payload is distinct from payload then raise exception using errcode='PT409',message='store_credit_operation_conflict'; end if;
    return operation.result;
  end if;
  perform private.assert_active_user(p_user_id);
  if private.is_account_write_fenced(p_user_id) then raise insufficient_privilege using message='account_deletion_in_progress'; end if;
  select * into policy from private.store_credit_policy where singleton for share;
  if not policy.enabled then raise check_violation using message='store_credit_disabled'; end if;
  perform private.expire_store_credit_lots(p_user_id,clock_timestamp());
  before_balance:=private.store_credit_balance(p_user_id);
  if (before_balance->>'available')::bigint<>p_expected_available then raise exception using errcode='PT409',message='store_credit_balance_conflict'; end if;
  if p_amount>0 then
    if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+make_interval(days=>policy.validity_days)
      then raise check_violation using message='store_credit_expiry_invalid'; end if;
    if p_amount>(before_balance->>'debt')::bigint and (before_balance->>'available')::bigint+(before_balance->>'reserved')::bigint+p_amount-(before_balance->>'debt')::bigint>policy.max_balance
      then raise check_violation using message='store_credit_balance_limit'; end if;
    perform private.issue_store_credit_lot(p_user_id,p_amount,p_expires_at,'admin',null,actor,p_operation_id,btrim(p_reason));
  else
    if p_expires_at is not null then raise invalid_parameter_value using message='store_credit_debit_expiry'; end if;
    outstanding:=-p_amount;
    if (before_balance->>'available')::bigint<outstanding then raise check_violation using message='store_credit_insufficient'; end if;
    for lot in select * from private.store_credit_lots where user_id=p_user_id and available_amount>0 order by expires_at,id for update loop
      take:=least(outstanding,lot.available_amount);
      update private.store_credit_lots set available_amount=available_amount-take,revoked_amount=revoked_amount+take where id=lot.id;
      insert into public.store_credit_ledger(user_id,kind,amount,available_delta,lot_id,actor_id,operation_id,reason)
        values(p_user_id,'adjustment_debit',-take,-take,lot.id,actor,p_operation_id,btrim(p_reason));
      outstanding:=outstanding-take; exit when outstanding=0;
    end loop;
  end if;
  after_balance:=private.store_credit_balance(p_user_id);
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.store_credit.adjusted','store_credit:'||p_user_id::text,
    jsonb_build_object('before',before_balance,'after',after_balance,'request',payload,'operationId',p_operation_id));
  insert into private.store_credit_operations(operation_id,actor_id,kind,payload,result) values(p_operation_id,actor,'adjustment',payload,after_balance);
  return after_balance;
end $$;
revoke all on function public.admin_adjust_store_credit(uuid,uuid,bigint,timestamptz,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_adjust_store_credit(uuid,uuid,bigint,timestamptz,text,bigint) to authenticated;

create function private.store_credit_history(p_user_id uuid,p_page integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare balance jsonb; rows jsonb; row_count bigint; page_number integer:=greatest(1,coalesce(p_page,1));
begin
  if page_number>1000000 then raise invalid_parameter_value using message='store_credit_page_invalid'; end if;
  perform private.expire_store_credit_lots(p_user_id,clock_timestamp());
  balance:=private.store_credit_balance(p_user_id);
  select count(*) into row_count from public.store_credit_ledger where user_id=p_user_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id::text,'kind',kind,'amount',amount,'availableDelta',available_delta,'reservedDelta',reserved_delta,'debtDelta',debt_delta,
    'orderId',order_id,'lotId',lot_id,'actorId',actor_id,'reason',reason,'expiresAt',expires_at,'createdAt',created_at) order by created_at desc,id desc),'[]') into rows
  from (select * from public.store_credit_ledger where user_id=p_user_id order by created_at desc,id desc limit 30 offset (page_number-1)*30) page;
  return balance||jsonb_build_object('userId',p_user_id,'enabled',(select enabled from private.store_credit_policy where singleton),'total',row_count,'page',page_number,'pageSize',30,'items',rows);
end $$;
revoke all on function private.store_credit_history(uuid,integer) from public,anon,authenticated,service_role;

create function public.get_my_store_credit_history(p_page integer default 1) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());
begin
  if actor is null then raise insufficient_privilege using message='auth_required'; end if;
  return private.store_credit_history(actor,p_page);
end $$;
revoke all on function public.get_my_store_credit_history(integer) from public,anon,authenticated,service_role;
grant execute on function public.get_my_store_credit_history(integer) to authenticated;

create function public.admin_get_store_credit_history(p_user_id uuid,p_page integer default 1) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform private.assert_store_credit_admin();
  if not exists(select 1 from public.profiles where id=p_user_id) then raise no_data_found using message='customer_not_found'; end if;
  return private.store_credit_history(p_user_id,p_page);
end $$;
revoke all on function public.admin_get_store_credit_history(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_store_credit_history(uuid,integer) to authenticated;

-- Expiry sweeps lock accounts in UUID order, never lock an order or source FK.
create function public.expire_store_credits(p_batch_size integer default 500) returns integer
language plpgsql volatile security definer set search_path='' as $$
declare account record; handled integer:=0;
begin
  for account in select a.user_id from private.store_credit_accounts a
    where exists(select 1 from private.store_credit_lots l where l.user_id=a.user_id and l.available_amount>0 and l.expires_at<=clock_timestamp())
    order by a.user_id limit greatest(1,least(coalesce(p_batch_size,500),5000)) for update of a skip locked loop
    perform private.expire_store_credit_lots(account.user_id,clock_timestamp()); handled:=handled+1;
  end loop;
  return handled;
end $$;
revoke all on function public.expire_store_credits(integer) from public,anon,authenticated,service_role;
grant execute on function public.expire_store_credits(integer) to service_role;
grant execute on function public.expire_store_credits(integer) to postgres;
select cron.schedule('expire-store-credits','* * * * *','select public.expire_store_credits()');

-- Existing order functions can be postgres-owned after a hosted restore. Do not
-- grant these private helpers or tables to authenticated/service_role.
grant usage on schema private to postgres;
grant all on private.store_credit_policy,private.store_credit_accounts,private.store_credit_lots,private.store_credit_operations,public.store_credit_ledger to postgres;
grant usage,select on sequence public.store_credit_ledger_id_seq to postgres;
grant execute on function private.assert_store_credit_admin(),private.lock_store_credit_account(uuid),private.expire_store_credit_lots(uuid,timestamptz),private.store_credit_balance(uuid),private.issue_store_credit_lot(uuid,bigint,timestamptz,text,uuid,uuid,uuid,text,uuid),private.store_credit_policy_json(),private.store_credit_history(uuid,integer) to postgres;
