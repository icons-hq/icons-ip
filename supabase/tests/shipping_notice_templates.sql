\set ON_ERROR_STOP on
begin;

create function pg_temp.expect_error(statement text, expected_message text, expected_code text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected_message in sqlerrm) = 0 or sqlstate <> expected_code then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %', expected_message;
end $$;

select 1 / case when to_regclass('public.shipping_notice_templates') is not null
  and not has_table_privilege('anon', 'public.shipping_notice_templates', 'select')
  and has_function_privilege('authenticated', 'public.admin_save_shipping_notice_template(uuid,text,integer,text,text,text,text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.admin_save_shipping_notice_template(uuid,text,integer,text,text,text,text,text,text,timestamptz)', 'execute')
  then 1 else 0 end as assert_shipping_notice_template_boundary;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000049011', 'authenticated', 'authenticated', 'shipping-notice-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-000000049011';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000049011', true);
select public.admin_save_shipping_notice_template(null, 'shipping-test-v2', 2, '배송 검증 초안', '', '', '', '', '', null) as saved \gset
select (:'saved'::jsonb->>'id') as template_id \gset
select (:'saved'::jsonb->>'updatedAt') as template_updated_at \gset
select 1 / case when exists(select 1 from public.shipping_notice_templates where id = :'template_id'::uuid and status = 'draft' and version = 2)
  then 1 else 0 end as assert_new_template_is_draft;

select pg_temp.expect_error(format($sql$select public.admin_save_shipping_notice_template(%L,%L,%s,%L,%L,%L,%L,%L,%L,%L)$sql$,
  :'template_id'::uuid, 'shipping-test-v2', 2, '충돌', '배송', '반품', 'CS', '02', 'shipping@example.test', '2000-01-01T00:00:00Z'),
  'shipping_notice_template_conflict', 'PT409');

select pg_temp.expect_error(format('select public.admin_activate_shipping_notice_template(%L::uuid,%L::timestamptz,%L)',
  :'template_id', :'template_updated_at', '근거 없음'), 'shipping_notice_template_required', '23514');

select public.admin_save_shipping_notice_template(:'template_id'::uuid, 'shipping-test-v2', 2, '배송 검증',
  E'검증 배송 안내\n둘째 줄', E'검증 교환 반품 안내\n둘째 줄', E'검증 CS', '02-0000-0000', 'shipping@example.test', :'template_updated_at'::timestamptz) as saved \gset
select (:'saved'::jsonb->>'updatedAt') as template_updated_at \gset
select pg_temp.expect_error(format($sql$select public.admin_activate_shipping_notice_template(%L,%L,%L)$sql$,
  :'template_id'::uuid, :'template_updated_at'::timestamptz, E' \n\t'), 'shipping_notice_template_required', '23514');
select public.admin_activate_shipping_notice_template(:'template_id'::uuid, :'template_updated_at'::timestamptz, E'운영 자료 확인\n문서 대조') as activated \gset
select 1 / case when (:'activated'::jsonb->>'status') = 'active'
  and exists(select 1 from public.shipping_notice_templates where id = :'template_id'::uuid and confirmed_by = '00000000-0000-4000-8000-000000049011')
  then 1 else 0 end as assert_activation_requires_confirmation_and_audit;

reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.verticals(key, label, color) values ('shipping-notice-tests', '배송정보 검증', '#000000') on conflict (key) do nothing;
insert into public.ips(id, title, vertical_key, published_at)
values ('shipping-notice-tests', '배송정보 검증', 'shipping-notice-tests', now())
on conflict (id) do nothing;
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, published_at, origin_id, shipping_fee_type, individual_fee)
values ('shipping-notice-good', 'shipping-notice-tests', '배송정보 상품', '키링', 1000, 'ok', 1,null, '00000000-0000-4000-8000-000000042201', 'policy', 0)
on conflict (id) do nothing;
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('shipping-notice-good');
select updated_at as good_updated_at from public.goods where id = 'shipping-notice-good' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000049011', true);
select public.admin_apply_shipping_notice_template('shipping-notice-good', :'template_id'::uuid, :'good_updated_at'::timestamptz) as applied \gset
select 1 / case when exists(select 1 from public.goods where id = 'shipping-notice-good'
  and shipping_notice_template_id = :'template_id'::uuid
  and shipping_notice_template_version = 2
  and shipping_notice_snapshot->>'shippingNotice' = E'검증 배송 안내\n둘째 줄'
  and not (shipping_notice_snapshot ? 'confirmationEvidence'))
  then 1 else 0 end as assert_good_keeps_applied_template_snapshot;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select 1 / case when public.get_good_shipping_policy('shipping-notice-good')->>'shippingNotice' = E'검증 배송 안내\n둘째 줄'
  and public.get_good_shipping_policy('shipping-notice-good')->'cs'->>'email' = 'shipping@example.test'
  and not (public.get_good_shipping_policy('shipping-notice-good') ? 'confirmationEvidence')
  then 1 else 0 end as assert_public_shipping_policy_exposes_snapshot_without_evidence;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000049011', true);

select pg_temp.expect_error(format($sql$select public.admin_apply_shipping_notice_template(%L,%L,%L)$sql$,
  'shipping-notice-good', :'template_id'::uuid, (:'good_updated_at'::timestamptz-interval '1 second')),
  'good_shipping_notice_conflict', 'PT409');

select updated_at as good_updated_at from public.goods where id = 'shipping-notice-good' \gset
select public.admin_apply_shipping_notice_template('shipping-notice-good', null, :'good_updated_at'::timestamptz) as cleared \gset
select 1 / case when exists(select 1 from public.goods where id = 'shipping-notice-good'
  and shipping_notice_template_id is null and shipping_notice_template_version is null and shipping_notice_snapshot is null)
  then 1 else 0 end as assert_template_clear_path;

reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.goods_variants set stock_qty=0 where good_id='shipping-notice-good';
update public.goods set archived_at = now() where id = 'shipping-notice-good';
select updated_at as good_updated_at from public.goods where id = 'shipping-notice-good' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000049011', true);
select pg_temp.expect_error(format($sql$select public.admin_apply_shipping_notice_template(%L,%L,%L)$sql$,
  'shipping-notice-good', :'template_id'::uuid, :'good_updated_at'::timestamptz), 'good_archived', '23514');

select public.admin_save_good(jsonb_build_object('id','shipping-notice-save','ip_id','shipping-notice-tests',
  'name','폼 연결 검증','price',1000,'type','키링','stock','ok',
  'shipping_notice_template_code','shipping-test-v2','shipping_notice_template_version',2)) as form_saved \gset
select 1 / case when exists(select 1 from public.goods where id='shipping-notice-save'
  and shipping_notice_template_id=:'template_id'::uuid and shipping_notice_template_version=2
  and shipping_notice_snapshot->>'shippingNotice'=E'검증 배송 안내\n둘째 줄')
then 1 else 0 end as assert_common_good_save_applies_template_atomically;

reset role;
select set_config('request.jwt.claim.sub', '', true);
-- Isolate the template's ON DELETE SET NULL contract from the independent audit retention FK.
delete from public.audit_log where actor_id='00000000-0000-4000-8000-000000049011';
delete from public.profiles where id='00000000-0000-4000-8000-000000049011';
select 1 / case when exists(select 1 from public.shipping_notice_templates where id=:'template_id'::uuid
  and confirmed_by is null and confirmed_at is not null and status='active') then 1 else 0 end as assert_actor_deletion_preserves_confirmed_template;
rollback;
