'use client';

import { useMemo, useSyncExternalStore } from 'react';

export interface CatalogColumnOption {
  key: string;
  label: string;
  /** 항상 보이는 열. 식별 열(ID·이름)은 감출 수 없다. */
  locked?: boolean;
}

/* 저장소를 못 쓰는 브라우저(시크릿 모드 등)에서는 이 탭 안에서만 기억한다. */
const memoryStore = new Map<string, string>();
const listeners = new Set<() => void>();

function readRaw(storageKey: string) {
  const inMemory = memoryStore.get(storageKey);
  if (inMemory !== undefined) return inMemory;
  try {
    return window.localStorage.getItem(storageKey) ?? '';
  } catch {
    return '';
  }
}

function writeRaw(storageKey: string, raw: string) {
  memoryStore.set(storageKey, raw);
  try {
    window.localStorage.setItem(storageKey, raw);
  } catch {
    /* 메모리에는 남았으니 이번 화면에서는 유지된다. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
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
 * 서버 렌더와 하이드레이션은 기본 열(전부 표시)로 같아야 하므로 서버 스냅샷은 빈 값이고,
 * 저장값은 클라이언트에서 외부 저장소 구독으로 읽는다. 열 순서는 바꾸지 않는다 —
 * 순서까지 저장하면 동료가 보는 표와 열 위치가 달라져 "세 번째 칸이 가격"이라는 대화가
 * 안 된다.
 */
export function useColumnVisibility(storageKey: string, columns: readonly CatalogColumnOption[]) {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(storageKey),
    () => '',
  );
  const hidden = useMemo(() => parseHidden(raw, columns), [raw, columns]);

  function toggle(key: string, visible: boolean) {
    const next = visible ? hidden.filter((current) => current !== key) : [...hidden, key];
    writeRaw(storageKey, JSON.stringify(next));
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
