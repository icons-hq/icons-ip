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

it('전부 취소된 상품의 배송 묶음은 원장 금액은 그대로 두고 취소·환불됨을 붙인다(QA2b minor 2)', () => {
  const good = transactionDisplay.shipping[0].components[0].goodId;
  const html = renderToStaticMarkup(<GoodsTransactionSummary display={transactionDisplay} names={{ [good]: '피규어' }} canceledGoodIds={new Set([good])} />);
  expect(html).toContain('전체 취소·환불됨'); expect(html).toContain('피규어 · 취소·환불됨 · 선결제');
  expect(renderToStaticMarkup(<GoodsTransactionSummary display={transactionDisplay} names={{ [good]: '피규어' }} />)).not.toContain('취소·환불됨');
});

/* MD-0037: 주문 상세 결제 정보는 네 줄의 이름만 바꾼다. 주문서·선물·정기구매의 기본 이름은 그대로여야 한다. */
it('기본 라벨(checkout)은 주문서의 이름을 그대로 쓴다', () => {
  for (const html of [
    renderToStaticMarkup(<GoodsTransactionSummary display={transactionDisplay} />),
    renderToStaticMarkup(<GoodsTransactionSummary display={transactionDisplay} labels="checkout" />),
  ]) {
    expect(html).toContain('<dt>상품 금액</dt>'); expect(html).toContain('<dt>쿠폰 할인</dt>'); expect(html).toContain('<dt>적립금 사용</dt>'); expect(html).toContain('<dt>온라인 결제금액</dt>');
    expect(html).not.toContain('총 상품 금액'); expect(html).not.toContain('쿠폰 할인 금액'); expect(html).not.toContain('보유 적립금 사용'); expect(html).not.toContain('총 결제 금액');
  }
});

it('order 라벨은 네 줄의 이름만 바꾸고 금액·그 밖의 줄은 같다', () => {
  const checkout = renderToStaticMarkup(<GoodsTransactionSummary display={transactionDisplay} />);
  const order = renderToStaticMarkup(<GoodsTransactionSummary display={transactionDisplay} labels="order" />);
  expect(order).toContain('<dt>총 상품 금액</dt>'); expect(order).toContain('<dt>쿠폰 할인 금액</dt>'); expect(order).toContain('<dt>보유 적립금 사용</dt>');
  expect(order).toContain('총 결제 금액</dt><dd>₩16,000'); expect(order).toContain('총 부담금액</dt><dd>₩19,000'); expect(order).toContain('복수구매 할인');
  expect(order).not.toContain('<dt>온라인 결제금액</dt>');
  /* 착불 안내 문장도 같은 합계 이름을 가리킨다 — 표의 행 이름과 문장이 어긋나지 않는다. */
  expect(order).toContain('착불 배송비는 총 결제 금액에 포함되지 않습니다.');
  /* 라벨 네 개(착불 안내 속 합계 이름 포함)를 되돌리면 두 표기가 글자 하나까지 같아야 한다 — 금액·순서는 라벨 프롭과 무관하다. */
  expect(order.replace('총 상품 금액', '상품 금액').replace('쿠폰 할인 금액', '쿠폰 할인').replace('보유 적립금 사용', '적립금 사용').replaceAll('총 결제 금액', '온라인 결제금액')).toBe(checkout);
});
