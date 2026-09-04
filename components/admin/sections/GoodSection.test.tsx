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
  options: { copyHref?: string | null; template?: AdminGoodRecord | null } = {},
) {
  return renderToStaticMarkup(
    <GoodSection
      action={vi.fn()}
      adjustmentId="11111111-1111-4111-8111-111111111111"
      catalogIps={[hwasan]}
      copyHref={options.copyHref ?? null}
      ipOptions={[{ id: 'hwasan', title: '화산강림', archivedAt: null }]}
      listHref="/admin/catalog/goods?tab=low&page=2"
      pending={false}
      selected={selected}
      state={state}
      template={options.template ?? null}
    />,
  );
}

describe('GoodSection', () => {
  /* 복사해서 등록 — 새 ID만 비우고 나머지를 옮긴다. 이미지·재고·무통장은 옮기지 않는다. */
  it('opens a copy as a new registration with everything but the id, images, and stock', () => {
    const html = renderGoodSection(null, {}, { template: good });

    expect(html).toContain('새 굿즈 등록 · g100 복사');
    expect(html).toContain('복사한 새 등록입니다');
    expect(html).toMatch(/<input[^>]*name="id"[^>]*value=""/);
    expect(html).not.toMatch(/<input[^>]*name="id"[^>]*readOnly/);
    expect(html).toContain('value="화산강림 아크릴 스탠드"');
    expect(html).toContain('value="22000"');
    expect(html).toContain('value="주식회사 아이콘스"');
    expect(html).toContain('붉은 실을 따라 놓인 아크릴 블록입니다.');
    expect(html).toContain('name="initialStockQty"');
    expect(html).not.toContain('src="https://cdn.example/catalog/good/gallery-1.webp"');
    expect(html).not.toContain('현재 실재고');
    expect(html).toContain('<input type="hidden" name="previousId" value=""/>');
    expect(html.match(/<form/g)).toHaveLength(1);
  });

  it('offers "copy as new" only from an existing good, through the given link', () => {
    const existing = renderGoodSection(good, {}, { copyHref: '/admin/catalog/goods?tab=low&selected=new&copyFrom=g100' });
    const creating = renderGoodSection(null, {}, { copyHref: '/admin/catalog/goods?selected=new&copyFrom=g100' });

    expect(existing).toContain('href="/admin/catalog/goods?tab=low&amp;selected=new&amp;copyFrom=g100"');
    expect(existing).toContain('복사해서 등록');
    expect(creating).not.toContain('복사해서 등록');
  });

  /* 임시 저장은 브라우저에서만 산다 — 서버 렌더에는 배너도 상태 표시도 없다. */
  it('renders no draft banner or draft status on the server', () => {
    const html = renderGoodSection(null);

    expect(html).not.toContain('임시 저장본');
    expect(html).not.toContain('브라우저에 임시 저장됨');
  });

  /* 목록은 GoodConsole 이 맡는다 — 편집 화면은 머리에 목록 링크와 대상만 쓴다. */
  it('heads the editor with a back-to-list link that keeps the list conditions', () => {
    const existing = renderGoodSection(good);
    const creating = renderGoodSection(null);

    expect(existing).toContain('href="/admin/catalog/goods?tab=low&amp;page=2"');
    expect(existing).toContain('← 목록으로');
    expect(existing).toContain('g100 · 화산강림 아크릴 스탠드 · 12개');
    expect(creating).toContain('새 굿즈 등록');
    expect(creating).not.toContain('aria-label="보관 상태"');
  });

  /* 등록 시 초기 재고는 신규 폼에만 있고, 실재고 조정 폼과는 다른 칸이다. */
  it('offers an initial stock quantity only while creating, wired to the server-made idempotency key', () => {
    const creating = renderGoodSection(null);
    const existing = renderGoodSection(good);

    expect(creating).toContain('name="initialStockQty"');
    expect(creating).toContain('name="initialStockAdjustmentId"');
    expect(creating).toContain('value="11111111-1111-4111-8111-111111111111"');
    expect(creating).toContain('초기 재고 수량');
    expect(existing).not.toContain('name="initialStockQty"');
    expect(existing).not.toContain('name="initialStockAdjustmentId"');
  });

  it('re-seeds the initial stock quantity and shows its error after a failed save', () => {
    const html = renderGoodSection(null, {
      errors: { initialStockQty: '초기 재고는 0 이상의 정수여야 합니다.' },
      values: { initialStockQty: '-3' },
    });

    expect(html).toContain('id="initialStockQty-error"');
    expect(html).toContain('value="-3"');
  });

  /* 고시정보 프리셋 바 — 저장은 브라우저에만 하고 폼 필드 수는 늘리지 않는다. */
  it('renders the goods notice preset bar without adding form fields', () => {
    const html = renderGoodSection(null);

    expect(html).toContain('aria-label="고시정보 프리셋"');
    expect(html).toContain('저장된 프리셋 없음');
    expect(html).toContain('현재 값 저장');
    expect(html).toContain('이 브라우저에만 저장됩니다.');
    expect(html).not.toMatch(/<input[^>]*name="presetName"/);
    expect(html.match(/<form/g)).toHaveLength(1);
  });

  /* 탭 7 (설계서 4-3) — 화면 정리일 뿐 폼은 하나다. 안 보이는 패널도 값을 제출한다. */
  it('lays the form out in seven tabs while keeping every field inside the single form', () => {
    const html = renderGoodSection(null);

    /* 공개 상세 미리보기에도 탭이 있다 — 어드민 탭만 센다. */
    expect(html.match(/class="admin-form-tab"/g)).toHaveLength(7);
    expect(html.match(/class="admin-form-tabpanel col"/g)).toHaveLength(7);
    expect(html).toMatch(/aria-selected="true"[^>]*>① 기본/);
    expect(html.match(/class="admin-form-tabpanel col" hidden=""/g)).toHaveLength(6);
    /* 숨은 탭의 required 칸이 브라우저 검증에 막히지 않게 폼은 noValidate 다(검사는 제출 핸들러가 한다). */
    expect(html).toMatch(/<form[^>]*noValidate=""/);
    for (const name of ['id', 'ipId', 'name', 'price', 'compareAtPrice', 'initialStockQty', 'imagePath', 'noticeMaker', 'description']) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html.match(/<form/g)).toHaveLength(1);
  });

  it('opens the tab that holds the first field error and counts errors per tab', () => {
    const html = renderGoodSection(null, {
      errors: { price: '가격을 확인해주세요.', noticeMaker: '고시정보 필수 항목입니다.', noticeOrigin: '고시정보 필수 항목입니다.' },
    });

    expect(html).toMatch(/aria-selected="true"[^>]*>② 판매/);
    expect(html).not.toMatch(/aria-selected="true"[^>]*>① 기본/);
    expect(html).toContain('aria-label="오류 1건"');
    expect(html).toContain('aria-label="오류 2건"');
  });

  /* 자리표시는 name 없이 disabled — 제출값에 섞이지 않고 필요한 데이터 층을 말한다. */
  it('renders shipping, stock-table, and exposure placeholders disabled and unnamed', () => {
    const html = renderGoodSection(good);

    expect(html).toContain('D-2 배송 정책 · D-1 출고지');
    expect(html).toContain('₩50,000');
    expect(html).toContain('김포 (기본)');
    /* 기존 굿즈의 품목 표는 저장 폼 밖 「품목 · 재고」 카드가 맡는다 — 자리표시는 새 등록에서만 뜬다. */
    expect(html).not.toContain('품목 표 · 자리표시');
    expect(html).toContain('품목 · 재고');
    expect(renderGoodSection(null)).toContain('품목 표 · 자리표시');
    expect(html).toContain('노출 상태');
    expect(html).toContain('메인 큐레이션 연결');
    expect(html).not.toMatch(/<(input|select)[^>]*disabled=""[^>]*name=/);
    expect(html).not.toMatch(/<(input|select)[^>]*name=[^>]*disabled=""/);
  });

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

  it('renders the variant table and per-slot stock forms when the variant editor data is present', () => {
    const editor = {
      goodId: good.id,
      defaultLocationId: 'gimpo',
      stockOverride: 'auto',
      options: [],
      masters: [{
        id: '11111111-1111-4111-8111-111111111111', code: 'O0001', name: '색상', displayStyle: 'select', sortOrder: 1, archivedAt: null,
        values: [{ id: '11111111-1111-4111-8111-aaaaaaaaaaaa', value: '빨강', sortOrder: 1, archivedAt: null }],
      }],
      variants: [{
        id: '22222222-2222-4222-8222-222222222222', code: 'g100-01', customCode: null, signature: '', isDefault: true, additionalPrice: 0,
        display: true, sellable: true, locationId: null, imagePath: null, sortOrder: 0, archivedAt: null, values: {},
        stocks: [
          { locationId: 'gimpo', onHand: 12, reserved: 0, safety: 0, lastSource: 'migration', lastMovementAt: null, countedAt: null },
          { locationId: 'namyangju', onHand: 0, reserved: 0, safety: 0, lastSource: 'migration', lastMovementAt: null, countedAt: null },
        ],
      }],
      locations: [
        { id: 'gimpo', name: '김포', contact: null, erpWarehouseCode: null, defaultCarrierCode: null, isDefault: true, active: true, sortOrder: 1 },
        { id: 'namyangju', name: '남양주', contact: null, erpWarehouseCode: null, defaultCarrierCode: null, isDefault: false, active: true, sortOrder: 2 },
      ],
    };
    const html = renderToStaticMarkup(
      <GoodSection
        action={() => undefined}
        adjustmentId="00000000-0000-4000-8000-000000000001"
        catalogIps={[hwasan]}
        ipOptions={[{ id: 'hwasan', title: '화산강림', archivedAt: null }]}
        listHref="/admin/catalog/goods"
        pending={false}
        selected={good}
        state={{}}
        variantBatchId="00000000-0000-4000-8000-000000000002"
        variantEditor={editor}
      />,
    );

    expect(html).toContain('품목 · 재고');
    expect(html).toContain('기본 품목 (옵션 없음)');
    expect(html).toContain('name="payload"');
    expect(html).toContain('name="batchId"');
    /* 상품 단위 조정 칸(expectedStockQty)은 사라지고 품목 × 출고지 조정 칸이 선다. */
    expect(html).not.toContain('name="expectedStockQty"');
    expect(html).toContain('name="expectedOnHand"');
    expect(html).toContain('name="reasonCode"');
    expect(html).toContain('name="toLocationId"');
    expect(html).toContain('name="safetyQty"');
    expect(html).toContain('12 / 0 / 0');
    /* 저장 · 품목 저장 · 재고 조정 · 재고 이동 · 안전재고 · 무통장 · 보관 = 7 */
    expect(html.match(/<form/g)).toHaveLength(7);
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
