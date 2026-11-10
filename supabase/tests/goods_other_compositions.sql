\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. Isolated local/CI database only.
-- All synthetic setup and actual public writes roll back, including raw DTO captures.
begin;
-- Synthetic data for the disposable owned clone. Caller begins a transaction.
set local timezone='UTC';
load 'safeupdate';
create schema other_comp_test;
create function other_comp_test.id(n integer) returns uuid language sql immutable as $$select ('a71c0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function other_comp_test.actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',case when n=0 then '' else other_comp_test.id(n)::text end,true);
 perform set_config('request.jwt.claims',case when n=0 then '{"role":"anon"}' else jsonb_build_object('sub',other_comp_test.id(n),'role','authenticated','session_id',other_comp_test.id(1000+n))::text end,true);
end$$;
create function other_comp_test.ok(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Other composition assertion: %',label;end if;raise notice 'PASS %',label;end$$;
create function other_comp_test.error(q text,wanted text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=wanted or sqlstate=wanted then raise notice 'PASS rejected %',wanted;return;end if;raise;end;raise exception 'Expected other composition error %',wanted;end$$;
create function other_comp_test.values(kind text default 'other_composition',ids text[] default array['oc-fixture-a','oc-fixture-b','oc-fixture-c']) returns jsonb language sql stable as $$
 select jsonb_build_object('kind',kind,'title','다른 구성 합성','representativeGoodId',ids[1],'enabled',true,'startsAt',null,'endsAt',null,'goodIds',to_jsonb(ids),'visual',null)
 ||case when kind='other_composition' then '{"compositionLabels":[]}'::jsonb else '{}'::jsonb end
$$;
grant usage on schema other_comp_test to anon,authenticated,service_role;
grant execute on all functions in schema other_comp_test to anon,authenticated,service_role;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select other_comp_test.id(n),'authenticated','authenticated','oc-fixture-'||n||'@example.test',now(),'{"testFixture":"other-composition"}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role=case when id=other_comp_test.id(4) then 'user'::public.user_role else 'staff'::public.user_role end,
 nickname='다른구성합성 '||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id in(select other_comp_test.id(n) from generate_series(1,4)n);
insert into private.operator_memberships(profile_id,manager_role) values(other_comp_test.id(1),'primary'),(other_comp_test.id(2),'deputy'),(other_comp_test.id(3),'logistics');
-- Committed race fixtures must satisfy the real deferred owner invariant too.
-- Add a synthetic owner only when the cloned source has no existing owner.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select other_comp_test.id(5),'authenticated','authenticated','oc-fixture-owner@example.test',now(),'{"testFixture":"other-composition"}','{}'
where not exists(select 1 from private.operator_memberships where manager_role='owner');
update public.profiles set role='staff',onboarded_at=now(),birth_date='1990-01-01',consents='{"terms":true,"privacy":true}' where id=other_comp_test.id(5);
insert into private.operator_memberships(profile_id,manager_role)select other_comp_test.id(5),'owner' where exists(select 1 from public.profiles where id=other_comp_test.id(5));
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)select other_comp_test.id(1000+n),other_comp_test.id(n),now(),now(),now()+interval '2 hours' from generate_series(1,4)n;
insert into public.ips(id,title,vertical_key,published_at)values('oc-fixture-ip','다른구성 합성 IP','character',now());
insert into public.goods(id,ip_id,name,code,type,price,stock,stock_qty)
select 'oc-fixture-'||key,'oc-fixture-ip','다른구성 합성 '||key,'OC-A71C-'||upper(key),'문구',1000,'ok',10 from unnest(array['a','b','c','d','e','f','g','h','i','j','k','draft'])key;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id like 'oc-fixture-%' and id<>'oc-fixture-draft';
insert into private.operator_memberships(profile_id,manager_role)
select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'oc-fixture-%' and id<>'oc-fixture-draft';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'oc-fixture-%' and id<>'oc-fixture-draft' order by id;
set local role service_role;
select public.service_prepare_admin_artwork_upload(other_comp_test.id(1),'catalog/curation/a71c0000-0000-4000-8000-000000000301.webp','curation','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification(other_comp_test.id(1),'catalog/curation/a71c0000-0000-4000-8000-000000000301.webp');
select public.service_verify_admin_artwork_upload(other_comp_test.id(1),'catalog/curation/a71c0000-0000-4000-8000-000000000301.webp',100);
reset role;
select other_comp_test.actor(1);set local role authenticated;
select public.admin_save_goods_relation_composition(other_comp_test.id(101),0,other_comp_test.id(201),other_comp_test.values('together'));
select public.admin_save_goods_relation_composition(other_comp_test.id(102),0,other_comp_test.id(202),other_comp_test.values('similar'));
select public.admin_save_goods_relation_composition(other_comp_test.id(103),0,other_comp_test.id(203),other_comp_test.values('codi')||'{"visual":{"imagePath":"public-media/catalog/curation/a71c0000-0000-4000-8000-000000000301.webp","alt":"합성 코디","description":"","hotspots":[]}}');
reset role;
-- Fixed fixture timestamps make complete before/after reader JSON comparable;
-- this does not alter owner/ACL, visibility, source functions or authorization.
update public.goods_relations set created_at='2026-10-01T00:00:00Z',updated_at='2026-10-01T00:00:00Z' where id in(other_comp_test.id(101),other_comp_test.id(102),other_comp_test.id(103));
select other_comp_test.actor(1);set local role authenticated;

-- Continue authenticated fixture; all mutations below roll back.
select other_comp_test.ok(current_user='authenticated' and auth.uid()=other_comp_test.id(1) and (auth.jwt()->>'session_id')::uuid=other_comp_test.id(1001),'actual authenticated actor and persisted session claims');
select other_comp_test.ok(public.admin_save_goods_relation_composition(other_comp_test.id(101),0,other_comp_test.id(201),other_comp_test.values('together'))=jsonb_build_object('id',other_comp_test.id(101),'revision',1),'legacy raw request replay survives unchanged');
select (public.admin_get_product_detail_presentation()->'values')-'otherComposition' as legacy_values \gset
select (public.admin_get_product_detail_presentation()->'revisions')-'otherComposition' as legacy_revisions \gset
select other_comp_test.ok(public.admin_get_product_detail_presentation()#>'{values,otherComposition}'='{"enabled":false}'::jsonb and public.admin_get_product_detail_presentation()#>>'{revisions,otherComposition}'='0','new independent setting defaults off');
reset role;select other_comp_test.actor(0);set local role anon;
select jsonb_build_object('oldA',public.get_good_relations('oc-fixture-a'),'oldB',public.get_good_relations('oc-fixture-b'),
 'compositionA',public.get_good_relation_compositions('oc-fixture-a'),'compositionB',public.get_good_relation_compositions('oc-fixture-b'),
 'detailA',public.get_product_detail_presentation('oc-fixture-a'),'detailB',public.get_product_detail_presentation('oc-fixture-b')) as before_new_kind \gset
reset role;select other_comp_test.actor(1);set local role authenticated;
select other_comp_test.values()||'{"compositionLabels":[{"goodId":"oc-fixture-a","label":"숨긴 대표 전용"},{"goodId":"oc-fixture-b","label":"2개 세트"},{"goodId":"oc-fixture-c","label":"lav"}]}'::jsonb as other_values \gset
select public.admin_save_goods_relation_composition(other_comp_test.id(110),0,other_comp_test.id(210),:'other_values') as first_receipt \gset
select other_comp_test.ok(public.admin_save_goods_relation_composition(other_comp_test.id(110),0,other_comp_test.id(210),:'other_values')=:'first_receipt'::jsonb,'same operation request returns same receipt');
select other_comp_test.error(format($q$select public.admin_save_goods_relation_composition(%L,0,%L,%L)$q$,other_comp_test.id(110),other_comp_test.id(210),:'other_values'::jsonb||'{"title":"다른 요청"}'),'goods_relation_operation_conflict');
select other_comp_test.error(format($q$select public.admin_save_goods_relation_composition(%L,0,%L,%L)$q$,other_comp_test.id(110),other_comp_test.id(211),:'other_values'),'goods_relation_changed');
select other_comp_test.error(format($q$select public.admin_save_goods_relation(%L,1,%L)$q$,other_comp_test.id(110),other_comp_test.values('together')-'visual'),'goods_relation_visual_required');
select other_comp_test.ok(public.admin_get_goods_relation(other_comp_test.id(110))#>>'{goods,2,compositionLabel}'='lav','v-ending label is preserved without escape-literal trimming');
select other_comp_test.ok(public.admin_list_goods_relations(p_query=>'다른구성 합성',p_kind=>'other_composition')->>'total'='1','new kind has its own administrator filter');
reset role;
select other_comp_test.ok((select count(*)=1 from public.audit_log where id=other_comp_test.id(210)),'one audit row for idempotent save');
set local role anon;select other_comp_test.actor(0);
select other_comp_test.ok(jsonb_build_object('oldA',public.get_good_relations('oc-fixture-a'),'oldB',public.get_good_relations('oc-fixture-b'),
 'compositionA',public.get_good_relation_compositions('oc-fixture-a'),'compositionB',public.get_good_relation_compositions('oc-fixture-b'),
 'detailA',public.get_product_detail_presentation('oc-fixture-a'),'detailB',public.get_product_detail_presentation('oc-fixture-b'))=:'before_new_kind'::jsonb,
 'actual anonymous old three-kind readers and detail remain exact with a new other-composition row');
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-b')='{"groups":[],"nextChangeAt":null}'::jsonb,'disabled display has no candidates');
select other_comp_test.error($q$select public.get_good_other_compositions(null)$q$,'invalid_other_composition_good');
select other_comp_test.error($q$select * from public.goods_relation_members$q$,'42501');
reset role;select other_comp_test.actor(1);set local role authenticated;
select public.admin_save_product_detail_presentation('otherComposition','{"enabled":true}',0,other_comp_test.id(220)) as setting_receipt \gset
select other_comp_test.ok(public.admin_save_product_detail_presentation('otherComposition','{"enabled":true}',0,other_comp_test.id(220))=:'setting_receipt'::jsonb,'independent setting request replay');
select other_comp_test.error(format($q$select public.admin_save_product_detail_presentation('otherComposition','{"enabled":false}',0,%L)$q$,other_comp_test.id(220)),'operation_conflict');
select other_comp_test.error(format($q$select public.admin_save_product_detail_presentation('otherComposition','{"enabled":false}',0,%L)$q$,other_comp_test.id(221)),'product_detail_conflict');
select other_comp_test.ok((public.admin_get_product_detail_presentation()->'values')-'otherComposition'=:'legacy_values'::jsonb and (public.admin_get_product_detail_presentation()->'revisions')-'otherComposition'=:'legacy_revisions'::jsonb,'legacy setting values and revisions remain exact');
select other_comp_test.error($q$select public.admin_save_product_detail_presentation('otherComposition','{"enabled":true,"similar":true}',1,gen_random_uuid())$q$,'invalid_product_detail_presentation');
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-b')#>'{groups,0,goods}'=jsonb_build_array(jsonb_build_object('goodId','oc-fixture-a','compositionLabel','숨긴 대표 전용'),jsonb_build_object('goodId','oc-fixture-c','compositionLabel','lav')),'public response preserves explicit member order and labels');
select 'OTHER_COMPOSITION_DTO:'||jsonb_build_object('kind','administrator','value',public.admin_get_goods_relation(other_comp_test.id(110)),
 'list',public.admin_list_goods_relations(p_query=>'다른구성 합성',p_kind=>'other_composition'),
 'settings',public.admin_get_product_detail_presentation())::text;
reset role;
update public.goods set published_at=null where id='oc-fixture-a';
set local role anon;select other_comp_test.actor(0);
select public.get_good_other_compositions('oc-fixture-b') as public_b \gset
select 'OTHER_COMPOSITION_DTO:'||jsonb_build_object('kind','anonymous','goodId','oc-fixture-b','value',:'public_b'::jsonb)::text;
select other_comp_test.ok(:'public_b'::jsonb#>'{groups,0,goods}'='[{"goodId":"oc-fixture-c","compositionLabel":"lav"}]'::jsonb and position('oc-fixture-a' in :'public_b')=0 and position('숨긴 대표 전용' in :'public_b')=0,'private representative identity and label never leak while B sees C');
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-c')#>'{groups,0,goods}'='[{"goodId":"oc-fixture-b","compositionLabel":"2개 세트"}]'::jsonb,'C symmetrically sees B');
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-a')='{"groups":[],"nextChangeAt":null}'::jsonb,'private current product is unavailable');
select other_comp_test.ok(public.get_good_relation_compositions('oc-fixture-b')='{"groups":[],"nextChangeAt":null}'::jsonb,'legacy three-kind representative public gate remains intact');
reset role;select other_comp_test.actor(4);set local role authenticated;
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-b')=:'public_b'::jsonb,'customer and anonymous public projections match');
select 'OTHER_COMPOSITION_DTO:'||jsonb_build_object('kind','authenticated','goodId','oc-fixture-b','value',public.get_good_other_compositions('oc-fixture-b'))::text;
select other_comp_test.error($q$select public.admin_get_goods_relation(other_comp_test.id(110))$q$,'42501');
select other_comp_test.error($q$insert into public.goods_relation_members(relation_id,good_id,position)values(other_comp_test.id(110),'oc-fixture-d',4)$q$,'42501');
reset role;select other_comp_test.actor(3);set local role authenticated;
select other_comp_test.error($q$select public.admin_save_goods_relation_composition(other_comp_test.id(115),0,gen_random_uuid(),other_comp_test.values())$q$,'operator_capability_required');
select other_comp_test.error($q$select public.admin_save_product_detail_presentation('otherComposition','{"enabled":false}',1,gen_random_uuid())$q$,'operator_capability_required');
reset role;select other_comp_test.actor(1);set local role authenticated;
select public.admin_save_goods_relation_composition(other_comp_test.id(111),0,other_comp_test.id(211),other_comp_test.values('other_composition',array['oc-fixture-b','oc-fixture-d']));
select other_comp_test.ok(jsonb_array_length(public.get_good_other_compositions('oc-fixture-b')->'groups')=2 and position('oc-fixture-d' in public.get_good_other_compositions('oc-fixture-c')::text)=0,'overlapping groups stay separate without transitive candidates');
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-d')#>'{groups,0,goods}'='[{"goodId":"oc-fixture-b","compositionLabel":null}]'::jsonb,'optional label is explicit null');
-- Disable the second group to isolate zero-candidate and time gates.
select public.admin_save_goods_relation_composition(other_comp_test.id(111),1,other_comp_test.id(212),other_comp_test.values('other_composition',array['oc-fixture-b','oc-fixture-d'])||'{"enabled":false}');
reset role;
savepoint no_candidate;update public.goods set published_at=null where id='oc-fixture-c';set local role anon;
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-b')='{"groups":[],"nextChangeAt":null}'::jsonb,'no public alternatives hides the group');
reset role;rollback to no_candidate;
savepoint restricted;update public.goods set sale_restriction='adult' where id='oc-fixture-c';set local role anon;
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-b')='{"groups":[],"nextChangeAt":null}'::jsonb,'restricted candidate is absent');
reset role;rollback to restricted;
savepoint archived;update public.goods_variants set stock_qty=0 where good_id='oc-fixture-c';update public.goods set stock_qty=0,archived_at=now() where id='oc-fixture-c';set local role anon;
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-b')='{"groups":[],"nextChangeAt":null}'::jsonb,'archived candidate is absent');
reset role;rollback to archived;
savepoint ip_private;update public.ips set published_at=null where id='oc-fixture-ip';set local role anon;
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-b')='{"groups":[],"nextChangeAt":null}'::jsonb,'unpublished IP removes the group');
reset role;rollback to ip_private;
savepoint soldout;update public.goods_variants set stock_qty=0 where good_id='oc-fixture-c';set local role anon;
select other_comp_test.ok(jsonb_array_length(public.get_good_other_compositions('oc-fixture-b')->'groups')=1,'sold out alternatives remain discoverable');
reset role;rollback to soldout;
select other_comp_test.actor(1);set local role authenticated;
do $$declare ids text[];bad jsonb;begin
 select array_agg('oc-fixture-'||chr(96+n) order by n)into ids from generate_series(1,10)n;
 perform public.admin_save_goods_relation_composition(other_comp_test.id(112),0,other_comp_test.id(213),other_comp_test.values('other_composition',ids));
 perform other_comp_test.ok(jsonb_array_length(public.admin_get_goods_relation(other_comp_test.id(112))->'goods')=10,'ten-member composition is accepted');
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  other_comp_test.values('other_composition',array['oc-fixture-b']),
  other_comp_test.values('other_composition',array_append(ids,'oc-fixture-k')),
  other_comp_test.values('other_composition',array['oc-fixture-b','oc-fixture-b']),
  other_comp_test.values('other_composition',array['oc-fixture-b','missing-fixture']),
  other_comp_test.values()||'{"representativeGoodId":"oc-fixture-k"}'))loop
  perform other_comp_test.error(format('select public.admin_save_goods_relation_composition(%L,0,gen_random_uuid(),%L)',other_comp_test.id(119),bad),'invalid_goods_relation_goods');
 end loop;
 perform other_comp_test.error(format('select public.admin_save_goods_relation_composition(%L,0,gen_random_uuid(),%L)',other_comp_test.id(119),other_comp_test.values()||'{"visual":{}}'),'invalid_goods_relation_visual');
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_array(jsonb_build_object('goodId','oc-fixture-b','label',repeat('가',41))),
  '[{"goodId":"oc-fixture-k","label":"2개"}]'::jsonb,
  '[{"goodId":"oc-fixture-b","label":"2개"},{"goodId":"oc-fixture-b","label":"3개"}]'::jsonb,
  '[{"goodId":"oc-fixture-b","label":"2개","extra":true}]'::jsonb,
  jsonb_build_array(jsonb_build_object('goodId','oc-fixture-b','label',chr(160)||'2개')),
  jsonb_build_array(jsonb_build_object('goodId','oc-fixture-b','label','2개'||chr(65279))),
  jsonb_build_array(jsonb_build_object('goodId','oc-fixture-b','label','2'||chr(133)||'개')),
  '[{"goodId":"oc-fixture-b","label":""}]'::jsonb))loop
  perform other_comp_test.error(format('select public.admin_save_goods_relation_composition(%L,0,gen_random_uuid(),%L)',other_comp_test.id(119),jsonb_set(other_comp_test.values(),'{compositionLabels}',bad)),'invalid_goods_relation_composition_labels');
 end loop;
 perform other_comp_test.error(format('select public.admin_save_goods_relation_composition(%L,0,gen_random_uuid(),%L)',other_comp_test.id(119),other_comp_test.values('similar')||'{"compositionLabels":[]}'),'invalid_goods_relation');
 for bad in select jsonb_build_object('title',value) from unnest(array['줄'||chr(10)||'바꿈','제어'||chr(133)||'문자',chr(160)||'구성','구성'||chr(65279)])value loop
  perform other_comp_test.error(format('select public.admin_save_goods_relation_composition(%L,0,gen_random_uuid(),%L)',other_comp_test.id(119),other_comp_test.values()||bad),'invalid_goods_relation');
 end loop;
 perform public.admin_save_goods_relation_composition(other_comp_test.id(116),0,other_comp_test.id(216),other_comp_test.values('similar')||jsonb_build_object('title','기존'||chr(10)||'제목','enabled',false));
 perform other_comp_test.ok(public.admin_get_goods_relation(other_comp_test.id(116))->>'title'='기존'||chr(10)||'제목','existing three-kind title acceptance is unchanged');
 perform public.admin_save_goods_relation_composition(other_comp_test.id(117),0,other_comp_test.id(217),other_comp_test.values()||jsonb_build_object('title','  '||repeat('🌷',15)||'  ','enabled',false));
 perform other_comp_test.ok(public.admin_get_goods_relation(other_comp_test.id(117))->>'title'=repeat('🌷',15),'new title preserves fifteen Unicode characters and ordinary space normalization');

end$$;
-- Narrow the ten-member row away from the live visibility cases.
select public.admin_save_goods_relation_composition(other_comp_test.id(112),1,other_comp_test.id(214),other_comp_test.values('other_composition',array['oc-fixture-j','oc-fixture-k'])||'{"enabled":false}');
reset role;
do $$begin
 update public.goods_relations set starts_at=statement_timestamp(),ends_at=statement_timestamp()+interval '1 day' where id=other_comp_test.id(110);
 perform other_comp_test.ok(jsonb_array_length(public.get_good_other_compositions('oc-fixture-b')->'groups')=1,'start boundary is inclusive');
 update public.goods_relations set starts_at=null,ends_at=statement_timestamp() where id=other_comp_test.id(110);
 perform other_comp_test.ok(jsonb_array_length(public.get_good_other_compositions('oc-fixture-b')->'groups')=0,'end boundary is exclusive');
 update public.goods_relations set starts_at=statement_timestamp()+interval '1 hour',ends_at=null where id=other_comp_test.id(110);
 perform other_comp_test.ok((public.get_good_other_compositions('oc-fixture-b')->>'nextChangeAt')::timestamptz=statement_timestamp()+interval '1 hour','future period boundary is retained');
end$$;
update public.goods_relations set starts_at=null,ends_at=null where id=other_comp_test.id(110);
select other_comp_test.actor(1);set local role authenticated;
select public.admin_save_goods_relation_composition(other_comp_test.id(113),0,other_comp_test.id(215),other_comp_test.values('other_composition',array['oc-fixture-draft','oc-fixture-b'])||'{"compositionLabels":[{"goodId":"oc-fixture-draft","label":"초안 구성"}]}');
reset role;update public.goods set id='oc-fixture-draft-renamed' where id='oc-fixture-draft';
select other_comp_test.ok(exists(select 1 from public.goods_relation_members where relation_id=other_comp_test.id(113) and good_id='oc-fixture-draft-renamed' and composition_label='초안 구성') and (select representative_good_id='oc-fixture-draft-renamed' from public.goods_relations where id=other_comp_test.id(113)),'draft URL cascade preserves representative and composition label');
set local role service_role;select other_comp_test.error($q$select public.get_good_other_compositions('oc-fixture-b')$q$,'42501');reset role;
select other_comp_test.ok(not has_function_privilege('service_role','public.get_good_other_compositions(text)','EXECUTE') and not has_table_privilege('authenticated','public.goods_relation_members','INSERT') and not has_table_privilege('anon','private.product_detail_settings','SELECT'),'new reader does not widen raw data privileges');
create temp table oc_locks as select locktype,classid,objid,objsubid,mode from pg_locks where pid=pg_backend_pid()and locktype='advisory';
create temp table oc_before_read as select md5(jsonb_build_object('relations',(select jsonb_agg(to_jsonb(r)order by id)from public.goods_relations r),'members',(select jsonb_agg(to_jsonb(r)order by relation_id,good_id)from public.goods_relation_members r),'settings',(select jsonb_agg(to_jsonb(r)order by section)from private.product_detail_settings r),'audit',(select jsonb_agg(to_jsonb(r)order by id)from public.audit_log r))::text)hash;
set local transaction_read_only=on;set local role anon;
select other_comp_test.ok(public.get_good_other_compositions('oc-fixture-b')=:'public_b'::jsonb,'actual read-only transaction returns the same projection');
reset role;
select other_comp_test.ok(not exists((select locktype,classid,objid,objsubid,mode from pg_locks where pid=pg_backend_pid()and locktype='advisory')except select * from oc_locks),'public read adds no advisory locks');
select other_comp_test.ok((select hash from oc_before_read)=md5(jsonb_build_object('relations',(select jsonb_agg(to_jsonb(r)order by id)from public.goods_relations r),'members',(select jsonb_agg(to_jsonb(r)order by relation_id,good_id)from public.goods_relation_members r),'settings',(select jsonb_agg(to_jsonb(r)order by section)from private.product_detail_settings r),'audit',(select jsonb_agg(to_jsonb(r)order by id)from public.audit_log r))::text),'public read does not mutate relation setting or audit rows');
rollback;
