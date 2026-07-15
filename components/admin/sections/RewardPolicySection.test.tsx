import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminCardPoolRecord,
  AdminGoodRecord,
  AdminRewardPolicyRecord,
} from '@/lib/admin/catalog.server';
import {
  getRewardPolicyFormKey,
  getRewardPolicyPoolOptions,
  retainRewardPolicyGoodId,
  RewardPolicySection,
} from './RewardPolicySection';

const mocks = vi.hoisted(() => ({
  actionState: {} as { errors?: Record<string, string>; message?: string },
  upsert: vi.fn(),
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
vi.mock('@/app/admin/actions', () => ({ upsertAdminRewardPolicyAction: mocks.upsert }));

const goods: AdminGoodRecord[] = [
  {
    id: 'good-a',
    ipId: 'ip-a',
    name: '화산 키링',
    type: '키링',
    price: 15000,
    badge: null,
    stock: 'in',
    stockQty: 10,
    bg: null,
    imagePath: null,
  },
  {
    id: 'good-b',
    ipId: 'ip-b',
    name: '루멘 포스터',
    type: '포스터',
    price: 20000,
    badge: null,
    stock: 'in',
    stockQty: 10,
    bg: null,
    imagePath: null,
  },
];

const readyPoolA: AdminCardPoolRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  ipId: 'ip-a',
  name: '화산 운영 풀',
  activeFrom: '2026-07-01T00:00:00.000Z',
  activeTo: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  status: 'active',
  oddsConfigured: true,
  rewardReady: true,
  odds: { N: 1, R: 0, SR: 0, SSR: 0, HOLO: 0 },
};

const scheduledPoolB: AdminCardPoolRecord = {
  ...readyPoolA,
  id: '22222222-2222-4222-8222-222222222222',
  ipId: 'ip-b',
  name: '루멘 예정 풀',
  activeFrom: '2026-08-01T00:00:00.000Z',
  status: 'scheduled',
};

const endedPool: AdminCardPoolRecord = {
  ...readyPoolA,
  id: '33333333-3333-4333-8333-333333333333',
  name: '종료된 보존 풀',
  activeTo: '2026-07-10T00:00:00.000Z',
  status: 'ended',
};

const unreadyPool: AdminCardPoolRecord = {
  ...readyPoolA,
  id: '44444444-4444-4444-8444-444444444444',
  name: '발급 준비 미완료 풀',
  oddsConfigured: true,
  rewardReady: false,
};

const selectedPolicy: AdminRewardPolicyRecord = {
  id: '55555555-5555-4555-8555-555555555555',
  poolId: endedPool.id,
  trigger: 'order_paid',
  targetIpId: 'ip-a',
  targetGoodId: 'good-a',
  minAmount: 30000,
  ticketsPerGrant: 2,
  active: true,
  activeFrom: '2026-07-15T03:04:05.000Z',
  activeTo: '2026-08-15T03:04:05.000Z',
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-15T04:00:00.000Z',
  issuedCount: 12,
  availableCount: 7,
  openedCount: 4,
  revokedCount: 1,
  orderCount: 6,
  lastIssuedAt: '2026-07-15T02:00:00.000Z',
  status: 'pool-unavailable',
};

const ipOptions = [
  { id: 'ip-a', title: '화산강림' },
  { id: 'ip-b', title: '루멘' },
];

function renderPolicySection({
  pools = [readyPoolA, scheduledPoolB, endedPool, unreadyPool],
  records = [] as AdminRewardPolicyRecord[],
  selected = null as AdminRewardPolicyRecord | null,
  ips = ipOptions,
}: {
  pools?: AdminCardPoolRecord[];
  records?: AdminRewardPolicyRecord[];
  selected?: AdminRewardPolicyRecord | null;
  ips?: { id: string; title: string }[];
} = {}) {
  return renderToStaticMarkup(
    <RewardPolicySection
      draftActiveFrom="2026-07-15T03:04:05.000Z"
      draftId="66666666-6666-4666-8666-666666666666"
      goods={goods}
      ipOptions={ips}
      onSelect={vi.fn()}
      operationId="77777777-7777-4777-8777-777777777777"
      pools={pools}
      records={records}
      selected={selected}
    />,
  );
}

describe('RewardPolicySection', () => {
  beforeEach(() => {
    mocks.actionState = {};
    mocks.useActionState.mockReset();
    mocks.useActionState.mockImplementation(() => [mocks.actionState, vi.fn(), false]);
  });

  it('renders safe create defaults, KST fields, validation bounds, and server-action fields', () => {
    const html = renderPolicySection();

    expect(mocks.useActionState).toHaveBeenCalledWith(mocks.upsert, {});
    expect(html).toContain('aria-label="발급 정책 목록"');
    expect(html).toContain('새 발급 정책');
    expect(html).toContain('name="operationId"');
    expect(html).toContain('value="77777777-7777-4777-8777-777777777777"');
    expect(html).toContain('name="id"');
    expect(html).toContain('value="66666666-6666-4666-8666-666666666666"');
    expect(html).toContain('name="trigger"');
    expect(html).toContain('value="order_paid"');
    expect(html).toContain('전체 굿즈(IP 결제 합계)');
    expect(html).toContain('name="minAmount"');
    expect(html).toContain('min="0"');
    expect(html).toContain('step="1"');
    expect(html).toContain('name="ticketsPerGrant"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="100"');
    expect(html).toContain('value="2026-07-15T12:04"');
    expect(html).toContain('운영 종료 (KST, 선택)');
    expect(html.match(/<input[^>]+name="active"[^>]*>/)?.[0]).not.toContain('checked');
  });

  it('filters target goods by IP while keeping eligible reward pools IP-independent', () => {
    const html = renderPolicySection();

    expect(html).toContain('화산 키링');
    expect(html).not.toContain('루멘 포스터');
    expect(html).toContain('화산 운영 풀');
    expect(html).toContain('루멘 예정 풀');
    expect(html).not.toContain('종료된 보존 풀');
    expect(html).not.toContain('발급 준비 미완료 풀');
  });

  it('retains an unavailable selected pool for deactivation and preserves selected fields after an error', () => {
    mocks.actionState = { errors: { form: '저장 실패' } };
    const html = renderPolicySection({ records: [selectedPolicy], selected: selectedPolicy });

    expect(html).toContain('종료된 보존 풀');
    expect(html).toContain('value="good-a" selected=""');
    expect(html).toContain(`value="${endedPool.id}" selected=""`);
    expect(html.match(/<input[^>]+name="active"[^>]*>/)?.[0]).toContain('checked');
    expect(html).toContain('value="30000"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="2026-07-15T12:04"');
    expect(html).toContain('현재 카드풀을 사용할 수 없습니다. 정책을 비활성화한 뒤 저장해주세요.');
    expect(html).toContain('disabled=""');
    expect(html).toContain('저장 실패');
  });

  it('shows policy status, issuance summary, cumulative-match warning, and legacy exclusion warning', () => {
    const statuses = ['inactive', 'scheduled', 'active', 'ended', 'pool-unavailable'] as const;
    const records = statuses.map((status, index) => ({
      ...selectedPolicy,
      id: `${index + 1}5555555-5555-4555-8555-555555555555`,
      status,
    }));
    const html = renderPolicySection({ records, selected: records[4] });

    for (const label of ['비활성', '운영 예정', '운영 중', '운영 종료', '카드풀 사용 불가']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('발급 12');
    expect(html).toContain('사용 가능 7');
    expect(html).toContain('개봉 4');
    expect(html).toContain('회수 1');
    expect(html).toContain('주문 6');
    expect(html).toContain('최근 발급 2026-07-15 11:00 KST');
    expect(html).toContain('class="admin-form-grid mono"');
    expect(html).toContain('조건이 겹치는 활성 정책은 누적 적용');
    expect(html).toContain('정책 연결 정보가 없는 기존 뽑기권은 집계에서 제외');
  });

  it('disables creation with an explicit reason when prerequisites are missing', () => {
    const noIpHtml = renderPolicySection({ ips: [] });
    const noPoolHtml = renderPolicySection({ pools: [endedPool, unreadyPool] });

    expect(noIpHtml).toContain('먼저 IP를 등록해주세요.');
    expect(noIpHtml).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(?:<[^>]+>[^<]*<\/[^>]+>)?\s*저장<\/button>/);
    expect(noPoolHtml).toContain('확률과 카드 구성이 완료된 운영 예정/운영 중 카드풀을 먼저 준비해주세요.');
    expect(noPoolHtml).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(?:<[^>]+>[^<]*<\/[^>]+>)?\s*저장<\/button>/);
  });

  it('resets an out-of-scope good and uses a semantic remount key', () => {
    expect(retainRewardPolicyGoodId(goods, 'ip-a', 'good-a')).toBe('good-a');
    expect(retainRewardPolicyGoodId(goods, 'ip-b', 'good-a')).toBe('');
    expect(getRewardPolicyFormKey(selectedPolicy, 'draft-id', 'operation-id')).toBe(
      JSON.stringify([selectedPolicy.id, selectedPolicy.updatedAt, 'operation-id']),
    );
    expect(getRewardPolicyFormKey(null, 'draft-id', 'operation-id')).toBe(
      JSON.stringify(['draft-id', null, 'operation-id']),
    );
  });

  it('includes scheduled ready pools and only the selected unavailable pool', () => {
    expect(getRewardPolicyPoolOptions(
      [readyPoolA, scheduledPoolB, endedPool, unreadyPool],
      selectedPolicy,
    ).map((pool) => pool.id)).toEqual([readyPoolA.id, scheduledPoolB.id, endedPool.id]);
  });
});
