'use client';

import { useRef, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { SUGGESTED_SEARCH_TERMS, searchPlaceholder } from '@/lib/search-terms';
import { useOverlayA11y } from './useOverlayA11y';

/* 헤더 검색 패널(11 §6 B5). 로고 행 바로 아래에서 GNB 행을 덮고, 그 아래 본문은 10% 딤 + 5px 흐림이다.
   위치는 sticky 헤더 상자 기준이라 공지·유틸바·축약 여부와 무관하게 실제 로고 행 아래에 붙는다(wc-chrome.css).
   ESC 닫기·포커스 트랩·배경 inert·스크롤 잠금은 useOverlayA11y가 맡는다 — 레퍼런스의 ESC 미지원은 옮기지 않는다.
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
        {/* 모바일은 [뒤로][입력][검색] 한 줄이다. 데스크톱은 1180×60 회색 칸 하나로 보이고(돋보기는 칸 안 왼쪽 장식),
            뒤로·검색 버튼은 화면에서 감춘다 — 닫기는 백드롭·ESC, 제출은 Enter. 두 버튼은 접근 이름과 키보드 순서에
            남아 있고 포커스가 오면 칸 안 오른쪽에 드러난다(wc-chrome.css .wc-search__aux). */}
        <form action="/search" className="wc-container wc-search__form" onSubmit={submit} role="search">
          <button aria-label="검색 닫기" className="wc-icon-btn wc-search__aux" onClick={onClose} type="button">
            <Icon name="chevronLeft" size={24} />
          </button>
          <div className="wc-search__field">
            <span aria-hidden className="wc-search__field-icon">
              <Icon name="search" size={22} />
            </span>
            <input
              aria-label="검색어"
              className="wc-search__input"
              defaultValue=""
              enterKeyHint="search"
              name="q"
              placeholder={searchPlaceholder()}
              ref={inputRef}
              type="search"
            />
          </div>
          <button aria-label="검색" className="wc-icon-btn wc-search__aux" type="submit">
            <Icon name="search" size={24} />
          </button>
        </form>
        {/* 최근 검색어도 자동완성도 없는 패널이라, 빈 인풋 앞에서 다음 행동을 주는 건 이 칩 행뿐이다.
            링크라서 JS 없이도 동작한다 — onClose 는 라우팅이 시작된 뒤 패널을 걷는 정리일 뿐이다.
            칩 구성(운영 편집)은 L8b 몫이고 여기서는 라벨만 레퍼런스 문법('추천')에 맞춘다. */}
        <div className="wc-container wc-search__chips">
          <p className="wc-search__chips-label">추천</p>
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
