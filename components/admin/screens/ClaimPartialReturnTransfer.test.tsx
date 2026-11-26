import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TOSS_REFUND_BANKS } from '@/lib/payments/toss-bank-codes';
import {
  ClaimPartialReturnTransfer, PARTIAL_RETURN_TRANSFER_REASON_MAX, PARTIAL_RETURN_TRANSFER_REASON_MIN,
  partialReturnTransferConfirmRequest, partialReturnTransferReady,
} from './ClaimPartialReturnTransfer';

vi.mock('@/app/admin/claim-actions', () => ({ convertPartialReturnToTransferAction: vi.fn() }));

/*
 * 결제사가 부분 취소를 받지 않아 닫힌 부분 반품을 계좌 송금으로 바꾸는 양식(화면 규칙 PR 3 · D-38·D-36).
 * '확인했습니다' 체크는 없고(서버 액션도 그 값을 받지 않는다), 은행은 목록에서 고르며, 되돌릴 수 없는 전환은 확인창이 말한다.
 */
const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const open = () => renderToStaticMarkup(<ClaimPartialReturnTransfer claimId={CLAIM_ID} defaultOpen refundAmount={20000} />);

describe('부분 반품 계좌 송금 전환 양식', () => {
  it('처음에는 전환 버튼만 보이고, 환불 기한을 말한다', () => {
    const html = renderToStaticMarkup(<ClaimPartialReturnTransfer claimId={CLAIM_ID} refundAmount={20000} />);
    expect(html).toContain('data-partial-return-transfer-entry');
    expect(html).toContain('계좌 송금 부분 환불로 전환</button>');
    expect(html).toContain('환불 기한(입고 확인 뒤 3영업일)');
    expect(html).not.toContain('환급 기한');
    expect(html).not.toContain('<form');
  });

  it('확인 체크를 두지 않는다', () => {
    const html = open();
    expect(html).toContain('data-partial-return-transfer=""');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('name="confirmed"');
    expect(html).not.toContain('고객과 계좌 송금 환불을 확인했고');
  });

  it('은행은 손으로 적지 않고 환불 계좌 입력과 같은 목록에서 고른다', () => {
    const html = open();
    expect(html).not.toMatch(/<input[^>]*name="bankName"/);
    const select = html.match(/<select[^>]*name="bankName"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? '';
    expect(select).toContain('required');
    expect(select).toContain('>은행 선택</option>');
    expect(select.match(/<option /g)).toHaveLength(TOSS_REFUND_BANKS.length + 1);
    for (const bank of TOSS_REFUND_BANKS) expect(select).toContain(`value="${bank.name}"`);
  });

  it('사유는 필수이고 어디에 남는지 말하며, 입력 전에는 전환 버튼이 눌리지 않는다', () => {
    const html = open();
    expect(html).toMatch(/<label[^>]*>전환 사유 \(필수\)<\/label>/);
    expect(html).toContain(`${PARTIAL_RETURN_TRANSFER_REASON_MIN}~${PARTIAL_RETURN_TRANSFER_REASON_MAX}자. 고객에게는 보이지 않고 감사 기록에 남습니다.`);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit"[^>]*>계좌 송금으로 전환<\/button>|<button[^>]*type="submit"[^>]*disabled=""[^>]*>계좌 송금으로 전환<\/button>/);
    for (const name of ['은행', '계좌번호', '예금주']) expect(html).toMatch(new RegExp(`<label[^>]*>${name}</label>`));
  });

  it('전환 버튼은 사유 5~500자와 은행·계좌번호(숫자·하이픈 8~30자)·예금주가 모두 맞을 때만 눌린다', () => {
    const base = { reason: '고객 통화로 계좌 송금 동의', bankName: 'KB국민은행', accountNumber: '123-456-789012', accountHolder: '홍길동' };
    expect(partialReturnTransferReady(base)).toBe(true);
    expect(partialReturnTransferReady({ ...base, reason: '가'.repeat(PARTIAL_RETURN_TRANSFER_REASON_MIN - 1) })).toBe(false);
    expect(partialReturnTransferReady({ ...base, reason: '가'.repeat(PARTIAL_RETURN_TRANSFER_REASON_MIN) })).toBe(true);
    expect(partialReturnTransferReady({ ...base, reason: '가'.repeat(PARTIAL_RETURN_TRANSFER_REASON_MAX) })).toBe(true);
    expect(partialReturnTransferReady({ ...base, reason: '가'.repeat(PARTIAL_RETURN_TRANSFER_REASON_MAX + 1) })).toBe(false);
    expect(partialReturnTransferReady({ ...base, bankName: ' ' })).toBe(false);
    expect(partialReturnTransferReady({ ...base, accountNumber: '1234567' })).toBe(false);
    expect(partialReturnTransferReady({ ...base, accountNumber: '12345678' })).toBe(true);
    expect(partialReturnTransferReady({ ...base, accountNumber: '1234-5678-abcd' })).toBe(false);
    expect(partialReturnTransferReady({ ...base, accountHolder: '' })).toBe(false);
  });

  it('확인창은 금액·적은 계좌·결과를 말하고 되돌릴 수 없다고 알리며 돌아가기를 준다', () => {
    const request = partialReturnTransferConfirmRequest(20000, { bankName: ' KB국민은행 ', accountNumber: ' 123-456-789012 ', accountHolder: ' 홍길동 ' });
    expect(request).toMatchObject({ title: '계좌 송금 부분 환불로 바꿀까요?', confirmLabel: '계좌 송금으로 전환', cancelLabel: '돌아가기', destructive: true });
    for (const line of ['결제사 대신 고객 계좌로 20,000원을 송금하는 환불로 바꿉니다.', '은행: KB국민은행', '계좌번호: 123-456-789012', '예금주: 홍길동',
      '고른 상품의 재고를 지금 되돌리고 환불 송금 대기에 올립니다.', '되돌릴 수 없습니다.']) expect(request.message.split('\n')).toContain(line);
    expect(request.message).toContain('이후 일부 반품을 받지 않고');
    /* 계좌를 넘기지 않으면 금액과 결과만 말한다. */
    expect(partialReturnTransferConfirmRequest(20000).message).not.toContain('계좌번호:');
  });
});
