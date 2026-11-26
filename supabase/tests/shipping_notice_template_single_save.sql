\set ON_ERROR_STOP on
-- 배송 안내 템플릿을 한 번에 저장·적용하는 admin_save_and_apply_shipping_notice_template과 목록 조회
-- admin_list_shipping_notice_templates, 근거 없이도 되는 활성화(admin_activate_shipping_notice_template) 검증.
-- 안내 글·연락처는 모두 합성 값이다. 준비물은 모두 rollback된다(상품을 공개하지 않아 KC 도우미가 필요 없다).
-- 본다: 실행 권한 봉인·운영자 계약, 권한, 필수 안내가 비면 아무것도 남지 않음, 코드 자동·버전 1·바로 사용,
-- 같은 작업 번호 재전송, 고치면 다음 버전 + 그 템플릿을 쓰는 상품 반영(보관 상품 제외), 다른 사람이 먼저 바꾼 저장 거절,
-- 내용이 같으면 새 버전 없이 뒤처진 상품만 맞춤, 초안 줄을 그 자리에서 사용으로, 목록(코드마다 한 줄·상품 수), 감사 기록.
begin;
create function pg_temp.notice_save_expect_error(statement text, expected_message text, expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm) = 0 or (expected_code is not null and sqlstate <> expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %', expected_message;
end $$;

select set_config('request.jwt.claim.sub', '', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-000000106001', 'authenticated', 'authenticated', 'notice-save-primary@example.test', now(), '{}', '{}', now(), now()),
 ('00000000-0000-4000-8000-000000106002', 'authenticated', 'authenticated', 'notice-save-member@example.test', now(), '{}', '{}', now(), now());
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-000000106001';
-- primary는 catalog.manage·catalog.read가 있고, member는 운영자가 아니다.
insert into private.operator_memberships(profile_id, manager_role) values ('00000000-0000-4000-8000-000000106001', 'primary');
update private.operator_access_state set configured = true where id;

insert into public.verticals(key, label, color) values ('notice-save-tests', '배송 안내 검증', '#000000') on conflict (key) do nothing;
insert into public.ips(id, title, vertical_key, published_at) values ('notice-save-ip', '배송 안내 검증', 'notice-save-tests', now());
-- a·b: 템플릿을 쓰는 상품. c: 템플릿을 쓰다가 보관한 상품. d: 템플릿을 쓰지 않는 상품.
insert into public.goods(id, code, ip_id, name, price, stock, stock_qty) values
 ('notice-save-a', 'NSAVE-A', 'notice-save-ip', '안내 검증 A', 1000, 'ok', 1),
 ('notice-save-b', 'NSAVE-B', 'notice-save-ip', '안내 검증 B', 1000, 'ok', 1),
 ('notice-save-c', 'NSAVE-C', 'notice-save-ip', '안내 검증 C', 1000, 'ok', 1),
 ('notice-save-d', 'NSAVE-D', 'notice-save-ip', '안내 검증 D', 1000, 'ok', 1);

-- 1. 실행 권한: authenticated만. anon·service_role은 실행할 수 없다.
select 1 / case when has_function_privilege('authenticated', 'public.admin_save_and_apply_shipping_notice_template(uuid,uuid,timestamptz,text,text,text,text,text,text,text)', 'execute')
 and not has_function_privilege('anon', 'public.admin_save_and_apply_shipping_notice_template(uuid,uuid,timestamptz,text,text,text,text,text,text,text)', 'execute')
 and not has_function_privilege('service_role', 'public.admin_save_and_apply_shipping_notice_template(uuid,uuid,timestamptz,text,text,text,text,text,text,text)', 'execute')
 and has_function_privilege('authenticated', 'public.admin_list_shipping_notice_templates(text,integer,integer,text)', 'execute')
 and not has_function_privilege('anon', 'public.admin_list_shipping_notice_templates(text,integer,integer,text)', 'execute')
 and not has_function_privilege('service_role', 'public.admin_list_shipping_notice_templates(text,integer,integer,text)', 'execute')
 and has_function_privilege('authenticated', 'public.admin_activate_shipping_notice_template(uuid,timestamptz,text)', 'execute')
 and not has_function_privilege('anon', 'public.admin_activate_shipping_notice_template(uuid,timestamptz,text)', 'execute')
 then 1 else 0 end as assert_execute_is_sealed_to_authenticated;
-- 2. 운영자 계약: 저장은 catalog.manage 쓰기, 목록은 catalog.read 읽기. 다시 정의한 활성화도 본문 지문이 지금 함수와 같다.
select 1 / case when (select count(*) from private.operator_rpc_contracts c join pg_proc p on p.oid = to_regprocedure(c.signature)
  where c.body_md5 = md5(p.prosrc) and not c.legacy_admin_only and (c.signature, c.capability, c.guard_kind) in (
   ('public.admin_save_and_apply_shipping_notice_template(uuid,uuid,timestamp with time zone,text,text,text,text,text,text,text)', 'catalog.manage', 'write'),
   ('public.admin_list_shipping_notice_templates(text,integer,integer,text)', 'catalog.read', 'read'),
   ('public.admin_activate_shipping_notice_template(uuid,timestamp with time zone,text)', 'catalog.manage', 'write'))) = 3
 and (select count(*) from private.operator_internal_contracts where signature in (
   'public.admin_save_and_apply_shipping_notice_template(uuid,uuid,timestamp with time zone,text,text,text,text,text,text,text)',
   'public.admin_list_shipping_notice_templates(text,integer,integer,text)',
   'public.admin_activate_shipping_notice_template(uuid,timestamp with time zone,text)')) = 3
 then 1 else 0 end as assert_operator_contracts_registered;
-- 활성 템플릿의 테이블 검사는 근거를 요구하지 않고, 필수 안내와 확인 시각은 계속 요구한다.
select 1 / case when (select count(*) from pg_constraint where conrelid = 'public.shipping_notice_templates'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) like '%confirmed_at IS NOT NULL%' and pg_get_constraintdef(oid) not like '%confirmation_evidence%') = 1
 and not exists(select 1 from pg_constraint where conrelid = 'public.shipping_notice_templates'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) like '%confirmed_at IS NOT NULL%' and pg_get_constraintdef(oid) like '%confirmation_evidence%')
 then 1 else 0 end as assert_active_check_no_longer_requires_evidence;

-- 3. 운영자가 아닌 회원은 저장도 목록도 못 한다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000106002', true);
select pg_temp.notice_save_expect_error($sql$select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a001', null, null, '권한 없음', '배송', '반품', '', 'CS', '02-0000-0000', '')$sql$, 'operator_capability_required', '42501');
select pg_temp.notice_save_expect_error($sql$select public.admin_list_shipping_notice_templates()$sql$, 'operator_capability_required', '42501');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000106001', true);
-- 4. 필수 안내가 비면 거절하고 아무것도 남기지 않는다(교환·반품 안내 없음 / 고객센터 연락처 없음 / 이름 없음).
select pg_temp.notice_save_expect_error($sql$select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a002', null, null, '검증 기본 안내', '배송 안내', E' \n', '', 'CS', '02-0000-0000', '')$sql$, 'shipping_notice_template_required', '23514');
select pg_temp.notice_save_expect_error($sql$select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a002', null, null, '검증 기본 안내', '배송 안내', '반품 안내', '', 'CS', '', '')$sql$, 'shipping_notice_template_required', '23514');
select pg_temp.notice_save_expect_error($sql$select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a002', null, null, E' \t', '배송 안내', '반품 안내', '', 'CS', '02-0000-0000', '')$sql$, 'invalid_shipping_notice_template', '22023');
-- 새 템플릿에 '열어 본 시각'을 보내거나, 고치면서 그 시각을 빼면 거절한다.
select pg_temp.notice_save_expect_error($sql$select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a002', null, now(), '검증 기본 안내', '배송 안내', '반품 안내', '', 'CS', '02-0000-0000', '')$sql$, 'invalid_shipping_notice_template', '22023');
select 1 / case when not exists(select 1 from public.shipping_notice_templates where name = '검증 기본 안내')
 and not exists(select 1 from public.audit_log where id = '00000000-0000-4000-8000-00000010a002')
 then 1 else 0 end as assert_rejected_save_leaves_nothing;

-- 5. 새 템플릿: 코드는 자동(n-…), 버전 1, 바로 사용(active). 근거는 비어 있고 저장한 사람이 남는다.
select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a003', null, null, ' 검증 기본 안내 ', E'결제 후 2~3일 안에 보냅니다.\n둘째 줄', '받은 날부터 7일 안에 신청하세요.',
  '제주는 하루 더 걸립니다.', '검증 CS', '02-0000-0000', 'notice-save@example.test') as created \gset
select (:'created'::jsonb->>'id') as template_v1 \gset
select (:'created'::jsonb->>'updatedAt') as template_v1_updated \gset
select (:'created'::jsonb->>'code') as template_code \gset
select 1 / case when (:'created'::jsonb->>'created')::boolean and (:'created'::jsonb->>'changed')::boolean
 and (:'created'::jsonb->>'appliedGoods')::int = 0 and (:'created'::jsonb->>'version')::int = 1 and :'created'::jsonb->>'status' = 'active'
 and :'template_code' = 'n-000000000000' and :'template_code' ~ '^[a-z][a-z0-9-]{1,39}$'
 and exists(select 1 from public.shipping_notice_templates where id = :'template_v1'::uuid and code = :'template_code' and version = 1
   and status = 'active' and name = '검증 기본 안내' and remote_area_notice = '제주는 하루 더 걸립니다.'
   and confirmation_evidence = '' and confirmed_by = '00000000-0000-4000-8000-000000106001' and confirmed_at is not null)
 and exists(select 1 from public.audit_log where id = '00000000-0000-4000-8000-00000010a003'
   and action = 'catalog.shipping_notice_template.saved_and_applied' and target = 'shipping_notice_templates:' || :'template_v1'
   and diff->'before' = 'null'::jsonb and diff->'after'->>'id' = :'template_v1')
 then 1 else 0 end as assert_new_template_is_usable_at_once;

-- 6. 같은 작업 번호를 다시 보내면 다시 만들지 않고 처음 결과를 돌려준다. 내용이 다르면 거절한다.
select 1 / case when public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a003', null, null, '검증 기본 안내', E'결제 후 2~3일 안에 보냅니다.\n둘째 줄', '받은 날부터 7일 안에 신청하세요.',
  '제주는 하루 더 걸립니다.', '검증 CS', '02-0000-0000', 'notice-save@example.test') = :'created'::jsonb
 and (select count(*) from public.shipping_notice_templates where name = '검증 기본 안내') = 1
 then 1 else 0 end as assert_same_operation_is_not_saved_twice;
select pg_temp.notice_save_expect_error($sql$select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a003', null, null, '검증 기본 안내', '다른 내용', '받은 날부터 7일 안에 신청하세요.',
  '', '검증 CS', '02-0000-0000', '')$sql$, 'shipping_notice_template_operation_mismatch', 'PT409');

-- 상품 a·b·c에 템플릿을 적용하고(기존 적용 함수) c는 보관한다.
select public.admin_apply_shipping_notice_template(id, :'template_v1'::uuid, updated_at) from public.goods
 where id in ('notice-save-a', 'notice-save-b', 'notice-save-c') order by id;
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.goods_variants set stock_qty = 0 where good_id = 'notice-save-c';
update public.goods set archived_at = now() where id = 'notice-save-c';
select base_revision as good_a_revision from public.goods where id = 'notice-save-a' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000106001', true);

-- 7. 목록: 템플릿 한 줄, 쓰는 상품 수는 보관하지 않은 상품만. 내부 확인 근거는 돌려주지 않는다.
select public.admin_list_shipping_notice_templates('검증 기본') as listed \gset
select 1 / case when (:'listed'::jsonb->>'total')::int = 1 and jsonb_array_length(:'listed'::jsonb->'rows') = 1
 and :'listed'::jsonb->'rows'->0->>'id' = :'template_v1' and (:'listed'::jsonb->'rows'->0->>'goodsCount')::int = 2
 and :'listed'::jsonb->'rows'->0->>'status' = 'active'
 and (select array_agg(key order by key) from jsonb_object_keys(:'listed'::jsonb->'rows'->0) key)
  = array['code','csEmail','csName','csPhone','goodsCount','id','name','remoteAreaNotice','returnExchangeNotice','shippingNotice','status','updatedAt','version']
 then 1 else 0 end as assert_list_row_shape_and_goods_count;

-- 8. 열어 본 뒤 다른 사람이 바꾼 것으로 보이면(시각 불일치) 거절하고 아무것도 바꾸지 않는다.
select pg_temp.notice_save_expect_error(format($sql$select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a004', %L, %L, '검증 기본 안내', '고친 배송 안내', '받은 날부터 7일 안에 신청하세요.', '', '검증 CS', '02-0000-0000', '')$sql$,
  :'template_v1', (:'template_v1_updated'::timestamptz - interval '1 second')), 'shipping_notice_template_conflict', 'PT409');
select 1 / case when (select count(*) from public.shipping_notice_templates where code = :'template_code') = 1
 and (select shipping_notice_snapshot->>'shippingNotice' from public.goods where id = 'notice-save-a') = E'결제 후 2~3일 안에 보냅니다.\n둘째 줄'
 then 1 else 0 end as assert_conflict_changes_nothing;

-- 9. 고치기: 다음 버전이 생기고, 그 템플릿을 쓰는 보관하지 않은 상품이 새 내용으로 바뀐다. 예전 버전과 보관한 상품은 그대로다.
select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a005', :'template_v1'::uuid, :'template_v1_updated'::timestamptz, '검증 기본 안내',
  '결제 후 3일 안에 보냅니다.', '받은 날부터 7일 안에 신청하세요.', '', '검증 CS', '02-0000-0000', 'notice-save@example.test') as edited \gset
select (:'edited'::jsonb->>'id') as template_v2 \gset
select (:'edited'::jsonb->>'updatedAt') as template_v2_updated \gset
select 1 / case when not (:'edited'::jsonb->>'created')::boolean and (:'edited'::jsonb->>'changed')::boolean
 and (:'edited'::jsonb->>'appliedGoods')::int = 2 and (:'edited'::jsonb->>'version')::int = 2 and :'edited'::jsonb->>'code' = :'template_code'
 and :'template_v2' <> :'template_v1'
 and exists(select 1 from public.shipping_notice_templates where id = :'template_v1'::uuid and status = 'active'
   and shipping_notice = E'결제 후 2~3일 안에 보냅니다.\n둘째 줄' and updated_at = :'template_v1_updated'::timestamptz)
 and exists(select 1 from public.shipping_notice_templates where id = :'template_v2'::uuid and status = 'active' and version = 2
   and shipping_notice = '결제 후 3일 안에 보냅니다.' and remote_area_notice = '')
 and (select count(*) from public.goods where id in ('notice-save-a', 'notice-save-b')
   and shipping_notice_template_id = :'template_v2'::uuid and shipping_notice_template_version = 2
   and shipping_notice_snapshot->>'shippingNotice' = '결제 후 3일 안에 보냅니다.'
   and shipping_notice_snapshot->>'templateId' = :'template_v2' and (shipping_notice_snapshot->>'templateVersion')::int = 2
   and shipping_notice_snapshot->>'code' = :'template_code' and shipping_notice_snapshot->>'remoteAreaNotice' = ''
   and not (shipping_notice_snapshot ? 'confirmationEvidence')) = 2
 and exists(select 1 from public.goods where id = 'notice-save-c' and shipping_notice_template_id = :'template_v1'::uuid
   and shipping_notice_snapshot->>'shippingNotice' = E'결제 후 2~3일 안에 보냅니다.\n둘째 줄')
 and exists(select 1 from public.goods where id = 'notice-save-d' and shipping_notice_template_id is null and shipping_notice_snapshot is null)
 then 1 else 0 end as assert_edit_makes_next_version_and_updates_goods;
-- 상품 수정 화면이 들고 있던 기본 정보 버전이 올라가, 그사이 열어 둔 상품 화면의 저장은 '다른 사람이 먼저 바꿨습니다'로 막힌다.
select 1 / case when (select base_revision from public.goods where id = 'notice-save-a') > :good_a_revision
 then 1 else 0 end as assert_goods_base_revision_moves;
-- 감사 기록: 템플릿 한 건(전후)과 바뀐 상품마다 한 건(전후·작업 번호).
select 1 / case when exists(select 1 from public.audit_log where id = '00000000-0000-4000-8000-00000010a005'
   and actor_id = '00000000-0000-4000-8000-000000106001' and action = 'catalog.shipping_notice_template.saved_and_applied'
   and diff->'before'->>'id' = :'template_v1' and diff->'after'->>'id' = :'template_v2' and (diff->'result'->>'appliedGoods')::int = 2)
 and (select count(*) from public.audit_log where action = 'catalog.good.shipping_notice_template_applied'
   and diff->>'operationId' = '00000000-0000-4000-8000-00000010a005' and target in ('goods:notice-save-a', 'goods:notice-save-b')
   and diff->'before'->>'templateId' = :'template_v1' and diff->'after'->>'templateId' = :'template_v2'
   and diff->'after'->'snapshot'->>'shippingNotice' = '결제 후 3일 안에 보냅니다.') = 2
 then 1 else 0 end as assert_audit_rows_for_template_and_goods;

-- 10. 예전 줄(버전 1)을 열어 둔 화면의 저장은 거절한다 — 지금 줄은 버전 2다.
select pg_temp.notice_save_expect_error(format($sql$select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a006', %L, %L, '검증 기본 안내', '늦게 온 저장', '받은 날부터 7일 안에 신청하세요.', '', '검증 CS', '02-0000-0000', '')$sql$,
  :'template_v1', :'template_v1_updated'), 'shipping_notice_template_conflict', 'PT409');

-- 11. 내용이 같으면 새 버전을 만들지 않는다. 예전 버전으로 돌아가 있던 상품만 지금 내용으로 맞춘다.
select public.admin_apply_shipping_notice_template('notice-save-a', :'template_v1'::uuid, (select updated_at from public.goods where id = 'notice-save-a'));
select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a007', :'template_v2'::uuid, :'template_v2_updated'::timestamptz, '검증 기본 안내',
  '결제 후 3일 안에 보냅니다.', '받은 날부터 7일 안에 신청하세요.', '', '검증 CS', '02-0000-0000', 'notice-save@example.test') as unchanged \gset
select 1 / case when not (:'unchanged'::jsonb->>'changed')::boolean and (:'unchanged'::jsonb->>'appliedGoods')::int = 1
 and :'unchanged'::jsonb->>'id' = :'template_v2' and :'unchanged'::jsonb->>'updatedAt' = :'edited'::jsonb->>'updatedAt'
 and (select count(*) from public.shipping_notice_templates where code = :'template_code') = 2
 and exists(select 1 from public.goods where id = 'notice-save-a' and shipping_notice_template_id = :'template_v2'::uuid)
 then 1 else 0 end as assert_same_content_only_catches_up_goods;
-- 목록은 여전히 한 줄(가장 큰 버전)이고, 코드로도 그 한 줄을 읽는다. 쓰는 상품 수는 버전을 가리지 않고 센다.
select public.admin_apply_shipping_notice_template('notice-save-b', :'template_v1'::uuid, (select updated_at from public.goods where id = 'notice-save-b'));
select 1 / case when (public.admin_list_shipping_notice_templates('검증 기본')->>'total')::int = 1
 and public.admin_list_shipping_notice_templates('검증 기본')->'rows'->0->>'id' = :'template_v2'
 and (public.admin_list_shipping_notice_templates('', 20, 0, :'template_code')->'rows'->0->>'goodsCount')::int = 2
 and (public.admin_list_shipping_notice_templates('없는 이름 100%')->>'total')::int = 0
 and (public.admin_list_shipping_notice_templates('', 20, 0, 'n-none')->>'total')::int = 0
 then 1 else 0 end as assert_list_is_one_row_per_template;
select pg_temp.notice_save_expect_error($sql$select public.admin_list_shipping_notice_templates('', 0, 0)$sql$, 'invalid_shipping_notice_template_page', '22023');

-- 12. 예전 방식으로 만든 초안(코드·버전을 손으로 적은 줄)은 그 줄 그대로 사용으로 바뀐다. 버전은 그대로다.
select public.admin_save_shipping_notice_template_v2(null, 'notice-save-draft', 3, '검증 초안', '', '', '', '', '', '', null) as draft \gset
select 1 / case when public.admin_list_shipping_notice_templates('', 20, 0, 'notice-save-draft')->'rows'->0->>'status' = 'draft'
 then 1 else 0 end as assert_list_shows_draft_status;
select public.admin_save_and_apply_shipping_notice_template(
  '00000000-0000-4000-8000-00000010a008', (:'draft'::jsonb->>'id')::uuid, (:'draft'::jsonb->>'updatedAt')::timestamptz, '검증 초안 마무리',
  '배송 안내', '교환·반품 안내', '', '검증 CS', '', 'notice-save@example.test') as finished \gset
select 1 / case when :'finished'::jsonb->>'id' = :'draft'::jsonb->>'id' and (:'finished'::jsonb->>'version')::int = 3
 and :'finished'::jsonb->>'status' = 'active' and (:'finished'::jsonb->>'changed')::boolean and (:'finished'::jsonb->>'appliedGoods')::int = 0
 and exists(select 1 from public.shipping_notice_templates where id = (:'draft'::jsonb->>'id')::uuid and status = 'active'
   and name = '검증 초안 마무리' and cs_phone = '' and confirmation_evidence = '' and confirmed_at is not null)
 then 1 else 0 end as assert_draft_row_becomes_usable_in_place;

-- 13. 예전 활성화 함수: 근거 없이도 활성화하고, 근거를 보내면 전처럼 저장한다. 너무 긴 근거와 필수 안내 누락은 계속 거절한다.
select public.admin_save_shipping_notice_template_v2(null, 'notice-save-activate', 1, '검증 활성화', '배송', '반품', '', 'CS', '02-0000-0000', '', null) as plain \gset
select pg_temp.notice_save_expect_error(format('select public.admin_activate_shipping_notice_template(%L::uuid, %L::timestamptz, %L)',
  :'plain'::jsonb->>'id', :'plain'::jsonb->>'updatedAt', repeat('가', 2001)), 'shipping_notice_template_required', '23514');
select public.admin_activate_shipping_notice_template((:'plain'::jsonb->>'id')::uuid, (:'plain'::jsonb->>'updatedAt')::timestamptz, E' \n\t') as activated \gset
select 1 / case when :'activated'::jsonb->>'status' = 'active'
 and exists(select 1 from public.shipping_notice_templates where id = (:'plain'::jsonb->>'id')::uuid and status = 'active'
   and confirmation_evidence = '' and confirmed_by = '00000000-0000-4000-8000-000000106001')
 then 1 else 0 end as assert_activation_works_without_evidence;
select public.admin_save_shipping_notice_template_v2(null, 'notice-save-activate', 2, '검증 활성화', '배송', '반품', '', 'CS', '02-0000-0000', '', null) as evidenced \gset
select public.admin_activate_shipping_notice_template((:'evidenced'::jsonb->>'id')::uuid, (:'evidenced'::jsonb->>'updatedAt')::timestamptz, ' 운영 자료 확인 ');
select public.admin_save_shipping_notice_template_v2(null, 'notice-save-activate', 3, '검증 활성화', '', '', '', '', '', '', null) as empty_draft \gset
select pg_temp.notice_save_expect_error(format('select public.admin_activate_shipping_notice_template(%L::uuid, %L::timestamptz, %L)',
  :'empty_draft'::jsonb->>'id', :'empty_draft'::jsonb->>'updatedAt', ''), 'shipping_notice_template_required', '23514');
select 1 / case when exists(select 1 from public.shipping_notice_templates where id = (:'evidenced'::jsonb->>'id')::uuid
   and status = 'active' and confirmation_evidence = '운영 자료 확인')
 then 1 else 0 end as assert_activation_still_stores_sent_evidence;
rollback;
