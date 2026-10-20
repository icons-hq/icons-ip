\set ON_ERROR_STOP on
begin;
create schema inquiry_files_test;
create function inquiry_files_test.id(n integer) returns uuid language sql immutable as $$select ('f1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function inquiry_files_test.actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',inquiry_files_test.id(n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',inquiry_files_test.id(n),'role','authenticated','session_id',inquiry_files_test.id(100+n))::text,true);
end $$;
create function inquiry_files_test.ok(value boolean,label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'file assertion: %',label;end if;raise notice 'PASS %',label;end $$;
create function inquiry_files_test.error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or position(expected in sqlerrm)>0 then raise notice 'PASS rejected %',expected;return;end if;raise;end;
 raise exception 'Expected rejection: %',expected;end $$;
revoke all on all functions in schema inquiry_files_test from public;
grant usage on schema inquiry_files_test to authenticated,service_role;
grant execute on all functions in schema inquiry_files_test to authenticated,service_role;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select inquiry_files_test.id(n),'authenticated','authenticated','chat-file-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role=case when id in(inquiry_files_test.id(2),inquiry_files_test.id(4)) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='합성 파일 계정 '||right(id::text,4),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id in(select inquiry_files_test.id(n) from generate_series(1,4)n);
insert into auth.sessions(id,user_id) select inquiry_files_test.id(100+n),inquiry_files_test.id(n) from generate_series(1,4)n;
insert into private.operator_memberships(profile_id,manager_role) values(inquiry_files_test.id(2),'deputy'),(inquiry_files_test.id(4),'logistics');
insert into public.inquiries(id,user_id,category,title,status) values(inquiry_files_test.id(201),inquiry_files_test.id(1),'etc','합성 파일 상담','open');

set local role service_role;
select inquiry_files_test.ok(public.service_prepare_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(102),inquiry_files_test.id(301),'안내.pdf','application/pdf',20,true)->>'state'='pending','valid operator prepares private file');
select inquiry_files_test.ok(public.service_prepare_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(102),inquiry_files_test.id(301),'안내.pdf','application/pdf',20,true)->>'id'=inquiry_files_test.id(301)::text,'prepare retry keeps same immutable ID');
select inquiry_files_test.error($q$select public.service_prepare_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(102),inquiry_files_test.id(301),'다른.pdf','application/pdf',20,true)$q$,'PT409');
select inquiry_files_test.error($q$select public.service_prepare_inquiry_file(inquiry_files_test.id(1),inquiry_files_test.id(101),inquiry_files_test.id(302),'안내.pdf','application/pdf',20,true)$q$,'42501');
select inquiry_files_test.error($q$select public.service_prepare_inquiry_file(inquiry_files_test.id(4),inquiry_files_test.id(104),inquiry_files_test.id(302),'안내.pdf','application/pdf',20,true)$q$,'42501');
select inquiry_files_test.error($q$select public.service_prepare_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(101),inquiry_files_test.id(302),'안내.pdf','application/pdf',20,true)$q$,'42501');
select inquiry_files_test.error($q$select public.service_prepare_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(102),inquiry_files_test.id(302),'안내.pdf','application/pdf',20971521,true)$q$,'22023');
select inquiry_files_test.error($q$select public.service_prepare_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(102),inquiry_files_test.id(302),'synthetic.html','text/plain',20,true)$q$,'23514');
select inquiry_files_test.ok(public.service_prepare_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(102),inquiry_files_test.id(309),'PHOTO.JPEG','image/jpeg',20,false)->>'state'='pending','JPEG alternate extension is accepted case-insensitively');
select inquiry_files_test.error($q$select public.service_verify_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(102),inquiry_files_test.id(301),repeat('a',64))$q$,'inquiry_file_unverified');
reset role;
select inquiry_files_test.actor(2);
set local role authenticated;
select inquiry_files_test.ok(public.can_upload_inquiry_file(inquiry_files_test.id(2)||'/'||inquiry_files_test.id(301)||'.pdf'),'only matching live session gets upload claim');
select inquiry_files_test.error($q$select public.admin_send_inquiry_chat_message(inquiry_files_test.id(201),'',array[inquiry_files_test.id(301)],inquiry_files_test.id(401))$q$,'inquiry_file_unavailable');
select inquiry_files_test.error($q$select public.admin_send_inquiry_chat_message(inquiry_files_test.id(201),'','{}',inquiry_files_test.id(401))$q$,'22023');
insert into storage.objects(bucket_id,name,owner,metadata) values('inquiry-files-private',inquiry_files_test.id(2)||'/'||inquiry_files_test.id(301)||'.pdf',inquiry_files_test.id(2),'{"mimetype":"application/pdf","size":20}');
select inquiry_files_test.ok((select count(*)=0 from storage.objects where bucket_id='inquiry-files-private'),'private file is not directly selectable even by uploader');
reset role;
set local role service_role;
select inquiry_files_test.ok(public.service_verify_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(102),inquiry_files_test.id(301),repeat('a',64))->>'id'=inquiry_files_test.id(301)::text,'server verification links hash and exact storage metadata');
select inquiry_files_test.ok(public.service_verify_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(102),inquiry_files_test.id(301),repeat('a',64))->>'id'=inquiry_files_test.id(301)::text,'verification retry idempotent');
select inquiry_files_test.error($q$select public.service_verify_inquiry_file(inquiry_files_test.id(2),inquiry_files_test.id(102),inquiry_files_test.id(301),repeat('b',64))$q$,'PT409');
reset role;
select inquiry_files_test.actor(2);
set local role authenticated;
select inquiry_files_test.ok(not public.can_upload_inquiry_file(inquiry_files_test.id(2)||'/'||inquiry_files_test.id(301)||'.pdf'),'verified file cannot be overwritten');
select inquiry_files_test.ok(jsonb_array_length(public.admin_inquiry_file_library())>=1,'verified shared file appears in library');
select public.admin_send_inquiry_chat_message(inquiry_files_test.id(201),'',array[inquiry_files_test.id(301)],inquiry_files_test.id(401));
select public.admin_send_inquiry_chat_message(inquiry_files_test.id(201),'',array[inquiry_files_test.id(301)],inquiry_files_test.id(401));
select inquiry_files_test.error($q$select public.admin_send_inquiry_chat_message(inquiry_files_test.id(201),'다른 본문',array[inquiry_files_test.id(301)],inquiry_files_test.id(401))$q$,'PT409');
select inquiry_files_test.ok((select count(*)=1 from public.inquiry_messages where inquiry_id=inquiry_files_test.id(201)),'same request stores exactly one attachment-only message');
select public.admin_send_inquiry_chat_message(inquiry_files_test.id(201),'네','{}',inquiry_files_test.id(402));
select inquiry_files_test.ok((select count(*)=2 from public.inquiry_messages where inquiry_id=inquiry_files_test.id(201)),'one-character message remains valid');
select inquiry_files_test.actor(1);
select inquiry_files_test.ok((select count(*)=1 from jsonb_object_keys(public.inquiry_message_files(inquiry_files_test.id(201)))),'owner reads message file metadata');
select inquiry_files_test.error($q$select public.admin_inquiry_file_library()$q$,'42501');
select inquiry_files_test.actor(3);
select inquiry_files_test.error($q$select public.inquiry_message_files(inquiry_files_test.id(201))$q$,'42501');
reset role;
select inquiry_files_test.ok((select count(*)=2 from public.notifications where user_id=inquiry_files_test.id(1) and type='inquiry_answered'),'same request creates one notification');
select set_config('inquiry_test.message',(select message_id::text from private.inquiry_chat_send_receipts where operation_id=inquiry_files_test.id(401)),true);
set local role service_role;
select inquiry_files_test.ok(public.service_inquiry_file_download(inquiry_files_test.id(1),inquiry_files_test.id(101),inquiry_files_test.id(301),current_setting('inquiry_test.message')::uuid)->>'sha256'=repeat('a',64),'owner can download attached file');
reset role;
set local role service_role;
select inquiry_files_test.error($q$select public.service_inquiry_file_download(inquiry_files_test.id(3),inquiry_files_test.id(103),inquiry_files_test.id(301),current_setting('inquiry_test.message')::uuid)$q$,'42501');
select inquiry_files_test.error($q$select public.service_inquiry_file_download(inquiry_files_test.id(1),inquiry_files_test.id(101),inquiry_files_test.id(301),null)$q$,'42501');
select inquiry_files_test.error($q$select public.service_inquiry_file_download(inquiry_files_test.id(4),inquiry_files_test.id(104),inquiry_files_test.id(301),current_setting('inquiry_test.message')::uuid)$q$,'42501');
reset role;
select inquiry_files_test.actor(2);
set local role authenticated;
select inquiry_files_test.ok(public.admin_retire_inquiry_file(inquiry_files_test.id(301)),'library delete retires file');
select inquiry_files_test.error($q$select public.admin_send_inquiry_chat_message(inquiry_files_test.id(201),'',array[inquiry_files_test.id(301)],inquiry_files_test.id(403))$q$,'inquiry_file_unavailable');
select inquiry_files_test.ok(public.admin_send_inquiry_chat_message(inquiry_files_test.id(201),'',array[inquiry_files_test.id(301)],inquiry_files_test.id(401))->>'messageId'=current_setting('inquiry_test.message'),'existing send retry survives later library deletion');
reset role;
set local role service_role;
select inquiry_files_test.ok(public.service_inquiry_file_download(inquiry_files_test.id(1),inquiry_files_test.id(101),inquiry_files_test.id(301),current_setting('inquiry_test.message')::uuid)->>'id'=inquiry_files_test.id(301)::text,'library removal retains previously sent download');
select inquiry_files_test.ok(not public.service_claim_inquiry_file_cleanup(20)@>jsonb_build_array(jsonb_build_object('id',inquiry_files_test.id(301))),'cleanup never claims sent file');
reset role;
-- Direct legacy photo replies allow empty text only for a real owned object.
select inquiry_files_test.actor(1);
set local role authenticated;
select inquiry_files_test.error($q$select public.append_inquiry_message(inquiry_files_test.id(201),'',array[inquiry_files_test.id(1)||'/inquiry/f1100000-0000-4000-8000-000000000501.png'])$q$,'inquiry_image_missing');
reset role;
insert into storage.objects(bucket_id,name,owner,metadata) values('user-uploads',inquiry_files_test.id(1)||'/inquiry/f1100000-0000-4000-8000-000000000501.png',inquiry_files_test.id(1),'{"mimetype":"image/png","size":20}');
set local role authenticated;
select inquiry_files_test.ok(public.append_inquiry_message(inquiry_files_test.id(201),'',array[inquiry_files_test.id(1)||'/inquiry/f1100000-0000-4000-8000-000000000501.png']) is not null,'customer photo-only reply stores actual attachment');
reset role;
delete from auth.sessions where id=inquiry_files_test.id(101);
set local role service_role;
select inquiry_files_test.error($q$select public.service_inquiry_file_download(inquiry_files_test.id(1),inquiry_files_test.id(101),inquiry_files_test.id(301),current_setting('inquiry_test.message')::uuid)$q$,'42501');
reset role;
select inquiry_files_test.ok(not has_function_privilege('anon','public.inquiry_message_files(uuid)','execute')
 and not has_function_privilege('authenticated','public.service_inquiry_file_download(uuid,uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_send_inquiry_chat_message(uuid,text,uuid[],uuid)','execute')
 and not has_table_privilege('authenticated','private.inquiry_chat_files','select,insert,update,delete'),'files and operations retain least privilege ACLs');
rollback;
