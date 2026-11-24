'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { AddressBookForm, type AddressBookFormSaved } from '@/components/address-book/AddressBookForm';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';
import { Icon } from '@/components/ui/Icon';
import {
  ADDRESS_BOOK_LIMIT,
  ADDRESS_BOOK_PATH,
  addressBookAddressLine,
  defaultAddressBookEntry,
  maskAddressBookPhone,
  type AddressBookEntry,
} from '@/lib/address-book';

/*
 * 주문서 배송지 선택 시트(국내 커머스 관행 맞추기 P1). 요약 카드의 [변경]이 연다. 모바일은 바닥 시트, 넓은 화면은 가운데
 * 560 폭 대화상자다(구매 시트 anyWidth 와 같은 문법). 호출부가 OverlayPortal 로 #root 밖에 그린다.
 *   · 목록: 주소록 배송지를 라디오 카드로 보인다(기본 배송지 먼저, 기본 배지). 고른 뒤 [이 배송지로 받기]로 주문서에 채운다 —
 *     화살표로 고르는 동안 시트가 닫히지 않게 고르기와 적용을 나눈다. 연락처는 가운데를 가린다(배송지 관리와 같다).
 *   · 추가·수정: 같은 시트 안에서 주소록 폼(AddressBookForm)을 연다. 새 배송지는 저장하면 바로 주문서에 채우고 닫는다.
 *     수정은 목록으로 돌아오고, 주문서에 채워 둔 배송지를 고쳤으면 주문서도 새 값으로 바꾼다.
 *   · 직접 입력: 주소록에 저장하지 않고 이번 주문에만 쓸 배송지를 입력 칸으로 적는다(주소록이 가득 찼을 때의 길이기도 하다).
 * Escape·바깥 누르기·닫기는 닫기이고 포커스는 연 버튼으로 돌아간다(useOverlayA11y). 주소록 폼의 제출 이벤트는 React 트리를 타고
 * 주문서 form 으로 번지므로 시트가 막는다(DOM 은 #root 밖이라 폼이 겹치지 않는다).
 */

type View = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; id: string };

export const checkoutAddressEditButtonId = (entryId: string) => `checkout-address-edit-${entryId}`;
const OPTION_NAME = 'checkout-address-pick';

/** 목록을 열 때 고른 상태로 둘 항목 — 주문서에 채운 배송지, 없으면 기본 배송지, 없으면 첫 항목. */
export function initialPickerSelection(book: readonly AddressBookEntry[], currentId: string | null): string | null {
  if (currentId && book.some((entry) => entry.id === currentId)) return currentId;
  return defaultAddressBookEntry(book)?.id ?? book[0]?.id ?? null;
}

/** 저장 결과로 이어 그릴 항목 — 다시 읽은 목록의 그 항목, 못 읽었으면 저장한 값으로 만든다. */
export function savedAddressBookEntry(saved: AddressBookFormSaved, fallbackId: string | null, wasDefault = false): AddressBookEntry {
  const found = saved.savedId ? saved.entries?.find((entry) => entry.id === saved.savedId) : undefined;
  if (found) return found;
  return {
    id: saved.savedId ?? fallbackId ?? '',
    label: saved.input.label,
    ...saved.input.address,
    address2: saved.input.address.address2 ?? null,
    isDefault: wasDefault || saved.input.makeDefault,
  };
}

/** 다시 읽지 못했을 때의 목록 — 저장한 항목을 넣거나 바꾸고, 기본 배송지는 하나로 둔다. */
export function nextAddressBookAfterSave(book: readonly AddressBookEntry[], saved: AddressBookFormSaved, entry: AddressBookEntry): AddressBookEntry[] {
  if (saved.entries) return saved.entries;
  const next = book.map((item) => (item.id === entry.id ? entry : entry.isDefault ? { ...item, isDefault: false } : item));
  return book.some((item) => item.id === entry.id) ? next : [...next, entry];
}

export interface CheckoutAddressPickerProps {
  book: AddressBookEntry[];
  /** 지금 주문서에 채운 배송지와 같은 주소록 항목. */
  currentId: string | null;
  onApply: (entry: AddressBookEntry) => void;
  onBookChange: (book: AddressBookEntry[]) => void;
  /** 고친 항목 — 주문서에 채운 배송지였으면 주문서가 새 값으로 바꾼다. */
  onEdited: (entry: AddressBookEntry) => void;
  onDirectInput: () => void;
  onClose: () => void;
}

export function CheckoutAddressPicker({ book, currentId, onApply, onBookChange, onClose, onDirectInput, onEdited }: CheckoutAddressPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [selectedId, setSelectedId] = useState<string | null>(() => initialPickerSelection(book, currentId));
  const [status, setStatus] = useState<string | null>(null);
  /* 목록으로 돌아올 때 포커스를 줄 곳(고친 항목의 [수정]). 없으면 제목. */
  const returnFocusId = useRef<string | null>(null);
  useOverlayA11y({ open: true, onClose, panelRef });

  const full = book.length >= ADDRESS_BOOK_LIMIT;
  const editing = view.kind === 'edit' ? book.find((entry) => entry.id === view.id) ?? null : null;
  const selected = book.find((entry) => entry.id === selectedId) ?? null;

  /* 보기를 바꾸면 새 보기의 제목(또는 돌아갈 버튼)으로 포커스를 옮긴다 — 첫 열림은 useOverlayA11y 가 맡는다. */
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const target = returnFocusId.current ? document.getElementById(returnFocusId.current) : null;
    returnFocusId.current = null;
    (target ?? headingRef.current)?.focus();
  }, [view]);

  const showList = (focusId: string | null = null) => {
    returnFocusId.current = focusId;
    setView({ kind: 'list' });
  };

  const onSaved = (saved: AddressBookFormSaved) => {
    if (view.kind === 'add') {
      const entry = savedAddressBookEntry(saved, null);
      onBookChange(nextAddressBookAfterSave(book, saved, entry));
      onApply(entry);
      return;
    }
    if (view.kind !== 'edit' || !editing) return;
    const entry = savedAddressBookEntry(saved, editing.id, editing.isDefault);
    onBookChange(nextAddressBookAfterSave(book, saved, entry));
    onEdited(entry);
    setSelectedId(entry.id);
    setStatus('배송지를 수정했어요.');
    showList(checkoutAddressEditButtonId(entry.id));
  };

  /* 주소록 폼의 제출·키 이벤트가 React 트리를 타고 주문서 form 의 onSubmit 으로 번지지 않게 막는다. */
  const stop = (event: SyntheticEvent) => event.stopPropagation();

  const title = view.kind === 'list' ? '배송지 선택' : view.kind === 'add' ? '새 배송지 추가' : '배송지 수정';

  return (
    <>
      <div aria-hidden="true" className="checkout-address-sheet__dim" onClick={onClose} />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="checkout-address-sheet"
        onSubmit={stop}
        ref={panelRef}
        role="dialog"
      >
        <div className="checkout-address-sheet__head">
          {view.kind !== 'list' ? (
            <button aria-label="배송지 목록으로" className="checkout-address-sheet__icon" onClick={() => showList(view.kind === 'edit' ? checkoutAddressEditButtonId(view.id) : null)} type="button">
              <Icon name="chevronLeft" size={22} />
            </button>
          ) : null}
          <h2 className="checkout-address-sheet__title" id={titleId} ref={headingRef} tabIndex={-1}>{title}</h2>
          <button aria-label="배송지 선택 닫기" className="checkout-address-sheet__icon" onClick={onClose} type="button">
            <Icon name="close" size={22} />
          </button>
        </div>

        <div className="checkout-address-sheet__body">
          {view.kind === 'list' ? (
            <>
              {book.length === 0 ? (
                <p className="checkout-address-sheet__empty">저장한 배송지가 없어요. 새 배송지를 추가하면 다음 주문부터 바로 불러와요.</p>
              ) : (
                <fieldset className="checkout-address-sheet__list">
                  <legend className="wc-sr-only">받을 배송지</legend>
                  {book.map((entry) => (
                    <div className={`checkout-address-option${entry.id === selectedId ? ' is-selected' : ''}`} key={entry.id}>
                      <label className="checkout-address-option__main">
                        <input
                          checked={entry.id === selectedId}
                          name={OPTION_NAME}
                          onChange={() => {
                            setSelectedId(entry.id);
                            setStatus(null);
                          }}
                          type="radio"
                          value={entry.id}
                        />
                        <span className="checkout-address-option__text">
                          <span className="checkout-address-option__title">
                            <strong>{entry.label}</strong>
                            {entry.isDefault ? <span className="checkout-address-badge">기본 배송지</span> : null}
                          </span>
                          <span>{entry.recipientName} · {maskAddressBookPhone(entry.phone)}</span>
                          <span>{addressBookAddressLine(entry)}</span>
                        </span>
                      </label>
                      <button
                        aria-label={`${entry.label} 수정`}
                        className="checkout-address-option__edit"
                        id={checkoutAddressEditButtonId(entry.id)}
                        onClick={() => {
                          setStatus(null);
                          setView({ kind: 'edit', id: entry.id });
                        }}
                        type="button"
                      >
                        수정
                      </button>
                    </div>
                  ))}
                </fieldset>
              )}
              {status ? <p className="checkout-address-sheet__status" role="status">{status}</p> : null}
              <div className="checkout-address-sheet__more">
                <button
                  aria-describedby={full ? 'checkout-address-sheet-full' : undefined}
                  className="wc-btn"
                  disabled={full}
                  onClick={() => {
                    setStatus(null);
                    setView({ kind: 'add' });
                  }}
                  type="button"
                >
                  새 배송지 추가
                </button>
                {full ? (
                  <p className="checkout-address-sheet__note" id="checkout-address-sheet-full">
                    배송지는 최대 {ADDRESS_BOOK_LIMIT}개까지 저장할 수 있어요. 배송지 관리에서 쓰지 않는 배송지를 지우거나, 아래에서 이번 주문에만 쓸 배송지를 입력해주세요.
                  </p>
                ) : null}
                <div className="checkout-address-sheet__links">
                  <button className="checkout-address-sheet__link" onClick={onDirectInput} type="button">주소록에 저장하지 않고 입력</button>
                  <Link className="checkout-address-sheet__link" href={ADDRESS_BOOK_PATH}>배송지 관리</Link>
                </div>
              </div>
            </>
          ) : (
            <AddressBookForm
              cancelLabel="목록으로"
              entry={editing}
              firstEntry={book.length === 0}
              idPrefix="checkout-book"
              key={view.kind === 'edit' ? view.id : 'add'}
              onCancel={() => showList(view.kind === 'edit' ? checkoutAddressEditButtonId(view.id) : null)}
              onSaved={onSaved}
              submitLabel={view.kind === 'add' ? '저장하고 이 배송지로 받기' : '수정 내용 저장'}
            />
          )}
        </div>

        {view.kind === 'list' && book.length > 0 ? (
          <div className="checkout-address-sheet__foot">
            <button className="wc-btn primary" disabled={!selected} onClick={() => selected && onApply(selected)} type="button">
              이 배송지로 받기
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
