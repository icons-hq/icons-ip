-- Admin-only atomic grants. Preview never expires or writes financial lots.
create table private.store_credit_batches (
 id uuid primary key, actor_id uuid not null, purpose text not null check(purpose in ('promotion','general')),
 amount bigint not null check(amount between 1 and 999999999999), reason text not null check(length(reason) between 1 and 1000),
 expires_at timestamptz not null, policy_version integer not null, payload jsonb not null,
 status text not null default 'prepared' check(status in ('prepared','completed','failed')),
 result jsonb, created_at timestamptz not null default clock_timestamp(), finished_at timestamptz
);
create table private.store_credit_batch_recipients (
 batch_id uuid not null references private.store_credit_batches(id), user_id uuid not null,
 operation_id uuid not null unique, expected_balance jsonb not null,
 primary key(batch_id,user_id)
);
alter table private.store_credit_batches enable row level security;
alter table private.store_credit_batch_recipients enable row level security;
revoke all on private.store_credit_batches,private.store_credit_batch_recipients from public,anon,authenticated,service_role;
grant all on private.store_credit_batches,private.store_credit_batch_recipients to postgres;
create index store_credit_batches_created on private.store_credit_batches(created_at desc,id);
create index store_credit_ledger_console_created on public.store_credit_ledger(created_at desc,id desc);

create function private.store_credit_preview_balance(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('available',coalesce(sum(available_amount) filter(where expires_at>statement_timestamp()),0),
  'reserved',coalesce(sum(reserved_amount),0),'debt',coalesce(sum(debt_amount),0))
 from private.store_credit_lots where user_id=p_user_id
$$;
revoke all on function private.store_credit_preview_balance(uuid) from public,anon,authenticated,service_role;
grant execute on function private.store_credit_preview_balance(uuid) to postgres;

create function public.admin_find_store_credit_customers(p_query text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.assert_store_credit_admin();
 if length(btrim(coalesce(p_query,''))) not between 2 and 200 then raise invalid_parameter_value using message='store_credit_query_invalid'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,
  'maskedEmail',case when position('@' in email)>0 then left(email,1)||'***@'||split_part(email,'@',2) else '' end,
  'eligible',suspended_at is null and not private.is_account_write_fenced(id)) order by nickname,id),'[]')
  from (select id,nickname,email,suspended_at from public.profiles
   where id::text=btrim(p_query) or lower(email)=lower(btrim(p_query)) or nickname ilike '%'||replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_')||'%'
   order by nickname,id limit 50) customers);
end $$;
revoke all on function public.admin_find_store_credit_customers(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_find_store_credit_customers(text) to authenticated;

create function public.admin_preview_store_credit_batch(p_id uuid,p_targets text[],p_amount bigint,p_expires_at timestamptz,p_reason text,p_purpose text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; policy private.store_credit_policy; previous private.store_credit_batches; payload jsonb; rows jsonb:='[]';
 target text; matched uuid; matches integer; balance jsonb; issue text; seen uuid[]:='{}'; invalid integer:=0; offset_total bigint:=0; result jsonb;
begin
 actor:=private.assert_store_credit_admin();
 if p_id is null or coalesce(cardinality(p_targets),0) not between 1 and 1000 or p_amount is null or p_amount not between 1 and 999999999999
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or p_purpose is null or p_purpose not in ('promotion','general')
  or exists(select 1 from unnest(p_targets) t where t is null or length(btrim(t)) not between 1 and 200)
  then raise invalid_parameter_value using message='store_credit_batch_invalid'; end if;
 payload:=jsonb_build_object('targets',to_jsonb(p_targets),'amount',p_amount,'expiresAt',p_expires_at,'reason',btrim(p_reason),'purpose',p_purpose);
 perform pg_advisory_xact_lock(hashtextextended('store_credit_batch:'||p_id::text,0));
 select * into previous from private.store_credit_batches where id=p_id;
 if found then
  if previous.actor_id<>actor or previous.payload is distinct from payload then raise exception using errcode='PT409',message='store_credit_batch_conflict'; end if;
  return previous.result;
 end if;
 select * into policy from private.store_credit_policy where singleton for share;
 if not policy.enabled then raise check_violation using message='store_credit_disabled'; end if;
 if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+make_interval(days=>policy.validity_days)
  then raise check_violation using message='store_credit_expiry_invalid'; end if;
 foreach target in array p_targets loop
  issue:=null; matched:=null; balance:='{"available":0,"reserved":0,"debt":0}';
  select count(*), (array_agg(id order by id))[1] into matches,matched from public.profiles where id::text=btrim(target) or lower(email)=lower(btrim(target));
  if matches<>1 then issue:='customer_not_found';
  elsif matched=any(seen) then issue:='duplicate_customer';
  else
   seen:=array_append(seen,matched); balance:=private.store_credit_preview_balance(matched);
   if exists(select 1 from public.profiles where id=matched and suspended_at is not null) or private.is_account_write_fenced(matched) then issue:='customer_unavailable';
   elsif p_amount>(balance->>'debt')::bigint and (balance->>'available')::bigint+(balance->>'reserved')::bigint+p_amount-(balance->>'debt')::bigint>policy.max_balance then issue:='store_credit_balance_limit'; end if;
  end if;
  if issue is not null then invalid:=invalid+1; else offset_total:=offset_total+least(p_amount,(balance->>'debt')::bigint); end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('target',target,'userId',matched,'nickname',(select nickname from public.profiles where id=matched),
   'error',issue,'balance',balance,'offset',case when issue is null then least(p_amount,(balance->>'debt')::bigint) else 0 end));
 end loop;
 result:=jsonb_build_object('id',p_id,'status',case when invalid>0 then 'invalid' else 'prepared' end,'purpose',p_purpose,'reason',btrim(p_reason),
  'amount',p_amount,'expiresAt',p_expires_at,'count',cardinality(p_targets),'invalidCount',invalid,'gross',p_amount*cardinality(p_targets),
  'offset',offset_total,'net',p_amount*cardinality(p_targets)-offset_total,'rows',rows,'createdAt',clock_timestamp(),'error',null);
 if invalid=0 then
  insert into private.store_credit_batches(id,actor_id,purpose,amount,reason,expires_at,policy_version,payload,result)
   values(p_id,actor,p_purpose,p_amount,btrim(p_reason),p_expires_at,policy.version,payload,result);
  insert into private.store_credit_batch_recipients(batch_id,user_id,operation_id,expected_balance)
   select p_id,(r->>'userId')::uuid,extensions.gen_random_uuid(),r->'balance' from jsonb_array_elements(rows) r;
 end if;
 return result;
end $$;
revoke all on function public.admin_preview_store_credit_batch(uuid,text[],bigint,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_store_credit_batch(uuid,text[],bigint,timestamptz,text,text) to authenticated;

create function public.admin_execute_store_credit_batch(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; batch private.store_credit_batches; policy private.store_credit_policy; recipient private.store_credit_batch_recipients;
 before_balance jsonb; v_result jsonb; failure text; after_balance jsonb; rows jsonb:='[]';
begin
 actor:=private.assert_store_credit_admin();
 perform pg_advisory_xact_lock(hashtextextended('store_credit_batch:'||p_id::text,0));
 select * into batch from private.store_credit_batches where id=p_id for update;
 if not found or batch.actor_id<>actor then raise insufficient_privilege using message='store_credit_batch_not_found'; end if;
 if batch.status<>'prepared' then return batch.result; end if;
 -- This subtransaction rolls every grant/expiry/audit back if any recipient fails.
 begin
  select * into policy from private.store_credit_policy where singleton for share;
  if not policy.enabled then raise check_violation using message='store_credit_disabled'; end if;
  if policy.version<>batch.policy_version or batch.created_at<clock_timestamp()-interval '15 minutes' then raise exception using errcode='PT409',message='store_credit_preview_stale'; end if;
  if batch.expires_at<=clock_timestamp() then raise check_violation using message='store_credit_expiry_invalid'; end if;
  for recipient in select * from private.store_credit_batch_recipients where batch_id=p_id order by user_id loop
   perform private.lock_store_credit_account(recipient.user_id);
   perform private.assert_active_user(recipient.user_id);
   if private.is_account_write_fenced(recipient.user_id) then raise insufficient_privilege using message='customer_unavailable'; end if;
   perform private.expire_store_credit_lots(recipient.user_id,clock_timestamp());
   before_balance:=private.store_credit_balance(recipient.user_id);
   if before_balance is distinct from recipient.expected_balance then raise exception using errcode='PT409',message='store_credit_balance_conflict'; end if;
  end loop;
  for recipient in select * from private.store_credit_batch_recipients where batch_id=p_id order by user_id loop
   after_balance:=public.admin_adjust_store_credit(recipient.operation_id,recipient.user_id,batch.amount,batch.expires_at,batch.reason,(recipient.expected_balance->>'available')::bigint);
   rows:=rows||jsonb_build_array(jsonb_build_object('userId',recipient.user_id,'operationId',recipient.operation_id,'balance',after_balance));
  end loop;
  v_result:=batch.result||jsonb_build_object('status','completed','completedCount',(batch.result->>'count')::integer,'failedCount',0,'completedRows',rows,'finishedAt',clock_timestamp());
 exception when others then
  failure:=sqlerrm;
  -- Do not return arbitrary SQL internals to clients.
  if failure not in ('store_credit_disabled','store_credit_preview_stale','store_credit_expiry_invalid','store_credit_balance_conflict','store_credit_balance_limit','customer_unavailable','account_suspended','account_deletion_in_progress') then failure:='store_credit_batch_failed'; end if;
  v_result:=batch.result||jsonb_build_object('status','failed','completedCount',0,'failedCount',(batch.result->>'count')::integer,'error',failure,'finishedAt',clock_timestamp());
 end;
 update private.store_credit_batches set status=v_result->>'status',result=v_result,finished_at=clock_timestamp() where id=p_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.store_credit.batch_'||(v_result->>'status'),'store_credit_batch:'||p_id::text,
  jsonb_build_object('count',v_result->'count','amount',batch.amount,'gross',v_result->'gross','offset',v_result->'offset','error',v_result->'error'));
 return v_result;
end $$;
revoke all on function public.admin_execute_store_credit_batch(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_execute_store_credit_batch(uuid) to authenticated;

create function public.admin_get_store_credit_batch(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;
begin
 actor:=private.assert_store_credit_admin();
 return (select result||jsonb_build_object('canExecute',actor_id=actor and status='prepared') from private.store_credit_batches where id=p_id);
end $$;
revoke all on function public.admin_get_store_credit_batch(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_store_credit_batch(uuid) to authenticated;

create function public.admin_search_store_credit_console(p_mode text default 'batches',p_query text default '',p_from date default null,p_to date default null,p_kind text default '',p_page integer default 1,p_page_size integer default 50) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; query text:=btrim(coalesce(p_query,''));
begin
 perform private.assert_store_credit_admin();
 if p_mode is null or p_mode not in ('batches','ledger') or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (20,50,100,10000) or length(query)>200 or p_from>p_to
  then raise invalid_parameter_value using message='store_credit_filters_invalid'; end if;
 with all_rows as (
  select b.id::text id,b.created_at,'batch' source,b.status kind,b.reason,b.amount,(b.result->>'count')::integer recipients,
   (b.result->>'gross')::bigint gross,coalesce((b.result->>'completedCount')::integer,0) completed,b.purpose,null::uuid user_id,null::uuid order_id,
   b.actor_id,b.id batch_id,null::bigint available_delta,null::bigint reserved_delta,null::bigint debt_delta,b.expires_at
   from private.store_credit_batches b where p_mode='batches'
  union all
  select o.operation_id::text,o.created_at,'individual','completed',o.payload->>'reason',(o.payload->>'amount')::bigint,1,(o.payload->>'amount')::bigint,1,'general',
   (o.payload->>'userId')::uuid,null::uuid,o.actor_id,null::uuid,null::bigint,null::bigint,null::bigint,(o.payload->>'expiresAt')::timestamptz
   from private.store_credit_operations o where p_mode='batches' and o.kind='adjustment' and (o.payload->>'amount')::bigint>0
   and not exists(select 1 from private.store_credit_batch_recipients r where r.operation_id=o.operation_id)
  union all
  select l.id::text,l.created_at,'ledger',l.kind,l.reason,l.amount,1,l.amount,1,'',l.user_id,l.order_id,l.actor_id,r.batch_id,l.available_delta,l.reserved_delta,l.debt_delta,l.expires_at
   from public.store_credit_ledger l left join private.store_credit_batch_recipients r on r.operation_id=l.operation_id where p_mode='ledger'
 ), filtered as (
  select a.*,coalesce(p.nickname,'') nickname,case when position('@' in p.email)>0 then left(p.email,1)||'***@'||split_part(p.email,'@',2) else '' end masked_email
  from all_rows a left join public.profiles p on p.id=a.user_id
  where (p_from is null or a.created_at>=(p_from::timestamp at time zone 'Asia/Seoul'))
   and(p_to is null or a.created_at<((p_to+1)::timestamp at time zone 'Asia/Seoul')) and(coalesce(p_kind,'')='' or a.kind=p_kind)
   and(query='' or a.id=query or a.user_id::text=query or a.order_id::text=query or a.batch_id::text=query or lower(p.email)=lower(query)
    or position(lower(query) in lower(a.reason))>0 or position(lower(query) in lower(p.nickname))>0
    or (p_mode='batches' and exists(select 1 from private.store_credit_batch_recipients r join public.profiles c on c.id=r.user_id
     where r.batch_id=a.batch_id and(c.id::text=query or lower(c.email)=lower(query) or position(lower(query) in lower(c.nickname))>0))))
 ), paged as (select * from filtered order by created_at desc,id desc limit p_page_size offset (p_page-1)*p_page_size)
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',id,'createdAt',created_at,'source',source,'kind',kind,'reason',reason,'amount',amount,'recipients',recipients,'gross',gross,'completed',completed,'purpose',purpose,
  'userId',user_id,'orderId',order_id,'actorId',actor_id,'batchId',batch_id,'availableDelta',available_delta,'reservedDelta',reserved_delta,'debtDelta',debt_delta,'expiresAt',expires_at,'nickname',nickname,'maskedEmail',masked_email)
  order by created_at desc,id desc) from paged),'[]')) into result;
 return result;
end $$;
revoke all on function public.admin_search_store_credit_console(text,text,date,date,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_store_credit_console(text,text,date,date,text,integer,integer) to authenticated;

create function public.admin_export_store_credit_console(p_mode text,p_query text default '',p_from date default null,p_to date default null,p_kind text default '') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; payload jsonb;
begin
 actor:=private.assert_store_credit_admin();
 payload:=public.admin_search_store_credit_console(p_mode,p_query,p_from,p_to,p_kind,1,10000);
 if (payload->>'total')::bigint>10000 then raise check_violation using message='store_credit_export_limit'; end if;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.store_credit.exported','store_credit_console',
  jsonb_build_object('mode',p_mode,'query',p_query,'from',p_from,'to',p_to,'kind',p_kind,'rows',payload->'total'));
 return payload||jsonb_build_object('capturedAt',clock_timestamp());
end $$;
revoke all on function public.admin_export_store_credit_console(text,text,date,date,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_export_store_credit_console(text,text,date,date,text) to authenticated;
