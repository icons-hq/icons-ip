import { parseDigitalFile, type DigitalFile } from './goods-fulfillment';
import { isUuid } from './uuid';
import { transactionExactKeys, transactionInstant, transactionRecord } from './goods-transaction-values';
export interface OrderDownloadItem { itemId: string; name: string; files: DigitalFile[]; available: boolean; firstProvidedAt: string | null }
export interface OrderDownloads { orderId: string; canCancel: boolean; reviewRequired: boolean; items: OrderDownloadItem[] }
export function parseOrderDownloads(value: unknown): OrderDownloads | null {
 if (!transactionRecord(value) || !transactionExactKeys(value, ['orderId', 'canCancel', 'reviewRequired', 'items']) || !isUuid(value.orderId)
  || typeof value.canCancel !== 'boolean' || typeof value.reviewRequired !== 'boolean' || !Array.isArray(value.items) || value.items.length > 200) return null;
 const seen = new Set<string>();
 for (const item of value.items) {
  if (!transactionRecord(item) || !transactionExactKeys(item, ['itemId', 'name', 'files', 'available', 'firstProvidedAt']) || !isUuid(item.itemId) || seen.has(item.itemId)
   || typeof item.name !== 'string' || !item.name || item.name.length > 500 || typeof item.available !== 'boolean'
   || item.firstProvidedAt !== null && !transactionInstant(item.firstProvidedAt) || !Array.isArray(item.files) || item.files.length < 1 || item.files.length > 10
   || item.files.some(file => !parseDigitalFile(file)) || new Set(item.files.map(file => file.id)).size !== item.files.length) return null;
  seen.add(item.itemId);
 }
 return value as unknown as OrderDownloads;
}

/**
 * 주문이 출고 보류(운영 쪽 결제 확인 — 테스트 결제·결제사 취소)라 디지털 파일 제공을 멈춘 경우의 고객 문구. 내부 사정(테스트 결제 등)을
 * 말하지 않고 '결제 확인 중'이라는 이유와 다음 행동만 알린다. 첫 제공 전·재다운로드 모두 같다.
 */
export const DIGITAL_DOWNLOAD_ON_HOLD_MESSAGE = '결제 확인이 끝나지 않아 지금은 파일을 받을 수 없습니다. 확인이 끝나면 이 화면에서 다시 받을 수 있고, 궁금한 점은 주문 관련 1:1 문의로 알려주세요.';
