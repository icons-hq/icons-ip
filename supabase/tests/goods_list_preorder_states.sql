\set ON_ERROR_STOP on
-- 상품 목록의 '예약 임시저장 · 판매 미적용' 표시(20261119150000, 2026-11-19 홍실 2차 예약 초안 사고).
-- admin_goods_list_preorder_states는 사용 옵션 중 임시저장(draft)만 있고 적용 중(active) 예약이 없는 옵션 수를 상품마다 센다.
-- 적용 중 옵션·사용 중지 옵션·예약 없는 상품은 세지 않고, 접수 중지 뒤 새 임시저장은 센다. 권한(catalog.read)·입력 상한·실행 권한을 고정한다.
begin;
create function pg_temp.states_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%',p_message;end if;end $$;
create function pg_temp.states_error(p_sql text,p_error text) returns void language plpgsql as $$
begin begin execute p_sql;exception when others then if position(p_error in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected %',p_error;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values
 ('b9310000-0000-4000-8000-000000000001','authenticated','authenticated','preorder-states-admin@example.test','{}',now(),now()),
 ('b9310000-0000-4000-8000-000000000002','authenticated','authenticated','preorder-states-member@example.test','{}',now(),now());
update public.profiles set role='admin',nickname='예약목록검증관리자' where id='b9310000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('b9310000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values('b9310000-0000-4000-8000-000000000011','b9310000-0000-4000-8000-000000000001',now(),now());
insert into public.ips(id,title,vertical_key) values('preorder-states','TEST 예약 목록 표시','character');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9310000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b9310000-0000-4000-8000-000000000001","session_id":"b9310000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select public.admin_save_good('{"id":"states-mixed","ip_id":"preorder-states","name":"TEST 예약 섞임","price":10000,"variant_baseline":[],"variants":[{"name":"레드","attributes":{"색상":"레드"},"extraPrice":0,"stockQty":0},{"name":"블루","attributes":{"색상":"블루"},"extraPrice":0,"stockQty":0},{"name":"그린","attributes":{"색상":"그린"},"extraPrice":0,"stockQty":0},{"name":"옐로","attributes":{"색상":"옐로"},"extraPrice":0,"stockQty":0}]}');
select public.admin_save_good('{"id":"states-applied","ip_id":"preorder-states","name":"TEST 예약 적용","price":10000,"variant_baseline":[],"variants":[{"name":"기본","attributes":{},"extraPrice":0,"stockQty":0}]}');
select public.admin_save_good('{"id":"states-none","ip_id":"preorder-states","name":"TEST 예약 없음","price":10000,"variant_baseline":[],"variants":[{"name":"기본","attributes":{},"extraPrice":0,"stockQty":3}]}');
create function pg_temp.states_variant(p_good text,p_name text) returns uuid language sql as $$
 select id from public.goods_variants where good_id=p_good and name=p_name;$$;
create function pg_temp.states_values(p_state text) returns jsonb language sql as $$
 select jsonb_build_object('state',p_state,'capacityQty',30,'startsAt',to_char((now()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'endsAt',to_char((now()+interval '10 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'expectedShipDate',to_char((now()+interval '20 days') at time zone 'Asia/Seoul','YYYY-MM-DD'),'approvalReference','TEST 승인 문서');$$;
create function pg_temp.states_draft(p_good text,p_name text) returns jsonb language sql as $$
 select public.admin_save_goods_preorder(p_good,pg_temp.states_variant(p_good,p_name),null,'{"state":"draft","capacityQty":null,"startsAt":"","endsAt":"","expectedShipDate":"","approvalReference":""}'::jsonb,null);$$;
create function pg_temp.states_active(p_good text,p_name text) returns jsonb language sql as $$
 select public.admin_save_goods_preorder(p_good,pg_temp.states_variant(p_good,p_name),null,pg_temp.states_values('active'),null);$$;
create function pg_temp.states_read(p_ids text[]) returns jsonb language sql as $$ select public.admin_goods_list_preorder_states(p_ids);$$;

-- 레드: 사고 그대로 — 물량·종료일·근거 없이 임시저장만(같은 옵션에 임시저장 두 번이어도 옵션 하나로 센다).
select pg_temp.states_draft('states-mixed','레드');
select pg_temp.states_draft('states-mixed','레드');
-- 블루: 적용 중인 예약과 다음 회차 임시저장 — 판매에 적용되어 있으므로 세지 않는다.
select pg_temp.states_active('states-mixed','블루');
select pg_temp.states_draft('states-mixed','블루');
-- 그린: 접수 중지 뒤 새 임시저장 — 지금 예약 주문을 받지 않으므로 센다.
select pg_temp.states_active('states-mixed','그린') as green \gset
select public.admin_save_goods_preorder('states-mixed',pg_temp.states_variant('states-mixed','그린'),(:'green'::jsonb->>'id')::uuid,'{"state":"stopped"}'::jsonb,(:'green'::jsonb->>'revision')::integer);
select pg_temp.states_draft('states-mixed','그린');
-- 옐로: 임시저장한 뒤 옵션 사용을 중지 — 사용 옵션이 아니므로 세지 않는다.
select pg_temp.states_draft('states-mixed','옐로');
select pg_temp.states_active('states-applied','기본');

select pg_temp.states_read(array['states-mixed','states-applied','states-none']) as before_archive \gset
select pg_temp.states_assert(:'before_archive'::jsonb=jsonb_build_array(jsonb_build_object('id','states-mixed','draftOnlyOptionCount',3)),
 'before archive: red, green and yellow are draft-only, blue and the applied good are not: '||:'before_archive');
reset role;
update public.goods_variants set archived_at=now() where id=pg_temp.states_variant('states-mixed','옐로');
set local role authenticated;
select pg_temp.states_read(array['states-mixed','states-applied','states-none']) as after_archive \gset
select pg_temp.states_assert(:'after_archive'::jsonb=jsonb_build_array(jsonb_build_object('id','states-mixed','draftOnlyOptionCount',2)),
 'archived option is not counted: '||:'after_archive');
-- 레드를 적용하면 그 옵션은 빠진다.
select public.admin_save_goods_preorder('states-mixed',pg_temp.states_variant('states-mixed','레드'),
 (select (r->>'id')::uuid from jsonb_array_elements(public.admin_list_goods_preorders('states-mixed')) r where r->>'variantId'=pg_temp.states_variant('states-mixed','레드')::text order by r->>'createdAt' desc limit 1),
 pg_temp.states_values('active'),
 (select (r->>'revision')::integer from jsonb_array_elements(public.admin_list_goods_preorders('states-mixed')) r where r->>'variantId'=pg_temp.states_variant('states-mixed','레드')::text order by r->>'createdAt' desc limit 1));
select pg_temp.states_assert(pg_temp.states_read(array['states-mixed'])->0->>'draftOnlyOptionCount'='1','applying red leaves only green');
select pg_temp.states_assert(pg_temp.states_read(array['states-none','missing-good'])='[]'::jsonb,'goods without drafts and unknown ids return nothing');
select pg_temp.states_assert(pg_temp.states_read(array[]::text[])='[]'::jsonb,'empty page');

-- 입력 상한: 한 페이지(100개)까지만, null 배열·null 원소는 거절한다.
select pg_temp.states_error($q$select public.admin_goods_list_preorder_states(array(select 'g'||n from generate_series(1,101) n))$q$,'invalid_goods_list_preorder_states');
select pg_temp.states_error($q$select public.admin_goods_list_preorder_states(null)$q$,'invalid_goods_list_preorder_states');
select pg_temp.states_error($q$select public.admin_goods_list_preorder_states(array['states-mixed',null])$q$,'invalid_goods_list_preorder_states');

-- 운영자가 아니면 읽지 못한다.
select set_config('request.jwt.claim.sub','b9310000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b9310000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.states_error($q$select public.admin_goods_list_preorder_states(array['states-mixed'])$q$,'operator_capability_required');
reset role;
select pg_temp.states_assert(not has_function_privilege('anon','public.admin_goods_list_preorder_states(text[])','execute')
 and not has_function_privilege('service_role','public.admin_goods_list_preorder_states(text[])','execute')
 and has_function_privilege('authenticated','public.admin_goods_list_preorder_states(text[])','execute'),'execute is authenticated only');
rollback;
