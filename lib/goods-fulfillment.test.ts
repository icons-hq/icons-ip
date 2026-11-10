import { describe, expect, it } from 'vitest';
import { parseGoodsFulfillment, parseFulfillmentTerms, parseDigitalFile } from './goods-fulfillment';
import { parseOrderDownloads } from './order-downloads';
import { componentCollectFee, componentPrepaidFee } from './goods-transaction';
const file = { id: 'c7160850-0000-4000-8000-000000000001', name: '구매파일.txt', mimeType: 'text/plain', size: 32 };
const terms = { method: 'digital', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 };
const config = { goodId: 'digital-a', revision: 1, mode: 'digital', methods: [terms], files: [file], publicNote: '' };
describe('fulfillment boundary', () => {
 it('requires matching method, mode and verified public file metadata', () => {
  expect(parseGoodsFulfillment(config)).toEqual(config);
  expect(parseFulfillmentTerms({ version: 1, ...config, methods: undefined, method: 'digital', terms })).toBeNull();
  for (const patch of [{ mode: 'shipping' }, { files: [] }, { methods: [{ ...terms, installationFee: 100 }] }, { path: '/private/file' }]) expect(parseGoodsFulfillment({ ...config, ...patch })).toBeNull();
  expect(parseDigitalFile({ ...file, name: '../secret' })).toBeNull(); expect(parseDigitalFile({ ...file, size: 52_428_801 })).toBeNull();
 });
 it('keeps installation prepaid while transport is collected', () => {
  const component = { goodId: 'a', paymentMode: 'collect' as const, baseFee: 3000, regionalFee: 1000, installationFee: 2400, totalFee: 6400, deliveryPolicyId: null };
  expect(componentPrepaidFee(component)).toBe(2400); expect(componentCollectFee(component)).toBe(4000);
 });
 it('rejects download projections with private data or duplicate assets', () => {
  const doc = { orderId: file.id, canCancel: true, reviewRequired: false, items: [{ itemId: file.id, name: '디지털 상품', files: [file], available: true, firstProvidedAt: null }] };
  expect(parseOrderDownloads(doc)).toEqual(doc);
  expect(parseOrderDownloads({ ...doc, items: [{ ...doc.items[0], files: [{ ...file, path: 'private' }] }] })).toBeNull();
  expect(parseOrderDownloads({ ...doc, items: [{ ...doc.items[0], files: [file, file] }] })).toBeNull();
 });
});
