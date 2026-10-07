import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { Ip } from '@/lib/data';
import { sanitizeGoodsDescription } from '@/lib/goods-description';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { GOOD_BADGES, GOOD_TYPES } from '@/lib/goods-taxonomy';
import { GoodSection } from './GoodSection';
import { GoodsKcTemplateProvider } from '../useGoodsKcTemplate';

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
vi.mock('../../../app/admin/good-sale-restriction-actions', () => ({
  setGoodSaleRestrictionAction: vi.fn(),
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
  code: 'HW-0100',
  publishedAt: '2026-09-08',
  firstPublishedAt: '2026-09-08T00:00:00Z',
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
  saleRestriction: 'none',
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
  options: Pick<Parameters<typeof GoodSection>[0],'initialQuery'|'initialIpId'|'variants'> = {},
) {
  return renderToStaticMarkup(
    <GoodsKcTemplateProvider selectionKey={selected ? `good:${selected.id}` : 'create:any'}>
    <GoodSection
      action={vi.fn()}
      adjustmentId="11111111-1111-4111-8111-111111111111"
      catalogIps={[hwasan]}
      ipOptions={[{ id: 'hwasan', title: '화산강림', archivedAt: null }]}
      onSelect={vi.fn()}
      pending={false}
      records={selected ? [selected] : [good]}
      selected={selected}
      variants={selected ? [{ id: '11111111-1111-4111-8111-111111111111', goodId: selected.id, name: '기본 옵션', code: 'HW-0100-01', price: selected.price, stockQty: selected.stockQty, isDefault: true, archivedAt: null }] : []}
      state={state}
      {...options}
    /></GoodsKcTemplateProvider>,
  );
}

describe('GoodSection', () => {
  it('keeps the task order and error links in the same authoring sequence', () => {
    const html = renderGoodSection(null, { errors: { maxOrderQty: '수량 오류', originId: '배송 오류', noticeMaker: '고시 오류', variants: '옵션 오류', price: '가격 오류', name: '이름 오류' } });
    const sections = ['basic', 'price', 'variants', 'notice', 'shipping', 'sale'];
    const positions = sections.map((key) => html.indexOf(`id="good-section-${key}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    const summary = html.slice(html.indexOf('aria-label="저장 오류 요약"')).split('</section>')[0];
    expect([...summary.matchAll(/href="#good-section-([a-z]+)"/g)].map((match) => match[1])).toEqual(sections);
  });

  it('shows all seven published identity locks without omitting their submitted values', () => {
    const html = renderGoodSection(good);
    for (const name of ['name', 'noticeMaker', 'noticeOrigin', 'noticeMaterial', 'noticeSize']) {
      expect(html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0]).toContain('readOnly');
    }
    for (const name of ['ipId', 'type']) {
      expect(html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>`))?.[0]).toContain('disabled');
      expect(html).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="${name}"`));
    }
    expect(html).toContain('초안으로 전환 후 수정');
  });

  it('저장 실패 후 HTML 원문·형식·업로드를 복구하고 제거 사유와 정리된 미리보기를 함께 보여준다', () => {
    const path = 'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp';
    const html = renderGoodSection(good, { attempt: 2, values: { previousId: good.id, descriptionFormat: 'html', description: '<h2>보존 제목</h2><p style="color:red">본문</p><img src="https://external.test/a.png"><img src="/relative.png">', descriptionUploadPath: path, descriptionImageAlt: '입력한 대체 설명' } });
    expect(html).toContain('<option value="html" selected="">');
    expect(html).toContain('&lt;h2&gt;보존 제목&lt;/h2&gt;');
    expect(html).toContain('<h2>보존 제목</h2><p>본문</p>');
    expect(html).toContain('CSS·이벤트 등 지원하지 않는 속성은 제거됩니다.');
    expect(html).toContain('주소를 확인할 수 없는 이미지는 제거됩니다.');
    expect(html).toContain('<img src="https://external.test/a.png" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />');
    expect(html).toContain(`value="${path}"`);
    expect(html).toContain('value="입력한 대체 설명"');
  });
  it('renders kit sections and restores failed uploaded paths, notice and invalid option values', () => {
    const html = renderGoodSection(null, { attempt: 1, values: { previousId: '', name: '실패 뒤 상품', noticeAsContact: '복사된 연락처', imagePath: 'public-media/catalog/good/failed.webp', variants: '[{"name":"보존 옵션","code":"MANUAL","attributes":{},"extraPrice":-1,"stockQty":5}]' } });
    expect(html).toContain('aria-label="기본 정보"');
    expect(html).toContain('aria-label="배송 정보"');
    expect(html).toContain('value="실패 뒤 상품"');
    expect(html).toContain('value="복사된 연락처"');
    expect(html).toContain('value="public-media/catalog/good/failed.webp"');
    expect(html).toContain('value="보존 옵션"');
    expect(html).toContain('value="-1"');
    /* 대표·추가 이미지는 한 그리드(자리별 hidden input)이고, 상세 HTML 이미지·긴 상세 이미지만 별도 업로드 칸이다. */
    expect(html.match(/data-auto-upload="true"/g)).toHaveLength(2);
    expect(html.match(/class="wc-admin-image-tile wc-admin-artwork-upload-field"/g)).toHaveLength(2);
    expect(html).toContain('최근 저장된 상품에서 복사');
    expect(html).toContain('프리셋 찾기');
  });
  it('초안 저장 영역은 KC 검토 전에 KC 맥락을 먼저 채우는 순서와 재검토 조건을 안내한다', () => {
    const order = '1. 기본 정보·유형·고시정보·옵션까지 입력해 초안 저장 → 2. KC 검토 → 3. 공개. KC 검토 뒤 상품명·유형·IP·고시정보(제조자·제조국·소재·크기)나 옵션 구성을 바꾸면 KC를 다시 검토합니다.';
    const draft = { ...good, publishedAt: null };
    for (const html of [renderGoodSection(null), renderGoodSection(draft)]) {
      const save = html.slice(html.indexOf('aria-label="기본 상품 저장"'));
      expect(save).toContain(order);
      expect(save).not.toContain('1. 초안 생성 → 2. KC 검토 → 3. 공개 요청');
    }
    expect(renderGoodSection(good)).not.toContain(order);
  });
  it('저장 후 공개가 KC에 막혀 초안으로만 저장되면 성공이 아니라 공개 보류로 알리고 KC 정보로 안내한다', () => {
    const draft = { ...good, publishedAt: null };
    const message = "초안으로 저장했습니다. 상품명·유형·IP·고시정보가 바뀌어 KC를 다시 검토해야 공개할 수 있습니다. KC 정보에서 다시 검토(KC 대상이 아니면 '상품 전체 KC 해당 없음')한 뒤 공개해주세요.";
    const html = renderGoodSection(draft, { message, kcPublishBlocked: true, savedGoodId: draft.id, attempt: 1 });
    const save = html.slice(html.indexOf('aria-label="기본 상품 저장"'));
    expect(save).toContain('초안 저장 완료 · 공개 보류');
    expect(save).not.toContain('기본 상품 저장 완료');
    const escaped = message.replaceAll("'", '&#x27;').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(save).toMatch(new RegExp(`role="alert"[^>]*>${escaped}`));
    expect(save).toMatch(/<a href="#good-operation-kc"[^>]*>KC 정보 열기<\/a>/);
    const saved = renderGoodSection(draft, { message: '상품을 저장했습니다.', savedGoodId: draft.id, attempt: 1 });
    expect(saved).toContain('기본 상품 저장 완료');
    expect(saved).not.toContain('공개 보류');
  });
  it('초안 저장은 브라우저 고시 필수 검증에 막히지 않고 공개 이미지 오류를 표시한다', () => {
    const html = renderGoodSection(null, { errors: { imagePath: '대표 이미지를 업로드한 뒤 공개해주세요.' } });
    expect(html).toContain('초안으로 저장');
    expect(html).toContain('저장 후 공개');
    expect(html).toContain('대표 이미지를 업로드한 뒤 공개해주세요.');
    const noticeInputs = html.match(/<input[^>]*name="notice[^"]*"[^>]*>/g) ?? [];
    expect(noticeInputs).toHaveLength(7);
    expect(noticeInputs.every(input => !input.includes('required='))).toBe(true);
  });
  it('상품코드 검색이 목록을 거르고 새 상품의 연결 IP가 미리 채워진다',()=>{
    const matching=renderGoodSection(null,{}, {initialQuery:'hw-0100',initialIpId:'hwasan'});
    expect(matching).toContain('HW-0100 · 화산강림 아크릴 스탠드 · 12개');
    expect(matching).toContain('<option value="hwasan" selected="">');
    expect(matching).not.toContain('일치하는 상품이 없습니다.');
    const empty=renderGoodSection(null,{}, {initialQuery:'없는 코드'});
    expect(empty).toContain('일치하는 상품이 없습니다.');
  });

  it('검색 키워드와 진열 순서를 편집하고 키워드로 기존 목록을 찾는다', () => {
    const record = { ...good, searchKeywords: ['여름 굿즈', 'KUMA'], displayOrder: 4 };
    const html = renderGoodSection(record, {}, { initialQuery: 'kuma' });

    expect(html).toContain('여름 굿즈');
    expect(html).toContain('name="searchKeywords"');
    expect(html).toContain('name="displayOrder"');
    expect(html).toContain('value="4"');
  });
  it('shows current inventory and a separate delta form for an existing good', () => {
    const html = renderGoodSection(good);

    expect(html).toContain('선택 옵션 재고');
    expect(html).toContain('12개');
    expect(html).toContain('low');
    expect(html).toContain('name="delta"');
    expect(html).toContain('name="reason"');
    expect(html).toContain('class="admin-field-control"');
    expect(html).toContain('required=""');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('name="adjustmentId"');
    expect(html).toContain('name="expectedStockQty"');
    expect(html).toContain('재고 조정');
    const stockForm = (html.match(/<form\b[\s\S]*?<\/form>/g) ?? []).find(form => form.includes('name="delta"'));
    expect(stockForm).toContain('name="reason"');
    expect(stockForm).not.toContain('name="saleRestriction"');
  });

  it('does not infer readiness when the server summary is unavailable, and preserves the raw stock label', () => {
    const html = renderGoodSection({ ...good, stock: 'ok', stockQty: 0 });

    expect(html).toContain('<option value="ok" selected="">');
    expect(html).toContain('판매 준비 정보를 확인하지 못했습니다.');
  });

  it('does not expose inventory adjustment controls while creating a new good', () => {
    const html = renderGoodSection(null);

    expect(html).not.toContain('현재 실재고');
    expect(html).not.toContain('name="delta"');
    expect(html).not.toContain('name="reason"');
    expect(html).not.toContain('id="good-operation-stock"');
    expect(html.match(/<form/g)).toHaveLength(1);
  });

  it('keeps the stored sale restriction in the same goods form as payment methods', () => {
    const html = renderGoodSection({ ...good, saleRestriction: 'adult' });

    expect(html).toContain('결제·구매 조건');
    expect(html).toContain('name="saleRestriction"');
    expect(html).toContain('name="allowCardPayment"');
    expect(html).toContain('성인(19금)');
    expect(html).toMatch(/<option[^>]*value="adult"[^>]*selected|<option[^>]*selected[^>]*value="adult"/);
    expect(html).toContain('성인인증을 도입하기 전까지 공개되지 않고 구매가 차단됩니다');
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
    expect(html).toContain('[보관] HW-0100 · 화산강림 아크릴 스탠드 · 12개');
    expect(html).toContain('보관 복원');
    expect(html).toContain('value="good"');
    expect(html).not.toContain('현재 실재고');
    expect(html).not.toContain('name="delta"');
    expect(html.match(/<form/g)).toHaveLength(3);
  });

  /* #171 — 고시정보는 라벨 붙은 고정 입력이다. 자유 텍스트 한 칸이 아니다. */
  it('renders every goods notice item as a labelled required input', () => {
    const html = renderGoodSection(null);

    expect(html).toContain('상품정보제공고시 (전자상거래 필수 표기)');
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
    const originControl = html.match(/<input[^>]*name="noticeOrigin"[^>]*>/)?.[0];
    const errorId = originControl?.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(errorId).toBeTruthy();
    expect(html).toContain(`id="${errorId}" role="alert"`);
    expect(html).toContain('고시정보 필수 항목입니다.');
  });

  /* #172 — 설명·추가 이미지 9칸(2026-10-07 4칸에서 확대)·상세 이미지가 같은 업로드 칸을 재사용한다. */
  /* 2026-10-07 MD 요청 — 대표 이미지·추가 이미지를 한 썸네일 그리드로, "슬롯"·잘림 예시 없이. */
  it('offers one image grid for the main and additional images, a description, and one detail image', () => {
    const html = renderGoodSection(null);

    expect(html).toMatch(/<textarea[^>]*name="description"/);
    expect(html).toContain('상품 이미지 · 대표 이미지 1장 + 추가 이미지 최대 9장');
    expect(html).toContain('1000×1000(1:1) 이미지를 권장합니다. 올린 원본 비율 그대로, 잘리지 않고 표시됩니다.');
    for (const name of ['imagePath', ...Array.from({ length: 9 }, (_, index) => `galleryPath${index}`)]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('aria-label="대표 이미지 추가"');
    expect(html).toContain('aria-label="이미지 추가 (추가 이미지, 여러 장 선택 가능)"');
    expect(html).not.toMatch(/슬롯|갤러리 \(최대|공개 화면 잘림 확인/);
    expect(html).toContain('상세페이지(상세 설명) 편집');
    expect(html).toContain('name="detailImagePath"');
    expect(html).toContain('상세 이미지');
    /* 이미지 제약은 공유 업로드 계약(ADMIN_ARTWORK_ACCEPT)을 그대로 따른다. */
    expect(html.match(/accept="image\/jpeg,image\/png,image\/webp"/g)).toHaveLength(4);
    /* 그리드 안내 1회 + HTML 이미지 업로드 자체 안내 1회 */
    expect(html.match(/최대 5MB · 가로·세로 최대 8192px/g)).toHaveLength(2);
  });

  /* 리뷰 재현: HTML 이미지 업로드가 그리드의 1:1(1000×1000) 권장을 설명으로 읽었다 — 긴 세로 상세 이미지에는 틀린 안내다. */
  it('HTML 이미지 업로드는 1:1 권장 대신 자기 파일 규격 안내만 설명으로 연결한다', () => {
    const html = renderGoodSection(null);
    const describedBy = (id: string) => html.match(new RegExp(`aria-describedby="(${id}[^"]*)"[^>]*class="admin-artwork-input"`))?.[1];

    expect(describedBy('good-description-image')).toBe('good-description-image-artwork-help good-description-image-artwork-guidance');
    expect(html).toContain('id="good-description-image-artwork-help"');
    expect(html).not.toMatch(/aria-describedby="[^"]*goods-image-upload-guidance[^"]*"[^>]*class="admin-artwork-input"/);
  });

  /* 리뷰 재현: 요약이 원문 길이만 보여 줘 정리된 코드가 30,000자를 넘어 저장이 거부될 때 이유를 알 수 없었다. */
  it('상세페이지 HTML 요약에 정리 후 길이를 함께 보여주고, 정리 결과가 상한을 넘으면 저장 전에 알린다', () => {
    const images = Array.from({ length: 100 }, (_, index) => `<img src="https://img.example.com/${index}.jpg">`).join('');
    const description = `<p>${'가'.repeat(25000)}</p>${images}`;
    const html = renderGoodSection(good, { attempt: 1, values: { previousId: good.id, descriptionFormat: 'html', description } });
    const cleaned = sanitizeGoodsDescription(description).html.length;

    expect(description.length).toBeLessThanOrEqual(30000);
    expect(cleaned).toBeGreaterThan(30000);
    expect(html).toContain(`상세페이지 HTML · 원문 ${description.length.toLocaleString('ko-KR')}자 · 정리 후 ${cleaned.toLocaleString('ko-KR')}자`);
    expect(html).toContain(`정리된 코드가 ${cleaned.toLocaleString('ko-KR')}자로 최대 30,000자를 넘어 저장할 수 없습니다.`);
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
    expect(html).toContain('상품 상세페이지');
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
    const preview = html.slice(html.indexOf('공개 화면 미리보기'), html.indexOf('실재고 조정'));
    expect(preview).not.toContain('<form');
  });

  /* 2026-10-07 MD 회의 ⑥ — 스마트스토어식 판매가 → 할인 입력이 기존 price·compareAtPrice 계약으로 저장된다. */
  it('저장된 정가·판매가를 판매가·할인으로 열고 같은 저장 값을 hidden 입력으로 보낸다', () => {
    const html = renderGoodSection(good);
    const card = html.slice(html.indexOf('id="good-section-price"'), html.indexOf('id="good-section-variants"'));
    expect(card).toContain('<h3>판매가</h3>');
    expect(card).toMatch(/<input[^>]*name="regularPrice"[^>]*value="26000"/);
    expect(card).toMatch(/<input type="radio" name="discountEnabled" checked="" value="true"\/>설정함/);
    expect(card).toMatch(/<input[^>]*name="discountValue"[^>]*value="4000"/);
    expect(card).toContain('할인가 <strong>22,000원</strong> (4,000원 할인)');
    expect(card).toContain('<input type="hidden" name="price" value="22000"/>');
    expect(card).toContain('<input type="hidden" name="compareAtPrice" value="26000"/>');
    expect(card).toContain('고객 화면에 할인율 표시');
    for (const legacy of ['기준 판매가', '소비자가', '옵션 판매가', '추가금액']) expect(card).not.toContain(legacy);
  });

  it('새 상품은 할인 설정안함·빈 판매가로 시작하고 서버 가격 오류를 해당 칸에 붙인다', () => {
    const fresh = renderGoodSection(null);
    const card = fresh.slice(fresh.indexOf('id="good-section-price"'), fresh.indexOf('id="good-section-variants"'));
    expect(card).toMatch(/<input type="radio" name="discountEnabled" checked="" value="false"\/>설정안함/);
    expect(card).toMatch(/<input[^>]*name="regularPrice"[^>]*value=""/);
    expect(card).toContain('<input type="hidden" name="compareAtPrice" value=""/>');
    expect(card).toContain('class="goods-price-editor__discount" hidden=""');

    const failed = renderGoodSection(good, { errors: { compareAtPrice: '할인은 0원보다 크고 판매가보다 작아야 해요. 판매가와 할인을 확인해주세요.', price: '가격 오류' } });
    const failedCard = failed.slice(failed.indexOf('id="good-section-price"'), failed.indexOf('id="good-section-variants"'));
    expect(failedCard).toMatch(/id="goods-regular-price-error" role="alert">가격 오류/);
    expect(failedCard).toMatch(/id="goods-discount-value-error" role="alert">할인은 0원보다 크고 판매가보다 작아야 해요/);
  });

  it('저장 실패 후에는 입력한 할인 단위와 값을 그대로 되살린다', () => {
    const html = renderGoodSection(good, { attempt: 1, values: { previousId: good.id, price: '8415', compareAtPrice: '9900', regularPrice: '9900', discountEnabled: 'true', discountValue: '15', discountUnit: 'percent' } });
    expect(html).toMatch(/<input[^>]*name="discountValue"[^>]*value="15"/);
    expect(html).toMatch(/<option value="percent" selected="">%<\/option>/);
    expect(html).toContain('<input type="hidden" name="price" value="8415"/>');
    expect(html).toContain('할인가 <strong>8,415원</strong> (1,485원 할인)');
  });

  it('재고수량·옵션 카드는 옵션 없는 상품의 재고수량을 먼저 보여준다', () => {
    const html = renderGoodSection(good);
    const card = html.slice(html.indexOf('id="good-section-variants"'), html.indexOf('id="good-section-notice"'));
    expect(card).toContain('<h3>재고수량·옵션</h3>');
    expect(card).toContain('옵션 없음 · 재고수량 12개');
    expect(card.indexOf('for="goods-single-stock">재고수량')).toBeLessThan(card.indexOf('<legend>옵션</legend>'));
    expect(html).toContain('2. 판매가');
    expect(html).toContain('3. 재고수량·옵션');
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
