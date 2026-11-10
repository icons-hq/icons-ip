import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void)[] }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useTransition: () => [false, vi.fn()],
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/app/admin/goods-bulk-actions', () => ({ previewGoodsBulkAction: vi.fn(), commitGoodsBulkAction: vi.fn(), readGoodsBulkAction: vi.fn() }));
vi.mock('./GoodsGroupOperation', () => ({
  GroupTable: ({ children }: { children: ReactNode }) => children,
  useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: vi.fn() }),
}));
vi.mock('./screens/CustomerServiceDialog', () => ({ CustomerServiceDialog: ({ children }: { children: ReactNode }) => children }));

import Link from 'next/link';
import { Button } from './kit/ui/button';
import { GoodsBulkToolbar } from './GoodsBulkToolbar';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';

type Element = ReactElement<Record<string, unknown>>;
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
const isButton = (node: Element) => node.type === 'button' || node.type === Button;
const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };

function render(selectedIds: string[]) {
  hooks.index = 0; hooks.refIndex = 0; hooks.effects = [];
  return GoodsBulkToolbar({ kind: 'goods', identity, selectedIds, onCompleted: vi.fn(), selectionActions: <span>마케팅 링크 생성/복사</span> });
}
/* 진행 기록 확인을 끝낸 뒤의 화면 — 그 전에는 막대 전체가 잠겨 있다. */
async function settled(selectedIds: string[]) {
  render(selectedIds);
  for (const effect of hooks.effects) effect();
  await Promise.resolve();
  return render(selectedIds);
}
const labels = (list: Element[]) => list.filter(isButton).map(node => text(node.props.children as ReactNode));

beforeEach(() => {
  hooks.states = []; hooks.refs = [];
  vi.stubGlobal('localStorage', { length: 0, key: () => null, getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

it('자주 쓰는 일괄 변경만 줄에 두고 나머지는 더보기에 둔다 — 마케팅 링크는 일괄 변경 뒤에 따로 선다', async () => {
  const tree = await settled(['good-a']);
  const all = nodes(tree);
  const menu = all.find(node => node.type === 'details')!;
  const inMenu = nodes(menu.props.children as ReactNode);
  expect(labels(inMenu)).toEqual(['판매기간 변경', '선택 보관', '선택 복원']);
  expect(labels(all).filter(label => !labels(inMenu).includes(label))).toEqual(['전시 변경', '판매 변경', '판매가 변경', '즉시할인']);
  expect(inMenu.some(node => node.type === Link && text(node.props.children as ReactNode) === '배송 변경')).toBe(true);
  expect(text(tree).indexOf('즉시할인')).toBeLessThan(text(tree).indexOf('마케팅 링크 생성/복사'));
});

it('더보기의 항목도 줄의 버튼과 같은 변경 창을 연다', async () => {
  const before = nodes(await settled(['good-a']));
  (before.find(node => isButton(node) && text(node.props.children as ReactNode) === '선택 보관')!.props.onClick as () => void)();
  expect(nodes(render(['good-a'])).find(node => node.type === CustomerServiceDialog)?.props.title).toBe('선택 보관');
});

it('선택이 없으면 더보기도 다른 버튼처럼 비활성이다', async () => {
  const all = nodes(await settled([]));
  expect(all.some(node => node.type === 'details')).toBe(false);
  const more = all.find(node => isButton(node) && text(node.props.children as ReactNode) === '더보기')!;
  expect(more.props.disabled).toBe(true);
});
