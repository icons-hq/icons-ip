import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { Ip } from '@/lib/data';
import { GoodSection } from './sections/GoodSection';
import { GoodsKcTemplateProvider } from './useGoodsKcTemplate';

/* 2026-11-25 트랙 D-a: 상품 편집기 본문의 이름·안내·미리보기. 문구가 늘거나 옛 말투로 돌아가지 않게 화면에 보이는 모양으로 확인한다. */
vi.mock('@/app/admin/actions', () => ({ adjustAdminStockAction: vi.fn() }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../app/admin/archive-actions', () => ({ archiveAdminCatalogRecordAction: vi.fn(), unarchiveAdminCatalogRecordAction: vi.fn() }));
vi.mock('../../app/admin/good-bank-transfer-actions', () => ({ setGoodBankTransferAction: vi.fn() }));
vi.mock('../../app/admin/good-sale-restriction-actions', () => ({ setGoodSaleRestrictionAction: vi.fn() }));
vi.mock('../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({ items: [], count: 0, ready: true, mode: 'server' as const, pending: false, error: null, getQuantity: () => 0, add: vi.fn(), setQuantity: vi.fn(), remove: vi.fn(), refresh: vi.fn(), resetForSignOut: vi.fn() }),
}));

const hwasan: Ip = { id: 'hwasan', title: '화산강림', sub: 'ORIGINAL IP', v: { key: 'webtoon', label: '웹툰', color: '#38F0C0' }, glyph: '火', bg: 'linear-gradient(#111, #222)', fans: 0, goods: 1, cards: 0, featured: false, tagline: '불꽃처럼', synopsis: '화산강림 세계관' };
const category: AdminCategoryNode = { id: '33333333-3333-4333-8333-333333333333', code: 'acrylic', name: '아크릴 굿즈', parentId: null, depth: 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 1 };
const good: AdminGoodRecord = {
  id: 'g100', categoryId: category.id, code: 'HW-0100', publishedAt: null, firstPublishedAt: null, archivedAt: null, ipId: 'hwasan', name: '화산강림 아크릴 스탠드',
  price: 10000, compareAtPrice: null, badge: 'NEW', stock: 'low', stockQty: 12, allowBankTransfer: true, saleRestriction: 'none', bg: null, imagePath: null,
  notice: { maker: '주식회사 아이콘스', origin: '대한민국', material: '아크릴', size: '80 x 60 x 20mm · 90g', madeOn: '2026-07', asManager: '엑스스퀘어 고객센터', asContact: '02-000-0000' },
  description: '붉은 실을 따라 놓인 아크릴 블록입니다.', galleryPaths: [], galleryUrls: [], detailImagePaths: [], detailImageUrls: [],
};
const period = (startsAt: string, endsAt: string) => ({ state: 'editable' as const, reason: null, fingerprint: 'fp', period: { amount: 1000, startsAt, endsAt }, promotions: [],
  summary: { count: 1, minPrice: 9000, maxPrice: 9000, startsAt, endsAt } });

function render(selected: AdminGoodRecord | null, state: Parameters<typeof GoodSection>[0]['state'] = {}) {
  return renderToStaticMarkup(
    <GoodsKcTemplateProvider selectionKey={selected ? `good:${selected.id}` : 'create:any'}>
      <GoodSection action={vi.fn()} adjustmentId="11111111-1111-4111-8111-111111111111" catalogIps={[hwasan]} ipOptions={[{ id: 'hwasan', title: '화산강림', archivedAt: null }]}
        onSelect={vi.fn()} pending={false} records={selected ? [selected] : [good]} selected={selected} state={state} categories={[category]}
        variants={selected ? [{ id: '11111111-1111-4111-8111-111111111111', goodId: selected.id, name: '기본 옵션', code: 'HW-0100-01', price: selected.price, stockQty: selected.stockQty, isDefault: true, archivedAt: null }] : []} />
    </GoodsKcTemplateProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, '').replaceAll('&#x27;', "'");
const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));

describe('상품 편집기 본문 문구', () => {
  it('재고수량 / 옵션 제목 옆에 옵션 도움말 "?"가 있다', () => {
    const card = between(render(good), 'id="good-section-variants"', 'id="good-section-period"');
    expect(card).toContain('재고수량 / 옵션</h2>');
    expect(card).toMatch(/재고수량 \/ 옵션<\/h2><button[^>]*aria-label="재고수량 \/ 옵션 도움말"[^>]*data-admin-help=""/);
  });

  it('판매상태를 고르면 고객 화면과 구매에서 달라지는 점을 한 줄로 말한다', () => {
    const effect = (stock: string) => text(between(render({ ...good, stock: stock as AdminGoodRecord['stock'] }), 'data-good-stock-effect=""', '</p>'));
    expect(effect('ok')).toContain('정상으로 판매합니다. 재고수량이 0이 되면 자동으로 품절로 보입니다.');
    expect(effect('low')).toContain('구매는 그대로 되고, 장바구니에 남은 재고가 보입니다. 재고가 줄어도 자동으로 바뀌지 않아 직접 고릅니다.');
    expect(effect('soldout')).toContain('재고가 있어도 고객 화면에 품절로 보이고 살 수 없습니다. 다시 팔려면 정상 판매로 바꿉니다.');
    /* 선택지 이름은 가이드·엑셀과 같다. */
    const html = render(good);
    expect(html).toContain('<option value="ok">정상 판매</option>');
    expect(html).toContain('<option value="low" selected="">소량 재고</option>');
    expect(html).toContain('<option value="soldout">판매 중지</option>');
  });

  it('영문 상품명은 예시와 보이는 곳을, 검색 키워드는 한 줄만 말하고 따로 문단을 두지 않는다', () => {
    const html = render(good);
    expect(html).toContain('placeholder="예: Red String Keyring"');
    expect(text(html)).toContain('상품 상세의 상품명 아래에 보이고, 검색에도 쓰입니다.');
    expect(html).toContain('placeholder="한 줄에 하나, 또는 쉼표로 구분 (예: 키링, 아크릴)"');
    expect(text(html)).toContain('고객·어드민 검색에만 쓰이고 상세 화면에는 보이지 않습니다.');
    expect(text(html)).not.toContain('고객 통합 검색과 어드민 상품 검색에만 쓰이며');
  });

  it('직접입력형은 개념을 "?"에 두고 상품 자동코드는 잠겨 있을 때 한 줄만 말한다', () => {
    const extra = between(render(good), 'id="good-section-information"', 'data-good-workspace-save');
    expect(extra).toContain('aria-label="직접입력형 도움말"');
    expect(text(extra)).not.toContain('각인 문구처럼 고객이 직접 입력할 내용을 받습니다');
    expect(text(extra)).toContain("출고지시 엑셀의 '상품코드' 열에 찍히고 고객 화면 주소 끝에도 쓰입니다.");
    expect(text(extra)).not.toContain('바코드·ERP 코드는 여기에 넣지');
    expect(text(extra)).not.toContain('바꾸기 전 주소로 들어온 고객');
  });

  it('HTML 상세설명 안내는 필요한 사실만 두 줄로 줄였고, 이미지 설명은 무엇인지 예시로 보인다', () => {
    const html = render(good, { values: { previousId: good.id, descriptionFormat: 'html', description: '<p>본문</p>' } });
    const tools = between(html, 'data-good-html-tools=""', 'id="good-section-notice"');
    expect(text(tools)).toContain('다른 판매처의 상세페이지 HTML을 그대로 붙여넣을 수 있습니다. 스크립트와 임의 CSS는 지워집니다.');
    expect(text(tools)).toContain('https 이미지 주소는 올리지 않아도 그대로 쓰이며, 그 주소의 이미지를 바꾸면 상세페이지도 바뀝니다. http 주소는 https로 바꿔 저장합니다. 이미지는 최대 20장입니다.');
    expect(text(tools).match(/최대 20장/g)).toHaveLength(1);
    expect(tools).toContain('이미지 설명 (선택)');
    expect(tools).toContain('placeholder="예: 빨간 실이 감긴 아크릴 키링 앞면"');
    for (const old of ['HTML 이미지 대체 설명', '임의 CSS·스크립트·이벤트는 제거됩니다', '호스팅하지 않은 이미지만 파일을']) expect(html, old).not.toContain(old);
  });

  it('배송비 유형은 선택 카드이고 안내 템플릿 선택지에는 코드와 버전이 보이지 않는다', () => {
    const delivery = between(render(good), 'id="good-section-delivery"', 'id="good-section-information"');
    expect(delivery).toContain('data-good-choice="cards"');
    expect(delivery).not.toMatch(/<select[^>]*name="shippingFeeType"/);
    expect(text(delivery)).not.toMatch(/ v\d+<|· [A-Z_]+ v\d/);
  });

  it('미리보기는 짧은 안내만 두고, 특정기간 할인이 시작 전이면 할인이 아직 안 나오는 까닭을 알린다', () => {
    const base = render(good);
    expect(text(base)).toContain('지금 입력한 내용으로 그린 화면입니다. 미리보기를 열어도 저장된 상품은 바뀌지 않습니다. KC 표는 검토를 마치고 저장한 내용만 나옵니다.');
    expect(text(base)).not.toContain('KC 검토가 풀려');
    expect(text(base)).not.toContain('할인 시작 전이라');
    const future = render({ ...good, instantDiscount: period('2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z') });
    expect(text(future)).toContain('할인 시작 전이라 미리보기에는 아직 할인이 나오지 않습니다.');
  });

  it('특정기간만 할인이 지금 기간 안이면 저장 전 미리보기에 정가·할인율·할인가가 나온다', () => {
    const active = render({ ...good, instantDiscount: period('2020-01-01T00:00:00Z', '2099-02-01T00:00:00Z') });
    const preview = active.slice(active.indexOf('data-good-preview'));
    expect(preview).toContain('<span class="wc-price__rate">10%</span>');
    expect(preview).toContain('₩9,000');
    expect(preview).toContain('<s class="wc-price__original">₩10,000</s>');
    expect(text(active)).not.toContain('할인 시작 전이라');
  });
});
