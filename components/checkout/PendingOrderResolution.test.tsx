import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PendingOrderResolution } from './PendingOrderResolution';

it('진행 중 주문 목록과 결제·취소 방법을 함께 안내한다', () => {
  const html = renderToStaticMarkup(<PendingOrderResolution />);
  expect(html).toContain('href="/orders"');
  expect(html).toContain('진행 중인 주문 확인');
  expect(html).toContain('결제를 이어가거나 해당 주문을 취소');
});
