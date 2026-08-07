import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DATA, type Good, type Ip } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { EMPTY_GOODS_NOTICE } from '@/lib/goods-notice';
import { GoodDetail, GoodDetailView } from './GoodDetail';

const cart = vi.hoisted(() => ({
  add: vi.fn(),
  getQuantity: vi.fn(() => 0),
  pending: false,
  ready: true,
}));

vi.mock('@/components/shell/CartProvider', () => ({ useCart: () => cart }));

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
  type: '아크릴 블록',
  price: 12000,
  badge: '신상',
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

function render(overrides: Partial<GoodDetailContent> = {}) {
  return renderToStaticMarkup(<GoodDetail detail={{ ...detail, ...overrides }} />);
}

describe('GoodDetail', () => {
  it('renders the good identity, price, stock badge and cart action', () => {
    const html = render();

    expect(html).toContain('goods-detail-page');
    expect(html).toContain('아크릴 블록');
    expect(html).toContain('홍실 퀘스트');
    expect(html).toContain('₩12,000');
    expect(html).toContain('판매 중');
    expect(html).toContain('신상');
    expect(html).toContain('장바구니에 한 개 담기');
  });

  it('shows the gallery as selectable frames after the main artwork', () => {
    const html = render();

    expect(html).toContain('aria-label="굿즈 이미지"');
    expect(html).toContain('aria-label="대표 이미지"');
    expect(html).toContain('aria-label="갤러리 이미지 1"');
    expect(html).toContain('aria-label="갤러리 이미지 2"');
    expect(html).toContain('https://cdn.example/g13-1.webp');
  });

  /* #172 완료 조건 — 갤러리가 비어도 대표 이미지로 정상 렌더된다. */
  it('renders with the main artwork alone when the gallery is empty', () => {
    const html = render({ gallery: [], detailImageUrl: null });

    expect(html).toContain('https://cdn.example/g13.webp');
    expect(html).not.toContain('aria-label="굿즈 이미지"');
    expect(html).not.toContain('상세 이미지');
  });

  it('renders the description and the long detail image', () => {
    const html = render();

    expect(html).toContain('붉은 실을 따라 놓인 아크릴 블록입니다.');
    expect(html).toContain('goods-detail-long-image');
    expect(html).toContain('src="https://cdn.example/g13-detail.webp"');
  });

  it('renders the goods notice table, shipping and return guidance', () => {
    const html = render();

    expect(html).toContain('상품정보제공고시');
    expect(html).toContain('제조사 / 수입사');
    expect(html).toContain('주식회사 아이콘스');
    expect(html).toContain('A/S 연락처');
    expect(html).toContain('배송 안내');
    expect(html).toContain('배송비 3,000원 · 50,000원 이상 구매 시 무료');
    expect(html).toContain('교환 · 반품 안내');
    expect(html).toContain('7일 이내');
  });

  /* 요약만으로는 반송비 부담·반품 절차·환급 기한을 확인할 수 없다. 전문으로 가는 길이 있어야 한다. */
  it('교환·반품 안내에서 배송·반품 정책 전문으로 갈 수 있다', () => {
    const html = render();

    expect(html).toContain('href="/legal/shipping"');
    expect(html).toContain('배송·반품 정책 전문 보기');
  });

  it('explains a missing goods notice instead of rendering an empty table', () => {
    const html = render({ notice: EMPTY_GOODS_NOTICE });

    expect(html).toContain('아직 등록된 고시정보가 없습니다.');
    expect(html).not.toContain('goods-notice-table');
  });

  /* #173 완료 조건 — 품절 굿즈의 상세도 열리고 담기만 막힌다. */
  it('keeps a sold-out good browsable while blocking the cart action', () => {
    const html = renderToStaticMarkup(
      <GoodDetail detail={{ ...detail, good: { ...good, stock: 'soldout', stockQty: 0 } }} />,
    );

    expect(html).toContain('아크릴 블록');
    expect(html).toContain('상품정보제공고시');
    expect(html).toContain('>품절</button>');
    expect(html).toContain('disabled=""');
  });

  /* #173 완료 조건 — 홍실 3종의 상세페이지가 정상 렌더된다. */
  it.each(['g13', 'g14', 'g15'])('renders the Hong Sil Quest good %s', (goodId) => {
    const hongSil = DATA.GOODS.find((item) => item.id === goodId);
    expect(hongSil).toBeDefined();

    const html = renderToStaticMarkup(
      <GoodDetail detail={{ ...detail, good: hongSil!, gallery: [], detailImageUrl: null }} />,
    );

    expect(html).toContain(hongSil!.name);
    expect(html).toContain('상품정보제공고시');
    expect(html).toContain('교환 · 반품 안내');
  });

  /* #184 이 재사용할 순수 표시 경로 — 담기 자리를 slot 으로 대체할 수 있다. */
  it('accepts an inert cart action and can hide the back link', () => {
    const html = renderToStaticMarkup(
      <GoodDetailView
        cartAction={<span>미리보기</span>}
        detail={detail}
        showBackLink={false}
      />,
    );

    expect(html).toContain('미리보기');
    expect(html).not.toContain('← 굿즈샵');
  });
});
