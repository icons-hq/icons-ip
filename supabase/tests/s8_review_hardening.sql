\set ON_ERROR_STOP on

-- S8 리뷰 하드닝 스모크(20260901090000).
--
-- 다섯 가지를 시험한다.
--   1) 교환은 진행 중 공개 캠페인이 걸어 둔 상품에만 성립한다. 상품 status만으로는
--      기간이 끝난 편성의 카드팩이 계속 나갔다.
--   2) 계정 삭제 write fence가 RPC 밖 경로(테이블 직접 쓰기)에서도 막는다.
--   3) 캠페인이 쓰고 있는 슬러그로 오프라인 팝업을 새로 만들 수 없다(역방향 섀도잉).
--   4) mode='온라인' 이벤트는 '새 오프라인 팝업' 알림을 내지 않는다.
--   5) 재정의된 함수들의 ACL 봉인이 유지된다.
--
-- 코인 도메인 자체의 불변식(게이트 OFF 롤백·멱등·잔액 경합)은 coin_participation.sql
-- 이 갖는다. 여기서는 그 위에 얹힌 노출 게이트만 본다.

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000831',
    'authenticated', 'authenticated', 's8h-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000832',
    'authenticated', 'authenticated', 's8h-fan@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000833',
    'authenticated', 'authenticated', 's8h-fenced@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000831',
    's8h-staff@example.test', 's8h_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000832',
    's8h-fan@example.test', 's8h_fan', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000833',
    's8h-fenced@example.test', 's8h_fenced', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

-- 탈퇴 신청으로 쓰기가 봉인된 계정. private.is_account_write_fenced는
-- private.account_action_fences에 행이 있는지만 보고, 그 행은 요청 행을 FK로
-- 물고 있어서 두 테이블을 함께 시드해야 한다(20260813193000).
insert into private.account_deletion_requests (
  deletion_event_id, subject_user_id, idempotency_key, status
)
values (
  '00000000-0000-4000-8000-0000000008b1',
  '00000000-0000-4000-8000-000000000833',
  '00000000-0000-4000-8000-0000000008b2',
  'blocked_active_obligation'
);

insert into private.account_action_fences (subject_user_id, deletion_event_id)
values (
  '00000000-0000-4000-8000-000000000833',
  '00000000-0000-4000-8000-0000000008b1'
);

insert into public.ips (id, title, vertical_key)
values ('s8h-ip', 'S8 하드닝 IP', 'character')
on conflict (id) do nothing;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('s8h-g1', 's8h-ip', 'S8 하드닝 굿즈', '피규어', 20000, 'ok', 10)
on conflict (id) do update set price = excluded.price;

insert into public.card_pools (id, ip_id, name)
values ('00000000-0000-4000-8000-0000000008d5', 's8h-ip', 'S8 하드닝 풀')
on conflict (id) do nothing;

insert into public.pool_odds (pool_id, rarity, probability)
values
  ('00000000-0000-4000-8000-0000000008d5', 'N', 1),
  ('00000000-0000-4000-8000-0000000008d5', 'R', 0),
  ('00000000-0000-4000-8000-0000000008d5', 'SR', 0),
  ('00000000-0000-4000-8000-0000000008d5', 'SSR', 0),
  ('00000000-0000-4000-8000-0000000008d5', 'HOLO', 0)
on conflict (pool_id, rarity) do update set probability = excluded.probability;

insert into public.cards (id, ip_id, name, no, rarity, pool_id)
values ('s8h-card-n', 's8h-ip', 'S8 하드닝 카드', '001', 'N', '00000000-0000-4000-8000-0000000008d5')
on conflict (id) do nothing;

-- 교환이 성립하려면 전역 카드 리워드 게이트가 켜져 있어야 한다.
update private.card_reward_control set enabled = true where singleton;

-- ── ACL 계약: 재정의된 함수의 봉인이 유지된다 ──────────────────────────────
--
-- create or replace는 기존 ACL을 보존하지만, Supabase default privileges가
-- 신규 정의에 execute를 얹는 사고가 여기서 잡혀야 한다.

select 1 / case when not has_function_privilege(
    'anon', 'public.exchange_coins_for_draw_tickets(uuid, uuid)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.exchange_coins_for_draw_tickets(uuid, uuid)', 'execute'
  )
  and not has_function_privilege(
    'service_role', 'public.exchange_coins_for_draw_tickets(uuid, uuid)', 'execute'
  )
then 1 else 0 end as assert_exchange_rpc_still_sealed;

select 1 / case when not has_function_privilege(
    'anon',
    'public.admin_upsert_event(text, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_upsert_event(text, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_upsert_event(text, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text)',
    'execute'
  )
then 1 else 0 end as assert_admin_upsert_event_still_sealed;

select 1 / case when not exists (
  select 1
  from unnest(array['anon', 'authenticated', 'service_role']) as app_role(name)
  where has_function_privilege(app_role.name, 'private.notify_event_insert()', 'execute')
) then 1 else 0 end as assert_notify_event_insert_sealed;

-- fence 트리거가 세 테이블에 모두 걸려 있다.
select 1 / case when (
  select count(*) = 3
  from pg_trigger
  where not tgisinternal
    and tgname in (
      'trg_account_fence_coin_attendance',
      'trg_account_fence_coin_ledger',
      'trg_account_fence_product_questions'
    )
) then 1 else 0 end as assert_fence_triggers_registered;

-- coin_balances에는 걸지 않는다. 교환 RPC가 balances를 먼저 차감하고 ledger를
-- 넣으므로 ledger·attendance 두 곳이면 모든 쓰기 경로가 닫힌다.
select 1 / case when not exists (
  select 1
  from pg_trigger
  where not tgisinternal
    and tgrelid = 'public.coin_balances'::regclass
    and tgname like 'trg_account_fence%'
) then 1 else 0 end as assert_no_fence_trigger_on_balances;

-- ── 교환 상품·캠페인 픽스처 ────────────────────────────────────────────────

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000831', true);
set local role authenticated;

select public.admin_upsert_coin_exchange_offer(
  target_id => null,
  target_pool_id => '00000000-0000-4000-8000-0000000008d5',
  target_label => '노출된 카드팩',
  target_coin_cost => 1,
  target_ticket_count => 1,
  target_status => 'active'
) as live_offer_id \gset

select public.admin_upsert_coin_exchange_offer(
  target_id => null,
  target_pool_id => '00000000-0000-4000-8000-0000000008d5',
  target_label => '어디에도 안 걸린 카드팩',
  target_coin_cost => 1,
  target_ticket_count => 1,
  target_status => 'active'
) as orphan_offer_id \gset

select public.admin_upsert_coin_exchange_offer(
  target_id => null,
  target_pool_id => '00000000-0000-4000-8000-0000000008d5',
  target_label => '기간 끝난 편성의 카드팩',
  target_coin_cost => 1,
  target_ticket_count => 1,
  target_status => 'active'
) as expired_offer_id \gset

select public.admin_upsert_coin_exchange_offer(
  target_id => null,
  target_pool_id => '00000000-0000-4000-8000-0000000008d5',
  target_label => '준비 중 편성의 카드팩',
  target_coin_cost => 1,
  target_ticket_count => 1,
  target_status => 'active'
) as draft_offer_id \gset

select public.admin_upsert_coin_exchange_offer(
  target_id => null,
  target_pool_id => '00000000-0000-4000-8000-0000000008d5',
  target_label => '종료 처리된 편성의 카드팩',
  target_coin_cost => 1,
  target_ticket_count => 1,
  target_status => 'active'
) as closed_offer_id \gset

select set_config('test.live_offer_id', :'live_offer_id', true) as s1 \gset
select set_config('test.orphan_offer_id', :'orphan_offer_id', true) as s2 \gset
select set_config('test.expired_offer_id', :'expired_offer_id', true) as s3 \gset
select set_config('test.draft_offer_id', :'draft_offer_id', true) as s4 \gset
select set_config('test.closed_offer_id', :'closed_offer_id', true) as s5 \gset

-- 진행 중 공개 편성. 이 상품만 교환할 수 있어야 한다.
select public.admin_upsert_campaign(
  target_id => 's8h-live',
  target_kind => 'event',
  target_title => '진행 중 편성',
  target_subtitle => null,
  target_status => 'published',
  target_starts_at => now() - interval '1 hour',
  target_ends_at => now() + interval '10 days',
  target_hero_image_path => null,
  target_card_image_path => null,
  target_banner_image_path => null,
  target_featured_order => null,
  target_sections => jsonb_build_array(
    jsonb_build_object('type', 'exchange', 'offer_id', :'live_offer_id')
  ),
  target_previous_id => null
);

-- 공개돼 있지만 기간이 끝난 편성. 화면은 ClosedNotice를 그린다.
select public.admin_upsert_campaign(
  target_id => 's8h-expired',
  target_kind => 'event',
  target_title => '기간이 끝난 편성',
  target_subtitle => null,
  target_status => 'published',
  target_starts_at => now() - interval '20 days',
  target_ends_at => now() - interval '1 day',
  target_hero_image_path => null,
  target_card_image_path => null,
  target_banner_image_path => null,
  target_featured_order => null,
  target_sections => jsonb_build_array(
    jsonb_build_object('type', 'exchange', 'offer_id', :'expired_offer_id')
  ),
  target_previous_id => null
);

-- 아직 공개되지 않은 편성. 운영자만 보는 문서라 교환 경로가 없다.
select public.admin_upsert_campaign(
  target_id => 's8h-draft',
  target_kind => 'drop',
  target_title => '준비 중 편성',
  target_subtitle => null,
  target_status => 'draft',
  target_starts_at => now() - interval '1 hour',
  target_ends_at => now() + interval '10 days',
  target_hero_image_path => null,
  target_card_image_path => null,
  target_banner_image_path => null,
  target_featured_order => null,
  target_sections => jsonb_build_array(
    jsonb_build_object('type', 'exchange', 'offer_id', :'draft_offer_id')
  ),
  target_previous_id => null
);

-- 기간은 남았지만 운영자가 종료로 내린 편성. 상태 축을 시간 축과 따로 시험한다.
select public.admin_upsert_campaign(
  target_id => 's8h-closed',
  target_kind => 'event',
  target_title => '종료 처리된 편성',
  target_subtitle => null,
  target_status => 'ended',
  target_starts_at => now() - interval '1 hour',
  target_ends_at => now() + interval '10 days',
  target_hero_image_path => null,
  target_card_image_path => null,
  target_banner_image_path => null,
  target_featured_order => null,
  target_sections => jsonb_build_array(
    jsonb_build_object('type', 'exchange', 'offer_id', :'closed_offer_id')
  ),
  target_previous_id => null
);

-- 잔액 시드. 원장과 캐시를 함께 옮겨 두 값이 어긋난 상태에서 시작하지 않는다.
reset role;

insert into public.coin_ledger (user_id, amount, reason, attended_on)
values ('00000000-0000-4000-8000-000000000832', 10, 'attendance', current_date);

insert into public.coin_balances (user_id, balance)
values ('00000000-0000-4000-8000-000000000832', 10)
on conflict (user_id) do update set balance = excluded.balance;

-- ── 노출 경로가 없는 상품은 교환되지 않는다 ────────────────────────────────
--
-- 상품 status는 넷 다 'active'다. 거절 사유는 오직 "지금 이 상품을 내보이는
-- 진행 중 공개 캠페인이 없다"여야 한다.

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000832', true);
set local role authenticated;

do $$
declare
  v_case record;
begin
  for v_case in
    select *
    from (
      values
        ('orphan', current_setting('test.orphan_offer_id'), '00000000-0000-4000-8000-0000000008c1'),
        ('expired', current_setting('test.expired_offer_id'), '00000000-0000-4000-8000-0000000008c2'),
        ('draft', current_setting('test.draft_offer_id'), '00000000-0000-4000-8000-0000000008c3'),
        ('closed', current_setting('test.closed_offer_id'), '00000000-0000-4000-8000-0000000008c4')
    ) as probe(label, offer_id, operation_id)
  loop
    begin
      perform public.exchange_coins_for_draw_tickets(
        v_case.operation_id::uuid,
        v_case.offer_id::uuid
      );
      raise exception 'exchange without a live campaign should be rejected: %', v_case.label;
    exception
      when no_data_found then
        if sqlerrm <> 'offer_unavailable' then raise; end if;
    end;
  end loop;
end;
$$;

reset role;

select 1 / case when (
  select balance = 10 from public.coin_balances
  where user_id = '00000000-0000-4000-8000-000000000832'
) then 1 else 0 end as assert_unexposed_offers_leave_balance;

select 1 / case when not exists (
  select 1 from public.draw_tickets
  where source = 'coin_exchange'
    and user_id = '00000000-0000-4000-8000-000000000832'
) then 1 else 0 end as assert_unexposed_offers_issue_no_ticket;

-- ── 노출된 상품은 그대로 교환된다 ──────────────────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000832', true);
set local role authenticated;

select public.exchange_coins_for_draw_tickets(
  '00000000-0000-4000-8000-0000000008c5'::uuid,
  :'live_offer_id'::uuid
) as live_exchange \gset

select 1 / case when (
  (:'live_exchange'::jsonb ->> 'status') = 'exchanged'
  and (:'live_exchange'::jsonb ->> 'balance')::integer = 9
  and (:'live_exchange'::jsonb ->> 'issued_count')::integer = 1
) then 1 else 0 end as assert_exposed_offer_exchanges;

-- ── 편성이 끝나면 같은 상품이 즉시 닫힌다 ──────────────────────────────────
--
-- 이 스모크의 목적이 여기 있다. 예전 게이트는 offer.status 하나였고, 운영자가
-- 캠페인 종료 후 상품을 내리는 것을 잊으면 직접 호출·캐시된 폼으로 교환이 계속됐다.

reset role;

update public.campaigns
set ends_at = now() - interval '1 minute',
    starts_at = now() - interval '10 days'
where id = 's8h-live';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000832', true);
set local role authenticated;
do $$
begin
  begin
    perform public.exchange_coins_for_draw_tickets(
      '00000000-0000-4000-8000-0000000008c6'::uuid,
      current_setting('test.live_offer_id')::uuid
    );
    raise exception 'exchange after the campaign ended should be rejected';
  exception
    when no_data_found then
      if sqlerrm <> 'offer_unavailable' then raise; end if;
  end;
end;
$$;

reset role;

-- 이미 성립한 교환의 멱등 재생은 편성이 끝난 뒤에도 같은 답을 준다. 커밋된
-- 사실을 나중의 편성 변경으로 뒤집으면 응답만 유실된 사용자가 받은 카드팩을
-- 설명할 수 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000832', true);
set local role authenticated;

select public.exchange_coins_for_draw_tickets(
  '00000000-0000-4000-8000-0000000008c5'::uuid,
  :'live_offer_id'::uuid
) as ended_replay \gset

select 1 / case when (
  (:'ended_replay'::jsonb ->> 'status') = 'already_exchanged'
  and (:'ended_replay'::jsonb ->> 'issued_count')::integer = 1
) then 1 else 0 end as assert_replay_survives_campaign_end;

reset role;

select 1 / case when (
  select balance = 9 from public.coin_balances
  where user_id = '00000000-0000-4000-8000-000000000832'
) then 1 else 0 end as assert_campaign_end_leaves_balance;

-- ── 계정 삭제 fence: RPC 밖 경로도 막힌다 ──────────────────────────────────
--
-- RPC와 RLS 정책의 fence 검사는 그 경로에만 붙어 있다. 테이블 트리거는 나중에
-- 생기는 보정 RPC·배치가 fence를 잊어도 남는 방어다. superuser 직접 쓰기는
-- RLS를 우회하지만 트리거는 우회하지 못한다.

do $$
begin
  begin
    insert into public.coin_attendance (user_id, attended_on)
    values ('00000000-0000-4000-8000-000000000833', current_date);
    raise exception 'fenced attendance insert should be rejected';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'account_deletion_write_fenced' then raise; end if;
  end;

  begin
    insert into public.coin_ledger (user_id, amount, reason, attended_on)
    values ('00000000-0000-4000-8000-000000000833', 1, 'attendance', current_date);
    raise exception 'fenced ledger insert should be rejected';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'account_deletion_write_fenced' then raise; end if;
  end;

  begin
    insert into public.product_questions (good_id, user_id, body)
    values ('s8h-g1', '00000000-0000-4000-8000-000000000833', '봉인 계정 질문');
    raise exception 'fenced product question insert should be rejected';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'account_deletion_write_fenced' then raise; end if;
  end;
end;
$$;

select 1 / case when not exists (
  select 1 from public.coin_attendance
  where user_id = '00000000-0000-4000-8000-000000000833'
) and not exists (
  select 1 from public.coin_ledger
  where user_id = '00000000-0000-4000-8000-000000000833'
) and not exists (
  select 1 from public.product_questions
  where user_id = '00000000-0000-4000-8000-000000000833'
) then 1 else 0 end as assert_fenced_writes_left_no_row;

-- 봉인되지 않은 계정은 같은 경로로 그대로 쓴다(트리거가 전면 차단이 아니다).
insert into public.product_questions (good_id, user_id, body)
values ('s8h-g1', '00000000-0000-4000-8000-000000000832', '언제 재입고되나요?');

select 1 / case when (
  select count(*) = 1 from public.product_questions
  where user_id = '00000000-0000-4000-8000-000000000832'
) then 1 else 0 end as assert_unfenced_question_still_writes;

-- ── 역방향 슬러그 섀도잉 차단 ──────────────────────────────────────────────
--
-- admin_upsert_campaign은 events가 선점한 슬러그를 캠페인이 가져가는 것을 막는다.
-- 반대 방향이 열려 있으면, 그렇게 만들어진 팝업은 `/events/<id>`가 캠페인을 먼저
-- 조회하는 탓에 레거시 딥링크를 영영 잃는다.

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000831', true);
set local role authenticated;

do $$
begin
  begin
    perform public.admin_upsert_event(
      's8h-live', 's8h-ip', '캠페인 슬러그 탈취', '오프라인', '예정',
      null, null, null, null, null, null
    );
    raise exception 'campaign slug shadowing by an event should be rejected';
  exception
    when unique_violation then
      if sqlerrm <> 'catalog_id_taken' then raise; end if;
  end;
end;
$$;

reset role;

select 1 / case when not exists (
  select 1 from public.events where id = 's8h-live'
) then 1 else 0 end as assert_shadowing_event_left_no_row;

-- 캠페인과 겹치지 않는 슬러그는 그대로 통과한다(계약 무변경).
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000831', true);
set local role authenticated;

select public.admin_upsert_event(
  's8h-popup', 's8h-ip', '정상 오프라인 팝업', '오프라인', '예정',
  null, null, null, null, null, null
);

select 1 / case when exists (
  select 1 from public.events where id = 's8h-popup' and mode = '오프라인'
) then 1 else 0 end as assert_non_colliding_event_created;

-- 수정 분기는 캠페인을 보지 않는다 — 기존 행의 편집을 막아도 충돌은 그대로다.
select public.admin_upsert_event(
  's8h-popup', 's8h-ip', '정상 오프라인 팝업 (수정)', '오프라인', '예정',
  null, null, null, null, null, null, 's8h-popup'
);

select 1 / case when (
  select title = '정상 오프라인 팝업 (수정)' from public.events where id = 's8h-popup'
) then 1 else 0 end as assert_event_update_unaffected;

-- ── 오프라인 팝업 알림은 mode='오프라인'에만 나간다 ────────────────────────

reset role;

insert into public.ip_follows (user_id, ip_id, notify_events)
values ('00000000-0000-4000-8000-000000000832', 's8h-ip', true)
on conflict (user_id, ip_id) do update set notify_events = true;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000831', true);
set local role authenticated;

select public.admin_upsert_event(
  's8h-online-popup', 's8h-ip', '온라인 편성', '온라인', '예정',
  null, null, null, null, null, null
);

select public.admin_upsert_event(
  's8h-offline-popup', 's8h-ip', '오프라인 편성', '오프라인', '예정',
  null, null, null, null, null, null
);

reset role;

select 1 / case when not exists (
  select 1 from public.notifications
  where type = 'event_published'
    and source_id = 's8h-online-popup'
) then 1 else 0 end as assert_online_event_does_not_notify;

select 1 / case when (
  select count(*) = 1
    and bool_and(user_id = '00000000-0000-4000-8000-000000000832')
    and bool_and(title = '새 오프라인 팝업이 공개됐어요')
    and bool_and(body = '오프라인 편성 오프라인 팝업이 공개됐습니다.')
    and bool_and(link_path = '/offline-popups')
  from public.notifications
  where type = 'event_published'
    and source_id = 's8h-offline-popup'
) then 1 else 0 end as assert_offline_event_notifies;

-- ── 알림 백필: 옛 문구가 남지 않았다 ───────────────────────────────────────
--
-- 백필은 마이그레이션이 한 번 돌린 update다. 여기서는 결과만 확인한다 —
-- 이사 전 문구('새 이벤트가 공개됐어요')를 들고 있는 행이 없어야 한다.

select 1 / case when not exists (
  select 1 from public.notifications
  where type = 'event_published'
    and (title = '새 이벤트가 공개됐어요' or link_path = '/events')
) then 1 else 0 end as assert_legacy_event_notification_copy_backfilled;

reset role;
update private.card_reward_control set enabled = false where singleton;

rollback;
