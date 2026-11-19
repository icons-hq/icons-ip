begin;

-- 카카오 계정 상태 변경 웹훅(SSF)의 연결 해제(user-unlinked) 수신 원장과 처리 RPC.
-- 회원이 카카오 쪽(카카오계정 탈퇴, 연결된 서비스 관리에서 해제, 카카오 고객센터 처리 등)에서 ICONS 앱 연결을 끊으면
-- 카카오가 서명한 SET을 /api/webhooks/kakao/account-status로 보낸다. 앱이 서명·발급자·대상(REST API 키)을 검증한 뒤에만
-- service_role로 이 RPC를 부른다. 웹훅 본문은 검증 전에는 믿지 않는다(docs/runbooks/kakao-account-unlink.md).
--
-- 처리(2026-11-18 사용자 결정):
-- 1. 알림보다 나중에 카카오로 다시 로그인한 기록(identity의 last_sign_in_at·updated_at)이 있으면 바꾸지 않는다(relinked).
--    재전송이 최대 2시간 넘게 늦게 올 수 있어, 그 사이 다시 연결한 회원의 연결을 끊지 않게 한다. 알림 시각(toe)은 초 단위로
--    잘리고 두 서버의 시계도 조금 어긋나므로 5초 여유를 둔다(다시 연결하려면 카카오 동의 화면을 처음부터 거쳐야 한다).
-- 2. 다른 로그인 수단이 있는 회원은 카카오 identity만 지운다(identity_unlinked). 다른 수단은 Google·Apple 같은 다른
--    공급자 identity, 또는 비밀번호가 있는 이메일 identity다. 비밀번호 없는 이메일 identity(관리 API로 이메일을 바꿀 때
--    생길 수 있다)는 그것만으로 로그인할 수 없으므로 세지 않는다.
--    카카오가 준 프로필(identity_data)이 함께 지워지고, auth.users의 공급자 목록과 카카오가 채운 user metadata 값도
--    같이 정리한다. 계정·주문·다른 로그인 수단은 그대로다. 개인정보처리방침 제8조(처리 목적을 달성한 정보는 지체 없이 파기).
-- 3. 카카오로만 가입한 회원은 계정과 카카오 identity를 그대로 두고 '탈퇴 검토 대기'로 남긴다(withdrawal_review).
--    회원 탈퇴 기능이 꺼져 있어 자동 탈퇴를 할 수 없고, identity를 지우면 같은 카카오 계정으로 다시 로그인할 때 같은
--    이메일의 기존 계정과 부딪혀 로그인이 깨진다. 대기 목록은 private.kakao_unlink_withdrawal_queue가 보여 주고,
--    알림 뒤 카카오로 다시 로그인한 회원은 목록에서 빠진다.
-- 4. 그 회원번호의 카카오 identity가 없으면 기록만 한다(no_member). 회원 식별 정보는 남기지 않는다.
-- 같은 이벤트(jti)는 한 번만 처리하고 재전송에는 처음 결과를 돌려준다. 카카오 회원번호는 원장에 남기지 않는다.

create table private.kakao_unlink_events (
  event_id text primary key check (char_length(event_id) between 1 and 256),
  user_id uuid references auth.users(id) on delete cascade,
  reason text not null check (reason ~ '^[A-Z_]{1,64}$'),
  event_at timestamptz not null,
  outcome text not null check (outcome in ('identity_unlinked', 'withdrawal_review', 'relinked', 'no_member')),
  received_at timestamptz not null default clock_timestamp(),
  constraint kakao_unlink_events_member_check check ((outcome = 'no_member') = (user_id is null))
);
create index kakao_unlink_events_user_idx on private.kakao_unlink_events (user_id) where user_id is not null;
alter table private.kakao_unlink_events owner to postgres;
alter table private.kakao_unlink_events enable row level security;
revoke all on private.kakao_unlink_events from public, anon, authenticated, service_role;
comment on table private.kakao_unlink_events is
  '카카오 연결 해제(계정 상태 변경 웹훅 user-unlinked) 수신 원장. 이벤트(jti)당 한 행. 서명 검증을 통과한 알림만 service_record_kakao_unlink로 쓴다. 카카오 회원번호는 남기지 않고, 회원 삭제 시 함께 지워진다.';

-- 카카오로만 가입한 회원의 탈퇴 검토 대기 목록. 회원마다 마지막 연결 해제만 보고, 그 뒤 카카오로 다시 로그인했거나
-- 이미 어드민에서 탈퇴를 처리한 회원(private.member_withdrawal_processings, 20261118165000)은 뺀다.
create view private.kakao_unlink_withdrawal_queue as
select latest.user_id, latest.reason, latest.event_at, latest.received_at
from (
  select distinct on (e.user_id) e.user_id, e.outcome, e.reason, e.event_at, e.received_at
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
comment on view private.kakao_unlink_withdrawal_queue is
  '카카오로만 가입한 회원이 카카오 쪽에서 연결을 끊어 탈퇴 검토를 기다리는 목록(runbook kakao-account-unlink.md). 알림 뒤 다시 로그인했거나 이미 탈퇴를 처리한 회원은 빠진다.';

create function public.service_record_kakao_unlink(
  p_event_id text,
  p_kakao_user_id text,
  p_reason text,
  p_event_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing private.kakao_unlink_events;
  target auth.identities;
  member_id uuid;
  effective_at timestamptz;
  result text;
  remaining text[];
  has_password boolean;
begin
  if p_event_id is null or char_length(p_event_id) not between 1 and 256
    or p_kakao_user_id is null or p_kakao_user_id !~ '^[1-9][0-9]{0,19}$'
    or p_reason is null or p_reason !~ '^[A-Z_]{1,64}$'
    or p_event_at is null then
    raise invalid_parameter_value using message = 'invalid_kakao_unlink_event';
  end if;
  -- 카카오 시계가 앞서 있어도 지금보다 늦은 시각은 쓰지 않는다. 그래야 방금 다시 로그인한 기록을 연결 해제보다
  -- 앞선 것으로 잘못 읽고 연결을 끊는 일이 없다.
  effective_at := least(p_event_at, clock_timestamp());

  -- 같은 이벤트의 동시 재전송은 이벤트 advisory lock으로 줄 세우고, 처음 결과를 돌려준다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kakao-unlink:' || p_event_id, 0));
  select * into existing from private.kakao_unlink_events e where e.event_id = p_event_id;
  if found then
    return jsonb_build_object('status', existing.outcome, 'replayed', true);
  end if;

  -- 다시 로그인(GoTrue의 identity 갱신)과 겹치면 행 잠금으로 줄 세운다. 잠근 뒤 읽은 시각이 최신이다.
  select * into target from auth.identities i
    where i.provider = 'kakao' and i.provider_id = p_kakao_user_id
    order by i.created_at
    limit 1
    for update;

  if not found then
    result := 'no_member';
  else
    member_id := target.user_id;
    if greatest(coalesce(target.last_sign_in_at, target.created_at), target.created_at, target.updated_at)
        > effective_at + interval '5 seconds' then
      result := 'relinked';
    else
      -- 회원 행을 잠가 같은 회원의 Auth 변경과 줄 세운다. GoTrue의 identity 해제는 개수를 자기 쪽에서 세므로 이 잠금이
      -- 경쟁을 모두 막지는 못하지만 구간을 좁힌다.
      select coalesce(u.encrypted_password, '') <> '' into has_password
        from auth.users u where u.id = member_id for update;
      if exists (
        select 1 from auth.identities o
        where o.user_id = member_id and o.id <> target.id
          and (o.provider <> 'email' or coalesce(has_password, false))
      ) then
        delete from auth.identities i where i.id = target.id;
        select coalesce(array_agg(distinct o.provider order by o.provider), '{}'::text[]) into remaining
          from auth.identities o where o.user_id = member_id;
        -- GoTrue가 identity를 지울 때처럼 공급자 목록을 남은 identity로 다시 맞추고, 대표 공급자가 사라졌으면 바꾼다.
        -- user metadata는 마지막으로 로그인한 공급자의 값이 덮어쓴 것이라, 카카오 identity와 같은 값인 키만 지운다.
        update auth.users u set
          raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
            || jsonb_build_object('providers', to_jsonb(remaining))
            || case when coalesce((u.raw_app_meta_data ->> 'provider') = any(remaining), false) then '{}'::jsonb
                    else jsonb_build_object('provider', remaining[1]) end,
          raw_user_meta_data = (
            select coalesce(jsonb_object_agg(m.key, m.value), '{}'::jsonb)
            from jsonb_each(coalesce(u.raw_user_meta_data, '{}'::jsonb)) as m
            where (coalesce(target.identity_data, '{}'::jsonb) -> m.key) is distinct from m.value
          ),
          updated_at = now()
        where u.id = member_id;
        result := 'identity_unlinked';
      else
        result := 'withdrawal_review';
      end if;
    end if;
  end if;

  insert into private.kakao_unlink_events (event_id, user_id, reason, event_at, outcome)
    values (p_event_id, member_id, p_reason, effective_at, result);
  return jsonb_build_object('status', result, 'replayed', false);
end;
$$;

alter function public.service_record_kakao_unlink(text, text, text, timestamptz) owner to postgres;
revoke all on function public.service_record_kakao_unlink(text, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.service_record_kakao_unlink(text, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';

commit;
