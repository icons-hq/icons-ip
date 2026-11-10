import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 운영 추천 검색어 로더(CH-10). 셸 캐시(300초) 안에서 노출이 끝난 목록을 붙들지 않는다 —
 * 캐시는 후보 목록과 끝나는 시각을 담고, 요청마다 지금 노출 중인 목록을 고른다(컬렉션 배너 로더와 같다).
 */

const mocks = vi.hoisted(() => ({ rows: [] as unknown[], error: null as unknown, reads: 0 }));
vi.mock('next/cache', () => ({
  /* 첫 성공 결과를 붙드는 캐시 — 실패는 담지 않는다(unstable_cache 와 같다). */
  unstable_cache: (fn: () => Promise<unknown>) => {
    let cached: { value: unknown } | null = null;
    return async () => {
      if (!cached) cached = { value: await fn() };
      return cached.value;
    };
  },
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'lte', 'or', 'order', 'limit']) builder[method] = () => builder;
    builder.then = (resolve: (value: unknown) => unknown) => {
      mocks.reads += 1;
      return Promise.resolve({ data: mocks.rows, error: mocks.error }).then(resolve);
    };
    return { from: () => builder };
  },
}));
vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ url: 'https://local.example.test', key: 'anon-test', isConfigured: true }) }));

const NOW = Date.parse('2026-10-27T03:00:00.000Z');
const list = (terms: string[], activeTo: string | null) => ({ payload: { terms }, active_to: activeTo });
const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

async function freshLoader() {
  vi.resetModules();
  return (await import('./search-terms.server')).getOperatorSearchTerms;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  mocks.rows = [];
  mocks.error = null;
  mocks.reads = 0;
});

afterEach(() => {
  vi.useRealTimers();
  errors.mockClear();
});

describe('getOperatorSearchTerms', () => {
  it('노출이 끝난 목록은 캐시가 남아 있어도 건너뛰고, 앞서 시작한 목록이 바로 이어받는다', async () => {
    mocks.rows = [list(['가을 한정'], new Date(NOW + 60_000).toISOString()), list(['상시'], null)];
    const getOperatorSearchTerms = await freshLoader();

    expect(await getOperatorSearchTerms()).toEqual(['가을 한정']);
    vi.setSystemTime(NOW + 120_000);
    expect(await getOperatorSearchTerms()).toEqual(['상시']);
    expect(mocks.reads).toBe(1);
  });

  it('남은 목록이 모두 끝나면 null — 셸은 코드 상수로 돌아간다', async () => {
    mocks.rows = [list(['가을 한정'], new Date(NOW + 60_000).toISOString())];
    const getOperatorSearchTerms = await freshLoader();

    expect(await getOperatorSearchTerms()).toEqual(['가을 한정']);
    vi.setSystemTime(NOW + 60_000);
    expect(await getOperatorSearchTerms()).toBeNull();
  });

  it('깨진 목록은 건너뛰고, 읽기 실패는 캐시하지 않고 null 이다', async () => {
    mocks.rows = [{ payload: { terms: 'not-a-list' }, active_to: null }, list(['상시'], null)];
    expect(await (await freshLoader())()).toEqual(['상시']);

    mocks.error = { code: 'PGRST301' };
    const getOperatorSearchTerms = await freshLoader();
    expect(await getOperatorSearchTerms()).toBeNull();
    mocks.error = null;
    expect(await getOperatorSearchTerms()).toEqual(['상시']);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
