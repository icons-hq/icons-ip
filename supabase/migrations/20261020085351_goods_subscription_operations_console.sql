-- Reviewed subscription customer pagination and operator read/inspection/export.
-- No provider request or rollout gate is enabled by this migration.
create function public.get_my_goods_subscriptions_page(p_expected_actor_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id then raise insufficient_privilege using message='subscription_actor_changed';end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null) is distinct from (p_before_id is null) then
  raise invalid_parameter_value using message='invalid_subscription_cursor';end if;
 with eligible as(select p.* from private.goods_subscription_plans p where p.owner_id=auth.uid() and (p.state<>'draft' or p.draft_expires_at>clock_timestamp())),
 page as(select * from eligible where p_before_at is null or (updated_at,id)<(p_before_at,p_before_id) order by updated_at desc,id desc limit p_limit+1),
 shown as(select * from page order by updated_at desc,id desc limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(private.subscription_plan_summary(id,false) order by updated_at desc,id desc) from shown),'[]'::jsonb),
  'total',(select count(*) from eligible),'hasMore',(select count(*)>p_limit from page),
  'nextCursor',case when (select count(*)>p_limit from page) then (select jsonb_build_object('updatedAt',updated_at,'id',id) from shown order by updated_at,id limit 1) end) into result;
 return result;
end $$;
create function private.subscription_cycle_page(p_plan_id uuid,p_before_number integer,p_limit integer) returns jsonb
language sql stable security invoker set search_path='' as $$
 with page as(select * from private.goods_subscription_cycles where plan_id=p_plan_id and (p_before_number is null or cycle_number<p_before_number) order by cycle_number desc limit p_limit+1),
 shown as(select * from page order by cycle_number desc limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'number',c.cycle_number,'state',c.state,'scheduledAt',c.scheduled_at,
  'orderId',c.order_id,'orderStatus',o.status,'amount',o.total,'settledAt',c.settled_at,'reason',c.safe_reason) order by c.cycle_number desc)
  from shown c left join public.orders o on o.id=c.order_id),'[]'::jsonb),'total',(select count(*) from private.goods_subscription_cycles where plan_id=p_plan_id),
  'hasMore',(select count(*)>p_limit from page),'nextBeforeNumber',case when (select count(*)>p_limit from page) then (select min(cycle_number) from shown) end);
$$;
create function public.get_my_goods_subscription_cycles(p_expected_actor_id uuid,p_plan_id uuid,p_before_number integer default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id or not exists(select 1 from private.goods_subscription_plans where id=p_plan_id and owner_id=auth.uid()) then
  raise insufficient_privilege using message='subscription_actor_changed';end if;
 if p_limit is null or p_limit not between 1 and 100 or p_before_number is not null and p_before_number<1 then
  raise invalid_parameter_value using message='invalid_subscription_cursor';end if;
 return private.subscription_cycle_page(p_plan_id,p_before_number,p_limit);
end $$;

create function private.subscription_console_row(p_plan_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'ownerId',p.owner_id,'buyerName',coalesce(pr.nickname,'회원'),'state',p.state,'revision',p.revision,
  'createdAt',p.created_at,'updatedAt',p.updated_at,'nextRunAt',p.next_run_at,'reason',p.pause_reason,'schedule',t.schedule,
  'renewalOnlineTotal',t.renewal_display#>'{totals,onlineTotal}','renewalCollectTotal',t.renewal_display#>'{totals,collectShippingTotal}',
  'goodsLabel',coalesce((select string_agg(coalesce(g.name,'상품')||' '||(x->>'qty')||'개',', ' order by x->>'goodId',x->>'variantId')
    from jsonb_array_elements(t.selection) x left join public.goods g on g.id=x->>'goodId'),''),
  'cycleCount',(select count(*) from private.goods_subscription_cycles where plan_id=p.id),
  'paidCycleCount',(select count(*) from private.goods_subscription_cycles c join public.orders o on o.id=c.order_id where c.plan_id=p.id and c.state='approved' and o.status not in('pending','canceled')),
  'paidOnlineTotal',(select coalesce(sum(o.total),0) from private.goods_subscription_cycles c join public.orders o on o.id=c.order_id where c.plan_id=p.id and c.state='approved' and o.status not in('pending','canceled')),
  'latestCycle',case when last_cycle.id is null then null else jsonb_build_object('id',last_cycle.id,'number',last_cycle.cycle_number,'state',last_cycle.state,
   'orderId',last_cycle.order_id,'dispatchedAt',last_cycle.dispatched_at,'nextCheckAt',last_cycle.next_check_at,'reason',last_cycle.safe_reason) end)
 from private.goods_subscription_plans p join private.goods_subscription_terms t on t.id=p.current_terms_id left join public.profiles pr on pr.id=p.owner_id
 left join lateral(select * from private.goods_subscription_cycles where plan_id=p.id order by cycle_number desc limit 1) last_cycle on true where p.id=p_plan_id;
$$;
create function private.subscription_console_ids(p_state text,p_search text) returns table(id uuid,updated_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select p.id,p.updated_at from private.goods_subscription_plans p join private.goods_subscription_terms t on t.id=p.current_terms_id
 left join public.profiles pr on pr.id=p.owner_id where (p_state is null or p.state=p_state)
 and (p.state<>'draft' or p.draft_expires_at>clock_timestamp()) and (p_search='' or position(lower(p_search) in lower(p.id::text))>0
  or position(lower(p_search) in lower(coalesce(pr.nickname,'')))>0 or exists(select 1 from jsonb_array_elements(t.selection) item
   left join public.goods g on g.id=item->>'goodId' where position(lower(p_search) in lower(coalesce(g.name,'')||' '||(item->>'goodId')))>0));
$$;
create function private.subscription_console_query(p_state text,p_search text) returns void
language plpgsql immutable security invoker set search_path='' as $$begin
 if p_state is not null and p_state not in('draft','awaiting_first_payment','active','paused','needs_confirmation','canceled')
  or p_search is null or char_length(p_search)>100 or p_search<>btrim(p_search) or p_search~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_subscription_filter';end if;
end $$;
create function public.admin_list_goods_subscriptions(p_expected_actor_id uuid,p_state text default null,p_search text default '',p_page integer default 1,p_page_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id or not public.has_operator_capability('sales.read',false) then
  raise insufficient_privilege using message='subscription_operator_required';end if;
 perform private.subscription_console_query(p_state,p_search);
 if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then raise invalid_parameter_value using message='invalid_subscription_page';end if;
 with matches as(select * from private.subscription_console_ids(p_state,p_search)),page as(select * from matches order by updated_at desc,id desc limit p_page_size offset ((p_page-1)::bigint*p_page_size))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(private.subscription_console_row(id) order by updated_at desc,id desc) from page),'[]'::jsonb),
  'total',(select count(*) from matches),'page',p_page,'pageSize',p_page_size,'asOf',clock_timestamp()) into result;
 return result;
end $$;
create function public.admin_get_goods_subscription(p_expected_actor_id uuid,p_plan_id uuid,p_before_number integer default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id or not public.has_operator_capability('sales.read',false) then
  raise insufficient_privilege using message='subscription_operator_required';end if;
 if p_before_number is not null and p_before_number<1 then raise invalid_parameter_value using message='invalid_subscription_cursor';end if;
 result:=private.subscription_console_row(p_plan_id);if result is null then raise no_data_found using message='subscription_not_found';end if;
 return jsonb_build_object('subscription',result,'cycles',private.subscription_cycle_page(p_plan_id,p_before_number,50));
end $$;
create function public.admin_prepare_subscription_inspection(p_expected_actor_id uuid,p_cycle_id uuid,p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();cycle private.goods_subscription_cycles;request jsonb;result jsonb;begin
 if actor is null or actor is distinct from p_expected_actor_id or p_operation_id is null then raise insufficient_privilege using message='subscription_operator_required';end if;
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 request:=jsonb_build_object('cycleId',p_cycle_id);
 perform pg_advisory_xact_lock(hashtextextended('subscription-inspection:'||p_operation_id::text,0));
 result:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.subscription.inspection_requested',request);if result is not null then return result;end if;
 select * into cycle from private.goods_subscription_cycles where id=p_cycle_id;
 if not found or cycle.dispatched_at is null or cycle.state not in('dispatching','unknown','needs_review') then raise object_not_in_prerequisite_state using message='subscription_inspection_unavailable';end if;
 result:=jsonb_build_object('operationId',p_operation_id,'cycleId',cycle.id,'planId',cycle.plan_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.subscription.inspection_requested','subscription-cycle:'||p_cycle_id::text,
  jsonb_build_object('request',request,'result',result));return result;
end $$;

create table private.subscription_export_receipts (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null,filters jsonb not null,payload jsonb not null,
 fingerprint text not null check(fingerprint~'^[0-9a-f]{64}$'),created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '10 minutes'
);
create index subscription_export_receipts_expiry on private.subscription_export_receipts(expires_at);
create function public.admin_prepare_goods_subscription_export(p_expected_actor_id uuid,p_state text default null,p_search text default '') returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare rows jsonb;receipt private.subscription_export_receipts;begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id then raise insufficient_privilege using message='subscription_operator_required';end if;
 perform private.require_actor_operator_capability(auth.uid(),'sales.read',false);perform private.subscription_console_query(p_state,p_search);
 select coalesce(jsonb_agg(private.subscription_console_row(id) order by updated_at desc,id desc),'[]'::jsonb) into rows from
  (select * from private.subscription_console_ids(p_state,p_search) order by updated_at desc,id desc limit 10001) limited;
 if jsonb_array_length(rows)>10000 then raise program_limit_exceeded using message='subscription_export_limit';end if;
 insert into private.subscription_export_receipts(actor_id,filters,payload,fingerprint) values(auth.uid(),jsonb_build_object('state',p_state,'query',p_search),rows,
  encode(sha256(convert_to(rows::text,'UTF8')),'hex')) returning * into receipt;
 return jsonb_build_object('receiptId',receipt.id,'fingerprint',receipt.fingerprint,'rows',rows,'total',jsonb_array_length(rows),'asOf',receipt.created_at);
end $$;
create function public.service_record_goods_subscription_export(p_actor_id uuid,p_receipt_id uuid,p_fingerprint text,p_file_sha256 text) returns uuid
language plpgsql volatile security definer set search_path='' as $$declare receipt private.subscription_export_receipts;audit_id uuid;begin
 perform private.subscription_require_service();perform private.require_actor_operator_capability(p_actor_id,'sales.read',false);
 select * into receipt from private.subscription_export_receipts where id=p_receipt_id and actor_id=p_actor_id for share;
 if not found or receipt.expires_at<=clock_timestamp() or receipt.fingerprint is distinct from p_fingerprint
  or p_file_sha256 is null or p_file_sha256!~'^[0-9a-f]{64}$' then raise check_violation using message='subscription_export_changed';end if;
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor_id,'admin.subscription_export.file_issued','subscription-export:'||receipt.id::text,
  jsonb_build_object('receiptId',receipt.id,'fingerprint',receipt.fingerprint,'rowCount',jsonb_array_length(receipt.payload),
   'fileSha256',p_file_sha256,'format','xlsx','encryption','ECMA-376-Agile')) returning id into audit_id;
 return audit_id;
end $$;
create function public.service_purge_goods_subscription_exports(p_limit integer default 1000) returns integer
language plpgsql volatile security definer set search_path='' as $$declare removed integer;begin
 perform private.subscription_require_service();if p_limit is null or p_limit not between 1 and 1000 then raise invalid_parameter_value using message='invalid_subscription_purge_limit';end if;
 delete from private.subscription_export_receipts where id in(select id from private.subscription_export_receipts where created_at<clock_timestamp()-interval '24 hours' order by created_at,id for update skip locked limit p_limit);
 get diagnostics removed=row_count;return removed;
end $$;

create function public.service_purge_billing_registration_secrets(p_limit integer default 1000) returns integer
language plpgsql volatile security definer set search_path='' as $$declare removed integer;begin
 perform private.subscription_require_service();if p_limit is null or p_limit not between 1 and 1000 then raise invalid_parameter_value using message='invalid_subscription_purge_limit';end if;
 update private.billing_enrollments set auth_envelope=null,claim_token=null,lease_until=null,
  state=case when state in('processing','unknown') then 'needs_review' else state end,
  safe_reason=case when state in('processing','unknown') then 'registration_recovery_expired' else safe_reason end,updated_at=clock_timestamp()
 where id in(select id from private.billing_enrollments where auth_envelope is not null and recovery_until<clock_timestamp()
  and (claim_token is null or lease_until<=clock_timestamp()) order by recovery_until,id for update skip locked limit p_limit);
 get diagnostics removed=row_count;return removed;
end $$;

alter table private.subscription_export_receipts enable row level security;
revoke all on private.subscription_export_receipts from public,anon,authenticated,service_role;
do $$declare item record;begin
 for item in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
  n.nspname='private' and p.proname in('subscription_cycle_page','subscription_console_row','subscription_console_ids','subscription_console_query')
  or n.nspname='public' and p.proname in('get_my_goods_subscriptions_page','get_my_goods_subscription_cycles','admin_list_goods_subscriptions',
   'admin_get_goods_subscription','admin_prepare_subscription_inspection','admin_prepare_goods_subscription_export','service_record_goods_subscription_export','service_purge_goods_subscription_exports','service_purge_billing_registration_secrets') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',item.signature);
  if item.nspname='public' and item.proname like 'service_%' then execute format('grant execute on function %s to service_role',item.signature);
  elsif item.nspname='public' then execute format('grant execute on function %s to authenticated',item.signature);
  else execute format('grant execute on function %s to postgres',item.signature);end if;
  perform private.register_operator_internal_contract(item.signature);
 end loop;
end $$;
select private.register_operator_rpc_contract('public.admin_list_goods_subscriptions(uuid,text,text,integer,integer)'::regprocedure,'sales.read','read',false);
select private.register_operator_rpc_contract('public.admin_get_goods_subscription(uuid,uuid,integer)'::regprocedure,'sales.read','read',false);
select private.register_operator_rpc_contract('public.admin_prepare_subscription_inspection(uuid,uuid,uuid)'::regprocedure,'sales.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_prepare_goods_subscription_export(uuid,text,text)'::regprocedure,'sales.read','write',false);
select private.register_operator_rpc_contract('public.service_record_goods_subscription_export(uuid,uuid,text,text)'::regprocedure,'sales.read','service_start',false);
notify pgrst,'reload schema';
