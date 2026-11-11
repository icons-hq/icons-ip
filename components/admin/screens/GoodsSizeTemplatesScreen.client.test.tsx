import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
/* 화면과 편집 창의 상태 칸을 따로 둔다. 편집 창은 화면이 그린 요소를 함수로 다시 불러 그린다. */
const hooks = vi.hoisted(() => ({ scopes: {} as Record<string, unknown[]>, scope: 'screen', index: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), capture: vi.fn(), restore: vi.fn(), discard: vi.fn(), recovery: null as unknown }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const state = hooks.scopes[hooks.scope] ??= []; const index = hooks.index++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
  },
}));
vi.mock('@/app/admin/goods-size-chart-actions', () => ({ listGoodsSizeTemplatesAction: vi.fn(), saveGoodsSizeTemplateAction: mocks.save }));
vi.mock('../useGoodsSizeRecovery', () => ({ useGoodsSizeRecovery: () => ({ recovery: mocks.recovery, invalidRecovery: false, unavailable: false, capture: mocks.capture, restore: mocks.restore, discard: mocks.discard }) }));
import { GoodsSizeTemplatesScreen } from './GoodsSizeTemplatesScreen';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { emptyGoodsSizeChart, type GoodsSizeChart } from '@/lib/goods-size-chart';

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean; value?: string }>;
const all = (node: ReactNode): Element[] => Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : '';
const chart: GoodsSizeChart = { unit: 'cm', sizes: ['S'], measurements: [{ name: '총장', values: ['60'] }], note: '' };
const kept = { baseRevision: 0, name: '이전에 쓴 템플릿', chart, request: null };

/** 새 템플릿 등록 창을 연 화면에서 편집 창을 그린다. */
function editor() {
  hooks.scope = 'screen'; hooks.index = 0;
  const host = all(GoodsSizeTemplatesScreen({ accountId: 'operator-a' })).find(node => typeof node.type === 'function' && node.type.name === 'SizeTemplateEditor');
  if (!host) throw new Error('SizeTemplateEditor');
  hooks.scope = 'editor'; hooks.index = 0;
  return all((host.type as (props: typeof host.props) => ReactNode)(host.props));
}
function button(label: string) { const item = editor().find(node => node.type === Button && text(node) === label); if (!item) throw new Error(label); return item; }
const nameInput = () => editor().find(node => node.type === Input)!;
const fieldset = () => editor().find(node => node.type === 'fieldset')!;

beforeEach(() => {
  vi.clearAllMocks(); hooks.scopes = { screen: Object.assign([], { 6: { template: null } }) }; mocks.recovery = kept;
  mocks.discard.mockImplementation(() => { mocks.recovery = null; });
  mocks.restore.mockImplementation(() => { mocks.recovery = null; return kept; });
});

it('브라우저 복구 기록이 남은 동안 템플릿을 고치거나 저장해 이전 기록을 덮지 않는다', () => {
  expect(fieldset().props.disabled).toBe(true); expect(button('템플릿 저장').props.disabled).toBe(true);
  expect(text(editor())).toContain('복구하거나 버린 뒤 템플릿을 고칠 수 있습니다.');
  nameInput().props.onChange?.({ target: { value: '새 이름' } });
  editor().find(node => node.type === 'form')?.props.onSubmit?.({ preventDefault() {} });
  expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.discard).not.toHaveBeenCalled();
});

it('복구하면 이전 템플릿을, 버리면 빈 표를 이어서 고칠 수 있다', () => {
  button('템플릿 복구').props.onClick?.();
  expect(fieldset().props.disabled).toBe(false); expect(nameInput().props.value).toBe('이전에 쓴 템플릿');
  nameInput().props.onChange?.({ target: { value: '이어서 쓴 템플릿' } });
  expect(mocks.capture).toHaveBeenLastCalledWith({ baseRevision: 0, name: '이어서 쓴 템플릿', chart, request: null });
  hooks.scopes = { screen: Object.assign([], { 6: { template: null } }) }; mocks.recovery = kept; vi.clearAllMocks();
  mocks.discard.mockImplementation(() => { mocks.recovery = null; });
  button('복구 기록 버리기').props.onClick?.();
  expect(fieldset().props.disabled).toBe(false);
  nameInput().props.onChange?.({ target: { value: '새 템플릿' } });
  expect(mocks.capture).toHaveBeenLastCalledWith({ baseRevision: 0, name: '새 템플릿', chart: emptyGoodsSizeChart(), request: null });
});
