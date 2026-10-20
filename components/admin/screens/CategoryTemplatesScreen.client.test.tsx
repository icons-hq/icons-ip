import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/category-template-actions', () => ({ listCategoryTemplatesAction: mocks.list, saveCategoryTemplatesAction: mocks.save }));
import { CategoryTemplatesScreen } from './CategoryTemplatesScreen';
const id = '94700000-0000-4000-8000-000000000101';
const row = { categoryId: id, code: 'stationery', name: '문구', path: ['문구'], usable: true, archived: false, revision: 1, createdAt: '2026-10-14T00:00:00Z' };
const page = { rows: [row], total: 1, page: 1, pageSize: 20 };
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { checked?: boolean; value?: string } }) => void; disabled?: boolean; value?: string; type?: string; 'aria-label'?: string }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return CategoryTemplatesScreen({}); }
function button(label: string) { const node = all(render()).find(item => item.type === 'button' && text(item) === label); if (!node) throw new Error(label); return node; }
function choose() { all(render()).find(item => item.type === 'input' && item.props['aria-label'] === '문구 선택')?.props.onChange?.({ target: { checked: true } }); }
async function settle() { for (let i = 0; i < 18; i++) await Promise.resolve(); }
beforeEach(() => { vi.clearAllMocks(); hooks.state = [page]; hooks.refs = []; hooks.effects = []; mocks.list.mockResolvedValue({ ok: true, value: page }); });
it('preserves uncertain selections and retries the identical operation without double submission', async () => {
  let finish!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ok: true, value: [{ ...row, revision: 2, archived: true }] });
  choose(); button('선택 보관 1개').props.onClick?.(); button('선택 보관 1개').props.onClick?.(); expect(mocks.save).toHaveBeenCalledOnce();
  finish({ ok: false, uncertain: true, error: '응답 불명' }); await settle();
  expect(button('선택 보관 1개').props.disabled).toBe(true);
  expect(all(render()).filter(item => item.type === 'input' && item.props.type === 'checkbox').every(item => item.props.disabled)).toBe(true);
  button('같은 요청 결과 확인').props.onClick?.(); await settle();
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]); expect(hooks.state[4]).toEqual([]);
});
it('keeps selection after a confirmed conflict until an explicit fresh read', async () => {
  mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '다른 변경' });
  choose(); button('선택 보관 1개').props.onClick?.(); await settle();
  expect(hooks.state[4]).toEqual([id]); expect(button('선택 보관 1개').props.disabled).toBe(true);
  button('최신 목록 다시 조회').props.onClick?.(); await settle(); expect(hooks.state[4]).toEqual([]);
});
it('ignores an initial response that arrives after a newer archived-list search', async () => {
  hooks.state = []; let initial!: (value: unknown) => void;
  const archived = { ...page, rows: [{ ...row, archived: true, revision: 2 }] };
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { initial = resolve; })).mockResolvedValueOnce({ ok: true, value: archived });
  render(); hooks.effects[0]();
  all(render()).find(item => item.type === 'select')?.props.onChange?.({ target: { value: 'archived' } }); await settle();
  initial({ ok: true, value: page }); await settle();
  expect(hooks.state[0]).toEqual(archived); expect(hooks.state[3]).toBe(true);
});
