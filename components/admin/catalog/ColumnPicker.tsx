'use client';

import { useMemo } from 'react';
import { useBrowserStoredValue, writeBrowserStoredValue } from './browser-store';

export interface CatalogColumnOption {
  key: string;
  label: string;
  /** 항상 보이는 열. 식별 열(ID·이름)은 감출 수 없다. */
  locked?: boolean;
}

function parseHidden(raw: string, columns: readonly CatalogColumnOption[]) {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (key): key is string => typeof key === 'string'
        && columns.some((column) => column.key === key && !column.locked),
    );
  } catch {
    return [];
  }
}

/**
 * 표시 열 선택 — 열 목록은 화면이 정하고 감춘 열만 브라우저에 저장한다.
 *
 * 열 순서는 바꾸지 않는다 — 순서까지 저장하면 동료가 보는 표와 열 위치가 달라져
 * "세 번째 칸이 가격"이라는 대화가 안 된다.
 */
export function useColumnVisibility(storageKey: string, columns: readonly CatalogColumnOption[]) {
  const raw = useBrowserStoredValue(storageKey);
  const hidden = useMemo(() => parseHidden(raw, columns), [raw, columns]);

  function toggle(key: string, visible: boolean) {
    const next = visible ? hidden.filter((current) => current !== key) : [...hidden, key];
    writeBrowserStoredValue(storageKey, JSON.stringify(next));
  }

  return {
    hidden,
    isVisible: (key: string) => !hidden.includes(key),
    toggle,
  };
}

export function ColumnPicker({
  columns,
  hidden,
  idPrefix = 'admin-catalog-columns',
  onToggle,
}: {
  columns: readonly CatalogColumnOption[];
  hidden: readonly string[];
  idPrefix?: string;
  onToggle: (key: string, visible: boolean) => void;
}) {
  const visibleCount = columns.length - hidden.length;

  return (
    <details className="admin-console-columns">
      <summary className="btn btn-sm btn-ghost">
        표시 열{hidden.length ? ` ${visibleCount}/${columns.length}` : ''}
      </summary>
      <div aria-label="표시 열 선택" className="admin-console-columns-menu card" role="group">
        {columns.map((column) => {
          const id = `${idPrefix}-${column.key}`;
          return (
            <label htmlFor={id} key={column.key}>
              <input
                checked={!hidden.includes(column.key)}
                disabled={column.locked}
                id={id}
                onChange={(event) => onToggle(column.key, event.target.checked)}
                type="checkbox"
              />
              <span>{column.label}</span>
            </label>
          );
        })}
        <span className="muted admin-console-columns-note">이 브라우저에만 저장됩니다.</span>
      </div>
    </details>
  );
}
