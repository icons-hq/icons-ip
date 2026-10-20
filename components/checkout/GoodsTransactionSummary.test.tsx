import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { transactionDisplay } from '@/test/fixtures/cart-transaction';
import { GoodsTransactionSummary } from './GoodsTransactionSummary';
it('복수 할인·쿠폰·적립금과 온라인16,000/착불3,000/총부담19,000을 구분한다', () => {
  const html = renderToStaticMarkup(<GoodsTransactionSummary display={transactionDisplay} names={{ 'transaction-good': '피규어' }} />);
  expect(html).toContain('복수구매 할인'); expect(html).toContain('−₩2,000'); expect(html).toContain('쿠폰 할인'); expect(html).toContain('적립금 사용');
  expect(html).toContain('온라인 결제금액</dt><dd>₩16,000'); expect(html).toContain('수령 시 별도</dt><dd>₩3,000'); expect(html).toContain('총 부담금액</dt><dd>₩19,000');
  expect(html).toContain('착불 배송비는 온라인 결제금액에 포함되지 않습니다.'); expect(html).toContain('수납 주체: 배송사'); expect(html).toContain('착불 배송비 환불 문의: 판매자 문의');
});
