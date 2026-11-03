-- R19·R20(MD-0030·MD-0025) 후속, 2026-11-03.
--
-- 1) 업로드 차단 사유. 운영자별 업로드 확인은 동시에 1건, 1분에 22건까지이고(service_begin_admin_artwork_verification),
--    업로드 준비는 확인 대기 22건·저장 대기 60건까지다(service_prepare_admin_artwork_upload). 두 함수는 막히면
--    빈 결과/false만 돌려줘 화면에는 "이미지 파일을 확인하지 못했습니다"만 보였고, 사진이 조용히 사라진 것처럼 보였다.
--    두 함수의 계약은 그대로 두고, 실패한 뒤에만 부르는 읽기 전용 사유 조회를 더한다. 잠금을 잡지 않아
--    PostgREST의 읽기 전용 트랜잭션(STABLE)에서도 돈다. 운영자 권한 판정을 하지 않는 service 전용 조회라
--    운영자 RPC 계약 등록 대상이 아니다(operator_capability_coverage의 분류 조건에 걸리지 않는다).
--
-- 2) 사진 보관함 이름을 NFC로 저장하고 검색어·이름을 NFC로 비교한다. macOS 브라우저는 파일 이름의 한글을
--    NFD(자모 분리)로 넘겨, 보관함에 올린 파일 이름이 NFC로 입력한 검색어와 strpos로 맞지 않았다.
--    기존 이름은 화면에 같은 글자로 보이는 NFC로 바꾼다(revision은 올리지 않는다 — 운영자가 연 편집 화면의
--    저장 충돌을 만들지 않는다). 두 함수는 운영자 RPC 계약이라 이 파일 끝에서 다시 등록한다.
begin;

create function public.service_admin_artwork_upload_block_reason(p_actor_id uuid, p_stage text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_actor_id is null or p_stage is null or p_stage not in ('prepare', 'verify') then null
    when p_stage = 'verify' and exists (
      select 1
      from public.admin_artwork_upload_claims as claim
      where claim.actor_id = p_actor_id
        and claim.status = 'processing'
        and claim.expires_at > pg_catalog.now()
    ) then 'verification_in_progress'
    when p_stage = 'verify' and (
      select count(*)
      from public.admin_artwork_upload_claims as claim
      where claim.actor_id = p_actor_id
        and claim.processing_started_at >= pg_catalog.now() - interval '1 minute'
    ) >= 22 then 'verification_rate_limited'
    when p_stage = 'prepare' and (
      select count(*)
      from public.admin_artwork_upload_claims as claim
      where claim.actor_id = p_actor_id
        and claim.status in ('pending', 'processing')
        and claim.expires_at > pg_catalog.now()
    ) >= 22 then 'staging_full'
    when p_stage = 'prepare' and (
      select count(*)
      from public.admin_artwork_upload_claims as claim
      where claim.actor_id = p_actor_id
        and claim.status = 'verified'
        and claim.expires_at > pg_catalog.now()
    ) >= 60 then 'unsaved_full'
    else null
  end;
$$;

revoke all on function public.service_admin_artwork_upload_block_reason(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_admin_artwork_upload_block_reason(uuid, text)
  to service_role;

CREATE OR REPLACE FUNCTION public.admin_list_goods_photos(p_query text DEFAULT ''::text, p_archived boolean DEFAULT false, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; total_count bigint; search_term text;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='forbidden'; end if;
  if p_page is null or p_page < 1 or p_page > 100000 or p_query is null or char_length(p_query)>100 or p_archived is null then raise invalid_parameter_value using message='invalid_photo_search'; end if;
  -- 이름과 검색어를 모두 NFC로 맞춘다. 저장 경로는 NFC로만 쓰지만, 비교도 정규화해 어느 쪽이 NFD여도 찾는다.
  search_term:=lower(normalize(btrim(p_query),NFC));
  select count(*) into total_count from public.goods_photo_library p where (p.archived_at is not null)=p_archived and strpos(lower(normalize(p.name,NFC)),search_term)>0;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'imagePath',p.image_path,'revision',p.revision,'archived',p.archived_at is not null,'createdAt',p.created_at,'references',private.goods_photo_references(p.image_path)) order by p.created_at desc,p.id),'[]') into result
    from (select * from public.goods_photo_library p where (p.archived_at is not null)=p_archived and strpos(lower(normalize(p.name,NFC)),search_term)>0 order by p.created_at desc,p.id limit 20 offset (p_page-1)*20) p;
  return jsonb_build_object('rows',result,'total',total_count,'page',p_page,'pageSize',20);
end $function$;

CREATE OR REPLACE FUNCTION public.admin_save_goods_photo(p_id uuid, p_image_path text, p_name text, p_expected_revision integer, p_archived boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); previous public.goods_photo_library; saved public.goods_photo_library; object_path text; refs jsonb; clean_name text;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='forbidden'; end if;
  -- macOS 파일 이름(NFD 한글)도 화면에 보이는 그대로의 NFC로 저장해 검색에 걸리게 한다.
  clean_name:=normalize(btrim(p_name),NFC);
  if p_id is null or clean_name is null or char_length(clean_name) not between 1 and 100 or p_expected_revision is null or p_expected_revision<0 or p_archived is null then raise invalid_parameter_value using message='invalid_goods_photo'; end if;
  perform pg_advisory_xact_lock(hashtextextended('goods-photo:'||p_id::text,0));
  select * into previous from public.goods_photo_library where id=p_id for update;
  if found then
    if previous.image_path is distinct from p_image_path then raise check_violation using message='photo_path_immutable'; end if;
    -- Register retries are safe only for the exact creator and original payload.
    if p_expected_revision=0 and previous.created_by=actor and previous.revision=1 and previous.name=clean_name and previous.archived_at is null and not p_archived then
      return jsonb_build_object('id',previous.id,'revision',previous.revision);
    end if;
    if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='goods_photo_changed'; end if;
    refs:=private.goods_photo_references(previous.image_path);
    if p_archived and jsonb_array_length(refs)>0 then raise check_violation using message='goods_photo_in_use'; end if;
    update public.goods_photo_library set name=clean_name,archived_at=case when p_archived then coalesce(archived_at,clock_timestamp()) else null end,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into saved;
  else
    if p_expected_revision<>0 or p_archived then raise sqlstate 'PT409' using message='goods_photo_changed'; end if;
    if p_image_path is null or p_image_path !~ '^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$' then raise check_violation using message='unverified_artwork'; end if;
    object_path:=substr(p_image_path,length('public-media/')+1);
    update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
      where claim.actor_id=actor and claim.path=object_path and claim.kind='good' and claim.status='verified'
        and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
    if not found then raise check_violation using message='unverified_artwork'; end if;
    insert into public.goods_photo_library(id,image_path,name,created_by) values(p_id,p_image_path,clean_name,actor) returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods.photo.saved','goods_photo:'||p_id::text,jsonb_build_object('before',case when previous.id is null then null else to_jsonb(previous) end,'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'revision',saved.revision);
end $function$;

-- 화면에는 같은 글자로 보이는 표기 정규화라 revision·updated_at·감사 기록을 남기지 않는다.
update public.goods_photo_library
  set name = normalize(name, NFC)
  where name is distinct from normalize(name, NFC);

select private.register_operator_rpc_contract('public.admin_list_goods_photos(text,boolean,integer)'::regprocedure,'catalog.read','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_photo(uuid,text,text,integer,boolean)'::regprocedure,'catalog.manage','write',false);

commit;
