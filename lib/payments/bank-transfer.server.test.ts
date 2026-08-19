import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bankTransferCheckoutEnabled, getBankTransferAccount } from './bank-transfer.server';

function stubAccount() {
  vi.stubEnv('BANK_TRANSFER_BANK_NAME', '국민은행');
  vi.stubEnv('BANK_TRANSFER_ACCOUNT_NUMBER', '123456-01-789012');
  vi.stubEnv('BANK_TRANSFER_ACCOUNT_HOLDER', '주식회사 아이콘스');
}

describe('getBankTransferAccount', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('세 값이 모두 있어야 계좌를 돌려준다', () => {
    stubAccount();
    expect(getBankTransferAccount()).toEqual({
      bank: '국민은행',
      accountNumber: '123456-01-789012',
      holder: '주식회사 아이콘스',
    });
  });

  /*
   * #255가 끝나기 전 상태다. 계좌 없이 "입금해주세요"를 띄우면 돈이 어디로도
   * 가지 않는 주문만 쌓인다.
   */
  it('예금주가 비면 계좌가 없는 것으로 본다', () => {
    stubAccount();
    vi.stubEnv('BANK_TRANSFER_ACCOUNT_HOLDER', '   ');
    expect(getBankTransferAccount()).toBeNull();
  });
});

describe('bankTransferCheckoutEnabled', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('계좌가 없으면 무통장 결제수단이 열리지 않는다', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    expect(bankTransferCheckoutEnabled()).toBe(false);
  });

  /* 무통장에는 결제사가 없다 — 서버 신뢰 경계와 계좌만 있으면 성립한다. */
  it('service role과 계좌가 있으면 PG provider gate와 무관하게 열린다', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    stubAccount();
    expect(bankTransferCheckoutEnabled()).toBe(true);
  });

  it('서버 신뢰 경계가 없으면 계좌가 있어도 닫힌다', () => {
    stubAccount();
    expect(bankTransferCheckoutEnabled()).toBe(false);
  });
});
