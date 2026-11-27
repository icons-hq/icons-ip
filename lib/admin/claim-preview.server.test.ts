import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminClaimWorkspace } from './claim-preview.server';

/*
 * 상세 화면 한 벌의 로더(독립 상세 라우트와 목록 위 팝업이 같이 쓴다). 화면 규칙 PR 3(C3): 반품·교환 승인 확인창이
 * '택배사에 회수가 접수됩니다'를 말할지는 자동 회수 접수 스위치가 정한다 — 그 값을 목록이 읽는 조회와 같은 곳에서 읽어 내린다.
 */
const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mocks = vi.hoisted(() => ({
  detail: vi.fn(), carriers: vi.fn(), defective: vi.fn(), partial: vi.fn(), policy: vi.fn(), operations: vi.fn(), business: vi.fn(),
}));
vi.mock('@/lib/admin/claims.server', () => ({ loadAdminClaimDetail: mocks.detail }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: mocks.carriers }));
vi.mock('@/lib/admin/defective-stock.server', () => ({ loadClaimDefectiveStock: mocks.defective }));
vi.mock('@/lib/orders/partial-return.server', () => ({ loadAdminClaimPartialReturn: mocks.partial, loadPartialReturnPolicy: mocks.policy }));
vi.mock('@/lib/admin/claim-return-operations.server', () => ({ loadClaimReturnOperations: mocks.operations }));
vi.mock('@/lib/legal/business-info.server', () => ({ getBusinessInfo: mocks.business }));

const on = { pickup: { enabled: true, failed: 0, pending: 0, items: [] }, intake: { enabled: false } };
const off = { pickup: { enabled: false }, intake: { enabled: false } };
const detailOf = (claimType: 'cancel' | 'return' | 'exchange') => ({ claim: { claimType }, order: null, payment: null });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.carriers.mockResolvedValue([]);
  mocks.defective.mockResolvedValue([]);
  mocks.partial.mockResolvedValue(null);
  mocks.policy.mockResolvedValue({ enabled: false });
  mocks.operations.mockResolvedValue(off);
});

describe('클레임 상세 로더의 자동 회수 접수 스위치', () => {
  it.each(['return', 'exchange'] as const)('%s는 스위치 값을 autoPickupOnApproval로 내린다', async (claimType) => {
    mocks.detail.mockResolvedValue(detailOf(claimType));
    mocks.operations.mockResolvedValue(on);
    expect((await loadAdminClaimWorkspace(CLAIM_ID))?.autoPickupOnApproval).toBe(true);
    mocks.operations.mockResolvedValue(off);
    expect((await loadAdminClaimWorkspace(CLAIM_ID))?.autoPickupOnApproval).toBe(false);
  });

  it('회수가 없는 취소는 스위치를 읽지 않고 꺼진 것으로 내린다', async () => {
    mocks.detail.mockResolvedValue(detailOf('cancel'));
    mocks.operations.mockResolvedValue(on);
    expect((await loadAdminClaimWorkspace(CLAIM_ID))?.autoPickupOnApproval).toBe(false);
    expect(mocks.operations).not.toHaveBeenCalled();
  });

  it('스위치를 읽지 못해도 상세는 열고 꺼진 것으로 본다(목록과 같다)', async () => {
    mocks.detail.mockResolvedValue(detailOf('return'));
    mocks.operations.mockRejectedValue(new Error('rpc down'));
    const workspace = await loadAdminClaimWorkspace(CLAIM_ID);
    expect(workspace?.autoPickupOnApproval).toBe(false);
    expect(workspace?.detail.claim.claimType).toBe('return');
  });

  it('없는 요청은 null이고 스위치도 읽지 않는다', async () => {
    mocks.detail.mockResolvedValue(null);
    expect(await loadAdminClaimWorkspace(CLAIM_ID)).toBeNull();
    expect(mocks.operations).not.toHaveBeenCalled();
  });
});
