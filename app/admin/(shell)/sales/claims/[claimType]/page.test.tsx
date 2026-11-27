import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import Page, { maxDuration } from './page';

/*
 * R8: 요청번호를 누르면 같은 목록 위에 상세 팝업이 열린다. 상세 라우트와 같은 로더로
 * 읽고, 팝업 안의 처리(결제사 취소 포함)는 이 목록 라우트의 함수 예산으로 돈다.
 */

const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), list: vi.fn(), workspace: vi.fn(), note: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.gate }));
vi.mock('@/lib/admin/pii-access-log.server', () => ({ notePiiAccess: mocks.note }));
vi.mock('@/lib/admin/claims.server', () => ({ getAdminClaimConsoleData: mocks.list }));
vi.mock('@/lib/admin/claim-preview.server', () => ({ loadAdminClaimWorkspace: mocks.workspace }));
/* 반품 자동 회수 접수·반품입고 회신 칸(QNA-032·QNA-034)은 스위치가 꺼진 상태로 읽는다 — 목록은 지금과 같다. */
const operations = vi.hoisted(() => ({ value: { pickup: { enabled: false }, intake: { enabled: false } } as unknown }));
vi.mock('@/lib/admin/claim-return-operations.server', () => ({ loadClaimReturnOperations: async () => operations.value }));
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
    autoPickupOnApproval: true,
  };
}

beforeEach(() => {
  operations.value = { pickup: { enabled: false }, intake: { enabled: false } };
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
  expect(named(tree, 'ClaimPreviewKitDialog')).toBeUndefined();
});

it('claimId가 있으면 상세 라우트와 같은 로더로 읽어 팝업 안에 embedded 상세를 그린다', async () => {
  mocks.workspace.mockResolvedValue(workspace());
  const tree = await Page({
    params: Promise.resolve({ claimType: 'returns' }),
    searchParams: Promise.resolve({ stage: 'open', page: '2', claimId: CLAIM_ID.toUpperCase() }),
  } as never);

  expect(mocks.workspace).toHaveBeenCalledWith(CLAIM_ID);
  const dialog = named(tree, 'ClaimPreviewKitDialog');
  expect(dialog?.props.closeHref).toBe('/admin/sales/claims/returns?stage=open&page=2');
  expect(dialog?.props.title).toBe('반품 C00012 상세 · 처리');
  const screen = named(tree, 'ClaimDetailScreen');
  expect(screen?.props).toMatchObject({
    actorId: 'staff-1',
    embedded: true,
    /* 자동 회수 접수 스위치를 팝업에도 넘겨야 팝업 안의 승인도 '택배사에 회수가 접수된다'는 확인창을 띄운다. */
    autoPickupOnApproval: true,
    backHref: '/admin/sales/claims/returns?stage=open&page=2',
    detailHref: `/admin/sales/claims/returns/${CLAIM_ID}?back=${encodeURIComponent('stage=open&page=2')}`,
  });
  expect(mocks.note).toHaveBeenCalledExactlyOnceWith({ actorId: 'staff-1', action: 'view', surface: 'claim.detail',
    path: `/admin/sales/claims/returns/${CLAIM_ID}`, subjectKind: 'claim', subjectIds: [CLAIM_ID], detail: { via: 'popup' } });
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
  /* 세 목록 모두 템플릿 룩 kit 화면·팝업이다(ADR-0028). */
  const dialog = named(tree, 'ClaimPreviewKitDialog');
  expect(dialog).toBeDefined();
  expect(named(tree, 'ClaimQueueKitScreen')).toBeDefined();
  expect(named(tree, 'ClaimDetailScreen')).toBeUndefined();
  expect(JSON.stringify(dialog?.props.children)).toContain('요청을 찾을 수 없습니다');
  expect(mocks.note).not.toHaveBeenCalled();
});

it('구매자·수령인 검색은 원문 없이 클레임 검색 기록을 남기고, 주문번호 검색·검색어 없는 목록은 남기지 않는다', async () => {
  const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
  mocks.list.mockResolvedValue({ claimType: 'return', counts: {}, filters: {}, pageSize: 20, rows: [{ id: CLAIM_ID }, { id: other }], total: 5 });
  await Page({ params: Promise.resolve({ claimType: 'returns' }), searchParams: Promise.resolve({ field: 'buyer', query: '홍길동' }) } as never);
  expect(mocks.note).toHaveBeenCalledExactlyOnceWith({ actorId: 'staff-1', action: 'search', surface: 'claim.search', path: '/admin/sales/claims/returns',
    subjectKind: 'claim', subjectIds: [CLAIM_ID, other], subjectCount: 5, detail: { field: 'buyer', page: 1 } });
  expect(JSON.stringify(mocks.note.mock.calls)).not.toContain('홍길동');
  mocks.note.mockClear();
  await Page({ params: Promise.resolve({ claimType: 'returns' }), searchParams: Promise.resolve({ field: 'order', query: 'C00012' }) } as never);
  await Page({ params: Promise.resolve({ claimType: 'returns' }), searchParams: Promise.resolve({ stage: 'open' }) } as never);
  expect(mocks.note).not.toHaveBeenCalled();
});

it('형식이 아닌 claimId는 무시한다', async () => {
  await Page({ params: Promise.resolve({ claimType: 'cancels' }), searchParams: Promise.resolve({ claimId: 'x' }) } as never);
  expect(mocks.workspace).not.toHaveBeenCalled();
});

it.each(['cancels', 'returns', 'exchanges'])('ADR-0028: %s 목록은 kit 화면·kit 팝업이고, 비교용 기존 화면 스위치는 없다', async (slug) => {
  mocks.workspace.mockResolvedValue(null);
  const tree = await Page({ params: Promise.resolve({ claimType: slug }), searchParams: Promise.resolve({ claimId: CLAIM_ID, ui: 'classic' }) } as never);
  expect(named(tree, 'ClaimQueueKitScreen')).toBeDefined();
  expect(named(tree, 'ClaimPreviewKitDialog')).toBeDefined();
  expect(named(tree, 'ClaimQueueScreen')).toBeUndefined();
  expect(named(tree, 'ClaimPreviewDialog')).toBeUndefined();
});

/* L-09: 반품·교환 승인 확인창은 자동 회수 접수가 켜져 있을 때만 '택배사에 회수가 접수됩니다'를 말한다. 스위치 값은 목록이 이미 읽는다. */
it.each([[false, 'returns'], [true, 'returns'], [true, 'exchanges']] as const)('자동 회수 접수 스위치(%s)를 %s 목록 화면에 넘긴다', async (enabled, slug) => {
  operations.value = { pickup: enabled ? { enabled: true, failed: 0, pending: 0, items: [] } : { enabled: false }, intake: { enabled: false } };
  const tree = await Page({ params: Promise.resolve({ claimType: slug }), searchParams: Promise.resolve({ stage: 'open' }) } as never);
  expect(named(tree, 'ClaimQueueKitScreen')?.props.autoPickupEnabled).toBe(enabled);
});

it('취소 목록은 회수가 없어 자동 회수 접수를 읽지 않고 꺼진 것으로 넘긴다', async () => {
  operations.value = { pickup: { enabled: true, failed: 0, pending: 0, items: [] }, intake: { enabled: false } };
  const tree = await Page({ params: Promise.resolve({ claimType: 'cancels' }), searchParams: Promise.resolve({ stage: 'open' }) } as never);
  expect(named(tree, 'ClaimQueueKitScreen')?.props.autoPickupEnabled).toBe(false);
});
