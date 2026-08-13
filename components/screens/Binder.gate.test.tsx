import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card, Ip } from '@/lib/data';
import { Binder } from './Binder';

const ip: Ip = {
  id: 'binder-gate-ip',
  title: '기존 보유 IP',
  sub: '카드 아카이브',
  v: { key: 'webtoon', label: '웹툰', color: '#38F0C0' },
  glyph: '카드',
  tagline: '기존 보유 카드',
  synopsis: '기존 보유 카드는 계속 확인할 수 있다.',
  bg: '#111111',
  fans: 1,
  goods: 0,
  cards: 1,
  featured: false,
};

const card: Card = {
  id: 'binder-gate-card',
  ip: ip.id,
  name: '기존 보유 카드',
  no: '001/001',
  rarity: 'N',
  owned: false,
  bg: '#222222',
};

describe('Binder card reward gate', () => {
  it('keeps owned cards readable but removes pack acquisition while disabled', () => {
    const html = renderToStaticMarkup(
      <Binder
        cardRewardsEnabled={false}
        catalog={{ source: 'supabase', cards: [card], ips: [ip] }}
        ownedCardIds={[card.id]}
      />,
    );

    expect(html).toContain('기존 보유 카드');
    expect(html).toContain('보유 카드');
    expect(html).not.toContain('href="/packs"');
    expect(html).not.toContain('카드팩 열기');
  });
});
