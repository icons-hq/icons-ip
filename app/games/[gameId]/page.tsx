import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getGameCatalogEntry } from '@/lib/games/catalog';
import { GameScreen } from '@/components/games/GameScreen';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';

/* 현재 제품의 웹 참여형 게임 경로. 셸 없이 풀블리드로 렌더되며,
 * 카탈로그는 supabase 모드에서 games 테이블, mock 모드에서 DATA.GAMES(#64)를 쓴다. */

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
