import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ capture: vi.fn(), flush: vi.fn(), beginSubmission: vi.fn() }));
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn, useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }), useEffect: () => undefined,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('@/lib/admin/local-autosave', () => ({
  EMPTY_LOCAL_AUTOSAVE_SNAPSHOT: {},
  createAdminLocalAutosave: () => ({ capture: mocks.capture, flush: mocks.flush, beginSubmission: mocks.beginSubmission, getSnapshot: () => ({}), subscribe: vi.fn(), key: 'test' }),
}));
import { useAdminLocalAutosave } from './useAdminLocalAutosave';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('복구 보존은 지정한 비동기 초기화만 적용하고 사진 선택·혼합 hidden 배치·직접 입력은 편집으로 보관한다', () => {
  vi.useFakeTimers();
  class Input { type = 'hidden'; constructor(public name: string) {} }
  let observed: (changes: { target: Input }[]) => void = () => undefined;
  vi.stubGlobal('HTMLInputElement', Input);
  vi.stubGlobal('MutationObserver', class { constructor(callback: typeof observed) { observed = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('FormData', class extends Map<string, string> { constructor() { super(); } });
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', new EventTarget());
  const form = Object.assign(new EventTarget(), { closest: () => null }) as unknown as HTMLFormElement;
  const local = useAdminLocalAutosave({ scope: { accountId: 'operator', formId: 'good', recordId: 'good' }, fields: ['imagePath'], serverState: {}, passiveInitializationFields: ['productAttributes', 'productAttributeDraft'] });
  const cleanup = local.formRef(form);
  const mutate = (...names: string[]) => { observed(names.map(name => ({ target: new Input(name) }))); vi.runOnlyPendingTimers(); };
  mutate('productAttributes', 'productAttributeDraft');
  expect(mocks.capture).toHaveBeenLastCalledWith(expect.any(Map), { preserveRecovery: true });
  mutate('imagePath');
  expect(mocks.capture).toHaveBeenLastCalledWith(expect.any(Map), { preserveRecovery: false });
  mutate('productAttributes', 'imagePath');
  expect(mocks.capture).toHaveBeenLastCalledWith(expect.any(Map), { preserveRecovery: false });
  form.dispatchEvent(new Event('change'));
  observed([{ target: new Input('productAttributes') }]); vi.runOnlyPendingTimers();
  expect(mocks.capture).toHaveBeenLastCalledWith(expect.any(Map), { preserveRecovery: false });
  const calls = mocks.capture.mock.calls.length;
  form.dispatchEvent(new Event('click')); vi.runOnlyPendingTimers();
  expect(mocks.capture).toHaveBeenCalledTimes(calls);
  cleanup?.();
});

function LockedFormHarness(disabled = true) {
  vi.useFakeTimers();
  class Input { type = 'hidden'; constructor(public name: string) {} }
  const ancestor = { disabled, parentElement: null };
  const entries = new Map([['previousId', 'good'], ['name', '저장된 상품'], ['imagePath', 'catalog/verified.webp'], ['productAttributes', 'initialized']]);
  const form = Object.assign(new EventTarget(), { closest: (selector: string) => selector === 'fieldset' || ancestor.disabled ? ancestor : null, entries });
  let observed: (changes: { target: unknown; attributeName?: string }[]) => void = () => undefined;
  const formDataReads = vi.fn();
  vi.stubGlobal('HTMLInputElement', Input);
  vi.stubGlobal('MutationObserver', class { constructor(callback: typeof observed) { observed = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('FormData', class extends Map<string, string> { constructor() { super(ancestor.disabled ? [] : entries); formDataReads(); } });
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', new EventTarget());
  const local = useAdminLocalAutosave({ scope: { accountId: 'operator', formId: 'good', recordId: 'good' }, fields: ['name','imagePath','productAttributes'], serverState: {}, passiveInitializationFields: ['productAttributes'] });
  const onCapture = vi.fn(), cleanup = local.formRef(form as unknown as HTMLFormElement, onCapture);
  return { ancestor, form: form as unknown as HTMLFormElement, entries, local, onCapture, cleanup, formDataReads,
    initialize: () => observed([{ target: new Input('productAttributes'), attributeName: 'value' }]),
    setDisabled: (value: boolean) => { ancestor.disabled = value; observed([{ target: ancestor, attributeName: 'disabled' }]); } };
}

it('외부 fieldset 잠금 중 비동기 초기화는 미리보기와 자동저장을 보존하고 해제 뒤 전체 DOM을 수동편집 없이 다시 읽는다', () => {
  const h = LockedFormHarness();
  h.initialize(); vi.runOnlyPendingTimers();
  expect(mocks.capture).not.toHaveBeenCalled(); expect(h.onCapture).not.toHaveBeenCalled(); expect(h.formDataReads).not.toHaveBeenCalled();
  h.setDisabled(false); vi.runOnlyPendingTimers();
  expect(mocks.capture).toHaveBeenCalledOnce(); expect(mocks.capture).toHaveBeenLastCalledWith(expect.any(Map), { preserveRecovery: true });
  expect([...mocks.capture.mock.lastCall![0]]).toEqual([...h.entries]);
  expect([...h.onCapture.mock.lastCall![0]]).toEqual([...h.entries]); h.cleanup?.();
});

it('입력 후 예약된 수집과 cleanup flush도 잠긴 FormData를 읽지 않는다', () => {
  const h = LockedFormHarness(false);
  h.form.dispatchEvent(new Event('input')); h.setDisabled(true); vi.runOnlyPendingTimers();
  expect(mocks.capture).not.toHaveBeenCalled(); expect(h.onCapture).not.toHaveBeenCalled(); expect(h.formDataReads).not.toHaveBeenCalled();
  h.cleanup?.(); expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.flush).toHaveBeenCalled();
});

it('잠금 중 명시 임시저장과 프로그램 제출을 막고 해제 후 기존 저장 계약을 유지한다', () => {
  const h = LockedFormHarness(); const preventDefault = vi.fn();
  h.local.onSubmitCapture({ currentTarget: h.form, preventDefault } as unknown as Parameters<typeof h.local.onSubmitCapture>[0]);
  expect(preventDefault).toHaveBeenCalledOnce(); expect(mocks.beginSubmission).not.toHaveBeenCalled();
  expect(h.local.saveDraft(h.form)).toBe(false); expect(mocks.capture).not.toHaveBeenCalled();
  h.setDisabled(false); vi.runOnlyPendingTimers(); mocks.capture.mockClear();
  expect(h.local.saveDraft(h.form)).toBe(true); expect([...mocks.capture.mock.lastCall![0]]).toEqual([...h.entries]);
  h.cleanup?.();
});

it('잠금 전에 발생한 실제 입력은 해제 후에도 명시 편집으로 보관한다', () => {
  const h = LockedFormHarness(false);
  h.entries.set('name', '사용자가 바꾼 상품'); h.form.dispatchEvent(new Event('input')); h.setDisabled(true); vi.runOnlyPendingTimers();
  expect(mocks.capture).not.toHaveBeenCalled(); h.setDisabled(false); vi.runOnlyPendingTimers();
  expect(mocks.capture).toHaveBeenCalledWith(expect.any(Map), { preserveRecovery: false }); expect([...mocks.capture.mock.lastCall![0]]).toEqual([...h.entries]); h.cleanup?.();
});
