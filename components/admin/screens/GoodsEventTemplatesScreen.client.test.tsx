import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/goods-benefit-actions', () => ({ listGoodsEventTemplatesAction: mocks.list, saveGoodsEventTemplateAction: vi.fn() }));
import { GoodsEventTemplatesScreen } from './GoodsEventTemplatesScreen';
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault: () => void }) => void; value?: string }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return GoodsEventTemplatesScreen({}); }
async function settle() { for (let i = 0; i < 18; i++) await Promise.resolve(); }
const active = { id: '93800000-0000-4000-8000-000000000501', eventText: '사용 중 첫 목록', archived: false, revision: 1, createdAt: '2026-10-13T14:00:00Z' };
const archived = { ...active, id: '93800000-0000-4000-8000-000000000502', eventText: '보관된 최신 목록', archived: true };
const page = (row: typeof active) => ({ rows: [row], total: 1, page: 1, pageSize: 20 });
beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; hooks.effects = []; });
it('keeps archive filter and matching rows together when the initial active query finishes last', async () => {
  let initial!: (value: unknown) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { initial = resolve; })).mockResolvedValueOnce({ ok: true, value: page(archived) });
  render(); hooks.effects[0]();
  all(render()).find(item => item.type === 'select')?.props.onChange?.({ target: { value: 'archived' } }); await settle();
  expect(mocks.list.mock.calls).toEqual([['', false, 1], ['', true, 1]]);
  initial({ ok: true, value: page(active) }); await settle();
  const screen = render();
  expect(all(screen).find(item => item.type === 'select')?.props.value).toBe('archived');
  expect(text(screen)).toContain(archived.eventText);
  expect(text(screen)).not.toContain(active.eventText);
});
it.each(['response', 'exception'])('keeps a completed search after a late initial %s error', async kind => {
  let resolveInitial!: (value: unknown) => void, rejectInitial!: (reason: Error) => void;
  const selected = { ...active, eventText: '검색된 안내' };
  mocks.list.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveInitial = resolve; rejectInitial = reject; }))
    .mockResolvedValueOnce({ ok: true, value: page(selected) });
  render(); hooks.effects[0]();
  all(render()).find(item => item.type === 'input')?.props.onChange?.({ target: { value: '검색된' } });
  all(render()).find(item => item.type === 'form')?.props.onSubmit?.({ preventDefault: () => {} }); await settle();
  expect(mocks.list.mock.calls).toEqual([['', false, 1], ['검색된', false, 1]]);
  if (kind === 'exception') rejectInitial(new Error('late network error'));
  else resolveInitial({ ok: false, error: '늦은 조회 오류' });
  await settle();
  expect(text(render())).toContain(selected.eventText);
  expect(hooks.state[5]).toBe('');
});

it('returns to page one when another operator has archived every remaining row', async () => {
  mocks.list.mockResolvedValueOnce({ ok: true, value: { ...page(active), total: 21 } })
    .mockResolvedValueOnce({ ok: true, value: { rows: [], total: 0, page: 2, pageSize: 20 } })
    .mockResolvedValueOnce({ ok: true, value: { rows: [], total: 0, page: 1, pageSize: 20 } });
  render(); hooks.effects[0](); await settle();
  all(render()).find(item => item.type === 'button' && text(item) === '다음')?.props.onClick?.(); await settle();
  expect(mocks.list.mock.calls).toEqual([['', false, 1], ['', false, 2], ['', false, 1]]);
  expect(text(render())).toContain('1 / 1 페이지');
});
