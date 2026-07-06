import { DATA, type Card } from '@/lib/data';
import type { RarityKey } from '@/lib/rarity';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/client';

/* PopupGameHost — 호스트(웹/Expo)↔게임 브리지 계약(게임 미니앱 스펙 §2).
 * 게임은 이 인터페이스만 의존하고, 결과·경품은 항상 서버가 결정한다(ADR-0002). */

export interface GrantedReward {
  kind: 'card';
  cardId: string;
  rarity: RarityKey;
  isNew: boolean;
}

export interface GamePlayResult {
  playId: string; // 멱등 키(재생/중복 방지)
  rewards: GrantedReward[]; // 서버가 정한 무상 보상
  animationSeed: string; // rewards에 도달하는 결정론적 코스메틱 연출 시드
}

export interface RaffleResult {
  raffleId: string;
  winners: string[];
  serverSeed: string;
  clientSeed: string;
  animationSeed: string;
  isWinner: boolean;
}

export interface PopupGameHost {
  getSession(): Promise<{ accessToken: string; userId: string } | null>;
  playGame(gameId: string): Promise<GamePlayResult>;
  getRaffleResult(raffleId: string): Promise<RaffleResult>;
  startPrizeCheckout(raffleId: string): Promise<void>;
  haptics(type: 'light' | 'success'): void;
  share(payload: { title: string; url: string }): Promise<void>;
  close(): void;
  track(event: string, props?: Record<string, unknown>): void;
}

/* mock 등급 가중치 — 실서버는 pool_odds 기반 roll_rarity(#64). 풀에 있는 등급만 정규화 */
const MOCK_RATES: Record<RarityKey, number> = { N: 40, R: 30, SR: 18, SSR: 8, HOLO: 4 };

function mockRollCard(pool: Card[]): Card {
  const present = (Object.keys(MOCK_RATES) as RarityKey[]).filter((r) =>
    pool.some((c) => c.rarity === r),
  );
  const total = present.reduce((sum, r) => sum + MOCK_RATES[r], 0);
  let roll = Math.random() * total;
  let rarity = present[present.length - 1];
  for (const r of present) {
    roll -= MOCK_RATES[r];
    if (roll <= 0) {
      rarity = r;
      break;
    }
  }
  const group = pool.filter((c) => c.rarity === rarity);
  return group[Math.floor(Math.random() * group.length)];
}

function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 웹 호스트 — getSession만 실배선, playGame은 mock(#64에서 play_game RPC로 승격). */
export function createWebGameHost(): PopupGameHost {
  return {
    async getSession() {
      // Supabase 미설정(mock 모드)에서도 게임은 공개 플레이를 유지한다
      if (!getSupabaseConfig().isConfigured) return null;
      const { data } = await createClient().auth.getSession();
      const session = data.session;
      return session ? { accessToken: session.access_token, userId: session.user.id } : null;
    },

    async playGame(gameId) {
      const game = DATA.GAMES.find((g) => g.id === gameId);
      if (!game) throw new Error(`unknown game: ${gameId}`);
      const pool = DATA.CARDS.filter((c) => c.ip === game.ip);
      if (pool.length === 0) throw new Error(`empty reward pool: ${game.ip}`);
      // 서버 왕복 감을 주는 지연 — 실배선 시 Server Action → RPC로 교체
      await new Promise((resolve) => setTimeout(resolve, 450));
      const card = mockRollCard(pool);
      return {
        playId: crypto.randomUUID(),
        rewards: [{ kind: 'card', cardId: card.id, rarity: card.rarity, isNew: !card.owned }],
        animationSeed: randomSeed(),
      };
    },

    async getRaffleResult() {
      throw new Error('래플 시각화는 PoC 범위 밖입니다');
    },

    async startPrizeCheckout() {
      throw new Error('래플 시각화는 PoC 범위 밖입니다');
    },

    haptics(type) {
      navigator.vibrate?.(type === 'success' ? [18, 40, 24] : 10);
    },

    async share(payload) {
      if (navigator.share) {
        await navigator.share(payload);
        return;
      }
      await navigator.clipboard.writeText(`${payload.title} ${payload.url}`);
    },

    close() {
      if (window.history.length > 1) window.history.back();
      else window.location.assign('/');
    },

    track(event, props) {
      console.debug('[game:track]', event, props ?? {});
    },
  };
}
