'use client';

import { useEffect } from 'react';

/*
 * 10/27 회의 R18: 어드민 금액·수량 입력에 포커스를 둔 채 페이지를 휠로 내리면 브라우저가 숫자를 바꾼다.
 * 휠이 포커스된 어드민 number 입력 위에서 일어나면 포커스를 풀어 값은 그대로 두고 페이지만 스크롤한다.
 * 스피너 숨김은 wc-admin.css의 `.wc-admin input[type='number']` 규칙이 맡는다. 셸에 한 번만 마운트한다.
 */
type WheelTarget = { tagName?: string; type?: string; closest?: (selector: string) => unknown; blur?: () => void };

/** 포커스된 어드민 number 입력 위의 휠이면 포커스를 풀고 true를 돌려준다. */
export function releaseAdminNumberInputOnWheel(target: EventTarget | null, activeElement: Element | null): boolean {
  const input = target as WheelTarget | null;
  if (!input || input !== (activeElement as unknown) || input.tagName !== 'INPUT' || input.type !== 'number'
    || typeof input.closest !== 'function' || !input.closest('.wc-admin') || typeof input.blur !== 'function') return false;
  input.blur();
  return true;
}

export function installAdminNumberWheelGuard(root: Pick<Document, 'addEventListener' | 'removeEventListener'> & { activeElement: Element | null }) {
  const listener = (event: Event) => { releaseAdminNumberInputOnWheel(event.target, root.activeElement); };
  root.addEventListener('wheel', listener, { capture: true, passive: true });
  return () => root.removeEventListener('wheel', listener, { capture: true });
}

export function AdminNumberWheelGuard() {
  useEffect(() => installAdminNumberWheelGuard(document), []);
  return null;
}
