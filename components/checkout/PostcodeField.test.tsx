import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POSTCODE_SCRIPT_SRC } from '@/lib/postcode';

/* 정적 마크업(실제 React)과, 검색 열기·실패·선택 흐름을 위한 훅 대체 렌더(효과를 모아 직접 돌린다)를 함께 쓴다. */
const hooks = vi.hoisted(() => ({ fake: false, states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!hooks.fake) return actual.useState(initial);
      const i = hooks.index++;
      if (!(i in hooks.states)) hooks.states[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[i]) : next; }];
    },
    useRef: (initial: unknown) => {
      if (!hooks.fake) return actual.useRef(initial);
      const i = hooks.refIndex++;
      hooks.refs[i] ??= { current: initial };
      return hooks.refs[i];
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      if (!hooks.fake) return actual.useEffect(effect, deps);
      hooks.effects.push(effect);
    },
  };
});
vi.mock('@/lib/postcode.client', () => ({ loadPostcodeSearch: mocks.load }));

import {
  POSTCODE_FAILED_MESSAGE,
  POSTCODE_MANUAL_CHOSEN_MESSAGE,
  POSTCODE_SEARCH_HINT,
  POSTCODE_SELECTION_FAILED_MESSAGE,
  PostcodeField,
  postcodeLayerMessage,
  postcodeSearchButtonLabel,
} from './PostcodeField';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap((child) => (isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []));
const text = (node: ReactNode): string => Children.toArray(node).map((child) => (isValidElement<Record<string, unknown>>(child) ? text(child.props.children as ReactNode) : String(child))).join('');

type Props = Parameters<typeof PostcodeField>[0];
function render(props: Partial<Props> = {}) {
  return renderToStaticMarkup(<PostcodeField address1="" onChange={vi.fn()} onSelect={vi.fn()} postalCode="" {...props} />);
}
const inputTag = (html: string, id: string) => html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? '';

describe('PostcodeField — 표시', () => {
  it('우편번호·기본 주소는 검색으로 채우는 잠긴 칸이고, 주소가 없으면 [주소 검색]이다', () => {
    const html = render();
    for (const id of ['checkout-postalCode', 'checkout-address1']) {
      expect(inputTag(html, id)).toContain('readOnly=""');
      expect(inputTag(html, id)).toContain('aria-describedby="checkout-address-hint"');
    }
    expect(inputTag(html, 'checkout-postalCode')).toContain('maxLength="5"');
    expect(html).toContain('for="checkout-address1">기본 주소</label>');
    expect(html).toContain('>주소 검색</button>');
    expect(html).toContain(POSTCODE_SEARCH_HINT);
    expect(html).not.toContain('role="alert"');
  });

  it('검색으로 채운 주소가 있으면 칸은 잠긴 채 [다시 검색]으로 바꾼다', () => {
    const html = render({ postalCode: '04799', address1: '서울 성동구 왕십리로 83-21' });
    expect(inputTag(html, 'checkout-postalCode')).toContain('value="04799"');
    expect(inputTag(html, 'checkout-address1')).toContain('readOnly=""');
    expect(html).toContain('>다시 검색</button>');
    expect(postcodeSearchButtonLabel(true, true)).toBe('주소 검색 닫기');
    expect(postcodeSearchButtonLabel(false, false)).toBe('주소 검색');
  });

  it('첫 렌더에 외부 스크립트를 끼워 넣지 않는다', () => {
    const html = render();
    expect(html).not.toContain(POSTCODE_SCRIPT_SRC);
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('칸 오류를 그 칸에 표시하고 안내와 함께 연결한다', () => {
    const html = render({ errors: { postalCode: '우편번호 5자리를 입력해주세요.', address1: '기본 주소를 입력해주세요.' } });
    expect(inputTag(html, 'checkout-postalCode')).toContain('aria-invalid="true"');
    expect(inputTag(html, 'checkout-postalCode')).toContain('aria-describedby="checkout-postalCode-error checkout-address-hint"');
    expect(html).toContain('id="checkout-postalCode-error"');
    expect(inputTag(html, 'checkout-address1')).toContain('aria-describedby="checkout-address1-error checkout-address-hint"');
    expect(html).toContain('기본 주소를 입력해주세요.');
  });

  /* 주소록 폼(L7)·선물·정기구독이 같은 부품을 쓸 때 — 주문서의 id 와 겹치지 않게 접두를 받는다. 기본값은 그대로다. */
  it('다른 화면은 자기 접두를 넘겨 라벨·오류·검색 레이어 연결을 함께 옮긴다', () => {
    const html = render({ idPrefix: 'address-book', errors: { postalCode: '우편번호 5자리를 입력해주세요.' } });
    expect(html).toContain('for="address-book-postalCode"');
    expect(html).toContain('for="address-book-address1"');
    expect(html).toContain('id="address-book-postalCode-error"');
    expect(html).toContain('aria-controls="address-book-postalCode-search-layer"');
    expect(html).not.toMatch(/(id|for|aria-controls)="checkout-/);
    expect(render()).toContain('aria-controls="postcode-search-layer"');
  });

  it('레이어 안 상태 문구는 불러오는 동안만 보이고, 실패 문구는 화면 문맥을 따른다', () => {
    expect(postcodeLayerMessage('loading')).toBe('주소 검색을 불러오는 중이에요.');
    expect(postcodeLayerMessage('ready')).toBeNull();
    expect(postcodeLayerMessage('failed')).toBe(POSTCODE_FAILED_MESSAGE);
    expect(POSTCODE_FAILED_MESSAGE).toContain('직접 입력해도 주문할 수 있어요');
    expect(postcodeLayerMessage('failed', '배송지 문구')).toBe('배송지 문구');
  });
});

describe('PostcodeField — 검색 흐름', () => {
  const focused: string[] = [];
  let props: Props;
  const renderFake = () => { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return PostcodeField(props); };
  const find = (predicate: (node: Element) => boolean) => all(renderFake()).find(predicate)!;
  const searchButton = () => find((node) => node.type === 'button' && node.props.className === 'btn btn-ghost postcode-field-open');
  const manualButton = () => all(renderFake()).find((node) => node.type === 'button' && node.props.className === 'postcode-field-manual');
  const field = (id: string) => find((node) => node.type === 'input' && node.props.id === id);
  /* 검색을 연 뒤의 효과를 돌린다(임베드 대상 노드는 가짜로 둔다). */
  const openAndLoad = async () => {
    (searchButton().props.onClick as () => void)();
    renderFake();
    hooks.refs[0].current = {};
    for (const effect of hooks.effects) effect();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    hooks.fake = true;
    hooks.states = [];
    hooks.refs = [];
    focused.length = 0;
    mocks.load.mockReset();
    props = { address1: '', onChange: vi.fn(), onSelect: vi.fn(), postalCode: '' };
    vi.stubGlobal('window', { requestAnimationFrame: (callback: (time: number) => void) => { callback(0); return 0; } });
    vi.stubGlobal('document', { getElementById: (id: string) => ({ focus: () => { focused.push(id); } }) });
  });
  afterEach(() => {
    hooks.fake = false;
    vi.unstubAllGlobals();
  });

  it('검색을 열지 못하면 레이어를 걷고 손 입력을 열어 우편번호 칸으로 간다', async () => {
    mocks.load.mockRejectedValue(new Error('blocked'));
    await openAndLoad();
    expect(field('checkout-postalCode').props.readOnly).toBe(false);
    expect(field('checkout-address1').props.readOnly).toBe(false);
    expect(searchButton().props['aria-expanded']).toBe(false);
    expect(text(renderFake())).toContain(POSTCODE_FAILED_MESSAGE);
    expect(find((node) => node.props.role === 'alert').props.id).toBe('checkout-address-hint');
    expect(focused).toEqual(['checkout-postalCode']);
    (field('checkout-address1').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '서울' } });
    expect(props.onChange).toHaveBeenCalledWith('address1', '서울');
  });

  it('고른 결과는 공동주택 여부와 함께 넘기고 칸은 잠긴 채 둔다', async () => {
    let options: { oncomplete: (selection: unknown) => void } | null = null;
    mocks.load.mockResolvedValue(class { constructor(value: typeof options) { options = value; } embed() {} });
    await openAndLoad();
    options!.oncomplete({ zonecode: '04799', roadAddress: '서울 성동구 왕십리로 83-21', jibunAddress: '', userSelectedType: 'R', bname: '', buildingName: '', apartment: 'Y' });
    expect(props.onSelect).toHaveBeenCalledWith({ postalCode: '04799', address1: '서울 성동구 왕십리로 83-21', apartment: true });
    expect(field('checkout-postalCode').props.readOnly).toBe(true);
    expect(searchButton().props['aria-expanded']).toBe(false);
  });

  it('고른 결과를 옮기지 못하면 손 입력을 열고 그 까닭을 알린다', async () => {
    let options: { oncomplete: (selection: unknown) => void } | null = null;
    mocks.load.mockResolvedValue(class { constructor(value: typeof options) { options = value; } embed() {} });
    await openAndLoad();
    options!.oncomplete({ zonecode: '123', roadAddress: '서울', jibunAddress: '', userSelectedType: 'R', bname: '', buildingName: '', apartment: 'N' });
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(field('checkout-postalCode').props.readOnly).toBe(false);
    expect(text(renderFake())).toContain(POSTCODE_SELECTION_FAILED_MESSAGE);
  });

  /* 스크립트는 떴지만 레이어 안 검색 화면(교차 출처 iframe)이 막히거나 멈추면 이쪽에서 알 수 없다 — 고객이 고르는 탈출구를 둔다. */
  it('검색 레이어가 열려 있는 동안 [검색이 안 되면 직접 입력]으로 손 입력을 연다', async () => {
    expect(manualButton()).toBeUndefined();
    mocks.load.mockResolvedValue(class { embed() {} });
    await openAndLoad();
    expect(field('checkout-postalCode').props.readOnly).toBe(true);
    (manualButton()!.props.onClick as () => void)();
    expect(field('checkout-postalCode').props.readOnly).toBe(false);
    expect(field('checkout-address1').props.readOnly).toBe(false);
    expect(searchButton().props['aria-expanded']).toBe(false);
    expect(text(renderFake())).toContain(POSTCODE_MANUAL_CHOSEN_MESSAGE);
    expect(focused).toEqual(['checkout-postalCode']);
    /* 손 입력이 열린 뒤에 다시 검색을 열어도 탈출구는 더 보이지 않는다. */
    (searchButton().props.onClick as () => void)();
    expect(manualButton()).toBeUndefined();
  });

  it('잠긴 빈 칸을 누르면 검색을 열고, 손 입력이 열린 칸은 누른다고 열지 않는다', async () => {
    (field('checkout-address1').props.onClick as () => void)();
    expect(searchButton().props['aria-expanded']).toBe(true);
    (searchButton().props.onClick as () => void)();
    mocks.load.mockRejectedValue(new Error('blocked'));
    await openAndLoad();
    (field('checkout-address1').props.onClick as () => void)();
    expect(searchButton().props['aria-expanded']).toBe(false);
  });
});
