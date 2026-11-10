begin;
create table private.review_best_reward_jobs (
 id bigint generated always as identity primary key, review_id uuid not null, order_id uuid not null,user_id uuid not null,
 selection_revision bigint, selected boolean not null, policy_snapshot jsonb not null, actor_id uuid,
 state text not null default 'pending' check(state in ('pending','done')), outcome text, attempts integer not null default 0,
 next_at timestamptz not null default clock_timestamp(),created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,last_error text,
 unique(review_id,selection_revision)
);
create index review_best_reward_jobs_pending on private.review_best_reward_jobs(next_at,id) where state='pending';
create table private.review_best_rewards (
 review_id uuid primary key,order_id uuid not null,user_id uuid not null,lot_id uuid unique,
 amount bigint not null check(amount>=0),planned_amount bigint not null check(planned_amount>0),policy_snapshot jsonb not null,
 selection_revision bigint not null,granted_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 revoked_at timestamptz,revocation_operation_id uuid not null unique default gen_random_uuid(),grant_operation_id uuid not null unique default gen_random_uuid()
);
alter table private.review_best_reward_jobs enable row level security;
alter table private.review_best_rewards enable row level security;
revoke all on private.review_best_reward_jobs,private.review_best_rewards from public,anon,authenticated,service_role;
revoke all on sequence private.review_best_reward_jobs_id_seq from public,anon,authenticated,service_role;

-- Selection never takes a credit-account lock. Its immutable job is processed in
-- a separate transaction, avoiding the order/refund -> account -> review cycle.
create function private.queue_review_best_reward() returns trigger
language plpgsql security definer set search_path='' as $$
declare review public.reviews; policy private.customer_reward_policy; credit private.store_credit_policy; snapshot jsonb:='{}';
begin
 select * into review from public.reviews where id=new.review_id;
 if not found then return new;end if;
 select * into policy from private.customer_reward_policy where singleton;
 select * into credit from private.store_credit_policy where singleton;
 if policy.best_enabled and credit.enabled then
  snapshot:=jsonb_build_object('enabled',true,'revision',policy.revision,'amount',policy.best_amount,'validityDays',policy.best_validity_days,
   'reversal',policy.best_reversal,'maxBalance',credit.max_balance);
 end if;
 insert into private.review_best_reward_jobs(review_id,order_id,user_id,selection_revision,selected,policy_snapshot,actor_id)
  values(new.review_id,review.order_id,review.user_id,new.revision,new.selected and new.invalidated_at is null,snapshot,new.updated_by) on conflict do nothing;
 return new;
end $$;
revoke all on function private.queue_review_best_reward() from public,anon,authenticated,service_role;
create trigger review_best_reward_queue after insert or update of selected,revision,invalidated_at on private.review_best_selections
 for each row execute function private.queue_review_best_reward();

create function private.queue_deleted_review_best_reward() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from private.review_best_rewards where review_id=old.id) or exists(select 1 from private.review_best_reward_jobs where review_id=old.id and state='pending') then
  insert into private.review_best_reward_jobs(review_id,order_id,user_id,selected,policy_snapshot) values(old.id,old.order_id,old.user_id,false,'{}');
 end if;return old;
end $$;
revoke all on function private.queue_deleted_review_best_reward() from public,anon,authenticated,service_role;
create trigger review_best_reward_deleted before delete on public.reviews for each row execute function private.queue_deleted_review_best_reward();

create function private.reverse_best_review_reward(p_review_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare reward private.review_best_rewards;lot private.store_credit_lots;debt bigint:=0; recovered bigint:=0;
begin
 select * into reward from private.review_best_rewards where review_id=p_review_id for update;
 if not found or reward.revoked_at is not null or reward.policy_snapshot->>'reversal'<>'revoke' then return;end if;
 perform private.expire_store_credit_lots(reward.user_id,clock_timestamp());
 if reward.lot_id is not null then
  if not exists(select 1 from private.store_credit_lots where id=reward.lot_id and root_lot_id=id and user_id=reward.user_id and source_kind='admin') then
   raise check_violation using message='best_reward_lot_mismatch';end if;
  for lot in select * from private.store_credit_lots where root_lot_id=reward.lot_id order by id for update loop
   if lot.revoked_at is not null then continue;end if;
   debt:=debt+lot.reserved_amount+lot.spent_amount+lot.offset_amount;recovered:=recovered+lot.available_amount;
   update private.store_credit_lots set available_amount=0,revoked_amount=revoked_amount+lot.available_amount,revoked_at=clock_timestamp() where id=lot.id;
   insert into public.store_credit_ledger(user_id,kind,amount,available_delta,debt_delta,order_id,lot_id,operation_id,reason)
    values(reward.user_id,'earned_reversal',-lot.available_amount,-lot.available_amount,lot.reserved_amount+lot.spent_amount+lot.offset_amount,
     reward.order_id,lot.id,reward.revocation_operation_id,'BEST 리뷰 보상 회수');
  end loop;
  update private.store_credit_lots set debt_amount=debt_amount+debt where id=reward.lot_id;
 end if;
 update private.review_best_rewards set revoked_at=clock_timestamp() where review_id=p_review_id;
 insert into public.audit_log(id,action,target,diff) values(reward.revocation_operation_id,'review.best.reward_revoked','review:'||p_review_id,
  jsonb_build_object('recovered',recovered,'futureCreditOffset',debt,'lotId',reward.lot_id));
end $$;
revoke all on function private.reverse_best_review_reward(uuid) from public,anon,authenticated,service_role;

create function private.process_review_best_reward_jobs(p_review_id uuid default null,p_limit integer default 30) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.review_best_reward_jobs; review public.reviews; selection private.review_best_selections; reward private.review_best_rewards;
 eligible boolean; balance jsonb; amount bigint; grant_id uuid; lot_id uuid; expires timestamptz; processed integer:=0; failed integer:=0; result text;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value;end if;
 for job in select * from private.review_best_reward_jobs j where j.state='pending' and j.next_at<=clock_timestamp()
  and (p_review_id is null or j.review_id=p_review_id) order by j.id limit p_limit for update skip locked loop
  begin
   -- Same order as cancellation's financial transition, then BEST invalidation.
   perform 1 from public.orders where id=job.order_id for update;
   perform private.lock_store_credit_account(job.user_id);
   perform pg_advisory_xact_lock(hashtextextended('review-best-order:'||job.order_id::text,0));
   select * into review from public.reviews where id=job.review_id for update;
   select * into selection from private.review_best_selections where review_id=job.review_id for update;
   select * into reward from private.review_best_rewards where review_id=job.review_id for update;
   eligible:=review.id is not null and selection.selected and selection.invalidated_at is null
    and selection.review_fingerprint=private.review_event_review_fingerprint(review) and private.review_best_problem(review) is null
    and exists(select 1 from public.profiles where id=job.user_id and role='user' and suspended_at is null)
    and not private.is_account_write_fenced(job.user_id);
   result:='not_eligible';
   if reward.review_id is not null then
    if (not job.selected or not coalesce(eligible,false)) and reward.revoked_at is null and reward.policy_snapshot->>'reversal'='revoke' then
     perform private.reverse_best_review_reward(job.review_id);result:='revoked';
    else result:='already_processed';end if;
   elsif job.selected and coalesce(eligible,false) and selection.revision=job.selection_revision and job.policy_snapshot->'enabled'='true'::jsonb then
    perform private.expire_store_credit_lots(job.user_id,clock_timestamp());balance:=private.store_credit_balance(job.user_id);
    amount:=least((job.policy_snapshot->>'amount')::bigint,greatest(0,(job.policy_snapshot->>'maxBalance')::bigint-(balance->>'available')::bigint-(balance->>'reserved')::bigint)+(balance->>'debt')::bigint);
    expires:=clock_timestamp()+make_interval(days=>(job.policy_snapshot->>'validityDays')::integer);grant_id:=gen_random_uuid();lot_id:=null;
    if amount>0 then lot_id:=private.issue_store_credit_lot(job.user_id,amount,expires,'admin',job.order_id,job.actor_id,grant_id,'BEST 리뷰 보상');end if;
    insert into private.review_best_rewards(review_id,order_id,user_id,lot_id,amount,planned_amount,policy_snapshot,selection_revision,expires_at,grant_operation_id)
     values(job.review_id,job.order_id,job.user_id,lot_id,amount,(job.policy_snapshot->>'amount')::bigint,job.policy_snapshot,job.selection_revision,expires,grant_id);
    insert into public.audit_log(id,actor_id,action,target,diff) values(grant_id,case when exists(select 1 from public.profiles where id=job.actor_id) then job.actor_id end,
     'review.best.reward_granted','review:'||job.review_id,jsonb_build_object('amount',amount,'plannedAmount',job.policy_snapshot->'amount','lotId',lot_id,'policyRevision',job.policy_snapshot->'revision'));
    result:=case when amount<(job.policy_snapshot->>'amount')::bigint then 'balance_limited' else 'granted' end;
   elsif job.policy_snapshot->'enabled' is distinct from 'true'::jsonb then result:='disabled';
   end if;
   update private.review_best_reward_jobs set state='done',outcome=result,completed_at=clock_timestamp(),last_error=null where id=job.id;processed:=processed+1;
  exception when others then
   update private.review_best_reward_jobs set attempts=attempts+1,last_error=sqlstate,
    next_at=clock_timestamp()+make_interval(mins=>least(60,power(2,least(attempts,6))::integer)) where id=job.id;failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('processed',processed,'failed',failed);
end $$;
revoke all on function private.process_review_best_reward_jobs(uuid,integer) from public,anon,authenticated,service_role;

create function public.admin_get_review_best_reward(p_review_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare reward private.review_best_rewards; job private.review_best_reward_jobs; configured boolean;
begin
 if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_review_id is null then raise invalid_parameter_value;end if;
 select * into reward from private.review_best_rewards where review_id=p_review_id;
 select * into job from private.review_best_reward_jobs where review_id=p_review_id order by id desc limit 1;
 select p.best_enabled and c.enabled into configured from private.customer_reward_policy p cross join private.store_credit_policy c where p.singleton and c.singleton;
 return jsonb_build_object('reviewId',p_review_id,'state',case when job.state='pending' then 'pending' when reward.revoked_at is not null then 'revoked'
   when reward.review_id is not null then case when reward.amount<reward.planned_amount then 'capped' else 'paid' end
   when not configured then 'disabled' when job.id is not null then 'skipped' else 'none' end,
  'amount',coalesce(reward.amount,0),'plannedAmount',coalesce(reward.planned_amount,(job.policy_snapshot->>'amount')::bigint,0),
  'grantedAt',reward.granted_at,'expiresAt',reward.expires_at,'revokedAt',reward.revoked_at);
end $$;
revoke all on function public.admin_get_review_best_reward(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_review_best_reward(uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_review_best_reward(uuid)'::regprocedure,'cs.manage','read',false);

create function public.admin_process_review_best_reward(p_review_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('cs.manage',true);
 if p_review_id is null then raise invalid_parameter_value;end if;
 perform private.process_review_best_reward_jobs(p_review_id,30);
 return public.admin_get_review_best_reward(p_review_id);
end $$;
revoke all on function public.admin_process_review_best_reward(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_process_review_best_reward(uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_process_review_best_reward(uuid)'::regprocedure,'cs.manage','write',false);

create function public.process_review_best_rewards() returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if auth.role() is distinct from 'service_role' and session_user<>'postgres' then raise insufficient_privilege;end if;
 return private.process_review_best_reward_jobs(null,50);
end $$;
revoke all on function public.process_review_best_rewards() from public,anon,authenticated,service_role;
grant execute on function public.process_review_best_rewards() to service_role;

-- One disclosure per public review, including a later reversal. Multiple
-- benefits must not create duplicate cards or hide an already granted benefit.
create or replace function public.get_review_event_disclosures(p_review_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_review_ids is null or cardinality(p_review_ids)>500 then raise invalid_parameter_value using message='invalid_review_event_targets';end if;
 return (with benefits as (
  select a.source_review_id review_id,e.title,a.revoked_at is not null revoked
   from private.review_event_awards a join private.review_events e on e.id=a.event_id and e.announced_at is not null
   where a.source_review_id=any(p_review_ids)
  union all
  select b.review_id,'BEST 리뷰 보상',b.revoked_at is not null from private.review_best_rewards b where b.review_id=any(p_review_ids) and b.amount>0
 ), disclosed as (
  select r.id,string_agg(distinct b.title,' · ' order by b.title) title,bool_and(b.revoked) revoked from benefits b
  join public.reviews r on r.id=b.review_id and r.status='visible'
  join public.goods g on g.id=r.good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
  join public.ips ip on ip.id=g.ip_id and ip.archived_at is null and ip.published_at is not null group by r.id
 ) select coalesce(jsonb_agg(jsonb_build_object('reviewId',id,'eventTitle',title,'revoked',revoked) order by id),'[]'::jsonb) from disclosed);
end $$;
revoke all on function public.get_review_event_disclosures(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_review_event_disclosures(uuid[]) to anon,authenticated;
commit;
