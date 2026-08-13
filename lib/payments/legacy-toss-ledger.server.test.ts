import { describe, expect, it, vi } from 'vitest';
import { createLegacyTossPaymentRepository } from './legacy-toss-ledger.server';

function repositoryFixture(provider: 'toss' | 'korpay' | null = 'toss') {
  const filters: Array<[string, unknown]> = [];
  const upsert = vi.fn(async () => ({ error: null }));
  const query = {
    select: vi.fn(() => query),
    update: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    }),
    maybeSingle: vi.fn(async () => ({
      data: provider === null ? null : { provider },
      error: null,
    })),
    upsert,
  };
  const service = {
    from: vi.fn((table: string) => {
      if (table !== 'payments') throw new Error(`unexpected table ${table}`);
      return query;
    }),
  };
  return {
    filters,
    query,
    repository: createLegacyTossPaymentRepository(service as never),
    upsert,
  };
}

describe('LegacyTossPaymentRepository', () => {
  it.each([
    ['toss', 'known_toss'],
    ['korpay', 'known_other_provider'],
    [null, 'unknown_compatibility'],
  ] as const)('payment key의 local provider=%s 상태를 분류한다', async (provider, expected) => {
    const { repository } = repositoryFixture(provider);

    await expect(repository.classifyPaymentKey('provider-payment-key')).resolves.toEqual({
      status: expected,
    });
  });

  it('legacy Toss select와 update를 provider=toss 경계 안에서만 시작한다', () => {
    const { filters, repository } = repositoryFixture();

    repository.select('id,status').eq('idempotency_key', 'provider-payment-key');
    repository.update({ status: 'failed' }).eq('idempotency_key', 'provider-payment-key');

    expect(filters).toEqual([
      ['provider', 'toss'],
      ['idempotency_key', 'provider-payment-key'],
      ['provider', 'toss'],
      ['idempotency_key', 'provider-payment-key'],
    ]);
  });

  it('legacy Toss upsert는 caller 값과 무관하게 provider=toss를 명시한다', async () => {
    const { repository, upsert } = repositoryFixture();

    await repository.upsert(
      { provider: 'korpay', idempotency_key: 'provider-payment-key' },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );

    expect(upsert).toHaveBeenCalledWith(
      { provider: 'toss', idempotency_key: 'provider-payment-key' },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });
});
