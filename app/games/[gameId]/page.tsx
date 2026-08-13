import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getGameCatalogEntry } from '@/lib/games/catalog';
import { GameScreen } from '@/components/games/GameScreen';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';

/* 게임 = 자기완결 웹 번들(ADR-0002). 셸 없이 풀블리드로 렌더되고,
 * Expo(V2+)는 이 URL을 webview로 그대로 로드한다.
 * 카탈로그는 supabase 모드에서 games 테이블, mock 모드에서 DATA.GAMES(#64). */

const getEntry = cache(getGameCatalogEntry);
const getCardRewardsEnabled = cache(readCardRewardsEnabled);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  if (!await getCardRewardsEnabled()) return { title: 'ICONS' };
  const { gameId } = await params;
  const entry = await getEntry(gameId);
  return { title: entry ? `${entry.game.title} — ICONS` : 'ICONS' };
}

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  if (!await getCardRewardsEnabled()) notFound();
  const { gameId } = await params;
  const entry = await getEntry(gameId);
  if (!entry) notFound();
  return <GameScreen game={entry.game} source={entry.source} cards={entry.cards} />;
}
