import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getGameCatalogEntry } from '@/lib/games/catalog';
import { GameScreen } from '@/components/games/GameScreen';

/* 현재 참여형 게임은 웹 전용 풀블리드 화면이다. Expo/webview 호스트는 현 로드맵에 없다.
 * 카탈로그는 supabase 모드에서 games 테이블, mock 모드에서 DATA.GAMES(#64). */

const getEntry = cache(getGameCatalogEntry);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const entry = await getEntry(gameId);
  return { title: entry ? `${entry.game.title} — ICONS` : 'ICONS' };
}

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const entry = await getEntry(gameId);
  if (!entry) notFound();
  return <GameScreen game={entry.game} source={entry.source} cards={entry.cards} />;
}
