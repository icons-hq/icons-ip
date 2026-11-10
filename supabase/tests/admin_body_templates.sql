\set ON_ERROR_STOP on
-- Explicit synthetic accounts; all fixtures and authority changes roll back.
begin;
load 'safeupdate';
create function pg_temp.bt_id(kind integer,n integer) returns uuid language sql immutable as $$select ('a7b214'||lpad(kind::text,2,'0')||'-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;$$;
create function pg_temp.bt_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'Body template assertion: %',label;end if;end $$;
create function pg_temp.bt_error(q text,code text,expected text default null) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=code and (expected is null or sqlerrm=expected) then return;end if;raise;end;
 raise exception 'Expected SQLSTATE % (%): %',code,expected,q;end $$;
do $$begin if to_regclass('private.operator_legacy_fixture_control') is not null then raise exception 'Run without global legacy fixture helper';end if;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.bt_id(0,n),'authenticated','authenticated','body-template-'||n||'@example.test',now(),'{"testFixture":"admin-body-templates"}','{}' from generate_series(1,3)n;
update public.profiles set role='staff',nickname='본문합성'||right(id::text,1),birth_date='1990-01-01',onboarded_at=now() where id in(select pg_temp.bt_id(0,n) from generate_series(1,3)n);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.bt_id(0,1),'primary'),(pg_temp.bt_id(0,2),'primary'),(pg_temp.bt_id(0,3),'logistics');
update private.operator_access_state set configured=true where id;
create temp table bt_shapes as select jsonb_build_object('goods',(select count(*) from public.goods),'stories',(select count(*) from public.shopping_stories),
 'claims',(select md5(coalesce(jsonb_agg(to_jsonb(c) order by path)::text,'null')) from public.admin_artwork_upload_claims c)) baseline;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.bt_id(0,1)::text,true);
select pg_temp.bt_assert(public.admin_list_goods_body_templates(pg_temp.bt_id(0,1),false)='{"limit":50,"rows":[],"total":0,"archivedCount":0}'::jsonb,'first owner starts empty');
select public.admin_save_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1),0,pg_temp.bt_id(2,1),'민감개인명 합성',
 '<p data-icons-align="center" data-icons-size="24">비공개 템플릿 문구</p><a href="https://example.test/guide">외부 안내</a>') as bt_first \gset
select pg_temp.bt_assert(public.admin_save_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1),0,pg_temp.bt_id(2,1),'민감개인명 합성',
 '<p data-icons-align="center" data-icons-size="24">비공개 템플릿 문구</p><a href="https://example.test/guide">외부 안내</a>')=:'bt_first'::jsonb,'exact request replays original receipt');
select pg_temp.bt_error($q$select public.admin_save_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1),0,pg_temp.bt_id(2,1),'다른 이름','<p>다른 본문</p>')$q$,'23505','operation_conflict');
select pg_temp.bt_error($q$select public.admin_save_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1),0,gen_random_uuid(),'같은 이름','<p>오래된 수정</p>')$q$,'PT409','body_template_conflict');
select pg_temp.bt_assert(public.admin_get_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1))->>'bodyHtml' like '%https://example.test/guide%',
 'one personal store can be read through either authorized surface; destination app sanitizer owns link removal');
select pg_temp.bt_assert(not (public.admin_list_goods_body_templates(pg_temp.bt_id(0,1),false)#>'{rows,0}' ?| array['ownerId','bodyHtml'])
 and (public.admin_list_goods_body_templates(pg_temp.bt_id(0,1),false)#>>'{rows,0,characterCount}')::integer>0,
 'list metadata excludes private owner IDs and full HTML');
select pg_temp.bt_error($q$select public.admin_get_goods_body_template(pg_temp.bt_id(0,2),pg_temp.bt_id(1,1))$q$,'42501','body_template_actor_changed');
select set_config('request.jwt.claim.sub',pg_temp.bt_id(0,2)::text,true);
select pg_temp.bt_assert(public.admin_list_story_body_templates(pg_temp.bt_id(0,2),false)->>'total'='0','another fully privileged manager sees no first-owner rows');
select pg_temp.bt_error($q$select public.admin_get_goods_body_template(pg_temp.bt_id(0,2),pg_temp.bt_id(1,1))$q$,'P0002','body_template_not_found');
select pg_temp.bt_error($q$select public.admin_save_story_body_template(pg_temp.bt_id(0,2),pg_temp.bt_id(1,1),0,gen_random_uuid(),'침범','<p>타인 수정</p>')$q$,'P0002','body_template_not_found');
select pg_temp.bt_error($q$select public.admin_archive_story_body_template(pg_temp.bt_id(0,2),pg_temp.bt_id(1,1),1,gen_random_uuid(),true)$q$,'P0002','body_template_not_found');
select set_config('request.jwt.claim.sub',pg_temp.bt_id(0,1)::text,true);
select public.admin_archive_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1),1,pg_temp.bt_id(2,2),true) as bt_archived \gset
select pg_temp.bt_assert(public.admin_archive_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1),1,pg_temp.bt_id(2,2),true)=:'bt_archived'::jsonb,'archive request replay');
select pg_temp.bt_assert(public.admin_list_goods_body_templates(pg_temp.bt_id(0,1),false)->'rows'='[]'::jsonb
 and public.admin_list_story_body_templates(pg_temp.bt_id(0,1),true)->>'archivedCount'='1'
 and public.admin_list_story_body_templates(pg_temp.bt_id(0,1),true)->>'total'='1','archive is recoverable and still counts toward total quota');
select public.admin_save_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1),2,pg_temp.bt_id(2,3),'보관 상태 수정','<p>보관 중에도 이름과 본문을 재사용합니다.</p>');
select pg_temp.bt_assert(public.admin_get_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1))->>'archivedAt' is not null,'editing archived template does not restore it');
select pg_temp.bt_error($q$select public.admin_archive_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1),2,gen_random_uuid(),false)$q$,'PT409','body_template_conflict');
select public.admin_archive_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1),3,pg_temp.bt_id(2,4),false);
select pg_temp.bt_assert(public.admin_get_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1))->>'archivedAt' is null
 and public.admin_get_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1))->>'revision'='4','restoration uses current revision');

-- Direct Data API bypasses still cannot store image/active-media payloads or
-- tag-only content. Unsupported benign HTML attributes remain untrusted and
-- the server/client destination sanitizer removes them at every UI boundary.
do $$declare html text;begin
 for html in select unnest(array['','   ','<p><br></p>','<p>&nbsp;&#160;&#xA0;</p>',
 '<img src="https://example.test/image.png">','<p>설명</p><IMG src="public-media/catalog/curation/not-authorized.png">',
 '<p>설명</p><script>alert(1)</script>','<p>설명</p><svg></svg>','<p>설명</p><iframe src="https://example.test"></iframe>',repeat('가',30001)]) loop
  perform pg_temp.bt_error(format('select public.admin_save_goods_body_template(%L,%L,0,gen_random_uuid(),%L,%L)',pg_temp.bt_id(0,1),pg_temp.bt_id(1,70),'잘못된 내용',html),'22023','invalid_body_template');
 end loop;
end $$;
select pg_temp.bt_error($q$select public.admin_save_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,70),0,gen_random_uuid(),repeat('가',51),'<p>내용</p>')$q$,'22023','invalid_body_template');
select pg_temp.bt_error($q$select public.admin_save_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,70),0,gen_random_uuid(),E'이름\n바꿈','<p>내용</p>')$q$,'22023','invalid_body_template');
select pg_temp.bt_error($q$select public.admin_list_story_body_templates(pg_temp.bt_id(0,1),null)$q$,'22023','invalid_body_template');
select pg_temp.bt_error($q$select public.admin_get_story_body_template(pg_temp.bt_id(0,1),null)$q$,'22023','invalid_body_template');
do $$declare n integer;begin
 for n in 2..50 loop perform public.admin_save_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,n),0,gen_random_uuid(),'개인 합성 '||n,case when n=50 then repeat('가',30000) else '<p>합성 본문 '||n||'</p>' end);end loop;
end $$;
select pg_temp.bt_assert(public.admin_list_story_body_templates(pg_temp.bt_id(0,1),false)->>'total'='50','50 total including exact body boundary');
select public.admin_archive_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,50),1,pg_temp.bt_id(2,5),true);
select pg_temp.bt_error($q$select public.admin_save_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,51),0,gen_random_uuid(),'초과','<p>51번째</p>')$q$,'23514','body_template_limit');
select public.admin_save_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,50),2,pg_temp.bt_id(2,6),'50개에서 보관 수정','<p>개수 증가 없이 재사용</p>');
select set_config('request.jwt.claim.sub',pg_temp.bt_id(0,2)::text,true);
select public.admin_save_story_body_template(pg_temp.bt_id(0,2),pg_temp.bt_id(1,60),0,pg_temp.bt_id(2,7),'다른 개인','<p>다른 개인의 본문</p>');
select pg_temp.bt_assert(public.admin_list_goods_body_templates(pg_temp.bt_id(0,2),false)->>'total'='1','quota is per owner');
select set_config('request.jwt.claim.sub',pg_temp.bt_id(0,3)::text,true);
select pg_temp.bt_error($q$select public.admin_list_goods_body_templates(pg_temp.bt_id(0,3),false)$q$,'42501','operator_capability_required');
select pg_temp.bt_error($q$select public.admin_get_story_body_template(pg_temp.bt_id(0,3),null)$q$,'42501','operator_capability_required');
select pg_temp.bt_error($q$select public.admin_save_story_body_template(pg_temp.bt_id(0,3),pg_temp.bt_id(1,61),0,gen_random_uuid(),'차단','<p>차단</p>')$q$,'42501','operator_capability_required');
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id=pg_temp.bt_id(0,1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.bt_id(0,1)::text,true);
select pg_temp.bt_error($q$select public.admin_get_goods_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1))$q$,'42501','operator_capability_required');
select pg_temp.bt_error($q$select public.admin_archive_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1),4,gen_random_uuid(),true)$q$,'42501','operator_capability_required');
reset role;
update private.operator_memberships set manager_role='primary' where profile_id=pg_temp.bt_id(0,1);
set local role anon;
select pg_temp.bt_error($q$select public.admin_list_goods_body_templates(pg_temp.bt_id(0,1),false)$q$,'42501');
reset role;
set local role service_role;
select pg_temp.bt_error($q$select public.admin_get_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1))$q$,'42501');
reset role;
select pg_temp.bt_assert((select relrowsecurity from pg_class where oid='private.admin_body_templates'::regclass)
 and not has_table_privilege('authenticated','private.admin_body_templates','select,insert,update,delete')
 and not has_table_privilege('anon','private.admin_body_templates','select,insert,update,delete')
 and not has_table_privilege('service_role','private.admin_body_templates','select,insert,update,delete')
 and not has_function_privilege('authenticated','private.read_body_templates(uuid,text,uuid,boolean)','execute'),
 'private table and helpers sealed across all API roles');
select pg_temp.bt_assert(not exists(select 1 from public.audit_log where target like 'body-template:a7b214%' and
 (diff::text like '%비공개 템플릿 문구%' or diff::text like '%민감개인명%' or diff::text like '%<p>%' or diff::text like '%bodyHtml%' or diff::text like '%"name"%')),
 'shared audit never stores a personal template name or HTML');
select pg_temp.bt_assert((select diff#>>'{request,contentSha256}' ~ '^[0-9a-f]{64}$' from public.audit_log where id=pg_temp.bt_id(2,1)),
 'request receipt binds a SHA-256 content hash');
select pg_temp.bt_assert((select baseline from bt_shapes)=jsonb_build_object('goods',(select count(*) from public.goods),'stories',(select count(*) from public.shopping_stories),
 'claims',(select md5(coalesce(jsonb_agg(to_jsonb(c) order by path)::text,'null')) from public.admin_artwork_upload_claims c)),
 'templates create no product story or artwork ownership');
create temp table bt_audit_before as select count(*) count from public.audit_log;
create temp table bt_locks_before as select locktype,classid,objid,objsubid,mode from pg_locks where pid=pg_backend_pid() and locktype='advisory';
set local transaction_read_only=on;
set local role authenticated;
select public.admin_list_goods_body_templates(pg_temp.bt_id(0,1),true);
select pg_temp.bt_assert(public.admin_get_story_body_template(pg_temp.bt_id(0,1),pg_temp.bt_id(1,1))->>'name'='보관 상태 수정','list/get run in an actual read-only transaction');
reset role;
select pg_temp.bt_assert((select count from bt_audit_before)=(select count(*) from public.audit_log)
 and not exists((select locktype,classid,objid,objsubid,mode from pg_locks where pid=pg_backend_pid() and locktype='advisory') except select * from bt_locks_before),
 'personal reads add neither audit rows nor account locks');
rollback;
