\set ON_ERROR_STOP on
-- 긴 상세 이미지 여러 장(20261119170100)과 업로드 확인 거절 사유(20261119170000). 합성 데이터만 쓰고 끝에서 되돌린다.
begin;
create function pg_temp.detail_assert(p_ok boolean, p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%', p_message; end if; end $$;
create function pg_temp.detail_error(p_sql text, p_error text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then if position(p_error in sqlerrm) > 0 then return; end if; raise; end;
 raise exception 'Expected %', p_error; end $$;
create function pg_temp.detail_path(n integer) returns text language sql immutable as $$
  select 'public-media/catalog/good/00000000-0000-4000-8000-0000001119'||lpad(n::text,2,'0')||'.png'
$$;
create function pg_temp.detail_paths(p_id text) returns text[] language sql as $$ select detail_image_paths from public.goods where id = p_id $$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values
 ('d1190000-0000-4000-8000-000000000001','authenticated','authenticated','detail-images-admin@example.test','{}',now(),now());
update public.profiles set role='admin',nickname='상세이미지검증' where id='d1190000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('d1190000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values('d1190000-0000-4000-8000-000000000011','d1190000-0000-4000-8000-000000000001',now(),now());
insert into public.ips(id,title,vertical_key) values('detail-images-tests','TEST 긴 상세 이미지','character');

-- 표 제약·동기화 트리거·소유 검사 트리거의 감시 칸.
select pg_temp.detail_assert((select pg_get_constraintdef(oid) from pg_constraint
  where conrelid='public.goods'::regclass and conname='goods_detail_image_paths_limit')
  = 'CHECK ((COALESCE(array_length(detail_image_paths, 1), 0) <= 10))', 'detail image limit is ten');
select pg_temp.detail_assert(pg_get_triggerdef((select oid from pg_trigger where tgrelid='public.goods'::regclass and tgname='enforce_admin_goods_content_artwork_claim'))
  like '%detail_image_paths%', 'content artwork claim trigger watches detail_image_paths');

-- 1. 한 장만 아는 쓰기(직접 insert)는 목록을 그 한 장으로 맞춘다.
insert into public.goods(id,ip_id,name,price,stock,detail_image_path)
  values('detail-legacy','detail-images-tests','TEST 옛 한 장',1000,'ok','public-media/goods-detail-legacy/one.png');
select pg_temp.detail_assert(pg_temp.detail_paths('detail-legacy') = array['public-media/goods-detail-legacy/one.png'], 'legacy insert mirrors the single path');

-- 업로드 확인을 마친 이미지 7장(1~7). 확인은 운영자별로 한 장씩 차례로 진행된다.
set local role service_role;
do $$
declare n integer; claim_path text;
begin
  for n in 1..7 loop
    claim_path := substring(pg_temp.detail_path(n) from length('public-media/')+1);
    if not public.service_prepare_admin_artwork_upload('d1190000-0000-4000-8000-000000000001',claim_path,'good','image/png',4_431_981,now()+interval '10 minutes')
      or not exists(select 1 from public.service_begin_admin_artwork_verification('d1190000-0000-4000-8000-000000000001',claim_path))
      or not public.service_verify_admin_artwork_upload('d1190000-0000-4000-8000-000000000001',claim_path,5_130_000,1000,9067)
    then raise exception 'claim % not verified', n; end if;
  end loop;
end $$;

-- 거절 사유 기록: service_role만 부르고, 처음 남긴 이유를 덮지 않는다.
select public.service_prepare_admin_artwork_upload('d1190000-0000-4000-8000-000000000001','catalog/good/00000000-0000-4000-8000-000000111990.jpg','good','image/jpeg',7_302_758,now()+interval '10 minutes');
select pg_temp.detail_assert(public.service_reject_admin_artwork_upload('d1190000-0000-4000-8000-000000000001','catalog/good/00000000-0000-4000-8000-000000111990.jpg',
  'format_mismatch','{"declared":"image/jpeg","detected":"png","width":1000,"height":11131}'::jsonb), 'reject with reason');
select pg_temp.detail_assert(public.service_reject_admin_artwork_upload('d1190000-0000-4000-8000-000000000001','catalog/good/00000000-0000-4000-8000-000000111990.jpg',
  'unexpected_error','{}'::jsonb), 'repeated reject still succeeds');
select pg_temp.detail_assert(public.service_reject_admin_artwork_upload('d1190000-0000-4000-8000-000000000001','catalog/good/00000000-0000-4000-8000-000000111990.jpg'), 'two-argument reject still works');
select pg_temp.detail_error($q$select public.service_reject_admin_artwork_upload('d1190000-0000-4000-8000-000000000001','catalog/good/00000000-0000-4000-8000-000000111990.jpg','Bad Reason','{}'::jsonb)$q$, 'invalid_artwork_reject_reason');
select pg_temp.detail_error($q$select public.service_reject_admin_artwork_upload('d1190000-0000-4000-8000-000000000001','catalog/good/00000000-0000-4000-8000-000000111990.jpg','decode_failed','[1]'::jsonb)$q$, 'invalid_artwork_reject_reason');
reset role;
select pg_temp.detail_assert((select status='rejected' and reject_reason='format_mismatch' and reject_detail->>'detected'='png'
  from public.admin_artwork_upload_claims where path='catalog/good/00000000-0000-4000-8000-000000111990.jpg'), 'first reject reason is kept');
select pg_temp.detail_assert(has_function_privilege('service_role','public.service_reject_admin_artwork_upload(uuid,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.service_reject_admin_artwork_upload(uuid,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.service_reject_admin_artwork_upload(uuid,text,text,jsonb)','execute'), 'reject reason function is service-only');

set local role authenticated;
select set_config('request.jwt.claim.sub','d1190000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"d1190000-0000-4000-8000-000000000001","session_id":"d1190000-0000-4000-8000-000000000011","role":"authenticated"}',true);

create function pg_temp.detail_payload(p_id text, p_paths text[]) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'previous_id', (select id from public.goods where id = p_id), 'ip_id', 'detail-images-tests',
    'name', coalesce((select name from public.goods where id = p_id), 'TEST 긴 상세 이미지'), 'price', 1000,
    'detail_image_path', p_paths[1], 'detail_image_paths', to_jsonb(p_paths),
    'variant_baseline', coalesce((select jsonb_agg(v.id order by v.sort_order) from public.goods_variants v where v.good_id = p_id and v.archived_at is null), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'attributes', v.attributes, 'code', v.code,
      'extraPrice', 0, 'stockQty', v.stock_qty, 'expectedStockQty', v.stock_qty) order by v.sort_order)
      from public.goods_variants v where v.good_id = p_id and v.archived_at is null),
      '[{"name":"기본","attributes":{},"extraPrice":0,"stockQty":3}]'::jsonb))
$$;

-- 2. 새 상품에 세 장: 순서대로 저장되고, 첫 장 거울·claim 연결·감사가 남는다.
select public.admin_save_good(pg_temp.detail_payload('detail-a', array[pg_temp.detail_path(1), pg_temp.detail_path(2), pg_temp.detail_path(3)]));
select pg_temp.detail_assert(pg_temp.detail_paths('detail-a') = array[pg_temp.detail_path(1), pg_temp.detail_path(2), pg_temp.detail_path(3)]
  and (select detail_image_path from public.goods where id='detail-a') = pg_temp.detail_path(1), 'new good saves three detail images in order');
reset role;
select pg_temp.detail_assert((select count(*) from public.admin_artwork_upload_claims where status='attached'
  and path in (select substring(pg_temp.detail_path(n) from 14) from generate_series(1,3) n)) = 3, 'all three claims attached');
select pg_temp.detail_assert(exists(select 1 from public.audit_log where action='admin.good.detail_images_saved' and target='goods:detail-a'
  and jsonb_array_length(diff->'after') = 3), 'detail image change is audited');
set local role authenticated;

-- 3. 순서 바꾸기·빼기: 이미 붙은 이미지라 claim을 다시 요구하지 않고, 첫 장 거울과 기본 칸 버전이 따라간다.
select base_revision as rev0 from public.goods where id='detail-a' \gset
select public.admin_save_good(pg_temp.detail_payload('detail-a', array[pg_temp.detail_path(3), pg_temp.detail_path(1)]));
select pg_temp.detail_assert(pg_temp.detail_paths('detail-a') = array[pg_temp.detail_path(3), pg_temp.detail_path(1)]
  and (select detail_image_path from public.goods where id='detail-a') = pg_temp.detail_path(3), 'reorder and remove keep the mirror');
select pg_temp.detail_assert((select base_revision from public.goods where id='detail-a') > :rev0, 'detail image change bumps the base revision');

-- 4. 빠졌던 이미지를 다시 넣고 새 이미지를 더한다. 검증하지 않은 이미지는 저장 전체를 되돌린다.
select public.admin_save_good(pg_temp.detail_payload('detail-a', array[pg_temp.detail_path(3), pg_temp.detail_path(1), pg_temp.detail_path(4)]));
select pg_temp.detail_assert(pg_temp.detail_paths('detail-a') = array[pg_temp.detail_path(3), pg_temp.detail_path(1), pg_temp.detail_path(4)], 'new verified image appends');
select pg_temp.detail_error(format('select public.admin_save_good(%L::jsonb)',
  pg_temp.detail_payload('detail-a', array[pg_temp.detail_path(3), pg_temp.detail_path(99)])::text), 'unverified_artwork');
select pg_temp.detail_assert(pg_temp.detail_paths('detail-a') = array[pg_temp.detail_path(3), pg_temp.detail_path(1), pg_temp.detail_path(4)], 'failed save keeps the list');

-- 5. 목록 없이 한 장 칸만 보내는 저장(엑셀 반입): 첫 장이 같으면 둘째 장부터 그대로, 바꾸면 그 한 장이 된다.
select public.admin_save_good(pg_temp.detail_payload('detail-a', array[pg_temp.detail_path(3)]) - 'detail_image_paths' || '{"badge":"NEW"}');
select pg_temp.detail_assert(pg_temp.detail_paths('detail-a') = array[pg_temp.detail_path(3), pg_temp.detail_path(1), pg_temp.detail_path(4)]
  and (select badge from public.goods where id='detail-a') = 'NEW', 'legacy save with the same first image keeps later images');

-- 6. 형식 오류: 11장·빈 값·첫 장과 다른 한 장 칸.
select pg_temp.detail_error(format('select public.admin_save_good(%L::jsonb)',
  (pg_temp.detail_payload('detail-a', array[pg_temp.detail_path(3)]) || jsonb_build_object('detail_image_paths',
    (select jsonb_agg(pg_temp.detail_path(3)) from generate_series(1,11)))) ::text), 'goods_detail_images');
select pg_temp.detail_error(format('select public.admin_save_good(%L::jsonb)',
  (pg_temp.detail_payload('detail-a', array[pg_temp.detail_path(3)]) || '{"detail_image_paths":["", "x"]}')::text), 'goods_detail_images');
select pg_temp.detail_error(format('select public.admin_save_good(%L::jsonb)',
  (pg_temp.detail_payload('detail-a', array[pg_temp.detail_path(3), pg_temp.detail_path(1)]) || jsonb_build_object('detail_image_path', pg_temp.detail_path(1)))::text), 'goods_detail_images');

-- 7. 상세 이미지를 대표 이미지로 옮기면(같은 저장에서 목록에서 빼고) claim을 다시 요구하지 않는다.
select public.admin_save_good(pg_temp.detail_payload('detail-a', array[pg_temp.detail_path(3), pg_temp.detail_path(1)])
  || jsonb_build_object('image_path', pg_temp.detail_path(4)));
select pg_temp.detail_assert((select image_path from public.goods where id='detail-a') = pg_temp.detail_path(4)
  and pg_temp.detail_paths('detail-a') = array[pg_temp.detail_path(3), pg_temp.detail_path(1)], 'detail image moves to the main image');

reset role;
-- 8. 사진 보관함 사용처는 둘째 장 이후도 상품 사용으로 본다.
select pg_temp.detail_assert(private.goods_photo_references(pg_temp.detail_path(1)) @> '[{"id":"detail-a","kind":"good"}]'::jsonb, 'second detail image is a photo reference');
set local role authenticated;

-- 9. 복제는 목록 전체를 같은 순서로 복사한다.
select public.admin_clone_good('d1190000-0000-4000-8000-000000000020','detail-a','detail-a-copy','DETAIL-COPY','TEST 상세 복사');
select pg_temp.detail_assert(pg_temp.detail_paths('detail-a-copy') = array[pg_temp.detail_path(3), pg_temp.detail_path(1)]
  and (select detail_image_path from public.goods where id='detail-a-copy') = pg_temp.detail_path(3), 'clone copies every detail image in order');

-- 10. 서버 임시저장은 둘째 장 이후 칸(detailImagePath1…9)을 받고, 그 밖의 이름·검증 안 된 경로는 거절한다.
select public.admin_save_goods_draft('d1190000-0000-4000-8000-000000000030',
  jsonb_build_object('name','TEST 상세 임시저장','detailImagePath',pg_temp.detail_path(5),'detailImagePath1',pg_temp.detail_path(6)),0);
select pg_temp.detail_assert((select image_paths @> array[pg_temp.detail_path(5), pg_temp.detail_path(6)] from public.admin_goods_drafts
  where id='d1190000-0000-4000-8000-000000000030'), 'draft keeps the second detail image');
select pg_temp.detail_error($q$select public.admin_save_goods_draft('d1190000-0000-4000-8000-000000000031','{"name":"TEST","detailImagePath10":""}'::jsonb,0)$q$, 'invalid_goods_draft');
select pg_temp.detail_error($q$select public.admin_save_goods_draft('d1190000-0000-4000-8000-000000000031','{"name":"TEST","detailImagePath2":"https://example.test/a.png"}'::jsonb,0)$q$, 'unverified_artwork');

-- 11. 옛 한 장 저장이 첫 장을 바꾸면 목록은 그 한 장이다(엑셀은 여러 장인 상품의 이 변경을 미리보기에서 막는다).
select public.admin_save_good(pg_temp.detail_payload('detail-a', array[pg_temp.detail_path(7)]) - 'detail_image_paths');
select pg_temp.detail_assert(pg_temp.detail_paths('detail-a') = array[pg_temp.detail_path(7)], 'legacy save with a new first image replaces the list');
select public.admin_save_good(pg_temp.detail_payload('detail-a', '{}'::text[]));
select pg_temp.detail_assert(pg_temp.detail_paths('detail-a') = '{}'::text[] and (select detail_image_path from public.goods where id='detail-a') is null, 'empty list clears both');

rollback;
