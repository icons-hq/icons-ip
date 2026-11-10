import { describe, expect, it } from 'vitest';
import { parseAdminOrderDownloads } from './order-downloads';
const file = { id: '10000000-0000-4000-8000-000000000003', name: 'original.txt', mimeType: 'text/plain', size: 35, providedCount: 1, firstProvidedAt: '2026-10-16T00:00:00Z', lastProvidedAt: '2026-10-16T01:00:00Z' };
const document = { orderId: '10000000-0000-4000-8000-000000000001', items: [{ itemId: '10000000-0000-4000-8000-000000000002', name: '합성 파일 상품', files: [file] }] };
describe('operator digital provision evidence', () => {
 it('accepts untouched purchase metadata with provided or not-yet-provided records', () => {
  expect(parseAdminOrderDownloads(document)).toEqual(document);
  expect(parseAdminOrderDownloads({ ...document, items: [] })?.items).toEqual([]);
  expect(parseAdminOrderDownloads({ ...document, items: [{ ...document.items[0], files: [{ ...file, providedCount: 0, firstProvidedAt: null, lastProvidedAt: null }] }] })).not.toBeNull();
 });
 it.each([
  { path: 'private/secret.txt' }, { sessionId: 'private-session' }, { sha256: 'a'.repeat(64) },
  { providedCount: -1 }, { providedCount: 0 }, { firstProvidedAt: null }, { lastProvidedAt: '2026-10-15T00:00:00Z' },
 ])('rejects private fields or inconsistent timestamps/counts: %j', change => {
  expect(parseAdminOrderDownloads({ ...document, items: [{ ...document.items[0], files: [{ ...file, ...change }] }] })).toBeNull();
 });
 it('rejects duplicate purchase items or file IDs', () => {
  expect(parseAdminOrderDownloads({ ...document, items: [document.items[0], document.items[0]] })).toBeNull();
  expect(parseAdminOrderDownloads({ ...document, items: [{ ...document.items[0], files: [file, file] }] })).toBeNull();
 });
});
