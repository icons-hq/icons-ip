import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/goods-bulk-actions', () => ({ previewGoodsBulkAction: vi.fn(), commitGoodsBulkAction: vi.fn(), readGoodsBulkAction: vi.fn() }));
vi.mock('@/app/admin/goods-group-actions', () => ({ readGoodsGroupOperationAction: vi.fn(), readGoodsGroupSourceAction: vi.fn(), searchGoodsGroupProductsAction: vi.fn() }));
import { newDiscountPromotionHref } from '@/lib/admin/discount-promotions';
import type { GoodsBulkCommand, GoodsBulkFormFields, GoodsBulkGood, GoodsBulkKind, GoodsBulkPreview } from '@/lib/admin/goods-bulk';
import { GoodsBulkForm, GoodsBulkPreviewTable, GoodsBulkSkippedList, goodsBulkDialogTitle, goodsBulkInitialFields } from './GoodsBulkToolbar';

/*
 * 일괄 변경 창의 화면(화면 규칙 PR 2 — B-02·B-04·B-05·B-07·B-08·B-10, 결정 D4).
 * 설정(GoodsBulkForm)·저장 전 표(GoodsBulkPreviewTable)·건너뛴 목록(GoodsBulkSkippedList)은 훅이 없는 부품이라 그대로 그려 본다.
 */
const noop = () => undefined;
function formHtml(command: GoodsBulkCommand, fields: Partial<GoodsBulkFormFields> = {}, kind: GoodsBulkKind = 'goods') {
  return renderToStaticMarkup(<GoodsBulkForm kind={kind} command={command} fields={{ ...goodsBulkInitialFields(command), ...fields }} locked={false}
    promotionIp={kind === 'ip' ? 'maple-story' : undefined} onCommand={noop} onFields={noop} onSubmit={noop} />);
}
const cards = (html: string) => [...html.matchAll(/<label[^>]*data-good-choice-card=""[^>]*>.*?<input type="radio"([^>]*)\/>([^<]*)<\/span>/g)].map(match => ({ checked: match[1].includes('checked=""'), title: match[2] }));
const good = (id: string, patch: Partial<GoodsBulkGood> = {}): GoodsBulkGood => ({ id, name: `상품 ${id}`, code: id.toUpperCase(), price: 10000, nextPrice: 10000, priceMin: 10000, priceMax: 12000,
  nextMin: 10000, nextMax: 12000, published: false, archived: false, stopped: false, skip: null, ...patch });
const preview = (command: GoodsBulkCommand, goods: GoodsBulkGood[], values: GoodsBulkPreview['request']['values'] = {}): GoodsBulkPreview => ({ state: 'ready', operationId: 'b9000000-0000-4000-8000-000000000001',
  request: { kind: 'goods', ids: goods.map(row => row.id), command, values }, groups: [], goods, expiresAt: '2026-11-26T00:15:00Z' });
const tableHtml = (value: GoodsBulkPreview) => renderToStaticMarkup(<GoodsBulkPreviewTable preview={value} />);
/** 표 본문의 줄마다 칸 글자만 '|'로 이어 붙인다(머리글 줄은 뺀다). */
const rows = (html: string) => html.split('<tr').slice(2).map(part => part.slice(part.indexOf('>') + 1).split('</tr>')[0].replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'));

describe('일괄 변경 설정: 고르면 필요한 입력만 열린다', () => {
  it('전시상태·판매상태·기간 할인은 창 첫 줄의 선택 카드로 방향을 고른다(반대 동작을 드롭다운에 숨기지 않는다)', () => {
    expect(cards(formHtml('publish'))).toEqual([{ checked: true, title: '공개로' }, { checked: false, title: '초안으로' }]);
    expect(cards(formHtml('stop'))).toEqual([{ checked: false, title: '판매중으로' }, { checked: true, title: '판매중지로' }]);
    expect(cards(formHtml('discount_stop'))).toEqual([{ checked: false, title: '기간 할인 걸기' }, { checked: true, title: '기간 할인 중지' }]);
    expect(formHtml('publish')).not.toContain('<select');
    for (const [command, title] of [['publish', '전시상태 변경'], ['unpublish', '전시상태 변경'], ['start', '판매상태 변경'], ['discount_stop', '기간 할인'], ['archive', '보관'], ['restore', '복원'], ['period', '판매기간 변경']] as const)
      expect(goodsBulkDialogTitle(command)).toBe(title);
  });
  it("판매기간은 '기간 정하기'와 '기간 없이 계속 판매' 가운데 고른 쪽의 입력만 연다 — 날짜를 적고도 말없이 버려지지 않는다", () => {
    const range = formHtml('period', { startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59' });
    expect(cards(range)).toEqual([{ checked: true, title: '기간 정하기' }, { checked: false, title: '기간 없이 계속 판매' }]);
    expect(range.match(/type="datetime-local"/g)).toHaveLength(2);
    expect(range).toContain('시작 (KST)'); expect(range).toContain('종료 (KST)');
    /* 넣은 날짜를 한 줄로 되읽는다. */
    expect(range).toMatch(/data-good-readback=""[^>]*>(\d{4}년 )?12월 1일 10:00부터 7일 23:59까지 팝니다\.</);
    const none = formHtml('period', { periodMode: 'none', startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59' });
    expect(cards(none)).toEqual([{ checked: false, title: '기간 정하기' }, { checked: true, title: '기간 없이 계속 판매' }]);
    expect(none).not.toContain('datetime-local');
    expect(none).not.toContain('data-good-readback');
    expect(none).not.toContain('type="checkbox"');
    expect(formHtml('period', { startsAt: '2026-12-07T10:00', endsAt: '2026-12-01T10:00' })).toContain('종료가 시작보다 앞입니다. 날짜를 다시 확인해주세요.');
  });
  it('금액 칸은 고른 방식의 단위(원·%)를 뒤에 붙이고 이름도 금액·비율로 바뀐다', () => {
    const amount = formHtml('price', { mode: 'increase', value: '500' });
    expect(amount).toMatch(/<label for="goods-bulk-goods-value">금액<\/label>/);
    expect(amount).toMatch(/aria-hidden="true"[^>]*>원<\/span>/);
    const rate = formHtml('price', { mode: 'percent_decrease', value: '10' });
    expect(rate).toMatch(/<label for="goods-bulk-goods-value">비율<\/label>/);
    expect(rate).toMatch(/aria-hidden="true"[^>]*>%<\/span>/);
    expect(rate).not.toContain('금액 또는 비율');
    expect(formHtml('discount', { mode: 'rate' })).toMatch(/aria-hidden="true"[^>]*>%<\/span>/);
    expect(formHtml('discount', { startsAt: '2026-12-01T10:00', endsAt: '2026-12-07T23:59' })).toMatch(/12월 1일 10:00부터 7일 23:59까지 할인합니다\./);
  });
  it('설명 문단 대신 화면에 보이지 않는 결과만 한 줄로 남긴다', () => {
    expect(formHtml('price')).toContain('옵션가는 그대로 둡니다. 비율로 계산하면 1원 미만은 버립니다.');
    expect(formHtml('discount_stop')).toContain('상품마다 따로 건 할인과 할인 프로모션이 건 할인도 함께 멈춥니다. 멈춘 할인은 되살릴 수 없습니다.');
    expect(formHtml('restore')).toContain('복원한 상품은 초안으로 돌아옵니다.');
    expect(formHtml('discount', {}, 'ip')).toContain(`href="${newDiscountPromotionHref({ ip: 'maple-story' })}"`);
    expect(formHtml('discount')).toContain(`href="${newDiscountPromotionHref()}"`);
    const all = (['publish', 'unpublish', 'start', 'stop', 'archive', 'restore', 'price', 'discount', 'discount_stop', 'period', 'dissolve'] as const).map(command => formHtml(command)).join('');
    for (const stale of ['비교 시점', '비교 결과', '유효합니다', '판매 재개', '판매 운영', '전시 중지', '즉시할인 등록', '제한 해제', '해당']) expect(all, stale).not.toContain(stale);
    /* QA S3: 보관 창이 대상 한 줄과 버튼뿐이라 무슨 일이 일어나는지(고객 화면에서 내려감·복원하면 초안·재고가 남으면 안 됨)를 미리보기에서야 알았다. */
    expect(formHtml('archive')).toContain('보관한 상품은 고객 화면에서 내려가고, [복원]하면 초안으로 돌아옵니다. 재고수량이 0인 상품만 보관됩니다.');
    for (const command of ['publish', 'unpublish', 'start', 'stop'] as const) expect(formHtml(command), command).not.toContain('<p');
  });
});

describe('저장 전 표: 상품마다 현재 → 변경 후, 건너뛰는 상품은 이유와 함께', () => {
  it('건너뛰는 상품을 맨 위에 이유와 함께 두고, 바꿀 상품·건너뜀 수를 센다', () => {
    const html = tableHtml(preview('publish', [good('good-a'), good('good-b', { skip: 'goods_category_required' }), good('good-c', { archived: true, skip: 'good_archived' })]));
    expect(html).toContain('공개로</strong> · 바꿀 상품 1개 · 건너뜀 2개');
    expect(rows(html)).toEqual([
      '|상품 good-b|GOOD-B|초안|건너뜀 · 대표 카테고리가 없음|',
      '|상품 good-c|GOOD-C|보관|건너뜀 · 보관된 상품(먼저 복원)|',
      '|상품 good-a|GOOD-A|초안|공개|',
    ]);
    expect(html.match(/data-skipped="true"/g)).toHaveLength(2);
    expect(html).not.toContain('바꿀 수 있는 상품이 없습니다.');
  });
  /* QA G1: 창 안쪽 폭은 544px다(576px 창 − 여백 32px). 세 열이 그 안에 들어오도록 고정 배치에 비율 폭을 주고, 표에 최소 폭을 주지 않는다.
     '변경 후'(건너뛴 이유)가 가로 스크롤 뒤로 밀리면 "건너뛴 이유를 확인해주세요"라고 말하면서 이유를 보여 주지 못한다. */
  it('표는 창 폭 안에 세 열을 모두 보인다 — 고정 배치·비율 폭이고 최소 폭이 없다', () => {
    const html = tableHtml(preview('stop', [good('good-a', { stock: 'low', skip: 'goods_notice_required' })]));
    const table = /<table[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(table.split(' ')).toEqual(expect.arrayContaining(['w-full', 'table-fixed']));
    expect(table).not.toMatch(/min-w-\[/);
    const widths = [...html.matchAll(/<th[^>]*class="([^"]*)"[^>]*>([^<]*)<\/th>/g)].map(match => [match[2], /w-\[(\d+)%\]/.exec(match[1])?.[1] ?? 'auto']);
    expect(widths).toEqual([['상품명·상품 자동코드', '36'], ['현재', '24'], ['변경 후', 'auto']]);
    /* 줄의 칸은 줄을 바꾼다(한 줄로 늘어나 칸을 넘치지 않는다). */
    expect(html.match(/<td[^>]*class="[^"]*whitespace-normal/g)).toHaveLength(3);
  });
  /* B-08: 소량 재고로 지정한 상품은 [판매중으로]가 건드리지 않는다 — 지금 판매상태를 그대로 보이고 건너뛴다고 말한다. */
  it('판매중으로: 판매중지인 상품만 바뀌고 소량 재고·판매중 상품은 지금 상태 그대로 건너뛴다', () => {
    const html = tableHtml(preview('start', [good('good-a', { stopped: true, stock: 'soldout' }), good('good-b', { stock: 'low', skip: 'goods_bulk_not_stopped' }), good('good-c', { stock: 'ok', skip: 'goods_bulk_not_stopped' })]));
    expect(rows(html)).toEqual([
      '|상품 good-b|GOOD-B|소량 재고|건너뜀 · 판매중지가 아님|',
      '|상품 good-c|GOOD-C|판매중|건너뜀 · 판매중지가 아님|',
      '|상품 good-a|GOOD-A|판매중지|판매중|',
    ]);
    for (const stale of ['판매 운영', '판매 중지', '판매 재개']) expect(html).not.toContain(stale);
    expect(rows(tableHtml(preview('stop', [good('good-b', { stock: 'low' })])))).toEqual(['|상품 good-b|GOOD-B|소량 재고|판매중지|']);
  });
  it('판매가는 금액 범위를, 판매기간은 지금 기간과 새 기간을 보이고, 건너뛴 줄의 이유는 그 명령의 말로 쓴다', () => {
    const price = tableHtml(preview('price', [good('good-a', { nextPrice: 10500, nextMin: 10500, nextMax: 12500 }), good('good-b', { priceMax: 10000, skip: 'goods_bulk_price_invalid' })], { mode: 'increase', value: 500 }));
    expect(rows(price)).toEqual(['|상품 good-b|GOOD-B|10,000원|건너뜀 · 새 판매가가 1원보다 작거나 너무 큼|', '|상품 good-a|GOOD-A|10,000원 ~ 12,000원|10,500원 ~ 12,500원|']);
    const period = tableHtml(preview('period', [good('good-a', { saleStartsAt: null, saleEndsAt: null }), good('good-b', { saleStartsAt: '2026-11-01T01:00:00+00:00', saleEndsAt: '2026-11-10T14:59:00+00:00' })],
      { startsAt: '2026-12-01T01:00:00.000Z', endsAt: '2026-12-07T14:59:00.000Z' }));
    const cells = rows(period).map(row => row.replace(/\d{4}년 /g, ''));
    expect(cells).toEqual(['|상품 good-a|GOOD-A|기간 없음|12월 1일 10:00부터 7일 23:59까지|', '|상품 good-b|GOOD-B|11월 1일 10:00부터 10일 23:59까지|12월 1일 10:00부터 7일 23:59까지|']);
    expect(rows(tableHtml(preview('period', [good('good-b', { saleStartsAt: '2026-11-01T01:00:00+00:00', saleEndsAt: '2026-11-10T14:59:00+00:00' })], { startsAt: null, endsAt: null })))[0]).toMatch(/까지\|기간 없음\|$/);
    expect(rows(tableHtml(preview('restore', [good('good-a', { archived: true })])))).toEqual(['|상품 good-a|GOOD-A|보관|초안|']);
  });
  it('모두 건너뛰면 표 위에서 바로 알리고, 상품 자동코드가 없어도 내부 값을 내보이지 않는다', () => {
    const html = tableHtml(preview('archive', [good('internal-good-id', { name: '재고 남은 상품', code: null, skip: 'good_has_stock' })]));
    expect(html).toContain('바꿀 수 있는 상품이 없습니다.');
    expect(html).toContain('바꿀 상품 0개 · 건너뜀 1개');
    expect(html).toContain('건너뜀 · 재고수량이 남아 있음(0으로 맞춘 뒤 보관)');
    expect(html).not.toContain('internal-good-id');
  });
  it('할인 중지는 상품마다 멈출 할인을 보이고 멈출 건수를 센다', () => {
    const discounts = { count: 2, minPrice: 9000, maxPrice: 9500, startsAt: '2026-11-28T01:00:00Z', endsAt: '2026-11-30T01:00:00Z' };
    const html = tableHtml(preview('discount_stop', [good('good-a', { discounts }), good('good-b', { discounts: null, skip: 'no_active_discount' })]));
    expect(html).toContain('기간 할인 중지</strong> · 바꿀 상품 1개 · 건너뜀 1개 · 멈출 할인 2건');
    expect(html).toContain('할인 2건 · 9,000원 ~ 9,500원');
    expect(html).toContain('건너뜀 · 진행 중이거나 예정된 기간 할인이 없음');
  });
});

describe('저장 뒤 건너뛴 목록', () => {
  it('상품 이름과 이유를 남기고, 상품 자동코드가 없으면 내부 값 대신 이유만 적는다', () => {
    const html = renderToStaticMarkup(<GoodsBulkSkippedList command="publish" skipped={[
      { id: 'good-b', name: '상품 B', code: 'GOOD-B', reason: 'goods_kc_review_required' }, { id: 'internal-good-id', name: '상품 C', code: null, reason: 'some_new_reason' }]} />);
    expect(html).toContain('건너뛴 상품 2개');
    expect(html).toContain('상품 B'); expect(html).toContain('GOOD-B · KC 검토가 끝나지 않음');
    expect(html).toContain('지금은 바꿀 수 없음(상품 수정에서 확인)');
    expect(html).not.toContain('internal-good-id');
    expect(renderToStaticMarkup(<GoodsBulkSkippedList skipped={[]} />)).toBe('');
  });
});
