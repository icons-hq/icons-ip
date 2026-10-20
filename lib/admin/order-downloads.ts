import { parseDigitalFile, type DigitalFile } from '@/lib/goods-fulfillment';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
export interface AdminDownloadFile extends DigitalFile { providedCount: number; firstProvidedAt: string | null; lastProvidedAt: string | null }
export interface AdminOrderDownloads { orderId: string; items: { itemId: string; name: string; files: AdminDownloadFile[] }[] }
export function parseAdminOrderDownloads(value: unknown): AdminOrderDownloads | null {
 if (!transactionRecord(value) || !transactionExactKeys(value, ['orderId', 'items']) || !isUuid(value.orderId) || !Array.isArray(value.items) || value.items.length > 200) return null;
 const seen = new Set<string>();
 for (const item of value.items) {
  if (!transactionRecord(item) || !transactionExactKeys(item, ['itemId', 'name', 'files']) || !isUuid(item.itemId) || seen.has(item.itemId)
   || typeof item.name !== 'string' || !item.name || item.name.length > 500 || !Array.isArray(item.files) || item.files.length < 1 || item.files.length > 10) return null;
  const files = new Set<string>();
  for (const file of item.files) {
   if (!transactionRecord(file) || !transactionExactKeys(file, ['id', 'name', 'mimeType', 'size', 'providedCount', 'firstProvidedAt', 'lastProvidedAt'])
    || !parseDigitalFile({ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size }) || files.has(file.id as string)
    || !transactionInteger(file.providedCount, 0)
    || (file.providedCount === 0 ? file.firstProvidedAt !== null || file.lastProvidedAt !== null
     : !transactionInstant(file.firstProvidedAt) || !transactionInstant(file.lastProvidedAt) || Date.parse(file.firstProvidedAt) > Date.parse(file.lastProvidedAt))) return null;
   files.add(file.id as string);
  }
  seen.add(item.itemId);
 }
 return value as unknown as AdminOrderDownloads;
}
