-- Qualify claim fields in service guards that also return a kind OUT column.

CREATE OR REPLACE FUNCTION public.service_begin_admin_artwork_verification(p_actor_id uuid, p_path text)
 RETURNS TABLE(kind text, mime_type text, source_size integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.lock_operator_subjects(array[p_actor_id]);
  if not private.has_operator_capability(p_actor_id,private.operator_artwork_capability((select claim.kind from public.admin_artwork_upload_claims claim where claim.actor_id=p_actor_id and claim.path=p_path))) then return; end if;

  if p_actor_id is null
    or p_path is null
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-artwork-upload:' || p_actor_id::text, 0)
  );

  -- actor 별 동시 processing 은 1개다. 이 직렬화는 그대로 유지한다.
  if exists (
    select 1
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.status = 'processing'
      and claim.expires_at > pg_catalog.clock_timestamp()
  ) or (
    -- 남용 억제 창. 굿즈 폼 11칸(대표 1 + 추가 이미지 9 + 상세 1)을 채우고 한 번 갈아끼울 수 있어야 한다.
    select count(*)
    from public.admin_artwork_upload_claims as claim
    where claim.actor_id = p_actor_id
      and claim.processing_started_at >= pg_catalog.clock_timestamp() - interval '1 minute'
  ) >= 22 then
    return;
  end if;

  return query
  update public.admin_artwork_upload_claims as claim
  set
    status = 'processing',
    processing_started_at = pg_catalog.clock_timestamp()
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status = 'pending'
    and claim.expires_at > pg_catalog.clock_timestamp()
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = claim.actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    )
  returning claim.kind, claim.mime_type, claim.source_size;
end;
$function$
;

select private.register_operator_rpc_contract('public.service_begin_admin_artwork_verification(uuid,text)'::regprocedure,'catalog.manage','service_start',false);

CREATE OR REPLACE FUNCTION public.service_verify_admin_artwork_upload(p_actor_id uuid, p_path text, p_final_size integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.lock_operator_subjects(array[p_actor_id]);
  if not private.has_operator_capability(p_actor_id,private.operator_artwork_capability((select claim.kind from public.admin_artwork_upload_claims claim where claim.actor_id=p_actor_id and claim.path=p_path))) then return false; end if;

  if p_final_size is null or p_final_size < 1 or p_final_size > 5 * 1024 * 1024 then
    return false;
  end if;

  update public.admin_artwork_upload_claims as claim
  set
    status = 'verified',
    final_size = p_final_size,
    verified_at = pg_catalog.clock_timestamp(),
    -- 폼 작성 창. 이미 더 먼 만료가 잡혀 있으면 당기지 않는다.
    -- greatest 는 파서 구문이라 search_path 와 무관하게 스키마 수식이 없다.
    expires_at = greatest(
      claim.expires_at,
      pg_catalog.clock_timestamp() + interval '2 hours'
    )
  where claim.actor_id = p_actor_id
    and claim.path = p_path
    and claim.status = 'processing'
    and claim.expires_at > pg_catalog.clock_timestamp()
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = claim.actor_id
        and profile.role in ('staff', 'admin')
        and profile.suspended_at is null
    );

  return found;
end;
$function$
;

select private.register_operator_rpc_contract('public.service_verify_admin_artwork_upload(uuid,text,integer)'::regprocedure,'catalog.manage','service_start',false);
