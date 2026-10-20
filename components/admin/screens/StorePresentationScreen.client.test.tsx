import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), jobs: [] as (() => void)[] }));
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial; return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const index = hooks.index++, previous = hooks.effects.get(index); if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { hooks.effects.set(index, { deps, cleanup: previous?.cleanup }); hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects.get(index)!.cleanup = effect() || undefined; }); } },
}));
vi.mock('@/app/admin/store-presentation-actions', () => ({ saveStorePresentationAction: mocks.save }));
import { StorePresentationScreen } from './StorePresentationScreen';
import { DEFAULT_STORE_PRESENTATION } from '@/lib/store-presentation';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
function render() {
  hooks.index = 0;
  const screen = StorePresentationScreen({ snapshot: { values: DEFAULT_STORE_PRESENTATION, revisions: { common: 1, listing: 1 } }, section: 'common' });
  const form = nodes(screen).find(node => typeof node.type === 'function' && node.type.name === 'PresentationForm')!;
  const result = (form.type as (props: Record<string, unknown>) => ReactNode)(form.props);
  for (const job of hooks.jobs.splice(0)) job();
  return nodes(result);
}
const checkbox = () => render().find(node => node.type === 'input' && node.props.type === 'checkbox')!;
function edit() { (checkbox().props.onChange as (event: unknown) => void)({ target: { checked: !DEFAULT_STORE_PRESENTATION.common.showHomeSearch } }); render(); }
function unloadBlocked() { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }
function cancel() { const button = render().find(node => node.type === 'button' && text(node) === '변경 취소')!; expect(button.props.disabled).toBe(false); (button.props.onClick as () => void)(); render(); }
async function save() { const form = render().find(node => node.type === 'form')!; (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } }
beforeEach(() => { hooks.values = []; hooks.effects.clear(); hooks.jobs = []; vi.clearAllMocks(); vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: vi.fn(() => true) })); vi.stubGlobal('document', new EventTarget()); render(); });
afterEach(() => { for (const effect of hooks.effects.values()) effect.cleanup?.(); vi.unstubAllGlobals(); });

it('미저장 전시 설정의 이동을 보호하고 명시적으로 취소한 경우에만 저장값으로 되돌린다', () => {
  edit(); expect(unloadBlocked()).toBe(true);
  vi.mocked(window.confirm).mockReturnValueOnce(false); cancel();
  expect(checkbox().props.checked).toBe(!DEFAULT_STORE_PRESENTATION.common.showHomeSearch);
  cancel(); expect(checkbox().props.checked).toBe(DEFAULT_STORE_PRESENTATION.common.showHomeSearch);
  expect(unloadBlocked()).toBe(false); expect(mocks.save).not.toHaveBeenCalled();
});

it('확인된 저장만 새 기준으로 삼고 결과 불명확 상태에서는 변경 취소로 요청을 잃지 않는다', async () => {
  edit(); mocks.save.mockRejectedValueOnce(new Error('Failed to fetch')); await save();
  const first = mocks.save.mock.calls[0];
  expect(render().find(node => node.type === 'button' && text(node) === '변경 취소')!.props.disabled).toBe(true);
  expect(unloadBlocked()).toBe(true);
  mocks.save.mockResolvedValueOnce({ revision: 2 }); await save();
  expect(mocks.save.mock.calls[1]).toEqual(first);
  expect(checkbox().props.checked).toBe(!DEFAULT_STORE_PRESENTATION.common.showHomeSearch);
  expect(unloadBlocked()).toBe(false);
});
