import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isAccountSuspended } from '@/lib/auth/onboarding';
import { getGameCatalogEntry } from '@/lib/games/catalog';
import { GameScreen } from '@/components/games/GameScreen';
import { HyosanMemoriesEntry } from '@/components/games/hyosan-memories/HyosanMemoriesEntry.client';
import hyosanStyles from '@/components/games/hyosan-memories/HyosanMemories.module.css';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';

/* 현재 제품의 웹 참여형 게임 경로. 셸 없이 풀블리드로 렌더되며,
 * 카탈로그는 supabase 모드에서 games 테이블, mock 모드에서 DATA.GAMES(#64)를 쓴다. */

const getEntry = cache(getGameCatalogEntry);
const getCardRewardsEnabled = cache(readCardRewardsEnabled);
const HYOSAN_MEMORIES_GAME_ID = 'hyosan-memories';

function HyosanLoginGate() {
  const next = `/games/${HYOSAN_MEMORIES_GAME_ID}`;
  return (
    <main
      className={hyosanStyles.accessGate}
      data-hyosan-access="login-required"
      aria-labelledby="hyosan-access-title"
    >
      <span className={hyosanStyles.loadingEyebrow}>MEMORY ECHO / ACCESS REQUIRED</span>
      <h1 id="hyosan-access-title">효산의 기억</h1>
      <p>보호된 참여 기능입니다. 로그인 후 그레이박스를 시작할 수 있습니다.</p>
      <Link className={hyosanStyles.loginButton} href={`/login?next=${encodeURIComponent(next)}`}>
        로그인하고 플레이
      </Link>
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  if (gameId === HYOSAN_MEMORIES_GAME_ID) return { title: '효산의 기억 — ICONS' };
  if (!await getCardRewardsEnabled()) return { title: 'ICONS' };
  const entry = await getEntry(gameId);
  return { title: entry ? `${entry.game.title} — ICONS` : 'ICONS' };
}

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  if (gameId === HYOSAN_MEMORIES_GAME_ID) {
    const auth = await getCurrentAuthState();
    if (!auth.isConfigured || !auth.user) return <HyosanLoginGate />;
    if (auth.user && isAccountSuspended(auth.profile)) redirect('/account-suspended');
    return <HyosanMemoriesEntry />;
  }
  if (!await getCardRewardsEnabled()) notFound();
  const entry = await getEntry(gameId);
  if (!entry) notFound();
  return <GameScreen game={entry.game} source={entry.source} cards={entry.cards} />;
}
