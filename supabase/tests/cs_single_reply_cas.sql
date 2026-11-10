\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('00000000-0000-4000-8000-'||lpad((63500+n)::text,12,'0'))::uuid,'authenticated','authenticated',
 'cs-single-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role='staff' where id in ('00000000-0000-4000-8000-000000063501','00000000-0000-4000-8000-000000063502','00000000-0000-4000-8000-000000063504');
insert into private.operator_memberships(profile_id,manager_role) values
 ('00000000-0000-4000-8000-000000063501','primary'),('00000000-0000-4000-8000-000000063502','primary'),('00000000-0000-4000-8000-000000063504','logistics');
insert into public.ips(id,title,vertical_key) values('cs-single-reply','합성 단건 답변 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('cs-single-reply','cs-single-reply','합성 답변 상품','문구',1000,'ok',10);
insert into public.orders(id,user_id,status,total,address,delivered_at) values
 ('00000000-0000-4000-8000-000000063541','00000000-0000-4000-8000-000000063503','delivered',1000,'{}',now()),
 ('00000000-0000-4000-8000-000000063542','00000000-0000-4000-8000-000000063503','delivered',1000,'{}',now());
insert into public.reviews(id,user_id,good_id,order_id,rating,body,reply_source_revision) values
 ('00000000-0000-4000-8000-000000063551','00000000-0000-4000-8000-000000063503','cs-single-reply','00000000-0000-4000-8000-000000063541',5,'첫 번째 합성 리뷰 내용',77),
 ('00000000-0000-4000-8000-000000063552','00000000-0000-4000-8000-000000063503','cs-single-reply','00000000-0000-4000-8000-000000063542',3,'일괄 답변 합성 리뷰 내용',0);
insert into public.product_questions(id,good_id,user_id,body,reply_source_revision) values
 ('00000000-0000-4000-8000-000000063561','cs-single-reply','00000000-0000-4000-8000-000000063503','합성 상품 문의 내용입니다.',77);
create temp table single_reply_receipts(surface text, target_id uuid, operation_id uuid, result jsonb);
grant all on single_reply_receipts to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063501',true);
do $$ declare surface text; target uuid; operation uuid; result jsonb; context jsonb; begin
 foreach surface in array array['product_question','review'] loop
  target:=case surface when 'review' then '00000000-0000-4000-8000-000000063551'::uuid else '00000000-0000-4000-8000-000000063561'::uuid end;
  context:=public.admin_cs_reply_context(surface,target);
  if context->>'revision'<>'0' or context->>'id'<>target::text then raise exception 'initial revision not reset';end if;
  operation:=gen_random_uuid();
  result:=public.admin_save_cs_reply(operation,auth.uid(),surface,target,'운영자가 작성한 첫 답변입니다.',0);
  if result->>'revision'<>'1' or result->>'expectedRevision'<>'0' or result->>'changed'<>'true' then raise exception 'incorrect save receipt';end if;
  insert into single_reply_receipts values(surface,target,operation,result);
  if public.admin_save_cs_reply(operation,auth.uid(),surface,target,'운영자가 작성한 첫 답변입니다.',0)<>result
   or public.admin_cs_reply_operation(operation,auth.uid(),surface,target,'운영자가 작성한 첫 답변입니다.',0)<>result then raise exception 'receipt replay mismatch';end if;
  begin perform public.admin_save_cs_reply(operation,auth.uid(),surface,target,'변경한 재전송 문구입니다.',0);raise exception 'changed body replayed';
   exception when sqlstate 'PT409' then if sqlerrm<>'cs_reply_operation_changed' then raise;end if;end;
  begin perform public.admin_save_cs_reply(operation,auth.uid(),surface,target,'운영자가 작성한 첫 답변입니다.',1);raise exception 'changed revision replayed';
   exception when sqlstate 'PT409' then if sqlerrm<>'cs_reply_operation_changed' then raise;end if;end;
  begin perform public.admin_save_cs_reply(gen_random_uuid(),auth.uid(),surface,target,'운영자가 작성한 첫 답변입니다.',0);raise exception 'stale same-body request accepted';
   exception when sqlstate 'PT409' then if sqlerrm<>'cs_reply_source_changed' then raise;end if;end;
  begin perform public.admin_save_cs_reply(gen_random_uuid(),'00000000-0000-4000-8000-000000063502',surface,target,'다른 계정에 남은 문구',1);raise exception 'account mismatch accepted';
   exception when insufficient_privilege then if sqlerrm<>'cs_reply_account_changed' then raise;end if;end;
 end loop;
 begin perform public.admin_answer_product_question('00000000-0000-4000-8000-000000063561','구형 함수 우회');raise exception 'legacy question callable';exception when insufficient_privilege then null;end;
 begin perform public.admin_reply_to_review('00000000-0000-4000-8000-000000063551','구형 함수 우회');raise exception 'legacy review callable';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Mark notifications read, then ensure a no-op does not resurface or re-audit them.
update public.notifications set read_at=clock_timestamp() where source_id in ('00000000-0000-4000-8000-000000063551','00000000-0000-4000-8000-000000063561');
create temp table single_reply_notifications as select id,read_at,created_at,body from public.notifications where source_id in ('00000000-0000-4000-8000-000000063551','00000000-0000-4000-8000-000000063561');
set local role authenticated;
do $$ declare row record; result jsonb; begin
 for row in select * from single_reply_receipts loop
  result:=public.admin_save_cs_reply(gen_random_uuid(),auth.uid(),row.surface,row.target_id,row.result->>'body',1);
  if result->>'changed'<>'false' or result->>'revision'<>'1' then raise exception 'same body did not no-op';end if;
 end loop;
end $$;
reset role;
select 1/case when (select count(*) from public.audit_log where action in('product_question.answer','admin.review.reply') and target in ('review:00000000-0000-4000-8000-000000063551','product_questions:00000000-0000-4000-8000-000000063561'))=2
 and not exists(select * from single_reply_notifications except select id,read_at,created_at,body from public.notifications)
 and (select count(*) from public.notifications where source_id in ('00000000-0000-4000-8000-000000063551','00000000-0000-4000-8000-000000063561'))=2
 then 1 else 0 end as noop_and_replay_have_zero_audit_notification_effects;
-- Metadata-only edits cannot create spurious conflicts, and manual revision writes are ignored.
update public.product_questions set updated_at=clock_timestamp(),answered_at=clock_timestamp(),reply_source_revision=99 where id='00000000-0000-4000-8000-000000063561';
update public.reviews set edited_at=clock_timestamp(),admin_reply_at=clock_timestamp(),reply_source_revision=99 where id='00000000-0000-4000-8000-000000063551';
select 1/case when (select reply_source_revision=1 from public.product_questions where id='00000000-0000-4000-8000-000000063561')
 and (select reply_source_revision=1 from public.reviews where id='00000000-0000-4000-8000-000000063551') then 1 else 0 end as unrelated_metadata_does_not_advance_revision;
update public.product_questions set body=body||' 수정' where id='00000000-0000-4000-8000-000000063561';
update public.product_questions set body='합성 상품 문의 내용입니다.' where id='00000000-0000-4000-8000-000000063561';
update public.reviews set rating=4,image_paths=array['00000000-0000-4000-8000-000000063503/review/00000000-0000-4000-8000-000000063591.jpg'] where id='00000000-0000-4000-8000-000000063551';
update public.reviews set rating=5,image_paths='{}' where id='00000000-0000-4000-8000-000000063551';
update public.product_questions set status='hidden' where id='00000000-0000-4000-8000-000000063561';
update public.product_questions set status='visible' where id='00000000-0000-4000-8000-000000063561';
update public.reviews set status='hidden',hidden_reason='합성 블라인드',hidden_at=now(),hidden_by='00000000-0000-4000-8000-000000063501' where id='00000000-0000-4000-8000-000000063551';
update public.reviews set status='visible',hidden_reason=null,hidden_at=null,hidden_by=null where id='00000000-0000-4000-8000-000000063551';
set local role authenticated;
do $$ declare row record;begin
 for row in select * from single_reply_receipts loop
  if public.admin_cs_reply_context(row.surface,row.target_id)->>'revision'<>'5' then raise exception 'ABA revision was lost';end if;
  begin perform public.admin_save_cs_reply(gen_random_uuid(),auth.uid(),row.surface,row.target_id,row.result->>'body',1);raise exception 'ABA overwrite accepted';
   exception when sqlstate 'PT409' then if sqlerrm<>'cs_reply_source_changed' then raise;end if;end;
  if public.admin_save_cs_reply(row.operation_id,auth.uid(),row.surface,row.target_id,row.result->>'body',0)<>row.result then raise exception 'late replay altered receipt';end if;
 end loop;
end $$;
-- Existing batch still calls the sealed writer through its SECURITY DEFINER owner.
select 1/case when public.admin_reply_reviews_batch('00000000-0000-4000-8000-000000063571','[{"id":"00000000-0000-4000-8000-000000063552","expectedReplyAt":null,"expectedEditedAt":null,"expectedStatus":"visible"}]','기존 일괄 답변은 유지합니다.')#>>'{items,0,status}'='saved' then 1 else 0 end as nested_batch_writer_still_works;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063502',true);
do $$ declare row record;begin
 for row in select * from single_reply_receipts loop
  if public.admin_cs_reply_operation(row.operation_id,auth.uid(),row.surface,row.target_id,row.result->>'body',0) is not null then raise exception 'foreign receipt leaked';end if;
  begin perform public.admin_save_cs_reply(row.operation_id,auth.uid(),row.surface,row.target_id,row.result->>'body',0);raise exception 'foreign actor replayed';
   exception when sqlstate 'PT409' then if sqlerrm<>'cs_reply_operation_changed' then raise;end if;end;
 end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063504',true);
do $$ begin
 begin perform public.admin_cs_reply_context('review','00000000-0000-4000-8000-000000063551');raise exception 'logistics read bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_cs_reply_operation(gen_random_uuid(),auth.uid(),'review','00000000-0000-4000-8000-000000063551','문구',0);raise exception 'logistics receipt bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_save_cs_reply(gen_random_uuid(),auth.uid(),'review','00000000-0000-4000-8000-000000063551','문구',0);raise exception 'logistics write bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id='00000000-0000-4000-8000-000000063501';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063501',true);
do $$ declare row record;begin
 select * into row from single_reply_receipts limit 1;
 begin perform public.admin_save_cs_reply(row.operation_id,auth.uid(),row.surface,row.target_id,row.result->>'body',0);raise exception 'revoked actor replayed';exception when insufficient_privilege then null;end;
 begin perform public.admin_cs_reply_operation(row.operation_id,auth.uid(),row.surface,row.target_id,row.result->>'body',0);raise exception 'revoked actor read receipt';exception when insufficient_privilege then null;end;
end $$;
reset role;
update private.operator_memberships set manager_role='primary' where profile_id='00000000-0000-4000-8000-000000063501';
delete from public.product_questions where id='00000000-0000-4000-8000-000000063561';
delete from public.reviews where id='00000000-0000-4000-8000-000000063551';
set local role authenticated;
do $$ declare row record;begin
 for row in select * from single_reply_receipts loop
  if public.admin_cs_reply_operation(row.operation_id,auth.uid(),row.surface,row.target_id,row.result->>'body',0)<>row.result
   or public.admin_save_cs_reply(row.operation_id,auth.uid(),row.surface,row.target_id,row.result->>'body',0)<>row.result then raise exception 'deletion lost completed receipt';end if;
  begin perform public.admin_save_cs_reply(gen_random_uuid(),auth.uid(),row.surface,row.target_id,'삭제 이후 새 답변',5);raise exception 'deleted target recreated';exception when no_data_found then null;end;
  begin perform public.admin_cs_reply_context(row.surface,row.target_id);raise exception 'deleted context leaked';exception when no_data_found then null;end;
 end loop;
end $$;
reset role;
select 1/case when not has_function_privilege('authenticated','public.admin_reply_to_review(uuid,text)','execute')
 and not has_function_privilege('authenticated','public.admin_answer_product_question(uuid,text)','execute')
 and not has_function_privilege('anon','public.admin_save_cs_reply(uuid,uuid,text,uuid,text,bigint)','execute')
 and not has_function_privilege('service_role','public.admin_save_cs_reply(uuid,uuid,text,uuid,text,bigint)','execute')
 and not has_table_privilege('authenticated','private.cs_reply_operations','select')
 and not has_table_privilege('service_role','private.cs_reply_operations','select')
 and (select reply_source_revision=1 from public.reviews where id='00000000-0000-4000-8000-000000063552') then 1 else 0 end as sealed_acl_and_batch_revision;
rollback;
