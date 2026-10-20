\set ON_ERROR_STOP on
-- All fixtures, temporary capability projection and audit receipts roll back.
begin;
load 'safeupdate';
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.gi_id(n integer) returns uuid language sql immutable as $$select ('a6c01400-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.gi_assert(ok boolean, label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'Guidance import assertion: %',label;end if;end$$;
create function pg_temp.gi_expect(q text, expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected guidance import error: %',expected;end$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.gi_id(n),'authenticated','authenticated','guidance-import-'||n||'@example.test',now(),'{}','{}' from generate_series(1,6)n;
update public.profiles set role='staff' where id in(select pg_temp.gi_id(n) from generate_series(1,4)n) or id=pg_temp.gi_id(6);
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.gi_id(1),'primary'),(pg_temp.gi_id(2),'deputy'),(pg_temp.gi_id(3),'logistics'),(pg_temp.gi_id(6),'primary');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) values('guidance-import-ip','안내 XLSX 합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,code) select 'guidance-import-'||n,'guidance-import-ip','안내 XLSX 합성 '||n,'문구',1000,'GI-'||n from generate_series(1,7)n;
update public.goods_variants set stock_qty=4 where good_id like 'guidance-import-%';
-- Legacy plain descriptions remain valid in storage beyond the current 2000-character editor limit.
update public.goods set description=repeat('기',2100),description_format='plain' where id='guidance-import-2';

create function pg_temp.gi_as(rev integer,guide text default '수입 A/S 안내') returns jsonb language sql immutable as $$
 select jsonb_build_object('expectedRevision',rev,'values',jsonb_build_object('phone','02-123-4567','guide',guide,'sellerSpecialNotes','판매자 안내'))$$;
create function pg_temp.gi_size(rev integer,enabled boolean default true) returns jsonb language sql immutable as $$
 select jsonb_build_object('expectedRevision',rev,'values',jsonb_build_object('enabled',enabled,'chart',
  '{"unit":"cm","sizes":["단일"],"measurements":[{"name":"가로","values":["3.5"]}],"note":"치수 안내"}'::jsonb))$$;
create function pg_temp.gi_target(good_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(good)||jsonb_build_object('previous_id',good.id,'publish',false,
  'variant_baseline',(select jsonb_agg(v.id order by v.id) from public.goods_variants v where v.good_id=good.id),
  'variants',(select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'code',v.code,'attributes',v.attributes,
   'extraPrice',v.price-good.price,'stockQty',v.stock_qty,'expectedStockQty',v.stock_qty) order by v.id) from public.goods_variants v where v.good_id=good.id))
 from public.goods good where good.id=$1$$;
-- Trusted server plan setup only; assertions call the real public commit RPC.
create function pg_temp.gi_batch(n integer,good_id text,guidance jsonb,only_guidance boolean default true,target_override jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare target jsonb;entry jsonb;batch_id uuid:=pg_temp.gi_id(n);begin
 if target_override is not null then target:=target_override;
 elsif only_guidance then select jsonb_build_object('previous_id',g.id,'code',g.code) into target from public.goods g where g.id=good_id;
 else target:=pg_temp.gi_target(good_id);end if;
 entry:=jsonb_build_object('kind',case when good_id is null then 'new' else 'update' end,'rows',jsonb_build_array(n),'target',target,
  'fingerprint',case when good_id is null then null else private.goods_import_fingerprint(good_id) end);
 if guidance is not null then entry:=entry||jsonb_build_object('guidance',guidance);end if;
 if only_guidance then entry:=entry||jsonb_build_object('guidanceOnly',true);end if;
 insert into public.admin_goods_imports(id,actor_id,state,plan) values(batch_id,auth.uid(),'ready',jsonb_build_array(entry));return batch_id;
end$$;
create function pg_temp.gi_kc(good_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('models','[]'::jsonb,'expectedRevision',(select revision from private.goods_kc_reviews where goods_kc_reviews.good_id=$1),
  'expectedContextFingerprint',private.goods_kc_fingerprint($1))$$;
create function pg_temp.gi_base(good_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('good',(select to_jsonb(g) from public.goods g where id=$1),
  'variants',(select jsonb_agg(to_jsonb(v) order by id) from public.goods_variants v where v.good_id=$1),
  'kc',(select to_jsonb(k) from private.goods_kc_reviews k where k.good_id=$1),
  'costs',(select jsonb_agg(to_jsonb(c) order by variant_id) from private.goods_variant_purchase_costs c
   where c.variant_id in(select id from public.goods_variants where goods_variants.good_id=$1)))$$;
create function pg_temp.gi_state(good_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select pg_temp.gi_base(good_id)||jsonb_build_object('afterSales',private.goods_after_sales_document(good_id),
  'sizeChart',private.goods_size_chart_document(good_id),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_log a))$$;
create temp table gi_values(key text primary key,value jsonb);
grant select,insert,update on gi_values to authenticated;
insert into gi_values values('legacy-before',pg_temp.gi_base('guidance-import-2'));

select pg_temp.gi_assert(not exists(
 select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
 where p.oid='private.apply_goods_import_guidance(uuid,integer,text,jsonb)'::regprocedure
 and(acl.grantee=0 or acl.grantee in(select oid from pg_roles where rolname in('anon','authenticated','service_role')))
), 'new helper is sealed from PUBLIC and all three untrusted roles');
select pg_temp.gi_assert(has_function_privilege('postgres','private.apply_goods_import_guidance(uuid,integer,text,jsonb)','execute')
 and exists(select 1 from private.operator_internal_contracts where to_regprocedure(signature)='private.apply_goods_import_guidance(uuid,integer,text,jsonb)'::regprocedure), 'owner helper and registry');

select set_config('request.jwt.claim.sub',pg_temp.gi_id(1)::text,true);
set local role authenticated;
select pg_temp.gi_assert((select value->'afterSales'->>'revision'='0' and value->'sizeChart'->>'revision'='0'
 from public.admin_goods_import_records(array['GI-1']) value),'manager receives current zero-revision child documents');
select pg_temp.gi_expect($q$select public.admin_goods_import_records(array_fill('GI-1'::text,array[501]))$q$,'import_record_limit');
select pg_temp.gi_expect($q$select private.apply_goods_import_guidance(null,null,null,null)$q$,'42501');

-- Guidance-only saves retain every product, option, stock, KC and timestamp byte.
select public.admin_commit_goods_import_group(pg_temp.gi_batch(101,'guidance-import-2',jsonb_build_object('afterSales',pg_temp.gi_as(0),'sizeChart',pg_temp.gi_size(0))),0) as legacy_result \gset
select pg_temp.gi_assert(:'legacy_result'::jsonb->>'status'='success' and pg_temp.gi_base('guidance-import-2')=(select value from gi_values where key='legacy-before'),'legacy guidance save never revalidates or drafts the existing base row');
select pg_temp.gi_assert(public.admin_commit_goods_import_group(pg_temp.gi_id(101),0)=:'legacy_result'::jsonb,'exact batch retry returns the original result');
select pg_temp.gi_assert((select value->'afterSales'->>'revision'='1' and value->'sizeChart'->>'revision'='1'
 from public.admin_goods_import_records(array['GI-2']) value),'export reads the committed revisions');
reset role;
select pg_temp.gi_assert((select count(*) from public.audit_log where id in(
 md5('goods-import-guidance:v1:'||pg_temp.gi_id(101)::text||':'||pg_temp.gi_id(1)::text||':0:afterSales')::uuid,
 md5('goods-import-guidance:v1:'||pg_temp.gi_id(101)::text||':'||pg_temp.gi_id(1)::text||':0:sizeChart')::uuid))=2,'stable per-batch actor/index/kind receipt IDs exist exactly once');

set local role authenticated;
-- Existing and new base saves use the same child CAS contracts inside their savepoint.
select public.admin_commit_goods_import_group(pg_temp.gi_batch(102,'guidance-import-1',jsonb_build_object('afterSales',pg_temp.gi_as(0),'sizeChart',pg_temp.gi_size(0)),false,
 jsonb_set(pg_temp.gi_target('guidance-import-1'),'{name}','"상품과 안내를 함께 변경"')),0) as normal_result \gset
select pg_temp.gi_assert(:'normal_result'::jsonb->>'status'='success','normal product update and both guidance children commit together');
select public.admin_commit_goods_import_group(pg_temp.gi_batch(103,null,jsonb_build_object('afterSales',pg_temp.gi_as(0),'sizeChart',pg_temp.gi_size(0)),false,
 '{"ip_id":"guidance-import-ip","name":"안내 포함 신규 상품","code":"GI-NEW","publish":false,"variants":[{"name":"기본 옵션","code":"GI-NEW-A","attributes":{},"extraPrice":0,"stockQty":3}],"variant_baseline":[]}'::jsonb),0) as new_result \gset
select pg_temp.gi_assert(:'new_result'::jsonb->>'status'='success' and public.admin_get_goods_after_sales_content(:'new_result'::jsonb->>'id')->>'revision'='1'
 and public.admin_get_goods_size_chart(:'new_result'::jsonb->>'id')->>'revision'='1','new product guidance starts at revision zero');
-- Omitted sheet preserves the exact current child document, including revision.
insert into gi_values values('omit-size',public.admin_get_goods_size_chart('guidance-import-1'));
select pg_temp.gi_assert(public.admin_commit_goods_import_group(pg_temp.gi_batch(104,'guidance-import-1',jsonb_build_object('afterSales',pg_temp.gi_as(1,'A/S만 수정'))),0)->>'status'='success'
 and public.admin_get_goods_size_chart('guidance-import-1')=(select value from gi_values where key='omit-size'),'omitted size sheet remains byte-identical');
insert into gi_values values('omit-both',jsonb_build_object('as',public.admin_get_goods_after_sales_content('guidance-import-1'),'size',public.admin_get_goods_size_chart('guidance-import-1')));
select pg_temp.gi_assert(public.admin_commit_goods_import_group(pg_temp.gi_batch(105,'guidance-import-1',null,false),0)->>'status'='success'
 and jsonb_build_object('as',public.admin_get_goods_after_sales_content('guidance-import-1'),'size',public.admin_get_goods_size_chart('guidance-import-1'))=(select value from gi_values where key='omit-both'),'both omitted guidance sheets preserve both documents');
-- A/S explicit clearing remains supported; disabling sizes retains the table.
select pg_temp.gi_assert(public.admin_commit_goods_import_group(pg_temp.gi_batch(106,'guidance-import-1',jsonb_build_object(
 'afterSales',jsonb_build_object('expectedRevision',2,'values',jsonb_build_object('phone','','guide','','sellerSpecialNotes','')),
 'sizeChart',pg_temp.gi_size(1,false))),0)->>'status'='success','explicit A/S clear and size disable commit');
select pg_temp.gi_assert(public.admin_get_goods_after_sales_content('guidance-import-1')->>'phone'=''
 and public.admin_get_goods_size_chart('guidance-import-1')#>>'{values,enabled}'='false'
 and jsonb_array_length(public.admin_get_goods_size_chart('guidance-import-1')#>'{values,chart,sizes}')=1,'clear only the approved A/S fields and retain disabled table');

-- A later size conflict rolls back an earlier A/S save plus all ordinary product work.
reset role;
insert into gi_values values('before-atomic-failure',pg_temp.gi_state('guidance-import-1'));
set local role authenticated;
select pg_temp.gi_batch(107,'guidance-import-1',jsonb_build_object('afterSales',pg_temp.gi_as(3,'롤백될 안내'),'sizeChart',pg_temp.gi_size(1)),false,
 jsonb_set(jsonb_set(pg_temp.gi_target('guidance-import-1'),'{name}','"롤백될 상품명"'),'{variants,0,stockQty}','9')
 ||jsonb_build_object('kc_update',pg_temp.gi_kc('guidance-import-1'),
  'claim_policy',jsonb_build_object('returnAllowed',true,'exchangeAllowed',true,'returnFee',3000))) as atomic_batch \gset
select public.admin_commit_goods_import_group(:'atomic_batch',0) as atomic_result \gset
select pg_temp.gi_assert(:'atomic_result'::jsonb->>'status'='failed' and :'atomic_result'::jsonb->>'error'='goods_size_chart_changed','stale size reports the child CAS error');
select pg_temp.gi_assert(pg_temp.gi_state('guidance-import-1')=(select value from gi_values where key='before-atomic-failure'),'base, options, stock, KC, claim, both children, audits and child receipts all roll back');
select pg_temp.gi_assert(public.admin_commit_goods_import_group(:'atomic_batch',0)=:'atomic_result'::jsonb,'failed batch result is durable and retry never reapplies writes');
reset role;
select pg_temp.gi_assert((select results->'0' from public.admin_goods_imports where id=:'atomic_batch')=:'atomic_result'::jsonb,'only failure result persists in the batch');

-- Parent fingerprint conflict and each child CAS protect separately edited state.
set local role authenticated;
select pg_temp.gi_batch(108,'guidance-import-3',jsonb_build_object('afterSales',pg_temp.gi_as(0))) as parent_batch \gset
reset role;
update public.goods set name='다른 관리자 수정' where id='guidance-import-3';
set local role authenticated;
select pg_temp.gi_assert(public.admin_commit_goods_import_group(:'parent_batch',0)->>'error'='import_product_changed','parent lock/fingerprint rejects stale base state');
select pg_temp.gi_batch(109,'guidance-import-3',jsonb_build_object('afterSales',pg_temp.gi_as(0))) as as_batch \gset
select public.admin_save_goods_after_sales_content('guidance-import-3',0,pg_temp.gi_id(701),pg_temp.gi_as(0,'다른 관리자 안내')->'values');
select pg_temp.gi_assert(public.admin_commit_goods_import_group(:'as_batch',0)->>'error'='goods_after_sales_changed','A/S child independently rejects a later revision');
select public.admin_save_goods_after_sales_content('guidance-import-3',1,pg_temp.gi_id(702),pg_temp.gi_as(1,'두 번째 관리자 안내')->'values');
select pg_temp.gi_assert(public.admin_commit_goods_import_group(:'as_batch',0)->>'error'='goods_after_sales_changed'
 and public.admin_get_goods_after_sales_content('guidance-import-3')->>'revision'='2','retry after another child revision preserves that revision');

-- ID rename cascades existing child rows, then saves against their current revision.
select pg_temp.gi_assert(public.admin_commit_goods_import_group(pg_temp.gi_batch(110,'guidance-import-4',jsonb_build_object('afterSales',pg_temp.gi_as(0),'sizeChart',pg_temp.gi_size(0))),0)->>'status'='success','rename fixture children created');
select pg_temp.gi_assert(public.admin_commit_goods_import_group(pg_temp.gi_batch(111,'guidance-import-4',jsonb_build_object('afterSales',pg_temp.gi_as(1),'sizeChart',pg_temp.gi_size(1)),false,
 jsonb_set(pg_temp.gi_target('guidance-import-4'),'{id}','"guidance-import-renamed"')),0)->>'status'='success','base ID change and child CAS complete atomically');
select pg_temp.gi_assert(public.admin_get_goods_after_sales_content('guidance-import-renamed')->>'revision'='2'
 and public.admin_get_goods_size_chart('guidance-import-renamed')->>'revision'='2','renamed children retain and advance their own revisions');

-- Strict guidance-only scope never silently drops a non-guidance edit.
do $$declare n integer:=200; target jsonb; result jsonb; guidance jsonb;begin
 foreach target in array array[
  '{"previous_id":"guidance-import-5","code":"GI-5","name":"허용 안 함"}'::jsonb,
  '{"previous_id":"guidance-import-5","code":"DIFFERENT"}'::jsonb,
  '{"code":"GI-5"}'::jsonb
 ] loop
  n:=n+1;result:=public.admin_commit_goods_import_group(pg_temp.gi_batch(n,'guidance-import-5',jsonb_build_object('afterSales',pg_temp.gi_as(0)),true,target),0);
  perform pg_temp.gi_assert(result->>'status'='failed','guidance-only rejects extra, mismatched or missing target keys');
 end loop;
 result:=public.admin_commit_goods_import_group(pg_temp.gi_batch(210,null,jsonb_build_object('afterSales',pg_temp.gi_as(0)),true,'{"code":"GI-ILLEGAL-NEW"}'),0);
 perform pg_temp.gi_assert(result->>'error'='invalid_import_guidance_only','new product cannot enter guidance-only');
 result:=public.admin_commit_goods_import_group(pg_temp.gi_batch(211,'guidance-import-5','{}'),0);
 perform pg_temp.gi_assert(result->>'error'='invalid_import_guidance_only','empty guidance-only is not a save');
 foreach guidance in array array[
  '{"other":{}}'::jsonb,'{"afterSales":null}'::jsonb,
  '{"afterSales":{"expectedRevision":-1,"values":{}}}'::jsonb,
  '{"afterSales":{"expectedRevision":1.5,"values":{}}}'::jsonb,
  '{"afterSales":{"expectedRevision":2147483647,"values":{}}}'::jsonb,
  '{"afterSales":{"expectedRevision":0,"values":{},"operationId":"a6c01400-0000-4000-8000-000000000999"}}'::jsonb
 ] loop
  n:=n+1;result:=public.admin_commit_goods_import_group(pg_temp.gi_batch(n,'guidance-import-5',guidance),0);
  perform pg_temp.gi_assert(result->>'error'='invalid_import_guidance','invalid child envelope or client operation ID denied');
 end loop;
end$$;
select pg_temp.gi_batch(220,'guidance-import-5',jsonb_build_object('afterSales',pg_temp.gi_as(0))) as image_batch \gset
reset role;
update public.admin_goods_imports set prepared_images=jsonb_build_object('0',jsonb_build_object('image_path','icons/test-guidance.webp')) where id=:'image_batch';
set local role authenticated;
select pg_temp.gi_assert(public.admin_commit_goods_import_group(:'image_batch',0)->>'error'='invalid_import_guidance_only','prepared image edits cannot hide in guidance-only');
-- Existing table deletion remains forbidden even when sent through XLSX.
select pg_temp.gi_assert(public.admin_commit_goods_import_group(pg_temp.gi_batch(221,'guidance-import-1',jsonb_build_object('sizeChart',
 jsonb_build_object('expectedRevision',2,'values','{"enabled":false,"chart":{"unit":"cm","sizes":[],"measurements":[],"note":""}}'::jsonb)),true),0)->>'error'='goods_size_chart_cannot_clear','XLSX cannot erase an existing size table');

-- Current operator, actor and unauthenticated boundaries are enforced before replay.
select set_config('request.jwt.claim.sub',pg_temp.gi_id(2)::text,true);
select pg_temp.gi_expect(format('select public.admin_commit_goods_import_group(%L,0)',pg_temp.gi_id(101)),'import_not_found');
select pg_temp.gi_assert((select value->'afterSales' is not null and value->'sizeChart' is not null from public.admin_goods_import_records(array['GI-1']) value),'deputy receives its authorized snapshots');
select pg_temp.gi_assert(public.admin_commit_goods_import_group(pg_temp.gi_batch(230,'guidance-import-5',jsonb_build_object('afterSales',pg_temp.gi_as(0))),0)->>'status'='success','deputy catalog manager can save guidance');
select set_config('request.jwt.claim.sub',pg_temp.gi_id(3)::text,true);
select pg_temp.gi_expect($q$select public.admin_goods_import_records(array['GI-1'])$q$,'42501');
select pg_temp.gi_expect(format('select public.admin_commit_goods_import_group(%L,0)',pg_temp.gi_id(101)),'42501');
select set_config('request.jwt.claim.sub',pg_temp.gi_id(4)::text,true);
select pg_temp.gi_expect($q$select public.admin_goods_import_records(array['GI-1'])$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.gi_id(5)::text,true);
select pg_temp.gi_expect(format('select public.admin_commit_goods_import_group(%L,0)',pg_temp.gi_id(101)),'42501');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.gi_expect($q$select public.admin_goods_import_records(array['GI-1'])$q$,'42501');
reset role;
set local role anon;
select pg_temp.gi_expect($q$select public.admin_goods_import_records(array['GI-1'])$q$,'42501');
reset role;
set local role service_role;
select pg_temp.gi_expect($q$select public.admin_goods_import_records(array['GI-1'])$q$,'42501');
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id=pg_temp.gi_id(1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.gi_id(1)::text,true);
select pg_temp.gi_expect(format('select public.admin_commit_goods_import_group(%L,0)',pg_temp.gi_id(101)),'42501');
reset role;

-- No current role has catalog.read without catalog.manage. Simulate only that
-- future projection in this rollback transaction, then restore its exact body.
create temp table gi_capability_source as select pg_get_functiondef('private.operator_role_capabilities(text)'::regprocedure) definition;
do $$declare source text;anchor text:=$a$when 'logistics' then array['home','catalog.announcements']$a$;begin
 select definition into source from gi_capability_source;
 if cardinality(string_to_array(source,anchor))<>2 then raise exception 'readonly capability fixture anchor mismatch';end if;
 execute replace(source,anchor,$a$when 'logistics' then array['home','catalog.read','catalog.announcements']$a$);
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.gi_id(3)::text,true);
select pg_temp.gi_assert(public.has_operator_capability('catalog.read',false) and not public.has_operator_capability('catalog.manage',false),'synthetic read-only fixture scope');
select pg_temp.gi_assert((select value->'good'->>'code'='GI-1' and value->'afterSales'='null'::jsonb and value->'sizeChart'='null'::jsonb
 and not(value->'variants'->0 ? 'purchase_cost_krw') from public.admin_goods_import_records(array['GI-1']) value),'read-only basic records preserved, new private documents null and costs still hidden');
reset role;
do $$declare source text;begin select definition into source from gi_capability_source;execute source;
 perform pg_temp.gi_assert(pg_get_functiondef('private.operator_role_capabilities(text)'::regprocedure)=source,'exact capability function restored before transaction rollback');end$$;
rollback;
