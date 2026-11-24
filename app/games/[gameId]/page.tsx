import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isAccountSuspended, isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { HyosanMemoriesEntry } from '@/components/games/hyosan-memories/HyosanMemoriesEntry.client';
import hyosanStyles from '@/components/games/hyosan-memories/HyosanMemories.module.css';

/* 넷플릭스 지우학 캠페인(`/ip/aouad`)의 게임 「효산의 기억」만 여는 경로다. 셸 없이 풀블리드로 렌더된다.
 * 카드 리워드용 참여형 게임(마블 룰렛 등)은 2026-11-24 일반 쇼핑몰 전환으로 지웠다(ADR-0052) — 다른 게임 ID 는 404 다. */

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
  return { title: gameId === HYOSAN_MEMORIES_GAME_ID ? '효산의 기억 — 엑스스퀘어' : '엑스스퀘어' };
}

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  if (gameId !== HYOSAN_MEMORIES_GAME_ID) notFound();
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return <HyosanLoginGate />;
  if (isAccountSuspended(auth.profile)) redirect('/account-suspended');
  if (!isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath(`/games/${HYOSAN_MEMORIES_GAME_ID}`));
  }
  return <HyosanMemoriesEntry />;
}
