import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {},
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/auto-order-confirmation-actions', () => ({ saveAutoOrderConfirmationAction: mocks.save }));
import { AutoOrderConfirmPanel } from './AutoOrderConfirmPanel';
import type { AutoOrderConfirmationState } from '@/lib/admin/auto-order-confirmation';

type Element = ReactElement<{ children?: ReactNode; summary?: string; value?: string; role?: string; tabIndex?: number;
  type?: string; onChange?: (event: unknown) => void; onSubmit?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
/** 렌더 중 상태 맞춤(setState)은 React처럼 같은 렌더를 한 번 더 돌려 반영한다. */
function render(initial: AutoOrderConfirmationState | null) {
  let out: ReactNode = null;
  for (let pass = 0; pass < 2; pass++) { hooks.index = 0; hooks.refIndex = 0; out = AutoOrderConfirmPanel({ initial }); }
  return out as Element;
}
const timeInput = (tree: Element) => all(tree).find(element => element.type === 'input' && element.props.type === 'time')!;
const result = (tree: Element) => all(tree).find(element => element.type === 'p' && (element.props.role === 'status' || element.props.role === 'alert'));
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); }

const base: AutoOrderConfirmationState = { revision: 3, enabled: true, runTime: '16:30', enabledAt: '2026-10-27T00:57:35Z', updatedAt: '2026-10-27T00:57:35Z',
  nextRunAt: '2026-10-27T07:30:00Z', lastRun: null, lastExclusions: [] };
const saved: AutoOrderConfirmationState = { ...base, revision: 4, runTime: '17:00', updatedAt: '2026-10-27T02:00:00Z', nextRunAt: '2026-10-27T08:00:00Z' };

beforeEach(() => { hooks.state = []; hooks.refs = []; vi.clearAllMocks(); mocks.save.mockResolvedValue({ state: saved }); });

async function saveRunTime(value: string) {
  timeInput(render(base)).props.onChange?.({ target: { value } });
  all(render(base)).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
  await settle();
}

it('저장 뒤 서버가 새 설정으로 다시 그려도 저장 결과 문구가 남고 표시는 새 설정을 따른다', async () => {
  await saveRunTime('17:00');
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(true, '17:00', 3, expect.any(String));
  // revalidatePath가 같은 자리에 새 initial(다른 객체)을 내려보낸다 — 다시 마운트하지 않으므로 상태 문구가 그대로다.
  const tree = render(structuredClone(saved));
  const status = result(tree);
  expect(status?.props.role).toBe('status');
  expect(text(status)).toBe('저장했습니다. 매일 17:00에 자동 발주확인합니다.');
  // 저장 중 잠긴 입력에서 빠진 포커스를 받을 수 있는 자리다.
  expect(status?.props.tabIndex).toBe(-1);
  expect(tree.props.summary).toContain('매일 17:00 · 켜짐');
  expect(timeInput(tree).props.value).toBe('17:00');
});

it('늦게 도착한 이전 설정은 되돌리지 않고, 같은 revision의 새 실행 기록은 반영하며 고치던 입력은 남긴다', async () => {
  await saveRunTime('17:00');
  const stale = render(structuredClone(base));
  expect(stale.props.summary).toContain('매일 17:00');
  expect(text(result(stale))).toContain('저장했습니다');

  timeInput(render(saved)).props.onChange?.({ target: { value: '18:00' } });
  const ran = { ...saved, lastRun: { runDate: '2026-10-27', cutoffAt: '2026-10-27T08:00:00Z', startedAt: '2026-10-27T08:00:30Z', finishedAt: '2026-10-27T08:00:31Z',
    confirmedCount: 5, excludedCount: 1 } };
  const tree = render(ran);
  expect(tree.props.summary).toContain('발주확인 5건 · 제외 1건');
  expect(timeInput(tree).props.value).toBe('18:00');
  expect(text(result(tree))).toContain('저장했습니다');
});

it('처음에 설정을 읽지 못했어도 다시 그릴 때 받은 설정으로 패널을 연다', () => {
  expect(text(render(null))).toContain('자동 발주확인 설정을 불러오지 못했습니다');
  const tree = render(base);
  expect(tree.props.summary).toContain('매일 16:30 · 켜짐');
  expect(timeInput(tree).props.value).toBe('16:30');
});
