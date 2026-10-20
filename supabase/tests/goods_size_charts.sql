\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql in the same connection. Everything rolls back.
begin;
load 'safeupdate';
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_size_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected size chart error: %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('98050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','size-chart-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id::text like '98050000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values('98050000-0000-4000-8000-000000000001','primary'),('98050000-0000-4000-8000-000000000002','deputy'),('98050000-0000-4000-8000-000000000003','logistics');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) values('size-chart-ip','사이즈 검증 합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,notice_size) values
 ('size-chart-good','size-chart-ip','사이즈 검증 합성 상품','문구',1000,'기존 고시 크기'),
 ('size-chart-empty','size-chart-ip','사이즈 없는 합성 상품','문구',2000,'독립 고시 크기');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id='size-chart-good';
update public.profiles set role='staff' where id=(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id='size-chart-good');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id='size-chart-good';
select pg_temp.publish_goods_kc_fixture('size-chart-good');
select jsonb_build_object('price',price,'stock_qty',stock_qty,'notice_size',notice_size,'kc',kc_disclosures) as original_good from public.goods where id='size-chart-good' \gset
select jsonb_agg(to_jsonb(v) order by id) as original_variants from public.goods_variants v where good_id='size-chart-good' \gset
select '{"unit":"mm","sizes":["단일","확장"],"measurements":[{"name":"가로","values":["37.4","63"]},{"name":"세로","values":["24","48.2"]}],"note":"합성 치수 안내"}'::jsonb as chart \gset
select '{"unit":"cm","sizes":[],"measurements":[],"note":""}'::jsonb as empty_chart \gset
select jsonb_build_object('enabled',true,'chart',:'chart'::jsonb) as values \gset
select 1/case when not exists(
 select 1 from pg_class c cross join unnest(array['anon','authenticated','service_role']) r
 where c.oid in('private.goods_size_charts'::regclass,'private.goods_size_templates'::regclass)
 and(not c.relrowsecurity or has_table_privilege(r,c.oid,'select,insert,update,delete,truncate,references,trigger'))
) and not exists(
 select 1 from pg_proc p cross join unnest(array['anon','authenticated','service_role']) r
 where p.oid in('private.validate_goods_size_chart(jsonb,boolean)'::regprocedure,'private.goods_size_chart_document(text)'::regprocedure,'private.clone_goods_size_chart(text,text,uuid)'::regprocedure)
 and has_function_privilege(r,p.oid,'execute')
) then 1 else 0 end as private_data_and_helpers_sealed;
select 1/case when has_function_privilege('postgres','private.clone_goods_size_chart(text,text,uuid)','execute')
 and (select prosecdef from pg_proc where oid='private.clone_goods_size_chart(text,text,uuid)'::regprocedure)
 and (select pg_get_userbyid(proowner)='postgres' from pg_proc where oid='private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure)
 and not has_function_privilege('anon','public.admin_get_goods_size_chart(text)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_size_chart(text,integer,uuid,jsonb)','execute') then 1 else 0 end as clone_owner_access_and_public_acl;
-- SQL and TypeScript share these exact decimal and text boundaries.
do $$ declare value text;payload jsonb;valid jsonb;begin
 foreach value in array array['1e3','1E-1','37.49','1,000','+3','-3','.1','01','0','0.0','99999.1','100000','3mm','NaN','Infinity','',chr(160)||'1'||chr(160)] loop
  payload:=jsonb_build_object('unit','cm','sizes',jsonb_build_array('단일'),'measurements',jsonb_build_array(jsonb_build_object('name','가로','values',jsonb_build_array(value))),'note','');
  begin perform private.validate_goods_size_chart(payload,false);raise exception 'accepted invalid number %',value;
  exception when invalid_parameter_value then null;end;
 end loop;
 valid:=private.validate_goods_size_chart(jsonb_build_object('unit','mm','sizes',jsonb_build_array(E' \n단일\t',chr(160)||'확장'||chr(160)),
  'measurements',jsonb_build_array(jsonb_build_object('name',' 가로 ','values',jsonb_build_array(E' 37.4\t','63.0'))),'note',E' \r\n측정\r\n안내\t문구\r '),false);
 if valid->'sizes'<>jsonb_build_array('단일',chr(160)||'확장'||chr(160)) or valid#>>'{measurements,0,values,1}'<>'63' or valid->>'note'<>E'측정\n안내\t문구' then raise exception 'normalization_mismatch';end if;
 valid:=private.validate_goods_size_chart(jsonb_build_object('unit','cm','sizes',jsonb_build_array(repeat('😀',10)),
  'measurements',jsonb_build_array(jsonb_build_object('name',repeat('😀',20),'values',jsonb_build_array('99999.0'))),'note',repeat('😀',500)),false);
 if char_length(valid->'sizes'->>0)<>10 or valid#>>'{measurements,0,values,0}'<>'99999' then raise exception 'unicode_or_boundary_mismatch';end if;
 foreach value in array array[chr(1),chr(127),chr(133)] loop
  begin perform private.validate_goods_size_chart(jsonb_build_object('unit','cm','sizes',jsonb_build_array('단일'),'measurements',jsonb_build_array(jsonb_build_object('name','가로','values',jsonb_build_array('0.1'))),'note','메모'||value),false);raise exception 'accepted control';
  exception when invalid_parameter_value then null;end;
 end loop;
end $$;
select set_config('request.jwt.claim.sub','98050000-0000-4000-8000-000000000001',true);
set local role authenticated;
select 1/case when public.admin_get_goods_size_chart('size-chart-good')->>'revision'='0' and public.admin_get_goods_size_chart('size-chart-good')#>>'{values,enabled}'='false' then 1 else 0 end as initial_empty_revision_zero;
select public.admin_save_goods_size_chart('size-chart-good',0,'98050000-0000-4000-8000-000000000101',:'values') as saved \gset
select 1/case when public.admin_save_goods_size_chart('size-chart-good',0,'98050000-0000-4000-8000-000000000101',:'values')=:'saved'::jsonb then 1 else 0 end as exact_replay;
select pg_temp.expect_size_error(format('select public.admin_save_goods_size_chart(%L,0,%L,%L::jsonb)','size-chart-good','98050000-0000-4000-8000-000000000101',jsonb_build_object('enabled',false,'chart',:'chart'::jsonb)),'operation_conflict');
select pg_temp.expect_size_error(format('select public.admin_save_goods_size_chart(%L,0,gen_random_uuid(),%L::jsonb)','size-chart-good',:'values'),'goods_size_chart_changed');
select pg_temp.expect_size_error(format('select public.admin_save_goods_size_chart(%L,1,gen_random_uuid(),%L::jsonb)','size-chart-good',jsonb_build_object('enabled',false,'chart',:'empty_chart'::jsonb)),'goods_size_chart_cannot_clear');
select pg_temp.expect_size_error($q$select public.admin_save_goods_size_chart('size-chart-good',1,gen_random_uuid(),'{"enabled":true,"chart":{"unit":"cm","sizes":["중복","중복"],"measurements":[{"name":"가로","values":["3","4"]}],"note":""}}')$q$,'invalid_goods_size_chart');
select pg_temp.expect_size_error($q$select public.admin_save_goods_size_chart('size-chart-good',1,gen_random_uuid(),'{"enabled":false,"chart":{"unit":"cm","sizes":["단일"],"measurements":[],"note":""}}')$q$,'invalid_goods_size_chart');
select pg_temp.expect_size_error($q$select public.admin_save_goods_size_chart('size-chart-good',1,gen_random_uuid(),'{"enabled":true,"chart":{"unit":"cm","sizes":["단일"],"measurements":[{"name":"가로","values":[3]}],"note":""}}')$q$,'invalid_goods_size_chart');
select public.admin_save_goods_size_chart('size-chart-empty',0,gen_random_uuid(),jsonb_build_object('enabled',false,'chart',:'empty_chart'::jsonb));
select public.admin_save_goods_size_template('98050000-0000-4000-8000-000000000301','합성 템플릿',:'chart',false,0,'98050000-0000-4000-8000-000000000302') as template \gset
select 1/case when public.admin_save_goods_size_template('98050000-0000-4000-8000-000000000301','합성 템플릿',:'chart',false,0,'98050000-0000-4000-8000-000000000302')=:'template'::jsonb then 1 else 0 end as template_exact_replay;
select public.admin_save_goods_size_template('98050000-0000-4000-8000-000000000301','수정 합성 템플릿',jsonb_set(:'chart'::jsonb,'{note}','"템플릿만 변경"'),true,1,gen_random_uuid());
select 1/case when public.admin_list_goods_size_templates('',false,1)->>'total'='0' and public.admin_list_goods_size_templates('',true,1)->>'total'='1'
 and public.admin_get_goods_size_chart('size-chart-good')#>'{values,chart}'=:'chart'::jsonb then 1 else 0 end as archive_and_edit_do_not_propagate;
select public.admin_save_goods_size_template('98050000-0000-4000-8000-000000000301','복원 합성 템플릿',:'chart',false,2,gen_random_uuid());
select pg_temp.expect_size_error(format('select public.admin_save_goods_size_template(%L,%L,%L::jsonb,false,1,gen_random_uuid())','98050000-0000-4000-8000-000000000301','오래된 템플릿',:'chart'),'goods_size_template_changed');
select public.admin_clone_good('98050000-0000-4000-8000-000000000201','size-chart-good','size-chart-clone','SIZE-COPY','사이즈 복사 합성');
select public.admin_clone_good('98050000-0000-4000-8000-000000000201','size-chart-good','size-chart-clone','SIZE-COPY','사이즈 복사 합성');
select public.admin_clone_good('98050000-0000-4000-8000-000000000202','size-chart-empty','size-chart-empty-clone','SIZE-EMPTY','빈 사이즈 복사 합성');
select 1/case when public.admin_get_goods_size_chart('size-chart-clone')#>'{values,chart}'=:'chart'::jsonb
 and public.admin_get_goods_size_chart('size-chart-clone')->>'revision'='1'
 and public.admin_get_goods_size_chart('size-chart-empty-clone')#>'{values,chart}'=:'empty_chart'::jsonb then 1 else 0 end as cloned_snapshots_and_empty_preserved;
reset role;
select 1/case when (select count(*) from public.audit_log where id='98050000-0000-4000-8000-000000000201')=1
 and(select jsonb_build_object('price',price,'stock_qty',stock_qty,'notice_size',notice_size,'kc',kc_disclosures)=:'original_good'::jsonb from public.goods where id='size-chart-good')
 and(select jsonb_agg(to_jsonb(v) order by id)=:'original_variants'::jsonb from public.goods_variants v where good_id='size-chart-good') then 1 else 0 end as clone_once_commerce_and_notice_untouched;
update public.goods set id='size-chart-renamed' where id='size-chart-clone';
select 1/case when exists(select 1 from private.goods_size_charts where good_id='size-chart-renamed' and chart=:'chart'::jsonb) then 1 else 0 end as id_rename_cascades;
set local role anon;
select 1/case when public.get_good_size_chart('size-chart-good')=:'chart'::jsonb and public.get_good_size_chart('size-chart-empty') is null then 1 else 0 end as public_minimal_chart_only;
reset role;
set local role authenticated;
select public.admin_save_goods_size_chart('size-chart-good',1,gen_random_uuid(),jsonb_build_object('enabled',false,'chart',:'chart'::jsonb));
select 1/case when public.admin_save_goods_size_chart('size-chart-good',0,'98050000-0000-4000-8000-000000000101',:'values')=:'saved'::jsonb
 and public.admin_get_goods_size_chart('size-chart-good')->>'revision'='2' and public.get_good_size_chart('size-chart-good') is null
 and public.admin_get_goods_size_chart('size-chart-good')#>'{values,chart}'=:'chart'::jsonb then 1 else 0 end as disabled_preserves_chart_and_old_replay_does_not_reenable;
select public.admin_clone_good('98050000-0000-4000-8000-000000000203','size-chart-good','size-chart-disabled-clone','SIZE-OFF','표시중지 사이즈 복사');
select 1/case when public.admin_get_goods_size_chart('size-chart-disabled-clone')#>>'{values,enabled}'='false' and public.admin_get_goods_size_chart('size-chart-disabled-clone')#>'{values,chart}'=:'chart'::jsonb then 1 else 0 end as disabled_clone_keeps_measurements;
select public.admin_save_goods_size_chart('size-chart-good',2,gen_random_uuid(),:'values');
reset role;
update public.goods set published_at=null where id='size-chart-good';
set local role anon;
select 1/case when public.get_good_size_chart('size-chart-good') is null then 1 else 0 end as unpublished_good_hidden;
reset role;
update public.goods set published_at=now() where id='size-chart-good';
update public.ips set published_at=null where id='size-chart-ip';
set local role anon;
select 1/case when public.get_good_size_chart('size-chart-good') is null then 1 else 0 end as unpublished_ip_hidden;
reset role;
update public.ips set published_at=now() where id='size-chart-ip';
update public.goods set sale_restriction='adult' where id='size-chart-good';
set local role anon;
select 1/case when public.get_good_size_chart('size-chart-good') is null then 1 else 0 end as restricted_good_hidden;
reset role;
update public.goods set sale_restriction='none',archived_at=now() where id='size-chart-good';
set local role anon;
select 1/case when public.get_good_size_chart('size-chart-good') is null then 1 else 0 end as archived_good_hidden;
reset role;
update public.goods set archived_at=now() where ip_id='size-chart-ip' and archived_at is null;
update public.ips set archived_at=now() where id='size-chart-ip';
set local role anon;
select 1/case when public.get_good_size_chart('size-chart-good') is null then 1 else 0 end as archived_ip_hidden;
reset role;
update public.ips set archived_at=null where id='size-chart-ip';
update public.goods set archived_at=null where ip_id='size-chart-ip';
select set_config('request.jwt.claim.sub','98050000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.expect_size_error(format('select public.admin_save_goods_size_chart(%L,0,%L,%L::jsonb)','size-chart-good','98050000-0000-4000-8000-000000000101',:'values'),'operation_conflict');
select set_config('request.jwt.claim.sub','98050000-0000-4000-8000-000000000003',true);
select pg_temp.expect_size_error($q$select public.admin_get_goods_size_chart('size-chart-good')$q$,'operator_capability_required');
select pg_temp.expect_size_error($q$select public.admin_list_goods_size_templates()$q$,'operator_capability_required');
select pg_temp.expect_size_error(format('select public.admin_save_goods_size_chart(%L,3,gen_random_uuid(),%L::jsonb)','size-chart-good',:'values'),'operator_capability_required');
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id='98050000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','98050000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.expect_size_error(format('select public.admin_save_goods_size_chart(%L,0,%L,%L::jsonb)','size-chart-good','98050000-0000-4000-8000-000000000101',:'values'),'operator_capability_required');
reset role;
rollback;
