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
