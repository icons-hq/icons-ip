import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 컬렉션 배너 로더(CL-09). 쿠키 없는 캐시 읽기 위에서 요청마다 종료·목적지 게이트·페이지 몫을 건다 —
 * 돌려준 목록이 곧 그 페이지에 그릴 배너여야 Shop 의 머리말·여백 판정(hasBanner)이 실제 배너와 같다(l8b-ui-2·l8b-data-3).
 */

const mocks = vi.hoisted(() => ({ rows: [] as unknown[], error: null as unknown, rewards: vi.fn(), calls: [] as Array<[string, unknown[]]> }));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>) => fn,
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'lte', 'or', 'order', 'limit']) {
      builder[method] = (...args: unknown[]) => { mocks.calls.push([method, args]); return builder; };
    }
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: mocks.rows, error: mocks.error }).then(resolve);
    return {
      from: () => builder,
      storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }) }) },
    };
  },
}));
vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ url: 'https://local.example.test', key: 'anon-test', isConfigured: true }) }));
vi.mock('./card-rewards/gate.server', () => ({ readCardRewardsEnabled: mocks.rewards }));

import { getCollectionBanners } from './collection-banners.server';

const IMAGE = (n: number) => `public-media/catalog/curation/97410000-0000-4000-8000-${String(n).padStart(12, '0')}.webp`;

function row(n: number, slot: string, link: string | null = null, activeTo: string | null = null) {
  return { id: `97420000-0000-4000-8000-${String(n).padStart(12, '0')}`, title: `배너 ${n}`, image_path: IMAGE(n), link_path: link, slot, active_to: activeTo, payload: null };
}

const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  mocks.rows = [];
  mocks.error = null;
  mocks.calls = [];
  mocks.rewards.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  errors.mockClear();
});

describe('getCollectionBanners', () => {
  it('BEST·NEW는 운영 순서 첫 장 하나만 돌려준다 — 칸 배너가 슬라이더가 되지 않는다(l8b-data-1·l8b-ui-1)', async () => {
    mocks.rows = [row(1, 'best'), row(2, 'best'), row(3, 'new'), row(4, 'new'), row(5, 'all'), row(6, 'all')];

    expect((await getCollectionBanners('best')).map((banner) => banner.title)).toEqual(['배너 1']);
    expect((await getCollectionBanners('new')).map((banner) => banner.title)).toEqual(['배너 3']);
    expect((await getCollectionBanners('all')).map((banner) => banner.title)).toEqual(['배너 5', '배너 6']);
  });

  it('카드 리워드가 꺼지면 카드팩으로 가는 BEST 배너를 서버에서 걷는다 — 걷힌 목록이 비면 Shop 은 텍스트 제목을 그린다(l8b-ui-2)', async () => {
    mocks.rows = [row(1, 'best', '/packs')];

    expect(await getCollectionBanners('best')).toEqual([]);
    expect(mocks.rewards).toHaveBeenCalledTimes(1);
  });

  it('게이트로 빠진 자리는 다음 순서 배너가 채운다(l8b-data-4)', async () => {
    mocks.rows = [row(1, 'best', '/games/quiz'), row(2, 'best', '/shop/best')];

    expect((await getCollectionBanners('best')).map((banner) => banner.title)).toEqual(['배너 2']);
    mocks.rows = [row(10, 'all', '/packs'), ...Array.from({ length: 10 }, (_, index) => row(11 + index, 'all'))];
    const slides = await getCollectionBanners('all');
    expect(slides).toHaveLength(10);
    expect(slides.map((banner) => banner.title)).not.toContain('배너 10');
    expect(slides.at(-1)?.title).toBe('배너 20');
  });

  it('카드 리워드가 켜진 배포에서는 카드팩 배너가 첫 HTML 부터 그대로 있다', async () => {
    mocks.rewards.mockResolvedValue(true);
    mocks.rows = [row(1, 'best', '/packs')];

    expect((await getCollectionBanners('best')).map((banner) => banner.href)).toEqual(['/packs']);
  });

  it('카드팩·게임으로 가는 배너가 없으면 게이트를 읽지 않는다(요청마다 DB 왕복을 더하지 않는다)', async () => {
    mocks.rows = [row(1, 'best', '/shop/best'), row(2, 'all', '/packs')];

    expect(await getCollectionBanners('best')).toHaveLength(1);
    expect(mocks.rewards).not.toHaveBeenCalled();
  });

  it('커뮤니티가 닫힌 배포에서는 커뮤니티로 가는 배너를 걷는다', async () => {
    mocks.rows = [row(1, 'new', '/community/feed'), row(2, 'new')];

    expect((await getCollectionBanners('new')).map((banner) => banner.title)).toEqual(['배너 2']);
  });

  it('요청 시각에 끝난 배너는 캐시에 남아 있어도 그리지 않는다', async () => {
    const now = Date.parse('2026-10-27T03:00:00Z');
    mocks.rows = [row(1, 'new', null, '2026-10-27T02:00:00Z'), row(2, 'new', null, '2026-10-28T00:00:00Z')];

    expect((await getCollectionBanners('new', now)).map((banner) => banner.title)).toEqual(['배너 2']);
  });

  it('읽기가 실패하면 던지지 않고 배너 없이 그린다', async () => {
    mocks.error = { code: 'PGRST202', message: 'schema cache' };

    expect(await getCollectionBanners('all')).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
