import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSellerClaimContextAction, readSellerClaimIntakeAction, submitSellerClaimIntakeAction } from './seller-claim-intake-actions';
import { SELLER_CLAIM_TEST_ORDER, SELLER_CLAIM_TEST_REQUEST, sellerClaimContextFixture, sellerClaimInputFixture, sellerClaimReceiptFixture } from '@/lib/admin/seller-claim-intake.fixture';
const mocks = vi.hoisted(() => ({ allowed: true, rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: async () => mocks.allowed }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
beforeEach(() => { mocks.allowed = true; mocks.rpc.mockReset(); mocks.revalidate.mockReset(); });
describe('판매자 직접 접수 액션', () => {
  it('대리 취소 요청을 별도 조회로 확인하고 취소 관리 목록을 갱신한다', async () => {
    const input = { ...sellerClaimInputFixture, claimType: 'cancel', collectionAddress: null, collections: [] };
    const receipt = { ...sellerClaimReceiptFixture, claimType: 'cancel', collectionAddress: null, collections: [] };
    mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ data: receipt, error: null });
    expect(await submitSellerClaimIntakeAction(input)).toEqual({ receipt });
    expect(mocks.rpc.mock.calls[0][1].p_payload).toMatchObject({ claimType: 'cancel', collectionAddress: null, collections: [] });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/claims/cancels');
    mocks.rpc.mockResolvedValueOnce({ error: { code: '23514', message: 'not_cancelable' } });
    expect(await submitSellerClaimIntakeAction(input)).toMatchObject({ uncertain: false, error: expect.stringContaining('발주확인') });
  });
  it('현재 자격과 출고지를 읽고 저장 이후 별도 결과 조회를 사용한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: sellerClaimContextFixture, error: null });
    expect(await loadSellerClaimContextAction(SELLER_CLAIM_TEST_ORDER)).toEqual({ context: sellerClaimContextFixture });
    mocks.rpc.mockResolvedValueOnce({ data: { ignored: 'submission acknowledgement' }, error: null }).mockResolvedValueOnce({ data: sellerClaimReceiptFixture, error: null });
    expect(await submitSellerClaimIntakeAction(sellerClaimInputFixture)).toEqual({ receipt: sellerClaimReceiptFixture });
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['admin_seller_claim_intake_context','admin_submit_seller_claim_intake','admin_read_seller_claim_intake']);
    expect(mocks.rpc.mock.calls[1][1].p_payload.customerRequestedAt).toBe('2026-10-12T23:30:00.000Z');
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/claims/returns');
  });
  it('접수 응답 유실과 읽기 실패를 입력 오류와 구분한다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await submitSellerClaimIntakeAction(sellerClaimInputFixture)).toMatchObject({ uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'not_claimable', code: '23514' } });
    expect(await submitSellerClaimIntakeAction(sellerClaimInputFixture)).toMatchObject({ uncertain: false, error: expect.stringContaining('실제 발송된 배송 중 주문') });
    mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ data: null, error: { message: 'read failed' } });
    expect(await submitSellerClaimIntakeAction(sellerClaimInputFixture)).toMatchObject({ uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ data: sellerClaimReceiptFixture, error: null });
    expect(await readSellerClaimIntakeAction(sellerClaimInputFixture)).toEqual({ receipt: sellerClaimReceiptFixture });
  });
  it('권한·부분 금액·고객 동의는 RPC 실행 전에 검증한다', async () => {
    expect(await submitSellerClaimIntakeAction({ ...sellerClaimInputFixture, amount: 1 })).toHaveProperty('error');
    expect(await submitSellerClaimIntakeAction({ ...sellerClaimInputFixture, agreementConfirmed: false })).toHaveProperty('error');
    mocks.allowed = false;
    expect(await loadSellerClaimContextAction(SELLER_CLAIM_TEST_ORDER)).toHaveProperty('error');
    expect(await readSellerClaimIntakeAction(sellerClaimInputFixture)).toHaveProperty('error');
    expect(await submitSellerClaimIntakeAction(sellerClaimInputFixture)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('잘못된 조회 식별자는 결과 확인 완료로 표시하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ data: { ...sellerClaimReceiptFixture, orderId: SELLER_CLAIM_TEST_REQUEST }, error: null });
    expect(await submitSellerClaimIntakeAction(sellerClaimInputFixture)).toMatchObject({ uncertain: true });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('재조회는 원본 전체 입력과 환불계좌를 결속하는 읽기 RPC만 호출한다', async () => {
    const input = { ...sellerClaimInputFixture, refundAccount: { bankName: '합성은행', accountNumber: '000000001234', accountHolder: '합성 고객' } };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await readSellerClaimIntakeAction(input)).toEqual({ receipt: null });
    const { requestId, refundAccount, ...payload } = input;
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_read_seller_claim_intake', {
      p_request_id: requestId, p_payload: { ...payload, customerRequestedAt: '2026-10-12T23:30:00.000Z' }, p_refund_account: refundAccount,
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('본문 대조가 실패한 조회나 달라진 결과는 성공으로 표시하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'seller_claim_request_conflict' } });
    expect(await readSellerClaimIntakeAction(sellerClaimInputFixture)).toHaveProperty('error');
    mocks.rpc.mockResolvedValueOnce({ data: { ...sellerClaimReceiptFixture, agreementEvidence: '다른 고객 합의' }, error: null });
    expect(await readSellerClaimIntakeAction(sellerClaimInputFixture)).toHaveProperty('error');
    expect(await readSellerClaimIntakeAction(SELLER_CLAIM_TEST_REQUEST)).toHaveProperty('error');
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
