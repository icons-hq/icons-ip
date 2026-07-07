'use server';

import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';
import type { GamePlayResult } from '@/lib/games/host';

/* 참여형 게임 플레이(#64) — 결과는 play_game RPC가 결정한다(ADR-0002).
 * 게임은 공개 진입이므로 미로그인은 redirect가 아니라 에러 객체로 돌려주고,
 * 로그인 CTA는 풀블리드 게임 화면 안에서 노출한다. */

export type PlayGameActionResult =
  | { ok: true; result: GamePlayResult }
  | { ok: false; error: 'auth_required' | 'onboarding_required' | 'play_failed' };

export async function playGameAction(gameId: string): Promise<PlayGameActionResult> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { ok: false, error: 'auth_required' };
  if (!isOnboarded(auth.profile, auth.user.email)) return { ok: false, error: 'onboarding_required' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('play_game', { p_game_id: gameId });
  if (error || !data) return { ok: false, error: 'play_failed' };
  return { ok: true, result: data as GamePlayResult };
}
