import type { SVGProps } from 'react';

/* 헤더 아이콘 3종 — Figma 원본(`ICONS` 파일 헤더, 선 2.17)을 그대로 옮긴 글리프다. 색은 CSS(`currentColor`)가 정한다.
   사이트 전역 `components/ui/Icon`의 search·bag·user는 다른 화면이 함께 쓰므로 바꾸지 않고 헤더만 이 글리프를 쓴다.
   장식이다 — 접근 이름은 감싸는 버튼·링크의 aria-label이 가진다. */

type GlyphProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox' | 'width' | 'height'>;

const STROKE = 2.16667;

export function SearchGlyph(props: GlyphProps) {
  return (
    <svg aria-hidden="true" focusable="false" fill="none" height="20.8" overflow="visible" viewBox="0 0 19.6886 20.7836" width="19.7" {...props}>
      <path d="M9.11419 17.1451C13.5495 17.1451 17.145 13.5495 17.145 9.11419C17.145 4.67887 13.5495 1.08333 9.11419 1.08333C4.67887 1.08333 1.08333 4.67887 1.08333 9.11419C1.08333 13.5495 4.67887 17.1451 9.11419 17.1451Z" stroke="currentColor" strokeWidth={STROKE} />
      <path d="M14.2248 15.3198L18.6052 19.7003" stroke="currentColor" strokeLinecap="round" strokeWidth={STROKE} />
    </svg>
  );
}

export function CartGlyph(props: GlyphProps) {
  return (
    <svg aria-hidden="true" focusable="false" fill="none" height="24.2" overflow="visible" viewBox="0 0 22.2 24.1673" width="22.2" {...props}>
      <path d="M6.80714 8.95357V5.37619C6.80714 -0.34762 15.3929 -0.34762 15.3929 5.37619V8.95357" stroke="currentColor" strokeLinecap="round" strokeWidth={STROKE} />
      <path d="M2.51429 7.34351H19.6857L21.1167 23.084H1.08334L2.51429 7.34351Z" stroke="currentColor" strokeLinejoin="round" strokeWidth={STROKE} />
    </svg>
  );
}

export function MyGlyph(props: GlyphProps) {
  return (
    <svg aria-hidden="true" focusable="false" fill="none" height="23.1" overflow="visible" viewBox="0 0 22.2 23.0636" width="22.2" {...props}>
      <path d="M11.1 12.1374C14.1525 12.1374 16.627 9.6629 16.627 6.61039C16.627 3.55788 14.1525 1.08333 11.1 1.08333C8.04746 1.08333 5.57291 3.55788 5.57291 6.61039C5.57291 9.6629 8.04746 12.1374 11.1 12.1374Z" stroke="currentColor" strokeWidth={STROKE} />
      <path d="M1.08333 21.6226C1.08333 17.3116 4.66072 12.6791 11.1 12.6791C17.5393 12.6791 21.1167 17.6694 21.1167 21.9803" stroke="currentColor" strokeLinecap="round" strokeWidth={STROKE} />
    </svg>
  );
}
