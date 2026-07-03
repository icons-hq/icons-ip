'use client';

import { usePathname } from 'next/navigation';

/* 라우트별 atmos 블룸 변형 — 값 진실원은 globals.css .bg-atmos--* */
const VARIANTS: [prefix: string, variant: string][] = [
  ['/ip', 'iphub'],
  ['/shop', 'shop'],
  ['/gacha', 'gacha'],
  ['/events', 'events'],
  ['/community', 'community'],
  ['/binder', 'binder'],
  ['/search', 'search'],
  ['/login', 'login'],
  ['/market', 'market'],
  ['/exchange', 'exchange'],
];

export function Atmos() {
  const pathname = usePathname();
  const variant = VARIANTS.find(([p]) => pathname === p || pathname.startsWith(p + '/'))?.[1];
  return <div aria-hidden className={'bg-atmos' + (variant ? ` bg-atmos--${variant}` : '')} />;
}
