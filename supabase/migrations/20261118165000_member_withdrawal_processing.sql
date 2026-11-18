-- 문의로 받은 회원 탈퇴의 운영자 처리(원장 CUS-036·CUS-035·OPS-021).
--
-- 탈퇴 신청 기능(#137 Phase 1)은 readiness 값 없이는 켜지지 않아 탈퇴는 1:1 문의로 받는다. 지금까지의 처리 절차는
-- '어드민에서 정지 + SQL 편집기에서 private.erase_member_address_book 실행 + 수기 기록'이라 SQL 권한자만 처리할 수 있었고
-- 감사가 남지 않았으며 휴대폰 번호·마케팅 수신 동의·로그인 세션은 그대로 남았다. 이 migration은 그 임시 절차를 어드민
-- 고객 상세의 '탈퇴 요청 처리' 한 동작으로 시스템화한다.
--
-- 이 동작은 hard delete가 아니다. 정책(docs/account-deletion-retention-policy.md §1·§2)이 정한 완전한 탈퇴 —
-- 법정 snapshot 분리 → 메일 fence → hard delete → 별도 compliance 프로젝트 tombstone — 의 선행 조건이 아직 없으므로
-- 프로필(이메일·닉네임·생년월일)·Auth 사용자·거래 기록·커뮤니티 작성물·Storage 객체는 남긴다. 지우는 것은 법정 보존 대상이
-- 아니고 탈퇴 봉인(account_action_fences) 트리거가 지우는 것과 같은 범위다.
--
-- public.admin_process_member_withdrawal(회원, 문의 번호, 처리 메모) — platform.manage(회원 관리·정지와 같은 권한):
--   · 문의 번호는 그 회원이 쓴 1:1 문의여야 한다(본인 요청의 근거).
--   · 진행 중 의무(private.account_deletion_blockers — 탈퇴 신청과 같은 판정)와 운영자 소속이 있으면 아무것도 바꾸지 않고
--     남은 의무를 돌려준다(status blocked).
--   · 한 트랜잭션에서: 정지(public.admin_suspend_user — 정지 감사 포함), 주소록(private.erase_member_address_book),
--     휴대폰 번호·인증 요청·이력(private.erase_member_phone), 마케팅 정보 수신 동의 전 수단 철회(원장에 source
--     member_withdrawal로 기록, 파생값 consents.marketing=false), 성별(고객 통계 동의) 철회, 활동 기록·동의 철회, 진행 중
--     이메일 변경 요청, 재입고 알림 신청 삭제, 로그인 세션(auth.sessions·refresh token) 삭제.
--   · 처리 기록(private.member_withdrawal_processings)과 감사 로그(admin.member.withdrawal_processed: 문의 번호·지운 개수,
--     개인정보 원문·메모 없음)를 남긴다. 다시 부르면 처음 기록을 돌려주고(멱등) 그 사이 생긴 세션만 다시 끊는다.
-- 재로그인 차단은 Supabase Auth 관리 API(ban)가 맡는다 — DB가 할 수 없고 관리 API에는 사용자 id로 세션을 끊는 호출이
-- 없어서 세션 삭제는 위 RPC가, 로그인·토큰 갱신 차단은 앱 서버가 관리 API로 한다. 앱은 차단을 적용한 뒤
-- public.admin_confirm_member_withdrawal_signin_block으로 auth.users.banned_until을 DB가 직접 확인해 기록·감사한다.
-- 탈퇴 처리한 계정은 정지 해제를 막는다(admin_unsuspend_user).
begin;

create function private.t10_withdrawal_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't10 withdrawal patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 처리 기록. 회원당 한 행 — 처리 사실·문의 번호·처리자와 재로그인 차단 확인 시각만 둔다(개인정보 원문 없음).
--    회원 프로필이 나중에 hard delete되면 함께 지워진다(그때는 compliance tombstone이 이어받는다).
create table private.member_withdrawal_processings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  inquiry_reference bigint not null check (inquiry_reference > 0),
  processed_by uuid references public.profiles(id) on delete set null,
  processed_at timestamptz not null default clock_timestamp(),
  signin_blocked_at timestamptz,
  signin_blocked_by uuid references public.profiles(id) on delete set null,
  check (signin_blocked_by is null or signin_blocked_at is not null),
  check (signin_blocked_at is null or signin_blocked_at >= processed_at)
);
alter table private.member_withdrawal_processings owner to postgres;
alter table private.member_withdrawal_processings enable row level security;
revoke all on private.member_withdrawal_processings from public, anon, authenticated, service_role;
comment on table private.member_withdrawal_processings is
  '문의로 받은 회원 탈퇴의 운영자 처리 기록(admin_process_member_withdrawal). hard delete가 아니라 정지·비법정 개인정보 삭제·세션 종료까지다 — 남는 항목과 이유는 docs/account-deletion-retention-policy.md §5.';

-- 2. 마케팅 정보 수신 동의 원장의 출처에 '탈퇴 처리'를 더한다(철회 기록의 근거, 정보통신망법 제50조).
alter table private.customer_marketing_consents drop constraint customer_marketing_consents_source_check;
alter table private.customer_marketing_consents add constraint customer_marketing_consents_source_check
  check (source in ('legacy', 'legacy_app', 'onboarding', 'settings', 'member_withdrawal'));
alter table private.customer_marketing_consent_events drop constraint customer_marketing_consent_events_source_check;
alter table private.customer_marketing_consent_events add constraint customer_marketing_consent_events_source_check
  check (source in ('legacy', 'legacy_app', 'onboarding', 'settings', 'member_withdrawal'));

-- 3. 로그인 세션 종료. 세션 행을 지우면 refresh token·MFA 기록이 함께 지워지고(외래키 cascade) Auth의 사용자 조회가
--    'session_not_found'로 실패한다. 세션 없는 옛 refresh token도 지운다. 이미 발급된 access token은 만료(기본 1시간)까지
--    PostgREST에서 유효하지만 정지로 보호 액션은 막힌다. 지운 세션 수를 돌려준다.
create function private.revoke_member_auth_sessions(p_user_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare revoked integer;
begin
  if p_user_id is null then raise invalid_parameter_value using message = 'member_withdrawal_member_required'; end if;
  delete from auth.refresh_tokens where user_id = p_user_id::text and session_id is null;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics revoked = row_count;
  return revoked;
end $$;
alter function private.revoke_member_auth_sessions(uuid) owner to postgres;
revoke all on function private.revoke_member_auth_sessions(uuid) from public, anon, authenticated, service_role;

-- 4. 화면이 읽는 처리 상태(처리 전이면 processed=false).
create function private.member_withdrawal_document(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('processed', true, 'processedAt', w.processed_at, 'inquiryReference', w.inquiry_reference,
       'signinBlocked', w.signin_blocked_at is not null, 'signinBlockedAt', w.signin_blocked_at)
     from private.member_withdrawal_processings w where w.user_id = p_user_id),
    jsonb_build_object('processed', false, 'processedAt', null, 'inquiryReference', null,
      'signinBlocked', false, 'signinBlockedAt', null));
$$;
alter function private.member_withdrawal_document(uuid) owner to postgres;
revoke all on function private.member_withdrawal_document(uuid) from public, anon, authenticated, service_role;

-- 5. 처리. 잠금 순서는 정지와 같다(운영자·대상 계정 행동 잠금 → 프로필 → 각 저장소 잠금).
create function public.admin_process_member_withdrawal(target_profile_id uuid, target_inquiry_reference bigint, target_note text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  note text := pg_catalog.btrim(coalesce(target_note, ''), E' \t\n\r\f\v');
  inquiry_owner uuid;
  blockers jsonb;
  suspension jsonb;
  changed_at timestamptz;
  consent record;
  revoked integer;
  erased_address integer;
  erased_phone integer;
  withdrawn_marketing integer := 0;
  erased_demographics integer;
  erased_activity_events integer;
  withdrawn_activity integer;
  erased_email_changes integer;
  erased_restock_alerts integer;
  erased jsonb;
begin
  perform private.lock_operator_subjects(array[actor, target_profile_id]);
  perform private.require_operator_capability('platform.manage', false);

  if target_profile_id is null or target_inquiry_reference is null or target_inquiry_reference < 1
    or pg_catalog.char_length(note) not between 2 and 200 or pg_catalog.translate(note, E'\n\t', '') ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_member_withdrawal';
  end if;
  if target_profile_id = actor then
    raise exception 'cannot_withdraw_self' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target_profile_id) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  -- 이미 처리한 회원: 처음 기록을 돌려준다. 재로그인 차단 전에 다시 로그인했을 수 있어 세션만 다시 끊는다.
  if exists (select 1 from private.member_withdrawal_processings w where w.user_id = target_profile_id) then
    revoked := private.revoke_member_auth_sessions(target_profile_id);
    return private.member_withdrawal_document(target_profile_id)
      || jsonb_build_object('status', 'already_processed', 'revokedSessions', revoked);
  end if;

  select i.user_id into inquiry_owner from public.inquiries i where i.reference = target_inquiry_reference;
  if inquiry_owner is null or inquiry_owner <> target_profile_id then
    raise no_data_found using message = 'member_withdrawal_inquiry_not_found';
  end if;

  -- 탈퇴 신청과 같은 진행 중 의무 판정. 운영자 소속(매니저 역할)은 프로필 역할과 별개라 따로 본다.
  blockers := private.account_deletion_blockers(target_profile_id);
  if exists (select 1 from private.operator_memberships m where m.profile_id = target_profile_id)
    and not blockers @> '[{"code":"staff_handover"}]'::jsonb then
    blockers := blockers || jsonb_build_array(jsonb_build_object('code', 'staff_handover', 'count', 1, 'path', '/settings'));
  end if;
  if blockers <> '[]'::jsonb then
    return jsonb_build_object('status', 'blocked', 'blockers', blockers);
  end if;

  suspension := public.admin_suspend_user(target_profile_id,
    pg_catalog.left('탈퇴 요청 처리 · 문의 #' || target_inquiry_reference::text || ' · ' || note, 200));
  changed_at := pg_catalog.clock_timestamp();

  erased_address := private.erase_member_address_book(target_profile_id);
  erased_phone := private.erase_member_phone(target_profile_id);

  -- 마케팅 정보 수신 동의: 동의 중인 수단마다 철회를 원장에 남기고 파생값을 맞춘다(원장 먼저 — 동기화 트리거는 같으면 아무것도 하지 않는다).
  for consent in
    select c.channel, c.notice_version from private.customer_marketing_consents c
    where c.user_id = target_profile_id and c.agreed order by c.channel
  loop
    perform private.write_customer_marketing_consent(target_profile_id, consent.channel, false, consent.notice_version,
      'member_withdrawal', changed_at);
    withdrawn_marketing := withdrawn_marketing + 1;
  end loop;
  update public.profiles set consents = jsonb_set(coalesce(consents, '{}'::jsonb), '{marketing}', 'false'::jsonb, true)
  where id = target_profile_id and consents->'marketing' is distinct from 'false'::jsonb;

  -- 탈퇴 봉인 트리거(erase_fenced_customer_demographics·member_activity_fenced·erase_fenced_member_email_change)와 같은 범위.
  update private.customer_demographic_consents
  set choice = 'declined', gender = null, accepted_at = null, revision = revision + 1, updated_at = changed_at
  where user_id = target_profile_id and choice = 'accepted';
  get diagnostics erased_demographics = row_count;
  delete from private.member_activity_events where user_id = target_profile_id;
  get diagnostics erased_activity_events = row_count;
  update private.member_activity_consents
  set choice = 'declined', accepted_at = null, revision = revision + 1, updated_at = changed_at
  where user_id = target_profile_id and choice = 'accepted';
  get diagnostics withdrawn_activity = row_count;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-email:user:' || target_profile_id::text, 0));
  delete from private.member_email_change_challenges where user_id = target_profile_id;
  get diagnostics erased_email_changes = row_count;
  -- 재입고 알림은 정지와 무관하게 메일·알림을 보내므로 신청을 지운다.
  delete from public.restock_alerts where user_id = target_profile_id;
  get diagnostics erased_restock_alerts = row_count;

  revoked := private.revoke_member_auth_sessions(target_profile_id);
  erased := jsonb_build_object(
    'addressBookEntries', erased_address,
    'phoneNumbers', erased_phone,
    'marketingConsents', withdrawn_marketing,
    'demographicConsents', erased_demographics,
    'activityEvents', erased_activity_events,
    'activityConsents', withdrawn_activity,
    'emailChangeRequests', erased_email_changes,
    'restockAlerts', erased_restock_alerts);

  insert into private.member_withdrawal_processings (user_id, inquiry_reference, processed_by, processed_at)
  values (target_profile_id, target_inquiry_reference, actor, changed_at);
  insert into public.audit_log (actor_id, action, target, diff)
  values (actor, 'admin.member.withdrawal_processed', 'profile:' || target_profile_id::text, jsonb_build_object(
    'inquiryReference', target_inquiry_reference,
    'suspended', coalesce((suspension->>'changed')::boolean, false),
    'erased', erased,
    'revokedSessions', revoked));

  return private.member_withdrawal_document(target_profile_id) || jsonb_build_object(
    'status', 'processed',
    'suspended', coalesce((suspension->>'changed')::boolean, false),
    'erased', erased,
    'revokedSessions', revoked);
end $$;
alter function public.admin_process_member_withdrawal(uuid, bigint, text) owner to postgres;
revoke all on function public.admin_process_member_withdrawal(uuid, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_process_member_withdrawal(uuid, bigint, text) to authenticated;

-- 6. 재로그인 차단 확인. 앱 서버가 Auth 관리 API로 차단(ban)을 적용한 뒤 부른다. 앱의 말을 믿지 않고 auth.users.banned_until을
--    직접 읽어 장기 차단이 걸려 있을 때만 기록·감사한다. 차단 직전에 생긴 세션도 다시 끊는다. 이미 확인했으면 그 기록을 돌려준다.
create function public.admin_confirm_member_withdrawal_signin_block(target_profile_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  processing private.member_withdrawal_processings;
  banned timestamptz;
  revoked integer;
  confirmed_at timestamptz;
begin
  perform private.lock_operator_subjects(array[actor, target_profile_id]);
  perform private.require_operator_capability('platform.manage', false);
  if target_profile_id is null then raise invalid_parameter_value using message = 'invalid_member_withdrawal'; end if;

  select * into processing from private.member_withdrawal_processings w where w.user_id = target_profile_id for update;
  if not found then raise no_data_found using message = 'member_withdrawal_not_processed'; end if;
  if processing.signin_blocked_at is not null then
    return private.member_withdrawal_document(target_profile_id) || jsonb_build_object('replayed', true, 'revokedSessions', 0);
  end if;

  select u.banned_until into banned from auth.users u where u.id = target_profile_id;
  if banned is null or banned < pg_catalog.clock_timestamp() + interval '50 years' then
    raise check_violation using message = 'member_withdrawal_signin_not_blocked';
  end if;

  revoked := private.revoke_member_auth_sessions(target_profile_id);
  confirmed_at := greatest(pg_catalog.clock_timestamp(), processing.processed_at);
  update private.member_withdrawal_processings
  set signin_blocked_at = confirmed_at, signin_blocked_by = actor
  where user_id = target_profile_id;
  insert into public.audit_log (actor_id, action, target, diff)
  values (actor, 'admin.member.withdrawal_signin_blocked', 'profile:' || target_profile_id::text,
    jsonb_build_object('inquiryReference', processing.inquiry_reference, 'revokedSessions', revoked));
  return private.member_withdrawal_document(target_profile_id) || jsonb_build_object('replayed', false, 'revokedSessions', revoked);
end $$;
alter function public.admin_confirm_member_withdrawal_signin_block(uuid) owner to postgres;
revoke all on function public.admin_confirm_member_withdrawal_signin_block(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_confirm_member_withdrawal_signin_block(uuid) to authenticated;

-- 7. 고객 상세가 읽는 처리 상태. STABLE이라 PostgREST가 READ ONLY 트랜잭션으로 부른다 — 잠그는 권한 검사를 쓰지 않는다.
create function public.admin_member_withdrawal_status(target_profile_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_operator_capability('platform.manage', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if target_profile_id is null then raise invalid_parameter_value using message = 'invalid_member_withdrawal'; end if;
  return private.member_withdrawal_document(target_profile_id);
end $$;
alter function public.admin_member_withdrawal_status(uuid) owner to postgres;
revoke all on function public.admin_member_withdrawal_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_member_withdrawal_status(uuid) to authenticated;

-- 8. 탈퇴 처리한 계정은 정지를 풀지 않는다(지운 정보는 돌아오지 않고, 처리 기록과 계정 상태가 어긋난다).
select private.t10_withdrawal_patch_function('public.admin_unsuspend_user(uuid)'::regprocedure, array[
$a$  if selected_suspended_at is null then$a$,
$a$  if exists(select 1 from private.member_withdrawal_processings w where w.user_id = target_profile_id) then
    raise exception 'member_withdrawn' using errcode = '22023';
  end if;

  if selected_suspended_at is null then$a$
]);

-- 9. 운영자 계약 지문. 새 RPC는 분류를 등록하고, 재정의한 정지 해제는 기존 분류 그대로 다시 등록한다.
select private.register_operator_rpc_contract('public.admin_process_member_withdrawal(uuid,bigint,text)'::regprocedure, 'platform.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_confirm_member_withdrawal_signin_block(uuid)'::regprocedure, 'platform.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_member_withdrawal_status(uuid)'::regprocedure, 'platform.manage', 'read', false);
do $$declare contract record; begin
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = 'public.admin_unsuspend_user(uuid)'::regprocedure;
  if not found then raise exception 'admin_unsuspend_user contract missing'; end if;
  perform private.register_operator_rpc_contract('public.admin_unsuspend_user(uuid)'::regprocedure, contract.capability, contract.guard_kind, contract.legacy_admin_only);
end $$;

drop function private.t10_withdrawal_patch_function(regprocedure, text[]);

notify pgrst, 'reload schema';

commit;
