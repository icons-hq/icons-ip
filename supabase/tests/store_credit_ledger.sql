\set ON_ERROR_STOP on
-- Synthetic policy amounts below are test fixtures, not operating defaults.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('00000000-0000-4000-8000-000000004881','authenticated','authenticated','credits-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004882','authenticated','authenticated','credits-owner@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004883','authenticated','authenticated','credits-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='credits-'||right(id::text,4)||'@example.test',nickname='credits_'||right(id::text,4),birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now(),role=case when id='00000000-0000-4000-8000-000000004881' then 'admin'::public.user_role else 'user'::public.user_role end
where id in ('00000000-0000-4000-8000-000000004881','00000000-0000-4000-8000-000000004882','00000000-0000-4000-8000-000000004883');

select 1/case when not has_table_privilege('authenticated','private.store_credit_lots','select')
  and not has_table_privilege('service_role','private.store_credit_lots','update')
  and not has_table_privilege('authenticated','public.store_credit_ledger','insert')
  and not has_function_privilege('authenticated','private.issue_store_credit_lot(uuid,bigint,timestamptz,text,uuid,uuid,uuid,text,uuid)','execute')
  and not has_function_privilege('authenticated','public.place_order_with_store_credits(uuid,jsonb,uuid,public.order_payment_method,bigint)','execute')
  then 1 else 0 end as private_history_is_sealed;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004881',true);
set local role authenticated;
do $$ declare version integer; begin
  version:=(public.admin_get_store_credit_policy()->>'version')::integer;
  begin
    perform public.admin_save_store_credit_policy('10000000-0000-4000-8000-000000004881',version,'{"enabled":true,"evidence":"test only"}');
    raise exception 'incomplete policy must never enable';
  exception when check_violation then null; end;
end $$;
select public.admin_save_store_credit_policy('10000000-0000-4000-8000-000000004882',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":1000,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":10000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"synthetic test policy, rollback only"}');
select (now()+interval '2 days')::text as grant_expiry \gset
select public.admin_adjust_store_credit('20000000-0000-4000-8000-000000004881','00000000-0000-4000-8000-000000004882',5000,:'grant_expiry','합성 지급 근거',0);
-- Exactly the same operation replays before optimistic balance checking.
select public.admin_adjust_store_credit('20000000-0000-4000-8000-000000004881','00000000-0000-4000-8000-000000004882',5000,:'grant_expiry','합성 지급 근거',0);
select 1/case when (public.admin_get_store_credit_history('00000000-0000-4000-8000-000000004882')->>'available')::bigint=5000
  and (public.admin_get_store_credit_history('00000000-0000-4000-8000-000000004882')->>'total')::bigint=1 then 1 else 0 end as grant_replay_is_exactly_once;
do $$ begin
  begin
    perform public.admin_adjust_store_credit('20000000-0000-4000-8000-000000004882','00000000-0000-4000-8000-000000004882',-1000,null,'오래된 잔액',0);
    raise exception 'stale amount should reject';
  exception when sqlstate 'PT409' then null; end;
end $$;
select public.admin_adjust_store_credit('20000000-0000-4000-8000-000000004883','00000000-0000-4000-8000-000000004882',-1000,null,'정정 근거',5000);

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004882',true);
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=4000
  and (public.get_my_store_credit_history()->>'total')::bigint=2 then 1 else 0 end as owner_sees_real_balance_and_history;
do $$ begin
  begin
    perform public.admin_get_store_credit_history('00000000-0000-4000-8000-000000004883');
    raise exception 'owner cannot read another customer';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004883',true);
select 1/case when (select count(*) from public.store_credit_ledger)=0
  and (public.get_my_store_credit_history()->>'available')::bigint=0 then 1 else 0 end as own_row_rls_isolated;

reset role;
-- Only fixture time is changed. Expiration/amount is observed through public RPC.
update private.store_credit_lots set expires_at=now()-interval '1 second' where user_id='00000000-0000-4000-8000-000000004882';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004882',true);
set local role authenticated;
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=0
  and (public.get_my_store_credit_history()->>'total')::bigint=3 then 1 else 0 end as expiry_is_once_and_preserves_history;
select 1/case when (public.get_my_store_credit_history()->>'total')::bigint=3 then 1 else 0 end as repeated_expiry_read_is_idempotent;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004881',true);
do $$ declare n integer; begin
  for n in 1..32 loop
    perform public.admin_adjust_store_credit(extensions.gen_random_uuid(),'00000000-0000-4000-8000-000000004882',1,now()+interval '2 days','페이지 검증',n-1);
  end loop;
end $$;
select 1/case when (public.admin_get_store_credit_history('00000000-0000-4000-8000-000000004882',2)->>'total')::bigint=35
  and jsonb_array_length(public.admin_get_store_credit_history('00000000-0000-4000-8000-000000004882',2)->'items')=5
  then 1 else 0 end as server_pagination_keeps_exact_total;

reset role;
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000004881';
set local role authenticated;
do $$ begin
  begin perform public.admin_get_store_credit_policy(); raise exception 'demoted role still has access';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 1/case when (select count(*) from public.audit_log where actor_id='00000000-0000-4000-8000-000000004881' and action='admin.store_credit.adjusted')=34
  then 1 else 0 end as every_adjustment_is_audited_once;
rollback;
