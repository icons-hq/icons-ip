import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ start: vi.fn(), advance: vi.fn(), read: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {},
  useRef: (initial: unknown) => { const i = hooks.refIndex++; hooks.refs[i] ??= { current: initial }; return hooks.refs[i]; },
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.state)) hooks.state[i] = initial; return [hooks.state[i], (next: unknown) => { hooks.state[i] = typeof next === 'function' ? next(hooks.state[i]) : next; }]; },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/pg-settlement-actions', () => ({ startPgSettlementImportAction: mocks.start, advancePgSettlementImportAction: mocks.advance, readPgSettlementImportAction: mocks.read }));
import { PgSettlementImportControl } from './PgSettlementImportControl';
import { SETTLEMENT_FIXTURE_JOB as job } from '@/lib/settlements/fixture';
const query = { mode: job.mode, dateType: job.dateType, startDate: job.startDate, endDate: job.endDate };
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render(enabled = true) { hooks.index = 0; hooks.refIndex = 0; return PgSettlementImportControl({ query, enabled, connectedMode: 'test', operationId: job.operationId, initialJob: null }); }
function button(label: string) { const element = all(render()).find(item => item.type === 'button' && text(item) === label); if (!element) throw new Error(label); return element; }
async function settle() { for (let i = 0; i < 18; i++) await Promise.resolve(); }
beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; });
it('keeps an unknown creation on the original operation and blocks same-render double submissions', async () => {
  let finish!: (result: unknown) => void;
  mocks.start.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ok: false, uncertain: true, error: 'lost' });
  const submit = button('자료 가져오기'); submit.props.onClick?.(); submit.props.onClick?.(); expect(mocks.start).toHaveBeenCalledOnce();
  finish({ ok: false, uncertain: true, error: 'lost' }); await settle();
  button('같은 수집 요청 확인').props.onClick?.(); await settle();
  expect(mocks.start.mock.calls[1]).toEqual(mocks.start.mock.calls[0]); expect(mocks.advance).not.toHaveBeenCalled();
});
it('stops after a busy read and resumes by checking the existing import', async () => {
  mocks.start.mockResolvedValue({ ok: true, kind: 'created', job }); mocks.advance.mockResolvedValue({ ok: true, kind: 'busy', job });
  button('자료 가져오기').props.onClick?.(); await settle(); expect(mocks.advance).toHaveBeenCalledOnce();
  mocks.read.mockResolvedValue({ ok: true, kind: 'paused', job }); button('현재 상태 확인').props.onClick?.(); await settle();
  expect(mocks.read).toHaveBeenCalledWith(job.id); expect(mocks.start).toHaveBeenCalledOnce(); expect(mocks.advance).toHaveBeenCalledOnce();
});
it('offers a full server reload after a confirmed conflict even when the lost creation has no local job id', async () => {
  mocks.start.mockResolvedValueOnce({ ok: false, uncertain: true, error: 'lost' }).mockResolvedValueOnce({ ok: false, recoveryRequired: true, error: '연결 변경' });
  button('자료 가져오기').props.onClick?.(); await settle(); button('같은 수집 요청 확인').props.onClick?.(); await settle();
  expect(button('자료 가져오기').props.disabled).toBe(true);
  expect(button('저장된 수집 작업 다시 불러오기').props.disabled).not.toBe(true);
  expect(mocks.start.mock.calls[1]).toEqual(mocks.start.mock.calls[0]); expect(mocks.advance).not.toHaveBeenCalled();
});
it('stops before the next page when requested and never fetches with a disabled connection', async () => {
  const disconnected = all(render(false)).find(item => item.type === 'button'); expect(disconnected?.props.disabled).toBe(true);
  disconnected?.props.onClick?.(); await settle(); expect(mocks.start).not.toHaveBeenCalled();
  let finish!: (result: unknown) => void;
  mocks.start.mockResolvedValue({ ok: true, kind: 'created', job }); mocks.advance.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  button('자료 가져오기').props.onClick?.(); await settle();
  button('현재 조회 후 멈춤').props.onClick?.(); finish({ ok: true, kind: 'accepted', job: { ...job, nextPage: 2, recordCount: 1000 } }); await settle();
  expect(mocks.advance).toHaveBeenCalledOnce(); expect(button('이어서 수집').props.disabled).toBe(false);
});
