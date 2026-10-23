import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DATA, type Good, type Ip } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { EMPTY_GOODS_NOTICE } from '@/lib/goods-notice';
import { getLegalDocument } from '@/lib/legal/documents';
import type { ReviewRatingSummary } from '@/lib/reviews';
import { GoodDetail, GoodDetailView, pdpDefaultPanelId, pdpRailBoxState } from './GoodDetail';
import { buildGoodPreview } from '@/lib/admin/good-preview';

/* 상세페이지의 출고 기한 문장은 배송·반품 정책이 진실원이다.
 * 정책이 바뀌면 이 값이 따라 바뀌고, 상세페이지가 안 따라오면 아래 테스트가 깨진다. */
const SHIPPING_PERIOD_NOTICE = (() => {
  const row = getLegalDocument('shipping')
    ?.articles.flatMap((article) => article.table?.rows ?? [])
    .find(([label]) => label === '배송 기간');
  if (!row) throw new Error('배송·반품 정책에서 "배송 기간" 행을 찾지 못했다');
  return row[1];
})();

const cart = vi.hoisted(() => ({
  add: vi.fn(),
  error: null as string | null,
  getQuantity: vi.fn(() => 0),
  pending: false,
  ready: true,
  setQuantity: vi.fn(async () => {}),
}));

vi.mock('@/components/shell/CartProvider', () => ({ useCart: () => cart }));

const navigation = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/g13',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

/* 위시·재입고는 S4 의 다른 트랙(E)이 소유한다. 여기서 검증할 것은 "PDP 가 그 자리에
   무엇을 어떤 상태로 넘기는가"라 실물 대신 프롭을 그대로 뱉는 대역을 세운다. */
vi.mock('@/components/shop/WishlistHeart', () => ({
  WishlistHeart: ({ disabled, goodId, initialWished }: {
    disabled?: boolean;
    goodId: string;
    initialWished: boolean;
  }) => (
    <button
      className="wc-wish-heart"
      data-disabled={disabled ? 'true' : 'false'}
      data-good={goodId}
      data-wished={initialWished ? 'true' : 'false'}
      type="button"
    >
      위시
    </button>
  ),
}));

vi.mock('@/components/shop/RestockCta', () => ({
  RestockCta: ({ compact, disabled, goodId, initialRequested, variantId }: {
    className?: string;
    compact?: boolean;
    disabled?: boolean;
    goodId: string;
    initialRequested: boolean;
    optionName?: string | null;
    variantId?: string | null;
  }) => (
    <button
      className="wc-restock-cta"
      data-compact={compact ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      data-good={goodId}
      data-requested={initialRequested ? 'true' : 'false'}
      data-variant={variantId ?? ''}
      type="button"
    >
      재입고 알림 받기
    </button>
  ),
}));

const ip: Ip = {
  id: 'hong-sil-quest',
  title: '홍실 퀘스트',
  sub: 'SOOP2RANG · 캐릭터 IP',
  v: { key: 'character', label: '캐릭터 IP', color: '#FFD84D' },
  glyph: '홍실',
  bg: 'linear-gradient(#300008, #FF2E63)',
  fans: 0,
  goods: 3,
  cards: 0,
  featured: false,
  tagline: '붉은 실을 따라 시작되는 특별한 퀘스트',
  synopsis: '홍실 퀘스트 컬렉션',
};

const good: Good = {
  id: 'g13',
  name: '아크릴 블록',
  ip: 'hong-sil-quest',
  type: '아크릴',
  price: 12000,
  badge: 'NEW',
  stock: 'ok',
  stockQty: 8,
  img: 'url("https://cdn.example/g13.webp") center / cover no-repeat',
};

const detail: GoodDetailContent = {
  good,
  ip,
  description: '붉은 실을 따라 놓인 아크릴 블록입니다.',
  gallery: [
    'url("https://cdn.example/g13-1.webp") center / cover no-repeat',
    'url("https://cdn.example/g13-2.webp") center / cover no-repeat',
  ],
  detailImageUrl: 'https://cdn.example/g13-detail.webp',
  notice: {
    maker: '주식회사 아이콘스',
    origin: '대한민국',
    material: '아크릴',
    size: '80 x 60 x 20mm · 90g',
    madeOn: '2026-07',
    asManager: '아이콘스 고객센터',
    asContact: '02-000-0000',
  },
};

const summary: ReviewRatingSummary = {
  count: 3,
  average: 4.5,
  distribution: [0, 0, 0, 1, 2],
  photoCount: 1,
};

function render(overrides: Partial<GoodDetailContent> = {}) {
  return renderToStaticMarkup(
    <GoodDetail
      detail={{ ...detail, ...overrides }}
      qna={<p>Q&A 본문 슬롯</p>}
      qnaSummary={{ count: 2 }}
      reviewSummary={summary}
      reviews={<p>리뷰 본문 슬롯</p>}
    />,
  );
}

describe('GoodDetail', () => {
  it('다른 구성 슬롯은 리뷰 요약 바로 다음·상세 탭 앞에 표시하고 embedded에서는 숨긴다', () => {
    const slots = { reviewHighlights: <p>review-highlight-marker</p>, otherCompositions: <p>other-composition-marker</p>, announcements: <p>announcement-marker</p> };
    const html = renderToStaticMarkup(<GoodDetail detail={detail} {...slots} />);
    expect(html.indexOf('review-highlight-marker')).toBeLessThan(html.indexOf('other-composition-marker'));
    expect(html.indexOf('other-composition-marker')).toBeLessThan(html.indexOf('announcement-marker'));
    expect(html.indexOf('other-composition-marker')).toBeLessThan(html.indexOf('class="wc-pdp-tabs"'));
    const embedded = renderToStaticMarkup(<GoodDetailView detail={detail} embedded {...slots} />);
    expect(embedded).not.toContain('other-composition-marker');
    expect(embedded).not.toContain('review-highlight-marker');
  });

  it('HTML 설명은 문서 요소를 표시하고 실행 코드와 유해 링크를 제거한다', () => {
    const html = render({ descriptionFormat: 'html', description: '<h2>구성품</h2><p>키링 <strong>2개</strong></p><ul><li>보관 안내</li></ul><table><tbody><tr><th>소재</th><td>아크릴</td></tr></tbody></table><script>window.attacked=1</script><a href="javascript:alert(1)" onclick="alert(2)">위험 링크</a><a href="https://iconsip.com/legal/shipping">배송 안내</a>' });
    expect(html).toContain('<h2>구성품</h2>');
    expect(html).toContain('<strong>2개</strong>');
    expect(html).toContain('<th>소재</th><td>아크릴</td>');
    expect(html).toContain('href="https://iconsip.com/legal/shipping"');
    expect(html).not.toMatch(/window.attacked|javascript:|onclick=/);
  });

  it('HTML 미리보기와 공개 결과가 같고 DB가 검증한 저장소 경로와 https 호스팅 이미지만 표시한다', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://media.example.test');
    try {
      const path = 'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp';
      const raw = `<h1>구성품</h1><p>키링 &amp; 스티커</p><img src="${path}" alt="구성" width="9000" onerror="alert(1)"><img src="https://external.test/a.webp">`;
      const preview = buildGoodPreview({ values: { descriptionFormat: 'html', description: raw }, imageUrls: {}, fallbackBg: null, stockQty: 0, ip });
      const publicHtml = render({ description: raw, descriptionFormat: 'html', descriptionImagePaths: [path] });
      const previewHtml = render(preview);
      const descriptionHtml = (html: string) => html.match(/<div class="wc-goods-description">.*?<\/div>/s)?.[0];
      expect(descriptionHtml(previewHtml)).toBe(descriptionHtml(publicHtml));
      expect(publicHtml).toContain('src="https://media.example.test/storage/v1/object/public/public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp"');
      expect(publicHtml).not.toMatch(/onerror=|width="9000"/);
      /* 2026-10-07 MD 요청: 판매처 공통 호스팅 이미지는 주소 그대로 보인다. */
      expect(publicHtml).toContain('<img src="https://external.test/a.webp" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />');
      expect(render({ description: raw, descriptionFormat: 'html', descriptionImagePaths: [] })).not.toContain('src="https://media.example.test/');
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([
    '<p onclick="alert(1)">본문</p><style>body{display:none}</style>',
    '<svg><a xlink:href="javascript:alert(1)">SVG</a></svg><math><mtext><img src=x onerror="alert(2)"></mtext></math>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe><object data="javascript:alert(1)"></object>',
    '<a href="java&#x0a;script:alert(1)" style="color:red">링크</a><a href="//evil.test">외부</a>',
    '<img src="data:image/svg+xml,<svg onload=alert(1)>"><img srcset="https://evil.test/x 2x">',
  ])('직접 저장된 HTML도 공개 렌더에서 실행·유해 URL을 제거한다: %s', (source) => {
    const html = render({ descriptionFormat: 'html', description: source }).match(/<div class="wc-goods-description">.*?<\/div>/s)?.[0];
    expect(html).toBeDefined();
    expect(html).not.toMatch(/<script|<style|<svg|<math|<iframe|<object|onerror=|onclick=|onload=|javascript:|srcdoc=|srcset=|evil\.test|display:none|color:red/);
  });

  it('기존 일반 텍스트 설명의 태그 모양과 <3도 문자 그대로 보존한다', () => {
    const html = render({ description: '<3 & <strong>문자</strong>\n다음 줄' });
    expect(html).toContain('&lt;3 &amp; &lt;strong&gt;문자&lt;/strong&gt;\n다음 줄');
    expect(html).not.toContain('<strong>문자</strong>');
  });

  it('White Catalog PDP 골격으로 굿즈 정체성과 가격을 그린다', () => {
    const html = render();

    expect(html).toContain('wc-root wc-pdp');
    expect(html).toContain('wc-pdp__layout');
    expect(html).toContain('wc-pdp__info');
    expect(html).toContain('아크릴 블록');
    expect(html).toContain('₩12,000');
    /* 배지는 저장 배지 + 할인 파생이다(lib/goods-taxonomy). 재고 상태는 배지가 아니다. */
    expect(html).toContain('wc-pdp__badges');
    expect(html).toContain('>NEW<');
  });

  /* 정가가 있으면 취소선 정가와 할인율이 붙은 2행 블록이다(R-04 §3.3). */
  it('할인 중이면 가격이 2행으로 갈린다', () => {
    const html = render({ good: { ...good, compareAtPrice: 18000 } });

    expect(html).toContain('wc-price__original');
    expect(html).toContain('₩18,000');
    expect(html).toContain('33%');
    expect(html).toContain('>SALE<');
    expect(render()).not.toContain('wc-price__original');
  });

  it('할인율 표시를 끄면 상세에서도 비교 금액과 할인율을 숨기고 판매가는 유지한다', () => {
    const html = render({ good: { ...good, compareAtPrice: 18000, showDiscountRate: false } });
    expect(html).not.toContain('wc-price__original');
    expect(html).not.toContain('wc-price__rate');
    expect(html).toContain('₩12,000');
    /* PD-15 — 숨긴 할인을 SALE 배지가 다시 광고하지 않는다. */
    expect(html).not.toContain('>SALE<');
  });

  /* PD-15 · R-04 §3.3 — 취소선·할인율·판매가가 "₩18,000 33% ₩12,000"으로만 읽히지 않게 보조기기 라벨을 붙인다. */
  it('정가·할인율·할인가를 보조기기가 구분하도록 숨은 라벨을 붙인다', () => {
    const sale = render({ good: { ...good, compareAtPrice: 18000 } });
    expect(sale).toContain('<span class="wc-sr-only">정가</span><s class="wc-price__original">₩18,000</s>');
    expect(sale).toContain('<span class="wc-sr-only">할인율</span><span class="wc-price__rate">33%</span>');
    expect(sale).toContain('<span class="wc-sr-only">할인가</span><span class="wc-price__amount">₩12,000</span>');

    /* 할인 표기가 없거나 숨겼으면 실제 결제가를 '정가'라 부르지 않는다. */
    expect(render()).toContain('<span class="wc-sr-only">가격</span><span class="wc-price__amount">₩12,000</span>');
    expect(render({ good: { ...good, compareAtPrice: 18000, showDiscountRate: false } }))
      .toContain('<span class="wc-sr-only">가격</span><span class="wc-price__amount">₩12,000</span>');
  });

  /* 소비자가 12,000원 → 할인가 10,800원에 옵션가 3,000원. 옵션가는 할인하지 않으므로 선택한 옵션의
     정가는 15,000원이고, 할인 금액 1,200원만큼의 할인율(8%)을 보인다. */
  it('옵션가가 붙은 옵션을 고르면 그 옵션의 정가와 실제 할인율을 보인다', () => {
    const option = { id: '00000000-0000-4000-8000-000000000201', name: '대형', code: 'G13-L', price: 13800, stockQty: 3, isDefault: true, attributes: {} };
    const html = render({ good: { ...good, price: 13800, priceMax: 13800, catalogPrice: 10800, catalogCompareAtPrice: 12000, compareAtPrice: 15000, options: [option] } });

    expect(html).toContain('<s class="wc-price__original">₩15,000</s>');
    expect(html).toContain('<span class="wc-price__rate">8%</span>');
    expect(html).toContain('<span class="wc-price__amount">₩13,800</span>');
    expect(html).toContain('>SALE<');
  });

  it('갤러리를 scroll-snap 스테이지와 도트·썸네일로 그린다', () => {
    const html = render();

    expect(html).toContain('wc-pdp-gallery__stage');
    expect(html).toContain('wc-pdp-gallery__dot');
    expect(html).toContain('wc-pdp-gallery__thumb');
    expect(html).toContain('aria-label="1번째 이미지"');
    expect(html).toContain('aria-label="3번째 이미지"');
    expect(html).toContain('https://cdn.example/g13-1.webp');
  });

  /* 2026-10-07 — 대표 이미지 1장 + 추가 이미지 최대 9장 = 10장을 도트·썸네일 모두 끝까지 그린다. */
  it('대표 이미지와 추가 이미지 9장을 10개 슬라이드·도트·썸네일로 그린다', () => {
    const html = render({ gallery: Array.from({ length: 9 }, (_, index) => `url("https://cdn.example/g13-extra-${index + 1}.webp")`) });

    expect(html.match(/class="wc-pdp-gallery__slide"/g)).toHaveLength(10);
    expect(html.match(/class="wc-pdp-gallery__dot(?: is-active)?"/g)).toHaveLength(10);
    expect(html.match(/class="wc-pdp-gallery__thumb(?: is-active)?"/g)).toHaveLength(10);
    expect(html).toContain('aria-label="10번째 이미지 보기"');
    expect(html).toContain('https://cdn.example/g13-extra-9.webp');
  });

  /* 2026-10-07 QA 6 — 도트의 기준 상자가 썸네일까지 품은 갤러리 전체라, 데스크톱에서 도트가
   * 썸네일 줄(10장이면 둘째 줄) 위에 떴다. 도트는 메인 이미지(스테이지)와 같은 상자에 두고
   * 썸네일은 그 상자 밖에 둬야 썸네일 줄 수와 무관하게 이미지 안쪽 하단에 남는다. */
  it('도트는 메인 이미지 상자 안에, 썸네일은 그 상자 밖에 그린다', () => {
    const html = render({ gallery: Array.from({ length: 9 }, (_, index) => `url("https://cdn.example/g13-extra-${index + 1}.webp")`) });
    const open = html.indexOf('<div class="wc-pdp-gallery__viewport">');
    expect(open).toBeGreaterThanOrEqual(0);

    /* 열린 div를 짝이 맞는 닫는 태그까지 잘라 낸다(슬라이드는 div, 도트·썸네일은 button). */
    let depth = 0;
    let end = -1;
    for (const match of html.slice(open).matchAll(/<div\b|<\/div>/g)) {
      depth += match[0] === '</div>' ? -1 : 1;
      if (depth === 0) {
        end = open + (match.index ?? 0) + match[0].length;
        break;
      }
    }
    const viewport = html.slice(open, end);

    expect(viewport).toContain('class="wc-pdp-gallery__stage"');
    expect(viewport).toContain('class="wc-pdp-gallery__dots"');
    expect(viewport.match(/class="wc-pdp-gallery__dot(?: is-active)?"/g)).toHaveLength(10);
    expect(viewport).not.toContain('wc-pdp-gallery__thumb');
    expect(html.indexOf('class="wc-pdp-gallery__thumbs"')).toBeGreaterThanOrEqual(end);
  });

  /* #172 완료 조건 — 갤러리가 비어도 대표 이미지로 정상 렌더된다. */
  it('갤러리가 비면 대표 이미지 한 장만 남고 도트는 사라진다', () => {
    const html = render({ gallery: [], detailImageUrl: null });

    expect(html).toContain('https://cdn.example/g13.webp');
    expect(html).toContain('wc-pdp-gallery__stage');
    expect(html).not.toContain('wc-pdp-gallery__dot');
    expect(html).not.toContain('wc-pdp-panel__image');
  });

  it('수량·합계·CTA 쌍을 구매 패널에 둔다', () => {
    const html = render();

    expect(html).toContain('wc-buy-panel__ctas');
    expect(html).toContain('수량');
    expect(html).toContain('총 금액');
    expect(html).toContain('>장바구니<');
    expect(html).toContain('>구매하기<');
    expect(html).not.toContain('재입고 알림 받기');
  });

  /* R-04 §4 — 품절이면 CTA 자리만 재입고 알림으로 바뀌고 수량·합계는 남는다. */
  it.each([['scheduled', '판매 시작 전'], ['ended', '판매 종료']] as const)('shows the sale period and prevents a misleading restock CTA for %s', (state, label) => {
    const html = render({ good: { ...good, stock: 'soldout', stockQty: 0, salePeriod: { state, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-15T00:00:00Z', calculatedAt: '2026-10-13T00:00:00Z', nextChangeAt: null } } });
    expect(html).toContain(`>${label}</button>`); expect(html).toContain(`>${label}</p>`); expect(html).not.toContain('재입고 알림 받기'); expect(html).not.toContain('>품절<'); expect(html).not.toContain('>구매하기<');
    expect(html).toContain('>판매 상태</span>'); expect(html).not.toContain('옵션 선택 후 표시');
    expect(html).toContain(`class="wc-buybar__buy" type="button" disabled="">${label}</button>`);
    /* 바가 시트를 열지 않으므로 모바일에서도 본문 패널을 남긴다(옵션·예약·한도 안내를 볼 길). */
    expect(html).toContain('<div class="wc-pdp__purchase is-inline"><div class="wc-buy-panel">');
  });
  it('품절이면 CTA가 재입고 알림으로 교체되고 합계는 가격으로 남는다', () => {
    const html = render({ good: { ...good, stock: 'soldout', stockQty: 0 } });

    expect(html).toContain('재입고 알림 받기');
    expect(html).toContain('data-good="g13"');
    expect(html).toContain('총 금액');
    /* PD-08 — 고를 옵션이 없는 품절 굿즈에 "옵션 선택 후 표시"를 남기지 않는다. 본문 패널·레일 박스가 같다. */
    expect(html).toContain('<strong class="wc-buy-panel__total-amount">₩12,000</strong>');
    expect(html).toContain('<strong class="wc-pdp-railbox__amount">₩12,000</strong>');
    expect(html).not.toContain('옵션 선택 후 표시');
    /* PD-12 — 재고 표시 라벨은 두지 않는다. 품절은 재입고 알림이 말한다. */
    expect(html).not.toMatch(/<p class="wc-buy-panel__state">품절<\/p>/);
    expect(html).not.toContain('wc-buy-panel__ctas');
    expect(html).not.toContain('>구매하기<');
  });

  /* PD-12 — 리뷰 0건은 회색 별만, 있으면 평균과 "N개 리뷰보기" 링크(리뷰 탭을 연다). */
  it('리뷰가 있으면 별점 행이 평균과 리뷰 탭을 여는 링크다', () => {
    const html = render();
    const rating = html.match(/<p class="wc-pdp-tools__rating">.*?<\/p>/)?.[0] ?? '';

    expect(rating).toContain('<span class="wc-sr-only">5점 만점에 4.5점</span>');
    expect(rating).toContain('<strong class="wc-pdp-tools__average">4.5</strong>');
    /* 스크립트 전·새 탭 클릭에는 리뷰 탭으로 여는 주소로 그대로 간다. */
    expect(rating).toContain('<a class="wc-pdp-tools__reviews" href="/shop/g13?reviewPage=1#reviews">3개 리뷰보기</a>');
    expect(rating).not.toContain('리뷰 3건');
  });

  it('리뷰 0건이면 숫자와 "리뷰 0건" 없이 회색 별만 두고, 조회 실패면 비운다', () => {
    const empty = renderToStaticMarkup(<GoodDetail detail={detail} reviewSummary={{ count: 0, average: 0, distribution: [0, 0, 0, 0, 0], photoCount: 0 }} />);
    const rating = empty.match(/<p class="wc-pdp-tools__rating is-empty">.*?<\/p>/)?.[0] ?? '';

    expect(rating).toBe('<p class="wc-pdp-tools__rating is-empty"><span aria-hidden="true" class="wc-rating__stars">☆☆☆☆☆</span><span class="wc-sr-only">아직 등록된 리뷰가 없습니다.</span></p>');
    expect(empty).not.toContain('0.0');
    expect(empty).not.toContain('리뷰 0건');
    expect(empty).not.toContain('wc-pdp-tools__reviews');

    const failed = renderToStaticMarkup(<GoodDetail detail={detail} />);
    expect(failed).not.toContain('wc-pdp-tools__rating');
  });

  /* PD-07 — 위시 하트 옆 36 원형 공유 버튼. 미리보기에서는 실제로 열지 않는다. */
  it('위시 하트 옆에 공유 버튼을 두고 미리보기에서는 비활성으로 그린다', () => {
    const html = render();
    const actions = html.match(/<div class="wc-pdp-tools__actions">.*?<\/div>/)?.[0] ?? '';

    expect(actions.indexOf('wc-wish-heart')).toBeLessThan(actions.indexOf('wc-pdp-share'));
    expect(actions).toContain('<button aria-expanded="false" aria-haspopup="dialog" aria-label="공유하기" class="wc-pdp-share" type="button">');
    expect(renderToStaticMarkup(<GoodDetailView detail={detail} embedded />)).toMatch(/aria-label="공유하기" class="wc-pdp-share" disabled=""/);
  });

  it('위시 하트에 현재 찜 상태를 넘긴다', () => {
    const wished = renderToStaticMarkup(
      <GoodDetail detail={detail} engagement={{ restockRequested: false, wished: true }} />,
    );

    expect(wished).toContain('wc-pdp-tools');
    expect(wished).toContain('data-wished="true"');
    expect(render()).toContain('data-wished="false"');
  });

  /* PD-03 — 뷰포트 고정 미니 바는 짧은 상세에서 첫 화면부터 본문 CTA 와 겹쳤다. 데스크톱 구매 요약은
     하부 탭 섹션의 우측 레일 안 박스로만 둔다(레일 안 sticky 라 탭 섹션 범위에서만 보인다). */
  it('모바일 고정 바와 탭 섹션 레일 안 구매 요약 박스를 두고 뷰포트 고정 미니 바는 없다', () => {
    const only = { id: '00000000-0000-4000-8000-000000000301', name: '기본 옵션', code: 'G13', price: 12000, stockQty: 8, isDefault: true, attributes: {} };
    const html = render({ good: { ...good, options: [only] } });

    expect(html).toContain('class="wc-buybar"');
    expect(html).not.toContain('wc-buybar-mini');
    const tabs = html.slice(html.indexOf('class="wc-pdp-tabs"'));
    const rail = tabs.slice(tabs.indexOf('<div class="wc-pdp-rail">'));
    expect(tabs.indexOf('<div class="wc-pdp-rail">')).toBeGreaterThan(tabs.indexOf('role="tablist"'));
    expect(rail).toMatch(/^<div class="wc-pdp-rail"><section aria-label="빠른 구매" class="wc-pdp-railbox">/);
    expect(rail).toContain('<span class="wc-pdp-railbox__label">총 금액</span><strong class="wc-pdp-railbox__amount">₩12,000</strong>');
    expect(rail).toContain('aria-label="장바구니에 담기" class="wc-pdp-railbox__cart"');
    expect(rail).toContain('>구매하기</button>');
    /* 레일 끝 표지는 문의 런처 판단용이다 — 보조기기에는 없다. */
    expect(rail).toContain('<span aria-hidden="true" class="wc-pdp-rail__end"></span>');
  });

  it('탭 섹션은 컨테이너 밖 전폭이라 탭바가 화면 끝까지 간다', () => {
    const html = render();
    const tabs = html.slice(html.indexOf('<div class="wc-pdp-tabs">'));

    expect(tabs.startsWith('<div class="wc-pdp-tabs"><div class="wc-tabs"><div class="wc-tabs__list" role="tablist">')).toBe(true);
  });

  it('품절이면 레일 박스 CTA 도 재입고 알림이고 판매 기간 밖이면 비활성 상태 버튼이다', () => {
    const soldOut = render({ good: { ...good, stock: 'soldout', stockQty: 0 } });
    const soldOutRail = soldOut.slice(soldOut.indexOf('<div class="wc-pdp-rail">'));
    expect(soldOutRail).toContain('wc-restock-cta');
    expect(soldOutRail).not.toContain('wc-pdp-railbox__ctas');

    const ended = render({ good: { ...good, stock: 'soldout', stockQty: 0, salePeriod: { state: 'ended', startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-15T00:00:00Z', calculatedAt: '2026-10-16T00:00:00Z', nextChangeAt: null } } });
    const endedRail = ended.slice(ended.indexOf('<div class="wc-pdp-rail">'));
    expect(endedRail).toContain('<button class="wc-pdp-railbox__buy is-full" disabled="" type="button">판매 종료</button>');
    expect(endedRail).not.toContain('wc-restock-cta');
  });

  /* PD-01 — 모바일 바는 구매 시트를 여는 트리거다. 실행은 시트 안 CTA 가 한다. */
  it('모바일 바의 장바구니·구매하기는 시트를 여는 트리거라 본문 패널이 잠긴 동안에도 잠기지 않는다', () => {
    const options = [
      { id: '00000000-0000-4000-8000-000000000201', name: '파랑', code: 'G13-B', price: 12000, stockQty: 3, isDefault: true, attributes: {} },
      { id: '00000000-0000-4000-8000-000000000202', name: '빨강', code: 'G13-R', price: 13000, stockQty: 0, isDefault: false, attributes: {} },
    ];
    const barOf = (html: string) => html.slice(html.indexOf('<div class="wc-buybar">'), html.indexOf('</div>', html.indexOf('<div class="wc-buybar">')));
    const html = render({ good: { ...good, options } });
    const bar = barOf(html);

    expect(bar).toMatch(/<button aria-expanded="false" aria-haspopup="dialog" aria-label="장바구니에 담기" class="wc-buybar__cart" type="button">/);
    expect(bar).toMatch(/<button aria-expanded="false" aria-haspopup="dialog" class="wc-buybar__buy" type="button">구매하기<\/button>/);
    expect(bar).not.toContain('disabled');
    /* LD-5 — 본문 패널은 같은 컨트롤러라 첫 구매 가능 옵션(파랑)을 고른 채 열리고 담기·구매가 바로 된다.
       품절 옵션(빨강)은 고를 수 있게 `· 품절`로 남는다. 모바일에서는 CSS 가 이 래퍼째 숨긴다. */
    expect(html).toContain('<div class="wc-pdp__purchase"><div class="wc-buy-panel">');
    expect(html).toContain('<option value="00000000-0000-4000-8000-000000000201" selected="">파랑 · ₩12,000</option>');
    expect(html).toContain('<option value="00000000-0000-4000-8000-000000000202">빨강 · ₩13,000 · 품절</option>');
    expect(html).toMatch(/<button class="wc-btn wc-buy-panel__cart" type="button">장바구니<\/button>/);
    expect(html).toContain('<strong class="wc-buy-panel__total-amount">₩12,000</strong>');

    /* 카트가 준비되기 전에는 본문 패널의 CTA 가 잠기지만 바는 시트를 여는 트리거라 그대로다. */
    try {
      cart.ready = false;
      const loading = render({ good: { ...good, options } });
      expect(loading).toMatch(/class="wc-btn wc-buy-panel__cart" disabled=""/);
      expect(barOf(loading)).not.toContain('disabled');
    } finally {
      cart.ready = true;
    }
  });

  /* PD-10 — 다른 옵션은 판매 중이고 고른 옵션만 품절: 본문 패널·레일 박스 CTA 는 그 옵션의 재입고 알림이다.
     모바일 바는 상태를 말한다(R-04 §10-7 결함 미재현) — 벨 + '재입고 알림 받기'로 바뀌되 여전히 시트를 여는
     트리거라 시트에서 그 옵션을 신청하거나 다른 옵션을 고른다. 고른 옵션은 담을 수 없어 카트 존이 없다. */
  it('고른 옵션만 품절이면 패널·레일은 그 옵션의 재입고 알림이고 모바일 바는 재입고 알림을 말하는 시트 트리거다', () => {
    const options = [
      { id: '00000000-0000-4000-8000-000000000221', name: '파랑', code: 'G13-B', price: 12000, stockQty: 3, isDefault: true, attributes: {} },
      { id: '00000000-0000-4000-8000-000000000222', name: '빨강', code: 'G13-R', price: 13000, stockQty: 0, isDefault: false, attributes: {} },
    ];
    try {
      navigation.search = 'variant=00000000-0000-4000-8000-000000000222';
      const html = render({ good: { ...good, price: 12000, priceMax: 13000, options } });
      const panel = html.slice(html.indexOf('<div class="wc-pdp__purchase">'), html.indexOf('<div class="wc-pdp-tabs">'));
      const rail = html.slice(html.indexOf('<div class="wc-pdp-rail">'));
      const bar = html.slice(html.indexOf('<div class="wc-buybar">'));

      expect(panel).toContain('<option value="00000000-0000-4000-8000-000000000222" selected="">빨강 · ₩13,000 · 품절</option>');
      expect(panel).toMatch(/<button class="wc-restock-cta"[^>]*data-variant="00000000-0000-4000-8000-000000000222"/);
      expect(panel).not.toContain('wc-buy-panel__ctas');
      expect(panel).toContain('<strong class="wc-buy-panel__total-amount">₩13,000</strong>');
      expect(rail).toMatch(/<button class="wc-restock-cta"[^>]*data-variant="00000000-0000-4000-8000-000000000222"/);
      expect(rail).toContain('<strong class="wc-pdp-railbox__amount">₩13,000</strong>');
      expect(bar.startsWith('<div class="wc-buybar"><div class="wc-restock-cta wc-buybar__restock">'
        + '<button aria-expanded="false" aria-haspopup="dialog" class="wc-btn primary" type="button"><svg aria-hidden="true"')).toBe(true);
      /* 바 끝의 상태 줄(보조기기 전용)은 바에서 직접 신청한 결과가 바뀐 판매 상태로 거절됐을 때 이유를 든다. */
      expect(bar).toContain('<span class="wc-sr-only">빨강 옵션 </span>재입고 알림 받기</button></div>'
        + '<p aria-atomic="true" aria-live="polite" class="wc-sr-only" role="status"></p></div>');
      /* 담을 수 없는 옵션을 고른 채 [장바구니]·[구매하기]를 약속하지 않는다. 시트 안 신청 버튼(RestockCta)도 바에 없다. */
      expect(bar).not.toContain('장바구니에 담기');
      expect(bar).not.toContain('>구매하기<');
      expect(bar).not.toMatch(/<button class="wc-restock-cta"/);
      /* 바가 시트를 여니 모바일 본문 패널은 시트로 옮겨 간다(is-inline 아님). 가격 표시는 고른 옵션이다. */
      expect(html).toContain('<div class="wc-pdp__purchase"><div class="wc-buy-panel">');
      expect(html).toContain('<span class="wc-sr-only">가격</span><span class="wc-price__amount">₩13,000</span>');
    } finally {
      navigation.search = '';
    }
  });

  /* PD-11 — 옵션 단위 신청은 그 옵션을 골랐을 때만 신청됨으로 보이고, 굿즈 단위 신청과 섞이지 않는다. */
  it('옵션 단위 신청 상태를 그 옵션의 재입고 CTA 에만 넘긴다', () => {
    const options = [
      { id: '00000000-0000-4000-8000-000000000231', name: '파랑', code: 'G13-B', price: 12000, stockQty: 3, isDefault: true, attributes: {} },
      { id: '00000000-0000-4000-8000-000000000232', name: '빨강', code: 'G13-R', price: 13000, stockQty: 0, isDefault: false, attributes: {} },
    ];
    try {
      navigation.search = 'variant=00000000-0000-4000-8000-000000000232';
      const requested = renderToStaticMarkup(<GoodDetail detail={{ ...detail, good: { ...good, options } }}
        engagement={{ wished: false, restockRequested: false, restockVariantIds: ['00000000-0000-4000-8000-000000000232'] }} />);
      expect(requested).toMatch(/data-requested="true" data-variant="00000000-0000-4000-8000-000000000232"/);
      const goodsLevelOnly = renderToStaticMarkup(<GoodDetail detail={{ ...detail, good: { ...good, options } }}
        engagement={{ wished: false, restockRequested: true, restockVariantIds: [] }} />);
      expect(goodsLevelOnly).toMatch(/data-requested="false" data-variant="00000000-0000-4000-8000-000000000232"/);
      /* 모바일 바의 시트 트리거도 고른 옵션의 신청 상태를 말한다. */
      expect(requested.slice(requested.indexOf('<div class="wc-buybar">'))).toContain('<span class="wc-sr-only">빨강 옵션 </span>재입고 알림 신청됨</button>');
      expect(goodsLevelOnly.slice(goodsLevelOnly.indexOf('<div class="wc-buybar">'))).toContain('<span class="wc-sr-only">빨강 옵션 </span>재입고 알림 받기</button>');
    } finally {
      navigation.search = '';
    }
  });

  it('품절이면 모바일 바 전체가 재입고 알림이고 시트 트리거를 두지 않는다', () => {
    const html = render({ good: { ...good, stock: 'soldout', stockQty: 0 } });
    const bar = html.slice(html.indexOf('<div class="wc-buybar">'));

    expect(bar.startsWith('<div class="wc-buybar"><button class="wc-restock-cta"')).toBe(true);
    /* 모든 옵션 품절은 굿즈 단위(모든 옵션) 신청이다 — 옵션 키가 없다. */
    expect(bar).toMatch(/^<div class="wc-buybar"><button class="wc-restock-cta"[^>]*data-variant=""/);
    /* 바(72px)·레일 박스에는 안내 줄을 늘릴 자리가 없어 좁은 표면 모드로, 본문 패널은 버튼 아래 안내 줄로 알린다. */
    expect(bar).toMatch(/^<div class="wc-buybar"><button class="wc-restock-cta" data-compact="true"/);
    expect(html.slice(html.indexOf('<div class="wc-pdp-rail">'))).toMatch(/<button class="wc-restock-cta" data-compact="true"/);
    expect(html.slice(html.indexOf('<div class="wc-pdp__purchase'), html.indexOf('<div class="wc-pdp-tabs">'))).toMatch(/<button class="wc-restock-cta" data-compact="false"/);
    expect(html).not.toContain('aria-haspopup="dialog" aria-label="장바구니에 담기"');
    /* 시트 트리거가 없으니 모바일 본문 패널을 숨기지 않는다 — 품절 합계(PD-08)·옵션별 가격이 남는다. */
    expect(html).toContain('<div class="wc-pdp__purchase is-inline"><div class="wc-buy-panel">');
  });

  /* PD-10 · R-04 §3.5 — 모든 옵션이 품절인 다옵션 굿즈: 빈 옵션 없이 첫 옵션을 고른 채 열고, 셀렉트·제목 가격·
     합계가 같은 옵션을 가리킨다. CTA 는 굿즈 단위(모든 옵션) 재입고 알림 그대로다. */
  it('모든 옵션이 품절이면 첫 옵션을 고른 채 열고 셀렉트·가격·합계가 같은 옵션이다', () => {
    const options = [
      { id: '00000000-0000-4000-8000-0000005672d1', name: '옵션 D', code: 'G13-D', price: 12000, stockQty: 0, isDefault: true, attributes: {} },
      { id: '00000000-0000-4000-8000-0000005672e1', name: '옵션 E', code: 'G13-E', price: 13000, stockQty: 0, isDefault: false, attributes: {} },
    ];
    const soldOut = { good: { ...good, stock: 'soldout' as const, stockQty: 0, price: 12000, priceMax: 13000, options } };
    const html = render(soldOut);
    const select = html.slice(html.indexOf('<select'), html.indexOf('</select>'));

    expect(select).not.toContain('옵션을 선택해주세요');
    expect(select).toContain('<option value="00000000-0000-4000-8000-0000005672d1" selected="">옵션 D · ₩12,000 · 품절</option>');
    expect(html).toContain('<span class="wc-sr-only">가격</span><span class="wc-price__amount">₩12,000</span>');
    expect(html).not.toContain('₩12,000 ~ ₩13,000');
    expect(html).toContain('<strong class="wc-buy-panel__total-amount">₩12,000</strong>');
    expect(html).toContain('<strong class="wc-pdp-railbox__amount">₩12,000</strong>');
    expect(html).toMatch(/<button class="wc-restock-cta"[^>]*data-variant=""/);
    expect(html).not.toMatch(/data-variant="00000000-0000-4000-8000-0000005672d1"/);

    /* 직접 고른 옵션 E 도 셀렉트·가격·합계가 E 이고 CTA 는 굿즈 단위다. 기본 선택은 주소에 쓰지 않지만 고른 옵션은 받는다. */
    try {
      navigation.search = 'variant=00000000-0000-4000-8000-0000005672e1';
      const chosen = render(soldOut);
      expect(chosen).toContain('<option value="00000000-0000-4000-8000-0000005672e1" selected="">옵션 E · ₩13,000 · 품절</option>');
      expect(chosen).toContain('<span class="wc-sr-only">가격</span><span class="wc-price__amount">₩13,000</span>');
      expect(chosen).toContain('<strong class="wc-buy-panel__total-amount">₩13,000</strong>');
      expect(chosen).toMatch(/<button class="wc-restock-cta"[^>]*data-variant=""/);
    } finally {
      navigation.search = '';
    }
  });

  it('하부를 패널 전환 탭으로 나눈다', () => {
    const html = render();

    expect(html).toContain('wc-pdp-tabs');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="pdp-tab-detail"');
    expect(html).toContain('id="pdp-panel-reviews"');
    expect(html).toContain('>상세정보<');
    expect(html).toContain('>리뷰 (3)<');
    /* PD-06 — 4번째 탭은 '추가정보'다(모바일에서 라벨이 잘리지 않는 길이). */
    expect(html).toContain('>추가정보<');
    expect(html).toContain('id="pdp-panel-info"');
    expect(html).not.toContain('배송·교환 안내');
    expect(html).toContain('리뷰 본문 슬롯');
  });

  /* 상품 Q&A(#330)는 리뷰와 배송 안내 사이다 — 구매 전 질문은 후기 다음, 정책 앞에서
     읽힌다. 본문은 리뷰와 같은 이유로 서버가 그린 slot 이다. */
  it('리뷰와 추가정보 사이에 Q&A 탭을 둔다', () => {
    const html = render();

    expect(html).toContain('id="pdp-panel-qna"');
    expect(html).toContain('>Q&amp;A (2)<');
    expect(html).toContain('Q&amp;A 본문 슬롯');
    expect(html.indexOf('id="pdp-tab-qna"')).toBeGreaterThan(html.indexOf('id="pdp-tab-reviews"'));
    expect(html.indexOf('id="pdp-tab-info"')).toBeGreaterThan(html.indexOf('id="pdp-tab-qna"'));
  });

  /* CH-16 — 문의 런처가 레일 박스와 겹치지 않게 하는 판단 근거. */
  it('레일 박스는 탭 섹션 안에서는 화면 하단에 붙고, 레일 끝이 보이면 레일과 함께 올라간다', () => {
    expect(pdpRailBoxState({ panelsInView: false, railEndInView: false })).toBeUndefined();
    expect(pdpRailBoxState({ panelsInView: false, railEndInView: true })).toBeUndefined();
    expect(pdpRailBoxState({ panelsInView: true, railEndInView: false })).toBe('docked');
    expect(pdpRailBoxState({ panelsInView: true, railEndInView: true })).toBe('leaving');
  });

  /* PD-14 — ?variant= 로 들어오면 그 옵션으로 연다(서버 렌더도 같은 값). 고를 수 없는 값은 무시한다. */
  it('주소의 ?variant= 가 고를 수 있는 옵션이면 그 옵션과 가격으로 연다', () => {
    const options = [
      { id: '00000000-0000-4000-8000-000000000401', name: '파랑', code: 'G13-B', price: 12000, stockQty: 3, isDefault: true, attributes: {} },
      { id: '00000000-0000-4000-8000-000000000402', name: '빨강', code: 'G13-R', price: 15000, stockQty: 2, isDefault: false, attributes: {} },
      { id: '00000000-0000-4000-8000-000000000403', name: '초록', code: 'G13-G', price: 13000, stockQty: 0, isDefault: false, attributes: {} },
    ];
    const multi = { good: { ...good, price: 12000, priceMax: 15000, options } };
    try {
      navigation.search = 'reviewPage=2&variant=00000000-0000-4000-8000-000000000402';
      const chosen = render(multi);
      expect(chosen).toMatch(/<select[^>]*>.*<option value="00000000-0000-4000-8000-000000000402" selected="">빨강 · ₩15,000<\/option>/s);
      expect(chosen).toContain('<span class="wc-sr-only">가격</span><span class="wc-price__amount">₩15,000</span>');
      expect(chosen).toContain('<strong class="wc-buy-panel__total-amount">₩15,000</strong>');

      /* PD-10 — 품절 옵션은 그 옵션을 고른 채(재입고 알림 CTA) 연다. 재입고 알림·공유 링크가 이 주소다. */
      navigation.search = 'variant=00000000-0000-4000-8000-000000000403';
      const soldOutChoice = render(multi);
      expect(soldOutChoice).toMatch(/<option value="00000000-0000-4000-8000-000000000403" selected="">초록 · ₩13,000 · 품절<\/option>/);
      expect(soldOutChoice).toContain('<strong class="wc-buy-panel__total-amount">₩13,000</strong>');
      expect(soldOutChoice).toMatch(/data-variant="00000000-0000-4000-8000-000000000403"/);

      /* 다른 굿즈 옵션·오타는 기본 선택 규칙(첫 구매 가능 옵션, LD-5)으로 돌아간다. */
      navigation.search = 'variant=00000000-0000-4000-8000-999999999999';
      const fallback = render(multi);
      expect(fallback).toMatch(/<option value="00000000-0000-4000-8000-000000000401" selected="">파랑 · ₩12,000<\/option>/);
      expect(fallback).toContain('<strong class="wc-buy-panel__total-amount">₩12,000</strong>');
      expect(fallback).not.toContain('wc-restock-cta');
    } finally {
      navigation.search = '';
    }
  });

  it('리뷰 조건이 URL에 있으면 리뷰 탭에서 연다', () => {
    expect(pdpDefaultPanelId(new URLSearchParams(''))).toBe('detail');
    expect(pdpDefaultPanelId(null)).toBe('detail');
    /* goodReviewsHref는 1페이지 링크에도 reviewPage=1을 싣는다 — 이 계약이 무너지면
       리뷰 페이지네이션 "이전"이 상세정보 탭에 떨어져 무동작이 된다. */
    expect(pdpDefaultPanelId(new URLSearchParams('reviewPage=1'))).toBe('reviews');
    expect(pdpDefaultPanelId(new URLSearchParams('reviewPage=2'))).toBe('reviews');
    expect(pdpDefaultPanelId(new URLSearchParams('reviewSort=rating_desc'))).toBe('reviews');
    expect(pdpDefaultPanelId(new URLSearchParams('reviewPhoto=1'))).toBe('reviews');
  });

  /* 내 Q&A 목록·알림에서 오는 링크가 전부 이 파라미터를 달고 온다. 도착한 화면이
     상세정보 탭이면 방금 찾아온 질문을 볼 수 없다. */
  it('Q&A 조건이 URL에 있으면 Q&A 탭에서 연다', () => {
    expect(pdpDefaultPanelId(new URLSearchParams('qnaPage=1'))).toBe('qna');
    expect(pdpDefaultPanelId(new URLSearchParams('qnaPage=2'))).toBe('qna');
    /* 두 조건이 함께 오면 리뷰가 먼저다 — 기존 링크의 도착지를 바꾸지 않는다. */
    expect(pdpDefaultPanelId(new URLSearchParams('reviewPage=2&qnaPage=2'))).toBe('reviews');
  });

  it('고시정보 표와 배송·교환 안내를 추가정보 탭 아코디언에 싣는다', () => {
    const html = render();
    const info = html.slice(html.indexOf('id="pdp-panel-info"'));
    const detailPanel = html.slice(html.indexOf('id="pdp-panel-detail"'), html.indexOf('id="pdp-panel-reviews"'));

    /* PD-06 — 고시정보는 상세 패널에서 추가정보 탭으로 옮겼다. 4개 절이 각각 <details> 다. */
    expect(detailPanel).not.toContain('pdp-notice-heading');
    expect(info.match(/<details class="wc-pdp-info__item">/g)).toHaveLength(4);
    expect(info.indexOf('pdp-notice-heading')).toBeLessThan(info.indexOf('pdp-shipping-heading'));
    expect(info.indexOf('pdp-shipping-heading')).toBeLessThan(info.indexOf('pdp-return-heading'));
    expect(info.indexOf('pdp-return-heading')).toBeLessThan(info.indexOf('pdp-seller-heading'));
    expect(info).toContain('<summary class="wc-pdp-info__summary"><span id="pdp-seller-heading">판매자 정보</span></summary>');
    expect(html).toContain('고시정보');
    expect(html).toContain('제조사 / 수입사');
    expect(html).toContain('주식회사 아이콘스');
    expect(html).toContain('A/S 연락처');
    expect(html).toContain('배송 안내');
    expect(html).toContain('배송 정책을 확인하지 못했습니다');
    expect(html).toContain('교환 · 반품 안내');
    expect(html).toContain('7일 이내');
  });

  /* 표 제목은 용어집(CONTEXT.md '고시정보')을 따르고, 법정 고시 제도의 이름은 캡션 각주로만 남는다. */
  it('고시정보 표 제목이 용어집 용어를 쓴다', () => {
    const html = render();

    expect(html).toMatch(/id="pdp-notice-heading"[^>]*>고시정보</);
    expect(html).toContain('전자상거래법에 따라 표시하는 상품정보제공고시 항목입니다.');
  });

  /* 상세페이지가 정책보다 짧은 출고 기한을 약속하면 약관 제13조의 "약정 배송기간"이 둘이 된다.
     검사는 배송 안내 절로 좁힌다 — 다른 절(문의 답변 SLA 등)이 쓰는 "영업일"까지 금지하면
     실제 위험(출고 기한이 둘이 되는 것)과 무관한 문구가 이 규칙에 걸린다. */
  it('출고 기한 고지가 배송·반품 정책과 같은 문장이다', () => {
    const html = render();
    const shippingSection = html.slice(
      html.indexOf('pdp-shipping-heading'),
      html.indexOf('pdp-return-heading'),
    );

    expect(html).toContain(SHIPPING_PERIOD_NOTICE);
    expect(shippingSection).toContain(SHIPPING_PERIOD_NOTICE);
    expect(shippingSection).not.toContain('영업일 기준');
  });
  it('예약 옵션의 발송 예정일을 배송 안내에도 표시해 일반 출고 기한과 혼동하지 않는다', () => {
    const html = render({ good: { ...detail.good, options: [{ id: '00000000-0000-4000-8000-000000000485',
      name: '10월 예약', attributes: {}, code: 'TEST-485', isDefault: true, price: detail.good.price, stockQty: 5,
      supply: { mode: 'preorder', state: 'open', policyId: '00000000-0000-4000-8000-000000000486', policyRevision: 1,
        availableQty: 5, startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-09-30T00:00:00Z',
        expectedShipDate: '2026-10-10', calculatedAt: '2026-09-10T00:00:00Z', nextChangeAt: '2026-09-30T00:00:00Z' } }] } });
    const section = html.slice(html.indexOf('pdp-shipping-heading'), html.indexOf('pdp-return-heading'));
    expect(section).toContain('2026년 10월 10일 발송 예정');
    expect(section).toContain('같은 출고지');
    expect(section).not.toContain(SHIPPING_PERIOD_NOTICE);
  });

  /* 요약만으로는 반송비 부담·반품 절차·환급 기한을 확인할 수 없다. 전문으로 가는 길이 있어야 한다. */
  it('교환·반품 안내에서 배송·반품 정책 전문으로 갈 수 있다', () => {
    const html = render();

    expect(html).toContain('href="/legal/shipping"');
    expect(html).toContain('배송·반품 정책 전문 보기');
  });

  it('IP 카드에서 온라인 팝업 화면으로 간다', () => {
    const html = render();

    expect(html).toContain('홍실 퀘스트');
    expect(html).toContain('href="/ip/hong-sil-quest"');
    expect(html).toContain('온라인 팝업 보러가기');
  });

  /* PD-09 — 텍스트 한 줄이던 칩이 446×82 카드가 됐다. 키아트가 이미지일 때만 150×80 칸을 둔다. */
  it('IP 카드는 IP 이름과 보러가기를 담은 카드 링크이고 키아트가 이미지일 때만 그림 칸을 둔다', () => {
    const text = render();
    const card = text.match(/<a class="wc-pdp-ipcard is-text" href="\/ip\/hong-sil-quest">.*?<\/a>/)?.[0] ?? '';
    expect(card).toContain('<strong class="wc-pdp-ipcard__name">홍실 퀘스트</strong>');
    expect(card).toContain('온라인 팝업 보러가기 <span aria-hidden="true">›</span>');
    expect(card).not.toContain('wc-pdp-ipcard__art');

    const art = 'url("https://cdn.example/hong-sil-key.webp") center / cover no-repeat';
    const withArt = render({ ip: { ...ip, bg: art } });
    expect(withArt).toMatch(/<a class="wc-pdp-ipcard" href="\/ip\/hong-sil-quest"><span aria-hidden="true" class="wc-pdp-ipcard__art" style="background:url\(&quot;https:\/\/cdn\.example\/hong-sil-key\.webp&quot;\) center \/ cover no-repeat"><\/span>/);
  });

  /* PD-19 — 상세 이미지 다음에 IP 소개, 패널 끝에 같은 IP 카드. 데이터는 IP 에 있는 값만 쓴다. */
  it('상세 설명 패널에 상세 이미지 다음 IP 소개를, 패널 끝에 IP 카드를 둔다', () => {
    const html = render();
    const panel = html.slice(html.indexOf('id="pdp-panel-detail"'), html.indexOf('id="pdp-panel-reviews"'));

    expect(panel).toContain('id="pdp-ip-story-heading">IP 소개</h2>');
    expect(panel).toContain('<h3 class="wc-pdp-ip-story__name">홍실 퀘스트</h3>');
    expect(panel).toContain('붉은 실을 따라 시작되는 특별한 퀘스트');
    expect(panel).toContain('홍실 퀘스트 컬렉션');
    expect(panel.indexOf('wc-pdp-panel__image')).toBeLessThan(panel.indexOf('pdp-ip-story-heading'));
    expect(panel).toContain('<a class="wc-pdp-ipcard is-text wc-pdp-ipcard--panel" href="/ip/hong-sil-quest">');
    /* 소개 문장도 키아트도 없는 IP 는 이름만 남은 빈 블록을 그리지 않는다. */
    expect(render({ ip: { ...ip, tagline: '', synopsis: ' ' } })).not.toContain('pdp-ip-story-heading');
  });

  /* PD-16b(LD-6) — 추천 블록은 탭 위가 아니라 상세 설명 패널 맨 끝이다. 다른 구성·띠배너는 제자리다. */
  it('연관 굿즈와 자동 추천을 상세 설명 패널 맨 끝에 둔다', () => {
    const relatedGoods = { nextChangeAt: null, groups: [{ id: 'group-a', kind: 'similar' as const, title: '유사한 굿즈',
      goods: [{ id: 'good-b', name: '연관 굿즈', ip: 'hong-sil-quest', type: '문구', price: 3000, badge: null, img: '', stock: 'ok' as const, stockQty: 5 }] }] };
    const html = renderToStaticMarkup(
      <GoodDetail automaticRecommendations={<p>auto-recommendation-marker</p>} detail={{ ...detail, relatedGoods }} otherCompositions={<p>other-composition-marker</p>} />,
    );
    const panel = html.slice(html.indexOf('id="pdp-panel-detail"'), html.indexOf('id="pdp-panel-reviews"'));

    expect(html.indexOf('유사한 굿즈')).toBeGreaterThan(html.indexOf('role="tablist"'));
    expect(panel).toContain('유사한 굿즈');
    expect(panel).toContain('auto-recommendation-marker');
    expect(panel.indexOf('wc-pdp-ipcard--panel')).toBeLessThan(panel.indexOf('유사한 굿즈'));
    expect(panel.indexOf('유사한 굿즈')).toBeLessThan(panel.indexOf('auto-recommendation-marker'));
    expect(html.indexOf('other-composition-marker')).toBeLessThan(html.indexOf('role="tablist"'));
  });

  it('IP 주소를 바꾼 뒤 IP 카드 링크는 새 주소로 직접 간다', () => {
    const html = render({ ip: { ...detail.ip!, publicSlug: 'new-hong-sil' } });
    expect(html).toContain('href="/ip/new-hong-sil"');
    expect(html).not.toContain('href="/ip/hong-sil-quest"');
  });

  it('상품 문의 진입점을 유지한다', () => {
    expect(render()).toContain('href="/my/inquiries/new?category=good&amp;goodId=g13"');
  });

  it('고시정보가 비면 빈 표 대신 이유를 적는다', () => {
    const html = render({ notice: EMPTY_GOODS_NOTICE });

    expect(html).toContain('아직 등록된 고시정보가 없습니다.');
    expect(html).not.toContain('wc-pdp-notice__table');
  });

  /* #173 완료 조건 — 홍실 3종의 상세페이지가 정상 렌더된다. */
  it.each(['g13', 'g14', 'g15'])('renders the Hong Sil Quest good %s', (goodId) => {
    const hongSil = DATA.GOODS.find((item) => item.id === goodId);
    expect(hongSil).toBeDefined();

    const html = renderToStaticMarkup(
      <GoodDetail detail={{ ...detail, good: hongSil!, gallery: [], detailImageUrl: null }} />,
    );

    expect(html).toContain(hongSil!.name);
    expect(html).toContain('고시정보');
    expect(html).toContain('교환 · 반품 안내');
  });

  /* #184 어드민 미리보기 — 같은 마크업이되 실제로 담기거나 찜하지 않는다. */
  it('embedded 미리보기는 인터랙티브 컨트롤을 비활성으로 그린다', () => {
    const html = renderToStaticMarkup(<GoodDetailView detail={detail} embedded />);

    expect(html).toContain('wc-pdp is-embedded');
    expect(html).not.toContain('<main');
    expect(html).toContain('data-disabled="true"');
    expect(html).toMatch(/class="wc-btn wc-buy-panel__cart" disabled=""/);
    expect(html).toMatch(/class="wc-btn primary wc-buy-panel__buy" disabled=""/);
    /* 고정 바가 어드민 콘솔 하단을 덮으면 미리보기가 아니라 방해물이 된다. */
    expect(html).not.toContain('class="wc-buybar"');
    expect(html).not.toContain('wc-buybar-mini');
    expect(html).not.toContain('wc-pdp-rail');
    expect(html).not.toContain('data-rail-box');
  });

  it('리뷰 슬롯이 없으면 리뷰 탭이 빈 이유를 적는다', () => {
    const html = renderToStaticMarkup(<GoodDetailView detail={detail} embedded />);

    expect(html).toContain('아직 등록된 리뷰가 없습니다.');
    expect(html).toContain('>리뷰<');
  });

  it('Q&A 슬롯이 없으면 Q&A 탭이 빈 이유를 적는다', () => {
    const html = renderToStaticMarkup(<GoodDetailView detail={detail} embedded />);

    expect(html).toContain('아직 등록된 질문이 없습니다.');
    expect(html).toContain('>Q&amp;A<');
  });
});


describe('출고지 배송 정책 표시', () => {
  it('DB 정책 금액과 상품별 유형을 표시하고 누락 시 금액을 추정하지 않는다', () => {
    const policy = {originId:'gimpo',originName:'김포',baseFee:4700,freeThreshold:62000,feeType:'policy' as const,individualFee:2500};
    expect(renderToStaticMarkup(<GoodDetailView detail={detail} shippingPolicy={policy} />)).toContain('4,700');
    expect(renderToStaticMarkup(<GoodDetailView detail={detail} shippingPolicy={{...policy,feeType:'individual'}} />)).toContain('굿즈당 1회');
    expect(renderToStaticMarkup(<GoodDetailView detail={detail} shippingPolicy={{...policy,feeType:'free'}} />)).toContain('무료배송');
    expect(renderToStaticMarkup(<GoodDetailView detail={detail} />)).toContain('배송 정책을 확인하지 못했습니다');
  });
});
