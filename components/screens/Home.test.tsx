import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HomeCurationSnapshot, HomeGoodsCard } from '@/lib/home-catalog';
import { Home } from './Home';

const emptyCuration: HomeCurationSnapshot = {
  hero: null,
  announcement: null,
  featuredIpIds: [],
  heroSlides: [],
  editorPicks: [],
  goodsBands: [],
  categoryBestTabs: [],
  popularTabs: [],
  benefitTiles: [],
};

const good = (id: string, overrides: Partial<HomeGoodsCard> = {}): HomeGoodsCard => ({
  id,
  name: `굿즈 ${id}`,
  brand: 'ICONS',
  price: 29000,
  badge: null,
  imageBg: 'linear-gradient(#111, #222)',
  href: `/shop/${id}`,
  soldOut: false,
  ...overrides,
});

const fullCuration: HomeCurationSnapshot = {
  ...emptyCuration,
  heroSlides: [
    {
      id: 'hero-1',
      title: '여름 드랍',
      subtitle: 'SUMMER DROP',
      imageUrl: 'https://cdn.example/hero-1.webp',
      mobileImageUrl: null,
      href: '/events/summer',
    },
  ],
  editorPicks: [
    {
      id: 'pick-1',
      title: '주간 픽',
      badge: 'NEW',
      description: '이번 주 큐레이션',
      imageBg: 'linear-gradient(#333, #444)',
      href: '/events/pick',
    },
  ],
  categoryBestTabs: [
    { id: 'keyring', label: '키링', goods: [good('g1'), good('g2'), good('g3'), good('g4'), good('g5')] },
    { id: 'living', label: '리빙', goods: [] },
  ],
  goodsBands: [
    {
      id: 'b1',
      title: '주간 기획전',
      subcopy: '쿠폰 중복 적용',
      imageUrl: 'https://cdn.example/band-1.webp',
      href: '/shop?collection=weekly',
      goods: [good('g6', { badge: '한정' }), good('g7', { brand: null, soldOut: true })],
    },
  ],
  popularTabs: [{ id: 'multi', label: 'MULTI', goods: [good('g8')] }],
  benefitTiles: [
    { id: 't1', title: '카드팩 열기', description: '무료로 받은 카드팩을 열어보세요', href: '/packs' },
    { id: 't2', title: '게임 참여', description: null, href: '/games/reward' },
  ],
};

const render = (curation: HomeCurationSnapshot, cardRewardsEnabled = true) =>
  renderToStaticMarkup(<Home cardRewardsEnabled={cardRewardsEnabled} curation={curation} />);

describe('Home empty curation', () => {
  /* 큐레이션이 비면 가짜 콘텐츠로 채우지 않는다 — 원인과 다음 행동 하나만 남긴다(DESIGN §7·§9). */
  it('falls back to one explicit empty state with a single next step', () => {
    const html = render(emptyCuration);

    expect(html).toContain('wc-home__empty');
    expect(html).toContain('홈을 준비하고 있어요');
    expect(html).toContain('곧 새로운 소식과 상품을 만나볼 수 있어요.');
    expect(html).toContain('href="/shop"');
    expect(html).toContain('굿즈샵 둘러보기');
  });

  it('draws no band at all when every slot is empty', () => {
    const html = render(emptyCuration);

    expect(html).not.toContain('wc-home__band');
    expect(html).not.toContain('wc-hero');
    expect(html).not.toContain('wc-tab-band');
  });

  /* 밴드 헤딩은 전부 h2 라, 페이지 이름을 대신 읽어줄 h1 이 문서에 하나는 있어야 한다. */
  it('keeps a screen-reader page heading above the bands', () => {
    expect(render(emptyCuration)).toContain('<h1 class="wc-sr-only">ICONS 홈</h1>');
    expect(render(fullCuration)).toContain('<h1 class="wc-sr-only">ICONS 홈</h1>');
  });

  it('drops the empty state as soon as one band has data', () => {
    expect(render(fullCuration)).not.toContain('wc-home__empty');
  });
});

describe('Home bands', () => {
  it('renders the hero carousel from the curated slides', () => {
    const html = render(fullCuration);

    expect(html).toContain('aria-label="대표 큐레이션"');
    expect(html).toContain('여름 드랍');
    expect(render({ ...fullCuration, heroSlides: [] })).not.toContain('aria-label="대표 큐레이션"');
  });

  it('renders the editor picks band as content cards', () => {
    const html = render(fullCuration);

    expect(html).toContain('id="home-picks-heading"');
    expect(html).toContain('에디터의 제안');
    expect(html).toContain('aria-label="에디터의 제안 콘텐츠"');
    expect(html).toContain('wc-slider wc-picks');
    expect(html).toContain('wc-content-card');
    expect(html).toContain('주간 픽');
    expect(render({ ...fullCuration, editorPicks: [] })).not.toContain('home-picks-heading');
  });

  it('renders the category BEST band as a tabbed product slider', () => {
    const html = render(fullCuration);

    expect(html).toContain('id="home-best-heading"');
    expect(html).toContain('카테고리 BEST');
    expect(html).toContain('id="home-best-tab-keyring"');
    expect(html).toContain('wc-tab-band__page');
  });

  /* 페이지 하나가 상품 4개다. 5개짜리 탭은 4+1 로 갈라져야 하고, 한 장에 몰리면 그리드가 깨진다. */
  it('slices each tab into pages of four products', () => {
    const html = render(fullCuration);

    const panel = html.match(/<div\b[^>]*id="home-best-panel-keyring"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect((panel.match(/wc-tab-band__page/g) ?? []).length).toBe(2);
    expect((panel.match(/wc-product-card__name-link/g) ?? []).length).toBe(5);
  });

  /* 탭 목록이 있어도 상품이 하나도 없으면 빈 패널만 남는다 — 그런 탭은 아예 만들지 않는다. */
  it('drops tabs without products and the band when no tab has any', () => {
    const html = render(fullCuration);

    expect(html).toContain('id="home-best-tab-keyring"');
    expect(html).not.toContain('id="home-best-tab-living"');

    const bare = render({
      ...fullCuration,
      categoryBestTabs: [{ id: 'keyring', label: '키링', goods: [] }],
    });
    expect(bare).not.toContain('home-best-heading');
  });

  it('renders the popular band with its own tab id space', () => {
    const html = render(fullCuration);

    expect(html).toContain('id="home-popular-heading"');
    expect(html).toContain('인기템');
    expect(html).toContain('id="home-popular-tab-multi"');
    expect(render({ ...fullCuration, popularTabs: [] })).not.toContain('home-popular-heading');
  });

  it('renders one banner-plus-list band per curated goods band', () => {
    const html = render(fullCuration);

    expect(html).toContain('id="home-band-b1-heading"');
    expect(html).toContain('주간 기획전');
    expect(html).toContain('쿠폰 중복 적용');
    /* 배너 카피는 아트웍에 베이크돼 있어 alt 로 옮길 텍스트가 없다 — 이름은 링크가 갖는다. */
    expect(html).toContain('aria-label="주간 기획전 기획전 보기"');
    expect(html).toContain('src="https://cdn.example/band-1.webp"');
    expect(html).toContain('기획전 전체보기');
    expect(render({ ...fullCuration, goodsBands: [] })).not.toContain('wc-band__layout');
  });

  /* 리스트 행에는 품절 스크림 밴드를 겹칠 자리가 없다. 가격 옆 라벨이 시각·보조기술 양쪽에 그 상태를 전한다. */
  it('shows the brand only when present and labels sold-out rows next to the price', () => {
    const html = render(fullCuration);

    const rows = [...html.matchAll(/<a\b[^>]*wc-band__row[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toContain('<p class="wc-band__row-brand">ICONS</p>');
    expect(rows[0]).toContain('₩29,000');
    expect(rows[0]).not.toContain('wc-band__row-soldout');

    expect(rows[1]).not.toContain('wc-band__row-brand');
    expect(rows[1]).toContain('<span class="wc-band__row-soldout">품절</span>');
  });

  /* 상품이 하나도 없는 기획전은 배너와 전체보기만 남는다 — 빈 리스트 칼럼을 그리지 않는다. */
  it('keeps only the banner when a goods band has no products', () => {
    const html = render({
      ...fullCuration,
      goodsBands: [{ ...fullCuration.goodsBands[0], goods: [] }],
    });

    expect(html).toContain('wc-band__banner');
    expect(html).toContain('기획전 전체보기');
    expect(html).not.toContain('wc-band__list');
  });

  it('renders the card pack and game band on a grey surface', () => {
    const html = render(fullCuration);

    expect(html).toContain('wc-home__band wc-home__band--grey');
    expect(html).toContain('id="home-benefit-heading"');
    expect(html).toContain('카드팩·게임');
    expect(html).toContain('href="/packs"');
    expect(html).toContain('카드팩 열기');
    /* 설명은 선택이다 — 없는 타일에 빈 줄을 남기면 타일 높이가 어긋난다. */
    expect((html.match(/wc-benefit__tile-desc/g) ?? []).length).toBe(1);
  });

  /* 게이트가 꺼져 있으면 카드팩·게임은 존재하지 않는 기능이다. 데이터가 있어도 진입점을 열지 않는다. */
  it('hides the benefit band while the card rewards gate is off', () => {
    const html = render(fullCuration, false);

    expect(html).not.toContain('home-benefit-heading');
    expect(html).not.toContain('카드팩·게임');
    expect(html).not.toContain('href="/packs"');
  });

  it('drops the benefit band when the gate is on but no tile is curated', () => {
    expect(render({ ...fullCuration, benefitTiles: [] })).not.toContain('home-benefit-heading');
  });

  /* 게이트 필터는 혜택 밴드만이 아니다 — 어드민이 어떤 밴드에든 /packs·/games 목적지를
     걸 수 있으므로, 꺼진 배포에서는 그 큐레이션 자체를 걸러낸다(구 홈과 같은 규칙). */
  it('filters card-reward destinations out of every band while the gate is off', () => {
    const gatedCuration: HomeCurationSnapshot = {
      ...fullCuration,
      heroSlides: [
        ...fullCuration.heroSlides,
        {
          id: 'hero-packs',
          title: '카드팩 오픈 이벤트',
          subtitle: null,
          imageUrl: 'https://cdn.example/packs-hero.webp',
          mobileImageUrl: null,
          href: '/packs',
        },
      ],
      editorPicks: [
        ...fullCuration.editorPicks,
        {
          id: 'pick-games',
          title: '리워드 게임 소식',
          badge: null,
          description: null,
          imageBg: 'url("https://cdn.example/games.webp") center / cover no-repeat',
          href: '/games/reward',
        },
      ],
    };

    const gatedOff = render(gatedCuration, false);
    expect(gatedOff).not.toContain('href="/packs"');
    expect(gatedOff).not.toContain('href="/games/reward"');
    expect(gatedOff).not.toContain('카드팩 오픈 이벤트');
    expect(gatedOff).not.toContain('리워드 게임 소식');

    const gatedOn = render(gatedCuration, true);
    expect(gatedOn).toContain('카드팩 오픈 이벤트');
    expect(gatedOn).toContain('리워드 게임 소식');
  });
});

describe('Home band order', () => {
  /* 밴드 순서는 R-스펙 02 §0 이 정본이다. 조건부 렌더를 옮기다 보면 조용히 뒤집힌다. */
  it('keeps the reproduction-spec band order', () => {
    const html = render(fullCuration);

    const positions = [
      'aria-label="대표 큐레이션"',
      'home-picks-heading',
      'home-best-heading',
      'home-band-b1-heading',
      'home-popular-heading',
      'home-benefit-heading',
    ].map((marker) => html.indexOf(marker));

    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('labels every band section by its own heading', () => {
    const html = render(fullCuration);

    for (const id of [
      'home-picks-heading',
      'home-best-heading',
      'home-band-b1-heading',
      'home-popular-heading',
      'home-benefit-heading',
    ]) {
      expect(html).toContain(`aria-labelledby="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });
});
