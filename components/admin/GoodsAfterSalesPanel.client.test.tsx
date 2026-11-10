import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/goods-after-sales-actions', () => ({ saveGoodsAfterSalesAction: mocks.save, loadGoodsAfterSalesAction: mocks.load, listGoodsAfterSalesTemplatesAction: vi.fn(), saveGoodsAfterSalesTemplateAction: vi.fn() }));
vi.mock('@/lib/media', () => ({ publicMediaUrl: (path: string) => { if (!path) throw new Error('Empty paths must not reach the configured media normalizer'); return `https://cdn.example/${path}`; } }));
import { GoodsAfterSalesPanel } from './GoodsAfterSalesPanel';
import { GoodsAfterSalesFields } from './GoodsAfterSalesFields';
import type { GoodsAfterSalesValues } from '@/lib/goods-after-sales';
const values = { phone: '02-123', guide: 'A/S 안내', sellerSpecialNotes: '배송 기간' };
const snapshot = { ...values, goodId: 'good-1', goodName: '상품', revision: 1, updatedAt: '2026-10-13T14:00:00Z' };
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean; value?: string }>;
function all(node: ReactNode): Element[] { if (isValidElement<{ values: GoodsAfterSalesValues; onChange: (value: GoodsAfterSalesValues) => void }>(node) && node.type === GoodsAfterSalesFields) return all(GoodsAfterSalesFields(node.props)); return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return GoodsAfterSalesPanel({ goodId: 'good-1' }); }
function button(label: string) { const element = all(render()).find(item => item.type === 'button' && text(item) === label); if (!element) throw new Error(label); return element; }
function submit() { const form = all(render()).find(item => item.type === 'form'); if (!form) throw new Error('missing form'); form.props.onSubmit?.({ preventDefault: () => {} }); }
async function settle() { for (let i = 0; i < 18; i++) await Promise.resolve(); }
beforeEach(() => { vi.clearAllMocks(); hooks.state = [{ ...snapshot }, { ...values }]; hooks.refs = []; hooks.effects = []; });
it('keeps an unknown write on one fixed request and blocks same-render double submission', async () => {
  let finish!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ok: true, value: { ...snapshot, revision: 2 } });
  submit(); submit(); expect(mocks.save).toHaveBeenCalledOnce();
  finish({ ok: false, uncertain: true, error: '응답 불명' }); await settle();
  expect(all(render()).find(item => item.type === 'fieldset')?.props.disabled).toBe(true);
  button('저장된 내용으로 다시 불러오기').props.onClick?.(); await settle(); expect(mocks.load).not.toHaveBeenCalled();
  button('같은 요청 결과 확인').props.onClick?.(); await settle();
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]); expect(hooks.state[0]).toMatchObject({ revision: 2 });
});
it('preserves losing edits after a confirmed conflict and requires an explicit fresh read', async () => {
  mocks.save.mockResolvedValue({ ok: false, conflict: true, error: '동시 변경' });
  submit(); await settle(); expect(hooks.state[1]).toEqual(values); expect(button('안내 저장').props.disabled).toBe(true);
  submit(); await settle(); expect(mocks.save).toHaveBeenCalledOnce();
  mocks.load.mockResolvedValue({ ok: true, value: { ...snapshot, guide: '다른 담당자 저장', revision: 2 } });
  button('저장된 내용으로 다시 불러오기').props.onClick?.(); await settle();
  expect(hooks.state[1]).toMatchObject({ guide: '다른 담당자 저장' }); expect(button('안내 저장').props.disabled).toBe(false);
});
it('never turns an unread record into an editable empty form', () => {
  hooks.state = [null, { phone: '', guide: '', sellerSpecialNotes: '' }];
  expect(button('안내 저장').props.disabled).toBe(true); submit(); expect(mocks.save).not.toHaveBeenCalled();
});
it('keeps a later reload and save when the initial read resolves last', async () => {
  hooks.state = [];
  let initial!: (value: unknown) => void;
  const fresh = { ...snapshot, guide: '다시 조회한 안내', revision: 2 };
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { initial = resolve; })).mockResolvedValueOnce({ ok: true, value: fresh });
  mocks.save.mockResolvedValue({ ok: true, value: { ...fresh, guide: '새로 저장한 안내', revision: 3 } });
  render(); hooks.effects[0]();
  button('저장된 내용으로 다시 불러오기').props.onClick?.(); await settle();
  all(render()).find(item => item.type === 'textarea' && item.props.value === fresh.guide)?.props.onChange?.({ target: { value: '새로 저장한 안내' } });
  submit(); await settle();
  expect(mocks.save.mock.calls[0]).toEqual(['good-1', { ...values, guide: '새로 저장한 안내' }, 2, expect.any(String)]);
  initial({ ok: true, value: snapshot }); await settle();
  expect(hooks.state[0]).toMatchObject({ guide: '새로 저장한 안내', revision: 3 });
  expect(text(render())).toContain('A/S 안내와 판매자 특이사항을 저장했습니다.');
});
it.each(['response', 'exception'])('ignores a late initial read %s error after a successful reload', async kind => {
  hooks.state = [];
  let resolveInitial!: (value: unknown) => void, rejectInitial!: (reason: Error) => void;
  mocks.load.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveInitial = resolve; rejectInitial = reject; }))
    .mockResolvedValueOnce({ ok: true, value: { ...snapshot, guide: '최신 안내', revision: 2 } });
  render(); hooks.effects[0]();
  button('저장된 내용으로 다시 불러오기').props.onClick?.(); await settle();
  if (kind === 'exception') rejectInitial(new Error('late network error'));
  else resolveInitial({ ok: false, error: '늦은 조회 오류' });
  await settle();
  expect(hooks.state[0]).toMatchObject({ guide: '최신 안내', revision: 2 });
  expect(text(render())).toContain('저장된 내용으로 다시 불러왔습니다.');
  expect(hooks.state[5]).toBe(false);
});

it('retries an uncertain clear using its fixed empty request even when the former draft was incomplete', async () => {
  hooks.state[1] = { phone: '수정 중', guide: '', sellerSpecialNotes: '미완성' };
  mocks.save.mockResolvedValueOnce({ ok: false, uncertain: true, error: '결과 불명' }).mockResolvedValueOnce({ ok: true, value: { ...snapshot, phone: '', guide: '', sellerSpecialNotes: '', revision: 2 } });
  button('안내 해제').props.onClick?.(); await settle();
  button('같은 요청 결과 확인').props.onClick?.(); await settle();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save.mock.calls[0]).toEqual(['good-1', { phone: '', guide: '', sellerSpecialNotes: '' }, 1, expect.any(String)]);
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
  expect(text(render())).toContain('상품 상세의 A/S 안내와 판매자 특이사항을 해제했습니다.');
});
