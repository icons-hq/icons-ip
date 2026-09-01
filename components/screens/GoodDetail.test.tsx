import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DATA, type Good, type Ip } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { EMPTY_GOODS_NOTICE } from '@/lib/goods-notice';
import { getLegalDocument } from '@/lib/legal/documents';
import type { ReviewRatingSummary } from '@/lib/reviews';
import { GoodDetail, GoodDetailView, pdpDefaultPanelId } from './GoodDetail';

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

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/g13',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
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
  RestockCta: ({ disabled, goodId, initialRequested }: {
    className?: string;
    disabled?: boolean;
    goodId: string;
    initialRequested: boolean;
  }) => (
    <button
      className="wc-restock-cta"
      data-disabled={disabled ? 'true' : 'false'}
      data-good={goodId}
      data-requested={initialRequested ? 'true' : 'false'}
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

  it('갤러리를 scroll-snap 스테이지와 도트·썸네일로 그린다', () => {
    const html = render();

    expect(html).toContain('wc-pdp-gallery__stage');
    expect(html).toContain('wc-pdp-gallery__dot');
    expect(html).toContain('wc-pdp-gallery__thumb');
    expect(html).toContain('aria-label="1번째 이미지"');
    expect(html).toContain('aria-label="3번째 이미지"');
    expect(html).toContain('https://cdn.example/g13-1.webp');
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
  it('품절이면 CTA가 재입고 알림으로 교체된다', () => {
    const html = render({ good: { ...good, stock: 'soldout', stockQty: 0 } });

    expect(html).toContain('재입고 알림 받기');
    expect(html).toContain('data-good="g13"');
    expect(html).toContain('>품절<');
    expect(html).toContain('총 금액');
    expect(html).not.toContain('wc-buy-panel__ctas');
    expect(html).not.toContain('>구매하기<');
  });

  it('위시 하트에 현재 찜 상태를 넘긴다', () => {
    const wished = renderToStaticMarkup(
      <GoodDetail detail={detail} engagement={{ restockRequested: false, wished: true }} />,
    );

    expect(wished).toContain('wc-pdp-tools');
    expect(wished).toContain('data-wished="true"');
    expect(render()).toContain('data-wished="false"');
  });

  it('고정 구매바 2종을 함께 둔다', () => {
    const html = render();

    expect(html).toContain('class="wc-buybar"');
    expect(html).toContain('wc-buybar-mini');
    expect(html).toContain('aria-label="장바구니에 담기"');
    /* 미니 바는 하부 탭이 보이기 전까지 화면과 보조기기 양쪽에서 없다. */
    expect(html).toMatch(/class="wc-buybar-mini"[^>]*hidden/);
  });

  it('하부를 패널 전환 탭으로 나눈다', () => {
    const html = render();

    expect(html).toContain('wc-pdp-tabs');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="pdp-tab-detail"');
    expect(html).toContain('id="pdp-panel-reviews"');
    expect(html).toContain('>상세정보<');
    expect(html).toContain('>리뷰 (3)<');
    expect(html).toContain('>배송·교환 안내<');
    expect(html).toContain('리뷰 본문 슬롯');
  });

  /* 상품 Q&A(#330)는 리뷰와 배송 안내 사이다 — 구매 전 질문은 후기 다음, 정책 앞에서
     읽힌다. 본문은 리뷰와 같은 이유로 서버가 그린 slot 이다. */
  it('리뷰와 배송 안내 사이에 Q&A 탭을 둔다', () => {
    const html = render();

    expect(html).toContain('id="pdp-panel-qna"');
    expect(html).toContain('>Q&amp;A (2)<');
    expect(html).toContain('Q&amp;A 본문 슬롯');
    expect(html.indexOf('id="pdp-tab-qna"')).toBeGreaterThan(html.indexOf('id="pdp-tab-reviews"'));
    expect(html.indexOf('id="pdp-tab-shipping"')).toBeGreaterThan(html.indexOf('id="pdp-tab-qna"'));
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

  it('고시정보 표와 배송·교환 안내를 패널에 싣는다', () => {
    const html = render();

    expect(html).toContain('고시정보');
    expect(html).toContain('제조사 / 수입사');
    expect(html).toContain('주식회사 아이콘스');
    expect(html).toContain('A/S 연락처');
    expect(html).toContain('배송 안내');
    expect(html).toContain('배송비 3,000원 · 50,000원 이상 구매 시 무료');
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

  /* 요약만으로는 반송비 부담·반품 절차·환급 기한을 확인할 수 없다. 전문으로 가는 길이 있어야 한다. */
  it('교환·반품 안내에서 배송·반품 정책 전문으로 갈 수 있다', () => {
    const html = render();

    expect(html).toContain('href="/legal/shipping"');
    expect(html).toContain('배송·반품 정책 전문 보기');
  });

  it('IP 칩에서 브랜드 화면으로 간다', () => {
    const html = render();

    expect(html).toContain('홍실 퀘스트');
    expect(html).toContain('href="/ip/hong-sil-quest"');
    expect(html).toContain('브랜드 보러가기');
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
