import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[],
  effects: [] as { deps: unknown[]; cleanup?: void | (() => void) }[],
  jobs: [] as (() => void)[], stateIndex: 0, refIndex: 0, effectIndex: 0,
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ??= { current: initial }; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.effectIndex++, previous = hooks.effects[index];
    if (previous && !deps.some((dep, i) => dep !== previous.deps[i])) return;
    hooks.effects[index] = { deps };
    hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects[index].cleanup = effect(); });
  },
}));

import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { setAdminConfirmHandler } from '@/lib/admin/confirm';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';
let leaveConfirm: ReturnType<typeof stubAdminConfirm>;
import { ADMIN_LEAVE_CONFIRM_MESSAGE } from '@/lib/admin/leave-guard';

type Options = Parameters<typeof useAdminLeaveGuard>[0];
function Screen(options?: Options) { return useAdminLeaveGuard(options); }
function render(options?: Options) {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0;
  const result = Screen(options);
  for (const job of hooks.jobs.splice(0)) job();
  return result;
}
function unloadBlocked() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function clickLink() {
  (document as unknown as { closest: () => unknown }).closest = () => ({ href: 'https://iconsip.com/admin/cs/faq', target: '', hasAttribute: () => false });
  const event = Object.assign(new Event('click', { cancelable: true }), { button: 0 });
  document.dispatchEvent(event);
  return event.defaultPrevented;
}

let mutate: () => void;
class FakeForm extends EventTarget {
  elements = [{ name: 'title', type: 'text', value: 'A' }];
  type(value: string) { this.elements[0].value = value; this.dispatchEvent(new Event('input')); vi.runAllTimers(); }
}

beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.jobs = [];
  vi.useFakeTimers();
  leaveConfirm = stubAdminConfirm(false);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { href: 'https://iconsip.com/admin/settings/store' } }));
  vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { mutate = callback; } observe() {} disconnect() {} });
});
afterEach(() => {
  for (const effect of hooks.effects) { if (typeof effect.cleanup === 'function') effect.cleanup(); }
  setAdminConfirmHandler(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useAdminLeaveGuard', () => {
  it('값을 state로 들고 있는 화면은 dirty가 켜진 동안만 지킨다', () => {
    expect(render({ dirty: false }).dirty).toBe(false);
    expect(unloadBlocked()).toBe(false);

    expect(render({ dirty: true }).dirty).toBe(true);
    expect(unloadBlocked()).toBe(true);
    expect(clickLink()).toBe(true);
    expect(leaveConfirm).toHaveBeenCalledWith(ADMIN_LEAVE_CONFIRM_MESSAGE);

    render({ dirty: false });
    expect(unloadBlocked()).toBe(false);
  });

  it('화면 문구를 쓰고, 문구가 바뀌면 새 문구로 묻는다', async () => {
    render({ dirty: true, message: '착불 입력이 있습니다.' });
    clickLink();
    expect(leaveConfirm).toHaveBeenLastCalledWith('착불 입력이 있습니다.');
    /* 앞의 확인창이 닫힌 뒤의 다음 이동이다. */
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    render({ dirty: true, message: '다른 문구' });
    clickLink();
    expect(leaveConfirm).toHaveBeenLastCalledWith('다른 문구');
  });

  it('쿼리만 바뀌어도 입력이 남는 화면은 그런 링크에 묻지 않는다(옵션을 켠 화면만)', () => {
    const clickQueryLink = () => {
      (document as unknown as { closest: () => unknown }).closest = () => ({ href: 'https://iconsip.com/admin/settings/store?page=2', target: '', hasAttribute: () => false });
      const event = Object.assign(new Event('click', { cancelable: true }), { button: 0 });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    render({ dirty: true, survivesQueryChange: true });
    expect(clickQueryLink()).toBe(false);
    expect(leaveConfirm).not.toHaveBeenCalled();
    render({ dirty: true });
    expect(clickQueryLink()).toBe(true);
    expect(leaveConfirm).toHaveBeenCalledOnce();
  });

  it('저장 결과를 기다리는 동안은 묻지 않고 막는다', () => {
    render({ blocked: true });
    expect(clickLink()).toBe(true);
    expect(leaveConfirm).not.toHaveBeenCalled();
    expect(unloadBlocked()).toBe(true);
  });

  it('실패 뒤 되살린 값은 폼이 새 기준과 같아도 미저장이다', () => {
    expect(render({ preserved: true }).dirty).toBe(true);
    expect(unloadBlocked()).toBe(true);
  });

  it('비제어 폼을 입력하면 지키고, 저장에 성공하면 내려놓는다', () => {
    const state = {};
    const first = render({ serverState: state });
    const form = new FakeForm();
    first.formRef(form as unknown as HTMLFormElement);
    expect(unloadBlocked()).toBe(false);

    form.type('B');
    expect(render({ serverState: state }).dirty).toBe(true);
    expect(unloadBlocked()).toBe(true);

    form.dispatchEvent(new Event('submit'));
    render({ serverState: { message: '저장했습니다.' } });
    vi.runAllTimers();
    expect(render({ serverState: { message: '저장했습니다.' } }).dirty).toBe(false);
    expect(unloadBlocked()).toBe(false);
  });

  it('숨은 값만 바뀌어도(사진 선택) 미저장이다', () => {
    const form = new FakeForm();
    render().formRef(form as unknown as HTMLFormElement);
    form.elements.push({ name: 'imagePath', type: 'hidden', value: 'a.png' });
    mutate();
    vi.runAllTimers();
    expect(render().dirty).toBe(true);
  });

  it('페이지가 내려갈 때 항상 최신 onUnload를 쓴다', () => {
    const first = vi.fn(), second = vi.fn();
    render({ dirty: true, onUnload: first });
    render({ dirty: true, onUnload: second });
    unloadBlocked();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
