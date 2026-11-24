import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressBookEntry } from '@/lib/address-book';

const hooks = vi.hoisted(() => ({ fake: false, states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
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
    useRef: (initial: unknown) => {
      if (!hooks.fake) return actual.useRef(initial);
      const i = hooks.refIndex++;
      hooks.refs[i] ??= { current: initial };
      return hooks.refs[i];
    },
  };
});
vi.mock('@/app/my/addresses/actions', () => ({ saveAddressBookEntryAction: mocks.save }));

import { PostcodeField } from '@/components/checkout/PostcodeField';
import { setCustomerConfirmHandler, type CustomerConfirmRequest } from '@/lib/customer-confirm';
import { ADDRESS_BOOK_POSTCODE_FAILED_MESSAGE, AddressBookForm, type AddressBookFormProps } from './AddressBookForm';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap((child) => (isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []));
const text = (node: ReactNode): string => Children.toArray(node).map((child) => (isValidElement<Record<string, unknown>>(child) ? text(child.props.children as ReactNode) : String(child))).join('');

const home: AddressBookEntry = {
  id: '7a570000-0000-4000-8000-000000000001', label: '집', recipientName: '홍길동', phone: '01012345678',
  postalCode: '04524', address1: '서울 중구 세종대로 110', address2: null, isDefault: true,
};

let props: AddressBookFormProps;
const renderFake = () => { hooks.index = 0; hooks.refIndex = 0; return AddressBookForm(props); };
const input = (id: string) => all(renderFake()).find((node) => node.type === 'input' && node.props.id === id)!;
const type = (id: string, value: string) => (input(id).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
const submit = () => (all(renderFake()).find((node) => node.type === 'form')!.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });

beforeEach(() => {
  hooks.fake = false;
  hooks.states = [];
  hooks.refs = [];
  mocks.save.mockReset();
  props = { idPrefix: 'address-book', firstEntry: false, submitLabel: '배송지 저장', onSaved: vi.fn(), onCancel: vi.fn() };
});

describe('AddressBookForm — 표시', () => {
  it('주문서와 같은 우편번호 부품을 접두 id 로 쓰고 배송 메모 칸은 없다', () => {
    const html = renderToStaticMarkup(<AddressBookForm {...props} />);
    for (const field of ['label', 'recipientName', 'phone', 'address1', 'address2']) expect(html).toContain(`id="address-book-${field}"`);
    expect(html).toContain('id="address-book-postalCode"');
    expect(html).not.toContain('id="checkout-postalCode"');
    expect(html).not.toContain('배송 메모');
    expect(html).toContain('maxLength="20"');
    /* 배송지 이름은 선택이다 — 비우면 받는 분 이름으로 저장한다(P1). */
    const label = html.match(/<input[^>]*id="address-book-label"[^>]*>/)?.[0] ?? '';
    expect(label).not.toContain('required');
    expect(label).toContain('aria-describedby="address-book-label-hint"');
    expect(html).toContain('배송지 이름 <em>선택</em>');
    expect(html).toContain('비우면 받는 분 이름으로 저장해요.');
    /* 주소는 검색으로 채우는 잠긴 칸이다(PostcodeField). */
    expect(html.match(/<input[^>]*id="address-book-address1"[^>]*>/)?.[0]).toContain('readOnly=""');
    const checkbox = html.match(/<input[^>]*id="address-book-makeDefault"[^>]*>/)?.[0] ?? '';
    expect(checkbox).toContain('type="checkbox"');
    expect(checkbox).not.toContain('disabled');
    expect(checkbox).not.toContain('checked');
    expect(html).toContain('>취소</button>');
  });

  it('첫 배송지는 기본 지정이 켜진 채 잠기고, 이미 기본인 배송지를 고칠 때도 끌 수 없다', () => {
    const checkbox = (html: string) => html.match(/<input[^>]*id="address-book-makeDefault"[^>]*>/)?.[0] ?? '';
    const first = renderToStaticMarkup(<AddressBookForm {...props} firstEntry />);
    expect(checkbox(first)).toContain('checked=""');
    expect(checkbox(first)).toContain('disabled=""');
    expect(first).toContain('첫 배송지는 기본 배송지가 돼요.');
    const editing = renderToStaticMarkup(<AddressBookForm {...props} entry={home} />);
    expect(checkbox(editing)).toContain('checked=""');
    expect(checkbox(editing)).toContain('disabled=""');
    expect(editing).toContain('value="홍길동"');
    expect(editing).toContain('value="01012345678"');
  });
});

describe('AddressBookForm — 제출', () => {
  const focus = vi.fn();
  const postcode = () => all(renderFake()).find((node) => node.type === PostcodeField)!;
  const search = (value: { postalCode: string; address1: string; apartment: boolean }) => (postcode().props.onSelect as (selected: typeof value) => void)(value);
  const fill = () => {
    for (const [id, value] of [['recipientName', '홍길동'], ['phone', '010-1234-5678']] as const) type(`address-book-${id}`, value);
    search({ postalCode: '04524', address1: '서울 중구 세종대로 110', apartment: false });
  };
  beforeEach(() => {
    hooks.fake = true;
    focus.mockReset();
    vi.stubGlobal('window', { requestAnimationFrame: (callback: (time: number) => void) => { callback(0); return 0; } });
    vi.stubGlobal('document', { getElementById: (id: string) => ({ focus: () => focus(id) }) });
  });
  afterEach(() => { vi.unstubAllGlobals(); setCustomerConfirmHandler(null); });

  it('검증에 걸리면 서버를 부르지 않고 첫 오류 칸으로 포커스를 옮긴다', async () => {
    type('address-book-label', '집');
    await submit();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(focus).toHaveBeenLastCalledWith('address-book-recipientName');
    expect(input('address-book-recipientName').props['aria-invalid']).toBe(true);
    expect(postcode().props.errors).toEqual({ postalCode: '우편번호 5자리를 입력해주세요.', address1: '기본 주소를 입력해주세요.' });
  });

  it('검색 결과는 우편번호·기본 주소만 채우고 상세 주소로 포커스를 옮긴다', () => {
    type('address-book-address2', '101동');
    search({ postalCode: '04524', address1: '서울 중구 세종대로 110', apartment: false });
    expect(postcode().props.address1).toBe('서울 중구 세종대로 110');
    expect(postcode().props.postalCode).toBe('04524');
    expect(input('address-book-address2').props.value).toBe('101동');
    expect(focus).toHaveBeenLastCalledWith('address-book-address2');
  });

  it('수정은 내 배송지 id 로 저장하고 성공하면 갱신된 목록과 저장한 값을 넘긴다', async () => {
    props = { ...props, entry: { ...home, isDefault: false } };
    mocks.save.mockResolvedValue({ ok: true, entries: [home], savedId: home.id });
    type('address-book-label', '새 집');
    await submit();
    expect(mocks.save).toHaveBeenCalledWith(home.id, { label: '새 집', recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '', makeDefault: false });
    expect(props.onSaved).toHaveBeenCalledWith({ entries: [home], savedId: home.id, input: { label: '새 집', address: { recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110' }, makeDefault: false } });
  });

  it('배송지 이름을 비워도 저장하고, 저장되는 이름은 받는 분 이름이다', async () => {
    mocks.save.mockResolvedValue({ ok: true, entries: null, savedId: home.id });
    fill();
    await submit();
    expect(mocks.save).toHaveBeenCalledWith(null, expect.objectContaining({ label: '' }));
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ label: '홍길동' }) }));
  });

  /* 공동주택(아파트)인데 동·호수가 비면 저장 전에 한 번 확인받는다 — 막지는 않는다(네이버 방식). */
  it('공동주택 검색 결과에 상세 주소가 없으면 확인받고, [상세 주소 입력]이면 저장하지 않고 그 칸으로 간다', async () => {
    const asked: CustomerConfirmRequest[] = [];
    let answer = false;
    setCustomerConfirmHandler(async (request) => { asked.push(request); return answer; });
    mocks.save.mockResolvedValue({ ok: true, entries: [home], savedId: home.id });
    fill();
    search({ postalCode: '04524', address1: '서울 중구 세종대로 110', apartment: true });
    await submit();
    expect(asked[0]).toMatchObject({ title: '상세 주소 없이 진행할까요?', confirmLabel: '이대로 저장', cancelLabel: '상세 주소 입력' });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(focus).toHaveBeenLastCalledWith('address-book-address2');

    answer = true;
    await submit();
    expect(mocks.save).toHaveBeenCalledTimes(1);

    /* 상세 주소를 적으면 묻지 않는다. */
    type('address-book-address2', '101동 1203호');
    await submit();
    expect(asked).toHaveLength(2);
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it('첫 배송지는 기본 지정으로 보내고, 서버 거절은 문구와 칸 오류로 되돌린다', async () => {
    props = { ...props, firstEntry: true };
    mocks.save.mockResolvedValue({ ok: false, error: 'address_book_full', message: '배송지는 최대 10개까지 저장할 수 있어요.' });
    type('address-book-label', '집');
    fill();
    await submit();
    expect(mocks.save).toHaveBeenCalledWith(null, expect.objectContaining({ makeDefault: true }));
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(text(renderFake())).toContain('배송지는 최대 10개까지 저장할 수 있어요.');
  });

  /* 같은 태스크 안에서 제출이 두 번 불리면(같은 렌더의 onSubmit — pending 이 아직 false) 요청은 한 번만 나간다(L7 QA). */
  it('같은 렌더의 제출을 연달아 불러도 저장 요청은 하나만 나가고, 끝나면 다시 저장할 수 있다', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.save.mockImplementation(() => new Promise((done) => { resolve = done; }));
    fill();
    const onSubmit = all(renderFake()).find((node) => node.type === 'form')!.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>;
    const first = onSubmit({ preventDefault() {} });
    const second = onSubmit({ preventDefault() {} });
    await second;
    expect(mocks.save).toHaveBeenCalledTimes(1);
    resolve({ ok: true, entries: [home], savedId: home.id });
    await first;
    expect(props.onSaved).toHaveBeenCalledTimes(1);
    mocks.save.mockResolvedValue({ ok: true, entries: [home], savedId: home.id });
    await submit();
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it('주소 검색을 열지 못했을 때 주문이 아니라 배송지 저장 문맥의 문구를 넘긴다', () => {
    const field = all(renderFake()).find((node) => node.type === PostcodeField)!;
    expect(field.props.failedMessage).toBe(ADDRESS_BOOK_POSTCODE_FAILED_MESSAGE);
    expect(ADDRESS_BOOK_POSTCODE_FAILED_MESSAGE).toContain('배송지를 저장할 수 있어요');
    expect(ADDRESS_BOOK_POSTCODE_FAILED_MESSAGE).not.toContain('주문');
  });
});
