'use client';

import { useSyncExternalStore } from 'react';

/*
 * 운영자 브라우저에만 남는 값(표시 열·고시정보 프리셋)의 외부 저장소.
 *
 * useSyncExternalStore 로 읽는 이유: 서버 렌더와 하이드레이션은 빈 값으로 같아야 하고,
 * 저장값은 클라이언트에서 구독으로 읽어야 한다(effect 안의 setState 는 린트가 막고,
 * 하이드레이션 불일치도 만든다). 저장소를 못 쓰는 브라우저(시크릿 모드 등)에서는
 * 메모리에만 남아 이 탭 안에서 유지된다.
 */

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

export function writeBrowserStoredValue(storageKey: string, raw: string) {
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

const serverSnapshot = () => '';

/** 저장된 원문(문자열). 없으면 빈 문자열 — 파싱은 호출자가 한다. */
export function useBrowserStoredValue(storageKey: string) {
  return useSyncExternalStore(subscribe, () => readRaw(storageKey), serverSnapshot);
}
