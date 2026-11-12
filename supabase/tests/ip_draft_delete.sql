\set ON_ERROR_STOP on
-- IP 내부 ID 자동 발급(admin_create_ip)과 미사용 초안 삭제(admin_ip_delete_readiness · admin_delete_draft_ip).
-- 20261113034000 · ADR-0039. Every fixture rolls back.
begin;
do $$begin
  if to_regclass('private.operator_legacy_fixture_control') is not null then
    raise exception 'Run IP draft deletion tests without the legacy fixture helper';
  end if;
end $$;
-- Legacy (unconfigured) authority is part of this contract; pin it for this rolled-back transaction only.
update private.operator_access_state set configured = false where id;
select set_config('request.jwt.claim.sub', '', true);

create function pg_temp.t17c_id(n integer) returns uuid language sql immutable as $$
  select ('17c00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.t17c_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'IP draft delete assertion: %', label; end if; end $$;
create function pg_temp.t17c_expect(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlerrm = expected or sqlstate = expected then return; end if;
    raise;
  end;
  raise exception 'Expected % from %', expected, statement;
end $$;
create function pg_temp.t17c_as(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.t17c_id(n)::text, true);
$$;
grant execute on function pg_temp.t17c_id(integer), pg_temp.t17c_assert(boolean, text),
  pg_temp.t17c_expect(text, text), pg_temp.t17c_as(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Declarative boundary.
-- ---------------------------------------------------------------------------
select pg_temp.t17c_assert(bool_and(
    has_function_privilege('authenticated', signature, 'execute')
    and not has_function_privilege('anon', signature, 'execute')
    and not has_function_privilege('service_role', signature, 'execute')
    and not has_function_privilege('public', signature, 'execute')), 'RPC ACL')
from unnest(array[
  'public.admin_create_ip(text,text,text,text,text,text,text,text,text,boolean)',
  'public.admin_ip_delete_readiness(text)',
  'public.admin_delete_draft_ip(text)'
]) as signature;
select pg_temp.t17c_assert(bool_and(not has_function_privilege(role_name, signature, 'execute')), 'private helpers sealed')
from unnest(array[
  'private.ip_delete_readiness(text)',
  'private.record_ip_public_history()',
  'private.default_ip_public_slug()',
  'private.lock_coupon_target_ips()'
]) as signature
cross join unnest(array['anon', 'authenticated', 'service_role']) as role_name;
select pg_temp.t17c_assert(bool_and(not has_table_privilege(role_name, table_name, 'select,insert,update,delete')), 'private tables sealed')
from unnest(array['private.ip_public_history', 'private.retired_ip_ids']) as table_name
cross join unnest(array['anon', 'authenticated', 'service_role']) as role_name;
select pg_temp.t17c_assert(count(*) = 4, 'operator RPC contracts registered with current bodies')
from private.operator_rpc_contracts as contract
join pg_proc as proc on proc.oid = to_regprocedure(contract.signature)
where contract.body_md5 = md5(proc.prosrc)
  and (contract.signature, contract.capability, contract.guard_kind, contract.legacy_admin_only) in (
    ('public.admin_create_ip(text,text,text,text,text,text,text,text,text,boolean)', 'platform.manage', 'write', false),
    ('public.admin_ip_delete_readiness(text)', 'platform.manage', 'read', false),
    ('public.admin_delete_draft_ip(text)', 'platform.manage', 'write', true),
    ('public.admin_update_ip_identity(text,text,text)', 'platform.manage', 'write', false)
  );
select pg_temp.t17c_assert(exists (
  select 1 from pg_trigger where tgrelid = 'public.ips'::regclass and tgname = 'ips_record_public_history' and not tgisinternal
), 'public history trigger');
select pg_temp.t17c_assert(exists (
  select 1 from pg_trigger
  where tgrelid = 'public.coupons'::regclass and tgname = 'coupons_lock_target_ips' and not tgisinternal
    and pg_get_triggerdef(oid) like '%BEFORE INSERT OR UPDATE OF target_ip_ids ON public.coupons FOR EACH ROW%'
), 'coupon target lock trigger');
-- Every IP that is public right now already carries public history (backfill + trigger).
select pg_temp.t17c_assert(not exists (
  select 1 from public.ips as ip
  where ip.published_at is not null
    and not exists (select 1 from private.ip_public_history as history where history.ip_id = ip.id)
), 'published IPs have public history');

-- ---------------------------------------------------------------------------
-- Principals: 1 legacy admin · 2 legacy staff · 3 configured primary · 4 configured deputy · 5 user.
-- ---------------------------------------------------------------------------
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.t17c_id(n), 'authenticated', 'authenticated', 'ip-draft-delete-' || n || '@example.test', now(),
  '{"testFixture":"ip-draft-delete"}', '{}', now(), now()
from generate_series(1, 5) as n;
update public.profiles
set role = (case right(id::text, 1) when '1' then 'admin' when '5' then 'user' else 'staff' end)::public.user_role,
    nickname = 'ip_draft_delete_' || right(id::text, 1), birth_date = '2000-01-01', onboarded_at = now()
where id in (select pg_temp.t17c_id(n) from generate_series(1, 5) as n);
insert into private.operator_legacy_cohort(profile_id, legacy_role) values
  (pg_temp.t17c_id(1), 'admin'), (pg_temp.t17c_id(2), 'staff');
insert into private.operator_memberships(profile_id, manager_role) values
  (pg_temp.t17c_id(3), 'primary'), (pg_temp.t17c_id(4), 'deputy');
insert into public.verticals(key, label, color) values ('t17c-test', 'T17c 테스트', '#111111') on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. 내부 ID 자동 발급: 사람은 이름·공개 URL만 넣는다.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.t17c_as(2);
select pg_temp.t17c_assert(public.admin_create_ip(' t17c-alpha ', ' 알파 IP ', '보조', 't17c-test', null, null, null, null, null) = 't17c-alpha',
  'issued id follows the public URL');
select pg_temp.t17c_expect($q$select public.admin_create_ip('t17c-alpha', '중복', null, 't17c-test', null, null, null, null, null)$q$, 'ip_public_slug_taken');
select pg_temp.t17c_expect($q$select public.admin_create_ip('T17c Alpha', '형식', null, 't17c-test', null, null, null, null, null)$q$, 'invalid_ip_public_slug');
select pg_temp.t17c_expect($q$select public.admin_create_ip('t17c-alpha-', '형식', null, 't17c-test', null, null, null, null, null)$q$, 'invalid_ip_public_slug');
select pg_temp.t17c_expect($q$select public.admin_create_ip('aouad', '예약', null, 't17c-test', null, null, null, null, null)$q$, 'invalid_ip_public_slug');
select pg_temp.t17c_expect($q$select public.admin_create_ip(null, null, null, null, null, null, null, null, null)$q$, 'invalid_ip_public_slug');
select pg_temp.t17c_expect($q$select public.admin_create_ip('t17c-blank', '   ', null, 't17c-test', null, null, null, null, null)$q$, 'invalid_ip_title');
select pg_temp.t17c_expect($q$select public.admin_create_ip('t17c-blank', '분류 없음', null, 'missing-vertical', null, null, null, null, null)$q$, 'invalid_ip_vertical');
select public.admin_create_ip('t17c-live', '공개 IP', null, 't17c-test', null, null, null, null, null, true);
reset role;
select pg_temp.t17c_assert(public_slug = 't17c-alpha' and title = '알파 IP' and sub = '보조' and published_at is null
  and archived_at is null and not featured, 'created as a draft with the requested public URL')
from public.ips where id = 't17c-alpha';
select pg_temp.t17c_assert(count(*) = 1, 'creation audited once')
from public.audit_log
where actor_id = pg_temp.t17c_id(2) and action = 'catalog.ip.upsert' and target = 'ips:t17c-alpha'
  and diff ->> 'mode' = 'create' and diff ->> 'public_slug' = 't17c-alpha' and (diff ->> 'id_issued')::boolean;
select pg_temp.t17c_assert(not exists (select 1 from private.ip_public_history where ip_id = 't17c-alpha'), 'draft has no public history');
select pg_temp.t17c_assert(ip.published_at is not null and history.evidence = 'published'
  and exists (select 1 from public.audit_log where action = 'admin.ip.published' and target = 'ips:t17c-live'),
  'save-and-publish records public history')
from public.ips as ip join private.ip_public_history as history on history.ip_id = ip.id
where ip.id = 't17c-live';

-- Capability: deputy and plain users cannot create.
set local role authenticated;
select pg_temp.t17c_as(4);
select pg_temp.t17c_expect($q$select public.admin_create_ip('t17c-deputy', '부매니저', null, 't17c-test', null, null, null, null, null)$q$, '42501');
select pg_temp.t17c_as(5);
select pg_temp.t17c_expect($q$select public.admin_create_ip('t17c-user', '회원', null, 't17c-test', null, null, null, null, null)$q$, '42501');
reset role;

-- ---------------------------------------------------------------------------
-- 2. 삭제 가능 여부와 권한.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.t17c_as(2);
select pg_temp.t17c_assert(
  readiness ->> 'state' = 'draft'
  and not (readiness ->> 'publicHistory')::boolean
  and (readiness ->> 'referenceTotal')::bigint = 0
  and (readiness ->> 'deletable')::boolean
  and readiness -> 'references' = '{"goods":0,"cards":0,"card_pools":0,"reward_policies":0,"events":0,"home_curations":0,"coupons":0,"order_items":0,"ip_follows":0,"posts":0,"other":0}'::jsonb
  and readiness -> 'aliases' = '[]'::jsonb,
  'an unused draft is deletable with zero-reference evidence')
from public.admin_ip_delete_readiness('t17c-alpha') as readiness;
select pg_temp.t17c_assert(public.admin_ip_delete_readiness('t17c-missing') is null, 'unknown IP has no readiness');
select pg_temp.t17c_expect($q$select public.admin_ip_delete_readiness('Bad Id')$q$, 'invalid_ip_id');
-- Legacy staff may read the evidence but deleting is admin-only.
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-alpha')$q$, 'operator_capability_required');
select pg_temp.t17c_as(4);
select pg_temp.t17c_expect($q$select public.admin_ip_delete_readiness('t17c-alpha')$q$, '42501');
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-alpha')$q$, '42501');
select pg_temp.t17c_as(5);
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-alpha')$q$, '42501');

-- Legacy admin deletes: snapshot audit, retired ID, idempotent replay.
select pg_temp.t17c_as(1);
select pg_temp.t17c_assert(public.admin_delete_draft_ip('t17c-alpha'), 'admin deletes an unused draft');
select pg_temp.t17c_assert(not public.admin_delete_draft_ip('t17c-alpha'), 'replay is a no-op');
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-never-existed')$q$, 'catalog_not_found');
reset role;
select pg_temp.t17c_assert(not exists (select 1 from public.ips where id = 't17c-alpha'), 'row deleted');
select pg_temp.t17c_assert(count(*) = 1
  and bool_and(audit.diff -> 'snapshot' ->> 'title' = '알파 IP')
  and bool_and(audit.diff -> 'snapshot' ->> 'public_slug' = 't17c-alpha')
  and bool_and(audit.diff -> 'snapshot' ->> 'published_at' is null)
  and bool_and((audit.diff -> 'references' ->> 'goods')::int = 0)
  and bool_and(audit.diff ->> 'retired_id' = 't17c-alpha')
  and bool_and(retired.audit_log_id = audit.id and retired.retired_by = pg_temp.t17c_id(1) and retired.public_slug = 't17c-alpha'),
  'deletion audited once with the deleted row snapshot and linked to the retired ID')
from public.audit_log as audit
join private.retired_ip_ids as retired on retired.id = 't17c-alpha'
where audit.action = 'catalog.ip.deleted' and audit.target = 'ips:t17c-alpha' and audit.actor_id = pg_temp.t17c_id(1);

-- ---------------------------------------------------------------------------
-- 3. 퇴역 ID는 다시 발급하지 않는다. 공개 URL은 공개된 적이 없으니 다시 쓸 수 있고, 내부 ID는 -2·-3이 붙는다.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.t17c_as(3);
select pg_temp.t17c_assert(public.admin_create_ip('t17c-alpha', '알파 다시', null, 't17c-test', null, null, null, null, null) = 't17c-alpha-2',
  'a retired ID gets a numeric suffix');
-- Another IP's internal ID is not available as a public URL (links resolve both).
select pg_temp.t17c_expect($q$select public.admin_create_ip('t17c-alpha-2', '충돌', null, 't17c-test', null, null, null, null, null)$q$, 'ip_public_slug_taken');
select pg_temp.t17c_expect($q$select public.admin_update_ip_identity('t17c-live', 't17c-alpha-2', 't17c-live')$q$, 'ip_public_slug_taken');
-- The legacy explicit-ID path cannot reuse a retired ID either.
select pg_temp.t17c_expect($q$select public.admin_upsert_ip('t17c-alpha', '옛 경로', null, 't17c-test', null, null, null, null, null, false, null, null)$q$, 'catalog_id_retired');
reset role;
select pg_temp.t17c_assert(public_slug = 't17c-alpha', 'reused public URL kept on the suffixed ID')
from public.ips where id = 't17c-alpha-2';
set local role authenticated;
select pg_temp.t17c_as(3);
-- Renaming a never-public draft leaves an alias; the alias is the IP's own former URL, not a reference.
select pg_temp.t17c_assert(public.admin_update_ip_identity('t17c-alpha-2', 't17c-alpha-renamed', 't17c-alpha'), 'draft rename');
select pg_temp.t17c_assert(public.admin_update_ip_identity('t17c-alpha-2', 't17c-alpha-2', 't17c-alpha-renamed'), 'an IP may take its own internal ID as URL');
select pg_temp.t17c_assert(readiness -> 'aliases' = '["t17c-alpha","t17c-alpha-renamed"]'::jsonb and (readiness ->> 'deletable')::boolean,
  'never-public aliases do not block deletion')
from public.admin_ip_delete_readiness('t17c-alpha-2') as readiness;
select pg_temp.t17c_assert(public.admin_delete_draft_ip('t17c-alpha-2'), 'configured primary deletes');
select pg_temp.t17c_assert(public.admin_create_ip('t17c-alpha', '알파 세 번째', null, 't17c-test', null, null, null, null, null) = 't17c-alpha-3',
  'the next suffix skips every retired ID');
reset role;
select pg_temp.t17c_assert(not exists (select 1 from public.ip_public_slug_aliases where ip_id = 't17c-alpha-2'), 'aliases removed with the draft');
select pg_temp.t17c_assert(diff -> 'aliases' = '["t17c-alpha","t17c-alpha-renamed"]'::jsonb, 'removed aliases recorded in the audit')
from public.audit_log where action = 'catalog.ip.deleted' and target = 'ips:t17c-alpha-2';
-- Only admin_create_ip may store a public URL that differs from the internal ID.
set local role service_role;
select pg_temp.t17c_expect($q$insert into public.ips(id, public_slug, title, vertical_key) values ('t17c-direct', 't17c-direct-url', '직접', 't17c-test')$q$,
  'ip_public_slug_write_requires_rpc');
reset role;

-- ---------------------------------------------------------------------------
-- 4. 막히는 경우: 참조·공개 이력·초안이 아님.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.t17c_as(2);
select public.admin_create_ip('t17c-goods', '상품 연결', null, 't17c-test', null, null, null, null, null);
select public.admin_create_ip('t17c-linked', '링크 연결', null, 't17c-test', null, null, null, null, null);
select public.admin_create_ip('t17c-coupon', '쿠폰 대상', null, 't17c-test', null, null, null, null, null);
select public.admin_create_ip('t17c-follow', '팔로우', null, 't17c-test', null, null, null, null, null);
select public.admin_create_ip('t17c-once', '공개했던 초안', null, 't17c-test', null, null, null, null, null, true);
select public.admin_set_ip_published('t17c-once', false);
select public.admin_create_ip('t17c-archived', '보관한 초안', null, 't17c-test', null, null, null, null, null);
select public.admin_archive_ip('t17c-archived');
reset role;
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty)
values ('t17c-goods-item', 't17c-goods', '연결 상품', '문구', 1000, 'soldout', 0);
insert into public.home_curations(id, kind, title, link_path, display_order, active_from, enabled)
values (gen_random_uuid(), 'announcement', '링크 공지', '/ip/t17c-linked?tab=goods', 0, now(), false);
insert into public.coupons(code, name, discount_type, discount_value, goods_scope, target_ip_ids)
values ('T17C-IP-COUPON', 'IP 쿠폰', 'fixed', 1000, 'selected_ips', array['t17c-coupon']);
insert into public.ip_follows(user_id, ip_id) values (pg_temp.t17c_id(5), 't17c-follow');

set local role authenticated;
select pg_temp.t17c_as(1);
select pg_temp.t17c_assert((readiness -> 'references' ->> 'goods')::int = 1 and (readiness ->> 'referenceTotal')::int = 1
  and not (readiness ->> 'deletable')::boolean, 'linked goods block deletion')
from public.admin_ip_delete_readiness('t17c-goods') as readiness;
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-goods')$q$, 'ip_has_references');
select pg_temp.t17c_assert((readiness -> 'references' ->> 'home_curations')::int = 1, 'a banner link to the IP page blocks deletion')
from public.admin_ip_delete_readiness('t17c-linked') as readiness;
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-linked')$q$, 'ip_has_references');
select pg_temp.t17c_assert((readiness -> 'references' ->> 'coupons')::int = 1, 'a coupon target blocks deletion')
from public.admin_ip_delete_readiness('t17c-coupon') as readiness;
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-coupon')$q$, 'ip_has_references');
select pg_temp.t17c_assert((readiness -> 'references' ->> 'ip_follows')::int = 1, 'a follower blocks deletion')
from public.admin_ip_delete_readiness('t17c-follow') as readiness;
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-follow')$q$, 'ip_has_references');
select pg_temp.t17c_assert(readiness ->> 'state' = 'draft' and (readiness ->> 'publicHistory')::boolean
  and not (readiness ->> 'deletable')::boolean, 'a draft that was public once keeps its history')
from public.admin_ip_delete_readiness('t17c-once') as readiness;
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-once')$q$, 'ip_has_public_history');
select pg_temp.t17c_assert(readiness ->> 'state' = 'published', 'published state reported')
from public.admin_ip_delete_readiness('t17c-live') as readiness;
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-live')$q$, 'ip_not_draft');
select pg_temp.t17c_assert(readiness ->> 'state' = 'archived' and not (readiness ->> 'publicHistory')::boolean, 'archived draft is not deletable')
from public.admin_ip_delete_readiness('t17c-archived') as readiness;
select pg_temp.t17c_expect($q$select public.admin_delete_draft_ip('t17c-archived')$q$, 'ip_not_draft');
reset role;
select pg_temp.t17c_assert(count(*) = 6, 'blocked IPs are untouched')
from public.ips where id in ('t17c-goods', 't17c-linked', 't17c-coupon', 't17c-follow', 't17c-once', 't17c-archived');
select pg_temp.t17c_assert(count(*) = 2, 'only the two successful deletions were audited')
from public.audit_log where action = 'catalog.ip.deleted' and target like 'ips:t17c-%';

-- ---------------------------------------------------------------------------
-- 5. 쿠폰 대상 IP: 이번 쓰기로 추가되는 대상은 지금 있는 IP여야 한다(삭제와의 경합은 *_concurrency.sh가 고정한다).
-- ---------------------------------------------------------------------------
select pg_temp.t17c_expect($q$insert into public.coupons(code, name, discount_type, discount_value, goods_scope, target_ip_ids)
  values ('T17C-GONE-COUPON', '지운 IP 쿠폰', 'fixed', 1000, 'selected_ips', array['t17c-alpha'])$q$, 'coupon_target_ip_unavailable');
select pg_temp.t17c_expect($q$update public.coupons set target_ip_ids = array['t17c-coupon', 't17c-alpha-2'] where code = 'T17C-IP-COUPON'$q$,
  'coupon_target_ip_unavailable');
update public.coupons set target_ip_ids = array['t17c-coupon', 't17c-goods'] where code = 'T17C-IP-COUPON';
-- A definition may keep a target it already had, even one that no longer exists (legacy rows); only new targets are checked.
insert into public.verticals(key, label, color) values ('t17c-test-2', 'T17c 테스트 2', '#222222') on conflict (key) do nothing;
insert into public.ips(id, title, vertical_key) values ('t17c-dangling', '사라질 IP', 't17c-test-2');
insert into public.coupons(code, name, discount_type, discount_value, goods_scope, target_ip_ids)
values ('T17C-DANGLING', '옛 대상 쿠폰', 'fixed', 1000, 'selected_ips', array['t17c-dangling']);
delete from public.ips where id = 't17c-dangling';
update public.coupons set target_ip_ids = target_ip_ids, name = '옛 대상 유지' where code = 'T17C-DANGLING';
update public.coupons set target_ip_ids = array['t17c-dangling', 't17c-goods'] where code = 'T17C-DANGLING';
select pg_temp.t17c_expect($q$update public.coupons set target_ip_ids = array['t17c-dangling', 't17c-goods', 't17c-alpha'] where code = 'T17C-DANGLING'$q$,
  'coupon_target_ip_unavailable');
select pg_temp.t17c_assert(target_ip_ids = array['t17c-dangling', 't17c-goods'] and name = '옛 대상 유지', 'kept targets survive, added ones are checked')
from public.coupons where code = 'T17C-DANGLING';

-- A direct (service) publish also records public history.
set local role service_role;
update public.ips set published_at = now() where id = 't17c-follow';
reset role;
select pg_temp.t17c_assert(exists (select 1 from private.ip_public_history where ip_id = 't17c-follow'), 'trigger records direct publishes');

rollback;
