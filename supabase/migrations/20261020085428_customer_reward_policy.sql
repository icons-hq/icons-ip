begin;
create table private.customer_reward_policy (
 singleton boolean primary key default true check(singleton), revision bigint not null default 1 check(revision>0),
 grade_enabled boolean not null default false, grade_rates jsonb not null default '{"welcome":null,"silver":null,"gold":null,"platinum":null}',
 best_enabled boolean not null default false, best_amount bigint check(best_amount between 1 and 999999999999),
 best_validity_days integer check(best_validity_days between 1 and 36500), best_reversal text check(best_reversal in ('keep','revoke')),
 evidence text not null default '' check(char_length(evidence)<=2000), updated_at timestamptz not null default clock_timestamp(),
 check(not best_enabled or (best_amount is not null and best_validity_days is not null and best_reversal is not null))
);
insert into private.customer_reward_policy(singleton) values(true);
alter table private.customer_reward_policy enable row level security;
revoke all on private.customer_reward_policy from public,anon,authenticated,service_role;

create function private.customer_reward_policy_document() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',p.revision,'updatedAt',p.updated_at,'gradeEnabled',p.grade_enabled,'gradeRates',p.grade_rates,
  'bestEnabled',p.best_enabled,'bestAmount',p.best_amount,'bestValidityDays',p.best_validity_days,'bestReversal',p.best_reversal,'evidence',p.evidence,
  'baseCreditEnabled',(select enabled from private.store_credit_policy where singleton)) from private.customer_reward_policy p where p.singleton;
$$;
revoke all on function private.customer_reward_policy_document() from public,anon,authenticated,service_role;

create function public.admin_get_customer_reward_policy() returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform private.assert_store_credit_admin(); return private.customer_reward_policy_document();
end $$;
revoke all on function public.admin_get_customer_reward_policy() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_customer_reward_policy() to authenticated;
select private.register_operator_rpc_contract('public.admin_get_customer_reward_policy()'::regprocedure,'marketing.manage','read',false);

create function public.admin_save_customer_reward_policy(p_values jsonb,p_expected_revision bigint,p_operation_id uuid,p_expected_actor uuid,p_expected_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; previous private.customer_reward_policy; prior public.audit_log; request jsonb; result jsonb; item record; base_enabled boolean;
begin
 actor:=private.assert_store_credit_admin();
 if actor is distinct from p_expected_actor or p_expected_session is null or auth.jwt()->>'session_id' is distinct from p_expected_session::text
  or not exists(select 1 from auth.sessions where id=p_expected_session and user_id=actor and (not_after is null or not_after>clock_timestamp())) then
  raise insufficient_privilege using message='customer_reward_auth_changed';end if;
 if p_operation_id is null or p_expected_revision is null or p_expected_revision<1 or jsonb_typeof(p_values) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_values))<>8
  or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('gradeEnabled','gradeRates','bestEnabled','bestAmount','bestValidityDays','bestReversal','evidence','acknowledged'))
  or jsonb_typeof(p_values->'gradeEnabled') is distinct from 'boolean' or jsonb_typeof(p_values->'bestEnabled') is distinct from 'boolean'
  or p_values->'acknowledged' is distinct from 'true'::jsonb or jsonb_typeof(p_values->'evidence') is distinct from 'string'
  or char_length(btrim(p_values->>'evidence')) not between 1 and 2000 or jsonb_typeof(p_values->'gradeRates') is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_values->'gradeRates'))<>4
  or exists(select 1 from jsonb_object_keys(p_values->'gradeRates') k where k not in ('welcome','silver','gold','platinum')) then
  raise invalid_parameter_value using message='invalid_customer_reward_policy';end if;
 for item in select key,value from jsonb_each(p_values->'gradeRates') loop
  if item.value<>'null'::jsonb and (jsonb_typeof(item.value)<>'number' or item.value::text !~ '^[0-9]+$' or item.value::numeric>10000)
   or (p_values->>'gradeEnabled')::boolean and item.value='null'::jsonb then raise invalid_parameter_value using message='invalid_customer_reward_rate';end if;
 end loop;
 if p_values->'bestAmount'<>'null'::jsonb and (jsonb_typeof(p_values->'bestAmount')<>'number' or (p_values->'bestAmount')::text !~ '^[1-9][0-9]*$' or (p_values->>'bestAmount')::numeric>999999999999)
  or p_values->'bestValidityDays'<>'null'::jsonb and (jsonb_typeof(p_values->'bestValidityDays')<>'number' or (p_values->'bestValidityDays')::text !~ '^[1-9][0-9]*$' or (p_values->>'bestValidityDays')::numeric>36500)
  or p_values->'bestReversal'<>'null'::jsonb and (jsonb_typeof(p_values->'bestReversal')<>'string' or p_values->>'bestReversal' not in ('keep','revoke'))
  or (p_values->>'bestEnabled')::boolean and (p_values->'bestAmount'='null'::jsonb or p_values->'bestValidityDays'='null'::jsonb or p_values->'bestReversal'='null'::jsonb)
  then raise invalid_parameter_value using message='invalid_customer_reward_best';end if;
 -- All money policies are locked before their dependent configuration.
 select enabled into base_enabled from private.store_credit_policy where singleton for share;
 if not base_enabled and ((p_values->>'gradeEnabled')::boolean or (p_values->>'bestEnabled')::boolean) then raise object_not_in_prerequisite_state using message='store_credit_policy_required';end if;
 select * into previous from private.customer_reward_policy where singleton for update;
 request:=jsonb_build_object('values',p_values,'revision',p_expected_revision,'sessionId',p_expected_session);
 select * into prior from public.audit_log where id=p_operation_id;
 if found then
  if prior.actor_id is distinct from actor or prior.action<>'marketing.customer_reward_policy' or prior.diff->'request' is distinct from request then raise sqlstate 'PT409' using message='customer_reward_operation_conflict';end if;
  return prior.diff->'result';
 end if;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='customer_reward_policy_changed';end if;
 update private.customer_reward_policy set grade_enabled=(p_values->>'gradeEnabled')::boolean,grade_rates=p_values->'gradeRates',
  best_enabled=(p_values->>'bestEnabled')::boolean,best_amount=(p_values->>'bestAmount')::bigint,best_validity_days=(p_values->>'bestValidityDays')::integer,
  best_reversal=p_values->>'bestReversal',evidence=btrim(p_values->>'evidence'),revision=revision+1,updated_at=clock_timestamp() where singleton;
 result:=private.customer_reward_policy_document();
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'marketing.customer_reward_policy','customer_rewards',jsonb_build_object('request',request,'result',result));
 return result;
end $$;
revoke all on function public.admin_save_customer_reward_policy(jsonb,bigint,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_customer_reward_policy(jsonb,bigint,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_customer_reward_policy(jsonb,bigint,uuid,uuid,uuid)'::regprocedure,'marketing.manage','write',false);

-- The order stores the effective earning rate, so later grade/settings changes
-- cannot change a promise made at checkout. Existing orders retain their JSON.
create function private.store_credit_policy_for_member(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.store_credit_policy_json(); policy private.customer_reward_policy; grade text; rate bigint;
begin
 select * into policy from private.customer_reward_policy where singleton;
 if not policy.grade_enabled or result->'enabled' is distinct from 'true'::jsonb then return result;end if;
 select loyalty_grade::text into grade from public.profiles where id=p_user_id;
 if grade is null then return result;end if;
 rate:=(policy.grade_rates->>grade)::bigint;
 if rate is null then raise object_not_in_prerequisite_state using message='customer_reward_rate_missing';end if;
 return result||jsonb_build_object('earnKind','rate_bps','earnValue',rate,'gradeReward',jsonb_build_object('grade',grade,'policyRevision',policy.revision));
end $$;
revoke all on function private.store_credit_policy_for_member(uuid) from public,anon,authenticated,service_role;
commit;
