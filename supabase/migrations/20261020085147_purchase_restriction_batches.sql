-- Batch intake reuses the existing purchase-only ledger and its per-customer
-- order-creation lock. Preview does not register restrictions. Expected row
-- failures are reported separately; unexpected errors roll back the execution.
create index profiles_email_ci_lookup_idx on public.profiles(lower(email)) where email is not null;

create table private.purchase_restriction_batches (
 id uuid primary key,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 payload jsonb not null,
 preview jsonb not null,
 result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 check ((result is null and completed_at is null) or (result is not null and completed_at is not null))
);
alter table private.purchase_restriction_batches enable row level security;
revoke all on private.purchase_restriction_batches from public,anon,authenticated,service_role;
create index purchase_restriction_batches_actor_created on private.purchase_restriction_batches(actor_id,created_at desc,id);

create function private.purchase_restriction_batch_json(batch private.purchase_restriction_batches,actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',batch.id,'mode',batch.payload->>'mode','reasonCode',batch.payload->>'reasonCode',
  'reasonDetail',batch.payload->>'reasonDetail','createdAt',batch.created_at,'expiresAt',batch.created_at+interval '15 minutes',
  'completedAt',batch.completed_at,'status',case when batch.result is not null then 'completed'
   when batch.created_at+interval '15 minutes'<=statement_timestamp() then 'expired' else 'prepared' end,
  'canExecute',batch.actor_id=actor and batch.result is null and batch.created_at+interval '15 minutes'>statement_timestamp(),
  'readyCount',(select count(*) from jsonb_array_elements(batch.preview) row where row->>'status'='ready'),
  'registeredCount',coalesce((batch.result->>'registeredCount')::integer,0),
  'skippedCount',coalesce((batch.result->>'skippedCount')::integer,0),
  'failedCount',coalesce((batch.result->>'failedCount')::integer,0),
  'rows',coalesce((select jsonb_agg(row||jsonb_build_object(
    'currentState',case when row->>'restrictionId' is null then null when r.id is null then 'missing'
      when r.released_at is null then 'active' else 'released' end,
    'releasedAt',r.released_at) order by (row->>'rowNumber')::integer)
    from jsonb_array_elements(coalesce(batch.result->'rows',batch.preview)) row
    left join public.goods_purchase_restrictions r on r.id=nullif(row->>'restrictionId','')::uuid),'[]'::jsonb));
$$;
revoke all on function private.purchase_restriction_batch_json(private.purchase_restriction_batches,uuid) from public,anon,authenticated,service_role;

create function public.admin_get_purchase_restriction_batch(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_purchase_restriction_staff(); batch private.purchase_restriction_batches;
begin
 -- A readback waits for an in-flight execution of this exact request. It must
 -- not misreport an uncommitted execution as a safely retryable prepared batch.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchase_restriction_batch:'||p_batch_id,0));
 select * into batch from private.purchase_restriction_batches where id=p_batch_id;
 if not found then return null; end if;
 return private.purchase_restriction_batch_json(batch,actor);
end $$;
revoke all on function public.admin_get_purchase_restriction_batch(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_purchase_restriction_batch(uuid) to authenticated;

create function public.admin_preview_purchase_restriction_batch(p_batch_id uuid,p_mode text,p_inputs text[],p_reason_code text,p_reason_detail text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_purchase_restriction_staff(); existing private.purchase_restriction_batches; saved private.purchase_restriction_batches;
 payload jsonb; normalized_inputs text[]; reason text:=nullif(btrim(p_reason_detail),''); token text; n integer:=0; matches integer;
 target_user uuid; target_order uuid; customer public.profiles; active_id uuid; seen uuid[]:='{}'; seen_inputs text[]:='{}';
 row_status text; duplicate_of integer; rows jsonb:='[]'::jsonb;
begin
 if p_batch_id is null or p_mode is null or p_mode not in ('customer','order') or p_inputs is null or cardinality(p_inputs) not between 1 and 100
  or array_position(p_inputs,null) is not null or exists(select 1 from unnest(p_inputs) v where length(btrim(v)) not between 1 and 254 or v ~ '[[:cntrl:]]')
  or p_reason_code is null or p_reason_code not in ('repeated_purchase','verbal_abuse','business_interference','other')
  or reason is null or length(reason)>200
 then raise invalid_parameter_value using message='invalid_purchase_restriction_batch'; end if;
 select array_agg(lower(btrim(value)) order by position) into normalized_inputs from unnest(p_inputs) with ordinality x(value,position);
 payload:=jsonb_build_object('mode',p_mode,'inputs',normalized_inputs,'reasonCode',p_reason_code,'reasonDetail',reason);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchase_restriction_batch:'||p_batch_id,0));
 select * into existing from private.purchase_restriction_batches where id=p_batch_id;
 if found then
  if existing.actor_id<>actor or existing.payload<>payload then raise exception using errcode='PT409',message='purchase_restriction_batch_request_conflict'; end if;
  return private.purchase_restriction_batch_json(existing,actor);
 end if;
 foreach token in array normalized_inputs loop
  n:=n+1; target_user:=null; target_order:=null; customer:=null; active_id:=null; duplicate_of:=null; row_status:='ready';
  if token=any(seen_inputs) then
   row_status:='duplicate'; duplicate_of:=array_position(seen_inputs,token);
  elsif p_mode='order' then
   if token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then row_status:='invalid_input';
   else
    select id,user_id into target_order,target_user from public.orders where id=token::uuid;
    if not found then row_status:='not_found'; end if;
   end if;
  else
   if token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and token !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then row_status:='invalid_input';
   else
    if token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
     select id into target_user from public.profiles where id=token::uuid; matches:=case when found then 1 else 0 end;
    else
     select count(*),(array_agg(id order by id))[1] into matches,target_user from public.profiles where email is not null and lower(email)=token;
    end if;
    if matches=0 then row_status:='not_found'; target_user:=null;
    elsif matches>1 then row_status:='ambiguous'; target_user:=null; end if;
   end if;
  end if;
  if target_user is not null then
   select * into customer from public.profiles where id=target_user;
   if not found then row_status:='not_found';target_user:=null;
   elsif target_user=any(seen) then
    row_status:='duplicate';
    select (x->>'rowNumber')::integer into duplicate_of from jsonb_array_elements(rows)x where x->>'userId'=target_user::text order by (x->>'rowNumber')::integer limit 1;
   elsif customer.role<>'user' then row_status:='not_eligible';
   else
    select id into active_id from public.goods_purchase_restrictions where user_id=target_user and released_at is null;
    if found then row_status:='already_active'; end if;
   end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('rowNumber',n,'input',token,'userId',target_user,'nickname',customer.nickname,
   'maskedEmail',case when customer.email is null then null else left(split_part(customer.email,'@',1),1)||'***@'||split_part(customer.email,'@',2) end,
   'evidenceOrderId',target_order,'status',row_status,'duplicateOf',duplicate_of,'restrictionId',active_id,'outcome',null,'error',null));
  seen_inputs:=array_append(seen_inputs,token); if target_user is not null then seen:=array_append(seen,target_user); end if;
 end loop;
 insert into private.purchase_restriction_batches(id,actor_id,payload,preview) values(p_batch_id,actor,payload,rows) returning * into saved;
 return private.purchase_restriction_batch_json(saved,actor);
end $$;
revoke all on function public.admin_preview_purchase_restriction_batch(uuid,text,text[],text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_purchase_restriction_batch(uuid,text,text[],text,text) to authenticated;

create function public.admin_execute_purchase_restriction_batch(p_batch_id uuid,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_purchase_restriction_staff(); batch private.purchase_restriction_batches; saved private.purchase_restriction_batches;
 row jsonb; rows jsonb:='[]'; target_user uuid; request_id uuid; registered integer:=0; skipped integer:=0; failed integer:=0; reply jsonb; active_id uuid;
begin
 if p_batch_id is null or p_confirmed is distinct from true then raise invalid_parameter_value using message='purchase_restriction_batch_confirmation_required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchase_restriction_batch:'||p_batch_id,0));
 select * into batch from private.purchase_restriction_batches where id=p_batch_id for update;
 if not found then raise no_data_found using message='purchase_restriction_batch_not_found'; end if;
 if batch.actor_id<>actor then raise insufficient_privilege using message='purchase_restriction_batch_actor_mismatch'; end if;
 if batch.result is not null then return private.purchase_restriction_batch_json(batch,actor); end if;
 if batch.created_at+interval '15 minutes'<=clock_timestamp() then raise exception using errcode='PT409',message='purchase_restriction_batch_expired'; end if;
 if not exists(select 1 from jsonb_array_elements(batch.preview)x where x->>'status'='ready') then raise check_violation using message='purchase_restriction_batch_no_ready_targets'; end if;
 -- Global UUID order prevents two overlapping batches from deadlocking while
 -- retaining the same per-customer lock used by single registration and orders.
 for target_user in select (x->>'userId')::uuid from jsonb_array_elements(batch.preview)x where x->>'status'='ready' order by (x->>'userId')::uuid loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_user::text,0));
 end loop;
 if batch.created_at+interval '15 minutes'<=clock_timestamp() then raise exception using errcode='PT409',message='purchase_restriction_batch_expired'; end if;
 for row in select x from jsonb_array_elements(batch.preview)x order by (x->>'rowNumber')::integer loop
  if row->>'status'<>'ready' then
   row:=row||jsonb_build_object('outcome','skipped','error',row->>'status');skipped:=skipped+1;
  else
   target_user:=(row->>'userId')::uuid;
   request_id:=(md5(p_batch_id::text||':purchase-restriction:'||target_user::text))::uuid;
   begin
    reply:=public.admin_register_purchase_restriction(request_id,target_user,batch.payload->>'reasonCode',batch.payload->>'reasonDetail',nullif(row->>'evidenceOrderId','')::uuid);
    if reply->>'releasedAt' is not null then
     row:=row||jsonb_build_object('outcome','failed','error','request_already_released','restrictionId',request_id);failed:=failed+1;
    else
     row:=row||jsonb_build_object('outcome','registered','error',null,'restrictionId',request_id);registered:=registered+1;
    end if;
   exception when check_violation or invalid_parameter_value then
    if sqlerrm='purchase_restriction_already_active' then
     select id into active_id from public.goods_purchase_restrictions where user_id=target_user and released_at is null;
     row:=row||jsonb_build_object('outcome','skipped','error','already_active','restrictionId',active_id);skipped:=skipped+1;
    elsif sqlerrm='purchase_restriction_customer_not_eligible' then
     row:=row||jsonb_build_object('outcome','failed','error','not_eligible');failed:=failed+1;
    elsif sqlerrm='purchase_restriction_evidence_owner_mismatch' then
     row:=row||jsonb_build_object('outcome','failed','error','evidence_owner_mismatch');failed:=failed+1;
    else raise; end if;
   end;
  end if;
  rows:=rows||jsonb_build_array(row);
 end loop;
 update private.purchase_restriction_batches set result=jsonb_build_object('rows',rows,'registeredCount',registered,'skippedCount',skipped,'failedCount',failed),
  completed_at=clock_timestamp() where id=p_batch_id returning * into saved;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.purchase_restriction.batch_completed','purchase_restriction_batch:'||p_batch_id,
  jsonb_build_object('mode',batch.payload->>'mode','registeredCount',registered,'skippedCount',skipped,'failedCount',failed));
 return private.purchase_restriction_batch_json(saved,actor);
end $$;
revoke all on function public.admin_execute_purchase_restriction_batch(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_execute_purchase_restriction_batch(uuid,boolean) to authenticated;
