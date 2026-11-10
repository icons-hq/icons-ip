\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000063401','authenticated','authenticated','cs-tools-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000063402','authenticated','authenticated','cs-tools-buyer@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000063403','authenticated','authenticated','cs-tools-other-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id in ('00000000-0000-4000-8000-000000063401','00000000-0000-4000-8000-000000063403');
insert into public.ips(id,title,vertical_key) values('cs-tools','합성 CS 도구 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('cs-tools','cs-tools','합성 리뷰 상품','문구',1000,'ok',10);
insert into public.orders(id,user_id,status,total,address,delivered_at) values
 ('00000000-0000-4000-8000-000000063411','00000000-0000-4000-8000-000000063402','delivered',1000,'{}',now()),
 ('00000000-0000-4000-8000-000000063412','00000000-0000-4000-8000-000000063402','delivered',1000,'{}',now());
insert into public.reviews(id,user_id,good_id,order_id,rating,body) values
 ('00000000-0000-4000-8000-000000063421','00000000-0000-4000-8000-000000063402','cs-tools','00000000-0000-4000-8000-000000063411',5,'합성 리뷰 첫 번째'),
 ('00000000-0000-4000-8000-000000063422','00000000-0000-4000-8000-000000063402','cs-tools','00000000-0000-4000-8000-000000063412',3,'합성 리뷰 두 번째');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063401',true);
select public.admin_save_cs_reply_template('00000000-0000-4000-8000-000000063431','review','product','감사 인사','소중한 리뷰 감사합니다.',0);
select public.admin_save_cs_reply_template('00000000-0000-4000-8000-000000063432','product_question','shipping','배송 안내','배송 안내 합성 본문',0);
select 1/case when (select count(*) from public.cs_reply_templates where id in ('00000000-0000-4000-8000-000000063431','00000000-0000-4000-8000-000000063432'))=2
 and (select revision from public.cs_reply_templates where id='00000000-0000-4000-8000-000000063431')=1
 then 1 else 0 end as assert_public_reply_templates_saved_with_separate_surfaces;
select public.admin_archive_cs_reply_template('00000000-0000-4000-8000-000000063431',true,1);
select 1/case when (select archived_at is not null and revision=2 from public.cs_reply_templates where id='00000000-0000-4000-8000-000000063431') then 1 else 0 end as assert_template_archives_without_deleting_history;
select public.admin_archive_cs_reply_template('00000000-0000-4000-8000-000000063431',false,2);
do $$begin
 begin perform public.admin_save_cs_reply_template('00000000-0000-4000-8000-000000063431','review','other','충돌 제목','이미 다른 작업에서 수정',1);raise exception 'stale template accepted';exception when sqlstate 'PT409' then if sqlerrm<>'cs_reply_template_changed' then raise;end if;end;
 begin perform public.admin_save_cs_reply_template('00000000-0000-4000-8000-000000063433','review','other','길이','x',0);raise exception 'short review template accepted';exception when invalid_parameter_value then null;end;
end$$;
select '[{"id":"00000000-0000-4000-8000-000000063421","expectedReplyAt":null,"expectedEditedAt":null,"expectedStatus":"visible"},{"id":"00000000-0000-4000-8000-000000063422","expectedReplyAt":"2020-01-01T00:00:00Z","expectedEditedAt":null,"expectedStatus":"visible"},{"id":"00000000-0000-4000-8000-000000063429","expectedReplyAt":null,"expectedEditedAt":null,"expectedStatus":"visible"}]'::jsonb as batch_items \gset
select public.admin_reply_reviews_batch('00000000-0000-4000-8000-000000063441',:'batch_items','소중한 리뷰 감사합니다.') as first_result \gset
select 1/case when (:'first_result'::jsonb#>>'{items,0,status}')='saved'
 and (:'first_result'::jsonb#>>'{items,1,code}')='review_changed'
 and (:'first_result'::jsonb#>>'{items,2,code}')='review_not_found'
 and (select admin_reply from public.reviews where id='00000000-0000-4000-8000-000000063422') is null
 then 1 else 0 end as assert_partial_failure_preserves_success_and_each_reason;
select 1/case when public.admin_reply_reviews_batch('00000000-0000-4000-8000-000000063441',:'batch_items','소중한 리뷰 감사합니다.')=:'first_result'::jsonb
 and public.admin_review_reply_batch_result('00000000-0000-4000-8000-000000063441')=:'first_result'::jsonb
 then 1 else 0 end as assert_request_replay_and_completed_readback_are_identical;
do $$begin
 begin perform public.admin_reply_reviews_batch('00000000-0000-4000-8000-000000063441','[{"id":"00000000-0000-4000-8000-000000063421","expectedReplyAt":null,"expectedEditedAt":null,"expectedStatus":"visible"}]','새로운 답글 본문입니다.');raise exception 'same request changed payload';exception when sqlstate 'PT409' then if sqlerrm<>'review_batch_request_changed' then raise;end if;end;
 begin perform public.admin_reply_reviews_batch('00000000-0000-4000-8000-000000063442','[]','빈 대상 답글');raise exception 'empty batch accepted';exception when invalid_parameter_value then null;end;
 begin perform public.admin_reply_reviews_batch('00000000-0000-4000-8000-000000063442',(select jsonb_agg(jsonb_build_object('id',md5(n::text)::uuid,'expectedReplyAt',null,'expectedEditedAt',null,'expectedStatus','visible')) from generate_series(1,51)n),'한도 초과 답글');raise exception 'oversize batch accepted';exception when invalid_parameter_value then null;end;
end$$;
select jsonb_build_array(jsonb_build_object('id',id,'expectedReplyAt',admin_reply_at,'expectedEditedAt',edited_at,'expectedStatus',status)) as saved_items from public.reviews where id='00000000-0000-4000-8000-000000063421' \gset
select 1/case when public.admin_reply_reviews_batch('00000000-0000-4000-8000-000000063443',:'saved_items','소중한 리뷰 감사합니다.')#>>'{items,0,status}'='unchanged'
 then 1 else 0 end as assert_same_reply_is_not_written_twice;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063403',true);
select 1/case when public.admin_review_reply_batch_result('00000000-0000-4000-8000-000000063441') is null then 1 else 0 end as assert_batch_result_is_actor_scoped;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063402',true);
select 1/case when (select count(*) from public.cs_reply_templates)=0 then 1 else 0 end as assert_customers_cannot_read_templates;
do $$begin
 begin perform public.admin_reply_reviews_batch('00000000-0000-4000-8000-000000063449','[]','권한 없는 답글');raise exception 'customer bulk reply accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 1/case when (select count(*) from public.notifications where source_type='review' and source_id='00000000-0000-4000-8000-000000063421')=1
 and (select count(*) from public.audit_log where action='admin.review.reply' and target='review:00000000-0000-4000-8000-000000063421')=1
 and exists(select 1 from public.audit_log where action='admin.cs_reply_template.archived')
 and not has_function_privilege('anon','public.admin_reply_reviews_batch(uuid,jsonb,text)','execute')
 and not has_function_privilege('service_role','public.admin_reply_reviews_batch(uuid,jsonb,text)','execute')
 and not has_table_privilege('authenticated','private.review_reply_batches','select')
 and not has_table_privilege('authenticated','public.cs_reply_templates','update')
 then 1 else 0 end as assert_notifications_audit_and_acl;
rollback;
