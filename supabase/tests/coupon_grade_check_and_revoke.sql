\set ON_ERROR_STOP on
-- 쿠폰 등급 확인(코드 입력)과 지정 발급 쿠폰 개별 회수(PAY-028·PAY-034).
-- 등급: 하위 등급 거절·동급/상위 성공·이미 보유 반환·승급 지급·지정 발급·일반 쿠폰 무영향.
-- 회수: 권한·사유·상한·미사용만·사용 중 거절·멱등·감사·고객 숨김·재수령 불가·평가 만료·장바구니 선택 제거·발급 작업 문서.
begin;
create function pg_temp.expect(q text, wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise exception 'wanted %, got %',wanted,sqlerrm; end;
 raise exception 'Expected error %', wanted;
end $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('bfc02800-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.uid(n),'authenticated','authenticated','coupon-revoke-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,12) n;
update public.profiles set role=case when id=pg_temp.uid(1) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='TEST 쿠폰회수'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id::text like 'bfc02800-%';
update public.profiles set loyalty_grade=case right(id::text,2) when '02' then 'welcome' when '03' then 'silver' when '04' then 'gold' when '05' then 'platinum' else 'welcome' end::public.loyalty_grade
 where id::text like 'bfc02800-%' and id<>pg_temp.uid(1);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.uid(1),'primary');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values(pg_temp.uid(900),pg_temp.uid(1),now(),now(),now()+interval '1 hour');

insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status,issue_limit,issuance_mode,grade_benefit)
 values('GR-GOLD','TEST 골드 쿠폰','fixed',1000,0,now()-interval '1 day','active',null,'code','gold'),
        ('GR-SILVER','TEST 실버 쿠폰','fixed',1000,0,now()-interval '1 day','active',null,'code','silver'),
        ('GR-NONE','TEST 일반 코드 쿠폰','fixed',1000,0,now()-interval '1 day','active',null,'code',null);
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status,issue_limit,issuance_mode)
 values('RV-TARGET','TEST 지정 발급','fixed',1000,0,now()-interval '1 day','active',null,'targeted'),
        ('RV-CODE','TEST 코드 발급','fixed',1000,0,now()-interval '1 day','active',null,'code');

-- ── 등급 확인 ────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.uid(2)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select pg_temp.expect('select public.claim_coupon_code(''GR-GOLD'')','coupon_grade_required');
select pg_temp.expect('select public.apply_cart_coupon_code(''GR-SILVER'')','coupon_grade_required');
select 1/case when public.claim_coupon_code('GR-NONE') is not null then 1 else 0 end as assert_plain_code_coupon_unaffected;
select set_config('request.jwt.claim.sub',pg_temp.uid(3)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(3),'role','authenticated')::text,true);
select pg_temp.expect('select public.claim_coupon_code(''GR-GOLD'')','coupon_grade_required');
select 1/case when public.claim_coupon_code('GR-SILVER') is not null then 1 else 0 end as assert_same_grade_succeeds;
select set_config('request.jwt.claim.sub',pg_temp.uid(4)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(4),'role','authenticated')::text,true);
select 1/case when public.claim_coupon_code('GR-GOLD') is not null and public.claim_coupon_code('GR-SILVER') is not null then 1 else 0 end as assert_same_and_lower_coupon_succeed;
select set_config('request.jwt.claim.sub',pg_temp.uid(5)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(5),'role','authenticated')::text,true);
select 1/case when public.claim_coupon_code('GR-GOLD') is not null then 1 else 0 end as assert_higher_grade_succeeds;
reset role;
select 1/case when not exists(select 1 from public.user_coupons where user_id in(pg_temp.uid(2),pg_temp.uid(3)) and coupon_code='GR-GOLD')
 and (select issued_count from public.coupons where code='GR-GOLD')=2 then 1 else 0 end as assert_rejection_issues_nothing;
-- 이미 보유한 쿠폰은 등급이 낮아도 그대로 돌려준다(승급·월간 지급으로 받은 뒤 강등).
insert into public.user_coupons(coupon_code,user_id,issued_source,issued_at,expires_at,usable_from)
 values('GR-GOLD',pg_temp.uid(6),'grade_benefit',now(),null,now()-interval '1 day');
update public.profiles set loyalty_grade='silver' where id=pg_temp.uid(6);
select 1/case when private.claim_coupon_code('GR-GOLD',pg_temp.uid(6))=(select id from public.user_coupons where user_id=pg_temp.uid(6) and coupon_code='GR-GOLD') then 1 else 0 end as assert_held_returned_below_grade;
-- 운영자 지정 발급·승급 지급은 코드 입력 확인을 거치지 않는다.
select 1/case when private.issue_coupon_code('GR-GOLD',pg_temp.uid(2),'admin_grant') is not null then 1 else 0 end as assert_admin_grant_ignores_grade;
select private.grant_grade_benefit_coupons(pg_temp.uid(7),'welcome','silver');
select 1/case when exists(select 1 from public.user_coupons where user_id=pg_temp.uid(7) and coupon_code='GR-SILVER' and issued_source='grade_benefit') then 1 else 0 end as assert_upgrade_grant_unaffected;

-- ── 회수 ─────────────────────────────────────────────────────────────────────
select private.issue_coupon_code('RV-TARGET',pg_temp.uid(n),'admin_grant') from generate_series(8,11) n;
select id as held_a from public.user_coupons where user_id=pg_temp.uid(8) and coupon_code='RV-TARGET' \gset
select id as held_b from public.user_coupons where user_id=pg_temp.uid(9) and coupon_code='RV-TARGET' \gset
select id as held_c from public.user_coupons where user_id=pg_temp.uid(10) and coupon_code='RV-TARGET' \gset
select id as held_d from public.user_coupons where user_id=pg_temp.uid(11) and coupon_code='RV-TARGET' \gset
-- B는 결제 대기 주문이 잡은 쿠폰(사용), C는 장바구니에 선택해 둔 쿠폰이다.
update public.user_coupons set status='used',used_at=now() where id=:'held_b';
insert into public.cart_coupon_selections(user_id,user_coupon_id) values(pg_temp.uid(10),:'held_c');

-- 권한·입력
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.uid(2)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select pg_temp.expect(format('select public.admin_revoke_user_coupons(array[%L]::uuid[],%L,%L)',:'held_a','잘못 발급','bfc02800-0000-4000-8000-000000000a01'),'operator_capability_required');
select set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'session_id',pg_temp.uid(900),'role','authenticated')::text,true);
select pg_temp.expect(format('select public.admin_revoke_user_coupons(array[%L]::uuid[],%L,%L)',:'held_a','가','bfc02800-0000-4000-8000-000000000a02'),'coupon_revoke_reason_invalid');
select pg_temp.expect(format('select public.admin_revoke_user_coupons(%L::uuid[],%L,%L)','{}','잘못 발급','bfc02800-0000-4000-8000-000000000a02'),'coupon_revoke_targets_invalid');
select pg_temp.expect(format('select public.admin_revoke_user_coupons(array(select gen_random_uuid() from generate_series(1,501)),%L,%L)','잘못 발급','bfc02800-0000-4000-8000-000000000a02'),'coupon_revoke_targets_invalid');
select pg_temp.expect(format('select public.admin_revoke_user_coupons(array[%L]::uuid[],%L,null)',:'held_a','잘못 발급'),'coupon_revoke_operation_required');
select 1/case when not has_function_privilege('anon','public.admin_revoke_user_coupons(uuid[],text,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_revoke_user_coupons(uuid[],text,uuid)','execute')
 and has_function_privilege('authenticated','public.admin_revoke_user_coupons(uuid[],text,uuid)','execute') then 1 else 0 end as assert_revoke_function_sealed;

-- 회수: A(회수), B(사용 중 — 거절), C(회수·장바구니 선택 제거), 없는 ID(not_found)
select public.admin_revoke_user_coupons(array[:'held_a'::uuid,:'held_b'::uuid,:'held_c'::uuid,'bfc02800-0000-4000-8000-0000000000ff'::uuid],'엉뚱한 고객에게 발급',pg_temp.uid(701)) as revoked \gset
select 1/case when :'revoked'::jsonb->>'revokedCount'='2' and :'revoked'::jsonb->>'requestedCount'='4'
 and (select count(*) from jsonb_array_elements(:'revoked'::jsonb->'lines') l where l->>'status'='revoked')=2
 and (select l->>'status' from jsonb_array_elements(:'revoked'::jsonb->'lines') l where l->>'userCouponId'=:'held_b')='used'
 and (select l->>'status' from jsonb_array_elements(:'revoked'::jsonb->'lines') l where l->>'userCouponId'='bfc02800-0000-4000-8000-0000000000ff')='not_found'
 then 1 else 0 end as assert_revoke_line_results;
reset role;
select 1/case when (select revoked_at is not null and revoked_by=pg_temp.uid(1) and revoke_reason='엉뚱한 고객에게 발급' and status='active' and expires_at<now()-interval '30 seconds' from public.user_coupons where id=:'held_a')
 and (select revoked_at is null and status='used' from public.user_coupons where id=:'held_b')
 and (select revoked_at is not null from public.user_coupons where id=:'held_c')
 and not exists(select 1 from public.cart_coupon_selections where user_coupon_id=:'held_c')
 and (select issued_count from public.coupons where code='RV-TARGET')=4 then 1 else 0 end as assert_rows_revoked_and_counter_kept;
select 1/case when (select count(*)=1 from public.audit_log where id=pg_temp.uid(701) and action='admin.coupon.revoked' and actor_id=pg_temp.uid(1)
   and diff->>'reason'='엉뚱한 고객에게 발급' and jsonb_array_length(diff->'result'->'lines')=4
   and (select count(*) from jsonb_array_elements(diff->'result'->'lines') l where l->>'status'='revoked' and l->>'couponCode'='RV-TARGET' and l->>'issuedSource'='admin_grant' and l ? 'userId')=2) then 1 else 0 end as assert_revoke_audited;
-- 멱등: 같은 작업·같은 내용은 저장된 결과, 다른 내용은 충돌, 이미 회수한 쿠폰은 already_revoked.
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
select 1/case when (public.admin_revoke_user_coupons(array[:'held_a'::uuid,:'held_b'::uuid,:'held_c'::uuid,'bfc02800-0000-4000-8000-0000000000ff'::uuid],'엉뚱한 고객에게 발급',pg_temp.uid(701)))->>'replayed'='true' then 1 else 0 end as assert_revoke_replay;
select pg_temp.expect(format('select public.admin_revoke_user_coupons(array[%L]::uuid[],%L,%L)',:'held_a','다른 사유',pg_temp.uid(701)),'coupon_revoke_operation_conflict');
select 1/case when (select l->>'status' from jsonb_array_elements((public.admin_revoke_user_coupons(array[:'held_a'::uuid],'다시 시도',pg_temp.uid(702)))->'lines') l)='already_revoked' then 1 else 0 end as assert_already_revoked_line;
reset role;
select 1/case when (select count(*) from public.audit_log where action='admin.coupon.revoked')=1 then 1 else 0 end as assert_no_audit_without_revocation;

-- 결제를 마치지 않은 주문(pending)이 잡은 쿠폰은 in_use(주문 취소 뒤 회수), 그 밖의 사용은 used 다.
reset role;
insert into public.orders(id,user_id,total,status) values('bfc02800-0000-4000-8000-0000000007d1',pg_temp.uid(9),10000,'pending');
update public.user_coupons set used_order_id='bfc02800-0000-4000-8000-0000000007d1' where id=:'held_b';
set local role authenticated;
select 1/case when (select l->>'status' from jsonb_array_elements((public.admin_revoke_user_coupons(array[:'held_b'::uuid],'결제 대기 확인',pg_temp.uid(707)))->'lines') l)='in_use' then 1 else 0 end as assert_pending_order_is_in_use;
reset role;

-- 고객: 회수된 쿠폰은 쿠폰함에 보이지 않고, 운영자는 이력까지 본다.
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.uid(8)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(8),'role','authenticated')::text,true);
select 1/case when not exists(select 1 from public.user_coupons where id=:'held_a') and not exists(select 1 from public.coupons where code='RV-TARGET') then 1 else 0 end as assert_revoked_hidden_from_customer;
select set_config('request.jwt.claim.sub',pg_temp.uid(9)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(9),'role','authenticated')::text,true);
select 1/case when exists(select 1 from public.user_coupons where id=:'held_b') then 1 else 0 end as assert_other_customer_unaffected;
select set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'session_id',pg_temp.uid(900),'role','authenticated')::text,true);
select 1/case when exists(select 1 from public.user_coupons where id=:'held_a' and revoked_at is not null) then 1 else 0 end as assert_operator_sees_revoked;
reset role;

-- 회수한 쿠폰은 평가에서 만료이고 같은 코드로 다시 받을 수 없다(코드형·지정 발급 모두).
select 1/case when (select o_reason from private.evaluate_user_coupon(:'held_a'::uuid,pg_temp.uid(8),20000))='coupon_expired' then 1 else 0 end as assert_revoked_evaluates_expired;
select pg_temp.expect(format('select private.issue_coupon_code(%L,%L,%L)','RV-TARGET',pg_temp.uid(8),'admin_grant'),'coupon_revoked');
select 1/case when (select o_reason from private.evaluate_order_user_coupon(:'held_a'::uuid,pg_temp.uid(8),gen_random_uuid()) limit 1)='coupon_expired' then 1 else 0 end as assert_order_evaluation_expired;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.uid(11)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(11),'role','authenticated')::text,true);
select public.claim_coupon_code('RV-CODE') as held_code \gset
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'session_id',pg_temp.uid(900),'role','authenticated')::text,true);
select 1/case when (public.admin_revoke_user_coupons(array[:'held_code'::uuid],'코드 잘못 공유',pg_temp.uid(703)))->>'revokedCount'='1' then 1 else 0 end as assert_code_coupon_revoked;
select set_config('request.jwt.claim.sub',pg_temp.uid(11)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(11),'role','authenticated')::text,true);
select pg_temp.expect('select public.claim_coupon_code(''RV-CODE'')','coupon_revoked');
select pg_temp.expect('select public.apply_cart_coupon_code(''RV-CODE'')','coupon_revoked');
reset role;
-- 회수 칸 모양 제약: 사용 중인 쿠폰·사유 없는 회수는 저장되지 않는다.
select pg_temp.expect(format('update public.user_coupons set revoked_at=now(),revoke_reason=%L where id=%L','사유',:'held_b'),'user_coupons_revoke_shape');
select pg_temp.expect(format('update public.user_coupons set revoked_at=now() where id=%L',:'held_d'),'user_coupons_revoke_shape');

-- 지정 발급 확인은 회수한 고객을 막고, 발급 작업 결과 줄은 보유·회수 상태를 보여 준다.
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,issue_starts_at,issue_ends_at,ends_at,status,issuance_mode)
 values('RV-BATCH','TEST 작업 쿠폰','fixed',1000,0,now()-interval '1 day',now()-interval '1 day',now()+interval '7 days',now()+interval '30 days','active','targeted');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'session_id',pg_temp.uid(900),'role','authenticated')::text,true);
select jsonb_build_object('kind','customers','userIds',jsonb_build_array(pg_temp.uid(2),pg_temp.uid(3))) as targets \gset
select public.admin_preview_coupon_issue(pg_temp.uid(801),'RV-BATCH',:'targets',pg_temp.uid(1),pg_temp.uid(900));
select 1/case when public.admin_execute_coupon_issue(pg_temp.uid(801),pg_temp.uid(1),pg_temp.uid(900))->>'issuedCount'='2' then 1 else 0 end as assert_batch_issued;
select (select l->>'userCouponId' from jsonb_array_elements(public.admin_get_coupon_issue(pg_temp.uid(801))->'rows') l where l->>'userId'=pg_temp.uid(2)::text) as batch_held \gset
select 1/case when (select count(*)=2 and bool_and(l->>'heldStatus'='active') and bool_and(l->'revokedAt'='null'::jsonb) from jsonb_array_elements(public.admin_get_coupon_issue(pg_temp.uid(801))->'rows') l) then 1 else 0 end as assert_batch_rows_show_held_state;
select public.admin_revoke_user_coupons(array[:'batch_held'::uuid],'작업 결과에서 회수',pg_temp.uid(704)) as batch_revoked \gset
select 1/case when (:'batch_revoked'::jsonb->'lines'->0->>'issueBatchId')=pg_temp.uid(801)::text then 1 else 0 end as assert_audit_carries_issue_batch;
select 1/case when (select (l->>'revokedAt') is not null and l->>'heldStatus'='active' from jsonb_array_elements(public.admin_get_coupon_issue(pg_temp.uid(801))->'rows') l where l->>'userId'=pg_temp.uid(2)::text) then 1 else 0 end as assert_batch_row_marked_revoked;
-- 회수 이력 고객은 막는 사유가 아니라 '제외' 줄이다: 나머지 대상은 그대로 발급되고 실행도 막히지 않는다.
select jsonb_build_object('kind','customers','userIds',jsonb_build_array(pg_temp.uid(2),pg_temp.uid(3),pg_temp.uid(12))) as targets3 \gset
select public.admin_preview_coupon_issue(pg_temp.uid(802),'RV-BATCH',:'targets3',pg_temp.uid(1),pg_temp.uid(900)) as repreview \gset
select 1/case when :'repreview'::jsonb->>'status'='prepared' and :'repreview'::jsonb->>'plannedCount'='1' and :'repreview'::jsonb->>'invalidCount'='0'
 and (select l->>'excluded' from jsonb_array_elements(:'repreview'::jsonb->'rows') l where l->>'userId'=pg_temp.uid(2)::text)='revoked'
 and (select l->>'reason' is null from jsonb_array_elements(:'repreview'::jsonb->'rows') l where l->>'userId'=pg_temp.uid(2)::text)
 and (select not (l ? 'excluded') from jsonb_array_elements(:'repreview'::jsonb->'rows') l where l->>'userId'=pg_temp.uid(3)::text) then 1 else 0 end as assert_revoked_customer_excluded_not_blocking;
select 1/case when public.admin_execute_coupon_issue(pg_temp.uid(802),pg_temp.uid(1),pg_temp.uid(900))->>'issuedCount'='1' then 1 else 0 end as assert_others_issued_despite_exclusion;
reset role;
select 1/case when (select count(*)=1 and bool_and(revoked_at is not null) from public.user_coupons where user_id=pg_temp.uid(2) and coupon_code='RV-BATCH')
 and exists(select 1 from public.user_coupons where user_id=pg_temp.uid(12) and coupon_code='RV-BATCH' and revoked_at is null) then 1 else 0 end as assert_excluded_customer_not_reissued;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'session_id',pg_temp.uid(900),'role','authenticated')::text,true);
-- 기보유로 건너뛴 작업은 감사의 발급 작업으로 귀속되지 않는다(uid3 쿠폰은 작업 801이 발급, 802는 기보유 건너뜀).
select (select l->>'userCouponId' from jsonb_array_elements(public.admin_get_coupon_issue(pg_temp.uid(802))->'rows') l where l->>'userId'=pg_temp.uid(3)::text) as held_u3 \gset
select 1/case when (public.admin_revoke_user_coupons(array[:'held_u3'::uuid],'귀속 확인',pg_temp.uid(705)))->'lines'->0->>'issueBatchId'=pg_temp.uid(801)::text then 1 else 0 end as assert_audit_batch_is_issuing_job;
select (select l->>'userCouponId' from jsonb_array_elements(public.admin_get_coupon_issue(pg_temp.uid(802))->'rows') l where l->>'userId'=pg_temp.uid(12)::text) as held_u12 \gset
select 1/case when (public.admin_revoke_user_coupons(array[:'held_u12'::uuid],'귀속 확인 둘',pg_temp.uid(706)))->'lines'->0->>'issueBatchId'=pg_temp.uid(802)::text then 1 else 0 end as assert_audit_batch_is_new_issue_job;
-- 최근 발급 작업 목록.
select 1/case when (select count(*)=2 and bool_and(l->>'status'='completed') from jsonb_array_elements(public.admin_list_coupon_issues('RV-BATCH',10)) l)
 and (select (l->>'revokedCount')::int from jsonb_array_elements(public.admin_list_coupon_issues('RV-BATCH',10)) l where l->>'id'=pg_temp.uid(801)::text)=2
 and public.admin_list_coupon_issues('RV-BATCH',10)->0->>'id'=pg_temp.uid(802)::text then 1 else 0 end as assert_recent_issue_list;
select pg_temp.expect('select public.admin_list_coupon_issues(''x'',10)','coupon_issue_list_invalid');
-- 마케팅 쿠폰 첨부 선택지에는 등급 혜택 쿠폰이 없다.
select 1/case when exists(select 1 from jsonb_array_elements(public.admin_marketing_coupon_options('',1)->'rows') l where l->>'code'='GR-NONE')
 and not exists(select 1 from jsonb_array_elements(public.admin_marketing_coupon_options('',1)->'rows') l where l->>'code' in ('GR-GOLD','GR-SILVER')) then 1 else 0 end as assert_marketing_options_exclude_grade_coupons;

-- 고객 상세 쿠폰 탭은 회수됨을 따로 보여 준다.
select 1/case when exists(select 1 from jsonb_array_elements(public.admin_customer_detail(pg_temp.uid(8),'coupons',1)->'items') l where l->>'id'=:'held_a' and l->>'status'='revoked') then 1 else 0 end as assert_customer_detail_revoked_status;
reset role;
rollback;
