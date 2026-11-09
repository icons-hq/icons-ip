import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { GoodsListScreen } from './GoodsListScreen';
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
    for (const label of ['판매가 바로 수정', '판매상태 바로 수정', '재고수량 바로 수정']) expect(html).toContain(`aria-label="${label}"`);
    // 판매가 바로 수정은 편집기의 판매가와 같은 뜻일 때만: 상품 할인·진행 중인 즉시할인 상품은 이유만 보인다.
    expect(html.match(/판매가 바로 수정/g)).toHaveLength(1);
    expect(html).toContain('상품 할인 중 · 판매가는 상품 수정에서 변경'); expect(html).toContain('#good-section-price');
    expect(html).toContain('할인을 중지한 뒤 판매가를 바꿀 수 있습니다');
    expect(html.match(/재고수량 바로 수정/g)).toHaveLength(2);
    expect(html).toContain('옵션별 재고 수정');
    expect(html).toContain('IP 전체 즉시할인');
    const readOnly = renderToStaticMarkup(<GoodsListScreen data={data} bulkIdentity={identity} />);
    expect(readOnly).not.toContain('바로 수정'); expect(readOnly).not.toContain('IP 전체 즉시할인');
  });
  it('R11: 판매가·재고수량은 칸 전체가 바로 수정이고, 같은 칸의 보조 링크는 덮개 위에 남는다', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    const good = { id: 'good-a', code: 'A', name: '상품 A', ipId: 'maple', ipTitle: '메이플', publishedAt: null, archivedAt: null, stock: 'ok' as const, stockQty: 7,
      activeStockQty: 7, lowStockOptionCount: 0, noticeComplete: true, priceMin: 10000, priceMax: 10000, basePrice: 10000, activeVariantCount: 1,
      inlineStock: { variantId: 'b9000000-0000-4000-8000-000000000010', stockQty: 7 } };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [good], ips: [], total: 1 }} canIssueMarketingLinks bulkIdentity={identity} />);
    // 판매가·재고수량 값 버튼은 칸을 채우는 덮개형(data-inline-edit="cell")이고, 다른 링크와 한 칸을 쓰는 판매상태는 그 줄만 채운다.
    // 덮개가 감싼 칸을 기준 상자로 세우는 방식(틀고정 칸은 sticky 그대로)과 인쇄는 components/admin/GoodsInlineEdit.test.tsx가 확인한다.
    const cellOf = (label: string) => new RegExp(`data-inline-edit="(cell|value)"><button[^>]*aria-label="${label} 바로 수정"`).exec(html)?.[1];
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
  it('상품번호 열: 고객에게 보이는 상품은 고객 화면을 새 탭으로, 아니면 편집기 미리보기로 연다. 상품명은 지금처럼 수정 화면이다', () => {
    const base = { code: 'A', name: '상품 A', ipId: 'maple', ipTitle: '메이플', archivedAt: null, stock: 'ok' as const, stockQty: 1, activeStockQty: 1, lowStockOptionCount: 0, noticeComplete: true };
    const filters = normalizeGoodsListFilters({ q: '상품' });
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters, total: 2, ips: [], goods: [
      { ...base, id: 'good-public', publishedAt: '2026-10-01T00:00:00Z', customerVisible: true },
      { ...base, id: 'good-draft', publishedAt: null, customerVisible: false },
    ] }} />);
    expect(html).toContain('>상품번호</th>');
    expect(html).toMatch(/<a [^>]*data-goods-list="good-id" href="\/shop\/good-public" target="_blank" rel="noopener noreferrer">good-public/);
    expect(html).toContain(`href="${goodEditorHref(filters, 'good-draft').replaceAll('&', '&amp;')}#good-preview"`);
    expect(html).toContain('공개 전 · 미리보기');
    // 상품명(첫 열)은 수정 화면으로 간다.
    expect(html).toContain(`hover:underline" href="${goodEditorHref(filters, 'good-public').replaceAll('&', '&amp;')}">`);
    // 상품번호는 열로 옮겼으므로 접힌 추가 정보에 다시 두지 않는다.
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
      expect(row(html, 'selling')).toMatch(/aria-label="판매상태 바로 수정"[^>]*>(?:(?!<\/button>)[\s\S])*data-tone="success"/);
      expect(row(html, 'draft')).toMatch(/aria-label="판매상태 바로 수정"[^>]*>(?:(?!<\/button>)[\s\S])*공개 시 <\/span>판매중/);
      expect(row(html, 'draft')).not.toContain('판매상태 </span>');
      expect(row(html, 'not-ready')).toMatch(/aria-label="판매상태 바로 수정"[^>]*>(?:(?!<\/button>)[\s\S])*판매상태 <\/span>판매중/);
      expect(row(html, 'draft')).not.toMatch(/aria-label="판매상태 바로 수정"[^>]*>(?:(?!<\/button>)[\s\S])*data-tone=/);
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
  it('1440 화면에서 끝 열까지 들어오고, 긴 영문이 많은 상품번호는 맨 뒤 열이다', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0, counts: { all: 0, active: 0, draft: 0, published: 0, archived: 0 } }} canIssueMarketingLinks />);
    const widths = [...html.matchAll(/<col style="width:(\d+)px"/g)].map(match => Number(match[1]));
    expect(widths.length).toBe(9);
    // 체크박스 칸(40) 포함 1100px(1440 화면의 표 영역) 안에 든다.
    expect(widths.reduce((sum, width) => sum + width, 40)).toBeLessThanOrEqual(1100);
    const headers = [...html.matchAll(/<th[^>]*scope="col"[^>]*>([^<]+)<\/th>/g)].map(match => match[1]);
    expect(headers.at(-1)).toBe('상품번호');
    expect(html).toContain('아직 등록한 상품이 없습니다');
  });
  it('기본 조회인 보관 제외 칸이 켜져 있고, 품절·소량 재고는 조회 링크로 바로 찾는다', () => {
    const counts = { all: 20, active: 15, draft: 3, published: 12, archived: 5 };
    const render = (values: Record<string, string>) => renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters(values), goods: [], ips: [], total: 0, counts }} />);
    expect(render({})).toMatch(/<a(?=[^>]*aria-current="page")(?=[^>]*aria-label="보관 제외 15건")/);
    expect(render({})).toMatch(/<a(?=[^>]*aria-label="품절 보기")(?=[^>]*href="[^"]*stock=out_of_stock)/);
    expect(render({})).toMatch(/<a(?=[^>]*aria-label="소량 재고 보기")(?=[^>]*href="[^"]*stock=low)/);
    // 켜진 재고 칸을 다시 누르면 재고 조건을 푼다.
    expect(render({ stock: 'out_of_stock' })).toMatch(/<a(?=[^>]*aria-current="true")(?=[^>]*aria-label="품절 보기")(?=[^>]*href="[^"]*stock=all)/);
  });
  it('품절·소량 재고 칸은 숫자가 없어도 의미색이고, 준비 사유는 주의색이며, 주 색 링크는 첫 칸 하나다', () => {
    const base = { code: 'A', name: '상품', ipId: 'ip', ipTitle: 'IP', stock: 'ok' as const, stockQty: 3, activeStockQty: 3, lowStockOptionCount: 0, noticeComplete: true, archivedAt: null, publishedAt: null, customerVisible: false };
    const readiness = { ...unknownGoodsReadiness(), state: 'blocked' as const, reasons: [{ code: 'image_missing' as const, ...GOODS_READINESS_REASONS.image_missing, kind: 'blocking' as const }] };
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), total: 1, ips: [], goods: [{ ...base, id: 'long-good-id-1234567890', readiness }] }} />);
    expect(html).toMatch(/<a(?=[^>]*data-tone="danger")(?=[^>]*aria-label="품절 보기")/);
    expect(html).toMatch(/<a(?=[^>]*data-tone="warning")(?=[^>]*aria-label="소량 재고 보기")/);
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
