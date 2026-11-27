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
/* 실행 시각 입력은 kit Input(ADR-0028)이다 — 렌더 전 요소 트리에서는 그 부품 자체가 요소 종류다. */
import { Input } from '@/components/admin/kit/ui/input';
import { Button } from '@/components/admin/kit/ui/button';

type Element = ReactElement<{ children?: ReactNode; status?: ReactNode; summary?: ReactNode; value?: string; role?: string; tabIndex?: number; disabled?: boolean;
  type?: string; onChange?: (event: unknown) => void; onSubmit?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
/** 렌더 중 상태 맞춤(setState)은 React처럼 같은 렌더를 한 번 더 돌려 반영한다. */
function render(initial: AutoOrderConfirmationState | null) {
  let out: ReactNode = null;
  for (let pass = 0; pass < 2; pass++) { hooks.index = 0; hooks.refIndex = 0; out = AutoOrderConfirmPanel({ initial }); }
  return out as Element;
}
const timeInput = (tree: Element) => all(tree).find(element => (element.type === 'input' || element.type === Input) && element.props.type === 'time')!;
const checkbox = (tree: Element) => all(tree).find(element => element.type === 'input' && element.props.type === 'checkbox')!;
const readback = (tree: Element) => text(all(tree).find(element => (element.props as Record<string, unknown>)['data-auto-order-readback'] === '')!);
const submitButton = (tree: Element) => all(tree).find(element => element.type === Button && element.props.type === 'submit')!;
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
  expect(text(tree.props.summary)).toContain('매일 17:00');
  expect(text(tree.props.status)).toBe('켜짐');
  expect(timeInput(tree).props.value).toBe('17:00');
});

it('늦게 도착한 이전 설정은 되돌리지 않고, 같은 revision의 새 실행 기록은 반영하며 고치던 입력은 남긴다', async () => {
  await saveRunTime('17:00');
  const stale = render(structuredClone(base));
  expect(text(stale.props.summary)).toContain('매일 17:00');
  expect(text(result(stale))).toContain('저장했습니다');

  timeInput(render(saved)).props.onChange?.({ target: { value: '18:00' } });
  const ran = { ...saved, lastRun: { runDate: '2026-10-27', cutoffAt: '2026-10-27T08:00:00Z', startedAt: '2026-10-27T08:00:30Z', finishedAt: '2026-10-27T08:00:31Z',
    confirmedCount: 5, excludedCount: 1 } };
  const tree = render(ran);
  expect(text(tree.props.summary)).toContain('발주확인 5건 · 제외 1건');
  expect(timeInput(tree).props.value).toBe('18:00');
  /* 값을 다시 고치면 앞선 저장 결과 문장은 지운다(QA-O 사소 2) — '저장하면 …'과 '저장했습니다 …'가 함께 보이지 않는다. */
  expect(result(tree)).toBeUndefined();
  expect(readback(tree)).toContain('저장하면 매일 18:00에');
});

it('저장한 뒤 사용 여부를 다시 바꾸면 앞선 저장 결과 문장을 지우고, 오류 문구는 다시 저장할 때까지 남긴다', async () => {
  mocks.save.mockResolvedValue({ state: { ...base, revision: 4, enabled: false } });
  checkbox(render(base)).props.onChange?.({ target: { checked: false } });
  all(render(base)).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
  await settle();
  expect(text(result(render(base)))).toBe('저장했습니다. 자동 발주확인을 껐습니다. 신규주문은 직접 발주확인합니다.');
  checkbox(render(base)).props.onChange?.({ target: { checked: true } });
  const tree = render(base);
  expect(result(tree)).toBeUndefined();
  expect(readback(tree)).toContain('저장하면 매일 16:30에');

  /* 잘못된 시각으로 저장을 누른 오류는 값을 고쳐도 남는다(다시 저장하면 지워진다). */
  timeInput(tree).props.onChange?.({ target: { value: '' } });
  all(render(base)).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
  await settle();
  expect(result(render(base))?.props.role).toBe('alert');
  timeInput(render(base)).props.onChange?.({ target: { value: '17:30' } });
  expect(text(result(render(base)))).toBe('실행 시각을 00:00~23:59 사이로 입력해주세요.');
});

it('처음에 설정을 읽지 못했어도 다시 그릴 때 받은 설정으로 패널을 연다', () => {
  expect(text(render(null))).toContain('자동 발주확인 설정을 불러오지 못했습니다');
  const tree = render(base);
  expect(text(tree.props.summary)).toContain('매일 16:30');
  expect(text(tree.props.status)).toBe('켜짐');
  expect(timeInput(tree).props.value).toBe('16:30');
});

/* 켜고 끌 때 무엇이 달라지는지를 지금 고른 값으로 한 줄에 되읽는다. 저장하기 전에 바꾼 것은 '저장하면'으로 시작한다. */
it('바꾼 값을 저장하기 전에 한 줄로 되읽고, 끄면 실행 시각 칸을 숨긴다', () => {
  const unchanged = render(base);
  expect(readback(unchanged)).toBe('매일 16:30에, 그 시각까지 결제된 신규주문을 발주확인합니다. 발주확인 전까지는 고객이 직접 취소할 수 있습니다.');
  timeInput(unchanged).props.onChange?.({ target: { value: '17:00' } });
  expect(readback(render(base))).toBe('저장하면 매일 17:00에, 그 시각까지 결제된 신규주문을 발주확인합니다. 발주확인 전까지는 고객이 직접 취소할 수 있습니다.');
  checkbox(render(base)).props.onChange?.({ target: { checked: false } });
  const off = render(base);
  expect(readback(off)).toBe('저장하면 자동 발주확인을 끕니다. 신규주문은 직접 발주확인합니다.');
  expect(all(off).some(element => element.props.type === 'time')).toBe(false);
  /* 끈 채로 시각만 바꾼 것은 바뀐 것이 아니다 — 켜 두었던 값으로 돌아오면 저장할 것이 없다. */
  checkbox(render(base)).props.onChange?.({ target: { checked: true } });
  timeInput(render(base)).props.onChange?.({ target: { value: '16:30' } });
  expect(readback(render(base))).toBe('매일 16:30에, 그 시각까지 결제된 신규주문을 발주확인합니다. 발주확인 전까지는 고객이 직접 취소할 수 있습니다.');
  expect(submitButton(render(base)).props.disabled).toBe(true);
});

it('꺼 둔 것을 켜면 켠 뒤 결제된 주문부터 대상이고 지금 신규주문은 직접 처리한다고 되읽는다', () => {
  const off: AutoOrderConfirmationState = { ...base, enabled: false, nextRunAt: null };
  expect(readback(render(off))).toBe('자동 발주확인이 꺼져 있습니다. 신규주문은 직접 발주확인합니다.');
  checkbox(render(off)).props.onChange?.({ target: { checked: true } });
  expect(readback(render(off))).toBe('저장하면 매일 16:30에, 그 시각까지 결제된 신규주문을 발주확인합니다. 발주확인 전까지는 고객이 직접 취소할 수 있습니다. 지금 신규주문에 있는 주문은 직접 발주확인합니다.');
});

it('끄는 저장은 비어 있는 실행 시각에 막히지 않고 저장돼 있던 시각을 보낸다', async () => {
  timeInput(render(base)).props.onChange?.({ target: { value: '' } });
  checkbox(render(base)).props.onChange?.({ target: { checked: false } });
  mocks.save.mockResolvedValue({ state: { ...base, revision: 4, enabled: false, nextRunAt: null } });
  all(render(base)).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
  await settle();
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(false, '16:30', 3, expect.any(String));
  expect(text(result(render({ ...base, revision: 4, enabled: false, nextRunAt: null })))).toBe('저장했습니다. 자동 발주확인을 껐습니다. 신규주문은 직접 발주확인합니다.');
});

/* 시각을 고치다가 끄면 숨은 칸에 고친 시각이 남는다. 끄는 저장은 그 값을 함께 저장하지 않는다 — 끈 채로 시각만 바뀌어 있으면 다시 켤 때 놀란다. */
it('시각을 고친 뒤 끄고 저장해도 저장돼 있던 시각을 보낸다', async () => {
  timeInput(render(base)).props.onChange?.({ target: { value: '17:00' } });
  checkbox(render(base)).props.onChange?.({ target: { checked: false } });
  mocks.save.mockResolvedValue({ state: { ...base, revision: 4, enabled: false, nextRunAt: null } });
  all(render(base)).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
  await settle();
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(false, '16:30', 3, expect.any(String));
});

it('켠 채로 실행 시각을 비워 저장하면 고칠 방법을 알리고 저장하지 않는다. 비어 있는 동안 되읽는 줄은 시각 자리를 비우지 않는다', async () => {
  timeInput(render(base)).props.onChange?.({ target: { value: '' } });
  expect(readback(render(base))).toBe('저장하면 매일 실행 시각에, 그 시각까지 결제된 신규주문을 발주확인합니다. 발주확인 전까지는 고객이 직접 취소할 수 있습니다.');
  all(render(base)).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
  await settle();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(text(result(render(base)))).toBe('실행 시각을 00:00~23:59 사이로 입력해주세요.');
});

it('저장 결과를 모르면 낱말 표의 말로 알리고, [저장됐는지 확인]은 같은 내용·같은 요청 번호로 다시 보낸다', async () => {
  mocks.save.mockResolvedValueOnce({ error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.', uncertain: true });
  await saveRunTime('17:00');
  const asked = render(base);
  expect(text(result(asked))).toBe('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
  expect(text(submitButton(asked).props.children)).toBe('저장됐는지 확인');
  mocks.save.mockResolvedValueOnce({ state: saved });
  all(render(base)).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
  await settle();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
  expect(text(result(render(saved)))).toBe('저장했습니다. 매일 17:00에 자동 발주확인합니다.');
  /* 다른 사람이 먼저 바꾼 것처럼 알 수 있는 오류는 서버 문구를 그대로 보인다. */
  mocks.save.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다. 새로고침해 지금 설정을 확인해주세요.' });
  timeInput(render(saved)).props.onChange?.({ target: { value: '18:00' } });
  all(render(saved)).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
  await settle();
  expect(text(result(render(saved)))).toContain('다른 사람이 먼저 바꿨습니다.');
});
