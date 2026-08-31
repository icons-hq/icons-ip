-- S8 리뷰 하드닝 (#330 / PR #373): 캠페인·코인·Q&A 도메인이 열어 둔 구멍을
-- 스키마 변경 없이 닫는다.
--
-- 20260831100000~20260831100300은 이미 적용된 마이그레이션이라 고치지 않는다.
-- 여기서는 함수를 재정의하고 트리거를 덧붙이는 방식만 쓴다.
--
-- 다섯 가지를 담는다.
--   1) 교환 RPC가 "실제 노출 경로가 있는 상품"만 받는다.
--   2) 계정 삭제 write fence를 코인·Q&A 테이블 자체에 건다(RPC 밖 경로까지).
--   3) 오프라인 팝업 알림 백필의 나머지 — 제목·본문.
--   4) 캠페인 슬러그를 이벤트가 되가져가는 역방향 섀도잉 차단.
--   5) 온라인 이벤트에 '오프라인 팝업' 알림을 보내지 않는다.

-- ── 1. 교환은 진행 중 공개 캠페인이 걸어 둔 상품에만 성립한다 ───────────────
--
-- 기존 게이트는 coin_exchange_offers.status 하나였다. 캠페인이 끝난 뒤 운영자가
-- 상품을 'disabled'로 내리는 것을 잊으면, 화면에서는 사라진 교환이 직접 RPC
-- 호출이나 캐시된 폼 재제출로는 계속 성립한다 — 종료된 편성의 카드팩이 기간
-- 밖에서 계속 나간다.
--
-- 스키마를 바꾸지 않고 판정을 뒤집는다: 상품이 "살아 있는가"가 아니라 그 상품을
-- 지금 실제로 노출하는 경로가 있는가를 묻는다. 노출 경로는 진행 중 공개 캠페인의
-- exchange 블록 하나뿐이다(캠페인 상세 외에 교환 버튼을 그리는 표면이 없다).
--
-- 시간 경계는 화면의 ClosedNotice(campaign displayState 'ended')와 같다 —
-- now() < ends_at. 두 경계가 갈라지면 "종료됨"이라고 적힌 화면에서 교환이
-- 성립하거나, 열려 있는 화면이 거절당한다.
--
-- 에러는 offer_unavailable을 재사용한다. 사용자에게는 "지금은 교환할 수 없는
-- 상품"이라는 사실 하나면 되고, 앱의 문구 매핑(participation-actions.ts)도
-- 그대로 둔다.
create or replace function public.exchange_coins_for_draw_tickets(
  p_operation_id uuid,
  p_offer_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_offer public.coin_exchange_offers%rowtype;
  v_ledger_owner uuid;
  v_ledger_offer uuid;
  v_balance integer;
  v_issued integer;
  v_existing_count integer;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user
      and profile.suspended_at is not null
  ) then
    raise exception 'account_suspended' using errcode = '55000';
  end if;

  -- 탈퇴 신청으로 쓰기가 봉인된 계정(20260813193000 의 계정 fence 관례).
  if private.is_account_write_fenced(v_user) then
    raise object_not_in_prerequisite_state
      using message = 'account_deletion_write_fenced';
  end if;

  if p_operation_id is null then
    raise exception 'invalid_operation' using errcode = '22004';
  end if;

  -- 응답이 유실된 재시도는 먼저 커밋된 원장을 관측한 뒤에 판단해야 한다
  -- (admin_grant_draw_tickets와 같은 관용구). 잠금이 없으면 두 재시도가 모두
  -- "없음"을 보고 각자 차감한 뒤 하나가 unique 위반으로 되돌아간다.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('coin_exchange:' || p_operation_id::text, 0)
  );

  select ledger.user_id, ledger.offer_id
    into v_ledger_owner, v_ledger_offer
  from public.coin_ledger as ledger
  where ledger.operation_id = p_operation_id;

  if found then
    -- 남의 멱등 키를 재생해 잔액·발급 수를 읽어 가는 경로를 막는다.
    if v_ledger_owner is distinct from v_user then
      raise exception 'exchange_operation_conflict' using errcode = '23505';
    end if;

    -- 같은 키인데 다른 상품이면 재시도가 아니라 다른 요청이다. 캠페인 한 장에
    -- 교환 블록이 여러 개일 때 화면이 키를 공유하면 여기로 온다 — already_exchanged
    -- 로 답하면 두 번째 상품은 교환되지 않았는데 성공으로 읽힌다.
    if v_ledger_offer is distinct from p_offer_id then
      raise exception 'exchange_operation_conflict' using errcode = '23505',
        detail = 'operation_id is bound to a different offer';
    end if;

    select coalesce(balance, 0) into v_balance
    from public.coin_balances
    where user_id = v_user;

    select count(*)::integer into v_existing_count
    from public.draw_tickets as ticket
    where ticket.source = 'coin_exchange'
      and ticket.source_id = p_operation_id;

    -- 이미 성립한 교환의 재생은 캠페인 상태를 다시 묻지 않는다. 커밋된 사실을
    -- 나중의 편성 변경으로 뒤집으면, 응답만 유실된 사용자가 발급받은 카드팩을
    -- 설명할 수 없는 상태가 된다.
    return jsonb_build_object(
      'status', 'already_exchanged',
      'balance', coalesce(v_balance, 0),
      'issued_count', v_existing_count
    );
  end if;

  select offer.*
    into v_offer
  from public.coin_exchange_offers as offer
  where offer.id = p_offer_id
  for share;

  if not found or v_offer.status <> 'active' then
    raise exception 'offer_unavailable' using errcode = 'P0002';
  end if;

  -- 노출 경로 확인. sections는 admin_upsert_campaign의 검증을 통과한 배열이라
  -- exchange 블록의 offer_id는 uuid 문자열이다. 대소문자만 정규화한다 —
  -- 검증 정규식이 대소문자를 가리지 않아 대문자 uuid도 저장될 수 있다.
  if not exists (
    select 1
    from public.campaigns as campaign,
      lateral pg_catalog.jsonb_array_elements(campaign.sections) as section(entry)
    where campaign.status = 'published'
      and campaign.starts_at <= now()
      and now() < campaign.ends_at
      and section.entry ->> 'type' = 'exchange'
      and pg_catalog.lower(section.entry ->> 'offer_id') = p_offer_id::text
  ) then
    raise exception 'offer_unavailable' using errcode = 'P0002';
  end if;

  perform private.assert_card_pool_ready(v_offer.pool_id);

  -- 직렬화 지점. 두 세션이 같은 잔액을 노리면 뒤에 온 쪽은 잠금 해제 후 갱신된
  -- 행으로 조건을 다시 평가해 0행을 얻는다 — 초과 인출이 성립할 창이 없다.
  update public.coin_balances
  set balance = balance - v_offer.coin_cost,
      updated_at = now()
  where user_id = v_user
    and balance >= v_offer.coin_cost
  returning balance into v_balance;

  if not found then
    raise exception 'insufficient_coins';
  end if;

  insert into public.coin_ledger (user_id, amount, reason, operation_id, offer_id)
  values (v_user, -v_offer.coin_cost, 'exchange', p_operation_id, v_offer.id);

  -- source_id = operation_id 라서 unique (source, source_id, ordinal)이 재시도
  -- 이중 발급을 DB 레벨에서 한 번 더 막는다.
  insert into public.draw_tickets (user_id, pool_id, source, source_id, ordinal)
  select v_user, v_offer.pool_id, 'coin_exchange', p_operation_id, issue_series.n
  from pg_catalog.generate_series(1, v_offer.ticket_count) as issue_series(n);

  get diagnostics v_issued = row_count;

  -- 게이트가 행을 삼켰다. 코인 차감·원장·잔액까지 전부 되돌린다.
  if v_issued <> v_offer.ticket_count then
    raise exception 'card_rewards_disabled' using errcode = '55000';
  end if;

  -- 알림은 draw_tickets STATEMENT 트리거(20260716090001)가 보낸다. 여기서 직접
  -- 넣으면 발급 한 건에 알림이 두 번 간다.
  return jsonb_build_object(
    'status', 'exchanged',
    'balance', v_balance,
    'issued_count', v_issued
  );
end;
$$;

-- ⚠️ create or replace는 기존 ACL을 보존하지만, Supabase default privileges가
--    public 스키마 함수에 anon/authenticated/service_role execute를 자동
--    부여하므로 이 파일만 읽고 봉인 상태를 판단할 수 있어야 한다.
--    `from public`만으로는 봉인되지 않는다.
revoke all on function public.exchange_coins_for_draw_tickets(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.exchange_coins_for_draw_tickets(uuid, uuid) to authenticated;

-- ── 2. 계정 삭제 write fence — 코인·Q&A 테이블 ──────────────────────────────
--
-- RPC와 RLS 정책은 각자 fence를 확인하지만, 그 확인은 그 경로에만 붙어 있다.
-- 나중에 생기는 어드민 보정 RPC나 배치 하나가 fence를 잊으면 삭제 대기 계정에
-- 새 잔액·새 공개 글이 생긴다. 20260813193000이 orders·likes·cart_items에
-- 걸어 둔 것과 같은 테이블 레벨 방어를 코인·Q&A에도 건다.
--
-- coin_balances에는 걸지 않는다. 교환 RPC는 balances를 먼저 차감하고 원장을
-- 넣는데, ledger insert가 fence 예외로 던지면 같은 트랜잭션이 통째로 롤백된다 —
-- attendance와 ledger 두 곳이면 코인이 늘거나 주는 모든 경로가 닫힌다.
-- balances에까지 걸면 막는 것은 같고 "차감 먼저"라는 순서에만 의존이 하나 는다.
create trigger trg_account_fence_coin_attendance
before insert on public.coin_attendance
for each row execute function private.guard_account_insert_or_update('user_id');

create trigger trg_account_fence_coin_ledger
before insert on public.coin_ledger
for each row execute function private.guard_account_insert_or_update('user_id');

-- Q&A는 RLS insert 정책이 이미 fence를 보지만, 그 술어는 authenticated 경로에만
-- 있다. security definer로 도는 경로는 정책을 지나지 않는다.
create trigger trg_account_fence_product_questions
before insert on public.product_questions
for each row execute function private.guard_account_insert_or_update('user_id');

-- ── 3. 오프라인 팝업 알림 백필 — 제목·본문 ─────────────────────────────────
--
-- 20260831100300은 link_path만 옮겼다. 이미 알림함에 쌓인 행은 여전히
-- '새 이벤트가 공개됐어요' / '<제목> 이벤트가 공개됐습니다.'를 들고 있어서,
-- 알림 문구와 도착 화면('/offline-popups')이 서로 다른 것을 가리킨다.
--
-- 대상 판정을 link_path로 하지 않는다. 100300의 백필이 먼저 돌아 이미 전부
-- '/offline-popups'로 바뀌었다 — 그 조건으로는 0행이다. 옛 제목이 남은 것이
-- 이사 전에 발송됐다는 유일한 증거다.
--
-- body는 500자에서 잘릴 수 있다. 접미사가 잘려 나간 행은 원문을 그대로 둔다 —
-- 문장 중간을 짐작해서 고치면 없던 말을 만든다.
update public.notifications
set title = '새 오프라인 팝업이 공개됐어요',
    link_path = '/offline-popups',
    body = case
      when body like '%이벤트가 공개됐습니다.'
        then left(replace(body, ' 이벤트가 공개됐습니다.', ' 오프라인 팝업이 공개됐습니다.'), 500)
      else body
    end
where type = 'event_published'
  and title = '새 이벤트가 공개됐어요';

-- ── 4. 캠페인 슬러그 역방향 섀도잉 차단 ────────────────────────────────────
--
-- admin_upsert_campaign(20260831100000)은 events가 선점한 슬러그를 캠페인이
-- 가져가는 것을 막는다. 반대 방향은 열려 있었다: 캠페인이 쓰고 있는 슬러그로
-- 오프라인 팝업을 새로 만들 수 있었다.
--
-- 그 팝업은 만들어지는 순간 자기 딥링크를 잃는다. `/events/<id>`는 캠페인을 먼저
-- 조회하고 있어서 레거시 링크가 영영 캠페인 상세로 간다 — 팝업은 존재하지만
-- 옛 주소로는 닿을 수 없다.
--
-- 20260807090001:228의 정의를 그대로 승계하고 신규 생성 분기에만 검사를 더한다.
create or replace function public.admin_upsert_event(
  target_id text,
  target_ip_id text,
  target_title text,
  target_mode text,
  target_status text,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  target_location text,
  target_accent text,
  target_bg text,
  target_image_path text,
  target_previous_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_id is not null then
    if normalized_previous_id is distinct from target_id then
      raise exception 'catalog_id_immutable' using errcode = '22023';
    end if;

    perform 1 from public.events where id = target_id for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  else
    -- 슬러그 섀도잉 차단(역방향). 수정 분기에는 걸지 않는다 — 이 조건이 참인
    -- 기존 팝업이 있다면 그것은 이 가드가 생기기 전에 만들어진 행이고, 편집을
    -- 막아도 충돌은 그대로 남는다.
    if exists (select 1 from public.campaigns where id = target_id) then
      raise exception 'catalog_id_taken' using errcode = '23505';
    end if;
  end if;

  insert into public.events (
    id,
    ip_id,
    title,
    mode,
    status,
    starts_at,
    ends_at,
    location,
    accent,
    bg,
    image_path
  )
  values (
    target_id,
    target_ip_id,
    target_title,
    target_mode,
    target_status,
    target_starts_at,
    target_ends_at,
    target_location,
    target_accent,
    target_bg,
    target_image_path
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id,
    title = excluded.title,
    mode = excluded.mode,
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    location = excluded.location,
    accent = excluded.accent,
    bg = excluded.bg,
    image_path = excluded.image_path,
    updated_at = now()
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.event.upsert',
    'events:' || target_id,
    jsonb_build_object(
      'id', target_id,
      'ip_id', target_ip_id,
      'title', target_title,
      'status', target_status,
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );
end;
$$;

revoke all on function public.admin_upsert_event(
  text, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_event(
  text, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text
) to authenticated;

-- ── 5. 온라인 이벤트는 '오프라인 팝업' 알림을 보내지 않는다 ────────────────
--
-- 20260831100300이 알림 문구를 '새 오프라인 팝업이 공개됐어요'로 바꿨는데,
-- 팬아웃 조건에는 mode가 없다. mode='온라인' 이벤트가 공개되면 팔로워는
-- 오프라인 팝업이 열렸다는 알림을 받는다 — 사실이 아닌 문장이다.
--
-- 문구를 mode별로 가르지 않고 온라인은 알리지 않는 쪽을 택한다. 온라인 편성의
-- 정본 표면은 캠페인 허브·IP 관이고, 그쪽 알림은 이 트리거가 아니라 각자의
-- 발행 경로가 낼 몫이다.
--
-- 나머지(ip_id·staff 게이트·dedupe 키·link_path)는 100300 그대로다.
create or replace function private.notify_event_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.ip_id is null
    or new.mode = '온라인'
    or (select auth.uid()) is null
    or not (select public.is_staff())
  then
    return new;
  end if;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  select
    follow.user_id,
    'event_published',
    '새 오프라인 팝업이 공개됐어요',
    left(new.title || ' 오프라인 팝업이 공개됐습니다.', 500),
    '/offline-popups',
    'event',
    new.id,
    'event:' || pg_catalog.encode(
      extensions.digest(new.id, 'sha256'),
      'hex'
    )
  from public.ip_follows as follow
  where follow.ip_id = new.ip_id
    and follow.notify_events
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

revoke all on function private.notify_event_insert()
  from public, anon, authenticated, service_role;
