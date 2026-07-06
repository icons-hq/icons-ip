import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DATA } from '@/lib/data';
import { GameScreen } from '@/components/games/GameScreen';

/* 게임 = 자기완결 웹 번들(ADR-0002). 셸 없이 풀블리드로 렌더되고,
 * Expo(V2+)는 이 URL을 webview로 그대로 로드한다. */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const game = DATA.GAMES.find((g) => g.id === gameId);
  return { title: game ? `${game.title} — ICONS` : 'ICONS' };
}

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const game = DATA.GAMES.find((g) => g.id === gameId);
  if (!game) notFound();
  return <GameScreen game={game} />;
}
