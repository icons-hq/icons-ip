\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000079901','authenticated','authenticated','custom-input-workbook-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000079901';
insert into private.operator_memberships(profile_id,manager_role) values ('00000000-0000-4000-8000-000000079901','primary');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key) values ('custom-input-workbook-sql','직접입력 엑셀 SQL 합성 IP','character');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active)
values ('00000000-0000-4000-8000-000000079903','custom-input-workbook-sql','TEST 엑셀 출고지',0,'TEST 주소',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000079901',true);
set local role authenticated;
select public.admin_save_good('{"id":"custom-input-workbook-sql-good","code":"CUSTOM-XLSX-SQL","name":"TEST 이전 상품","ip_id":"custom-input-workbook-sql","type":"문구","price":5000,"origin_id":"00000000-0000-4000-8000-000000079903","publish":false,"variant_baseline":[],"variants":[{"code":"CUSTOM-XLSX-SQL-01","name":"기본 옵션","attributes":{},"extraPrice":0,"stockQty":4}],"custom_inputs":{"enabled":true,"fields":[{"id":"00000000-0000-4000-8000-000000079902","name":"TEST 이전 문구","active":true}]},"custom_inputs_expected_revision":0}');
reset role;
insert into public.orders(id,user_id,status,total,address)
values ('00000000-0000-4000-8000-000000079904','00000000-0000-4000-8000-000000079901','pending',5000,'{}');
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,
 origin_id_snapshot,shipping_fee_type_snapshot,individual_fee_snapshot,custom_inputs_snapshot)
select '00000000-0000-4000-8000-000000079904',g.id,v.id,1,5000,g.name,g.type,g.ip_id,g.origin_id,'policy',0,
 '{"revision":1,"fields":[{"id":"00000000-0000-4000-8000-000000079902","name":"TEST 이전 문구","value":"TEST 주문 당시 문구"}]}'::jsonb
from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='custom-input-workbook-sql-good';
do $$
declare
  g public.goods; v public.goods_variants; target jsonb; result jsonb; repeated jsonb;
  batch_id uuid; original_definition jsonb; original_name text; original_revision integer; audit_count integer;
begin
  select * into g from public.goods where id='custom-input-workbook-sql-good';
  select * into v from public.goods_variants where good_id=g.id and is_default;
  target:=to_jsonb(g)||jsonb_build_object('previous_id',g.id,'publish',false,'name','TEST 엑셀 상품',
    'variant_baseline',jsonb_build_array(v.id),'variants',jsonb_build_array(jsonb_build_object(
      'id',v.id,'name',v.name,'code',v.code,'attributes',v.attributes,'extraPrice',0,'stockQty',4,'expectedStockQty',4)),
    'custom_inputs',jsonb_build_object('enabled',true,'fields',jsonb_build_array(jsonb_build_object(
      'id','00000000-0000-4000-8000-000000079902','name','TEST 엑셀 문구','active',true))),
    'custom_inputs_expected_revision',1);
  batch_id:='00000000-0000-4000-8000-000000079910';
  insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,'00000000-0000-4000-8000-000000079901','ready',
    jsonb_build_array(jsonb_build_object('kind','update','rows','[5]'::jsonb,'target',target,'fingerprint',private.goods_import_fingerprint(g.id)),
      jsonb_build_object('kind','new','rows','[6]'::jsonb,'target',jsonb_build_object('ip_id','missing-ip','name','TEST 실패 상품','code','CUSTOM-XLSX-FAIL'))));
  result:=public.admin_commit_goods_import_group(batch_id,0);
  if result->>'status'<>'success' or (select name from public.goods where id=g.id)<>'TEST 엑셀 상품'
    or (select custom_inputs_revision from public.goods where id=g.id)<>2
    or (select custom_input_fields#>>'{0,id}' from public.goods where id=g.id)<>'00000000-0000-4000-8000-000000079902'
    or (select custom_input_fields#>>'{0,name}' from public.goods where id=g.id)<>'TEST 엑셀 문구' then
    raise exception 'definition and product did not commit together: %',result;end if;
  select count(*) into audit_count from public.audit_log where actor_id='00000000-0000-4000-8000-000000079901';
  repeated:=public.admin_commit_goods_import_group(batch_id,0);
  if repeated is distinct from result or (select custom_inputs_revision from public.goods where id=g.id)<>2
    or (select count(*) from public.audit_log where actor_id='00000000-0000-4000-8000-000000079901')<>audit_count then
    raise exception 'import replay changed definition or audit';end if;
  result:=public.admin_commit_goods_import_group(batch_id,1);
  if result->>'status'<>'failed' or (select name from public.goods where id=g.id)<>'TEST 엑셀 상품'
    or exists(select 1 from public.goods where code='CUSTOM-XLSX-FAIL') then raise exception 'partial failure changed successful group';end if;
  raise notice 'PASS product and definition atomic success, one revision, replay, other product failure';

  select custom_input_fields,name,custom_inputs_revision into original_definition,original_name,original_revision from public.goods where id=g.id;
  -- The base product save runs before the custom-input update. The final trigger
  -- must reject an enabled empty definition and roll the earlier name back too.
  target:=target||jsonb_build_object('name','TEST 롤백되어야 하는 이름','custom_inputs',jsonb_build_object('enabled',true,'fields','[]'::jsonb),
    'custom_inputs_expected_revision',original_revision);
  batch_id:='00000000-0000-4000-8000-000000079913';
  insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,'00000000-0000-4000-8000-000000079901','ready',
    jsonb_build_array(jsonb_build_object('kind','update','rows','[5]'::jsonb,'target',target,'fingerprint',private.goods_import_fingerprint(g.id))));
  result:=public.admin_commit_goods_import_group(batch_id,0);
  if result->>'status'<>'failed' or result->>'error'<>'invalid_goods_custom_input_fields'
    or (select name from public.goods where id=g.id) is distinct from original_name
    or (select custom_input_fields from public.goods where id=g.id) is distinct from original_definition
    or (select custom_inputs_revision from public.goods where id=g.id)<>original_revision then
    raise exception 'failed final definition update did not roll product back: %',result;end if;
  raise notice 'PASS invalid final definition rolls back base product and definition together';

  target:=target||jsonb_build_object('custom_inputs',jsonb_build_object('enabled',false,'fields',original_definition),
    'custom_inputs_expected_revision',original_revision);
  batch_id:='00000000-0000-4000-8000-000000079914';
  insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,'00000000-0000-4000-8000-000000079901','ready',
    jsonb_build_array(jsonb_build_object('kind','update','rows','[5]'::jsonb,'target',target,'fingerprint',private.goods_import_fingerprint(g.id))));
  update public.goods set custom_input_fields=jsonb_set(custom_input_fields,'{0,name}','"TEST 다른 운영자 문구"') where id=g.id;
  result:=public.admin_commit_goods_import_group(batch_id,0);
  if result->>'status'<>'failed' or result->>'error'<>'import_product_changed'
    or (select custom_input_fields#>>'{0,name}' from public.goods where id=g.id)<>'TEST 다른 운영자 문구' then
    raise exception 'preview definition fingerprint conflict accepted: %',result;end if;
  -- A current fingerprint cannot substitute for the spreadsheet's older CAS.
  batch_id:='00000000-0000-4000-8000-000000079915';
  insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,'00000000-0000-4000-8000-000000079901','ready',
    jsonb_build_array(jsonb_build_object('kind','update','rows','[5]'::jsonb,'target',target,'fingerprint',private.goods_import_fingerprint(g.id))));
  result:=public.admin_commit_goods_import_group(batch_id,0);
  if result->>'status'<>'failed' or result->>'error'<>'goods_custom_inputs_changed' then raise exception 'old worksheet definition CAS accepted: %',result;end if;
  raise notice 'PASS definition change after preview and old worksheet CAS both reject';

  select custom_input_fields,custom_inputs_revision into original_definition,original_revision from public.goods where id=g.id;
  target:=(target-'custom_inputs'-'custom_inputs_expected_revision')||jsonb_build_object('name','TEST 구형 파일 메타데이터');
  batch_id:='00000000-0000-4000-8000-000000079916';
  insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,'00000000-0000-4000-8000-000000079901','ready',
    jsonb_build_array(jsonb_build_object('kind','update','rows','[5]'::jsonb,'target',target,'fingerprint',private.goods_import_fingerprint(g.id))));
  result:=public.admin_commit_goods_import_group(batch_id,0);
  if result->>'status'<>'success' or (select custom_input_fields from public.goods where id=g.id) is distinct from original_definition
    or (select custom_inputs_revision from public.goods where id=g.id)<>original_revision then raise exception 'absent sheet erased definition: %',result;end if;
  raise notice 'PASS old plan without custom-input payload preserves definition and revision';
  if (select custom_inputs_snapshot from public.order_items where order_id='00000000-0000-4000-8000-000000079904') is distinct from
    '{"revision":1,"fields":[{"id":"00000000-0000-4000-8000-000000079902","name":"TEST 이전 문구","value":"TEST 주문 당시 문구"}]}'::jsonb then
    raise exception 'existing order input snapshot changed with worksheet definition';end if;
  raise notice 'PASS existing order ID, name, revision and value snapshot stay unchanged';
end $$;
rollback;
