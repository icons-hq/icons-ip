\set ON_ERROR_STOP on

-- D-4 엑셀 양식 · 비동기 내보내기 (설계서 v2 §1-7, 보고서 G §6 테스트 포인트)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000009a1', 'authenticated', 'authenticated', 'export-admin@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000009a2', 'authenticated', 'authenticated', 'export-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000009a3', 'authenticated', 'authenticated', 'export-buyer@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000009a1', 'export-admin@example.test', 'export_admin', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'admin'),
  ('00000000-0000-4000-8000-0000000009a2', 'export-staff@example.test', 'export_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-0000000009a3', 'export-buyer@example.test', 'export_buyer', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role;

insert into public.verticals (key, label, color) values ('export-test', '내보내기 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('export-ip', '내보내기 테스트 IP', 'export-test') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('export-g1', 'export-ip', '내보내기 테스트 굿즈', '문구', 3000, 'ok', 10)
on conflict (id) do nothing;

insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-0000000009a3', 'export-g1', 2);
select public.place_order(
  '00000000-0000-4000-8000-0000000009a3'::uuid,
  '{"recipientName":"홍길동","phone":"01012345678","postalCode":"06236","address1":"서울특별시 강남구 테헤란로 1","address2":"101동 202호","deliveryNote":"문 앞, 부재 시 경비실"}'::jsonb,
  '00000000-0000-4000-8000-0000000009b1'::uuid
) as order_id \gset

select id as picking_id from public.export_templates where key = 'picking_list' \gset
select id as sabang_id from public.export_templates where key = 'sabangnet_orders' \gset
select set_config('exp.picking', :'picking_id', true), set_config('exp.sabang', :'sabang_id', true);

-- ---------------------------------------------------------------------------
-- A. 시스템 양식 3종 — ERP 실화면에서 확인한 열 이름 + 상품 목록
-- ---------------------------------------------------------------------------
select 1 / case when (
  -- 발주서 · 사방넷 호환 · 굿즈 카탈로그 · 거래확정 내역(현업 3-3)
  (select count(*) from public.export_templates where is_system) = 5
  and (select security_level from public.export_templates where key = 'goods_catalog') = 'normal'
  and (select target from public.export_templates where key = 'goods_catalog')::text = 'goods'
  and (select security_level from public.export_templates where key = 'picking_list') = 'pii'
  and (select jsonb_array_length(columns) from public.export_templates where key = 'picking_list') = 17
  and (select jsonb_array_length(columns) from public.export_templates where key = 'sabangnet_orders') = 22
  -- 정산현황에서 확인한 식별자 열이 사방넷 양식에 있다
  and (select columns @> '[{"header":"원주문번호(쇼핑몰)"}]'::jsonb from public.export_templates where key = 'sabangnet_orders')
  and (select columns @> '[{"header":"상품코드(쇼핑몰)"}]'::jsonb from public.export_templates where key = 'sabangnet_orders')
  -- 출고처리에서 확인한 배송 열이 발주서에 있다
  and (select columns @> '[{"header":"수취인우편번호"}]'::jsonb from public.export_templates where key = 'sabangnet_orders')
) then 1 else 0 end as assert_system_templates_use_confirmed_erp_headers;

-- ---------------------------------------------------------------------------
-- B. ACL — 인증 경로는 authenticated, 워커 경로는 service_role
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_request_export(uuid,uuid,jsonb,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_request_export(uuid,uuid,jsonb,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_request_export(uuid,uuid,jsonb,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_export_rows(uuid,jsonb,jsonb,integer)', 'execute')
  and has_function_privilege('service_role', 'public.claim_export_job(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_export_job(text)', 'execute')
  and has_function_privilege('service_role', 'public.export_rows_for_job(uuid,jsonb,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.export_rows_for_job(uuid,jsonb,integer)', 'execute')
  and not has_table_privilege('authenticated', 'public.export_jobs', 'insert')
  and not has_table_privilege('anon', 'public.export_templates', 'select')
) then 1 else 0 end as assert_export_acl;

-- ---------------------------------------------------------------------------
-- C. 개인정보 양식 — 권한 없으면 요청 자체가 막힌다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a2', true);

do $$
begin
  perform public.admin_request_export('00000000-0000-4000-8000-0000000009c1', current_setting('exp.picking')::uuid, '{}'::jsonb, '창고 발주');
  raise exception 'pii export without permission must fail';
exception when insufficient_privilege then
  if sqlerrm <> 'secure_export_required' then raise; end if;
end $$;

-- 권한은 관리자만 준다 — 스태프가 스스로에게 줄 수 없다.
do $$
begin
  perform public.admin_set_admin_permission('00000000-0000-4000-8000-0000000009a2', 'secure_export', true);
  raise exception 'staff must not grant permissions';
exception when insufficient_privilege then
  if sqlerrm <> 'admin_required' then raise; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a1', true);
select public.admin_set_admin_permission('00000000-0000-4000-8000-0000000009a2', 'secure_export', true);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a2', true);
do $$
begin
  perform public.admin_request_export('00000000-0000-4000-8000-0000000009c2', current_setting('exp.picking')::uuid, '{}'::jsonb, null);
  raise exception 'pii export without a reason must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'reason_required' then raise; end if;
end $$;

select public.admin_request_export('00000000-0000-4000-8000-0000000009c3', current_setting('exp.picking')::uuid, '{}'::jsonb, '창고 발주') as job_id \gset
select set_config('exp.job', :'job_id', true);
-- 같은 요청 키를 다시 보내면 같은 잡을 가리킨다.
select 1 / case when public.admin_request_export('00000000-0000-4000-8000-0000000009c3', current_setting('exp.picking')::uuid, '{}'::jsonb, '창고 발주') = :'job_id'::uuid
  then 1 else 0 end as assert_request_is_idempotent;

-- ---------------------------------------------------------------------------
-- D. 마스킹 — 권한 없는 요청자에게는 원문이 행으로 나오지 않는다
-- ---------------------------------------------------------------------------
reset role;
select 1 / case when (
  private.mask_name('홍길동') = '홍*동'
  and private.mask_name('김철수철') = '김**철'
  and private.mask_name('이수') = '이*'
  and private.mask_name('김') = '김'
  and private.mask_phone('010-1234-5678') = '*******5678'
  and private.mask_phone('02-123-4567') = '*****4567'
  and private.mask_phone('') = ''
  and private.mask_address('서울특별시 강남구 테헤란로 1') = '서울특별시 강남구 ***'
) then 1 else 0 end as assert_masking_rules;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
-- 권한 있는 스태프: 원문
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a2', true);
select 1 / case when (
  select (row_data ->> 'recipient_name') = '홍길동'
     and (row_data ->> 'recipient_phone') = '01012345678'
     and (row_data ->> 'recipient_address') = '서울특별시 강남구 테헤란로 1 101동 202호'
     and (row_data ->> 'recipient_postal_code') = '06236'
     and (row_data ->> 'qty') = '2'
     and (row_data ->> 'delivery_note') = '문 앞, 부재 시 경비실'
  from public.admin_export_rows(current_setting('exp.picking')::uuid, '{}'::jsonb, null, 100)
  where row_data ->> 'good_id' = 'export-g1'
) then 1 else 0 end as assert_permitted_staff_sees_plain_values;

-- 권한 없는 스태프(관리자 계정으로 확인): 마스킹
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a1', true);
select 1 / case when (
  select (row_data ->> 'recipient_name') = '홍*동'
     and (row_data ->> 'recipient_phone') = '*******5678'
     and (row_data ->> 'recipient_address') = '서울특별시 강남구 ***'
  from public.admin_export_rows(current_setting('exp.picking')::uuid, '{}'::jsonb, null, 100)
  where row_data ->> 'good_id' = 'export-g1'
) then 1 else 0 end as assert_unpermitted_staff_sees_masked_values;

-- 합포장·배송번호 파생
select 1 / case when (
  select (row_data ->> 'box_kind') = '단품'
     and pg_catalog.length(row_data ->> 'shipment_group') = 8
     and (row_data ->> 'mall_name') = 'XSQUARE몰'
     and (row_data ->> 'location_name') = '김포'
  from public.admin_export_rows(current_setting('exp.sabang')::uuid, '{}'::jsonb, null, 100)
  where row_data ->> 'good_id' = 'export-g1'
) then 1 else 0 end as assert_derived_shipment_columns;

-- ---------------------------------------------------------------------------
-- E. 워커 — 요청자의 권한으로 마스킹을 정한다(워커 자신의 권한이 아니다)
-- ---------------------------------------------------------------------------
reset role;
select 1 / case when (
  select (row_data ->> 'recipient_name') = '홍길동'
  from public.export_rows_for_job(current_setting('exp.job')::uuid, null, 100)
  where row_data ->> 'good_id' = 'export-g1'
) then 1 else 0 end as assert_worker_follows_requester_permission;

-- 권한을 거두면 같은 잡의 행도 마스킹된다.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a1', true);
select public.admin_set_admin_permission('00000000-0000-4000-8000-0000000009a2', 'secure_export', false);
reset role;
select 1 / case when (
  select (row_data ->> 'recipient_name') = '홍*동'
  from public.export_rows_for_job(current_setting('exp.job')::uuid, null, 100)
  where row_data ->> 'good_id' = 'export-g1'
) then 1 else 0 end as assert_revoked_permission_masks_worker_rows;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a1', true);
select public.admin_set_admin_permission('00000000-0000-4000-8000-0000000009a2', 'secure_export', true);
reset role;

-- ---------------------------------------------------------------------------
-- F. 큐 — 하나만 집고, 중복으로 집지 않고, 멈추면 되돌린다
-- ---------------------------------------------------------------------------
select id as claimed_id from public.claim_export_job('worker-1') \gset
select 1 / case when (
  :'claimed_id'::uuid = current_setting('exp.job')::uuid
  and (select status from public.export_jobs where id = current_setting('exp.job')::uuid) = 'running'
  and (select attempts from public.export_jobs where id = current_setting('exp.job')::uuid) = 1
) then 1 else 0 end as assert_queue_claims_once;

-- 빈 큐는 "행 없음"이어야 한다. 합성 타입이면 전부 null 인 행 하나가 나오고,
-- 워커는 그걸 잡으로 착각한다(HTTP 로는 JSON null 이 아니라 객체로 보인다).
select count(*) as empty_claim_rows from public.claim_export_job('worker-2') \gset
select 1 / case when :'empty_claim_rows'::integer = 0 then 1 else 0 end as assert_empty_queue_claims_nothing;

-- 아직 안 끝난 파일은 받을 수 없다.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a2', true);
do $$
begin
  perform public.admin_issue_export_download(current_setting('exp.job')::uuid, '창고 발주');
  raise exception 'download before completion must fail';
exception when raise_exception then
  if sqlerrm <> 'job_not_done' then raise; end if;
end $$;

reset role;
select public.finish_export_job(current_setting('exp.job')::uuid, 'path/to/file.csv', 1, 512, 'abc123');
select 1 / case when (
  select status = 'done' and row_count = 1 and expires_at > now() + interval '6 days'
  from public.export_jobs where id = current_setting('exp.job')::uuid
) then 1 else 0 end as assert_finish_sets_expiry;

-- 워커가 멈춘 잡은 10분 뒤 큐로 돌아간다. 3회 실패하면 접는다.
update public.export_jobs set status = 'running', locked_at = now() - interval '11 minutes', attempts = 1
where id = current_setting('exp.job')::uuid;
-- 상태를 바꾸는 호출과 그 결과 확인을 한 문장에 두지 않는다(같은 스냅샷을 읽는다).
select public.requeue_stale_export_jobs() as requeued \gset
select 1 / case when :'requeued'::integer = 1
  and (select status from public.export_jobs where id = current_setting('exp.job')::uuid) = 'queued'
  then 1 else 0 end as assert_stale_job_requeues;
update public.export_jobs set status = 'running', locked_at = now() - interval '11 minutes', attempts = 3
where id = current_setting('exp.job')::uuid;
select public.requeue_stale_export_jobs();
select 1 / case when (select status from public.export_jobs where id = current_setting('exp.job')::uuid) = 'failed'
  then 1 else 0 end as assert_stale_job_gives_up_after_three;

-- ---------------------------------------------------------------------------
-- G. 다운로드 — 사유가 있어야 하고, 발급이 기록으로 남고, 기록은 못 고친다
-- ---------------------------------------------------------------------------
update public.export_jobs set status = 'done', expires_at = now() + interval '7 days'
where id = current_setting('exp.job')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a2', true);
do $$
begin
  perform public.admin_issue_export_download(current_setting('exp.job')::uuid, null);
  raise exception 'pii download without a reason must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'reason_required' then raise; end if;
end $$;

select 1 / case when (
  select file_path = 'path/to/file.csv' and file_name like 'picking_list_%.csv' and url_expires_at > now()
  from public.admin_issue_export_download(current_setting('exp.job')::uuid, '창고 발주 전달')
) then 1 else 0 end as assert_download_issues_and_names_file;

reset role;
select 1 / case when (
  select count(*) = 1 and max(reason) = '창고 발주 전달'
  from public.export_download_logs where job_id = current_setting('exp.job')::uuid
) then 1 else 0 end as assert_download_is_logged;

do $$
begin
  update public.export_download_logs set reason = '고쳐치기' where job_id = current_setting('exp.job')::uuid;
  raise exception 'download log must be append-only';
exception when object_not_in_prerequisite_state then null;
end $$;

-- 보관 기간이 지나면 받을 수 없다.
update public.export_jobs set expires_at = now() - interval '1 minute' where id = current_setting('exp.job')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a2', true);
do $$
begin
  perform public.admin_issue_export_download(current_setting('exp.job')::uuid, '창고 발주');
  raise exception 'expired download must fail';
exception when raise_exception then
  if sqlerrm <> 'job_expired' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- H. 양식 — 시스템 양식은 못 고치고, 개인정보 열로 정렬할 수 없다
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.admin_upsert_export_template(
    current_setting('exp.picking')::uuid, '고쳐치기', 'order_items', '[{"key":"order_no","header":"주문번호"}]'::jsonb
  );
  raise exception 'system template must be read-only';
exception when raise_exception then
  if sqlerrm <> 'system_template_readonly' then raise; end if;
end $$;

do $$
begin
  perform public.admin_upsert_export_template(
    null, '개인정보 정렬', 'order_items',
    '[{"key":"recipient_name","header":"수취인명","mask":"name"}]'::jsonb,
    '[{"key":"recipient_name","dir":"asc"}]'::jsonb
  );
  raise exception 'sorting by a masked column must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'invalid_columns' then raise; end if;
end $$;

select 1 / case when public.admin_upsert_export_template(
  null, '김포 발주서(간단)', 'order_items',
  '[{"key":"order_no","header":"주문번호"},{"key":"qty","header":"수량"}]'::jsonb
) is not null then 1 else 0 end as assert_user_template_can_be_created;

reset role;

-- ---------------------------------------------------------------------------
-- I. 보안 엑셀 — 개인정보 양식을 엑셀로 뽑으면 파일 열기 암호가 필수다
-- ---------------------------------------------------------------------------
insert into public.export_templates (key, name, target, columns, security_level, file_format, is_system)
select null, '사방넷 주문(엑셀)', 'order_items', columns, 'pii', 'xlsx', false
from public.export_templates where key = 'sabangnet_orders'
returning id as xlsx_template \gset
select set_config('exp.xlsx', :'xlsx_template', true);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a2', true);
do $$
begin
  perform public.admin_request_export('00000000-0000-4000-8000-0000000009d1', current_setting('exp.xlsx')::uuid, '{}'::jsonb, '보안엑셀', null);
  raise exception 'pii xlsx without a password must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'password_required' then raise; end if;
end $$;
do $$
begin
  perform public.admin_request_export('00000000-0000-4000-8000-0000000009d2', current_setting('exp.xlsx')::uuid, '{}'::jsonb, '보안엑셀', 'short');
  raise exception 'a short password must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'password_required' then raise; end if;
end $$;

select public.admin_request_export('00000000-0000-4000-8000-0000000009d3', current_setting('exp.xlsx')::uuid, '{}'::jsonb, '보안엑셀', 'icons-2026-secret') as xlsx_job \gset
select set_config('exp.xlsx_job', :'xlsx_job', true);
reset role;
select 1 / case when (
  -- 원문은 잡 원장에 없다. 해시만 남는다.
  (select password_hash from public.export_jobs where id = :'xlsx_job') = encode(extensions.digest('icons-2026-secret', 'sha256'), 'hex')
  and (select count(*) from private.export_job_secrets where job_id = :'xlsx_job') = 1
) then 1 else 0 end as assert_password_is_hashed_and_held_apart;

-- 워커가 한 번 읽으면 임시 보관함에서 사라진다.
select 1 / case when public.consume_export_job_secret(:'xlsx_job'::uuid) = 'icons-2026-secret'
  then 1 else 0 end as assert_worker_consumes_the_secret;
select 1 / case when (
  (select count(*) from private.export_job_secrets where job_id = :'xlsx_job') = 0
  and public.consume_export_job_secret(:'xlsx_job'::uuid) is null
) then 1 else 0 end as assert_secret_is_gone_after_use;

-- ---------------------------------------------------------------------------
-- J. 업로드 — 검증만 하고, 리포트를 남기고, 통과한 줄만 적용한다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a2', true);

select public.admin_register_import(
  'stock_set', '재고.csv', repeat('a', 64),
  jsonb_build_array(
    jsonb_build_object('ref', 'export-g1', 'on_hand_qty', 7, 'line', 2),
    jsonb_build_object('ref', '없는코드', 'on_hand_qty', 3, 'line', 3),
    jsonb_build_object('ref', 'export-g1-01', 'on_hand_qty', -1, 'line', 4)
  ),
  false
) as import_job \gset
select set_config('exp.import', :'import_job', true);

reset role;
select 1 / case when (
  select total_rows = 3 and ok_rows = 1 and failed_rows = 2 and status = 'validated'
     and report @> '[{"line":3,"code":"variant_not_found"}]'::jsonb
     and report @> '[{"line":4,"code":"invalid_qty"}]'::jsonb
  from public.import_jobs where id = current_setting('exp.import')::uuid
) then 1 else 0 end as assert_import_validates_without_writing;

-- 같은 파일을 다시 올리면 새로 만들지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a2', true);
select 1 / case when public.admin_register_import(
  'stock_set', '재고.csv', repeat('a', 64),
  jsonb_build_array(jsonb_build_object('ref', 'export-g1', 'on_hand_qty', 7, 'line', 2)), false
) = current_setting('exp.import')::uuid then 1 else 0 end as assert_same_file_returns_the_same_job;

-- 통과한 줄만 적용된다(2번 줄만).
select public.admin_apply_import(
  current_setting('exp.import')::uuid,
  -- 화면은 검증에 쓴 행을 그대로 다시 보낸다(줄 번호가 기준이다).
  jsonb_build_array(
    jsonb_build_object('ref', 'export-g1', 'on_hand_qty', 7, 'line', 2),
    jsonb_build_object('ref', '없는코드', 'on_hand_qty', 3, 'line', 3),
    jsonb_build_object('ref', 'export-g1-01', 'on_hand_qty', -1, 'line', 4)
  )
) as applied \gset
reset role;
select 1 / case when (
  (:'applied'::jsonb ->> 'applied')::integer = 1
  and (select status from public.import_jobs where id = current_setting('exp.import')::uuid) = 'applied'
  -- 보유를 7로 맞췄고 이 주문이 2개를 예약 중이라 판매 가능 수량은 5다(D-1b 규칙).
  and (select stock_qty from public.goods where id = 'export-g1') = 5
) then 1 else 0 end as assert_import_applies_only_valid_rows;

-- 이미 적용한 파일은 다시 적용하지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a2', true);
do $$
begin
  perform public.admin_apply_import(current_setting('exp.import')::uuid, '[]'::jsonb);
  raise exception 'applying twice must fail';
exception when raise_exception then
  if sqlerrm <> 'not_validated' then raise; end if;
end $$;

-- 「전부 아니면 전무」는 오류가 하나라도 있으면 아무것도 적용하지 않는다.
select public.admin_register_import(
  'stock_set', '원자.csv', repeat('b', 64),
  jsonb_build_array(
    jsonb_build_object('ref', 'export-g1', 'on_hand_qty', 9, 'line', 2),
    jsonb_build_object('ref', '없는코드', 'on_hand_qty', 3, 'line', 3)
  ),
  true
) as atomic_job \gset
do $$
begin
  perform public.admin_apply_import(current_setting('exp.atomic')::uuid, '[]'::jsonb);
exception when others then null;
end $$;
select set_config('exp.atomic', :'atomic_job', true);
do $$
begin
  perform public.admin_apply_import(current_setting('exp.atomic')::uuid, jsonb_build_array(jsonb_build_object('ref', 'export-g1', 'on_hand_qty', 9, 'line', 2)));
  raise exception 'atomic import with errors must fail';
exception when raise_exception then
  if sqlerrm <> 'atomic_has_errors' then raise; end if;
end $$;
reset role;
select 1 / case when (select stock_qty from public.goods where id = 'export-g1') = 5
  then 1 else 0 end as assert_atomic_import_changes_nothing;

-- ---------------------------------------------------------------------------
-- L. 굿즈 일괄 업로드 — 파일에 있는 열만 바꾼다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a1', true);

-- 판매가만 실린 줄은 판매가만 바꾼다 — 이름·분류는 파일에 없으니 그대로여야 한다.
-- 재고는 앞 절(J)에서 이미 한 번 바뀌었다. 여기서는 「이 업로드가 건드리지 않는다」만 본다.
select set_config('exp.qty_before', (select stock_qty::text from public.goods where id = 'export-g1'), true);
select public.admin_register_import(
  'goods_upsert', 'goods.csv', repeat('c', 64),
  jsonb_build_array(jsonb_build_object('good_id', 'export-g1', 'price', 4500, 'line', 2)),
  false
) as goods_job \gset
select set_config('exp.goods', :'goods_job', true);
select public.admin_apply_import(
  current_setting('exp.goods')::uuid,
  jsonb_build_array(jsonb_build_object('good_id', 'export-g1', 'price', 4500, 'line', 2))
) as goods_applied \gset
select 1 / case when (
  (select price from public.goods where id = 'export-g1') = 4500
  and (select name from public.goods where id = 'export-g1') = '내보내기 테스트 굿즈'
  and (select type from public.goods where id = 'export-g1') = '문구'
  and (select stock_qty from public.goods where id = 'export-g1')::text = current_setting('exp.qty_before')
) then 1 else 0 end as assert_goods_import_touches_only_present_columns;

-- 없는 IP·잘못된 분류·파일 안 중복은 줄 단위로 거른다. 신규는 최소치를 요구한다.
select public.admin_register_import(
  'goods_upsert', 'goods-bad.csv', repeat('d', 64),
  jsonb_build_array(
    jsonb_build_object('good_id', 'export-g1', 'ip_id', 'no-such-ip', 'line', 2),
    jsonb_build_object('good_id', 'export-g1', 'type', '없는분류', 'line', 3),
    jsonb_build_object('good_id', 'export-new', 'name', '이름만 있는 신상', 'line', 4),
    jsonb_build_object('good_id', 'export-g1', 'price', 5000, 'line', 5),
    jsonb_build_object('good_id', 'export-g1', 'price', 6000, 'line', 6)
  ),
  false
) as bad_job \gset
select set_config('exp.goods_bad', :'bad_job', true);
select 1 / case when (
  select report from public.import_jobs where id = current_setting('exp.goods_bad')::uuid
) = '[{"code": "ip_not_found", "line": 2}, {"code": "invalid_type", "line": 3}, {"code": "good_incomplete", "line": 4}, {"code": "duplicate_good", "line": 6}]'::jsonb
  then 1 else 0 end as assert_goods_import_reports_each_bad_line;

-- 신규 등록은 최소치가 모두 있으면 만들어지고, IP 굿즈 수가 따라 올라간다.
select public.admin_register_import(
  'goods_upsert', 'goods-new.csv', repeat('e', 64),
  jsonb_build_array(jsonb_build_object(
    'good_id', 'export-new', 'ip_id', 'export-ip', 'name', '일괄 신상', 'type', '키링', 'price', 9000,
    'tax_type', 'exempt', 'search_keywords', jsonb_build_array('키링', '신상'), 'line', 2
  )),
  false
) as new_job \gset
select set_config('exp.goods_new', :'new_job', true);
select public.admin_apply_import(
  current_setting('exp.goods_new')::uuid,
  jsonb_build_array(jsonb_build_object(
    'good_id', 'export-new', 'ip_id', 'export-ip', 'name', '일괄 신상', 'type', '키링', 'price', 9000,
    'tax_type', 'exempt', 'search_keywords', jsonb_build_array('키링', '신상'), 'line', 2
  ))
) as new_applied \gset
select 1 / case when (
  (select count(*) from public.goods where id = 'export-new') = 1
  and (select tax_type from public.goods where id = 'export-new') = 'exempt'
  -- 검색어는 저장 시 트리거가 소문자·중복 제거·정렬한다.
  and (select search_keywords from public.goods where id = 'export-new') = '{신상,키링}'::text[]
  and (select goods_count from public.ips where id = 'export-ip') = 2
) then 1 else 0 end as assert_goods_import_creates_new_good;

-- 판매 기간은 한쪽만 실려도 나머지 쪽과 맞춰 본다.
reset role;
update public.goods set sale_starts_at = now() + interval '10 days' where id = 'export-g1';
set local role authenticated;
select public.admin_register_import(
  'goods_upsert', 'goods-window.csv', repeat('f', 64),
  jsonb_build_array(jsonb_build_object('good_id', 'export-g1', 'sale_ends_at', (now() + interval '1 day')::text, 'line', 2)),
  false
) as window_job \gset
select 1 / case when (
  select report from public.import_jobs where id = :'window_job'::uuid
) = '[{"code": "invalid_sale_window", "line": 2}]'::jsonb then 1 else 0 end as assert_goods_import_checks_sale_window_against_stored;
reset role;
update public.goods set sale_starts_at = null where id = 'export-g1';
set local role authenticated;

-- 굿즈 양식은 개인정보가 아니므로 마스킹 대상이 아니고, 커서는 상품코드로 넘어간다.
select id as goods_template from public.export_templates where key = 'goods_catalog' \gset
select count(*) as goods_rows from public.admin_export_rows(:'goods_template'::uuid, '{"ip_id": "export-ip"}'::jsonb, null, 100) \gset
select 1 / case when :'goods_rows'::integer = 2 then 1 else 0 end as assert_goods_export_filters_by_ip;
select count(*) as after_cursor from public.admin_export_rows(
  :'goods_template'::uuid,
  '{"ip_id": "export-ip"}'::jsonb,
  (select row_key from public.admin_export_rows(:'goods_template'::uuid, '{"ip_id": "export-ip"}'::jsonb, null, 1)),
  100
) \gset
select 1 / case when :'after_cursor'::integer = 1 then 1 else 0 end as assert_goods_export_cursor_walks_by_code;
reset role;

-- ---------------------------------------------------------------------------
-- K. 만료 — 지난 파일은 표시되고 다운로드가 막힌다
-- ---------------------------------------------------------------------------
update public.export_jobs set status = 'done', expires_at = now() - interval '1 hour'
where id = current_setting('exp.job')::uuid;
select public.expire_stale_export_jobs() as expired_count \gset
select 1 / case when :'expired_count'::integer >= 1
  and (select status from public.export_jobs where id = current_setting('exp.job')::uuid) = 'expired'
  then 1 else 0 end as assert_expired_jobs_are_marked;

rollback;
