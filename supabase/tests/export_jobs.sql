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
-- A. 시스템 양식 2종 — ERP 실화면에서 확인한 열 이름
-- ---------------------------------------------------------------------------
select 1 / case when (
  (select count(*) from public.export_templates where is_system) = 2
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
  has_function_privilege('authenticated', 'public.admin_request_export(uuid,uuid,jsonb,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_request_export(uuid,uuid,jsonb,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_request_export(uuid,uuid,jsonb,text)', 'execute')
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
select (public.claim_export_job('worker-1')).id as claimed_id \gset
select 1 / case when (
  :'claimed_id'::uuid = current_setting('exp.job')::uuid
  and (select status from public.export_jobs where id = current_setting('exp.job')::uuid) = 'running'
  and (select attempts from public.export_jobs where id = current_setting('exp.job')::uuid) = 1
  and (public.claim_export_job('worker-2')) is null
) then 1 else 0 end as assert_queue_claims_once;

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

rollback;
