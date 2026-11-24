import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressBookEntry } from '@/lib/address-book';

/* 정적 마크업(실제 React)과, 고르기·추가·수정 흐름을 위한 훅 대체 렌더(효과·포커스 가두기는 건너뛴다)를 함께 쓴다. */
const hooks = vi.hoisted(() => ({ fake: false, states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
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
    useEffect: (effect: () => void, deps?: unknown[]) => (hooks.fake ? undefined : actual.useEffect(effect, deps)),
    useId: () => (hooks.fake ? 'picker' : actual.useId()),
  };
});
vi.mock('@/components/shell/useOverlayA11y', () => ({ useOverlayA11y: vi.fn() }));
vi.mock('@/app/my/addresses/actions', () => ({ saveAddressBookEntryAction: vi.fn() }));

import { AddressBookForm, type AddressBookFormSaved } from '@/components/address-book/AddressBookForm';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';
import {
  CheckoutAddressPicker,
  initialPickerSelection,
  nextAddressBookAfterSave,
  savedAddressBookEntry,
  type CheckoutAddressPickerProps,
} from './CheckoutAddressPicker';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap((child) => (isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []));
const text = (node: ReactNode): string => Children.toArray(node).map((child) => (isValidElement<Record<string, unknown>>(child) ? text(child.props.children as ReactNode) : String(child))).join('');

const home: AddressBookEntry = {
  id: '7a570000-0000-4000-8000-000000000001', label: '집', recipientName: '홍길동', phone: '01012345678',
  postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동', isDefault: true,
};
const office: AddressBookEntry = { ...home, id: '7a570000-0000-4000-8000-000000000002', label: '회사', recipientName: '김회사', phone: '0212345678', address1: '서울 강남구 테헤란로 152', address2: null, isDefault: false };
const ten = Array.from({ length: 10 }, (_, index) => ({ ...office, id: `7a570000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`, isDefault: index === 0 }));

let props: CheckoutAddressPickerProps;
beforeEach(() => {
  hooks.fake = false;
  hooks.states = [];
  hooks.refs = [];
  props = { book: [home, office], currentId: office.id, onApply: vi.fn(), onBookChange: vi.fn(), onClose: vi.fn(), onDirectInput: vi.fn(), onEdited: vi.fn() };
});

describe('CheckoutAddressPicker — 목록', () => {
  it('모달 시트에 주소록을 라디오 카드로 보이고 지금 배송지를 고른 상태로 연다(연락처는 가린다)', () => {
    const html = renderToStaticMarkup(<CheckoutAddressPicker {...props} />);
    expect(html).toMatch(/role="dialog"/);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('>배송지 선택</h2>');
    const radio = (id: string) => html.match(new RegExp(`<input[^>]*value="${id}"[^>]*>`))?.[0] ?? '';
    expect(radio(office.id)).toContain('type="radio"');
    expect(radio(office.id)).toContain('name="checkout-address-pick"');
    expect(radio(office.id)).toContain('checked=""');
    expect(radio(home.id)).not.toContain('checked');
    expect(html).toContain('<strong>집</strong><span class="checkout-address-badge">기본 배송지</span>');
    expect(html).toContain('홍길동 · 010-****-5678');
    expect(html).toContain('김회사 · 02-****-5678');
    expect(html).not.toContain('01012345678');
    expect(html).toContain(`id="checkout-address-edit-${home.id}"`);
    expect(html).toContain('aria-label="집 수정"');
    expect(html).toContain('>이 배송지로 받기</button>');
    expect(html).toContain('>새 배송지 추가</button>');
    expect(html).toContain('>주소록에 저장하지 않고 입력</button>');
    expect(html).toContain('href="/my/addresses"');
    expect(html).toContain('aria-label="배송지 선택 닫기"');
    expect(useOverlayA11y).toBeDefined();
  });

  it('주소록이 비면 안내와 추가·직접 입력만 두고, 가득 차면 추가를 잠그고 이유를 말한다', () => {
    const empty = renderToStaticMarkup(<CheckoutAddressPicker {...props} book={[]} currentId={null} />);
    expect(empty).toContain('저장한 배송지가 없어요.');
    expect(empty).not.toContain('이 배송지로 받기');
    const full = renderToStaticMarkup(<CheckoutAddressPicker {...props} book={ten} currentId={null} />);
    expect(full).toMatch(/<button aria-describedby="checkout-address-sheet-full" class="wc-btn" disabled=""/);
    expect(full).toContain('배송지는 최대 10개까지 저장할 수 있어요.');
  });

  it('처음 고른 항목은 지금 배송지, 없으면 기본 배송지, 없으면 첫 항목이다', () => {
    expect(initialPickerSelection([home, office], office.id)).toBe(office.id);
    expect(initialPickerSelection([office, home], null)).toBe(home.id);
    expect(initialPickerSelection([office, home], 'missing')).toBe(home.id);
    expect(initialPickerSelection([{ ...office, isDefault: false }], null)).toBe(office.id);
    expect(initialPickerSelection([], null)).toBeNull();
  });

  it('저장 결과로 이어 그릴 항목·목록 — 다시 읽은 목록이 있으면 그대로, 없으면 저장한 값으로 기본 배송지를 하나로 둔다', () => {
    const input = { label: '본가', address: { recipientName: '박팬', phone: '01022223333', postalCode: '06236', address1: '서울 강남구' }, makeDefault: true };
    const reread: AddressBookFormSaved = { entries: [home], savedId: home.id, input };
    expect(savedAddressBookEntry(reread, null)).toBe(home);
    expect(nextAddressBookAfterSave([office], reread, home)).toEqual([home]);
    const lost: AddressBookFormSaved = { entries: null, savedId: '7a570000-0000-4000-8000-000000000009', input };
    const added = savedAddressBookEntry(lost, null);
    expect(added).toEqual({ id: '7a570000-0000-4000-8000-000000000009', label: '본가', recipientName: '박팬', phone: '01022223333', postalCode: '06236', address1: '서울 강남구', address2: null, isDefault: true });
    expect(nextAddressBookAfterSave([home, office], lost, added)).toEqual([{ ...home, isDefault: false }, office, added]);
    const edited = savedAddressBookEntry({ entries: null, input: { ...input, makeDefault: false } }, office.id);
    expect(nextAddressBookAfterSave([home, office], { entries: null, input }, edited)).toEqual([home, edited]);
  });
});

describe('CheckoutAddressPicker — 고르기·추가·수정', () => {
  const render = () => { hooks.index = 0; hooks.refIndex = 0; return CheckoutAddressPicker(props); };
  const find = (predicate: (node: Element) => boolean) => all(render()).find(predicate);
  const button = (label: string) => find((node) => node.type === 'button' && text(node) === label)!;
  const form = () => find((node) => node.type === AddressBookForm);
  const input = { label: '본가', address: { recipientName: '박팬', phone: '01022223333', postalCode: '06236', address1: '서울 강남구' }, makeDefault: false };

  beforeEach(() => { hooks.fake = true; });

  it('라디오로 고르는 동안은 닫지 않고 [이 배송지로 받기]에서만 주문서에 채운다', () => {
    (find((node) => node.type === 'input' && node.props.value === home.id)!.props.onChange as () => void)();
    expect(props.onApply).not.toHaveBeenCalled();
    (button('이 배송지로 받기').props.onClick as () => void)();
    expect(props.onApply).toHaveBeenCalledWith(home);
  });

  it('새 배송지를 저장하면 목록에 넣고 바로 주문서에 채운다', () => {
    (button('새 배송지 추가').props.onClick as () => void)();
    expect(form()!.props.entry).toBeNull();
    expect(form()!.props.submitLabel).toBe('저장하고 이 배송지로 받기');
    expect(form()!.props.idPrefix).toBe('checkout-book');
    expect(text(render())).toContain('새 배송지 추가');
    const added = { ...office, id: '7a570000-0000-4000-8000-000000000003', label: '본가' };
    (form()!.props.onSaved as (saved: AddressBookFormSaved) => void)({ entries: [home, office, added], savedId: added.id, input });
    expect(props.onBookChange).toHaveBeenCalledWith([home, office, added]);
    expect(props.onApply).toHaveBeenCalledWith(added);
  });

  it('수정은 그 배송지로 폼을 열고, 저장하면 목록으로 돌아와 알리며 주문서에 고친 값을 넘긴다', () => {
    (button('수정').props.onClick as () => void)();
    expect(form()!.props.entry).toBe(home);
    expect(form()!.props.cancelLabel).toBe('목록으로');
    const updated = { ...home, address2: '102동' };
    (form()!.props.onSaved as (saved: AddressBookFormSaved) => void)({ entries: [updated, office], savedId: home.id, input });
    expect(props.onBookChange).toHaveBeenCalledWith([updated, office]);
    expect(props.onEdited).toHaveBeenCalledWith(updated);
    expect(props.onApply).not.toHaveBeenCalled();
    expect(form()).toBeUndefined();
    expect(find((node) => node.props.role === 'status')).toBeDefined();
    expect(text(render())).toContain('배송지를 수정했어요.');
    expect(find((node) => node.type === 'input' && node.props.value === home.id)!.props.checked).toBe(true);
  });

  it('주소록 폼의 제출 이벤트가 주문서 form 으로 번지지 않게 시트에서 막는다', () => {
    const dialog = find((node) => node.props.role === 'dialog')!;
    const stopPropagation = vi.fn();
    (dialog.props.onSubmit as (event: { stopPropagation(): void }) => void)({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('닫기·바깥 누르기·직접 입력은 호출부에 맡긴다', () => {
    (find((node) => node.props['aria-label'] === '배송지 선택 닫기')!.props.onClick as () => void)();
    (find((node) => node.props.className === 'checkout-address-sheet__dim')!.props.onClick as () => void)();
    expect(props.onClose).toHaveBeenCalledTimes(2);
    (button('주소록에 저장하지 않고 입력').props.onClick as () => void)();
    expect(props.onDirectInput).toHaveBeenCalled();
  });
});
