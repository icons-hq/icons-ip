\set ON_ERROR_STOP on
-- Run only in the owned isolated database; all fixtures and writes roll back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000063201','authenticated','authenticated','shipping-template-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000063202','authenticated','authenticated','shipping-template-member@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000063203','authenticated','authenticated','shipping-template-other-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id in ('00000000-0000-4000-8000-000000063201','00000000-0000-4000-8000-000000063203');
-- Current explicit catalog capability; new fixture users are not legacy cohort.
insert into private.operator_memberships(profile_id,manager_role) values
 ('00000000-0000-4000-8000-000000063201','deputy'),('00000000-0000-4000-8000-000000063203','deputy');
insert into public.verticals(key,label,color) values('shipping-template-test','배송 템플릿 검증','#000');
insert into public.ips(id,title,vertical_key,published_at) values('shipping-template-ip','배송 템플릿 검증','shipping-template-test',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active) values
 ('a0000000-0000-4000-8000-000000063240','shipping-template-origin','합성 출고지','hanjin',3100,40000,'합성 반송 주소',true),
 ('00000000-0000-4000-8000-000000063241','shipping-template-inactive','합성 비활성 출고지','hanjin',2000,null,'합성 주소',false);
insert into public.goods(id,code,ip_id,name,type,price,stock,individual_fee)
 select 'shipping-template-good-'||lpad(n::text,3,'0'),'SHIPPING-TEMPLATE-'||lpad(n::text,3,'0'),'shipping-template-ip','합성 상품 '||n,'문구',1000,'ok',100 from generate_series(1,101)n;
insert into public.orders(id,user_id,status,total,address) values('00000000-0000-4000-8000-000000063250','00000000-0000-4000-8000-000000063202','pending',1000,'{}');
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select '00000000-0000-4000-8000-000000063250','shipping-template-good-001',id,1,1000,'합성 주문 상품','문구','shipping-template-ip' from public.goods_variants where good_id='shipping-template-good-001' limit 1;
create temp table shipping_template_order_before as select to_jsonb(i) snapshot from public.order_items i where order_id='00000000-0000-4000-8000-000000063250';
create temp table shipping_template_origin_before as select to_jsonb(o) snapshot from public.fulfillment_origins o where id='a0000000-0000-4000-8000-000000063240';
create function pg_temp.shipping_template_payload(origin uuid default 'a0000000-0000-4000-8000-000000063240',fee_type text default 'individual') returns jsonb language sql as $$
 select jsonb_build_object('originId',origin,'feeType',fee_type,'individualFee',3500,
  'claimPolicy',jsonb_build_object('returnAllowed',true,'exchangeAllowed',null,'restrictionReason',null,'returnFee',0,'returnFreeShippingFee',null,'exchangeFee',6000)); $$;
create function pg_temp.shipping_template_targets(preview jsonb) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('id',x->>'id','updatedAt',x->>'updatedAt') order by x->>'id') from jsonb_array_elements(preview->'goods')x; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063201',true);
select public.admin_save_shipping_settings_template('00000000-0000-4000-8000-000000063211',0,'합성_배송%',true,pg_temp.shipping_template_payload()) as created \gset
select public.admin_save_shipping_settings_template('00000000-0000-4000-8000-000000063213',0,'UUID 정규화',false,
 jsonb_set(pg_temp.shipping_template_payload(),'{originId}',to_jsonb(upper('a0000000-0000-4000-8000-000000063240')))) as normalized \gset
select 1/case when :'normalized'::jsonb->'settings'->>'originId'='a0000000-0000-4000-8000-000000063240' then 1 else 0 end as origin_id_normalized;
select 1/case when (:'created'::jsonb->>'revision')::int=1 and (public.admin_list_shipping_settings_templates('합성_배송%')->>'total')::int=1
 and (public.admin_list_shipping_settings_templates('배송x')->>'total')::int=0
 and (public.admin_search_goods_for_shipping_settings('SHIPPING-TEMPLATE-001')->>'total')::int=1 then 1 else 0 end as save_list_literal_search;
select public.admin_preview_shipping_settings_template('00000000-0000-4000-8000-000000063211',array['shipping-template-good-001','shipping-template-good-002']) as preview \gset
select 1/case when :'preview'::jsonb->'goods'->0->'before'->'claimPolicy'->'returnFee'='null'::jsonb
 and :'preview'::jsonb->'goods'->0->'after'->'claimPolicy'->>'returnFee'='0'
 and :'preview'::jsonb->'goods'->0->'after'=:'created'::jsonb->'settings' then 1 else 0 end as preview_preserves_null_zero_and_exact_target;
select public.admin_apply_shipping_settings_template('00000000-0000-4000-8000-000000063221','00000000-0000-4000-8000-000000063211',1,
 (:'preview'::jsonb->'origin'->>'updatedAt')::timestamptz,pg_temp.shipping_template_targets(:'preview')) as applied \gset
select 1/case when :'applied'::jsonb->>'appliedCount'='2' and public.admin_apply_shipping_settings_template('00000000-0000-4000-8000-000000063221','00000000-0000-4000-8000-000000063211',1,
 (:'preview'::jsonb->'origin'->>'updatedAt')::timestamptz,pg_temp.shipping_template_targets(:'preview'))=:'applied'::jsonb then 1 else 0 end as same_request_replays_exact_result;
reset role;
select 1/case when (select count(*) from public.goods g where id in ('shipping-template-good-001','shipping-template-good-002')
 and private.good_shipping_settings(g)=pg_temp.shipping_template_payload() and shipping_settings_template_revision=1
 and shipping_settings_snapshot->'settings'=pg_temp.shipping_template_payload())=2
 and (select count(*) from public.audit_log where action='catalog.good.shipping_settings_applied' and diff->>'requestId'='00000000-0000-4000-8000-000000063221')=2
 and (select count(*) from private.shipping_settings_applications where id='00000000-0000-4000-8000-000000063221')=1
 then 1 else 0 end as apply_matches_preview_and_is_idempotent;
select 1/case when (select count(*) from shipping_template_order_before)=1
 and (select to_jsonb(i) from public.order_items i where order_id='00000000-0000-4000-8000-000000063250')=(select snapshot from shipping_template_order_before)
 and (select to_jsonb(o) from public.fulfillment_origins o where id='a0000000-0000-4000-8000-000000063240')=(select snapshot from shipping_template_origin_before)
 then 1 else 0 end as historical_order_and_origin_untouched;
set local role authenticated;
select public.admin_save_shipping_settings_template('00000000-0000-4000-8000-000000063211',1,'합성_배송%',true,pg_temp.shipping_template_payload('a0000000-0000-4000-8000-000000063240','free'));
reset role;
select 1/case when (select shipping_fee_type='individual' and shipping_settings_template_revision=1 from public.goods where id='shipping-template-good-001') then 1 else 0 end as edit_does_not_propagate;
set local role authenticated;
select public.admin_preview_shipping_settings_template('00000000-0000-4000-8000-000000063211',array['shipping-template-good-003','shipping-template-good-004']) as stale \gset
reset role;
update public.goods set price=1200,updated_at=clock_timestamp() where id='shipping-template-good-004';
-- Generic updated_at uses now() inside this test transaction. Explicitly change
-- a shipping field too, which runs the monotonic shipping template guard.
update public.goods set individual_fee=101 where id='shipping-template-good-004';
set local role authenticated;
select set_config('test.shipping_preview',:'stale',true);
do $$declare p jsonb:=current_setting('test.shipping_preview')::jsonb; begin
 begin perform public.admin_apply_shipping_settings_template('00000000-0000-4000-8000-000000063222','00000000-0000-4000-8000-000000063211',2,
 (p->'origin'->>'updatedAt')::timestamptz,pg_temp.shipping_template_targets(p));raise exception 'stale good accepted';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
select 1/case when (select shipping_settings_template_id is null from public.goods where id='shipping-template-good-003')
 and not exists(select 1 from private.shipping_settings_applications where id='00000000-0000-4000-8000-000000063222')
 and not exists(select 1 from public.audit_log where diff->>'requestId'='00000000-0000-4000-8000-000000063222') then 1 else 0 end as conflict_has_no_prefix_or_audit;
set local role authenticated;
select public.admin_preview_shipping_settings_template('00000000-0000-4000-8000-000000063211',array['shipping-template-good-003']) as origin_stale \gset
reset role;
update public.fulfillment_origins set base_fee=3300,updated_at=clock_timestamp() where id='a0000000-0000-4000-8000-000000063240';
set local role authenticated;
select set_config('test.shipping_preview',:'origin_stale',true);
do $$declare p jsonb:=current_setting('test.shipping_preview')::jsonb;begin
 begin perform public.admin_apply_shipping_settings_template('00000000-0000-4000-8000-000000063223','00000000-0000-4000-8000-000000063211',2,
 (p->'origin'->>'updatedAt')::timestamptz,pg_temp.shipping_template_targets(p));raise exception 'stale origin accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.admin_save_shipping_settings_template('00000000-0000-4000-8000-000000063211',1,'덮어쓰기',true,pg_temp.shipping_template_payload());raise exception 'stale template accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.admin_save_shipping_settings_template('00000000-0000-4000-8000-000000063212',0,'비활성 출고지',true,pg_temp.shipping_template_payload('00000000-0000-4000-8000-000000063241'));raise exception 'inactive origin accepted';exception when check_violation then null;end;
 begin perform public.admin_save_shipping_settings_template('00000000-0000-4000-8000-000000063212',0,'없는 출고지',true,pg_temp.shipping_template_payload('00000000-0000-4000-8000-000000063299'));raise exception 'missing origin accepted';exception when check_violation then null;end;
 begin perform public.admin_save_shipping_settings_template('00000000-0000-4000-8000-000000063212',0,'착불 미지원',true,pg_temp.shipping_template_payload()||'{"feeType":"cod"}');raise exception 'unknown mode accepted';exception when invalid_parameter_value then null;end;
 begin perform public.admin_save_shipping_settings_template('00000000-0000-4000-8000-000000063212',0,'이유 없는 제한',true,jsonb_set(pg_temp.shipping_template_payload(),'{claimPolicy,returnAllowed}','false'));raise exception 'restriction without reason';exception when invalid_parameter_value then null;end;
 begin perform public.admin_preview_shipping_settings_template('00000000-0000-4000-8000-000000063211',array['shipping-template-good-001','shipping-template-good-001']);raise exception 'duplicate targets accepted';exception when invalid_parameter_value then null;end;
 begin perform public.admin_preview_shipping_settings_template('00000000-0000-4000-8000-000000063211',array['missing']);raise exception 'missing good accepted';exception when check_violation then null;end;
 begin perform public.admin_preview_shipping_settings_template('00000000-0000-4000-8000-000000063211',(select array_agg('shipping-template-good-'||lpad(n::text,3,'0')) from generate_series(1,101)n));raise exception '101 targets accepted';exception when invalid_parameter_value then null;end;
end$$;
select public.admin_preview_shipping_settings_template('00000000-0000-4000-8000-000000063211',(select array_agg('shipping-template-good-'||lpad(n::text,3,'0')) from generate_series(1,100)n)) as hundred \gset
select public.admin_apply_shipping_settings_template('00000000-0000-4000-8000-000000063224','00000000-0000-4000-8000-000000063211',2,
 (:'hundred'::jsonb->'origin'->>'updatedAt')::timestamptz,pg_temp.shipping_template_targets(:'hundred')) as hundred_applied \gset
select 1/case when :'hundred_applied'::jsonb->>'appliedCount'='100' then 1 else 0 end as hundred_targets_applied;
reset role;
update public.goods set name='템플릿 설정 유지 확인' where id='shipping-template-good-001';
select 1/case when (select shipping_settings_template_revision=2 from public.goods where id='shipping-template-good-001') then 1 else 0 end as unrelated_edit_preserves_association;
update public.goods set shipping_fee_type='policy' where id='shipping-template-good-001';
select 1/case when (select shipping_settings_template_id is null and shipping_settings_template_revision is null and shipping_settings_snapshot is null from public.goods where id='shipping-template-good-001') then 1 else 0 end as changed_settings_detach_association;
set local role authenticated;
select public.admin_save_shipping_settings_template('00000000-0000-4000-8000-000000063211',2,'합성_배송%',false,pg_temp.shipping_template_payload()) as disabled \gset
select 1/case when (public.admin_list_shipping_settings_templates('합성_배송%', 'disabled')->>'total')::int=1 then 1 else 0 end as disabled_is_kept;
do $$begin
 begin perform public.admin_preview_shipping_settings_template('00000000-0000-4000-8000-000000063211',array['shipping-template-good-002']);raise exception 'disabled preview accepted';exception when check_violation then null;end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063203',true);
select set_config('test.shipping_preview',:'preview',true);
do $$declare p jsonb:=current_setting('test.shipping_preview')::jsonb;begin
 begin perform public.admin_apply_shipping_settings_template('00000000-0000-4000-8000-000000063221','00000000-0000-4000-8000-000000063211',1,
 (p->'origin'->>'updatedAt')::timestamptz,pg_temp.shipping_template_targets(p));raise exception 'other actor replay accepted';exception when sqlstate 'PT409' then null;end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063202',true);
select 1/case when (select count(*) from public.shipping_settings_templates)=0 then 1 else 0 end as member_rls_empty;
do $$begin
 begin perform public.admin_list_shipping_settings_templates();raise exception 'member read accepted';exception when insufficient_privilege then null;end;
 begin perform public.admin_preview_shipping_settings_template('00000000-0000-4000-8000-000000063211',array['shipping-template-good-002']);raise exception 'member preview accepted';exception when insufficient_privilege then null;end;
 begin update public.shipping_settings_templates set name='bypass';raise exception 'direct write accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 1/case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('admin_save_shipping_settings_template','admin_list_shipping_settings_templates','admin_search_goods_for_shipping_settings','admin_preview_shipping_settings_template','admin_apply_shipping_settings_template')
 and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or not has_function_privilege('authenticated',p.oid,'execute')))
 and not has_table_privilege('authenticated','private.shipping_settings_applications','select') then 1 else 0 end as rpc_grants_and_private_application_records;
rollback;
