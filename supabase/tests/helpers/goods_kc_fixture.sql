-- TEST-ONLY, connection-local helper. Prepend this file to a SQL regression file
-- in the same psql stdin. Never include it in migrations, seed.sql, or a deployed
-- schema. It uses the real review RPC and creates explicit synthetic evidence;
-- it does not disable a trigger, alter a policy, or add a production bypass.
create or replace function pg_temp.review_goods_kc_fixture(p_good_id text) returns void
language plpgsql security definer set search_path='' as $$
declare previous_actor text:=current_setting('request.jwt.claim.sub',true); config jsonb; models jsonb;
  fixture_actor uuid:=('47c47700'||left(md5(p_good_id),24))::uuid;
begin
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
declare fixture_actor uuid:=('47c47700'||left(md5(p_good_id),24))::uuid;
begin
  if exists(select 1 from private.goods_kc_review_events event cross join lateral jsonb_array_elements(event.snapshot->'models') model
    where event.good_id=p_good_id and coalesce(model#>>'{evidence,applicability}','') not like 'TEST-ONLY:%') then
    raise exception 'Refusing to remove non-synthetic KC evidence';
  end if;
  update public.goods set published_at=null where id=p_good_id;
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
