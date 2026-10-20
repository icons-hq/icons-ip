\set ON_ERROR_STOP on
-- Rollback-only operator projection/export contract. No real provider or file IO.
begin;
create function pg_temp.gift_console_id(kind text,n integer) returns uuid language sql immutable as $$
 select md5('gift-operations-console:'||kind||':'||n)::uuid;
$$;
create function pg_temp.gift_console_assert(ok boolean,label text) returns integer language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Gift console: %',label;end if;return 1;
end $$;
create function pg_temp.gift_console_error(statement text,expected text) returns integer language plpgsql as $$begin
 begin execute statement;exception when others then
  if sqlstate=expected or sqlerrm=expected then return 1;end if;raise;
 end;raise exception 'Gift console expected rejection: %',expected;
end $$;
create temp table gift_console_values(key text primary key,value jsonb);
grant all on gift_console_values to authenticated,service_role;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select pg_temp.gift_console_id('actor',n),'authenticated','authenticated','gift-console-'||n||'@example.test',clock_timestamp(),
 '{"testFixture":"gift-operations-console"}','{}' from generate_series(1,6)n;
update public.profiles set role=case when id in(pg_temp.gift_console_id('actor',1),pg_temp.gift_console_id('actor',4),pg_temp.gift_console_id('actor',5))
 then 'admin'::public.user_role else 'user'::public.user_role end,
 nickname=case when id=pg_temp.gift_console_id('actor',3) then 'GCONSOLE SAFE 수신 닉네임' else 'GC검증'||right(id::text,8) end,
 birth_date='1990-01-01',onboarded_at=clock_timestamp(),consents='{"terms":true,"privacy":true}'
 where id in(select pg_temp.gift_console_id('actor',n) from generate_series(1,6)n);
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.gift_console_id('actor',1),'primary'),(pg_temp.gift_console_id('actor',4),'primary'),(pg_temp.gift_console_id('actor',5),'deputy');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key) values('gift-console-ip','TEST 선물 운영 IP','character');
insert into public.goods(id,ip_id,name,type,price) values('gift-console-good','gift-console-ip','TEST 선물 운영 상품','문구',981237654);
insert into public.orders(id,user_id,status,total,address,payment_method,checkout_key,expires_at)
 values(pg_temp.gift_console_id('order',1),pg_temp.gift_console_id('actor',2),'pending',981237654,null,'card',pg_temp.gift_console_id('checkout',1),clock_timestamp()+interval '1 hour');
insert into private.gift_intents(id,sender_id,recipient_id,state,message,sender_label,recipient_label,expires_at,accepted_at,closed_at,order_id,ordered_source_revision,created_at)
select pg_temp.gift_console_id('gift',n),pg_temp.gift_console_id('actor',2),
 case when n in(208,212,214) then pg_temp.gift_console_id('actor',3) end,
 case n when 208 then 'accepted' when 209 then 'declined' when 210 then 'expired' when 211 then 'canceled' when 212 then 'ordered' when 214 then 'accepted' else 'awaiting_acceptance' end,
 'GCONSOLE-PRIVATE-MESSAGE','GCONSOLE-BASE 보낸 닉네임',case when n in(208,212,214) then 'GCONSOLE SAFE 수신 닉네임' end,
 case when n in(210,213,214) then clock_timestamp()-interval '1 hour' else clock_timestamp()+interval '1 day' end,
 case when n in(208,212,214) then clock_timestamp()-interval '1 hour' end,
 case when n in(209,210,211) then clock_timestamp()-interval '1 minute' end,
 case when n=212 then pg_temp.gift_console_id('order',1) end,case when n=212 then 'TEST-console-order-binding' end,
 '2026-10-14T00:00:00Z'::timestamptz-(n||' seconds')::interval
from generate_series(1,214)n;
insert into private.gift_items(gift_id,position,good_id,variant_id,qty,input_revision,input_values,item_display)
select pg_temp.gift_console_id('gift',n),0,'gift-console-good',variant.id,2,19,'{"engraving":"GCONSOLE-PRIVATE-INPUT"}',
 jsonb_build_object('name',case n when 8 then 'GCONSOLE ITEM NEEDLE' else 'TEST 선물 상품' end,
 'variantName',case n when 7 then 'GCONSOLE VARIANT NEEDLE' else 'TEST 기본 옵션' end,
 'inputValues','GCONSOLE-PRIVATE-ITEM-DISPLAY','price',981237654,'phone','01099887766')
from generate_series(1,214)n cross join public.goods_variants variant where variant.good_id='gift-console-good' and variant.is_default;
insert into private.gift_items(gift_id,position,good_id,variant_id,qty,input_revision,input_values,item_display)
select pg_temp.gift_console_id('gift',1),1,'gift-console-good',id,1,0,'{}','{"name":"두 번째 상품","variantName":"다른 옵션"}'
from public.goods_variants where good_id='gift-console-good' and is_default;
insert into private.gift_recipient_addresses(gift_id,recipient_id,address)
values(pg_temp.gift_console_id('gift',208),pg_temp.gift_console_id('actor',3),
 '{"recipientName":"GCONSOLE-PRIVATE-RECIPIENT","phone":"01099887766","postalCode":"54321","address1":"GCONSOLE-PRIVATE-ADDRESS"}');
insert into private.gift_link_tokens(token_hash,gift_id,generation,expires_at)
values(repeat('f',64),pg_temp.gift_console_id('gift',1),1,clock_timestamp()+interval '1 day');
insert into private.gift_claim_sessions(session_hash,token_hash,expires_at)
values(repeat('e',64),repeat('f',64),clock_timestamp()+interval '10 minutes');

-- Four-role ACLs include PUBLIC (grantee=0); no raw private row is exposed.
do $$declare signature regprocedure;role_name text;begin
 foreach signature in array array['private.gift_console_state(private.gift_intents)'::regprocedure,'private.gift_console_row(uuid)'::regprocedure,
  'private.gift_console_query(text,text)'::regprocedure,'private.gift_console_ids(text,text)'::regprocedure] loop
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature and a.grantee=0) then
   raise exception 'Gift private helper has PUBLIC privilege';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   perform pg_temp.gift_console_assert(not has_function_privilege(role_name,signature,'execute'),'private helper sealed: '||role_name);
  end loop;
 end loop;
 foreach signature in array array['public.admin_list_gifts(uuid,text,text,integer,integer)'::regprocedure,'public.admin_prepare_gift_export(uuid,text,text)'::regprocedure] loop
  perform pg_temp.gift_console_assert(has_function_privilege('authenticated',signature,'execute')
   and not has_function_privilege('anon',signature,'execute') and not has_function_privilege('service_role',signature,'execute'),'operator RPC roles');
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature and a.grantee=0) then raise exception 'Gift operator RPC PUBLIC privilege';end if;
 end loop;
 foreach signature in array array['public.service_record_gift_export(uuid,uuid,text,text)'::regprocedure,'public.service_purge_gift_exports(integer)'::regprocedure] loop
  perform pg_temp.gift_console_assert(has_function_privilege('service_role',signature,'execute')
   and not has_function_privilege('anon',signature,'execute') and not has_function_privilege('authenticated',signature,'execute'),'service RPC roles');
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature and a.grantee=0) then raise exception 'Gift service RPC PUBLIC privilege';end if;
 end loop;
 perform pg_temp.gift_console_assert((select relrowsecurity from pg_class where oid='private.gift_export_receipts'::regclass),'receipt RLS enabled');
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.gift_console_assert(not has_table_privilege(role_name,'private.gift_export_receipts','select,insert,update,delete'),'receipt table sealed');
 end loop;
 perform pg_temp.gift_console_assert(not exists(select 1 from pg_class p cross join lateral aclexplode(coalesce(p.relacl,acldefault('r',p.relowner))) a
  where p.oid='private.gift_export_receipts'::regclass and a.grantee=0),'receipt PUBLIC sealed');
end $$;

set local role anon;
select pg_temp.gift_console_error('select public.admin_list_gifts(null)','42501') as anon_list_denied;
select pg_temp.gift_console_error('select * from private.gift_export_receipts','42501') as anon_receipts_denied;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.gift_console_id('actor',1)::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.gift_console_error('select * from private.gift_intents','42501') as authenticated_raw_gifts_denied;
select pg_temp.gift_console_error('select * from private.gift_recipient_addresses','42501') as authenticated_raw_addresses_denied;
select pg_temp.gift_console_error('select * from private.gift_export_receipts','42501') as authenticated_raw_receipts_denied;
select pg_temp.gift_console_error('select public.service_purge_gift_exports()','42501') as authenticated_service_denied;
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',4))','42501') as expected_actor_mismatch_denied;
insert into gift_console_values values('default',public.admin_list_gifts(pg_temp.gift_console_id('actor',1))),
 ('page1',public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'awaiting_acceptance','GCONSOLE-BASE',1,200)),
 ('page2',public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'awaiting_acceptance','GCONSOLE-BASE',2,200)),
 ('all',public.admin_list_gifts(pg_temp.gift_console_id('actor',1),null,'GCONSOLE-BASE',1,200));
select pg_temp.gift_console_assert((select value->>'pageSize'='100' and not exists(select 1 from jsonb_array_elements(value->'rows') row where row->>'state'<>'awaiting_acceptance')
 from gift_console_values where key='default'),'default waiting state and 100 rows') as default_waiting_contract;
select pg_temp.gift_console_assert((select value->>'total'='207' and jsonb_array_length(value->'rows')=200 from gift_console_values where key='page1')
 and (select value->>'total'='207' and jsonb_array_length(value->'rows')=7 from gift_console_values where key='page2')
 and not exists(select 1 from jsonb_array_elements((select value->'rows' from gift_console_values where key='page1')) a
  join jsonb_array_elements((select value->'rows' from gift_console_values where key='page2')) b on a->>'id'=b->>'id'),
 '207 rows span two disjoint pages with consistent count') as complete_pagination_over_200;
select pg_temp.gift_console_assert((select value#>>'{rows,0,id}'=pg_temp.gift_console_id('gift',1)::text
 and value#>>'{rows,0,quantity}'='3' and value#>>'{rows,0,goodsLabel}' like '%'||E'\n'||'두 번째 상품 / 다른 옵션 × 1' from gift_console_values where key='page1'),
 'stable ordering and full quantity/display') as stable_rows_and_quantities;
select pg_temp.gift_console_assert(public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'awaiting_acceptance','GCONSOLE-BASE',1,50)->>'pageSize'='50'
 and jsonb_array_length(public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'awaiting_acceptance','GCONSOLE-BASE',1,100)->'rows')=100
 and jsonb_array_length(public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'awaiting_acceptance','GCONSOLE-BASE',5,200)->'rows')=0,'50/100/200 sizes and empty later page') as allowed_page_sizes;
select pg_temp.gift_console_assert((select value->>'total'='214' from gift_console_values where key='all')
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'accepted','GCONSOLE-BASE')->>'total'='1'
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'ordered','GCONSOLE-BASE')->>'total'='1'
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'declined','GCONSOLE-BASE')->>'total'='1'
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'canceled','GCONSOLE-BASE')->>'total'='1'
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'expired','GCONSOLE-BASE')->>'total'='3','six states and effective expiry') as all_six_states_and_effective_expiry;
select pg_temp.gift_console_assert(public.admin_list_gifts(pg_temp.gift_console_id('actor',1),null,'gconsole variant needle')->>'total'='1'
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),null,'GCONSOLE ITEM NEEDLE')->>'total'='1'
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),null,pg_temp.gift_console_id('gift',1)::text)->>'total'='1'
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),null,pg_temp.gift_console_id('order',1)::text)->>'total'='1'
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),null,'GCONSOLE SAFE 수신 닉네임')->>'total'='3','safe search domains') as search_id_order_name_variant_nickname;
select pg_temp.gift_console_assert(public.admin_list_gifts(pg_temp.gift_console_id('actor',1),null,'GCONSOLE-PRIVATE')->>'total'='0'
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),null,'01099887766')->>'total'='0'
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),null,repeat('f',64))->>'total'='0'
 and (select bool_and(value::text !~ '(GCONSOLE-PRIVATE|01099887766|981237654|inputValues|address1|phone|token|message|senderId|recipientId)') from gift_console_values),
 'private fields and private search excluded') as projection_and_search_have_no_private_leaks;
select pg_temp.gift_console_assert(not exists(select 1 from gift_console_values v cross join lateral jsonb_array_elements(v.value->'rows') row
 where row-array['id','state','senderName','recipientName','goodsLabel','quantity','createdAt','expiresAt','acceptedAt','orderId']<>'{}'::jsonb)
 and public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'accepted','GCONSOLE-BASE')#>>'{rows,0,recipientName}'='GCONSOLE SAFE 수신 닉네임',
 'closed projection and nickname-only recipient') as closed_row_dto;
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',1),''paid'')','22023') as invalid_state_denied;
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',1),null,null)','22023') as null_search_denied;
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',1),null,'' x '')','22023') as untrimmed_search_denied;
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',1),null,repeat(''x'',101))','22023') as oversized_search_denied;
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',1),null,chr(10))','22023') as control_search_denied;
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',1),null,'''',0,100)','22023') as invalid_page_denied;
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',1),null,'''',1,20)','22023') as invalid_page_size_denied;

-- This SQL receipt is the exact rows/fingerprint the XLSX writer receives.
insert into gift_console_values values('export',public.admin_prepare_gift_export(pg_temp.gift_console_id('actor',1),'awaiting_acceptance','GCONSOLE-BASE'));
select pg_temp.gift_console_assert((select value->>'total'='207' and value->'rows'=
 (select value->'rows' from gift_console_values where key='page1')||(select value->'rows' from gift_console_values where key='page2')
 from gift_console_values where key='export'),'export contains every filtered page in the same order') as export_not_limited_to_visible_page;
reset role;
select pg_temp.gift_console_assert((select r.payload=v.value->'rows' and r.fingerprint=v.value->>'fingerprint'
 and r.fingerprint=encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') and r.snapshot_at=(v.value->>'asOf')::timestamptz
 and r.expires_at-r.created_at between interval '9 minutes 59 seconds' and interval '10 minutes 1 second'
 from private.gift_export_receipts r join gift_console_values v on r.id=(v.value->>'receiptId')::uuid where v.key='export'),
 'stored export rows/hash/asOf and ten-minute receipt') as snapshot_payload_fingerprint_and_ttl;

-- Same statement timestamp across an intentional delay: state and asOf must
-- agree even when wall-clock expiry occurs before the export query finishes.
insert into private.gift_intents(id,sender_id,state,sender_label,expires_at)
values(pg_temp.gift_console_id('boundary',1),pg_temp.gift_console_id('actor',2),'awaiting_acceptance','GCONSOLE-BOUNDARY',clock_timestamp()+interval '1 hour');
do $$declare document jsonb;begin
 update private.gift_intents set expires_at=statement_timestamp() where id=pg_temp.gift_console_id('boundary',1);
 document:=public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'expired','GCONSOLE-BOUNDARY',1,50);
 perform pg_temp.gift_console_assert(document->>'total'='1' and (document->>'asOf')::timestamptz=statement_timestamp(),'expiry includes exact asOf boundary');
end $$;
do $$declare document jsonb;expires timestamptz;begin
 expires:=clock_timestamp()+interval '10 milliseconds';
 update private.gift_intents set expires_at=expires where id=pg_temp.gift_console_id('boundary',1);
 perform pg_sleep(0.05);
 document:=public.admin_prepare_gift_export(pg_temp.gift_console_id('actor',1),'awaiting_acceptance','GCONSOLE-BOUNDARY');
 perform pg_temp.gift_console_assert(clock_timestamp()>expires and document->>'total'='1'
  and (document->>'asOf')::timestamptz=statement_timestamp() and (document->>'asOf')::timestamptz<expires,
  'export asOf uses state snapshot rather than later receipt clock');
end $$;

-- Rights are evaluated again when the generated encrypted file is audited.
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.gift_console_id('actor',2)::text,true);
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',2))','42501') as ordinary_customer_denied;
select pg_temp.gift_console_error('select public.admin_prepare_gift_export(pg_temp.gift_console_id(''actor'',2))','42501') as ordinary_export_denied;
select set_config('request.jwt.claim.sub',pg_temp.gift_console_id('actor',5)::text,true);
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',5))','42501') as manager_without_sales_read_denied;
reset role;
update public.profiles set role='user' where id=pg_temp.gift_console_id('actor',1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.gift_console_id('actor',1)::text,true);
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',1))','42501') as profile_role_loss_denied;
reset role;
update public.profiles set role='admin' where id=pg_temp.gift_console_id('actor',1);
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.gift_console_id('actor',1);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.gift_console_error('select * from private.gift_export_receipts','42501') as service_raw_receipts_denied;
select pg_temp.gift_console_error('select public.admin_list_gifts(pg_temp.gift_console_id(''actor'',1))','42501') as service_operator_rpc_denied;
select pg_temp.gift_console_error(format('select public.service_record_gift_export(%L,%L,%L,%L)',pg_temp.gift_console_id('actor',1),value->>'receiptId',value->>'fingerprint',repeat('a',64)),
 '42501') as capability_rechecked_after_prepare from gift_console_values where key='export';
reset role;
update private.operator_memberships set manager_role='primary' where profile_id=pg_temp.gift_console_id('actor',1);
update private.gift_intents set state='declined',closed_at=clock_timestamp() where id=pg_temp.gift_console_id('gift',1);
set local role service_role;
select pg_temp.gift_console_error(format('select public.service_record_gift_export(%L,%L,%L,%L)',pg_temp.gift_console_id('actor',4),value->>'receiptId',value->>'fingerprint',repeat('a',64)),
 'gift_export_changed') as receipt_actor_binding from gift_console_values where key='export';
select pg_temp.gift_console_error(format('select public.service_record_gift_export(%L,%L,%L,%L)',pg_temp.gift_console_id('actor',1),value->>'receiptId',repeat('b',64),repeat('a',64)),
 'gift_export_changed') as fingerprint_mismatch_denied from gift_console_values where key='export';
select pg_temp.gift_console_error(format('select public.service_record_gift_export(%L,%L,%L,%L)',pg_temp.gift_console_id('actor',1),value->>'receiptId',value->>'fingerprint','invalid'),
 'gift_export_changed') as file_hash_malformed_denied from gift_console_values where key='export';
insert into gift_console_values select 'fileAudit',to_jsonb(public.service_record_gift_export(pg_temp.gift_console_id('actor',1),(value->>'receiptId')::uuid,value->>'fingerprint',repeat('a',64)))
 from gift_console_values where key='export';
reset role;
select pg_temp.gift_console_assert((select a.actor_id=pg_temp.gift_console_id('actor',1) and a.action='admin.gift_export.file_issued'
 and a.diff->>'rowCount'='207' and a.diff->>'fileSha256'=repeat('a',64) and a.diff->>'encryption'='ECMA-376-Agile' and a.diff->>'format'='xlsx'
 and a.diff->>'fingerprint'=v.value->>'fingerprint' and a.diff::text !~ '(GCONSOLE-PRIVATE|address|phone|inputValues|token|message)'
 from public.audit_log a cross join gift_console_values v where a.id=((select value from gift_console_values where key='fileAudit')#>>'{}')::uuid and v.key='export'),
 'file audit stores safe snapshot/hash identity') as encrypted_file_audit;
select pg_temp.gift_console_assert((select r.payload=v.value->'rows' and jsonb_array_length(r.payload)=207
 from private.gift_export_receipts r join gift_console_values v on r.id=(v.value->>'receiptId')::uuid where v.key='export'),
 'source changes do not rewrite frozen export') as snapshot_survives_source_change;
update private.gift_export_receipts set expires_at=clock_timestamp()-interval '1 second' where id=(select (value->>'receiptId')::uuid from gift_console_values where key='export');
set local role service_role;
select pg_temp.gift_console_error(format('select public.service_record_gift_export(%L,%L,%L,%L)',pg_temp.gift_console_id('actor',1),value->>'receiptId',value->>'fingerprint',repeat('a',64)),
 'gift_export_changed') as expired_receipt_not_issued from gift_console_values where key='export';
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.gift_console_error('select public.service_purge_gift_exports()','42501') as service_role_claim_required;
select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.gift_console_error('select public.service_purge_gift_exports(1001)','22023') as bounded_purge_limit;
reset role;
insert into private.gift_export_receipts(id,actor_id,filters,payload,fingerprint,created_at,expires_at)
select pg_temp.gift_console_id('old-receipt',n),pg_temp.gift_console_id('actor',1),'{}','[]',encode(sha256(convert_to('[]','UTF8')),'hex'),
 clock_timestamp()-((24+n)||' hours')::interval,clock_timestamp()-interval '24 hours' from generate_series(1,2)n;
set local role service_role;
select pg_temp.gift_console_assert(public.service_purge_gift_exports(1)=1,'purge bounded to one old payload') as purge_one_old_receipt;
reset role;
select pg_temp.gift_console_assert(not exists(select 1 from private.gift_export_receipts where id=pg_temp.gift_console_id('old-receipt',2))
 and exists(select 1 from private.gift_export_receipts where id=pg_temp.gift_console_id('old-receipt',1))
 and exists(select 1 from private.gift_export_receipts where id=(select (value->>'receiptId')::uuid from gift_console_values where key='export')),
 'oldest payload removed; recent ten-minute-expired receipt kept until 24h') as purge_age_and_oldest_order;
set local role service_role;
select pg_temp.gift_console_assert(public.service_purge_gift_exports(1000)=1,'remaining older-than-24h payload removed') as purge_remaining_old_receipt;
reset role;
update private.gift_export_receipts set created_at=clock_timestamp()-interval '25 hours'
where id=(select (value->>'receiptId')::uuid from gift_console_values where key='export');
set local role service_role;
select pg_temp.gift_console_assert(public.service_purge_gift_exports(1)=1,'audited payload is removed after 24h') as purge_audited_payload;
reset role;
select pg_temp.gift_console_assert(not exists(select 1 from private.gift_export_receipts where id=(select (value->>'receiptId')::uuid from gift_console_values where key='export'))
 and exists(select 1 from public.audit_log where id=((select value from gift_console_values where key='fileAudit')#>>'{}')::uuid),
 'file audit outlives payload purge') as file_audit_retained;

-- Full export cap applies to matches, not the visible 200-row page.
insert into private.gift_intents(id,sender_id,state,sender_label,expires_at)
select pg_temp.gift_console_id('bulk',n),pg_temp.gift_console_id('actor',2),'awaiting_acceptance','GCONSOLE-BULK',clock_timestamp()+interval '1 day'
from generate_series(1,10001)n;
insert into private.gift_items(gift_id,position,good_id,variant_id,qty,input_revision,input_values,item_display)
select pg_temp.gift_console_id('bulk',n),0,'gift-console-good',v.id,1,0,'{}','{"name":"대량 검증 상품"}'
from generate_series(1,10001)n cross join public.goods_variants v where v.good_id='gift-console-good' and v.is_default;
insert into gift_console_values select 'receiptCountBeforeLimit',to_jsonb(count(*)) from private.gift_export_receipts;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.gift_console_id('actor',1)::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.gift_console_assert(public.admin_list_gifts(pg_temp.gift_console_id('actor',1),'awaiting_acceptance','GCONSOLE-BULK',2,200)->>'total'='10001',
 'large list still returns full filtered count') as large_list_complete_count;
select pg_temp.gift_console_error('select public.admin_prepare_gift_export(pg_temp.gift_console_id(''actor'',1),''awaiting_acceptance'',''GCONSOLE-BULK'')',
 'gift_export_limit') as export_10001_rejected;
reset role;
select pg_temp.gift_console_assert((select count(*) from private.gift_export_receipts)=((select value from gift_console_values where key='receiptCountBeforeLimit')#>>'{}')::integer,
 'over-limit export writes no partial receipt') as no_partial_over_limit_receipt;
update private.gift_intents set state='canceled',closed_at=clock_timestamp() where id=pg_temp.gift_console_id('bulk',10001);
set local role authenticated;
insert into gift_console_values values('bulkExport',public.admin_prepare_gift_export(pg_temp.gift_console_id('actor',1),'awaiting_acceptance','GCONSOLE-BULK'));
select pg_temp.gift_console_assert((select value->>'total'='10000' and jsonb_array_length(value->'rows')=10000 from gift_console_values where key='bulkExport'),
 'exactly 10000 rows can be exported completely') as export_exactly_10000_allowed;
reset role;
rollback;
