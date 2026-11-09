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

select pg_temp.er_assert(not has_function_privilege('anon','public.service_erp_read(text,text[],jsonb,jsonb,integer)','execute'),'anon cannot read');
select pg_temp.er_assert(not has_function_privilege('authenticated','public.service_erp_read(text,text[],jsonb,jsonb,integer)','execute'),'signed-in users cannot read');
select pg_temp.er_assert(has_function_privilege('service_role','public.service_erp_read(text,text[],jsonb,jsonb,integer)','execute'),'service role reads');
select pg_temp.er_assert(not has_function_privilege('service_role','private.erp_read_where(regclass,text[],text,jsonb,jsonb)','execute'),'helpers stay private');

set local role service_role;
do $$ declare catalog jsonb; names text[]; secret_columns text; users jsonb;
begin
 catalog:=public.service_erp_read();
 select array_agg(t->>'name') into names from jsonb_array_elements(catalog->'tables') t;
 perform pg_temp.er_assert(names @> array['public.orders','public.order_items','public.payments','public.order_shipments',
  'public.order_shipment_items','private.order_item_external_identity_snapshots','auth.users'],'business tables are listed');
 perform pg_temp.er_assert(not names && array['private.billing_credentials','private.gift_link_tokens','private.operator_invitations',
  'private.gift_claim_sessions','auth.sessions','auth.refresh_tokens'],'secret tables are not listed');
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
 page:=public.service_erp_read('auth.users',null,null,jsonb_build_object('id',jsonb_build_array(pg_temp.er_id('buyer',1))),10);
 perform pg_temp.er_assert(page->'rows'->0->>'email'='erp-read@example.test' and page::text not like '%erp-read-password-hash%','members without passwords');
 page:=public.service_erp_read('private.goods_variant_external_identity',null,null,null,1000);
 perform pg_temp.er_assert(page::text like '%ERP-READ-0001%','ERP codes are readable');
end $$;

select pg_temp.er_raises($q$select public.service_erp_read('private.billing_credentials')$q$,'secret table is refused');
select pg_temp.er_raises($q$select public.service_erp_read('public.nope')$q$,'unknown table is refused');
select pg_temp.er_raises($q$select public.service_erp_read('public.payments',null,null,'{"payment_key":["x"]}')$q$,'filtering on a secret column is refused');
select pg_temp.er_raises($q$select public.service_erp_read('public.orders',null,null,'{"id":"x"}')$q$,'filter values must be a list');
reset role;
rollback;
