\set ON_ERROR_STOP on
begin;
create function pg_temp.bulk_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%',p_message;end if;end $$;
create function pg_temp.bulk_error(p_sql text,p_error text) returns void language plpgsql as $$
begin begin execute p_sql;exception when others then if position(p_error in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected %',p_error;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values
 ('b9000000-0000-4000-8000-000000000001','authenticated','authenticated','bulk-admin@example.test','{}',now(),now()),
 ('b9000000-0000-4000-8000-000000000002','authenticated','authenticated','bulk-buyer@example.test','{}',now(),now());
update public.profiles set role='admin',nickname='일괄검증관리자' where id='b9000000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('b9000000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('b9000000-0000-4000-8000-000000000011','b9000000-0000-4000-8000-000000000001',now(),now()),
 ('b9000000-0000-4000-8000-000000000012','b9000000-0000-4000-8000-000000000002',now(),now());
insert into public.ips(id,title,vertical_key) values('bulk-tests','TEST 일괄 변경','character');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-000000000001","session_id":"b9000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select public.admin_save_good('{"id":"bulk-a","ip_id":"bulk-tests","name":"TEST 일괄 A","price":10000,"variant_baseline":[],"variants":[{"name":"기본","attributes":{"색상":"빨강"},"extraPrice":0,"stockQty":9},{"name":"추가","attributes":{"색상":"파랑"},"extraPrice":2000,"stockQty":7}]}');
select public.admin_save_good('{"id":"bulk-b","ip_id":"bulk-tests","name":"TEST 일괄 B","price":20000,"variant_baseline":[],"variants":[{"name":"기본","attributes":{},"extraPrice":0,"stockQty":5}]}');
create function pg_temp.bulk_preview(p_number integer,p_command text,p_values jsonb default '{}',p_ids jsonb default '["bulk-a","bulk-b"]',p_kind text default 'goods') returns jsonb
language sql as $$ select public.admin_preview_goods_bulk(md5('bulk-test:'||p_number)::uuid,
 jsonb_build_object('kind',p_kind,'ids',p_ids,'command',p_command,'values',p_values),
 'b9000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000011');$$;
create function pg_temp.bulk_commit(p_number integer) returns jsonb language sql as $$
 select public.admin_commit_goods_bulk(md5('bulk-test:'||p_number)::uuid,'b9000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000011');$$;
select pg_temp.bulk_preview(1,'price','{"mode":"increase","value":500}');
select pg_temp.bulk_assert((select price=10000 from public.goods where id='bulk-a'),'preview never changes prices');
select pg_temp.bulk_assert(pg_temp.bulk_commit(1)->>'state'='completed','atomic price update');
select pg_temp.bulk_assert(pg_temp.bulk_commit(1)->>'state'='completed','same receipt on repeated commit');
select pg_temp.bulk_assert((select price=10500 from public.goods where id='bulk-a') and (select price=20500 from public.goods where id='bulk-b')
 and (select sum(stock_qty)=21 and min(price)=10500 and max(price)=20500 from public.goods_variants where good_id in ('bulk-a','bulk-b'))
 and (select price=12500 from public.goods_variants where good_id='bulk-a' and not is_default),'option increments and stock preserved');
reset role;
select pg_temp.bulk_assert((select count(*)=1 from public.audit_log where action='catalog.goods_bulk.completed' and target='goods_bulk:'||md5('bulk-test:1')::uuid::text),'one batch audit on replay');
set local role authenticated;
select pg_temp.bulk_preview(2,'stop');
select pg_temp.bulk_assert(pg_temp.bulk_commit(2)->>'state'='completed','stop');
select pg_temp.bulk_assert((select bool_and(stock='soldout') from public.goods where id in ('bulk-a','bulk-b')),'sales stop values');
select pg_temp.bulk_preview(3,'start');select pg_temp.bulk_assert(pg_temp.bulk_commit(3)->>'state'='completed','start');
select pg_temp.bulk_preview(4,'period',jsonb_build_object('startsAt',now()+interval '1 hour','endsAt',now()+interval '1 day'));
select pg_temp.bulk_assert(pg_temp.bulk_commit(4)->>'state'='completed','period');
select pg_temp.bulk_assert((select bool_and(sale_period_revision=1 and sale_starts_at=now()+interval '1 hour') from public.goods where id in ('bulk-a','bulk-b')),'period revisions');
select pg_temp.bulk_preview(5,'discount',jsonb_build_object('mode','rate','value',10,'startsAt',now()+interval '2 days','endsAt',now()+interval '3 days'));
select pg_temp.bulk_assert(pg_temp.bulk_commit(5)->>'state'='completed','discount');
reset role;
select pg_temp.bulk_assert((select count(*)=3 and min(discount_price)=9450 and max(discount_price)=18450 from private.goods_variant_price_periods where good_id in ('bulk-a','bulk-b') and state='active'),'discount each active variant');
set local role authenticated;
select public.admin_save_goods_price_period('bulk-b',(select id from public.goods_variants where good_id='bulk-b'),null,
 jsonb_build_object('state','active','discountPrice',20000,'startsAt',now()+interval '4 days','endsAt',now()+interval '5 days'),null);
-- Second product overlap rejects the entire transaction, including first product.
select pg_temp.bulk_preview(6,'discount',jsonb_build_object('mode','amount','value',100,'startsAt',now()+interval '4 days','endsAt',now()+interval '5 days'));
select pg_temp.bulk_assert(pg_temp.bulk_commit(6)->>'state'='rejected','overlap rejects');
select pg_temp.bulk_assert(pg_temp.bulk_commit(6)->>'state'='rejected','rejection is terminal');
select pg_temp.bulk_preview(7,'discount_stop');select pg_temp.bulk_assert(pg_temp.bulk_commit(7)->>'state'='completed','discount stop');
reset role;
select pg_temp.bulk_assert((select count(*)=4 and bool_and(state='disabled') from private.goods_variant_price_periods where good_id in ('bulk-a','bulk-b')),'no partial overlap additions');
set local role authenticated;
select pg_temp.bulk_preview(8,'price','{"mode":"set","value":15000}');
reset role;
select private.change_goods_variant_stock('bulk-b',(select id from public.goods_variants where good_id='bulk-b'),-1);
set local role authenticated;
select pg_temp.bulk_assert(pg_temp.bulk_commit(8)->>'error'='goods_bulk_changed','stock sold after preview rejects');
select pg_temp.bulk_assert((select price=10500 from public.goods where id='bulk-a') and (select price=20500 from public.goods where id='bulk-b'),'no partial price after conflict');
select pg_temp.bulk_preview(9,'stop');
reset role;update private.goods_bulk_operations set expires_at=clock_timestamp()-interval '1 second' where id=md5('bulk-test:9')::uuid;
set local role authenticated;
select pg_temp.bulk_assert(pg_temp.bulk_commit(9)->>'error'='goods_bulk_preview_expired','expired preview');
select pg_temp.bulk_preview(10,'stop');
select pg_temp.bulk_assert(public.admin_read_goods_bulk(md5('bulk-test:10')::uuid,'b9000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000011')->>'state'='unresolved','read never dispatches');
select pg_temp.bulk_assert(public.admin_read_goods_bulk(md5('bulk-test:10')::uuid,'b9000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000011',true)->>'state'='sealed','seal pending');
select pg_temp.bulk_assert(pg_temp.bulk_commit(10)->>'state'='sealed','sealed cannot dispatch');
select pg_temp.bulk_preview(11,'archive');select pg_temp.bulk_assert(pg_temp.bulk_commit(11)->>'error'='good_has_stock','archive requires empty stock');
reset role;
select private.change_goods_variant_stock(good_id,id,-stock_qty) from public.goods_variants where good_id in ('bulk-a','bulk-b');
set local role authenticated;
select pg_temp.bulk_preview(17,'archive');select pg_temp.bulk_assert(pg_temp.bulk_commit(17)->>'state'='completed','archive');
select pg_temp.bulk_preview(12,'restore');select pg_temp.bulk_assert(pg_temp.bulk_commit(12)->>'state'='completed','restore');
select pg_temp.bulk_assert((select bool_and(archived_at is null and published_at is null) from public.goods where id in ('bulk-a','bulk-b')),'restore preserves draft');
select pg_temp.bulk_preview(13,'publish');
select pg_temp.bulk_assert(pg_temp.bulk_commit(13)->>'state'='rejected','publication guards remain mandatory');
select pg_temp.bulk_assert((select bool_and(published_at is null) from public.goods where id in ('bulk-a','bulk-b')),'no partial publication');
select pg_temp.bulk_error($q$select pg_temp.bulk_preview(14,'price','{"mode":null,"value":1}')$q$,'goods_bulk_invalid');
select pg_temp.bulk_error($q$select pg_temp.bulk_preview(14,'stop','{}','["bulk-a","bulk-a"]')$q$,'goods_bulk_invalid');
select pg_temp.bulk_error($q$select pg_temp.bulk_preview(14,'price','{"mode":"percent_decrease","value":100}')$q$,'goods_bulk_invalid');
select pg_temp.bulk_error($q$select public.admin_commit_goods_bulk(md5('bulk-test:1')::uuid,'b9000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000012')$q$,'goods_group_auth_changed');
-- Normal group assembly followed by exact selected-group expansion and dissolve.
select public.admin_save_good('{"id":"bulk-group-a","ip_id":"bulk-tests","name":"TEST 그룹 A","price":10000}');
select public.admin_save_good('{"id":"bulk-group-b","ip_id":"bulk-tests","name":"TEST 그룹 B","price":10000}');
select public.admin_save_goods_group('b9000000-0000-4000-8000-000000000101',0,
 '{"name":"TEST 일괄 그룹","optionNames":["색상"],"members":[{"goodId":"bulk-group-a","values":["빨강"]},{"goodId":"bulk-group-b","values":["파랑"]}]}',
 'b9000000-0000-4000-8000-000000000102','b9000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000011');
select pg_temp.bulk_assert(jsonb_array_length(pg_temp.bulk_preview(15,'price','{"mode":"increase","value":1000}','["b9000000-0000-4000-8000-000000000101"]','groups')->'goods')=2,'group expansion');
select pg_temp.bulk_assert(pg_temp.bulk_commit(15)->>'state'='completed','group price update');
select pg_temp.bulk_preview(16,'dissolve','{}','["b9000000-0000-4000-8000-000000000101"]','groups');
select pg_temp.bulk_assert(pg_temp.bulk_commit(16)->>'state'='completed','group dissolve');
reset role;
select pg_temp.bulk_assert(not exists(select 1 from private.goods_group_members where group_id='b9000000-0000-4000-8000-000000000101')
 and (select count(*)=2 and bool_and(price=11000) from public.goods where id in ('bulk-group-a','bulk-group-b')),'dissolve retains products');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-000000000002","session_id":"b9000000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select pg_temp.bulk_error($q$select public.admin_commit_goods_bulk(md5('bulk-test:1')::uuid,'b9000000-0000-4000-8000-000000000002','b9000000-0000-4000-8000-000000000012')$q$,'operator_capability_required');
reset role;
select pg_temp.bulk_assert(not has_table_privilege('authenticated','private.goods_bulk_operations','select')
 and not has_function_privilege('anon','public.admin_commit_goods_bulk(uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_commit_goods_bulk(uuid,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.goods_bulk_fingerprint(text)','execute'),'private state and helper ACL');
rollback;
