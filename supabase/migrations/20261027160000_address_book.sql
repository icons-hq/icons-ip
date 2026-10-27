-- LFS 패리티 2차 L7 (#572) — MY-11 주소록(배송지 관리). 10/14 후속 백로그 S6b·S3 흡수.
--
-- 회원이 저장해 두는 배송지 목록이다. 주문서에서 골라 채우는 입력 보조일 뿐이고, 주문에 저장되는
-- 배송지(orders.address)는 주문할 때 폼에 적힌 사본이다 — 주소록을 고치거나 지워도 이미 만든 주문의
-- 배송지는 바뀌지 않는다. 주문 주소 JSON 계약·주문 생성 RPC·결제 경로는 이 migration 이 건드리지 않는다.
-- 선물 수령인 주소는 담지 않는다(수령인 주소는 private.gift_recipient_addresses 의 몫이다).
--
-- 계약
--   · 본인만 읽는다(RLS). 쓰기는 아래 RPC 셋으로만 한다 — 표 직접 쓰기 권한은 어느 롤에도 주지 않는다.
--   · 회원당 최대 10개. 주소가 하나라도 있으면 기본 배송지는 정확히 1개다: 부분 유니크 인덱스가 "2개 이상"을
--     막고, 쓰기 RPC 가 회원 단위 잠금 안에서 첫 주소를 기본으로 만들고 기본 주소를 지우면 다른 주소를 올린다.
--   · 탈퇴를 신청해 쓰기가 봉인된 계정(private.is_account_write_fenced)의 쓰기를 거절한다(product_questions·
--     coin_participation·restock 관례). 봉인이 생기는 그 트랜잭션에서 주소록을 지운다(account_action_fences
--     after insert 트리거 — member_activity·customer_demographics 관례). 주문에 저장된 배송지는 거래 기록이라
--     그대로 남는다(탈퇴 법정 보존 스냅샷은 주문 쪽 계약이다).
--   · 탈퇴 신청 기능(account_deletion_control.phase_one_enabled)이 꺼져 있는 동안 탈퇴는 문의로 받아 운영자가
--     처리한다. 이때는 봉인 행이 생기지 않고, 주문이 있는 회원은 orders.user_id(on delete restrict) 때문에 Auth
--     사용자 삭제도 막혀 profiles FK cascade 로 지워지지 않는다. 그래서 운영자가 탈퇴를 처리할 때 부르는 봉인된
--     삭제 함수 private.erase_member_address_book(uuid)를 둔다(SQL 편집기 전용 — 어느 API 롤에도 열지 않는다).
--     운영자는 먼저 계정을 정지해(admin_suspend_user) 새 저장을 막은 뒤 이 함수로 지운다.
--   · 새 저장(추가·수정·기본 지정)은 온보딩을 마치고(onboarded_at·약관·개인정보처리방침 동의) 정지되지 않은 회원만
--     한다(subscription_lock_actor 관례 — 처리방침에 동의하지 않은 회원의 연락처·주소를 받지 않는다). 삭제는
--     자기 개인정보를 지우는 일이라 정지·미온보딩이어도 막지 않는다.
--   · updated_at 은 회원이 마지막으로 저장(추가·수정)한 시각이다. 기본 배송지를 지정·해제하거나 승계할 때는
--     바꾸지 않는다 — 기본 배송지를 지우면 이 시각이 가장 늦은 배송지가 기본이 된다(화면 안내와 같은 규칙).
--   · 주소 필드 검증은 주문 배송지 정정과 같은 정규화(private.normalize_order_address_change)를 쓴다 —
--     주소록에 들어간 값은 언제나 주문 배송지로 그대로 쓸 수 있다.
--
-- 잠금 순서: 계정 행동 잠금(private.is_account_write_fenced 가 잡는 'account-action:' advisory) → 주소록 잠금
-- ('address-book:' advisory). 탈퇴 신청(request_my_account_deletion)도 계정 행동 잠금을 먼저 잡고 봉인을 넣으므로,
-- 진행 중인 저장이 끝난 뒤에 봉인·삭제가 일어나고 그 뒤의 저장은 봉인을 보고 거절된다.

begin;

-- ── 1. 표 ─────────────────────────────────────────────────────────────
create table public.address_book_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 배송지 이름(별칭) — '집', '회사'처럼 회원이 붙이는 이름.
  label text not null,
  recipient_name text not null,
  -- 숫자만(8~15자리) — 주문 배송지와 같은 정규화.
  phone text not null,
  postal_code text not null,
  address1 text not null,
  -- 상세 주소. 비우면 null(빈 문자열을 저장하지 않는다).
  address2 text,
  is_default boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  -- 회원이 마지막으로 저장(추가·수정)한 시각. 기본 지정·해제·승계로는 바뀌지 않는다(기본 승계 순서의 근거).
  updated_at timestamptz not null default clock_timestamp(),
  constraint address_book_entries_label_check
    check (label = btrim(label) and char_length(label) between 1 and 20 and label !~ '[[:cntrl:]]'),
  constraint address_book_entries_recipient_check
    check (recipient_name = btrim(recipient_name) and char_length(recipient_name) between 1 and 50 and recipient_name !~ '[[:cntrl:]]'),
  constraint address_book_entries_phone_check
    check (phone ~ '^[0-9]{8,15}$'),
  constraint address_book_entries_postal_check
    check (postal_code ~ '^[0-9]{5}$'),
  constraint address_book_entries_address1_check
    check (address1 = btrim(address1) and char_length(address1) between 1 and 200 and address1 !~ '[[:cntrl:]]'),
  constraint address_book_entries_address2_check
    check (address2 is null or (address2 = btrim(address2) and char_length(address2) between 1 and 200 and address2 !~ '[[:cntrl:]]'))
);

comment on table public.address_book_entries is
  '주소록 — 회원이 저장한 배송지(별칭·받는 분·연락처·주소, 기본 배송지 1개, 회원당 최대 10개). 주문서 입력 보조이며 주문 배송지(orders.address)와 별개다. 본인만 읽고, 쓰기는 save/set_default/delete RPC 로만 한다. 탈퇴 신청(계정 봉인) 시 삭제되고, 문의로 받은 탈퇴는 운영자가 private.erase_member_address_book 으로 지운다.';

-- 회원당 기본 배송지는 많아야 1개(정확히 1개는 RPC 가 지킨다).
create unique index address_book_entries_one_default
  on public.address_book_entries (user_id)
  where is_default;

-- 목록 조회(기본 먼저 → 등록 순)와 회원 단위 개수·삭제를 받는다.
create index address_book_entries_user_idx
  on public.address_book_entries (user_id, created_at, id);

alter table public.address_book_entries enable row level security;

create policy address_book_entries_select_own
  on public.address_book_entries
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.address_book_entries from public, anon, authenticated, service_role;
grant select on table public.address_book_entries to authenticated;

-- 봉인된 계정으로의 쓰기를 표 수준에서도 막는다(다른 회원 소유 표와 같은 방어선).
create trigger trg_account_fence_address_book_entries
before insert or update on public.address_book_entries
for each row execute function private.guard_account_insert_or_update('user_id');

-- ── 2. 쓰기 공통: 인증 · 봉인 · 회원 단위 잠금 ─────────────────────────
-- p_new_write: 추가·수정·기본 지정이면 true(온보딩·정지 확인), 삭제면 false(자기 개인정보 삭제는 막지 않는다).
create function private.address_book_actor(p_new_write boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_profile public.profiles;
begin
  if actor is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  -- 계정 행동 잠금을 먼저 잡는다(위 잠금 순서). 봉인된 계정은 여기서 끝난다.
  if private.is_account_write_fenced(actor) then
    raise object_not_in_prerequisite_state using message = 'account_deletion_write_fenced';
  end if;
  if p_new_write is distinct from false then
    select * into actor_profile from public.profiles where id = actor;
    if not found then
      raise exception 'auth_required' using errcode = '28000';
    end if;
    if actor_profile.suspended_at is not null then
      raise insufficient_privilege using message = 'account_suspended';
    end if;
    -- 개인정보처리방침에 동의하고 온보딩을 마친 회원만 연락처·주소를 저장한다(subscription_lock_actor 관례).
    if actor_profile.onboarded_at is null
      or actor_profile.consents->>'terms' is distinct from 'true'
      or actor_profile.consents->>'privacy' is distinct from 'true' then
      raise insufficient_privilege using message = 'onboarding_required';
    end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('address-book:' || actor::text, 0)
  );
  return actor;
end;
$$;

revoke all on function private.address_book_actor(boolean) from public, anon, authenticated, service_role;

-- ── 3. 저장(추가·수정) ────────────────────────────────────────────────
-- p_entry_id 가 null 이면 추가, 있으면 내 주소 수정. p_address 는 주문 배송지 JSON 과 같은 키
-- (recipientName·phone·postalCode·address1·address2)만 받는다 — 배송 메모는 주문마다 다르므로 담지 않는다.
-- 첫 주소는 언제나 기본 배송지가 된다. 기본 배송지를 수정하면서 기본을 끄는 일은 없다(다른 주소를 기본으로
-- 지정하면 넘어간다) — 그래야 주소가 있는 동안 기본 배송지가 늘 1개다.
create function public.save_my_address_book_entry(
  p_entry_id uuid,
  p_label text,
  p_address jsonb,
  p_make_default boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid;
  clean_label text := btrim(coalesce(p_label, ''));
  normalized jsonb;
  target public.address_book_entries;
  entry_count integer;
  becomes_default boolean;
  saved_id uuid;
begin
  actor := private.address_book_actor(true);

  if char_length(clean_label) not between 1 and 20 or clean_label ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'address_book_invalid';
  end if;
  if p_address is null or jsonb_typeof(p_address) <> 'object' or p_address ? 'deliveryNote' then
    raise invalid_parameter_value using message = 'address_book_invalid';
  end if;
  begin
    normalized := private.normalize_order_address_change(p_address);
  exception when invalid_parameter_value then
    raise invalid_parameter_value using message = 'address_book_invalid';
  end;

  if p_entry_id is null then
    select count(*) into entry_count
    from public.address_book_entries
    where user_id = actor;

    if entry_count >= 10 then
      raise check_violation using message = 'address_book_full';
    end if;

    becomes_default := coalesce(p_make_default, false) or entry_count = 0;
    if becomes_default then
      -- 기본 해제는 회원의 수정이 아니다 — updated_at 을 그대로 둔다.
      update public.address_book_entries
      set is_default = false
      where user_id = actor and is_default;
    end if;

    insert into public.address_book_entries (
      user_id, label, recipient_name, phone, postal_code, address1, address2, is_default
    )
    values (
      actor,
      clean_label,
      normalized->>'recipientName',
      normalized->>'phone',
      normalized->>'postalCode',
      normalized->>'address1',
      nullif(normalized->>'address2', ''),
      becomes_default
    )
    returning id into saved_id;

    return saved_id;
  end if;

  select * into target
  from public.address_book_entries
  where id = p_entry_id and user_id = actor
  for update;

  if not found then
    raise no_data_found using message = 'address_book_entry_missing';
  end if;

  becomes_default := target.is_default or coalesce(p_make_default, false);
  if becomes_default and not target.is_default then
    update public.address_book_entries
    set is_default = false
    where user_id = actor and is_default;
  end if;

  update public.address_book_entries
  set label = clean_label,
      recipient_name = normalized->>'recipientName',
      phone = normalized->>'phone',
      postal_code = normalized->>'postalCode',
      address1 = normalized->>'address1',
      address2 = nullif(normalized->>'address2', ''),
      is_default = becomes_default,
      updated_at = clock_timestamp()
  where id = target.id;

  return target.id;
end;
$$;

revoke all on function public.save_my_address_book_entry(uuid, text, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.save_my_address_book_entry(uuid, text, jsonb, boolean) to authenticated;

-- ── 4. 기본 배송지 지정 ───────────────────────────────────────────────
-- 한 트랜잭션·회원 단위 잠금 안에서 내리고 올린다 — 동시에 서로 다른 주소를 지정해도 끝나면 1개다.
-- 지정·해제는 회원이 배송지 내용을 고친 것이 아니라 updated_at 을 바꾸지 않는다(기본 승계 순서가 흔들리지 않게).
create function public.set_my_default_address_book_entry(p_entry_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid;
begin
  actor := private.address_book_actor(true);

  if p_entry_id is null or not exists (
    select 1 from public.address_book_entries where id = p_entry_id and user_id = actor
  ) then
    raise no_data_found using message = 'address_book_entry_missing';
  end if;

  update public.address_book_entries
  set is_default = false
  where user_id = actor and is_default and id <> p_entry_id;

  update public.address_book_entries
  set is_default = true
  where id = p_entry_id and user_id = actor and not is_default;
end;
$$;

revoke all on function public.set_my_default_address_book_entry(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_default_address_book_entry(uuid) to authenticated;

-- ── 5. 삭제 ───────────────────────────────────────────────────────────
-- 기본 배송지를 지우면 남은 주소 가운데 회원이 가장 최근에 저장(추가·수정)한 주소가 기본이 된다(updated_at 순 —
-- 기본 지정·해제는 이 시각을 바꾸지 않는다). 승계도 회원의 수정이 아니라 updated_at 을 그대로 둔다.
-- 삭제는 정지·미온보딩 계정도 할 수 있다(자기 개인정보 삭제). 봉인된 계정은 이미 주소록이 지워졌다.
create function public.delete_my_address_book_entry(p_entry_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid;
  was_default boolean;
begin
  actor := private.address_book_actor(false);

  delete from public.address_book_entries
  where id = p_entry_id and user_id = actor
  returning is_default into was_default;

  if not found then
    raise no_data_found using message = 'address_book_entry_missing';
  end if;

  if was_default then
    update public.address_book_entries
    set is_default = true
    where id = (
      select id from public.address_book_entries
      where user_id = actor
      order by updated_at desc, created_at desc, id
      limit 1
    );
  end if;
end;
$$;

revoke all on function public.delete_my_address_book_entry(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_my_address_book_entry(uuid) to authenticated;

-- ── 6. 탈퇴 시 삭제 ───────────────────────────────────────────────────
-- 회원 한 명의 주소록 전부를 지운다. 계정 행동 잠금 → 주소록 잠금 순서로 잡아(같은 트랜잭션이면 재진입) 진행 중인
-- 저장이 끝나기를 기다린 뒤 지우므로, 삭제 직전에 시작한 저장이 삭제 뒤에 남지 않는다. 지운 개수를 돌려준다.
-- 주문에 저장된 배송지·선물 수령인 주소는 이 범위가 아니다.
--   · 탈퇴 신청(봉인): 아래 트리거가 봉인 행이 생기는 트랜잭션 안에서 부른다.
--   · 탈퇴 신청 기능이 꺼져 있는 동안 문의로 받은 탈퇴: 운영자가 계정을 정지한 뒤(새 저장이 막힌다) SQL 편집기에서
--     `select private.erase_member_address_book('<회원 id>');`로 부른다. API 롤에는 열지 않는다.
create function private.erase_member_address_book(p_user_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  erased integer;
begin
  if p_user_id is null then
    raise invalid_parameter_value using message = 'address_book_member_required';
  end if;
  perform private.lock_account_action_subject(p_user_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('address-book:' || p_user_id::text, 0)
  );
  delete from public.address_book_entries where user_id = p_user_id;
  get diagnostics erased = row_count;
  return erased;
end;
$$;

revoke all on function private.erase_member_address_book(uuid) from public, anon, authenticated, service_role;

-- 봉인 행이 생기는 트랜잭션 안에서 지운다. 봉인을 다른 경로로 넣어도 같은 잠금 순서다.
create function private.erase_fenced_address_book()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.erase_member_address_book(new.subject_user_id);
  return new;
end;
$$;

revoke all on function private.erase_fenced_address_book() from public, anon, authenticated, service_role;

create trigger erase_fenced_address_book
after insert on private.account_action_fences
for each row execute function private.erase_fenced_address_book();

notify pgrst, 'reload schema';

commit;
