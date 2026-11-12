import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import { GOODS_READINESS_REASONS, type AdminGoodsReadiness, type GoodsReadinessReasonCode } from '@/lib/admin/goods-readiness';
import type { Ip } from '@/lib/data';
import { GOODS_HTML_MAX_LENGTH, sanitizeGoodsDescription } from '@/lib/goods-description';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { GOOD_BADGES, GOOD_TYPES } from '@/lib/goods-taxonomy';
import { GoodSection } from './GoodSection';
import { groupGoodsEntryVisible } from '../GoodEditor';
import { ADMIN_SCREENS, adminScreenForPath } from '@/lib/admin/navigation';
import { commonTestOwnership } from '@/lib/admin/goods-group-common.test-fixtures';
import { parseGoodsEditorOwnership } from '@/lib/admin/goods-group-common';
import { GoodsKcTemplateProvider } from '../useGoodsKcTemplate';
import { GOOD_LOCKED_SELECTS_CLASS } from '../GoodEditorParts';
import { GOODS_RANDOM_OPTION_LIMIT_GUIDANCE, GOODS_RANDOM_OPTION_LIMIT_MIXED } from '../GoodsSalePolicyFields';

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
  options: Pick<Parameters<typeof GoodSection>[0],'initialQuery'|'initialIpId'|'variants'|'canSearchErp'|'ownership'|'accountId'|'cloneOperationId'|'canManageCosts'|'canManageMedia'|'readiness'> = {},
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
  it('그룹 공통정보·옵션 구조와 합산 조건은 잠그고 개별 가격·재고·사진·결제는 유지한다', () => {
    const selected = { ...good, id: 'group-child', publishedAt: null };
    const ownership = parseGoodsEditorOwnership(commonTestOwnership)!;
    const html = renderGoodSection(selected, { values: { previousId: selected.id, name: '이전 브라우저 이름', description: '이전 공통 설명' } }, { ownership });
    expect(html).toContain('공통정보 편집'); expect(html).toContain('합산 기준 상품');
    expect(html).toContain('groupCommon='); expect(html).not.toContain('이전 브라우저 이름'); expect(html).not.toContain('이전 공통 설명');
    expect(html).toMatch(/readOnly=""[^>]*name="name"|name="name"[^>]*readOnly=""/);
    expect(html).toMatch(/readOnly=""[^>]*aria-label="기본 옵션명"|aria-label="기본 옵션명"[^>]*readOnly=""/);
    expect(html).toMatch(/<fieldset[^>]*disabled=""[^>]*data-good-option-usage=""/);
    expect(html).not.toContain('다른 상품 옵션 불러오기'); expect(html).not.toContain('id="good-operation-variants"');
    expect(html).not.toContain('id="good-operation-after-sales"'); expect(html).not.toContain('id="good-operation-size-chart"');
    expect(html).toContain('id="goods-single-stock"'); expect(html).toContain('name="allowCardPayment"'); expect(html).toContain('id="good-section-images"');
    for (const name of ['categoryId','additionalCategoryIds','description','descriptionFormat','originId','shippingFeeType','individualFee','orderQuantityLimitEnabled','memberLifetimeQtyLimit']) expect(html).toContain(`type="hidden" name="${name}"`);
  });

  it('플랫폼 관리 권한이 없는 상품 매니저에게 IP 운영 화면 링크를 노출하지 않는다', () => {
    expect(renderGoodSection(good)).toContain('/admin/catalog/ips/hwasan');
    const html = renderGoodSection(good, {}, { canSearchErp: false });
    expect(html).not.toContain('/admin/catalog/ips/hwasan');
    expect(html).toContain('name="ipId"');
  });
  /*
   * TKT-073(#506 완료 기준 1) — 입력 순서는 현행 유지(11/11 S36-007·TKT-001 결정 "현행 유지(회의 결정)")이고, 섹션 순서·오류 요약 순서와
   * 이미지·판매기간·KC·예약판매 위치까지 렌더로 고정한다. 등록 화면과 저장된 상품의 편집기는 같은 순서다.
   */
  it('keeps the task order and error links in the same authoring sequence', () => {
    const html = renderGoodSection(null, { errors: { maxOrderQty: '수량 오류', originId: '배송 오류', noticeMaker: '고시 오류', variants: '옵션 오류', price: '가격 오류', name: '이름 오류', saleStartsAt: '기간 오류', workspacePreorders: '예약 오류' } });
    const anchors = ['good-section-basic', 'good-section-price', 'good-section-variants', 'good-section-period', 'good-operation-preorders', 'good-section-limits',
      'good-section-images', 'good-section-description', 'good-section-notice', 'good-operation-kc', 'good-section-delivery', 'good-section-shipping', 'good-section-information'];
    for (const markup of [html, renderGoodSection({ ...good, publishedAt: null })]) {
      const positions = anchors.map((id) => markup.indexOf(`id="${id}"`));
      expect(positions.every((position) => position >= 0), anchors.filter((_, index) => positions[index] < 0).join()).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
    const summary = html.slice(html.indexOf('aria-label="저장 오류 요약"')).split('</section>')[0];
    expect([...summary.matchAll(/href="#(good-(?:section|operation)-[a-z]+)"/g)].map((match) => match[1]))
      .toEqual(['good-section-basic', 'good-section-price', 'good-section-variants', 'good-section-period', 'good-operation-preorders', 'good-section-limits', 'good-section-notice', 'good-section-shipping']);
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
    expect(html).toContain('aria-label="배송·반품·결제"');
    expect(html).toContain('value="실패 뒤 상품"');
    expect(html).toContain('value="복사된 연락처"');
    expect(html).toContain('value="public-media/catalog/good/failed.webp"');
    expect(html).toContain('value="보존 옵션"');
    expect(html).toContain('value="-1"');
    /* 대표·추가 이미지는 한 그리드(자리별 hidden input)이고, 상세 HTML 이미지·긴 상세 이미지만 별도 업로드 칸이다. */
    expect(html.match(/data-auto-upload="true"/g)).toHaveLength(2);
    expect(html.match(/<li class="[^"]*" data-artwork-upload-field=""/g)).toHaveLength(2);
    expect(html).toContain('최근 저장된 상품에서 복사');
    expect(html).toContain('템플릿에서 가져오기');
  });
  /*
   * ADM-004(복잡도 표 25·27행) — 저장 안내의 순서 문장은 등록 화면에서 한 문장이고, 저장된 초안의 "초안 저장 → KC 검토 → 공개" 순서는 판매 준비 카드
   * (다음 할 일 · KC 검토 필요, 판매 준비 안내의 KC 재검토 문장)가 말하므로 저장 안내에서 되풀이하지 않는다.
   */
  it('저장 안내는 등록 화면의 KC 포함 저장·공개 순서를 한 문장으로 말하고, 저장된 초안의 순서는 판매 준비 카드에 맡긴다', () => {
    const draft = { ...good, publishedAt: null };
    const save = (html: string) => html.slice(html.indexOf('aria-label="기본 상품 저장"'));
    const draftHtml = renderGoodSection(draft);
    expect(save(draftHtml)).not.toContain('초안 저장 → 2. KC 검토 → 3. 공개');
    expect(save(draftHtml)).not.toContain('1. 초안 생성 → 2. KC 검토 → 3. 공개 요청');
    expect(draftHtml).toContain('모델·옵션·고시정보를 수정하면 실제 상품과 검토 근거가 달라질 수 있어 초안 전환과 KC 재검토가 필요합니다.');
    /* R13·D6② — 등록 화면은 KC를 기본 입력과 함께 저장한다. 순서·재검토 조건은 한 문장이다. */
    const create = save(renderGoodSection(null));
    const sentence = 'KC까지 입력해 저장한 뒤 판매 준비에서 공개하며, KC를 검토 완료로 저장했더라도 그 뒤 상품명·유형·IP·고시정보(제조자·제조국·소재·크기)나 옵션 구성을 바꾸면 KC를 다시 검토합니다.';
    expect(create).toContain(sentence);
    expect(sentence.match(/다\./g)).toHaveLength(1);
    expect(create).toContain('KC·예약판매 입력을 한 번에 저장합니다. 하나라도 실패하면 아무것도 저장되지 않고 입력은 유지됩니다.');
    /* 저장 안내를 열지 않아도 다음 단계가 보인다. */
    expect(create).toContain('data-good-next-step="">다음 단계: 저장하면 화면 맨 위에 판매 준비가 열리고, 거기서 공개합니다.');
    expect(create).not.toContain('→ 2.');
  });

  /* ADM-004(복잡도 표 168·190행) — 선택 카드인 상세설명은 요약 한 줄로 접고, 용어 도움말은 연결 IP·유형을 고르는 동안만 보인다. */
  it('상세설명 카드는 요약 한 줄로 접혀 있고 오류가 있으면 열리며, 연결 IP·유형 도움말은 고르는 동안만 보인다', () => {
    const create = renderGoodSection(null);
    expect(create.match(/<details id="good-section-description"[^>]*>/)?.[0]).not.toContain('open=""');
    expect(create).toMatch(/<textarea[^>]*name="description"/);
    expect(renderGoodSection(null, { errors: { description: '설명 오류' } }).match(/<details id="good-section-description"[^>]*>/)?.[0]).toContain('open=""');
    expect(create).toContain('data-good-identity-help=""');
    expect(renderGoodSection({ ...good, publishedAt: null })).not.toContain('data-good-identity-help=""');
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
    // KC를 다시 검토하고 게시 작업으로 공개하면, 남아 있던 보류 안내가 공개 상태와 어긋나지 않게 사라진다.
    const published = renderGoodSection({ ...good, publishedAt: '2026-10-07T12:00:00.000Z' }, { message, kcPublishBlocked: true, savedGoodId: good.id, attempt: 1 });
    const publishedSave = published.slice(published.indexOf('aria-label="기본 상품 저장"'));
    expect(publishedSave).not.toContain('공개 보류');
    expect(publishedSave).not.toContain('KC를 다시 검토해야 공개할 수 있습니다');
    expect(publishedSave).toContain('저장된 내용과 같음');
  });
  it('초안 저장은 브라우저 고시 필수 검증에 막히지 않고 공개 이미지 오류를 표시한다', () => {
    const html = renderGoodSection(null, { errors: { imagePath: '대표 이미지를 업로드한 뒤 공개해주세요.' } });
    expect(html).toContain('저장하기');
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
    expect(html).toContain('required=""');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('name="adjustmentId"');
    expect(html).toContain('name="expectedStockQty"');
    expect(html).toContain('재고 조정');
    const stockForm = (html.match(/<form\b[\s\S]*?<\/form>/g) ?? []).find(form => form.includes('name="delta"'));
    expect(stockForm).toContain('name="reason"');
    expect(stockForm).toMatch(/<input[^>]*data-slot="input"[^>]*name="delta"/);
    expect(stockForm).toMatch(/<textarea[^>]*data-slot="textarea"[^>]*name="reason"/);
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
    /* 저장 전에는 이름만 보이고 입력·폼은 없다(R13). */
    const hub = html.slice(html.indexOf('data-good-operation-hub="pending"'));
    const names = hub.slice(0, hub.indexOf('</dl>'));
    expect(names).toContain('재고 조정');
    expect(names).not.toMatch(/<input|<select|<textarea|<button/);
    expect(html.match(/<form/g)).toHaveLength(1);
  });

  /*
   * 10/27 회의 R13·D6① — 등록 화면에서 저장 뒤 나오는 항목을 같은 순서로 보인다. 카드 18장을 없애고 이름 목록 한 장으로 합쳤으므로
   * "자리표시 카드" 계약이 "이름 목록 + 사유 한 번"으로 바뀌었다. KC·예약판매는 기본 입력과 함께 저장한다(D6②).
   */
  it('등록 화면은 저장 뒤 항목 이름을 같은 묶음·같은 순서로 나열하고 이유는 한 번만 말하며 KC·예약판매는 함께 입력한다', () => {
    const props = { accountId: 'operator-1', cloneOperationId: '33333333-3333-4333-8333-333333333333', canManageCosts: true };
    const saved = renderGoodSection({ ...good, publishedAt: null }, {}, props);
    const create = renderGoodSection(null, {}, props);
    const hubIds = (html: string) => [...html.slice(html.indexOf('data-good-operation-hub=')).matchAll(/<details id="good-operation-([a-z-]+)"/g)].map((match) => match[1]);
    const names = [...create.matchAll(/data-good-operation-name="([a-z-]+)"/g)].map((match) => match[1]);
    /* 18개 = 게시 상태 포함, KC·예약판매 제외. */
    expect(names).toHaveLength(18);
    expect(names.filter((id) => id !== 'publish')).toEqual(hubIds(saved).filter((id) => id !== 'preorders'));
    expect(names).toEqual(expect.arrayContaining(['prices', 'transaction-terms', 'benefits', 'stock', 'publish']));
    for (const id of names) expect(create).toMatch(new RegExp(`<li id="good-operation-${id}"`));
    expect(create.split('상품을 저장하면 이 자리에서 바로 입력할 수 있습니다.')).toHaveLength(2);
    expect(create).toContain('저장하면 이어서 설정할 수 있어요');
    expect(create).not.toContain('data-good-operation="placeholder"');
    expect(create.slice(create.indexOf('data-good-operation-hub="pending"'))).not.toContain('aria-disabled="true"');
    const card = (html: string, id: string) => { const start = html.indexOf(`id="good-operation-${id}"`); const next = html.indexOf('<details id="good-operation-', start + 1); return html.slice(start, next < 0 ? undefined : next); };
    expect(card(create, 'kc')).toContain('상품과 함께 저장');
    expect(card(create, 'kc')).toContain('상품 전체 KC 해당 없음');
    expect(card(create, 'kc')).toContain('KC 모델 추가');
    expect(card(create, 'preorders')).toContain('예약 조건 추가');
    expect(create).toMatch(/<details id="good-operation-kc"[^>]*open=""/);
    /* 1027T-023(11/11 "펼친 채로"): 예약판매는 접힌 줄이 아니라 판매 정보 카드의 판매기간 바로 뒤에 펼친 소항목이고, 이어서 설정 카드에는 없다. */
    expect(create).not.toMatch(/<details[^>]*id="good-operation-preorders"/);
    expect(create).toMatch(/<section aria-labelledby="good-operation-preorders-title"[^>]*id="good-operation-preorders"/);
    expect(create.indexOf('id="good-section-period"')).toBeLessThan(create.indexOf('id="good-operation-preorders"'));
    expect(create.indexOf('id="good-operation-preorders"')).toBeLessThan(create.indexOf('id="good-section-limits"'));
    expect(create.indexOf('id="good-operation-preorders"')).toBeLessThan(create.indexOf('data-good-operation-hub="pending"'));
    expect(create.slice(create.indexOf('data-good-operation-hub="pending"'))).not.toContain('예약 조건 추가');
    /* 예약 입력은 소속 폼을 떼어 상품 저장의 브라우저 검증·Enter 제출에 섞이지 않는다. */
    const preorderInputs = card(create, 'preorders').slice(0, card(create, 'preorders').indexOf('id="good-section-limits"'));
    expect(preorderInputs).toMatch(/<button[^>]*form="good-detached-controls"[^>]*>예약 조건 추가<\/button>/);
    /* KC는 고시 입력 바로 아래, 배송 카드 앞에 있다. */
    expect(create.indexOf('name="noticeAsContact"')).toBeLessThan(create.indexOf('id="good-operation-kc"'));
    expect(create.indexOf('id="good-operation-kc"')).toBeLessThan(create.indexOf('id="good-section-delivery"'));
    const form = create.slice(create.indexOf('<form'), create.indexOf('</form>'));
    expect(form).toContain('type="hidden" name="workspaceOperationId"');
    expect(form).toContain('type="hidden" name="workspaceSections"');
    /* KC 입력은 폼 안에 있어도 name이 없어 제출·자동복구·임시저장에 실리지 않는다(DQ3). */
    expect(card(create, 'kc').slice(0, card(create, 'kc').indexOf('id="good-section-delivery"'))).not.toMatch(/<(input|select|textarea)\b[^>]*\sname=/);
    expect(saved).not.toContain('name="workspaceOperationId"');
    expect(card(saved, 'kc')).toContain('별도 저장');
    /* 저장 뒤 KC는 고시 카드, 게시 상태는 판매 준비 카드에 있다. */
    expect(saved.indexOf('id="good-section-notice"')).toBeLessThan(saved.indexOf('id="good-operation-kc"'));
    expect(saved.indexOf('id="good-operation-kc"')).toBeLessThan(saved.indexOf('id="good-section-delivery"'));
    const readiness = saved.slice(saved.indexOf('data-good-readiness=""'), saved.indexOf('data-good-workspace-form'));
    expect(readiness).toContain('id="good-operation-publish"');
    expect(readiness).toContain('공개로 전환');
  });

  /*
   * 사람 눈 테스트 2라운드 — 공개 버튼이 두 개라 차이를 몰랐고, 저장 후 공개를 눌러도 초안으로만 저장돼 이름과 결과가 달랐다.
   * 주 행동은 하나다: 막는 항목이 남으면 다음 할 일, 없으면 공개로 전환, 저장할 입력이 있으면 저장 막대의 저장 후 공개. 저장 계약(intent)은 그대로다.
   */
  describe('판매 준비 카드의 주 행동', () => {
    const reason = (code: GoodsReadinessReasonCode, kind: 'blocking' | 'review' = 'blocking') => ({ code, ...GOODS_READINESS_REASONS[code], kind });
    const ready: AdminGoodsReadiness = { state: 'review_required', checkedAt: '2026-11-09T06:20:51.000Z', publication: 'draft', operation: 'active', availableQty: 40, publicReview: 'current', saleSettings: 'blocked', reviewRequired: true, reasons: [reason('draft')] };
    const kcBlocked: AdminGoodsReadiness = { ...ready, publicReview: 'required', reasons: [reason('draft'), reason('kc_required', 'review')] };
    const live: AdminGoodsReadiness = { ...ready, state: 'ready', publication: 'published', saleSettings: 'ready', reviewRequired: false, availableQty: 55, reasons: [] };
    const draft = { ...good, publishedAt: null, firstPublishedAt: null, imagePath: 'public-media/catalog/good/main.webp', originId: '11111111-1111-4111-8111-111111111111' };
    const card = (html: string) => html.slice(html.indexOf('data-good-readiness=""'), html.indexOf('data-good-workspace-nav'));
    const bar = (html: string) => html.slice(html.indexOf('aria-label="기본 상품 저장"'), html.indexOf('</form>', html.indexOf('aria-label="기본 상품 저장"')));
    const tone = (html: string, label: string) => html.match(new RegExp(`data-tone="([a-z]+)"[^>]*>${label}`))?.[1];
    const button = (html: string, label: string) => html.match(new RegExp(`<(?:a|button)\\b[^>]*>${label}<`))?.[0] ?? '';

    it('KC가 막으면 공개 버튼 대신 KC 검토하기가 주 행동이고 저장 후 공개는 보이지 않는다', () => {
      const html = renderGoodSection(draft, {}, { readiness: kcBlocked });
      expect(card(html)).toContain('다음 할 일 · KC 검토 필요');
      expect(button(card(html), 'KC 검토하기')).toContain('bg-primary');
      expect(button(card(html), 'KC 검토하기')).toContain('href="#good-operation-kc"');
      expect(button(card(html), '공개로 전환')).toBe('');
      expect(bar(html)).not.toContain('value="publish"');
      expect(bar(html)).not.toContain('저장 후 공개');
      expect(bar(html)).toContain('KC 검토를 마치면 공개할 수 있습니다.');
      /* 고칠 입력이 없으면 주 색은 위쪽 다음 할 일 하나다. */
      expect(button(bar(html), '저장하기')).not.toContain('bg-primary');
      /* 사람 눈 테스트 3라운드 — KC 일 하나에 노랑·빨강이 섞였다. 이동 띠도 주의색이고, 남은 것이 KC뿐이면 저장 막대는 문장 하나로 말한다. */
      const nav = html.slice(html.indexOf('data-good-workspace-nav'), html.indexOf('</nav>', html.indexOf('data-good-workspace-nav')));
      expect(nav).toMatch(/data-good-card-remaining="1"[^>]*data-tone="warning"|data-tone="warning"[^>]*data-good-card-remaining="1"/);
      expect(nav).not.toContain('data-tone="danger"');
      expect(bar(html)).not.toContain('data-good-publish-remaining');
    });

    /* 사람 눈 테스트 3라운드 — "저장된 내용과 같음"인데 초안은 흰색, 공개 중인 상품은 파란색이라 눌러도 되는지 망설였다. */
    it('저장할 변경이 없으면 저장하기는 초안·공개 중 어느 상품이든 같은 보조 모양이다', () => {
      const clean = [renderGoodSection(draft, {}, { readiness: kcBlocked }), renderGoodSection(draft, {}, { readiness: ready }), renderGoodSection(good, {}, { readiness: live })];
      for (const html of clean) {
        expect(bar(html)).toContain('저장된 내용과 같음');
        expect(button(bar(html), '저장하기')).not.toContain('bg-primary');
      }
      expect(button(bar(renderGoodSection(null)), '저장하기')).toContain('bg-primary');
    });

    it('공개 중 반영 안내는 주의색이고 잠긴 연결 IP·유형 선택칸은 잠긴 입력칸과 같은 모양이다', () => {
      const publishedHtml = renderGoodSection(good, {}, { readiness: live });
      expect(bar(publishedHtml)).toMatch(/data-good-next-step=""><span class="[^"]*text-warning[^"]*">[^]*?저장하면 공개 중인 상품 화면에 바로 반영됩니다\./);
      /* 잠금은 모양만 바꾼다. 값은 hidden input이 그대로 제출한다. */
      const lockedOpen = `<div class="${GOOD_LOCKED_SELECTS_CLASS.replaceAll('&', '&amp;')}">`;
      expect(publishedHtml).toContain(lockedOpen);
      const locked = publishedHtml.slice(publishedHtml.indexOf(lockedOpen));
      expect(locked).toMatch(/<select[^>]*disabled=""[^>]*name="ipId"|<select[^>]*name="ipId"[^>]*disabled=""/);
      expect(locked).toContain('<input type="hidden" name="ipId" value="hwasan"/>');
      expect(renderGoodSection(draft, {}, { readiness: ready })).not.toContain(lockedOpen);
    });

    it('실제로 막는 항목만 주의색이다: 초안만으로는 판매 설정을 확인 필요로 보이지 않는다', () => {
      const html = renderGoodSection(draft, {}, { readiness: kcBlocked });
      expect(tone(html, '게시 · 초안')).toBe('neutral');
      expect(tone(html, '판매 설정 · 준비 완료')).toBe('success');
      expect(tone(html, '공개 검토 · KC 검토 필요')).toBe('warning');
      const stopped = renderGoodSection(draft, {}, { readiness: { ...kcBlocked, operation: 'stopped', reasons: [reason('draft'), reason('stopped'), reason('kc_required', 'review')] } });
      expect(tone(stopped, '운영 · 판매 중지')).toBe('danger');
      expect(tone(stopped, '판매 설정 · 확인 필요')).toBe('warning');
      /* 서버가 막는 항목이 다른 확인 항목보다 먼저다. */
      expect(card(stopped)).toContain('다음 할 일 · KC 검토 필요');
      expect(card(stopped)).toContain('운영자가 판매 중지</a>');
    });

    it('막는 항목이 없으면 공개로 전환이 주 행동 하나다', () => {
      const html = renderGoodSection(draft, {}, { readiness: ready });
      expect(card(html)).toContain('공개할 수 있습니다');
      expect(button(card(html), '공개로 전환')).toContain('bg-primary');
      expect(bar(html)).not.toContain('value="publish"');
      expect(button(bar(html), '저장하기')).not.toContain('bg-primary');
      expect(bar(html)).toContain('화면 맨 위 판매 준비에서 공개할 수 있습니다.');
    });

    it('공개는 되지만 고객이 살 수 없는 항목이면 다음 할 일을 앞세우고 공개는 보조로 남긴다', () => {
      const html = renderGoodSection(draft, {}, { readiness: { ...ready, availableQty: 0, reasons: [reason('draft'), reason('stock_unavailable')] } });
      expect(button(card(html), '재고 확인하기')).toContain('bg-primary');
      expect(button(card(html), '공개로 전환')).not.toContain('bg-primary');
      expect(button(card(html), '공개로 전환')).toContain('data-slot="button"');
    });

    it('저장할 입력이 있고 공개 조건을 채웠을 때만 저장 후 공개가 보이고 저장하기가 주 행동이다', () => {
      const values = { previousId: draft.id, name: draft.name, type: draft.type, ipId: draft.ipId, imagePath: draft.imagePath, regularPrice: '26000', price: '22000', originId: '11111111-1111-4111-8111-111111111111', noticeMaker: '주식회사 아이콘스', noticeOrigin: '대한민국', noticeMaterial: '아크릴', noticeSize: '80 x 60 x 20mm · 90g', noticeMadeOn: '2026-07', noticeAsManager: '아이콘스 고객센터', noticeAsContact: '02-000-0000' };
      const variants = [{ id: '11111111-1111-4111-8111-111111111111', goodId: draft.id, name: '기본 옵션', code: 'HW-0100-01', price: draft.price, stockQty: 12, isDefault: true, archivedAt: null, attributes: {} }];
      const dirty = renderGoodSection(draft, { attempt: 1, values }, { readiness: ready, variants });
      expect(button(bar(dirty), '저장 후 공개')).toContain('value="publish"');
      expect(button(bar(dirty), '저장하기')).toContain('bg-primary');
      expect(bar(dirty)).toContain('저장 후 공개를 누르면 수정한 내용까지 고객 화면에 공개됩니다.');
      /* 이번 저장이 KC 검토를 되돌리면 초안으로만 저장되므로 버튼을 내고 이유를 말한다. */
      const context = renderGoodSection(draft, { attempt: 1, values: { ...values, name: '바꾼 상품명' } }, { readiness: ready, variants });
      expect(bar(context)).not.toContain('value="publish"');
      expect(bar(context)).toContain('KC를 다시 검토해야 공개할 수 있습니다.');
      /* 필수 칸이 비면 저장 후 공개는 없다. */
      expect(bar(renderGoodSection(draft, { attempt: 1, values: { ...values, noticeMaker: '' } }, { readiness: ready, variants }))).not.toContain('value="publish"');
    });

    it('공개 중인 상품은 초록 상태로 보이고 내리는 작업은 위험 표시와 함께 접힌 줄이다', () => {
      const html = renderGoodSection(good, {}, { readiness: live });
      expect(tone(html, '게시 · 공개')).toBe('success');
      expect(tone(html, '운영 · 정상')).toBe('success');
      expect(tone(html, '판매 설정 · 준비 완료')).toBe('success');
      expect(tone(html, '공개 검토 · KC 검토 완료')).toBe('success');
      const fold = card(html).slice(card(html).indexOf('<details'));
      expect(fold.slice(0, fold.indexOf('>'))).toContain('id="good-operation-publish"');
      expect(fold.slice(0, fold.indexOf('>'))).not.toContain('open=""');
      expect(fold).toMatch(/<summary[^>]*text-destructive[^>]*>[^]*?초안으로 되돌리기<\/summary>/);
      expect(button(fold, '초안으로 되돌리기')).toContain('text-destructive');
      expect(card(html)).not.toContain('data-good-readiness-next');
      /* 입력칸을 밀어내던 긴 안내와 내부 용어는 첫 화면에 없다. */
      expect(card(html)).not.toMatch(/서버|미저장|기본 폼/);
      expect(card(html)).toContain('판매 가능 재고 55개');
    });

    it('공개 중 상품의 확인 항목은 주 색을 쓰지 않는다', () => {
      const html = renderGoodSection(good, {}, { readiness: { ...live, publicReview: 'legacy_unrecorded', reasons: [reason('kc_legacy_unrecorded', 'review')] } });
      expect(card(html)).toContain('확인 필요 · 기존 공개 · KC 미기록');
      expect(button(card(html), 'KC 정보 확인하기')).not.toContain('bg-primary');
      expect(tone(html, '공개 검토 · 기존 공개 · KC 미기록')).toBe('warning');
      /* 기존 공개 · KC 미기록과 품절은 미입력이 아니다. */
      const count = (id: string) => html.match(new RegExp(`href="#good-section-${id}"[^]*?data-good-card-remaining="(\\d+)"`))?.[1];
      expect(count('notice')).toBe('0');
      expect(count('price')).toBe('0');
    });
  });

  /* 저장 뒤 운영 패널 18개는 접이식 5그룹으로 묶는다. 각 패널의 id·별도 저장 계약은 그대로다. */
  it('저장 뒤 운영 패널을 판매 운영·가격·혜택·배송·수령·상세 콘텐츠·관리 5그룹으로 접어 둔다', () => {
    const saved = renderGoodSection({ ...good, publishedAt: null }, {}, { accountId: 'operator-1', cloneOperationId: '33333333-3333-4333-8333-333333333333', canManageCosts: true });
    const hub = saved.slice(saved.indexOf('data-good-operation-hub="saved"'));
    const groups = [...hub.matchAll(/<details[^>]*data-good-operation-group="([a-z]+)"[^>]*>/g)];
    expect(groups.map((match) => match[1])).toEqual(['sales', 'benefits', 'delivery', 'content', 'manage']);
    for (const group of groups) expect(group[0]).not.toContain('open=""');
    expect(hub).toContain('각 항목은 따로 저장합니다. 기본 상품 입력은 함께 저장되지 않습니다.');
    expect(hub.split('기본 상품 입력은 함께 저장되지 않습니다.')).toHaveLength(2);
    expect(hub.indexOf('data-good-operation-group="sales"')).toBeLessThan(hub.indexOf('id="good-operation-stock"'));
    expect(hub.indexOf('id="good-operation-stock"')).toBeLessThan(hub.indexOf('data-good-operation-group="benefits"'));
  });

  /* 10/27 회의 D5② — 판매 방식(랜덤 판매) 패널은 예약판매 바로 앞에 둔다. 등록 화면에는 이름만 있다. */
  it('판매 방식 패널을 예약판매 바로 앞에 두고, 기본 입력 잠금 규칙을 다른 운영 패널과 같이 따른다', () => {
    const props = { accountId: 'operator-1' };
    const ids = (html: string) => [...html.matchAll(/<details id="good-operation-([a-z-]+)"/g)].map((match) => match[1]);
    const card = (html: string, id: string) => { const start = html.indexOf(`id="good-operation-${id}"`); const next = html.indexOf('<details id="good-operation-', start); return html.slice(start, next < 0 ? undefined : next); };
    const saved = renderGoodSection({ ...good, publishedAt: null }, {}, props);
    /* 1027T-023: 예약판매 패널은 판매 정보 카드로 옮겼고, 판매 방식 바로 뒤 옛 자리에는 그 위치로 가는 링크가 남는다. */
    const sale = saved.indexOf('<details id="good-operation-option-sale-mode"');
    const moved = saved.indexOf('data-good-operation-moved="preorders"');
    expect(sale).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(sale);
    expect(saved.slice(sale + 1, moved)).not.toContain('<details id="good-operation-');
    expect(saved.slice(moved)).toMatch(/href="#good-operation-preorders"[^>]*>예약판매로 이동<\/a>/);
    expect(saved.indexOf('id="good-operation-preorders"')).toBeLessThan(saved.indexOf('id="good-section-limits"'));
    expect(saved.indexOf('id="good-section-period"')).toBeLessThan(saved.indexOf('id="good-operation-preorders"'));
    expect(ids(saved)).not.toContain('preorders');
    expect(card(saved, 'option-sale-mode')).toMatch(/<summary[^>]*>[^]*?data-good-operation-title="">판매 방식<\/span>[^]*?<\/summary>/);
    expect(card(saved, 'option-sale-mode')).toContain('aria-label="판매 방식"');
    /* 서버 렌더는 기본 입력 상태를 확인하는 중이라 잠긴다 — 다른 잠금 패널과 같은 공통 안내를 패널 맨 위에 보인다. */
    expect(card(saved, 'option-sale-mode')).toMatch(/data-good-operation-notice="" role="status"><p[^>]*>기본 상품의 입력 상태를 확인하고 있습니다.<\/p>/);

    const create = renderGoodSection(null, {}, props);
    expect(create).toContain('data-good-operation-name="option-sale-mode"');
    expect(create).not.toContain('<details id="good-operation-option-sale-mode"');
    expect(renderGoodSection({ ...good, archivedAt: '2026-10-01T00:00:00Z' })).not.toContain('id="good-operation-option-sale-mode"');
  });

  it('등록 화면 섹션 저장 오류는 같은 자리 카드와 상단 요약에서 그 카드로 안내한다', () => {
    const html = renderGoodSection(null, { attempt: 1, errors: { workspacePreorders: '예약 활성화는 관리자 계정에서 할 수 있습니다. 상품은 저장되지 않았고 입력은 유지됩니다.', name: '이름 오류' } });
    const summary = html.slice(html.indexOf('aria-label="저장 오류 요약"')).split('</section>')[0];
    expect([...summary.matchAll(/href="#([a-z-]+)"/g)].map((match) => match[1])).toEqual(['good-section-basic', 'good-operation-preorders']);
    const preorders = html.slice(html.indexOf('id="good-operation-preorders"'));
    expect(preorders).toMatch(/role="alert">예약 활성화는 관리자 계정에서 할 수 있습니다/);
  });

  it('keeps the stored sale restriction in the same goods form as payment methods', () => {
    const html = renderGoodSection({ ...good, saleRestriction: 'adult' });

    expect(html).toContain('결제·판매 제한');
    expect(html).not.toContain('구매수량·결제 설정');
    expect(html).toContain('name="saleRestriction"');
    expect(html).toContain('name="allowCardPayment"');
    expect(html).toContain('성인(19금)');
    expect(html).toMatch(/<option[^>]*value="adult"[^>]*selected|<option[^>]*selected[^>]*value="adult"/);
    expect(html).toContain('성인 인증을 마친 회원에게만 공개·판매됩니다');
  });

  /*
   * 10/27 회의 R12·D7②, 11/11 ADM-011·1027T-021·1027T-023 결정 "둘 다 펼친 채로" — 판매 정보 카드에 판매가 → 재고 → 판매기간 → 예약판매 →
   * 구매 제한이 모두 펼쳐져 입력칸이 바로 보인다(#637의 접힌 줄을 되돌림). 라벨·입력·제출 값은 그대로이고 설정돼 있으면 제목 옆 요약에 값이 보인다.
   */
  it('구매 제한은 판매 정보 카드의 판매기간·예약판매 바로 아래에 펼쳐져 있고 입력·라벨은 그대로다', () => {
    const html = renderGoodSection({ ...good, orderQuantityLimitEnabled: true, minOrderQty: 1, maxOrderQty: 3 } as typeof good);
    const period = html.indexOf('id="good-section-period"');
    const preorders = html.indexOf('id="good-operation-preorders"');
    const limits = html.indexOf('id="good-section-limits"');
    const variants = html.indexOf('id="good-section-variants"');
    expect(variants).toBeGreaterThan(0);
    expect(period).toBeGreaterThan(variants);
    expect(preorders).toBeGreaterThan(period);
    expect(limits).toBeGreaterThan(preorders);
    /* 판매기간·구매 제한·예약판매는 접힘(details)이 아니고, 판매 정보 카드 자체는 열려 있다. */
    for (const id of ['good-section-period', 'good-operation-preorders', 'good-section-limits']) expect(html).not.toMatch(new RegExp(`<details[^>]*id="${id}"`));
    expect(html).toMatch(/<details id="good-section-price"[^>]*open=""/);
    const card = html.slice(limits, html.indexOf('id="good-section-images"'));
    expect(card).toContain('최소 1·최대 3개');
    for (const text of ['구매 제한', '최소/최대 구매수량', '최소 구매수량', '최대 구매수량', '1인 최대 구매수량', '옵션별 구매 제한']) expect(card).toContain(text);
    expect(card).toContain('최소·최대 구매수량을 모두 입력');
    expect(card).toMatch(/<input type="radio" name="orderQuantityLimitEnabled" checked="" value="true"\/>설정함/);
    expect(card).toMatch(/<input[^>]*name="maxOrderQty"[^>]*value="3"/);
    expect(card).toContain('aria-label="기본 옵션 최대 구매수량(주문당)"');
    expect(card).toContain('aria-label="기본 옵션 1인 최대 구매수량"');
    expect(html.indexOf('name="allowCardPayment"')).toBeGreaterThan(variants);
  });

  it('저장된 옵션별 제한을 보여주고, 랜덤 판매 상품은 같은 옵션 배정 상한 한 줄로 입력한다', () => {
    const variant = { id: '11111111-1111-4111-8111-111111111111', goodId: good.id, name: '기본 옵션', code: 'HW-0100-01', price: good.price, stockQty: 12, isDefault: true, archivedAt: null, orderMaxQty: 2, memberMaxQty: null };
    const html = renderGoodSection(good, {}, { variants: [variant] });
    expect(html).toMatch(/<input[^>]*aria-label="기본 옵션 최대 구매수량\(주문당\)"[^>]*value="2"/);
    expect(html).not.toContain(GOODS_RANDOM_OPTION_LIMIT_GUIDANCE);
    expect(html).not.toContain('data-random-option-limit=""');
    const second = { ...variant, id: '22222222-2222-4222-8222-222222222222', name: 'B', code: 'HW-0100-02', isDefault: false };
    const random = renderGoodSection({ ...good, optionSaleMode: 'random' } as typeof good, {}, { variants: [variant, second] });
    expect(random).toContain(GOODS_RANDOM_OPTION_LIMIT_GUIDANCE);
    /* 랜덤 판매 상품은 옵션별 표 대신 모든 옵션에 같은 값을 넣는 한 줄이고, 입력은 막지 않는다. */
    expect(random).not.toMatch(/<fieldset[^>]*disabled=""[^>]*data-good-option-limits=""|<fieldset[^>]*data-good-option-limits=""[^>]*disabled=""/);
    expect(random).toContain('모든 옵션 (2개)');
    expect(random).toMatch(/<input[^>]*aria-label="같은 옵션 최대 배정 수량\(주문당\)"[^>]*value="2"/);
    expect(random).not.toContain('aria-label="B 최대 구매수량(주문당)"');
    expect(random).toContain('같은 옵션 주문당 2개까지');
    expect(random).not.toContain(GOODS_RANDOM_OPTION_LIMIT_MIXED);
    const mixed = renderGoodSection({ ...good, optionSaleMode: 'random' } as typeof good, {}, { variants: [variant, { ...second, orderMaxQty: null }] });
    expect(mixed).toContain(GOODS_RANDOM_OPTION_LIMIT_MIXED);
  });

  /* 리뷰 T3a-2 — 편집기 안 접이식 영역도 키 밖 펼침 상태(stateId)로 그려 저장 시도마다 다시 접히지 않는다. */
  it('편집기 안 접이식 영역(긴 상세 이미지·접힌 줄·옵션 상세 정보·미리보기·저장 안내)도 펼침 상태를 기억한다', () => {
    const html = renderGoodSection(good, { errors: { nameEn: '영문명 오류' } });
    const opening = (pattern: RegExp) => html.match(pattern)?.[0] ?? '';
    const start = html.indexOf('data-good-optional-title="">긴 상세 이미지 (선택)<');
    expect(start).toBeGreaterThan(0);
    expect(html.slice(html.lastIndexOf('<details', start), start)).toContain('data-known-open=');
    for (const row of ['shipping', 'claims', 'sale']) expect(opening(new RegExp(`<details[^>]*id="good-section-${row}"[^>]*>`))).toContain('data-known-open=');
    /* 판매기간·구매 제한은 접지 않는 소항목이다(ADM-011·1027T-021). */
    for (const row of ['period', 'limits']) expect(html).toMatch(new RegExp(`<section aria-labelledby="good-section-${row}-title"[^>]*id="good-section-${row}"`));
    /* 오류가 있는 추가 설정 카드는 강제로 연다. */
    expect(opening(/<details[^>]*id="good-section-information"[^>]*>/)).toContain('open=""');
    expect(renderGoodSection(good).match(/<details[^>]*id="good-section-information"[^>]*>/)?.[0]).not.toContain('open=""');
    expect(opening(/<details[^>]*data-good-option-details=""[^>]*>/)).toContain('data-known-open="false"');
    expect(opening(/<details id="good-preview"[^>]*>/)).toContain('data-known-open="false"');
    expect(opening(/<details[^>]*data-good-save-info=""[^>]*>/)).toContain('data-known-open="false"');
  });

  /* 10/27 회의 R14 — 기본 입력 상태로 잠긴 운영 패널은 맨 위에 공통 이유를 보인다(서버 렌더는 확인 중 상태). */
  it('기본 입력 상태로 잠기는 운영 패널 5개는 패널 맨 위에 공통 잠금 이유를 둔다', () => {
    const html = renderGoodSection({ ...good, publishedAt: null }, {}, { accountId: 'operator-1' });
    const card = (id: string) => { const start = html.indexOf(`id="good-operation-${id}"`); return html.slice(start, html.indexOf('<details id="good-operation-', start + 1)); };
    for (const id of ['transaction-terms', 'shipping-charge-group', 'subscription-policy', 'fulfillment', 'production']) {
      expect(card(id)).toMatch(/data-good-operation-notice="" role="status"><p[^>]*>기본 상품의 입력 상태를 확인하고 있습니다.<\/p>/);
      /* 리뷰 T3a-7 — 패널 본문은 같은 문장을 되풀이하지 않고 위 안내를 가리킨다(한 패널에 이유가 두 번 나오지 않는다). */
      expect(card(id).split('기본 상품의 입력 상태를 확인하고 있습니다.')).toHaveLength(2);
    }
    expect(card('prices')).not.toContain('data-good-operation-notice');
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
    /* 상세설명은 카드 안 접힘 없이 형식 선택과 입력을 바로 보인다. */
    expect(html).not.toContain('상세설명 편집');
    expect(html).toContain('name="detailImagePath"');
    expect(html).toContain('상세 이미지');
    /* 이미지 제약은 공유 업로드 계약(ADMIN_ARTWORK_ACCEPT)을 그대로 따른다. */
    expect(html.match(/accept="image\/jpeg,image\/png,image\/webp"/g)).toHaveLength(4);
    /* 그리드 안내 1회 + HTML 이미지 업로드 자체 안내 1회 */
    expect(html.match(/최대 20MB · 가로·세로 최대 30,000px/g)).toHaveLength(2);
  });

  /* 리뷰 재현: HTML 이미지 업로드가 그리드의 1:1(1000×1000) 권장을 설명으로 읽었다 — 긴 세로 상세 이미지에는 틀린 안내다. */
  it('HTML 이미지 업로드는 1:1 권장 대신 자기 파일 규격 안내만 설명으로 연결한다', () => {
    const html = renderGoodSection(null);
    const describedBy = (id: string) => html.match(new RegExp(`aria-describedby="(${id}[^"]*)"[^>]*data-artwork-input=""`))?.[1];

    expect(describedBy('good-description-image')).toBe('good-description-image-artwork-help good-description-image-artwork-guidance');
    expect(html).toContain('id="good-description-image-artwork-help"');
    expect(html).not.toMatch(/aria-describedby="[^"]*goods-image-upload-guidance[^"]*"[^>]*data-artwork-input=""/);
  });

  /* 리뷰 재현: 요약이 원문 길이만 보여 줘 정리된 코드가 30,000자를 넘어 저장이 거부될 때 이유를 알 수 없었다. */
  it('상세페이지 HTML 요약에 정리 후 길이를 함께 보여주고, 정리 결과가 상한을 넘으면 저장 전에 알린다', () => {
    const images = Array.from({ length: 100 }, (_, index) => `<img src="https://img.example.com/${index}.jpg">`).join('');
    const description = `<p>${'가'.repeat(GOODS_HTML_MAX_LENGTH - 5000)}</p>${images}`;
    const html = renderGoodSection(good, { attempt: 1, values: { previousId: good.id, descriptionFormat: 'html', description } });
    const cleaned = sanitizeGoodsDescription(description).html.length;

    expect(description.length).toBeLessThanOrEqual(GOODS_HTML_MAX_LENGTH);
    expect(cleaned).toBeGreaterThan(GOODS_HTML_MAX_LENGTH);
    expect(html).toContain(`상세페이지 HTML · 원문 ${description.length.toLocaleString('ko-KR')}자 · 정리 후 ${cleaned.toLocaleString('ko-KR')}자`);
    expect(html).toContain(`정리된 코드가 ${cleaned.toLocaleString('ko-KR')}자로 최대 ${GOODS_HTML_MAX_LENGTH.toLocaleString('ko-KR')}자를 넘어 저장할 수 없습니다.`);
  });

  /* 10/27 회의 R17 — 붙여넣은 상세 HTML이 잘리지 않게 글자 수 제한(maxLength)을 두지 않고, 상한은 공용 상수로 표시·경고한다. */
  it('상세 HTML 입력은 잘리지 않고 상한을 넘으면 저장 전에 경고한다', () => {
    const description = `<p>${'가'.repeat(GOODS_HTML_MAX_LENGTH + 10)}</p>`;
    const html = renderGoodSection(good, { attempt: 1, values: { previousId: good.id, descriptionFormat: 'html', description } });
    const textarea = html.match(/<textarea[^>]*name="description"[^>]*>/)?.[0];
    expect(textarea).toBeDefined();
    expect(textarea).not.toContain('maxLength');
    expect(html).toContain(`상세페이지 HTML (정리된 코드 포함 최대 ${GOODS_HTML_MAX_LENGTH.toLocaleString('ko-KR')}자)`);
    expect(html).toContain(`원문이 ${description.length.toLocaleString('ko-KR')}자로 최대 ${GOODS_HTML_MAX_LENGTH.toLocaleString('ko-KR')}자를 넘어 저장할 수 없습니다.`);
    /* 접힌 상세설명 카드(ADM-004)도 저장 전 확인할 안내가 있으면 처음부터 열어 둔다. */
    expect(html.match(/<details id="good-section-description"[^>]*>/)?.[0]).toContain('open=""');
    expect(renderGoodSection(good).match(/<textarea[^>]*name="description"[^>]*>/)?.[0]).toContain('maxLength="2000"');
  });

  /*
   * 복잡도 측정(카드 36개·필수 12개가 첫 화면에 0개)의 후속 — 카드별 남은 필수 입력과 저장 막대의 공개까지 남은 수를 보인다.
   * 사람 눈 테스트 2라운드: 저장된 상품에도 같은 입력 완료 표시를 보이고, 공개까지 남은 수만 초안에 둔다.
   * 3라운드: 빈 화면의 빨간 "N개 남음"이 7곳이라 오류처럼 보였다. 진행은 이동 띠 한 곳에 조용히 두고, 빨강은 저장에 실패한 칸에만 쓴다.
   */
  it('이동 띠 한 곳에 남은 필수 입력을 조용히 보이고, 공개 뒤에는 입력 완료 표시만 같게 남는다', () => {
    const create = renderGoodSection(null);
    const count = (html: string, id: string) => html.match(new RegExp(`href="#good-section-${id}"[^]*?data-good-card-remaining="(\\d+)"`))?.[1];
    expect(count(create, 'basic')).toBe('3');
    expect(count(create, 'images')).toBe('1');
    expect(create).toMatch(/data-good-publish-remaining="\d+"[^>]*>공개까지 필수 \d+개 남음/);
    expect(create).toContain('필수 입력 남음');
    /* 숫자만 두면 오류 수로 읽힌다 — 이동 띠도 남은 수임을 글자로 말한다. */
    const nav = create.slice(create.indexOf('data-good-workspace-nav'), create.indexOf('</nav>'));
    expect(nav).toContain('>3개 남음<');
    /* 입력 전에는 잘못한 것이 없다: 이동 띠·저장 막대 어디에도 빨강이 없고, 카드 머리에는 진행 표시를 되풀이하지 않는다. */
    expect(create).not.toContain('data-tone="danger"');
    expect(nav).toContain('data-tone="neutral"');
    expect(create.slice(create.indexOf('id="good-section-basic"'))).not.toContain('data-good-card-remaining');
    const remainingButton = create.match(/<button[^>]*data-good-publish-remaining="\d+"[^>]*>/)?.[0] ?? '';
    expect(remainingButton).toContain('text-muted-foreground');
    expect(remainingButton).not.toContain('text-destructive');
    /* 필수 항목이 없는 카드는 끝난 건지 선택인지 모호하지 않게 선택이라고 쓰고, 지금 보는 카드에 현재 위치를 표시한다. */
    const links = [...nav.matchAll(/<a [^]*?<\/a>/g)].map(([link]) => link);
    expect(links.map((link) => link.includes('>선택<'))).toEqual([false, false, false, true, false, false, true]);
    expect(links.map((link) => link.includes('aria-current="location"'))).toEqual([true, false, false, false, false, false, false]);
    /* 저장에 실패한 칸만 빨강이다. 다른 카드의 남은 표시는 조용한 채로 둔다. */
    const failed = renderGoodSection(null, { errors: { regularPrice: '판매가를 입력해주세요.', name: '상품명을 입력해주세요.' } });
    const failedNav = failed.slice(failed.indexOf('data-good-workspace-nav'), failed.indexOf('</nav>'));
    expect(failedNav.match(/data-tone="danger"/g)).toHaveLength(2);
    expect(failedNav).toContain('>1개 확인<');
    expect(failedNav).toContain('data-tone="neutral"');
    /* 공개 중인 상품의 공개까지 남은 수는 숨기고(공개 조건은 이미 서버가 확인했다), 입력 완료 표시는 초안과 같다. */
    const published = renderGoodSection(good);
    expect(published).not.toContain('data-good-publish-remaining');
    expect(count(published, 'basic')).toBe('0');
    expect(published.slice(published.indexOf('data-good-workspace-nav'), published.indexOf('</nav>'))).toContain('필수 입력 완료');
    /* 보관 상품은 고칠 수 없어 진행 표시를 두지 않는다. */
    expect(renderGoodSection({ ...good, archivedAt: '2026-10-01T00:00:00Z' })).not.toContain('data-good-card-remaining');
  });

  it('저장 막대는 저장하기·미리보기·임시저장 메뉴·취소로 줄이고 불러오기는 메뉴에 묶는다', () => {
    const create = renderGoodSection(null);
    const bar = create.slice(create.indexOf('data-good-workspace-save'), create.indexOf('</form>'));
    expect(bar).toContain('aria-label="임시저장 메뉴"');
    expect(bar).toMatch(/data-good-draft-button=""[^>]*>임시저장</);
    expect(bar).not.toContain('>임시저장 불러오기<');
    expect(bar).not.toContain('>새 임시저장으로 저장<');
    for (const label of ['미리보기', '저장하기', '취소']) expect(bar).toContain(label);
    /* 탭이 하나뿐이면 탭 줄을 그리지 않는다. */
    expect(create).not.toContain('data-good-editor-tabs');
  });

  /* 사람 눈 테스트 3라운드 — 목록·복사등록·동영상 링크가 한 줄씩 쌓여 입력이 늦게 시작했다. 다른 등록 화면처럼 제목 줄 오른쪽에 묶는다. */
  it('목록·복사등록·동영상 관리는 화면 머리 오른쪽 한 줄에 묶는다', () => {
    const header = (html: string) => html.slice(html.indexOf('data-admin-kit="page-header"'), html.indexOf('</header>', html.indexOf('data-admin-kit="page-header"')));
    const create = header(renderGoodSection(null, {}, { accountId: 'operator-1', canManageMedia: true }));
    expect(create).toContain('상품 등록');
    expect(create).toMatch(/data-good-copy-entry=""[^]*?기존 상품으로 복사등록[^]*?href="\/admin\/catalog\/goods"[^]*?상품 목록으로/);
    expect(create).not.toContain('동영상·숏클립 관리');
    const edit = header(renderGoodSection(good, {}, { accountId: 'operator-1', canManageMedia: true }));
    expect(edit).toContain(good.name);
    expect(edit).toContain(`>${good.id}<`);
    expect(edit).toContain('href="/admin/catalog/goods/media?goodId=g100"');
    expect(edit).toContain('상품 목록으로');
    expect(edit).not.toContain('data-good-copy-entry');
    /* 동영상 관리 링크는 권한이 있을 때만 그린다. */
    expect(header(renderGoodSection(good))).not.toContain('동영상·숏클립 관리');
  });

  /* 사람 눈 테스트 2라운드 — 별표와 "(필수)"가 섞여 있었다. 카드의 "필수 N개 남음"과 같은 말인 "(필수)" 하나로 통일하고, 남은 수에 세는 칸에는 모두 붙인다. */
  it('필수 표시는 (필수) 하나로 통일하고 남은 수에 세는 칸에 모두 붙인다', () => {
    const create = renderGoodSection(null);
    expect(create).not.toContain('aria-label="필수"');
    expect(create).not.toContain('필수항목');
    for (const label of ['상품명 (필수)', '연결 IP (필수)', '상품 유형 (필수)', '판매가 (필수)', '재고수량 (필수)', '대표이미지 (필수)', '출고지 (필수)', ...GOODS_NOTICE_FIELDS.map((field) => `${field.label} (필수)`)]) expect(create).toContain(label);
  });

  /* 10/27 회의 R21(D9①) — 그룹상품 등록은 메뉴·탭에서 숨기고 라우트만 유지한다. */
  it('등록 화면 탭에 그룹상품 등록 링크를 두지 않는다', () => {
    const html = renderGoodSection(null);
    expect(html).toContain('상품 등록');
    expect(html).not.toContain('groups/new?mode=assemble');
    expect(html).not.toContain('그룹상품 등록</a>');
  });

  /* R21: 편집기 탭의 그룹상품 등록 링크는 메뉴 숨김(navHidden)과 한 값으로 묶는다. 기존 그룹은 주소로 계속 열린다. */
  it('그룹상품 등록 탭은 메뉴 숨김과 짝을 이루고, 숨겨도 그룹상품 화면은 주소로 열린다', () => {
    const create = ADMIN_SCREENS.find((screen) => screen.id === 'goods-groups-create')!;
    expect(create.navHidden).toBe(true);
    expect(groupGoodsEntryVisible()).toBe(false);
    expect(groupGoodsEntryVisible(ADMIN_SCREENS.map((screen) => screen.id === create.id ? { ...screen, navHidden: false } : screen))).toBe(true);
    expect(groupGoodsEntryVisible(ADMIN_SCREENS.filter((screen) => screen.id !== create.id))).toBe(false);
    expect(adminScreenForPath('/admin/catalog/groups/new?mode=assemble')?.id).toBe('goods-groups-create');
    expect(adminScreenForPath('/admin/catalog/groups/11111111-1111-4111-8111-111111111111')?.id).toBe('goods-groups');
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
    expect(card).toContain('data-good-section-title="">판매 정보');
    expect(card).toMatch(/<input[^>]*name="regularPrice"[^>]*value="26000"/);
    expect(card).toMatch(/<input type="radio" name="discountEnabled" checked="" value="true"\/>설정함/);
    expect(card).toMatch(/<input[^>]*name="discountValue"[^>]*value="4000"/);
    expect(card).toMatch(/할인가 <strong[^>]*>22,000원<\/strong> \(4,000원, 15% 할인\)/);
    expect(card).toContain('<input type="hidden" name="price" value="22000"/>');
    expect(card).toContain('<input type="hidden" name="compareAtPrice" value="26000"/>');
    /* 할인율 표시는 기간 할인에도 쓰여 추가 설정으로 옮겼다. */
    expect(card).not.toContain('고객 화면에 할인율 표시');
    expect(html.slice(html.indexOf('id="good-section-information"'))).toContain('name="showDiscountRate"');
    for (const legacy of ['기준 판매가', '소비자가', '옵션 판매가', '추가금액']) expect(card).not.toContain(legacy);
  });

  it('새 상품은 할인 설정안함·빈 판매가로 시작하고 서버 가격 오류를 해당 칸에 붙인다', () => {
    const fresh = renderGoodSection(null);
    const card = fresh.slice(fresh.indexOf('id="good-section-price"'), fresh.indexOf('id="good-section-variants"'));
    expect(card).toMatch(/<input type="radio" name="discountEnabled" checked="" value="false"\/>설정안함/);
    expect(card).toMatch(/<input[^>]*name="regularPrice"[^>]*value=""/);
    expect(card).toContain('<input type="hidden" name="compareAtPrice" value=""/>');
    expect(card).toContain('data-good-price-discount="" hidden=""');

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
    expect(html).toMatch(/할인가 <strong[^>]*>8,415원<\/strong> \(1,485원, 15% 할인\)/);
  });

  it('재고수량·옵션 카드는 옵션 없는 상품의 재고수량을 먼저 보여준다', () => {
    const html = renderGoodSection(good);
    const card = html.slice(html.indexOf('id="good-section-variants"'), html.indexOf('id="good-section-notice"'));
    expect(card).toContain('재고수량 / 옵션</h4>');
    expect(card).toContain('옵션 없음 · 재고수량 12개');
    expect(card.indexOf('for="goods-single-stock">재고수량')).toBeLessThan(card.indexOf('>옵션</legend>'));
    /* 섹션 이동 띠는 14개 링크에서 카드 7개로 줄었다. */
    const nav = html.slice(html.indexOf('data-good-workspace-nav'), html.indexOf('</nav>', html.indexOf('data-good-workspace-nav')));
    for (const label of ['1. 기본 정보', '2. 판매 정보', '3. 상품이미지', '4. 상세설명', '5. 고시·KC', '6. 배송·반품·결제', '7. 추가 설정']) expect(nav).toContain(label);
    expect(nav.match(/<a /g)).toHaveLength(7);
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
