import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { Ip } from '@/lib/data';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { GOOD_BADGES, GOOD_TYPES } from '@/lib/goods-taxonomy';
import { GoodSection } from './GoodSection';

vi.mock('@/app/admin/actions', () => ({
  adjustAdminStockAction: vi.fn(),
}));
vi.mock('@/components/ui/Icon', () => ({
  Icon: () => null,
}));
vi.mock('../../../app/admin/archive-actions', () => ({
  archiveAdminCatalogRecordAction: vi.fn(),
  unarchiveAdminCatalogRecordAction: vi.fn(),
}));
vi.mock('../../../app/admin/good-bank-transfer-actions', () => ({
  setGoodBankTransferAction: vi.fn(),
}));
vi.mock('../../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));
/* 미리보기는 공개 상세 화면(구매 패널·위시 하트)을 그대로 그린다 — 그 클라이언트 훅들은
   앱 라우터와 카트 컨텍스트를 요구한다. 여기서 확인하려는 것은 어드민 폼과 미리보기의
   배선이지 그 훅들의 동작이 아니다. */
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({
    items: [],
    count: 0,
    ready: true,
    mode: 'server' as const,
    pending: false,
    error: null,
    getQuantity: () => 0,
    add: vi.fn(),
    setQuantity: vi.fn(),
    remove: vi.fn(),
    refresh: vi.fn(),
    resetForSignOut: vi.fn(),
  }),
}));

const hwasan: Ip = {
  id: 'hwasan',
  title: '화산강림',
  sub: 'ORIGINAL IP',
  v: { key: 'webtoon', label: '웹툰', color: '#38F0C0' },
  glyph: '火',
  bg: 'linear-gradient(#111, #222)',
  fans: 0,
  goods: 1,
  cards: 0,
  featured: false,
  tagline: '불꽃처럼',
  synopsis: '화산강림 세계관',
};

const good: AdminGoodRecord = {
  id: 'g100',
  archivedAt: null,
  ipId: 'hwasan',
  name: '화산강림 아크릴 스탠드',
  type: '아크릴',
  price: 22000,
  compareAtPrice: 26000,
  badge: 'NEW',
  stock: 'low',
  stockQty: 12,
  allowBankTransfer: true,
  bg: null,
  imagePath: null,
  notice: {
    maker: '주식회사 아이콘스',
    origin: '대한민국',
    material: '아크릴',
    size: '80 x 60 x 20mm · 90g',
    madeOn: '2026-07',
    asManager: '아이콘스 고객센터',
    asContact: '02-000-0000',
  },
  description: '붉은 실을 따라 놓인 아크릴 블록입니다.',
  galleryPaths: ['public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp'],
  galleryUrls: ['https://cdn.example/catalog/good/gallery-1.webp'],
  detailImagePath: 'public-media/catalog/good/44444444-4444-4444-8444-444444444444.webp',
  detailImageUrl: 'https://cdn.example/catalog/good/detail.webp',
};

function renderGoodSection(
  selected: AdminGoodRecord | null,
  state: Parameters<typeof GoodSection>[0]['state'] = {},
) {
  return renderToStaticMarkup(
    <GoodSection
      action={vi.fn()}
      adjustmentId="11111111-1111-4111-8111-111111111111"
      catalogIps={[hwasan]}
      ipOptions={[{ id: 'hwasan', title: '화산강림', archivedAt: null }]}
      onSelect={vi.fn()}
      pending={false}
      records={selected ? [selected] : [good]}
      selected={selected}
      state={state}
    />,
  );
}

describe('GoodSection', () => {
  it('shows current inventory and a separate delta form for an existing good', () => {
    const html = renderGoodSection(good);

    expect(html).toContain('현재 실재고');
    expect(html).toContain('12개');
    expect(html).toContain('유효 표시 상태');
    expect(html).toContain('low');
    expect(html).toContain('name="delta"');
    expect(html).toContain('name="reason"');
    expect(html).toContain('class="admin-field-control"');
    expect(html).toContain('required=""');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('name="adjustmentId"');
    expect(html).toContain('name="expectedStockQty"');
    expect(html).toContain('재고 조정');
    /* 저장 · 재고 조정 · 무통장 토글(#256) · 보관 네 개다. */
    expect(html.match(/<form/g)).toHaveLength(4);
  });

  it('derives soldout for zero quantity without changing the raw stock label', () => {
    const html = renderGoodSection({ ...good, stock: 'ok', stockQty: 0 });

    expect(html).toContain('운영 상태 ok');
    expect(html).toContain('유효 표시 상태 soldout');
  });

  it('does not expose inventory adjustment controls while creating a new good', () => {
    const html = renderGoodSection(null);

    expect(html).not.toContain('현재 실재고');
    expect(html).not.toContain('name="delta"');
    expect(html).not.toContain('name="reason"');
    expect(html).not.toContain('재고 조정');
    expect(html.match(/<form/g)).toHaveLength(1);
  });

  it('uses the shared artwork upload field', () => {
    const html = renderGoodSection(good);

    expect(html).toContain('data-artwork-kind="good"');
    expect(html).toContain('name="imagePath"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
  });

  it('shows archive status and hides stock adjustment until an archived good is restored', () => {
    const archived = { ...good, archivedAt: '2026-07-17T12:00:00.000Z' };
    const html = renderGoodSection(archived);

    expect(html).toContain('aria-label="보관 상태"');
    expect(html).toContain('[보관] g100 · 화산강림 아크릴 스탠드 · 12개');
    expect(html).toContain('보관 복원');
    expect(html).toContain('value="good"');
    expect(html).not.toContain('현재 실재고');
    expect(html).not.toContain('name="delta"');
    expect(html.match(/<form/g)).toHaveLength(2);
  });

  /* #171 — 고시정보는 라벨 붙은 고정 입력이다. 자유 텍스트 한 칸이 아니다. */
  it('renders every goods notice item as a labelled required input', () => {
    const html = renderGoodSection(null);

    expect(html).toContain('고시정보 (전자상거래 필수 표기)');
    for (const field of GOODS_NOTICE_FIELDS) {
      expect(html).toContain(`name="${field.formName}"`);
      expect(html).toContain(field.label);
    }
  });

  it('prefills the selected good notice values and surfaces per-field errors', () => {
    const html = renderGoodSection(good, {
      errors: { noticeOrigin: '고시정보 필수 항목입니다.' },
    });

    expect(html).toContain('value="주식회사 아이콘스"');
    expect(html).toContain('value="02-000-0000"');
    expect(html).toContain('id="noticeOrigin-error"');
    expect(html).toContain('고시정보 필수 항목입니다.');
  });

  /* #172 — 설명·갤러리 4슬롯·상세 이미지가 같은 업로드 칸을 재사용한다. */
  it('offers a description, four ordered gallery slots, and one detail image', () => {
    const html = renderGoodSection(null);

    expect(html).toMatch(/<textarea[^>]*name="description"/);
    expect(html).toContain('갤러리 (최대 4장)');
    for (const slot of [0, 1, 2, 3]) {
      expect(html).toContain(`name="galleryPath${slot}"`);
      expect(html).toContain(`갤러리 ${slot + 1}`);
    }
    expect(html).toContain('name="detailImagePath"');
    expect(html).toContain('상세 이미지');
    /* 이미지 제약은 공유 업로드 칸에서 그대로 따라온다. */
    expect(html.match(/accept="image\/jpeg,image\/png,image\/webp"/g)).toHaveLength(6);
    expect(html.match(/최대 5MB · 가로·세로 최대 8192px/g)).toHaveLength(6);
  });

  it('prefills gallery slots in stored order and keeps the detail image', () => {
    const html = renderGoodSection(good);

    expect(html).toContain('붉은 실을 따라 놓인 아크릴 블록입니다.');
    expect(html).toContain('value="public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp"');
    expect(html).toContain('src="https://cdn.example/catalog/good/gallery-1.webp"');
    expect(html).toContain('value="public-media/catalog/good/44444444-4444-4444-8444-444444444444.webp"');
    expect(html).toContain('src="https://cdn.example/catalog/good/detail.webp"');
  });

  /* #184 — 공개 화면 컴포넌트를 그대로 써서 목록 카드와 상세를 함께 보여준다. */
  it('renders the public shop card and detail screen as a preview', () => {
    const html = renderGoodSection(good);

    expect(html).toContain('공개 화면 미리보기');
    expect(html).toContain('굿즈샵 목록 카드');
    expect(html).toContain('굿즈 상세페이지');
    /* wc 토큰은 .wc-root 스코프 안에서만 산다 — 어드민 캔버스를 밝게 바꾸지 않는다. */
    expect(html).toContain('wc-root');
    expect(html).toContain('wc-product-card');
  });

  /* #326 — 정가는 카드 미리보기에서 취소선과 SALE 배지로 파생된다. */
  it('previews the sale price the way the shop card will render it', () => {
    const html = renderGoodSection(good);

    expect(html).toContain('₩26,000');
    expect(html).toContain('SALE');
    expect(html).toContain('NEW');
  });

  it('keeps the preview inert — no cart button and no extra form', () => {
    const html = renderGoodSection(good);

    expect(html).not.toContain('shop-cart-button');
    /* 저장 · 재고 조정 · 무통장 토글 · 보관 네 개 그대로다. 미리보기는 폼을 늘리지 않는다. */
    expect(html.match(/<form/g)).toHaveLength(4);
  });

  /* #326 — 유형·배지는 자유 입력이 아니라 표준 값 select 다(DB CHECK 와 같은 목록). */
  it('offers the standard type and badge options plus a compare-at price field', () => {
    const html = renderGoodSection(null);

    expect(html).toContain('name="compareAtPrice"');
    for (const type of GOOD_TYPES) expect(html).toContain(`<option value="${type}">`);
    for (const badge of GOOD_BADGES) expect(html).toContain(`<option value="${badge}">`);
    expect(html).toContain('없음');
  });

  it('previews the selected record values before any edit', () => {
    const html = renderGoodSection(good);

    expect(html).toContain('붉은 실을 따라 놓인 아크릴 블록입니다.');
    expect(html).toContain('https://cdn.example/catalog/good/gallery-1.webp');
    expect(html).toContain('02-000-0000');
  });

  it('surfaces a duplicated gallery image error next to its slot', () => {
    const html = renderGoodSection(good, {
      errors: { galleryPath1: '같은 이미지를 갤러리에 두 번 넣을 수 없습니다.' },
    });

    expect(html).toContain('id="galleryPath1-error"');
    expect(html).toContain('같은 이미지를 갤러리에 두 번 넣을 수 없습니다.');
  });
});
