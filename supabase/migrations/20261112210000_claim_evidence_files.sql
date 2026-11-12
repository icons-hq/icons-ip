-- 클레임 처리 근거 사진(TKT-166·QNA-039, ADR-0041).
--
-- 하자·오배송 교환에서 '회수 없이 재출고'(회수 생략)를 고르면 사유 문장과 근거 사진 1장 이상이
-- 필요하다. 기존 클레임 근거는 글(판매자 대리 접수 합의 근거·회수 확인 근거)뿐이라 사진 저장소가
-- 없다 — 상담 첨부(inquiry-files-private)는 상담 권한·보관함 계약이라 재사용하지 않고, 클레임
-- 전용 비공개 버킷을 둔다.
--
-- 올리기는 서버 액션이 맡는다: 운영자 권한(sales.manage)을 확인하고 이미지를 디코딩해 검사한 뒤
-- service 클라이언트로 `<claimId>/<fileId>.<ext>`에 넣고, 이 파일의 등록 RPC가 같은 운영자로
-- 다시 권한을 보고 저장소 객체(크기·형식)를 대조해 원장에 남긴다. 버킷에는 SELECT/INSERT/UPDATE/
-- DELETE 정책이 없다 — 클라이언트는 직접 읽거나 덮어쓰지 못하고, 보기는 서버가 짧은 서명 URL로
-- 넘긴다.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('claim-evidence-private','claim-evidence-private',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table private.claim_evidence_files(
 id uuid primary key,
 claim_id uuid not null references public.order_cancellation_requests(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 mime_type text not null check(mime_type in('image/jpeg','image/png','image/webp')),
 size_bytes integer not null check(size_bytes between 1 and 10485760),
 sha256 text not null check(sha256~'^[0-9a-f]{64}$'),
 path text not null unique,
 created_at timestamptz not null default clock_timestamp(),
 constraint claim_evidence_files_path check(path=claim_id::text||'/'||id::text||'.'||case mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end)
);
create index claim_evidence_files_claim_idx on private.claim_evidence_files(claim_id,created_at);
alter table private.claim_evidence_files enable row level security;
alter table private.claim_evidence_files owner to postgres;
revoke all on private.claim_evidence_files from public,anon,authenticated,service_role;

-- 서버 액션이 올린 객체를 원장에 등록한다. 같은 id로 같은 내용을 다시 보내면 같은 결과를 돌려준다.
create function public.admin_register_claim_evidence_file(p_claim_id uuid,p_file_id uuid,p_mime_type text,p_size_bytes integer,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());claim public.order_cancellation_requests;existing private.claim_evidence_files;object_path text;
begin
 perform private.require_operator_capability('sales.manage',false);
 if actor is null then raise insufficient_privilege using message='staff required';end if;
 if p_claim_id is null or p_file_id is null or p_mime_type is null or p_mime_type not in('image/jpeg','image/png','image/webp')
  or p_size_bytes is null or p_size_bytes not between 1 and 10485760 or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$' then
  raise invalid_parameter_value using message='invalid_claim_evidence_file';end if;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for share;
 if not found then raise no_data_found using message='claim_not_found';end if;
 if claim.claim_type<>'exchange' then raise check_violation using message='claim_evidence_unavailable';end if;
 object_path:=p_claim_id::text||'/'||p_file_id::text||'.'||case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
 select * into existing from private.claim_evidence_files where id=p_file_id for update;
 if found then
  if existing.claim_id<>p_claim_id or existing.mime_type<>p_mime_type or existing.size_bytes<>p_size_bytes or existing.sha256<>p_sha256 then
   raise unique_violation using message='claim_evidence_conflict';end if;
  return jsonb_build_object('id',existing.id,'claimId',existing.claim_id,'mimeType',existing.mime_type,'size',existing.size_bytes,'createdAt',existing.created_at);
 end if;
 if (select count(*) from private.claim_evidence_files where claim_id=p_claim_id)>=20 then raise check_violation using message='claim_evidence_limit';end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='claim-evidence-private' and o.name=object_path
  and o.metadata->>'mimetype'=p_mime_type and o.metadata->>'size'=p_size_bytes::text) then
  raise check_violation using message='claim_evidence_unverified';end if;
 insert into private.claim_evidence_files(id,claim_id,actor_id,mime_type,size_bytes,sha256,path)
 values(p_file_id,p_claim_id,actor,p_mime_type,p_size_bytes,p_sha256,object_path) returning * into existing;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_evidence_uploaded','order:'||claim.order_id::text,
  jsonb_build_object('claimId',p_claim_id,'fileId',p_file_id,'mimeType',p_mime_type,'size',p_size_bytes));
 return jsonb_build_object('id',existing.id,'claimId',existing.claim_id,'mimeType',existing.mime_type,'size',existing.size_bytes,'createdAt',existing.created_at);
end $$;

-- 보기 경로: 운영자에게만 저장 경로를 돌려준다. 서명 URL은 서버가 service 클라이언트로 짧게 만든다.
create function public.admin_claim_evidence_file(p_file_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f private.claim_evidence_files;
begin
 perform private.require_operator_capability('sales.manage',false);
 select * into f from private.claim_evidence_files where id=p_file_id;
 if not found then raise no_data_found using message='claim_evidence_not_found';end if;
 return jsonb_build_object('id',f.id,'claimId',f.claim_id,'path',f.path,'mimeType',f.mime_type,'size',f.size_bytes);
end $$;

revoke all on function public.admin_register_claim_evidence_file(uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_register_claim_evidence_file(uuid,uuid,text,integer,text) to authenticated;
revoke all on function public.admin_claim_evidence_file(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_claim_evidence_file(uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_register_claim_evidence_file(uuid,uuid,text,integer,text)'::regprocedure,'sales.manage','write',false);
select private.register_operator_internal_contract('public.admin_register_claim_evidence_file(uuid,uuid,text,integer,text)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_claim_evidence_file(uuid)'::regprocedure,'sales.manage','read',false);
select private.register_operator_internal_contract('public.admin_claim_evidence_file(uuid)'::regprocedure);

commit;
notify pgrst,'reload schema';
