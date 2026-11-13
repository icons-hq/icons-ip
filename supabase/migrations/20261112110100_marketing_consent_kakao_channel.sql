begin;

-- 10/14 실사용 QA 회의 1014-010 — 구매 전 회원에게 알릴 수단을 늘린다(SMS + 카카오톡, 수단별 동의).
--
-- 1) 수단별 마케팅 정보 수신 동의 원장(20261027110000)에 카카오톡(kakao)을 더한다. 화면은 카카오톡 채널 스위치
--    (ICONS_KAKAO_CHANNEL_ENABLED, 기본 OFF)가 켜졌을 때만 이 줄을 보이고 안내 버전 marketing-channels-v2로 받는다.
--    기존 RPC set_my_marketing_consents(이메일·SMS, v1)는 그대로 두고, 세 수단을 받는 v2 RPC를 따로 둔다 —
--    스위치가 꺼져 있으면 앱은 v1만 부르므로 동작이 바뀌지 않는다.
--    파생값 consents.marketing은 계속 '어느 수단이든 하나라도 동의'다. v1 저장이 카카오톡 동의를 모르고 파생값을
--    false로 써서 트리거가 카카오톡 동의까지 철회하지 않도록, v1의 파생값 계산에 기존 카카오톡 동의를 포함한다.
-- 2) SMS 알림 seam(앱 스위치 ICONS_SMS_NOTIFICATIONS_ENABLED, 기본 OFF)이 받는 사람을 고르는 서비스 롤 RPC.
--    광고성 정보는 SMS 수신 동의가 있는 회원에게만, 인증된 휴대폰 번호로만 보낸다. 거래 안내는 동의와 무관하다.

alter table private.customer_marketing_consents drop constraint customer_marketing_consents_channel_check;
alter table private.customer_marketing_consents add constraint customer_marketing_consents_channel_check
  check (channel in ('email', 'sms', 'kakao'));
alter table private.customer_marketing_consents drop constraint customer_marketing_consents_notice_version_check;
alter table private.customer_marketing_consents add constraint customer_marketing_consents_notice_version_check
  check (notice_version in ('marketing-legacy-v0', 'marketing-channels-v1', 'marketing-channels-v2'));
alter table private.customer_marketing_consent_events drop constraint customer_marketing_consent_events_channel_check;
alter table private.customer_marketing_consent_events add constraint customer_marketing_consent_events_channel_check
  check (channel in ('email', 'sms', 'kakao'));
alter table private.customer_marketing_consent_events drop constraint customer_marketing_consent_events_notice_version_check;
alter table private.customer_marketing_consent_events add constraint customer_marketing_consent_events_notice_version_check
  check (notice_version in ('marketing-legacy-v0', 'marketing-channels-v1', 'marketing-channels-v2'));

-- 본인 동의 문서에 카카오톡을 더한다. 기록이 없으면 null이다(스위치가 꺼져 있는 동안 모든 회원이 null).
create or replace function private.customer_marketing_consent_document(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'noticeVersion','marketing-channels-v1',
  'marketing',exists(select 1 from private.customer_marketing_consents c where c.user_id=p_user and c.agreed),
  'email',(select jsonb_build_object('agreed',c.agreed,'agreedAt',c.agreed_at,'withdrawnAt',c.withdrawn_at,'noticeVersion',c.notice_version,'source',c.source)
   from private.customer_marketing_consents c where c.user_id=p_user and c.channel='email'),
  'sms',(select jsonb_build_object('agreed',c.agreed,'agreedAt',c.agreed_at,'withdrawnAt',c.withdrawn_at,'noticeVersion',c.notice_version,'source',c.source)
   from private.customer_marketing_consents c where c.user_id=p_user and c.channel='sms'),
  'kakao',(select jsonb_build_object('agreed',c.agreed,'agreedAt',c.agreed_at,'withdrawnAt',c.withdrawn_at,'noticeVersion',c.notice_version,'source',c.source)
   from private.customer_marketing_consents c where c.user_id=p_user and c.channel='kakao'));
$$;

-- v1 저장의 파생값이 기존 카카오톡 동의를 지우지 않게 한다(정확히 한 군데만 바꾼다).
do $patch$
declare
  definition text := pg_get_functiondef('public.set_my_marketing_consents(boolean,boolean,text,text)'::regprocedure);
  anchor text := 'derived:=p_email or p_sms;';
begin
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'set_my_marketing_consents anchor must appear exactly once';
  end if;
  execute replace(definition, anchor,
    'derived:=p_email or p_sms or exists(select 1 from private.customer_marketing_consents c where c.user_id=actor and c.channel=''kakao'' and c.agreed);');
end;
$patch$;

-- 세 수단(이메일·SMS·카카오톡)을 함께 받는 저장. 안내 버전은 카카오톡을 담은 marketing-channels-v2만 받는다.
-- 잠금 순서와 멱등은 v1과 같다(계정 행동 잠금 → 회원 행 → 수단별 원장).
create function public.set_my_marketing_consents_v2(
  p_email boolean, p_sms boolean, p_kakao boolean, p_notice_version text, p_source text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); profile_consents jsonb; changed_at timestamptz:=clock_timestamp(); derived boolean;
begin
 if actor is null then raise insufficient_privilege using message='marketing_consent_auth_required'; end if;
 if p_email is null or p_sms is null or p_kakao is null or p_notice_version is distinct from 'marketing-channels-v2'
  or p_source is null or p_source not in ('onboarding','settings') then
  raise invalid_parameter_value using message='invalid_marketing_consent'; end if;
 if private.is_account_write_fenced(actor) then
  raise object_not_in_prerequisite_state using message='account_deletion_write_fenced'; end if;
 select p.consents into profile_consents from public.profiles p where p.id=actor for update;
 if not found then raise insufficient_privilege using message='marketing_consent_auth_required'; end if;
 perform private.write_customer_marketing_consent(actor,'email',p_email,p_notice_version,p_source,changed_at);
 perform private.write_customer_marketing_consent(actor,'sms',p_sms,p_notice_version,p_source,changed_at);
 perform private.write_customer_marketing_consent(actor,'kakao',p_kakao,p_notice_version,p_source,changed_at);
 derived:=p_email or p_sms or p_kakao;
 if profile_consents->'marketing' is distinct from to_jsonb(derived) then
  update public.profiles set consents=coalesce(consents,'{}'::jsonb)||jsonb_build_object('marketing',derived) where id=actor;
 end if;
 return private.customer_marketing_consent_document(actor);
end $$;

-- SMS 알림 seam의 받는 사람. 광고성 정보(advertising)는 SMS 수신 동의가 있어야 하고, 거래 안내(transactional)는
-- 동의와 무관하다. 둘 다 인증된 휴대폰 번호가 있어야 하며, 정지·탈퇴 봉인 계정에는 보내지 않는다.
create function public.service_member_sms_recipient(p_user_id uuid, p_purpose text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  phone text;
  consent_agreed_at timestamptz;
begin
  if p_user_id is null or p_purpose is null or p_purpose not in ('advertising', 'transactional') then
    raise invalid_parameter_value using message = 'invalid_sms_recipient_request';
  end if;
  if private.is_account_write_fenced(p_user_id)
    or not exists (select 1 from public.profiles p where p.id = p_user_id and p.suspended_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'account_unavailable');
  end if;
  select n.phone_e164 into phone from private.member_phone_numbers n where n.user_id = p_user_id;
  if phone is null then
    return jsonb_build_object('ok', false, 'reason', 'no_verified_phone');
  end if;
  if p_purpose = 'advertising' then
    select c.agreed_at into consent_agreed_at from private.customer_marketing_consents c
      where c.user_id = p_user_id and c.channel = 'sms' and c.agreed;
    if consent_agreed_at is null then
      return jsonb_build_object('ok', false, 'reason', 'consent_required');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'phoneE164', phone, 'smsConsentAgreedAt', consent_agreed_at);
end;
$$;

alter function private.customer_marketing_consent_document(uuid) owner to postgres;
alter function public.set_my_marketing_consents(boolean,boolean,text,text) owner to postgres;
alter function public.set_my_marketing_consents_v2(boolean,boolean,boolean,text,text) owner to postgres;
alter function public.service_member_sms_recipient(uuid, text) owner to postgres;
revoke all on function private.customer_marketing_consent_document(uuid),
  public.set_my_marketing_consents(boolean,boolean,text,text),
  public.set_my_marketing_consents_v2(boolean,boolean,boolean,text,text),
  public.service_member_sms_recipient(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_marketing_consents(boolean,boolean,text,text),
  public.set_my_marketing_consents_v2(boolean,boolean,boolean,text,text) to authenticated;
grant execute on function public.service_member_sms_recipient(uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
