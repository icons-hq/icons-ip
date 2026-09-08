\set ON_ERROR_STOP on
begin;

-- 문의 RPC/RLS의 공개 계약: 첫 답변자 유지, 감사된 재배정, 고객/API 메모 차단,
-- 고객 독촉이 대기 시간을 초기화하지 않는 큐 순서를 실제 역할로 검증한다.
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-00000000415' || n)::uuid, 'authenticated', 'authenticated',
  'inquiry-ops-' || n || '@example.test', now(), '{}', '{}', now(), now()
from generate_series(1, 4) as n;
update public.profiles set role = case when right(id::text, 1) in ('2','3') then 'staff' else 'user' end::public.user_role,
  nickname = case right(id::text, 1) when '2' then '수민' when '3' then '지우' else '구매자_' || right(id::text, 1) end,
  birth_date = '2000-01-01', consents = '{"terms":true,"privacy":true}', onboarded_at = now()
where id::text like '00000000-0000-4000-8000-00000000415%';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004151', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.create_inquiry('etc','assignment-smoke-first','배송 확인 부탁드립니다.') as inquiry_id \gset
select 1 / case when (select assignee_id is null and waiting_since = created_at
  from public.inquiries where id = :'inquiry_id') then 1 else 0 end as assert_new_inquiry_waits_unassigned;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004152', true);
select message_id as first_reply from public.admin_answer_inquiry(:'inquiry_id', '확인하겠습니다.') \gset
select 1 / case when (select assignee_id = '00000000-0000-4000-8000-000000004152' and waiting_since is null
  from public.inquiries where id = :'inquiry_id') then 1 else 0 end as assert_first_reply_assigns_and_clears_wait;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004153', true);
select message_id as second_reply from public.admin_answer_inquiry(:'inquiry_id', '이어서 확인했습니다.') \gset
select 1 / case when (select assignee_id = '00000000-0000-4000-8000-000000004152'
  and handled_by = '00000000-0000-4000-8000-000000004153'
  from public.inquiries where id = :'inquiry_id') then 1 else 0 end as assert_followup_reply_preserves_assignee;
select 1 / case when (select count(*) from public.inquiry_message_author_names(:'inquiry_id')
  where (message_id = :'first_reply' and author_name = '수민') or (message_id = :'second_reply' and author_name = '지우')) = 2
  then 1 else 0 end as assert_staff_sees_actual_reply_authors;

select public.admin_reassign_inquiry(:'inquiry_id', '00000000-0000-4000-8000-000000004153', '오후 담당 인계');
select 1 / case when not public.admin_reassign_inquiry(:'inquiry_id', '00000000-0000-4000-8000-000000004153', '오후 담당 인계')
  then 1 else 0 end as assert_same_assignment_is_noop;
select 1 / case when (select count(*) from public.audit_log where action = 'admin.inquiry.reassigned'
  and target = 'inquiries:' || :'inquiry_id' and actor_id = '00000000-0000-4000-8000-000000004153'
  and diff->>'before' = '00000000-0000-4000-8000-000000004152'
  and diff->>'after' = '00000000-0000-4000-8000-000000004153'
  and diff->>'reason' = '오후 담당 인계') = 1 then 1 else 0 end as assert_reassignment_audited_once;
select public.admin_add_inquiry_internal_note(:'inquiry_id', '고객 비노출: 물류팀과 재확인') as note_id \gset
select 1 / case when (select body = '고객 비노출: 물류팀과 재확인' from public.inquiry_internal_notes where id = :'note_id')
  then 1 else 0 end as assert_staff_can_read_note;
select 1 / case when public.admin_inquiry_workspace(:'inquiry_id')->>'assigneeName' = '지우'
  and public.admin_inquiry_workspace(:'inquiry_id')->'notes'->0->>'authorName' = '지우'
  then 1 else 0 end as assert_workspace_names_and_notes;
select 1 / case when (select status = 'answered' and waiting_since is null from public.inquiries where id = :'inquiry_id')
  then 1 else 0 end as assert_note_does_not_reopen_or_reset_customer_thread;

-- 고객이 같은 Data API table/RPC로 접근해도 내부 메모는 읽을 수 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004151', true);
select 1 / case when (select count(*) from public.inquiry_internal_notes where inquiry_id = :'inquiry_id') = 0
  then 1 else 0 end as assert_customer_data_api_cannot_read_internal_notes;
select 1 / case when (select count(*) from public.inquiry_messages where inquiry_id = :'inquiry_id'
  and body like '%고객 비노출%') = 0 then 1 else 0 end as assert_customer_messages_exclude_notes;
select 1 / case when (select count(*) from public.inquiry_message_author_names(:'inquiry_id')) = 2
  then 1 else 0 end as assert_customer_can_read_reply_names;
select set_config('test.inquiry_id', :'inquiry_id', true);
do $$ begin
  begin
    perform public.admin_inquiry_workspace(current_setting('test.inquiry_id')::uuid);
    raise exception 'customer workspace must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_add_inquiry_internal_note(current_setting('test.inquiry_id')::uuid, '공격');
    raise exception 'customer note write must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_reassign_inquiry(current_setting('test.inquiry_id')::uuid, null, '공격');
    raise exception 'customer reassignment must fail';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004154', true);
select 1 / case when (select count(*) from public.inquiry_message_author_names(:'inquiry_id')) = 0
  then 1 else 0 end as assert_other_customer_cannot_enumerate_reply_names;
select 1 / case when (select count(*) from public.inquiry_internal_notes) = 0
  then 1 else 0 end as assert_other_customer_cannot_read_notes;

-- 답변 후 고객의 첫 추가 질문이 새 대기를 시작한다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004151', true);
select public.append_inquiry_message(:'inquiry_id', '다시 확인 부탁드립니다.');
select 1 / case when (select status = 'open' and waiting_since = last_message_at and answered_at is not null
  from public.inquiries where id = :'inquiry_id') then 1 else 0 end as assert_reopened_wait_starts_even_after_first_answer;
select public.create_inquiry('etc', 'assignment-smoke-second', '다른 문의입니다.') as later_inquiry_id \gset
reset role;
-- Clock fixtures: first inquiry has waited 25h, second 23h. A recent reminder must
-- leave the first inquiry at the head of the queue, including across pagination.
update public.inquiries set waiting_since = now() - interval '25 hours' where id = :'inquiry_id';
update public.inquiries set waiting_since = now() - interval '23 hours' where id = :'later_inquiry_id';
set local role authenticated;
select public.append_inquiry_message(:'inquiry_id', '추가로 문의합니다.');
select 1 / case when (select waiting_since = now() - interval '25 hours' from public.inquiries where id = :'inquiry_id')
  then 1 else 0 end as assert_reminder_does_not_reset_wait;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004153', true);
select 1 / case when (select id = :'inquiry_id' and waiting_since <= now() - interval '24 hours'
  from public.admin_search_inquiries('open', null, null, null, 'assignment-smoke', 'title', 1, 0))
  then 1 else 0 end as assert_overdue_first_before_pagination;
select 1 / case when (select id = :'later_inquiry_id' and waiting_since > now() - interval '24 hours'
  from public.admin_search_inquiries('open', null, null, null, 'assignment-smoke', 'title', 1, 1))
  then 1 else 0 end as assert_non_overdue_on_next_page;

-- 활성 운영자만 배정할 수 있다.
do $$ begin
  begin
    perform public.admin_reassign_inquiry(current_setting('test.inquiry_id')::uuid,
      '00000000-0000-4000-8000-000000004154', '일반 사용자 배정 시도');
    raise exception 'user assignee must fail';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
update public.profiles set suspended_at = now(), suspension_reason = 'inquiry smoke suspension' where id = '00000000-0000-4000-8000-000000004152';
set local role authenticated;
do $$ begin
  begin
    perform public.admin_reassign_inquiry(current_setting('test.inquiry_id')::uuid,
      '00000000-0000-4000-8000-000000004152', '정지 운영자 배정 시도');
    raise exception 'suspended assignee must fail';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004152', true);
select 1 / case when (select count(*) from public.inquiry_internal_notes) = 0
  then 1 else 0 end as assert_suspended_staff_cannot_read_notes;
reset role;

select 1 / case when not has_table_privilege('anon', 'public.inquiry_internal_notes', 'select')
  and not has_table_privilege('authenticated', 'public.inquiry_internal_notes', 'insert')
  and not has_table_privilege('authenticated', 'public.inquiry_internal_notes', 'update')
  and not has_table_privilege('authenticated', 'public.inquiry_internal_notes', 'delete')
  and not has_table_privilege('service_role', 'public.inquiry_internal_notes', 'select')
  and not has_function_privilege('anon', 'public.admin_inquiry_workspace(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.inquiry_message_author_names(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_reassign_inquiry(uuid,uuid,text)', 'execute')
  then 1 else 0 end as assert_least_privilege;
rollback;
