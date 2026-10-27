\set ON_ERROR_STOP on
-- IP-wide instant discount: beyond 100 goods, skip-and-report instead of all-or-nothing.
begin;
create function pg_temp.bulk_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%',p_message;end if;end $$;
create function pg_temp.bulk_error(p_sql text,p_error text) returns void language plpgsql as $$
begin begin execute p_sql;exception when others then if position(p_error in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected %',p_error;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values
 ('b9100000-0000-4000-8000-000000000001','authenticated','authenticated','bulk-ip-admin@example.test','{}',now(),now());
update public.profiles set role='admin',nickname='IP할인검증관리자' where id='b9100000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('b9100000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values('b9100000-0000-4000-8000-000000000011','b9100000-0000-4000-8000-000000000001',now(),now());
insert into public.ips(id,title,vertical_key) values('bulk-ip-main','TEST IP 일괄 할인','character'),('bulk-ip-other','TEST IP 일괄 다른 IP','character'),('bulk-ip-closed','TEST IP 보관','character');
update public.ips set archived_at=now() where id='bulk-ip-closed';
-- 105 live goods in the IP (above the 100-item selection limit), one archived, one in another IP.
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
 select 'bulk-ip-'||lpad(n::text,3,'0'),'bulk-ip-main','TEST IP 상품 '||n,'문구',10000,'ok',10 from generate_series(1,105) n;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,archived_at) values('bulk-ip-archived','bulk-ip-main','TEST IP 보관 상품','문구',10000,'ok',0,now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('bulk-ip-elsewhere','bulk-ip-other','TEST 다른 IP 상품','문구',10000,'ok',10);
-- Too cheap for a 1,000-won amount discount: skipped, not fatal.
update public.goods set price=900 where id='bulk-ip-002';
update public.goods_variants set price=900 where good_id='bulk-ip-002';
set local role authenticated;
select set_config('request.jwt.claim.sub','b9100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b9100000-0000-4000-8000-000000000001","session_id":"b9100000-0000-4000-8000-000000000011","role":"authenticated"}',true);
-- An existing overlapping discount on one good.
select public.admin_save_goods_price_period('bulk-ip-001',(select id from public.goods_variants where good_id='bulk-ip-001'),null,
 jsonb_build_object('state','active','discountPrice',9500,'startsAt',now()+interval '1 day','endsAt',now()+interval '3 days'),null);
create function pg_temp.ip_preview(p_number integer,p_command text,p_values jsonb,p_ip text default 'bulk-ip-main') returns jsonb
language sql as $$ select public.admin_preview_goods_bulk(md5('bulk-ip-test:'||p_number)::uuid,
 jsonb_build_object('kind','ip','ids',jsonb_build_array(p_ip),'command',p_command,'values',p_values),
 'b9100000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000011');$$;
create function pg_temp.ip_commit(p_number integer) returns jsonb language sql as $$
 select public.admin_commit_goods_bulk(md5('bulk-ip-test:'||p_number)::uuid,'b9100000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000011');$$;
select jsonb_build_object('mode','amount','value',1000,'startsAt',now()+interval '2 days','endsAt',now()+interval '4 days') as discount \gset
select pg_temp.ip_preview(1,'discount',:'discount') as preview \gset
select pg_temp.bulk_assert(jsonb_array_length(:'preview'::jsonb->'goods')=105
 and not exists(select 1 from jsonb_array_elements(:'preview'::jsonb->'goods') r where r->>'id' in ('bulk-ip-archived','bulk-ip-elsewhere')),'IP expansion beyond 100, excluding archived and other IPs');
select pg_temp.bulk_assert((select jsonb_object_agg(r->>'id',r->>'skip') from jsonb_array_elements(:'preview'::jsonb->'goods') r where r->>'skip' is not null)
 ='{"bulk-ip-001":"price_period_overlap","bulk-ip-002":"goods_bulk_price_invalid"}'::jsonb,'skip reasons frozen in preview');
reset role;
-- Ordinary sales between preview and commit do not reject a price-only batch.
select private.change_goods_variant_stock('bulk-ip-050',(select id from public.goods_variants where good_id='bulk-ip-050'),-1);
set local role authenticated;
select pg_temp.ip_commit(1) as receipt \gset
select pg_temp.bulk_assert(:'receipt'::jsonb->>'state'='completed' and (:'receipt'::jsonb->>'goodsCount')::int=103
 and jsonb_array_length(:'receipt'::jsonb->'skipped')=2,'applied the rest, reported skips');
reset role;
select pg_temp.bulk_assert((select count(*)=103 and bool_and(discount_price=9000) from private.goods_variant_price_periods where good_id like 'bulk-ip-%' and starts_at=now()+interval '2 days'),'discount on every applied good');
select pg_temp.bulk_assert(not exists(select 1 from private.goods_variant_price_periods where good_id in ('bulk-ip-002','bulk-ip-archived','bulk-ip-elsewhere')),'skipped and excluded goods untouched');
select pg_temp.bulk_assert((select count(*)=1 from private.goods_variant_price_periods where good_id='bulk-ip-001'),'overlapping good keeps its own discount');
select pg_temp.bulk_assert((select count(*)=1 from public.audit_log where action='catalog.goods_bulk.completed' and target='goods_bulk:'||md5('bulk-ip-test:1')::uuid::text),'one batch audit');
set local role authenticated;
select pg_temp.bulk_assert(pg_temp.ip_commit(1)=:'receipt'::jsonb,'repeat commit returns the stored receipt');
-- Discount stop shows every current/upcoming discount it will turn off (including individually set ones).
select pg_temp.ip_preview(2,'discount_stop','{}') as stop_preview \gset
select pg_temp.bulk_assert((select r->'discounts'->>'count'='1' and r->'discounts'->>'minPrice'='9500' and r->'skip'='null'::jsonb from jsonb_array_elements(:'stop_preview'::jsonb->'goods') r where r->>'id'='bulk-ip-001')
 and (select r->'discounts'->>'minPrice'='9000' from jsonb_array_elements(:'stop_preview'::jsonb->'goods') r where r->>'id'='bulk-ip-050')
 and (select r->>'skip'='no_active_discount' and r->'discounts'='null'::jsonb from jsonb_array_elements(:'stop_preview'::jsonb->'goods') r where r->>'id'='bulk-ip-002'),'stop preview lists discounts to turn off');
-- A base price change is refused at preview while a current/upcoming discount exists (same rule as the option price guard).
select pg_temp.bulk_error($q$select public.admin_preview_goods_bulk(md5('bulk-ip-test:price')::uuid,'{"kind":"goods","ids":["bulk-ip-050"],"command":"price","values":{"mode":"set","value":12000}}','b9100000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000011')$q$,'active_price_period_requires_reset');
-- The list projection explains why inline price edit is closed.
select pg_temp.bulk_assert((select jsonb_object_agg(r->>'id',r->'activeDiscountEndsAt' is distinct from 'null'::jsonb) from jsonb_array_elements(public.admin_goods_list_price_states(array['bulk-ip-050','bulk-ip-002'])) r)
 ='{"bulk-ip-050":true,"bulk-ip-002":false}'::jsonb,'list price state shows active discounts');
-- A changed option price still rejects the whole batch.
reset role;
update public.goods_variants set price=price+1 where good_id='bulk-ip-002';
set local role authenticated;
select pg_temp.bulk_assert(pg_temp.ip_commit(2)->>'error'='goods_bulk_changed','price change rejects');
-- Stop for real: goods without discounts are skipped and reported, the rest lose every active period.
select pg_temp.ip_preview(6,'discount_stop','{}');
select pg_temp.ip_commit(6) as stop_receipt \gset
select pg_temp.bulk_assert(:'stop_receipt'::jsonb->>'state'='completed' and (:'stop_receipt'::jsonb->>'goodsCount')::int=104
 and :'stop_receipt'::jsonb->'skipped' @> '[{"id":"bulk-ip-002","reason":"no_active_discount"}]'::jsonb and jsonb_array_length(:'stop_receipt'::jsonb->'skipped')=1,'stop skips goods without discounts');
reset role;
select pg_temp.bulk_assert(not exists(select 1 from private.goods_variant_price_periods where good_id like 'bulk-ip-%' and state='active'),'every active period stopped');
set local role authenticated;
select pg_temp.bulk_error($q$select pg_temp.ip_preview(7,'discount_stop','{}')$q$,'goods_bulk_no_active_discount');
select pg_temp.bulk_error($q$select public.admin_goods_list_price_states(array_fill('x'::text,array[101]))$q$,'invalid_goods_list_price_states');
select pg_temp.bulk_error($q$select pg_temp.ip_preview(3,'price','{"mode":"set","value":1000}')$q$,'goods_bulk_invalid');
select pg_temp.bulk_error($q$select pg_temp.ip_preview(4,'discount','{"mode":"rate","value":10,"startsAt":"2030-01-01T00:00:00Z","endsAt":"2030-01-02T00:00:00Z"}','bulk-ip-closed')$q$,'goods_bulk_ip_unavailable');
select pg_temp.bulk_error($q$select public.admin_preview_goods_bulk(gen_random_uuid(),'{"kind":"ip","ids":["bulk-ip-main","bulk-ip-other"],"command":"discount_stop","values":{}}','b9100000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000011')$q$,'goods_bulk_invalid');
reset role;
-- More than 1,000 goods in one IP: refused instead of an unbounded transaction.
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
 select 'bulk-ip-x'||lpad(n::text,4,'0'),'bulk-ip-other','TEST IP 대량 '||n,'문구',10000,'ok',1 from generate_series(1,1000) n;
set local role authenticated;
select pg_temp.bulk_error($q$select pg_temp.ip_preview(5,'discount_stop','{}','bulk-ip-other')$q$,'goods_bulk_target_limit');
reset role;
select pg_temp.bulk_assert(not has_function_privilege('anon','public.admin_goods_list_price_states(text[])','execute')
 and not has_function_privilege('service_role','public.admin_goods_list_price_states(text[])','execute')
 and not has_function_privilege('authenticated','private.goods_bulk_price_fingerprint(text)','execute')
 and not has_function_privilege('authenticated','private.goods_bulk_discount_price(integer,jsonb)','execute')
 and not has_function_privilege('anon','public.admin_preview_goods_bulk(uuid,jsonb,uuid,uuid)','execute'),'helper ACL');
rollback;
