\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin
    perform public.admin_save_good('{}');
  exception when invalid_authorization_specification then
    if sqlerrm='auth_required' then return; end if;
    raise;
  end;
  raise exception 'existing unauthenticated save contract must be preserved';
end $$;
create function pg_temp.good_payload(good_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',good_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[good_id]) record;
$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000050801','authenticated','authenticated','discount-display-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000050801';
insert into public.verticals(key,label,color) values('discount-display','할인 표시 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('discount-display','할인 표시 검증','discount-display',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050801',true);
select public.admin_save_good('{"id":"discount-display-good","ip_id":"discount-display","name":"할인 표시 검증","price":9000,"compare_at_price":12000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"DISCOUNT-DISPLAY-1","attributes":{},"extraPrice":0,"stockQty":10}]}');
select 1/case when (select show_discount_rate from public.goods where id='discount-display-good') then 1 else 0 end as assert_legacy_default_on;
select public.admin_save_good(pg_temp.good_payload('discount-display-good')||'{"show_discount_rate":false}');
select 1/case when exists(select 1 from public.goods where id='discount-display-good' and not show_discount_rate and price=9000 and compare_at_price=12000)
 then 1 else 0 end as assert_display_off_preserves_prices;
select public.admin_save_good(pg_temp.good_payload('discount-display-good')-'show_discount_rate');
select public.admin_save_good(pg_temp.good_payload('discount-display-good')||'{"show_discount_rate":false}');
reset role;
select 1/case when (select count(*) from public.audit_log where target='goods:discount-display-good' and action='admin.good.discount_display_saved')=1
 and exists(select 1 from public.audit_log where target='goods:discount-display-good' and action='admin.good.discount_display_saved'
   and diff#>>'{before,show_discount_rate}'='true' and diff#>>'{after,show_discount_rate}'='false')
 and not (select show_discount_rate from public.goods where id='discount-display-good')
 then 1 else 0 end as assert_one_audit_and_omission_preservation;
set local role authenticated;
do $$ begin
  begin
    perform public.admin_save_good(pg_temp.good_payload('discount-display-good')||'{"show_discount_rate":"false"}');
  exception when invalid_parameter_value then return;
  end;
  raise exception 'discount display must reject non-boolean values';
end $$;
select public.admin_clone_good('00000000-0000-4000-8000-000000050802','discount-display-good','discount-display-copy','DISCOUNT-COPY','복사 표시 검증');
select 1/case when not (select show_discount_rate from public.goods where id='discount-display-copy') then 1 else 0 end as assert_clone_preserves_display;
select public.admin_save_good(pg_temp.good_payload('discount-display-copy')||'{"show_discount_rate":true}');
select public.admin_clone_good('00000000-0000-4000-8000-000000050802','discount-display-good','discount-display-copy','DISCOUNT-COPY','복사 표시 검증');
select 1/case when (select show_discount_rate from public.goods where id='discount-display-copy') then 1 else 0 end as assert_clone_replay_does_not_overwrite_later_edits;
reset role;
select 1/case when not has_function_privilege('anon','public.admin_save_good(jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_save_good(jsonb)','execute')
 and not has_function_privilege('anon','private.apply_goods_discount_display(text,boolean)','execute')
 and not has_function_privilege('authenticated','private.apply_goods_discount_display(text,boolean)','execute')
 and not has_function_privilege('service_role','private.apply_goods_discount_display(text,boolean)','execute')
 then 1 else 0 end as assert_discount_display_writer_is_sealed;
rollback;
