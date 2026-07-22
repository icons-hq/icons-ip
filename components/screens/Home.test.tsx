import { readFileSync } from 'node:fs';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Ip, Vertical } from '@/lib/data';
import { Home } from './Home';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/home-catalog', async () => await import('../../lib/home-catalog'));
vi.mock('@/lib/ip-display', async () => await import('../../lib/ip-display'));
vi.mock('@/lib/rarity', async () => await import('../../lib/rarity'));
vi.mock('@/lib/routes', async () => await import('../../lib/routes'));
vi.mock('@/components/ui/Empty', () => ({
  Empty: ({ text, sub }: { text: string; sub?: string }) => <div>{text}{sub}</div>,
}));

vi.mock('@/components/ui/motion', () => ({
  useHeroParallax: () => ({
    artRef: { current: null },
    onMouseMove: () => undefined,
    onMouseLeave: () => undefined,
  }),
  useTilt: () => ({
    cardRef: { current: null },
    glareRef: { current: null },
    onMouseMove: () => undefined,
    onMouseLeave: () => undefined,
  }),
}));

const vertical: Vertical = { key: 'global', label: '글로벌 IP', color: '#2DE2FF' };

function ip(id: string, title: string, featured = false): Ip {
  return {
    id,
    title,
    sub: '테스트 IP',
    v: vertical,
    glyph: title,
    bg: `linear-gradient(#${id.length}11, #222)`,
    fans: 1000,
    goods: 0,
    cards: 0,
    featured,
    tagline: `${title} 태그라인`,
    synopsis: `${title} 시놉시스`,
  };
}

function catalog(source: CatalogSnapshot['source'], ips: Ip[]): CatalogSnapshot {
  return { source, verticals: [vertical], ips, goods: [], cards: [], events: [] };
}

function renderHome(overrides: Partial<ComponentProps<typeof Home>> = {}) {
  const baseCatalog = catalog('supabase', [
    ip('legacy', '레거시 특집', true),
    ip('lumen', '루멘'),
    ip('hwasan', '화산강림'),
    ip('maple', '메이플스토리'),
    ip('kakao', '카카오프렌즈'),
    ip('attack', '진격의 거인'),
    ip('six', '여섯 번째 IP'),
  ]);
  const props: ComponentProps<typeof Home> = {
    catalog: baseCatalog,
    curation: {
      hero: null,
      announcement: null,
      featuredIpIds: ['lumen', 'hwasan'],
    },
    followedIpIds: [],
    postPreviewByIpId: {},
    ...overrides,
  };

  return renderToStaticMarkup(<Home {...props} />);
}

describe('Home curation', () => {
  it('overrides the hero artwork, title, and primary CTA while preserving the secondary CTA', () => {
    const html = renderHome({
      curation: {
        hero: {
          id: 'hero-1',
          title: '여름 한정 세계가 열렸어요',
          imageBg: 'url("https://cdn.example/summer.webp") center / cover no-repeat',
          href: '/events/summer',
        },
        announcement: null,
        featuredIpIds: ['lumen', 'hwasan'],
      },
    });

    expect(html).toContain('여름 한정 세계가 열렸어요');
    expect(html).toContain('https://cdn.example/summer.webp');
    expect(html).toContain('href="/events/summer"');
    expect(html).toContain('aria-label="여름 한정 세계가 열렸어요 자세히 보기"');
    expect(html).toContain('자세히 보기 →');
    expect(html).toContain('href="#verbs"');
    expect(html).toContain('둘러보기');
    expect(html).not.toContain('누구의');
    expect(html).not.toContain('루멘 세계로 입장 →');
    expect(html).toContain('FEATURED IP');
    expect(html).not.toContain('NOW SHOWING');
    expect(html).toContain('href="/ip/lumen"');
    expect(html).toContain('루멘 세계로 →');
  });

  it('keeps the selected-IP hero when no active hero exists', () => {
    const html = renderHome();

    expect(html).toContain('누구의');
    expect(html).toContain('팬</span>이세요?');
    expect(html).toContain('루멘 세계로 입장 →');
    expect(html).not.toContain('자세히 보기 →');
  });

  it('renders the first announcement as a separate accessible link banner', () => {
    const html = renderHome({
      curation: {
        hero: null,
        announcement: {
          id: 'announcement-1',
          title: '배송 일정이 변경됐어요',
          imageBg: null,
          href: '/community?tag=notice',
        },
        featuredIpIds: ['lumen'],
      },
    });

    expect(html).toMatch(/<aside[^>]+aria-label="공지"[^>]*>/);
    expect(html).toContain('href="/community?tag=notice"');
    expect(html).toContain('배송 일정이 변경됐어요');
  });

  it('keeps an IP-independent hero and announcement visible when the catalog has no IPs', () => {
    const html = renderHome({
      catalog: catalog('supabase', []),
      curation: {
        hero: {
          id: 'hero-empty-catalog',
          title: 'IP 공개 전 특별전을 먼저 만나보세요',
          imageBg: 'url("https://cdn.example/prelaunch.webp") center / cover no-repeat',
          href: '/events/prelaunch',
        },
        announcement: {
          id: 'announcement-empty-catalog',
          title: '첫 IP 공개 일정을 확인하세요',
          imageBg: null,
          href: '/community?tag=notice',
        },
        featuredIpIds: [],
      },
    });

    expect(html).toContain('IP 공개 전 특별전을 먼저 만나보세요');
    expect(html).toContain('https://cdn.example/prelaunch.webp');
    expect(html).toContain('href="/events/prelaunch"');
    expect(html).toContain('aria-label="IP 공개 전 특별전을 먼저 만나보세요 자세히 보기"');
    expect(html).toContain('자세히 보기 →');
    expect(html).toContain('href="/community?tag=notice"');
    expect(html).toContain('첫 IP 공개 일정을 확인하세요');
    expect(html).toContain('등록된 IP가 아직 없습니다');
    expect(html).not.toContain('aria-label="최애 IP 선택"');
    expect(html).not.toContain('FEATURED IP');
    expect(html).not.toContain('NOW SHOWING');
    expect(html).not.toContain('FANS');
    expect(html).not.toContain('세계로');
  });

  it('keeps the IP empty surface alongside an announcement-only curation', () => {
    const html = renderHome({
      catalog: catalog('supabase', []),
      curation: {
        hero: null,
        announcement: {
          id: 'announcement-only-empty-catalog',
          title: '서비스 준비 소식을 확인하세요',
          imageBg: null,
          href: '/community',
        },
        featuredIpIds: [],
      },
    });

    expect(html).toContain('등록된 IP가 아직 없습니다');
    expect(html).toContain('곧 새로운 IP가 공개될 예정이에요.');
    expect(html).toMatch(/<aside[^>]+aria-label="공지"[^>]*>/);
    expect(html).toContain('href="/community"');
    expect(html).toContain('서비스 준비 소식을 확인하세요');
    expect(html).not.toContain('<header');
  });

  it('preserves the existing IP empty surface when no curation exists', () => {
    const html = renderHome({
      catalog: catalog('supabase', []),
      curation: { hero: null, announcement: null, featuredIpIds: [] },
    });

    expect(html).toContain('class="screen"');
    expect(html).toContain('등록된 IP가 아직 없습니다');
    expect(html).toContain('곧 새로운 IP가 공개될 예정이에요.');
    expect(html).not.toContain('<header');
    expect(html).not.toContain('<aside');
  });

  it('gives the announcement link explicit hover and focus-visible feedback', () => {
    const html = renderHome({
      curation: {
        hero: null,
        announcement: {
          id: 'announcement-feedback',
          title: '공지 링크 피드백',
          imageBg: null,
          href: '/community',
        },
        featuredIpIds: ['lumen'],
      },
    });
    const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

    expect(html).toContain('class="wrap home-announcement-link"');
    expect(css).toMatch(/\.home-announcement-link:hover\s*\{[^}]*var\(--line-3\)/);
    expect(css).toMatch(/\.home-announcement-link:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--cyan\)/);
  });

  it('allows long unbroken hero and announcement titles to wrap on a narrow viewport', () => {
    const longTitle = 'A'.repeat(120);
    const html = renderHome({
      curation: {
        hero: {
          id: 'hero-long',
          title: longTitle,
          imageBg: 'url("https://cdn.example/long.webp") center / cover no-repeat',
          href: '/events',
        },
        announcement: {
          id: 'announcement-long',
          title: longTitle,
          imageBg: null,
          href: '/community',
        },
        featuredIpIds: ['lumen'],
      },
    });

    expect(html).toMatch(new RegExp(`<h1[^>]*style="[^"]*min-width:0;overflow-wrap:anywhere[^"]*">${longTitle}</h1>`));
    expect(html).toMatch(new RegExp(`font-weight:650;min-width:0;overflow-wrap:anywhere[^"]*">${longTitle}</span>`));
    expect(html).toMatch(/<aside[^>]*>[\s\S]*<a[^>]*style="[^"]*min-width:0[^"]*"/);
    expect(html).toContain('flex:0 0 auto');
  });

  it('renders a featured artwork override and keeps catalog key art when no override exists', () => {
    const artworkIp = {
      ...ip('artwork', '아트워크 특집'),
      bg: 'url("https://cdn.example/featured.webp") center / cover no-repeat',
    };
    const fallbackIp = {
      ...ip('fallback', '기본 키아트 특집'),
      bg: 'linear-gradient(#123456, #654321)',
    };

    const artworkHtml = renderHome({
      catalog: catalog('supabase', [artworkIp, fallbackIp]),
      curation: { hero: null, announcement: null, featuredIpIds: ['artwork', 'fallback'] },
    });
    const fallbackHtml = renderHome({
      catalog: catalog('supabase', [fallbackIp]),
      curation: { hero: null, announcement: null, featuredIpIds: ['fallback'] },
    });

    expect(artworkHtml).toContain('https://cdn.example/featured.webp');
    expect(fallbackHtml).toContain('linear-gradient(#123456, #654321)');
  });

  it('keeps numeric-like post previews in explicit picker order in the ticker', () => {
    const html = renderHome({
      catalog: catalog('supabase', [ip('10', '열 번째 IP'), ip('2', '두 번째 IP')]),
      curation: { hero: null, announcement: null, featuredIpIds: ['10', '2'] },
      postPreviewByIpId: {
        '10': {
          id: 'post-ten',
          user: 'ten',
          ipName: '열 번째 IP',
          avatar: '#2DE2FF',
          text: '열 번째 글',
          likes: 10,
          comments: 0,
          time: '방금 전',
          tag: '후기',
        },
        '2': {
          id: 'post-two',
          user: 'two',
          ipName: '두 번째 IP',
          avatar: '#8B5CFF',
          text: '두 번째 글',
          likes: 2,
          comments: 0,
          time: '방금 전',
          tag: '후기',
        },
      },
    });

    expect(html.indexOf('@ten 님의 후기')).toBeLessThan(html.indexOf('@two 님의 후기'));
  });

  it('renders the curated picker in order and caps it at five accessible buttons', () => {
    const html = renderHome({
      curation: {
        hero: null,
        announcement: null,
        featuredIpIds: ['six', 'attack', 'kakao', 'maple', 'hwasan', 'lumen', 'legacy'],
      },
    });

    const labels = ['여섯 번째 IP', '진격의 거인', '카카오프렌즈', '메이플스토리', '화산강림'];
    let previousIndex = -1;
    for (const label of labels) {
      const index = html.indexOf(`aria-label="${label} 선택"`);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(html).not.toContain('aria-label="루멘 선택"');
    expect((html.match(/aria-pressed=/g) ?? [])).toHaveLength(5);
  });

  it('uses legacy featured selection only for a mock catalog, regardless of curation IDs', () => {
    const html = renderHome({
      catalog: catalog('mock', [
        ip('regular', '일반 IP'),
        ip('legacy', '레거시 특집', true),
        ip('curated', '운영 특집'),
      ]),
      curation: {
        hero: null,
        announcement: null,
        featuredIpIds: ['curated'],
      },
    });

    expect(html).toContain('레거시 특집 세계로 입장 →');
    expect(html).toContain('aria-label="레거시 특집 선택"');
    expect(html).not.toContain('aria-label="운영 특집 선택"');
  });

  it('uses catalog order for an explicit empty Supabase curation instead of legacy featured', () => {
    const html = renderHome({
      catalog: catalog('supabase', [
        ip('regular', '일반 IP'),
        ip('legacy', '레거시 특집', true),
      ]),
      curation: { hero: null, announcement: null, featuredIpIds: [] },
    });

    expect(html).toContain('일반 IP 세계로 입장 →');
    expect(html.indexOf('aria-label="일반 IP 선택"')).toBeLessThan(
      html.indexOf('aria-label="레거시 특집 선택"'),
    );
  });
});
