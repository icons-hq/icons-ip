import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerHistoryState } from '@/app/admin/customer-actions';
import { CustomerHistoryPanel } from './CustomerHistoryPanel';
const mocks = vi.hoisted(() => ({ state: {} as CustomerHistoryState }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useActionState: () => [mocks.state, vi.fn(), false] }));
vi.mock('@/app/admin/customer-actions', () => ({ loadCustomerHistoryAction: vi.fn() }));
beforeEach(() => { mocks.state = {}; });
describe('문의 안의 고객 이력', () => {
  it('페이지 이동 링크 대신 같은 화면에서 이력을 요청하는 버튼을 둔다', () => {
    const html = renderToStaticMarkup(<CustomerHistoryPanel userId="customer-a" />);
    expect(html).toContain('name="userId" value="customer-a"');
    expect(html).toMatch(/<button(?=[^>]*name="tab")(?=[^>]*value="orders")/);
    expect(html).toMatch(/<button(?=[^>]*name="tab")(?=[^>]*value="claims")/);
  });
  it('고객이 바뀌면 이전 고객의 지연 응답을 표시하지 않는다', () => {
    mocks.state = { history: { userId: 'customer-a', tab: 'orders', page: 1, pageSize: 20, total: 1, items: [{ id: 'order', title: '이전 고객의 비공개 이력', createdAt: '2026-09-01T00:00:00Z' }] } };
    expect(renderToStaticMarkup(<CustomerHistoryPanel userId="customer-b" />)).not.toContain('이전 고객의 비공개 이력');
    expect(renderToStaticMarkup(<CustomerHistoryPanel userId="customer-a" />)).toContain('이전 고객의 비공개 이력');
  });
});
