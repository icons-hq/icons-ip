'use client';

import { useRef, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { SUGGESTED_SEARCH_TERMS } from '@/lib/search-terms';
import { useOverlayA11y } from './useOverlayA11y';

/* 헤더 검색 패널. 데스크톱에서는 헤더 아래로 펼쳐지고 모바일에서는 상단을 덮는다(수치는 wc-chrome.css).
   form의 action="/search"를 남겨 JS 없이도 검색이 성립하게 두고, JS가 살아 있으면 라우터로 가로챈다. */
export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useOverlayA11y({ open, onClose, panelRef, initialFocusRef: inputRef });

  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = inputRef.current?.value.trim();
    /* 빈 검색어로 결과 없는 페이지를 열지 않는다 — 패널은 그대로 둔다. */
    if (!q) return;
    router.push('/search?q=' + encodeURIComponent(q));
    onClose();
  };

  return (
    <>
      <div aria-hidden className="wc-search-backdrop" onClick={onClose} />
      <div ref={panelRef} aria-label="검색" aria-modal="true" className="wc-search" role="dialog">
        <form action="/search" className="wc-container wc-search__form" onSubmit={submit} role="search">
          <button aria-label="검색 닫기" className="wc-icon-btn" onClick={onClose} type="button">
            <Icon name="chevronLeft" size={24} />
          </button>
          <input
            aria-label="검색어"
            className="wc-search__input"
            defaultValue=""
            name="q"
            placeholder="IP · 굿즈 · 카드 · 포스트 통합 검색"
            ref={inputRef}
            type="search"
          />
          <button aria-label="검색" className="wc-icon-btn" type="submit">
            <Icon name="search" size={24} />
          </button>
        </form>
        {/* 최근 검색어도 자동완성도 없는 패널이라, 빈 인풋 앞에서 다음 행동을 주는 건 이 칩 행뿐이다.
            링크라서 JS 없이도 동작한다 — onClose 는 라우팅이 시작된 뒤 패널을 걷는 정리일 뿐이다. */}
        <div className="wc-container wc-search__chips">
          <p className="wc-search__chips-label">추천 검색어</p>
          {SUGGESTED_SEARCH_TERMS.map((term) => (
            <Link
              key={term}
              className="wc-search__chip"
              href={`/search?q=${encodeURIComponent(term)}`}
              onClick={onClose}
            >
              {term}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
