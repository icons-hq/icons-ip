'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { DATA } from '@/lib/data';
import {
  MOCK_TICKET_PREFIX,
  mapOpenTicketError,
  normalizeGrantedCards,
  type OpenPackErrorCode,
  type OpenedCard,
} from '@/lib/draw-tickets';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { resolveCatalogSource } from '@/lib/catalog-source';

/* 카드팩 개봉(#71) — 카드는 open_draw_ticket RPC가 결정하고(#62),
 * 클라이언트 reveal 연출은 코스메틱이다(ADR-0002). */

export type OpenPackResult =
  | { status: 'opened'; cards: OpenedCard[] }
  | { status: 'error'; code: OpenPackErrorCode; message: string };

const ERROR_MESSAGES: Record<OpenPackErrorCode, string> = {
  not_found: '카드팩을 찾을 수 없어요. 새로고침 후 다시 시도해주세요.',
  already_opened: '이미 개봉된 카드팩이에요. 새로고침 후 다시 시도해주세요.',
  pool_empty: '카드 구성을 준비 중인 카드팩이에요. 잠시 후 다시 시도해주세요.',
  unknown: '카드팩을 개봉하지 못했어요. 잠시 후 다시 시도해주세요.',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const failure = (code: OpenPackErrorCode): OpenPackResult => ({
  status: 'error',
  code,
  message: ERROR_MESSAGES[code],
});

/** mock 데모 개봉 — ordinal 기반 결정론(서버가 결정, RNG 없음). 상태 없는 데모라 재개봉 가능. */
function openMockTicket(ticketId: string): OpenPackResult {
  const [ipId, ordinal] = ticketId.slice(MOCK_TICKET_PREFIX.length).split(':');
  const pool = DATA.CARDS.filter((c) => c.ip === ipId);
  const index = Number.parseInt(ordinal ?? '', 10);
  if (!pool.length || Number.isNaN(index)) return failure('not_found');
  const card = pool[(index - 1) % pool.length];
  return { status: 'opened', cards: [{ cardId: card.id, rarity: card.rarity, isNew: !card.owned }] };
}

export async function openDrawTicketAction(ticketId: string): Promise<OpenPackResult> {
  const source = resolveCatalogSource({ isSupabaseConfigured: getSupabaseConfig().isConfigured });
  if (source === 'mock') {
    return ticketId.startsWith(MOCK_TICKET_PREFIX) ? openMockTicket(ticketId) : failure('not_found');
  }

  if (!UUID_RE.test(ticketId)) return failure('not_found');

  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/packs')}`);
  }
  if (!isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath('/packs'));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('open_draw_ticket', { p_ticket_id: ticketId });
  if (error) return failure(mapOpenTicketError(error.message));

  const cards = normalizeGrantedCards(data);
  if (!cards.length) return failure('unknown');

  revalidatePath('/packs');
  revalidatePath('/binder');
  return { status: 'opened', cards };
}
