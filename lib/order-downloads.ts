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
