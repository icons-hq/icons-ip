-- ============================================================================
-- ICONS · public 스키마 함수 ACL 전수 교정 (default privileges 누수 봉인)
--
-- 배경: Supabase는 alter default privileges로 public 스키마 신규 함수에
--   anon/authenticated/service_role의 execute를 자동 부여한다. 기존 migration들의
--   `revoke all on function ... from public`은 PUBLIC grant만 제거할 뿐 이 롤별
--   grant를 남겨, 웹훅 전용 함수가 클라이언트에서 직접 호출 가능했다.
--   실증: confirm_order_payment(20260706090001에서 교정), confirm_wallet_charge·
--   confirm_ticket_payment(본 migration) — 실결제 없이 확정 RPC 호출 가능.
--
-- 원칙: 함수마다 롤별 명시 revoke 후 의도된 최소 롤에만 grant.
--   의도는 각 원 migration의 grant 문을 진실원으로 삼았다. 이 파일이 전 함수
--   ACL 매트릭스의 단일 진실원이며, 이후 함수 추가 시 같은 규율을 따른다(AGENTS.md).
--   (alter default privileges 자체 변경은 Supabase 플랫폼 전제와 충돌 위험이 있어 배제.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 웹훅 전용 — service_role만. 클라이언트가 결제를 확정할 수 없어야 한다.
-- ---------------------------------------------------------------------------
revoke all on function public.confirm_order_payment(text, uuid, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_order_payment(text, uuid, text, bigint, jsonb) to service_role;

revoke all on function public.confirm_ticket_payment(text, uuid, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_ticket_payment(text, uuid, text, bigint, jsonb) to service_role;

revoke all on function public.confirm_wallet_charge(text, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_wallet_charge(text, text, bigint, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 2) 사용자 시작 RPC — authenticated만. (admin_*·check_in_ticket은 내부 is_staff 검사)
-- ---------------------------------------------------------------------------
revoke all on function public.place_order(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.place_order(jsonb) to authenticated;

revoke all on function public.charge_wallet_init(bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.charge_wallet_init(bigint, text) to authenticated;

revoke all on function public.pull_gacha(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.pull_gacha(uuid, integer) to authenticated;

revoke all on function public.reserve_tickets(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.reserve_tickets(uuid, integer) to authenticated;

revoke all on function public.check_in_ticket(text) from public, anon, authenticated, service_role;
grant execute on function public.check_in_ticket(text) to authenticated;

revoke all on function public.follow_ip(text) from public, anon, authenticated, service_role;
grant execute on function public.follow_ip(text) to authenticated;

revoke all on function public.unfollow_ip(text) from public, anon, authenticated, service_role;
grant execute on function public.unfollow_ip(text) to authenticated;

revoke all on function public.open_draw_ticket(uuid) from public, anon, authenticated, service_role;
grant execute on function public.open_draw_ticket(uuid) to authenticated;

revoke all on function public.admin_upsert_ip(text, text, text, text, text, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_ip(text, text, text, text, text, text, text, text, text, boolean) to authenticated;

revoke all on function public.admin_upsert_good(text, text, text, text, integer, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_good(text, text, text, text, integer, text, text, text, text) to authenticated;

revoke all on function public.admin_upsert_card(text, text, text, text, rarity, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_card(text, text, text, text, rarity, text, text) to authenticated;

revoke all on function public.admin_upsert_event(text, text, text, text, text, timestamptz, timestamptz, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_event(text, text, text, text, text, timestamptz, timestamptz, text, text, text, text) to authenticated;

revoke all on function public.create_post_comment(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.create_post_comment(uuid, text) to authenticated;

revoke all on function public.set_post_like(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_post_like(uuid, boolean) to authenticated;

revoke all on function public.delete_own_post(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_own_post(uuid) to authenticated;

revoke all on function public.delete_own_comment(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_own_comment(uuid) to authenticated;

revoke all on function public.submit_community_report(report_target, text, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_community_report(report_target, text, text) to authenticated;

revoke all on function public.block_community_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.block_community_user(uuid) to authenticated;

revoke all on function public.admin_update_report_status(uuid, report_status) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_report_status(uuid, report_status) to authenticated;

revoke all on function public.admin_hide_community_post(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_hide_community_post(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) 사용자 시작 + 서버 경로 겸용 — authenticated + service_role
-- ---------------------------------------------------------------------------
revoke all on function public.cancel_order(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_order(uuid, text) to authenticated, service_role;

revoke all on function public.refund_ticket_order(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.refund_ticket_order(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) 공개 읽기 RPC — anon + authenticated (공개 브라우징 원칙)
-- ---------------------------------------------------------------------------
revoke all on function public.search_public_content(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_public_content(text, integer) to anon, authenticated;

revoke all on function public.community_post_reaction_counts(uuid[], uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.community_post_reaction_counts(uuid[], uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) RLS 헬퍼 — 정책이 호출자 롤로 평가하므로 anon/authenticated execute가 필수.
-- ---------------------------------------------------------------------------
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) 내부 전용 — 어떤 클라이언트 롤도 실행 불가(SECURITY DEFINER 함수 안에서만).
-- ---------------------------------------------------------------------------
revoke all on function public.roll_rarity(uuid) from public, anon, authenticated, service_role;
revoke all on function public.grant_cards(uuid, uuid, text, uuid, text, integer)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) 트리거 함수 — 직접 호출 자체가 불가하지만(returns trigger) 위생상 봉인.
-- ---------------------------------------------------------------------------
revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke all on function public.sync_public_profile() from public, anon, authenticated, service_role;
revoke all on function public.assert_pool_odds_total() from public, anon, authenticated, service_role;
