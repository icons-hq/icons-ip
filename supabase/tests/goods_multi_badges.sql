\set ON_ERROR_STOP on
-- 상품 표시문구 여러 개(20261125140000): 목록·첫 값 거울·저장 래퍼·기본 칸 버전·복제·투영. 합성 데이터만 쓰고 끝에서 되돌린다.
begin;
create function pg_temp.badges_assert(p_ok boolean, p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%', p_message; end if; end $$;
create function pg_temp.badges_error(p_sql text, p_error text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then if position(p_error in sqlerrm) > 0 then return; end if; raise; end;
 raise exception 'Expected %', p_error; end $$;
create function pg_temp.badges_of(p_id text) returns text[] language sql as $$ select badges from public.goods where id = p_id $$;
create function pg_temp.badge_of(p_id text) returns text language sql as $$ select badge from public.goods where id = p_id $$;

-- 0. 표 제약·트리거·함수 봉인·투영 배선.
select pg_temp.badges_assert(exists(select 1 from pg_constraint where conrelid='public.goods'::regclass and conname='goods_badges_allowed')
  and exists(select 1 from pg_constraint where conrelid='public.goods'::regclass and conname='goods_badge_check'), 'badge constraints exist');
select pg_temp.badges_assert(exists(select 1 from pg_trigger where tgrelid='public.goods'::regclass and tgname='goods_badges_sync' and not tgisinternal),
  'badge sync trigger exists');
select pg_temp.badges_assert((select column_default = '''{}''::text[]' and is_nullable = 'NO' from information_schema.columns
  where table_schema='public' and table_name='goods' and column_name='badges'), 'badges is a not-null empty-default array');
select pg_temp.badges_assert(not has_function_privilege(role_name, fn, 'execute'), format('%s is sealed from %s', fn, role_name))
  from unnest(array['private.sync_goods_badges()', 'private.admin_save_good_before_badges(jsonb)',
    'private.create_goods_group_product_before_badges(text,uuid,text,uuid)', 'private.create_goods_group_product(text,uuid,text,uuid)']) fn
  cross join unnest(array['anon', 'authenticated', 'service_role']) role_name;
select pg_temp.badges_assert(has_function_privilege('authenticated', 'public.admin_save_good(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.admin_save_good(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_clone_good(uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_clone_good(uuid,text,text,text,text)', 'execute'), 'save and clone stay authenticated-only');
select pg_temp.badges_assert(exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid = to_regprocedure(c.signature)
  where c.signature = 'public.admin_save_good(jsonb)' and c.capability = 'catalog.manage' and c.body_md5 = md5(p.prosrc)), 'save wrapper contract re-registered');
select pg_temp.badges_assert(position('new.badges' in (select prosrc from pg_proc where oid='private.track_goods_base_revision()'::regprocedure)) > 0,
  'base revision watches badges');
select pg_temp.badges_assert(position('badges=source.badges' in (select prosrc from pg_proc where oid='public.admin_clone_good(uuid,text,text,text,text)'::regprocedure)) > 0,
  'clone copies the badge list');
select pg_temp.badges_assert(position('create_goods_group_product_before_badges' in (select prosrc from pg_proc where oid='private.create_goods_group_product(text,uuid,text,uuid)'::regprocedure)) > 0
  and position('badges = source.badges' in (select prosrc from pg_proc where oid='private.create_goods_group_product(text,uuid,text,uuid)'::regprocedure)) > 0,
  'group product creation copies the badge list');
select pg_temp.badges_assert(position($a$'badges',p_good.badges$a$ in (select prosrc from pg_proc where oid='private.category_display_public_good(public.goods,jsonb)'::regprocedure)) > 0,
  'category display projection carries badges');
select pg_temp.badges_assert(position($a$'badges',g.badges$a$ in (select prosrc from pg_proc where oid='public.get_shopping_story(uuid)'::regprocedure)) > 0,
  'public shopping story carries badges');
select pg_temp.badges_assert(position($a$'badges',p_good.badges$a$ in (select prosrc from pg_proc where oid='private.shopping_story_admin_good(public.goods,boolean,boolean)'::regprocedure)) > 0,
  'admin shopping story candidates carry badges');
select pg_temp.badges_assert((select position('array_to_string(goods.badges' in prosrc) > 0 and position('coalesce(goods.badge,' in prosrc) = 0
  from pg_proc where oid='public.search_public_content(text,integer)'::regprocedure), 'search matches every badge');

insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values
 ('b1250000-0000-4000-8000-000000000001','authenticated','authenticated','multi-badges-admin@example.test','{}',now(),now());
update public.profiles set role='admin',nickname='표시문구검증' where id='b1250000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('b1250000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values('b1250000-0000-4000-8000-000000000011','b1250000-0000-4000-8000-000000000001',now(),now());
insert into public.ips(id,title,vertical_key) values('multi-badges-tests','TEST 상품 표시문구','character');

-- 1. 동기화 트리거: 한 값만 아는 쓰기와 목록 쓰기가 서로를 맞춘다.
insert into public.goods(id,ip_id,name,price,stock,badge) values('badge-legacy','multi-badges-tests','TEST 옛 한 값',1000,'ok','NEW');
select pg_temp.badges_assert(pg_temp.badges_of('badge-legacy') = array['NEW'], 'legacy insert mirrors the single badge');
insert into public.goods(id,ip_id,name,price,stock,badges) values('badge-list','multi-badges-tests','TEST 목록',1000,'ok',array['EXCLUSIVE','NEW']);
select pg_temp.badges_assert(pg_temp.badge_of('badge-list') = 'EXCLUSIVE' and pg_temp.badges_of('badge-list') = array['EXCLUSIVE','NEW'], 'list insert sets the first-value mirror');
update public.goods set badges = array['NEW','EXCLUSIVE'] where id = 'badge-list';
select pg_temp.badges_assert(pg_temp.badge_of('badge-list') = 'NEW', 'reordering the list moves the mirror');
update public.goods set name = 'TEST 목록 이름만' where id = 'badge-list';
select pg_temp.badges_assert(pg_temp.badges_of('badge-list') = array['NEW','EXCLUSIVE'], 'unrelated update keeps the list');
update public.goods set badge = 'NEW' where id = 'badge-list';
select pg_temp.badges_assert(pg_temp.badges_of('badge-list') = array['NEW','EXCLUSIVE'], 'rewriting the same first value keeps later badges');
update public.goods set badge = 'EXCLUSIVE' where id = 'badge-list';
select pg_temp.badges_assert(pg_temp.badges_of('badge-list') = array['EXCLUSIVE'], 'a single-value writer that changes the first value replaces the list');
update public.goods set badge = null where id = 'badge-list';
select pg_temp.badges_assert(pg_temp.badges_of('badge-list') = '{}'::text[], 'clearing the single value clears the list');
select pg_temp.badges_error($q$update public.goods set badges = array['NEW','NEW'] where id = 'badge-list'$q$, 'goods_badges_duplicate');
select pg_temp.badges_error($q$update public.goods set badges = array['NEW','SALE'] where id = 'badge-list'$q$, 'goods_badges_allowed');
select pg_temp.badges_error($q$update public.goods set badges = array['NEW',null] where id = 'badge-list'$q$, 'goods_badges_allowed');
select pg_temp.badges_error($q$update public.goods set badges = '{{NEW},{EXCLUSIVE}}'::text[] where id = 'badge-list'$q$, 'goods_badges_allowed');

-- 투영: 카테고리 전시는 목록을 그대로 싣는다.
update public.goods set badges = array['EXCLUSIVE','NEW'] where id = 'badge-legacy';
select pg_temp.badges_assert((select private.category_display_public_good(g, '[]'::jsonb)->'badges' from public.goods g where g.id = 'badge-legacy')
  = '["EXCLUSIVE","NEW"]'::jsonb, 'category display projection lists badges in order');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1250000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b1250000-0000-4000-8000-000000000001","session_id":"b1250000-0000-4000-8000-000000000011","role":"authenticated"}',true);

create function pg_temp.badge_payload(p_id text, p_badges jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'previous_id', (select id from public.goods where id = p_id), 'ip_id', 'multi-badges-tests',
    'name', coalesce((select name from public.goods where id = p_id), 'TEST 표시문구'), 'price', 1000, 'badges', p_badges,
    'variant_baseline', coalesce((select jsonb_agg(v.id order by v.sort_order) from public.goods_variants v where v.good_id = p_id and v.archived_at is null), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'attributes', v.attributes, 'code', v.code,
      'extraPrice', 0, 'stockQty', v.stock_qty, 'expectedStockQty', v.stock_qty) order by v.sort_order)
      from public.goods_variants v where v.good_id = p_id and v.archived_at is null),
      '[{"name":"기본","attributes":{},"extraPrice":0,"stockQty":3}]'::jsonb))
$$;

-- 2. 저장 래퍼: 새 상품에 둘을 고른 순서대로 저장하고 첫 값 거울·감사가 남는다.
select public.admin_save_good(pg_temp.badge_payload('badge-a', '["EXCLUSIVE","NEW"]'));
select pg_temp.badges_assert(pg_temp.badges_of('badge-a') = array['EXCLUSIVE','NEW'] and pg_temp.badge_of('badge-a') = 'EXCLUSIVE', 'new good saves badges in order');
reset role;
select pg_temp.badges_assert(exists(select 1 from public.audit_log where action = 'admin.good.badges_saved' and target = 'goods:badge-a'
  and diff = '{"before":[],"after":["EXCLUSIVE","NEW"]}'::jsonb), 'badge change is audited');
set local role authenticated;

-- 3. 순서만 바꾸거나 둘째 값만 빼도 기본 칸 버전이 오른다(옛 화면이 되돌리지 못한다).
select base_revision as rev0 from public.goods where id = 'badge-a' \gset
select public.admin_save_good(pg_temp.badge_payload('badge-a', '["NEW","EXCLUSIVE"]'));
select pg_temp.badges_assert(pg_temp.badges_of('badge-a') = array['NEW','EXCLUSIVE'] and pg_temp.badge_of('badge-a') = 'NEW', 'reorder saves and moves the mirror');
select base_revision as rev1 from public.goods where id = 'badge-a' \gset
select pg_temp.badges_assert(:rev1 > :rev0, 'reorder bumps the base revision');
select public.admin_save_good(pg_temp.badge_payload('badge-a', '["NEW"]'));
select pg_temp.badges_assert(pg_temp.badges_of('badge-a') = array['NEW'] and pg_temp.badge_of('badge-a') = 'NEW', 'dropping a later badge keeps the first');
select base_revision as rev2 from public.goods where id = 'badge-a' \gset
select pg_temp.badges_assert(:rev2 > :rev1, 'dropping only a later badge bumps the base revision');
select public.admin_save_good(pg_temp.badge_payload('badge-a', '["NEW"]') || jsonb_build_object('base_expected_revision', :rev2));
select pg_temp.badges_assert((select base_revision from public.goods where id = 'badge-a') = :rev2, 'unchanged badges keep the base revision');
select pg_temp.badges_error(format('select public.admin_save_good(%L::jsonb)',
  (pg_temp.badge_payload('badge-a', '["NEW","EXCLUSIVE"]') || jsonb_build_object('base_expected_revision', :rev1))::text), 'goods_base_changed');

-- 4. 목록 없이 첫 값만 보내는 옛 저장: 첫 값이 같으면 둘째 값부터 그대로, 바꾸면 그 하나다.
select public.admin_save_good(pg_temp.badge_payload('badge-a', '["NEW","EXCLUSIVE"]'));
select public.admin_save_good(pg_temp.badge_payload('badge-a', '[]') - 'badges' || '{"badge":"NEW"}');
select pg_temp.badges_assert(pg_temp.badges_of('badge-a') = array['NEW','EXCLUSIVE'], 'legacy save with the same first value keeps later badges');
select public.admin_save_good(pg_temp.badge_payload('badge-a', '[]') - 'badges' || '{"badge":"EXCLUSIVE"}');
select pg_temp.badges_assert(pg_temp.badges_of('badge-a') = array['EXCLUSIVE'], 'legacy save with a new first value replaces the list');

-- 5. 형식·값 오류는 저장 전체를 되돌린다.
select public.admin_save_good(pg_temp.badge_payload('badge-a', '["EXCLUSIVE","NEW"]'));
select pg_temp.badges_error(format('select public.admin_save_good(%L::jsonb)', pg_temp.badge_payload('badge-a', '"NEW"')::text), 'goods_badges_invalid');
select pg_temp.badges_error(format('select public.admin_save_good(%L::jsonb)', pg_temp.badge_payload('badge-a', '["NEW",1]')::text), 'goods_badges_invalid');
select pg_temp.badges_error(format('select public.admin_save_good(%L::jsonb)', pg_temp.badge_payload('badge-a', '[null]')::text), 'goods_badges_invalid');
select pg_temp.badges_error(format('select public.admin_save_good(%L::jsonb)',
  (pg_temp.badge_payload('badge-a', '["NEW","EXCLUSIVE"]') || '{"badge":"EXCLUSIVE"}')::text), 'goods_badges_invalid');
select pg_temp.badges_error(format('select public.admin_save_good(%L::jsonb)', pg_temp.badge_payload('badge-a', '["NEW","NEW"]')::text), 'goods_badges_duplicate');
-- 첫 값이 표준 값이 아니면 첫 값 칸(goods_badge_check)·목록(goods_badges_allowed) 제약 중 하나가 거절한다.
select pg_temp.badges_error(format('select public.admin_save_good(%L::jsonb)', pg_temp.badge_payload('badge-a', '["SALE"]')::text), 'violates check constraint "goods_badge');
select pg_temp.badges_error(format('select public.admin_save_good(%L::jsonb)', pg_temp.badge_payload('badge-a', '["NEW","SALE"]')::text), 'goods_badges_allowed');
select pg_temp.badges_assert(pg_temp.badges_of('badge-a') = array['EXCLUSIVE','NEW'] and pg_temp.badge_of('badge-a') = 'EXCLUSIVE', 'failed saves keep the list');
-- 첫 값 칸을 함께 보내도 목록의 첫 값과 같으면 저장한다(SQL 내부 경로의 to_jsonb(goods) 모양).
select public.admin_save_good(pg_temp.badge_payload('badge-a', '["NEW","EXCLUSIVE"]') || '{"badge":"NEW"}');
select pg_temp.badges_assert(pg_temp.badges_of('badge-a') = array['NEW','EXCLUSIVE'], 'matching mirror is accepted');

-- 6. 복제는 목록 전체를 같은 순서로 복사한다.
select public.admin_clone_good('b1250000-0000-4000-8000-000000000020','badge-a','badge-a-copy','BADGE-COPY','TEST 표시문구 복사');
select pg_temp.badges_assert(pg_temp.badges_of('badge-a-copy') = array['NEW','EXCLUSIVE'] and pg_temp.badge_of('badge-a-copy') = 'NEW', 'clone copies every badge in order');

-- 7. 빈 목록은 둘 다 비운다.
select public.admin_save_good(pg_temp.badge_payload('badge-a', '[]'));
select pg_temp.badges_assert(pg_temp.badges_of('badge-a') = '{}'::text[] and pg_temp.badge_of('badge-a') is null, 'empty list clears both');

rollback;
