import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCampaignDetail, loadCampaignHub } from './campaigns.server';

/* 로더 테스트 — 체이너블 가짜 빌더로 필터·변환을 단언한다(lib/inquiries.server.test.ts 관례).
   표시 상태가 현재 시각에 의존하므로 날짜는 과거·미래로 충분히 벌려 고정한다. */

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}

const mocks = vi.hoisted(() => ({
  configured: true,
  tables: {} as Record<string, TableResult>,
  filters: [] as [string, string, unknown][],
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.configured }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const result = () => mocks.tables[table] ?? { data: null, error: null };
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          mocks.filters.push([table, column, value]);
          return query;
        },
        in: (column: string, value: unknown) => {
          mocks.filters.push([table, column, value]);
          return query;
        },
        order: () => query,
        limit: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
        then: (resolve: (value: TableResult) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
      }),
    },
  }),
}));

const PAST = { starts_at: '2020-01-01T00:00:00.000Z', ends_at: '2020-02-01T00:00:00.000Z' };
const FUTURE = { starts_at: '2099-01-01T00:00:00.000Z', ends_at: '2099-02-01T00:00:00.000Z' };
const LIVE = { starts_at: '2020-01-01T00:00:00.000Z', ends_at: '2099-02-01T00:00:00.000Z' };

const OFFER_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_OFFER_ID = '22222222-2222-4222-8222-222222222222';

function hubRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'event',
    title: `${id} 캠페인`,
    subtitle: null,
    status: 'published',
    card_image_path: null,
    banner_image_path: null,
    featured_order: null,
    ...LIVE,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.configured = true;
  mocks.tables = {};
  mocks.filters = [];
});

describe('loadCampaignHub', () => {
  /* 이벤트 허브는 공개 브라우징 표면이다 — mock 모드에서 던지면 비로그인 방문자에게
     사이트가 고장 난 것으로 보인다. */
  it('supabase 미구성이면 빈 허브를 던지지 않고 돌려준다', async () => {
    mocks.configured = false;

    await expect(loadCampaignHub()).resolves.toEqual({ banners: [], campaigns: [] });
  });

  it('조회 오류도 빈 허브로 접는다', async () => {
    mocks.tables.campaigns = { data: null, error: { message: 'boom' } };

    await expect(loadCampaignHub()).resolves.toEqual({ banners: [], campaigns: [] });
  });

  it('배너는 featured_order 오름차순, 목록은 상태 그룹 순으로 낸다', async () => {
    mocks.tables.campaigns = {
      data: [
        hubRow('ended-one', PAST),
        hubRow('featured-two', { ...LIVE, featured_order: 2 }),
        hubRow('upcoming-one', FUTURE),
        hubRow('featured-one', { ...LIVE, featured_order: 1 }),
      ],
      error: null,
    };

    const hub = await loadCampaignHub();

    expect(hub.banners.map((entry) => entry.id)).toEqual(['featured-one', 'featured-two']);
    expect(hub.campaigns.map((entry) => entry.displayState)).toEqual([
      'ongoing',
      'ongoing',
      'upcoming',
      'ended',
    ]);
    expect(hub.campaigns.at(-1)?.id).toBe('ended-one');
  });

  it('Storage 경로를 공개 URL로 바꿔 화면에 넘긴다', async () => {
    mocks.tables.campaigns = {
      data: [hubRow('with-art', { card_image_path: 'public-media/campaigns/card.png' })],
      error: null,
    };

    const hub = await loadCampaignHub();

    expect(hub.campaigns[0]?.cardImagePath).toBe('https://cdn.test/public-media/campaigns/card.png');
    expect(hub.campaigns[0]?.bannerImagePath).toBeNull();
  });

  /* kind 를 모르면 어느 탭에도 넣을 수 없고 유형 뱃지 텍스트도 정할 수 없다. */
  it('모르는 kind 행은 목록에서 뺀다', async () => {
    mocks.tables.campaigns = {
      data: [hubRow('good'), hubRow('weird', { kind: 'lfs' })],
      error: null,
    };

    const hub = await loadCampaignHub();

    expect(hub.campaigns.map((entry) => entry.id)).toEqual(['good']);
  });
});

describe('loadCampaignDetail', () => {
  it('supabase 미구성이면 null이다', async () => {
    mocks.configured = false;

    await expect(loadCampaignDetail('summer')).resolves.toBeNull();
  });

  it('행이 없으면 null이다', async () => {
    mocks.tables.campaigns = { data: null, error: null };

    await expect(loadCampaignDetail('missing')).resolves.toBeNull();
  });

  it('교환·굿즈 참조를 해석해 한 벌로 내린다', async () => {
    mocks.tables.campaigns = {
      data: {
        ...hubRow('summer'),
        hero_image_path: 'campaigns/hero.png',
        sections: [
          { type: 'intro', copy: '여름 캠페인', anchor: '소개' },
          { type: 'exchange', offer_id: OFFER_ID },
          { type: 'exchange', offer_id: MISSING_OFFER_ID },
          { type: 'goods', good_ids: ['g13', 'gone'] },
        ],
      },
      error: null,
    };
    mocks.tables.coin_exchange_offers = {
      data: [{ id: OFFER_ID, label: '카드팩 1개', coin_cost: 30, ticket_count: 1 }],
      error: null,
    };
    mocks.tables.goods = {
      data: [{
        id: 'g13',
        name: '아크릴 블록',
        price: 12000,
        compare_at_price: 15000,
        badge: '신상',
        stock: 'ok',
        stock_qty: 8,
        bg: 'linear-gradient(#111, #222)',
        image_path: 'goods/g13.png',
      }],
      error: null,
    };

    const detail = await loadCampaignDetail('summer');

    expect(detail?.heroImagePath).toBe('https://cdn.test/public-media/campaigns/hero.png');
    expect(mocks.filters).toContainEqual(['campaigns', 'id', 'summer']);
    expect(mocks.filters).toContainEqual(['coin_exchange_offers', 'id', [OFFER_ID, MISSING_OFFER_ID]]);
    expect(mocks.filters).toContainEqual(['goods', 'id', ['g13', 'gone']]);

    const sections = detail?.resolvedSections ?? [];
    expect(sections[1]).toEqual({
      type: 'exchange',
      offer_id: OFFER_ID,
      offer: { id: OFFER_ID, label: '카드팩 1개', coinCost: 30, ticketCount: 1 },
    });
    /* 못 찾은 offer 는 블록을 지우지 않는다 — 자리는 남기고 화면이 안내를 바꾼다. */
    expect(sections[2]).toEqual({ type: 'exchange', offer_id: MISSING_OFFER_ID, offer: null });
    expect(sections[3]).toMatchObject({
      type: 'goods',
      good_ids: ['g13', 'gone'],
      goods: [{
        id: 'g13',
        name: '아크릴 블록',
        price: 12000,
        compareAtPrice: 15000,
        badge: '신상',
        soldOut: false,
      }],
    });
  });

  it('참조가 없으면 교환·굿즈 조회를 아예 하지 않는다', async () => {
    mocks.tables.campaigns = {
      data: {
        ...hubRow('quiet'),
        hero_image_path: null,
        sections: [{ type: 'attendance' }],
      },
      error: null,
    };

    const detail = await loadCampaignDetail('quiet');

    expect(detail?.resolvedSections).toEqual([{ type: 'attendance' }]);
    expect(mocks.filters.some(([table]) => table === 'coin_exchange_offers')).toBe(false);
    expect(mocks.filters.some(([table]) => table === 'goods')).toBe(false);
  });

  it('재고가 0인 굿즈는 품절로 표시한다', async () => {
    mocks.tables.campaigns = {
      data: {
        ...hubRow('soldout'),
        hero_image_path: null,
        sections: [{ type: 'goods', good_ids: ['g99'] }],
      },
      error: null,
    };
    mocks.tables.goods = {
      data: [{
        id: 'g99',
        name: '품절 굿즈',
        price: 9000,
        compare_at_price: null,
        badge: null,
        stock: 'ok',
        stock_qty: 0,
        bg: null,
        image_path: null,
      }],
      error: null,
    };

    const detail = await loadCampaignDetail('soldout');
    const section = detail?.resolvedSections[0];

    expect(section?.type).toBe('goods');
    expect(section && 'goods' in section ? section.goods[0]?.soldOut : null).toBe(true);
  });
});
