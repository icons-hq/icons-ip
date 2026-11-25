-- 탈퇴 처리 때 보존 근거가 없는 개인정보를 모두 지우고 로그인 식별자 원문을 남기지 않는다(원장 CUS-036, 2026-11-25).
--
-- #683·#688·#698의 탈퇴 처리(private.process_member_withdrawal)는 정지·주소록·휴대폰·동의·성인 인증·프로필 익명화·세션 삭제까지
-- 했지만 이메일(프로필·Auth), Auth 사용자의 로그인 연결(identity)·프로필 정보, 위시·장바구니·알림함·IP 팔로우·쿠폰·코인 같은
-- 개인화 데이터가 남았다. 약관 제7조·처리방침 제3조는 '탈퇴를 처리하면 지체 없이 파기(법정 보존분 제외)'를 약속한다. 이 migration은
-- 남는 것을 (1) 법정 보존(전자상거래법 거래 기록 5년, 소비자 불만·분쟁처리 기록 3년)과 (2) 보존 근거 없음으로 나누고 (2)를 지운다.
--
--   1. 처리 때 지운다(private.erase_withdrawn_member_personal_data): 위시리스트, 장바구니(쿠폰 선택·주문서 초안 포함), 알림함,
--      IP 팔로우(팬 수 캐시는 unfollow_ip와 같은 규칙으로 맞춘다), 재입고 알림(알린 기록까지), 좋아요·내가 한 차단·리뷰 도움돼요,
--      처리가 끝난 신고, 등급 변경 기록, 쓰지 않은 쿠폰(주문 할인에 묶인 쿠폰은 거래 기록이라 남는다), 출석 코인 원장·잔액·출석 기록,
--      마케팅 발송 대상 기록의 회원 연결.
--   2. 처리 때 지운다(private.erase_withdrawn_member_signin_data): 모든 로그인 연결(auth.identities — 소셜 회원번호·이름·사진 주소·
--      이메일), Auth 사용자 프로필 정보(user metadata), 전화번호·변경 대기 이메일·비밀번호 해시, 2단계 인증 수단, 로그인 진행 기록
--      (flow_state·one_time_tokens). 재로그인은 기존대로 Auth 관리 API의 장기 차단(ban)이 막는다.
--   3. 처리한 회원에게는 앱 알림을 만들지 않는다(public.notifications 입력 트리거 — 처리 뒤 문의 답변 알림 등). 처리 뒤 남은 access
--      token(최대 1시간)으로 생길 수 있는 위시·팔로우·장바구니 행은 처리 3일 뒤 정리 잡이 2·1을 한 번 더 돌려 지운다.
--   4. 이메일 원문(프로필·Auth): 1:1 문의 근거 처리는 처리 결과를 문의 답변 메일로 알리기 위해 처리 3일 뒤 정리 잡이 지우고, 카카오
--      알림 근거 처리는 답변할 문의가 없어 처리 때 바로 지운다(private.erase_withdrawn_member_email). 메일 발송 기록(email_deliveries)은
--      20260813240000부터 수신 주소를 남기지 않는다.
--   5. 재가입 차단: 지금까지는 남겨 둔 이메일이 같은 이메일 재가입을 막았다. 원문 대신 이메일(계정·로그인 연결의 이메일)과 소셜 로그인
--      계정 식별자를 복원할 수 없게 바꾼 값(DB 안 비밀키로 만든 HMAC)을 처리일부터 1년 남기고(private.withdrawn_signin_blocks), 새 사용자
--      생성·로그인 연결 추가(auth.identities)·계정 이메일 변경이 같은 값이면 거절한다. 판정이 실패하면 막지 않는다(fail open).
--   6. 처리일부터 1년이 지나면 마케팅 수신 동의·철회 원장, 성별·활동 기록 동의 행과 남은 신고 기록을 지운다.
--   7. GoTrue 접속 기록(auth.audit_log_entries — 이메일·IP 포함)은 처리방침의 '서비스 접속 기록 3개월'대로 3개월이 지나면 지운다(매일).
--      운영 DB에서 지울 권한이 없으면 실패하지 않고 -1을 돌려준다.
-- 남는 것: 주문·결제·환불·클레임·티켓·적립금·쿠폰 사용 기록과 주문 배송지(5년), 1:1 문의·상품 문의·상담 메모(3년), 리뷰·커뮤니티
-- 작성물(작성자는 익명화한 닉네임), 정지된 Auth 사용자·프로필 행(이메일·연결 없이 위 기록을 잇는 번호), 처리 기록·감사 로그.
-- ADR-0052로 지운 카드·카드팩·게임 표는 이 처리에서 건드리지 않는다(2026-11-24 이후 새로 쌓이지 않고, 정리는 별도 승인 범위).
--
-- 기존 함수는 pg_get_functiondef + 앵커 치환으로 바꾼다. 바꾸는 함수는 private 함수뿐이라 운영자 계약 지문은 다시 등록하지 않는다.
begin;

create function private.t5_withdrawal_erasure_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't5 withdrawal erasure patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 재가입 차단 값. 원문 대신 DB 안 비밀키로 만든 HMAC만 둔다. 비밀키는 이 DB에서 만들고 어느 API 롤에도 열지 않는다.
create table private.withdrawn_signin_digest_keys (
  version smallint primary key check (version > 0),
  secret bytea not null check (pg_catalog.octet_length(secret) >= 32),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table private.withdrawn_signin_digest_keys owner to postgres;
alter table private.withdrawn_signin_digest_keys enable row level security;
revoke all on private.withdrawn_signin_digest_keys from public, anon, authenticated, service_role;
insert into private.withdrawn_signin_digest_keys (version, secret) values (1, extensions.gen_random_bytes(32));
comment on table private.withdrawn_signin_digest_keys is
  '탈퇴 회원 재가입 차단 값(withdrawn_signin_blocks)의 HMAC 비밀키. 이 DB에서만 쓰고 어느 API 롤에도 열지 않는다.';

create table private.withdrawn_signin_blocks (
  digest text primary key check (digest ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('email', 'identity')),
  key_version smallint not null references private.withdrawn_signin_digest_keys(version),
  blocked_at timestamptz not null,
  blocked_until timestamptz not null,
  check (blocked_until > blocked_at)
);
create index withdrawn_signin_blocks_until_idx on private.withdrawn_signin_blocks (blocked_until);
alter table private.withdrawn_signin_blocks owner to postgres;
alter table private.withdrawn_signin_blocks enable row level security;
revoke all on private.withdrawn_signin_blocks from public, anon, authenticated, service_role;
comment on table private.withdrawn_signin_blocks is
  '탈퇴 처리한 회원의 이메일·소셜 로그인 계정 식별자를 복원할 수 없게 바꾼 값. 처리일부터 1년 동안 같은 값의 새 가입·로그인 연결·이메일 변경을 거절하고 기간이 지나면 지운다(회원과 연결하지 않는다).';

-- 2. 처리 기록: 이메일 원문 파기 시각, 처리 3일 뒤 다시 지운 시각, 1년 보관분 정리 시각.
alter table private.member_withdrawal_processings
  add column email_erased_at timestamptz,
  add column followup_erased_at timestamptz,
  add column retention_purged_at timestamptz,
  add constraint member_withdrawal_processings_erasure_after_processing check (
    (email_erased_at is null or email_erased_at >= processed_at)
    and (followup_erased_at is null or followup_erased_at >= processed_at)
    and (retention_purged_at is null or retention_purged_at >= processed_at));

-- 3. 재가입 차단 값 계산. 종류(email·identity)와 값(소문자·앞뒤 공백 제거)으로 만든다. 값이 비었거나 키가 없으면 null.
create function private.withdrawn_signin_digest(p_kind text, p_value text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_kind in ('email', 'identity') and pg_catalog.btrim(coalesce(p_value, '')) <> '' then
    pg_catalog.encode(extensions.hmac(
      pg_catalog.convert_to('withdrawn-signin-v1|' || p_kind || '|' || pg_catalog.lower(pg_catalog.btrim(p_value)), 'UTF8'),
      k.secret, 'sha256'), 'hex') end
  from private.withdrawn_signin_digest_keys k where k.version = 1
$$;
alter function private.withdrawn_signin_digest(text, text) owner to postgres;
revoke all on function private.withdrawn_signin_digest(text, text) from public, anon, authenticated, service_role;

-- 4. 재가입 차단 판정. 이메일 또는 소셜 로그인 계정(공급자:회원번호 — 이메일·전화·익명 공급자는 보지 않는다)이 아직 막힌 값이면 true.
--    막힌 값이 하나도 없으면 값을 계산하지 않는다. 판정 중 오류가 나면 false다(차단 기능의 고장이 가입·로그인을 멈추지 않게).
create function private.withdrawn_signin_blocked(p_email text, p_provider text, p_subject text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare provider text := pg_catalog.lower(coalesce(p_provider, ''));
begin
  if not exists (select 1 from private.withdrawn_signin_blocks b where b.blocked_until > pg_catalog.clock_timestamp()) then
    return false;
  end if;
  return exists (
    select 1 from private.withdrawn_signin_blocks b
    where b.blocked_until > pg_catalog.clock_timestamp()
      and (b.digest = private.withdrawn_signin_digest('email', p_email)
        or (provider not in ('', 'email', 'phone', 'anonymous')
          and b.digest = private.withdrawn_signin_digest('identity', provider || ':' || p_subject))));
exception when others then
  return false;
end $$;
alter function private.withdrawn_signin_blocked(text, text, text) owner to postgres;
revoke all on function private.withdrawn_signin_blocked(text, text, text) from public, anon, authenticated, service_role;

-- 5. 재가입 차단 값 남기기. 지금 Auth·프로필 이메일, 로그인 연결에 담긴 이메일, 이메일·전화 외의 모든 로그인 연결(공급자:회원번호)을
--    p_from부터 1년 막는다. 로그인 연결을 지우기 전에 부른다. 이미 있는 값이면 더 늦은 기한을 남긴다. 남긴 값 수를 돌려준다.
create function private.block_withdrawn_member_signin(p_target uuid, p_from timestamptz) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare blocked integer;
begin
  if p_target is null or p_from is null then raise invalid_parameter_value using message = 'member_withdrawal_member_required'; end if;
  with candidates as (
    select 'email'::text as kind, private.withdrawn_signin_digest('email', u.email) as digest from auth.users u where u.id = p_target
    union all
    select 'email', private.withdrawn_signin_digest('email', p.email) from public.profiles p where p.id = p_target
    union all
    select 'email', private.withdrawn_signin_digest('email', i.identity_data ->> 'email') from auth.identities i where i.user_id = p_target
    union all
    select 'identity', private.withdrawn_signin_digest('identity', pg_catalog.lower(i.provider) || ':' || i.provider_id)
    from auth.identities i where i.user_id = p_target and pg_catalog.lower(i.provider) not in ('email', 'phone', 'anonymous')
  ), saved as (
    insert into private.withdrawn_signin_blocks as b (digest, kind, key_version, blocked_at, blocked_until)
    select distinct on (c.digest) c.digest, c.kind, 1, p_from, p_from + interval '1 year'
    from candidates c where c.digest is not null order by c.digest, c.kind
    on conflict (digest) do update set blocked_until = greatest(b.blocked_until, excluded.blocked_until)
    returning 1
  )
  select count(*)::integer into blocked from saved;
  return blocked;
end $$;
alter function private.block_withdrawn_member_signin(uuid, timestamptz) owner to postgres;
revoke all on function private.block_withdrawn_member_signin(uuid, timestamptz) from public, anon, authenticated, service_role;

-- 6. 새 사용자 생성·계정 이메일 변경 거절. Auth(GoTrue)가 auth.users에 새 사용자를 넣을 때 이메일 또는 소셜 로그인 계정(app metadata의
--    공급자 + user metadata의 provider_id/sub)이, 이메일을 바꿀 때 새 이메일이 막힌 값이면 거절한다. 이메일을 비우는 변경(탈퇴 처리의
--    이메일 파기)과 이메일이 그대로인 변경은 보지 않는다.
create function private.reject_withdrawn_member_signup() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.email is null or new.email is not distinct from old.email then return new; end if;
    if private.withdrawn_signin_blocked(new.email, null, null) then
      raise exception 'withdrawn_member_signup_blocked' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if private.withdrawn_signin_blocked(new.email, new.raw_app_meta_data ->> 'provider',
      coalesce(new.raw_user_meta_data ->> 'provider_id', new.raw_user_meta_data ->> 'sub')) then
    raise exception 'withdrawn_member_signup_blocked' using errcode = 'P0001';
  end if;
  return new;
end $$;
alter function private.reject_withdrawn_member_signup() owner to postgres;
revoke all on function private.reject_withdrawn_member_signup() from public, anon, authenticated, service_role;
create trigger reject_withdrawn_member_signup
before insert or update of email on auth.users
for each row execute function private.reject_withdrawn_member_signup();

-- 7. 로그인 연결 추가 거절. GoTrue가 기존 계정에 로그인 연결을 붙일 때(같은 검증 이메일 자동 연결, 설정의 계정 연결)도 소셜 계정이나
--    연결에 담긴 이메일이 막힌 값이면 거절한다 — 새 사용자를 만들지 않는 재사용 경로.
create function private.reject_withdrawn_member_identity() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
begin
  if private.withdrawn_signin_blocked(new.identity_data ->> 'email', new.provider, new.provider_id) then
    raise exception 'withdrawn_member_signup_blocked' using errcode = 'P0001';
  end if;
  return new;
end $$;
alter function private.reject_withdrawn_member_identity() owner to postgres;
revoke all on function private.reject_withdrawn_member_identity() from public, anon, authenticated, service_role;
create trigger reject_withdrawn_member_identity
before insert on auth.identities
for each row execute function private.reject_withdrawn_member_identity();

-- 8. 처리한 회원에게는 앱 알림을 만들지 않는다(알림함은 지우는 정보다). 처리 뒤 문의 답변(admin_answer_inquiry·상담 답변)·배송완료 주문의
--    안내처럼 회원을 가리키는 모든 알림 입력을 조용히 건너뛴다 — 입력하는 쪽은 'on conflict do nothing'과 같은 결과(행 없음)를 받는다.
create function private.skip_withdrawn_member_notification() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
begin
  if exists (select 1 from private.member_withdrawal_processings w where w.user_id = new.user_id) then
    return null;
  end if;
  return new;
end $$;
alter function private.skip_withdrawn_member_notification() owner to postgres;
revoke all on function private.skip_withdrawn_member_notification() from public, anon, authenticated, service_role;
create trigger skip_withdrawn_member_notification
before insert on public.notifications
for each row execute function private.skip_withdrawn_member_notification();

-- 9. 로그인 연결·Auth 프로필 정보 삭제. 재로그인 차단(ban)은 앱이 관리 API로 따로 건다. 지운 로그인 연결 수를 돌려준다.
create function private.erase_withdrawn_member_signin_data(p_target uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare erased_identities integer;
begin
  if p_target is null then raise invalid_parameter_value using message = 'member_withdrawal_member_required'; end if;
  perform 1 from auth.users u where u.id = p_target for update;
  delete from auth.identities i where i.user_id = p_target;
  get diagnostics erased_identities = row_count;
  update auth.users u set
    raw_user_meta_data = '{}'::jsonb,
    raw_app_meta_data = (coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'provider') || jsonb_build_object('providers', '[]'::jsonb),
    phone = null,
    phone_change = '',
    email_change = '',
    encrypted_password = '',
    updated_at = now()
  where u.id = p_target;
  -- 로그인 진행 기록(소셜 공급자 토큰·인증 코드)·2단계 인증 수단(전화 인증 수단이면 휴대폰 번호). Auth 버전에 따라 표가 없을 수 있어
  -- 있을 때만 지운다.
  if pg_catalog.to_regclass('auth.flow_state') is not null then
    execute 'delete from auth.flow_state where user_id = $1' using p_target;
  end if;
  if pg_catalog.to_regclass('auth.one_time_tokens') is not null then
    execute 'delete from auth.one_time_tokens where user_id = $1' using p_target;
  end if;
  if pg_catalog.to_regclass('auth.mfa_factors') is not null then
    execute 'delete from auth.mfa_factors where user_id = $1' using p_target;
  end if;
  return jsonb_build_object('identities', erased_identities);
end $$;
alter function private.erase_withdrawn_member_signin_data(uuid) owner to postgres;
revoke all on function private.erase_withdrawn_member_signin_data(uuid) from public, anon, authenticated, service_role;

-- 10. 출석 코인 원장은 추가만 받는다(reject_coin_ledger_mutation). 탈퇴 처리의 삭제만 트랜잭션 로컬 표시로 통과시킨다.
select private.t5_withdrawal_erasure_patch_function('private.reject_coin_ledger_mutation()'::regprocedure, array[
$a$begin
  if tg_op = 'DELETE'
     and not exists ($a$,
$a$begin
  -- 탈퇴 처리(erase_withdrawn_member_personal_data)가 그 회원의 코인 기록을 지울 때만 통과한다(20261126104000).
  if tg_op = 'DELETE'
     and pg_catalog.current_setting('app.member_withdrawal_coin_erase', true) = old.user_id::text then
    return old;
  end if;

  if tg_op = 'DELETE'
     and not exists ($a$
]);

-- 11. 보존 근거 없는 개인화 데이터 삭제. 주문·결제에 묶인 기록(쿠폰 사용 원장과 그 쿠폰, 적립금, 주문 배송지)은 남긴다. 멱등이라 처리 3일
--     뒤 정리 잡이 한 번 더 부른다(처리 뒤 남은 access token으로 생긴 행).
create function private.erase_withdrawn_member_personal_data(p_target uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  erased_wishlist integer;
  erased_cart integer;
  erased_notifications integer;
  erased_follows integer;
  erased_coupons integer;
begin
  if p_target is null then raise invalid_parameter_value using message = 'member_withdrawal_member_required'; end if;

  delete from public.wishlists where user_id = p_target;
  get diagnostics erased_wishlist = row_count;
  delete from public.cart_coupon_selections where user_id = p_target;
  delete from public.cart_items where user_id = p_target;
  get diagnostics erased_cart = row_count;
  delete from private.checkout_drafts where user_id = p_target;
  delete from public.notifications where user_id = p_target;
  get diagnostics erased_notifications = row_count;

  -- IP 팔로우: 팬 수 캐시를 unfollow_ip와 같은 규칙(0 아래로 내리지 않음)으로 맞춘다.
  with gone as (
    delete from public.ip_follows where user_id = p_target returning ip_id
  ), counted as (
    select g.ip_id, count(*)::integer as n from gone g group by g.ip_id
  ), adjusted as (
    update public.ips i set fans_count = greatest(i.fans_count - c.n, 0), updated_at = now()
    from counted c where i.id = c.ip_id
    returning 1
  )
  select coalesce((select sum(c.n) from counted c), 0)::integer into erased_follows;

  -- 재입고 알림은 알린 기록(발송 이력)까지 지운다 — 보존 근거가 없다.
  delete from public.restock_alerts where user_id = p_target;
  delete from public.likes where user_id = p_target;
  delete from public.blocks where user_id = p_target;
  delete from private.review_helpful_votes where user_id = p_target;
  delete from public.loyalty_grade_events where user_id = p_target;
  -- 회원이 낸 신고 중 처리가 끝난 것. 처리 중인 신고는 대상 게시물 검토에 필요해 남기고 처리 1년 뒤 정리 잡이 지운다.
  delete from public.reports where reporter_id = p_target and status in ('resolved', 'dismissed');

  -- 쓰지 않은 쿠폰. 주문 할인에 쓴 쿠폰(사용 원장이 가리키는 쿠폰 — 사용 취소로 되살아난 쿠폰 포함)은 거래 기록과 함께 남는다.
  delete from public.user_coupons c
  where c.user_id = p_target and c.status = 'active'
    and not exists (select 1 from public.coupon_redemptions r where r.user_coupon_id = c.id);
  get diagnostics erased_coupons = row_count;

  -- 출석 코인(쓸 곳이 없는 참여 리워드). 원장의 추가 전용 가드는 이 표시가 있을 때만 삭제를 통과시킨다.
  perform pg_catalog.set_config('app.member_withdrawal_coin_erase', p_target::text, true);
  delete from public.coin_ledger where user_id = p_target;
  delete from public.coin_balances where user_id = p_target;
  delete from public.coin_attendance where user_id = p_target;
  perform pg_catalog.set_config('app.member_withdrawal_coin_erase', '', true);

  -- 마케팅 발송 대상 기록은 캠페인 집계로 남기고 회원 연결만 끊는다.
  update private.marketing_recipients set customer_id = null where customer_id = p_target;

  return jsonb_build_object('wishlistItems', erased_wishlist, 'cartItems', erased_cart, 'notifications', erased_notifications,
    'follows', erased_follows, 'coupons', erased_coupons);
end $$;
alter function private.erase_withdrawn_member_personal_data(uuid) owner to postgres;
revoke all on function private.erase_withdrawn_member_personal_data(uuid) from public, anon, authenticated, service_role;

-- 12. 이메일 원문 파기. 처리 기록이 있고 아직 안 지운 회원만. 재가입 차단 값을 다시 남기고(그 사이 바뀐 이메일 포함) Auth·프로필 이메일을
--     비운다. 지웠으면 true. 카카오 근거 처리는 처리 트랜잭션에서 운영자로(p_actor), 문의 근거는 처리 3일 뒤 정리 잡이 부른다.
create function private.erase_withdrawn_member_email(p_target uuid, p_actor uuid default null) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  processing private.member_withdrawal_processings;
begin
  if p_target is null then raise invalid_parameter_value using message = 'member_withdrawal_member_required'; end if;
  perform private.lock_operator_subjects(array[p_target]);
  select * into processing from private.member_withdrawal_processings w where w.user_id = p_target for update;
  if not found or processing.email_erased_at is not null then return false; end if;

  perform 1 from auth.users u where u.id = p_target for update;
  perform 1 from public.profiles p where p.id = p_target for update;
  perform private.block_withdrawn_member_signin(p_target, processing.processed_at);

  -- 프로필 쓰기 봉인·탈퇴 신청 fence를 이 갱신만 통과한다(Auth 이메일 동기화 트리거가 프로필을 함께 비운다).
  perform pg_catalog.set_config('app.member_withdrawal_profile_write', p_target::text, true);
  update auth.users set email = null, updated_at = now() where id = p_target and email is not null;
  update public.profiles set email = null where id = p_target and email is not null;
  perform pg_catalog.set_config('app.member_withdrawal_profile_write', '', true);

  update private.member_withdrawal_processings
  set email_erased_at = greatest(pg_catalog.clock_timestamp(), processing.processed_at)
  where user_id = p_target;
  insert into public.audit_log (actor_id, action, target, diff)
  values (p_actor, 'admin.member.withdrawal_email_erased', 'profile:' || p_target::text,
    case when processing.basis = 'inquiry' then '{}'::jsonb else jsonb_build_object('basis', processing.basis) end);
  return true;
end $$;
alter function private.erase_withdrawn_member_email(uuid, uuid) owner to postgres;
revoke all on function private.erase_withdrawn_member_email(uuid, uuid) from public, anon, authenticated, service_role;

-- 13. 처리 뒤 다시 생긴 행 지우기(멱등). 재가입 차단 값을 갱신하고 로그인 연결·Auth 정보·개인화 데이터를 다시 지운다. 지운 것이 있으면
--     감사를 남기고 개수를 돌려준다. 처리 기록이 없으면 null. 이 migration의 백필과 처리 3일 뒤 정리 잡이 쓴다.
create function private.sweep_withdrawn_member_data(p_target uuid, p_actor uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  processing private.member_withdrawal_processings;
  signin jsonb;
  result jsonb;
begin
  if p_target is null then raise invalid_parameter_value using message = 'member_withdrawal_member_required'; end if;
  perform private.lock_operator_subjects(array[p_target]);
  select * into processing from private.member_withdrawal_processings w where w.user_id = p_target for update;
  if not found then return null; end if;

  perform private.block_withdrawn_member_signin(p_target, processing.processed_at);
  signin := private.erase_withdrawn_member_signin_data(p_target);
  result := private.erase_withdrawn_member_personal_data(p_target)
    || jsonb_build_object('loginIdentities', (signin->>'identities')::integer);
  if exists (select 1 from jsonb_each_text(result) e where e.value::integer > 0) then
    insert into public.audit_log (actor_id, action, target, diff)
    values (p_actor, 'admin.member.withdrawal_personal_data_erased', 'profile:' || p_target::text, result);
  end if;
  return result;
end $$;
alter function private.sweep_withdrawn_member_data(uuid, uuid) owner to postgres;
revoke all on function private.sweep_withdrawn_member_data(uuid, uuid) from public, anon, authenticated, service_role;

-- 14. 처리 3일 뒤 마무리: 아직 남은 이메일 원문(문의 근거)을 지우고 그 사이 생긴 행을 다시 지운다. 회원당 한 번. 처리했으면 결과, 아니면 null.
create function private.finish_withdrawn_member_erasure(p_target uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  processing private.member_withdrawal_processings;
  email_erased boolean := false;
  swept jsonb;
begin
  if p_target is null then raise invalid_parameter_value using message = 'member_withdrawal_member_required'; end if;
  perform private.lock_operator_subjects(array[p_target]);
  select * into processing from private.member_withdrawal_processings w where w.user_id = p_target for update;
  if not found or processing.followup_erased_at is not null then return null; end if;

  if processing.email_erased_at is null then
    email_erased := private.erase_withdrawn_member_email(p_target);
  end if;
  swept := private.sweep_withdrawn_member_data(p_target);
  update private.member_withdrawal_processings
  set followup_erased_at = greatest(pg_catalog.clock_timestamp(), processing.processed_at)
  where user_id = p_target;
  return jsonb_build_object('emailErased', email_erased, 'swept', swept);
end $$;
alter function private.finish_withdrawn_member_erasure(uuid) owner to postgres;
revoke all on function private.finish_withdrawn_member_erasure(uuid) from public, anon, authenticated, service_role;

-- 15. 처리 트랜잭션: 재가입 차단 값을 남긴 뒤 로그인 연결·Auth 프로필 정보와 개인화 데이터를 지운다. 결과 erased에 개수를 더한다.
--     카카오 근거는 답변할 문의가 없어 처리 기록을 남긴 뒤 이메일 원문을 바로 지운다.
select private.t5_withdrawal_erasure_patch_function('private.process_member_withdrawal(uuid,uuid,text,bigint,text,text)'::regprocedure, array[
$a$  anonymized jsonb;
begin
$a$,
$a$  anonymized jsonb;
  signin jsonb;
  personal jsonb;
begin
$a$,
$a$  if p_basis = 'kakao_unlink' then
    erased_kakao := private.erase_member_kakao_identities(p_target);
  end if;
$a$,
$a$  -- 재가입 차단 값(이메일·소셜 로그인 계정)을 로그인 연결을 지우기 전에 남긴다(20261126104000).
  perform private.block_withdrawn_member_signin(p_target, changed_at);
  if p_basis = 'kakao_unlink' then
    erased_kakao := private.erase_member_kakao_identities(p_target);
  end if;
  -- 남은 로그인 연결·Auth 프로필 정보와 보존 근거 없는 개인화 데이터(위시·장바구니·알림함·팔로우·쿠폰 등)를 지운다.
  signin := private.erase_withdrawn_member_signin_data(p_target);
  personal := private.erase_withdrawn_member_personal_data(p_target);
$a$,
$a$성인 인증 기록 파기. 이메일은 남긴다.$a$,
$a$성인 인증 기록 파기. 이메일 원문은 문의 근거면 처리 결과 답변 뒤 3일이 지나 정리 잡이, 카카오 근거면 아래에서 바로 지운다.$a$,
$a$    'adultVerifications', (anonymized->>'adultVerifications')::integer)
$a$,
$a$    'adultVerifications', (anonymized->>'adultVerifications')::integer)
    || personal || jsonb_build_object('loginIdentities', (signin->>'identities')::integer)
$a$,
$a$  return private.member_withdrawal_document(p_target) || jsonb_build_object(
    'status', 'processed',$a$,
$a$  -- 카카오 근거는 답변할 문의가 없어 이메일 원문을 처리 때 바로 지운다(문의 근거만 처리 결과 답변 메일을 위해 3일 둔다).
  if p_basis = 'kakao_unlink' then
    perform private.erase_withdrawn_member_email(p_target, p_actor);
  end if;

  return private.member_withdrawal_document(p_target) || jsonb_build_object(
    'status', 'processed',$a$
]);

-- 16. 정리 잡: 처리 3일이 지난 회원의 마무리(문의 근거 이메일 원문 파기·그 사이 생긴 행 삭제), 기한이 지난 재가입 차단 값 삭제,
--     처리 1년이 지난 회원의 동의 원장·남은 신고 삭제.
create function private.run_member_withdrawal_retention(p_limit integer default 100) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  batch integer := greatest(least(coalesce(p_limit, 100), 1000), 1);
  subject uuid;
  finished jsonb;
  followups integer := 0;
  emails integer := 0;
  purged integer := 0;
  expired integer;
begin
  for subject in
    select w.user_id from private.member_withdrawal_processings w
    where w.followup_erased_at is null and w.processed_at <= pg_catalog.clock_timestamp() - interval '3 days'
    order by w.processed_at, w.user_id limit batch
  loop
    finished := private.finish_withdrawn_member_erasure(subject);
    if finished is not null then
      followups := followups + 1;
      if (finished->>'emailErased')::boolean then emails := emails + 1; end if;
    end if;
  end loop;

  delete from private.withdrawn_signin_blocks where blocked_until <= pg_catalog.clock_timestamp();
  get diagnostics expired = row_count;

  for subject in
    select w.user_id from private.member_withdrawal_processings w
    where w.retention_purged_at is null and w.processed_at <= pg_catalog.clock_timestamp() - interval '1 year'
    order by w.processed_at, w.user_id limit batch
    for update of w skip locked
  loop
    delete from private.customer_marketing_consent_events where user_id = subject;
    delete from private.customer_marketing_consents where user_id = subject;
    delete from private.customer_demographic_consents where user_id = subject;
    delete from private.member_activity_consents where user_id = subject;
    delete from public.reports where reporter_id = subject;
    update private.member_withdrawal_processings set retention_purged_at = pg_catalog.clock_timestamp() where user_id = subject;
    insert into public.audit_log (actor_id, action, target, diff)
    values (null, 'admin.member.withdrawal_retention_purged', 'profile:' || subject::text, '{}'::jsonb);
    purged := purged + 1;
  end loop;

  return jsonb_build_object('followups', followups, 'emailsErased', emails, 'signinBlocksExpired', expired, 'retentionPurged', purged);
end $$;
alter function private.run_member_withdrawal_retention(integer) owner to postgres;
revoke all on function private.run_member_withdrawal_retention(integer) from public, anon, authenticated, service_role;

-- 17. GoTrue 접속 기록(auth.audit_log_entries — 이메일·IP가 든 로그인·토큰 이벤트) 3개월 보존 뒤 삭제(처리방침 제3조 '서비스 접속에 관한
--     기록 3개월'). 한 번에 p_limit건. 운영 DB에서 postgres가 이 표를 지울 수 없거나 표가 없으면 실패하지 않고 -1을 돌려준다.
create function private.purge_auth_audit_log(p_limit integer default 50000) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare purged integer;
begin
  if pg_catalog.to_regclass('auth.audit_log_entries') is null then return -1; end if;
  execute 'delete from auth.audit_log_entries where id in (select a.id from auth.audit_log_entries as a where a.created_at < pg_catalog.now() - $2 limit $1)'
    using greatest(least(coalesce(p_limit, 50000), 200000), 1), interval '3 months';
  get diagnostics purged = row_count;
  return purged;
exception when insufficient_privilege or undefined_table or undefined_column then
  return -1;
end $$;
alter function private.purge_auth_audit_log(integer) owner to postgres;
revoke all on function private.purge_auth_audit_log(integer) from public, anon, authenticated, service_role;

-- 18. 이 migration 전에 처리된 회원: 재가입 차단 값(처리일 기준 1년)을 남기고 같은 삭제를 적용한다(바뀐 것이 있을 때만 감사).
--     처리 3일이 지난 회원의 이메일 원문은 아래 정리 잡 한 번이 지운다.
do $$
declare subject record;
begin
  for subject in select w.user_id from private.member_withdrawal_processings w order by w.user_id loop
    perform private.sweep_withdrawn_member_data(subject.user_id, null);
  end loop;
  perform private.run_member_withdrawal_retention(1000);
end $$;

-- 19. 정리 잡 등록. pg_cron이 있는 배포만 등록한다. cron.schedule은 이름 기준 upsert라 재적용에 안전하다.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('member-withdrawal-retention', '41 * * * *', 'select private.run_member_withdrawal_retention(100)');
    perform cron.schedule('auth-audit-log-retention', '53 3 * * *', 'select private.purge_auth_audit_log(50000)');
  end if;
end;
$$;

comment on table private.member_withdrawal_processings is
  '회원 탈퇴의 운영자 처리 기록 — 1:1 문의(basis inquiry) 또는 카카오계정 탈퇴 알림(basis kakao_unlink). 처리 때 보존 근거 없는 개인정보·로그인 연결을 지우고, 이메일 원문은 카카오 근거면 처리 때·문의 근거면 3일 뒤(email_erased_at), 3일 뒤 그 사이 생긴 행을 다시 지우고(followup_erased_at), 동의 원장·남은 신고는 1년 뒤(retention_purged_at) 정리 잡이 지운다. 남는 항목과 근거는 docs/account-deletion-retention-policy.md §5.';

drop function private.t5_withdrawal_erasure_patch_function(regprocedure, text[]);

notify pgrst, 'reload schema';

commit;
