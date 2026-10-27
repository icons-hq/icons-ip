import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressBookEntry } from '@/lib/address-book';
import type { CheckoutAddress } from '@/lib/checkout';

/* 정적 마크업(실제 React)과, 저장 흐름을 위한 훅 대체 렌더(GoodsTransactionCheckout.client.test 와 같은 방식)를 함께 쓴다. */
const hooks = vi.hoisted(() => ({ fake: false, states: [] as unknown[], index: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
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
  };
});
vi.mock('@/app/my/addresses/actions', () => ({ saveAddressBookEntryAction: mocks.save }));

import { CheckoutAddressBook, type CheckoutAddressBookProps } from './CheckoutAddressBook';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap((child) => (isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []));
const text = (node: ReactNode): string => Children.toArray(node).map((child) => (isValidElement<Record<string, unknown>>(child) ? text(child.props.children as ReactNode) : String(child))).join('');

const home: AddressBookEntry = {
  id: '7a570000-0000-4000-8000-000000000001', label: '집', recipientName: '홍길동', phone: '01012345678',
  postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동', isDefault: true,
};
const typed: CheckoutAddress = { recipientName: '김팬', phone: '010-9999-8888', postalCode: '06236', address1: '서울 강남구 테헤란로 152', address2: '', deliveryNote: '문 앞' };

let props: CheckoutAddressBookProps;
function renderFake() { hooks.index = 0; return CheckoutAddressBook(props); }
function find(tree: ReactNode, predicate: (node: Element) => boolean) { return all(tree).find(predicate); }

beforeEach(() => {
  hooks.fake = false;
  hooks.states = [];
  mocks.save.mockReset();
  props = { address: typed, book: [home], onPick: vi.fn() };
});

describe('CheckoutAddressBook — 표시', () => {
  it('주소록을 읽지 못했으면 아무것도 그리지 않는다(직접 입력은 그대로)', () => {
    expect(renderToStaticMarkup(<CheckoutAddressBook {...props} book={null} />)).toBe('');
  });

  it('주소록이 비면 고르기 없이 저장 권유와 배송지 관리 링크만 둔다', () => {
    const html = renderToStaticMarkup(<CheckoutAddressBook {...props} book={[]} />);
    expect(html).not.toContain('<select');
    expect(html).toContain('이 배송지를 주소록에 저장');
    expect(html).toContain('href="/my/addresses"');
  });

  it('폼 값이 주소록 배송지와 같으면 그 항목을 고른 상태로 보이고 다시 저장하자고 하지 않는다', () => {
    const html = renderToStaticMarkup(<CheckoutAddressBook {...props} address={{ ...typed, recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동' }} />);
    expect(html).toMatch(new RegExp(`<option value="${home.id}" selected="">집 \\(기본\\) · \\(04524\\) 서울 중구 세종대로 110 101동</option>`));
    expect(html).toContain('<option value="">새 배송지 입력</option>');
    expect(html).not.toContain('이 배송지를 주소록에 저장');
  });

  it('직접 입력 중이면 "직접 입력한 배송지"가 선택돼 있고 저장을 권한다', () => {
    const html = renderToStaticMarkup(<CheckoutAddressBook {...props} />);
    expect(html).toContain('<option value="" selected="">직접 입력한 배송지</option>');
    expect(html).toContain('이 배송지를 주소록에 저장');
  });

  it('주소록이 가득 차면 저장 대신 정리 안내를 한다', () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ ...home, id: `7a570000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`, isDefault: index === 0, address1: `서울 ${index}` }));
    const html = renderToStaticMarkup(<CheckoutAddressBook {...props} book={ten} />);
    expect(html).not.toContain('이 배송지를 주소록에 저장');
    expect(html).toContain('주소록이 가득 찼어요(최대 10개)');
  });
});

describe('CheckoutAddressBook — 고르기·저장', () => {
  const focus = vi.fn();
  beforeEach(() => {
    hooks.fake = true;
    focus.mockReset();
    vi.stubGlobal('window', { requestAnimationFrame: (callback: (time: number) => void) => { callback(0); return 0; } });
    vi.stubGlobal('document', { getElementById: (id: string) => (id === 'checkout-address-book-label' ? { focus } : null) });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('고르면 그 항목을, 새 배송지 입력을 고르면 null 을 주문서에 넘긴다', () => {
    const select = find(renderFake(), (node) => node.type === 'select')!;
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: home.id } });
    expect(props.onPick).toHaveBeenLastCalledWith(home);
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '' } });
    expect(props.onPick).toHaveBeenLastCalledWith(null);
  });

  it('이름 칸의 Enter 는 주문 제출로 새지 않고 지금 폼 배송지를 주소록에 저장한다(배송 메모 제외)', async () => {
    const saved = '7a570000-0000-4000-8000-000000000009';
    mocks.save.mockResolvedValue({ ok: true, entries: [home, { ...home, id: saved, label: '회사', isDefault: false }], savedId: saved });
    (find(renderFake(), (node) => node.type === 'button' && text(node.props.children as ReactNode) === '이 배송지를 주소록에 저장')!.props.onClick as () => void)();
    expect(focus).toHaveBeenCalledTimes(1);
    const label = find(renderFake(), (node) => node.type === 'input' && node.props.id === 'checkout-address-book-label')!;
    (label.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '회사' } });
    const preventDefault = vi.fn();
    (find(renderFake(), (node) => node.props.id === 'checkout-address-book-label')!.props.onKeyDown as (event: { key: string; preventDefault(): void }) => void)({ key: 'Enter', preventDefault });
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));

    expect(preventDefault).toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(null, { label: '회사', recipientName: '김팬', phone: '010-9999-8888', postalCode: '06236', address1: '서울 강남구 테헤란로 152', address2: '', makeDefault: false });
    await vi.waitFor(() => expect(text(renderFake())).toContain('주소록에 저장했어요.'));
    expect(find(renderFake(), (node) => node.type === 'select')).toBeDefined();
  });

  it('배송지 칸이 덜 채워졌으면 서버를 부르지 않고 무엇을 확인할지 알린다', async () => {
    props = { ...props, address: { ...typed, postalCode: '' } };
    (find(renderFake(), (node) => node.type === 'button' && text(node.props.children as ReactNode) === '이 배송지를 주소록에 저장')!.props.onClick as () => void)();
    (find(renderFake(), (node) => node.props.id === 'checkout-address-book-label')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '집' } });
    await (find(renderFake(), (node) => node.type === 'button' && text(node.props.children as ReactNode) === '주소록에 저장')!.props.onClick as () => Promise<void> | void)();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(text(renderFake())).toContain('받는 분, 연락처, 우편번호, 기본 주소를 먼저 확인해주세요.');
  });

  it('저장은 됐지만 목록을 다시 읽지 못했으면 방금 저장한 배송지로 이어 그린다(중복 저장 방지)', async () => {
    const saved = '7a570000-0000-4000-8000-000000000010';
    mocks.save.mockResolvedValue({ ok: true, entries: null, savedId: saved });
    props = { ...props, book: [] };
    (find(renderFake(), (node) => node.type === 'button' && text(node.props.children as ReactNode) === '이 배송지를 주소록에 저장')!.props.onClick as () => void)();
    (find(renderFake(), (node) => node.props.id === 'checkout-address-book-label')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '집' } });
    await (find(renderFake(), (node) => node.type === 'button' && text(node.props.children as ReactNode) === '주소록에 저장')!.props.onClick as () => Promise<void> | void)();
    await vi.waitFor(() => expect(text(renderFake())).toContain('주소록에 저장했어요.'));
    const options = all(renderFake()).filter((node) => node.type === 'option').map((node) => node.props.value);
    expect(options).toEqual(['', saved]);
    /* 첫 배송지라 기본 배송지가 된다. */
    expect(mocks.save).toHaveBeenCalledWith(null, expect.objectContaining({ makeDefault: true }));
  });
});
