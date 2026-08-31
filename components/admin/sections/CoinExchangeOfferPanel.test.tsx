import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCoinExchangeOfferRecord } from '@/lib/admin/campaigns';
import type { AdminCardPoolRecord } from '@/lib/admin/catalog.server';
import { CoinExchangeOfferPanel } from './CoinExchangeOfferPanel';

const POOL_ID = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = '22222222-2222-4222-8222-222222222222';

const hooks = vi.hoisted(() => ({
  offerAction: vi.fn(),
  offerState: {} as Record<string, unknown>,
  selectedId: null as string | null,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (action: unknown, initial: unknown) => {
      if (action === hooks.offerAction) return [hooks.offerState, vi.fn(), false];
      return [initial, vi.fn(), false];
    },
    useState: (initial: unknown) => [hooks.selectedId ?? initial, vi.fn()],
  };
});
vi.mock('@/app/admin/campaign-actions', () => ({
  upsertAdminCoinExchangeOfferAction: hooks.offerAction,
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

const readyPool: AdminCardPoolRecord = {
  id: POOL_ID,
  ipId: 'maplestory',
  name: '가을 카드풀',
  activeFrom: '2026-08-01T00:00:00.000Z',
  activeTo: null,
  updatedAt: '2026-08-01T00:00:00.000Z',
  status: 'active',
  oddsConfigured: true,
  rewardReady: true,
  odds: { N: 0.6, R: 0.25, SR: 0.1, SSR: 0.04, HOLO: 0.01 },
};

const offer: AdminCoinExchangeOfferRecord = {
  id: OFFER_ID,
  poolId: POOL_ID,
  label: '가을 카드팩 1장',
  coinCost: 10,
  ticketCount: 1,
  status: 'active',
  updatedAt: '2026-08-31T15:00:00.000Z',
};

function render(
  offers: AdminCoinExchangeOfferRecord[] = [offer],
  pools: AdminCardPoolRecord[] = [readyPool],
) {
  return renderToStaticMarkup(<CoinExchangeOfferPanel offers={offers} pools={pools} />);
}

beforeEach(() => {
  hooks.offerState = {};
  hooks.selectedId = null;
});

describe('CoinExchangeOfferPanel', () => {
  /* exchange 블록은 이 id 를 손으로 옮겨 적는 값이다 — 선택하지 않아도 보여야 한다. */
  it('교환처 id 를 목록에 그대로 노출한다', () => {
    const markup = render();

    expect(markup).toContain(OFFER_ID);
    expect(markup).toContain('admin-campaign-offer-id');
  });

  it('목록에 카드풀·코인 비용·카드팩 수·상태를 함께 읽어 준다', () => {
    const markup = render();

    expect(markup).toContain('가을 카드풀');
    expect(markup).toContain('코인 10');
    expect(markup).toContain('카드팩 1장');
    expect(markup).toContain('노출');
  });

  /* 확률이 채워지지 않은 풀은 등록은 되지만 교환 시점에 실패한다
     (exchange_coins_for_draw_tickets → assert_card_pool_ready). 그 사실을 미리 말한다. */
  it('개봉 준비가 안 된 카드풀을 선택지와 목록 양쪽에서 표시한다', () => {
    const markup = render([offer], [{ ...readyPool, rewardReady: false }]);

    expect(markup.match(/개봉 준비 안 됨/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('교환처가 없으면 그 사실을 말한다', () => {
    const markup = render([]);

    expect(markup).toContain('등록된 교환처가 없습니다.');
  });

  it('카드풀이 없으면 선택지 대신 이유를 보여 준다', () => {
    const markup = render([], []);

    expect(markup).toContain('등록된 카드풀이 없습니다');
  });

  it('선택하지 않으면 신규 등록 폼이다', () => {
    const markup = render();

    expect(markup).toContain('name="offerId" value=""');
    expect(markup).toContain('교환처 등록');
  });

  it('선택하면 저장된 값을 프리필하고 수정 폼이 된다', () => {
    hooks.selectedId = OFFER_ID;

    const markup = render();

    expect(markup).toContain(`name="offerId" value="${OFFER_ID}"`);
    expect(markup).toContain('교환처 수정');
    expect(markup).toContain('value="가을 카드팩 1장"');
  });

  /* 가챠·뽑기 어휘를 쓰지 않는다(ADR-0003·ADR-0004, CONTEXT.md). */
  it('사용자에게 보이는 어휘를 카드팩으로 유지한다', () => {
    const markup = render();

    expect(markup).toContain('카드팩');
    expect(markup).not.toMatch(/가챠|뽑기|충전/);
  });
});
