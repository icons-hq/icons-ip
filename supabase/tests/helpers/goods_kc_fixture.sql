-- TEST-ONLY, connection-local helper. Prepend this file to a SQL regression file
-- in the same psql stdin. Never include it in migrations, seed.sql, or a deployed
-- schema. It uses the real review RPC and creates explicit synthetic evidence;
-- it does not disable a trigger, alter a policy, or add a production bypass.
-- SHEET-003(ADR-0037): 상품 유형은 대표 카테고리(없으면 가까운 상위)에 연결한 값이고, 연결이 없으면 운영자
-- 공개(set_good_published)가 거절한다. 카테고리 없이 유형만 직접 넣은 합성 상품을 그 유형이 연결된 합성 카테고리에
-- 붙여 공개 경로를 그대로 지나게 한다. 유형은 바뀌지 않고(연결값 = 저장된 유형), 이미 카테고리가 있거나 그룹 상품이면
-- 건드리지 않는다(카테고리 시험의 의미를 바꾸지 않는다).
create or replace function pg_temp.link_goods_type_category_fixture(p_good_id text) returns void
language plpgsql security definer set search_path='' as $$
declare good public.goods; fixture_category uuid;
begin
  select * into good from public.goods where id=p_good_id;
  if not found or good.category_id is not null or coalesce(good.type,'')=''
    or exists(select 1 from private.goods_group_members where good_id=p_good_id) then return; end if;
  fixture_category:=('47c47701'||left(md5('goods-type-fixture:'||good.type),24))::uuid;
  insert into public.catalog_categories(id,code,name,depth,sort_order,good_type)
    values(fixture_category,'test-type-'||left(md5('goods-type-fixture:'||good.type),12),'TEST-ONLY 상품 유형 '||good.type,1,0,good.type)
    on conflict (id) do nothing;
  update public.goods set category_id=fixture_category where id=p_good_id;
end $$;

create or replace function pg_temp.review_goods_kc_fixture(p_good_id text) returns void
language plpgsql security definer set search_path='' as $$
declare previous_actor text:=current_setting('request.jwt.claim.sub',true); config jsonb; models jsonb;
  fixture_actor uuid:=('47c47700'||left(md5(p_good_id),24))::uuid;
begin
  perform pg_temp.link_goods_type_category_fixture(p_good_id);
  if exists(select 1 from auth.users where id=fixture_actor and raw_app_meta_data->>'testFixture' is distinct from 'goods-kc') then
    raise exception 'KC test reviewer identity collision';
  end if;
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(fixture_actor,'authenticated','authenticated','kc-synthetic-'||md5(p_good_id)||'@example.test',now(),
      '{"testFixture":"goods-kc"}','{}',now(),now())
    on conflict(id) do nothing;
  update public.profiles set role='staff',nickname='KC합성'||left(md5(p_good_id),12),suspended_at=null where id=fixture_actor;
  perform set_config('request.jwt.claim.sub',fixture_actor::text,true);
  config:=public.admin_read_goods_kc(p_good_id);
  if config->>'publishedAt' is not null then
    raise exception 'KC fixture review needs a draft first: %',p_good_id;
  end if;
  models:=jsonb_build_array(jsonb_build_object(
    'family','other','scheme','not_applicable','productCategory','자동검증 합성자료',
    'modelName','TEST-ONLY:'||left(p_good_id,150),'businessRole','manufacturer','businessName','자동검증 전용 합성 사업자',
    'identifier','','publicNote','자동검증 전용 합성 고시이며 실제 판매 제품의 KC 적합성을 나타내지 않습니다.',
    'variantIds',(select coalesce(jsonb_agg(variant.id::text order by variant.id),'[]') from public.goods_variants variant where variant.good_id=p_good_id),
    'basis','자동검증용 합성 fixture. 실제 제품의 적용성 또는 적합성을 판정하지 않습니다.',
    'evidence',jsonb_build_object('applicability','TEST-ONLY:fixtures/'||left(p_good_id,150),'certificate','','testReport','','declaration','')));
  perform public.admin_save_goods_kc(p_good_id,models,'reviewed',(config->>'revision')::integer,config->>'contextFingerprint',true);
  perform set_config('request.jwt.claim.sub',coalesce(previous_actor,''),true);
exception when others then
  perform set_config('request.jwt.claim.sub',coalesce(previous_actor,''),true);
  raise;
end $$;

-- Committed concurrency fixtures need targeted cleanup after the sessions end.
-- This refuses to delete a review containing evidence outside the test prefix.
create or replace function pg_temp.cleanup_goods_kc_fixture(p_good_id text) returns void
language plpgsql security definer set search_path='' as $$
declare fixture_actor uuid:=('47c47700'||left(md5(p_good_id),24))::uuid; fixture_category uuid;
begin
  if exists(select 1 from private.goods_kc_review_events event cross join lateral jsonb_array_elements(event.snapshot->'models') model
    where event.good_id=p_good_id and coalesce(model#>>'{evidence,applicability}','') not like 'TEST-ONLY:%') then
    raise exception 'Refusing to remove non-synthetic KC evidence';
  end if;
  update public.goods set published_at=null where id=p_good_id;
  -- link_goods_type_category_fixture가 붙인 합성 유형 카테고리도 걷는다. 커밋하는 경합 시험이 남기면 뒤 시험이 세는
  -- 공개 카테고리 수가 바뀐다(레거시 스모크 sales_category_hierarchy). 다른 상품이 아직 쓰면 그대로 둔다.
  select category_id into fixture_category from public.goods where id=p_good_id;
  if fixture_category is not null and left(fixture_category::text,8)='47c47701' then
    update public.goods set category_id=null where id=p_good_id;
    delete from public.catalog_categories c where c.id=fixture_category
      and not exists(select 1 from public.goods g where g.category_id=c.id);
  end if;
  delete from private.goods_kc_review_events where good_id=p_good_id;
  delete from private.goods_kc_reviews where good_id=p_good_id;
  delete from public.audit_log where target='goods:'||p_good_id and action in ('admin.good.kc_saved','admin.good.kc_invalidated');
  delete from public.notifications where user_id=fixture_actor;
  delete from auth.users where id=fixture_actor and raw_app_meta_data->>'testFixture'='goods-kc';
end $$;

-- A convenience for test setup only. The public-row trigger still verifies the
-- review; application publication itself is exercised in goods_kc_compliance.sql.
create or replace function pg_temp.publish_goods_kc_fixture(p_good_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_temp.review_goods_kc_fixture(p_good_id);
  update public.goods set published_at=clock_timestamp() where id=p_good_id;
end $$;
