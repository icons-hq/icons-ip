-- 탈퇴 처리 때 프로필 개인정보 익명화(원장 CUS-036 잔여, 2026-11-19 사용자 결정).
--
-- #683·#688의 탈퇴 처리(private.process_member_withdrawal)는 정지·주소록·휴대폰·마케팅 동의·세션을 지우지만 프로필의
-- 닉네임·생년월일·프로필 사진은 그대로 남았다. 이 migration은 처리 트랜잭션에서 다음을 더한다.
--   1. 닉네임 → '탈퇴한 회원 <회원 id 해시 앞 6자리>'(다른 회원과 겹치면 자리를 늘린다), 생년월일 → null, 프로필 사진 경로 → null.
--      이메일은 남긴다(같은 이메일 재가입 차단·거래 조회, docs/account-deletion-retention-policy.md §5). public_profiles는
--      기존 트리거(sync_public_profile)가 같은 트랜잭션에서 맞춘다 — 리뷰·커뮤니티·문의 작성자 표시가 새 이름으로 바뀐다.
--      생년월일은 가입 때 만 14세 확인에만 쓴다. 19금 판매 성인 확인 증빙은 성인 인증 기록(KCP 결과 요약)이 따로 갖고
--      법정 snapshot은 DOB를 보존하지 않으므로(정책 §5 '원문 연락처·프로필·DOB를 보존하지 않음') 법정 기록에 영향이 없다.
--   2. 프로필 사진 Storage 객체는 DB가 지울 수 없다. 처리 기록에 지울 경로(avatar_erase_path)를 남기고, 앱 서버가 Storage API로
--      지운 뒤 admin_confirm_member_withdrawal_avatar_erased가 storage.objects에서 사라졌는지 직접 확인해 기록·감사한다
--      (재로그인 차단과 같은 방식). 실패하면 고객 상세의 '다시 적용'으로 재시도한다.
--   3. 감사 diff와 처리 결과의 erased에 익명화한 칸 이름(profileFields)만 남긴다(값 없음). 처리 상태 문서에는
--      avatarErasePending(지울 사진이 남았는가)을 더한다.
-- 처리 전 상태·문의 근거·카카오 근거 회원의 나머지 동작은 그대로다. 기존 함수는 pg_get_functiondef + 앵커 치환으로 바꾼다.
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

-- 1. 지울 프로필 사진 경로. 지우기 전까지만 경로를 갖고(pending), 확인되면 경로를 비우고 시각·처리자만 남긴다.
alter table private.member_withdrawal_processings
  add column avatar_erase_path text,
  add column avatar_erased_at timestamptz,
  add column avatar_erased_by uuid references public.profiles(id) on delete set null,
  add constraint member_withdrawal_processings_avatar_state check (
    (avatar_erase_path is null or avatar_erased_at is null)
    and (avatar_erased_by is null or avatar_erased_at is not null));

-- 2. 처리 트랜잭션: 익명화와 지울 사진 경로 기록, 처리 결과·감사의 erased에 익명화한 칸 이름.
select private.o3i_patch_function('private.process_member_withdrawal(uuid,uuid,text,bigint,text,text)'::regprocedure, array[
$a$  erased jsonb;
begin
$a$,
$a$  erased jsonb;
  old_avatar text;
  had_birth boolean;
  anonymous_nickname text;
  anonymous_length integer := 6;
  anonymized_fields jsonb;
begin
$a$,
$a$  revoked := private.revoke_member_auth_sessions(p_target);
$a$,
$a$  -- 프로필 익명화: 닉네임은 '탈퇴한 회원 <해시>'(다른 회원과 겹치면 자리를 늘림), 생년월일·프로필 사진은 비운다. 이메일은 남긴다.
  select p.avatar_path, p.birth_date is not null into old_avatar, had_birth from public.profiles p where p.id = p_target for update;
  loop
    anonymous_nickname := '탈퇴한 회원 ' || pg_catalog.left(pg_catalog.md5(p_target::text), anonymous_length);
    exit when anonymous_length >= 32 or not exists (
      select 1 from public.profiles o where o.id <> p_target
        and pg_catalog.lower(pg_catalog.btrim(o.nickname, E' \t\n\r\f\v')) = anonymous_nickname);
    anonymous_length := anonymous_length + 1;
  end loop;
  anonymized_fields := pg_catalog.jsonb_build_array('nickname')
    || case when had_birth then pg_catalog.jsonb_build_array('birthDate') else '[]'::jsonb end
    || case when old_avatar is not null then pg_catalog.jsonb_build_array('avatar') else '[]'::jsonb end;
  update public.profiles set nickname = anonymous_nickname, birth_date = null, avatar_path = null where id = p_target;

  revoked := private.revoke_member_auth_sessions(p_target);
$a$,
$a$'restockAlerts', erased_restock_alerts)$a$,
$a$'restockAlerts', erased_restock_alerts,
    'profileFields', anonymized_fields)$a$,
$a$kakao_unlink_event_id, processed_by, processed_at)$a$,
$a$kakao_unlink_event_id, processed_by, processed_at, avatar_erase_path)$a$,
$a$p_kakao_event_id, p_actor, changed_at);$a$,
$a$p_kakao_event_id, p_actor, changed_at, old_avatar);$a$
]);

-- 3. 처리 상태 문서: 처리한 회원에게 지울 프로필 사진이 남았는지(avatarErasePending). 처리 전 문서 모양은 그대로다.
select private.o3i_patch_function('private.member_withdrawal_document(uuid)'::regprocedure, array[
$a$'signinBlocked', w.signin_blocked_at is not null, 'signinBlockedAt', w.signin_blocked_at)$a$,
$a$'signinBlocked', w.signin_blocked_at is not null, 'signinBlockedAt', w.signin_blocked_at,
       'avatarErasePending', w.avatar_erase_path is not null)$a$
]);

-- 4. 지울 사진 경로 읽기(앱 서버가 Storage API로 지울 대상). 처리했고 아직 안 지운 회원만 경로를 돌려준다.
create function public.admin_member_withdrawal_avatar_path(target_profile_id uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_operator_capability('platform.manage', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if target_profile_id is null then raise invalid_parameter_value using message = 'invalid_member_withdrawal'; end if;
  return (select w.avatar_erase_path from private.member_withdrawal_processings w where w.user_id = target_profile_id);
end $$;
alter function public.admin_member_withdrawal_avatar_path(uuid) owner to postgres;
revoke all on function public.admin_member_withdrawal_avatar_path(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_member_withdrawal_avatar_path(uuid) to authenticated;

-- 5. 사진 삭제 확인. 객체가 storage.objects에서 사라졌는지 직접 읽어 확인한 뒤에만 기록한다. 재호출은 replayed.
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
  if processing.avatar_erase_path is null then
    return private.member_withdrawal_document(target_profile_id) || jsonb_build_object('replayed', true);
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'user-uploads' and o.name = processing.avatar_erase_path) then
    raise check_violation using message = 'member_withdrawal_avatar_not_erased';
  end if;

  confirmed_at := greatest(pg_catalog.clock_timestamp(), processing.processed_at);
  update private.member_withdrawal_processings
  set avatar_erase_path = null, avatar_erased_at = confirmed_at, avatar_erased_by = actor
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

-- 운영자 계약 지문. 새 RPC는 분류를 등록하고, 재정의한 처리 RPC 둘은 기존 분류 그대로 다시 등록한다(함수 본문은 private 쪽만 바뀌었다).
select private.register_operator_rpc_contract('public.admin_member_withdrawal_avatar_path(uuid)'::regprocedure, 'platform.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_confirm_member_withdrawal_avatar_erased(uuid)'::regprocedure, 'platform.manage', 'write', false);

drop function private.o3i_patch_function(regprocedure, text[]);

notify pgrst, 'reload schema';
commit;
