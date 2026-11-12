import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 사이트맵 읽기는 쿠키 없는 공개 키 조회이고, 공개 상세와 같은 노출 규칙(보관·초안·19금 제외, 공개 IP 소속)을 쓴다.
   PostgREST max_rows(1000)가 오류 없이 자르므로 끝까지 페이지로 읽는다. */
const db = vi.hoisted(() => ({
  configured: true,
  calls: [] as Array<{ table: string; select?: string; filters: string[]; range?: [number, number] }>,
  pages: {} as Record<string, Array<Array<Record<string, unknown>>>>,
  error: null as null | { message: string },
  cookieMethods: null as null | { getAll: () => unknown },
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => (db.configured
    ? { url: 'http://127.0.0.1:54321', key: 'publishable-test', isConfigured: true }
    : { url: undefined, key: undefined, isConfigured: false }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { getAll: () => unknown } }) => {
    db.cookieMethods = options.cookies;
    return {
      from(table: string) {
        const call: (typeof db.calls)[number] = { table, filters: [] };
        db.calls.push(call);
        const builder = {
          select(columns: string) { call.select = columns; return builder; },
          is(column: string, value: unknown) { call.filters.push(`${column} is ${String(value)}`); return builder; },
          not(column: string, op: string, value: unknown) { call.filters.push(`${column} not ${op} ${String(value)}`); return builder; },
          eq(column: string, value: unknown) { call.filters.push(`${column} = ${String(value)}`); return builder; },
          order(column: string) { call.filters.push(`order ${column}`); return builder; },
          range(from: number, to: number) {
            call.range = [from, to];
            const page = db.pages[table]?.[from / 1000] ?? [];
            return Promise.resolve(db.error ? { data: null, error: db.error } : { data: page, error: null });
          },
        };
        return builder;
      },
    };
  },
}));

beforeEach(() => {
  db.configured = true;
  db.calls.length = 0;
  db.pages = {};
  db.error = null;
  db.cookieMethods = null;
});

describe('loadSitemapCatalog', () => {
  it('공개 IP·굿즈만 공개 상세와 같은 조건으로 읽는다(19금·초안·보관·비공개 IP 소속 제외)', async () => {
    db.pages = {
      ips: [[{ id: 'ip-maple', public_slug: 'maplestory', updated_at: '2026-11-01T00:00:00Z' }]],
      goods: [[{ id: 'g4', updated_at: '2026-11-10T00:00:00Z', ips: { id: 'ip-maple' } }]],
    };
    const { loadSitemapCatalog } = await import('./sitemap-catalog.server');

    await expect(loadSitemapCatalog()).resolves.toEqual({
      ips: [{ id: 'ip-maple', publicSlug: 'maplestory', updatedAt: '2026-11-01T00:00:00Z' }],
      goods: [{ id: 'g4', updatedAt: '2026-11-10T00:00:00Z' }],
    });
    /* 방문자 쿠키 없이 읽는다. */
    expect(db.cookieMethods?.getAll()).toEqual([]);
    const goods = db.calls.find((call) => call.table === 'goods')!;
    expect(goods.select).toBe('id,updated_at,ips!inner(id)');
    expect(goods.filters).toEqual(expect.arrayContaining([
      'archived_at is null',
      'published_at not is null',
      'sale_restriction = none',
      'ips.archived_at is null',
      'ips.published_at not is null',
    ]));
    const ips = db.calls.find((call) => call.table === 'ips')!;
    expect(ips.filters).toEqual(expect.arrayContaining(['archived_at is null', 'published_at not is null']));
  });

  it('1000행이 넘으면 다음 페이지까지 읽는다', async () => {
    const page = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({ id: `g${start + index}`, updated_at: null }));
    db.pages = { ips: [[]], goods: [page(0, 1000), page(1000, 3)] };
    const { loadSitemapCatalog } = await import('./sitemap-catalog.server');

    const catalog = await loadSitemapCatalog();
    expect(catalog.goods).toHaveLength(1003);
    expect(db.calls.filter((call) => call.table === 'goods').map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('읽기 오류는 숨기지 않는다(빈 사이트맵으로 바꾸지 않는다)', async () => {
    db.error = { message: 'boom' };
    const { loadSitemapCatalog } = await import('./sitemap-catalog.server');

    await expect(loadSitemapCatalog()).rejects.toThrow('sitemap_catalog_failed:boom');
  });

  it('Supabase 가 없으면(목 데이터 실행) 고정 화면만 싣도록 빈 목록이다', async () => {
    db.configured = false;
    const { loadSitemapCatalog } = await import('./sitemap-catalog.server');

    await expect(loadSitemapCatalog()).resolves.toEqual({ goods: [], ips: [] });
    expect(db.calls).toEqual([]);
  });
});
