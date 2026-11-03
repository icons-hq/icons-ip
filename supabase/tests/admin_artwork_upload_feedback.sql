\set ON_ERROR_STOP on
-- R19·R20 후속(20261103120000): 업로드 차단 사유 조회와 사진 보관함 이름 NFC 정규화.
begin;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000110301','authenticated','authenticated','upload-feedback-a@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000110302','authenticated','authenticated','upload-feedback-b@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000110303','authenticated','authenticated','upload-feedback-c@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id in ('00000000-0000-4000-8000-000000110301','00000000-0000-4000-8000-000000110302','00000000-0000-4000-8000-000000110303');
create function pg_temp.claim_path(actor integer, n integer) returns text language sql immutable as $$
  select 'catalog/good/00000000-0000-4000-8'||lpad(actor::text,3,'0')||'-'||lpad(n::text,12,'0')||'.webp'
$$;

-- 사유 조회는 service_role 전용 읽기 함수다.
select 1/case when has_function_privilege('service_role','public.service_admin_artwork_upload_block_reason(uuid,text)','execute')
  and not has_function_privilege('authenticated','public.service_admin_artwork_upload_block_reason(uuid,text)','execute')
  and not has_function_privilege('anon','public.service_admin_artwork_upload_block_reason(uuid,text)','execute')
  and (select provolatile='s' and prosecdef and proconfig=array['search_path=""']
    from pg_proc where oid='public.service_admin_artwork_upload_block_reason(uuid,text)'::regprocedure)
  then 1 else 0 end as block_reason_sealed_and_stable;

set local role service_role;
select 1/case when public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110301','verify') is null
  and public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110301','prepare') is null
  and public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110301','other') is null
  and public.service_admin_artwork_upload_block_reason(null,'verify') is null
  then 1 else 0 end as no_reason_without_claims;

-- 확인 중인 업로드가 있으면 다음 확인은 막히고, 사유는 verification_in_progress다. 다른 운영자는 막지 않는다.
select 1/case when public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000110301',pg_temp.claim_path(1,1),'good','image/webp',100,now()+interval '10 minutes')
  and public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000110301',pg_temp.claim_path(1,2),'good','image/webp',100,now()+interval '10 minutes')
  then 1 else 0 end as prepared_two;
select 1/case when exists(select 1 from public.service_begin_admin_artwork_verification('00000000-0000-4000-8000-000000110301',pg_temp.claim_path(1,1)))
  then 1 else 0 end as first_verification_started;
select 1/case when not exists(select 1 from public.service_begin_admin_artwork_verification('00000000-0000-4000-8000-000000110301',pg_temp.claim_path(1,2)))
  and public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110301','verify')='verification_in_progress'
  and public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110301','prepare') is null
  and public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110302','verify') is null
  then 1 else 0 end as in_progress_reason;
select public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000110301',pg_temp.claim_path(1,1),100,10,10);
select 1/case when public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110301','verify') is null
  then 1 else 0 end as in_progress_cleared;

-- 1분에 22건을 확인하면 23번째는 막히고, 사유는 verification_rate_limited다.
do $$
declare n integer;
begin
  for n in 2..22 loop
    if n > 2 and not public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000110301',pg_temp.claim_path(1,n),'good','image/webp',100,now()+interval '10 minutes') then
      raise exception 'prepare % should pass', n;
    end if;
    if not exists(select 1 from public.service_begin_admin_artwork_verification('00000000-0000-4000-8000-000000110301',pg_temp.claim_path(1,n)))
      or not public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000110301',pg_temp.claim_path(1,n),100,10,10) then
      raise exception 'verification % should pass inside the rate window', n;
    end if;
  end loop;
end $$;
select 1/case when public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000110301',pg_temp.claim_path(1,23),'good','image/webp',100,now()+interval '10 minutes')
  and not exists(select 1 from public.service_begin_admin_artwork_verification('00000000-0000-4000-8000-000000110301',pg_temp.claim_path(1,23)))
  and public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110301','verify')='verification_rate_limited'
  then 1 else 0 end as rate_limited_reason;

-- 확인 대기 22건이 차면 준비가 막히고, 사유는 staging_full이다.
do $$
declare n integer;
begin
  for n in 1..22 loop
    if not public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000110302',pg_temp.claim_path(2,n),'good','image/webp',100,now()+interval '10 minutes') then
      raise exception 'staging prepare % should pass', n;
    end if;
  end loop;
end $$;
select 1/case when not public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000110302',pg_temp.claim_path(2,23),'good','image/webp',100,now()+interval '10 minutes')
  and public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110302','prepare')='staging_full'
  and public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110302','verify') is null
  then 1 else 0 end as staging_full_reason;
reset role;

-- 저장을 기다리는 확인본 60건이 차면 준비가 막히고, 사유는 unsaved_full이다(합성 claim, 1분 창 밖에서 확인됨).
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at)
select pg_temp.claim_path(3,n),'00000000-0000-4000-8000-000000110303','good','image/webp',100,100,'verified',now()+interval '1 hour',now()-interval '30 minutes',now()-interval '29 minutes'
from generate_series(1,60) n;
set local role service_role;
select 1/case when not public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000110303',pg_temp.claim_path(3,61),'good','image/webp',100,now()+interval '10 minutes')
  and public.service_admin_artwork_upload_block_reason('00000000-0000-4000-8000-000000110303','prepare')='unsaved_full'
  then 1 else 0 end as unsaved_full_reason;
reset role;

-- 사진 보관함 이름은 NFC로 저장하고, NFD·NFC 어느 검색어로도 찾는다. 같은 등록을 NFD 이름으로 다시 보내도 한 행이다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000110301',true);
select public.admin_save_goods_photo('00000000-0000-4000-8000-000000110399','public-media/'||pg_temp.claim_path(1,1),normalize('  메이플 키링.png ',NFD),0);
select public.admin_save_goods_photo('00000000-0000-4000-8000-000000110399','public-media/'||pg_temp.claim_path(1,1),normalize('메이플 키링.png',NFD),0);
reset role;
select 1/case when (select name from public.goods_photo_library where id='00000000-0000-4000-8000-000000110399')=normalize('메이플 키링.png',NFC)
  and (select revision from public.goods_photo_library where id='00000000-0000-4000-8000-000000110399')=1
  and (select count(*) from public.goods_photo_library where image_path='public-media/'||pg_temp.claim_path(1,1))=1
  then 1 else 0 end as stored_nfc_once;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000110301',true);
select 1/case when (public.admin_list_goods_photos(normalize('메이플',NFC))->>'total')::int=1
  and (public.admin_list_goods_photos(normalize('메이플',NFD))->>'total')::int=1
  and (public.admin_list_goods_photos(normalize(' 키링 ',NFD))->>'total')::int=1
  then 1 else 0 end as search_is_normalization_safe;
reset role;

-- 마이그레이션 전부터 있던 NFD 이름(직접 넣은 행)도 비교가 정규화되어 검색된다.
insert into public.goods_photo_library(id,image_path,name,created_by)
values('00000000-0000-4000-8000-000000110398','public-media/catalog/good/00000000-0000-4000-8000-000000110398.webp',normalize('구 사진 이름',NFD),'00000000-0000-4000-8000-000000110301');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000110301',true);
select 1/case when (public.admin_list_goods_photos(normalize('구 사진',NFC))->>'total')::int=1 then 1 else 0 end as legacy_nfd_row_found;
reset role;

-- 재정의한 두 함수의 운영자 계약이 현재 본문과 맞다.
select 1/case when (select count(*) from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where c.signature in ('public.admin_list_goods_photos(text,boolean,integer)','public.admin_save_goods_photo(uuid,text,text,integer,boolean)')
    and c.body_md5=md5(p.prosrc))=2 then 1 else 0 end as photo_contracts_current;
rollback;
