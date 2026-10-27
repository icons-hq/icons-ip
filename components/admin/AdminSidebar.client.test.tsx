import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pathname: '/admin', storage: new Map<string, string>() }));
/* 브라우저 없이 사이드바 함수를 직접 호출한다 — 상태·효과는 고정하고 메뉴 설정 저장소만 실제처럼 읽고 쓴다. */
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial: unknown) => ({ current: initial }), useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(), useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
import { AdminSidebar } from './AdminSidebar';

type Element = ReactElement<{ children?: ReactNode; 'aria-controls'?: string; 'aria-expanded'?: boolean; onClick?: () => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function render(pathname: string, consoleId: 'commerce' | 'content') {
  mocks.pathname = pathname;
  return AdminSidebar({ accountId: 'operator-a', collapsed: false, onCollapsedChange: () => {}, role: 'staff', console: consoleId }) as ReactNode;
}
const toggle = (tree: ReactNode, groupId: string) => all(tree).find(element => element.type === 'button' && element.props['aria-controls'] === `admin-nav-group-${groupId}`);
const expanded = (tree: ReactNode, groupId: string) => toggle(tree, groupId)?.props['aria-expanded'];

beforeEach(() => {
  mocks.storage.clear();
  vi.stubGlobal('window', {
    localStorage: { getItem: (key: string) => mocks.storage.get(key) ?? null, setItem: (key: string, value: string) => { mocks.storage.set(key, value); } },
    dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

it('커머스에서 처음 메뉴 그룹을 펼쳐도 콘텐츠 운영 콘솔의 다른 그룹은 접힌 채로 남는다', () => {
  const commerce = render('/admin/sales/orders', 'commerce');
  expect(expanded(commerce, 'catalog')).toBe(false);
  toggle(commerce, 'catalog')!.props.onClick?.();
  expect(expanded(render('/admin/sales/orders', 'commerce'), 'catalog')).toBe(true);

  const content = render('/admin/catalog/cards', 'content');
  expect(expanded(content, 'content')).toBe(true); // 현재 화면의 그룹은 항상 열린다.
  expect(expanded(content, 'field')).toBe(false);
  expect(expanded(content, 'help')).toBe(false);
});

it('콘텐츠 운영에서 처음 메뉴를 만져도 커머스 그룹은 현재 그룹만 열린다', () => {
  toggle(render('/admin/catalog/cards', 'content'), 'field')!.props.onClick?.();
  expect(expanded(render('/admin/catalog/cards', 'content'), 'field')).toBe(true);

  const commerce = render('/admin/sales/orders', 'commerce');
  expect(expanded(commerce, 'sales')).toBe(true);
  for (const groupId of ['catalog', 'display', 'help']) expect(expanded(commerce, groupId), groupId).toBe(false);
});
