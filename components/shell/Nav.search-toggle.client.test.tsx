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
import { BottomTabBar } from './BottomTabBar';
import { MenuSheet } from './MenuSheet';
import { Nav } from './Nav';
import { SEARCH_KEEP_INTERACTIVE, SearchOverlay } from './SearchOverlay';
import { ShellNotices } from './ShellNotices';
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

  /* 딤 위에 밝게 남는 줄(헤더 행·유틸 메뉴·롤링 띠배너·이미지 스트립)을 inert 에서 빼고(keepInteractive) 포커스를 가두지 않는(trapFocus false) 비모달로 훅을 부른다. */
  it('검색 패널은 밝게 남는 줄을 눌린 채로 두고 포커스를 가두지 않는 비모달로 훅을 연다', () => {
    hooks.index = 0;
    const panel = nodes(SearchOverlay({ open: true, onClose: vi.fn() })).find((node) => node.props.role === 'dialog');

    expect(SEARCH_KEEP_INTERACTIVE.split(',').map((selector) => selector.trim())).toEqual(['.wc-header__bar', '.wc-utilbar', '.wc-notice-bar', '.wc-notice']);
    expect(useOverlayA11y).toHaveBeenCalledWith(expect.objectContaining({ open: true, keepInteractive: SEARCH_KEEP_INTERACTIVE, trapFocus: false }));
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

/* MD-0034 원문 "검색 활성화 / 해제 뿐만 아니라 다른 버튼도 작동 가능" — 패널이 열린 동안 밝게 보이는 유틸 메뉴·공지 띠도 눌리고, 누르면 패널이 닫힌다. */
describe('검색 패널이 열린 동안 유틸 메뉴·공지 띠 (MD-0034)', () => {
  const linkTarget = { closest: (selectors: string) => (selectors.includes('a[href]') ? {} : null) };
  const blankTarget = { closest: () => null };
  const utilbar = () => find((node) => node.type === 'nav' && node.props.className === 'wc-utilbar');
  const clickWith = (node: Element, target: unknown) => (node.props.onClick as (event: { target: unknown }) => void)({ target });

  it('유틸 메뉴의 링크·버튼을 누르면 패널이 닫히고, 빈 곳을 누르면 열린 채다', () => {
    click(searchButton());
    expect(searchOpen()).toBe(true);

    clickWith(utilbar(), blankTarget);
    expect(searchOpen()).toBe(true);

    clickWith(utilbar(), linkTarget);
    expect(searchOpen()).toBe(false);
  });

  it('공지 띠 안의 링크·닫기 버튼은 onActivate 로 패널을 닫고, 패널이 닫혀 있으면 아무것도 바꾸지 않는다', () => {
    const notices = () => find((node) => node.type === ShellNotices);
    const activate = notices().props.onActivate as () => void;

    activate();
    expect(searchOpen()).toBe(false);

    click(searchButton());
    expect(searchOpen()).toBe(true);
    (notices().props.onActivate as () => void)();
    expect(searchOpen()).toBe(false);
  });

  it('검색 패널이 아닌 오버레이(전체 메뉴 시트)는 이 신호로 닫지 않는다', () => {
    (find((node) => node.type === BottomTabBar).props.onMenuOpen as () => void)();
    const sheetOpen = () => find((node) => node.type === MenuSheet).props.open;
    expect(sheetOpen()).toBe(true);
    (find((node) => node.type === ShellNotices).props.onActivate as () => void)();
    expect(sheetOpen()).toBe(true);
  });
});

/* review-b m1·m2 — 메가메뉴(카테고리·온라인 팝업)는 검색 패널(z3) 뒤에 열리면 윗부분이 가려지고 키보드는 가려진 링크로 간다. 열릴 때 패널을 닫고,
   트리거·메가 링크를 눌러도 같은 경로 이동에서 패널이 남지 않게 닫는다. */
describe('검색 패널이 열린 채 메가메뉴 (review-b m1·m2)', () => {
  type MegaProps = { onSearchClose: () => void; children: (close: () => void) => ReactNode };
  const mega = () => find((node) => typeof node.type === 'function' && node.props.panelId === 'wc-mega-category');

  /* 메가 항목은 하위 컴포넌트라 같은 훅 대역으로 직접 돌려 (자체 상태를 가진) 트리를 얻는다. 크롬에서 컴포넌트를 꺼낸 뒤에는 대역 저장소를 비워
     메가 항목 전용으로 쓴다 — 이후 크롬을 다시 그리지 않는다. */
  function renderMega(props: MegaProps) {
    const component = mega().type as (props: unknown) => ReactNode;
    hooks.values = []; hooks.index = 0;
    const tree = nodes(component({ active: false, href: '/shop', label: '카테고리', panelId: 'wc-mega-category', pathname: '/shop', ...props }));
    const megaOpen = () => (hooks.values.find((value) => typeof value === 'object' && value !== null && 'open' in value) as { open: boolean }).open;
    return { tree, megaOpen };
  }

  it('Nav 가 두 메가 항목에 검색 패널 닫기를 건다', () => {
    click(searchButton());
    expect(searchOpen()).toBe(true);
    (mega().props.onSearchClose as () => void)();
    expect(searchOpen()).toBe(false);
  });

  it('메가메뉴가 열릴 때(hover·focus·↓) 검색 패널을 닫고, 트리거 클릭도 닫는다', () => {
    const onSearchClose = vi.fn();
    const { tree, megaOpen } = renderMega({ onSearchClose, children: () => null });
    const item = tree.find((node) => node.type === 'li') as Element;
    const trigger = tree.find((node) => node.props['aria-controls'] === 'wc-mega-category') as Element;

    expect(megaOpen()).toBe(false);
    (item.props.onMouseEnter as () => void)();
    expect(onSearchClose).toHaveBeenCalledTimes(1);
    expect(megaOpen()).toBe(true);
    (item.props.onMouseLeave as () => void)();
    expect(megaOpen()).toBe(false);
    (item.props.onFocusCapture as () => void)();
    expect(onSearchClose).toHaveBeenCalledTimes(2);
    expect(megaOpen()).toBe(true);
    expect(trigger.props.onClick).toBe(onSearchClose);
  });

  it('메가 링크가 받는 닫기 콜백은 메가를 접고 검색 패널도 닫는다', () => {
    const onSearchClose = vi.fn();
    let linkClose: (() => void) | null = null;
    const { tree, megaOpen } = renderMega({ onSearchClose, children: (close) => { linkClose = close; return null; } });
    (tree.find((node) => node.type === 'li')?.props.onMouseEnter as () => void)();
    expect(megaOpen()).toBe(true);
    onSearchClose.mockClear();

    expect(linkClose).not.toBeNull();
    (linkClose as unknown as () => void)();
    expect(onSearchClose).toHaveBeenCalledTimes(1);
    expect(megaOpen()).toBe(false);
  });
});
