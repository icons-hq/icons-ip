import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, expect, it, vi } from 'vitest';
import Page from './page';

/* 클레임 상세 라우트는 열람을 개인정보 접속기록으로 남긴다(목록 위 팝업과 같은 기록, 경로만 상세 라우트). */
const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const mocks = vi.hoisted(() => ({ gate: vi.fn(), workspace: vi.fn(), note: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.gate }));
vi.mock('@/lib/admin/claim-preview.server', () => ({ loadAdminClaimWorkspace: mocks.workspace }));
vi.mock('@/lib/admin/pii-access-log.server', () => ({ notePiiAccess: mocks.note }));
vi.mock('@/components/admin/screens/ClaimDetailScreen', () => ({ ClaimDetailScreen: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound'); },
  redirect: (href: string) => { throw new Error(`redirect:${href}`); },
}));

const visit = (claimId = CLAIM_ID, claimType = 'returns') => Page({ params: Promise.resolve({ claimType, claimId }), searchParams: Promise.resolve({}) } as never);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.gate.mockResolvedValue({ user: { id: 'staff-1' }, operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, isStaff: true, role: 'staff' });
  mocks.workspace.mockResolvedValue({ detail: { claim: { id: CLAIM_ID, claimType: 'return' } }, carriers: [], cancellationForm: null, defectiveStock: null });
});

it('연 클레임 상세를 접속기록으로 남긴다', async () => {
  await visit(CLAIM_ID.toUpperCase());
  expect(mocks.workspace).toHaveBeenCalledWith(CLAIM_ID);
  expect(mocks.note).toHaveBeenCalledExactlyOnceWith({ actorId: 'staff-1', action: 'view', surface: 'claim.detail',
    path: `/admin/sales/claims/returns/${CLAIM_ID}`, subjectKind: 'claim', subjectIds: [CLAIM_ID], detail: { via: 'page' } });
});

/* 반품·교환 승인 확인창은 자동 회수 접수가 켜져 있을 때만 '택배사에 회수가 접수됩니다'를 말한다 — 로더가 읽은 스위치 값을 화면에 그대로 내린다. */
it.each([true, false])('자동 회수 접수 스위치(%s)를 상세 화면에 넘긴다', async (enabled) => {
  mocks.workspace.mockResolvedValue({ detail: { claim: { id: CLAIM_ID, claimType: 'return' } }, carriers: [], cancellationForm: null, defectiveStock: null, autoPickupOnApproval: enabled });
  const tree = await visit() as { props: { autoPickupOnApproval?: boolean } };
  expect(tree.props.autoPickupOnApproval).toBe(enabled);
});

it('없는 요청·유형이 바뀐 요청은 기록하지 않고 404·현재 유형으로 보낸다', async () => {
  mocks.workspace.mockResolvedValueOnce(null);
  await expect(visit()).rejects.toThrow('notFound');
  mocks.workspace.mockResolvedValueOnce({ detail: { claim: { id: CLAIM_ID, claimType: 'exchange' } }, carriers: [], cancellationForm: null, defectiveStock: null });
  await expect(visit()).rejects.toThrow(`redirect:/admin/sales/claims/exchanges/${CLAIM_ID}`);
  expect(mocks.note).not.toHaveBeenCalled();
});
