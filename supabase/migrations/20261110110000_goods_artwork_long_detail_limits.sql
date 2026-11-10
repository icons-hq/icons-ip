-- MD-0002·10/27 회의 28:03~28:48 후속: 세로로 긴 통이미지 상세페이지가 5MB·8192px 한도에 막혀 등록되지 않았다.
-- 상품 이미지(kind='good')만 파일당 20MB·가로세로 30,000px로 올린다. 다른 종류는 5MB·8192px 그대로다.
-- 총 픽셀 상한 4,000만은 그대로라 서버의 이미지 처리 부담은 늘지 않는다.
-- lib/admin/artwork.ts의 GOODS_ARTWORK_MAX_BYTES·GOODS_ARTWORK_MAX_DIMENSION과 같은 값이다.
begin;

-- 버킷은 종류를 모르므로 가장 큰 한도를 둔다. 종류별 판정은 아래 클레임 제약과 함수가 맡는다.
do $$
begin
  update storage.buckets set file_size_limit = 20 * 1024 * 1024
    where id in ('public-media', 'admin-artwork-staging');
  if (select count(*) from storage.buckets
      where id in ('public-media', 'admin-artwork-staging') and file_size_limit = 20 * 1024 * 1024) <> 2 then
    raise exception 'admin_artwork_bucket_missing';
  end if;
end $$;

alter table public.admin_artwork_upload_claims
  drop constraint admin_artwork_upload_claims_source_size_check,
  drop constraint admin_artwork_upload_claims_final_size_check,
  drop constraint admin_artwork_final_dimensions_valid,
  add constraint admin_artwork_upload_claims_source_size_check check (
    source_size between 1 and case when kind = 'good' then 20 * 1024 * 1024 else 5 * 1024 * 1024 end
  ),
  add constraint admin_artwork_upload_claims_final_size_check check (
    final_size between 1 and case when kind = 'good' then 20 * 1024 * 1024 else 5 * 1024 * 1024 end
  ),
  add constraint admin_artwork_final_dimensions_valid check (
    (final_width is null and final_height is null)
    or (
      final_width is not null and final_height is not null
      and final_width between 1 and case when kind = 'good' then 30000 else 8192 end
      and final_height between 1 and case when kind = 'good' then 30000 else 8192 end
      and final_width::bigint * final_height::bigint <= 40000000
    )
  );

do $patch$
declare
  target regprocedure;
  body text;
  anchor text;
begin
  target := 'public.service_prepare_admin_artwork_upload(uuid,text,text,text,integer,timestamptz)'::regprocedure;
  body := pg_get_functiondef(target);
  anchor := $a$or p_source_size > 5 * 1024 * 1024$a$;
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'artwork_prepare_size_anchor_changed';
  end if;
  execute replace(body, anchor,
    $a$or p_source_size > (case when p_kind = 'good' then 20 * 1024 * 1024 else 5 * 1024 * 1024 end)$a$);

  target := 'public.service_verify_admin_artwork_upload(uuid,text,integer)'::regprocedure;
  body := pg_get_functiondef(target);
  anchor := $a$p_final_size > 5 * 1024 * 1024 then$a$;
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'artwork_verify_size_anchor_changed';
  end if;
  execute replace(body, anchor, $a$p_final_size > (case when (
      select claim.kind from public.admin_artwork_upload_claims as claim
      where claim.actor_id = p_actor_id and claim.path = p_path
    ) = 'good' then 20 * 1024 * 1024 else 5 * 1024 * 1024 end) then$a$);

  target := 'public.service_verify_admin_artwork_upload(uuid,text,integer,integer,integer)'::regprocedure;
  body := pg_get_functiondef(target);
  anchor := $a$p_final_width not between 1 and 8192 or p_final_height not between 1 and 8192$a$;
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'artwork_verify_dimension_anchor_changed';
  end if;
  execute replace(body, anchor, $a$least(p_final_width, p_final_height) < 1
    or greatest(p_final_width, p_final_height) > (case when (
      select claim.kind from public.admin_artwork_upload_claims as claim
      where claim.actor_id = p_actor_id and claim.path = p_path
    ) = 'good' then 30000 else 8192 end)$a$);
end $patch$;

-- 재정의한 함수의 계약 지문을 다시 적는다(operator_capability_coverage). 분류는 기존 행 값 그대로다.
select private.register_operator_rpc_contract('public.service_prepare_admin_artwork_upload(uuid,text,text,text,integer,timestamp with time zone)'::regprocedure, 'catalog.manage', 'service_start', false);
select private.register_operator_rpc_contract('public.service_verify_admin_artwork_upload(uuid,text,integer)'::regprocedure, 'catalog.manage', 'service_start', false);
select private.register_operator_rpc_contract('public.service_verify_admin_artwork_upload(uuid,text,integer,integer,integer)'::regprocedure, 'catalog.manage', 'service_start', false);
select private.register_operator_internal_contract(signature::regprocedure)
from private.operator_internal_contracts
where signature::regprocedure in (
  'public.service_prepare_admin_artwork_upload(uuid,text,text,text,integer,timestamp with time zone)'::regprocedure,
  'public.service_verify_admin_artwork_upload(uuid,text,integer)'::regprocedure,
  'public.service_verify_admin_artwork_upload(uuid,text,integer,integer,integer)'::regprocedure
);

commit;
