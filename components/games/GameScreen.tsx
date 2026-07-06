'use client';

import { useMemo } from 'react';
import type { Game } from '@/lib/data';
import { createWebGameHost } from '@/lib/games/host';
import { MarbleRoulette } from './MarbleRoulette';

/* 웹 호스트 조립 지점 — Expo(V2+)는 이 층에서 postMessage 브리지 호스트로 교체된다(ADR-0002).
 * 게임 컴포넌트는 PopupGameHost 인터페이스만 안다. */
export function GameScreen({ game }: { game: Game }) {
  const host = useMemo(() => createWebGameHost(), []);
  return <MarbleRoulette game={game} host={host} />;
}
