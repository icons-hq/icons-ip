import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CollectionBanner } from '@/lib/collection-banners';
import { CollectionBanners, ListingBanner } from './CollectionBanners';

function banner(id: string, overrides: Partial<CollectionBanner> = {}): CollectionBanner {
  return {
    id,
    slot: 'all',
    title: `배너 ${id}`,
    subtitle: null,
    imageUrl: `https://cdn.test/${id}.webp`,
    mobileImageUrl: null,
    href: null,
    imageAlt: '',
    imageDim: 'none',
    textColor: 'black',
    endsAt: null,
    ...overrides,
  };
}

describe('CollectionBanners — Figma 스트립 배너(콘텐츠 폭 1272×340, r12)', () => {
  it('배너가 없으면 아무것도 그리지 않는다 — 빈 띠를 남기지 않는다', () => {
    expect(renderToStaticMarkup(<CollectionBanners banners={[]} slot="all" />)).toBe('');
    expect(renderToStaticMarkup(<CollectionBanners banners={[banner('b', { slot: 'best' })]} slot="new" />)).toBe('');
  });

  it('한 장이면 공용 StripBanner(page) 한 장 — 슬라이더 컨트롤 없이 링크 배너 하나를 그린다', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('one', {
      slot: 'best', href: '/shop/best', subtitle: '지금 많이 찾는 굿즈', mobileImageUrl: 'https://cdn.test/one-m.webp', imageAlt: '리락쿠마 키링',
    })]} slot="best" />);

    expect(html).toContain('class="wc-strip-banners" data-slot="best"');
    expect(html).toContain('aria-label="BEST 배너"');
    expect(html).toContain('class="wc-strip-banner" data-mobile="true" data-size="page"');
    expect(html).not.toContain('aria-roledescription="carousel"');
    expect(html).not.toContain('wc-strip-banner-slider');
    expect(html).toMatch(/<a class="wc-strip-banner__link" href="\/shop\/best">/);
    expect(html).toContain('media="(max-width: 749px)"');
    expect(html).toContain('srcSet="https://cdn.test/one-m.webp"');
    /* 모바일 규격(375×175)이 로딩 전에도 자리를 잡는다. */
    expect(html).toContain('--wc-strip-mobile-ratio:375 / 175');
    expect(html).toMatch(/<img alt="리락쿠마 키링" class="wc-strip-banner__img" src="https:\/\/cdn.test\/one.webp"\/>/);
  });

  it('문구는 이미지 위 장식 레이어(aria-hidden)이고, 링크 이름은 대체텍스트 — 없으면 제목이라 같은 문구를 두 번 읽지 않는다', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('copy', { slot: 'new', href: '/shop/new', subtitle: '신상 모음', imageAlt: '' })]} slot="new" />);

    expect(html).toContain('<span aria-hidden="true" class="wc-listing-banner__copy">');
    expect(html).toContain('<strong class="wc-listing-banner__title">배너 copy</strong>');
    expect(html).toContain('<span class="wc-listing-banner__subtitle">신상 모음</span>');
    expect(html).toContain('<img alt="배너 copy"');
    /* 딤은 운영자가 고른 경우에만 그린다. */
    expect(html).not.toContain('wc-listing-banner__dim');
  });

  /* X SQUARE Figma 목록 배너는 문구가 그림 안에 있다(20261125100000) — 문구를 비우면 같은 문구가 두 번 겹치지 않게
     글자 레이어를 그리지 않고, 대체텍스트가 그림 속 문구를 링크 이름으로 읽힌다. */
  it('문구를 비운 배너는 글자 레이어 없이 그림만 그리고 대체텍스트를 링크 이름으로 쓴다', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('baked', {
      slot: 'new', title: '', href: '/offline-popups/icons77', imageAlt: '배달부가 맛있고 피자가 친절해요!',
    })]} slot="new" />);

    expect(html).not.toContain('wc-listing-banner__copy');
    expect(html).not.toContain('wc-listing-banner__title');
    expect(html).toMatch(/<a class="wc-strip-banner__link" href="\/offline-popups\/icons77"><picture><img alt="배달부가 맛있고 피자가 친절해요!"/);
  });

  /* 카테고리 전시 배너는 제목 없이 내용(부제)만 둘 수 있다 — 그 문구는 사라지지 않는다. */
  it('제목 없이 부제만 있는 배너는 부제만 그린다', () => {
    const html = renderToStaticMarkup(<ListingBanner banner={banner('sub', { title: '', subtitle: '겨울 신상 모음' })} />);

    expect(html).toContain('<span aria-hidden="true" class="wc-listing-banner__copy"><span class="wc-listing-banner__subtitle">겨울 신상 모음</span></span>');
    expect(html).not.toContain('wc-listing-banner__title');
  });

  it('링크가 없으면 링크 없이 그림만이고, 딤·글자색은 데이터 속성으로 남는다', () => {
    const plain = renderToStaticMarkup(<CollectionBanners banners={[banner('plain', { slot: 'new' })]} slot="new" />);
    expect(plain).not.toContain('wc-strip-banner__link');
    expect(plain).toContain('data-text-color="black"');

    const dimmed = renderToStaticMarkup(<CollectionBanners banners={[banner('dim', { slot: 'new', imageDim: 'black', textColor: 'white' })]} slot="new" />);
    expect(dimmed).toContain('<span aria-hidden="true" class="wc-listing-banner__dim" data-tone="black"></span>');
    expect(dimmed).toContain('data-text-color="white"');
  });

  it('여러 장이면 수동 캐러셀 — 루프 이전·다음 버튼과 위치 표시, 첫 장만 우선 로드하고 정지 버튼은 없다', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('a'), banner('b', { imageDim: 'black', textColor: 'white' }), banner('c')]} slot="all" />);

    expect(html).toContain('class="wc-strip-banners" data-slot="all"');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html.match(/aria-roledescription="slide"/g)).toHaveLength(3);
    expect(html).toContain('aria-label="1 / 3"');
    expect(html).toContain('aria-label="이전 배너"');
    expect(html).toContain('aria-label="다음 배너"');
    expect(html).toMatch(/<p aria-live="off" class="wc-strip-banner-slider__fraction"><span>1<\/span> \/ <span>3<\/span><\/p>/);
    expect(html.match(/fetchPriority="high"/g)).toHaveLength(1);
    expect(html.match(/loading="lazy"/g)).toHaveLength(2);
    expect(html).toContain('<span aria-hidden="true" class="wc-listing-banner__dim" data-tone="black"></span>');
    /* 레퍼런스는 자동 넘김이 꺼져 있다 — 움직이지 않으니 정지 버튼을 두지 않는다. 진행 막대도 없다. */
    expect(html).not.toMatch(/일시정지|자동 넘김|progress/);
  });

  it('BEST·NEW는 여러 장을 받아도 운영 순서 첫 장 하나만 — 슬라이더·이전·다음·위치 표시가 없다(l8b-data-1·l8b-ui-1)', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('b1', { slot: 'best' }), banner('b2', { slot: 'best' })]} slot="best" />);

    expect(html).toContain('배너 b1');
    expect(html).not.toContain('배너 b2');
    expect(html).not.toContain('aria-roledescription="carousel"');
    expect(html).not.toContain('aria-label="다음 배너"');
    expect(html).not.toContain('wc-strip-banner-slider__fraction');
  });

  it('목적지 게이트는 서버 로더가 이미 걸었다 — 받은 배너를 첫 HTML 에 그대로 그린다(컨텍스트 초기값으로 다시 걷지 않는다, l8b-ui-2)', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('packs', { slot: 'best', href: '/packs' })]} slot="best" />);

    expect(html).toContain('배너 packs');
    expect(html).toContain('href="/packs"');
  });

  it('이미지 주소가 빈 초안(어드민 미리보기)은 그림 없이 같은 크기의 면만 그린다', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('draft', { slot: 'new', imageUrl: '', title: '' })]} slot="new" />);

    expect(html).toContain('wc-listing-banner__blank');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<picture');
  });
});

describe('ListingBanner — 카테고리 전시 배너도 같은 한 장 틀이다', () => {
  it('전시 구성 배너(HomeHeroSlide 모양)를 같은 마크업으로 그리고 대체텍스트가 있으면 그것이 이름이다', () => {
    const html = renderToStaticMarkup(<ListingBanner banner={{
      id: 'category-1', title: '겨울 여행', subtitle: '신규 일러스트 MD', imageUrl: 'https://cdn.test/c.webp', mobileImageUrl: null, href: '/ip/hong-sil-quest', imageAlt: '눈 내린 풍경', imageDim: 'none', textColor: 'white',
    }} />);

    expect(html).toContain('class="wc-listing-banner" data-text-color="white"');
    expect(html).toContain('<img alt="눈 내린 풍경"');
    expect(html).toContain('href="/ip/hong-sil-quest"');
    expect(html).toContain('겨울 여행');
  });
});
