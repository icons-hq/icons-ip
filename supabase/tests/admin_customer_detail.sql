\set ON_ERROR_STOP on
-- #430: exact customer, server paging, private notes, search masking and role boundaries.
begin;
select 1 / case when not has_function_privilege('anon','public.admin_customer_detail(uuid,text,integer)','execute')
 and not has_function_privilege('service_role','public.admin_add_customer_note(uuid,text,uuid)','execute')
 and not has_table_privilege('anon','public.customer_notes','select')
 and not has_table_privilege('authenticated','public.customer_notes','insert,update,delete')
 then 1 else 0 end as assert_customer_workspace_acl;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000004301','authenticated','authenticated','older@qa.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004302','authenticated','authenticated','customer-staff@qa.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004303','authenticated','authenticated','other-customer@qa.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff',nickname='상담 담당자' where id='00000000-0000-4000-8000-000000004302';
update public.profiles set nickname='오래된 고객',created_at='2000-01-01',consents='{"terms":true,"privacy":true,"marketing":false}'
 where id='00000000-0000-4000-8000-000000004301';
insert into public.orders(id,user_id,status,total,address,created_at)
select ('10000000-0000-4000-8000-'||lpad((430000+n)::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000004301','pending',12000,'{}','2026-09-01'::timestamptz+n*interval '1 hour'
 from generate_series(1,25) n;
insert into public.orders(id,user_id,status,total,address)
values ('10000000-0000-4000-8000-000000004399','00000000-0000-4000-8000-000000004303','pending',99999,'{}');
insert into public.inquiries(id,user_id,category,title,order_id)
values ('20000000-0000-4000-8000-000000004301','00000000-0000-4000-8000-000000004301','order','고객 주문 문의','10000000-0000-4000-8000-000000430001');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason)
values ('30000000-0000-4000-8000-000000004301','10000000-0000-4000-8000-000000430001','00000000-0000-4000-8000-000000004301','변심');
insert into public.coupons(code,name,discount_type,discount_value) values ('TEST430','고객 혜택','fixed',1000);
insert into public.user_coupons(id,coupon_code,user_id,issued_source,expires_at)
values ('40000000-0000-4000-8000-000000004301','TEST430','00000000-0000-4000-8000-000000004301','code_entry',now()-interval '1 day');
insert into public.coupons(code,name,discount_type,discount_value,starts_at,ends_at)
 values ('TEST430SHORT','기한 단축 쿠폰','fixed',1000,now()-interval '3 days',now()-interval '2 days');
insert into public.user_coupons(id,coupon_code,user_id,issued_source,expires_at)
 values ('40000000-0000-4000-8000-000000004302','TEST430SHORT','00000000-0000-4000-8000-000000004301','code_entry',now()+interval '1 day');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004302',true);
set local role authenticated;
do $$ declare d jsonb; d2 jsonb; begin
 d:=public.admin_customer_detail('00000000-0000-4000-8000-000000004301','orders',1);
 d2:=public.admin_customer_detail('00000000-0000-4000-8000-000000004301','orders',2);
 if d->'customer'->>'id' <> '00000000-0000-4000-8000-000000004301' or d->'customer'->>'email' <> 'older@qa.test'
 then raise exception 'wrong customer detail'; end if;
 if (d->>'total')::int <> 25 or jsonb_array_length(d->'items') <> 20 or jsonb_array_length(d2->'items') <> 5
 then raise exception 'customer orders pagination incorrect'; end if;
 if exists(select 1 from jsonb_array_elements(d->'items') a cross join jsonb_array_elements(d2->'items') b where a->>'id'=b->>'id')
 then raise exception 'customer pages overlap'; end if;
 if d::text like '%99999%' then raise exception 'other customer order leaked'; end if;
 if public.admin_customer_detail('00000000-0000-4000-8000-000000004309','overview',1) is not null
 then raise exception 'missing customer replaced'; end if;
 d:=public.admin_customer_detail('00000000-0000-4000-8000-000000004301','inquiries',1);
 if d->'items'->0->>'id' is distinct from '20000000-0000-4000-8000-000000004301' or d->'items'->0->>'title' <> '고객 주문 문의'
 then raise exception 'customer inquiry missing'; end if;
 d:=public.admin_customer_detail('00000000-0000-4000-8000-000000004301','claims',1);
 if d->'items'->0->>'id' is distinct from '30000000-0000-4000-8000-000000004301' or d->'items'->0->>'orderId' <> '10000000-0000-4000-8000-000000430001'
 then raise exception 'customer claim missing'; end if;
 d:=public.admin_customer_detail('00000000-0000-4000-8000-000000004301','coupons',1);
 if not exists(select 1 from jsonb_array_elements(d->'items') r where r->>'id'='40000000-0000-4000-8000-000000004301' and r->>'status'='expired')
 then raise exception 'expired customer coupon missing'; end if;
 if not exists(select 1 from jsonb_array_elements(d->'items') r where r->>'id'='40000000-0000-4000-8000-000000004302'
  and r->>'status'='expired' and (r->>'expiresAt')::timestamptz<now()) then raise exception 'shortened coupon expiry ignored'; end if;
end $$;
select public.admin_add_customer_note('00000000-0000-4000-8000-000000004301','내부 상담 메모','50000000-0000-4000-8000-000000004301');
select public.admin_add_customer_note('00000000-0000-4000-8000-000000004301','내부 상담 메모','50000000-0000-4000-8000-000000004301');
do $$ declare d jsonb; begin
 d:=public.admin_customer_detail('00000000-0000-4000-8000-000000004301','notes',1);
 if (d->>'total')::int <> 1 or d->'items'->0->>'body' is distinct from '내부 상담 메모'
   or d->'items'->0->>'authorName' <> '상담 담당자' then raise exception 'audited customer note not returned'; end if;
 if not exists(select 1 from public.audit_log where action='admin.customer.note_added'
   and actor_id='00000000-0000-4000-8000-000000004302' and target='profile:00000000-0000-4000-8000-000000004301'
   and diff->>'noteId'='50000000-0000-4000-8000-000000004301') then raise exception 'customer note audit missing'; end if;
 begin
  perform public.admin_add_customer_note('00000000-0000-4000-8000-000000004303','다른 고객 메모','50000000-0000-4000-8000-000000004301');
  raise exception 'customer note operation reused';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.admin_add_customer_note('00000000-0000-4000-8000-000000004301',E'\n\t ',gen_random_uuid());
  raise exception 'blank customer note accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.admin_add_customer_note('00000000-0000-4000-8000-000000004301',repeat('가',2001),gen_random_uuid());
  raise exception 'oversize customer note accepted';
 exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004301',true);
select 1 / case when (select count(*) from public.customer_notes)=0 then 1 else 0 end as assert_notes_hidden_from_customer;
do $$ begin
 begin
  perform public.admin_customer_detail('00000000-0000-4000-8000-000000004301','orders',1);
  raise exception 'customer opened staff detail';
 exception when insufficient_privilege then null; end;
 begin
  perform public.admin_add_customer_note('00000000-0000-4000-8000-000000004301','고객 직접 작성',gen_random_uuid());
  raise exception 'customer added internal note';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'n'||n||'older@qa.test',now(),'{}','{}',now(),now() from generate_series(1,25) n;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004302',true);
set local role authenticated;
select 1 / case when (select profile_id from public.admin_search_members('OLDER@QA.TEST',1,0))='00000000-0000-4000-8000-000000004301'
 then 1 else 0 end as assert_exact_email_finds_older_customer_first;
select 1 / case when (select masked_email from public.admin_search_members('OLDER@QA.TEST',1,0))='o***@qa.test'
 then 1 else 0 end as assert_search_still_masks_email;
reset role;
rollback;
