begin;

-- 10/14 실사용 QA 회의 S4 — 채널별(이메일·SMS) 마케팅 정보 수신 동의.
--
-- 지금까지 마케팅 동의는 profiles.consents.marketing boolean 하나였고 언제 무슨 안내로
-- 동의했는지 남지 않았다. 정보통신망법 제50조(사전 수신 동의·철회)와 시행령 제62조의3
-- (2년마다 수신 동의 여부 확인)의 근거가 되도록 채널별 현재 선택·동의/철회 시각·안내 버전을
-- private 원장에 남기고, 바뀔 때마다 이력을 한 줄씩 쌓는다.
--
-- 호환: 고객 세그먼트(customer_segment_members)·인앱 메시지·어드민 회원 상세가
-- consents->'marketing'을 읽는다. 그 값은 "어느 채널이든 하나라도 동의 = true"인 파생값으로
-- 계속 유지한다 — 채널을 몰라도 되는 기존 소비자(인앱 알림함 포함)는 지금처럼 동작한다.
-- 새 앱은 set_my_marketing_consents로만 바꾸고, 원장 밖에서 들어온 consents.marketing 쓰기
-- (배포 창의 옛 앱·운영 SQL)는 무시하지 않고 아래 트리거가 원장에 반영한다.

create table private.customer_marketing_consents (
 user_id uuid not null references public.profiles(id) on delete cascade,
 channel text not null check(channel in ('email','sms')),
 agreed boolean not null,
 notice_version text not null check(notice_version in ('marketing-legacy-v0','marketing-channels-v1')),
 source text not null check(source in ('legacy','legacy_app','onboarding','settings')),
 agreed_at timestamptz,
 withdrawn_at timestamptz,
 revision bigint not null check(revision>0),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(user_id,channel),
 check((agreed and agreed_at is not null and withdrawn_at is null) or (not agreed and agreed_at is null))
);
create table private.customer_marketing_consent_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.profiles(id) on delete cascade,
 channel text not null check(channel in ('email','sms')),
 agreed boolean not null,
 notice_version text not null check(notice_version in ('marketing-legacy-v0','marketing-channels-v1')),
 source text not null check(source in ('legacy','legacy_app','onboarding','settings')),
 occurred_at timestamptz not null default clock_timestamp()
);
create index customer_marketing_consent_events_user_time on private.customer_marketing_consent_events(user_id,occurred_at desc);
alter table private.customer_marketing_consents owner to postgres;
alter table private.customer_marketing_consent_events owner to postgres;
alter table private.customer_marketing_consents enable row level security;
alter table private.customer_marketing_consent_events enable row level security;
revoke all on private.customer_marketing_consents,private.customer_marketing_consent_events from public,anon,authenticated,service_role;

-- 기존 단일 동의의 이관. 옛 안내("마케팅 정보 수신 동의")는 채널을 나누지 않았고 회원 연락처는
-- 이메일뿐이었으므로 이메일 채널 동의로만 옮긴다(SMS 동의를 지어내지 않는다).
-- 동의 시각은 기록된 적이 없어 온보딩 완료 시각(없으면 가입 시각)을 쓴다. 실제 동의 시각은
-- 그보다 이르지 않으므로 2년 재확인 시계가 늦게 돌지 않는 보수적인 하한이다.
-- 안내 버전 marketing-legacy-v0·source legacy로 새 동의와 구별하고, 화면은 날짜 대신
-- "기존 동의(기록 전)"로 표시한다.
insert into private.customer_marketing_consents(user_id,channel,agreed,notice_version,source,agreed_at,withdrawn_at,revision)
select p.id,'email',true,'marketing-legacy-v0','legacy',coalesce(p.onboarded_at,p.created_at),null,1
from public.profiles p where p.consents->'marketing'='true'::jsonb;
insert into private.customer_marketing_consent_events(user_id,channel,agreed,notice_version,source,occurred_at)
select c.user_id,c.channel,true,c.notice_version,c.source,c.agreed_at
from private.customer_marketing_consents c where c.source='legacy';

-- 한 수단의 선택을 원장에 쓴다. 같은 선택이면 아무것도 바꾸지 않는다(멱등, false 반환).
-- 처음 기록하는 거부는 "안내를 보고 동의하지 않음"의 근거로 한 줄 남긴다.
-- 호출자가 회원 행을 먼저 잠근다(RPC는 FOR UPDATE, 트리거는 UPDATE 자체의 행 잠금).
create function private.write_customer_marketing_consent(p_user uuid,p_channel text,p_choice boolean,
 p_notice_version text,p_source text,p_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_row private.customer_marketing_consents; had_row boolean;
begin
 select * into current_row from private.customer_marketing_consents c where c.user_id=p_user and c.channel=p_channel for update;
 had_row:=found;
 if had_row and current_row.agreed=p_choice then return false; end if;
 insert into private.customer_marketing_consents(user_id,channel,agreed,notice_version,source,agreed_at,withdrawn_at,revision,updated_at)
 values(p_user,p_channel,p_choice,p_notice_version,p_source,
  case when p_choice then p_at end,
  case when not p_choice and had_row and current_row.agreed then p_at end,
  coalesce(current_row.revision,0)+1,p_at)
 on conflict(user_id,channel) do update set agreed=excluded.agreed,notice_version=excluded.notice_version,source=excluded.source,
  agreed_at=excluded.agreed_at,withdrawn_at=excluded.withdrawn_at,revision=excluded.revision,updated_at=excluded.updated_at;
 insert into private.customer_marketing_consent_events(user_id,channel,agreed,notice_version,source,occurred_at)
 values(p_user,p_channel,p_choice,p_notice_version,p_source,p_at);
 return true;
end $$;

create function private.customer_marketing_consent_document(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'noticeVersion','marketing-channels-v1',
  'marketing',exists(select 1 from private.customer_marketing_consents c where c.user_id=p_user and c.agreed),
  'email',(select jsonb_build_object('agreed',c.agreed,'agreedAt',c.agreed_at,'withdrawnAt',c.withdrawn_at,'noticeVersion',c.notice_version,'source',c.source)
   from private.customer_marketing_consents c where c.user_id=p_user and c.channel='email'),
  'sms',(select jsonb_build_object('agreed',c.agreed,'agreedAt',c.agreed_at,'withdrawnAt',c.withdrawn_at,'noticeVersion',c.notice_version,'source',c.source)
   from private.customer_marketing_consents c where c.user_id=p_user and c.channel='sms'));
$$;

create function public.my_marketing_consent_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.profiles p where p.id=actor) then
  raise insufficient_privilege using message='marketing_consent_auth_required'; end if;
 return private.customer_marketing_consent_document(actor);
end $$;

create function public.set_my_marketing_consents(p_email boolean,p_sms boolean,p_notice_version text,p_source text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); profile_consents jsonb; changed_at timestamptz:=clock_timestamp(); derived boolean;
begin
 if actor is null then raise insufficient_privilege using message='marketing_consent_auth_required'; end if;
 if p_email is null or p_sms is null or p_notice_version is distinct from 'marketing-channels-v1'
  or p_source is null or p_source not in ('onboarding','settings') then
  raise invalid_parameter_value using message='invalid_marketing_consent'; end if;
 -- 계정 잠금(account-action)을 회원 행보다 먼저 잡는다 — 결제 확정·미결제 주문 닫기가 계정 잠금 →
 -- 회원 행(등급 재산정) 순서라, 반대로 잡으면 같은 회원의 동시 처리와 교착한다(ADR-0026 잠금 순서).
 if private.is_account_write_fenced(actor) then
  raise object_not_in_prerequisite_state using message='account_deletion_write_fenced'; end if;
 -- 회원 행 잠금으로 같은 회원의 동시 저장(다른 탭·온보딩 재제출·옛 앱 직접 쓰기)을 직렬화한다.
 select p.consents into profile_consents from public.profiles p where p.id=actor for update;
 if not found then raise insufficient_privilege using message='marketing_consent_auth_required'; end if;
 perform private.write_customer_marketing_consent(actor,'email',p_email,p_notice_version,p_source,changed_at);
 perform private.write_customer_marketing_consent(actor,'sms',p_sms,p_notice_version,p_source,changed_at);
 derived:=p_email or p_sms;
 -- 원장을 먼저 쓰고 파생값을 맞춘다. 아래 동기화 트리거는 파생값과 원장이 같으면 아무것도 하지 않는다.
 if profile_consents->'marketing' is distinct from to_jsonb(derived) then
  update public.profiles set consents=coalesce(consents,'{}'::jsonb)||jsonb_build_object('marketing',derived) where id=actor;
 end if;
 return private.customer_marketing_consent_document(actor);
end $$;

-- consents.marketing의 모양 지키기. 키를 지우거나 boolean이 아닌 값으로 바꾸는 쓰기는 이전 값을
-- 유지한다 — 새 온보딩은 약관 저장 때 consents를 {terms,privacy}로 덮어쓰며 marketing을
-- 보내지 않는다(그 값은 RPC가 원장과 함께 바꾼다).
create function private.keep_marketing_consent_shape() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.consents->'marketing' is distinct from old.consents->'marketing'
  and jsonb_typeof(new.consents->'marketing') is distinct from 'boolean' then
  new.consents:=jsonb_set(coalesce(new.consents,'{}'::jsonb),'{marketing}',coalesce(old.consents->'marketing','false'::jsonb),true);
 end if;
 return new;
end $$;
create trigger trg_profiles_marketing_consent_shape before update of consents on public.profiles
 for each row execute function private.keep_marketing_consent_shape();

-- 원장 밖에서 바뀐 consents.marketing(배포 창 동안의 옛 앱 Data API 쓰기, 운영 SQL)을 원장에 반영한다.
-- false는 동의 중인 수단을 모두 철회하고, true는 옛 단일 안내와 같은 이메일 동의로 기록한다
-- (source legacy_app, 안내 버전 marketing-legacy-v0). RPC 경로는 원장을 먼저 써서 파생값과
-- 원장이 이미 같으므로 여기서 아무것도 하지 않는다.
create function private.sync_marketing_consent_ledger() returns trigger
language plpgsql security definer set search_path='' as $$
declare wanted boolean; derived boolean; channel_value text; changed_at timestamptz:=clock_timestamp();
begin
 if new.consents->'marketing' is not distinct from old.consents->'marketing' then return null; end if;
 wanted:=coalesce(new.consents->'marketing'='true'::jsonb,false);
 derived:=exists(select 1 from private.customer_marketing_consents c where c.user_id=new.id and c.agreed);
 if wanted=derived then return null; end if;
 if wanted then
  perform private.write_customer_marketing_consent(new.id,'email',true,'marketing-legacy-v0','legacy_app',changed_at);
 else
  for channel_value in select c.channel from private.customer_marketing_consents c where c.user_id=new.id and c.agreed order by c.channel loop
   perform private.write_customer_marketing_consent(new.id,channel_value,false,'marketing-legacy-v0','legacy_app',changed_at);
  end loop;
 end if;
 return null;
end $$;
create trigger trg_profiles_marketing_consent_ledger after update of consents on public.profiles
 for each row execute function private.sync_marketing_consent_ledger();

alter function private.write_customer_marketing_consent(uuid,text,boolean,text,text,timestamptz) owner to postgres;
alter function private.customer_marketing_consent_document(uuid) owner to postgres;
alter function public.my_marketing_consent_state() owner to postgres;
alter function public.set_my_marketing_consents(boolean,boolean,text,text) owner to postgres;
alter function private.keep_marketing_consent_shape() owner to postgres;
alter function private.sync_marketing_consent_ledger() owner to postgres;
revoke all on function private.write_customer_marketing_consent(uuid,text,boolean,text,text,timestamptz),
 private.customer_marketing_consent_document(uuid),public.my_marketing_consent_state(),
 public.set_my_marketing_consents(boolean,boolean,text,text),private.keep_marketing_consent_shape(),
 private.sync_marketing_consent_ledger()
 from public,anon,authenticated,service_role;
grant execute on function public.my_marketing_consent_state(),public.set_my_marketing_consents(boolean,boolean,text,text) to authenticated;
commit;
