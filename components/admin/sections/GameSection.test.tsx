import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminCardPoolRecord,
  AdminEventRecord,
  AdminGameRecord,
} from '@/lib/admin/catalog.server';
import {
  GameSection,
  getGameEventOptions,
  getGamePoolOptions,
  retainGameEventId,
} from './GameSection';

const mocks = vi.hoisted(() => ({
  end: vi.fn(),
  endState: {} as { errors?: Record<string, string>; message?: string },
  save: vi.fn(),
  saveState: {} as { errors?: Record<string, string>; message?: string },
  useActionState: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (...args: unknown[]) => mocks.useActionState(...args),
  };
});
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/app/admin/actions', () => ({
  endAdminGameAction: mocks.end,
  upsertAdminGameAction: mocks.save,
}));

const readyPool: AdminCardPoolRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  ipId: 'ip-a',
  name: 'IP A 카드풀',
  activeFrom: '2026-07-01T00:00:00.000Z',
  activeTo: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  status: 'active',
  oddsConfigured: true,
  rewardReady: true,
  odds: { N: 0.7, R: 0.2, SR: 0.1, SSR: 0, HOLO: 0 },
};

const scheduledPool: AdminCardPoolRecord = {
  ...readyPool,
  id: '22222222-2222-4222-8222-222222222222',
  ipId: 'ip-b',
  name: 'IP B 예정 카드풀',
  activeFrom: '2026-08-01T00:00:00.000Z',
  status: 'scheduled',
};

const endedPool: AdminCardPoolRecord = {
  ...readyPool,
  id: '33333333-3333-4333-8333-333333333333',
  name: '종료 카드풀',
  activeTo: '2026-07-10T00:00:00.000Z',
  status: 'ended',
};

const unreadyPool: AdminCardPoolRecord = {
  ...readyPool,
  id: '44444444-4444-4444-8444-444444444444',
  name: '준비 미완료 카드풀',
  rewardReady: false,
};

const events: AdminEventRecord[] = [
  {
    id: 'online-a',
    ipId: 'ip-a',
    title: 'IP A 온라인 이벤트',
    mode: '온라인',
    status: '예정',
    startsAt: null,
    endsAt: null,
    location: null,
    accent: null,
    bg: null,
    imagePath: null,
  },
  {
    id: 'offline-a',
    ipId: 'ip-a',
    title: 'IP A 오프라인 이벤트',
    mode: '오프라인',
    status: '예정',
    startsAt: null,
    endsAt: null,
    location: null,
    accent: null,
    bg: null,
    imagePath: null,
  },
  {
    id: 'online-b',
    ipId: 'ip-b',
    title: 'IP B 온라인 이벤트',
    mode: '온라인',
    status: '예정',
    startsAt: null,
    endsAt: null,
    location: null,
    accent: null,
    bg: null,
    imagePath: null,
  },
];

const activeGame: AdminGameRecord = {
  id: 'marble-a',
  type: 'marble_roulette',
  title: 'IP A 마블 룰렛',
  variantKind: 'card',
  marbleCount: 10,
  rewardPoolId: readyPool.id,
  rewardPoolName: readyPool.name,
  ipId: 'ip-a',
  ipTitle: 'IP A',
  eventId: 'online-a',
  eventTitle: 'IP A 온라인 이벤트',
  perUserDailyLimit: 2,
  activeFrom: '2026-07-15T00:00:00.000Z',
  activeTo: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-15T01:00:00.000Z',
  playCount: 12,
  lastPlayedAt: '2026-07-15T02:00:00.000Z',
  hasPlays: true,
  status: 'active',
};

function renderGameSection({
  pools = [readyPool, scheduledPool, endedPool, unreadyPool],
  records = [] as AdminGameRecord[],
  selected = null as AdminGameRecord | null,
}: {
  pools?: AdminCardPoolRecord[];
  records?: AdminGameRecord[];
  selected?: AdminGameRecord | null;
} = {}) {
  return renderToStaticMarkup(
    <GameSection
      endOperationId="66666666-6666-4666-8666-666666666666"
      events={events}
      onSelect={vi.fn()}
      operationId="55555555-5555-4555-8555-555555555555"
      pools={pools}
      records={records}
      selected={selected}
    />,
  );
}

describe('GameSection', () => {
  beforeEach(() => {
    mocks.saveState = {};
    mocks.endState = {};
    mocks.useActionState.mockReset();
    mocks.useActionState.mockImplementation((action: unknown) => (
      action === mocks.end
        ? [mocks.endState, vi.fn(), false]
        : [mocks.saveState, vi.fn(), false]
    ));
  });

  it('renders a safe card-game create form with an intentionally blank start', () => {
    const html = renderGameSection();

    expect(mocks.useActionState).toHaveBeenCalledWith(mocks.save, {});
    expect(html).toContain('class="admin-master-detail"');
    expect(html).toContain('class="admin-form-grid"');
    expect(html).toContain('aria-label="게임 목록"');
    expect(html).toContain('새 게임 등록');
    expect(html).toContain('name="operationId"');
    expect(html).toContain('value="55555555-5555-4555-8555-555555555555"');
    expect(html).toContain('name="previousGameId"');
    expect(html).toContain('name="id"');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="rewardPoolId"');
    expect(html).toContain('name="eventId"');
    expect(html).toContain('name="perUserDailyLimit"');
    expect(html).toContain('value="1"');
    expect(html.match(/<input[^>]+name="activeFrom"[^>]*>/)?.[0]).toContain('value=""');
    expect(html).toContain('운영 시작 (KST)');
    expect(html).toContain('마블 룰렛');
    expect(html).toContain('카드 보상형');
    expect(html).toContain('구슬 10개');
    expect(html).not.toContain('name="config"');
    expect(html).not.toContain('name="type"');
  });

  it('keeps only ready non-ended pools and same-IP online events as create candidates', () => {
    const html = renderGameSection();

    expect(getGamePoolOptions([readyPool, scheduledPool, endedPool, unreadyPool], null)).toEqual([
      readyPool,
      scheduledPool,
    ]);
    expect(getGameEventOptions(events, 'ip-a')).toEqual([events[0]]);
    expect(retainGameEventId(events, 'ip-a', 'online-a')).toBe('online-a');
    expect(retainGameEventId(events, 'ip-b', 'online-a')).toBe('');
    expect(html).toContain('IP A 카드풀');
    expect(html).toContain('IP B 예정 카드풀');
    expect(html).not.toContain('종료 카드풀');
    expect(html).not.toContain('준비 미완료 카드풀');
    expect(html).toContain('IP A 온라인 이벤트');
    expect(html).not.toContain('IP A 오프라인 이벤트');
    expect(html).not.toContain('IP B 온라인 이벤트');
  });

  it('retains a selected unavailable pool so an existing record remains inspectable', () => {
    const selected = {
      ...activeGame,
      hasPlays: false,
      playCount: 0,
      lastPlayedAt: null,
      rewardPoolId: endedPool.id,
      rewardPoolName: endedPool.name,
      status: 'pool-unavailable' as const,
    };

    expect(getGamePoolOptions([readyPool, endedPool], selected)).toEqual([readyPool, endedPool]);
    expect(renderGameSection({ records: [selected], selected })).toContain('종료 카드풀');
  });

  it('shows every operational status in the list', () => {
    const statuses: AdminGameRecord['status'][] = ['scheduled', 'active', 'ended', 'pool-unavailable'];
    const records = statuses.map((status, index) => ({
      ...activeGame,
      id: `game-${index}`,
      title: `게임 ${index}`,
      status,
    }));
    const html = renderGameSection({ records });

    for (const label of ['운영 예정', '운영 중', '운영 종료', '카드풀 사용 불가']) {
      expect(html).toContain(label);
    }
  });

  it('locks slug, pool, and event after play history while keeping operating fields editable', () => {
    const html = renderGameSection({ records: [activeGame], selected: activeGame });
    const idInput = html.match(/<input[^>]+name="id"[^>]*>/)?.[0] ?? '';
    const titleInput = html.match(/<input[^>]+name="title"[^>]*>/)?.[0] ?? '';
    const limitInput = html.match(/<input[^>]+name="perUserDailyLimit"[^>]*>/)?.[0] ?? '';
    const poolInput = html.match(/<input[^>]+name="rewardPoolId"[^>]*>/)?.[0] ?? '';
    const eventInput = html.match(/<input[^>]+name="eventId"[^>]*>/)?.[0] ?? '';

    expect(idInput).toContain('readOnly=""');
    expect(titleInput).not.toContain('readOnly=""');
    expect(limitInput).not.toContain('readOnly=""');
    expect(poolInput).toContain('type="hidden"');
    expect(poolInput).toContain(`value="${readyPool.id}"`);
    expect(eventInput).toContain('type="hidden"');
    expect(eventInput).toContain('value="online-a"');
    expect(html.match(/aria-readonly="true"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('플레이 이력이 있어 slug·보상 카드풀·연결 이벤트는 변경할 수 없습니다.');
    expect(html).toContain('플레이 12회');
    expect(html).toContain('최근 플레이 2026-07-15 11:00 KST');
  });

  it('provides an explicit end action whenever an editable card game window is active', () => {
    const activeHtml = renderGameSection({ records: [activeGame], selected: activeGame });
    const scheduledHtml = renderGameSection({
      records: [{ ...activeGame, status: 'scheduled' }],
      selected: { ...activeGame, status: 'scheduled' },
    });
    const unavailableHtml = renderGameSection({
      records: [{ ...activeGame, status: 'pool-unavailable' }],
      selected: { ...activeGame, status: 'pool-unavailable' },
    });

    expect(mocks.useActionState).toHaveBeenCalledWith(mocks.end, {});
    expect(activeHtml).toContain('지금 종료');
    expect(activeHtml).toContain('name="gameId"');
    expect(activeHtml).toContain('value="66666666-6666-4666-8666-666666666666"');
    expect(scheduledHtml).not.toContain('지금 종료');
    expect(unavailableHtml).toContain('지금 종료');
  });

  it.each(['goods', 'unknown'] as const)('renders %s variants as read-only with the #115 handoff', (variantKind) => {
    const selected: AdminGameRecord = {
      ...activeGame,
      id: `${variantKind}-game`,
      title: `${variantKind} 게임`,
      variantKind,
      rewardPoolId: null,
      rewardPoolName: null,
      ipId: null,
      ipTitle: null,
      eventId: null,
      eventTitle: null,
      hasPlays: false,
      playCount: 0,
      lastPlayedAt: null,
    };
    const html = renderGameSection({ records: [selected], selected });

    expect(html).toContain('읽기 전용');
    expect(html).toContain('href="https://github.com/sangwopark19/icons-ip/issues/115"');
    expect(html).toContain('#115');
    expect(html).not.toContain('name="title"');
    expect(html).not.toContain('지금 종료');
    expect(html).not.toMatch(/>\s*저장\s*</);
  });

  it('preserves selected values and reports action failures', () => {
    mocks.saveState = { errors: { form: '게임 저장 실패' } };
    const html = renderGameSection({ records: [activeGame], selected: activeGame });

    expect(html).toContain('value="IP A 마블 룰렛"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="2026-07-15T09:00"');
    expect(html).toContain('게임 저장 실패');
  });

  it('disables creation with an explicit reason when no eligible card pool exists', () => {
    const html = renderGameSection({ pools: [endedPool, unreadyPool] });

    expect(html).toContain('확률과 카드 구성이 완료된 운영 예정/운영 중 카드풀을 먼저 준비해주세요.');
    expect(html).toContain('disabled=""');
  });
});
