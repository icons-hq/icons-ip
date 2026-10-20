-- Read-only PG reconciliation. No checkout, refund, inventory, or bank state
-- is changed. Two complete scans must agree before a snapshot is published.
create table private.pg_settlement_imports (
 id uuid primary key default extensions.gen_random_uuid(), operation_id uuid not null unique, actor_id uuid not null,
 provider text not null default 'toss' check(provider='toss'), mode text not null check(mode in('test','live')),
 scope_hash text not null check(scope_hash~'^[0-9a-f]{64}$'), mid text not null,
 date_type text not null check(date_type in('soldDate','paidOutDate')), start_date date not null,end_date date not null,
 state text not null default 'collecting' check(state in('collecting','verifying','complete','failed')),
 scan integer not null default 1 check(scan in(1,2)), next_page integer not null default 1 check(next_page between 1 and 21),
 record_count integer not null default 0 check(record_count between 0 and 20000), source_count integer not null default 0 check(source_count between 0 and 40000),
 claim_id uuid, lease_until timestamptz,error_code text,
 started_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 check(end_date between start_date and start_date+30),check((claim_id is null)=(lease_until is null)),
 check((state='complete')=(completed_at is not null)),check(char_length(mid) between 1 and 14)
);
create index pg_settlement_imports_query_idx on private.pg_settlement_imports(mode,date_type,start_date,end_date,completed_at desc) where state='complete';
create table private.pg_settlement_pages (
 import_id uuid not null references private.pg_settlement_imports(id),scan integer not null,page integer not null,
 claim_id uuid not null unique,source_count integer not null,record_count integer not null,
 source_hash text not null,records_hash text not null,input_hash text not null,terminal boolean not null,
 collected_at timestamptz not null default clock_timestamp(),primary key(import_id,scan,page)
);
create table private.pg_settlement_source_keys (
 import_id uuid not null references private.pg_settlement_imports(id),scan integer not null,transaction_key text not null,
 primary key(import_id,scan,transaction_key)
);
create table private.pg_settlement_records (
 id uuid primary key default extensions.gen_random_uuid(),import_id uuid not null references private.pg_settlement_imports(id),
 transaction_key text not null,record jsonb not null,record_hash text not null,verified boolean not null default false,
 kind text not null check(kind in('approval','cancel')),currency text not null,sold_date date not null,paid_out_date date not null,
 match_state text not null default 'unlinked' check(match_state in('matched','unlinked','mismatch')),
 match_reason text not null default 'payment_not_found',purpose text,reference_id uuid,order_number text,
 unique(import_id,transaction_key)
);
create index pg_settlement_records_report_idx on private.pg_settlement_records(import_id,kind,currency,match_state);
create index payments_pg_settlement_key_idx on public.payments(provider,payment_key) where payment_key is not null;
alter table private.pg_settlement_imports enable row level security;
alter table private.pg_settlement_pages enable row level security;
alter table private.pg_settlement_source_keys enable row level security;
alter table private.pg_settlement_records enable row level security;
revoke all on private.pg_settlement_imports,private.pg_settlement_pages,private.pg_settlement_source_keys,private.pg_settlement_records from public,anon,authenticated,service_role;

create function private.pg_settlement_immutable() returns trigger language plpgsql set search_path='' as $$
declare parent_id uuid;next_parent_id uuid;
begin
 if tg_table_name='pg_settlement_imports' then
  if old.state='complete' then raise object_not_in_prerequisite_state using message='settlement_snapshot_immutable';end if;
 else
  parent_id:=case when tg_op='INSERT' then new.import_id else old.import_id end;
  if tg_op<>'DELETE' then next_parent_id:=new.import_id;end if;
  if exists(select 1 from private.pg_settlement_imports where id=any(array[parent_id,next_parent_id]) and state='complete') then
   raise object_not_in_prerequisite_state using message='settlement_snapshot_immutable';end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.pg_settlement_immutable() from public,anon,authenticated,service_role;
create trigger pg_settlement_imports_immutable before update or delete on private.pg_settlement_imports for each row execute function private.pg_settlement_immutable();
create trigger pg_settlement_records_immutable before insert or update or delete on private.pg_settlement_records for each row execute function private.pg_settlement_immutable();
create trigger pg_settlement_pages_immutable before insert or update or delete on private.pg_settlement_pages for each row execute function private.pg_settlement_immutable();
create trigger pg_settlement_source_keys_immutable before insert or update or delete on private.pg_settlement_source_keys for each row execute function private.pg_settlement_immutable();

create function private.pg_settlement_query(p_query jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare first_date date;last_date date;
begin
 if jsonb_typeof(p_query) is distinct from 'object' or p_query->>'dateType' not in('soldDate','paidOutDate')
  or coalesce(p_query->>'startDate','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or coalesce(p_query->>'endDate','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
  raise invalid_parameter_value using message='settlement_invalid_query';end if;
 first_date:=(p_query->>'startDate')::date;last_date:=(p_query->>'endDate')::date;
 if p_query->>'dateType' is null or last_date not between first_date and first_date+30 then raise invalid_parameter_value using message='settlement_invalid_query';end if;
 return jsonb_build_object('dateType',p_query->>'dateType','startDate',first_date::text,'endDate',last_date::text);
exception when datetime_field_overflow or invalid_datetime_format then raise invalid_parameter_value using message='settlement_invalid_query';
end $$;
revoke all on function private.pg_settlement_query(jsonb) from public,anon,authenticated,service_role;

create function private.pg_settlement_job(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',id,'operationId',operation_id,'dateType',date_type,'startDate',start_date,'endDate',end_date,'mode',mode,
 'state',state,'scan',scan,'nextPage',next_page,'recordCount',record_count,'sourceCount',source_count,
 'startedAt',started_at,'updatedAt',updated_at,'completedAt',completed_at,'errorCode',error_code) from private.pg_settlement_imports where id=p_id;
$$;
revoke all on function private.pg_settlement_job(uuid) from public,anon,authenticated,service_role;

create function private.pg_settlement_require_actor(p_actor uuid) returns void language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from private.operator_access_state where id for share;
 perform private.require_actor_operator_capability(p_actor,'sales.manage',true);
end $$;
revoke all on function private.pg_settlement_require_actor(uuid) from public,anon,authenticated,service_role;

create function public.service_create_pg_settlement_import(p_actor_id uuid,p_operation_id uuid,p_query jsonb,p_mode text,p_scope_hash text,p_mid text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare q jsonb;job private.pg_settlement_imports;
begin
 perform private.pg_settlement_require_actor(p_actor_id);q:=private.pg_settlement_query(p_query);
 if p_operation_id is null or p_mode is null or p_mode not in('test','live') or p_scope_hash is null or p_scope_hash!~'^[0-9a-f]{64}$'
  or p_mid is null or p_mid!~'^[!-~]{1,14}$' then raise invalid_parameter_value using message='settlement_invalid_import';end if;
 perform pg_advisory_xact_lock(hashtextextended('pg-settlement-operation:'||p_operation_id::text,0));
 select * into job from private.pg_settlement_imports where operation_id=p_operation_id;
 if found then
  if job.actor_id<>p_actor_id or job.mode<>p_mode or job.scope_hash<>p_scope_hash or job.mid<>p_mid
   or job.date_type<>q->>'dateType' or job.start_date<>(q->>'startDate')::date or job.end_date<>(q->>'endDate')::date then
   raise unique_violation using message='settlement_operation_conflict';end if;
  return jsonb_build_object('job',private.pg_settlement_job(job.id));
 end if;
 insert into private.pg_settlement_imports(operation_id,actor_id,mode,scope_hash,mid,date_type,start_date,end_date)
 values(p_operation_id,p_actor_id,p_mode,p_scope_hash,p_mid,q->>'dateType',(q->>'startDate')::date,(q->>'endDate')::date) returning * into job;
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor_id,'admin.pg_settlement.import_started','pg-settlement:'||job.id::text,
  jsonb_build_object('importId',job.id,'mode',job.mode,'query',q));
 return jsonb_build_object('job',private.pg_settlement_job(job.id));
end $$;
revoke all on function public.service_create_pg_settlement_import(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_create_pg_settlement_import(uuid,uuid,jsonb,text,text,text) to service_role;

create function public.service_claim_pg_settlement_import(p_actor_id uuid,p_import_id uuid,p_scope_hash text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare job private.pg_settlement_imports;token uuid:=extensions.gen_random_uuid();
begin
 perform private.pg_settlement_require_actor(p_actor_id);
 select * into job from private.pg_settlement_imports where id=p_import_id for update;
 if not found or job.actor_id<>p_actor_id then raise insufficient_privilege using message='settlement_import_unavailable';end if;
 if job.state in('complete','failed') then return jsonb_build_object('kind',job.state,'job',private.pg_settlement_job(job.id));end if;
 if job.scope_hash is distinct from p_scope_hash then
  update private.pg_settlement_imports set state='failed',error_code='scope_changed',claim_id=null,lease_until=null,updated_at=clock_timestamp() where id=job.id;
  return jsonb_build_object('kind','failed','job',private.pg_settlement_job(job.id));end if;
 if job.lease_until>clock_timestamp() then return jsonb_build_object('kind','busy','job',private.pg_settlement_job(job.id));end if;
 update private.pg_settlement_imports set claim_id=token,lease_until=clock_timestamp()+interval '120 seconds',error_code=null,updated_at=clock_timestamp() where id=job.id;
 return jsonb_build_object('kind','ready','job',private.pg_settlement_job(job.id),'claimId',token,'scan',job.scan,'page',job.next_page,
  'query',jsonb_build_object('dateType',job.date_type,'startDate',job.start_date,'endDate',job.end_date));
end $$;
revoke all on function public.service_claim_pg_settlement_import(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_claim_pg_settlement_import(uuid,uuid,text) to service_role;

-- Verify normalized private input again at the DB boundary. Decimal strings
-- are exact and bounded, with no float casts or coercion from wire numbers.
create function private.pg_settlement_validate_record(p_record jsonb,p_job private.pg_settlement_imports) returns void
language plpgsql immutable set search_path='' as $$
declare key text;value jsonb;fee jsonb;at_date date;
begin
 if jsonb_typeof(p_record) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_record))<>16
  or not p_record ?& array['mId','paymentKey','transactionKey','orderId','currency','method','amount','interestFee','fees','supplyAmount','vat','payOutAmount','approvedAt','soldDate','paidOutDate','cancel'] then
  raise invalid_parameter_value using message='settlement_invalid_record';end if;
 if p_record->>'mId' is distinct from p_job.mid or coalesce(p_record->>'paymentKey','')!~'^[!-~]{1,200}$'
  or coalesce(p_record->>'transactionKey','')!~'^[!-~]{1,64}$' or coalesce(p_record->>'orderId','')!~'^[A-Za-z0-9_-]{6,64}$'
  or coalesce(p_record->>'currency','')!~'^[A-Z]{3}$' or char_length(coalesce(p_record->>'method','')) not between 1 and 40
  or p_record->>'method'~'[[:cntrl:]]' or btrim(p_record->>'method')='' then raise invalid_parameter_value using message='settlement_invalid_record';end if;
 for key,value in select j.key,j.value from jsonb_each(p_record) j where j.key not in('fees','cancel') loop
  if jsonb_typeof(value)<>'string' then raise invalid_parameter_value using message='settlement_invalid_record';end if;
 end loop;
 foreach key in array array['amount','interestFee','supplyAmount','vat','payOutAmount'] loop
  if p_record->>key!~'^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,8})?$' or trim_scale((p_record->>key)::numeric)::text<>p_record->>key then
   raise invalid_parameter_value using message='settlement_invalid_record';end if;
 end loop;
 foreach key in array array['soldDate','paidOutDate'] loop
  if p_record->>key!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise invalid_parameter_value using message='settlement_invalid_record';end if;
  at_date:=(p_record->>key)::date;
 end loop;
 at_date:=(p_record->>p_job.date_type)::date;
 if at_date not between p_job.start_date and p_job.end_date then raise invalid_parameter_value using message='settlement_invalid_record';end if;
 if p_record->>'approvedAt'!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
  raise invalid_parameter_value using message='settlement_invalid_record';end if;
 perform (p_record->>'approvedAt')::timestamptz;
 if jsonb_typeof(p_record->'fees') is distinct from 'array' or jsonb_array_length(p_record->'fees')>100 then raise invalid_parameter_value using message='settlement_invalid_record';end if;
 for fee in select * from jsonb_array_elements(p_record->'fees') loop
  if jsonb_typeof(fee) is distinct from 'object' or (select count(*)from jsonb_object_keys(fee))<>2
   or not fee ?& array['type','fee'] or jsonb_typeof(fee->'type') is distinct from 'string' or jsonb_typeof(fee->'fee') is distinct from 'string'
   or coalesce(fee->>'type','')!~'^[A-Z_]{1,40}$' or coalesce(fee->>'fee','')!~'^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,8})?$'
   or trim_scale((fee->>'fee')::numeric)::text<>fee->>'fee' then raise invalid_parameter_value using message='settlement_invalid_record';end if;
 end loop;
 if p_record->'cancel'<>'null'::jsonb then
  value:=p_record->'cancel';
  if jsonb_typeof(value) is distinct from 'object' or (select count(*)from jsonb_object_keys(value))<>3
   or not value ?& array['cancelAmount','canceledAt','transactionKey'] or jsonb_typeof(value->'cancelAmount') is distinct from 'string'
   or jsonb_typeof(value->'canceledAt') is distinct from 'string' or jsonb_typeof(value->'transactionKey') is distinct from 'string'
   or value->>'transactionKey' is distinct from p_record->>'transactionKey'
   or coalesce(value->>'cancelAmount','')!~'^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,8})?$'
   or trim_scale((value->>'cancelAmount')::numeric)::text<>value->>'cancelAmount'
   or coalesce(value->>'canceledAt','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
   raise invalid_parameter_value using message='settlement_invalid_record';end if;
  perform (value->>'canceledAt')::timestamptz;
 end if;
exception when data_exception then raise invalid_parameter_value using message='settlement_invalid_record';
end $$;
revoke all on function private.pg_settlement_validate_record(jsonb,private.pg_settlement_imports) from public,anon,authenticated,service_role;

-- Matching is frozen when the snapshot completes. A key match alone cannot
-- hide a different provider, purpose, reference, amount, or evidence key.
create function private.pg_settlement_match(p_record jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare a public.payment_attempts;p public.payments;candidate_count integer;record_kind text;reason text;reference_number text;reference_total bigint;reference_user uuid;refund_count integer;refund_amount numeric;
begin
 record_kind:=case when p_record->'cancel'='null'::jsonb then 'approval' else 'cancel' end;
 select count(*) into candidate_count from public.payment_attempts where provider='toss' and provider_order_id=p_record->>'orderId';
 if candidate_count=0 then return jsonb_build_object('state','unlinked','reason','payment_not_found');end if;
 select * into a from public.payment_attempts where provider='toss' and provider_order_id=p_record->>'orderId';
 select * into p from public.payments where id=a.payment_id;
 if not found then return jsonb_build_object('state','unlinked','reason','payment_not_finalized');end if;
 if (select count(*)from public.payments where provider='toss' and payment_key=p_record->>'paymentKey')>1 then
  return jsonb_build_object('state','mismatch','reason','ambiguous_payment');end if;
 if p.provider<>'toss' or p.payment_key is distinct from p_record->>'paymentKey' or p.purpose<>a.purpose or p.ref_id is distinct from a.ref_id
  or p.user_id<>a.user_id or p.amount<>a.amount or a.currency<>p_record->>'currency' or a.state not in('approved','canceled') or p.status not in('paid','canceled','refunded') then
  return jsonb_build_object('state','mismatch','reason','payment_identity_mismatch');end if;
 if a.purpose='order' then select total,user_id,upper(left(id::text,8)) into reference_total,reference_user,reference_number from public.orders where id=a.ref_id;
 elsif a.purpose='ticket' then select total,user_id,upper(left(id::text,8)) into reference_total,reference_user,reference_number from public.ticket_orders where id=a.ref_id;
 else return jsonb_build_object('state','unlinked','reason','unsupported_purpose');end if;
 if reference_total is null or reference_total<>p.amount or reference_user<>p.user_id then return jsonb_build_object('state','mismatch','reason','reference_mismatch');end if;
 if record_kind='approval' then
  if (p_record->>'amount')::numeric<>p.amount then reason:='amount_mismatch';
  elsif not exists(select 1 from private.payment_provider_evidence e where e.payment_attempt_id=a.id and e.evidence_kind='confirm_approved'
   and e.provider_payment_key=p.payment_key and e.provider_transaction_id=p_record->>'transactionKey') then reason:='transaction_evidence_missing';end if;
 else
  if not exists(select 1 from private.payment_provider_evidence e where e.payment_attempt_id=a.id and e.evidence_kind='refund_approved'
   and e.provider_payment_key=p.payment_key and e.provider_transaction_id=p_record->>'transactionKey') then reason:='transaction_evidence_missing';
  else
   select count(*),sum(amount) into refund_count,refund_amount from public.refunds where payment_id=p.id and status='done';
   -- Current finalized refunds are whole-payment records. Do not guess which
   -- partial refund a repeated equal amount represents.
   if (select count(distinct provider_transaction_id) from private.payment_provider_evidence where payment_attempt_id=a.id and evidence_kind='refund_approved')<>1 then reason:='ambiguous_refund';
   elsif refund_count<>1 or (p_record#>>'{cancel,cancelAmount}')::numeric<>refund_amount then reason:='refund_amount_mismatch';end if;
  end if;
 end if;
 return jsonb_build_object('state',case when reason is null then 'matched' when reason='transaction_evidence_missing' then 'unlinked' else 'mismatch' end,'reason',coalesce(reason,'verified'),
  'purpose',a.purpose,'referenceId',a.ref_id,'orderNumber',reference_number);
end $$;
revoke all on function private.pg_settlement_match(jsonb) from public,anon,authenticated,service_role;

create function public.service_finish_pg_settlement_import(p_actor_id uuid,p_import_id uuid,p_claim_id uuid,p_scope_hash text,p_page jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare job private.pg_settlement_imports;prior private.pg_settlement_pages;item jsonb;key text;input_hash text;v_source_count integer;v_record_count integer;is_terminal boolean;matching jsonb;failure text;
begin
 perform private.pg_settlement_require_actor(p_actor_id);
 select * into job from private.pg_settlement_imports where id=p_import_id for update;
 if not found or job.actor_id<>p_actor_id then raise insufficient_privilege using message='settlement_import_unavailable';end if;
 if job.state not in('complete','failed') and job.scope_hash is distinct from p_scope_hash then
  update private.pg_settlement_imports set state='failed',error_code='scope_changed',claim_id=null,lease_until=null,updated_at=clock_timestamp() where id=job.id;
  return jsonb_build_object('kind','failed','job',private.pg_settlement_job(job.id));end if;
 input_hash:=encode(extensions.digest(p_page::text,'sha256'),'hex');
 select * into prior from private.pg_settlement_pages where import_id=job.id and claim_id=p_claim_id;
 if found then
  if prior.input_hash is distinct from input_hash then raise unique_violation using message='settlement_page_conflict';end if;
  return jsonb_build_object('kind',case when job.state in('complete','failed')then job.state else 'accepted' end,'job',private.pg_settlement_job(job.id));end if;
 if job.state in('complete','failed') then return jsonb_build_object('kind',job.state,'job',private.pg_settlement_job(job.id));end if;
 if p_claim_id is null or job.claim_id is distinct from p_claim_id or job.lease_until<=clock_timestamp() then
  return jsonb_build_object('kind','stale','job',private.pg_settlement_job(job.id));end if;
 begin
  if pg_column_size(p_page)>8388608 or jsonb_typeof(p_page) is distinct from 'object' or jsonb_typeof(p_page->'records') is distinct from 'array'
   or jsonb_typeof(p_page->'sourceTransactionKeys') is distinct from 'array' or jsonb_typeof(p_page->'terminal') is distinct from 'boolean'
   or coalesce(p_page->>'page','')!~'^[0-9]{1,2}$' or (p_page->>'page')::int<>job.next_page
   or coalesce(p_page->>'sourceCount','')!~'^[0-9]{1,4}$' or (p_page->>'sourceCount')::int not between 0 and 1000
   or coalesce(p_page->>'sourceHash','')!~'^[0-9a-f]{64}$' or coalesce(p_page->>'recordsHash','')!~'^[0-9a-f]{64}$' then
   raise invalid_parameter_value using message='invalid_response';end if;
  v_source_count:=(p_page->>'sourceCount')::int;v_record_count:=jsonb_array_length(p_page->'records');is_terminal:=(p_page->>'terminal')::boolean;
  if v_record_count>v_source_count or jsonb_array_length(p_page->'sourceTransactionKeys')<>v_source_count or is_terminal<>(v_source_count<1000)
   or (job.next_page=21 and v_source_count>0) or coalesce((select sum(p.source_count) from private.pg_settlement_pages p where p.import_id=job.id and p.scan=job.scan),0)+v_source_count>20000 then raise invalid_parameter_value using message='page_limit';end if;
  for item in select * from jsonb_array_elements(p_page->'sourceTransactionKeys') loop
   key:=item#>>'{}';
   if jsonb_typeof(item)<>'string' or key!~'^[!-~]{1,64}$' then raise invalid_parameter_value using message='invalid_response';end if;
   insert into private.pg_settlement_source_keys(import_id,scan,transaction_key) values(job.id,job.scan,key);
  end loop;
  for item in select * from jsonb_array_elements(p_page->'records') loop
   perform private.pg_settlement_validate_record(item,job);key:=item->>'transactionKey';
   if not p_page->'sourceTransactionKeys' ? key then raise invalid_parameter_value using message='invalid_response';end if;
   if job.scan=1 then
    insert into private.pg_settlement_records(import_id,transaction_key,record,record_hash,kind,currency,sold_date,paid_out_date)
    values(job.id,key,item,encode(extensions.digest(item::text,'sha256'),'hex'),case when item->'cancel'='null'::jsonb then 'approval' else 'cancel' end,
     item->>'currency',(item->>'soldDate')::date,(item->>'paidOutDate')::date);
   else
    update private.pg_settlement_records set verified=true where import_id=job.id and transaction_key=key and not verified
     and record=item and record_hash=encode(extensions.digest(item::text,'sha256'),'hex');
    if not found then raise invalid_parameter_value using message='snapshot_changed';end if;
   end if;
  end loop;
  insert into private.pg_settlement_pages(import_id,scan,page,claim_id,source_count,record_count,source_hash,records_hash,input_hash,terminal)
  values(job.id,job.scan,job.next_page,p_claim_id,v_source_count,v_record_count,p_page->>'sourceHash',p_page->>'recordsHash',input_hash,is_terminal);
  if is_terminal and job.scan=2 then
   if exists(select 1 from private.pg_settlement_records where import_id=job.id and not verified) then raise invalid_parameter_value using message='snapshot_changed';end if;
   for item in select jsonb_build_object('id',id,'match',private.pg_settlement_match(record)) from private.pg_settlement_records where import_id=job.id loop
    matching:=item->'match';
    update private.pg_settlement_records set match_state=matching->>'state',match_reason=matching->>'reason',purpose=matching->>'purpose',
     reference_id=(matching->>'referenceId')::uuid,order_number=matching->>'orderNumber' where id=(item->>'id')::uuid;
   end loop;
   update private.pg_settlement_imports set state='complete',source_count=job.source_count+v_source_count,claim_id=null,lease_until=null,error_code=null,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=job.id;
   insert into public.audit_log(actor_id,action,target,diff) values(p_actor_id,'admin.pg_settlement.import_completed','pg-settlement:'||job.id::text,
    jsonb_build_object('importId',job.id,'mode',job.mode,'recordCount',job.record_count));
  elsif is_terminal then
   update private.pg_settlement_imports set state='verifying',scan=2,next_page=1,record_count=job.record_count+v_record_count,source_count=job.source_count+v_source_count,
    claim_id=null,lease_until=null,error_code=null,updated_at=clock_timestamp() where id=job.id;
  else
   update private.pg_settlement_imports set next_page=job.next_page+1,record_count=job.record_count+case when job.scan=1 then v_record_count else 0 end,
    source_count=job.source_count+v_source_count,claim_id=null,lease_until=null,error_code=null,updated_at=clock_timestamp() where id=job.id;
  end if;
 exception when unique_violation then failure:='duplicate_transaction';
 when data_exception then failure:=case when sqlerrm in('snapshot_changed','page_limit')then sqlerrm else 'invalid_response' end;
 end;
 if failure is not null then update private.pg_settlement_imports set state='failed',error_code=failure,claim_id=null,lease_until=null,updated_at=clock_timestamp() where id=job.id;end if;
 return jsonb_build_object('kind',case when failure is not null then 'failed' when is_terminal and job.scan=2 then 'complete' else 'accepted' end,'job',private.pg_settlement_job(job.id));
end $$;
revoke all on function public.service_finish_pg_settlement_import(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_finish_pg_settlement_import(uuid,uuid,uuid,text,jsonb) to service_role;

create function public.service_fail_pg_settlement_import(p_actor_id uuid,p_import_id uuid,p_claim_id uuid,p_scope_hash text,p_error text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare job private.pg_settlement_imports;
begin
 perform private.pg_settlement_require_actor(p_actor_id);
 select * into job from private.pg_settlement_imports where id=p_import_id for update;
 if not found or job.actor_id<>p_actor_id then raise insufficient_privilege using message='settlement_import_unavailable';end if;
 if job.state in('complete','failed') then return jsonb_build_object('kind',job.state,'job',private.pg_settlement_job(job.id));end if;
 if job.scope_hash is distinct from p_scope_hash then p_error:='scope_changed';
 elsif p_claim_id is null or job.claim_id is distinct from p_claim_id or job.lease_until<=clock_timestamp() then return jsonb_build_object('kind','stale','job',private.pg_settlement_job(job.id));end if;
 if p_error is null or p_error not in('invalid_request','invalid_response','merchant_mismatch','duplicate_transaction','provider_unavailable','provider_credentials','response_too_large','page_limit','scope_changed','snapshot_changed') then
  raise invalid_parameter_value using message='settlement_invalid_error';end if;
 update private.pg_settlement_imports set state=case when p_error='provider_unavailable' then job.state else 'failed' end,error_code=p_error,
  claim_id=null,lease_until=null,updated_at=clock_timestamp() where id=job.id;
 return jsonb_build_object('kind',case when p_error='provider_unavailable' then 'accepted' else 'failed' end,'job',private.pg_settlement_job(job.id));
end $$;
revoke all on function public.service_fail_pg_settlement_import(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_fail_pg_settlement_import(uuid,uuid,uuid,text,text) to service_role;

create function public.admin_get_pg_settlement_import(p_import_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.pg_settlement_require_actor(auth.uid());
 return (select private.pg_settlement_job(id) from private.pg_settlement_imports where id=p_import_id and actor_id=auth.uid());
end $$;
revoke all on function public.admin_get_pg_settlement_import(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_pg_settlement_import(uuid) to authenticated;

create function private.pg_settlement_report(p_query jsonb,p_export boolean default false) returns jsonb
language plpgsql stable set search_path='' as $$
declare q jsonb;job private.pg_settlement_imports;v_mode text;v_kind text;v_match text;v_search text;v_currency text;v_import uuid;
 v_page integer;v_size integer;v_total integer;v_transactions jsonb;v_totals jsonb;v_daily jsonb;v_fees jsonb;v_jobs jsonb;v_fingerprint text;
begin
 q:=private.pg_settlement_query(p_query);
 v_mode:=p_query->>'mode';v_kind:=coalesce(p_query->>'kind','all');v_match:=coalesce(p_query->>'match','all');
 v_search:=coalesce(p_query->>'query','');v_currency:=coalesce(p_query->>'currency','');
 if v_mode is null or v_mode not in('test','live') or v_kind not in('all','approval','cancel') or v_match not in('all','matched','unlinked','mismatch')
  or char_length(v_search)>100 or v_search~'[[:cntrl:]]' or (v_currency<>'' and v_currency!~'^[A-Z]{3}$')
  or coalesce(p_query->>'page','1')!~'^[0-9]{1,7}$' or coalesce(p_query->>'pageSize','20') not in('20','50','100')
  or (p_query->>'importId' is not null and p_query->>'importId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
  raise invalid_parameter_value using message='settlement_invalid_query';end if;
 v_page:=coalesce((p_query->>'page')::int,1);v_size:=coalesce((p_query->>'pageSize')::int,20);v_import:=(p_query->>'importId')::uuid;
 if v_page not between 1 and 1000000 then raise invalid_parameter_value using message='settlement_invalid_query';end if;
 select * into job from private.pg_settlement_imports where state='complete' and mode=v_mode and date_type=q->>'dateType'
  and start_date=(q->>'startDate')::date and end_date=(q->>'endDate')::date and (v_import is null or id=v_import)
  order by completed_at desc,id desc limit 1;
 select coalesce(jsonb_agg(private.pg_settlement_job(recent.id) order by recent.started_at desc,recent.id desc),'[]'::jsonb) into v_jobs
 from(select id,started_at from private.pg_settlement_imports where actor_id=auth.uid() and mode=v_mode and date_type=q->>'dateType'
  and start_date=(q->>'startDate')::date and end_date=(q->>'endDate')::date order by started_at desc,id desc limit 10)recent;
 -- This single relational statement provides every view of the exact same
 -- filtered immutable snapshot. Only whitelisted safe columns are projected.
 with filtered as materialized(
  select r.*,r.record as data,case when job.date_type='soldDate' then r.sold_date else r.paid_out_date end as report_date
  from private.pg_settlement_records r where r.import_id=job.id and (v_kind='all' or r.kind=v_kind)
   and (v_match='all' or r.match_state=v_match) and (v_currency='' or r.currency=v_currency)
   and (v_search='' or position(lower(v_search) in lower(coalesce(r.order_number,'')))>0
    or position(lower(v_search) in coalesce(r.reference_id::text,''))>0)
 ), money as materialized(
  select f.*,(data->>'amount')::numeric as amount,(data->>'interestFee')::numeric as interest_fee,
   coalesce((select sum((fee->>'fee')::numeric)from jsonb_array_elements(data->'fees')fee),0) as fee_amount,
   (data->>'supplyAmount')::numeric as supply_amount,(data->>'vat')::numeric as vat,(data->>'payOutAmount')::numeric as pay_out_amount,
   coalesce((data#>>'{cancel,cancelAmount}')::numeric,0) as cancel_amount from filtered f
 ), aggregates as(
  select currency,kind,report_date,count(*) as count,sum(amount) as amount,sum(interest_fee) as interest_fee,sum(fee_amount) as fee_amount,
   sum(supply_amount) as supply_amount,sum(vat) as vat,sum(pay_out_amount) as pay_out_amount,sum(cancel_amount) as cancel_amount,
   grouping(report_date) as is_total from money group by grouping sets((currency,kind),(currency,kind,report_date))
 ), rendered as(
  select is_total,report_date,currency,kind,jsonb_build_object('currency',currency,'kind',kind,'count',count,'amount',trim_scale(amount)::text,
   'interestFee',trim_scale(interest_fee)::text,'feeAmount',trim_scale(fee_amount)::text,'supplyAmount',trim_scale(supply_amount)::text,
   'vat',trim_scale(vat)::text,'payOutAmount',trim_scale(pay_out_amount)::text,'cancelAmount',trim_scale(cancel_amount)::text) value from aggregates
 ), fee_rows as(
  select f.currency,f.kind,fee->>'type' as type,count(distinct f.id) as count,trim_scale(sum((fee->>'fee')::numeric))::text as fee
  from filtered f cross join lateral jsonb_array_elements(f.data->'fees') fee group by f.currency,f.kind,fee->>'type'
 ), transactions as(
  select r.report_date,r.id,jsonb_build_object('id',r.id,'kind',r.kind,'currency',r.currency,'method',r.data->>'method',
   'amount',r.data->>'amount','interestFee',r.data->>'interestFee','fees',r.data->'fees','supplyAmount',r.data->>'supplyAmount',
   'vat',r.data->>'vat','payOutAmount',r.data->>'payOutAmount','cancelAmount',r.data#>>'{cancel,cancelAmount}',
   'approvedAt',r.data->>'approvedAt','soldDate',r.sold_date,'paidOutDate',r.paid_out_date,'canceledAt',r.data#>>'{cancel,canceledAt}',
   'matchState',r.match_state,'matchReason',r.match_reason,'purpose',r.purpose,'referenceId',r.reference_id,'orderNumber',r.order_number) as value
  from filtered r order by r.report_date desc,r.id limit case when p_export then 20000 else v_size end offset case when p_export then 0 else (v_page-1)*v_size end
 ) select (select count(*)from filtered),
  coalesce((select jsonb_agg(value order by report_date desc,id)from transactions),'[]'::jsonb),
  coalesce((select jsonb_agg(value order by currency,kind)from rendered where is_total=1),'[]'::jsonb),
  coalesce((select jsonb_agg(value||jsonb_build_object('date',report_date) order by report_date desc,currency,kind)from rendered where is_total=0),'[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(fee_rows)order by currency,kind,type)from fee_rows),'[]'::jsonb)
 into v_total,v_transactions,v_totals,v_daily,v_fees;
 if job.id is not null then
  v_fingerprint:=encode(extensions.digest(jsonb_build_object('version',1,'importId',job.id,'kind',v_kind,'match',v_match,'currency',v_currency,'query',v_search)::text,'sha256'),'hex');
 end if;
 return jsonb_build_object('query',q,'coverage',case when job.id is null then 'uncollected' when job.record_count=0 then 'empty' else 'complete' end,
  'snapshot',private.pg_settlement_job(job.id),'jobs',v_jobs,'totals',v_totals,'daily',v_daily,'transactions',v_transactions,'fees',v_fees,
  'pagination',jsonb_build_object('page',case when p_export then 1 else v_page end,'pageSize',case when p_export then 20000 else v_size end,'total',v_total),'fingerprint',v_fingerprint);
end $$;
revoke all on function private.pg_settlement_report(jsonb,boolean) from public,anon,authenticated,service_role;

create function public.admin_get_pg_settlement_report(p_query jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin perform private.pg_settlement_require_actor(auth.uid());return private.pg_settlement_report(p_query,false);end $$;
revoke all on function public.admin_get_pg_settlement_report(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_pg_settlement_report(jsonb) to authenticated;

create function public.admin_export_pg_settlement_report(p_query jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.pg_settlement_require_actor(auth.uid());
 if p_query->>'importId' is null then raise invalid_parameter_value using message='settlement_snapshot_required';end if;
 return private.pg_settlement_report(p_query,true);
end $$;
revoke all on function public.admin_export_pg_settlement_report(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_export_pg_settlement_report(jsonb) to authenticated;

create function public.admin_record_pg_settlement_export(p_query jsonb,p_fingerprint text,p_record_count integer) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;receipt uuid:=extensions.gen_random_uuid();
begin
 perform private.pg_settlement_require_actor(auth.uid());
 if p_query->>'importId' is null then raise invalid_parameter_value using message='settlement_snapshot_required';end if;
 result:=private.pg_settlement_report(p_query,true);
 if result->>'coverage'='uncollected' or p_fingerprint is null or p_fingerprint is distinct from result->>'fingerprint'
  or p_record_count is null or p_record_count<>(result#>>'{pagination,total}')::int then raise invalid_parameter_value using message='settlement_export_changed';end if;
 insert into public.audit_log(id,actor_id,action,target,diff) values(receipt,auth.uid(),'admin.pg_settlement.exported','pg-settlement:'||(result#>>'{snapshot,id}'),
  jsonb_build_object('importId',result#>>'{snapshot,id}','fingerprint',p_fingerprint,'recordCount',p_record_count,
   'dateType',result#>>'{snapshot,dateType}','startDate',result#>>'{snapshot,startDate}','endDate',result#>>'{snapshot,endDate}','mode',result#>>'{snapshot,mode}',
   'kind',coalesce(p_query->>'kind','all'),'match',coalesce(p_query->>'match','all'),'currency',coalesce(p_query->>'currency',''),'hasQuery',coalesce(p_query->>'query','')<>''));
 return receipt;
end $$;
revoke all on function public.admin_record_pg_settlement_export(jsonb,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_pg_settlement_export(jsonb,text,integer) to authenticated;

select private.register_operator_rpc_contract('public.service_create_pg_settlement_import(uuid,uuid,jsonb,text,text,text)'::regprocedure,'sales.manage','service_start',true);
select private.register_operator_rpc_contract('public.service_claim_pg_settlement_import(uuid,uuid,text)'::regprocedure,'sales.manage','service_start',true);
select private.register_operator_rpc_contract('public.service_finish_pg_settlement_import(uuid,uuid,uuid,text,jsonb)'::regprocedure,'sales.manage','service_finish',true);
select private.register_operator_rpc_contract('public.service_fail_pg_settlement_import(uuid,uuid,uuid,text,text)'::regprocedure,'sales.manage','service_finish',true);
select private.register_operator_rpc_contract('public.admin_get_pg_settlement_import(uuid)'::regprocedure,'sales.manage','read',true);
select private.register_operator_rpc_contract('public.admin_get_pg_settlement_report(jsonb)'::regprocedure,'sales.manage','read',true);
select private.register_operator_rpc_contract('public.admin_export_pg_settlement_report(jsonb)'::regprocedure,'sales.manage','read',true);
select private.register_operator_rpc_contract('public.admin_record_pg_settlement_export(jsonb,text,integer)'::regprocedure,'sales.manage','write',true);
select private.register_operator_internal_contract('private.pg_settlement_immutable()'::regprocedure);
select private.register_operator_internal_contract('private.pg_settlement_query(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.pg_settlement_job(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.pg_settlement_require_actor(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.pg_settlement_validate_record(jsonb,private.pg_settlement_imports)'::regprocedure);
select private.register_operator_internal_contract('private.pg_settlement_match(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.pg_settlement_report(jsonb,boolean)'::regprocedure);
notify pgrst,'reload schema';
