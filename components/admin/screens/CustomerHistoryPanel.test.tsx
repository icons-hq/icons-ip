import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerHistoryState } from '@/app/admin/customer-actions';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { CustomerHistoryPanel } from './CustomerHistoryPanel';
const mocks = vi.hoisted(() => ({ state: {} as CustomerHistoryState, dispatch: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useActionState: () => [mocks.state, mocks.dispatch, false], useId: () => 'customer-history-test' }));
vi.mock('@/app/admin/customer-actions', () => ({ loadCustomerHistoryAction: vi.fn() }));
type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
beforeEach(() => { mocks.state = {}; mocks.dispatch.mockClear(); });
describe('문의 안의 고객 이력', () => {
  it('페이지 이동 링크 대신 같은 화면에서 이력을 요청하는 버튼을 둔다', () => {
    const html = renderToStaticMarkup(<CustomerHistoryPanel userId="customer-a" />);
    expect(html).toContain('name="userId" value="customer-a"');
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*name="tab")(?=[^>]*value="orders")/);
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*name="tab")(?=[^>]*value="claims")/);
  });
  it('고객이 바뀌면 이전 고객의 지연 응답을 표시하지 않는다', () => {
    mocks.state = { history: { userId: 'customer-a', tab: 'orders', page: 1, pageSize: 20, total: 1, items: [{ id: 'order', title: '이전 고객의 비공개 이력', createdAt: '2026-09-01T00:00:00Z' }] } };
    expect(renderToStaticMarkup(<CustomerHistoryPanel userId="customer-b" />)).not.toContain('이전 고객의 비공개 이력');
    const current = renderToStaticMarkup(<CustomerHistoryPanel userId="customer-a" />);
    expect(current).toContain('이전 고객의 비공개 이력');
    /* 페이지 이동은 공용 ConsolePagination(버튼 모드)이다 — 링크 없이 같은 화면에서 이동한다. */
    expect(current).toContain('aria-label="고객 이력 페이지"'); expect(current).toContain('1–1 / 전체 1건 · 1 / 1 페이지');
    expect(current).toMatch(/<button aria-label="이전 페이지"[^>]*disabled=""[^>]*type="button"/);
  });
  it('페이지 이동도 탭과 같은 서버 액션에 고객·탭·페이지를 보낸다', () => {
    mocks.state = { history: { userId: 'customer-a', tab: 'claims', page: 2, pageSize: 20, total: 41, items: [] } };
    const pagination = all(CustomerHistoryPanel({ userId: 'customer-a' })).find(item => item.type === ConsolePagination) as unknown as
      ReactElement<{ page: number; pageSize: number; total: number; disabled?: boolean; onPageChange: (page: number) => void }>;
    expect(pagination.props).toMatchObject({ page: 2, pageSize: 20, total: 41, disabled: false });
    pagination.props.onPageChange(3);
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(Object.fromEntries(mocks.dispatch.mock.calls[0][0] as FormData)).toEqual({ userId: 'customer-a', tab: 'claims', page: '3' });
  });
});
