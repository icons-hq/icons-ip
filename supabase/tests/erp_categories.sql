\set ON_ERROR_STOP on

-- 카탈로그 분류 = ERP 기준 (마이그레이션 20260909140000): 시드 · 잠금 · 자체 분류 자리 · 유형 파생 · 엑셀 열 · 동기화

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000008c1', 'authenticated', 'authenticated', 'erpcat-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000008c2', 'authenticated', 'authenticated', 'erpcat-member@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000008c1', 'erpcat-staff@example.test', 'erpcat_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-0000000008c2', 'erpcat-member@example.test', 'erpcat_member', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role;

insert into public.verticals (key, label, color) values ('erpcat-test', 'ERP 분류 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('erpcat-ip', 'ERP 분류 테스트 IP', 'erpcat-test') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('erpcat-g1', 'erpcat-ip', 'ERP 분류 굿즈', '아크릴', 12000, 'ok', 10)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A. 시드 — ERP 제상품 분류 350 노드(대 8 · 중 52 · 소 290), 경로·순서
-- ---------------------------------------------------------------------------
select 1 / case when (
  (select count(*) from public.categories where source = 'erp') = 350
  and (select count(*) from public.categories where source = 'erp' and depth = 1) = 8
  and (select count(*) from public.categories where source = 'erp' and depth = 2) = 52
  and (select count(*) from public.categories where source = 'erp' and depth = 3) = 290
  and (select path from public.categories where erp_key = '문구 > 노트 > 스프링노트') = '/erp-02/erp-02-02/erp-02-02-01/'
  and (select position from public.categories where erp_key = '패션') = 4
  and (select count(*) from public.categories where source = 'erp' and (kind <> 'catalog' or erp_key is null)) = 0
) then 1 else 0 end as assert_erp_seed;

select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_sync_erp_categories(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.admin_sync_erp_categories(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_sync_erp_categories(jsonb)', 'execute')
) then 1 else 0 end as assert_erp_sync_acl;

-- ---------------------------------------------------------------------------
-- B. 잠금 — 정체(이름·부모·순서·삭제)는 플래그 없이는 postgres 도 못 바꾼다. 진열 설정은 열려 있다.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.categories set name = '문구(바꿈)' where erp_key = '문구';
  raise exception 'renaming an erp node must fail';
exception when check_violation then
  if sqlerrm <> 'category_erp_locked' then raise; end if;
end $$;
do $$
begin
  delete from public.categories where erp_key = '가공품 > 가공품 > 가공품';
  raise exception 'deleting an erp node must fail';
exception when check_violation then
  if sqlerrm <> 'category_erp_locked' then raise; end if;
end $$;
do $$
begin
  insert into public.categories (id, kind, parent_id, name, path, depth, position, source, erp_key)
  values ('erpcat-fake', 'catalog', null, '가짜', '', 1, 0, 'erp', 'X > 가짜');
  raise exception 'inserting an erp node without the sync flag must fail';
exception when check_violation then
  if sqlerrm <> 'category_erp_locked' then raise; end if;
end $$;
update public.categories set display_mode = 'auto', include_descendants = false, seo_title = '키링 모음' where erp_key = '패션 > 키링';
select 1 / case when (
  (select display_mode || ':' || include_descendants::text || ':' || seo_title from public.categories where erp_key = '패션 > 키링') = 'auto:false:키링 모음'
) then 1 else 0 end as assert_erp_display_settings_stay_open;
update public.categories set display_mode = 'manual', include_descendants = true, seo_title = null where erp_key = '패션 > 키링';

-- ---------------------------------------------------------------------------
-- C. 스태프 RPC — 일반 회원 거부 · ERP 노드 이름은 폼이 보내도 안 바뀜 · 옮기기/재정렬/보관 거부
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000008c2', true);
do $$
begin
  perform public.admin_sync_erp_categories('[{"id":"x","key":"x","parentKey":null,"name":"x","level":1,"position":0}]'::jsonb);
  raise exception 'member must not sync';
exception when insufficient_privilege then null;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000008c1', true);
do $$
declare
  v_id text;
begin
  select id into v_id from public.categories where erp_key = '패션 > 키링';
  perform public.admin_upsert_category(v_id, '키링(바꿈)', null, 'catalog', '설명', 'active', false, 'auto', 'name', true, false, null, 'SEO', null, v_id);
  if (select name from public.categories where id = v_id) <> '키링' then
    raise exception 'erp node name must not change through the form';
  end if;
  if (select display_mode || ':' || include_descendants::text || ':' || coalesce(seo_title, '') from public.categories where id = v_id) <> 'auto:false:SEO' then
    raise exception 'display settings must apply to an erp node';
  end if;
  perform public.admin_upsert_category(v_id, '키링', null, 'catalog', null, 'active', false, 'manual', 'newest', true, true, null, null, null, v_id);
end $$;
do $$
begin
  perform public.admin_move_category('erp-05-37-02', 'erp-02');
  raise exception 'moving an erp node must fail';
exception when check_violation then
  if sqlerrm <> 'category_erp_locked' then raise; end if;
end $$;
do $$
declare
  v_ids text[];
begin
  select array_agg(id order by position desc, id) into v_ids from public.categories where parent_id = 'erp-05';
  perform public.admin_reorder_categories('erp-05', v_ids);
  raise exception 'reordering erp siblings must fail';
exception when check_violation then
  if sqlerrm <> 'category_erp_locked' then raise; end if;
end $$;
do $$
begin
  perform public.admin_archive_category('erp-01');
  raise exception 'archiving an erp node must fail';
exception when check_violation then
  if sqlerrm <> 'category_erp_locked' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- D. 자체 분류 — ERP 잎(소분류) 아래 4단째만. 기획전은 자유. 옮기기도 ERP 잎 사이에서만.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.admin_upsert_category('erpcat-root', '자체 최상위');
  raise exception 'store root must fail';
exception when check_violation then
  if sqlerrm <> 'category_catalog_under_erp_leaf' then raise; end if;
end $$;
do $$
begin
  perform public.admin_upsert_category('erpcat-mid', '자체 중간', 'erp-03-14');
  raise exception 'store node under a non-leaf erp node must fail';
exception when check_violation then
  if sqlerrm <> 'category_catalog_under_erp_leaf' then raise; end if;
end $$;
select public.admin_upsert_category('erpcat-acrylic-stand', '아크릴 스탠드', 'erp-03-14-09');
select 1 / case when (
  (select path || ':' || depth || ':' || source from public.categories where id = 'erpcat-acrylic-stand')
    = '/erp-03/erp-03-14/erp-03-14-09/erpcat-acrylic-stand/:4:store'
) then 1 else 0 end as assert_store_leaf_under_erp_leaf;
do $$
begin
  perform public.admin_upsert_category('erpcat-deeper', '더 아래', 'erpcat-acrylic-stand');
  raise exception 'store node under a store node must fail';
exception when check_violation then
  if sqlerrm <> 'category_catalog_under_erp_leaf' then raise; end if;
end $$;
select public.admin_upsert_category('erpcat-season', '시즌 기획전', null, 'collection');
select 1 / case when (select kind || ':' || source from public.categories where id = 'erpcat-season') = 'collection:store'
  then 1 else 0 end as assert_collection_still_free;

select public.admin_move_category('erpcat-acrylic-stand', 'erp-05-37-02');
select 1 / case when (select path from public.categories where id = 'erpcat-acrylic-stand') = '/erp-05/erp-05-37/erp-05-37-02/erpcat-acrylic-stand/'
  then 1 else 0 end as assert_store_leaf_moves_between_erp_leaves;
do $$
begin
  perform public.admin_move_category('erpcat-acrylic-stand', 'erp-05-37');
  raise exception 'moving a store leaf under a non-leaf erp node must fail';
exception when check_violation then
  if sqlerrm <> 'category_catalog_under_erp_leaf' then raise; end if;
end $$;
select public.admin_move_category('erpcat-acrylic-stand', 'erp-03-14-09');

select public.admin_upsert_category('erpcat-acrylic-block', '아크릴 블록', 'erp-03-14-09');
select public.admin_reorder_categories('erp-03-14-09', array['erpcat-acrylic-block', 'erpcat-acrylic-stand']);
select 1 / case when (
  (select position from public.categories where id = 'erpcat-acrylic-block') = 0
  and (select position from public.categories where id = 'erpcat-acrylic-stand') = 1
) then 1 else 0 end as assert_store_siblings_reorder;

-- ---------------------------------------------------------------------------
-- E. 유형 파생 — 대표 분류가 키링/파우치/쿠션/인형/피규어/문구 아래면 goods.type 을 맞춘다. 매핑 없으면 그대로.
-- ---------------------------------------------------------------------------
select public.admin_set_good_categories('erpcat-g1', 'erp-05-37-02', array['erp-05-37-02']);
select 1 / case when (select type from public.goods where id = 'erpcat-g1') = '키링' then 1 else 0 end as assert_type_derived_keyring;
select public.admin_set_good_categories('erpcat-g1', 'erp-03-51-02', array['erp-03-51-02']);
select 1 / case when (select type from public.goods where id = 'erpcat-g1') = '피규어' then 1 else 0 end as assert_type_derived_figure;
select public.admin_set_good_categories('erpcat-g1', 'erpcat-acrylic-stand', array['erpcat-acrylic-stand']);
select 1 / case when (select type from public.goods where id = 'erpcat-g1') = '피규어' then 1 else 0 end as assert_type_kept_when_unmapped;
select public.admin_set_good_categories('erpcat-g1', 'erp-02-02-01', array['erp-02-02-01']);
select 1 / case when (select type from public.goods where id = 'erpcat-g1') = '문구' then 1 else 0 end as assert_type_derived_stationery;

-- ---------------------------------------------------------------------------
-- F. ERP 품목 등록 엑셀 — 분류 열 셋은 대표 분류의 ERP 조상(자체 4단 분류라도)
-- ---------------------------------------------------------------------------
select public.admin_set_good_categories('erpcat-g1', 'erpcat-acrylic-stand', array['erpcat-acrylic-stand']);
reset role;
do $$
declare
  v_tpl uuid;
  v_row jsonb;
begin
  select id into v_tpl from public.export_templates where key = 'erp_goods';
  select row_data into v_row
  from private.export_rows(v_tpl, '{"ip_id":"erpcat-ip","include_archived":true}'::jsonb, null, 10, true)
  where row_data->>'good_id' = 'erpcat-g1';
  if v_row is null then raise exception 'export row missing'; end if;
  if v_row->>'category_l1' <> '리빙' or v_row->>'category_l2' <> '홈데코' or v_row->>'category_l3' <> '장식소품' then
    raise exception 'export category columns must be erp ancestors, got % / % / %',
      v_row->>'category_l1', v_row->>'category_l2', v_row->>'category_l3';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- G. 동기화 — 같은 목록은 0/0/0 · 사라진 노드는 숨김+표시 · 이름 바뀜 반영 · 돌아오면 표시 해제 · 새 노드 추가
-- ---------------------------------------------------------------------------
do $$
declare
  v_payload jsonb;
  v_result record;
begin
  select jsonb_agg(jsonb_build_object(
      'id', child.id, 'key', child.erp_key, 'parentKey', parent.erp_key,
      'name', child.name, 'level', child.depth, 'position', child.position))
    into v_payload
  from public.categories as child
  left join public.categories as parent on parent.id = child.parent_id
  where child.source = 'erp';

  select sync.inserted, sync.updated, sync.removed into v_result from private.sync_erp_categories(v_payload) as sync;
  if v_result.inserted <> 0 or v_result.updated <> 0 or v_result.removed <> 0 then
    raise exception 'resync of the same list must change nothing, got %', v_result;
  end if;

  select jsonb_agg(case when item->>'key' = '문구 > 노트 > 스프링노트' then item || '{"name":"스프링 노트"}'::jsonb else item end)
    into v_payload
  from jsonb_array_elements(v_payload) as item
  where item->>'key' <> '패션 > 키링 > 아크릴키링';
  select sync.inserted, sync.updated, sync.removed into v_result from private.sync_erp_categories(v_payload) as sync;
  if v_result.inserted <> 0 or v_result.updated <> 1 or v_result.removed <> 1 then
    raise exception 'sync counts wrong: %', v_result;
  end if;
  if (select erp_removed_at is null or status <> 'hidden' from public.categories where erp_key = '패션 > 키링 > 아크릴키링') then
    raise exception 'a node missing from the list must be hidden and flagged';
  end if;
  if (select name from public.categories where erp_key = '문구 > 노트 > 스프링노트') <> '스프링 노트' then
    raise exception 'a renamed node must update';
  end if;
  if (select count(*) from public.good_categories where category_id = 'erpcat-acrylic-stand') <> 1 then
    raise exception 'memberships must survive a sync';
  end if;

  v_payload := v_payload || jsonb_build_array(
    jsonb_build_object('id', 'erp-05-37-02', 'key', '패션 > 키링 > 아크릴키링', 'parentKey', '패션 > 키링', 'name', '아크릴키링', 'level', 3, 'position', 1),
    jsonb_build_object('id', 'erp-05-37-99', 'key', '패션 > 키링 > 아크릴스탠드', 'parentKey', '패션 > 키링', 'name', '아크릴스탠드', 'level', 3, 'position', 98));
  select sync.inserted, sync.updated, sync.removed into v_result from private.sync_erp_categories(v_payload) as sync;
  if v_result.inserted <> 1 or v_result.removed <> 0 then
    raise exception 'sync counts wrong after return: %', v_result;
  end if;
  if (select erp_removed_at is not null from public.categories where erp_key = '패션 > 키링 > 아크릴키링') then
    raise exception 'a returned node must clear the flag';
  end if;
  if (select path from public.categories where erp_key = '패션 > 키링 > 아크릴스탠드') <> '/erp-05/erp-05-37/erp-05-37-99/' then
    raise exception 'a new node must get the erp path';
  end if;
end $$;
do $$
begin
  perform private.sync_erp_categories('[]'::jsonb);
  raise exception 'empty payload must fail';
exception when invalid_parameter_value then null;
end $$;
do $$
begin
  perform private.sync_erp_categories('[{"id":"erp-x","key":"없는 > 부모","parentKey":"없는","name":"부모","level":2,"position":0}]'::jsonb);
  raise exception 'missing parent must fail';
exception when no_data_found then null;
end $$;
-- 동기화가 끝나면 플래그가 내려가 있어야 한다.
do $$
begin
  update public.categories set name = '문구(바꿈)' where erp_key = '문구';
  raise exception 'lock must be back after sync';
exception when check_violation then
  if sqlerrm <> 'category_erp_locked' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- H. RLS — ERP 노드도 숨기면 anon 에게 안 보인다(표시 상태는 우리 몫)
-- ---------------------------------------------------------------------------
update public.categories set status = 'hidden' where id = 'erp-01';
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select 1 / case when (
  (select count(*) from public.categories where id = 'erp-01') = 0
  and (select count(*) from public.categories where id = 'erp-02') = 1
) then 1 else 0 end as assert_hidden_erp_node_is_invisible_to_anon;
reset role;

rollback;
