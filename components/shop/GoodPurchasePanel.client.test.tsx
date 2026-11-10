import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 재입고 신청이 바뀐 판매 상태로 거절된 뒤의 표면 동작 — jsdom 없이 훅을 얇게 흉내 내 컴포넌트 함수를 직접
   부르고 effect 를 의존성 비교로 손수 돌린다(선례: components/campaign/CampaignMoreList.client.test.tsx). */

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as { effect: () => void | (() => void); deps?: unknown[] }[],
  previousDeps: [] as (unknown[] | undefined)[],
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      const set = (next: unknown) => {
        hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next;
      };
      return [hooks.states[index], set];
    },
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      if (!(index in hooks.refs)) hooks.refs[index] = { current: initial };
      return hooks.refs[index];
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      hooks.effects.push({ effect, deps });
    },
  };
});

vi.mock('@/components/shell/CartProvider', () => ({ useCart: () => ({}) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/shop/g11', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/components/shop/RestockCta', () => ({ RestockCta: () => null }));

import { RestockCta } from '@/components/shop/RestockCta';
import type { Good, GoodOption } from '@/lib/data';
import { GoodBuyBars, GoodPurchasePanel, type GoodPurchaseController } from './GoodPurchasePanel';

const STALE = '판매 상태가 바뀌었어요. 지금 상태를 확인해주세요.';
const optionA: GoodOption = { id: 'a', name: '옵션 A', code: 'A', price: 26000, stockQty: 20, isDefault: true, attributes: {} };
const optionB: GoodOption = { id: 'b', name: '옵션 B', code: 'B', price: 28000, stockQty: 0, isDefault: false, attributes: {} };
const good: Good = { id: 'g11', name: '리바이 아크릴 스탠드', ip: 'ip', type: '아크릴', price: 26000, priceMax: 28000, badge: null, stock: 'ok', stockQty: 20, img: '', options: [optionA, optionB] };

function controller(overrides: Partial<GoodPurchaseController> = {}): GoodPurchaseController {
  return {
    good, selectedOption: undefined, restockOption: optionB, selectOption: vi.fn(), selectionRequired: true, quantity: 1, setQuantity: vi.fn(),
    subtotal: 0, soldOut: false, restockRequested: false, restockVariantIds: [], disabled: false, inert: true, message: null,
    addToCart: vi.fn(), buyNow: vi.fn(), ...overrides,
  };
}

/* 같은 위치의 effect 를 이전 의존성과 비교해 바뀐 것만 돌린다(React 의 커밋 뒤 effect 와 같은 규칙). */
function render(tree: () => ReactNode) {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects = [];
  const result = tree();
  return { result, commit: () => hooks.effects.forEach(({ effect, deps }, index) => {
    const previous = hooks.previousDeps[index];
    if (!deps || !previous || deps.some((dep, at) => !Object.is(dep, previous[at]))) effect();
    hooks.previousDeps[index] = deps;
  }) };
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}

const restockCta = (tree: ReactNode) => elements(tree).find((element) => element.type === RestockCta)!;
const statusText = (tree: ReactNode) => {
  const status = elements(tree).find((element) => element.props.role === 'status')!;
  return (status.props.children as ReactNode) ?? '';
};

const body = { tagName: 'BODY' };
let focused: string[] = [];
const fakeRoot = (available: Record<string, string>) => ({
  querySelector: (selector: string) => (selector in available ? { focus: () => focused.push(available[selector]) } : null),
});

beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  hooks.previousDeps = [];
  focused = [];
  vi.stubGlobal('document', { activeElement: body, body });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('재입고 신청이 바뀐 판매 상태로 거절된 뒤 (리뷰 l2-ui-2·3)', () => {
  it('패널 상태 줄이 이유를 들고, 신청 버튼이 담기·구매로 바뀌면 포커스를 잃은 채인 포커스를 새 CTA 로 옮긴다', () => {
    let frame = render(() => GoodPurchasePanel({ purchase: controller() }));
    frame.commit();
    (restockCta(frame.result).props.onStaleState as (text: string) => void)(STALE);

    frame = render(() => GoodPurchasePanel({ purchase: controller() }));
    frame.commit();
    expect(statusText(frame.result)).toBe(STALE);
    expect(focused).toEqual([]);

    /* 화면을 다시 받았다 — 옵션 B 가 재입고돼 담기·구매가 돌아왔다. 버튼이 사라져 포커스는 body 에 있다. */
    hooks.refs[0].current = fakeRoot({ '.wc-buy-panel__ctas button:not([disabled])': '장바구니', 'select:not([disabled])': '옵션' });
    const restocked = controller({ restockOption: undefined, selectedOption: { ...optionB, stockQty: 3 }, selectionRequired: false, inert: false, subtotal: 28000 });
    frame = render(() => GoodPurchasePanel({ purchase: restocked }));
    frame.commit();
    expect(focused).toEqual(['장바구니']);
    expect(statusText(frame.result)).toBe(STALE);

    /* 한 번만 옮긴다. */
    frame = render(() => GoodPurchasePanel({ purchase: controller() }));
    frame.commit();
    frame = render(() => GoodPurchasePanel({ purchase: restocked }));
    frame.commit();
    expect(focused).toEqual(['장바구니']);
  });

  it('사용자가 이미 다른 곳에 포커스를 두었으면 옮기지 않는다', () => {
    let frame = render(() => GoodPurchasePanel({ purchase: controller() }));
    frame.commit();
    (restockCta(frame.result).props.onStaleState as (text: string) => void)(STALE);
    hooks.refs[0].current = fakeRoot({ '.wc-buy-panel__ctas button:not([disabled])': '장바구니' });
    vi.stubGlobal('document', { activeElement: { tagName: 'A' }, body });

    frame = render(() => GoodPurchasePanel({ purchase: controller({ restockOption: undefined, selectedOption: { ...optionB, stockQty: 3 } }) }));
    frame.commit();
    expect(focused).toEqual([]);
  });

  it('CTA 가 비활성이면(고를 옵션이 사라짐) 옵션 셀렉트로 옮긴다', () => {
    let frame = render(() => GoodPurchasePanel({ purchase: controller() }));
    frame.commit();
    (restockCta(frame.result).props.onStaleState as (text: string) => void)(STALE);
    hooks.refs[0].current = fakeRoot({ 'select:not([disabled])': '옵션' });

    frame = render(() => GoodPurchasePanel({ purchase: controller({ restockOption: undefined }) }));
    frame.commit();
    expect(focused).toEqual(['옵션']);
  });

  /* 상태 줄은 패널 하나의 live region 이다 — 다음 문구(담기 결과·카트 오류)가 오면 지난 거절 안내는 물러난다. */
  it('다음 상태 문구가 오거나 옵션을 바꾸면 거절 안내를 지운다', () => {
    let frame = render(() => GoodPurchasePanel({ purchase: controller() }));
    frame.commit();
    (restockCta(frame.result).props.onStaleState as (text: string) => void)(STALE);
    frame = render(() => GoodPurchasePanel({ purchase: controller({ message: '장바구니에 담았어요.' }) }));
    frame = render(() => GoodPurchasePanel({ purchase: controller({ message: '장바구니에 담았어요.' }) }));
    expect(statusText(frame.result)).toBe('장바구니에 담았어요.');
    frame = render(() => GoodPurchasePanel({ purchase: controller() }));
    expect(statusText(frame.result)).toBe('');

    (restockCta(frame.result).props.onStaleState as (text: string) => void)(STALE);
    frame = render(() => GoodPurchasePanel({ purchase: controller() }));
    expect(statusText(frame.result)).toBe(STALE);
    const select = elements(frame.result).find((element) => element.type === 'select')!;
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'a' } });
    frame = render(() => GoodPurchasePanel({ purchase: controller() }));
    expect(statusText(frame.result)).toBe('');
  });

  /* 모든 옵션 품절 때 바의 신청 버튼도 같다 — 굿즈가 다시 판매되면 바가 [카트][구매하기] 트리거로 바뀐다. */
  it('모바일 바에서 신청한 거절도 바의 상태 줄이 들고 포커스를 바의 새 트리거로 옮긴다', () => {
    const soldOut = controller({ good: { ...good, stock: 'soldout', stockQty: 0 }, soldOut: true, restockOption: optionB });
    let frame = render(() => GoodBuyBars({ onOpenSheet: vi.fn(), purchase: soldOut, sheetOpen: false }));
    frame.commit();
    expect(restockCta(frame.result).props.compact).toBe(true);
    (restockCta(frame.result).props.onStaleState as (text: string) => void)(STALE);

    hooks.refs[0].current = fakeRoot({ 'button:not([disabled])': '장바구니에 담기' });
    frame = render(() => GoodBuyBars({ onOpenSheet: vi.fn(), purchase: controller({ restockOption: undefined, selectedOption: optionA }), sheetOpen: false }));
    frame.commit();
    expect(focused).toEqual(['장바구니에 담기']);
    expect(statusText(frame.result)).toBe(STALE);
  });
});

/*
 * 시트를 연 바 버튼이 시트가 열린 동안 바뀐 뒤 시트를 닫으면(QA l2-qa-1) — 바는 고른 옵션의 품절 여부로 [카트][구매하기]와
 * 벨 트리거를 서로 다른 버튼으로 갈아 끼운다. 시트의 포커스 복귀는 빠진 버튼을 겨눠 body 로 떨어지므로, 바가 그 자리의 새
 * 버튼으로 옮긴다. 바의 버튼은 className 으로 고르고, 문서에서 빠졌는지는 isConnected 로 흉내 낸다.
 */
describe('시트를 연 바 버튼이 바뀐 뒤 닫힐 때의 포커스 복귀 (QA l2-qa-1)', () => {
  const buyable = () => controller({ restockOption: undefined, selectedOption: optionA, selectionRequired: false, inert: false, subtotal: 26000 });
  const barButton = (tree: ReactNode, className: string) => elements(tree).find((element) => element.type === 'button' && element.props.className === className)!;
  const opener = (className: string) => ({ isConnected: true, classList: { contains: (name: string) => className.split(' ').includes(name) } });

  /* 바를 그리고 버튼을 눌러 시트를 연 뒤, 시트가 열린 동안 연 버튼이 문서에서 빠졌다고 두고 닫는다. */
  function openThenClose(start: GoodPurchaseController, className: string, after: GoodPurchaseController, bar: Record<string, string>, connected = false) {
    const onOpenSheet = vi.fn();
    let frame = render(() => GoodBuyBars({ onOpenSheet, purchase: start, sheetOpen: false }));
    frame.commit();
    const target = opener(className);
    (barButton(frame.result, className).props.onClick as (event: { currentTarget: unknown }) => void)({ currentTarget: target });
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
    frame = render(() => GoodBuyBars({ onOpenSheet, purchase: start, sheetOpen: true }));
    frame.commit();
    target.isConnected = connected;
    hooks.refs[0].current = fakeRoot(bar);
    frame = render(() => GoodBuyBars({ onOpenSheet, purchase: after, sheetOpen: false }));
    frame.commit();
    return frame;
  }

  it('구매하기로 연 시트에서 품절 옵션을 고르고 닫으면 그 자리의 벨 트리거로 돌아간다', () => {
    openThenClose(buyable(), 'wc-buybar__buy', controller(), { '.wc-buybar__restock button:not([disabled])': '재입고 알림 받기', 'button:not([disabled])': '재입고 알림 받기' });
    expect(focused).toEqual(['재입고 알림 받기']);
  });

  it('카트로 연 시트에서 품절 옵션을 고르면 카트 존이 없으니 벨 트리거로 돌아간다', () => {
    openThenClose(buyable(), 'wc-buybar__cart', controller(), { '.wc-buybar__restock button:not([disabled])': '재입고 알림 받기' });
    expect(focused).toEqual(['재입고 알림 받기']);
  });

  it('벨로 연 시트에서 판매 중인 옵션을 고르거나 그 사이 재입고되면 주 버튼(구매하기)으로 돌아간다', () => {
    openThenClose(controller(), 'wc-btn primary', buyable(), { '.wc-buybar__buy:not([disabled])': '구매하기', 'button:not([disabled])': '장바구니에 담기' });
    expect(focused).toEqual(['구매하기']);
  });

  /* 카트 → 품절 옵션 → 판매 중인 옵션: 바가 두 번 바뀌어 처음 카트도 빠졌다 — 새 카트가 그 자리다. */
  it('카트로 열었으면 새로 생긴 카트로 돌아간다', () => {
    openThenClose(buyable(), 'wc-buybar__cart', buyable(), { '.wc-buybar__cart:not([disabled])': '장바구니에 담기', '.wc-buybar__buy:not([disabled])': '구매하기' });
    expect(focused).toEqual(['장바구니에 담기']);
  });

  it('연 버튼이 남아 있으면 시트의 복귀에 맡기고 옮기지 않는다', () => {
    openThenClose(buyable(), 'wc-buybar__buy', buyable(), { '.wc-buybar__buy:not([disabled])': '구매하기' }, true);
    expect(focused).toEqual([]);
  });

  it('포커스가 이미 다른 곳에 있으면 옮기지 않는다', () => {
    vi.stubGlobal('document', { activeElement: { tagName: 'BUTTON' }, body });
    openThenClose(buyable(), 'wc-buybar__buy', controller(), { '.wc-buybar__restock button:not([disabled])': '재입고 알림 받기' });
    expect(focused).toEqual([]);
  });

  it('닫힌 뒤 한 번만 옮기고, 바에 누를 버튼이 없으면(판매 불가로 바뀜) 아무 데도 옮기지 않는다', () => {
    const onOpenSheet = vi.fn();
    openThenClose(buyable(), 'wc-buybar__buy', controller(), { '.wc-buybar__restock button:not([disabled])': '재입고 알림 받기' });
    expect(focused).toEqual(['재입고 알림 받기']);
    let frame = render(() => GoodBuyBars({ onOpenSheet, purchase: controller(), sheetOpen: true }));
    frame.commit();
    frame = render(() => GoodBuyBars({ onOpenSheet, purchase: controller(), sheetOpen: false }));
    frame.commit();
    expect(focused).toEqual(['재입고 알림 받기']);

    focused = [];
    openThenClose(buyable(), 'wc-buybar__buy', controller({ unavailableLabel: '판매 종료' }), {});
    expect(focused).toEqual([]);
  });
});
