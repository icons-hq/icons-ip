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

import { CheckoutAddressBook, checkoutAddressBookEnterSaves, checkoutAddressBookFieldsCopy, type CheckoutAddressBookProps } from './CheckoutAddressBook';

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

  it('같은 배송지를 두 이름으로 저장했어도 처음에는 기본 배송지(목록 첫 항목)를 고른 상태로 보인다', () => {
    const twin = { ...home, id: '7a570000-0000-4000-8000-000000000002', label: '본가', isDefault: false };
    const html = renderToStaticMarkup(<CheckoutAddressBook {...props} address={{ ...typed, recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동' }} book={[home, twin]} />);
    expect(html).toMatch(new RegExp(`<option value="${home.id}" selected="">`));
    expect(html).not.toMatch(new RegExp(`<option value="${twin.id}" selected="">`));
  });

  it('주소록이 가득 차면 저장 대신 정리 안내를 한다', () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ ...home, id: `7a570000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`, isDefault: index === 0, address1: `서울 ${index}` }));
    const html = renderToStaticMarkup(<CheckoutAddressBook {...props} book={ten} />);
    expect(html).not.toContain('이 배송지를 주소록에 저장');
    expect(html).toContain('주소록이 가득 찼어요(최대 10개)');
  });
});

describe('CheckoutAddressBook — 키 처리·오류 문구', () => {
  it('저장 묶음의 Enter 는 이름 칸·체크박스에서 저장으로 돌리고, 버튼·IME 조합 중에는 건드리지 않는다', () => {
    expect(checkoutAddressBookEnterSaves('Enter', 'INPUT')).toBe(true);
    expect(checkoutAddressBookEnterSaves('Enter', 'INPUT', true)).toBe(false);
    expect(checkoutAddressBookEnterSaves('Enter', 'BUTTON')).toBe(false);
    expect(checkoutAddressBookEnterSaves(' ', 'INPUT')).toBe(false);
    expect(checkoutAddressBookEnterSaves('Tab', 'INPUT')).toBe(false);
  });

  it('틀린 배송지 칸 이름만 알린다(입력값은 싣지 않는다)', () => {
    expect(checkoutAddressBookFieldsCopy({ phone: '연락처를 확인해주세요.' })).toBe('주소록에 저장하기 전에 연락처 칸을 확인해주세요.');
    expect(checkoutAddressBookFieldsCopy({ address1: 'x', postalCode: 'y' })).toBe('주소록에 저장하기 전에 우편번호·기본 주소 칸을 확인해주세요.');
  });
});

describe('CheckoutAddressBook — 고르기·저장', () => {
  const focused: string[] = [];
  beforeEach(() => {
    hooks.fake = true;
    focused.length = 0;
    vi.stubGlobal('window', { requestAnimationFrame: (callback: (time: number) => void) => { callback(0); return 0; } });
    vi.stubGlobal('document', { getElementById: (id: string) => ({ focus: () => { focused.push(id); } }) });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const group = () => find(renderFake(), (node) => node.props.role === 'group')!;
  const enter = (tagName: string) => {
    const preventDefault = vi.fn();
    (group().props.onKeyDown as (event: unknown) => void)({ key: 'Enter', target: { tagName }, nativeEvent: { isComposing: false }, preventDefault });
    return preventDefault;
  };
  const openSave = (value: string) => {
    (find(renderFake(), (node) => node.type === 'button' && text(node.props.children as ReactNode) === '이 배송지를 주소록에 저장')!.props.onClick as () => void)();
    (find(renderFake(), (node) => node.props.id === 'checkout-address-book-label')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  };

  it('고르면 그 항목을, 새 배송지 입력을 고르면 null 을 주문서에 넘긴다', () => {
    const select = find(renderFake(), (node) => node.type === 'select')!;
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: home.id } });
    expect(props.onPick).toHaveBeenLastCalledWith(home);
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '' } });
    expect(props.onPick).toHaveBeenLastCalledWith(null);
  });

  it('이름 칸의 Enter 는 주문 제출로 새지 않고 지금 폼 배송지를 주소록에 저장한 뒤 select 로 포커스를 옮긴다(배송 메모 제외)', async () => {
    const saved = '7a570000-0000-4000-8000-000000000009';
    mocks.save.mockResolvedValue({ ok: true, entries: [home, { ...home, id: saved, label: '회사', isDefault: false }], savedId: saved });
    openSave('회사');
    expect(focused).toEqual(['checkout-address-book-label']);
    const preventDefault = enter('INPUT');
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));

    expect(preventDefault).toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(null, { label: '회사', recipientName: '김팬', phone: '010-9999-8888', postalCode: '06236', address1: '서울 강남구 테헤란로 152', address2: '', makeDefault: false });
    await vi.waitFor(() => expect(text(renderFake())).toContain('주소록에 저장했어요.'));
    expect(find(renderFake(), (node) => node.type === 'select')).toBeDefined();
    /* 저장 묶음이 사라져도 키보드 위치를 잃지 않는다. */
    expect(focused.at(-1)).toBe('checkout-address-book');
  });

  it('기본 배송지 체크박스의 Enter 도 주문 제출이 아니라 저장이다', async () => {
    const saved = '7a570000-0000-4000-8000-000000000011';
    mocks.save.mockResolvedValue({ ok: true, entries: [home, { ...home, id: saved, label: '본가', isDefault: true }], savedId: saved });
    openSave('본가');
    (find(renderFake(), (node) => node.type === 'input' && node.props.type === 'checkbox')!.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    const preventDefault = enter('INPUT');
    expect(preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledWith(null, expect.objectContaining({ label: '본가', makeDefault: true })));
  });

  it('버튼 위의 Enter 는 그 버튼의 클릭에 맡긴다(가로채지 않는다)', () => {
    openSave('본가');
    expect(enter('BUTTON')).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('취소하면 저장 묶음을 닫고 저장 버튼으로 포커스를 돌린다', () => {
    openSave('본가');
    (find(renderFake(), (node) => node.type === 'button' && text(node.props.children as ReactNode) === '취소')!.props.onClick as () => void)();
    expect(find(renderFake(), (node) => node.props.role === 'group')).toBeUndefined();
    expect(focused.at(-1)).toBe('checkout-address-book-save-toggle');
    expect(find(renderFake(), (node) => node.props.id === 'checkout-address-book-save-toggle')).toBeDefined();
  });

  it('배송지 칸이 틀렸으면 서버를 부르지 않고 그 칸을 알려 주문서 칸 오류로 올리고 첫 칸으로 포커스를 옮긴다', async () => {
    const onAddressErrors = vi.fn();
    props = { ...props, address: { ...typed, phone: '010-12', postalCode: '' }, onAddressErrors };
    openSave('집');
    await (find(renderFake(), (node) => node.type === 'button' && text(node.props.children as ReactNode) === '주소록에 저장')!.props.onClick as () => Promise<void> | void)();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(text(renderFake())).toContain('주소록에 저장하기 전에 연락처·우편번호 칸을 확인해주세요.');
    expect(onAddressErrors).toHaveBeenCalledWith({ phone: expect.any(String), postalCode: '우편번호 5자리를 입력해주세요.' });
    expect(focused.at(-1)).toBe('checkout-phone');
  });

  it('같은 배송지가 두 이름으로 있으면 마지막으로 고른 항목을 고른 상태로 둔다', () => {
    const twin = { ...home, id: '7a570000-0000-4000-8000-000000000002', label: '본가', isDefault: false };
    const same = { ...typed, recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동' };
    props = { ...props, address: same, book: [home, twin] };
    expect(find(renderFake(), (node) => node.type === 'select')!.props.value).toBe(home.id);
    (find(renderFake(), (node) => node.type === 'select')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: twin.id } });
    expect(props.onPick).toHaveBeenLastCalledWith(twin);
    expect(find(renderFake(), (node) => node.type === 'select')!.props.value).toBe(twin.id);
  });

  it('저장은 됐지만 목록을 다시 읽지 못했으면 방금 저장한 배송지로 이어 그린다(중복 저장 방지)', async () => {
    const saved = '7a570000-0000-4000-8000-000000000010';
    mocks.save.mockResolvedValue({ ok: true, entries: null, savedId: saved });
    props = { ...props, book: [] };
    openSave('집');
    await (find(renderFake(), (node) => node.type === 'button' && text(node.props.children as ReactNode) === '주소록에 저장')!.props.onClick as () => Promise<void> | void)();
    await vi.waitFor(() => expect(text(renderFake())).toContain('주소록에 저장했어요.'));
    const options = all(renderFake()).filter((node) => node.type === 'option').map((node) => node.props.value);
    expect(options).toEqual(['', saved]);
    /* 첫 배송지라 기본 배송지가 된다. */
    expect(mocks.save).toHaveBeenCalledWith(null, expect.objectContaining({ makeDefault: true }));
  });
});
