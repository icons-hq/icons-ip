-- 탈퇴 처리 때 프로필 개인정보 익명화·성인 인증 기록 파기(원장 CUS-036 잔여, 2026-11-19 사용자 결정).
--
-- #683·#688의 탈퇴 처리(private.process_member_withdrawal)는 정지·주소록·휴대폰·마케팅 동의·세션을 지우지만 프로필의
-- 닉네임·생년월일·프로필 사진과 성인 인증 기록은 그대로 남았다. 이 migration은 다음을 더한다.
--   1. private.erase_withdrawn_member_profile(회원): 닉네임 → '탈퇴한 회원 <회원 id 해시 앞 6자리>'(겹치면 자리를 늘림),
--      생년월일·프로필 사진 경로 → null, 프로필 사진 후보 기록(profile_avatar_claims) 삭제, 성인 인증 기록(private.adult_verifications·
--      adult_verification_sessions — 공개 처리방침 제3조가 탈퇴 시 파기를 약속한다) 삭제. 이메일은 남긴다(같은 이메일 재가입 차단·거래 조회).
--      이미 익명화된 프로필은 건드리지 않는 멱등 함수다. public_profiles는 기존 트리거(sync_public_profile)가 따라간다.
--      생년월일은 가입 때 만 14세 확인에만 쓰고, 19금 판매 판정은 성인 인증 기록을 읽는데 정지 회원은 어차피 구매할 수 없으며,
--      법정 snapshot은 DOB·성인 인증을 보존하지 않는다(정책 §5) — 법정 기록에 영향이 없다.
--   2. 탈퇴 처리(process_member_withdrawal)가 위 함수를 부르고, 감사·결과 erased에 칸 이름(profileFields)과 지운 성인 인증 행 수만 남긴다.
--   3. 이 migration 전에 이미 처리된 회원: 같은 함수로 migration 끝에서 백필하고, 처리 RPC의 재처리(already_processed) 분기도
--      익명화되지 않은 프로필이면 같은 함수를 멱등으로 적용한다(private.reconcile_withdrawn_member_profile, 감사 한 번).
--   4. 프로필 사진 Storage 객체는 DB가 지울 수 없다. 처리 기록에 '지울 사진 있음'(avatar_erase_pending)을 남기고, 앱 서버가
--      그 회원의 `<id>/profile/` 접두 객체 전체(교체 때 정리 실패한 이전 파일·업로드만 한 후보 포함)를 Storage API로 지운 뒤
--      admin_confirm_member_withdrawal_avatar_erased가 storage.objects에 그 접두 객체가 0개인지 직접 확인해 기록·감사한다.
--   5. 처리한 회원의 프로필 쓰기 봉인: 처리 뒤 남은 access token(최대 1시간)으로 본인이 닉네임·생년월일·사진·동의를 되살리지 못하게
--      guard_account_profile_update가 member_withdrawn으로 거절한다(마케팅 철회는 허용). 처리 함수 자신의 갱신은 트랜잭션 로컬
--      플래그(app.member_withdrawal_profile_write)로만 통과해 Phase 1 탈퇴 신청 fence가 있는 회원도 처리할 수 있다.
-- 기존 함수는 pg_get_functiondef + 앵커 치환으로 바꾼다. 운영자 계약 지문은 새 RPC 2개만 등록한다(기존 RPC의 본문은 바뀌지 않았다).
begin;

create function private.o3i_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 'o3i patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 처리 기록: 지울 프로필 사진 파일이 남았는가. 확인되면 시각·처리자만 남긴다.
alter table private.member_withdrawal_processings
  add column avatar_erase_pending boolean not null default false,
  add column avatar_erased_at timestamptz,
  add column avatar_erased_by uuid references public.profiles(id) on delete set null,
  add constraint member_withdrawal_processings_avatar_state check (
    (not avatar_erase_pending or avatar_erased_at is null)
    and (avatar_erased_by is null or avatar_erased_at is not null));

-- 2. 프로필 쓰기 봉인(처리한 회원). 처리 함수는 app.member_withdrawal_profile_write에 대상 id를 적고(트랜잭션 로컬) 갱신한다.
select private.o3i_patch_function('private.guard_account_profile_update()'::regprocedure, array[
$a$begin
  if private.is_account_write_fenced(new.id)$a$,
$a$begin
  if pg_catalog.current_setting('app.member_withdrawal_profile_write', true) is distinct from new.id::text
    and (new.nickname is distinct from old.nickname
      or new.birth_date is distinct from old.birth_date
      or new.avatar_path is distinct from old.avatar_path
      or (new.consents is distinct from old.consents and not (
        new.consents->'marketing' = 'false'::jsonb and new.consents - 'marketing' = old.consents - 'marketing')))
    and exists (select 1 from private.member_withdrawal_processings w where w.user_id = new.id)
  then
    raise object_not_in_prerequisite_state using message = 'member_withdrawn';
  end if;
  if pg_catalog.current_setting('app.member_withdrawal_profile_write', true) is distinct from new.id::text
    and private.is_account_write_fenced(new.id)$a$
]);

-- 3. 프로필 익명화·성인 인증 기록 파기(멱등). 호출자가 처리 기록을 맞춘다. 반환: 바꾼 칸 이름·지운 성인 인증 행 수·사진 파일 정리 필요 여부.
create function private.erase_withdrawn_member_profile(p_target uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  old_avatar text;
  had_birth boolean;
  old_nickname text;
  already boolean;
  anonymous_nickname text;
  anonymous_length integer := 6;
  fields jsonb := '[]'::jsonb;
  adult_rows integer := 0;
  step_rows integer;
  has_files boolean;
begin
  perform pg_catalog.set_config('app.member_withdrawal_profile_write', p_target::text, true);
  select p.avatar_path, p.birth_date is not null, p.nickname into old_avatar, had_birth, old_nickname
  from public.profiles p where p.id = p_target for update;
  if not found then raise no_data_found using message = 'profile_not_found'; end if;

  already := coalesce(old_nickname ~ '^탈퇴한 회원 [0-9a-f]{6,32}$'
    and pg_catalog.starts_with(pg_catalog.md5(p_target::text), pg_catalog.substr(old_nickname, 8)), false);
  if not already then
    loop
      anonymous_nickname := '탈퇴한 회원 ' || pg_catalog.left(pg_catalog.md5(p_target::text), anonymous_length);
      exit when anonymous_length >= 32 or not exists (
        select 1 from public.profiles o where o.id <> p_target
          and pg_catalog.lower(pg_catalog.btrim(o.nickname, E' \t\n\r\f\v')) = anonymous_nickname);
      anonymous_length := anonymous_length + 1;
    end loop;
    fields := fields || pg_catalog.jsonb_build_array('nickname');
  else
    anonymous_nickname := old_nickname;
  end if;
  if had_birth then fields := fields || pg_catalog.jsonb_build_array('birthDate'); end if;
  if old_avatar is not null then fields := fields || pg_catalog.jsonb_build_array('avatar'); end if;
  if not already or had_birth or old_avatar is not null then
    update public.profiles set nickname = anonymous_nickname, birth_date = null, avatar_path = null where id = p_target;
  end if;

  delete from public.profile_avatar_claims where user_id = p_target;
  delete from private.adult_verifications where user_id = p_target;
  get diagnostics step_rows = row_count;
  adult_rows := step_rows;
  delete from private.adult_verification_sessions where user_id = p_target;
  get diagnostics step_rows = row_count;
  adult_rows := adult_rows + step_rows;

  has_files := old_avatar is not null or exists (
    select 1 from storage.objects o where o.bucket_id = 'user-uploads' and o.name like p_target::text || '/profile/%');
  perform pg_catalog.set_config('app.member_withdrawal_profile_write', '', true);
  return pg_catalog.jsonb_build_object('profileFields', fields, 'adultVerifications', adult_rows, 'avatarPending', has_files);
end $$;
alter function private.erase_withdrawn_member_profile(uuid) owner to postgres;
revoke all on function private.erase_withdrawn_member_profile(uuid) from public, anon, authenticated, service_role;

-- 3-1. 이미 처리된 회원(이 migration 전 처리분·재처리 요청)에 같은 익명화를 맞춘다. 바뀐 것이 있을 때만 감사를 남긴다.
create function private.reconcile_withdrawn_member_profile(p_actor uuid, p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare result jsonb; processing private.member_withdrawal_processings;
begin
  select * into processing from private.member_withdrawal_processings w where w.user_id = p_target for update;
  if not found then return; end if;
  result := private.erase_withdrawn_member_profile(p_target);
  if (result->>'avatarPending')::boolean and processing.avatar_erased_at is null and not processing.avatar_erase_pending then
    update private.member_withdrawal_processings set avatar_erase_pending = true where user_id = p_target;
  end if;
  if result->'profileFields' <> '[]'::jsonb or (result->>'adultVerifications')::integer > 0 then
    insert into public.audit_log (actor_id, action, target, diff)
    values (p_actor, 'admin.member.withdrawal_profile_anonymized', 'profile:' || p_target::text,
      pg_catalog.jsonb_build_object('profileFields', result->'profileFields', 'adultVerifications', result->'adultVerifications'));
  end if;
end $$;
alter function private.reconcile_withdrawn_member_profile(uuid, uuid) owner to postgres;
revoke all on function private.reconcile_withdrawn_member_profile(uuid, uuid) from public, anon, authenticated, service_role;

-- 4. 처리 트랜잭션.
select private.o3i_patch_function('private.process_member_withdrawal(uuid,uuid,text,bigint,text,text)'::regprocedure, array[
$a$  erased jsonb;
begin
$a$,
$a$  erased jsonb;
  anonymized jsonb;
begin
$a$,
$a$  erased_address := private.erase_member_address_book(p_target);
$a$,
$a$  -- 이 트랜잭션의 프로필 갱신(동의 철회·익명화)은 처리한 회원의 프로필 쓰기 봉인과 탈퇴 신청 fence를 통과한다.
  perform pg_catalog.set_config('app.member_withdrawal_profile_write', p_target::text, true);
  erased_address := private.erase_member_address_book(p_target);
$a$,
$a$  revoked := private.revoke_member_auth_sessions(p_target);
$a$,
$a$  -- 프로필 익명화(닉네임·생년월일·사진 경로)·성인 인증 기록 파기. 이메일은 남긴다.
  anonymized := private.erase_withdrawn_member_profile(p_target);

  revoked := private.revoke_member_auth_sessions(p_target);
$a$,
$a$'restockAlerts', erased_restock_alerts)$a$,
$a$'restockAlerts', erased_restock_alerts,
    'profileFields', anonymized->'profileFields',
    'adultVerifications', (anonymized->>'adultVerifications')::integer)$a$,
$a$kakao_unlink_event_id, processed_by, processed_at)$a$,
$a$kakao_unlink_event_id, processed_by, processed_at, avatar_erase_pending)$a$,
$a$p_kakao_event_id, p_actor, changed_at);$a$,
$a$p_kakao_event_id, p_actor, changed_at, (anonymized->>'avatarPending')::boolean);$a$
]);

-- 4-1. 재처리: 이미 처리된 회원이면 익명화되지 않은 프로필을 같은 규칙으로 맞춘다.
select private.o3i_patch_function('private.check_member_withdrawal_request(uuid,uuid,text)'::regprocedure, array[
$a$    revoked := private.revoke_member_auth_sessions(p_target);
$a$,
$a$    perform private.reconcile_withdrawn_member_profile(p_actor, p_target);
    revoked := private.revoke_member_auth_sessions(p_target);
$a$
]);

-- 5. 처리 상태 문서: 처리한 회원에게 지울 프로필 사진 파일이 남았는지(avatarErasePending). 처리 전 문서 모양은 그대로다.
select private.o3i_patch_function('private.member_withdrawal_document(uuid)'::regprocedure, array[
$a$'signinBlocked', w.signin_blocked_at is not null, 'signinBlockedAt', w.signin_blocked_at)$a$,
$a$'signinBlocked', w.signin_blocked_at is not null, 'signinBlockedAt', w.signin_blocked_at,
       'avatarErasePending', w.avatar_erase_pending)$a$
]);

-- 6. 지울 사진 접두 읽기(앱 서버가 Storage API로 지울 대상). 처리했고 아직 안 지운 회원만 접두를 돌려준다.
create function public.admin_member_withdrawal_avatar_prefix(target_profile_id uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_operator_capability('platform.manage', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if target_profile_id is null then raise invalid_parameter_value using message = 'invalid_member_withdrawal'; end if;
  return (select target_profile_id::text || '/profile/' from private.member_withdrawal_processings w
    where w.user_id = target_profile_id and w.avatar_erase_pending);
end $$;
alter function public.admin_member_withdrawal_avatar_prefix(uuid) owner to postgres;
revoke all on function public.admin_member_withdrawal_avatar_prefix(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_member_withdrawal_avatar_prefix(uuid) to authenticated;

-- 7. 사진 삭제 확인. 그 접두 객체가 storage.objects에 0개인지 직접 읽어 확인한 뒤에만 기록한다. 재호출은 replayed.
create function public.admin_confirm_member_withdrawal_avatar_erased(target_profile_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  processing private.member_withdrawal_processings;
  confirmed_at timestamptz;
begin
  perform private.lock_operator_subjects(array[actor, target_profile_id]);
  perform private.require_operator_capability('platform.manage', false);
  if target_profile_id is null then raise invalid_parameter_value using message = 'invalid_member_withdrawal'; end if;

  select * into processing from private.member_withdrawal_processings w where w.user_id = target_profile_id for update;
  if not found then raise no_data_found using message = 'member_withdrawal_not_processed'; end if;
  if not processing.avatar_erase_pending then
    return private.member_withdrawal_document(target_profile_id) || jsonb_build_object('replayed', true);
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'user-uploads' and o.name like target_profile_id::text || '/profile/%') then
    raise check_violation using message = 'member_withdrawal_avatar_not_erased';
  end if;

  confirmed_at := greatest(pg_catalog.clock_timestamp(), processing.processed_at);
  update private.member_withdrawal_processings
  set avatar_erase_pending = false, avatar_erased_at = confirmed_at, avatar_erased_by = actor
  where user_id = target_profile_id;
  insert into public.audit_log (actor_id, action, target, diff)
  values (actor, 'admin.member.withdrawal_avatar_erased', 'profile:' || target_profile_id::text,
    jsonb_build_object('inquiryReference', processing.inquiry_reference)
      || case when processing.basis = 'inquiry' then '{}'::jsonb else jsonb_build_object('basis', processing.basis) end);
  return private.member_withdrawal_document(target_profile_id) || jsonb_build_object('replayed', false);
end $$;
alter function public.admin_confirm_member_withdrawal_avatar_erased(uuid) owner to postgres;
revoke all on function public.admin_confirm_member_withdrawal_avatar_erased(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_confirm_member_withdrawal_avatar_erased(uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_member_withdrawal_avatar_prefix(uuid)'::regprocedure, 'platform.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_confirm_member_withdrawal_avatar_erased(uuid)'::regprocedure, 'platform.manage', 'write', false);

-- 8. 이 migration 전에 이미 처리된 회원 백필(운영자 없음 — 감사 actor는 비운다).
do $$ declare target uuid; begin
  for target in select w.user_id from private.member_withdrawal_processings w order by w.user_id loop
    perform private.reconcile_withdrawn_member_profile(null, target);
  end loop;
end $$;

drop function private.o3i_patch_function(regprocedure, text[]);

notify pgrst, 'reload schema';
commit;
