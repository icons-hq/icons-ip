-- 운영자 2단계 인증(TOTP) 요구 스위치와 DB 강제, 기기 분실 초기화, 권한 회수 때 세션 끊기(원장 OPS-006·OPS-005).
--
-- 지금은 운영자 비밀번호 하나로 환불·개인정보 엑셀·설정 변경이 열린다. 이 migration은
--   1. 운영자 MFA 요구 스위치(private.operator_mfa_policy, 기본 꺼짐)를 둔다. 이 migration은 스위치를 켜지 않는다.
--   2. 스위치가 켜지면 운영자 권한 판정의 공통 진입(private.has_operator_capability → public.has_operator_capability·
--      private.require_*_operator_capability·RLS, 그리고 역할 기반 public.is_staff)이 "지금 요청의 JWT가 aal2이고 그 JWT의
--      로그인 세션 행이 아직 살아 있으며 행도 aal2인" 운영자만 운영자로 본다. RPC를 직접 불러 앱의 MFA 화면을 건너뛰어도 DB가 거절한다.
--      앱 서버가 사용자·세션을 인자로 넘겨 service_role로 부르는 운영자 경로(2-1)는 넘겨받은 세션 행이 aal2인지 따로 본다.
--      판정 대상이 지금 요청의 로그인 사용자(auth.uid())이고 JWT 역할이 authenticated일 때만 따진다 — service_role·cron·
--      JWT 없는 트리거 경로와 다른 사람의 권한을 확인하는 경로는 그대로다. 고객은 능력이 없어 판정 전에 false라 영향이 없다.
--   3. 기기를 잃은 운영자의 2단계 인증 초기화(최고 관리자 — 통합 매니저, 권한 전환 전에는 admin)와 감사 기록.
--      요소 삭제 자체는 앱 서버가 Supabase Auth admin API(auth.admin.mfa.deleteFactor)로 하고, 이 RPC는 권한 판정·
--      대상 세션 끊기·감사 기록을 한 트랜잭션으로 한다.
--   4. 운영자 권한 회수(역할 회수·전환 때 미지정) 시 그 사용자의 Auth 세션(auth.sessions, refresh token은 cascade)을 모두 지운다.
--      supabase-js의 auth.admin.signOut은 대상 사용자의 JWT가 있어야 해서 다른 사용자의 세션을 사용자 ID로 끊지 못한다.
--      세션 행이 사라지면 refresh가 거절되고 GoTrue의 getUser가 세션 없음으로 실패해 앱 가드가 로그인으로 보낸다.
--      이미 발급된 access token은 만료(기본 1시간)까지 서명이 유효하지만, 회수된 사람은 운영자 능력이 없어 DB가 거절한다.
--
-- 판정은 거의 모든 어드민 RPC가 지나간다. 능력 보유 확인 뒤에만 스위치 행 1건(PK)을 읽고, 꺼져 있으면 JWT를 풀지 않고 돌아간다.
-- 켜졌을 때만 JWT 비교와 세션 행 1건(PK)을 더한다. 잠금·쓰기는 없다(읽기 전용 트랜잭션 성질 유지,
-- supabase/tests/cs_reply_read_transaction_mode.sql). 운영자 판정을 행마다 부르던 RLS 정책은 initplan으로 감싼다(4-1).
--
-- 기존 함수는 pg_get_functiondef + 앵커 치환으로 바꿀 줄만 바꾸고, 앵커가 정확히 한 번 나오지 않으면 멈춘다.
-- 같은 migration 끝에서 운영자 계약 지문(RPC·내부)을 기존 분류값 그대로 다시 적는다.
begin;

create function private.t8_patch_function(p_signature text,p_anchor text,p_replacement text)
returns void language plpgsql volatile set search_path='' as $$
declare body text; found_count integer;
begin
  body:=pg_get_functiondef(p_signature::regprocedure);
  found_count:=(length(body)-length(replace(body,p_anchor,'')))/length(p_anchor);
  if found_count<>1 then raise exception 't8_anchor_changed: % (found %)',p_signature,found_count; end if;
  execute replace(body,p_anchor,p_replacement);
end $$;
revoke all on function private.t8_patch_function(text,text,text) from public,anon,authenticated,service_role;

-- 1. 스위치. 행은 private에만 두고 앱 롤은 함수로만 만난다.
create table private.operator_mfa_policy (
  singleton boolean primary key default true check(singleton),
  required boolean not null default false,
  revision bigint not null default 1 check(revision>0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);
insert into private.operator_mfa_policy(singleton) values(true);
alter table private.operator_mfa_policy enable row level security;
revoke all on private.operator_mfa_policy from public,anon,authenticated,service_role;
comment on table private.operator_mfa_policy is '운영자 2단계 인증 요구 스위치(OPS-006). 켜는 순서와 끄는 법은 docs/runbooks/operator-access.md.';

-- 행이 없거나 읽지 못하면 꺼짐이다 — 스위치 행 사고가 운영자 전원을 잠그지 않는다.
create function private.operator_mfa_required() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select p.required from private.operator_mfa_policy p where p.singleton),false);
$$;
revoke all on function private.operator_mfa_required() from public,anon,authenticated,service_role;

-- 세션 행이 지금 aal2이고 그 사용자에게 확인된 인증 앱이 아직 있는가. GoTrue는 인증 앱 확인 때 세션 행을 aal2로 올린다.
-- JWT의 aal 주장은 토큰 만료까지 남으므로 세션 행으로 다시 보고, 인증 앱이 모두 지워졌으면(초기화의 admin 삭제·본인 해제)
-- 세션 행이 아직 aal2여도 거절한다 — 로컬 GoTrue 실측에서 admin 요소 삭제는 세션 행 aal을 내리지 않았다.
create function private.operator_mfa_session_ok(p_actor uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_actor is not null and p_session is not null and exists(select 1 from auth.sessions s
    where s.id=p_session and s.user_id=p_actor and s.aal='aal2' and (s.not_after is null or s.not_after>clock_timestamp()))
    and exists(select 1 from auth.mfa_factors f where f.user_id=p_actor and f.status='verified');
$$;
revoke all on function private.operator_mfa_session_ok(uuid,uuid) from public,anon,authenticated,service_role;

-- 지금 요청의 JWT가 이 사용자의 aal2 세션이고 그 세션 행도 아직 aal2로 살아 있는가.
create function private.operator_mfa_session_verified(p_actor uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare claims jsonb:=(select auth.jwt()); session_text text;
begin
  if p_actor is null or claims is null or p_actor is distinct from (select auth.uid()) or claims->>'aal' is distinct from 'aal2' then return false; end if;
  session_text:=claims->>'session_id';
  if session_text is null or session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return private.operator_mfa_session_ok(p_actor,session_text::uuid);
end $$;
revoke all on function private.operator_mfa_session_verified(uuid) from public,anon,authenticated,service_role;

-- 운영자 판정을 막아야 하는가. 판정 대상이 지금 요청의 로그인 사용자이고 JWT 역할이 authenticated일 때만 막는다.
-- 스위치 행을 먼저 본다: 꺼져 있으면 JWT를 풀지 않고 바로 돌아간다(판정마다 붙는 비용을 PK 읽기 한 번으로 줄인다).
-- service_role이 사용자·세션을 인자로 넘기는 경로는 JWT가 없으므로 그 함수가 넘겨받은 세션을 operator_mfa_session_ok로 따로 본다.
create function private.operator_mfa_blocks(p_actor uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare claims jsonb;
begin
  if p_actor is null or not exists(select 1 from private.operator_mfa_policy p where p.singleton and p.required) then return false; end if;
  claims:=(select auth.jwt());
  if claims is null or claims->>'role' is distinct from 'authenticated' or p_actor is distinct from (select auth.uid()) then return false; end if;
  return not private.operator_mfa_session_verified(p_actor);
end $$;
revoke all on function private.operator_mfa_blocks(uuid) from public,anon,authenticated,service_role;

-- service_role이 사용자·세션을 인자로 넘겨 운영자를 판정하는 경로용: 스위치가 켜졌으면 넘겨받은 세션 행이 aal2여야 한다.
create function private.operator_mfa_service_session_ok(p_actor uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not private.operator_mfa_required() or private.operator_mfa_session_ok(p_actor,p_session);
$$;
revoke all on function private.operator_mfa_service_session_ok(uuid,uuid) from public,anon,authenticated,service_role;

-- 2. 공통 진입에 MFA 판정을 더한다. 능력이 있는 운영자에게만 스위치를 읽는다(고객·능력 없는 판정은 앞에서 false).
select private.t8_patch_function('private.has_operator_capability(uuid,text,boolean)',
$a$if access->>'mode'='legacy' and p_legacy_admin_only then$a$,
$a$-- 운영자 2단계 인증(OPS-006): 스위치가 켜지면 지금 요청의 aal2 세션만 운영자로 본다.
  if private.operator_mfa_blocks(p_actor) then return false; end if;
  if access->>'mode'='legacy' and p_legacy_admin_only then$a$);

-- MFA 때문에 거절된 운영자에게는 따로 알린다(앱이 2단계 인증 화면으로 안내). 운영자가 아닌 사람은 기존 거절 그대로다.
select private.t8_patch_function('private.require_actor_operator_capability(uuid,text,boolean)',
$a$if not private.has_operator_capability(p_actor,p_capability,p_legacy_admin_only) then$a$,
$a$if not private.has_operator_capability(p_actor,p_capability,p_legacy_admin_only) then
    if private.operator_mfa_blocks(p_actor) and private.operator_access_for(p_actor)->>'mode'<>'none' then
      raise insufficient_privilege using message='operator_mfa_required';
    end if;$a$);

-- 역할 기반 스태프 판정을 쓰는 남은 내부 경로(트리거·옛 저장 체인)도 같은 기준으로 본다.
select private.t8_patch_function('public.is_staff()',
$a$and profile.suspended_at is null$a$,
$a$and profile.suspended_at is null
      and not private.operator_mfa_blocks(profile.id)$a$);

-- 본인 권한 응답에 MFA 상태를 더한다. required=스위치가 켜졌고 운영자다, satisfied=지금 세션이 기준을 만족한다.
-- 앱은 required && !satisfied면 운영자 화면 대신 2단계 인증 화면으로 보낸다. 기존 키는 그대로다.
select private.t8_patch_function('public.admin_current_operator_access()',
$a$select private.operator_access_for((select auth.uid()));$a$,
$a$select current_access.access||jsonb_build_object('mfa',jsonb_build_object(
    'required',current_access.access->>'mode'<>'none' and private.operator_mfa_required(),
    'satisfied',current_access.access->>'mode'='none' or not private.operator_mfa_blocks((select auth.uid()))))
  from (select private.operator_access_for((select auth.uid())) as access) current_access;$a$);

-- 2-1. service_role이 사용자·세션을 인자로 넘겨 운영자를 판정하는 경로(앱 서버가 사용자 JWT를 검증한 뒤 service client로 부른다).
-- JWT가 없어 위 판정이 대상 세션을 모르므로, 이 함수들이 넘겨받은 세션 행이 스위치가 켜졌을 때 aal2인지 직접 본다.
-- 같은 모양(사용자+세션 인자로 운영자 판정)의 함수를 전수 조사했다: 아래 외의 세션 인자 함수(상품 그룹·배송 설정·배송비 묶음·쿠폰 발급·
-- 구매확정·클레임 비용·제작·환불 계좌)는 auth.uid()와 JWT session_id 일치를 요구해 위 JWT 판정으로 막힌다.
select private.t8_patch_function('private.contact_require_identity(uuid,uuid,text,boolean,uuid[],boolean)',
$a$or(p_capability is not null and not private.has_operator_capability(p_actor,p_capability,p_admin)) then$a$,
$a$or(p_capability is not null and (not private.has_operator_capability(p_actor,p_capability,p_admin)
  or not private.operator_mfa_service_session_ok(p_actor,p_session))) then$a$);
select private.t8_patch_function('private.digital_operator_session(uuid,uuid)',
$a$if not found or private.is_account_write_fenced(p_actor) then raise insufficient_privilege;end if;$a$,
$a$if not found or private.is_account_write_fenced(p_actor) or not private.operator_mfa_service_session_ok(p_actor,p_session) then raise insufficient_privilege;end if;$a$);
select private.t8_patch_function('private.inquiry_file_session(uuid,uuid,boolean)',
$a$if p_staff then perform private.require_actor_operator_capability(p_actor,'cs.manage');end if;$a$,
$a$if p_staff then perform private.require_actor_operator_capability(p_actor,'cs.manage');
  if not private.operator_mfa_service_session_ok(p_actor,p_session) then raise insufficient_privilege using message='operator_mfa_required';end if;
 end if;$a$);
-- 상담 첨부 내려받기: aal2가 아닌 운영자 세션은 운영자가 아니라 고객으로 본다(자기 문의의 첨부만).
select private.t8_patch_function('public.service_inquiry_file_download(uuid,uuid,uuid,uuid)',
$a$staff:=private.has_operator_capability(p_actor,'cs.manage',false);$a$,
$a$staff:=private.has_operator_capability(p_actor,'cs.manage',false) and private.operator_mfa_service_session_ok(p_actor,p_session);$a$);
select private.t8_patch_function('public.service_export_bank_transfer_refund_accounts(uuid,uuid,uuid,jsonb)',
$a$if not private.has_operator_capability(actor,'sales.manage',true) then$a$,
$a$if not private.has_operator_capability(actor,'sales.manage',true) or not private.operator_mfa_service_session_ok(actor,p_session_id) then$a$);
select private.t8_patch_function('public.service_export_order_partial_cancellation_refund_accounts(uuid,uuid,uuid,jsonb)',
$a$if not private.has_operator_capability(actor, 'sales.manage', true) then$a$,
$a$if not private.has_operator_capability(actor, 'sales.manage', true) or not private.operator_mfa_service_session_ok(actor, p_session_id) then$a$);
select private.t8_patch_function('public.service_resolve_order_partial_cancellation(uuid,text,text,text,bigint,uuid,uuid)',
$a$if not private.has_operator_capability(v_actor, 'sales.manage', true) then$a$,
$a$if not private.has_operator_capability(v_actor, 'sales.manage', true) or not private.operator_mfa_service_session_ok(v_actor, p_session_id) then$a$);
select private.t8_patch_function('public.service_record_review_export(uuid,uuid,jsonb,text,integer,timestamp with time zone,text)',
$a$if not found or not private.has_operator_capability(p_actor_id,'cs.manage',false) then$a$,
$a$if not found or not private.has_operator_capability(p_actor_id,'cs.manage',false) or not private.operator_mfa_service_session_ok(p_actor_id,p_session_id) then$a$);
select private.t8_patch_function('public.service_record_review_export_v2(uuid,uuid,jsonb,text,integer,timestamp with time zone,text)',
$a$if not found or not private.has_operator_capability(p_actor_id,'cs.manage',false) then$a$,
$a$if not found or not private.has_operator_capability(p_actor_id,'cs.manage',false) or not private.operator_mfa_service_session_ok(p_actor_id,p_session_id) then$a$);

-- 3. 세션 끊기. auth.sessions를 지우면 refresh_tokens·mfa_amr_claims가 cascade로 지워진다.
create function private.operator_revoke_auth_sessions(p_user uuid) returns integer
language plpgsql volatile security definer set search_path='' as $$
declare removed integer;
begin
  if p_user is null then return 0; end if;
  delete from auth.sessions where user_id=p_user;
  get diagnostics removed=row_count;
  return removed;
end $$;
revoke all on function private.operator_revoke_auth_sessions(uuid) from public,anon,authenticated,service_role;

-- 권한 회수(역할 회수)와 최초 전환 때 미지정으로 회수되는 운영자의 세션을 같은 트랜잭션에서 끊는다.
select private.t8_patch_function('public.admin_change_operator_role(uuid,text,integer,bigint,uuid)',
$a$update public.profiles set role='user' where id=p_profile_id;$a$,
$a$update public.profiles set role='user' where id=p_profile_id;
    -- 회수한 운영자의 로그인 세션을 모두 끊는다(OPS-005). 이미 받은 access token은 만료까지 남지만 운영자 능력이 없다.
    perform private.operator_revoke_auth_sessions(p_profile_id);$a$);

select private.t8_patch_function('public.admin_activate_operator_access(jsonb,bigint,uuid)',
$a$if role_name is null then update public.profiles set role='user' where id=target;$a$,
$a$if role_name is null then update public.profiles set role='user' where id=target;
      -- 전환 때 회수되는 운영자의 로그인 세션도 끊는다(OPS-005).
      perform private.operator_revoke_auth_sessions(target);$a$);

-- 4. 관리 화면 문서: 스위치와 운영자별 등록 상태. 운영자는 지금 운영자 권한이 있는 계정(전환 전 호환 포함)이다.
create function private.operator_mfa_policy_document() returns jsonb
language sql stable security definer set search_path='' as $$
  with operators as (
    select p.id from public.profiles p
    where p.role in ('staff','admin') and private.operator_access_for(p.id)->>'mode'<>'none'
  ), factors as (
    select o.id,
      count(f.id) filter (where f.status::text='verified' and f.factor_type::text='totp') as verified,
      count(f.id) filter (where f.status::text<>'verified' and f.factor_type::text='totp') as unverified,
      max(f.updated_at) filter (where f.status::text='verified' and f.factor_type::text='totp') as verified_at
    from operators o left join auth.mfa_factors f on f.user_id=o.id group by o.id
  ), directory as (
    select r.value||jsonb_build_object('verifiedFactors',f.verified,'unverifiedFactors',f.unverified,'verifiedAt',f.verified_at) as entry
    from jsonb_array_elements(private.operator_directory_rows(coalesce((select array_agg(id) from operators),'{}'::uuid[]))) r
    join factors f on f.id=(r.value->>'id')::uuid
  )
  select jsonb_build_object('required',c.required,'revision',c.revision,'updatedAt',c.updated_at,
    'updatedBy',(select p.nickname from public.profiles p where p.id=c.updated_by),
    'operators',coalesce((select jsonb_agg(entry order by (entry->>'verifiedFactors')::integer,entry->>'nickname',entry->>'id') from directory),'[]'::jsonb),
    'unenrolledCount',(select count(*) from factors where verified=0))
  from private.operator_mfa_policy c where c.singleton;
$$;
revoke all on function private.operator_mfa_policy_document() from public,anon,authenticated,service_role;

-- volatile: 권한 가드가 잠금을 쓰므로 PostgREST 읽기 전용 트랜잭션에 들어가지 않게 한다(다른 admin_get_*와 같다).
create function public.admin_get_operator_mfa_policy() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform private.require_operator_capability('operators.manage',true);
  return private.operator_mfa_policy_document();
end $$;
revoke all on function public.admin_get_operator_mfa_policy() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_operator_mfa_policy() to authenticated;

-- 켜기: 켜는 사람의 지금 세션이 aal2여야 하고(본인부터 잠기지 않게), 운영자 전원이 TOTP를 등록해 있어야 한다.
-- 끄기: 켜진 동안에는 권한 가드가 이미 aal2를 요구한다. 2단계 인증 기기를 모두 잃은 비상 해제는 런북의 SQL로 한다.
create function public.admin_save_operator_mfa_policy(p_required boolean,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; previous private.operator_mfa_policy; saved private.operator_mfa_policy; request jsonb; receipt jsonb; unenrolled integer;
begin
  actor:=private.require_operator_capability('operators.manage',true);
  if p_required is null or p_expected_revision is null or p_expected_revision<1 or p_operation_id is null
    then raise invalid_parameter_value using message='invalid_operator_mfa_policy'; end if;
  request:=jsonb_build_object('required',p_required,'expectedRevision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended('operator-mfa-policy-operation:'||p_operation_id::text,0));
  receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.operator.mfa_policy',request);
  if receipt is not null then return receipt; end if;
  select * into previous from private.operator_mfa_policy where singleton for update;
  if not found then raise no_data_found using message='operator_mfa_policy_missing'; end if;
  if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='operator_mfa_policy_changed'; end if;
  if p_required and not previous.required then
    if not private.operator_mfa_session_verified(actor) then raise insufficient_privilege using message='operator_mfa_self_required'; end if;
    select count(*) into unenrolled from public.profiles p
    where p.role in ('staff','admin') and private.operator_access_for(p.id)->>'mode'<>'none'
      and not exists(select 1 from auth.mfa_factors f where f.user_id=p.id and f.status::text='verified' and f.factor_type::text='totp');
    if unenrolled>0 then raise invalid_parameter_value using message='operator_mfa_unenrolled', detail=unenrolled::text; end if;
  end if;
  update private.operator_mfa_policy set required=p_required,revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
    where singleton returning * into saved;
  receipt:=jsonb_build_object('required',saved.required,'revision',saved.revision,'updatedAt',saved.updated_at);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.operator.mfa_policy','operator_mfa_policy',
    jsonb_build_object('request',request,'before',jsonb_build_object('required',previous.required,'revision',previous.revision),'result',receipt));
  return receipt;
end $$;
revoke all on function public.admin_save_operator_mfa_policy(boolean,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_operator_mfa_policy(boolean,bigint,uuid) to authenticated;

-- 기기 분실 초기화: 최고 관리자(통합 매니저, 전환 전에는 admin)만. 본인은 내 보안 설정에서 직접 바꾼다.
-- 대상의 로그인 세션을 모두 끊고 감사 기록을 남긴다. 요소 삭제는 앱 서버가 이 RPC 성공 뒤 admin API로 하고, 삭제 뒤 같은 요청 ID로
-- 한 번 더 불러 그 사이 생긴 세션까지 끊는다(실패하면 같은 요청 ID로 다시 불러 같은 기록을 받고 삭제를 다시 시도한다).
create function public.admin_reset_operator_mfa(p_profile_id uuid,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; request jsonb; receipt jsonb; factor_count integer; revoked integer;
begin
  actor:=private.require_operator_capability('operators.manage',true);
  if p_profile_id is null or p_operation_id is null then raise invalid_parameter_value using message='invalid_operator_mfa_reset'; end if;
  request:=jsonb_build_object('profileId',p_profile_id);
  perform pg_advisory_xact_lock(hashtextextended('operator-mfa-reset-operation:'||p_operation_id::text,0));
  if private.operator_access_for(actor)->>'mode'='configured'
    and not exists(select 1 from private.operator_memberships m where m.profile_id=actor and m.manager_role='owner')
    then raise insufficient_privilege using message='operator_mfa_reset_owner_only'; end if;
  receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.operator.mfa_reset',request);
  if receipt is not null then
    -- 같은 요청의 재시도와 요소 삭제 뒤 마무리 호출도 세션을 다시 끊는다. 첫 시도와 요소 삭제 사이에 새로 만든 세션을 남기지 않는다.
    perform private.operator_revoke_auth_sessions(p_profile_id);
    return receipt;
  end if;
  if p_profile_id=actor then raise insufficient_privilege using message='operator_self_change_denied'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_profile_id and p.role in ('staff','admin'))
    then raise invalid_parameter_value using message='operator_mfa_reset_target_invalid'; end if;
  select count(*) into factor_count from auth.mfa_factors f where f.user_id=p_profile_id;
  revoked:=private.operator_revoke_auth_sessions(p_profile_id);
  receipt:=jsonb_build_object('profileId',p_profile_id,'factorCount',factor_count,'sessionsRevoked',revoked);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.operator.mfa_reset','profile:'||p_profile_id::text,
    jsonb_build_object('request',request,'result',receipt));
  return receipt;
end $$;
revoke all on function public.admin_reset_operator_mfa(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_reset_operator_mfa(uuid,uuid) to authenticated;

-- 4-1. 성능: 운영자 판정을 행마다 부르던 RLS 정책을 initplan(`(select ...)`)으로 감싸 문장마다 한 번만 판정한다.
-- 감싼 판정은 모두 상수 능력 이름만 받아 행에 의존하지 않는다. 판정 결과는 요청 JWT로 정해져 한 문장 안에서 바뀌지 않는다.
-- 정책 본문은 deparse한 식에서 판정 호출만 바꾸고(나머지 식은 그대로), 운영자 RLS 계약 지문을 기존 능력값으로 다시 적는다.
do $policies$
declare
  item record; qual text; check_expr text; next_qual text; next_check text; changed integer:=0;
  call_pattern constant text:='has_operator_capability\(('||chr(39)||'[a-z._]+'||chr(39)||'::text)(, (true|false))?\)';
begin
  for item in select c.oid as relid,n.nspname,c.relname,p.polname,p.polqual,p.polwithcheck,k.capability
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    left join private.operator_policy_contracts k on k.schema_name=n.nspname and k.table_name=c.relname and k.policy_name=p.polname
    where (n.nspname,c.relname,p.polname) in (
      ('public','admin_goods_drafts','admin_goods_drafts_owner_read'),
      ('public','coupon_redemptions','coupon_redemptions_select_own_or_staff'),
      ('public','coupons','coupons_select_held_or_staff'),
      ('public','goods_announcement_goods','goods_announcement_goods_staff_read'),
      ('public','goods_announcements','goods_announcements_staff_read'),
      ('public','goods_photo_library','goods_photo_library_staff_read'),
      ('public','goods_relation_hotspots','goods_relation_hotspots_operator_read'),
      ('public','home_curations','home_curations_staff_read'),
      ('public','loyalty_grade_events','loyalty_grade_events_select_own_or_staff'),
      ('public','order_cancellation_requests','gift_claims_private_read'),
      ('public','order_claim_collections','order_claim_collections_owner_staff'),
      ('public','order_shipment_email_jobs','shipment_email_jobs_staff_read'),
      ('public','order_shipment_extra_trackings','order_shipment_extra_trackings_owner_staff_read'),
      ('public','order_shipment_items','shipment_items_owner_staff_read'),
      ('public','order_shipments','shipments_owner_staff_read'),
      ('public','shopping_stories','shopping_stories_operator_read'),
      ('public','shopping_story_goods','shopping_story_goods_operator_read'),
      ('public','shopping_story_sections','shopping_story_sections_operator_read'),
      ('public','user_coupons','user_coupons_select_own_or_staff'))
  loop
    if item.capability is null then raise exception 't8_policy_contract_missing: %.%',item.relname,item.polname; end if;
    qual:=pg_get_expr(item.polqual,item.relid); check_expr:=pg_get_expr(item.polwithcheck,item.relid);
    if coalesce(qual,'')||coalesce(check_expr,'') ~ 'SELECT has_operator_capability' then
      raise exception 't8_policy_already_wrapped: %.%',item.relname,item.polname; end if;
    next_qual:=regexp_replace(qual,call_pattern,'( SELECT has_operator_capability(\1\2) AS has_operator_capability)','g');
    next_check:=regexp_replace(check_expr,call_pattern,'( SELECT has_operator_capability(\1\2) AS has_operator_capability)','g');
    if next_qual is not distinct from qual and next_check is not distinct from check_expr then
      raise exception 't8_policy_anchor_changed: %.%',item.relname,item.polname; end if;
    execute format('alter policy %I on %I.%I',item.polname,item.nspname,item.relname)
      ||case when next_qual is not null then format(' using (%s)',next_qual) else '' end
      ||case when next_check is not null then format(' with check (%s)',next_check) else '' end;
    perform private.register_operator_policy_contract(item.relid::regclass,item.polname,item.capability);
    changed:=changed+1;
  end loop;
  if changed<>19 then raise exception 't8_policy_count_changed: %',changed; end if;

  -- 상품 엑셀 반입 읽기 정책은 앞 판정이 이미 감싸져 있고, EXISTS 안의 관리자 판정 하나만 남아 있다.
  select c.oid,p.polname,p.polqual,k.capability into item
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    join private.operator_policy_contracts k on k.schema_name=n.nspname and k.table_name=c.relname and k.policy_name=p.polname
    where n.nspname='public' and c.relname='admin_goods_imports' and p.polname='admin_goods_imports_owner_read' and p.polwithcheck is null;
  if not found then raise exception 't8_policy_contract_missing: admin_goods_imports_owner_read'; end if;
  qual:=pg_get_expr(item.polqual,item.oid);
  if (length(qual)-length(replace(qual,'AND has_operator_capability(''platform.manage''::text, true))','')))
    /length('AND has_operator_capability(''platform.manage''::text, true))')<>1 then
    raise exception 't8_policy_anchor_changed: admin_goods_imports_owner_read'; end if;
  next_qual:=replace(qual,'AND has_operator_capability(''platform.manage''::text, true))',
    'AND ( SELECT has_operator_capability(''platform.manage''::text, true) AS has_operator_capability))');
  execute format('alter policy admin_goods_imports_owner_read on public.admin_goods_imports using (%s)',next_qual);
  perform private.register_operator_policy_contract('public.admin_goods_imports'::regclass,'admin_goods_imports_owner_read',item.capability);
end $policies$;

-- 5. 운영자 계약 지문. 바꾼 함수는 기존 분류값 그대로, 새 함수는 새로 적는다.
select private.register_operator_rpc_contract('public.admin_current_operator_access()'::regprocedure,'home','manual',false);
select private.register_operator_rpc_contract('public.admin_change_operator_role(uuid,text,integer,bigint,uuid)'::regprocedure,'operators.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_activate_operator_access(jsonb,bigint,uuid)'::regprocedure,'operators.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_get_operator_mfa_policy()'::regprocedure,'operators.manage','read',true);
select private.register_operator_rpc_contract('public.admin_save_operator_mfa_policy(boolean,bigint,uuid)'::regprocedure,'operators.manage','write',true);
select private.register_operator_rpc_contract('public.admin_reset_operator_mfa(uuid,uuid)'::regprocedure,'operators.manage','write',true);
-- 2-1에서 본문을 바꾼 함수는 등록된 분류값 그대로 지문을 다시 적는다.
do $register$
declare item record;
begin
  for item in select c.signature,c.capability,c.guard_kind,c.legacy_admin_only from private.operator_rpc_contracts c
    where to_regprocedure(c.signature) in ('public.service_inquiry_file_download(uuid,uuid,uuid,uuid)'::regprocedure,
      'public.service_export_bank_transfer_refund_accounts(uuid,uuid,uuid,jsonb)'::regprocedure,
      'public.service_export_order_partial_cancellation_refund_accounts(uuid,uuid,uuid,jsonb)'::regprocedure,
      'public.service_resolve_order_partial_cancellation(uuid,text,text,text,bigint,uuid,uuid)'::regprocedure,
      'public.service_record_review_export(uuid,uuid,jsonb,text,integer,timestamp with time zone,text)'::regprocedure,
      'public.service_record_review_export_v2(uuid,uuid,jsonb,text,integer,timestamp with time zone,text)'::regprocedure)
  loop
    perform private.register_operator_rpc_contract(item.signature::regprocedure,item.capability,item.guard_kind,item.legacy_admin_only);
  end loop;
  perform private.register_operator_internal_contract(to_regprocedure(c.signature)) from private.operator_internal_contracts c
    where to_regprocedure(c.signature) in ('private.contact_require_identity(uuid,uuid,text,boolean,uuid[],boolean)'::regprocedure,
      'private.digital_operator_session(uuid,uuid)'::regprocedure,'private.inquiry_file_session(uuid,uuid,boolean)'::regprocedure,
      'public.service_inquiry_file_download(uuid,uuid,uuid,uuid)'::regprocedure,
      'public.service_export_bank_transfer_refund_accounts(uuid,uuid,uuid,jsonb)'::regprocedure,
      'public.service_export_order_partial_cancellation_refund_accounts(uuid,uuid,uuid,jsonb)'::regprocedure,
      'public.service_resolve_order_partial_cancellation(uuid,text,text,text,bigint,uuid,uuid)'::regprocedure,
      'public.service_record_review_export(uuid,uuid,jsonb,text,integer,timestamp with time zone,text)'::regprocedure,
      'public.service_record_review_export_v2(uuid,uuid,jsonb,text,integer,timestamp with time zone,text)'::regprocedure);
end $register$;
select private.register_operator_internal_contract(signature::regprocedure) from (values
  ('private.has_operator_capability(uuid,text,boolean)'),
  ('private.require_actor_operator_capability(uuid,text,boolean)'),
  ('private.operator_mfa_required()'),
  ('private.operator_mfa_session_ok(uuid,uuid)'),
  ('private.operator_mfa_service_session_ok(uuid,uuid)'),
  ('private.operator_mfa_session_verified(uuid)'),
  ('private.operator_mfa_blocks(uuid)'),
  ('private.operator_revoke_auth_sessions(uuid)'),
  ('private.operator_mfa_policy_document()')
) as target(signature);

drop function private.t8_patch_function(text,text,text);
commit;
