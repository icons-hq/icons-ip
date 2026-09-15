import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkQueueSection } from './WorkQueue';
import type { AdminWorkQueueData } from '@/lib/admin/work-queue';
const data: AdminWorkQueueData = { checkedAt: '2026-09-15T03:00:00Z', counts: {
  orders: { state: 'ready', count: 2 }, ready: { state: 'ready', count: 3 }, delayed: { state: 'error', count: null },
  inquiries: { state: 'ready', count: 0 }, goods: { state: 'ready', count: 23 },
}, goodsReasons: [{ code: 'kc_required', count: 22, href: '/admin/catalog/goods?readiness=kc_required' }] };
it('renders exact counts with separate units, matching links, known zero and failure text', () => {
  const html = renderToStaticMarkup(<WorkQueueSection data={data} />);
  expect(html).toContain('지금 처리할 업무'); expect(html).toContain('2건'); expect(html).toContain('3건'); expect(html).toContain('0건');
  expect(html).toContain('주문 수'); expect(html).toContain('배송 건 수'); expect(html).toContain('23건');
  expect(html).toContain('집계를 불러오지 못했습니다'); expect(html).toContain('확인 필요');
  expect(html).toContain('tab=delayed'); expect(html).toContain('status=paid'); expect(html).toContain('readiness=review_required');
  expect(html).toContain('중복 없는 상품 수'); expect(html).toContain('KST');
});
describe('unavailable work queue', () => {
  it('does not render a guessed empty queue', () => {
    const html = renderToStaticMarkup(<WorkQueueSection />);
    expect(html).not.toContain('0건'); expect(html).toContain('확인 필요');
  });
});
