import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Ip } from '@/lib/data';
import { IpDirectory } from './IpDirectory';

/* R-03 §3 디렉토리 행동 단언 — 28항목 인덱스 바, 정렬(A→Z·ETC 뒤), 피처드 상한, 빈 상태.
 * 표시명은 ipEn 경유라 ip-display META 등재 id(rilakkuma 등)는 영문, 미등재 id는 title 폴백이다. */

function ip(id: string, title: string, overrides: Partial<Ip> = {}): Ip {
  return {
    id,
    title,
    sub: '',
    v: { key: 'story', label: '스토리', color: '#111' },
    glyph: '◆',
    bg: 'linear-gradient(#111, #222)',
    fans: 0,
    goods: 0,
    cards: 0,
    featured: false,
    tagline: '',
    synopsis: '',
    ...overrides,
  };
}

const rilakkuma = ip('rilakkuma', '리락쿠마'); // ipEn → RILAKKUMA
const maplestory = ip('maplestory', '메이플스토리'); // ipEn → MAPLESTORY
const hwasan = ip('hwasan', '화산강림'); // 미등재 → 한글 title = ETC

function render(ips: Ip[], initialLetter?: string) {
  return renderToStaticMarkup(<IpDirectory initialLetter={initialLetter} ips={ips} />);
}

function text(html: string) {
  return html.replace(/<[^>]+>/g, '');
}

describe('IpDirectory', () => {
  it('renders the 28-entry A–Z index bar with ALL pressed by default', () => {
    const html = render([maplestory]);

    expect(html.match(/aria-pressed=/g)).toHaveLength(28);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('>ALL</button>');
    expect(html).toContain('>ETC</button>');
    expect(html.match(/<button[^>]*aria-pressed="true"[^>]*>/)?.[0]).toContain('is-active');
  });

  it('lists every ip sorted by display name with ETC entries last, linking to each hall', () => {
    const html = render([hwasan, rilakkuma, maplestory]);

    expect(html).toContain('href="/ip/maplestory"');
    expect(html).toContain('href="/ip/rilakkuma"');
    expect(html).toContain('href="/ip/hwasan"');
    expect(html.indexOf('MAPLESTORY')).toBeLessThan(html.indexOf('RILAKKUMA'));
    expect(html.indexOf('RILAKKUMA')).toBeLessThan(html.indexOf('화산강림'));
    expect(text(html)).toContain('총 3 개');
  });

  it('caps the featured rail at five curated tiles', () => {
    const featured = Array.from({ length: 7 }, (_, i) => ip(`feat-${i}`, `피처드 ${i}`, { featured: true }));
    const html = render(featured);

    expect(html.match(/class="wc-ipdir__tile"/g)).toHaveLength(5);
  });

  it('omits the featured rail when no ip is featured', () => {
    const html = render([maplestory, hwasan]);

    expect(html).not.toContain('wc-ipdir__tile');
  });

  it('filters the list by the active letter and reflects it in the count', () => {
    const html = render([rilakkuma, maplestory, hwasan], 'M');

    expect(html).toContain('MAPLESTORY');
    expect(html).not.toContain('RILAKKUMA');
    expect(html).not.toContain('화산강림');
    expect(text(html)).toContain('총 1 개');
  });

  it('shows the letter empty state with a reset action when a letter has no ip', () => {
    const html = render([maplestory], 'B');

    expect(html).toContain('이 이니셜의 IP가 아직 없어요');
    expect(html).toContain('전체 보기');
    expect(text(html)).toContain('총 0 개');
  });

  it('renders the catalog empty state when there is no ip at all', () => {
    const html = render([]);

    expect(html).toContain('등록된 IP가 아직 없습니다');
    expect(html).not.toContain('wc-alpha-index');
  });
});
