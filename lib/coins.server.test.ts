import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kstTodayIsoDate } from './coins';
import { loadCoinLedger, loadCoinOverview } from './coins.server';

/* 로더 테스트 — 체이너블 가짜 빌더(lib/inquiries.server.test.ts 관례). */

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}

const USER_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  configured: true,
  userId: null as string | null,
  tables: {} as Record<string, TableResult>,
  filters: [] as [string, string, unknown][],
  limits: [] as [string, number][],
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.configured }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => (
        mocks.userId
          ? { data: { user: { id: mocks.userId } }, error: null }
          : { data: { user: null }, error: null }
      ),
    },
    from(table: string) {
      const result = () => mocks.tables[table] ?? { data: null, error: null };
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          mocks.filters.push([table, column, value]);
          return query;
        },
        order: () => query,
        limit: (value: number) => {
          mocks.limits.push([table, value]);
          return Promise.resolve(result());
        },
        maybeSingle: () => Promise.resolve(result()),
        then: (resolve: (value: TableResult) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));

beforeEach(() => {
  mocks.configured = true;
  mocks.userId = USER_ID;
  mocks.tables = {};
  mocks.filters = [];
  mocks.limits = [];
});

describe('loadCoinOverview', () => {
  /* 캠페인 상세는 비로그인도 보는 공개 표면이다 — 여기서 던지면 열람이 막힌다. */
  it('supabase 미구성이면 null이다', async () => {
    mocks.configured = false;

    await expect(loadCoinOverview()).resolves.toBeNull();
  });

  /* 잔액 0 과 "로그인 안 함"은 화면에서 다르게 그려야 한다(게스트는 로그인 CTA). */
  it('비로그인은 잔액 0이 아니라 null이다', async () => {
    mocks.userId = null;

    await expect(loadCoinOverview()).resolves.toBeNull();
  });

  it('잔액 행이 없으면 0으로 읽는다', async () => {
    await expect(loadCoinOverview()).resolves.toEqual({ balance: 0, attendedToday: false });
  });

  it('오늘 출석 여부는 KST 날짜로 조회한다', async () => {
    mocks.tables.coin_balances = { data: { balance: 12 }, error: null };
    mocks.tables.coin_attendance = { data: { attended_on: kstTodayIsoDate() }, error: null };

    await expect(loadCoinOverview()).resolves.toEqual({ balance: 12, attendedToday: true });
    expect(mocks.filters).toContainEqual(['coin_attendance', 'user_id', USER_ID]);
    expect(mocks.filters).toContainEqual(['coin_attendance', 'attended_on', kstTodayIsoDate()]);
  });

  it('조회 오류는 잔액 0·미출석으로 접는다', async () => {
    mocks.tables.coin_balances = { data: null, error: { message: 'boom' } };
    mocks.tables.coin_attendance = { data: null, error: { message: 'boom' } };

    await expect(loadCoinOverview()).resolves.toEqual({ balance: 0, attendedToday: false });
  });
});

describe('loadCoinLedger', () => {
  it('mock 모드·비로그인은 빈 목록이다', async () => {
    mocks.configured = false;
    await expect(loadCoinLedger()).resolves.toEqual([]);

    mocks.configured = true;
    mocks.userId = null;
    await expect(loadCoinLedger()).resolves.toEqual([]);
  });

  it('원장 행을 화면 모델로 옮기고 모르는 사유는 뺀다', async () => {
    mocks.tables.coin_ledger = {
      data: [
        {
          id: 12,
          amount: -30,
          reason: 'exchange',
          attended_on: null,
          created_at: '2026-08-30T01:00:00.000Z',
        },
        {
          id: 11,
          amount: 1,
          reason: 'attendance',
          attended_on: '2026-08-30',
          created_at: '2026-08-30T00:10:00.000Z',
        },
        { id: 10, amount: 5, reason: 'mystery', attended_on: null, created_at: '2026-08-29T00:00:00.000Z' },
      ],
      error: null,
    };

    await expect(loadCoinLedger(20)).resolves.toEqual([
      { id: '12', amount: -30, reason: 'exchange', attendedOn: null, createdAt: '2026-08-30T01:00:00.000Z' },
      { id: '11', amount: 1, reason: 'attendance', attendedOn: '2026-08-30', createdAt: '2026-08-30T00:10:00.000Z' },
    ]);
    expect(mocks.limits).toContainEqual(['coin_ledger', 20]);
    expect(mocks.filters).toContainEqual(['coin_ledger', 'user_id', USER_ID]);
  });

  it('기본 조회 개수는 50이다', async () => {
    mocks.tables.coin_ledger = { data: [], error: null };
    await loadCoinLedger();

    expect(mocks.limits).toContainEqual(['coin_ledger', 50]);
  });

  it('조회 오류는 빈 목록으로 접는다', async () => {
    mocks.tables.coin_ledger = { data: null, error: { message: 'boom' } };

    await expect(loadCoinLedger()).resolves.toEqual([]);
  });
});
