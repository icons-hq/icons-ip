import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import Page, { maxDuration } from './page';

/*
 * R8: 요청번호를 누르면 같은 목록 위에 상세 팝업이 열린다. 상세 라우트와 같은 로더로
 * 읽고, 팝업 안의 처리(결제사 취소 포함)는 이 목록 라우트의 함수 예산으로 돈다.
 */

const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), list: vi.fn(), workspace: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.gate }));
vi.mock('@/lib/admin/claims.server', () => ({ getAdminClaimConsoleData: mocks.list }));
vi.mock('@/lib/admin/claim-preview.server', () => ({ loadAdminClaimWorkspace: mocks.workspace }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound'); },
  redirect: (href: string) => { throw new Error(`redirect:${href}`); },
  useRouter: () => ({ replace: vi.fn() }),
}));

type Node = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;
function all(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const element = node as Node;
  return [element, ...all(element.props.children)];
}
function named(node: ReactNode, name: string) {
  return all(node).find((element) => typeof element.type === 'function' && (element.type as { name?: string }).name === name);
}

function workspace(claimType = 'return') {
  return {
    detail: { claim: { id: CLAIM_ID, reference: 12, claimType }, payment: null, order: null },
    carriers: [],
    cancellationForm: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.gate.mockResolvedValue({ user: { id: 'staff-1' }, operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, isStaff: true, role: 'staff' });
  mocks.list.mockResolvedValue({ claimType: 'return', counts: {}, filters: {}, pageSize: 20, rows: [], total: 0 });
});

it('목록 라우트도 결제사 취소 예산(60초)을 가진다', () => {
  expect(maxDuration).toBe(60);
});

it('claimId가 없으면 상세를 읽지 않는다', async () => {
  const tree = await Page({ params: Promise.resolve({ claimType: 'returns' }), searchParams: Promise.resolve({ stage: 'open' }) } as never);
  expect(mocks.workspace).not.toHaveBeenCalled();
  expect(named(tree, 'ClaimPreviewDialog')).toBeUndefined();
});

it('claimId가 있으면 상세 라우트와 같은 로더로 읽어 팝업 안에 embedded 상세를 그린다', async () => {
  mocks.workspace.mockResolvedValue(workspace());
  const tree = await Page({
    params: Promise.resolve({ claimType: 'returns' }),
    searchParams: Promise.resolve({ stage: 'open', page: '2', claimId: CLAIM_ID.toUpperCase() }),
  } as never);

  expect(mocks.workspace).toHaveBeenCalledWith(CLAIM_ID);
  const dialog = named(tree, 'ClaimPreviewDialog');
  expect(dialog?.props.closeHref).toBe('/admin/sales/claims/returns?stage=open&page=2');
  expect(dialog?.props.title).toBe('반품 C00012 상세 · 처리');
  const screen = named(tree, 'ClaimDetailScreen');
  expect(screen?.props).toMatchObject({
    actorId: 'staff-1',
    embedded: true,
    backHref: '/admin/sales/claims/returns?stage=open&page=2',
    detailHref: `/admin/sales/claims/returns/${CLAIM_ID}?back=${encodeURIComponent('stage=open&page=2')}`,
  });
});

it('다른 유형으로 바뀐 요청은 그 유형의 목록 팝업으로 보낸다', async () => {
  mocks.workspace.mockResolvedValue(workspace('exchange'));
  await expect(Page({
    params: Promise.resolve({ claimType: 'returns' }),
    searchParams: Promise.resolve({ claimId: CLAIM_ID }),
  } as never)).rejects.toThrow(`redirect:/admin/sales/claims/exchanges?claimId=${CLAIM_ID}`);
});

it('찾을 수 없는 요청은 팝업 안에서 알린다', async () => {
  mocks.workspace.mockResolvedValue(null);
  const tree = await Page({ params: Promise.resolve({ claimType: 'cancels' }), searchParams: Promise.resolve({ claimId: CLAIM_ID }) } as never);
  const dialog = named(tree, 'ClaimPreviewDialog');
  expect(dialog).toBeDefined();
  expect(named(tree, 'ClaimDetailScreen')).toBeUndefined();
  expect(JSON.stringify(dialog?.props.children)).toContain('요청을 찾을 수 없습니다');
});

it('형식이 아닌 claimId는 무시한다', async () => {
  await Page({ params: Promise.resolve({ claimType: 'cancels' }), searchParams: Promise.resolve({ claimId: 'x' }) } as never);
  expect(mocks.workspace).not.toHaveBeenCalled();
});
