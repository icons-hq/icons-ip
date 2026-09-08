\set ON_ERROR_STOP on
begin;
select 1 / case when to_regclass('public.admin_goods_imports') is not null then 1 else 0 end as assert_import_schema;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000042501','authenticated','authenticated','excel-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000042502','authenticated','authenticated','excel-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id in ('00000000-0000-4000-8000-000000042501','00000000-0000-4000-8000-000000042502');
insert into public.verticals(key,label,color) values('excel-import','Excel 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('excel-import','Excel 검증','excel-import',now());
insert into public.admin_goods_imports(id,actor_id,state,plan) values
 ('00000000-0000-4000-8000-000000042510','00000000-0000-4000-8000-000000042501','ready',
 '[{"kind":"new","rows":[5],"code":"EXCEL-01","fingerprint":null,"target":{"ip_id":"excel-import","name":"Excel first","code":"EXCEL-01","origin_id":null,"publish":false,"variants":[{"name":"기본 옵션","code":"EXCEL-01-A","attributes":{},"extraPrice":0,"stockQty":4}],"variant_baseline":[]}},
 {"kind":"new","rows":[6],"code":"EXCEL-BAD","fingerprint":null,"target":{"ip_id":"missing-ip","name":"Excel bad","code":"EXCEL-BAD"}}]');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042502',true);
select 1 / case when not exists(select 1 from public.admin_goods_imports) then 1 else 0 end as assert_batches_are_actor_private;
do $$ begin
 begin
  perform public.admin_commit_goods_import_group('00000000-0000-4000-8000-000000042510',0);
  raise exception 'other actor committed batch';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042501',true);
select public.admin_commit_goods_import_group('00000000-0000-4000-8000-000000042510',0) as first_result \gset
select 1 / case when :'first_result'::jsonb->>'status'='success'
 and public.admin_commit_goods_import_group('00000000-0000-4000-8000-000000042510',0)=:'first_result'::jsonb
 and (select count(*) from public.goods where code='EXCEL-01')=1
 and (select stock_qty from public.goods where code='EXCEL-01')=4
 then 1 else 0 end as assert_group_commit_is_idempotent;
select 1 / case when public.admin_commit_goods_import_group('00000000-0000-4000-8000-000000042510',1)->>'status'='failed'
 and exists(select 1 from public.goods where code='EXCEL-01')
 and not exists(select 1 from public.goods where code='EXCEL-BAD')
 then 1 else 0 end as assert_failed_product_does_not_rollback_other_products;
reset role;
do $$
declare first_token uuid:='00000000-0000-4000-8000-000000042550'; second_token uuid:='00000000-0000-4000-8000-000000042551';
begin
 insert into public.admin_goods_imports(id,actor_id,state,plan) values('00000000-0000-4000-8000-000000042552','00000000-0000-4000-8000-000000042501','ready','[{"kind":"unchanged"}]');
 if public.service_acquire_goods_import_work('00000000-0000-4000-8000-000000042552','00000000-0000-4000-8000-000000042502',first_token) then raise exception 'wrong actor claimed work'; end if;
 if not public.service_acquire_goods_import_work('00000000-0000-4000-8000-000000042552','00000000-0000-4000-8000-000000042501',first_token) then raise exception 'initial lease rejected'; end if;
 if public.service_acquire_goods_import_work('00000000-0000-4000-8000-000000042552','00000000-0000-4000-8000-000000042501',second_token) then raise exception 'parallel lease accepted'; end if;
 perform public.service_release_goods_import_work('00000000-0000-4000-8000-000000042552','00000000-0000-4000-8000-000000042501',second_token);
 if (select work_token from public.admin_goods_imports where id='00000000-0000-4000-8000-000000042552')<>first_token then raise exception 'wrong token released work'; end if;
 update public.admin_goods_imports set work_expires_at=now()-interval '1 second' where id='00000000-0000-4000-8000-000000042552';
 if not public.service_acquire_goods_import_work('00000000-0000-4000-8000-000000042552','00000000-0000-4000-8000-000000042501',second_token) then raise exception 'abandoned lease did not recover'; end if;
 if has_function_privilege('authenticated','public.service_acquire_goods_import_work(uuid,uuid,uuid)','execute') then raise exception 'client can claim trusted work'; end if;
end $$;
select 1 / case when exists(select 1 from public.audit_log where action='admin.goods_import.applied' and actor_id='00000000-0000-4000-8000-000000042501')
 and not has_table_privilege('authenticated','public.admin_goods_imports','insert')
 and not has_function_privilege('anon','public.admin_commit_goods_import_group(uuid,integer)','execute')
 then 1 else 0 end as assert_import_write_boundary_and_audit;
do $$
declare good public.goods; variant public.goods_variants; target jsonb; before_fingerprint text; before_audits integer; batch_id uuid := '00000000-0000-4000-8000-000000042520'; result jsonb;
begin
 select * into good from public.goods where code='EXCEL-01';
 select * into variant from public.goods_variants where good_id=good.id and is_default;
 target:=to_jsonb(good)||jsonb_build_object('previous_id',good.id,'publish',false,'description','literal import-image: in a description',
  'variant_baseline',jsonb_build_array(variant.id),'variants',jsonb_build_array(jsonb_build_object('id',variant.id,'name',variant.name,'code',variant.code,'attributes',variant.attributes,'extraPrice',0,'stockQty',4,'expectedStockQty',4)));
 before_fingerprint:=private.goods_import_fingerprint(good.id);
 insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,'00000000-0000-4000-8000-000000042501','ready',
  jsonb_build_array(jsonb_build_object('kind','update','rows',jsonb_build_array(5),'target',target,'fingerprint',before_fingerprint)));
 -- A purchase changed stock after preview. Unchanged spreadsheet stock must preserve it.
 update public.goods_variants set stock_qty=3 where id=variant.id;
 if private.goods_import_fingerprint(good.id) is distinct from before_fingerprint then raise exception 'stock alone invalidated metadata fingerprint'; end if;
 result:=public.admin_commit_goods_import_group(batch_id,0);
 if result->>'status'<>'success' or (select stock_qty from public.goods_variants where id=variant.id)<>3 then raise exception 'unchanged stock was overwritten: %',result; end if;
 -- A requested quantity edit uses the preview baseline and fails after a purchase.
 batch_id:='00000000-0000-4000-8000-000000042521';
 target:=jsonb_set(target,'{variants,0,stockQty}','10');
 insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,'00000000-0000-4000-8000-000000042501','ready',
  jsonb_build_array(jsonb_build_object('kind','update','rows',jsonb_build_array(5),'target',target,'fingerprint',private.goods_import_fingerprint(good.id))));
 result:=public.admin_commit_goods_import_group(batch_id,0);
 if result->>'status'<>'failed' or result->>'error' not like '%stock_changed%' then raise exception 'stale stock edit accepted: %',result; end if;
 -- Changed metadata never silently overwrites another administrator's edit.
 batch_id:='00000000-0000-4000-8000-000000042522';
 insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,'00000000-0000-4000-8000-000000042501','ready',
  jsonb_build_array(jsonb_build_object('kind','update','rows',jsonb_build_array(5),'target',target,'fingerprint',private.goods_import_fingerprint(good.id))));
 update public.goods set name='Other editor' where id=good.id;
 result:=public.admin_commit_goods_import_group(batch_id,0);
 if result->>'status'<>'failed' or result->>'error'<>'import_product_changed' then raise exception 'metadata conflict accepted: %',result; end if;
 -- The manual stock label controls sale availability and is metadata, unlike quantity.
 target:=jsonb_set(target,'{variants,0,stockQty}','4');
 batch_id:='00000000-0000-4000-8000-000000042524';
 insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,'00000000-0000-4000-8000-000000042501','ready',
  jsonb_build_array(jsonb_build_object('kind','update','rows',jsonb_build_array(5),'target',target,'fingerprint',private.goods_import_fingerprint(good.id))));
 update public.goods set stock='soldout' where id=good.id;
 result:=public.admin_commit_goods_import_group(batch_id,0);
 if result->>'status'<>'failed' or result->>'error'<>'import_product_changed' then raise exception 'manual sale stop was overwritten: %',result; end if;
 select count(*) into before_audits from public.audit_log;
 batch_id:='00000000-0000-4000-8000-000000042523';
 insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,'00000000-0000-4000-8000-000000042501','ready','[{"kind":"unchanged","rows":[5]}]');
 result:=public.admin_commit_goods_import_group(batch_id,0);
 if result->>'status'<>'unchanged' or (select count(*) from public.audit_log)<>before_audits then raise exception 'no-op wrote product audit'; end if;
 if (select count(*) from public.admin_goods_export_candidates('EXCEL-01','excel-import','draft','all'))<>1
  or (select count(*) from public.admin_goods_export_candidates('EXCEL-01','excel-import','published','all'))<>0 then raise exception 'export filters drifted'; end if;
end $$;
rollback;
