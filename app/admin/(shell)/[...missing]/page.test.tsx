import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ calls: [] as string[], gateError: null as Error | null }));

vi.mock('@/lib/admin/guard.server', () => ({
  requireAdminScreenAccess: async (pathname: string) => {
    mocks.calls.push(`gate:${pathname}`);
    if (mocks.gateError) throw mocks.gateError;
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    mocks.calls.push('notFound');
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import AdminUnknownPathPage from './page';

describe('어드민 없는 주소 catch-all (ADM-016 #12)', () => {
  beforeEach(() => {
    mocks.calls = [];
    mocks.gateError = null;
  });

  it('권한 게이트를 먼저 통과시킨 뒤 notFound()로 셸 안 어드민 404를 낸다', async () => {
    await expect(AdminUnknownPathPage({ params: Promise.resolve({ missing: ['sales', 'nope'] }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.calls).toEqual(['gate:/admin/sales/nope', 'notFound']);
  });

  it('게이트가 막으면(미로그인 이동·비스태프 404) notFound()까지 가지 않고 게이트의 결과를 그대로 낸다', async () => {
    mocks.gateError = new Error('NEXT_REDIRECT');
    await expect(AdminUnknownPathPage({ params: Promise.resolve({ missing: ['zzz'] }) })).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.calls).toEqual(['gate:/admin/zzz']);
  });

  it('주소 조각은 로그인 복귀 경로를 위해 인코딩해 게이트에 넘긴다', async () => {
    await expect(AdminUnknownPathPage({ params: Promise.resolve({ missing: ['a b', 'c'] }) })).rejects.toThrow();
    expect(mocks.calls[0]).toBe('gate:/admin/a%20b/c');
  });
});
