import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { decryptUploadedWorkbook } from '@/lib/admin/encrypted-workbook.server';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS } from '@/lib/admin/shipment-workbook';
import { GIMPO_EXPORT_HEADERS, WAREHOUSE_OPERATION_HEADERS } from '@/lib/admin/warehouse-templates';
import { parseDelimitedText } from '@/lib/admin/spreadsheet-text';
import { exportShipmentsAction } from './shipment-actions';

/*
 * QA 라운드 1(B1·M2): 물류출고관리(sales.dispatch만, sales.read 없음)가 내려받는 출고지시 파일을 실제 빌더·실제 암호화로 만든다.
 * 다른 시험(shipment-actions.test.ts)은 빌더를 바꿔 끼워 null 구매자 칸이 빌더에서 터지는 것을 잡지 못했다.
 * 여기서는 RPC 응답과 권한만 바꿔 끼우고, 파일을 열어 칸 값을 확인한다.
 */
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: vi.fn() }));
vi.mock('@/lib/email/order-shipment-jobs.server', () => ({ enqueueOrderShippedEmails: vi.fn() }));

const PASSWORD = 'Qa1-logistics';
const credentials = { password: PASSWORD, passwordConfirmation: PASSWORD };
const SHIPMENT = '70000000-0000-4000-8000-000000000001';
const COLLECT_SHIPMENT = '70000000-0000-4000-8000-000000000002';
const ORIGIN = '70000000-0000-4000-8000-000000000009';
const collector = { name: '한진택배 김포센터', method: '수령 시 현금·카드 결제', refundContact: '1588-0011', instructions: '착불 배송비는 받는 분이 냅니다.' };
const detail = (n: number, buyer: 'reader' | 'blank') => ({
  orderNumber: `202611121000000${n}`, productOrderNumber: `202611122000000${n}`, shipmentNumber: `202611123000000${n}`,
  itemId: `70000000-0000-4000-8000-00000000010${n}`, goodId: 'qa-good', goodType: 'keyring', buyerPhone: '',
  address1: '합성 주소', address2: `${n}층`, orderedAt: '2026-11-12T00:00:00Z', confirmedAt: '2026-11-12T01:00:00Z', expectedShipDate: null, shippedAt: null, exportedAt: null,
  ...(buyer === 'reader'
    ? { buyerName: '구매자닉하나', buyerId: '70000000-0000-4000-8000-0000000000aa', paidAt: '2026-11-12T00:05:00Z', paymentMethod: 'card', productPrice: null, optionPrice: null,
      itemTotal: 12000, itemDiscount: 0, sellerDiscount: 0, regionalShippingFee: 0, shippingDiscount: 0 }
    // DB(private.shipment_export_detail_for_reader)가 sales.read 없는 계정에게 보내는 모양 그대로다.
    : { buyerName: null, buyerId: null, paidAt: null, paymentMethod: null, productPrice: null, optionPrice: null,
      itemTotal: null, itemDiscount: null, sellerDiscount: null, regionalShippingFee: null, shippingDiscount: null }),
});
const line = (n: number, shipmentId: string, unitPrice: number | null, buyer: 'reader' | 'blank', smartstore: boolean) => ({
  shipmentId, orderId: `70000000-0000-4000-8000-00000000020${n}`, recipient: `수령인${n}`, phone: `0101234567${n}`, postalCode: '00123', address: `합성 주소 ${n}층`,
  goodCode: 'QA-K1', variantCode: `QA-K1-${n}`, goodName: 'QA 키링', optionName: `옵션${n}`, qty: n + 1, unitPrice, deliveryNote: '문 앞', carrier: '한진택배',
  barcode: `880000000001${n}`, erpCode: '', erpName: '', ...(smartstore ? { smartstore: detail(n, buyer) } : {}),
});
/** template: 김포 21열(wms_csv). 금액이 null이면 DB가 비워 보낸 응답, 숫자면 비우기 전 응답이다. */
function payload({ amounts, buyer, smartstore }: { amounts: 'numbers' | 'blank'; buyer: 'reader' | 'blank'; smartstore: boolean }) {
  const fee = (value: number) => (amounts === 'numbers' ? value : null);
  return { shipments: [
    { id: SHIPMENT, shipmentNumber: '2026111230000001', orderNumber: '2026111210000001', updatedAt: '2026-11-12T02:00:00Z', originId: ORIGIN, originName: '김포',
      template: 'wms_csv', columns: [...DEFAULT_SHIPMENT_EXPORT_COLUMNS], shippingFee: fee(3000), shippingCollectFee: 0, isGift: false, pack: null, collector: null,
      lines: [line(1, SHIPMENT, fee(12000), buyer, smartstore)] },
    { id: COLLECT_SHIPMENT, shipmentNumber: '2026111230000002', orderNumber: '2026111210000002', updatedAt: '2026-11-12T02:00:00Z', originId: ORIGIN, originName: '김포',
      template: 'wms_csv', columns: [...DEFAULT_SHIPMENT_EXPORT_COLUMNS], shippingFee: fee(0), shippingCollectFee: 3000, isGift: false, pack: null, collector,
      lines: [line(2, COLLECT_SHIPMENT, fee(8000), buyer, smartstore)] },
  ] };
}
function respond(data: unknown) {
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null,
    data: name === 'admin_shipment_export' || name === 'admin_smartstore_shipment_export' ? structuredClone(data)
      : name === 'admin_mark_shipments_exported' ? 2 : name.endsWith('barcode_gaps') ? 0 : null }));
}
const as = (role: 'logistics' | 'primary') => mocks.auth.mockResolvedValue({ operatorAccess: configuredOperatorAccessFixture(role), isConfigured: true, user: { id: role }, isStaff: true, role: 'staff' });
async function workbook(bytes: Buffer) { const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never); return book; }
/** 머리글 이름으로 칸을 읽는다. 빈칸은 '' 로 돌려준다. */
function column(sheet: ExcelJS.Worksheet, header: string) {
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(value => String(value ?? ''));
  const index = headers.indexOf(header);
  if (index < 0) throw new Error(`no column ${header}`);
  return Array.from({ length: sheet.rowCount - 1 }, (_, row) => { const value = sheet.getCell(row + 2, index + 1).value; return value === null || value === undefined ? '' : value; });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('물류 계정 출고지시 파일 — 실제 빌더 (QA 라운드 1 B1·M2, 1014-084 수령인 정보만)', () => {
  it('ICONS 표준 양식(암호 XLSX)을 만들고 구매자·결제·금액 칸은 비우며 수령인·수량·착불 표기는 남긴다', async () => {
    as('logistics'); respond(payload({ amounts: 'blank', buyer: 'blank', smartstore: true }));
    const result = await exportShipmentsAction([SHIPMENT, COLLECT_SHIPMENT], 'xlsx', 'smartstore', credentials);
    expect(result.error).toBeUndefined();
    expect(result.file).toMatchObject({ encryption: 'ECMA-376-Agile' });
    const book = await workbook(await decryptUploadedWorkbook(Buffer.from(result.file!.base64, 'base64'), PASSWORD, 5 * 1024 * 1024));
    const sheet = book.worksheets[0];
    expect(column(sheet, '구매자')).toEqual(['', '']);
    for (const header of ['결제일', '결제수단', '상품별 할인액', '품목 실결제액(배송비 제외)', '배송비 합계', '제주/도서 추가배송비', '배송비 할인액']) {
      expect(column(sheet, header), header).toEqual(['', '']);
    }
    expect(column(sheet, '수취인')).toEqual(['수령인1', '수령인2']);
    expect(column(sheet, '수량')).toEqual([2, 3]);
    expect(column(sheet, '주문번호')).toEqual(['2026111210000001', '2026111210000002']);
    // 착불 건은 배송비 형태에 '착불'이 남고, 선결제 여부는 선결제 배송비를 드러내므로 적지 않는다.
    expect(column(sheet, '배송비 형태')).toEqual(['', '착불']);
    const guide = book.getWorksheet('배송 운영 안내')!;
    expect((guide.getRow(1).values as unknown[]).slice(1)).toEqual([...WAREHOUSE_OPERATION_HEADERS]);
    expect(column(guide, '선불 배송비')).toEqual(['']);
    expect(column(guide, '계약상 착불 배송비')).toEqual([3000]);
    expect(column(guide, '착불 수납 주체')).toEqual([collector.name]);
    expect(column(guide, '수납 방법')).toEqual([collector.method]);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_mark_shipments_exported', expect.anything());
  });
  it('DB가 비우기 전 응답이 와도 물류 파일의 구매자·금액은 빈칸이다(앱이 한 번 더 비운다)', async () => {
    as('logistics'); respond(payload({ amounts: 'numbers', buyer: 'reader', smartstore: true }));
    const result = await exportShipmentsAction([SHIPMENT, COLLECT_SHIPMENT], 'csv', 'smartstore');
    expect(result.error).toBeUndefined();
    // 착불 건이 있어 출고지시 CSV와 배송 운영 안내 CSV를 ZIP으로 묶는다.
    const zip = await JSZip.loadAsync(Buffer.from(result.file!.base64, 'base64'));
    const files = Object.keys(zip.files);
    const main = parseDelimitedText((await zip.file(files.find(name => name.includes('출고지시'))!)!.async('string')).replace(/^﻿/, ''), ',').rows;
    const header = main[0];
    const values = (name: string) => main.slice(1).map(row => row[header.indexOf(name)]);
    expect(values('구매자')).toEqual(['', '']);
    expect(values('결제수단')).toEqual(['', '']);
    expect(values('품목 실결제액(배송비 제외)')).toEqual(['', '']);
    expect(values('배송비 합계')).toEqual(['', '']);
    expect(values('배송비 형태')).toEqual(['', '착불']);
    expect(values('수취인')).toEqual(['수령인1', '수령인2']);
    const guide = parseDelimitedText((await zip.file(files.find(name => name.includes('배송운영안내'))!)!.async('string')).replace(/^﻿/, ''), ',').rows;
    expect(guide[1][guide[0].indexOf('선불 배송비')]).toBe('');
    expect(guide[1][guide[0].indexOf('계약상 착불 배송비')]).toBe('3000');
  });
  it('김포 21열(기존 창고 양식)은 주문금액/수량·배송비(수집)·선불 배송비를 비우고 수량·착불은 남긴다', async () => {
    as('logistics'); respond(payload({ amounts: 'blank', buyer: 'blank', smartstore: false }));
    const result = await exportShipmentsAction([SHIPMENT, COLLECT_SHIPMENT], 'xlsx', 'warehouse');
    expect(result.error).toBeUndefined();
    const book = await workbook(Buffer.from(result.file!.base64, 'base64'));
    const sheet = book.worksheets[0];
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([...GIMPO_EXPORT_HEADERS]);
    expect(column(sheet, '주문금액/수량')).toEqual(['', '']);
    expect(column(sheet, '배송비(수집)')).toEqual(['', '']);
    expect(column(sheet, '수량')).toEqual([2, 3]);
    expect(column(sheet, '수취인명')).toEqual(['수령인1', '수령인2']);
    expect(column(sheet, '주문번호(쇼핑몰)')).toEqual(['2026111210000001', '2026111210000002']);
    const guide = book.getWorksheet('배송 운영 안내')!;
    expect(column(guide, '선불 배송비')).toEqual(['']);
    expect(column(guide, '계약상 착불 배송비')).toEqual([3000]);
    expect(column(guide, '착불 수납 주체')).toEqual([collector.name]);
  });
  it('비우기 전 금액이 와도 물류의 김포 파일은 빈칸이고, 같은 자료를 주매니저가 받으면 금액이 그대로다', async () => {
    as('logistics'); respond(payload({ amounts: 'numbers', buyer: 'reader', smartstore: false }));
    const logistics = await exportShipmentsAction([SHIPMENT, COLLECT_SHIPMENT], 'xlsx', 'warehouse');
    const logisticsSheet = (await workbook(Buffer.from(logistics.file!.base64, 'base64'))).worksheets[0];
    expect(column(logisticsSheet, '주문금액/수량')).toEqual(['', '']);
    expect(column(logisticsSheet, '배송비(수집)')).toEqual(['', '']);
    as('primary'); respond(payload({ amounts: 'numbers', buyer: 'reader', smartstore: false }));
    const primary = await exportShipmentsAction([SHIPMENT, COLLECT_SHIPMENT], 'xlsx', 'warehouse');
    const primaryBook = await workbook(Buffer.from(primary.file!.base64, 'base64'));
    expect(column(primaryBook.worksheets[0], '주문금액/수량')).toEqual([12000, 8000]);
    expect(column(primaryBook.worksheets[0], '배송비(수집)')).toEqual([3000, 0]);
    expect(column(primaryBook.getWorksheet('배송 운영 안내')!, '선불 배송비')).toEqual([0]);
  });
});
