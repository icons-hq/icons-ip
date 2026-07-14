import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCardRecord } from '@/lib/admin/catalog.server';
import { Admin } from './Admin';

const hooks = vi.hoisted(() => ({
  cardSelected: null as unknown,
  stateValues: [] as unknown[],
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: () => [{}, vi.fn(), false],
    useMemo: (factory: () => unknown) => factory(),
    useState: (initial: unknown) => {
      const value = hooks.stateValues.length
        ? hooks.stateValues.shift()
        : typeof initial === 'function'
          ? (initial as () => unknown)()
          : initial;
      return [value, vi.fn()];
    },
  };
});

vi.mock('@/app/admin/actions', () => ({
  upsertAdminCardAction: vi.fn(),
  upsertAdminEventAction: vi.fn(),
  upsertAdminGoodAction: vi.fn(),
  upsertAdminIpAction: vi.fn(),
}));
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./Sidebar', () => ({ Sidebar: () => null }));
vi.mock('./sections/CardSection', () => ({
  CardSection: (props: { selected: unknown }) => {
    hooks.cardSelected = props.selected;
    return null;
  },
}));
vi.mock('./sections/CardPoolSection', () => ({ CardPoolSection: () => null }));
vi.mock('./sections/EventSection', () => ({ EventSection: () => null }));
vi.mock('./sections/GoodSection', () => ({ GoodSection: () => null }));
vi.mock('./sections/IpSection', () => ({ IpSection: () => null }));
vi.mock('./sections/Moderation', () => ({ ModerationSection: () => null }));
vi.mock('./sections/Overview', () => ({ OverviewSection: () => null }));
vi.mock('./sections/Orders', () => ({ OrdersSection: () => null }));
vi.mock('./sections/Roles', () => ({ RolesSection: () => null }));
vi.mock('./sections/TicketSection', () => ({ TicketSection: () => null }));

const unboundCard: AdminCardRecord = {
  id: 'c100',
  ipId: 'hwasan',
  poolId: null,
  name: '청명 홀로 카드',
  no: '001/120',
  rarity: 'HOLO',
  bg: null,
  imagePath: null,
};

describe('Admin card selection', () => {
  beforeEach(() => {
    hooks.cardSelected = null;
    hooks.stateValues = ['card', false, null, null, unboundCard.id, null, null, null];
  });

  it('derives the selected card from the latest revalidated records', () => {
    const props = {
      admin: { id: 'admin-1', email: 'admin@icons.gg', role: 'admin' },
      catalog: { verticals: [], ips: [] },
      initialSection: 'card',
      insights: {},
      moderation: { reports: [] },
      orders: {},
      profiles: [],
      records: {
        ips: [],
        goods: [],
        cards: [unboundCard],
        cardPools: [],
        events: [],
        ticketTypes: [],
      },
      poolDraftActiveFrom: '2026-07-15T00:00:00.000Z',
      poolDraftId: '11111111-1111-4111-8111-111111111111',
      poolOddsOperationId: '22222222-2222-4222-8222-222222222222',
      poolOperationId: '33333333-3333-4333-8333-333333333333',
      stockAdjustmentId: '44444444-4444-4444-8444-444444444444',
      ticketDraftId: '55555555-5555-4555-8555-555555555555',
      ticketOperationId: '66666666-6666-4666-8666-666666666666',
    } as unknown as Parameters<typeof Admin>[0];

    renderToStaticMarkup(<Admin {...props} />);

    expect(hooks.cardSelected).toBe(unboundCard);
  });
});
