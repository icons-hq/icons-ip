import { describe, expect, it } from 'vitest';
import {
  ERP_LINKED_GOODS_SKIP_LABELS,
  ERP_LINKED_GOODS_SKIP_REASONS,
  erpLinkedGoodsConfirmation,
  erpLinkedGoodsCounts,
  erpLinkedGoodsErrorLabel,
  erpLinkedGoodsFailureLabel,
  erpLinkedGoodsReceiptMessage,
  formatErpLinkedGoodsValue,
  parseErpLinkedGoodsPreview,
  parseErpLinkedGoodsReceipt,
  type ErpLinkedGoodsRow,
} from './erp-linked-goods';

const VARIANT = '00000000-0000-4000-8000-000000071201';
const row = (field: 'price' | 'barcode', extra: Partial<ErpLinkedGoodsRow> = {}): ErpLinkedGoodsRow => ({
  key: `${VARIANT}:${field}`, field, goodId: 'erp-good', goodName: '아크릴 키링', goodCode: 'G-1', published: true,
  variantId: VARIANT, optionName: '기본 옵션', isDefault: true, erpCode: '000123', erpName: '아크릴 키링',
  current: field === 'price' ? 10000 : null, next: field === 'price' ? 11000 : '0088012345678',
  status: 'apply', reason: null, warning: null, ...extra,
});
const preview = (rows: unknown[]) => ({ operationId: 'op', expiresAt: '2026-11-13T01:15:00Z', scopeCount: null, linked: 4, total: rows.length, truncated: false, rows });

describe('연결 상품 반영 미리보기 계약', () => {
  it('DB 결과를 그대로 읽고, 선행 0이 있는 바코드는 글자로 둔다', () => {
    const parsed = parseErpLinkedGoodsPreview(preview([row('price'), row('barcode', { current: '0088', warning: 'barcode_changed' })]));
    expect(parsed?.rows.map((entry) => [entry.key, entry.current, entry.next, entry.warning])).toEqual([
      [`${VARIANT}:price`, 10000, 11000, null],
      [`${VARIANT}:barcode`, '0088', '0088012345678', 'barcode_changed'],
    ]);
    expect(parsed).toMatchObject({ operationId: 'op', scopeCount: null, linked: 4, total: 2, truncated: false });
  });

  it('건너뛰는 행은 아는 사유가 있어야 하고, 반영 행은 사유가 없어야 한다', () => {
    expect(parseErpLinkedGoodsPreview(preview([row('price', { status: 'skip', reason: 'active_discount' })]))?.rows[0].reason).toBe('active_discount');
    expect(parseErpLinkedGoodsPreview(preview([row('price', { status: 'skip', reason: null })]))).toBeNull();
    expect(parseErpLinkedGoodsPreview(preview([{ ...row('price'), reason: 'unknown_reason' }]))).toBeNull();
    expect(parseErpLinkedGoodsPreview(preview([row('price', { reason: 'zero_price' })]))).toBeNull();
  });

  it('형식이 어긋나면 반영 버튼을 열지 않게 null을 돌려준다', () => {
    expect(parseErpLinkedGoodsPreview(null)).toBeNull();
    expect(parseErpLinkedGoodsPreview(preview([{ ...row('price'), key: 'other:price' }]))).toBeNull();
    expect(parseErpLinkedGoodsPreview(preview([{ ...row('price'), next: '11000' }]))).toBeNull();
    expect(parseErpLinkedGoodsPreview(preview([{ ...row('barcode'), next: 8801 }]))).toBeNull();
    expect(parseErpLinkedGoodsPreview(preview([row('price'), row('price')]))).toBeNull();
    expect(parseErpLinkedGoodsPreview({ ...preview([row('price')]), total: 0 })).toBeNull();
  });

  it('건너뛰는 사유마다 운영자가 할 일을 알려 준다', () => {
    for (const reason of ERP_LINKED_GOODS_SKIP_REASONS) expect(ERP_LINKED_GOODS_SKIP_LABELS[reason]).toMatch(/[가-힣]/);
    expect(ERP_LINKED_GOODS_SKIP_LABELS.active_discount).toContain('할인을 중지한 뒤 다시 비교');
    expect(ERP_LINKED_GOODS_SKIP_LABELS.zero_price).toContain('0원으로 바꾸지 않습니다');
  });

  it('요약 숫자는 반영할 수 있는 행만 세고, 이미 있던 바코드가 바뀌는 행을 따로 센다', () => {
    expect(erpLinkedGoodsCounts([row('price'), row('barcode', { current: '0088', warning: 'barcode_changed' }), row('price', { key: 'x:price', status: 'skip', reason: 'active_discount' })]))
      .toEqual({ price: 1, barcode: 1, skipped: 1, barcodeChanges: 1 });
  });
});

describe('연결 상품 반영 확정 계약', () => {
  it('확정 확인창은 상품 수·항목 수와 바뀌는 바코드를 함께 묻는다', () => {
    const text = erpLinkedGoodsConfirmation([row('price'), row('barcode', { current: '0088', warning: 'barcode_changed' })]);
    expect(text).toBe('연결 상품 1개에 판매가 1건·바코드 1건을 반영할까요? 바뀐 판매가는 저장하는 즉시 고객 화면과 새 주문에 적용됩니다. '
      + '이미 있던 바코드가 바뀌는 행이 1건입니다. 창고에 등록된 바코드와 같은지 확인해주세요. 반영 내역은 감사 기록에 남습니다.');
    expect(erpLinkedGoodsConfirmation([row('barcode')])).toBe('연결 상품 1개에 바코드 1건을 반영할까요? 반영 내역은 감사 기록에 남습니다.');
  });

  it('결과를 읽어 반영·막힘·거절을 한 줄로 알린다', () => {
    const completed = parseErpLinkedGoodsReceipt({ state: 'completed', operationId: 'op', applied: { price: 2, barcode: 0, goods: 2 }, failed: [] });
    expect(completed && erpLinkedGoodsReceiptMessage(completed)).toBe('상품 2개에 판매가 2건을 반영했습니다.');
    const partial = parseErpLinkedGoodsReceipt({ state: 'completed', operationId: 'op', applied: { price: 1, barcode: 1, goods: 1 },
      failed: [{ key: 'k', field: 'price', goodId: 'g', goodName: '굿즈', optionName: '기본 옵션', error: 'goods_notice_required' }] });
    expect(partial && erpLinkedGoodsReceiptMessage(partial)).toBe('상품 1개에 판매가 1건·바코드 1건을 반영했습니다. 1건은 상품 저장 규칙에 막혀 반영하지 못했습니다. 아래 사유를 확인해주세요.');
    const rejected = parseErpLinkedGoodsReceipt({ state: 'rejected', operationId: 'op', error: 'erp_goods_apply_expired' });
    expect(rejected && erpLinkedGoodsReceiptMessage(rejected)).toBe('미리보기를 연 지 15분이 지나 아무것도 반영하지 않았습니다. 다시 비교해주세요.');
    expect(parseErpLinkedGoodsReceipt({ state: 'completed', operationId: 'op', applied: { price: -1, barcode: 0, goods: 0 }, failed: [] })).toBeNull();
    expect(parseErpLinkedGoodsReceipt({ state: 'completed', operationId: 'op', applied: { price: 0, barcode: 0, goods: 0 }, failed: [{ key: 'k', field: 'stock' }] })).toBeNull();
  });

  it('상품 저장 규칙 오류와 확정 요청 오류를 운영자 문구로 바꾼다', () => {
    expect(erpLinkedGoodsFailureLabel('goods_notice_required')).toBe('상품정보제공고시가 빈 공개 상품이라 저장할 수 없습니다.');
    expect(erpLinkedGoodsFailureLabel('goods_save_rejected')).toContain('상품 화면에서 저장해 보고');
    expect(erpLinkedGoodsErrorLabel('erp_goods_apply_partial_price', '아크릴 키링')).toContain('같은 상품(‘아크릴 키링’)의 판매가 행을 일부만 고르면');
    expect(erpLinkedGoodsErrorLabel('erp_goods_apply_partial_price')).toContain('같은 상품의 판매가 행을 일부만 고르면');
    expect(erpLinkedGoodsErrorLabel('something else')).toBeNull();
  });

  it('값은 판매가면 원, 바코드면 글자 그대로, 비어 있으면 없음으로 보인다', () => {
    expect(formatErpLinkedGoodsValue('price', 12000)).toBe('12,000원');
    expect(formatErpLinkedGoodsValue('barcode', '0088012345678')).toBe('0088012345678');
    expect(formatErpLinkedGoodsValue('barcode', null)).toBe('없음');
  });
});
