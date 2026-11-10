-- Caller prepends BEGIN and helpers/inquiry_satisfaction_fixture.sql. Always rolls back.
-- DRAFT mode seeds legacy rows in an earlier connection; bind this transaction too.
select satisfaction_test.actor(2);
create function satisfaction_test.vote(n integer,op integer,desired text) returns jsonb language plpgsql as $$declare c jsonb;begin
 c:=public.get_my_inquiry_satisfaction(satisfaction_test.id(200+n));
 return public.set_my_inquiry_satisfaction(satisfaction_test.id(op),satisfaction_test.id(200+n),satisfaction_test.id(2),satisfaction_test.id(102),
  (c->>'answerId')::uuid,(c->>'revision')::bigint,desired);end$$;
revoke all on function satisfaction_test.vote(integer,integer,text) from public;
grant execute on function satisfaction_test.vote(integer,integer,text) to authenticated;
create temp table satisfaction_original_thread as select to_jsonb(i) row from public.inquiries i where id=satisfaction_test.id(201);
create temp table satisfaction_original_messages as select to_jsonb(m) row from public.inquiry_messages m where inquiry_id=satisfaction_test.id(201);
create temp table satisfaction_original_side_effects as select
 (select count(*) from public.notifications) notifications,(select count(*) from public.email_deliveries) emails;
set local role authenticated;
select satisfaction_test.ok(public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'revision'='0','legacy answer uses virtual revision zero');
select 'INQUIRY_SATISFACTION_DTO:'||jsonb_build_object('kind','legacy','value',public.get_my_inquiry_satisfaction(satisfaction_test.id(201)))::text;
select satisfaction_test.ok(public.get_my_inquiry_satisfaction(satisfaction_test.id(205))->>'canEvaluate'='false','no staff answer cannot be evaluated');
reset role;
select satisfaction_test.ok(not exists(select 1 from private.inquiry_satisfaction_state where inquiry_id in(select satisfaction_test.id(200+n) from generate_series(1,10)n)),'GET does not backfill state');
set local role authenticated;
select satisfaction_test.ok(satisfaction_test.vote(1,501,'satisfied')#>>'{receipt,afterRevision}'='1','first legacy vote becomes revision one');
select 'INQUIRY_SATISFACTION_DTO:'||jsonb_build_object('kind','completed','request',jsonb_build_object('operationId',satisfaction_test.id(501),'inquiryId',satisfaction_test.id(201),'expectedActorId',satisfaction_test.id(2),'expectedSessionId',satisfaction_test.id(102),'expectedAnswerId',satisfaction_test.id(401),'expectedRevision',0,'desiredValue','satisfied'),
 'value',public.set_my_inquiry_satisfaction(satisfaction_test.id(501),satisfaction_test.id(201),satisfaction_test.id(2),satisfaction_test.id(102),satisfaction_test.id(401),0,'satisfied'))::text;
select satisfaction_test.ok(public.set_my_inquiry_satisfaction(satisfaction_test.id(501),satisfaction_test.id(201),satisfaction_test.id(2),satisfaction_test.id(102),satisfaction_test.id(401),0,'satisfied')#>>'{receipt,afterRevision}'='1','exact replay returns original revision');
select satisfaction_test.error($q$select public.set_my_inquiry_satisfaction(satisfaction_test.id(501),satisfaction_test.id(201),satisfaction_test.id(2),satisfaction_test.id(102),satisfaction_test.id(401),0,'dissatisfied')$q$,'inquiry_satisfaction_operation_conflict');
select satisfaction_test.error($q$select public.set_my_inquiry_satisfaction(satisfaction_test.id(502),satisfaction_test.id(201),satisfaction_test.id(2),satisfaction_test.id(102),satisfaction_test.id(401),0,'dissatisfied')$q$,'inquiry_satisfaction_revision_conflict');
select satisfaction_test.ok(satisfaction_test.vote(1,503,'satisfied')#>>'{receipt,outcome}'='unchanged','same-value fresh operation is a no-op');
reset role;
select satisfaction_test.ok((select count(*)=2 from private.inquiry_satisfaction_operations where inquiry_id=satisfaction_test.id(201)) and
 (select count(*)=1 from public.audit_log where action='inquiry.satisfaction.changed' and target='inquiries:'||satisfaction_test.id(201)::text),'replay/no-op leave two receipts but only one audit');
select satisfaction_test.ok((select row from satisfaction_original_thread)=(select to_jsonb(i) from public.inquiries i where id=satisfaction_test.id(201)) and
 not exists((select row from satisfaction_original_messages except select to_jsonb(m) from public.inquiry_messages m where inquiry_id=satisfaction_test.id(201)) union all
 (select to_jsonb(m) from public.inquiry_messages m where inquiry_id=satisfaction_test.id(201) except select row from satisfaction_original_messages)),'rating preserves every original thread/message field');
select satisfaction_test.ok((select notifications from satisfaction_original_side_effects)=(select count(*) from public.notifications) and
 (select emails from satisfaction_original_side_effects)=(select count(*) from public.email_deliveries),'rating creates no notification/email');
set local role authenticated;
do $$declare result jsonb;begin result:=satisfaction_test.vote(1,504,null);
 perform satisfaction_test.ok(result#>>'{current,value}' is null and result#>>'{current,revision}'='2','withdrawal receipt returns unrated revision two');end$$;
select satisfaction_test.ok(public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'value' is null and
 public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'revision'='2','independent read sees withdrawn revision two');
select satisfaction_test.ok(satisfaction_test.vote(1,505,'dissatisfied')#>>'{current,value}'='dissatisfied','explicit change succeeds');
select public.append_inquiry_message(satisfaction_test.id(201),'합성 추가 질문','{}');
select satisfaction_test.ok(public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'value'='dissatisfied','user followup keeps evaluation');
reset role;
insert into public.inquiry_messages(inquiry_id,author,body) values(satisfaction_test.id(201),'system','합성 자동 안내');
select satisfaction_test.actor(1);set local role authenticated;
select public.admin_close_inquiry(satisfaction_test.id(201));
select satisfaction_test.actor(2);
select satisfaction_test.ok(public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'value'='dissatisfied' and
 public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'revision'='3','system message and closing preserve the prior value and revision before any new rating');
select satisfaction_test.ok(satisfaction_test.vote(1,506,'satisfied')#>>'{current,value}'='satisfied','system and close preserve evaluation and closed remains ratable');
reset role;
-- The next insertion is intentionally older by timestamp: the last inserted ID wins.
insert into public.inquiry_messages(id,inquiry_id,author,author_id,body,created_at)
 values(satisfaction_test.id(451),satisfaction_test.id(201),'staff',satisfaction_test.id(4),'합성 새 답변','2026-10-14T15:00:00Z');
set local role authenticated;
select satisfaction_test.ok(public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'answerId'=satisfaction_test.id(451)::text and public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'value' is null,'last inserted staff answer replaces timestamp maximum and resets current only');
select satisfaction_test.error($q$select public.set_my_inquiry_satisfaction(satisfaction_test.id(507),satisfaction_test.id(201),satisfaction_test.id(2),satisfaction_test.id(102),satisfaction_test.id(401),4,'satisfied')$q$,'inquiry_satisfaction_answer_changed');
select satisfaction_test.ok(public.read_my_inquiry_satisfaction_operation(satisfaction_test.id(501),satisfaction_test.id(201),satisfaction_test.id(2),satisfaction_test.id(102),satisfaction_test.id(401),0,'satisfied')#>>'{receipt,afterValue}'='satisfied' and
 public.read_my_inquiry_satisfaction_operation(satisfaction_test.id(501),satisfaction_test.id(201),satisfaction_test.id(2),satisfaction_test.id(102),satisfaction_test.id(401),0,'satisfied')#>>'{current,value}' is null,'old receipt and new current remain separate');
select satisfaction_test.actor(3);
select satisfaction_test.error($q$select public.get_my_inquiry_satisfaction(satisfaction_test.id(201))$q$,'inquiry_satisfaction_inquiry_unavailable');
select satisfaction_test.actor(2);
select satisfaction_test.error($q$select public.set_my_inquiry_satisfaction(satisfaction_test.id(508),satisfaction_test.id(201),satisfaction_test.id(3),satisfaction_test.id(102),satisfaction_test.id(451),5,'satisfied')$q$,'inquiry_satisfaction_auth_required');
reset role;
update public.profiles set suspended_at=now(),suspension_reason='TEST satisfaction' where id=satisfaction_test.id(2);
set local role authenticated;
select satisfaction_test.ok(public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'canEvaluate'='false','suspended account reads but cannot evaluate');
select satisfaction_test.error($q$select satisfaction_test.vote(1,509,'satisfied')$q$,'inquiry_satisfaction_account_unavailable');
select satisfaction_test.ok(public.read_my_inquiry_satisfaction_operation(satisfaction_test.id(501),satisfaction_test.id(201),satisfaction_test.id(2),satisfaction_test.id(102),satisfaction_test.id(401),0,'satisfied')->>'operation'='completed','suspended owner can recover an existing receipt');
reset role;update public.profiles set suspended_at=null,suspension_reason=null,onboarded_at=null where id=satisfaction_test.id(2);
set local role authenticated;select satisfaction_test.error($q$select satisfaction_test.vote(1,510,'satisfied')$q$,'inquiry_satisfaction_account_unavailable');
reset role;update public.profiles set onboarded_at=now() where id=satisfaction_test.id(2);
update auth.users set banned_until=now()+interval '1 hour' where id=satisfaction_test.id(2);
set local role authenticated;select satisfaction_test.error($q$select satisfaction_test.vote(1,511,'satisfied')$q$,'inquiry_satisfaction_account_unavailable');
reset role;update auth.users set banned_until=null where id=satisfaction_test.id(2);
insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status) values(satisfaction_test.id(901),satisfaction_test.id(2),satisfaction_test.id(902),'awaiting_email_intent');
insert into private.account_action_fences(subject_user_id,deletion_event_id) values(satisfaction_test.id(2),satisfaction_test.id(901));
set local role authenticated;select satisfaction_test.error($q$select satisfaction_test.vote(1,512,'satisfied')$q$,'inquiry_satisfaction_account_unavailable');
reset role;delete from private.account_action_fences where subject_user_id=satisfaction_test.id(2);
set local role authenticated;
select satisfaction_test.vote(1,521,'satisfied');select satisfaction_test.vote(2,522,'satisfied');select satisfaction_test.vote(3,523,'satisfied');select satisfaction_test.vote(4,524,'dissatisfied');
select satisfaction_test.actor(1);
select satisfaction_test.ok(public.admin_inquiry_satisfaction_console(p_query=>'TEST 만족도 d515',p_satisfaction=>'dissatisfied')->>'total'='1'
 and public.admin_inquiry_satisfaction_console(p_query=>'TEST 만족도 d515',p_satisfaction=>'dissatisfied')->'summary'='{"satisfied":3,"dissatisfied":1,"unrated":6}'::jsonb,'filter precedes pagination and summary excludes only satisfaction');
select satisfaction_test.ok(public.admin_inquiry_satisfaction_console(p_query=>'TEST 만족도 d515',p_satisfaction=>'dissatisfied',p_offset=>100)->>'total'='1'
 and public.admin_inquiry_satisfaction_console(p_query=>'TEST 만족도 d515',p_satisfaction=>'dissatisfied',p_offset=>100)->'rows'='[]'::jsonb,'empty later page keeps exact total');
select satisfaction_test.ok(public.admin_inquiry_satisfaction_console(p_query=>'TEST 만족도 d515',p_from=>'2026-10-15',p_to=>'2026-10-15')->>'total'='10'
 and public.admin_inquiry_satisfaction_console(p_query=>'TEST 만족도 d515',p_from=>'2026-10-14',p_to=>'2026-10-14')->>'total'='0','KST reception day boundary preserved');
do $$declare old_rows jsonb;new_rows jsonb;begin
 select jsonb_agg(to_jsonb(r)-'total_count') into old_rows from public.admin_search_inquiries(p_query=>'TEST 만족도 d515',p_limit=>3,p_offset=>2)r;
 select jsonb_agg(v-'satisfaction' order by ord) into new_rows from jsonb_array_elements(public.admin_inquiry_satisfaction_console(p_query=>'TEST 만족도 d515',p_limit=>3,p_offset=>2)->'rows') with ordinality e(v,ord);
 perform satisfaction_test.ok(old_rows=new_rows,'legacy full row/search/SLA ordering parity');end$$;
select 'INQUIRY_SATISFACTION_DTO:'||jsonb_build_object('kind','admin','value',public.admin_inquiry_satisfaction_detail(satisfaction_test.id(201)))::text;
reset role;
savepoint numbered_console;
insert into public.orders(id,user_id,status,total,address)
 values(satisfaction_test.id(701),satisfaction_test.id(2),'pending',1000,'{}');
update public.inquiries set order_id=satisfaction_test.id(701) where id=satisfaction_test.id(201);
set local role authenticated;
select satisfaction_test.ok(
 public.admin_inquiry_satisfaction_console_numbered(p_query=>(select order_number from public.orders where id=satisfaction_test.id(701)))#>>'{rows,0,order_number}'
 =(select order_number from public.orders where id=satisfaction_test.id(701)),
 'numbered console searches and returns the persisted display number');
do $$declare legacy jsonb;numbered jsonb;begin
 legacy:=public.admin_inquiry_satisfaction_console(p_query=>'TEST 만족도 d515');
 numbered:=public.admin_inquiry_satisfaction_console_numbered(p_query=>'TEST 만족도 d515');
 perform satisfaction_test.ok((select jsonb_agg(v-'order_number' order by ord)
  from jsonb_array_elements(numbered->'rows') with ordinality e(v,ord))=legacy->'rows'
  and numbered-'rows'=legacy-'rows','numbered console preserves every legacy field, sort and summary');
end$$;
select 'INQUIRY_SATISFACTION_DTO:'||jsonb_build_object('kind','console','value',public.admin_inquiry_satisfaction_console_numbered(p_query=>'TEST 만족도 d515'))::text;
reset role;rollback to numbered_console;set local role authenticated;
select satisfaction_test.actor(5);select satisfaction_test.error($q$select public.admin_inquiry_satisfaction_console()$q$,'operator_capability_required');
select satisfaction_test.error($q$select public.admin_inquiry_satisfaction_console_numbered()$q$,'operator_capability_required');
reset role;
select satisfaction_test.ok(not has_table_privilege('authenticated','private.inquiry_satisfaction_state','SELECT') and not has_table_privilege('service_role','private.inquiry_satisfaction_operations','INSERT')
 and not has_function_privilege('authenticated','private.inquiry_satisfaction_current(uuid)','EXECUTE') and not has_function_privilege('anon','public.get_my_inquiry_satisfaction(uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.set_my_inquiry_satisfaction(uuid,uuid,uuid,uuid,uuid,bigint,text)','EXECUTE'),'new relations and private helpers sealed');
-- Session cleanup retains historical operation data, but the JWT becomes unusable.
delete from auth.sessions where id=satisfaction_test.id(102);select satisfaction_test.actor(2);set local role authenticated;
select satisfaction_test.error($q$select public.get_my_inquiry_satisfaction(satisfaction_test.id(201))$q$,'inquiry_satisfaction_auth_required');
reset role;select satisfaction_test.ok(exists(select 1 from private.inquiry_satisfaction_operations where actor_id=satisfaction_test.id(2)),'session deletion retains operation history');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values(satisfaction_test.id(102),satisfaction_test.id(2),now(),now(),now()+interval '1 hour');
delete from auth.users where id=satisfaction_test.id(4);
set local role authenticated;
select satisfaction_test.ok(public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'answerId' is null and public.get_my_inquiry_satisfaction(satisfaction_test.id(201))->>'canEvaluate'='false','staff deletion removes target without falling back');
reset role;select satisfaction_test.ok(exists(select 1 from private.inquiry_satisfaction_state where inquiry_id=satisfaction_test.id(201)) and exists(select 1 from private.inquiry_satisfaction_operations where inquiry_id=satisfaction_test.id(201)),'deleted answer keeps state tombstone and historical receipt');
delete from auth.users where id=satisfaction_test.id(2);
select satisfaction_test.ok(not exists(select 1 from private.inquiry_satisfaction_state where inquiry_id in(select satisfaction_test.id(200+n) from generate_series(1,10)n)) and
 not exists(select 1 from private.inquiry_satisfaction_operations where actor_id=satisfaction_test.id(2)),'owner/inquiry FK cleanup cascades without a new delete guard');
select satisfaction_test.ok(exists(select 1 from public.audit_log where action='inquiry.satisfaction.changed' and actor_id is null
 and diff->>'actorId'=satisfaction_test.id(2)::text and not(diff ?| array['body','title','sessionId','email','accessToken'])),'deleted customer retains minimal audit identity without an actor FK blocker');
rollback;
