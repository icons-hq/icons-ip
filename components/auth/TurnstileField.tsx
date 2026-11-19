'use client';

import { useEffect, useRef } from 'react';

/*
 * Cloudflare Turnstile 위젯. NEXT_PUBLIC_TURNSTILE_SITE_KEY가 없으면 아무것도 그리지 않는다(꺼짐).
 * 토큰은 form 안의 숨은 입력 cf-turnstile-response로 서버 액션에 실리고, 서버가 siteverify로 검증한다
 * (lib/auth/mail-abuse.server.ts). 토큰은 한 번만 쓸 수 있어, React가 액션이 끝난 뒤 폼을 reset하면 위젯도 새로 받는다.
 * 'interaction-only'라 사람이 풀어야 할 때만 보이고, 평소에는 가입·재설정 화면의 모양을 바꾸지 않는다.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const TURNSTILE_FIELD_NAME = 'cf-turnstile-response';

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error('turnstile script failed'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileField() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!siteKey) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    let widgetId: string | null = null;
    const form = host.closest('form');

    const clearToken = () => {
      if (inputRef.current) inputRef.current.value = '';
    };
    const onReset = () => {
      clearToken();
      if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
    };
    form?.addEventListener('reset', onReset);

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetId = window.turnstile.render(host, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          callback: (token: string) => {
            if (inputRef.current) inputRef.current.value = token;
          },
          'expired-callback': clearToken,
          'error-callback': clearToken,
        });
      })
      .catch(() => {
        /* 스크립트를 못 받으면 토큰이 없어 서버가 거절한다 — 화면 문구는 서버 응답이 안내한다. */
      });

    return () => {
      cancelled = true;
      form?.removeEventListener('reset', onReset);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return (
    <>
      <input name={TURNSTILE_FIELD_NAME} ref={inputRef} type="hidden" />
      <div data-turnstile-host ref={hostRef} />
    </>
  );
}
