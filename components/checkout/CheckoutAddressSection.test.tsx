import { Children, isValidElement, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressBookEntry } from '@/lib/address-book';
import type { CheckoutAddress, CheckoutAddressErrors } from '@/lib/checkout';
import type { CheckoutAddressMode } from '@/lib/checkout-address-entry';

/* 정적 마크업(실제 React)과, 시트·검색 흐름을 위한 훅 대체 렌더를 함께 쓴다. */
const hooks = vi.hoisted(() => ({ fake: false, states: [] as unknown[], index: 0 }));
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
vi.mock('@/app/my/addresses/actions', () => ({ saveAddressBookEntryAction: vi.fn() }));

import { CheckoutAddressPicker } from './CheckoutAddressPicker';
import { CheckoutAddressSection, CheckoutAddressSaveOption, type CheckoutAddressSectionProps } from './CheckoutAddressSection';
import { PostcodeField } from './PostcodeField';
import type { CheckoutAddressEntryState } from './useCheckoutAddressEntry';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap((child) => (isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []));

const home: AddressBookEntry = {
  id: '7a570000-0000-4000-8000-000000000001', label: '집', recipientName: '홍길동', phone: '01012345678',
  postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동', isDefault: true,
};
const office: AddressBookEntry = { ...home, id: '7a570000-0000-4000-8000-000000000002', label: '회사', recipientName: '김회사', address1: '서울 강남구 테헤란로 152', address2: null, isDefault: false };
const homeAddress: CheckoutAddress = { recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동', deliveryNote: '문 앞' };
const recent: CheckoutAddress = { recipientName: '김팬', phone: '0311234567', postalCode: '06236', address1: '서울 강남구 테헤란로 152', address2: '', deliveryNote: '' };

/* 주문서가 들고 있는 상태를 흉내 낸다 — 세터는 값을 바로 바꾼다. */
function makeEntry(patch: Partial<Pick<CheckoutAddressEntryState, 'book' | 'mode' | 'pickedId' | 'saveToBook' | 'saveLabel' | 'apartment'>> = {}): CheckoutAddressEntryState {
  const state = { book: [home, office] as AddressBookEntry[] | null, mode: 'summary' as CheckoutAddressMode, pickedId: null as string | null, saveToBook: false, saveLabel: '', apartment: false, ...patch };
  const setter = <K extends keyof typeof state>(key: K) => (next: SetStateAction<(typeof state)[K]>) => {
    state[key] = typeof next === 'function' ? (next as (value: (typeof state)[K]) => (typeof state)[K])(state[key]) : next;
  };
  return new Proxy(state, {
    get: (target, key: string) => {
      if (key.startsWith('set')) {
        const field = (key[3].toLowerCase() + key.slice(4)) as keyof typeof state;
        return setter(field);
      }
      return target[key as keyof typeof state];
    },
  }) as unknown as CheckoutAddressEntryState;
}

function staticHtml(props: Partial<CheckoutAddressSectionProps> = {}) {
  return renderToStaticMarkup(<CheckoutAddressSection address={homeAddress} entry={makeEntry()} setAddress={vi.fn()} {...props} />);
}

describe('CheckoutAddressSection — 표시', () => {
  it('주소록 기본 배송지는 요약 카드(받는 분·배송지 이름·기본 배지·연락처·주소)와 [변경]으로만 보이고, 배송 메모는 그 아래에 둔다', () => {
    const html = staticHtml();
    expect(html).toContain('<strong>홍길동</strong><span class="checkout-address-summary__label">집</span><span class="checkout-address-badge">기본 배송지</span>');
    expect(html).toContain('010-1234-5678');
    expect(html).toContain('(04524) 서울 중구 세종대로 110 101동');
    expect(html).toMatch(/<button aria-haspopup="dialog" aria-label="배송지 변경"[^>]*id="checkout-address-change"[^>]*>변경<\/button>/);
    expect(html).not.toContain('id="checkout-recipientName"');
    expect(html).toContain('id="checkout-deliveryNote"');
    expect(html).toContain('value="문 앞"');
    /* 이미 주소록에 있는 배송지라 저장하자고 하지 않는다. */
    expect(html).not.toContain('주소록에 저장');
  });

  it('직전 주문의 배송지는 요약으로 보이고 주소록 저장 체크(기본 꺼짐)를 둔다 — 이름 칸은 체크해야 열린다', () => {
    const html = staticHtml({ address: recent });
    expect(html).toContain('<strong>김팬</strong></p>');
    expect(html).toContain('031-123-4567');
    expect(html).not.toContain('checkout-address-badge');
    const checkbox = html.match(/<input[^>]*id="checkout-address-save"[^>]*>/)?.[0] ?? '';
    expect(checkbox).toContain('type="checkbox"');
    expect(checkbox).not.toContain('checked');
    expect(html).toContain('주문할 때 함께 저장해요.');
    expect(html).not.toContain('id="checkout-address-save-label"');

    const checked = staticHtml({ address: recent, entry: makeEntry({ saveToBook: true, book: [] }) });
    expect(checked).toContain('id="checkout-address-save-label"');
    expect(checked).toContain('비우면 받는 분 이름으로 저장해요.');
    expect(checked).toContain('첫 배송지는 기본 배송지가 돼요.');
  });

  it('입력 칸 모양은 [주소록에서 선택]·받는 분·연락처·주소 검색 칸·상세 주소를 펼친다', () => {
    const html = staticHtml({ address: recent, entry: makeEntry({ mode: 'form' }) });
    expect(html).toContain('>주소록에서 선택</button>');
    for (const id of ['checkout-recipientName', 'checkout-phone', 'checkout-postalCode', 'checkout-address1', 'checkout-address2', 'checkout-deliveryNote']) expect(html).toContain(`id="${id}"`);
    expect(html.match(/<input[^>]*id="checkout-address1"[^>]*>/)?.[0]).toContain('readOnly=""');
    expect(html).not.toContain('checkout-address-summary');
    /* 주소록이 비면 고를 것이 없어 [주소록에서 선택]을 두지 않는다. */
    expect(staticHtml({ address: recent, entry: makeEntry({ mode: 'form', book: [] }) })).not.toContain('주소록에서 선택');
  });

  it('요약이어도 배송지가 지금 규칙을 통과하지 못하면 칸을 펼치고 칸 오류를 보인다', () => {
    const errors: CheckoutAddressErrors = { phone: '연락처는 숫자 8~15자리로 입력해주세요.' };
    const html = staticHtml({ address: { ...recent, phone: '12' }, errors });
    expect(html).toContain('id="checkout-phone"');
    expect(html).toContain('id="checkout-phone-error"');
    expect(html).not.toContain('checkout-address-summary');
  });

  it('주소록을 쓸 수 없으면 저장 체크가 없고 [변경]은 시트를 열지 않는다(칸을 펼친다)', () => {
    const html = staticHtml({ address: recent, entry: makeEntry({ book: null }) });
    expect(html).not.toContain('주소록에 저장');
    expect(html).not.toContain('aria-haspopup');
    expect(html).toContain('id="checkout-address-change"');
  });

  it('주소록이 가득 차면 저장 대신 정리 안내를 한다', () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ ...office, id: `7a570000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`, isDefault: index === 0, address1: `서울 ${index}` }));
    const html = staticHtml({ address: recent, entry: makeEntry({ book: ten }) });
    expect(html).not.toContain('id="checkout-address-save"');
    expect(html).toContain('주소록이 가득 찼어요(최대 10개)');
    expect(renderToStaticMarkup(<CheckoutAddressSaveOption availability="saved" checked={false} disabled={false} firstEntry={false} label="" onCheckedChange={vi.fn()} onLabelChange={vi.fn()} />)).toBe('');
  });
});

describe('CheckoutAddressSection — 고르기·직접 입력·검색', () => {
  const focused: string[] = [];
  let address: CheckoutAddress;
  let errors: CheckoutAddressErrors;
  let entry: CheckoutAddressEntryState;
  const setAddress = (next: SetStateAction<CheckoutAddress>) => { address = typeof next === 'function' ? next(address) : next; };
  const setErrors = (next: SetStateAction<CheckoutAddressErrors>) => { errors = typeof next === 'function' ? next(errors) : next; };
  const render = () => { hooks.index = 0; return CheckoutAddressSection({ address, entry, errors, onErrorsChange: setErrors, setAddress }); };
  const find = (predicate: (node: Element) => boolean) => all(render()).find(predicate);
  const picker = () => find((node) => node.type === CheckoutAddressPicker);
  const click = (id: string) => (find((node) => node.props.id === id)!.props.onClick as () => void)();

  beforeEach(() => {
    hooks.fake = true;
    hooks.states = [];
    focused.length = 0;
    address = { ...homeAddress };
    errors = {};
    entry = makeEntry();
    vi.stubGlobal('window', { requestAnimationFrame: (callback: (time: number) => void) => { callback(0); return 0; } });
    vi.stubGlobal('document', { getElementById: (id: string) => ({ focus: () => { focused.push(id); } }) });
  });
  afterEach(() => {
    hooks.fake = false;
    vi.unstubAllGlobals();
  });

  it('[변경]은 지금 배송지를 고른 상태로 시트를 열고, 다른 배송지를 고르면 채우고 요약으로 접는다(배송 메모는 둔다)', () => {
    expect(picker()).toBeUndefined();
    click('checkout-address-change');
    expect(picker()!.props.currentId).toBe(home.id);
    expect(picker()!.props.book).toEqual([home, office]);
    (picker()!.props.onApply as (value: AddressBookEntry) => void)(office);
    expect(address).toEqual({ recipientName: '김회사', phone: '01012345678', postalCode: '04524', address1: '서울 강남구 테헤란로 152', address2: '', deliveryNote: '문 앞' });
    expect(entry.mode).toBe('summary');
    expect(entry.pickedId).toBe(office.id);
    expect(picker()).toBeUndefined();
    expect(focused).toEqual(['checkout-address-change']);
  });

  it('시트의 [주소록에 저장하지 않고 입력]은 빈 칸을 펼치고 받는 분 칸으로 간다', () => {
    entry = makeEntry({ apartment: true });
    errors = { phone: 'x', deliveryNote: '배송 메모는 200자 이하로 입력해주세요.' };
    click('checkout-address-change');
    (picker()!.props.onDirectInput as () => void)();
    expect(address).toEqual({ recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryNote: '문 앞' });
    expect(entry.mode).toBe('form');
    expect(entry.apartment).toBe(false);
    expect(errors).toEqual({ deliveryNote: '배송 메모는 200자 이하로 입력해주세요.' });
    expect(focused).toEqual(['checkout-recipientName']);
  });

  it('주소록을 쓸 수 없으면 [변경]이 지금 배송지를 입력 칸으로 펼친다', () => {
    entry = makeEntry({ book: null });
    click('checkout-address-change');
    expect(picker()).toBeUndefined();
    expect(entry.mode).toBe('form');
    expect(address).toEqual(homeAddress);
  });

  it('시트에서 지금 채운 배송지를 고치면 주문서도 새 값으로 바꾸고, 다른 배송지를 고친 것은 두지 않는다', () => {
    click('checkout-address-change');
    (picker()!.props.onEdited as (value: AddressBookEntry) => void)({ ...office, address1: '바뀐 곳' });
    expect(address).toEqual(homeAddress);
    (picker()!.props.onEdited as (value: AddressBookEntry) => void)({ ...home, address2: '102동' });
    expect(address.address2).toBe('102동');
    expect(address.deliveryNote).toBe('문 앞');
  });

  it('주소 검색 결과는 우편번호·기본 주소만 채우고 공동주택 여부를 남기며 상세 주소로 간다', () => {
    entry = makeEntry({ mode: 'form' });
    errors = { postalCode: 'x', address1: 'y', phone: 'z' };
    const field = find((node) => node.type === PostcodeField)!;
    (field.props.onSelect as (value: { postalCode: string; address1: string; apartment: boolean }) => void)({ postalCode: '06236', address1: '서울 강남구 테헤란로 152', apartment: true });
    expect(address).toMatchObject({ postalCode: '06236', address1: '서울 강남구 테헤란로 152', address2: '101동' });
    expect(entry.apartment).toBe(true);
    expect(errors).toEqual({ phone: 'z' });
    expect(focused).toEqual(['checkout-address2']);
  });

  it('칸을 고치면 그 칸 오류만 지우고, 저장 체크와 이름은 상태로 올린다', () => {
    entry = makeEntry({ mode: 'form', book: [] });
    address = { ...recent };
    errors = { recipientName: 'x', phone: 'y' };
    (find((node) => node.props.id === 'checkout-recipientName')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '박팬' } });
    expect(address.recipientName).toBe('박팬');
    expect(errors).toEqual({ phone: 'y' });
    const save = find((node) => node.type === CheckoutAddressSaveOption)!;
    (save.props.onCheckedChange as (value: boolean) => void)(true);
    (save.props.onLabelChange as (value: string) => void)('본가');
    expect(entry.saveToBook).toBe(true);
    expect(entry.saveLabel).toBe('본가');
  });
});
