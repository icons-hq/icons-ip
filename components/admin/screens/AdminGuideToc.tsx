'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface AdminGuideTocItem { id: string; heading: string }

const SECTION_LINK = 'block rounded-md px-2 py-1 text-xs leading-snug text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=location]:bg-primary-soft aria-[current=location]:font-medium aria-[current=location]:text-primary-soft-foreground';

/**
 * 주제 안 섹션 목차. 넓은 화면에서는 본문 옆에 붙어 따라오고, 좁으면 접어 둔다 — 항목이 수십 개라 본문을 밀어내지 않게 한다.
 * 지금 읽는 섹션은 스크롤 위치로 찾아 `aria-current="location"`으로 표시한다.
 */
export function AdminGuideToc({ items }: { items: AdminGuideTocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  const [open, setOpen] = useState(false);
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    const sections = items.map(item => document.getElementById(item.id)).filter((node): node is HTMLElement => node !== null);
    if (!sections.length) return;
    const visible = new Set<string>();
    /* 셸 머리 아래부터 화면 위쪽 1/3 구간에 걸린 섹션 중 가장 앞의 것이 "지금 읽는 곳"이다. */
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id); else visible.delete(entry.target.id);
      }
      const current = items.find(item => visible.has(item.id));
      if (current) setActive(current.id);
    }, { rootMargin: '-64px 0px -65% 0px' });
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [items]);

  /* 목차가 화면보다 길면 현재 항목이 목차 안에서 보이게 맞춘다(페이지 스크롤은 건드리지 않는다). */
  useEffect(() => {
    const box = nav.current;
    if (!box || box.scrollHeight <= box.clientHeight) return;
    const link = box.querySelector<HTMLElement>('[aria-current]');
    if (!link) return;
    if (link.offsetTop < box.scrollTop || link.offsetTop + link.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = link.offsetTop - box.clientHeight / 3;
  }, [active]);

  return <nav aria-label="이 주제의 섹션" className="relative min-w-0 rounded-xl bg-card p-2 text-sm ring-1 ring-foreground/10 xl:sticky xl:top-16 xl:max-h-[calc(100svh-5rem)] xl:overflow-y-auto" data-guide="toc" ref={nav}>
    <button aria-expanded={open} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-medium hover:bg-muted xl:hidden" onClick={() => setOpen(value => !value)} type="button">
      <span>이 주제의 목차 <small className="text-xs font-normal text-muted-foreground tabular-nums">{items.length}개</small></span>
      <ChevronDown aria-hidden="true" className={`size-4 text-muted-foreground transition-transform${open ? ' rotate-180' : ''}`} />
    </button>
    <p className="hidden px-2 pt-1 pb-1.5 text-xs font-semibold text-secondary-foreground xl:block">이 주제의 목차 <span className="font-normal text-muted-foreground tabular-nums">{items.length}개</span></p>
    <ol className={`${open ? 'grid' : 'hidden'} grid-cols-1 gap-0.5 pt-1 sm:grid-cols-2 xl:grid xl:grid-cols-1 xl:pt-0`}>
      {items.map(item => <li className="min-w-0" key={item.id}>
        <a aria-current={active === item.id ? 'location' : undefined} className={SECTION_LINK} href={`#${item.id}`} onClick={() => setActive(item.id)}>{item.heading}</a>
      </li>)}
    </ol>
  </nav>;
}
