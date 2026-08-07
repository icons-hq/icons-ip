import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCardPoolRecord } from '@/lib/admin/catalog.server';
import type { AdminDrawTicketGrantRecord } from '@/lib/admin/draw-ticket-grants';
import type { AdminMemberSummary } from '@/lib/admin/members';
import { DrawTicketGrantSection } from './DrawTicketGrantSection';

const hooks = vi.hoisted(() => ({
  grantAction: vi.fn(),
  grantState: {} as Record<string, unknown>,
  searchAction: vi.fn(),
  searchState: { members: [] as AdminMemberSummary[], query: '' },
  selected: null as AdminMemberSummary | null,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useMemo: (factory: () => unknown) => factory(),
    useActionState: (action: unknown, initial: unknown) => {
      if (action === hooks.searchAction) return [hooks.searchState, vi.fn(), false];
      if (action === hooks.grantAction) return [hooks.grantState, vi.fn(), false];
      return [initial, vi.fn(), false];
    },
    useState: (initial: unknown) => [hooks.selected ?? initial, vi.fn()],
  };
});
vi.mock('@/app/admin/member-actions', () => ({ searchAdminMembersAction: hooks.searchAction }));
vi.mock('@/app/admin/reward-grant-actions', () => ({ grantAdminDrawTicketsAction: hooks.grantAction }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const POOL_ID = '33333333-3333-4333-8333-333333333333';

const readyPool: AdminCardPoolRecord = {
  id: POOL_ID,
  ipId: 'hong-sil-quest',
  name: '홍실 퀘스트 시즌1',
  activeFrom: '2026-07-01T00:00:00.000Z',
  activeTo: null,
  updatedAt: '2026-07-01T00:00:00.000Z',
  status: 'active',
  oddsConfigured: true,
  rewardReady: true,
  odds: { N: 0.6, R: 0.25, SR: 0.1, SSR: 0.04, HOLO: 0.01 },
};

const member: AdminMemberSummary = {
  id: PROFILE_ID,
  nickname: '팬일호',
  maskedEmail: 'f***@icons.gg',
  role: 'user',
  createdAt: '2026-07-01T00:00:00.000Z',
  suspendedAt: null,
};

const grant: AdminDrawTicketGrantRecord = {
  operationId: OPERATION_ID,
  grantedAt: '2026-08-07T02:30:00.000Z',
  actorNickname: 'staff_park',
  recipientId: PROFILE_ID,
  recipientNickname: '팬일호',
  recipientMaskedEmail: 'f***@icons.gg',
  poolId: POOL_ID,
  poolName: '홍실 퀘스트 시즌1',
  quantity: 3,
  openedCount: 1,
  revokedCount: 0,
  reason: '카드풀 준비 전 결제한 초기 구매자 소급 발급',
};

function render(props: Partial<Parameters<typeof DrawTicketGrantSection>[0]> = {}) {
  return renderToStaticMarkup(
    <DrawTicketGrantSection
      draftOperationId={OPERATION_ID}
      grants={[]}
      pools={[readyPool]}
      {...props}
    />,
  );
}

beforeEach(() => {
  hooks.grantState = {};
  hooks.searchState = { members: [], query: '' };
  hooks.selected = null;
});

describe('DrawTicketGrantSection', () => {
  it('카드풀이 없으면 폼 대신 준비 안내를 보여준다', () => {
    const html = render({ pools: [] });

    expect(html).toContain('발급할 수 있는 카드풀이 없습니다');
    expect(html).not.toContain('name="reason"');
    expect(html).not.toContain('name="quantity"');
  });

  it('발급 준비가 끝나지 않은 카드풀은 후보에서 제외한다', () => {
    const html = render({ pools: [{ ...readyPool, rewardReady: false }] });

    expect(html).toContain('발급할 수 있는 카드풀이 없습니다');
  });

  it('운영이 끝난 카드풀도 후보에서 제외한다', () => {
    const html = render({ pools: [{ ...readyPool, status: 'ended' }] });

    expect(html).toContain('발급할 수 있는 카드풀이 없습니다');
  });

  it('대상을 고르기 전에는 발급 폼을 열지 않는다', () => {
    hooks.searchState = { members: [member], query: '팬' };

    const html = render();

    expect(html).toContain('발급 대상을 검색해 선택하면');
    expect(html).not.toContain('name="reason"');
  });

  it('대상을 고르면 멱등키·대상·사유 입력을 갖춘 발급 폼을 연다', () => {
    hooks.searchState = { members: [member], query: '팬' };
    hooks.selected = member;

    const html = render();

    expect(html).toContain(`name="operationId" value="${OPERATION_ID}"`);
    expect(html).toContain(`name="profileId" value="${PROFILE_ID}"`);
    expect(html).toContain('name="reason"');
    expect(html).toContain('name="quantity"');
    expect(html).toContain('max="10"');
  });

  it('발급 성공 후에는 다음 요청용 멱등키로 폼을 다시 연다', () => {
    const nextOperationId = '44444444-4444-4444-8444-444444444444';
    hooks.searchState = { members: [member], query: '팬' };
    hooks.selected = member;
    hooks.grantState = { message: '카드팩 3개를 발급했습니다.', nextOperationId };

    const html = render();

    expect(html).toContain(`name="operationId" value="${nextOperationId}"`);
    expect(html).not.toContain(`name="operationId" value="${OPERATION_ID}"`);
  });

  it('정지된 회원은 발급 대상으로 고를 수 없다', () => {
    hooks.searchState = {
      members: [{ ...member, suspendedAt: '2026-08-01T00:00:00.000Z' }],
      query: '팬',
    };

    const html = render();

    expect(html).toContain('disabled=""');
  });

  it('최근 수동 발급 이력에 사유와 실행자를 보여준다', () => {
    const html = render({ grants: [grant] });

    expect(html).toContain('카드풀 준비 전 결제한 초기 구매자 소급 발급');
    expect(html).toContain('staff_park');
    expect(html).toContain('홍실 퀘스트 시즌1');
  });

  it('이력이 없으면 빈 상태 문구를 보여준다', () => {
    const html = render();

    expect(html).toContain('수동 발급 이력이 없습니다');
  });
});
