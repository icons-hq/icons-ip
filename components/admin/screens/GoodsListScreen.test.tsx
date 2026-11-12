import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { GoodsListScreen } from './GoodsListScreen';
import { GoodsInlineDialogHost, GoodsInlineDialogNotice } from '../GoodsInlineDialogHost';
import { GoodsListFiltersForm } from './GoodsListFiltersForm';
import { GOODS_READINESS_REASONS, unknownGoodsReadiness, type GoodsReadinessReasonCode } from '@/lib/admin/goods-readiness';
import { goodEditorHref, normalizeGoodsListFilters } from '@/lib/admin/goods-list';

describe('goods list screen', () => {
  it('상품 관리 권한과 현재 세션이 있으면 판매가·재고수량·판매상태를 목록에서 바로 고치고, IP 필터에서는 IP 전체 즉시할인을 연다', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    const good = { id: 'good-a', code: 'A', name: '상품 A', ipId: 'maple', ipTitle: '메이플', publishedAt: null, archivedAt: null, stock: 'ok' as const, stockQty: 7,
      activeStockQty: 7, lowStockOptionCount: 0, noticeComplete: true, priceMin: 10000, priceMax: 10000, basePrice: 10000, activeVariantCount: 1,
      inlineStock: { variantId: 'b9000000-0000-4000-8000-000000000010', stockQty: 7 } };
    const multi = { ...good, id: 'good-b', activeVariantCount: 3, inlineStock: null, compareAtPrice: 15000 };
    const discounted = { ...good, id: 'good-c', activeDiscountEndsAt: '2026-10-30T00:00:00Z' };
    const data = { filters: normalizeGoodsListFilters({ ipId: 'maple' }), goods: [good, multi, discounted], ips: [{ id: 'maple', title: '메이플', archivedAt: null }], total: 3 };
    const html = renderToStaticMarkup(<GoodsListScreen data={data} canIssueMarketingLinks bulkIdentity={identity} />);
    for (const label of ['판매가 10,000원 바로 수정', '판매상태 공개 시 판매중 바로 수정', '재고수량 7개 바로 수정']) expect(html).toContain(`aria-label="${label}"`);
    // 판매가 바로 수정은 편집기의 판매가와 같은 뜻일 때만: 상품 할인(정가 표시) 상품은 이유와 상품 수정 링크만 보인다.
    expect(html.match(/판매가 [^"]*바로 수정/g)).toHaveLength(1);
    expect(html).toContain('상품 할인 중 · 판매가는 상품 수정에서 변경'); expect(html).toContain('#good-section-price');
    // 진행·예정 즉시할인 상품은 같은 칸이 '할인 중지 후 변경' 창을 연다(1027T-025).
    expect(html).toContain('aria-label="판매가 10,000원 할인 중지 후 변경"'); expect(html).toContain('할인 진행·예정');
    expect(html.match(/재고수량 [^"]*바로 수정/g)).toHaveLength(2);
    // 옵션을 읽지 못한(옵션별 재고 값이 없는) 여러 옵션 상품은 상세 재고 안의 상품 수정 링크로 고친다.
    expect(html).toContain('옵션별 재고 수정');
    expect(html).toContain('IP 전체 즉시할인');
    const readOnly = renderToStaticMarkup(<GoodsListScreen data={data} bulkIdentity={identity} />);
    expect(readOnly).not.toContain('바로 수정'); expect(readOnly).not.toContain('IP 전체 즉시할인');
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
    const grid = inside.find(node => typeof node.props.className === 'string' && (node.props.className as string).includes('[&_table]:min-w-[1088px]'));
    expect(grid).toBeTruthy();
    expect(walk(grid!.props.children as ReactNode).some(node => node.type === GoodsInlineDialogHost)).toBe(false);
    // 모두 저장하고 닫힌 창의 결과 문구는 표 밖, 목록 위에 남는다.
    expect(inside.find(node => node.type === GoodsInlineDialogNotice)?.props.listedGoodIds).toEqual([]);
    // 상품 관리 권한이 없으면 창 주인은 세션을 받지 않는다(할인 창은 열 수 없다).
    const readOnly = GoodsListScreen({ data, bulkIdentity: identity }) as Node;
    expect((Children.only(readOnly.props.children as ReactNode) as Node).props.identity).toBeUndefined();
  });
  it('옵션이 여러 개인 상품의 재고 칸은 칸 전체가 옵션별 재고 창을 열고, 상품 할인이 있으면 할인 진행 중이어도 상품 수정으로 보낸다(1014-106·1027T-025)', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    const ready = { ...unknownGoodsReadiness(), state: 'ready' as const, publication: 'published' as const, operation: 'active' as const, availableQty: 12, reasons: [] };
    const options = [{ variantId: 'b9000000-0000-4000-8000-000000000021', name: '블루', code: 'OPT-B', stockQty: 5 }, { variantId: 'b9000000-0000-4000-8000-000000000022', name: '레드', code: 'OPT-R', stockQty: 4 },
      { variantId: 'b9000000-0000-4000-8000-000000000023', name: '그린', code: 'OPT-G', stockQty: 3 }];
    const multi = { id: 'good-m', code: 'M', name: '옵션 상품', ipId: 'maple', ipTitle: '메이플', publishedAt: '2026-10-01T00:00:00Z', archivedAt: null, stock: 'ok' as const, stockQty: 12,
      activeStockQty: 12, lowStockOptionCount: 0, noticeComplete: true, priceMin: 10000, priceMax: 10000, basePrice: 10000, activeVariantCount: 3, inlineStock: null, inlineOptions: options, readiness: ready };
    const both = { ...multi, id: 'good-both', compareAtPrice: 15000, activeDiscountEndsAt: '2026-11-20T00:00:00Z' };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [multi, both], ips: [], total: 2 }} canIssueMarketingLinks bulkIdentity={identity} />);
    const row = (id: string) => (html.split('<tr').find(part => part.includes(`>${id}<`) || part.includes(`title="${id}"`)) ?? '').split('</tr>')[0];
    // 칸을 채우는 값 버튼(R11)이고, 보이는 글자에 '옵션별 재고'가 있다. 창은 누르기 전에는 그리지 않는다.
    expect(row('good-m')).toMatch(/data-inline-edit="cell"><button[^>]*aria-label="재고수량 12개 옵션별 재고 수정"/);
    expect(row('good-m')).toContain('옵션별 재고</small>');
    expect(html).not.toContain('<dialog');
    // 옵션별 재고 창이 있으면 상세 재고 안의 상품 수정 링크는 두지 않는다(창 안에서 상품 수정으로 간다).
    expect(row('good-m')).not.toContain('#good-section-variants">옵션별 재고 수정');
    // 상품 할인과 진행 중인 즉시할인이 함께 있으면 판매가의 뜻이 정가라 창을 열지 않고 상품 수정으로 보낸다.
    expect(row('good-both')).not.toContain('할인 중지 후 변경');
    expect(row('good-both')).toMatch(/title="상품 할인·즉시할인 진행·예정 중\(~2026\.11\.20\) · 판매가는 상품 수정에서 변경" href="[^"]*#good-section-price">상품 할인 중<\/a>/);
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
    expect(grid.split(' ')).toEqual(expect.arrayContaining(['[&amp;_thead_th:first-child]:min-w-10', expect.stringMatching(/^\[&amp;_table\]:min-w-\[\d+px\]$/)]));
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
    expect(html).toMatch(/aria-label="전시중 12건"[^>]*>[\s\S]*?<strong[^>]*>12</);
    expect(html).toMatch(/aria-label="전체 20건"[^>]*>[\s\S]*?<strong[^>]*>20</);
    expect(html).toMatch(/상품목록 <span[^>]*>\(총 <strong[^>]*>3<\/strong>개\)<\/span>/);
    expect(html).not.toContain('wc-admin-kit__page-header');
    expect(html).toContain('create=1');
    expect(html).toContain('상품 일괄등록·수정');
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
  it('판매상태 줄에 판매기간(판매대기·종료) 필터를 둔다', () => {
    const html = renderToStaticMarkup(<GoodsListFiltersForm data={{ filters: normalizeGoodsListFilters({ salePeriod: 'ended' }), goods: [], ips: [], total: 0 }} />);
    expect(html).toContain('aria-label="판매기간"');
    expect(html).toContain('name="salePeriod"');
    expect(html).toContain('<option value="scheduled">판매대기 (시작 전)</option>');
    expect(html).toContain('<option value="ended" selected="">판매기간 종료</option>');
    expect(html.indexOf('name="salePeriod"')).toBeLessThan(html.indexOf('data-goods-search="advanced"'));
  });
  it('상품 URL 열: 고객에게 보이는 상품은 고객 화면을 새 탭으로, 아니면 편집기 미리보기로 연다. 상품번호(첫 열)·상품명은 수정 화면이다', () => {
    const base = { code: 'A', name: '상품 A', ipId: 'maple', ipTitle: '메이플', archivedAt: null, stock: 'ok' as const, stockQty: 1, activeStockQty: 1, lowStockOptionCount: 0, noticeComplete: true };
    const filters = normalizeGoodsListFilters({ q: '상품' });
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters, total: 2, ips: [], goods: [
      { ...base, id: 'good-public', productNo: 1042, publishedAt: '2026-10-01T00:00:00Z', customerVisible: true },
      { ...base, id: 'good-draft', productNo: null, publishedAt: null, customerVisible: false },
    ] }} />);
    expect(html).toContain('>상품 URL</th>');
    expect(html).toMatch(/<a [^>]*data-goods-list="good-id" href="\/shop\/good-public" target="_blank" rel="noopener noreferrer">good-public/);
    expect(html).toContain(`href="${goodEditorHref(filters, 'good-draft').replaceAll('&', '&amp;')}#good-preview"`);
    expect(html).toContain('공개 전 · 미리보기');
    // 상품번호(첫 열)는 주 색 링크로 수정 화면에 간다. 번호를 아직 못 읽은 상품은 '—'다.
    const editor = goodEditorHref(filters, 'good-public').replaceAll('&', '&amp;');
    expect(html).toContain(`<a class="font-medium text-primary underline-offset-4 hover:underline" href="${editor}"><span class="tabular-nums" data-goods-list="product-no">1042</span></a>`);
    expect(html).toMatch(/data-goods-list="product-no">—<\/span>/);
    // 상품명도 수정 화면이지만 주 색이 아니다.
    const nameLink = /<a [^>]*title="상품 A"[^>]*>상품 A<\/a>/.exec(html)?.[0] ?? '';
    expect(nameLink).toContain(`href="${editor}"`);
    expect(nameLink).toMatch(/class="[^"]*\btext-foreground\b/);
    expect(nameLink).not.toContain('text-primary');
    // 상품번호·상품 URL은 열로 있으므로 접힌 추가 정보에 다시 두지 않는다.
    expect(html).not.toMatch(/<dt[^>]*>상품번호<\/dt>/);
  });
  it('상품번호 보조 문구는 고객 화면에 안 보이는 사유와 같은 행의 상태 배지와 어긋나지 않는다', () => {
    // 리뷰 T4-R15-1: 보관·전시 중 성인·IP 비공개 상품에 '공개 전'이라고 쓰면 '보관'·'전시중' 배지와 모순된다.
    const base = { code: 'A', name: '상품', ipId: 'ip', ipTitle: 'IP', stock: 'ok' as const, stockQty: 1, activeStockQty: 1, lowStockOptionCount: 0, noticeComplete: true, customerVisible: false };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 3, ips: [], goods: [
      { ...base, id: 'draft-good', publishedAt: null, archivedAt: null },
      { ...base, id: 'archived-good', publishedAt: '2026-10-01T00:00:00Z', archivedAt: '2026-10-20T00:00:00Z' },
      { ...base, id: 'adult-good', publishedAt: '2026-10-01T00:00:00Z', archivedAt: null },
    ] }} />);
    const secondary = (id: string) => new RegExp(`>${id}<small[^>]*>([^<]+)</small>`).exec(html)?.[1];
    expect(secondary('draft-good')).toBe('공개 전 · 미리보기');
    expect(secondary('archived-good')).toBe('보관 · 미리보기');
    // 전시 중이지만 판매 제한(성인)·IP 비공개 등으로 고객 상세가 열리지 않는 상품.
    expect(secondary('adult-good')).toBe('고객 화면 비노출 · 미리보기');
    expect(html.match(/공개 전 · 미리보기/g)).toHaveLength(1);
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
    const row = (html: string, id: string) => html.split('<tr').find(part => part.includes(`>${id}<`)) ?? '';
    it.each([
      ['selling', '판매중', 'success'], ['stopped', '판매중지', 'danger'], ['sold-out', '품절', 'danger'],
      ['not-ready', '판매 준비 중', 'warning'], ['draft', '임시저장', 'neutral'], ['kept', '보관', 'neutral'],
    ] as const)('%s → %s(%s)', (id, label, tone) => {
      const cell = row(render(), id).split('data-goods-list="sale-status"')[1] ?? '';
      expect(cell).toMatch(new RegExp(`<span[^>]*data-tone="${tone}"[^>]*>${label}</span>`));
      expect(cell.match(/data-tone=/g)).toHaveLength(1);
    });
    it('전시·설정 준비는 보조 줄로 내린다', () => {
      expect(row(render(), 'selling')).toContain('전시중 · 설정 준비 완료');
    });
    /* 임시저장 줄에 '판매상태 판매중'이라고 쓰면 파는 건지 안 파는 건지 혼란스럽다 — 아직 안 파는 상품은 공개 시 값이라고 말한다. */
    it('판매중·판매중지는 배지가 값 버튼이고, 그 밖에는 판매 값을 보조 줄에 두되 임시저장은 공개 시 값이라고 말한다', () => {
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
    it('판매 중인 상품의 품절·부족 수량은 눈에 띄고, 임시저장 상품의 0개는 강조하지 않는다', () => {
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
  });
  it('1440 화면에서 끝 열까지 들어오고, 첫 열은 상품번호, 긴 영문이 많은 상품 URL은 맨 뒤 열이다(S36-009)', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0, counts: { all: 0, active: 0, draft: 0, published: 0, archived: 0 } }} canIssueMarketingLinks />);
    const widths = [...html.matchAll(/<col style="width:(\d+)px"/g)].map(match => Number(match[1]));
    expect(widths.length).toBe(10);
    // 체크박스 칸(40) 포함 1100px(1440 화면의 표 영역) 안에 든다.
    expect(widths.reduce((sum, width) => sum + width, 40)).toBeLessThanOrEqual(1100);
    const headers = [...html.matchAll(/<th[^>]*scope="col"[^>]*>([^<]+)<\/th>/g)].map(match => match[1]);
    expect(headers[0]).toBe('상품번호');
    expect(headers[1]).toBe('상품명 · 판매자상품코드');
    expect(headers.at(-1)).toBe('상품 URL');
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
    it('상품 URL은 앞부분이 읽히는 폭이고 전체 값은 말풍선, 보조 문구는 한 줄이다', () => {
      const html = render([{ ...base, id: 'long-good-id-1234567890', publishedAt: null, customerVisible: false, readiness: { ...ready, state: 'blocked' as const, reasons: [reason('draft')] } }]);
      const widths = [...html.matchAll(/<col style="width:(\d+)px"/g)].map(match => Number(match[1]));
      expect(widths.at(-1)).toBeGreaterThanOrEqual(88);
      expect(html).toMatch(/title="long-good-id-1234567890" data-goods-list="good-id"/);
      expect(html).toMatch(/long-good-id-1234567890<small class="[^"]*\btruncate\b[^"]*">공개 전 · 미리보기<\/small>/);
    });
    it('임시저장 칸은 첫 줄에 배지와 공개 시 값, 둘째 줄에 준비 사유를 둔다', () => {
      const cell = cellOf(render([{ ...base, id: 'draft', publishedAt: null, readiness: { ...ready, state: 'blocked' as const, reasons: [reason('draft'), reason('image_missing'), reason('notice_missing')] } }]));
      const lines = cell.split('</div>').filter(part => part.includes('공개 시') || part.includes('준비할 항목'));
      expect(cell.indexOf('data-tone="neutral"')).toBeLessThan(cell.indexOf('공개 시'));
      expect(cell.indexOf('공개 시')).toBeLessThan(cell.indexOf('준비할 항목'));
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
    it('사유가 있으면 전시 여부만 앞에 남겨 설정 준비 문구로 줄이 늘지 않는다', () => {
      const cell = cellOf(render([{ ...base, id: 'review', readiness: { ...ready, state: 'review_required' as const, reasons: [reason('image_missing')] } }]));
      expect(cell).toMatch(/<small[^>]*>전시중<\/small>/);
      expect(cell).toContain('대표 이미지 미입력 →');
      expect(cell).not.toContain('전시중 ·');
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
    expect(render({})).toMatch(/<a(?=[^>]*aria-label="품절 보기 4건")(?=[^>]*href="[^"]*stock=out_of_stock)/);
    expect(render({})).toMatch(/<a(?=[^>]*aria-label="소량 재고 보기 1,234건")(?=[^>]*href="[^"]*stock=low)/);
    // 켜진 재고 칸을 다시 누르면 재고 조건을 푼다.
    expect(render({ stock: 'out_of_stock' })).toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="품절 보기 4건")(?=[^>]*href="[^"]*stock=all)/);
    expect(render({ stock: 'out_of_stock' })).not.toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="소량 재고 보기 1,234건")/);
    // 재고 칸은 나머지 검색 조건을 그대로 들고 간다.
    expect(render({ status: 'published', q: '키링', ipId: 'maple' })).toMatch(/<a(?=[^>]*aria-label="소량 재고 보기 1,234건")(?=[^>]*href="[^"]*status=published[^"]*stock=low[^"]*q=%ED%82%A4%EB%A7%81[^"]*ipId=maple)/);
  });
  it('판매대기·판매중지·판매종료 칸은 건수와 함께 그 목록으로 가고, 켜진 칸을 다시 누르면 그 조건을 푼다(SHEET-036)', () => {
    const counts = { all: 20, active: 15, draft: 3, published: 12, archived: 5 };
    const stockCounts = { out_of_stock: 4, low: 1 };
    const saleStateCounts = { scheduled: 2, stopped: 3, ended: 0 };
    const render = (values: Record<string, string>, extra: object = { saleStateCounts }) => renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters(values), goods: [], ips: [], total: 0, counts, stockCounts, ...extra }} />);
    const html = render({});
    // 스마트스토어처럼 판매대기 → 품절 → 소량 재고 → 판매중지 → 판매종료 순서다.
    const labels = [...html.matchAll(/aria-label="(판매대기 보기|품절 보기|소량 재고 보기|판매중지 보기|판매종료 보기) [^"]*"/g)].map(match => match[1]);
    expect(labels).toEqual(['판매대기 보기', '품절 보기', '소량 재고 보기', '판매중지 보기', '판매종료 보기']);
    expect(html).toMatch(/<a(?=[^>]*aria-label="판매대기 보기 2건")(?=[^>]*data-tone="info")(?=[^>]*href="[^"]*salePeriod=scheduled)/);
    expect(html).toMatch(/<a(?=[^>]*aria-label="판매중지 보기 3건")(?=[^>]*data-tone="danger")(?=[^>]*href="[^"]*stock=stopped)/);
    expect(html).toMatch(/<a(?=[^>]*aria-label="판매종료 보기 0건")(?=[^>]*data-tone="default")(?=[^>]*href="[^"]*salePeriod=ended)/);
    // 판매기간 칸과 판매상태 칸은 서로 다른 조건이라 함께 켤 수 있고, 켜진 칸을 다시 누르면 자기 조건만 푼다.
    const both = render({ salePeriod: 'scheduled', stock: 'stopped', q: '키링' });
    expect(both).toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="판매대기 보기 2건")(?=[^>]*href="[^"]*stock=stopped[^"]*q=%ED%82%A4%EB%A7%81)/);
    expect(both).not.toMatch(/<a(?=[^>]*aria-label="판매대기 보기 2건")(?=[^>]*href="[^"]*salePeriod=)/);
    expect(both).toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="판매중지 보기 3건")(?=[^>]*href="[^"]*stock=all[^"]*salePeriod=scheduled)/);
    expect(both).toMatch(/<a(?=[^>]*aria-label="판매종료 보기 0건")(?=[^>]*href="[^"]*salePeriod=ended)/);
    expect(both).not.toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="판매종료 보기 0건")/);
    // 건수를 읽지 못해도 칸은 조회 링크로 남고 집계 없음으로 말한다.
    for (const missing of [null, undefined]) {
      const fallback = render({}, { saleStateCounts: missing });
      expect(fallback).toMatch(/<a(?=[^>]*aria-label="판매대기 보기 집계 없음")(?=[^>]*href="[^"]*salePeriod=scheduled)/);
      expect(fallback).toMatch(/<a(?=[^>]*aria-label="판매중지 보기 집계 없음")(?=[^>]*href="[^"]*stock=stopped)/);
      expect(fallback).toMatch(/<a(?=[^>]*aria-label="품절 보기 4건")/);
    }
  });
  it('재고 칸 아래에 품절·소량 재고의 기준을 글자로 보이고, 소량 재고에 수량 기준이 없다는 것을 밝힌다', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0, stockCounts: { out_of_stock: 1, low: 2 } }} />);
    expect(html).toMatch(/<div(?=[^>]*aria-describedby="goods-list-stock-basis")(?=[^>]*role="group")/);
    const basis = /<p[^>]*id="goods-list-stock-basis"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? '';
    expect(basis).toContain('품절: 판매중지가 아닌 상품 중 사용 옵션 재고 0개');
    expect(basis).toContain('소량 재고: 판매상태를 소량 재고로 지정하고 재고가 남은 상품');
    expect(basis).toContain('수량으로 자동 분류하지 않습니다');
    expect(html).toContain('옵션별 안전재고 기준 이하 경고는 재고수량 칸에 부족 N개 옵션으로 표시되고 소량 재고 건수에는 들어가지 않습니다');
    expect(html).toContain('품절·소량 재고·판매중지 건수는 판매상태 조건과 페이지를, 판매대기·판매종료 건수는 판매기간 조건과 페이지를 제외한 같은 검색 조건으로 계산합니다');
  });
  it('재고 건수를 읽지 못하면 칸은 조회 링크로 남고 집계 없음으로 말한다', () => {
    for (const stockCounts of [null, undefined]) {
      const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0, stockCounts }} />);
      expect(html).toMatch(/<a(?=[^>]*aria-label="품절 보기 집계 없음")(?=[^>]*href="[^"]*stock=out_of_stock)/);
      expect(html).toMatch(/<a(?=[^>]*aria-label="소량 재고 보기 집계 없음")(?=[^>]*href="[^"]*stock=low)/);
    }
  });
  it('품절·소량 재고 칸은 건수가 있을 때만 의미색이고, 준비 사유는 주의색이며, 주 색 링크는 첫 칸 하나다', () => {
    const base = { code: 'A', name: '상품', ipId: 'ip', ipTitle: 'IP', stock: 'ok' as const, stockQty: 3, activeStockQty: 3, lowStockOptionCount: 0, noticeComplete: true, archivedAt: null, publishedAt: null, customerVisible: false };
    const readiness = { ...unknownGoodsReadiness(), state: 'blocked' as const, reasons: [{ code: 'image_missing' as const, ...GOODS_READINESS_REASONS.image_missing, kind: 'blocking' as const }] };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 1, ips: [], goods: [{ ...base, id: 'long-good-id-1234567890', readiness }], stockCounts: { out_of_stock: 3, low: 1 } }} />);
    const card = (source: string, label: string) => new RegExp(`<a(?=[^>]*aria-label="${label}")[^>]*>[\\s\\S]*?</a>`).exec(source)?.[0] ?? '';
    expect(html).toMatch(/<a(?=[^>]*data-tone="danger")(?=[^>]*aria-label="품절 보기 3건")/);
    expect(html).toMatch(/<a(?=[^>]*data-tone="warning")(?=[^>]*aria-label="소량 재고 보기 1건")/);
    expect(card(html, '품절 보기 3건')).toContain('text-destructive');
    expect(card(html, '소량 재고 보기 1건')).toContain('text-warning');
    // 0건은 처리할 것이 없으니 회색으로 물러난다(ADR-0029).
    const empty = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 0, ips: [], goods: [], stockCounts: { out_of_stock: 0, low: 0 } }} />);
    expect(card(empty, '품절 보기 0건')).not.toContain('text-destructive');
    expect(card(empty, '소량 재고 보기 0건')).not.toContain('text-warning');
    expect(html).toMatch(/<a class="[^"]*\btext-warning\b[^"]*" href="[^"]*">(?:<svg[\s\S]*?<\/svg>)?대표 이미지 미입력 →<\/a>/);
    const idLink = /<a class="([^"]*)" title="long-good-id-1234567890" data-goods-list="good-id"/.exec(html)?.[1] ?? '';
    expect(idLink.split(' ')).toEqual(expect.arrayContaining(['truncate', 'text-muted-foreground']));
  });
  it('자주 쓰지 않는 조건은 상세검색에 접혀도 같은 폼으로 제출되고, 걸려 있으면 펼친다', () => {
    const render = (values: Record<string, string>) => renderToStaticMarkup(<GoodsListFiltersForm data={{ filters: normalizeGoodsListFilters(values), goods: [], ips: [], total: 0 }} />);
    const html = render({});
    const marker = html.indexOf('data-goods-search="advanced"');
    for (const name of ['q', 'stock', 'salePeriod', 'readiness', 'categoryId', 'ipId']) expect(html.slice(0, marker)).toContain(`name="${name}"`);
    for (const name of ['status', 'dateField', 'from', 'to']) expect(html.slice(marker)).toContain(`name="${name}"`);
    expect(render({ from: '2026-10-01' })).toMatch(/<details[^>]*data-goods-search="advanced"[^>]*open=""/);
    // 전시상태는 위 건수 칸이 현재 값을 보여 준다.
    expect(render({ status: 'draft' })).not.toMatch(/<details[^>]*data-goods-search="advanced"[^>]*open=""/);
  });
  it('빈 상품 목록에서도 지역 배송 정책 만료를 알린다', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0 }}
      shippingRegionExpiry={{ warnings: [{ originName: "김포", carrierLabel: "한진택배", id: 'policy', name: '지역 정책', version: 1, endsAt: '2026-09-27T00:00:00Z', status: 'expired' }] }} />);
    expect(html).toContain('정책 만료');
    expect(html).toContain('href="/admin/settings/shipping-regions"');
  });
  it('renders catalog filters and twenty-row paging with a precise edit link', () => {
    const html=renderToStaticMarkup(<GoodsListScreen data={{
      filters:normalizeGoodsListFilters({q:'ICONS',ipId:'hwasan',page:'2'}),total:1000,
      ips:[{id:'hwasan',title:'화산강림',archivedAt:null}],
      goods:[{id:'g100',code:'ICONS-100',name:'운영 상품',ipId:'hwasan',ipTitle:'화산강림',publishedAt:null,archivedAt:null,stock:'ok',noticeComplete: true, stockQty:0,activeStockQty:0,lowStockOptionCount:0}],
    }}/>);
    expect(html).toContain('data-slot="table"');
    expect(html).toContain('상품코드'); expect(html).toContain('상품명');
    expect(html).toContain('ERP 코드·품명');
    expect(html).toContain('바코드');
    expect(html).toContain('name="categoryId"'); expect(html).toContain('name="readiness"');
    expect(html).toContain('name="q"'); expect(html).toContain('name="ipId"');
    expect(html).toContain('name="status"'); expect(html).toContain('name="stock"');
    expect(html).toContain('goodId=g100'); expect(html).toContain('page=3');
    expect(html).toContain('임시저장'); expect(html).toContain('품절');
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
