import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn(), capture: vi.fn(), restore: vi.fn(), discard: vi.fn(), recovery: null as unknown }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useId: () => ':size-test:',
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? initial() : initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/goods-size-chart-actions', () => ({ saveGoodsSizeChartAction: mocks.save, loadGoodsSizeChartAction: mocks.load, listGoodsSizeTemplatesAction: vi.fn(), saveGoodsSizeTemplateAction: vi.fn() }));
vi.mock('./useGoodsSizeRecovery', () => ({ useGoodsSizeRecovery: () => ({ recovery: mocks.recovery, invalidRecovery: false, unavailable: false, capture: mocks.capture, restore: mocks.restore, discard: mocks.discard }) }));
import { GoodSizeChartPanel } from './GoodSizeChartPanel';
import { GoodsSizeChartFields } from './GoodsSizeChartFields';
import type { GoodsSizeChart } from '@/lib/goods-size-chart';
const chart: GoodsSizeChart = { unit: 'cm', sizes: ['단일'], measurements: [{ name: '둘레', values: ['42.7'] }], note: '' };
const values = { enabled: true, chart }, snapshot = { goodId: 'synthetic-size', goodName: '합성 상품', values, revision: 1, updatedAt: '2026-10-14T00:00:00Z' };
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean; value?: string; type?: string }>;
function all(node: ReactNode): Element[] {
  if (isValidElement<{ chart: GoodsSizeChart; onChange: (value: GoodsSizeChart) => void }>(node) && node.type === GoodsSizeChartFields) return all(GoodsSizeChartFields(node.props));
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : [];
}
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return GoodSizeChartPanel({ goodId: 'synthetic-size', accountId: 'operator-a' }); }
function button(label: string) { const item = all(render()).find(node => node.type === 'button' && text(node) === label); if (!item) throw new Error(label); return item; }
function submit() { all(render()).find(node => node.type === 'form')?.props.onSubmit?.({ preventDefault() {} }); }
function note(value: string) { all(render()).find(node => node.type === 'textarea')?.props.onChange?.({ target: { value } }); }
async function settle() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
async function mount() { render(); for (const effect of [...hooks.effects]) effect(); await settle(); }
beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; hooks.effects = []; mocks.recovery = null; mocks.load.mockResolvedValue({ ok: true, value: snapshot }); mocks.discard.mockImplementation(() => { mocks.recovery = null; }); });
it('keeps the same operation during unknown outcome and blocks double submission or a replacing read', async () => {
  await mount(); let finish!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ok: true, value: { ...snapshot, revision: 2 } });
  submit(); submit(); expect(mocks.save).toHaveBeenCalledOnce();
  finish({ ok: false, uncertain: true, error: '결과 불명' }); await settle();
  expect(all(render()).find(node => node.type === 'fieldset')?.props.disabled).toBe(true);
  const reads = mocks.load.mock.calls.length; button('최신 저장본 확인').props.onClick?.(); await settle(); expect(mocks.load).toHaveBeenCalledTimes(reads);
  mocks.load.mockResolvedValue({ ok: true, value: { ...snapshot, revision: 2 } });
  button('같은 요청 결과 확인').props.onClick?.(); await settle();
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]); expect(mocks.discard).toHaveBeenCalled();
});
it('keeps losing input for comparison and requires explicit adoption of the fresh revision', async () => {
  await mount(); note('작성 중 안내');
  mocks.save.mockResolvedValueOnce({ ok: false, conflict: true, error: '동시 수정' }); submit(); await settle();
  expect(all(render()).find(node => node.type === 'textarea')?.props.value).toBe('작성 중 안내');
  expect(button('사이즈 안내 저장').props.disabled).toBe(true);
  mocks.load.mockResolvedValue({ ok: true, value: { ...snapshot, revision: 2, values: { ...values, chart: { ...chart, note: '다른 담당자 안내' } } } });
  button('최신 저장본 확인').props.onClick?.(); await settle();
  expect(all(render()).find(node => node.type === 'textarea')?.props.value).toBe('작성 중 안내');
  button('최신 버전 기준으로 작성한 표 유지').props.onClick?.();
  mocks.save.mockResolvedValue({ ok: true, value: { ...snapshot, revision: 3, values: { ...values, chart: { ...chart, note: '작성 중 안내' } } } }); submit(); await settle();
  expect(mocks.save.mock.calls[1]).toEqual(['synthetic-size', { ...values, chart: { ...chart, note: '작성 중 안내' } }, 2, expect.any(String)]);
});
it('disables public display without clearing measurements', async () => {
  await mount(); all(render()).find(node => node.type === 'select' && node.props.value === 'enabled')?.props.onChange?.({ target: { value: 'disabled' } });
  mocks.save.mockResolvedValue({ ok: true, value: { ...snapshot, revision: 2, values: { enabled: false, chart } } }); submit(); await settle();
  expect(mocks.save.mock.calls[0][1]).toEqual({ enabled: false, chart });
  expect(text(render())).toContain('작성한 표는 보존했습니다.');
});
it('recovers a pending operation after remount and compares the current table after an old receipt', async () => {
  const oldRequest = { values, revision: 1, operationId: '99300000-0000-4000-8000-000000000001' };
  const draft = { baseRevision: 1, values, request: oldRequest }; mocks.recovery = draft;
  mocks.restore.mockImplementation(() => { mocks.recovery = null; return draft; });
  mocks.load.mockResolvedValue({ ok: true, value: { ...snapshot, revision: 4, values: { enabled: false, chart } } });
  mocks.save.mockResolvedValue({ ok: true, value: { ...snapshot, revision: 2 } });
  await mount(); submit(); expect(mocks.save).not.toHaveBeenCalled();
  button('이전 저장 요청 결과 확인').props.onClick?.(); await settle();
  expect(mocks.save).toHaveBeenCalledWith('synthetic-size', values, 1, oldRequest.operationId);
  expect(text(render())).toContain('이후 변경된 최신 저장본'); expect(button('사이즈 안내 저장').props.disabled).toBe(true);
});
it('does not enable empty editing on a failed read or accept a late initial read over newer work', async () => {
  let finish!: (value: unknown) => void;
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ok: true, value: { ...snapshot, revision: 3 } });
  render(); hooks.effects[0](); expect(button('사이즈 안내 저장').props.disabled).toBe(true);
  button('최신 저장본 확인').props.onClick?.(); await settle(); note('최신 표 편집');
  finish({ ok: true, value: snapshot }); await settle();
  mocks.save.mockResolvedValue({ ok: true, value: { ...snapshot, revision: 4, values: { ...values, chart: { ...chart, note: '최신 표 편집' } } } }); submit(); await settle();
  expect(mocks.save.mock.calls[0][2]).toBe(3);
  expect(mocks.save.mock.calls[0][1].chart.note).toBe('최신 표 편집');
});
