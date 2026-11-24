import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignHubSnapshot } from '@/lib/campaigns.server';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { CampaignSummary } from '@/lib/campaigns';
import type { FandomEvent } from '@/lib/data';
import { loadPopupItems } from './popups.server';

/* 로더 테스트 — 원천 두 곳(카탈로그 events · 캠페인 허브)을 대역으로 두고 합치기·보완 쿼리·실패 접기를 단언한다. */

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}

const mocks = vi.hoisted(() => ({
  configured: true,
  hub: { banners: [], campaigns: [] } as CampaignHubSnapshot,
  catalog: null as CatalogSnapshot | null,
  catalogError: false,
  eventsTable: { data: [], error: null } as TableResult,
  eventsQueryCalls: [] as string[][],
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/campaigns.server', () => ({
  loadCampaignHub: async () => mocks.hub,
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: async () => {
    if (mocks.catalogError) throw new Error('catalog down');
    return mocks.catalog;
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const query = {
        select: (columns: string) => {
          mocks.eventsQueryCalls.push([table, columns]);
          return query;
        },
        is: (column: string, value: unknown) => {
          mocks.eventsQueryCalls.push([table, column, String(value)]);
          return Promise.resolve(mocks.eventsTable);
        },
      };
      return query;
    },
  }),
}));

function event(overrides: Partial<FandomEvent> & Pick<FandomEvent, 'id'>): FandomEvent {
  return {
    title: `${overrides.id} 팝업`,
    ip: null,
    mode: '오프라인',
    status: '진행중',
    date: '11.01 - 11.30',
    loc: '성수',
    accent: '#8B5CFF',
    img: 'linear-gradient(#111, #222)',
    ...overrides,
  };
}

function snapshot(events: FandomEvent[], source: CatalogSnapshot['source'] = 'supabase'): CatalogSnapshot {
  return { source, verticals: [], ips: [], goods: [], events };
}

function campaign(overrides: Partial<CampaignSummary> & Pick<CampaignSummary, 'id'>): CampaignSummary {
  return {
    kind: 'event',
    title: `${overrides.id} 캠페인`,
    subtitle: null,
    cardImagePath: null,
    bannerImagePath: null,
    featuredOrder: null,
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: '2099-01-01T00:00:00.000Z',
    status: 'published',
    displayState: 'ongoing',
    presentation: { popupMode: 'online', popupLocation: null, cardLinkPath: null },
    ...overrides,
  };
}

const NOW = Date.parse('2026-11-17T03:00:00.000Z');

beforeEach(() => {
  mocks.configured = true;
  mocks.hub = { banners: [], campaigns: [] };
  mocks.catalog = snapshot([]);
  mocks.catalogError = false;
  mocks.eventsTable = { data: [], error: null };
  mocks.eventsQueryCalls = [];
});

describe('loadPopupItems', () => {
  it('두 원천이 모두 비면 빈 목록이다', async () => {
    await expect(loadPopupItems(NOW)).resolves.toEqual([]);
  });

  it('오프라인 팝업과 POP-UP 캠페인을 한 목록으로 합친다 — 진행 중이 먼저, 시작 최신순', async () => {
    mocks.catalog = snapshot([event({ id: 'e1' }), event({ id: 'e2', mode: '온라인' }), event({ id: 'e3', status: '종료' })]);
    mocks.eventsTable = { data: [{ id: 'e1', starts_at: '2026-11-05T00:00:00.000Z', ends_at: '2026-12-01T00:00:00.000Z' }], error: null };
    mocks.hub = {
      banners: [],
      campaigns: [
        campaign({ id: 'c-new', startsAt: '2026-11-10T00:00:00.000Z' }),
        campaign({ id: 'c-event', presentation: null }),
      ],
    };

    const items = await loadPopupItems(NOW);

    expect(items.map((item) => item.key)).toEqual(['campaign:c-new', 'event:e1']);
  });

  it('events 의 시작·끝 시각을 보완 쿼리로 읽어 끝난 팝업을 뺀다', async () => {
    mocks.catalog = snapshot([event({ id: 'past' }), event({ id: 'live' })]);
    mocks.eventsTable = {
      data: [
        { id: 'past', starts_at: '2026-10-01T00:00:00.000Z', ends_at: '2026-11-10T00:00:00.000Z' },
        { id: 'live', starts_at: '2026-11-01T00:00:00.000Z', ends_at: null },
      ],
      error: null,
    };

    const items = await loadPopupItems(NOW);

    expect(items.map((item) => item.id)).toEqual(['live']);
    expect(mocks.eventsQueryCalls).toContainEqual(['events', 'id,starts_at,ends_at']);
    expect(mocks.eventsQueryCalls).toContainEqual(['events', 'archived_at', 'null']);
  });

  /* 시각 보완이 실패해도 목록은 상태를 믿고 그대로 뜬다. */
  it('보완 쿼리가 실패하면 상태만 믿고 싣는다', async () => {
    mocks.catalog = snapshot([event({ id: 'e1' })]);
    mocks.eventsTable = { data: null, error: { message: 'boom' } };

    const items = await loadPopupItems(NOW);

    expect(items.map((item) => item.id)).toEqual(['e1']);
  });

  it('목업 카탈로그는 보완 쿼리를 하지 않는다', async () => {
    mocks.catalog = snapshot([event({ id: 'e1' })], 'mock');

    const items = await loadPopupItems(NOW);

    expect(items.map((item) => item.id)).toEqual(['e1']);
    expect(mocks.eventsQueryCalls).toEqual([]);
  });

  /* POP-UP 은 공개 브라우징 표면이다 — 한쪽 원천을 못 읽었다고 던지지 않는다. */
  it('카탈로그를 못 읽어도 POP-UP 캠페인은 싣는다', async () => {
    mocks.catalogError = true;
    mocks.hub = { banners: [], campaigns: [campaign({ id: 'c1' })] };

    const items = await loadPopupItems(NOW);

    expect(items.map((item) => item.key)).toEqual(['campaign:c1']);
  });

  it('supabase 미구성이면 보완 쿼리 없이 상태만 믿는다', async () => {
    mocks.configured = false;
    mocks.catalog = snapshot([event({ id: 'e1' })]);

    const items = await loadPopupItems(NOW);

    expect(items.map((item) => item.id)).toEqual(['e1']);
    expect(mocks.eventsQueryCalls).toEqual([]);
  });
});
