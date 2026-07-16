import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCardRecord, AdminGameRecord, AdminRewardPolicyRecord } from '@/lib/admin/catalog.server';
import { Admin } from './Admin';

const hooks = vi.hoisted(() => ({
  cardSelected: null as unknown,
  gameProps: null as unknown,
  memberProps: null as unknown,
  notificationProps: null as unknown,
  policyProps: null as unknown,
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
vi.mock('./sections/CardSection', () => {
  const CardSection = (props: { selected: unknown }) => {
    hooks.cardSelected = props.selected;
    return null;
  };
  CardSection.displayName = 'AdminCardSectionMock';
  return { CardSection };
});
vi.mock('./sections/CardPoolSection', () => ({ CardPoolSection: () => null }));
vi.mock('./sections/EventSection', () => ({ EventSection: () => null }));
vi.mock('./sections/GoodSection', () => ({ GoodSection: () => null }));
vi.mock('./sections/GameSection', () => {
  const GameSection = (props: { selected: unknown }) => {
    hooks.gameProps = props;
    return null;
  };
  GameSection.displayName = 'AdminGameSectionMock';
  return { GameSection };
});
vi.mock('./sections/IpSection', () => ({ IpSection: () => null }));
vi.mock('./sections/Members', () => {
  const MembersSection = (props: unknown) => {
    hooks.memberProps = props;
    return null;
  };
  MembersSection.displayName = 'AdminMembersSectionMock';
  return { MembersSection };
});
vi.mock('./sections/Moderation', () => ({ ModerationSection: () => null }));
vi.mock('./sections/NotificationSection', () => {
  const NotificationSection = (props: unknown) => {
    hooks.notificationProps = props;
    return null;
  };
  NotificationSection.displayName = 'AdminNotificationSectionMock';
  return { NotificationSection };
});
vi.mock('./sections/Overview', () => ({ OverviewSection: () => null }));
vi.mock('./sections/Orders', () => ({ OrdersSection: () => null }));
vi.mock('./sections/Roles', () => ({ RolesSection: () => null }));
vi.mock('./sections/RewardPolicySection', () => {
  const RewardPolicySection = (props: { selected: unknown }) => {
    hooks.policyProps = props;
    return null;
  };
  RewardPolicySection.displayName = 'AdminRewardPolicySectionMock';
  return { RewardPolicySection };
});
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

const policy: AdminRewardPolicyRecord = {
  id: '77777777-7777-4777-8777-777777777777',
  poolId: '88888888-8888-4888-8888-888888888888',
  trigger: 'order_paid',
  targetIpId: 'hwasan',
  targetGoodId: null,
  minAmount: 30000,
  ticketsPerGrant: 2,
  active: true,
  activeFrom: '2026-07-15T00:00:00.000Z',
  activeTo: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-15T01:00:00.000Z',
  issuedCount: 12,
  availableCount: 7,
  openedCount: 4,
  revokedCount: 1,
  orderCount: 6,
  lastIssuedAt: '2026-07-15T02:00:00.000Z',
  status: 'active',
};

const game: AdminGameRecord = {
  id: 'marble-maple',
  type: 'marble_roulette',
  title: '메이플 마블 룰렛',
  variantKind: 'card',
  marbleCount: 10,
  rewardPoolId: '88888888-8888-4888-8888-888888888888',
  rewardPoolName: '메이플 무상 리워드 풀',
  ipId: 'maplestory',
  ipTitle: '메이플스토리',
  eventId: 'e2',
  eventTitle: '메이플 온라인 팝업',
  perUserDailyLimit: 1,
  activeFrom: '2026-07-15T00:00:00.000Z',
  activeTo: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-15T01:00:00.000Z',
  playCount: 12,
  lastPlayedAt: '2026-07-15T02:00:00.000Z',
  hasPlays: true,
  status: 'active',
};

function createProps(
  cards: AdminCardRecord[],
  rewardPolicies: AdminRewardPolicyRecord[] = [],
  games: AdminGameRecord[] = [],
) {
  return {
    admin: { id: 'admin-1', email: 'admin@icons.gg', role: 'admin' },
    catalog: { verticals: [], ips: [] },
    initialSection: 'card',
    insights: {},
    moderation: { reports: [] },
    members: [],
    orders: {},
    profiles: [],
    records: {
      ips: [],
      goods: [],
      cards,
      cardPools: [],
      rewardPolicies,
      games,
      events: [],
      ticketTypes: [],
    },
    policyDraftActiveFrom: '2026-07-15T00:00:00.000Z',
    policyDraftId: '99999999-9999-4999-8999-999999999999',
    policyOperationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    poolDraftActiveFrom: '2026-07-15T00:00:00.000Z',
    poolDraftId: '11111111-1111-4111-8111-111111111111',
    poolOddsOperationId: '22222222-2222-4222-8222-222222222222',
    poolOperationId: '33333333-3333-4333-8333-333333333333',
    stockAdjustmentId: '44444444-4444-4444-8444-444444444444',
    ticketDraftId: '55555555-5555-4555-8555-555555555555',
    ticketOperationId: '66666666-6666-4666-8666-666666666666',
    gameEndOperationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    gameOperationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    notificationConsole: { audiences: [], history: [] },
    notificationOperationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  } as unknown as Parameters<typeof Admin>[0];
}

describe('Admin card selection', () => {
  beforeEach(() => {
    hooks.cardSelected = null;
    hooks.gameProps = null;
    hooks.policyProps = null;
    hooks.stateValues = ['card', false, null, null, unboundCard.id, null, null, null, null, null];
  });

  it('derives the selected card from the latest revalidated records', () => {
    renderToStaticMarkup(<Admin {...createProps([unboundCard])} />);

    expect(hooks.cardSelected).toBe(unboundCard);
  });

  it('uses distinct remount keys for delimiter-colliding card and IP ids', () => {
    const cardA = { ...unboundCard, id: 'a-b', ipId: 'c', rarity: 'N' as const };
    const cardB = { ...unboundCard, id: 'a', ipId: 'b-c', rarity: 'N' as const };
    const getCardSectionKey = (card: AdminCardRecord) => {
      hooks.stateValues = ['card', false, null, null, card.id, null, null, null, null, null];
      const stack: unknown[] = [Admin(createProps([card]))];

      while (stack.length) {
        const node = stack.pop();
        if (!isValidElement(node)) continue;
        if ((node.type as { displayName?: string }).displayName === 'AdminCardSectionMock') {
          return node.key;
        }

        const children = (node.props as { children?: unknown }).children;
        if (Array.isArray(children)) stack.push(...children);
        else if (children !== undefined) stack.push(children);
      }

      return null;
    };

    expect(getCardSectionKey(cardA)).not.toBe(getCardSectionKey(cardB));
  });
});

describe('Admin reward-policy selection', () => {
  beforeEach(() => {
    hooks.cardSelected = null;
    hooks.gameProps = null;
    hooks.policyProps = null;
    hooks.stateValues = ['policy', false, null, null, null, null, policy.id, null, null, null];
  });

  it('renders the policy console with server-generated draft values', () => {
    renderToStaticMarkup(<Admin {...createProps([], [policy])} />);

    expect(hooks.policyProps).toMatchObject({
      draftActiveFrom: '2026-07-15T00:00:00.000Z',
      draftId: '99999999-9999-4999-8999-999999999999',
      operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      records: [policy],
    });
  });

  it('derives the selected policy from the latest revalidated records', () => {
    const latestPolicy = { ...policy, updatedAt: '2026-07-15T03:00:00.000Z', issuedCount: 20 };

    renderToStaticMarkup(<Admin {...createProps([], [latestPolicy])} />);

    expect((hooks.policyProps as { selected: unknown }).selected).toBe(latestPolicy);
  });
});

describe('Admin game selection', () => {
  beforeEach(() => {
    hooks.cardSelected = null;
    hooks.gameProps = null;
    hooks.policyProps = null;
    hooks.stateValues = ['game', false, null, null, null, null, null, game.id, null, null];
  });

  it('derives the selected game from the latest revalidated records', () => {
    const latestGame = { ...game, updatedAt: '2026-07-15T03:00:00.000Z', playCount: 14 };

    renderToStaticMarkup(<Admin {...createProps([], [], [latestGame])} />);

    expect(hooks.gameProps).toMatchObject({
      endOperationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      records: [latestGame],
      selected: latestGame,
    });
  });
});

describe('Admin notification console', () => {
  beforeEach(() => {
    hooks.notificationProps = null;
    hooks.stateValues = ['notifications', false, null, null, null, null, null, null, null, null];
  });

  it('서버에서 적재한 대상·이력과 operation ID를 전달한다', () => {
    renderToStaticMarkup(<Admin {...createProps([])} />);

    expect(hooks.notificationProps).toEqual({
      data: { audiences: [], history: [] },
      operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
  });
});

describe('Admin member console', () => {
  beforeEach(() => {
    hooks.memberProps = null;
    hooks.stateValues = ['members', false, null, null, null, null, null, null, null, null];
  });

  it('staff actor와 서버에서 받은 마스킹 회원 목록을 전달한다', () => {
    const members = [{
      id: '11111111-1111-4111-8111-111111111111',
      nickname: '팬일호',
      maskedEmail: 'f***@icons.gg',
      role: 'user' as const,
      createdAt: '2026-07-01T00:00:00.000Z',
      suspendedAt: null,
    }];
    const props = createProps([]);

    renderToStaticMarkup(
      <Admin
        {...props}
        admin={{ id: 'staff-1', email: 'staff@icons.gg', role: 'staff' }}
        initialSection="members"
        members={members}
      />,
    );

    expect(hooks.memberProps).toEqual({
      actor: { id: 'staff-1', role: 'staff' },
      initialMembers: members,
    });
  });
});
