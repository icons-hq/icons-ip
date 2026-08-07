'use client';

import { POSTCODE_SCRIPT_SRC, type PostcodeSelection } from './postcode';

/* 주소 검색 스크립트를 필요한 순간에만 내려받는다. 체크아웃 첫 렌더에 외부
   스크립트를 끼워 넣으면, 그 스크립트가 죽는 날 결제까지 같이 죽는다.
   실패(네트워크 오류·차단·무응답)는 캐시하지 않고 수기 입력으로 돌려보낸다. */

export interface PostcodeEmbedOptions {
  oncomplete: (selection: PostcodeSelection) => void;
  onclose?: (state: string) => void;
  width?: string;
  height?: string;
}

export interface PostcodeEmbedTarget {
  embed: (element: HTMLElement, options?: { autoClose?: boolean }) => void;
}

export type PostcodeConstructor = new (options: PostcodeEmbedOptions) => PostcodeEmbedTarget;

interface PostcodeGlobal {
  daum?: { Postcode?: PostcodeConstructor };
}

/** 응답 없는 스크립트는 error 이벤트를 주지 않는다. 무한 로딩 대신 실패로 끝낸다. */
export const POSTCODE_SCRIPT_TIMEOUT_MS = 10_000;

let pending: Promise<PostcodeConstructor> | null = null;

/** 테스트에서 모듈 캐시를 비운다. */
export function resetPostcodeSearchLoader() {
  pending = null;
}

export function loadPostcodeSearch(): Promise<PostcodeConstructor> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('postcode search requires a browser'));
  }

  const loaded = (window as unknown as PostcodeGlobal).daum?.Postcode;
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;

  const request = new Promise<PostcodeConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (outcome: () => void) => {
      if (timer !== null) clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      outcome();
    };
    const fail = (message: string) => settle(() => {
      pending = null;
      script.remove();
      reject(new Error(message));
    });

    script.src = POSTCODE_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const constructor = (window as unknown as PostcodeGlobal).daum?.Postcode;
      if (constructor) settle(() => resolve(constructor));
      else fail('postcode search script loaded without a constructor');
    };
    script.onerror = () => fail('postcode search script failed to load');
    timer = setTimeout(() => fail('postcode search script timed out'), POSTCODE_SCRIPT_TIMEOUT_MS);

    document.head.appendChild(script);
  });

  pending = request;
  return request;
}
