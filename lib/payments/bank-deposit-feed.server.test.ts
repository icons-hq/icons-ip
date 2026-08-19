import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankDepositAdapter } from './bank-deposit-feed';
import { ingestBankDeposits, resolveBankDepositAdapter } from './bank-deposit-feed.server';
import { FakeBankDepositAdapter } from './fake-bank-deposit-adapter';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../supabase/service', () => ({
  getServiceRoleConfig: () => ({
    isConfigured: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  }),
  createServiceClient: () => ({ rpc: mocks.rpc }),
}));

const now = new Date('2026-08-18T12:00:00.000Z');

function record(externalId: string, overrides: Record<string, unknown> = {}) {
  return {
    externalId,
    depositedAt: '2026-08-18T01:00:00.000Z',
    depositorName: '홍길동',
    amount: 23000,
    ...overrides,
  };
}

describe('ingestBankDeposits', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  });

  /* 계약(#255) 전 상태다. 수집이 비어 있어도 무통장 결제는 수동 대조로 굴러간다. */
  it('어댑터가 없으면 아무것도 하지 않는다', async () => {
    await expect(ingestBankDeposits(null, now)).resolves.toBeNull();
    expect(resolveBankDepositAdapter()).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('service role이 없으면 어댑터가 있어도 적재하지 않는다', async () => {
    vi.unstubAllEnvs();
    const adapter = new FakeBankDepositAdapter([record('dep-001')]);
    await expect(ingestBankDeposits(adapter, now)).resolves.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('정규화한 기록만 service role RPC로 넘긴다', async () => {
    const adapter = new FakeBankDepositAdapter([
      record('dep-001'),
      record('dep-broken', { amount: 0 }),
    ]);

    await expect(ingestBankDeposits(adapter, now)).resolves.toEqual({
      fetched: 1,
      inserted: 1,
      source: 'fake',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('record_bank_deposits', {
      p_source: 'fake',
      p_deposits: [record('dep-001')],
    });
  });

  /* 폴링 창은 넉넉해야 한다 — 겹쳐 받아도 DB가 (source, external_id)로 거른다. */
  it('72시간 창으로 되짚어 가져온다', async () => {
    const seen: Date[] = [];
    const adapter: BankDepositAdapter = {
      name: 'probe',
      async fetchSince(since) {
        seen.push(since);
        return [];
      },
    };

    await expect(ingestBankDeposits(adapter, now)).resolves.toEqual({
      fetched: 0,
      inserted: 0,
      source: 'probe',
    });
    expect(seen[0]?.toISOString()).toBe('2026-08-15T12:00:00.000Z');
    /* 가져올 것이 없으면 RPC도 부르지 않는다. */
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('적재가 실패하면 조용히 성공으로 넘기지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const adapter = new FakeBankDepositAdapter([record('dep-001')]);
    await expect(ingestBankDeposits(adapter, now)).rejects.toThrow(/Failed to record bank deposits/);
  });
});
