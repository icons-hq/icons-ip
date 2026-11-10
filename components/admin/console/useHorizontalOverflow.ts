'use client';

import { useEffect, useRef, useState } from 'react';

/** 가로로 스크롤되는 요소가 오른쪽으로 더 볼 내용이 있는지 추적한다(잘린 열 표시용). */
export function useHorizontalOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element?.addEventListener) return;
    const update = () => setMore(element.scrollWidth - element.clientWidth - element.scrollLeft > 4);
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    return () => { element.removeEventListener('scroll', update); observer?.disconnect(); };
  }, []);
  return { ref, more };
}
