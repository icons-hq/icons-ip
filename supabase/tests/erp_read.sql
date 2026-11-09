\set ON_ERROR_STOP on
-- ERP 데이터 읽기: service_role 만 · 업무 표 전체 목록 · 비밀 표·칸 차단 · 칸 고르기 · 값 거르기 · 키셋 이어 읽기.
-- 모든 픽스처는 되돌린다.
begin;
create function pg_temp.er_id(kind text,n integer) returns uuid language sql immutable as $$
 with source as(select md5('erp-read:'||kind||':'||n) value)
 select (substr(value,1,8)||'-'||substr(value,9,4)||'-4'||substr(value,14,3)||'-8'||substr(value,18,3)||'-'||substr(value,21,12))::uuid from source;
$$;
create function pg_temp.er_assert(condition boolean,label text) returns void language plpgsql as $$begin
 if condition is distinct from true then raise exception 'ERP read assertion: %',label;end if;
end $$;
create function pg_temp.er_raises(statement text,label text) returns void language plpgsql as $$begin
 execute statement;
 raise exception 'ERP read assertion: % (no error)',label;
exception when invalid_parameter_value then null;
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
 values(pg_temp.er_id('buyer',1),'authenticated','authenticated','erp-read@example.test',now(),'{}','{}','erp-read-password-hash');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
 values(pg_temp.er_id('origin',1),'erp-read-origin','읽기 합성 출고지',0,'합성 반송 주소');
insert into public.ips(id,title,vertical_key) values('erp-read-ip','읽기 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('erp-read-good','erp-read-ip','읽기 합성 굿즈','문구',1000,'ok',100,pg_temp.er_id('origin',1));
insert into private.goods_variant_external_identity(variant_id,erp_code,erp_name,barcode)
 select v.id,'ERP-READ-0001','읽기 합성 품목','8800000000028' from public.goods_variants v where v.good_id='erp-read-good' and v.is_default;
insert into public.orders(id,user_id,status,total,address,created_at,updated_at,payment_method)
 select pg_temp.er_id('order',n),pg_temp.er_id('buyer',1),'paid',2000+n,
  jsonb_build_object('recipientName','읽기 합성 수취인','phone','01000000000'),
  '2026-11-01T00:00:00Z','2026-11-01T00:00:00Z'::timestamptz+n*interval '1 minute','card'
 from generate_series(1,3)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.er_id('item',n),pg_temp.er_id('order',n),g.id,v.id,n,1000,g.name,g.type,g.ip_id
 from generate_series(1,3)n join public.goods g on g.id='erp-read-good' join public.goods_variants v on v.good_id=g.id and v.is_default;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider)
 values(pg_temp.er_id('payment',1),pg_temp.er_id('buyer',1),'order',pg_temp.er_id('order',1),2001,'paid','erp-read-payment-key','erp-read-idempotency','toss');

select pg_temp.er_assert(not has_function_privilege('anon','public.service_erp_read(text,text[],jsonb,jsonb,integer,boolean)','execute'),'anon cannot read');
select pg_temp.er_assert(not has_function_privilege('authenticated','public.service_erp_read(text,text[],jsonb,jsonb,integer,boolean)','execute'),'signed-in users cannot read');
select pg_temp.er_assert(has_function_privilege('service_role','public.service_erp_read(text,text[],jsonb,jsonb,integer,boolean)','execute'),'service role reads');
select pg_temp.er_assert(not has_function_privilege('service_role','private.erp_read_where(regclass,text[],text,jsonb,jsonb,timestamptz)','execute'),'helpers stay private');
select pg_temp.er_assert(not has_function_privilege('service_role','private.erp_read_settled_before()','execute'),'horizon helper stays private');
select pg_temp.er_assert(not has_function_privilege('anon','public.service_erp_note_access(text,text,text[],text[],integer)','execute')
 and not has_function_privilege('authenticated','public.service_erp_note_access(text,text,text[],text[],integer)','execute')
 and has_function_privilege('service_role','public.service_erp_note_access(text,text,text[],text[],integer)','execute'),'only the service role notes access');
select pg_temp.er_assert(not has_table_privilege('service_role','private.erp_read_access_log','select')
 and not has_table_privilege('service_role','private.erp_read_access_rollup','insert'),'access log is sealed even from the service role');
select pg_temp.er_assert((select provolatile from pg_proc where oid='public.service_erp_read(text,text[],jsonb,jsonb,integer,boolean)'::regprocedure)='v','read is volatile so the horizon precedes its snapshot');

-- 접근 기록의 단언을 위해 이 파일의 픽스처 앞뒤를 구분할 수 있게 비워 둔다(되돌리는 트랜잭션 안이라 다른 시험에 새지 않는다).
delete from private.erp_read_access_log;
delete from private.erp_read_access_rollup;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider,raw)
 values(pg_temp.er_id('payment',2),pg_temp.er_id('buyer',1),'order',pg_temp.er_id('order',2),2002,'paid','erp-read-payment-key-2','erp-read-idempotency-2','toss',
  '{"paymentKey":"erp-read-raw-payment-key","secret":"erp-read-raw-secret"}');

set local role service_role;
do $$ declare catalog jsonb; names text[]; secret_columns text; users jsonb;
begin
 catalog:=public.service_erp_read();
 select array_agg(t->>'name') into names from jsonb_array_elements(catalog->'tables') t;
 perform pg_temp.er_assert(names @> array['public.orders','public.order_items','public.payments','public.order_shipments',
  'public.order_shipment_items','private.order_item_external_identity_snapshots','auth.users'],'business tables are listed');
 perform pg_temp.er_assert(not names && array['private.billing_credentials','private.gift_link_tokens','private.operator_invitations',
  'private.gift_claim_sessions','auth.sessions','auth.refresh_tokens','private.erp_read_access_log','private.erp_read_access_rollup'],'secret tables are not listed');
 perform pg_temp.er_assert(not exists(select 1 from jsonb_array_elements(catalog->'tables') t cross join jsonb_array_elements(t->'columns') c
  where t->>'name'='public.payments' and c->>'name'='raw'),'raw provider payloads are not listed');
 select string_agg((t->>'name')||'.'||(c->>'name'),', ') into secret_columns
 from jsonb_array_elements(catalog->'tables') t cross join jsonb_array_elements(t->'columns') c
 where c->>'name' ~ '(^|_)(token|password|hash|digest|nonce|signature|credential)(_|$)|payment_key$' and c->>'name' !~ '^is_';
 perform pg_temp.er_assert(secret_columns is null,'no secret columns are listed: '||coalesce(secret_columns,''));
 select t into users from jsonb_array_elements(catalog->'tables') t where t->>'name'='auth.users';
 perform pg_temp.er_assert(users->'columns' @> '[{"name":"email"}]' and not users->'columns' @> '[{"name":"encrypted_password"}]','members carry email, never passwords');
 perform pg_temp.er_assert((select t->>'cursor' from jsonb_array_elements(catalog->'tables') t where t->>'name'='public.orders')='updated_at','orders page by updated_at');
end $$;

do $$ declare page jsonb; second jsonb; mine jsonb;
begin
 mine:=jsonb_build_object('id',(select jsonb_agg(pg_temp.er_id('order',n)) from generate_series(1,3)n));
 page:=public.service_erp_read('public.orders',null,null,mine,2);
 perform pg_temp.er_assert(jsonb_array_length(page->'rows')=2 and page->'next'->'key'->>'id'=pg_temp.er_id('order',2)::text,'first page of two with a cursor');
 perform pg_temp.er_assert(page->'rows'->0->'address'->>'recipientName'='읽기 합성 수취인','personal columns are sent');
 second:=public.service_erp_read('public.orders',null,page->'next',mine,2);
 perform pg_temp.er_assert(jsonb_array_length(second->'rows')=1 and second->'rows'->0->>'id'=pg_temp.er_id('order',3)::text
  and jsonb_typeof(second->'next')='null','second page continues after the cursor and ends');
 page:=public.service_erp_read('public.orders',array['total'],null,mine,10);
 perform pg_temp.er_assert((select array_agg(k order by k) from jsonb_object_keys(page->'rows'->0) k)=array['id','total','updated_at'],'picked columns plus key and cursor');
 page:=public.service_erp_read('public.order_items',null,null,jsonb_build_object('order_id',jsonb_build_array(pg_temp.er_id('order',2))),10);
 perform pg_temp.er_assert(jsonb_array_length(page->'rows')=1 and (page->'rows'->0->>'qty')::int=2,'value filter picks one order''s items');
 page:=public.service_erp_read('public.payments',null,null,jsonb_build_object('ref_id',jsonb_build_array(pg_temp.er_id('order',1))),10);
 perform pg_temp.er_assert(jsonb_array_length(page->'rows')=1 and not page->'rows'->0 ? 'payment_key'
  and page::text not like '%erp-read-payment-key%','payment keys never leave');
 page:=public.service_erp_read('public.payments',null,null,jsonb_build_object('ref_id',jsonb_build_array(pg_temp.er_id('order',2))),10);
 perform pg_temp.er_assert(jsonb_array_length(page->'rows')=1 and not page->'rows'->0 ? 'raw'
  and page::text not like '%erp-read-raw%','raw provider payloads never leave');
 page:=public.service_erp_read('auth.users',null,null,jsonb_build_object('id',jsonb_build_array(pg_temp.er_id('buyer',1))),10);
 perform pg_temp.er_assert(page->'rows'->0->>'email'='erp-read@example.test' and page::text not like '%erp-read-password-hash%','members without passwords');
 page:=public.service_erp_read('private.goods_variant_external_identity',null,null,null,1000,false);
 perform pg_temp.er_assert(page::text like '%ERP-READ-0001%','ERP codes are readable');
end $$;

select pg_temp.er_raises($q$select public.service_erp_read('private.billing_credentials')$q$,'secret table is refused');
select pg_temp.er_raises($q$select public.service_erp_read('public.nope')$q$,'unknown table is refused');
select pg_temp.er_raises($q$select public.service_erp_read('public.payments',null,null,'{"payment_key":["x"]}')$q$,'filtering on a secret column is refused');
select pg_temp.er_raises($q$select public.service_erp_read('public.orders',null,null,'{"id":"x"}')$q$,'filter values must be a list');
select pg_temp.er_raises($q$select public.service_erp_read('public.orders',null,null,'{"id":["not-a-uuid"]}')$q$,'an uncastable filter value is an invalid request');
-- 잘못된 커서가 0줄·next:null(끝)처럼 보이지 않는다.
select pg_temp.er_raises($q$select public.service_erp_read('public.orders',null,'{"wrong":1}')$q$,'cursor without at/key is refused');
select pg_temp.er_raises($q$select public.service_erp_read('public.orders',null,'{"at":null,"key":{"id":"00000000-0000-0000-0000-000000000000"}}')$q$,'cursor with null at is refused');
select pg_temp.er_raises($q$select public.service_erp_read('public.orders',null,'{"at":"2026-11-01T00:00:00Z","key":{"other":"x"}}')$q$,'cursor without the key column is refused');
select pg_temp.er_raises($q$select public.service_erp_read('public.orders',null,'{"at":"nope","key":{"id":"00000000-0000-0000-0000-000000000000"}}')$q$,'cursor with a bad time is refused');
reset role;

-- 접근 기록: 읽을 때마다 표·칸·거른 칸 이름·돌려준 줄 수가 남고, 값은 남지 않는다.
do $$ declare mine jsonb; before_count bigint; row record;
begin
 mine:=jsonb_build_object('id',(select jsonb_agg(pg_temp.er_id('order',n)) from generate_series(1,3)n));
 select count(*) into before_count from private.erp_read_access_log;
 perform pg_temp.er_assert(before_count>0,'earlier reads were logged');
 perform pg_temp.er_assert(not exists(select 1 from private.erp_read_access_log l where l.actor<>'ax-erp-sync'),'actor is fixed by the database');
 select * into row from private.erp_read_access_log l where l.table_name='public.order_items' and 'order_id'=any(l.filter_columns) order by id desc limit 1;
 perform pg_temp.er_assert(row.outcome='ok' and row.row_count=1 and row.filter_columns=array['order_id'],'filtered read is logged with column names and count');
 perform pg_temp.er_assert(row.column_names is null,'null means all permitted columns');
 perform pg_temp.er_assert(not exists(select 1 from private.erp_read_access_log l where l::text like '%erp-read-buyer%' or l::text like '%'||pg_temp.er_id('order',1)::text||'%'),'filter values are never stored');
 perform public.service_erp_read('public.orders',array['total'],null,mine,10);
 select * into row from private.erp_read_access_log l where l.table_name='public.orders' order by id desc limit 1;
 perform pg_temp.er_assert(row.column_names=array['total'],'chosen columns are recorded');
 -- 이어 읽기가 0줄이면(줄이 나가지 않았으므로) 건건이 쌓지 않고 집계만 오른다.
 before_count:=(select count(*) from private.erp_read_access_log);
 perform public.service_erp_read('public.ips',null,jsonb_build_object('at','2099-01-01T00:00:00Z','key',jsonb_build_object('id','zz')),null,10);
 perform pg_temp.er_assert((select count(*) from private.erp_read_access_log)=before_count,'idle poll adds no detail row');
 perform pg_temp.er_assert((select calls from private.erp_read_access_rollup r where r.table_name='public.ips' and r.outcome='idle')=1,'idle poll is rolled up');
 perform public.service_erp_note_access('rejected','public.orders',array['id'],array['id']);
 perform public.service_erp_note_access('denied',null,null,null,3);
 perform pg_temp.er_assert((select calls from private.erp_read_access_rollup r where r.outcome='denied')=3,'denied attempts are rolled up');
 perform pg_temp.er_assert(exists(select 1 from private.erp_read_access_log l where l.outcome='rejected' and l.table_name='public.orders'),'rejected read is recorded');
 perform public.service_erp_note_access('rejected','public.orders; drop table x',array['a;b','id'],array['who@example.test']);
 select * into row from private.erp_read_access_log l where l.outcome='rejected' order by id desc limit 1;
 perform pg_temp.er_assert(row.table_name is null and row.column_names=array['id'] and row.filter_columns is null,'only identifier-shaped names reach the log');
end $$;

-- 큰 줄: 한 응답 2 MB 안에서 끊고 next 를 돌려 쪽을 나눈다. 한 줄이 한도를 넘어도 표 전체가 막히지 않는다.
do $$ declare bulk jsonb; page jsonb; total integer:=0; after jsonb; rounds integer:=0;
begin
 update public.orders set address=jsonb_build_object('blob',repeat('가',400000)) where id=pg_temp.er_id('order',1);
 update public.orders set address=jsonb_build_object('blob',repeat('나',400000)) where id=pg_temp.er_id('order',2);
 update public.orders set address=jsonb_build_object('blob',repeat('다',400000)) where id=pg_temp.er_id('order',3);
 bulk:=jsonb_build_object('id',(select jsonb_agg(pg_temp.er_id('order',n)) from generate_series(1,3)n));
 set local role service_role;
 page:=public.service_erp_read('public.orders',null,null,bulk,1000);
 perform pg_temp.er_assert(jsonb_array_length(page->'rows') between 1 and 2 and octet_length(page::text)<4500000 and jsonb_typeof(page->'next')='object','page stops under the response limit and says there is more');
 loop
  rounds:=rounds+1; total:=total+jsonb_array_length(page->'rows');
  exit when jsonb_typeof(page->'next') is distinct from 'object' or rounds>5;
  page:=public.service_erp_read('public.orders',null,page->'next',bulk,1000);
 end loop;
 perform pg_temp.er_assert(total=3,'following next reaches every row');
 reset role;
 update public.orders set address=jsonb_build_object('blob',repeat('라',900000)) where id=pg_temp.er_id('order',1);
 set local role service_role;
 page:=public.service_erp_read('public.orders',null,null,jsonb_build_object('id',jsonb_build_array(pg_temp.er_id('order',1))),1000);
 perform pg_temp.er_assert(page->'rows'->0->>'_erp_read_omitted'='oversize_row' and page->'rows'->0->>'id'=pg_temp.er_id('order',1)::text and page->'rows'->0 ? 'updated_at'
  and jsonb_typeof(page->'next')='null','oversize row keeps its cursor columns');
 reset role;
end $$;
rollback;
