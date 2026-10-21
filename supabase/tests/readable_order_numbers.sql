\set ON_ERROR_STOP on
begin;
create function pg_temp.number_assert(ok boolean,label text) returns void language plpgsql as $$begin
  if ok is distinct from true then raise exception 'Readable number assertion: %',label;end if;
end $$;
create function pg_temp.number_error(statement text,expected text) returns void language plpgsql as $$begin
  begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
  raise exception 'Expected error: %',expected;
end $$;

select pg_temp.number_assert(not exists(select 1 from public.orders where left(order_number,9)<>to_char(created_at at time zone 'Asia/Seoul','YYYYMMDD')||'1'), 'existing order dates retained');
select pg_temp.number_assert(not exists(select 1 from public.order_items i join public.orders o on o.id=i.order_id
  where left(product_order_number,9)<>left(o.order_number,8)||'2'), 'existing item numbers retain parent order date');
select pg_temp.number_assert(not exists(select 1 from public.order_shipments s join public.orders o on o.id=s.order_id
  where left(shipment_number,9)<>left(o.order_number,8)||'3'), 'existing shipment numbers retain parent order date');
select pg_temp.number_assert(not has_table_privilege('authenticated','private.commerce_number_counters','update')
  and not has_function_privilege('anon','private.next_commerce_number(timestamptz,smallint)','execute')
  and not has_function_privilege('authenticated','private.next_commerce_number(timestamptz,smallint)','execute')
  and not has_function_privilege('service_role','private.next_commerce_number(timestamptz,smallint)','execute'), 'number generator sealed');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('c6010000-0000-4000-8000-000000000001','authenticated','authenticated','readable-numbers@example.test','{}','{}',now(),now());
insert into public.orders(id,user_id,status,total,address,created_at)
values('c6010000-0000-4000-8000-000000000002','c6010000-0000-4000-8000-000000000001','pending',1000,'{}','2030-01-01T14:59:59Z'),
  ('c6010000-0000-4000-8000-000000000003','c6010000-0000-4000-8000-000000000001','pending',1000,'{}','2030-01-01T15:00:00Z');
select pg_temp.number_assert((select order_number='2030010110000001' from public.orders where id='c6010000-0000-4000-8000-000000000002'), 'before KST midnight');
select pg_temp.number_assert((select order_number='2030010210000001' from public.orders where id='c6010000-0000-4000-8000-000000000003'), 'after KST midnight resets sequence');
insert into public.orders(user_id,status,total,address,created_at)
select 'c6010000-0000-4000-8000-000000000001','pending',1000,'{}','2030-01-01T15:00:00Z'::timestamptz from generate_series(1,100);
select pg_temp.number_assert((select count(*)=count(distinct order_number) and count(*)=102 from public.orders where user_id='c6010000-0000-4000-8000-000000000001'), 'same timestamp orders stay unique');
select pg_temp.number_assert((select last_value=101 from private.commerce_number_counters where business_date='2030-01-02' and kind=1), 'counter advances from existing rows');
select pg_temp.number_error($sql$update public.orders set order_number='2030010119999999' where id='c6010000-0000-4000-8000-000000000002'$sql$,'commerce_number_immutable');
select pg_temp.number_error($sql$insert into public.orders(user_id,status,total,address,order_number) values('c6010000-0000-4000-8000-000000000001','pending',1000,'{}','2030010119999999')$sql$,'commerce_number_is_generated');
update private.commerce_number_counters set last_value=9999999 where business_date='2030-01-02' and kind=1;
select pg_temp.number_error($sql$select private.next_commerce_number('2030-01-01T15:00:00Z',1::smallint)$sql$,'commerce_number_counters_last_value_check');

set local role authenticated;
select set_config('request.jwt.claim.sub','c6010000-0000-4000-8000-000000000001',true);
select pg_temp.number_assert((select count(*)=102 from public.orders), 'existing owner RLS still limits numbered orders');
reset role;
rollback;
