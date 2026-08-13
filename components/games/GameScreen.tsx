'use client';

import { useMemo } from 'react';
import type { Card, Game } from '@/lib/data';
import type { CatalogSource } from '@/lib/catalog-source';
import { playGameAction } from '@/app/games/actions';
import { createWebGameHost } from '@/lib/games/host';
import { MarbleRoulette } from './MarbleRoulette';

/* 웹 참여형 게임의 호스트 조립 지점. Expo/webview 호스트는 현 로드맵에 없다.
 * 게임 컴포넌트는 legacy 이름의 PopupGameHost 인터페이스만 안다.
 * card variant × supabase 모드에서만 play_game RPC 경로를 주입한다(#64) —
 * goods variant는 retired 연출 데모라 mock에서만 유지한다. */
export function GameScreen({ game, source, cards }: { game: Game; source: CatalogSource; cards: Card[] }) {
  const remote = source === 'supabase' && game.config.variant.kind === 'card';
  const host = useMemo(
    () => createWebGameHost(remote ? { remotePlay: playGameAction } : {}),
    [remote],
  );
  return <MarbleRoulette game={game} host={host} cards={cards} live={remote} />;
}
