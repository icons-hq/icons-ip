-- ============================================================================
-- ICONS · 유료 가챠 물리 비활성 (#65) — wallets · pulls · pull_gacha 정리
-- 근거: docs/adr/0003-free-reward-pivot.md (ADR-0001 superseded)
-- 선행 확인: remote wallets 0행·잔액 0 · pending wallet payments 0 (2026-07-07).
-- 무료 코어(ADR-0004)가 재사용하는 card_pools · pool_odds(assert_pool_odds_total)
-- · roll_rarity · user_cards · cards.pool_id 는 보존한다.
-- payments의 purpose='wallet' enum 값·기존 행은 결제 raw 추적성을 위해 남긴다.
-- ============================================================================

-- 유료 RPC — ACL은 20260706090001에서 이미 봉인됨(전 롤 revoke). 물리 제거.
drop function public.pull_gacha(uuid, integer);
drop function public.charge_wallet_init(bigint, text);
drop function public.confirm_wallet_charge(text, text, bigint, jsonb);

-- 유료 이력·상태 테이블 (FK 순서: 자식 먼저)
drop table public.pull_results;
drop table public.pulls;
drop table public.gacha_pity;
drop table public.wallet_ledger;
drop table public.wallets;

drop type public.wallet_reason;

-- 유료 모델 유물 컬럼 — pull_gacha 제거 후 참조 0건. cost_per_pull은 not null이라
-- 남기면 신규 풀 생성마다 무의미한 값을 강제한다(무상 리워드 풀과 모순).
alter table public.card_pools
  drop column cost_per_pull,
  drop column pity_threshold;
