\set ON_ERROR_STOP on
-- SHEET-017: 리뷰이벤트 문구 템플릿(저장·수정·삭제·검색). 합성 데이터는 모두 롤백한다.
-- 적립금 정책이 꺼져 있어도 템플릿은 저장되고, 이벤트 저장은 그대로 막히는지 함께 고정한다.
begin;
load 'safeupdate';
create function pg_temp.review_template_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected review event template error: %',expected;end $$;
-- 리뷰이벤트 저장 요청 값(정책 꺼짐 상태에서 저장 검사 순서를 확인할 때 쓴다).
create function pg_temp.review_event_values_for(p_title text,p_description text) returns jsonb language sql as $$
 select jsonb_build_object('title',p_title,'description',p_description,'targetType','all','goodIds','[]'::jsonb,'categoryIds','[]'::jsonb,
  'startsOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+1)::text,'endsOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+3)::text,
  'announcesOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+6)::text,'plannedWinners',4,'creditAmount',1000,'creditValidityDays',10,'bannerStyle','basic');$$;
update private.operator_access_state set configured=false where id;
delete from private.operator_memberships where true;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('93100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','review-template-'||n||'@example.test',now(),'{}','{}' from generate_series(1,8)n;
update public.profiles set role=case when id='93100000-0000-4000-8000-000000000001' then 'admin'::public.user_role when right(id::text,12)::integer<=6 then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='템플릿 합성 '||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like '93100000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role)
 select ('93100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,role from unnest(array['owner','primary','deputy','influencer','agency','logistics']) with ordinality r(role,n);
update private.operator_access_state set configured=true where id;
-- 적립금 정책 꺼짐(11/3 운영 결정과 같은 상태).
update private.store_credit_policy set enabled=false where singleton;

-- 바깥에서 읽을 수 없다: 익명은 함수 실행 권한이 없고, 표는 어떤 롤에도 열려 있지 않다.
set local role anon;
select pg_temp.review_template_error($q$select public.admin_list_review_event_templates()$q$,'42501');
reset role;
select 1/case when not has_table_privilege('authenticated','private.review_event_templates','select,insert,update,delete')
 and not has_table_privilege('service_role','private.review_event_templates','select,insert,update,delete') then 1 else 0 end as table_closed;

set local role authenticated;
-- cs.manage가 있는 운영자(deputy)가 정책 꺼짐 상태에서 템플릿을 저장한다.
select set_config('request.jwt.claim.sub','93100000-0000-4000-8000-000000000003',true);
select 1/case when (public.admin_review_event_credit_policy()->>'enabled')::boolean=false then 1 else 0 end as credit_policy_off;
select public.admin_save_review_event_template('93100000-0000-4000-8000-000000000101',0,'93100000-0000-4000-8000-000000001001','포토리뷰 이벤트','사진과 함께 후기를 남겨주세요') as first_saved \gset
select 1/case when (:'first_saved'::jsonb)->>'title'='포토리뷰 이벤트' and (:'first_saved'::jsonb)->>'description'='사진과 함께 후기를 남겨주세요'
 and ((:'first_saved'::jsonb)->>'revision')::integer=1 then 1 else 0 end as saved_while_policy_off;
-- 같은 요청은 같은 결과, 같은 요청 번호에 다른 내용은 거절, 낡은 revision은 덮어쓰지 않는다.
select 1/case when public.admin_save_review_event_template('93100000-0000-4000-8000-000000000101',0,'93100000-0000-4000-8000-000000001001','포토리뷰 이벤트','사진과 함께 후기를 남겨주세요')=:'first_saved'::jsonb then 1 else 0 end as exact_replay;
select pg_temp.review_template_error($q$select public.admin_save_review_event_template('93100000-0000-4000-8000-000000000101',0,'93100000-0000-4000-8000-000000001001','다른 제목','사진과 함께 후기를 남겨주세요')$q$,'operation_conflict');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template('93100000-0000-4000-8000-000000000101',0,gen_random_uuid(),'포토리뷰 이벤트','사진 후기')$q$,'review_event_template_changed');
-- 이벤트 칸과 같은 규칙: 이벤트명 1~15자·내용 1~30자, 앞뒤 공백·제어 문자 없음.
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),'1234567890123456','내용')$q$,'invalid_review_event_template');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),'제목','1234567890123456789012345678901')$q$,'invalid_review_event_template');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),' 제목','내용')$q$,'invalid_review_event_template');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),'제목',E'첫 줄\n둘째 줄')$q$,'invalid_review_event_template');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),'','내용')$q$,'invalid_review_event_template');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),-1,gen_random_uuid(),'제목','내용')$q$,'invalid_review_event_template');
select 1/case when (public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),'123456789012345','123456789012345678901234567890')->>'revision')::integer=1 then 1 else 0 end as max_lengths_fit;
-- 앞뒤 공백은 앱(JS trim)과 같은 기준이다: NBSP·전각 공백·BOM·줄 구분자도 앞뒤에 오면 거절하고, 가운데 공백은 그대로 둔다.
-- (btrim만 보면 NBSP 끝 문구가 저장되고, 앱이 그 행을 읽지 못해 템플릿 목록이 깨진다.)
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),E'제목 ','내용')$q$,'invalid_review_event_template');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),E'　제목','내용')$q$,'invalid_review_event_template');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),'제목',E'내용﻿')$q$,'invalid_review_event_template');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),'제목',E' 내용')$q$,'invalid_review_event_template');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),E'제목 ','내용')$q$,'invalid_review_event_template');
select 1/case when public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),E'포토 리뷰',E'사진　후기')->>'title'=E'포토 리뷰' then 1 else 0 end as inner_unicode_space_kept;
-- 이벤트 저장은 정책이 꺼져 있으면 여전히 막힌다(템플릿과 무관한 기존 검사).
select pg_temp.review_template_error(format($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),%L::jsonb)$q$,
 jsonb_build_object('title','포토리뷰 이벤트','description','사진과 함께 후기를 남겨주세요','targetType','all','goodIds','[]'::jsonb,'categoryIds','[]'::jsonb,
  'startsOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+1)::text,'endsOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+3)::text,
  'announcesOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+6)::text,'plannedWinners',4,'creditAmount',1000,'creditValidityDays',10,'bannerStyle','basic')),'review_event_credit_policy');
-- 리뷰이벤트 저장도 같은 기준이다(20261112200600): 직접 RPC로 앞뒤에 NBSP·전각 공백·BOM·줄 구분자가 붙은 이벤트명·내용은
-- 정책 검사 전에 invalid_review_event로 거절하고(목록을 깨는 행이 더는 들어오지 않는다), 가운데 공백은 받아 정책 검사(꺼짐)까지 간다.
select pg_temp.review_template_error(format($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),%L::jsonb)$q$,
 pg_temp.review_event_values_for(E' 포토리뷰 이벤트','사진과 함께 후기를 남겨주세요')),'invalid_review_event');
select pg_temp.review_template_error(format($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),%L::jsonb)$q$,
 pg_temp.review_event_values_for('포토리뷰 이벤트',E'사진과 함께 후기를 남겨주세요　')),'invalid_review_event');
select pg_temp.review_template_error(format($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),%L::jsonb)$q$,
 pg_temp.review_event_values_for(E'﻿포토리뷰 이벤트','사진과 함께 후기를 남겨주세요')),'invalid_review_event');
select pg_temp.review_template_error(format($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),%L::jsonb)$q$,
 pg_temp.review_event_values_for('포토리뷰 이벤트',E'사진과 함께 후기를 남겨주세요 ')),'invalid_review_event');
select pg_temp.review_template_error(format($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),%L::jsonb)$q$,
 pg_temp.review_event_values_for(E'포토 리뷰　이벤트','사진과 함께 후기를 남겨주세요')),'review_event_credit_policy');

-- 수정: 읽은 revision으로 저장하면 revision이 오르고, 감사 로그에 이전 문구가 남는다.
select public.admin_save_review_event_template('93100000-0000-4000-8000-000000000101',1,'93100000-0000-4000-8000-000000001002','포토리뷰 이벤트','사진 한 장과 사용 후기를 남겨주세요') as updated \gset
select 1/case when ((:'updated'::jsonb)->>'revision')::integer=2 and (:'updated'::jsonb)->>'description'='사진 한 장과 사용 후기를 남겨주세요' then 1 else 0 end as updated_revision;
reset role;
select 1/case when (select count(*) from public.audit_log where id='93100000-0000-4000-8000-000000001002' and action='admin.review_event.template.saved'
 and actor_id='93100000-0000-4000-8000-000000000003' and diff->'before'->>'description'='사진과 함께 후기를 남겨주세요' and diff->'result'->>'revision'='2')=1 then 1 else 0 end as update_audited;
select 1/case when (select count(*) from public.audit_log where id='93100000-0000-4000-8000-000000001001' and diff->'before'='null'::jsonb)=1 then 1 else 0 end as create_audited;
-- RPC를 거치지 않는 쓰기도 표 검사가 같은 기준으로 막는다.
select pg_temp.review_template_error($q$insert into private.review_event_templates(id,title,description,created_by,updated_by)
 values(gen_random_uuid(),E'제목 ','내용','93100000-0000-4000-8000-000000000003','93100000-0000-4000-8000-000000000003')$q$,'23514');
select pg_temp.review_template_error($q$update private.review_event_templates set description=E'﻿'||description where id='93100000-0000-4000-8000-000000000101'$q$,'23514');
set local role authenticated;
select set_config('request.jwt.claim.sub','93100000-0000-4000-8000-000000000003',true);

-- 검색: 이벤트명·내용 어느 쪽이든 부분 일치로 찾고(영문 대소문자 무시), 최근 수정 순 20개씩.
select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),'Photo Review','Share your photo');
select public.admin_save_review_event_template(('93100000-0000-4000-8000-0000000002'||lpad(n::text,2,'0'))::uuid,0,gen_random_uuid(),'합성 템플릿 '||n,'페이지 확인 '||n) from generate_series(1,20)n;
select 1/case when (public.admin_list_review_event_templates('포토리뷰')->>'total')::integer=1 then 1 else 0 end as search_title;
select 1/case when (public.admin_list_review_event_templates('사용 후기',1)->>'total')::integer=1 then 1 else 0 end as search_description;
select 1/case when (public.admin_list_review_event_templates('  PHOTO ',1)->>'total')::integer=1 then 1 else 0 end as search_ignores_case_and_spaces;
select 1/case when (public.admin_list_review_event_templates('합성 템플릿 1')->>'total')::integer=11 then 1 else 0 end as search_substring;
select 1/case when (public.admin_list_review_event_templates('없는 문구',1)->>'total')::integer=0 then 1 else 0 end as search_miss;
select pg_temp.review_template_error($q$select public.admin_list_review_event_templates('',0)$q$,'invalid_review_event_template_search');
select pg_temp.review_template_error($q$select public.admin_list_review_event_templates(repeat('가',101),1)$q$,'invalid_review_event_template_search');
select 1/case when (public.admin_list_review_event_templates('',1)->>'total')::integer=24
 and (public.admin_list_review_event_templates('',1)->>'pageSize')::integer=20
 and jsonb_array_length(public.admin_list_review_event_templates('',1)->'rows')=20
 and jsonb_array_length(public.admin_list_review_event_templates('',2)->'rows')=4 then 1 else 0 end as paged;
select 1/case when not exists(
 select 1 from jsonb_array_elements(public.admin_list_review_event_templates('',1)->'rows') with ordinality a(item,i)
 join jsonb_array_elements(public.admin_list_review_event_templates('',1)->'rows') with ordinality b(item,i) on b.i=a.i+1
 where (a.item->>'updatedAt')::timestamptz<(b.item->>'updatedAt')::timestamptz) then 1 else 0 end as recent_first;
select public.admin_save_review_event_template('93100000-0000-4000-8000-000000000201',1,gen_random_uuid(),'합성 템플릿 1','다시 고친 문구');
select 1/case when public.admin_list_review_event_templates('',1)->'rows'->0->>'id'='93100000-0000-4000-8000-000000000201' then 1 else 0 end as updated_moves_first;

-- 권한: cs.manage가 없는 물류 운영자와 일반 회원은 읽지도 쓰지도 못한다.
select set_config('request.jwt.claim.sub','93100000-0000-4000-8000-000000000006',true);
select pg_temp.review_template_error($q$select public.admin_list_review_event_templates()$q$,'operator_capability_required');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),'제목','내용')$q$,'operator_capability_required');
select pg_temp.review_template_error($q$select public.admin_delete_review_event_template('93100000-0000-4000-8000-000000000101',2,gen_random_uuid())$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub','93100000-0000-4000-8000-000000000007',true);
select pg_temp.review_template_error($q$select public.admin_list_review_event_templates()$q$,'operator_capability_required');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template(gen_random_uuid(),0,gen_random_uuid(),'제목','내용')$q$,'operator_capability_required');

-- 삭제: 읽은 revision이 맞아야 지우고, 같은 요청은 같은 결과, 이미 지운 템플릿은 다시 지우거나 고치지 못한다.
select set_config('request.jwt.claim.sub','93100000-0000-4000-8000-000000000001',true);
select pg_temp.review_template_error($q$select public.admin_delete_review_event_template('93100000-0000-4000-8000-000000000101',1,gen_random_uuid())$q$,'review_event_template_changed');
select pg_temp.review_template_error($q$select public.admin_delete_review_event_template('93100000-0000-4000-8000-000000000101',0,gen_random_uuid())$q$,'invalid_review_event_template');
select public.admin_delete_review_event_template('93100000-0000-4000-8000-000000000101',2,'93100000-0000-4000-8000-000000001003') as deleted \gset
select 1/case when :'deleted'::jsonb='{"id":"93100000-0000-4000-8000-000000000101","deleted":true}'::jsonb then 1 else 0 end as delete_receipt;
select 1/case when public.admin_delete_review_event_template('93100000-0000-4000-8000-000000000101',2,'93100000-0000-4000-8000-000000001003')=:'deleted'::jsonb then 1 else 0 end as delete_replay;
select pg_temp.review_template_error($q$select public.admin_delete_review_event_template('93100000-0000-4000-8000-000000000101',2,gen_random_uuid())$q$,'review_event_template_changed');
select pg_temp.review_template_error($q$select public.admin_save_review_event_template('93100000-0000-4000-8000-000000000101',2,gen_random_uuid(),'포토리뷰 이벤트','다시 쓰기')$q$,'review_event_template_changed');
select 1/case when (public.admin_list_review_event_templates('포토리뷰')->>'total')::integer=0 and (public.admin_list_review_event_templates()->>'total')::integer=23 then 1 else 0 end as deleted_from_list;
reset role;
select 1/case when not exists(select 1 from private.review_event_templates where id='93100000-0000-4000-8000-000000000101')
 and (select count(*) from public.audit_log where id='93100000-0000-4000-8000-000000001003' and action='admin.review_event.template.deleted'
  and diff->'before'->>'description'='사진 한 장과 사용 후기를 남겨주세요')=1 then 1 else 0 end as delete_audited;
-- 운영자 계약에 등록되어 있다(권한 범위 cs.manage).
select 1/case when (select count(*) from private.operator_rpc_contracts where capability='cs.manage' and to_regprocedure(signature) in (
 'public.admin_list_review_event_templates(text,integer)'::regprocedure,'public.admin_save_review_event_template(uuid,integer,uuid,text,text)'::regprocedure,
 'public.admin_delete_review_event_template(uuid,integer,uuid)'::regprocedure))=3 then 1 else 0 end as contracts_registered;
rollback;
