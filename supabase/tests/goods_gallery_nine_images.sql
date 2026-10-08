\set ON_ERROR_STOP on
-- 2026-10-07 MD 피드백 ⑤ 보완: 추가 이미지(gallery_paths)는 대표 이미지 외 최대 9장이다.
-- 9장은 관리자 저장 경로로 저장되고, 10번째는 RPC 검사와 표 제약 양쪽에서 거부된다.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_gallery_error(statement text, message text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if position(message in sqlerrm)=0 then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',message;
end $$;
create function pg_temp.gallery_path(n integer) returns text language sql immutable as $$
  select 'public-media/catalog/good/00000000-0000-4000-8000-0000009160'||lpad(n::text,2,'0')||'.webp'
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000091601','authenticated','authenticated','goods-gallery-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000091601';
insert into public.verticals(key,label,color) values('goods-gallery-0916','추가 이미지 검증','#000000');
insert into public.ips(id,title,vertical_key) values('goods-gallery-0916','추가 이미지 검증','goods-gallery-0916');

-- 표 제약과 RPC 상한이 같은 9장이다.
select 1/case when (select pg_get_constraintdef(oid) from pg_constraint
  where conrelid='public.goods'::regclass and conname='goods_gallery_paths_limit')
  = 'CHECK ((COALESCE(array_length(gallery_paths, 1), 0) <= 9))' then 1 else 0 end as assert_gallery_constraint_is_nine;
select 1/case when exists(select 1 from pg_constraint where conrelid='public.goods'::regclass and conname='goods_gallery_paths_dense')
  then 1 else 0 end as assert_gallery_dense_constraint_kept;
select 1/case when has_function_privilege('authenticated','public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean)','execute')
  and not has_function_privilege('anon','public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean)','execute')
  and not has_function_privilege('service_role','public.admin_upsert_good(text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,integer,boolean)','execute')
  then 1 else 0 end as assert_upsert_good_grants_sealed;

-- 업로드 검증을 마친 이미지 10장을 준비한다. 검증은 운영자별로 한 장씩 차례로 진행된다.
set local role service_role;
do $$
declare
  n integer;
  claim_path text;
begin
  for n in 1..10 loop
    claim_path:=substring(pg_temp.gallery_path(n) from length('public-media/')+1);
    if not public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000091601',claim_path,'good','image/webp',100,now()+interval '10 minutes')
      or not exists(select 1 from public.service_begin_admin_artwork_verification('00000000-0000-4000-8000-000000091601',claim_path))
      or not public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000091601',claim_path,100)
    then
      raise exception 'gallery upload % should be verified inside the goods form budget',n;
    end if;
  end loop;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000091601',true);
select public.admin_save_good(jsonb_build_object('id','goods-gallery-0916','ip_id','goods-gallery-0916','name','추가 이미지 9장','type','문구','price',1000,'stock','ok',
  'gallery_paths',(select jsonb_agg(pg_temp.gallery_path(n) order by n) from generate_series(1,9) n)));
select 1/case when exists(select 1 from public.goods where id='goods-gallery-0916'
  and gallery_paths=(select array_agg(pg_temp.gallery_path(n) order by n) from generate_series(1,9) n))
  then 1 else 0 end as assert_nine_gallery_images_saved_in_order;
select 1/case when exists(select 1 from public.audit_log where action='catalog.good.upsert' and target='goods:goods-gallery-0916'
  and (diff->>'gallery_count')::integer=9) then 1 else 0 end as assert_nine_gallery_images_audited;

-- 10번째 추가 이미지는 관리자 저장 경로에서 거부되고 기존 9장과 남은 업로드는 그대로다.
select pg_temp.expect_gallery_error(format($sql$select public.admin_save_good(%L::jsonb)$sql$,
  jsonb_build_object('id','goods-gallery-0916','previous_id','goods-gallery-0916','ip_id','goods-gallery-0916','name','추가 이미지 10장','type','문구','price',1000,'stock','ok',
    'gallery_paths',(select jsonb_agg(pg_temp.gallery_path(n) order by n) from generate_series(1,10) n))),'goods_gallery_limit');
select pg_temp.expect_gallery_error(format($sql$select public.admin_upsert_good('goods-gallery-0916','goods-gallery-0916','추가 이미지 10장','문구',1000,null,'ok',null,null,
  null,null,null,null,null,null,null,null,%L::text[],null,'goods-gallery-0916')$sql$,
  (select array_agg(pg_temp.gallery_path(n) order by n) from generate_series(1,10) n)),'goods_gallery_limit');
select 1/case when exists(select 1 from public.goods where id='goods-gallery-0916' and name='추가 이미지 9장' and cardinality(gallery_paths)=9)
  then 1 else 0 end as assert_tenth_gallery_image_rejected_without_change;
reset role;
select 1/case when (select status from public.admin_artwork_upload_claims where path=substring(pg_temp.gallery_path(10) from length('public-media/')+1))='verified'
  then 1 else 0 end as assert_tenth_gallery_upload_not_consumed;

-- RPC를 거치지 않는 직접 쓰기도 표 제약이 막는다.
select pg_temp.expect_gallery_error($sql$update public.goods set gallery_paths=gallery_paths||pg_temp.gallery_path(10) where id='goods-gallery-0916'$sql$,
  'goods_gallery_paths_limit');
rollback;
