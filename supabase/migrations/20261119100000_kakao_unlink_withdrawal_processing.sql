-- 카카오 연결 해제 탈퇴 검토 대기 목록의 어드민 화면과 처리 경로(20261118190000 후속, runbook kakao-account-unlink.md §5).
--
-- 카카오로만 가입한 회원이 카카오 쪽에서 ICONS 연결을 끊으면 20261118190000이 그 회원을 계정·카카오 identity를 둔 채
-- private.kakao_unlink_withdrawal_queue(탈퇴 검토 대기)에 남긴다. 이 migration은 운영자가 그 목록을 보고 탈퇴 처리까지 잇게 한다.
--
-- 처리 근거(2026-11-19 사용자 결정 — 해제 사유별로 나눈다):
--   · 카카오계정 자체가 없어진 경우(ACCOUNT_DELETE 카카오계정 탈퇴, FORCED_ACCOUNT_DELETE 장기 휴면·고객센터 강제 탈퇴):
--     회원이 다시 로그인할 수단이 영구히 없어 계정을 둘 목적이 끝났다(개인정보 보호법 제21조 — 처리 목적이 달성되면 지체 없이
--     파기). 카카오 공식 문서도 계정 상태 변경 웹훅(User Unlinked)을 받으면 '카카오 로그인으로만 이용 가능한 경우에는 회원 탈퇴
--     처리'를 권장하고 연결 해제를 '서비스 이용 동의 철회'로 정의한다. 그래서 해제 알림(원장 행)을 근거로 운영자가 바로 처리한다.
--   · 그 밖의 사유(UNLINK_FROM_APPS 카카오계정 페이지에서 연결 해제 등): 회원이 카카오로 다시 로그인할 수 있다. 약관 제7조의
--     '회원이 회사에 탈퇴를 요청' 구조를 따라 회원에게 확인 연락을 한 뒤, 회원이 쓴 1:1 문의로 기존 admin_process_member_withdrawal
--     경로에서 처리한다. 새 RPC는 이 사유를 처리하지 않는다(kakao_unlink_member_request_required).
--
-- 처리 범위는 문의로 받은 탈퇴(20261118165000)와 같다 — 진행 중 의무 확인, 정지, 비법정 개인정보 삭제, 세션 종료, 감사, 이어서 앱이
-- 재로그인 차단. 카카오 근거 처리는 여기에 카카오 identity 삭제를 더한다. 카카오계정이 없어져 카카오 로그인이라는 목적이 영구히 끝났고
-- 카카오 문서상 회원번호도 파기 대상 개인정보다. 다른 수단 회원의 연결 끊기(runbook §2.1)와 같은 방식으로 identity·공급자 목록·카카오가
-- 채운 user metadata를 정리한다. 계정 이메일과 거래 기록은 문의 탈퇴처럼 남는다(완전 삭제가 아니다).
--
-- 바꾸는 것:
-- 1. private.member_withdrawal_processings에 처리 근거(basis: inquiry | kakao_unlink)와 근거가 된 카카오 해제 원장 행을 더한다.
--    문의 근거만 문의 번호를, 카카오 근거만 해제 이벤트를 가진다.
-- 2. 대기 목록 뷰 끝에 이벤트 ID 칸을 더한다(처리 근거로 남길 행).
-- 3. 처리 본체를 private.process_member_withdrawal로 옮기고, 문의 RPC는 문의 확인까지만 한다. 문의 근거의 정지 사유·감사·반환 모양은
--    그대로다.
-- 4. 새 RPC public.admin_process_kakao_unlink_withdrawal(회원, 처리 메모) — platform.manage(문의 탈퇴 처리와 같은 권한).
-- 5. 처리 상태 문서에 카카오 근거(basis·kakaoUnlink)와 대기 중인 카카오 해제(kakaoUnlink)를 조건부로 더한다. 문의 근거 회원과 대기 목록에
--    없는 회원의 문서 모양은 그대로다.
-- 6. 재로그인 차단 확인 감사에 카카오 근거를 표시한다(문의 근거는 그대로).
-- 7. 대기 목록 읽기 RPC public.admin_kakao_unlink_withdrawal_queue() — platform.manage, 가린 이메일만 돌려준다.
begin;

create function private.t11_kakao_withdrawal_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't11 kakao withdrawal patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 처리 근거. 기존 행은 모두 문의 근거다(기본값 inquiry — 문의 번호 없이 넣으면 근거 검사가 거절한다). 근거 행(카카오 해제 원장)은
--    처리 기록이 있는 동안 지울 수 없다(NO ACTION — 회원 삭제 때는 프로필 cascade로 처리 기록도 같은 문장에서 사라지므로 막히지 않는다).
alter table private.member_withdrawal_processings
  alter column inquiry_reference drop not null,
  add column basis text not null default 'inquiry' check (basis in ('inquiry', 'kakao_unlink')),
  add column kakao_unlink_event_id text references private.kakao_unlink_events(event_id),
  add constraint member_withdrawal_processings_basis_evidence check (
    ((basis = 'inquiry') = (inquiry_reference is not null))
    and ((basis = 'kakao_unlink') = (kakao_unlink_event_id is not null)));
comment on table private.member_withdrawal_processings is
  '회원 탈퇴의 운영자 처리 기록 — 1:1 문의(basis inquiry, admin_process_member_withdrawal) 또는 카카오계정 탈퇴 알림(basis kakao_unlink, admin_process_kakao_unlink_withdrawal). hard delete가 아니라 정지·비법정 개인정보 삭제·세션 종료까지다 — 남는 항목과 이유는 docs/account-deletion-retention-policy.md §5.';

-- 2. 대기 목록에 이벤트 ID를 더한다(뷰 끝 칸). 나머지 정의는 20261118190000과 같다.
create or replace view private.kakao_unlink_withdrawal_queue as
select latest.user_id, latest.reason, latest.event_at, latest.received_at, latest.event_id
from (
  select distinct on (e.user_id) e.user_id, e.outcome, e.reason, e.event_at, e.received_at, e.event_id
  from private.kakao_unlink_events e
  where e.user_id is not null
  order by e.user_id, e.event_at desc, e.received_at desc
) as latest
where latest.outcome = 'withdrawal_review'
  and not exists (
    select 1 from auth.identities i
    where i.user_id = latest.user_id and i.provider = 'kakao'
      and greatest(coalesce(i.last_sign_in_at, i.created_at), i.created_at, i.updated_at) > latest.event_at + interval '5 seconds'
  )
  and not exists (select 1 from private.member_withdrawal_processings w where w.user_id = latest.user_id);
alter view private.kakao_unlink_withdrawal_queue owner to postgres;
revoke all on private.kakao_unlink_withdrawal_queue from public, anon, authenticated, service_role;

-- 카카오계정 자체가 없어진 해제 사유. 이 사유만 해제 알림을 탈퇴 처리의 근거로 받는다. 앱 KAKAO_UNLINK_ACCOUNT_CLOSED_REASONS와 같다.
create function private.kakao_unlink_closes_account(p_reason text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_reason in ('ACCOUNT_DELETE', 'FORCED_ACCOUNT_DELETE'), false)
$$;
alter function private.kakao_unlink_closes_account(text) owner to postgres;
revoke all on function private.kakao_unlink_closes_account(text) from public, anon, authenticated, service_role;

-- 카카오 identity 삭제. service_record_kakao_unlink의 다른 수단 회원 처리(identity_unlinked)와 같은 정리 — identity(카카오 회원번호·
-- 닉네임·프로필 사진 주소·이메일), 카카오 identity와 같은 값인 user metadata 키, 남은 identity로 맞춘 공급자 목록. 남은 identity가 없으면
-- 대표 공급자 키를 지운다. 지운 identity 수를 돌려준다.
create function private.erase_member_kakao_identities(p_user_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  erased integer;
  removed jsonb;
  remaining text[];
begin
  if p_user_id is null then raise invalid_parameter_value using message = 'member_withdrawal_member_required'; end if;
  perform 1 from auth.users u where u.id = p_user_id for update;
  with gone as (
    delete from auth.identities i where i.user_id = p_user_id and i.provider = 'kakao' returning i.identity_data
  )
  select count(*)::integer, coalesce(jsonb_agg(coalesce(g.identity_data, '{}'::jsonb)), '[]'::jsonb) into erased, removed from gone g;
  if erased = 0 then return 0; end if;

  select coalesce(array_agg(distinct o.provider order by o.provider), '{}'::text[]) into remaining
    from auth.identities o where o.user_id = p_user_id;
  update auth.users u set
    raw_app_meta_data = case when cardinality(remaining) = 0
      then (coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'provider') || jsonb_build_object('providers', '[]'::jsonb)
      else coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('providers', to_jsonb(remaining))
        || case when coalesce((u.raw_app_meta_data ->> 'provider') = any(remaining), false) then '{}'::jsonb
                else jsonb_build_object('provider', remaining[1]) end
      end,
    raw_user_meta_data = (
      select coalesce(jsonb_object_agg(m.key, m.value), '{}'::jsonb)
      from jsonb_each(coalesce(u.raw_user_meta_data, '{}'::jsonb)) as m
      where not exists (select 1 from jsonb_array_elements(removed) as d where (d.value -> m.key) is not distinct from m.value)
    ),
    updated_at = now()
  where u.id = p_user_id;
  return erased;
end $$;
alter function private.erase_member_kakao_identities(uuid) owner to postgres;
revoke all on function private.erase_member_kakao_identities(uuid) from public, anon, authenticated, service_role;

-- 5. 화면이 읽는 처리 상태. 문의 근거·대기 목록에 없는 회원은 20261118165000과 같은 모양이고, 카카오 근거로 처리한 회원은 basis와
--    근거 해제(kakaoUnlink)를, 처리 전 대기 중인 회원은 kakaoUnlink만 더한다. accountClosed가 true면 해제 알림으로 처리할 수 있다.
create or replace function private.member_withdrawal_document(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('processed', true, 'processedAt', w.processed_at, 'inquiryReference', w.inquiry_reference,
       'signinBlocked', w.signin_blocked_at is not null, 'signinBlockedAt', w.signin_blocked_at)
       || case when w.basis = 'kakao_unlink' then jsonb_build_object('basis', w.basis, 'kakaoUnlink', jsonb_build_object(
            'reason', e.reason, 'eventAt', e.event_at, 'accountClosed', private.kakao_unlink_closes_account(e.reason)))
          else '{}'::jsonb end
     from private.member_withdrawal_processings w
     left join private.kakao_unlink_events e on e.event_id = w.kakao_unlink_event_id
     where w.user_id = p_user_id),
    jsonb_build_object('processed', false, 'processedAt', null, 'inquiryReference', null,
      'signinBlocked', false, 'signinBlockedAt', null)
      || coalesce((select jsonb_build_object('kakaoUnlink', jsonb_build_object('reason', q.reason, 'eventAt', q.event_at,
           'accountClosed', private.kakao_unlink_closes_account(q.reason)))
         from private.kakao_unlink_withdrawal_queue q where q.user_id = p_user_id), '{}'::jsonb));
$$;
alter function private.member_withdrawal_document(uuid) owner to postgres;
revoke all on function private.member_withdrawal_document(uuid) from public, anon, authenticated, service_role;

-- 두 처리 RPC의 공통 앞 단계. 잠금·권한 확인은 부른 RPC가 먼저 한다. 메모·대상을 확인하고, 이미 처리한 회원이면 처음 기록을
-- 돌려준다(재로그인 차단 전에 다시 로그인했을 수 있어 세션만 다시 끊는다). 처리할 회원이면 null.
create function private.check_member_withdrawal_request(p_actor uuid, p_target uuid, p_note text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare revoked integer;
begin
  if p_target is null or pg_catalog.char_length(coalesce(p_note, '')) not between 2 and 200
    or pg_catalog.translate(coalesce(p_note, ''), E'\n\t', '') ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_member_withdrawal';
  end if;
  if p_target = p_actor then
    raise exception 'cannot_withdraw_self' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_target) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from private.member_withdrawal_processings w where w.user_id = p_target) then
    revoked := private.revoke_member_auth_sessions(p_target);
    return private.member_withdrawal_document(p_target)
      || jsonb_build_object('status', 'already_processed', 'revokedSessions', revoked);
  end if;
  return null;
end $$;
alter function private.check_member_withdrawal_request(uuid, uuid, text) owner to postgres;
revoke all on function private.check_member_withdrawal_request(uuid, uuid, text) from public, anon, authenticated, service_role;

-- 3. 처리 본체. 근거 확인은 부른 RPC가 끝냈다(여기서는 근거 모양과 해제 행의 회원만 다시 본다). 잠금 순서·삭제 범위·반환 모양은
--    20261118165000의 admin_process_member_withdrawal과 같고, 카카오 근거만 카카오 identity 삭제(erased.kakaoIdentities)를 더한다.
create function private.process_member_withdrawal(
  p_actor uuid, p_target uuid, p_basis text, p_inquiry_reference bigint, p_kakao_event_id text, p_note text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  kakao_event private.kakao_unlink_events;
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
  erased_kakao integer := 0;
  erased jsonb;
begin
  if p_basis = 'inquiry' then
    if p_inquiry_reference is null or p_inquiry_reference < 1 or p_kakao_event_id is not null then
      raise invalid_parameter_value using message = 'invalid_member_withdrawal';
    end if;
  elsif p_basis = 'kakao_unlink' then
    select * into kakao_event from private.kakao_unlink_events e where e.event_id = p_kakao_event_id and e.user_id = p_target;
    if not found or p_inquiry_reference is not null then
      raise invalid_parameter_value using message = 'invalid_member_withdrawal';
    end if;
  else
    raise invalid_parameter_value using message = 'invalid_member_withdrawal';
  end if;

  -- 탈퇴 신청과 같은 진행 중 의무 판정. 운영자 소속(매니저 역할)은 프로필 역할과 별개라 따로 본다.
  blockers := private.account_deletion_blockers(p_target);
  if exists (select 1 from private.operator_memberships m where m.profile_id = p_target)
    and not blockers @> '[{"code":"staff_handover"}]'::jsonb then
    blockers := blockers || jsonb_build_array(jsonb_build_object('code', 'staff_handover', 'count', 1, 'path', '/settings'));
  end if;
  if blockers <> '[]'::jsonb then
    return jsonb_build_object('status', 'blocked', 'blockers', blockers);
  end if;

  suspension := public.admin_suspend_user(p_target, pg_catalog.left(case when p_basis = 'inquiry'
    then '탈퇴 요청 처리 · 문의 #' || p_inquiry_reference::text || ' · ' || p_note
    else '탈퇴 처리 · 카카오계정 탈퇴 알림 · ' || p_note end, 200));
  changed_at := pg_catalog.clock_timestamp();

  erased_address := private.erase_member_address_book(p_target);
  erased_phone := private.erase_member_phone(p_target);

  -- 마케팅 정보 수신 동의: 동의 중인 수단마다 철회를 원장에 남기고 파생값을 맞춘다(원장 먼저 — 동기화 트리거는 같으면 아무것도 하지 않는다).
  for consent in
    select c.channel, c.notice_version from private.customer_marketing_consents c
    where c.user_id = p_target and c.agreed order by c.channel
  loop
    perform private.write_customer_marketing_consent(p_target, consent.channel, false, consent.notice_version,
      'member_withdrawal', changed_at);
    withdrawn_marketing := withdrawn_marketing + 1;
  end loop;
  update public.profiles set consents = jsonb_set(coalesce(consents, '{}'::jsonb), '{marketing}', 'false'::jsonb, true)
  where id = p_target and consents->'marketing' is distinct from 'false'::jsonb;

  -- 탈퇴 봉인 트리거(erase_fenced_customer_demographics·member_activity_fenced·erase_fenced_member_email_change)와 같은 범위.
  update private.customer_demographic_consents
  set choice = 'declined', gender = null, accepted_at = null, revision = revision + 1, updated_at = changed_at
  where user_id = p_target and choice = 'accepted';
  get diagnostics erased_demographics = row_count;
  delete from private.member_activity_events where user_id = p_target;
  get diagnostics erased_activity_events = row_count;
  update private.member_activity_consents
  set choice = 'declined', accepted_at = null, revision = revision + 1, updated_at = changed_at
  where user_id = p_target and choice = 'accepted';
  get diagnostics withdrawn_activity = row_count;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-email:user:' || p_target::text, 0));
  delete from private.member_email_change_challenges where user_id = p_target;
  get diagnostics erased_email_changes = row_count;
  -- 재입고 알림은 정지와 무관하게 메일·알림을 보내므로 아직 알리지 않은(대기) 신청을 지운다. 알린 기록(발송 이력)은 남긴다.
  delete from public.restock_alerts where user_id = p_target and status = 'pending';
  get diagnostics erased_restock_alerts = row_count;
  if p_basis = 'kakao_unlink' then
    erased_kakao := private.erase_member_kakao_identities(p_target);
  end if;

  revoked := private.revoke_member_auth_sessions(p_target);
  erased := jsonb_build_object(
    'addressBookEntries', erased_address,
    'phoneNumbers', erased_phone,
    'marketingConsents', withdrawn_marketing,
    'demographicConsents', erased_demographics,
    'activityEvents', erased_activity_events,
    'activityConsents', withdrawn_activity,
    'emailChangeRequests', erased_email_changes,
    'restockAlerts', erased_restock_alerts)
    || case when p_basis = 'kakao_unlink' then jsonb_build_object('kakaoIdentities', erased_kakao) else '{}'::jsonb end;

  insert into private.member_withdrawal_processings (user_id, basis, inquiry_reference, kakao_unlink_event_id, processed_by, processed_at)
  values (p_target, p_basis, p_inquiry_reference, p_kakao_event_id, p_actor, changed_at);
  -- 감사: 문의 근거는 20261118165000과 같은 모양. 카카오 근거는 해제 사유·알림 시각을 남긴다(카카오 회원번호·메모·개인정보 원문 없음).
  insert into public.audit_log (actor_id, action, target, diff)
  values (p_actor, 'admin.member.withdrawal_processed', 'profile:' || p_target::text,
    case when p_basis = 'inquiry' then jsonb_build_object('inquiryReference', p_inquiry_reference)
      else jsonb_build_object('basis', p_basis, 'kakaoUnlinkReason', kakao_event.reason, 'kakaoUnlinkEventAt', kakao_event.event_at) end
    || jsonb_build_object(
      'suspended', coalesce((suspension->>'changed')::boolean, false),
      'erased', erased,
      'revokedSessions', revoked));

  return private.member_withdrawal_document(p_target) || jsonb_build_object(
    'status', 'processed',
    'suspended', coalesce((suspension->>'changed')::boolean, false),
    'erased', erased,
    'revokedSessions', revoked);
end $$;
alter function private.process_member_withdrawal(uuid, uuid, text, bigint, text, text) owner to postgres;
revoke all on function private.process_member_withdrawal(uuid, uuid, text, bigint, text, text)
  from public, anon, authenticated, service_role;

-- 문의로 받은 탈퇴. 확인 순서·오류·결과는 20261118165000과 같다 — 공통 앞 단계 뒤에 그 회원이 쓴 1:1 문의인지 확인하고 본체로 넘긴다.
create or replace function public.admin_process_member_withdrawal(target_profile_id uuid, target_inquiry_reference bigint, target_note text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  note text := pg_catalog.btrim(coalesce(target_note, ''), E' \t\n\r\f\v');
  replay jsonb;
  inquiry_owner uuid;
begin
  perform private.lock_operator_subjects(array[actor, target_profile_id]);
  perform private.require_operator_capability('platform.manage', false);
  if target_inquiry_reference is null or target_inquiry_reference < 1 then
    raise invalid_parameter_value using message = 'invalid_member_withdrawal';
  end if;
  replay := private.check_member_withdrawal_request(actor, target_profile_id, note);
  if replay is not null then return replay; end if;

  select i.user_id into inquiry_owner from public.inquiries i where i.reference = target_inquiry_reference;
  if inquiry_owner is null or inquiry_owner <> target_profile_id then
    raise no_data_found using message = 'member_withdrawal_inquiry_not_found';
  end if;
  return private.process_member_withdrawal(actor, target_profile_id, 'inquiry', target_inquiry_reference, null, note);
end $$;
alter function public.admin_process_member_withdrawal(uuid, bigint, text) owner to postgres;
revoke all on function public.admin_process_member_withdrawal(uuid, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_process_member_withdrawal(uuid, bigint, text) to authenticated;

-- 4. 카카오계정 탈퇴 알림으로 받은 탈퇴. 그 회원이 지금 대기 목록에 있고 마지막 해제가 카카오계정이 없어진 사유일 때만 처리한다.
--    다른 사유는 회원 확인(1:1 문의)이 필요하다고 알린다. 대기 목록에 없으면(다시 로그인했거나 해제 기록이 없으면) 처리하지 않는다.
create function public.admin_process_kakao_unlink_withdrawal(target_profile_id uuid, target_note text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  note text := pg_catalog.btrim(coalesce(target_note, ''), E' \t\n\r\f\v');
  replay jsonb;
  queued_event text;
  queued_reason text;
begin
  perform private.lock_operator_subjects(array[actor, target_profile_id]);
  perform private.require_operator_capability('platform.manage', false);
  replay := private.check_member_withdrawal_request(actor, target_profile_id, note);
  if replay is not null then return replay; end if;

  select q.event_id, q.reason into queued_event, queued_reason
    from private.kakao_unlink_withdrawal_queue q where q.user_id = target_profile_id;
  if queued_event is null then
    raise no_data_found using message = 'kakao_unlink_withdrawal_not_queued';
  end if;
  if not private.kakao_unlink_closes_account(queued_reason) then
    raise check_violation using message = 'kakao_unlink_member_request_required';
  end if;
  return private.process_member_withdrawal(actor, target_profile_id, 'kakao_unlink', null, queued_event, note);
end $$;
alter function public.admin_process_kakao_unlink_withdrawal(uuid, text) owner to postgres;
revoke all on function public.admin_process_kakao_unlink_withdrawal(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_process_kakao_unlink_withdrawal(uuid, text) to authenticated;

-- 6. 재로그인 차단 확인 감사: 카카오 근거면 basis를 더한다(문의 근거는 그대로 문의 번호·끊은 세션 수).
select private.t11_kakao_withdrawal_patch_function('public.admin_confirm_member_withdrawal_signin_block(uuid)'::regprocedure, array[
$a$jsonb_build_object('inquiryReference', processing.inquiry_reference, 'revokedSessions', revoked));$a$,
$a$jsonb_build_object('inquiryReference', processing.inquiry_reference, 'revokedSessions', revoked)
      || case when processing.basis = 'inquiry' then '{}'::jsonb else jsonb_build_object('basis', processing.basis) end);$a$
]);

-- 7. 대기 목록. 알림 시각 순. 이메일은 회원 목록(admin_search_members)과 같이 가린다 — 전체 이메일은 고객 상세에서 본다.
--    STABLE이라 PostgREST가 READ ONLY 트랜잭션으로 부른다 — 잠그는 권한 검사를 쓰지 않는다.
create function public.admin_kakao_unlink_withdrawal_queue()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_operator_capability('platform.manage', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'userId', q.user_id,
        'nickname', coalesce(nullif(pg_catalog.btrim(p.nickname, E' \t\n\r\f\v'), ''), 'fan_' || pg_catalog.left(q.user_id::text, 6)),
        'maskedEmail', case
          when nullif(pg_catalog.btrim(coalesce(p.email, '')), '') is null then '이메일 없음'
          when pg_catalog.strpos(p.email, '@') > 1
            then pg_catalog.left(pg_catalog.split_part(p.email, '@', 1), 1) || '***@' || pg_catalog.split_part(p.email, '@', 2)
          else '***' end,
        'reason', q.reason,
        'eventAt', q.event_at,
        'accountClosed', private.kakao_unlink_closes_account(q.reason),
        'suspended', coalesce(p.suspended_at is not null, false))
      order by q.event_at, q.user_id)
    from private.kakao_unlink_withdrawal_queue q
    left join public.profiles p on p.id = q.user_id), '[]'::jsonb);
end $$;
alter function public.admin_kakao_unlink_withdrawal_queue() owner to postgres;
revoke all on function public.admin_kakao_unlink_withdrawal_queue() from public, anon, authenticated, service_role;
grant execute on function public.admin_kakao_unlink_withdrawal_queue() to authenticated;

-- 운영자 계약 지문. 새 RPC는 분류를 등록하고, 재정의한 두 RPC는 기존 분류 그대로 다시 등록한다.
select private.register_operator_rpc_contract('public.admin_process_kakao_unlink_withdrawal(uuid,text)'::regprocedure, 'platform.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_kakao_unlink_withdrawal_queue()'::regprocedure, 'platform.manage', 'read', false);
do $$declare contract record; target regprocedure; begin
  foreach target in array array['public.admin_process_member_withdrawal(uuid,bigint,text)'::regprocedure,
    'public.admin_confirm_member_withdrawal_signin_block(uuid)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = target;
    if not found then raise exception '% contract missing', target; end if;
    perform private.register_operator_rpc_contract(target, contract.capability, contract.guard_kind, contract.legacy_admin_only);
  end loop;
end $$;

drop function private.t11_kakao_withdrawal_patch_function(regprocedure, text[]);

notify pgrst, 'reload schema';

commit;
