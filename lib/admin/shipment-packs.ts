import { isUuid } from '@/lib/uuid';
import { isCommerceNumber } from '@/lib/commerce-number';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
export interface ShipmentPackSummary { id: string; revision: number; count: number; shipmentIds: string[]; collectFee: number; canRelease: boolean }
export interface ShipmentPackRow { orderNumber?: string; shipmentNumber?: string; id: string; orderId: string; originName: string; buyerName: string; recipientName: string | null; status: string; exportedAt: string | null; updatedAt: string; shippingFee: number; collectFee: number; ready: boolean; pack: ShipmentPackSummary | null }
export interface ShipmentPackDocument { version: string; canCreate: boolean; rows: ShipmentPackRow[] }
export function shipmentPackIds(value: unknown, max = 100): string[] | null {
 if (!Array.isArray(value) || value.length < 1 || value.length > max || !value.every(isUuid)) return null;
 const ids = value.map(id => id.toLowerCase()); return new Set(ids).size === ids.length ? ids.sort() : null;
}
export function parseShipmentPackSummary(value: unknown): ShipmentPackSummary | null {
 if (!transactionRecord(value) || !transactionExactKeys(value, ['id', 'revision', 'count', 'shipmentIds', 'collectFee', 'canRelease']) || !isUuid(value.id)
  || !transactionInteger(value.revision, 1) || !transactionInteger(value.count, 2, 100) || !shipmentPackIds(value.shipmentIds)
  || (value.shipmentIds as string[]).length !== value.count || !transactionInteger(value.collectFee, 0) || typeof value.canRelease !== 'boolean') return null;
 return value as unknown as ShipmentPackSummary;
}
export function parseShipmentPackDocument(value: unknown): ShipmentPackDocument | null {
 if (!transactionRecord(value) || !transactionExactKeys(value, ['version', 'canCreate', 'rows']) || typeof value.version !== 'string' || !/^[a-f0-9]{64}$/.test(value.version)
  || typeof value.canCreate !== 'boolean' || !Array.isArray(value.rows) || value.rows.length > 1000) return null;
 if (!value.rows.every(row => transactionRecord(row) && transactionExactKeys(row, ['id', 'orderId', 'originName', 'buyerName', 'recipientName', 'status', 'exportedAt', 'updatedAt', 'shippingFee', 'collectFee', 'ready', 'pack', ...(Object.hasOwn(row, 'orderNumber') ? ['orderNumber'] : []), ...(Object.hasOwn(row, 'shipmentNumber') ? ['shipmentNumber'] : [])])
  && (row.orderNumber === undefined || isCommerceNumber(row.orderNumber, 'order')) && (row.shipmentNumber === undefined || isCommerceNumber(row.shipmentNumber, 'shipment'))
  && isUuid(row.id) && isUuid(row.orderId) && typeof row.originName === 'string' && typeof row.buyerName === 'string' && (row.recipientName === null || typeof row.recipientName === 'string')
  && ['ready', 'shipping', 'delivered', 'canceled'].includes(row.status as string) && (row.exportedAt === null || typeof row.exportedAt === 'string' && Number.isFinite(Date.parse(row.exportedAt)))
  && typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)) && transactionInteger(row.shippingFee, 0) && transactionInteger(row.collectFee, 0) && typeof row.ready === 'boolean'
  && (row.pack === null || parseShipmentPackSummary(row.pack)))) return null;
 if (new Set(value.rows.map(row => row.id)).size !== value.rows.length) return null;
 return value as unknown as ShipmentPackDocument;
}
export function shipmentPackError(message?: string, code?: string) {
 const errors: Record<string, string> = {
  shipment_pack_changed: '선택 이후 배송 정보나 합포장이 바뀌었습니다. 최신 정보를 확인해주세요.',
  shipment_pack_conflict: '같은 요청번호의 처리 내용이 다릅니다. 최신 정보를 확인해주세요.',
  shipment_pack_ineligible: '동일 구매자·수취인·주소·출고지의 발송 대기 건만 합포장할 수 있습니다. 취소 요청, 결제와 예약 재고를 확인해주세요.',
  shipment_pack_release_blocked: '출고지시를 전달하거나 발송한 합포장은 해제할 수 없습니다.',
  shipment_pack_address_changed: '합포장 이후 수취 정보가 바뀌었습니다. 출고 전 합포장을 해제하고 다시 구성해주세요.',
  shipment_pack_selection_required: '같은 합포장의 모든 배송 건을 선택해주세요.',
  shipment_pack_tracking_conflict: '같은 합포장에 서로 다른 송장이 있습니다. 해당 파일을 수정한 뒤 다시 등록해주세요.',
 };
 return errors[message ?? ''] ?? (code === '42501' ? '계정 또는 직원 권한이 바뀌었습니다. 다시 로그인해주세요.' : code === '22023' ? '선택한 배송 건과 처리 사유를 확인해주세요.' : '합포장 처리 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해주세요.');
}
