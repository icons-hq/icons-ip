import { describe, expect, it } from 'vitest';
import { parseSellerClaimContext, parseSellerClaimInput, parseSellerClaimReceipt, sellerClaimReceiptMatchesInput } from './seller-claim-intake';
import { sellerClaimContextFixture, sellerClaimInputFixture, sellerClaimReceiptFixture } from './seller-claim-intake.fixture';

describe('판매자 취소·반품·교환 접수 계약', () => {
  it('고객 요청 KST 시각과 수거 연락처를 정규화하며 주문 전체 요청만 받는다', () => {
    const result = parseSellerClaimInput({ ...sellerClaimInputFixture, collectionAddress: { ...sellerClaimInputFixture.collectionAddress, phone: '010-0000-0000' } });
    expect(result).toMatchObject({ ok: true, payload: { customerRequestedAt: '2026-10-12T23:30:00.000Z', collectionAddress: { phone: '01000000000' } } });
    for (const extra of [{ amount: 100 }, { items: ['item'] }, { qty: 1 }, { claimType: 'cancel' }, { agreementConfirmed: false }]) {
      expect(parseSellerClaimInput({ ...sellerClaimInputFixture, ...extra })).toMatchObject({ ok: false });
    }
  });
  it('취소는 고객 합의와 주문 전체 요청만 받고 수거 정보와 부분 처리 입력을 거부한다', () => {
    const cancellation = { ...sellerClaimInputFixture, claimType: 'cancel', reasonType: 'change_of_mind', collectionAddress: null, collections: [] };
    expect(parseSellerClaimInput(cancellation)).toMatchObject({ ok: true, payload: { claimType: 'cancel', reasonType: 'change_of_mind', collectionAddress: null, collections: [] } });
    /* R7: 하자·오배송은 받은 뒤의 일이라 취소가 아니라 반품·교환으로 접수한다. */
    expect(parseSellerClaimInput({ ...cancellation, reasonType: 'defect' })).toEqual({
      ok: false, error: '취소 접수 사유는 단순 변심만 선택할 수 있습니다. 상품 하자·오배송은 반품·교환으로 접수해주세요.',
    });
    expect(parseSellerClaimInput({ ...sellerClaimInputFixture, reasonType: 'defect' })).toMatchObject({ ok: true });
    for (const extra of [{ amount: 100 }, { items: ['item'] }, { qty: 1 }, { collectionAddress: sellerClaimInputFixture.collectionAddress }, { agreementConfirmed: false }]) {
      expect(parseSellerClaimInput({ ...cancellation, ...extra })).toMatchObject({ ok: false });
    }
    expect(parseSellerClaimReceipt({ ...sellerClaimReceiptFixture, claimType: 'cancel', collectionAddress: null, collections: [] })).toMatchObject({ claimType: 'cancel' });
    expect(parseSellerClaimReceipt({ ...sellerClaimReceiptFixture, claimType: 'cancel' })).toBeNull();
  });
  it('존재하지 않는 달력 날짜와 불완전한 수거 정보·문의 근거를 거부한다', () => {
    for (const customerRequestedAt of ['2026-02-30T08:00', '2026-13-01T10:00', '2026-10-13', '2026-10-13T08:30Z']) expect(parseSellerClaimInput({ ...sellerClaimInputFixture, customerRequestedAt })).toMatchObject({ ok: false });
    expect(parseSellerClaimInput({ ...sellerClaimInputFixture, source: 'inquiry', inquiryId: null })).toMatchObject({ ok: false });
    expect(parseSellerClaimInput({ ...sellerClaimInputFixture, collectionAddress: { ...sellerClaimInputFixture.collectionAddress, postalCode: '' } })).toMatchObject({ ok: false });
    expect(parseSellerClaimInput({ ...sellerClaimInputFixture, collections: [sellerClaimInputFixture.collections[0], sellerClaimInputFixture.collections[0]] })).toMatchObject({ ok: false });
  });
  it('구매자 발송은 운송장을, 판매자 수거 예정은 구체적 메모를 요구한다', () => {
    const collection = sellerClaimInputFixture.collections[0];
    expect(parseSellerClaimInput({ ...sellerClaimInputFixture, collections: [{ ...collection, method: 'customer_sent' }] })).toMatchObject({ ok: false });
    expect(parseSellerClaimInput({ ...sellerClaimInputFixture, collections: [{ ...collection, method: 'seller_arranged', note: '' }] })).toMatchObject({ ok: false });
    expect(parseSellerClaimInput({ ...sellerClaimInputFixture, collections: [{ ...collection, method: 'customer_sent', carrier: 'hanjin', trackingNumber: 'abc-12345' }] })).toMatchObject({ ok: true, payload: { collections: [{ trackingNumber: 'ABC12345' }] } });
  });
  it('반품 계좌는 완전한 한 세트만 받고 교환에는 저장하지 않는다', () => {
    const account = { bankName: '합성은행', accountNumber: '000000001234', accountHolder: '합성 고객' };
    expect(parseSellerClaimInput({ ...sellerClaimInputFixture, refundAccount: account })).toMatchObject({ ok: true, refundAccount: account });
    expect(parseSellerClaimInput({ ...sellerClaimInputFixture, claimType: 'exchange', refundAccount: account })).toMatchObject({ ok: false });
    expect(parseSellerClaimInput({ ...sellerClaimInputFixture, refundAccount: { ...account, accountHolder: '' } })).toMatchObject({ ok: false });
  });
  it('상세 결과는 접수 식별자·현재 단계·전체 수거 스냅샷을 검증한다', () => {
    expect(parseSellerClaimContext(sellerClaimContextFixture)).toEqual(sellerClaimContextFixture);
    expect(parseSellerClaimReceipt(sellerClaimReceiptFixture)).toEqual(sellerClaimReceiptFixture);
    expect(parseSellerClaimReceipt({ ...sellerClaimReceiptFixture, claimId: sellerClaimContextFixture.orderId })).toBeNull();
    expect(parseSellerClaimReceipt({ ...sellerClaimReceiptFixture, collections: [] })).toBeNull();
    expect(parseSellerClaimContext({ ...sellerClaimContextFixture, carriers: [{ code: 'bad', label: '택배' }] })).toBeNull();
  });
  it('결과의 요청·유형·합의·수거 정보를 처음 전송한 입력과 대조한다', () => {
    expect(sellerClaimReceiptMatchesInput(sellerClaimReceiptFixture, sellerClaimInputFixture)).toBe(true);
    for (const changed of [
      { requestId: sellerClaimContextFixture.orderId }, { claimType: 'exchange' as const }, { source: 'email' as const },
      { inquiryId: sellerClaimContextFixture.inquiries[0].id }, { customerRequestedAt: '2026-10-12T23:31:00Z' },
      { agreementEvidence: '다른 근거' }, { collectionAddress: { ...sellerClaimContextFixture.address, phone: '01011111111' } },
      { collections: [{ ...sellerClaimReceiptFixture.collections[0], note: '다른 수거 메모' }] },
    ]) expect(sellerClaimReceiptMatchesInput({ ...sellerClaimReceiptFixture, ...changed }, sellerClaimInputFixture)).toBe(false);
    expect(sellerClaimReceiptMatchesInput(sellerClaimReceiptFixture, { ...sellerClaimInputFixture, reason: '' })).toBe(false);
  });
});
