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
import { SETTLEMENT_ACTIONS, SETTLEMENT_BUSY_MESSAGE, SETTLEMENT_PAUSED_MESSAGE, SETTLEMENT_RECOVERY_MESSAGE, SETTLEMENT_STOP_MESSAGE, settlementFailureLabel, settlementUncertainMessage } from '@/lib/settlements/console';
import { Button } from '@/components/admin/kit/ui/button';
const query = { mode: job.mode, dateType: job.dateType, startDate: job.startDate, endDate: job.endDate };
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean; role?: string }>;
/* 수집 버튼은 kit Button(ADR-0028)이다 — 렌더 전 요소 트리에서는 그 부품 자체가 요소 종류다. */
const isButton = (item: Element) => item.type === 'button' || item.type === Button;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render(enabled = true) { hooks.index = 0; hooks.refIndex = 0; return PgSettlementImportControl({ query, enabled, connectedMode: 'test', operationId: job.operationId, initialJob: null }); }
function button(label: string) { const element = all(render()).find(item => isButton(item) && text(item) === label); if (!element) throw new Error(label); return element; }
const labels = () => all(render()).filter(isButton).map(text);
/** 화면에 지금 떠 있는 안내·오류 문장(role이 있는 한 줄). */
const feedback = () => { const element = all(render()).find(item => item.props.role === 'alert' || item.props.role === 'status'); return element ? text(element) : null; };
/** 문장 안의 [버튼 이름]은 지금 화면에 있는 버튼 이름 그대로여야 한다. */
const quoted = (sentence: string) => [...sentence.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]);
async function settle() { for (let i = 0; i < 18; i++) await Promise.resolve(); }
beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; });
it('keeps an unknown creation on the original operation and blocks same-render double submissions', async () => {
  let finish!: (result: unknown) => void;
  mocks.start.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ok: false, uncertain: true, error: 'lost' });
  const submit = button('자료 가져오기'); submit.props.onClick?.(); submit.props.onClick?.(); expect(mocks.start).toHaveBeenCalledOnce();
  finish({ ok: false, uncertain: true, error: 'lost' }); await settle();
  button('가져왔는지 확인').props.onClick?.(); await settle();
  expect(mocks.start.mock.calls[1]).toEqual(mocks.start.mock.calls[0]); expect(mocks.advance).not.toHaveBeenCalled();
});
it('stops after a busy read and resumes by checking the existing import', async () => {
  mocks.start.mockResolvedValue({ ok: true, kind: 'created', job }); mocks.advance.mockResolvedValue({ ok: true, kind: 'busy', job });
  button('자료 가져오기').props.onClick?.(); await settle(); expect(mocks.advance).toHaveBeenCalledOnce();
  expect(feedback()).toBe(SETTLEMENT_BUSY_MESSAGE); expect(quoted(feedback()!).every(name => labels().includes(name))).toBe(true);
  mocks.read.mockResolvedValue({ ok: true, kind: 'paused', job }); button('현재 상태 확인').props.onClick?.(); await settle();
  expect(mocks.read).toHaveBeenCalledWith(job.id); expect(mocks.start).toHaveBeenCalledOnce(); expect(mocks.advance).toHaveBeenCalledOnce();
  expect(feedback()).toBe(SETTLEMENT_PAUSED_MESSAGE); expect(quoted(feedback()!).every(name => labels().includes(name))).toBe(true);
});
it('offers a full server reload after a confirmed conflict even when the lost creation has no local job id', async () => {
  mocks.start.mockResolvedValueOnce({ ok: false, uncertain: true, error: 'lost' }).mockResolvedValueOnce({ ok: false, recoveryRequired: true, error: '연결 변경' });
  button('자료 가져오기').props.onClick?.(); await settle(); button('가져왔는지 확인').props.onClick?.(); await settle();
  expect(button('자료 가져오기').props.disabled).toBe(true);
  expect(button('가져온 기록 다시 불러오기').props.disabled).not.toBe(true);
  expect(mocks.start.mock.calls[1]).toEqual(mocks.start.mock.calls[0]); expect(mocks.advance).not.toHaveBeenCalled();
  /* 서버 문구 대신 화면의 말이 뜬다 — 서버 문구는 버튼 이름을 따로 적어 이름이 어긋난다. */
  expect(feedback()).toBe(SETTLEMENT_RECOVERY_MESSAGE); expect(feedback()).not.toContain('연결 변경');
  expect(quoted(feedback()!)).toEqual(['가져온 기록 다시 불러오기']); expect(labels()).toContain('가져온 기록 다시 불러오기');
});
it('stops before the next page when requested and never fetches with a disabled connection', async () => {
  /* 연결이 꺼져 있으면 누를 버튼 자체를 그리지 않는다(화면에서 켤 수 없으므로 안내 문구로 대신한다). */
  expect(all(render(false)).find(isButton)).toBeUndefined();
  expect(mocks.start).not.toHaveBeenCalled();
  let finish!: (result: unknown) => void;
  mocks.start.mockResolvedValue({ ok: true, kind: 'created', job }); mocks.advance.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  button('자료 가져오기').props.onClick?.(); await settle();
  button('멈추기').props.onClick?.(); finish({ ok: true, kind: 'accepted', job: { ...job, nextPage: 2, recordCount: 1000 } }); await settle();
  expect(mocks.advance).toHaveBeenCalledOnce(); expect(button('이어서 가져오기').props.disabled).toBe(false);
  /* 멈추면 나중에 어느 버튼으로 이어 가는지 말하고, 그 버튼이 화면에 있다. */
  expect(SETTLEMENT_STOP_MESSAGE).toContain('[이어서 가져오기]');
});
it('결과를 모를 때의 말은 작업이 이미 있는지에 따라 눌러야 할 버튼을 가리킨다', async () => {
  mocks.start.mockResolvedValueOnce({ ok: false, uncertain: true, error: 'lost' });
  button('자료 가져오기').props.onClick?.(); await settle();
  /* 작업이 없으면 같은 가져오기를 한 번 더 보내 확인한다. 서버가 준 영문 'lost'는 화면에 나오지 않는다. */
  expect(feedback()).toBe(settlementUncertainMessage(false)); expect(feedback()).not.toContain('lost');
  expect(quoted(feedback()!)).toEqual(['가져왔는지 확인']); expect(labels()).toContain('가져왔는지 확인');
  /* 작업이 있으면 상태를 읽어 어디까지 됐는지 본다. */
  hooks.state = []; hooks.refs = [];
  mocks.start.mockResolvedValue({ ok: true, kind: 'created', job }); mocks.advance.mockResolvedValueOnce({ ok: false, uncertain: true, error: 'lost' });
  button('자료 가져오기').props.onClick?.(); await settle();
  expect(feedback()).toBe(settlementUncertainMessage(true)); expect(quoted(feedback()!)).toEqual(['현재 상태 확인']); expect(labels()).toContain('현재 상태 확인');
});
it('가져오기가 멈추거나 끝나지 못하면 이유와 다음에 누를 버튼을 말한다', async () => {
  mocks.start.mockResolvedValue({ ok: true, kind: 'created', job });
  /* 결제사가 잠깐 받지 못한 경우는 이어서 가져오면 된다 — 그 버튼이 있다. */
  mocks.advance.mockResolvedValueOnce({ ok: true, kind: 'paused', job: { ...job, errorCode: 'provider_unavailable' } });
  button('자료 가져오기').props.onClick?.(); await settle();
  expect(feedback()).toBe(settlementFailureLabel('provider_unavailable')); expect(quoted(feedback()!)).toEqual(['이어서 가져오기']); expect(labels()).toContain('이어서 가져오기');
  /* 끝내지 못한 경우는 다시 가져온다 — 그 버튼이 있다. */
  hooks.state = []; hooks.refs = [];
  mocks.advance.mockResolvedValueOnce({ ok: true, kind: 'failed', job: { ...job, state: 'failed', errorCode: 'invalid_response' } });
  button('자료 가져오기').props.onClick?.(); await settle();
  expect(feedback()).toBe(settlementFailureLabel('invalid_response')); expect(quoted(feedback()!)).toEqual(['다시 가져오기']); expect(labels()).toContain('다시 가져오기');
  /* 안내가 쓰는 이름은 모두 화면 버튼 이름표에 있다. */
  for (const code of ['invalid_response', 'duplicate_transaction', 'provider_unavailable', 'scope_changed', 'snapshot_changed']) expect(quoted(settlementFailureLabel(code)!).every(name => (Object.values(SETTLEMENT_ACTIONS) as string[]).includes(name))).toBe(true);
});
it('끝난 자료도 다시 가져올 수 있고, 가져오기는 결제사 조회만 하므로 확인창 없이 바로 시작한다', async () => {
  mocks.start.mockResolvedValue({ ok: true, kind: 'complete', job: { ...job, state: 'complete', scan: 2, completedAt: '2026-10-13T13:05:00Z' } });
  button('자료 가져오기').props.onClick?.(); await settle();
  expect(mocks.start).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce();
  /* 끝난 뒤의 버튼은 '다시 가져오기' 하나다. 누르면 새 작업(새 번호)으로 처음부터 가져온다. */
  expect(labels()).toContain('다시 가져오기');
  button('다시 가져오기').props.onClick?.(); await settle();
  expect(mocks.start).toHaveBeenCalledTimes(2); expect(mocks.start.mock.calls[1][0]).not.toBe(mocks.start.mock.calls[0][0]);
});
