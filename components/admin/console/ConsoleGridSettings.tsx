'use client';

import { useId, useRef, useState } from 'react';
import { moveGridColumn, normalizeGridPreferences, type GridPreferences } from '@/lib/admin/grid-preferences';
import type { ConsoleGridColumn } from './ConsoleGrid';

export function ConsoleGridSettings({ columns, preferences, onSave }: {
  columns: ConsoleGridColumn[];
  preferences: GridPreferences;
  onSave: (next: GridPreferences) => boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState(preferences);
  const [message, setMessage] = useState('');
  const byKey = new Map(columns.map((column, index) => [column.key, { ...column, required: index === 0 || column.required }]));
  const visible = draft.order.filter((key) => !draft.hidden.includes(key));
  const close = () => dialog.current?.close();

  return (
    <div className="admin-grid-settings">
      {message ? <span role="status">{message}</span> : null}
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => {
        setDraft(preferences);
        dialog.current?.showModal();
      }}>조회항목 설정</button>
      <dialog aria-labelledby={titleId} className="admin-grid-settings-dialog" ref={dialog}>
        <header>
          <h2 id={titleId}>조회항목 설정</h2>
          <button aria-label="조회항목 설정 닫기" className="admin-grid-settings-close" type="button" onClick={close}>×</button>
        </header>
        <div className="admin-grid-settings-body">
          <p>목록에 표시할 항목과 순서를 선택하세요. 필수 항목은 항상 표시됩니다.</p>
          <div className="admin-grid-settings-lists">
            <section aria-label="조회항목 선택">
              <h3>조회항목</h3>
              <ul>{columns.map((column, index) => (
                <li key={column.key}>
                  <label>
                    <input type="checkbox" checked={!draft.hidden.includes(column.key)} disabled={index === 0 || column.required} onChange={(event) => {
                      const hidden = event.target.checked ? draft.hidden.filter((key) => key !== column.key) : [...draft.hidden, column.key];
                      setDraft(normalizeGridPreferences({ ...draft, hidden }, columns));
                    }} />
                    {column.label}{index === 0 || column.required ? <small>필수</small> : null}
                  </label>
                </li>
              ))}</ul>
            </section>
            <section aria-label="조회항목 순서">
              <h3>선택한 항목 <span>{visible.length}개</span></h3>
              <ol>{draft.order.map((key, index) => {
                const column = byKey.get(key);
                if (!column) return null;
                return <li key={key} data-hidden={draft.hidden.includes(key) || undefined}>
                  <span>{column.label}{draft.hidden.includes(key) ? <small>숨김</small> : null}</span>
                  <div>
                    <button aria-label={`${column.label} 위로`} disabled={index === 0} type="button" onClick={() => setDraft(moveGridColumn(draft, key, -1))}>↑</button>
                    <button aria-label={`${column.label} 아래로`} disabled={index === draft.order.length - 1} type="button" onClick={() => setDraft(moveGridColumn(draft, key, 1))}>↓</button>
                  </div>
                </li>;
              })}</ol>
            </section>
          </div>
          <label className="admin-grid-settings-freeze">틀고정
            <select value={draft.frozenCount} onChange={(event) => setDraft({ ...draft, frozenCount: Number(event.target.value) })}>
              {Array.from({ length: Math.min(4, visible.length) + 1 }, (_, count) => <option key={count} value={count}>{count === 0 ? '사용 안 함' : `왼쪽 ${count}열`}</option>)}
            </select>
          </label>
          <p className="admin-grid-settings-note">설정은 이 브라우저에서 사용하는 관리자 계정별로 저장됩니다.</p>
        </div>
        <footer>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => setDraft(normalizeGridPreferences(null, columns))}>기본값 복원</button>
          <div>
            <button className="btn btn-sm btn-ghost" type="button" onClick={close}>취소</button>
            <button className="btn btn-sm" type="button" onClick={() => {
              const persisted = onSave(normalizeGridPreferences(draft, columns));
              setMessage(persisted ? '조회항목 설정을 저장했습니다.' : '현재 화면에 적용했습니다. 브라우저 저장소를 사용할 수 없어 새로고침하면 초기화됩니다.');
              close();
            }}>확인</button>
          </div>
        </footer>
      </dialog>
    </div>
  );
}
