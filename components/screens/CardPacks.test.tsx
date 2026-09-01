import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Card, Ip } from '@/lib/data';
import type { DrawTicketInventory } from '@/lib/draw-tickets';
import { CardPacks } from './CardPacks';

/* 서버 액션 모듈은 next/cache 등 서버 전용 의존을 끌고 온다 — 개봉은 상호작용 경로라
   정적 렌더 테스트에서는 참조만 세운다. */
vi.mock('@/app/packs/actions', () => ({ openDrawTicketAction: vi.fn() }));

const ip: Ip = {
  id: 'packs-ip',
  title: '카드팩 IP',
  sub: '컬렉션',
  v: { key: 'webtoon', label: '웹툰', color: '#38F0C0' },
  glyph: '팩',
  tagline: '',
  synopsis: '',
  bg: '#101010',
  fans: 0,
  goods: 0,
  cards: 2,
  featured: false,
};

const normalCard: Card = {
  id: 'card-n',
  ip: ip.id,
  name: '일반 카드',
  no: '001/040',
  rarity: 'N',
  owned: false,
  bg: '#181818',
};

const rareCard: Card = {
  id: 'card-ssr',
  ip: ip.id,
  name: '최고 등급 카드',
  no: '002/040',
  rarity: 'SSR',
  owned: false,
  bg: '#202020',
};

const catalog = { source: 'supabase' as const, ips: [ip], cards: [normalCard, rareCard] };

const inventoryWithGroups: DrawTicketInventory = {
  source: 'supabase',
  signedIn: true,
  groups: [
    {
      poolId: 'pool-1',
      poolName: '카드팩 IP 컬렉션',
      ipId: ip.id,
      ticketIds: ['t1', 't2'],
      lineupCardIds: [normalCard.id, rareCard.id],
    },
  ],
};

function render(inventory: DrawTicketInventory) {
  return renderToStaticMarkup(<CardPacks catalog={catalog} inventory={inventory} />);
}

describe('CardPacks White Catalog chrome', () => {
  it('renders on the wc-root white surface without HM chrome', () => {
    const html = render(inventoryWithGroups);

    expect(html).toContain('wc-root wc-packs');
    for (const legacy of ['btn-holo', 'btn-ghost', 'eyebrow', 'rise', 'home-float', 'packs-hero', 'packs-groups', 'money-caption', 'holoShift']) {
      expect(html).not.toContain(legacy);
    }
    for (const hmToken of ['var(--violet-2)', 'var(--mint)', 'var(--dim)']) {
      expect(html).not.toContain(hmToken);
    }
  });

  it('keeps the pack inventory copy and per-pool open CTA', () => {
    const html = render(inventoryWithGroups);

    expect(html).toContain('카드팩 IP 컬렉션');
    expect(html).toContain('카드팩 개봉');
    expect(html).toContain('개봉 1회 = 카드 1장');
    expect(html).toContain('보유 카드팩');
    expect(html).toContain('<strong>2</strong>');
    expect(html).toContain('href="/binder"');
  });

  it('picks the highest rarity lineup card as the hero visual', () => {
    const html = render(inventoryWithGroups);

    expect(html).toContain('컬렉션 대표 카드 · No. 002/040');
    expect(html).toContain('최고 등급 카드');
  });
});

describe('CardPacks gates', () => {
  it('walls the inventory behind login with a next redirect', () => {
    const html = render({ source: 'supabase', signedIn: false, groups: [] });

    expect(html).toContain('로그인하면 보유 카드팩이 보여요');
    expect(html).toContain('굿즈 구매로 받은 카드팩과 개봉 기록을 계정에 보관합니다.');
    expect(html).toContain('href="/login?next=%2Fpacks"');
    expect(html).not.toContain('카드팩 개봉');
    expect(html).not.toContain('보유 카드팩 <strong>');
  });

  it('sends an empty signed-in inventory to the goods shop', () => {
    const html = render({ source: 'supabase', signedIn: true, groups: [] });

    expect(html).toContain('아직 보유한 카드팩이 없어요');
    expect(html).toContain('굿즈를 구매하면 컬렉션 카드팩이 무상으로 발급됩니다.');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('카드팩 개봉');
  });
});
