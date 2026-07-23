import { readFileSync } from 'node:fs';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import { DATA } from '../../lib/data';
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

function previewCatalog(source: CatalogSnapshot['source']): CatalogSnapshot {
  return {
    source,
    verticals: Object.values(DATA.V),
    ips: DATA.IPS,
    goods: DATA.GOODS,
    cards: DATA.CARDS,
    events: DATA.EVENTS,
  };
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
  it('places an active curation first in the preview hero without changing its target', () => {
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
    expect(html).toContain('<span>VIEW</span>');
    expect(html).toContain('FEATURED STORY');
    expect(html).toContain('href="/ip/lumen"');
  });

  it('uses the first curated IP as the lead story when no active hero exists', () => {
    const html = renderHome();

    expect(html).toContain('YOUR IP, YOUR WORLD');
    expect(html).toContain('루멘 태그라인');
    expect(html).toContain('루멘 시놉시스');
    expect(html).toContain('aria-label="루멘 자세히 보기"');
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
    expect(html).not.toContain('2026.07.12');
  });

  it('keeps the curated hero destination tappable on mobile without changing the source layout', () => {
    const html = renderHome({
      curation: {
        hero: {
          id: 'hero-mobile',
          title: '모바일 큐레이션',
          imageBg: null,
          href: '/events/mobile-curation',
        },
        announcement: null,
        featuredIpIds: ['lumen'],
      },
    });

    expect(html).toContain('class="hero-mobile-hit"');
    expect(html).toContain('aria-label="모바일에서 모바일 큐레이션 열기"');
    expect(html.match(/href="\/events\/mobile-curation"/g)).toHaveLength(2);
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
    expect(html).toContain('<span>VIEW</span>');
    expect(html).toContain('href="/community?tag=notice"');
    expect(html).toContain('첫 IP 공개 일정을 확인하세요');
    expect(html).toContain('등록된 IP가 아직 없습니다');
    expect(html).not.toContain('class="marquee-shell"');
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
    expect(html).toContain('<header class="site-header "');
    expect(html).toContain('<footer class="site-footer"');
  });

  it('preserves the existing IP empty surface when no curation exists', () => {
    const html = renderHome({
      catalog: catalog('supabase', []),
      curation: { hero: null, announcement: null, featuredIpIds: [] },
    });

    expect(html).toContain('class="icons-preview"');
    expect(html).toContain('등록된 IP가 아직 없습니다');
    expect(html).toContain('곧 새로운 IP가 공개될 예정이에요.');
    expect(html).toContain('<header class="site-header "');
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
    const css = readFileSync(new URL('../../app/styles/editorial-home.css', import.meta.url), 'utf8');

    expect(html).toContain('class="announcement"');
    expect(css).toMatch(/\.icons-preview \.announcement:hover\s*\{[^}]*padding:\s*0 12px/);
    expect(css).toMatch(/\.icons-preview a:focus-visible/);
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

    expect(html).toMatch(new RegExp(`<h1[^>]*>${longTitle}</h1>`));
    expect(html).toMatch(new RegExp(`<strong[^>]*>${longTitle}</strong>`));
    expect(cssForHome()).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('keeps line-broken reference hero copy on the source wrapping algorithm', () => {
    expect(cssForHome()).toMatch(/\.icons-preview \.hero h1\s*\{[^}]*overflow-wrap:\s*normal;[^}]*text-wrap:\s*wrap;/s);
    expect(cssForHome()).toMatch(/\.icons-preview :is\(h2, h3\)\s*\{[^}]*text-wrap:\s*wrap;/s);
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

  it('uses the selected IP post in the community feature', () => {
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

    expect(html).toContain('<b>ten</b>');
    expect(html).toContain('열 번째 글');
    expect(html.indexOf('<b>ten</b>')).toBeLessThan(html.indexOf('<b>two</b>'));
  });

  it('keeps followed IP community previews stable-first', () => {
    const html = renderHome({
      catalog: catalog('supabase', [ip('10', '열 번째 IP'), ip('2', '두 번째 IP')]),
      curation: { hero: null, announcement: null, featuredIpIds: ['10', '2'] },
      followedIpIds: ['2'],
      postPreviewByIpId: {
        '10': {
          id: 'post-ten', user: 'ten', ipName: '열 번째 IP', avatar: '#2DE2FF',
          text: '열 번째 글', likes: 10, comments: 0, time: '방금 전', tag: '후기',
        },
        '2': {
          id: 'post-two', user: 'two', ipName: '두 번째 IP', avatar: '#8B5CFF',
          text: '두 번째 글', likes: 2, comments: 0, time: '방금 전', tag: '후기',
        },
      },
    });

    expect(html.indexOf('<b>two</b>')).toBeLessThan(html.indexOf('<b>ten</b>'));
  });

  it('treats nullable production post previews as an absent preview', () => {
    expect(() => renderHome({
      postPreviewByIpId: { lumen: null } as unknown as ComponentProps<typeof Home>['postPreviewByIpId'],
    })).not.toThrow();
  });

  it('renders curated IP worlds in order and caps the primary marquee group at five', () => {
    const html = renderHome({
      curation: {
        hero: null,
        announcement: null,
        featuredIpIds: ['six', 'attack', 'kakao', 'maple', 'hwasan', 'lumen', 'legacy'],
      },
    });

    const primaryGroup = html.match(/<div class="marquee-group" aria-hidden="false">([\s\S]*?)<\/div><div class="marquee-group"/)?.[1] ?? '';
    const labels = ['여섯 번째 IP', '진격의 거인', '카카오프렌즈', '메이플스토리', '화산강림'];
    let previousIndex = -1;
    for (const label of labels) {
      const index = primaryGroup.indexOf(`aria-label="${label} 세계 보기"`);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(primaryGroup).not.toContain('aria-label="루멘 세계 보기"');
    expect((primaryGroup.match(/class="ip-orbit /g) ?? [])).toHaveLength(5);
  });

  it('does not let the reference dataset override production curation order', () => {
    const html = renderHome({
      catalog: previewCatalog('supabase'),
      curation: {
        hero: null,
        announcement: null,
        featuredIpIds: ['kakao-friends', 'rilakkuma', 'attack-on-titan', 'maplestory', 'nongdamgom'],
      },
    });
    const primaryGroup = html.match(/<div class="marquee-group" aria-hidden="false">([\s\S]*?)<\/div><div class="marquee-group"/)?.[1] ?? '';

    expect(html).toContain('<span>좋아하는 친구들과</span><span>피크닉을 떠나요</span>');
    expect(primaryGroup.indexOf('카카오프렌즈 세계 보기')).toBeLessThan(primaryGroup.indexOf('리락쿠마 세계 보기'));
    expect(html).toMatch(/aria-label="1번 슬라이드: 카카오프렌즈"[^>]*><span style="background-color:#ffe888"/);
  });

  it('uses the exact lightweight WebP reference assets on the preview dataset', () => {
    const html = renderHome({
      catalog: previewCatalog('mock'),
      curation: { hero: null, announcement: null, featuredIpIds: [] },
    });

    expect(html).toContain('/generated/ip/rilakkuma.webp');
    expect(html).not.toContain('/generated/ip/rilakkuma.png');
    expect(html).toContain('aria-label="1번 장면 자동 전환 일시 정지"');
  });

  it('preserves the source carousel step, film replay, and keyboard menu safeguards', () => {
    const source = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8');

    const css = cssForHome();

    expect(source).toContain('(card?.offsetWidth ?? 320) + 28');
    expect(source).toContain('<div className="film-visual" key={active.id}>');
    expect(source).not.toContain('<div className="film-window" key={active.id}>');
    expect(source).toContain('const featureArt = element.parentElement;');
    expect(source).toContain('const rect = featureArt.getBoundingClientRect();');
    expect(source).toContain("document.addEventListener('keydown', onKeyDown)");
    expect(source).toContain('element.inert = true');
    expect(css).toMatch(/\.icons-preview \.film-progress button\s*\{[^}]*height:\s*27px/);
    expect(css).toMatch(/\.icons-preview \.film-progress button::before\s*\{[^}]*height:\s*3px/);
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

    expect(html).toContain('레거시 특집 태그라인');
    expect(html).toContain('aria-label="레거시 특집 자세히 보기"');
    expect(html).not.toContain('aria-label="운영 특집 자세히 보기"');
  });

  it('uses catalog order for an explicit empty Supabase curation instead of legacy featured', () => {
    const html = renderHome({
      catalog: catalog('supabase', [
        ip('regular', '일반 IP'),
        ip('legacy', '레거시 특집', true),
      ]),
      curation: { hero: null, announcement: null, featuredIpIds: [] },
    });

    expect(html).toContain('aria-label="일반 IP 자세히 보기"');
    expect(html.indexOf('aria-label="일반 IP 세계 보기"')).toBeLessThan(
      html.indexOf('aria-label="레거시 특집 세계 보기"'),
    );
  });
});

function cssForHome() {
  return readFileSync(new URL('../../app/styles/editorial-home.css', import.meta.url), 'utf8');
}

describe('ICONS IP World Preview composition', () => {
  it('renders the preview structure in the same order from the existing home props', () => {
    const html = renderHome();

    const sequence = [
      'site-header',
      'hero',
      'announcement',
      'ip-section',
      'film-section',
      'experience-section',
      'world-section',
      'trust-section',
      'final-cta',
      'site-footer',
    ];
    let previous = -1;
    for (const className of sequence) {
      const index = html.indexOf(className);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }

    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(header).toMatch(/class="brand"[^>]*>ICONS<\/a>/);
    expect(header).not.toContain('ICONS<span>·</span>');
    expect(html).toMatch(/class="footer-brand"[^>]*>ICONS<span>·<\/span><\/a>/);
    expect(html).toContain('href="/ip"');
    expect(html).toContain('href="/shop"');
    expect(html).toContain('href="/packs"');
    expect(html).toContain('href="/events"');
    expect(html).toContain('href="/community"');
    expect(html).toContain('모든 팬의 세계가<br/>하나로 이어지는 곳.');
    expect(html).not.toContain('파트너사');
  });

  it('keeps the IP marquee centered, unclipped, and faster than the source preview', () => {
    const html = renderHome();
    const orbitClasses = [...html.matchAll(/class="(ip-orbit [^"]+)"/g)].map((match) => match[1]);
    const css = cssForHome();

    expect(orbitClasses.length).toBeGreaterThan(0);
    expect(orbitClasses.every((className) => !className.includes('ip-orbit--high') && !className.includes('ip-orbit--low'))).toBe(true);
    expect(css).toMatch(/\.icons-preview \.marquee-track\s*\{[^}]*animation:\s*20s linear infinite preview-marquee/);
    expect(css).not.toContain('.icons-preview .ip-orbit--low');
  });

  it('keeps world-card artwork full bleed while styling only its text label', () => {
    const css = cssForHome();

    expect(css).toContain('.icons-preview .world-card > span:not(.preview-artwork)');
    expect(css).not.toMatch(/\.icons-preview \.world-card span\s*\{/);
  });

  it('provides the preview hero controls and exact accessible labels', () => {
    const html = renderHome({
      curation: {
        hero: {
          id: 'hero-editorial',
          title: '여름 한정 세계가 열렸어요',
          imageBg: 'url("https://cdn.example/editorial.webp") center / cover no-repeat',
          href: '/events/summer',
        },
        announcement: null,
        featuredIpIds: ['lumen', 'hwasan'],
      },
    });

    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="슬라이드 일시 정지"');
    expect(html).toContain('aria-label="1번 슬라이드: 여름 한정 세계가 열렸어요"');
    expect(html).toContain('여름 한정 세계가 열렸어요');
    expect(html).toContain('href="/events/summer"');
  });

  it('includes the preview mobile menu and its circular-reveal state hook', () => {
    const html = renderHome();

    expect(html).toContain('aria-label="메뉴 열기"');
    expect(html).toContain('aria-label="전체 메뉴"');
    expect(html).toContain('class="mobile-menu "');
    expect(html).toContain('ICONS MENU');
    expect(html).toContain('SEOUL · 2026');
    expect(cssForHome()).toContain('.icons-preview .mobile-menu--open');
  });

  it('labels mock metrics as sample data instead of presenting them as production truth', () => {
    const html = renderHome({
      catalog: catalog('mock', [ip('sample', '샘플 IP', true)]),
      curation: { hero: null, announcement: null, featuredIpIds: [] },
    });

    expect(html).toContain('샘플 연결 팬');
    expect(html).not.toContain('연결된 팬</span>');
  });

  it('keeps the editorial frame and explicit empty state when no catalog IP exists', () => {
    const html = renderHome({
      catalog: catalog('supabase', []),
      curation: { hero: null, announcement: null, featuredIpIds: [] },
    });

    expect(html).toContain('class="icons-preview"');
    expect(html).toContain('등록된 IP가 아직 없습니다');
    expect(html).toContain('href="/ip"');
    expect(html).not.toContain('aria-roledescription="carousel"');
  });

  it('derives downstream experiences from the curated selected IP rather than a legacy featured IP', () => {
    const legacy = ip('legacy', '레거시 특집', true);
    const lumen = ip('lumen', '루멘');
    const base = catalog('supabase', [legacy, lumen]);
    const html = renderHome({
      catalog: {
        ...base,
        goods: [
          {
            id: 'legacy-good',
            name: '레거시 굿즈',
            ip: 'legacy',
            type: '키링',
            price: 10000,
            badge: null,
            stock: 'ok',
            stockQty: 5,
            img: 'linear-gradient(#111, #222)',
          },
          {
            id: 'lumen-good',
            name: '루멘 굿즈',
            ip: 'lumen',
            type: '피규어',
            price: 28000,
            badge: '신상',
            stock: 'ok',
            stockQty: 8,
            img: 'linear-gradient(#abc, #def)',
          },
        ],
      },
      curation: { hero: null, announcement: null, featuredIpIds: ['lumen'] },
    });

    expect(html).toMatch(/experience-card[\s\S]*루멘 굿즈/);
    expect(html).not.toMatch(/experience-card[\s\S]*레거시 굿즈/);
  });
});
