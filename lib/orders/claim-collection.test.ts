import { describe, expect, it } from 'vitest';
import { normalizeClaimCollectionValues, parseClaimCollectionDocument } from './claim-collection';
const values = { method: 'customer_sent', carrier: 'hanjin', trackingNumber: ' claim123456 ', evidence: ' TEST 택배 확인 ', confirmed: true };
describe('claim collection corrections', () => {
 it('normalizes real carrier metadata and requires paired tracking and explicit evidence', () => {
  expect(normalizeClaimCollectionValues(values)).toEqual({ ...values, trackingNumber: 'CLAIM123456', evidence: 'TEST 택배 확인' });
  for (const bad of [{ confirmed: false }, { carrier: null }, { evidence: '' }, { method: 'not_requested' }, { trackingNumber: '하이픈-1234' }, { extra: true }]) expect(normalizeClaimCollectionValues({ ...values, ...bad })).toBeNull();
 });
 it('rejects a malformed or expanded read document', () => {
  const doc = { claimId: '00000000-0000-4000-8000-000000000001', orderId: '00000000-0000-4000-8000-000000000002', claimRevision: 0, editable: false, rows: [], history: [] };
  expect(parseClaimCollectionDocument(doc)).toEqual(doc);
  expect(parseClaimCollectionDocument({ ...doc, secret: 'must reject' })).toBeNull();
  expect(parseClaimCollectionDocument({ ...doc, rows: [{ trackingNumber: 'private incomplete' }] })).toBeNull();
 });
 /* 출고지별 재출고(TKT-166): 재출고한 배송 건 행에만 reshipped=true가 오고, 그 행만 정정이 잠긴다. 다른 값은 받지 않는다. */
 it('accepts the per-origin reshipped lock only as an explicit true', () => {
  const row = { shipmentId: '00000000-0000-4000-8000-000000000003', originName: 'TEST 김포', revision: 0, method: 'not_requested', carrier: null, trackingNumber: null,
   evidence: '', requestedOnce: true, collectedAt: null, updatedAt: null };
  const doc = { claimId: '00000000-0000-4000-8000-000000000001', orderId: '00000000-0000-4000-8000-000000000002', claimRevision: 3, editable: true, rows: [row, { ...row, shipmentId: '00000000-0000-4000-8000-000000000004', reshipped: true }], history: [] };
  expect(parseClaimCollectionDocument(doc)?.rows.map(item => item.reshipped ?? false)).toEqual([false, true]);
  expect(parseClaimCollectionDocument({ ...doc, rows: [{ ...row, reshipped: false }] })).toBeNull();
 });
 /* 회수 묶음(S36-040·QNA-031): 승인 뒤 배송 건마다 반품지별 회수 주소가 오고, 회수 생략 배송 건은 true로만 온다. 내부 필드는 받지 않는다. */
 it('accepts return bundles and the collection waiver only in their exact shape', () => {
  const row = { shipmentId: '00000000-0000-4000-8000-000000000003', originName: 'TEST 김포', revision: 0, method: 'not_requested', carrier: null, trackingNumber: null,
   evidence: '', requestedOnce: true, collectedAt: null, updatedAt: null };
  const bundle = { bundleId: '00000000-0000-4000-8000-000000000010', returnName: '서울 반품지', returnAddress: '서울특별시 합성구 반품로 1', returnPhone: '02-1234-5678',
   items: [{ name: 'TEST 굿즈', qty: 1 }], collectedAt: null };
  const doc = { claimId: '00000000-0000-4000-8000-000000000001', orderId: '00000000-0000-4000-8000-000000000002', claimRevision: 3, editable: true,
   rows: [{ ...row, returnBundles: [bundle, { ...bundle, bundleId: '00000000-0000-4000-8000-000000000011', returnName: '', returnPhone: '' }] }, { ...row, shipmentId: '00000000-0000-4000-8000-000000000004', collectionWaived: true }], history: [] };
  expect(parseClaimCollectionDocument(doc)?.rows.map(item => [item.returnBundles?.length ?? 0, item.collectionWaived ?? false])).toEqual([[2, false], [0, true]]);
  for (const bad of [{ returnBundles: [] }, { returnBundles: [{ ...bundle, evidence: '내부 근거' }] }, { returnBundles: [{ ...bundle, items: [] }] },
   { returnBundles: [{ ...bundle, items: [{ name: 'x', qty: 0 }] }] }, { returnBundles: [{ ...bundle, bundleId: 'not-a-uuid' }] }, { collectionWaived: false }]) {
   expect(parseClaimCollectionDocument({ ...doc, rows: [{ ...row, ...bad }] })).toBeNull();
  }
 });
});
