'use client';

import { useMemo } from 'react';
import type { Card, Game } from '@/lib/data';
import type { CatalogSource } from '@/lib/catalog-source';
import { playGameAction } from '@/app/games/actions';
import { createWebGameHost } from '@/lib/games/host';
import { MarbleRoulette } from './MarbleRoulette';

/* 웹 호스트 조립 지점 — Expo(V2+)는 이 층에서 postMessage 브리지 호스트로 교체된다(ADR-0002).
 * 게임 컴포넌트는 PopupGameHost 인터페이스만 안다.
 * card variant × supabase 모드에서만 play_game RPC 경로를 주입한다(#64) —
 * goods variant는 래플 연출 데모라 실배선 전까지 mock 유지. */
export function GameScreen({ game, source, cards }: { game: Game; source: CatalogSource; cards: Card[] }) {
  const remote = source === 'supabase' && game.config.variant.kind === 'card';
  const host = useMemo(
    () => createWebGameHost(remote ? { remotePlay: playGameAction } : {}),
    [remote],
  );
  return <MarbleRoulette game={game} host={host} cards={cards} live={remote} />;
}
