'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { deleteAddressBookEntryAction, setDefaultAddressBookEntryAction, type AddressBookActionResult } from '@/app/my/addresses/actions';
import { AddressBookForm, type AddressBookFormSaved } from '@/components/address-book/AddressBookForm';
import { MypageShell } from '@/components/wc/MypageShell';
import {
  ADDRESS_BOOK_ERROR_COPY,
  ADDRESS_BOOK_LIMIT,
  ADDRESS_BOOK_PATH,
  addressBookAddressLine,
  defaultAddressBookEntry,
  maskAddressBookPhone,
  type AddressBookEntry,
} from '@/lib/address-book';

/*
 * 배송지 관리 — /my/addresses (LFS 패리티 2차 L7 · MY-11, 11 §5.8, 10/14 S6b·S3).
 * 헤딩 바 → 요약 박스 920×62(기본 배송지 + '기본 배송지 변경' 106×30) → 목록 표(배송지 이름 240 · 주소 393 ·
 * 연락처 180 · 관리 107) → '배송지 추가' 260×56 잉크 → 안내 박스. 모바일은 표를 배송지 블록으로 쌓는다.
 * 주소록은 주문서 입력 보조라 여기서 고치거나 지워도 이미 만든 주문의 배송지는 바뀌지 않는다.
 * 연락처는 목록에서 가운데를 가리고(전체 번호는 수정 폼에서만), 오류 문구에 입력값을 싣지 않는다.
 */

type Panel = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; id: string };
type Status = { tone: 'ok' | 'error'; text: string } | null;

export function MyAddresses({ entries: initialEntries }: { entries: AddressBookEntry[] | null }) {
  const router = useRouter();
  const [entries, setEntries] = useState<AddressBookEntry[] | null>(initialEntries);
  const [panel, setPanel] = useState<Panel>({ kind: 'closed' });
  const [choosingDefault, setChoosingDefault] = useState(false);
  const [defaultChoice, setDefaultChoice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const book = entries ?? [];
  const preferred = defaultAddressBookEntry(entries);
  const full = book.length >= ADDRESS_BOOK_LIMIT;
  const editing = panel.kind === 'edit' ? book.find((entry) => entry.id === panel.id) ?? null : null;
  /* 고치던 배송지를 지우면(다른 기기 포함) 폼은 닫힌 것으로 본다 — 추가 버튼이 잠긴 채 남지 않게. */
  const panelOpen = panel.kind === 'add' || editing !== null;

  const announce = (next: Status) => {
    setStatus(next);
    window.requestAnimationFrame(() => statusRef.current?.focus());
  };

  /* 액션이 다시 읽은 목록으로 바꾼다. 다시 읽지 못했으면 서버 화면을 새로 받는다. */
  const applyEntries = (next: AddressBookEntry[] | null) => {
    if (next) setEntries(next);
    else router.refresh();
  };

  const openPanel = (next: Panel) => {
    setPanel(next);
    setConfirmingDelete(null);
    setChoosingDefault(false);
    setStatus(null);
    window.requestAnimationFrame(() => panelHeadingRef.current?.focus());
  };

  const closePanel = () => {
    setPanel({ kind: 'closed' });
    window.requestAnimationFrame(() => addButtonRef.current?.focus());
  };

  const onSaved = ({ entries: next }: AddressBookFormSaved) => {
    const added = panel.kind === 'add';
    applyEntries(next);
    setPanel({ kind: 'closed' });
    announce({ tone: 'ok', text: added ? '배송지를 추가했어요.' : '배송지를 수정했어요.' });
  };

  const run = async (work: () => Promise<AddressBookActionResult>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await work();
      if (!result.ok) {
        announce({ tone: 'error', text: result.message });
        return;
      }
      applyEntries(result.entries);
      setConfirmingDelete(null);
      setChoosingDefault(false);
      announce({ tone: 'ok', text: done });
    } catch {
      announce({ tone: 'error', text: ADDRESS_BOOK_ERROR_COPY.unavailable });
    } finally {
      setBusy(false);
    }
  };

  const changeDefault = () => {
    const target = defaultChoice ?? preferred?.id ?? null;
    if (!target || target === preferred?.id) {
      setChoosingDefault(false);
      return;
    }
    void run(() => setDefaultAddressBookEntryAction(target), '기본 배송지를 바꿨어요.');
  };

  return (
    <MypageShell active={ADDRESS_BOOK_PATH}>
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">배송지 관리</h1>
        {entries ? <span className="wc-address-book__count">{book.length} / {ADDRESS_BOOK_LIMIT}</span> : null}
      </div>

      {entries === null ? (
        <p className="wc-address-book__error" role="alert">배송지를 불러오지 못했어요. 잠시 후 다시 열어주세요.</p>
      ) : (
        <>
          <section aria-labelledby="address-book-default-heading" className="wc-address-book__summary">
            <div className="wc-address-book__summary-copy">
              <h2 className="wc-address-book__summary-title" id="address-book-default-heading">기본 배송지</h2>
              <p className="wc-address-book__summary-value">
                {preferred ? `${preferred.label} · ${addressBookAddressLine(preferred)}` : '등록한 배송지가 없어요.'}
              </p>
            </div>
            {book.length > 1 ? (
              <button
                aria-controls="address-book-default-chooser"
                aria-expanded={choosingDefault}
                className="wc-address-book__summary-action"
                onClick={() => {
                  setChoosingDefault((open) => !open);
                  setDefaultChoice(preferred?.id ?? null);
                  setConfirmingDelete(null);
                }}
                type="button"
              >
                기본 배송지 변경
              </button>
            ) : null}
          </section>

          {choosingDefault ? (
            <fieldset className="wc-address-book__chooser" disabled={busy} id="address-book-default-chooser">
              <legend>기본 배송지로 쓸 배송지를 골라주세요</legend>
              {book.map((entry) => (
                <label className="wc-address-book__choice" key={entry.id}>
                  <input
                    checked={(defaultChoice ?? preferred?.id) === entry.id}
                    name="address-book-default"
                    onChange={() => setDefaultChoice(entry.id)}
                    type="radio"
                    value={entry.id}
                  />
                  <span>
                    <strong>{entry.label}</strong>
                    <span>{addressBookAddressLine(entry)}</span>
                  </span>
                </label>
              ))}
              <div className="wc-address-book__chooser-actions">
                <button className="wc-btn" onClick={() => setChoosingDefault(false)} type="button">취소</button>
                <button className="wc-btn primary" onClick={changeDefault} type="button">변경</button>
              </div>
            </fieldset>
          ) : null}

          <p
            className={`wc-address-book__status${status?.tone === 'error' ? ' is-error' : ''}`}
            ref={statusRef}
            role={status?.tone === 'error' ? 'alert' : 'status'}
            tabIndex={-1}
          >
            {status?.text}
          </p>

          {book.length === 0 ? (
            <p className="wc-address-book__empty">저장한 배송지가 없어요. 배송지를 추가하면 주문서에서 바로 불러올 수 있어요.</p>
          ) : (
            <table className="wc-address-book__table">
              <caption className="wc-sr-only">저장한 배송지 목록</caption>
              <colgroup>
                <col className="wc-address-book__col-name" />
                <col className="wc-address-book__col-address" />
                <col className="wc-address-book__col-phone" />
                <col className="wc-address-book__col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">배송지 이름</th>
                  <th scope="col">주소</th>
                  <th scope="col">연락처</th>
                  <th scope="col"><span className="wc-sr-only">관리</span></th>
                </tr>
              </thead>
              <tbody>
                {book.map((entry) => (
                  <AddressRow
                    busy={busy}
                    confirming={confirmingDelete === entry.id}
                    entry={entry}
                    key={entry.id}
                    onAskDelete={() => {
                      setConfirmingDelete(entry.id);
                      setChoosingDefault(false);
                    }}
                    onCancelDelete={() => setConfirmingDelete(null)}
                    onDelete={() => void run(() => deleteAddressBookEntryAction(entry.id), '배송지를 삭제했어요.')}
                    onEdit={() => openPanel({ kind: 'edit', id: entry.id })}
                  />
                ))}
              </tbody>
            </table>
          )}

          <div className="wc-address-book__add">
            <button
              aria-describedby={full ? 'address-book-full-note' : undefined}
              aria-expanded={panel.kind === 'add'}
              className="wc-btn primary"
              disabled={full || panelOpen}
              onClick={() => openPanel({ kind: 'add' })}
              ref={addButtonRef}
              type="button"
            >
              배송지 추가
            </button>
            {full ? (
              <p className="wc-address-book__note" id="address-book-full-note">
                배송지는 최대 {ADDRESS_BOOK_LIMIT}개까지 저장할 수 있어요. 쓰지 않는 배송지를 지우면 새로 추가할 수 있어요.
              </p>
            ) : null}
          </div>

          {panelOpen ? (
            <section aria-labelledby="address-book-panel-heading" className="wc-address-book__panel">
              <h2 className="wc-address-book__panel-title" id="address-book-panel-heading" ref={panelHeadingRef} tabIndex={-1}>
                {panel.kind === 'add' ? '배송지 추가' : '배송지 수정'}
              </h2>
              <AddressBookForm
                entry={editing}
                firstEntry={book.length === 0}
                idPrefix="address-book"
                key={panel.kind === 'edit' ? panel.id : 'add'}
                onCancel={closePanel}
                onSaved={onSaved}
                submitLabel={panel.kind === 'add' ? '배송지 저장' : '수정 내용 저장'}
              />
            </section>
          ) : null}
        </>
      )}

      <div className="wc-address-book__guide">
        <p className="wc-address-book__guide-title">이용 안내</p>
        <ul>
          <li>기본 배송지는 주문서를 열 때 배송지로 먼저 채워져요. 주문서에서 다른 배송지를 고르거나 새로 입력할 수 있어요.</li>
          <li>주문에는 주문할 때의 배송지가 따로 저장돼요. 여기서 고치거나 지워도 이미 한 주문의 배송지는 바뀌지 않아요.</li>
          <li>선물 받는 분의 주소는 주소록에 저장하지 않아요.</li>
          <li>회원 탈퇴가 처리되면 주소록도 바로 삭제돼요. 그 전에 여기서 언제든 직접 지울 수 있어요.</li>
        </ul>
      </div>
    </MypageShell>
  );
}

function AddressRow({
  busy,
  confirming,
  entry,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onEdit,
}: {
  busy: boolean;
  confirming: boolean;
  entry: AddressBookEntry;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  return (
    <>
      <tr className={entry.isDefault ? 'is-default' : undefined}>
        <th scope="row">
          <span className="wc-address-book__name">
            <strong>{entry.label}</strong>
            {entry.isDefault ? <span className="wc-address-book__badge">기본 배송지</span> : null}
          </span>
          <span className="wc-address-book__recipient">{entry.recipientName}</span>
        </th>
        <td className="wc-address-book__address">{addressBookAddressLine(entry)}</td>
        <td className="wc-address-book__phone">
          <span className="wc-address-book__cell-label">연락처 </span>
          {maskAddressBookPhone(entry.phone)}
        </td>
        <td className="wc-address-book__actions">
          <button aria-label={`${entry.label} 수정`} className="wc-address-book__row-action" disabled={busy} onClick={onEdit} type="button">수정</button>
          <button
            aria-expanded={confirming}
            aria-label={`${entry.label} 삭제`}
            className="wc-address-book__row-action"
            disabled={busy}
            onClick={confirming ? onCancelDelete : onAskDelete}
            type="button"
          >
            삭제
          </button>
        </td>
      </tr>
      {confirming ? (
        <tr className="wc-address-book__confirm">
          <td colSpan={4}>
            <p role="alert">
              {`'${entry.label}' 배송지를 삭제할까요?`}
              {entry.isDefault ? ' 기본 배송지라서, 지우면 남은 배송지 가운데 가장 최근에 추가하거나 고친 배송지가 기본 배송지가 돼요.' : null}
            </p>
            <div className="wc-address-book__confirm-actions">
              <button className="wc-btn" disabled={busy} onClick={onCancelDelete} type="button">취소</button>
              <button className="wc-btn primary" disabled={busy} onClick={onDelete} type="button">삭제</button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
