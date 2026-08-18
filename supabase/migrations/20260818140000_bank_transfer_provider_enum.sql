-- ==========================================================================
-- ICONS · 무통장 입금 provider 값 (#256)
--
-- Postgres는 같은 트랜잭션에서 새로 추가한 enum 값을 쓸 수 없다. 원장·RPC가
-- 'bank_transfer'를 참조하는 다음 마이그레이션과 반드시 파일을 나눠야 한다.
--
-- 결정 근거는 docs/adr/0007-bank-transfer-payments.md. 코페이 가상계좌가 현
-- 계약에 없어 자체 법인계좌로 받고, 원장은 기존 payment_attempts/payments를
-- provider 하나 더 붙여 그대로 쓴다.
-- ==========================================================================

alter type public.payment_provider add value if not exists 'bank_transfer';
