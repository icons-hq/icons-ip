\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql; all changes roll back in an isolated DB.
begin;
load 'safeupdate';
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_announcement_error(q text,wanted text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=wanted or sqlstate=wanted then return;end if;raise;end;
 raise exception 'Expected announcement error: %',wanted;
end$$;
create function pg_temp.announcement_values(title text,important boolean default true,starts timestamptz default null,ends timestamptz default null)
returns jsonb language sql as $$select jsonb_build_object('title',title,'body','안내 본문','format','plain','category','general','device','all',
 'enabled',true,'important',important,'allGoods',true,'goodIds','[]'::jsonb,'startsAt',starts,'endsAt',ends,
 'importantStartsAt',null,'importantEndsAt',null,'popupStartsAt',null,'popupEndsAt',null)$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('97010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','notice-period-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id::text like '97010000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('97010000-0000-4000-8000-000000000001','primary'),('97010000-0000-4000-8000-000000000002','deputy'),('97010000-0000-4000-8000-000000000003','influencer');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) values('notice-period-ip','공지 기간 QA','character',now());
insert into public.goods(id,ip_id,name,type,price,stock_qty) values
 ('notice-period-public','notice-period-ip','기간 공개 상품','문구',1000,10),
 ('notice-period-delete','notice-period-ip','참조 삭제 상품','문구',1000,10),
 ('notice-period-hidden','notice-period-ip','비공개 상품','문구',1000,10);
-- KC helper identities have explicit operator authority in configured databases.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}'
 from public.goods where id in ('notice-period-public','notice-period-delete');
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id in ('notice-period-public','notice-period-delete'));
insert into private.operator_memberships(profile_id,manager_role)
 select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in ('notice-period-public','notice-period-delete');
select pg_temp.publish_goods_kc_fixture('notice-period-public');
select pg_temp.publish_goods_kc_fixture('notice-period-delete');
select revision as global_zero from private.home_announcement_popup where singleton \gset
select 1/case when not has_table_privilege('authenticated','private.home_announcement_popup','select')
 and not has_function_privilege('anon','public.admin_save_goods_announcement_v2(uuid,uuid,integer,jsonb,text,bigint)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_announcement_v2(uuid,uuid,integer,jsonb,text,bigint)','execute')
 and has_function_privilege('authenticated','public.admin_save_goods_announcement_v2(uuid,uuid,integer,jsonb,text,bigint)','execute')
 and not has_function_privilege('anon','public.admin_get_goods_announcement_save_result(uuid)','execute')
 and has_function_privilege('anon','public.get_home_announcement_popup()','execute') then 1 else 0 end as authority_and_private_state;
select set_config('request.jwt.claim.sub','97010000-0000-4000-8000-000000000001',true);
set local role authenticated;
-- A new editor must read the actual global revision, not invent a zero fallback.
select public.admin_get_goods_announcement_editor_context('97020000-0000-4000-8000-000000000001') as new_context \gset
select 1/case when :'new_context'::jsonb->'announcement'='null'::jsonb and :'new_context'::jsonb->'popup'->>'selected'='false'
 and (:'new_context'::jsonb->'popup'->>'revision')::bigint=:'global_zero'::bigint
 and :'new_context'::jsonb->'popup'->'startsAt'='null'::jsonb then 1 else 0 end as new_context_actual_revision;
select pg_temp.announcement_values('공지 A',true,now()-interval '30 minutes',now()+interval '2 hours')||jsonb_build_object(
 'importantStartsAt',now()-interval '5 minutes','importantEndsAt',now()+interval '10 minutes',
 'popupStartsAt',now()-interval '1 hour','popupEndsAt',now()+interval '1 hour',
 'allGoods',false,'goodIds',jsonb_build_array('notice-period-delete')) as first_values \gset
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000001','97020000-0000-4000-8000-000000000001',0,:'first_values','set',:'global_zero') as first_result \gset
select public.admin_get_goods_announcement_editor_context('97020000-0000-4000-8000-000000000001') as a_context \gset
select 1/case when :'a_context'::jsonb->'announcement'->>'importantStartsAt' is not null
 and :'a_context'::jsonb->'announcement'->'goods'->0->>'id'='notice-period-delete'
 and :'a_context'::jsonb->'popup'->>'selected'='true'
 and (:'a_context'::jsonb->'popup'->>'revision')::bigint=:'global_zero'::bigint+1 then 1 else 0 end as nested_context_owner_acl_and_roundtrip;
select 1/case when public.admin_get_goods_announcement_save_result('97030000-0000-4000-8000-000000000001')=:'first_result'::jsonb
 and public.admin_get_goods_announcement_save_result('97030000-0000-4000-8000-999999999999') is null then 1 else 0 end as own_operation_result_and_missing_result;
select public.get_home_announcement_popup() as public_staff \gset
select (public.get_home_announcement_popup()->'item'->>'dismissKey') as first_dismiss \gset
reset role;
set local role anon;
select 1/case when public.get_home_announcement_popup()=:'public_staff'::jsonb
 and public.get_home_announcement_popup()->'item'->>'id'='97020000-0000-4000-8000-000000000001'
 and public.get_home_announcement_popup()->'item'->>'important'='true'
 and (public.get_home_announcement_popup()->'item'->>'startsAt')::timestamptz=(:'first_values'::jsonb->>'startsAt')::timestamptz
 and (public.get_home_announcement_popup()->'item'->>'endsAt')::timestamptz=(:'first_values'::jsonb->>'popupEndsAt')::timestamptz
 and (public.get_home_announcement_popup()->'item')-array['id','title','body','format','device','important','dismissKey','startsAt','endsAt']='{}'::jsonb
 then 1 else 0 end as public_selected_scope_window_and_minimal_shape;
select 1/case when jsonb_array_length(public.get_good_announcements('notice-period-hidden')->'items')=0
 and exists(select 1 from jsonb_array_elements(public.get_good_announcements('notice-period-delete')->'items') x where x->>'id'='97020000-0000-4000-8000-000000000001' and x->>'important'='true')
 then 1 else 0 end as pdp_still_checks_public_goods;
reset role;
set local role authenticated;
-- B is selected in the future; A does not reappear and B's body is not exposed.
select pg_temp.announcement_values('미래 공지 B')||jsonb_build_object('popupStartsAt',now()+interval '3 hours','popupEndsAt',now()+interval '4 hours') as b_values \gset
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000002','97020000-0000-4000-8000-000000000002',0,:'b_values','set',:'global_zero'::bigint+1) as b_result \gset
select public.admin_get_goods_announcement_editor_context('97020000-0000-4000-8000-000000000001') as unselected_a \gset
select 1/case when :'unselected_a'::jsonb->'popup'->>'selected'='false' and :'unselected_a'::jsonb->'popup'->'startsAt'='null'::jsonb
 and public.get_home_announcement_popup()->'item'='null'::jsonb and public.get_home_announcement_popup()->>'nextChangeAt' is not null
 then 1 else 0 end as future_selection_never_falls_back;
-- Preserve ignores a stale global revision and leaves the selected B untouched.
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000003','97020000-0000-4000-8000-000000000001',1,
 pg_temp.announcement_values('A 일반 편집')||jsonb_build_object('importantStartsAt',now()+interval '1 hour','importantEndsAt',now()+interval '2 hours'),'preserve',:'global_zero') as preserved \gset
select 1/case when (:'preserved'::jsonb->>'popupRevision')::bigint=(:'b_result'::jsonb->>'popupRevision')::bigint
 and public.get_home_announcement_popup()->'item'='null'::jsonb then 1 else 0 end as preserve_does_not_steal_selection;
select pg_temp.expect_announcement_error(format($q$select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000004','97020000-0000-4000-8000-000000000001',2,%L,'set',%s)$q$,:'first_values',:'global_zero'),'goods_announcement_popup_changed');
select pg_temp.expect_announcement_error(format($q$select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000005','97020000-0000-4000-8000-000000000001',2,pg_temp.announcement_values('금지 해제'),'clear',%s)$q$,(:'b_result'::jsonb->>'popupRevision')::bigint),'goods_announcement_popup_not_selected');
select 1/case when public.admin_get_goods_announcement('97020000-0000-4000-8000-000000000001')->>'title'='A 일반 편집'
 and public.admin_get_goods_announcement_save_result('97030000-0000-4000-8000-000000000004') is null then 1 else 0 end as global_conflict_atomic_rollback;
-- Old writer updates only old columns and never resets importance or selection.
select public.admin_save_goods_announcement('97020000-0000-4000-8000-000000000001',2,
 pg_temp.announcement_values('A 구 API 편집',false)-array['importantStartsAt','importantEndsAt','popupStartsAt','popupEndsAt']);
select public.admin_get_goods_announcement_editor_context('97020000-0000-4000-8000-000000000001') as legacy_context \gset
select 1/case when :'legacy_context'::jsonb->'announcement'->>'important'='false' and :'legacy_context'::jsonb->'announcement'->>'importantStartsAt' is not null
 and (:'legacy_context'::jsonb->'popup'->>'revision')::bigint=(:'b_result'::jsonb->>'popupRevision')::bigint
 then 1 else 0 end as legacy_writer_preserves_new_columns_and_selection;
-- Live product existence cannot invalidate an already committed exact receipt.
reset role;
select pg_temp.cleanup_goods_kc_fixture('notice-period-delete');
delete from public.goods where id='notice-period-delete';
set local role authenticated;
select 1/case when public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000001','97020000-0000-4000-8000-000000000001',0,:'first_values','set',:'global_zero')=:'first_result'::jsonb
 and public.admin_get_goods_announcement('97020000-0000-4000-8000-000000000001')->>'title'='A 구 API 편집'
 then 1 else 0 end as old_receipt_after_product_delete_preserves_current;
select pg_temp.expect_announcement_error(format($q$select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000001','97020000-0000-4000-8000-000000000001',0,%L,'set',%s)$q$,(:'first_values'::jsonb||'{"title":"다른 본문"}'),:'global_zero'),'operation_conflict');
select set_config('request.jwt.claim.sub','97010000-0000-4000-8000-000000000002',true);
select 1/case when public.admin_get_goods_announcement_save_result('97030000-0000-4000-8000-000000000001') is null then 1 else 0 end as other_actor_cannot_read_receipt;
select set_config('request.jwt.claim.sub','97010000-0000-4000-8000-000000000001',true);
-- Importance changes ranking independently from publication and creates a future boundary.
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000006','97020000-0000-4000-8000-000000000001',3,
 pg_temp.announcement_values('A 미래 중요')||jsonb_build_object('importantStartsAt',now()+interval '10 minutes','importantEndsAt',now()+interval '20 minutes'),'preserve',null);
select 1/case when exists(select 1 from jsonb_array_elements(public.get_good_announcements('notice-period-public')->'items') x where x->>'id'='97020000-0000-4000-8000-000000000001' and x->>'important'='false')
 and (public.get_good_announcements('notice-period-public')->>'nextChangeAt')::timestamptz<=now()+interval '10 minutes'
 then 1 else 0 end as future_importance_is_currently_ordinary_with_refresh;
-- Selecting A again creates a new dismissal key; ordinary edits keep that key.
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000007','97020000-0000-4000-8000-000000000001',4,
 pg_temp.announcement_values('A 다시 선택')||jsonb_build_object('popupStartsAt',now()-interval '1 hour','popupEndsAt',now()+interval '1 hour'),
 'set',(:'b_result'::jsonb->>'popupRevision')::bigint) as a_reselected \gset
select public.get_home_announcement_popup()->'item'->>'dismissKey' as new_dismiss \gset
select 1/case when :'new_dismiss'<>:'first_dismiss' then 1 else 0 end as new_explicit_selection_new_key;
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000008','97020000-0000-4000-8000-000000000001',5,
 pg_temp.announcement_values('제목만 수정'),'preserve',0);
select 1/case when public.get_home_announcement_popup()->'item'->>'dismissKey'=:'new_dismiss' then 1 else 0 end as normal_edit_preserves_today_dismissal;
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000009','97020000-0000-4000-8000-000000000001',6,
 pg_temp.announcement_values('팝업 해제'),'clear',(:'a_reselected'::jsonb->>'popupRevision')::bigint);
select 1/case when public.get_home_announcement_popup()->'item'='null'::jsonb and public.get_home_announcement_popup()->'nextChangeAt'='null'::jsonb then 1 else 0 end as clear_has_no_fallback;
-- A last selected but expired notice never revives a previous selection.
select public.admin_get_goods_announcement_editor_context('97020000-0000-4000-8000-000000000003')->'popup'->>'revision' as global_now \gset
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000010','97020000-0000-4000-8000-000000000003',0,
 pg_temp.announcement_values('종료된 마지막 공지')||jsonb_build_object('popupStartsAt',now()-interval '2 hours','popupEndsAt',now()-interval '1 hour'),'set',:'global_now');
select 1/case when public.get_home_announcement_popup()->'item'='null'::jsonb and public.get_home_announcement_popup()->'nextChangeAt'='null'::jsonb then 1 else 0 end as expired_selection_does_not_revive_a;
select public.admin_get_goods_announcement_editor_context('97020000-0000-4000-8000-000000000003')->'popup'->>'revision' as global_now \gset
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000011','97020000-0000-4000-8000-000000000003',1,
 pg_temp.announcement_values('겹치지 않는 전시',true,null,now()+interval '5 minutes')||jsonb_build_object('popupStartsAt',now()+interval '10 minutes','popupEndsAt',now()+interval '20 minutes'),'set',:'global_now');
select 1/case when public.get_home_announcement_popup()->'item'='null'::jsonb and public.get_home_announcement_popup()->'nextChangeAt'='null'::jsonb then 1 else 0 end as empty_intersection_exposes_no_future_body;
select public.admin_get_goods_announcement_editor_context('97020000-0000-4000-8000-000000000003')->'popup'->>'revision' as global_now \gset
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000012','97020000-0000-4000-8000-000000000003',2,
 pg_temp.announcement_values('게시 기간 대기',true,now()+interval '20 minutes',now()+interval '30 minutes')||jsonb_build_object('popupStartsAt',now()-interval '1 hour','popupEndsAt',now()+interval '1 hour'),'set',:'global_now');
select 1/case when public.get_home_announcement_popup()->'item'='null'::jsonb and (public.get_home_announcement_popup()->>'nextChangeAt')::timestamptz=now()+interval '20 minutes' then 1 else 0 end as publication_start_is_popup_boundary;
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000013','97020000-0000-4000-8000-000000000003',3,
 pg_temp.announcement_values('게시 종료 경계',true,null,now()),'preserve',null);
select 1/case when public.get_home_announcement_popup()->'item'='null'::jsonb and public.get_home_announcement_popup()->'nextChangeAt'='null'::jsonb then 1 else 0 end as publication_end_is_exclusive;
select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000014','97020000-0000-4000-8000-000000000001',7,
 pg_temp.announcement_values('중요 기간만 종료')||jsonb_build_object('importantStartsAt',now()-interval '2 hours','importantEndsAt',now()),'preserve',null);
select 1/case when exists(select 1 from jsonb_array_elements(public.get_good_announcements('notice-period-public')->'items') x where x->>'id'='97020000-0000-4000-8000-000000000001' and x->>'important'='false') then 1 else 0 end as expired_importance_keeps_ordinary_notice;
-- Period validation is strict; no partial windows or unknown payload fields.
do $$declare base_values jsonb;bad jsonb;begin
 base_values:=pg_temp.announcement_values('유효성');
 foreach bad in array array[
  '{"importantStartsAt":"2026-01-01T00:00:00Z"}'::jsonb,
  '{"importantStartsAt":"2026-02-01T00:00:00Z","importantEndsAt":"2026-01-01T00:00:00Z"}',
  '{"importantStartsAt":false}', '{"importantEndsAt":"tomorrow"}', '{"unknown":true}'
 ] loop
  begin
   perform public.admin_save_goods_announcement_v2(gen_random_uuid(),gen_random_uuid(),0,base_values||bad,'preserve',null);
   raise exception 'Invalid period accepted';
  exception when invalid_parameter_value then null;end;
 end loop;
end$$;
reset role;
-- Revocation wins before both replay and individual result lookup.
delete from private.operator_memberships where profile_id='97010000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_announcement_error($q$select public.admin_get_goods_announcement_save_result('97030000-0000-4000-8000-000000000001')$q$,'operator_capability_required');
select pg_temp.expect_announcement_error(format($q$select public.admin_save_goods_announcement_v2('97030000-0000-4000-8000-000000000001','97020000-0000-4000-8000-000000000001',0,%L,'set',%s)$q$,:'first_values',:'global_zero'),'operator_capability_required');
reset role;
select 1/case when (select count(*) from public.audit_log where id='97030000-0000-4000-8000-000000000001')=1
 and not exists(select 1 from public.audit_log where id in ('97030000-0000-4000-8000-000000000004','97030000-0000-4000-8000-000000000005'))
 then 1 else 0 end as single_receipt_and_no_failed_audits;
rollback;
