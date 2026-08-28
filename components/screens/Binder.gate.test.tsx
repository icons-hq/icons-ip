import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card, Ip } from '@/lib/data';
import { Binder, CardDetail } from './Binder';

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
  no: '001/040',
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

describe('Binder White Catalog chrome', () => {
  const render = (ownedCardIds: string[] | null) =>
    renderToStaticMarkup(
      <Binder
        cardRewardsEnabled
        catalog={{ source: 'supabase', cards: [card], ips: [ip] }}
        ownedCardIds={ownedCardIds}
      />,
    );

  it('renders on the wc-root white surface without HM chrome classes', () => {
    const html = render([card.id]);

    expect(html).toContain('wc-root wc-binder');
    for (const legacy of ['holo-text', 'btn-holo', 'btn-ghost', 'eyebrow', 'rise', 'binder-grid', 'money-caption']) {
      expect(html).not.toContain(legacy);
    }
    for (const hmToken of ['var(--violet-2)', 'var(--mint)']) {
      expect(html).not.toContain(hmToken);
    }
  });

  it('keeps ownership and rarity filters with aria-pressed state', () => {
    const html = render([card.id]);

    expect(html).toContain('aria-label="보유 필터"');
    expect(html).toContain('aria-label="등급 필터"');
    /* 초기 상태: 전체 + 전체 등급 두 칩이 눌린 상태다 */
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(2);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('wc-binder__chip');
  });

  it('shows the collection progress only when ownership is known', () => {
    const owned = render([card.id]);
    expect(owned).toContain('도감 달성률');
    expect(owned).toContain('1 / 1장 보유');

    const signedOut = render(null);
    expect(signedOut).not.toContain('도감 달성률');
    expect(signedOut).toContain('로그인하면 보유 현황이 표시됩니다');
  });
});

describe('CardDetail', () => {
  const renderDetail = (overrides: { owned?: boolean; cardRewardsEnabled?: boolean; hasOwnership?: boolean } = {}) =>
    renderToStaticMarkup(
      <CardDetail
        card={{ ...card, owned: overrides.owned ?? false }}
        cardRewardsEnabled={overrides.cardRewardsEnabled ?? true}
        collection="1/1"
        hasOwnership={overrides.hasOwnership ?? true}
        ip={ip}
        onClose={() => undefined}
      />,
    );

  it('is a dialog with issuance and collection stats but no mock price', () => {
    const html = renderDetail();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('발행량');
    /* no "001/040" → 발행량 040 */
    expect(html).toContain('040');
    expect(html).toContain('도감');
    expect(html).toContain('1/1');
    expect(html).not.toContain('시세');
    expect(html).not.toContain('₩48,000');
  });

  it('routes acquisition CTAs by ownership and the card reward gate', () => {
    const unowned = renderDetail({ owned: false, cardRewardsEnabled: true });
    expect(unowned).toContain('미보유');
    expect(unowned).toContain('카드팩으로 획득');
    expect(unowned).toContain('href="/packs"');
    expect(unowned).toContain('트레이드로 획득');

    const gated = renderDetail({ owned: false, cardRewardsEnabled: false });
    expect(gated).not.toContain('카드팩으로 획득');
    expect(gated).not.toContain('href="/packs"');

    const owned = renderDetail({ owned: true });
    expect(owned).toContain('보유 중');
    expect(owned).toContain('트레이드 등록');
    expect(owned).toContain('전시하기');
  });
});
