import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminShoppingStoryList } from '@/lib/admin/shopping-stories';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ remove: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useTransition: () => [false, (callback: () => void) => callback()],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/shopping-story-actions', () => ({ deleteShoppingStoriesAction: mocks.remove }));
vi.mock('../marketing/MarketingLinkIssuer', () => ({ MarketingLinkIssuer: () => null }));
import { ShoppingStoriesAdminScreen } from './ShoppingStoriesScreen';
import { CustomerServiceDialog } from './CustomerServiceDialog';

const data: AdminShoppingStoryList = {
  checkedAt: '2026-10-20T00:00:00Z', total: 2,
  filters: { query: '', state: 'all', from: '', to: '', page: 1, pageSize: 20, sort: 'created_desc' },
  rows: ['A', 'B'].map((title, index) => ({ id: `94700000-0000-4000-8000-00000000010${index + 1}`, reference: index + 1, title,
    startsAt: null, endsAt: null, state: 'active', revision: index + 1, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', sectionCount: 0, goodCount: 0 })),
};
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onClose?: () => void; onChange?: (event: { target: { checked: boolean } }) => void; disabled?: boolean; busy?: boolean; 'aria-label'?: string }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; return ShoppingStoriesAdminScreen({ data }); }
function button(label: string) { const node = all(render()).find(item => item.type === 'button' && text(item).trim() === label); if (!node) throw new Error(label); return node; }
function dialog() { return all(render()).find(item => item.type === CustomerServiceDialog); }
function selectAAndDeleteB() {
  all(render()).find(item => item.type === 'input' && item.props['aria-label'] === 'A 선택')?.props.onChange?.({ target: { checked: true } });
  const row = all(render()).find(item => item.type === 'tr' && text(item).includes('B'));
  all(row).find(item => item.type === 'button' && text(item) === '삭제')?.props.onClick?.();
  button('스토리 1개 삭제').props.onClick?.();
}
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
beforeEach(() => { vi.resetAllMocks(); hooks.state = []; hooks.refs = []; });

it('keeps the original deletion target visible and locks a different selection until an uncertain result is resolved', async () => {
  mocks.remove.mockResolvedValueOnce({ ok: false, retrySameOperation: true, error: '응답 불명' }).mockResolvedValueOnce({ ok: true });
  selectAAndDeleteB(); await settle();
  expect(dialog()?.props.busy).toBe(true);
  expect(button('취소').props.disabled).toBe(true);
  expect(button('선택삭제 (1)').props.disabled).toBe(true);
  expect(all(dialog()).filter(item => item.type === 'li').map(item => text(item))).toEqual(['B']);
  button('같은 요청으로 삭제 결과 확인').props.onClick?.(); await settle();
  expect(mocks.remove.mock.calls[1]).toEqual(mocks.remove.mock.calls[0]);
  expect(mocks.remove.mock.calls[1][1]).toEqual([{ id: data.rows[1].id, revision: 2 }]);
  expect(dialog()).toBeUndefined(); expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('treats a rejected transport as an uncertain outcome and retries the same operation', async () => {
  mocks.remove.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({ ok: true });
  selectAAndDeleteB(); await settle();
  expect(dialog()?.props.busy).toBe(true);
  expect(text(dialog())).toContain('삭제 결과를 확인하지 못했습니다.');
  button('같은 요청으로 삭제 결과 확인').props.onClick?.(); await settle();
  expect(mocks.remove.mock.calls[1]).toEqual(mocks.remove.mock.calls[0]);
});

it('starts a deletion only once before React commits the pending state', async () => {
  let finish!: (value: unknown) => void;
  mocks.remove.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  selectAAndDeleteB(); button('스토리 1개 삭제').props.onClick?.();
  expect(mocks.remove).toHaveBeenCalledOnce();
  finish({ ok: true }); await settle();
});
