begin;

-- 10/14 실사용 QA 회의 1014-014 — 카카오톡 채널을 친구로 추가한 회원에게 쿠폰을 한 번 자동 발급한다.
-- 앱 스위치(ICONS_KAKAO_CHANNEL_ENABLED)는 기본 OFF이고, 이 migration은 발급 원장·쿠폰 출처·서비스 롤 RPC만 만든다.
--
-- 앱이 카카오 API(채널 관계 조회, 어드민 키 방식)로 친구 관계를 확인한 뒤에만 이 RPC를 부른다 — 웹훅 본문이나
-- 브라우저 신호는 확인 근거가 아니다. 발급은 기존 쿠폰 발급 함수(private.issue_coupon_code)를 그대로 쓰고 출처를
-- kakao_channel로 남긴다. 한 회원은 한 채널에서 한 번만 받는다(채널을 차단했다 다시 추가해도 다시 받지 않는다).
-- 받을 수 있는 회원은 운영자 일괄 발급과 같다: 일반 회원·온보딩 완료·만 14세 이상·정지/탈퇴 봉인 아님.
-- 잠금 순서: 회원 advisory(hashtextextended(회원 id)) → 계정 행동 잠금 → (issue_coupon_code의 프로필·쿠폰 잠금).

alter table public.user_coupons drop constraint user_coupons_issued_source_check;
alter table public.user_coupons add constraint user_coupons_issued_source_check
  check (issued_source in ('code_entry', 'grade_benefit', 'admin_grant', 'kakao_channel'));

-- 쿠폰 발급 함수가 kakao_channel 출처를 받게 한다(정확히 한 군데만 바꾼다).
do $patch$
declare
  definition text := pg_get_functiondef('private.issue_coupon_code(text,uuid,text)'::regprocedure);
  anchor text := 'p_source not in (''code_entry'',''admin_grant'')';
begin
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'issue_coupon_code anchor must appear exactly once';
  end if;
  execute replace(definition, anchor, 'p_source not in (''code_entry'',''admin_grant'',''kakao_channel'')');
end;
$patch$;
revoke all on function private.issue_coupon_code(text,uuid,text) from public, anon, authenticated, service_role;
-- 운영자 내부 계약(20261020085516에서 등록)의 지문을 새 정의로 다시 등록한다.
select private.register_operator_internal_contract('private.issue_coupon_code(text,uuid,text)'::regprocedure);

create table private.kakao_channel_friend_rewards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel_public_id text not null check (channel_public_id ~ '^_[A-Za-z0-9]{1,64}$'),
  coupon_code text not null references public.coupons(code),
  user_coupon_id uuid not null references public.user_coupons(id) on delete cascade,
  granted_via text not null check (granted_via in ('login', 'onboarding', 'webhook')),
  granted_at timestamptz not null default clock_timestamp(),
  primary key (user_id, channel_public_id)
);
alter table private.kakao_channel_friend_rewards owner to postgres;
alter table private.kakao_channel_friend_rewards enable row level security;
revoke all on private.kakao_channel_friend_rewards from public, anon, authenticated, service_role;
comment on table private.kakao_channel_friend_rewards is
  '카카오톡 채널 친구 추가 쿠폰 발급 원장(1014-014). 회원·채널당 한 번. 카카오 채널 관계 조회 API로 확인한 뒤 서비스 롤 RPC로만 쓴다.';

-- 카카오 로그인 identity(회원번호)와 회원을 잇는다. 카카오 회원번호는 Supabase Auth identity의 provider_id다.
create function public.service_kakao_identity_user(p_kakao_user_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.user_id from auth.identities i
  where i.provider = 'kakao' and i.provider_id = p_kakao_user_id
  limit 1;
$$;

create function public.service_member_kakao_identity(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.provider_id from auth.identities i
  where i.provider = 'kakao' and i.user_id = p_user_id
  order by i.created_at
  limit 1;
$$;

create function public.service_grant_kakao_channel_friend_coupon(
  p_user_id uuid,
  p_channel_public_id text,
  p_coupon_code text,
  p_granted_via text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing private.kakao_channel_friend_rewards;
  held_id uuid;
  kst_today date := (statement_timestamp() at time zone 'Asia/Seoul')::date;
begin
  if p_user_id is null
    or p_channel_public_id is null or p_channel_public_id !~ '^_[A-Za-z0-9]{1,64}$'
    or p_coupon_code is null or p_coupon_code !~ '^[A-Z0-9][A-Z0-9-]{2,23}$'
    or p_granted_via is null or p_granted_via not in ('login', 'onboarding', 'webhook') then
    raise invalid_parameter_value using message = 'invalid_kakao_channel_reward';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  if private.is_account_write_fenced(p_user_id) then
    return jsonb_build_object('status', 'unavailable', 'reason', 'customer_unavailable');
  end if;

  select * into existing from private.kakao_channel_friend_rewards r
    where r.user_id = p_user_id and r.channel_public_id = p_channel_public_id;
  if found then
    return jsonb_build_object('status', 'already_granted', 'userCouponId', existing.user_coupon_id);
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.role = 'user' and p.suspended_at is null and p.onboarded_at is not null
      and p.birth_date is not null and p.birth_date <= (kst_today - interval '14 years')::date
  ) then
    return jsonb_build_object('status', 'unavailable', 'reason', 'customer_unavailable');
  end if;

  begin
    held_id := private.issue_coupon_code(p_coupon_code, p_user_id, 'kakao_channel');
  exception when check_violation or insufficient_privilege or invalid_parameter_value then
    -- 쿠폰이 없거나 끝났거나 한도를 다 쓴 경우다. 원장을 남기지 않아 운영자가 쿠폰을 고치면 다음 확인 때 발급된다.
    return jsonb_build_object('status', 'unavailable', 'reason', sqlerrm);
  end;

  insert into private.kakao_channel_friend_rewards (user_id, channel_public_id, coupon_code, user_coupon_id, granted_via)
    values (p_user_id, p_channel_public_id, upper(btrim(p_coupon_code)), held_id, p_granted_via);
  return jsonb_build_object('status', 'granted', 'userCouponId', held_id);
end;
$$;

alter function public.service_kakao_identity_user(text) owner to postgres;
alter function public.service_member_kakao_identity(uuid) owner to postgres;
alter function public.service_grant_kakao_channel_friend_coupon(uuid, text, text, text) owner to postgres;
revoke all on function public.service_kakao_identity_user(text),
  public.service_member_kakao_identity(uuid),
  public.service_grant_kakao_channel_friend_coupon(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_kakao_identity_user(text),
  public.service_member_kakao_identity(uuid),
  public.service_grant_kakao_channel_friend_coupon(uuid, text, text, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
