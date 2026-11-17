import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* MD-0034 "서치 아이콘 클릭 시 다른 버튼 안눌림 현상" — 검색 패널이 열려 있는 동안 헤더 행의 장바구니·마이페이지·로고가 눌리고,
 * 검색 아이콘이 열기/닫기 토글이어야 한다. jsdom 없이 훅을 흉내 내 셸 크롬을 직접 호출하고(CategorySheet.client.test 와 같은 방식)
 * 트리에서 실제 onClick 핸들러를 꺼내 돌린다. inert 대상 판정은 overlay-focus.test(backgroundToInert), 마크업 계약은 WcShell.test 몫이다. */
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, pathname: '/shop', presence: 'signed-in' }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useEffect: () => undefined,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => hooks.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./CartProvider', () => ({ useCart: () => ({ count: 2, resetForSignOut: vi.fn() }) }));
vi.mock('./AuthPresenceProvider', () => ({ useAuthPresence: () => hooks.presence }));
vi.mock('./CardRewardAvailability', () => ({ useCardRewardsEnabled: () => true }));
vi.mock('./StorePresentationProvider', () => ({ useStorePresentation: () => ({ common: { themeColor: '#78bb53', headerStyle: 'basic', showHomeSearch: false } }) }));
vi.mock('./useOverlayA11y', () => ({ useOverlayA11y: vi.fn() }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/app/login/actions', () => ({ signOutAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: vi.fn() }) }));
import { Nav } from './Nav';
import { SearchOverlay } from './SearchOverlay';
import { useOverlayA11y } from './useOverlayA11y';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap((value) => (isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []));

/* Nav 는 경로를 읽고 크롬 컴포넌트를 돌려준다 — 그 크롬 함수를 렌더마다 직접 호출해 (state 를 훅 흉내에 보존한 채) 트리를 얻는다. */
function render() {
  hooks.index = 0;
  const chrome = Nav({}) as Element;
  return nodes((chrome.type as (props: unknown) => ReactNode)(chrome.props));
}
const find = (predicate: (node: Element) => boolean) => {
  const found = render().find(predicate);
  expect(found).toBeDefined();
  return found as Element;
};
const click = (node: Element) => (node.props.onClick as () => void)();

const searchButton = () => find((node) => node.type === 'button' && node.props['aria-label'] === '검색');
const searchPanel = () => find((node) => node.type === SearchOverlay);
const searchOpen = () => searchPanel().props.open === true;

beforeEach(() => {
  hooks.values = [];
  hooks.pathname = '/shop';
  hooks.presence = 'signed-in';
});

describe('헤더 검색 패널 (MD-0034)', () => {
  it('검색 아이콘은 열기/닫기 토글이고 열린 패널을 가리킨다', () => {
    expect(searchOpen()).toBe(false);
    expect(searchButton().props['aria-expanded']).toBe(false);
    expect(searchButton().props['aria-controls']).toBe('wc-search-panel');

    click(searchButton());
    expect(searchOpen()).toBe(true);
    expect(searchButton().props['aria-expanded']).toBe(true);

    /* 열린 패널에서 같은 아이콘을 다시 누르면 닫힌다 — 시트의 "활성화 / 해제" 요구. */
    click(searchButton());
    expect(searchOpen()).toBe(false);
    expect(searchButton().props['aria-expanded']).toBe(false);
  });

  it('패널이 열린 채 장바구니·마이페이지·로고를 누르면 이동과 함께 패널이 닫힌다', () => {
    const targets: Array<[string, () => Element]> = [
      ['장바구니', () => find((node) => String(node.props.className).includes('wc-icon-btn--cart'))],
      ['로고', () => find((node) => node.props.className === 'wc-logo')],
    ];
    for (const [name, target] of targets) {
      click(searchButton());
      expect(searchOpen(), `${name} 클릭 전 열림`).toBe(true);
      click(target());
      expect(searchOpen(), `${name} 클릭 뒤 닫힘`).toBe(false);
    }

    /* 마이 아이콘(링크·로그인 버튼 두 모양)은 하위 컴포넌트라 닫기 콜백을 prop 으로 받는다 — 그 콜백이 실제로 패널을 닫는다. */
    click(searchButton());
    expect(searchOpen()).toBe(true);
    const account = find((node) => typeof node.type === 'function' && 'onNavigate' in node.props);
    (account.props.onNavigate as () => void)();
    expect(searchOpen()).toBe(false);
  });

  it('GNB 링크를 눌러도 같은 경로 클릭에서 패널이 닫힌다', () => {
    click(searchButton());
    expect(searchOpen()).toBe(true);
    click(find((node) => String(node.props.className).startsWith('wc-gnb__link') && node.props.href === '/shop/new'));
    expect(searchOpen()).toBe(false);
  });

  /* 헤더 행을 inert 에서 빼고(keepInteractive) 포커스를 가두지 않는(trapFocus false) 비모달로 훅을 부른다. */
  it('검색 패널은 헤더 행을 눌린 채로 두고 포커스를 가두지 않는 비모달로 훅을 연다', () => {
    hooks.index = 0;
    const panel = nodes(SearchOverlay({ open: true, onClose: vi.fn() })).find((node) => node.props.role === 'dialog');

    expect(useOverlayA11y).toHaveBeenCalledWith(expect.objectContaining({ open: true, keepInteractive: '.wc-header__bar', trapFocus: false }));
    expect(panel?.props['aria-modal']).toBe('false');
    expect(panel?.props.id).toBe('wc-search-panel');
  });

  it('경로가 바뀌면 열린 패널이 접힌다(뒤로 가기로 같은 경로에 돌아와도 되살아나지 않는다)', () => {
    click(searchButton());
    expect(searchOpen()).toBe(true);
    hooks.pathname = '/cart';
    expect(searchOpen()).toBe(false);
    hooks.pathname = '/shop';
    expect(searchOpen()).toBe(false);
  });
});
