import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminCampaignConsoleData } from './campaigns.server';

const CAMPAIGN_ROW = {
  id: 'autumn-attendance',
  kind: 'event',
  title: '가을 출석 이벤트',
  subtitle: null,
  status: 'draft',
  starts_at: '2026-08-31T15:00:00.000Z',
  ends_at: '2026-09-30T14:59:00.000Z',
  hero_image_path: 'campaigns/autumn/hero.webp',
  card_image_path: null,
  banner_image_path: null,
  featured_order: 1,
  sections: [{ type: 'attendance' }],
  updated_at: '2026-08-31T15:00:00.000Z',
};

const OFFER_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  pool_id: '11111111-1111-4111-8111-111111111111',
  label: '가을 카드팩 1장',
  coin_cost: 10,
  ticket_count: 1,
  status: 'active',
  updated_at: '2026-08-31T15:00:00.000Z',
};

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; select: string; orders: string[] }>,
  campaigns: [] as Array<Record<string, unknown>>,
  offers: [] as Array<Record<string, unknown>>,
  campaignError: null as { message: string } | null,
  offerError: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (table: string) => {
      const call = { table, select: '', orders: [] as string[] };
      mocks.calls.push(call);
      const query = {
        select(value: string) {
          call.select = value;
          return query;
        },
        order(column: string) {
          call.orders.push(column);
          return Promise.resolve(
            table === 'campaigns'
              ? { data: mocks.campaigns, error: mocks.campaignError }
              : { data: mocks.offers, error: mocks.offerError },
          );
        },
      };
      return query;
    },
  }),
}));

beforeEach(() => {
  mocks.calls = [];
  mocks.campaigns = [CAMPAIGN_ROW];
  mocks.offers = [OFFER_ROW];
  mocks.campaignError = null;
  mocks.offerError = null;
});

describe('getAdminCampaignConsoleData', () => {
  /* draft 는 운영자만 보는 상태다. 로더가 status 조건을 걸면 준비 중인 편성을
     콘솔에서 열 수 없어진다 — 노출 판정은 RLS(campaigns_public_read)가 한다. */
  it('상태 조건 없이 최근 시작순으로 캠페인을 읽는다', async () => {
    const data = await getAdminCampaignConsoleData();

    expect(data.campaigns).toEqual([expect.objectContaining({
      id: 'autumn-attendance',
      kind: 'event',
      status: 'draft',
      featuredOrder: 1,
      heroImagePath: 'campaigns/autumn/hero.webp',
      sections: [{ type: 'attendance' }],
    })]);
    const campaignCall = mocks.calls.find((call) => call.table === 'campaigns');
    expect(campaignCall?.orders).toEqual(['starts_at']);
    expect(campaignCall?.select).toContain('sections');
  });

  it('교환처를 카멜케이스 레코드로 옮긴다', async () => {
    const data = await getAdminCampaignConsoleData();

    expect(data.offers).toEqual([{
      id: OFFER_ROW.id,
      poolId: OFFER_ROW.pool_id,
      label: '가을 카드팩 1장',
      coinCost: 10,
      ticketCount: 1,
      status: 'active',
      updatedAt: OFFER_ROW.updated_at,
    }]);
  });

  /* sections 가 배열이 아닌 값으로 들어오면 폼이 JSON.stringify 에서 이상한 값을
     그린다. 목록 화면은 멈추지 않고 빈 블록으로 접는다. */
  it('배열이 아닌 sections 는 빈 배열로 접는다', async () => {
    mocks.campaigns = [{ ...CAMPAIGN_ROW, sections: null }];

    const data = await getAdminCampaignConsoleData();

    expect(data.campaigns[0].sections).toEqual([]);
  });

  it('모르는 kind·status 는 라벨이 있는 기본값으로 접는다', async () => {
    mocks.campaigns = [{ ...CAMPAIGN_ROW, kind: 'season', status: 'archived' }];

    const data = await getAdminCampaignConsoleData();

    expect(data.campaigns[0].kind).toBe('event');
    expect(data.campaigns[0].status).toBe('draft');
  });

  it('조회 실패는 화면이 아니라 로더에서 터뜨린다', async () => {
    mocks.campaignError = { message: 'permission denied' };

    await expect(getAdminCampaignConsoleData()).rejects.toThrow('Failed to load admin campaigns');
  });

  it('교환처 조회 실패도 조용히 넘기지 않는다', async () => {
    mocks.offerError = { message: 'permission denied' };

    await expect(getAdminCampaignConsoleData())
      .rejects.toThrow('Failed to load admin coin exchange offers');
  });
});
