import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { GoodsListScreen } from './GoodsListScreen';
import { GoodsInlineDialogHost, GoodsInlineDialogNotice } from '../GoodsInlineDialogHost';
import { GoodsListFiltersForm } from './GoodsListFiltersForm';
import { GoodsListDateRange } from './GoodsListDateRange';
import { GoodsListQueryField } from './GoodsListQueryField';
import { MarketingLinksGoodsGrid } from '../marketing/MarketingLinksGoodsGrid';
import { GOODS_READINESS_REASONS, unknownGoodsReadiness, type GoodsReadinessReasonCode } from '@/lib/admin/goods-readiness';
import { goodEditorHref, goodsListDateRangeFromEnd, goodsListDateRangeFromStart, normalizeGoodsListFilters } from '@/lib/admin/goods-list';
import { GOODS_LIST_HELP } from '@/lib/admin/help/goods-list';

/* 상품 URL 열은 기본으로 숨겨 줄에 그 값이 글자로 나오지 않는다 — 줄은 수정 화면 링크의 goodId로 찾는다. */
const rowOf = (html: string, id: string) => (html.split('<tr').find(part => new RegExp(`goodId=${id}["#]`).test(part)) ?? '').split('</tr>')[0];

describe('goods list screen', () => {
  it('상품 관리 권한과 현재 세션이 있으면 판매가·재고수량·판매상태를 목록에서 바로 고치고, IP 필터에서는 IP 전체 기간 할인을 연다', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    const good = { id: 'good-a', code: 'A', name: '상품 A', ipId: 'maple', ipTitle: '메이플', publishedAt: null, archivedAt: null, stock: 'ok' as const, stockQty: 7,
      activeStockQty: 7, lowStockOptionCount: 0, noticeComplete: true, priceMin: 10000, priceMax: 10000, basePrice: 10000, activeVariantCount: 1,
      inlineStock: { variantId: 'b9000000-0000-4000-8000-000000000010', stockQty: 7 } };
    const multi = { ...good, id: 'good-b', activeVariantCount: 3, inlineStock: null, compareAtPrice: 15000 };
    const discounted = { ...good, id: 'good-c', activeDiscountEndsAt: '2026-10-30T00:00:00Z' };
    const data = { filters: normalizeGoodsListFilters({ ipId: 'maple' }), goods: [good, multi, discounted], ips: [{ id: 'maple', title: '메이플', archivedAt: null }], total: 3 };
    const html = renderToStaticMarkup(<GoodsListScreen data={data} canIssueMarketingLinks bulkIdentity={identity} />);
    for (const label of ['판매가 10,000원 바로 수정', '판매상태 공개 시 판매중 바로 수정', '재고수량 7개 바로 수정']) expect(html).toContain(`aria-label="${label}"`);
    // 판매가 바로 수정은 할인이 없을 때만이다. 기간 없는 즉시할인(정가 표시) 상품도 같은 칸이 '할인 중지 후 변경' 창을 연다(TKT-033).
    expect(html.match(/판매가 [^"]*바로 수정/g)).toHaveLength(1);
    expect(html).not.toContain('상품 할인 중 · 판매가는 상품 수정에서 변경');
    expect(html).toContain('즉시할인 중</small>');
    // 진행 중이거나 예정된 기간 할인이 있는 상품은 같은 칸이 '할인 중지 후 변경' 창을 연다(1027T-025).
    expect(html.match(/aria-label="판매가 10,000원 할인 중지 후 변경"/g)).toHaveLength(2); expect(html).toContain('기간 할인 있음');
    expect(html.match(/재고수량 [^"]*바로 수정/g)).toHaveLength(2);
    // 옵션을 읽지 못한(옵션별 재고 값이 없는) 여러 옵션 상품은 상세 재고 안의 상품 수정 링크로 고친다.
    expect(html).toContain('옵션별 재고 수정');
    expect(html).toContain('IP 전체 기간 할인');
    const readOnly = renderToStaticMarkup(<GoodsListScreen data={data} bulkIdentity={identity} />);
    expect(readOnly).not.toContain('바로 수정'); expect(readOnly).not.toContain('IP 전체 기간 할인');
    expect(readOnly).not.toContain('할인 중지 후 변경');
  });
  it('옵션별 재고·할인 중지 창은 표 안이 아니라 화면 수준에서 열린다 — 표의 최소 폭·칸 굵기가 창에 걸리지 않고, 상품이 목록에서 빠져도 창이 남는다(리뷰 02·21·22·60)', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    type Node = ReactElement<Record<string, unknown>>;
    const walk = (value: ReactNode): Node[] => Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...walk(node.props.children as ReactNode)] : []);
    const data = { filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0 };
    const tree = GoodsListScreen({ data, canIssueMarketingLinks: true, bulkIdentity: identity }) as Node;
    // 화면 뿌리(section) 바로 안에 창 주인이 있고, 표(그리드)는 그 안의 한 자식일 뿐이다 — 창은 주인이 표 밖에 그린다.
    const host = Children.only(tree.props.children as ReactNode) as Node;
    expect(host.type).toBe(GoodsInlineDialogHost);
    expect(host.props.identity).toEqual(identity);
    const inside = walk(host.props.children as ReactNode);
    const grid = inside.find(node => typeof node.props.className === 'string' && (node.props.className as string).includes('[&>.relative_table]:min-w-[1012px]'));
    expect(grid).toBeTruthy();
    /* QA G1: 최소 폭은 목록 표에만 건다. 뿌리 아래 모든 table에 걸면(`[&_table]`) 작업 막대가 여는 일괄 변경 창의 표까지 1012px가 되어
       576px 창에서 '변경 후'(건너뛴 이유) 열이 보이지 않는다. */
    expect(grid!.props.className as string).not.toMatch(/\[&_table\]:min-w/);
    expect(walk(grid!.props.children as ReactNode).some(node => node.type === GoodsInlineDialogHost)).toBe(false);
    // 모두 저장하고 닫힌 창의 결과 문구는 표 밖, 목록 위에 남는다.
    expect(inside.find(node => node.type === GoodsInlineDialogNotice)?.props.listedGoodIds).toEqual([]);
    // 상품 관리 권한이 없으면 창 주인은 세션을 받지 않는다(할인 창은 열 수 없다).
    const readOnly = GoodsListScreen({ data, bulkIdentity: identity }) as Node;
    expect((Children.only(readOnly.props.children as ReactNode) as Node).props.identity).toBeUndefined();
  });
  it('옵션이 여러 개인 상품의 재고 칸은 칸 전체가 옵션별 재고 창을 열고, 기간 없는 즉시할인과 진행 중 즉시할인이 함께 있어도 할인 중지 후 변경 창을 연다(1014-106·1027T-025·TKT-033)', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    const ready = { ...unknownGoodsReadiness(), state: 'ready' as const, publication: 'published' as const, operation: 'active' as const, availableQty: 12, reasons: [] };
    const options = [{ variantId: 'b9000000-0000-4000-8000-000000000021', name: '블루', code: 'OPT-B', stockQty: 5 }, { variantId: 'b9000000-0000-4000-8000-000000000022', name: '레드', code: 'OPT-R', stockQty: 4 },
      { variantId: 'b9000000-0000-4000-8000-000000000023', name: '그린', code: 'OPT-G', stockQty: 3 }];
    const multi = { id: 'good-m', code: 'M', name: '옵션 상품', ipId: 'maple', ipTitle: '메이플', publishedAt: '2026-10-01T00:00:00Z', archivedAt: null, stock: 'ok' as const, stockQty: 12,
      activeStockQty: 12, lowStockOptionCount: 0, noticeComplete: true, priceMin: 10000, priceMax: 10000, basePrice: 10000, activeVariantCount: 3, inlineStock: null, inlineOptions: options, readiness: ready };
    const both = { ...multi, id: 'good-both', compareAtPrice: 15000, activeDiscountEndsAt: '2026-11-20T00:00:00Z' };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [multi, both], ips: [], total: 2 }} canIssueMarketingLinks bulkIdentity={identity} />);
    const row = (id: string) => rowOf(html, id);
    // 칸을 채우는 값 버튼(R11)이고, 보이는 글자에 '옵션별 재고'가 있다. 창은 누르기 전에는 그리지 않는다.
    expect(row('good-m')).toMatch(/data-inline-edit="cell"><button[^>]*aria-label="재고수량 12개 옵션별 재고 수정"/);
    expect(row('good-m')).toContain('옵션별 재고</small>');
    expect(html).not.toContain('<dialog');
    // 옵션별 재고 창이 있으면 상세 재고 안의 상품 수정 링크는 두지 않는다(창 안에서 상품 수정으로 간다).
    expect(row('good-m')).not.toContain('#good-section-variants">옵션별 재고 수정');
    // 기간 없는 즉시할인과 진행 중인 즉시할인이 함께 있으면 창이 둘 다 멈춘 뒤 판매가(할인 전 판매가 기준)를 바꾼다(TKT-033 includeInstant).
    expect(row('good-both')).toContain('aria-label="판매가 10,000원 할인 중지 후 변경"');
    expect(row('good-both')).toContain('즉시할인 중</small>');
    expect(row('good-both')).not.toContain('상품 할인 중</a>');
  });
  it('R11: 판매가·재고수량은 칸 전체가 바로 수정이고, 같은 칸의 보조 링크는 덮개 위에 남는다', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    const good = { id: 'good-a', code: 'A', name: '상품 A', ipId: 'maple', ipTitle: '메이플', publishedAt: null, archivedAt: null, stock: 'ok' as const, stockQty: 7,
      activeStockQty: 7, lowStockOptionCount: 0, noticeComplete: true, priceMin: 10000, priceMax: 10000, basePrice: 10000, activeVariantCount: 1,
      inlineStock: { variantId: 'b9000000-0000-4000-8000-000000000010', stockQty: 7 } };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [good], ips: [], total: 1 }} canIssueMarketingLinks bulkIdentity={identity} />);
    // 판매가·재고수량 값 버튼은 칸을 채우는 덮개형(data-inline-edit="cell")이고, 다른 링크와 한 칸을 쓰는 판매상태는 그 줄만 채운다.
    // 덮개가 감싼 칸을 기준 상자로 세우는 방식(틀고정 칸은 sticky 그대로)과 인쇄는 components/admin/GoodsInlineEdit.test.tsx가 확인한다.
    const cellOf = (label: string) => new RegExp(`data-inline-edit="(cell|value)"><button[^>]*aria-label="${label} [^"]*바로 수정"`).exec(html)?.[1];
    expect([cellOf('판매가'), cellOf('재고수량'), cellOf('판매상태')]).toEqual(['cell', 'cell', 'value']);
    // 같은 칸의 보조 링크(옵션별 재고 수정 등)는 덮개 위에 남는다.
    const multi = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [{ ...good, id: 'good-b', activeVariantCount: 3, inlineStock: null }], ips: [], total: 1 }} canIssueMarketingLinks bulkIdentity={identity} />);
    expect(multi).toMatch(/<a class="[^"]*relative z-\[1\][^"]*" href="[^"]*#good-section-variants">옵션별 재고 수정<\/a>/);
  });
  it('좁은 화면에서도 체크박스 칸이 접히지 않는다 — 칸 전체가 선택 영역이라 머리칸 최소 폭과 표 최소 폭을 준다', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0 }} canIssueMarketingLinks={false} />);
    // 체크박스 label은 칸을 덮는 절대 배치라 내용 폭이 없다. 자동 표 배치에서 표가 좁아지면 이 칸부터 0px로 접혀 누를 곳이 사라진다.
    const grid = html.match(/<div class="([^"]*)" data-console-grid="">/)?.[1] ?? '';
    expect(grid.split(' ')).toEqual(expect.arrayContaining(['[&amp;_thead_th:first-child]:min-w-10', expect.stringMatching(/^\[&amp;&gt;\.relative_table\]:min-w-\[\d+px\]$/)]));
  });
  it('shows server status counts independently of the filtered total and exposes real list controls', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({ status: 'draft', from: '2026-10-01', pageSize: '50', image: 'without' }), goods: [], ips: [], total: 3, pageSize: 50, counts: { all: 20, active: 15, draft: 3, published: 12, archived: 5 } }} />);
    expect(html).toContain('상품등록일');
    expect(html).toContain('상품수정일');
    expect(html).toContain('name="from"');
    expect(html).toContain('name="originId"');
    expect(html).toContain('name="image"');
    expect(html).toContain('aria-label="상품 목록수"');
    // 상태별 건수 카드: 링크 이름이 '상태 n건'이고 카드에 그 수가 보인다(서버 집계, 필터 결과 총수와 별개).
    expect(html).toMatch(/aria-label="공개 12건"[^>]*>[\s\S]*?<strong[^>]*>12</);
    expect(html).toMatch(/aria-label="전체 20건"[^>]*>[\s\S]*?<strong[^>]*>20</);
    expect(html).toMatch(/상품목록 <span[^>]*>\(총 <strong[^>]*>3<\/strong>개\)<\/span>/);
    expect(html).not.toContain('wc-admin-kit__page-header');
    expect(html).toContain('create=1');
    // 엑셀은 가는 곳마다 버튼 하나다: 올려서 등록·수정, 지금 조회 조건 그대로 내려받기. 같은 화면으로 가는 버튼을 둘 두지 않는다.
    const actions = html.split('data-goods-list="actions"')[1]?.split('data-goods-list="status"')[0] ?? '';
    expect(actions.match(/<a /g)).toHaveLength(3);
    expect(actions).toMatch(/<a [^>]*href="\/admin\/catalog\/goods\/import"[^>]*>엑셀로 등록·수정<\/a>/);
    expect(actions).toMatch(/<a (?=[^>]*data-goods-list="export")(?=[^>]*href="\/admin\/catalog\/goods\/export\?status=draft[^"]*from=2026-10-01[^"]*image=without")[^>]*>엑셀로 내려받기<\/a>/);
    expect(html.match(/href="\/admin\/catalog\/goods\/import"/g)).toHaveLength(1);
    // 내려받는 범위(지금 검색 조건 전체)는 버튼 이름 대신 말풍선이 말한다.
    expect(actions).toContain('title="지금 검색 조건에 맞는 상품을 모두 내려받습니다."');
    for (const stale of ['상품 일괄등록·수정', '엑셀 일괄작업', '현재 필터 전체 내보내기']) expect(html).not.toContain(stale);
    // R21: 그룹상품 탭 링크는 숨긴다(라우트는 그대로).
    expect(html).not.toContain('href="/admin/catalog/groups"');
    /* 전환할 탭이 하나뿐이면 탭 줄을 그리지 않는다(외톨이 탭 제거). */
    expect(html).not.toContain('aria-label="상품 관리 화면"');
    expect(html).toContain('from=2026-10-01');
  });
  it('상세 조건을 하단 검색 동작 앞에 유지하고 지정된 조건이 있으면 펼친다', () => {
    const render = (values: Record<string, string>) => renderToStaticMarkup(<GoodsListFiltersForm data={{
      filters: normalizeGoodsListFilters(values), goods: [], ips: [], total: 0,
      origins: [{ id: '11111111-1111-4111-8111-111111111111', name: '기본 출고지', active: true }],
    }} />);
    const active = render({ image: 'without', payment: 'bank', saleType: 'preorder', restriction: 'adult', originId: '11111111-1111-4111-8111-111111111111' });
    expect(active).toMatch(/<details[^>]*data-goods-search="advanced"[^>]*open=""/);
    expect(active).toContain('value="without" selected=""');
    expect(active).toContain('value="bank" selected=""');
    expect(active).toContain('value="preorder" selected=""');
    expect(active).toContain('value="adult" selected=""');
    expect(active).toContain('value="11111111-1111-4111-8111-111111111111" selected=""');
    expect(active.indexOf('name="image"')).toBeLessThan(active.indexOf('type="submit"'));
    expect(active).toContain('href="/admin/catalog/goods">초기화');
    expect(render({})).toMatch(/<details[^>]*data-goods-search="advanced"/);
    expect(render({})).not.toMatch(/<details[^>]*data-goods-search="advanced"[^>]*open=""/);
  });
  it('판매상태 필터는 품절과 판매중지를 따로 고르고, 이전 주소(stock=soldout)는 둘 다 찾는 선택지로 보여 준다(MD-0026)', () => {
    const form = (stock: string) => renderToStaticMarkup(<GoodsListFiltersForm data={{ filters: normalizeGoodsListFilters({ stock }), goods: [], ips: [], total: 0 }} />);
    const stopped = form('stopped');
    expect(stopped).toContain('<option value="out_of_stock">품절</option>');
    expect(stopped).toContain('<option value="stopped" selected="">판매중지</option>');
    expect(stopped).toContain('<option value="soldout">품절·판매중지 모두</option>');
    expect(form('out_of_stock')).toContain('<option value="out_of_stock" selected="">품절</option>');
    expect(form('soldout')).toContain('<option value="soldout" selected="">품절·판매중지 모두</option>');
    expect(stopped).not.toContain('품절·판매 중지');
  });
  it('판매상태 줄에 판매기간 필터를 두고, 이름은 줄의 배지·건수 칸과 같은 판매 예정·판매 종료다', () => {
    const html = renderToStaticMarkup(<GoodsListFiltersForm data={{ filters: normalizeGoodsListFilters({ salePeriod: 'ended' }), goods: [], ips: [], total: 0 }} />);
    expect(html).toContain('aria-label="판매기간"');
    expect(html).toContain('name="salePeriod"');
    expect(html).toContain('<option value="scheduled">판매 예정</option>');
    expect(html).toContain('<option value="ended" selected="">판매 종료</option>');
    for (const stale of ['판매대기', '판매기간 종료']) expect(html).not.toContain(stale);
    expect(html.indexOf('name="salePeriod"')).toBeLessThan(html.indexOf('data-goods-search="advanced"'));
  });
  it('상품명 옆 아이콘: 고객에게 보이는 상품은 고객 화면을 새 탭으로, 아니면 편집기 미리보기로 연다. 상품번호(첫 열)·상품명은 수정 화면이다', () => {
    const base = { code: 'A', name: '상품 A', ipId: 'maple', ipTitle: '메이플', archivedAt: null, stock: 'ok' as const, stockQty: 1, activeStockQty: 1, lowStockOptionCount: 0, noticeComplete: true };
    const filters = normalizeGoodsListFilters({ q: '상품' });
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters, total: 2, ips: [], goods: [
      { ...base, id: 'good-public', productNo: 1042, publishedAt: '2026-10-01T00:00:00Z', customerVisible: true },
      { ...base, id: 'good-draft', productNo: null, publishedAt: null, customerVisible: false },
    ] }} />);
    /* 고객 화면은 상품 자동코드 주소로 연다(ADR-0050). 아이콘뿐이라 이름은 접근성 이름과 말풍선으로 준다. */
    const open = /<a (?=[^>]*data-goods-list="customer-link")[^>]*>/.exec(rowOf(html, 'good-public'))?.[0] ?? '';
    expect(open).toContain('href="/shop/a"');
    expect(open).toContain('target="_blank"');
    expect(open).toContain('rel="noopener noreferrer"');
    expect(open).toContain('aria-label="상품 A 고객 화면 새 탭으로 열기"');
    expect(open).toContain('title="고객 화면 열기"');
    expect(rowOf(html, 'good-public')).not.toContain('data-goods-list="preview-link"');
    const preview = /<a (?=[^>]*data-goods-list="preview-link")[^>]*>/.exec(rowOf(html, 'good-draft'))?.[0] ?? '';
    expect(preview).toContain(`href="${goodEditorHref(filters, 'good-draft').replaceAll('&', '&amp;')}#good-preview"`);
    expect(preview).toContain('aria-label="상품 A 공개 화면 미리보기"');
    expect(preview).not.toContain('target=');
    expect(rowOf(html, 'good-draft')).not.toContain('data-goods-list="customer-link"');
    // 아이콘은 상품명 바로 옆(같은 줄)이고, 이름이 길어도 밀려 사라지지 않는다.
    expect(rowOf(html, 'good-public')).toMatch(/<a [^>]*title="상품 A"[^>]*>상품 A<\/a><a (?=[^>]*class="[^"]*\bshrink-0\b)(?=[^>]*data-goods-list="customer-link")/);
    // 상품번호(첫 열)는 주 색 링크로 수정 화면에 간다. 번호를 아직 못 읽은 상품은 '—'다.
    const editor = goodEditorHref(filters, 'good-public').replaceAll('&', '&amp;');
    // 같은 행에 상품명 링크가 대표라 첫 칸 링크는 Tab에서 뺀다(tabindex -1, ADM-016 #8).
    expect(html).toMatch(/<a [^>]*class="font-medium text-primary underline-offset-4 hover:underline"[^>]*tabindex="-1"[^>]*><span class="tabular-nums" data-goods-list="product-no">1042<\/span><\/a>/);
    expect(html).toContain(`href="${editor}"`);
    expect(html).toMatch(/data-goods-list="product-no">—<\/span>/);
    // 상품명도 수정 화면이지만 주 색이 아니다.
    const nameLink = /<a [^>]*title="상품 A"[^>]*>상품 A<\/a>/.exec(html)?.[0] ?? '';
    expect(nameLink).toContain(`href="${editor}"`);
    expect(nameLink).toMatch(/class="[^"]*\btext-foreground\b/);
    expect(nameLink).not.toContain('text-primary');
    // 상품번호는 열로 있으므로 접힌 추가 정보에 다시 두지 않는다.
    expect(html).not.toMatch(/<dt[^>]*>상품번호<\/dt>/);
  });
  it('상품 URL(영문 내부 값) 열은 기본으로 숨긴다 — 조회항목 설정에서 켤 수 있고, 켜면 값만 보인다', () => {
    const base = { code: 'A', name: '상품 A', ipId: 'maple', ipTitle: '메이플', archivedAt: null, stock: 'ok' as const, stockQty: 1, activeStockQty: 1, lowStockOptionCount: 0, noticeComplete: true };
    const data = { filters: normalizeGoodsListFilters({}), total: 1, ips: [], goods: [{ ...base, id: 'long-good-id-1234567890', publishedAt: '2026-10-01T00:00:00Z', customerVisible: true }] };
    const html = renderToStaticMarkup(<GoodsListScreen data={data} />);
    expect(html).not.toContain('>상품 URL</th>');
    expect(html).not.toContain('long-good-id-1234567890</');
    // 조회항목 설정에는 남아 있다(숨긴 열로).
    type Node = ReactElement<Record<string, unknown>>;
    const walk = (value: ReactNode): Node[] => Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...walk(node.props.children as ReactNode)] : []);
    const grid = walk(GoodsListScreen({ data }) as Node).find(node => node.type === MarketingLinksGoodsGrid)!;
    const columns = grid.props.columns as { key: string; label: string; width?: string; defaultVisible?: boolean; required?: boolean }[];
    expect(columns.filter(column => column.defaultVisible === false).map(column => [column.key, column.label])).toEqual([['goodId', '상품 URL']]);
    expect(columns.at(-1)?.key).toBe('goodId');
    // 이미 저장한 설정으로 이 열을 보는 계정도 체크박스 칸(40) 포함 1100px(1440 화면의 표 영역) 안에 든다. 앞부분이 읽히는 폭(88px)은 그대로다.
    expect(columns.reduce((sum, column) => sum + Number.parseInt(column.width ?? '0', 10), 40)).toBeLessThanOrEqual(1100);
    expect(Number.parseInt(columns.at(-1)?.width ?? '0', 10)).toBeGreaterThanOrEqual(88);
    // 켠 계정에는 값만 보인다(전체 값은 말풍선). 고객 화면을 여는 일은 상품명 옆 아이콘이 맡는다.
    const cell = renderToStaticMarkup((grid.props.rows as { cells: ReactNode[] }[])[0].cells[columns.length - 1]);
    expect(cell).toMatch(/^<span (?=[^>]*class="[^"]*\btruncate\b)(?=[^>]*title="long-good-id-1234567890")[^>]*>long-good-id-1234567890<\/span>$/);
    expect(cell).not.toContain('<a ');
  });
  it('고객 화면이 열리지 않는 상품(초안·보관·판매 제한)의 아이콘은 미리보기이고, 이유는 같은 줄의 상태 칸이 말한다 — 아이콘 옆에 글을 두지 않는다', () => {
    const base = { code: 'A', name: '상품', ipId: 'ip', ipTitle: 'IP', stock: 'ok' as const, stockQty: 1, activeStockQty: 1, lowStockOptionCount: 0, noticeComplete: true, customerVisible: false };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 3, ips: [], goods: [
      { ...base, id: 'draft-good', publishedAt: null, archivedAt: null },
      { ...base, id: 'archived-good', publishedAt: '2026-10-01T00:00:00Z', archivedAt: '2026-10-20T00:00:00Z' },
      { ...base, id: 'adult-good', publishedAt: '2026-10-01T00:00:00Z', archivedAt: null },
    ] }} />);
    for (const id of ['draft-good', 'archived-good', 'adult-good']) {
      expect(rowOf(html, id)).toMatch(/<a (?=[^>]*data-goods-list="preview-link")(?=[^>]*title="공개 화면 미리보기")(?=[^>]*href="[^"]*#good-preview")/);
      expect(rowOf(html, id)).not.toContain('data-goods-list="customer-link"');
    }
    expect(rowOf(html, 'draft-good')).toMatch(/data-tone="neutral"[^>]*>초안<\/span>/);
    expect(rowOf(html, 'archived-good')).toMatch(/data-tone="neutral"[^>]*>보관<\/span>/);
    // 리뷰 T4-R15-1의 보조 문구(공개 전·보관·고객 화면 비노출 · 미리보기)는 상태 칸과 같은 말의 되풀이라 뺐다. '비노출'은 쓰지 않는 말이다.
    for (const stale of ['· 미리보기', '비노출']) expect(html).not.toContain(stale);
    expect(rowOf(html, 'draft-good')).not.toContain('공개 전');
  });
  describe('상태 칸은 판매 가능 여부를 말하는 주 배지 하나와 보조 표기로 나뉜다', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    const base = { code: 'A', name: '상품', ipId: 'ip', ipTitle: 'IP', stock: 'ok' as const, stockQty: 3, activeStockQty: 3, lowStockOptionCount: 0, noticeComplete: true, archivedAt: null, publishedAt: '2026-10-01T00:00:00Z' };
    const ready = { ...unknownGoodsReadiness(), state: 'ready' as const, publication: 'published' as const, operation: 'active' as const, availableQty: 3, reasons: [] };
    const blocked = (code: GoodsReadinessReasonCode) => ({ ...ready, state: 'blocked' as const, availableQty: 0, reasons: [{ code, ...GOODS_READINESS_REASONS[code], kind: 'blocking' as const }] });
    const goods = [
      { ...base, id: 'selling', readiness: ready },
      { ...base, id: 'stopped', stock: 'soldout' as const, readiness: blocked('stopped') },
      { ...base, id: 'sold-out', readiness: blocked('stock_unavailable') },
      { ...base, id: 'not-ready', readiness: blocked('image_missing') },
      { ...base, id: 'draft', publishedAt: null, readiness: blocked('draft') },
      { ...base, id: 'kept', archivedAt: '2026-10-20T00:00:00Z', readiness: blocked('archived') },
    ];
    const render = (props: Partial<Parameters<typeof GoodsListScreen>[0]> = {}) => renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: goods.length, ips: [], goods }} {...props} />);
    const row = rowOf;
    it.each([
      ['selling', '판매중', 'success'], ['stopped', '판매중지', 'danger'], ['sold-out', '품절', 'danger'],
      ['not-ready', '판매 준비 중', 'warning'], ['draft', '초안', 'neutral'], ['kept', '보관', 'neutral'],
    ] as const)('%s → %s(%s)', (id, label, tone) => {
      const cell = row(render(), id).split('data-goods-list="sale-status"')[1] ?? '';
      expect(cell).toMatch(new RegExp(`<span[^>]*data-tone="${tone}"[^>]*>${label}</span>`));
      expect(cell.match(/data-tone=/g)).toHaveLength(1);
    });
    it('전시·설정 준비는 보조 줄로 내린다', () => {
      expect(row(render(), 'selling')).toContain('공개 · 설정 준비 완료');
    });
    /* 초안 줄에 '판매상태 판매중'이라고 쓰면 파는 건지 안 파는 건지 혼란스럽다 — 아직 안 파는 상품은 공개 시 값이라고 말한다. */
    it('판매중·판매중지는 배지가 값 버튼이고, 그 밖에는 판매 값을 보조 줄에 두되 초안은 공개 시 값이라고 말한다', () => {
      const html = render({ canIssueMarketingLinks: true, bulkIdentity: identity });
      expect(row(html, 'selling')).toMatch(/aria-label="판매상태 [^"]*바로 수정"[^>]*>(?:(?!<\/button>)[\s\S])*data-tone="success"/);
      expect(row(html, 'draft')).toMatch(/aria-label="판매상태 [^"]*바로 수정"[^>]*>(?:(?!<\/button>)[\s\S])*공개 시 <\/span>판매중/);
      expect(row(html, 'draft')).not.toContain('판매상태 </span>');
      expect(row(html, 'not-ready')).toMatch(/aria-label="판매상태 [^"]*바로 수정"[^>]*>(?:(?!<\/button>)[\s\S])*판매상태 <\/span>판매중/);
      expect(row(html, 'draft')).not.toMatch(/aria-label="판매상태 [^"]*바로 수정"[^>]*>(?:(?!<\/button>)[\s\S])*data-tone=/);
    });
    it('배지가 말하는 사유는 경고로 다시 적지 않고, 사유가 하나면 바로 링크로, 여럿이면 건수 한 줄로 접는다', () => {
      const reason = (code: GoodsReadinessReasonCode) => ({ code, ...GOODS_READINESS_REASONS[code], kind: 'blocking' as const });
      const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 3, ips: [], goods: [
        { ...base, id: 'only-draft', publishedAt: null, readiness: blocked('draft') },
        { ...base, id: 'one-reason', readiness: blocked('image_missing') },
        { ...base, id: 'many-reasons', publishedAt: null, readiness: { ...ready, state: 'blocked' as const, reasons: [reason('draft'), reason('image_missing'), reason('notice_missing')] } },
      ] }} />);
      expect(row(html, 'only-draft')).not.toContain('초안 · 공개 전');
      expect(row(html, 'one-reason')).toMatch(/대표 이미지 미입력 →<\/a>/);
      expect(row(html, 'one-reason')).not.toContain('준비할 항목');
      expect(row(html, 'many-reasons')).toMatch(/<details[^>]*data-goods-list="reasons"[\s\S]*?준비할 항목 2개/);
      expect(row(html, 'many-reasons')).toContain('고시정보 미입력 →');
      expect(row(html, 'many-reasons')).not.toContain('초안 · 공개 전');
    });
    it('판매 중인 상품의 품절·부족 수량은 눈에 띄고, 초안 상품의 0개는 강조하지 않는다', () => {
      const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 4, ips: [], goods: [
        { ...base, id: 'alert', lowStockOptionCount: 2, readiness: ready },
        { ...base, id: 'flagged', stock: 'low' as const, readiness: ready },
        { ...base, id: 'sold-out', readiness: blocked('stock_unavailable') },
        { ...base, id: 'draft', publishedAt: null, readiness: blocked('draft') },
      ] }} />);
      expect(row(html, 'alert')).toMatch(/text-warning[^>]*>3개<span[^>]*data-tone="warning"[^>]*>부족 2개 옵션<\/span>/);
      expect(row(html, 'flagged')).toMatch(/data-tone="warning"[^>]*>소량 재고<\/span>/);
      expect(row(html, 'sold-out')).toMatch(/text-destructive[^>]*>0개</);
      expect(row(html, 'draft')).not.toMatch(/(font-semibold text-destructive|text-warning)[^>]*>0개</);
    });
    /* 판매기간 밖 상품은 판매 가능 0개라 '판매 가능 수량 없음'으로 막히지만, 고객 화면처럼 판매 예정·판매 종료다. */
    it('판매기간 시작 전은 판매 예정, 끝난 뒤는 판매 종료이고, 재고가 있으면 수량 없음 경고·빨간 0개를 붙이지 않는다', () => {
      const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 6, ips: [], goods: [
        { ...base, id: 'before-start', salePeriodLabel: '판매 예정', readiness: blocked('stock_unavailable') },
        { ...base, id: 'after-end', salePeriodLabel: '판매 종료', readiness: blocked('stock_unavailable') },
        { ...base, id: 'before-start-empty', activeStockQty: 0, stockQty: 0, salePeriodLabel: '판매 예정', readiness: blocked('stock_unavailable') },
        { ...base, id: 'before-start-unready', salePeriodLabel: '판매 예정', readiness: { ...blocked('stock_unavailable'), reasons: [...blocked('stock_unavailable').reasons, ...blocked('image_missing').reasons] } },
        { ...base, id: 'before-start-stopped', stock: 'soldout' as const, salePeriodLabel: '판매 예정', readiness: blocked('stopped') },
        { ...base, id: 'ready-before-start', salePeriodLabel: '판매 예정', readiness: ready },
      ] }} />);
      const cell = (id: string) => row(html, id).split('data-goods-list="sale-status"')[1]?.split('</td>')[0] ?? '';
      expect(cell('before-start')).toMatch(/<span[^>]*data-tone="info"[^>]*>판매 예정<\/span>/);
      expect(cell('before-start')).not.toContain('품절');
      expect(cell('before-start')).not.toContain('판매 가능 수량 없음');
      expect(row(html, 'before-start')).not.toMatch(/text-destructive/);
      expect(cell('after-end')).toMatch(/<span[^>]*data-tone="neutral"[^>]*>판매 종료<\/span>/);
      expect(row(html, 'after-end')).not.toMatch(/text-destructive/);
      // 시작 전인데 재고도 0이면 시작 전에 채울 일이라 수량 없음 사유와 빨간 0개를 남긴다.
      expect(cell('before-start-empty')).toMatch(/data-tone="info"[^>]*>판매 예정<\/span>/);
      expect(cell('before-start-empty')).toContain('판매 가능 수량 없음');
      expect(row(html, 'before-start-empty')).toMatch(/text-destructive[^>]*>0개</);
      expect(cell('before-start-unready')).toMatch(/data-tone="warning"[^>]*>판매 준비 중<\/span>/);
      expect(cell('before-start-stopped')).toMatch(/data-tone="danger"[^>]*>판매중지<\/span>/);
      expect(cell('ready-before-start')).toMatch(/data-tone="info"[^>]*>판매 예정<\/span>/);
      expect(cell('ready-before-start')).toContain('공개 · 설정 준비 완료');
    });
    /* 접수 전 예약판매는 판매 가능 0개라 '판매 가능 수량 없음'으로 막히지만 품절이 아니라 '예약 접수 전'이다(품절·빨간 수량·경고 링크 없음).
       고객 화면은 '판매 예정'이라 부르지만, 목록의 '판매 예정' 건수 칸은 판매기간 시작 전만 세므로 목록에서는 따로 부른다. */
    it('예약판매만 있는 상품의 판매 가능 0개는 품절이 아니라 예약 상태다 — 접수 전은 예약 접수 전', () => {
      const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 4, ips: [], goods: [
        { ...base, id: 'scheduled', stock: 'low' as const, lowStockOptionCount: 1, preorderSaleLabel: '예약 접수 전', readiness: blocked('stock_unavailable') },
        { ...base, id: 'full', preorderSaleLabel: '예약 물량 마감', readiness: blocked('stock_unavailable') },
        { ...base, id: 'closed', preorderSaleLabel: '예약 접수 종료', readiness: blocked('stock_unavailable') },
        { ...base, id: 'also-unready', preorderSaleLabel: '예약 접수 전', readiness: { ...blocked('stock_unavailable'), reasons: [...blocked('stock_unavailable').reasons, ...blocked('image_missing').reasons] } },
      ] }} />);
      const cell = (id: string) => row(html, id).split('data-goods-list="sale-status"')[1]?.split('</td>')[0] ?? '';
      expect(cell('scheduled')).toMatch(/<span[^>]*data-tone="info"[^>]*>예약 접수 전<\/span>/);
      expect(cell('scheduled')).not.toContain('판매 예정');
      expect(cell('scheduled')).not.toContain('품절');
      expect(cell('scheduled')).not.toContain('판매 가능 수량 없음');
      expect(row(html, 'scheduled')).not.toMatch(/text-destructive[^>]*>0개</);
      // 지금 팔 수 있는 수량이 없으면 품절일 때처럼 부족 경보·소량 재고 표시도 붙지 않는다.
      expect(row(html, 'scheduled')).not.toContain('소량 재고</span>');
      expect(row(html, 'scheduled')).not.toContain('부족 1개 옵션</span>');
      expect(cell('full')).toMatch(/<span[^>]*data-tone="danger"[^>]*>예약 물량 마감<\/span>/);
      expect(row(html, 'full')).toMatch(/text-destructive[^>]*>0개</);
      expect(cell('closed')).toMatch(/<span[^>]*data-tone="neutral"[^>]*>예약 접수 종료<\/span>/);
      // 다른 준비 사유가 함께 막으면 지금처럼 판매 준비 중이고, 수량 없음 사유도 그대로 보인다.
      expect(cell('also-unready')).toMatch(/data-tone="warning"[^>]*>판매 준비 중<\/span>/);
      expect(cell('also-unready')).toContain('판매 가능 수량 없음');
    });
    /* 같은 이름은 같은 것을 가리킨다: '판매 예정' 건수 칸(판매기간 시작 전)과 같은 이름의 배지는 판매기간 시작 전 상품에만 붙는다.
       접수 전 예약판매는 그 칸에 들어가지 않으므로 '예약 접수 전'이라는 다른 이름이다 — "판매 예정 0건인데 판매 예정 배지가 보인다"가 없다. */
    it("건수 칸 '판매 예정'이 0건일 때 접수 전 예약판매 줄에 같은 이름의 배지가 붙지 않는다", () => {
      const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 2, ips: [], saleStateCounts: { scheduled: 0, stopped: 0, ended: 0 }, goods: [
        { ...base, id: 'preorder-not-open', preorderSaleLabel: '예약 접수 전', readiness: blocked('stock_unavailable') },
        { ...base, id: 'selling-now', readiness: ready },
      ] }} />);
      expect(html).toMatch(/<a(?=[^>]*aria-label="판매 예정 0건")(?=[^>]*href="[^"]*salePeriod=scheduled)/);
      expect(html.split('<table')[1]).not.toContain('판매 예정');
      expect(row(html, 'preorder-not-open')).toMatch(/data-tone="info"[^>]*>예약 접수 전<\/span>/);
      /* 판매기간 시작 전 상품이 있으면 칸과 배지가 같은 이름으로 같은 상품을 가리킨다. */
      const period = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 1, ips: [], saleStateCounts: { scheduled: 1, stopped: 0, ended: 0 }, goods: [
        { ...base, id: 'before-start', salePeriodLabel: '판매 예정', readiness: blocked('stock_unavailable') },
      ] }} />);
      expect(period).toMatch(/<a(?=[^>]*aria-label="판매 예정 1건")/);
      expect(row(period, 'before-start')).toMatch(/data-tone="info"[^>]*>판매 예정<\/span>/);
    });
    /* 목록의 준비 사유 링크는 편집기 판매 준비 카드의 같은 사유와 같은 칸으로 간다(도움말 "상품 수정의 그 칸으로 갑니다"). 판매상태는 접혀 있는
       '추가 설정', 대표 이미지는 '상품이미지', 대표 카테고리는 기본 정보 맨 위 칸이다 — 사유 표의 대상만 따르면 셋 다 기본 정보 카드에 떨어진다. */
    it('준비 사유 링크는 상품 수정에서 그 사유의 칸으로 간다 — 하나일 때도, 여럿을 접어 둔 목록에서도', () => {
      const reason = (code: GoodsReadinessReasonCode) => ({ code, ...GOODS_READINESS_REASONS[code], kind: 'blocking' as const });
      const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({ status: 'draft' }), total: 5, ips: [], goods: [
        { ...base, id: 'no-image', readiness: blocked('image_missing') },
        { ...base, id: 'no-category', readiness: blocked('category_missing') },
        { ...base, id: 'no-notice', readiness: blocked('notice_missing') },
        { ...base, id: 'no-kc', readiness: blocked('kc_required') },
        { ...base, id: 'several', publishedAt: null, readiness: { ...ready, state: 'blocked' as const, reasons: [reason('stopped'), reason('image_missing'), reason('category_missing'), reason('payment_disabled')] } },
      ] }} />);
      /* 그 글자를 가진 링크 하나의 주소만 읽는다(같은 줄의 미리보기 아이콘 링크로 넘어가지 않게 svg 안에서만 건너뛴다). */
      const target = (id: string, label: string) => new RegExp(`href="[^"]*goodId=${id}#([a-z-]+)"[^>]*>(?:<svg(?:(?!</svg>)[\\s\\S])*</svg>)?${label} →</a>`).exec(row(html, id))?.[1];
      expect(target('no-image', '대표 이미지 미입력')).toBe('good-section-images');
      expect(target('no-category', '대표 카테고리 없음')).toBe('good-section-category');
      expect(target('no-notice', '고시정보 미입력')).toBe('good-section-notice');
      expect(target('no-kc', 'KC 검토 필요')).toBe('good-operation-kc');
      expect(target('several', '판매상태가 판매중지')).toBe('good-section-information');
      expect(target('several', '대표 이미지 미입력')).toBe('good-section-images');
      expect(target('several', '대표 카테고리 없음')).toBe('good-section-category');
      expect(target('several', '결제수단 모두 중지')).toBe('good-section-sale');
      /* 목록 조건은 그대로 들고 간다. */
      expect(row(html, 'no-image')).toMatch(/href="[^"]*status=draft[^"]*goodId=no-image#good-section-images"/);
    });
  });
  it('1440 화면에서 끝 열까지 들어오고, 첫 열은 상품번호, 기본 열에 상품 URL은 없다(S36-009)', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0, counts: { all: 0, active: 0, draft: 0, published: 0, archived: 0 } }} canIssueMarketingLinks />);
    const widths = [...html.matchAll(/<col style="width:(\d+)px"/g)].map(match => Number(match[1]));
    expect(widths.length).toBe(9);
    // 표의 최소 폭은 체크박스 칸(40)과 기본 열 폭의 합이다 — 좁은 화면에서 필요한 만큼만 가로로 스크롤한다.
    const minWidth = Number(/\[&amp;&gt;\.relative_table\]:min-w-\[(\d+)px\]/.exec(html)?.[1]);
    expect(widths.reduce((sum, width) => sum + width, 40)).toBe(minWidth);
    expect(minWidth).toBeLessThanOrEqual(1100);
    const headers = [...html.matchAll(/<th[^>]*scope="col"[^>]*>([^<]+)<\/th>/g)].map(match => match[1]);
    expect(headers).toEqual(['상품번호', '상품명 · 상품 자동코드', '수정', '판매가', '게시 상태 · 판매 준비', '재고수량', 'IP · 카테고리', '상품등록일', '상품수정일']);
    expect(html).toContain('아직 등록한 상품이 없습니다');
  });
  describe('첫 화면에 상품이 더 보이게 위쪽을 줄인다', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    const render = () => renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0 }} canIssueMarketingLinks bulkIdentity={identity} />);
    it('상품 등록·일괄 작업은 목록 안이 아니라 화면 오른쪽 위에 있다', () => {
      const html = render();
      expect(html.split('data-goods-list="actions"')[1]?.split('data-goods-list="status"')[0]).toContain('create=1');
      expect(html.split('aria-label="상품목록"')[1]).not.toContain('create=1');
      expect(html.split('aria-label="상품목록"')[1]).not.toContain('data-goods-list="export"');
    });
    /* 표 부품의 머리 구조가 바뀌면 이 선택자들이 말없이 빗나가 도구 줄이 다시 두 단이 된다(코드 리뷰: [data-goods-bulk] 직계 선택자가 그렇게 어긋났다). */
    it('도구 줄을 한 단으로 만드는 선택자가 표의 실제 구조와 맞는다', () => {
      const html = render();
      const grid = html.match(/<div class="([^"]*)" data-console-grid="">/)?.[1].split(' ') ?? [];
      expect(grid).toEqual(expect.arrayContaining(['xl:contents', 'xl:[&amp;&gt;.relative]:w-full', 'xl:[&amp;&gt;div:has(&gt;[data-admin-kit=table-settings])]:flex-auto', 'xl:[&amp;_[data-goods-bulk]&gt;div&gt;small]:sr-only']));
      // 뿌리 바로 아래 첫 div가 작업 막대와 조회항목 설정을 직접 품고, 표는 그다음 .relative 칸이다.
      expect(html).toMatch(/data-console-grid=""><div class="[^"]*"><div class="[^"]*"><div class="[^"]*" data-goods-bulk="goods">[\s\S]*?<\/div><\/div><div class="[^"]*" data-admin-kit="table-settings">[\s\S]*?<\/div><\/div><div class="relative min-w-0">/);
      // '한 번에 최대 100개'는 작업 막대의 바로 아래 줄에 있는 small이다.
      expect(html).toMatch(/data-goods-bulk="goods"><div class="[^"]*">(?:(?!<small)[\s\S])*<small[^>]*>한 번에 최대 100개<\/small><\/div>/);
    });
    it('검색 칸은 두 줄이고 검색어 안내는 줄을 차지하지 않으며 입력 칸 설명으로 남는다', () => {
      const html = renderToStaticMarkup(<GoodsListFiltersForm data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0 }} />);
      expect(html.match(/data-goods-search="row"/g)?.length).toBeGreaterThanOrEqual(2);
      expect(html).toMatch(/aria-describedby="goods-list-query-hint"/);
      expect(html).toMatch(/<p class="sr-only" id="goods-list-query-hint">/);
      // 검색 대상 '전체'의 안내는 ERP 품명·바코드까지 말한다(TKT-074).
      expect(html).toMatch(/placeholder="상품명·번호·코드·ERP 품명·바코드"/);
      expect(html).toMatch(/title="전체 검색은 [^"]*ERP 품명·바코드에서 찾습니다/);
    });
  });
  describe('표의 긴 값과 칸 줄 수', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    const base = { code: 'CODE-1', name: '아주 긴 상품명이 있어도 한 줄로 줄어드는 상품', ipId: 'ip', ipTitle: '아주 긴 IP 이름', stock: 'ok' as const, stockQty: 3, activeStockQty: 3, lowStockOptionCount: 0, noticeComplete: true, archivedAt: null, publishedAt: '2026-10-01T00:00:00Z' };
    const ready = { ...unknownGoodsReadiness(), state: 'ready' as const, publication: 'published' as const, operation: 'active' as const, availableQty: 3, reasons: [] };
    const reason = (code: GoodsReadinessReasonCode) => ({ code, ...GOODS_READINESS_REASONS[code], kind: 'blocking' as const });
    const render = (goods: object[]) => renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: goods.length, ips: [], goods: goods as never }} canIssueMarketingLinks bulkIdentity={identity} />);
    const cellOf = (html: string) => html.split('data-goods-list="sale-status"')[1]?.split('</td>')[0] ?? '';
    it('상품명·코드·IP는 한 줄로 줄이고 전체 값은 말풍선에 둔다', () => {
      const html = render([{ ...base, id: 'good-a', readiness: ready, categoryName: '긴 카테고리 이름' }]);
      expect(html).toMatch(/<a (?=[^>]*class="[^"]*\btruncate\b)(?=[^>]*title="아주 긴 상품명이 있어도 한 줄로 줄어드는 상품")[^>]*>/);
      expect(html).toMatch(/<small class="[^"]*\btruncate\b[^"]*" title="CODE-1">/);
      expect(html).toMatch(/<span class="truncate" title="아주 긴 IP 이름">/);
    });
    it('상품명 칸은 아이콘 자리만큼 넓히고, 아이콘은 인쇄에서 뺀다', () => {
      const html = render([{ ...base, id: 'good-a', readiness: ready, customerVisible: true }]);
      const widths = [...html.matchAll(/<col style="width:(\d+)px"/g)].map(match => Number(match[1]));
      expect(widths[1]).toBeGreaterThanOrEqual(202);
      expect(/<a (?=[^>]*data-goods-list="customer-link")[^>]*class="([^"]*)"/.exec(html)?.[1].split(' ')).toEqual(expect.arrayContaining(['size-6', 'shrink-0', 'print:hidden']));
    });
    it('초안 칸은 첫 줄에 배지와 공개 시 값, 둘째 줄에 준비 사유를 둔다', () => {
      const cell = cellOf(render([{ ...base, id: 'draft', publishedAt: null, readiness: { ...ready, state: 'blocked' as const, reasons: [reason('draft'), reason('image_missing'), reason('notice_missing')] } }]));
      const lines = cell.split('</div>').filter(part => part.includes('공개 시') || part.includes('준비할 항목'));
      expect(cell.indexOf('data-tone="neutral"')).toBeLessThan(cell.indexOf('공개 시'));
      expect(cell.indexOf('공개 시')).toBeLessThan(cell.indexOf('준비할 항목'));
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
    it('사유가 있으면 전시 여부만 앞에 남겨 설정 준비 문구로 줄이 늘지 않는다', () => {
      const cell = cellOf(render([{ ...base, id: 'review', readiness: { ...ready, state: 'review_required' as const, reasons: [reason('image_missing')] } }]));
      expect(cell).toMatch(/<small[^>]*>공개<\/small>/);
      expect(cell).toContain('대표 이미지 미입력 →');
      expect(cell).not.toContain('공개 ·');
    });
    it('옵션별 재고를 읽지 못한 여러 옵션 상품의 재고 칸은 수량과 상세 재고 두 줄이고, 상품 수정의 옵션별 재고 링크는 상세 재고 안에 있다', () => {
      const html = render([{ ...base, id: 'multi', activeVariantCount: 3, inlineStock: null, readiness: ready }]);
      expect(html).toMatch(/data-goods-list="stock-details">(?:(?!<\/details>)[\s\S])*옵션별 재고 수정<\/a><\/details>/);
    });
    it('가격 범위의 값 버튼은 ~ 뒤에서 줄을 바꿀 수 있어 옆 칸을 덮지 않는다', () => {
      const html = render([{ ...base, id: 'range', basePrice: 12900, priceMin: 12900, priceMax: 15900, activeVariantCount: 3, inlineStock: null, readiness: ready }]);
      expect(html).toMatch(/<span class="inline-block">12,900~<\/span><span class="inline-block">15,900원<\/span>/);
      expect(html).toContain('aria-label="판매가 12,900~15,900원 바로 수정"');
    });
  });
  it('기본 조회인 보관 제외 칸이 켜져 있고, 품절·소량 재고는 건수와 함께 조회 링크로 바로 찾는다', () => {
    const counts = { all: 20, active: 15, draft: 3, published: 12, archived: 5 };
    const stockCounts = { out_of_stock: 4, low: 1234 };
    const render = (values: Record<string, string>) => renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters(values), goods: [], ips: [], total: 0, counts, stockCounts }} />);
    expect(render({})).toMatch(/<a(?=[^>]*aria-current="page")(?=[^>]*aria-label="보관 제외 15건")/);
    expect(render({})).toMatch(/<a(?=[^>]*aria-label="품절\(재고 0\) 4건")(?=[^>]*href="[^"]*stock=out_of_stock)/);
    expect(render({})).toMatch(/<a(?=[^>]*aria-label="소량 재고 1,234건")(?=[^>]*href="[^"]*stock=low)/);
    // 켜진 재고 칸을 다시 누르면 재고 조건을 푼다.
    expect(render({ stock: 'out_of_stock' })).toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="품절\(재고 0\) 4건")(?=[^>]*href="[^"]*stock=all)/);
    expect(render({ stock: 'out_of_stock' })).not.toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="소량 재고 1,234건")/);
    // 재고 칸은 나머지 검색 조건을 그대로 들고 간다.
    expect(render({ status: 'published', q: '키링', ipId: 'maple' })).toMatch(/<a(?=[^>]*aria-label="소량 재고 1,234건")(?=[^>]*href="[^"]*status=published[^"]*stock=low[^"]*q=%ED%82%A4%EB%A7%81[^"]*ipId=maple)/);
  });
  it('판매 예정·판매중지·판매 종료 칸은 건수와 함께 그 목록으로 가고, 켜진 칸을 다시 누르면 그 조건을 푼다(SHEET-036)', () => {
    const counts = { all: 20, active: 15, draft: 3, published: 12, archived: 5 };
    const stockCounts = { out_of_stock: 4, low: 1 };
    const saleStateCounts = { scheduled: 2, stopped: 3, ended: 0 };
    const render = (values: Record<string, string>, extra: object = { saleStateCounts }) => renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters(values), goods: [], ips: [], total: 0, counts, stockCounts, ...extra }} />);
    const html = render({});
    // 스마트스토어처럼 판매 예정 → 품절 → 소량 재고 → 판매중지 → 판매 종료 순서다. 이름은 '○○ 보기'가 아니라 기준을 말하고,
    // 판매기간 밖 두 칸은 줄의 배지·고객 화면과 같은 말(판매 예정·판매 종료)이다.
    const labels = [...html.matchAll(/aria-label="(판매 예정|품절\(재고 0\)|소량 재고|판매중지|판매 종료) [\d,]+건"/g)].map(match => match[1]);
    expect(labels).toEqual(['판매 예정', '품절(재고 0)', '소량 재고', '판매중지', '판매 종료']);
    for (const stale of ['판매대기', '판매종료', ' 보기']) expect(html).not.toContain(stale);
    expect(html).toMatch(/<a(?=[^>]*aria-label="판매 예정 2건")(?=[^>]*data-tone="info")(?=[^>]*href="[^"]*salePeriod=scheduled)/);
    expect(html).toMatch(/<a(?=[^>]*aria-label="판매중지 3건")(?=[^>]*data-tone="danger")(?=[^>]*href="[^"]*stock=stopped)/);
    expect(html).toMatch(/<a(?=[^>]*aria-label="판매 종료 0건")(?=[^>]*data-tone="default")(?=[^>]*href="[^"]*salePeriod=ended)/);
    // 판매기간 칸과 판매상태 칸은 서로 다른 조건이라 함께 켤 수 있고, 켜진 칸을 다시 누르면 자기 조건만 푼다.
    const both = render({ salePeriod: 'scheduled', stock: 'stopped', q: '키링' });
    expect(both).toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="판매 예정 2건")(?=[^>]*href="[^"]*stock=stopped[^"]*q=%ED%82%A4%EB%A7%81)/);
    expect(both).not.toMatch(/<a(?=[^>]*aria-label="판매 예정 2건")(?=[^>]*href="[^"]*salePeriod=)/);
    expect(both).toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="판매중지 3건")(?=[^>]*href="[^"]*stock=all[^"]*salePeriod=scheduled)/);
    expect(both).toMatch(/<a(?=[^>]*aria-label="판매 종료 0건")(?=[^>]*href="[^"]*salePeriod=ended)/);
    expect(both).not.toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="판매 종료 0건")/);
    // 건수를 읽지 못해도 칸은 조회 링크로 남고 집계 없음으로 말한다.
    for (const missing of [null, undefined]) {
      const fallback = render({}, { saleStateCounts: missing });
      expect(fallback).toMatch(/<a(?=[^>]*aria-label="판매 예정 집계 없음")(?=[^>]*href="[^"]*salePeriod=scheduled)/);
      expect(fallback).toMatch(/<a(?=[^>]*aria-label="판매중지 집계 없음")(?=[^>]*href="[^"]*stock=stopped)/);
      expect(fallback).toMatch(/<a(?=[^>]*aria-label="품절\(재고 0\) 4건")/);
    }
  });
  it('건수 칸 아래 설명 줄과 접힌 안내문은 없다 — 이름이 기준을 말하고, "?"는 소량 재고 칸과 판매 준비 두 곳뿐이다', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0, stockCounts: { out_of_stock: 1, low: 2 }, checkedAt: '2026-11-25T03:00:00.000Z' }} />);
    for (const gone of ['goods-list-stock-basis', 'data-goods-list="help"', '목록 사용·재고수량·판매 준비 안내', '확인 시각']) expect(html).not.toContain(gone);
    expect(html).not.toMatch(/<div[^>]*data-goods-list="status"[^>]*aria-describedby/);
    // 수량으로 자동 분류하지 않는다는 것은 이름·구조로 드러나지 않아 소량 재고 칸에만 "?"를 단다. 링크(건수 칸) 안이 아니라 옆에 겹쳐 놓는다.
    const helps = [...html.matchAll(/<button(?=[^>]*data-admin-help="")(?=[^>]*aria-label="([^"]+) 도움말")/g)].map(match => match[1]);
    expect(helps).toEqual(['소량 재고', '판매 준비']);
    expect(html).toMatch(/<div class="relative grid min-w-0" data-goods-list="count-help"><a(?=[^>]*aria-label="소량 재고 2건")[^>]*>[\s\S]*?<\/a><button(?=[^>]*aria-label="소량 재고 도움말")(?=[^>]*type="button")/);
    // 건수 칸은 모두 같은 높이다(감싼 칸 안의 링크에도 같은 여백 규칙이 걸린다).
    expect(/<div[^>]*class="([^"]*)"[^>]*data-goods-list="status"/.exec(html)?.[1].split(' ')).toContain('[&amp;_a]:py-1.5');
    expect(GOODS_LIST_HELP.lowStock.what).toContain('자동으로 넣지는 않습니다');
    expect(GOODS_LIST_HELP.lowStock.caution).toContain('부족 N개 옵션');
  });
  it('상세 재고는 수량 이름이 뜻을 말하고, 옆 칸이 말하는 판매상태는 다시 적지 않는다', () => {
    const base = { code: 'A', name: '상품', ipId: 'ip', ipTitle: 'IP', stock: 'ok' as const, noticeComplete: true, archivedAt: null, publishedAt: '2026-10-01T00:00:00Z' };
    const readiness = { ...unknownGoodsReadiness(), state: 'ready' as const, publication: 'published' as const, operation: 'active' as const, availableQty: 7, reasons: [] };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 1, ips: [], goods: [{ ...base, id: 'stocked', stockQty: 12, activeStockQty: 9, lowStockOptionCount: 0, readiness }] }} />);
    const details = /<details[^>]*data-goods-list="stock-details">([\s\S]*?)<\/details>/.exec(rowOf(html, 'stocked'))?.[1] ?? '';
    const pairs = [...details.matchAll(/<dt[^>]*>([^<]+)<\/dt><dd[^>]*>([^<]+)<\/dd>/g)].map(match => [match[1], match[2]]);
    expect(pairs).toEqual([['지금 팔 수 있는 수량', '7개'], ['사용 중인 옵션의 재고', '9개'], ['사용 중지한 옵션까지 합친 재고', '12개'], ['안전재고', '부족한 옵션 없음']]);
    for (const stale of ['전체 옵션 재고수량', '사용 옵션 재고수량', '부족 경보 없음', '판매상태', '운영 중']) expect(details).not.toContain(stale);
  });
  it('카테고리가 없는 상품은 미분류로 보인다', () => {
    const good = { id: 'no-category', code: 'A', name: '상품', ipId: 'ip', ipTitle: 'IP', stock: 'ok' as const, stockQty: 1, activeStockQty: 1, lowStockOptionCount: 0, noticeComplete: true, archivedAt: null, publishedAt: null, categoryName: null };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 1, ips: [], goods: [good] }} />);
    expect(rowOf(html, 'no-category')).toMatch(/<small[^>]*>미분류<\/small>/);
    expect(html).not.toContain('분류 미지정');
  });
  it('재고 건수를 읽지 못하면 칸은 조회 링크로 남고 집계 없음으로 말한다', () => {
    for (const stockCounts of [null, undefined]) {
      const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0, stockCounts }} />);
      expect(html).toMatch(/<a(?=[^>]*aria-label="품절\(재고 0\) 집계 없음")(?=[^>]*href="[^"]*stock=out_of_stock)/);
      expect(html).toMatch(/<a(?=[^>]*aria-label="소량 재고 집계 없음")(?=[^>]*href="[^"]*stock=low)/);
    }
  });
  it('품절·소량 재고 칸은 건수가 있을 때만 의미색이고, 준비 사유는 주의색이며, 주 색 링크는 첫 칸 하나다', () => {
    const base = { code: 'A', name: '상품', ipId: 'ip', ipTitle: 'IP', stock: 'ok' as const, stockQty: 3, activeStockQty: 3, lowStockOptionCount: 0, noticeComplete: true, archivedAt: null, publishedAt: null, customerVisible: false };
    const readiness = { ...unknownGoodsReadiness(), state: 'blocked' as const, reasons: [{ code: 'image_missing' as const, ...GOODS_READINESS_REASONS.image_missing, kind: 'blocking' as const }] };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 1, ips: [], goods: [{ ...base, id: 'long-good-id-1234567890', readiness }], stockCounts: { out_of_stock: 3, low: 1 } }} />);
    const card = (source: string, label: string) => new RegExp(`<a(?=[^>]*aria-label="${label}")[^>]*>[\\s\\S]*?</a>`).exec(source)?.[0] ?? '';
    expect(html).toMatch(/<a(?=[^>]*data-tone="danger")(?=[^>]*aria-label="품절\(재고 0\) 3건")/);
    expect(html).toMatch(/<a(?=[^>]*data-tone="warning")(?=[^>]*aria-label="소량 재고 1건")/);
    expect(card(html, '품절\\(재고 0\\) 3건')).toContain('text-destructive');
    expect(card(html, '소량 재고 1건')).toContain('text-warning');
    // 0건은 처리할 것이 없으니 회색으로 물러난다(ADR-0029).
    const empty = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 0, ips: [], goods: [], stockCounts: { out_of_stock: 0, low: 0 } }} />);
    expect(card(empty, '품절\\(재고 0\\) 0건')).not.toContain('text-destructive');
    expect(card(empty, '소량 재고 0건')).not.toContain('text-warning');
    /* 주소도 본다 — 대표 이미지 사유는 기본 정보가 아니라 상품이미지 카드로 간다. */
    expect(html).toMatch(/<a class="[^"]*\btext-warning\b[^"]*" href="[^"]*goodId=long-good-id-1234567890#good-section-images">(?:<svg[\s\S]*?<\/svg>)?대표 이미지 미입력 →<\/a>/);
    // 주 색 링크는 첫 칸(상품번호) 하나다. 상품명 옆 아이콘은 흐린 글자다.
    const row = rowOf(html, 'long-good-id-1234567890');
    expect(row.match(/<a [^>]*class="[^"]*\btext-primary\b/g)).toHaveLength(1);
    expect(/<a (?=[^>]*data-goods-list="preview-link")[^>]*class="([^"]*)"/.exec(row)?.[1].split(' ')).toContain('text-muted-foreground');
  });
  /* QA G2: 조회 조건은 비제어 입력이라 처음 그린 값만 쓴다. 건수 칸·[초기화]는 화면 안에서 주소만 바꾸므로, 조건마다 걸린 값을 key로 줘
     그 입력을 새로 그린다 — 안 그러면 '소량 재고' 칸을 눌러도 판매상태 셀렉트가 '전체'로 남고 [검색]을 누르면 조건이 풀린다. */
  it('조회 조건의 입력은 주소에 걸린 값이 바뀌면 새로 그려진다(건수 칸을 누른 뒤에도 셀렉트가 그 값을 보인다)', () => {
    type Node = ReactElement<Record<string, unknown>>;
    const walk = (value: ReactNode): Node[] => Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...walk(node.props.children as ReactNode), ...walk(node.props.label as ReactNode)] : []);
    /* Children.toArray는 화면이 준 key 앞에 '.$'를 붙이고 ':'를 '=2'로 바꾼다('.$stock=2low'). key가 없는 자식에는 자리 번호('.0')를 준다. 화면이 준 key만 읽는다. */
    const keyOf = (node: Node | undefined) => { const raw = String(node?.key ?? ''); return raw.startsWith('.$') ? raw.slice(2).replaceAll('=2', ':') : null; };
    const tree = (values: Record<string, string>) => walk(GoodsListFiltersForm({ data: { filters: normalizeGoodsListFilters(values), goods: [], ips: [], total: 0 } }) as Node);
    const control = (nodes: Node[], name: string) => nodes.find(node => node.props.name === name && 'defaultValue' in node.props);
    const before = tree({}), after = tree({ stock: 'low', salePeriod: 'scheduled', status: 'draft', q: '키링', field: 'name' });
    /* 건수 칸이 바꾸는 세 조건: 판매상태(stock)·판매기간(salePeriod)·게시 상태(status 라디오 묶음). */
    expect([keyOf(control(before, 'stock')), keyOf(control(after, 'stock'))]).toEqual(['stock:all', 'stock:low']);
    expect(control(after, 'stock')?.props.defaultValue).toBe('low');
    expect([keyOf(control(before, 'salePeriod')), keyOf(control(after, 'salePeriod'))]).toEqual(['salePeriod:all', 'salePeriod:scheduled']);
    const statusGroup = (nodes: Node[]) => nodes.find(node => node.type === 'fieldset' && walk(node.props.children as ReactNode).some(child => child.props.name === 'status'));
    expect([keyOf(statusGroup(before)), keyOf(statusGroup(after))]).toEqual(['status:active', 'status:draft']);
    /* [초기화]도 같은 화면 안 이동이다 — 나머지 조건과 검색어 줄도 걸린 값으로 key를 갖는다. */
    expect(Object.fromEntries(['readiness', 'categoryId', 'ipId', 'dateField', 'originId', 'payment', 'saleType', 'restriction', 'image'].map(name => [name, keyOf(control(before, name))])))
      .toEqual({ readiness: 'readiness:all', categoryId: 'categoryId:', ipId: 'ipId:', dateField: 'dateField:created', originId: 'originId:', payment: 'payment:all', saleType: 'saleType:all', restriction: 'restriction:all', image: 'image:all' });
    /* 같은 줄에 나란한 입력끼리 key가 겹치면 React가 서로를 헷갈린다 — 이름을 앞에 붙여 모두 다르다. */
    const keys = [...before.filter(node => 'defaultValue' in node.props && typeof node.props.name === 'string').map(keyOf), keyOf(statusGroup(before))];
    expect(new Set(keys).size).toBe(keys.length);
    const queryField = (nodes: Node[]) => nodes.find(node => node.type === GoodsListQueryField);
    expect(keyOf(queryField(before))).not.toBeNull();
    expect(keyOf(queryField(before))).not.toBe(keyOf(queryField(after)));
    expect(keyOf(before.find(node => node.type === GoodsListDateRange))).toBe('range:~');
    expect(keyOf(tree({ from: '2026-11-01', to: '2026-11-25' }).find(node => node.type === GoodsListDateRange))).toBe('range:2026-11-01~2026-11-25');
  });
  it('검색 대상에서 상품 URL(영문 내부 값)은 고를 수 없다 — 저장해 둔 주소(field=id)로 들어왔을 때만 그 조건이 보인다', () => {
    const form = (values: Record<string, string>) => renderToStaticMarkup(<GoodsListFiltersForm data={{ filters: normalizeGoodsListFilters(values), goods: [], ips: [], total: 0 }} />);
    const fields = (html: string) => [...html.matchAll(/<input[^>]*type="radio"[^>]*name="field"[^>]*value="([^"]+)"/g)].map(match => match[1]);
    expect(fields(form({}))).toEqual(['all', 'name', 'number', 'code', 'erp', 'barcode']);
    expect(form({})).not.toContain('상품 URL</label>');
    // '전체' 검색은 지금처럼 이 값도 찾는다(입력 칸 말풍선이 말한다).
    expect(form({})).toMatch(/title="전체 검색은 [^"]*상품 URL[^"]*"/);
    const legacy = form({ field: 'id', q: 'good-a' });
    expect(fields(legacy)).toEqual(['all', 'name', 'number', 'id', 'code', 'erp', 'barcode']);
    expect(legacy).toMatch(/<input(?=[^>]*name="field")(?=[^>]*value="id")(?=[^>]*checked="")[^>]*\/>상품 URL<\/label>/);
  });
  it('기간 조건의 날짜 이름은 게시 상태 값과 같은 말(공개일)이다', () => {
    const html = renderToStaticMarkup(<GoodsListFiltersForm data={{ filters: normalizeGoodsListFilters({ dateField: 'published' }), goods: [], ips: [], total: 0 }} />);
    expect(html).toContain('<option value="published" selected="">공개일</option>');
    expect(html).not.toContain('전시시작일');
  });
  it('기간: 종료일 달력은 시작일보다 앞을 고를 수 없고, 뒤바뀐 기간은 날짜 칸에서 바로잡는다', () => {
    const to = (html: string) => /<input(?=[^>]*name="to")[^>]*>/.exec(html)?.[0] ?? '';
    expect(to(renderToStaticMarkup(<GoodsListDateRange from="2026-10-10" to="2026-10-20" />))).toContain('min="2026-10-10"');
    expect(to(renderToStaticMarkup(<GoodsListDateRange from={null} to="2026-10-20" />))).not.toContain('min=');
    // 시작일을 종료일 뒤로 옮기면 종료일이 같은 날로 따라온다 — 손대지 않은 종료일 때문에 [검색]이 막히지 않는다.
    expect(goodsListDateRangeFromStart({ from: '2026-10-10', to: '2026-10-20' }, '2026-10-25')).toEqual({ from: '2026-10-25', to: '2026-10-25' });
    expect(goodsListDateRangeFromStart({ from: '2026-10-10', to: '2026-10-20' }, '2026-10-15')).toEqual({ from: '2026-10-15', to: '2026-10-20' });
    expect(goodsListDateRangeFromStart({ from: '2026-10-10', to: '' }, '2026-10-25')).toEqual({ from: '2026-10-25', to: '' });
    expect(goodsListDateRangeFromStart({ from: '2026-10-10', to: '2026-10-20' }, '')).toEqual({ from: '', to: '2026-10-20' });
    // 연도를 한 자리씩 적는 도중의 값(0002년…)은 종료일보다 늦지 않아 종료일을 건드리지 않는다.
    expect(goodsListDateRangeFromStart({ from: '2026-10-10', to: '2026-10-20' }, '0002-10-10')).toEqual({ from: '0002-10-10', to: '2026-10-20' });
    // 종료일을 글자로 시작일보다 앞서게 적고 칸을 떠나면 시작일이 그날로 따라온다. 바른 기간은 그대로 둔다(같은 값을 돌려줘 다시 그리지 않는다).
    expect(goodsListDateRangeFromEnd({ from: '2026-10-10', to: '2026-10-05' })).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    const valid = { from: '2026-10-10', to: '2026-10-20' };
    expect(goodsListDateRangeFromEnd(valid)).toBe(valid);
    const open = { from: '', to: '2026-10-05' };
    expect(goodsListDateRangeFromEnd(open)).toBe(open);
  });
  it('자주 쓰지 않는 조건은 상세검색에 접혀도 같은 폼으로 제출되고, 걸려 있으면 펼친다', () => {
    const render = (values: Record<string, string>) => renderToStaticMarkup(<GoodsListFiltersForm data={{ filters: normalizeGoodsListFilters(values), goods: [], ips: [], total: 0 }} />);
    const html = render({});
    const marker = html.indexOf('data-goods-search="advanced"');
    for (const name of ['q', 'stock', 'salePeriod', 'readiness', 'categoryId', 'ipId']) expect(html.slice(0, marker)).toContain(`name="${name}"`);
    for (const name of ['status', 'dateField', 'from', 'to']) expect(html.slice(marker)).toContain(`name="${name}"`);
    expect(render({ from: '2026-10-01' })).toMatch(/<details[^>]*data-goods-search="advanced"[^>]*open=""/);
    // 게시 상태는 위 건수 칸이 현재 값을 보여 준다.
    expect(render({ status: 'draft' })).not.toMatch(/<details[^>]*data-goods-search="advanced"[^>]*open=""/);
  });
  it('빈 상품 목록에서도 지역별 추가배송비 기간이 끝났다고 알린다', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0 }}
      shippingRegionExpiry={{ warnings: [{ originName: "김포", carrierLabel: "한진택배", id: 'policy', name: '지역 정책', version: 1, endsAt: '2026-09-27T00:00:00Z', status: 'expired' }] }} />);
    expect(html).toContain('기간 끝남');
    expect(html).toContain('href="/admin/settings/shipping-regions"');
  });
  it('renders catalog filters and twenty-row paging with a precise edit link', () => {
    const html=renderToStaticMarkup(<GoodsListScreen data={{
      filters:normalizeGoodsListFilters({q:'ICONS',ipId:'hwasan',page:'2'}),total:1000,
      ips:[{id:'hwasan',title:'화산강림',archivedAt:null}],
      goods:[{id:'g100',code:'ICONS-100',name:'운영 상품',ipId:'hwasan',ipTitle:'화산강림',publishedAt:null,archivedAt:null,stock:'ok',noticeComplete: true, stockQty:0,activeStockQty:0,lowStockOptionCount:0}],
    }}/>);
    expect(html).toContain('data-slot="table"');
    expect(html).toContain('상품 자동코드'); expect(html).toContain('상품명');
    expect(html).toContain('ERP 코드·품명');
    expect(html).toContain('바코드');
    expect(html).toContain('name="categoryId"'); expect(html).toContain('name="readiness"');
    expect(html).toContain('name="q"'); expect(html).toContain('name="ipId"');
    expect(html).toContain('name="status"'); expect(html).toContain('name="stock"');
    expect(html).toContain('goodId=g100'); expect(html).toContain('page=3');
    expect(html).toContain('초안'); expect(html).toContain('품절');
    expect(html).toContain('1,000');
  });
  it('모든 옵션을 중지한 상품은 재고 10개를 보존하면서 판매 불가와 부족 경보를 표시한다', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{
      filters: normalizeGoodsListFilters({}), total: 1, ips: [],
      goods: [{ id: 'stopped', code: 'STOPPED', name: '중지 상품', ipId: 'ip', ipTitle: 'IP',
        publishedAt: '2026-09-10', archivedAt: null, stock: 'ok', noticeComplete: true,
        stockQty: 10, activeStockQty: 0, lowStockOptionCount: 1, priceMin: 12345, priceMax: 17890,
        readiness: { ...unknownGoodsReadiness(), state: 'blocked', operation: 'active', availableQty: 0, reasons: [{ code: 'no_active_options', ...GOODS_READINESS_REASONS.no_active_options, kind: 'blocking' }] } }],
    }} />);
    const body = html.split('<tbody')[1]?.split('</tbody>')[0] ?? '';
    expect(body).toContain('10개');
    expect(body).toContain('0개');
    expect(body).toContain('사용 중인 옵션 없음');
    expect(body).toContain('판매 준비 중');
    expect(body).toContain('12,345~17,890원');
    expect(body).toContain('#good-section-variants');
    expect(body).toContain('부족 1개 옵션');
  });
});
