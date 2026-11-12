import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn(), read: vi.fn(), adjust: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/goods-bulk-actions', () => ({ previewGoodsBulkAction: mocks.preview, commitGoodsBulkAction: mocks.commit, readGoodsBulkAction: mocks.read }));
vi.mock('@/app/admin/actions', () => ({ adjustAdminStockAction: mocks.adjust }));
vi.mock('@/app/admin/goods-list-inline-actions', () => ({ readGoodsOptionStocksAction: vi.fn() }));
import { GoodsInlineOptionStock, GoodsInlinePrice, GoodsInlineSale, GoodsInlineStock, InlineEditor, runSingleGoodBulk } from './GoodsInlineEdit';
import { GoodsInlineDialogHost } from './GoodsInlineDialogHost';
import { saveGoodsOptionStocks } from './GoodsOptionStockDialog';

const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
const row = { id: 'good-a', name: '상품 A', code: 'A', price: 10000, nextPrice: 12000, priceMin: 10000, priceMax: 10000, nextMin: 12000, nextMax: 12000, published: true, archived: false, stopped: false, skip: null };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockImplementation(async (operationId: string, request: unknown) => ({ value: { state: 'ready', operationId, request, groups: [], goods: [row], expiresAt: '2026-10-27T00:15:00Z' } }));
  mocks.commit.mockImplementation(async (operationId: string) => ({ value: { state: 'completed', operationId, goodsCount: 1, groupsCount: 0, error: null } }));
  mocks.read.mockResolvedValue({ value: { state: 'sealed' } });
});

describe('상품 목록 바로 수정 (A9)', () => {
  it('목록에서 본 값과 현재 값이 같으면 기존 일괄 변경 경로로 상품 1개만 확정한다', async () => {
    const result = await runSingleGoodBulk(identity, 'good-a', 'price', { mode: 'set', value: 12000 }, current => current.price === 10000 ? null : 'stale');
    expect(result).toEqual({ ok: true });
    expect(mocks.preview).toHaveBeenCalledWith(expect.any(String), { kind: 'goods', ids: ['good-a'], command: 'price', values: { mode: 'set', value: 12000 } }, identity);
    expect(mocks.commit).toHaveBeenCalledWith(mocks.preview.mock.calls[0][0], identity);
  });
  it('다른 곳에서 값이 바뀌었으면 확정하지 않고 요청을 종료한다', async () => {
    const result = await runSingleGoodBulk(identity, 'good-a', 'price', { mode: 'set', value: 12000 }, current => current.price === 9000 ? null : '판매가가 바뀌었습니다.');
    expect(result).toEqual({ ok: false, message: '판매가가 바뀌었습니다.' });
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledWith(mocks.preview.mock.calls[0][0], identity, true);
  });
  it('응답이 불확실하면 재실행 대신 같은 요청의 결과 조회를 남긴다', async () => {
    mocks.commit.mockResolvedValueOnce({ error: '처리 결과가 불명확합니다.', uncertain: true });
    const result = await runSingleGoodBulk(identity, 'good-a', 'stop', {}, () => null);
    expect(result).toEqual({ ok: false, message: '처리 결과가 불명확합니다.', operationId: mocks.preview.mock.calls[0][0] });
  });
  it('확정 거절은 운영자 문구로 옮긴다', async () => {
    mocks.commit.mockImplementationOnce(async (operationId: string) => ({ value: { state: 'rejected', operationId, goodsCount: 0, groupsCount: 0, error: 'goods_compare_at_price_invalid' } }));
    const result = await runSingleGoodBulk(identity, 'good-a', 'price', { mode: 'set', value: 12000 }, () => null);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('정가') });
  });
  it('값 버튼은 셀 안에서 바로 수정을 연다', () => {
    const html = renderToStaticMarkup(<>
      <GoodsInlinePrice goodId="good-a" basePrice={10000} identity={identity} hasOptions={false} display="10,000원" />
      <GoodsInlineSale goodId="good-a" stopped identity={identity} />
      <GoodsInlineStock goodId="good-a" ipId="ip-a" variantId="b9000000-0000-4000-8000-000000000010" stockQty={7} />
    </>);
    // 접근 가능한 이름에 보이는 값을 넣어 음성 명령으로도 누를 수 있다(WCAG 2.5.3).
    for (const label of ['판매가 10,000원 바로 수정', '판매상태 판매중지 바로 수정', '재고수량 7개 바로 수정']) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('판매중지'); expect(html).toContain('7개');
  });
  it('판매가·재고수량은 셀 전체가 수정 버튼이고, 다른 링크와 함께 있는 판매상태는 그 줄을 채운다', () => {
    const cell = (markup: string) => /data-inline-edit="(cell|value)"/.exec(markup)?.[1] === 'cell';
    expect(cell(renderToStaticMarkup(<GoodsInlinePrice goodId="good-a" basePrice={10000} identity={identity} hasOptions={false} display="10,000원" />))).toBe(true);
    expect(cell(renderToStaticMarkup(<GoodsInlineStock goodId="good-a" ipId="ip-a" variantId="b9000000-0000-4000-8000-000000000010" stockQty={7} />))).toBe(true);
    expect(cell(renderToStaticMarkup(<GoodsInlineSale goodId="good-a" stopped identity={identity} />))).toBe(false);
  });

  /* R11(10/27 회의) — 칸 전체 클릭은 값 버튼의 덮개(::after)가 칸(td)을 기준 상자로 덮어 만든다. 표 부품의 클래스에 기대지 않는다. */
  const classesOf = (markup: string, pattern: RegExp) => (pattern.exec(markup)?.[1] ?? '').replaceAll('&amp;', '&').split(/\s+/).filter(Boolean);
  it('칸 전체 덮개는 감싼 칸을 기준 상자로 세우고, 값은 칸 폭을 채우며 오른쪽 정렬 칸에서 오른쪽에 선다', () => {
    const price = renderToStaticMarkup(<GoodsInlinePrice goodId="good-a" basePrice={10000} identity={identity} hasOptions={false} display="10,000원" />);
    expect(classesOf(price, /<span class="([^"]*)" data-inline-edit="cell">/)).toContain('[td:has(&)]:relative');
    expect(classesOf(price, /<button(?=[^>]*aria-label="판매가 [^"]*바로 수정")[^>]*class="([^"]*)"/)).toEqual(expect.arrayContaining(['w-full', 'after:absolute', 'after:inset-0', 'print:after:hidden', 'in-data-[align=end]:justify-end']));
    const sale = renderToStaticMarkup(<GoodsInlineSale goodId="good-a" stopped identity={identity} />);
    expect(classesOf(sale, /<button(?=[^>]*aria-label="판매상태 [^"]*바로 수정")[^>]*class="([^"]*)"/)).toEqual(expect.arrayContaining(['w-full', 'in-data-[align=end]:justify-end']));
    expect(sale).not.toContain('after:absolute');
    expect(sale).not.toContain('[td:has(&)]:relative');
  });
  /* 두 창은 목록 화면(GoodsInlineDialogHost)이 연다 — 칸은 값 버튼만 그리고 창은 칸 밖에 둔다. */
  const NOTE_CLASSES = ['text-right', 'text-xs', 'font-normal', 'whitespace-nowrap', 'text-muted-foreground'];
  const noteClasses = (markup: string, text: string) => (new RegExp(`<small class="([^"]*)">${text}</small>`).exec(markup)?.[1] ?? '').split(/\s+/);
  it('즉시할인이 진행·예정인 상품의 판매가 칸은 칸 전체가 할인 중지 후 변경 창을 열고, 누르기 전에는 창을 그리지 않는다(1027T-025)', () => {
    const price = <GoodsInlinePrice goodId="good-a" goodName="상품 A" goodCode="A" basePrice={10000} identity={identity} hasOptions={false} display="9,000원" valueText="9,000원" discountEndsAt="2026-11-20T00:00:00Z" />;
    const html = renderToStaticMarkup(<GoodsInlineDialogHost identity={identity}>{price}</GoodsInlineDialogHost>);
    expect(html).toMatch(/data-inline-edit="cell"><button[^>]*aria-label="판매가 9,000원 할인 중지 후 변경"/);
    expect(noteClasses(html, '할인 진행·예정')).toEqual(expect.arrayContaining(NOTE_CLASSES));
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('바로 수정');
    // 창을 여는 곳이 없으면 값과 이유만 보인다(누를 수 없는 버튼을 두지 않는다).
    const alone = renderToStaticMarkup(price);
    expect(alone).not.toContain('<button'); expect(alone).toContain('할인 진행·예정');
  });
  it('옵션이 여러 개인 상품의 재고 칸은 칸 전체가 옵션별 재고 창을 열고, 보조 글자는 한 줄로 칸 오른쪽에 맞추며 칸의 굵기를 물려받지 않는다(1014-106·107)', () => {
    const options = [{ variantId: 'b9000000-0000-4000-8000-000000000021', name: '블루', code: 'OPT-B', stockQty: 5 }, { variantId: 'b9000000-0000-4000-8000-000000000022', name: '레드', code: 'OPT-R', stockQty: 4 }];
    const stock = <GoodsInlineOptionStock goodId="good-a" ipId="ip-a" goodName="상품 A" goodCode="A" options={options} display="9개" editorHref="/admin/catalog/goods?goodId=good-a#good-section-variants" />;
    const html = renderToStaticMarkup(<GoodsInlineDialogHost identity={identity}>{stock}</GoodsInlineDialogHost>);
    expect(html).toMatch(/data-inline-edit="cell"><button[^>]*aria-label="재고수량 9개 옵션별 재고 수정"/);
    // 보조 글자는 값 버튼(왼쪽 정렬) 밖, 덮개 아래에 있어 눌러도 창이 열린다.
    expect(html).toMatch(/<\/button><small class="[^"]*">옵션별 재고<\/small>/);
    expect(noteClasses(html, '옵션별 재고')).toEqual(expect.arrayContaining(NOTE_CLASSES));
    expect(html).not.toContain('<dialog');
    expect(renderToStaticMarkup(stock)).not.toContain('<button');
  });
  it('옵션별 재고는 옵션마다 이 창에서 본 수량을 기대값으로 실재고 조정을 차례로 부르고, 거절·응답 끊김은 그 옵션의 결과로만 남긴다', async () => {
    const order: string[] = [];
    mocks.adjust.mockImplementation(async (_state: unknown, data: FormData) => {
      const variantId = String(data.get('variantId'));
      order.push(variantId);
      if (variantId === 'v-red') return { errors: { form: '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.' } };
      if (variantId === 'v-green') throw new Error('network');
      return { message: '실재고를 조정했습니다.', stockAdjustment: { variantId, stockQty: 8, adjustmentId: 'next' } };
    });
    const requests = [
      { variantId: 'v-blue', requestId: 'b9000000-0000-4000-8000-0000000000c1', expectedStockQty: 5, nextStockQty: 8, reason: '입고 반영' },
      { variantId: 'v-red', requestId: 'b9000000-0000-4000-8000-0000000000c2', expectedStockQty: 4, nextStockQty: 9, reason: '입고 반영' },
      { variantId: 'v-green', requestId: 'b9000000-0000-4000-8000-0000000000c3', expectedStockQty: 3, nextStockQty: 0, reason: '실사' },
    ];
    const outcomes = await saveGoodsOptionStocks({ goodId: 'good-a', ipId: 'ip-a' }, requests);
    expect(order).toEqual(['v-blue', 'v-red', 'v-green']);
    expect(outcomes).toEqual([
      { variantId: 'v-blue', state: 'saved', stockQty: 8 },
      { variantId: 'v-red', state: 'rejected', message: '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.' },
      { variantId: 'v-green', state: 'uncertain', message: expect.stringContaining('한 번만 반영') },
    ]);
    const sent = mocks.adjust.mock.calls.map(call => Object.fromEntries((call[1] as FormData).entries()));
    expect(sent[0]).toEqual({ adjustmentId: 'b9000000-0000-4000-8000-0000000000c1', goodId: 'good-a', ipId: 'ip-a', variantId: 'v-blue', expectedStockQty: '5', delta: '3', reason: '입고 반영' });
    expect(sent[2]).toMatchObject({ expectedStockQty: '3', delta: '-3', reason: '실사' });
  });
  it("결과가 불명확한 저장 뒤의 '처리 결과 조회' 버튼은 덮개 위에 남아 수정 폼을 열지 않는다", () => {
    const markup = renderToStaticMarkup(<InlineEditor fillCell label="판매가" display="10,000원" onSubmit={() => undefined} pending={false} error="처리 결과가 불명확합니다." recovery onRecover={() => undefined} editing={false} setEditing={() => undefined}><span /></InlineEditor>);
    const recover = /<button[^>]*class="([^"]*)"[^>]*>처리 결과 조회<\/button>/.exec(markup)?.[1]?.split(/\s+/) ?? [];
    expect(recover).toEqual(expect.arrayContaining(['relative', 'z-1']));
    expect(markup).toContain('role="alert"');
  });
});
