-- Reviewed PG statement accounts, separate from payment/refund write routing.
alter table private.pg_settlement_imports
 add column integration text not null default 'toss_payment' check(integration in('toss_payment','toss_billing')),
 add column billing_profile_id uuid references private.billing_profiles(id),
 add constraint pg_settlement_import_account check((integration='toss_payment' and billing_profile_id is null) or (integration='toss_billing' and billing_profile_id is not null));
create index pg_settlement_account_query on private.pg_settlement_imports(integration,billing_profile_id,mid,mode,date_type,start_date,end_date,completed_at desc) where state='complete';

-- The browser sees only random account IDs and safe labels. MID and billing
-- profile identity remain behind service-only functions.
create table private.pg_settlement_accounts (
 id uuid primary key default gen_random_uuid(),integration text not null check(integration in('toss_payment','toss_billing')),
 billing_profile_id uuid references private.billing_profiles(id),mid text not null check(mid~'^[!-~]{1,14}$'),mode text not null check(mode in('test','live')),
 check((integration='toss_payment' and billing_profile_id is null) or (integration='toss_billing' and billing_profile_id is not null)),
 unique nulls not distinct(integration,billing_profile_id,mid,mode)
);
alter table private.pg_settlement_accounts enable row level security;
revoke all on private.pg_settlement_accounts from public,anon,authenticated,service_role;
create trigger immutable_pg_settlement_account before update or delete on private.pg_settlement_accounts
 for each row execute function private.guard_goods_transaction_version();
insert into private.pg_settlement_accounts(integration,billing_profile_id,mid,mode)
 select distinct integration,billing_profile_id,mid,mode from private.pg_settlement_imports on conflict do nothing;
insert into private.pg_settlement_accounts(integration,billing_profile_id,mid,mode)
 select 'toss_billing',id,merchant_id,environment from private.billing_profiles on conflict do nothing;
create function private.register_pg_settlement_account() returns trigger
language plpgsql volatile security definer set search_path='' as $$begin
 if tg_table_name='billing_profiles' then
  insert into private.pg_settlement_accounts(integration,billing_profile_id,mid,mode) values('toss_billing',new.id,new.merchant_id,new.environment) on conflict do nothing;
 else
  insert into private.pg_settlement_accounts(integration,billing_profile_id,mid,mode) values(new.integration,new.billing_profile_id,new.mid,new.mode) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function private.register_pg_settlement_account() from public,anon,authenticated,service_role;
grant execute on function private.register_pg_settlement_account() to postgres;
create trigger billing_profile_statement_account after insert on private.billing_profiles for each row execute function private.register_pg_settlement_account();
create trigger pg_import_statement_account after insert on private.pg_settlement_imports for each row execute function private.register_pg_settlement_account();
select private.register_operator_internal_contract('private.register_pg_settlement_account()'::regprocedure);

create function public.admin_list_pg_settlement_accounts() returns jsonb
language plpgsql volatile security definer set search_path='' as $$begin
 perform private.pg_settlement_require_actor(auth.uid());
 return(select coalesce(jsonb_agg(jsonb_build_object('accountId',id,'integration',integration,'mode',mode,
  'label',(case integration when 'toss_billing' then '정기결제' else '일반 결제' end)||' · '||(case mode when 'test' then '테스트' else '실거래' end)||' · 계정 '||left(id::text,8)) order by integration,mode,id),'[]') from private.pg_settlement_accounts);
end $$;
revoke all on function public.admin_list_pg_settlement_accounts() from public,anon,authenticated,service_role;
grant execute on function public.admin_list_pg_settlement_accounts() to authenticated;
select private.register_operator_rpc_contract('public.admin_list_pg_settlement_accounts()'::regprocedure,'sales.manage','manual',true);

create function public.service_get_pg_settlement_account(p_account_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('accountId',id,'integration',integration,'profileId',billing_profile_id,'merchantId',mid,'mode',mode)
 from private.pg_settlement_accounts where id=p_account_id;
$$;
create function public.service_find_regular_pg_settlement_account(p_mid text,p_mode text) returns uuid
language sql stable security definer set search_path='' as $$
 select id from private.pg_settlement_accounts where integration='toss_payment' and mid=p_mid and mode=p_mode;
$$;
revoke all on function public.service_get_pg_settlement_account(uuid),public.service_find_regular_pg_settlement_account(text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_get_pg_settlement_account(uuid),public.service_find_regular_pg_settlement_account(text,text) to service_role;
select private.register_operator_internal_contract('public.service_get_pg_settlement_account(uuid)'::regprocedure);
select private.register_operator_internal_contract('public.service_find_regular_pg_settlement_account(text,text)'::regprocedure);

create function public.service_create_profile_pg_settlement_import(p_actor_id uuid,p_operation_id uuid,p_query jsonb,p_mode text,p_scope_hash text,p_mid text,p_integration text,p_profile_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare q jsonb;job private.pg_settlement_imports;begin
 perform private.pg_settlement_require_actor(p_actor_id);q:=private.pg_settlement_query(p_query);
 if p_operation_id is null or p_mode is null or p_mode not in('test','live') or p_scope_hash is null or p_scope_hash!~'^[0-9a-f]{64}$'
  or p_mid is null or p_mid!~'^[!-~]{1,14}$' or p_integration is null or p_integration not in('toss_payment','toss_billing')
  or(p_integration='toss_payment' and p_profile_id is not null) or(p_integration='toss_billing' and (p_profile_id is null or not exists(
   select 1 from private.billing_profiles where id=p_profile_id and merchant_id=p_mid and environment=p_mode))) then raise invalid_parameter_value using message='settlement_invalid_import';end if;
 perform pg_advisory_xact_lock(hashtextextended('pg-settlement-operation:'||p_operation_id::text,0));
 select * into job from private.pg_settlement_imports where operation_id=p_operation_id;
 if found then
  if job.actor_id<>p_actor_id or job.mode<>p_mode or job.scope_hash<>p_scope_hash or job.mid<>p_mid or job.integration<>p_integration or job.billing_profile_id is distinct from p_profile_id
   or job.date_type<>q->>'dateType' or job.start_date<>(q->>'startDate')::date or job.end_date<>(q->>'endDate')::date then raise unique_violation using message='settlement_operation_conflict';end if;
  return jsonb_build_object('job',private.pg_settlement_job(job.id));
 end if;
 insert into private.pg_settlement_imports(operation_id,actor_id,mode,scope_hash,mid,integration,billing_profile_id,date_type,start_date,end_date)
 values(p_operation_id,p_actor_id,p_mode,p_scope_hash,p_mid,p_integration,p_profile_id,q->>'dateType',(q->>'startDate')::date,(q->>'endDate')::date) returning * into job;
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor_id,'admin.pg_settlement.import_started','pg-settlement:'||job.id::text,
  jsonb_build_object('importId',job.id,'mode',job.mode,'integration',p_integration,'accountId',private.pg_settlement_account_id(job.integration,job.billing_profile_id,job.mid,job.mode),'query',q));
 return jsonb_build_object('job',private.pg_settlement_job(job.id));
end $$;
revoke all on function public.service_create_profile_pg_settlement_import(uuid,uuid,jsonb,text,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_create_profile_pg_settlement_import(uuid,uuid,jsonb,text,text,text,text,uuid) to service_role;
select private.register_operator_rpc_contract('public.service_create_profile_pg_settlement_import(uuid,uuid,jsonb,text,text,text,text,uuid)'::regprocedure,'sales.manage','service_start',true);

create function private.pg_settlement_account_id(p_integration text,p_profile_id uuid,p_mid text,p_mode text) returns uuid
language sql stable security definer set search_path='' as $$
 select id from private.pg_settlement_accounts where integration=p_integration and billing_profile_id is not distinct from p_profile_id and mid=p_mid and mode=p_mode;
$$;
revoke all on function private.pg_settlement_account_id(text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.pg_settlement_account_id(text,uuid,text,text) to postgres;
select private.register_operator_internal_contract('private.pg_settlement_account_id(text,uuid,text,text)'::regprocedure);

create function private.pg_settlement_account_matches(p_query jsonb,p_job private.pg_settlement_imports) returns boolean
language plpgsql stable security definer set search_path='' as $$declare key text:=nullif(p_query->>'account','');begin
 if key is null then return p_job.integration='toss_payment';end if;
 if key='current' then return false;end if;
 if key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise invalid_parameter_value using message='settlement_invalid_account';end if;
 return exists(select 1 from private.pg_settlement_accounts where id=key::uuid and integration=p_job.integration
  and billing_profile_id is not distinct from p_job.billing_profile_id and mid=p_job.mid and mode=p_job.mode);
end $$;
revoke all on function private.pg_settlement_account_matches(jsonb,private.pg_settlement_imports) from public,anon,authenticated,service_role;
grant execute on function private.pg_settlement_account_matches(jsonb,private.pg_settlement_imports) to postgres;
select private.register_operator_internal_contract('private.pg_settlement_account_matches(jsonb,private.pg_settlement_imports)'::regprocedure);

create function private.pg_settlement_match_account(p_record jsonb,p_job private.pg_settlement_imports) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare attempt public.payment_attempts;binding private.payment_provider_bindings;begin
 select * into attempt from public.payment_attempts where provider='toss' and provider_order_id=p_record->>'orderId';
 if not found then return private.pg_settlement_match(p_record);end if;
 select * into binding from private.payment_provider_bindings where attempt_id=attempt.id;
 if found then
  if p_job.integration<>'toss_billing' or p_job.billing_profile_id<>binding.profile_id or p_job.mid<>binding.merchant_id or p_job.mode<>binding.environment
   or binding.integration<>'toss_billing' then return jsonb_build_object('state','mismatch','reason','integration_binding_mismatch');end if;
 elsif p_job.integration='toss_billing' then return jsonb_build_object('state','mismatch','reason','integration_binding_missing');end if;
 return private.pg_settlement_match(p_record);
end $$;
revoke all on function private.pg_settlement_match_account(jsonb,private.pg_settlement_imports) from public,anon,authenticated,service_role;
grant execute on function private.pg_settlement_match_account(jsonb,private.pg_settlement_imports) to postgres;
select private.register_operator_internal_contract('private.pg_settlement_match_account(jsonb,private.pg_settlement_imports)'::regprocedure);

do $$declare definition text;anchor text;begin
 definition:=pg_get_functiondef('private.pg_settlement_job(uuid)'::regprocedure);anchor:='''mode'',mode,';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'settlement_account_job_anchor_changed';end if;
 execute replace(definition,anchor,anchor||'''integration'',integration,''accountId'',private.pg_settlement_account_id(integration,billing_profile_id,mid,mode),');
 definition:=pg_get_functiondef('private.pg_settlement_immutable()'::regprocedure);anchor:='if old.state=''complete'' then';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'settlement_account_immutable_anchor_changed';end if;
 execute replace(definition,anchor,'if tg_op=''UPDATE'' and (new.integration,new.billing_profile_id,new.mid,new.mode,new.scope_hash) is distinct from (old.integration,old.billing_profile_id,old.mid,old.mode,old.scope_hash) then raise check_violation using message=''settlement_account_immutable'';end if;'||anchor);
 definition:=pg_get_functiondef('public.service_finish_pg_settlement_import(uuid,uuid,uuid,text,jsonb)'::regprocedure);anchor:='private.pg_settlement_match(record)';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'settlement_account_match_anchor_changed';end if;
 execute replace(definition,anchor,'private.pg_settlement_match_account(record,job)');
 definition:=pg_get_functiondef('private.pg_settlement_report(jsonb,boolean)'::regprocedure);anchor:='mode=v_mode and date_type=q->>''dateType''';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>2 then raise exception 'settlement_account_report_anchor_changed';end if;
 execute replace(definition,anchor,anchor||' and private.pg_settlement_account_matches(p_query,pg_settlement_imports)');
 perform private.register_operator_internal_contract('private.pg_settlement_job(uuid)'::regprocedure);
 perform private.register_operator_internal_contract('private.pg_settlement_immutable()'::regprocedure);
 perform private.register_operator_internal_contract('private.pg_settlement_report(jsonb,boolean)'::regprocedure);
 perform private.register_operator_rpc_contract('public.service_finish_pg_settlement_import(uuid,uuid,uuid,text,jsonb)'::regprocedure,'sales.manage','service_finish',true);
end $$;
notify pgrst,'reload schema';
