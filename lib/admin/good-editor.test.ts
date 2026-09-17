import { expect, it } from 'vitest';
import { goodEditorValues, createGoodEditorDraft, buildGoodEditorPreview, GOOD_LOCAL_DRAFT_FIELDS } from './good-editor';
import { createAdminLocalAutosave, withLocalRecoveryValues } from './local-autosave';
it('restores failed option edits and their optimistic baseline into the same preview and submission values', () => {
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => records.set(key, value), removeItem: (key: string) => records.delete(key) };
  const scope = { accountId: 'operator', formId: 'good', recordId: null };
  const optionId = '11111111-1111-4111-8111-111111111111';
  const edited = { name: '편집 상품', price: '1000', compareAtPrice: '2000', variantBaseline: JSON.stringify([optionId]),
    variants: JSON.stringify([{ id: optionId, name: '수정 옵션', code: '0001', attributes: {}, extraPrice: 500, stockQty: 4, expectedStockQty: 7 }]) };
  const current = createAdminLocalAutosave({ scope, storage, fields: GOOD_LOCAL_DRAFT_FIELDS });
  current.capture(Object.entries(edited)); current.beginSubmission(); current.completeSubmission(false);
  const reopened = createAdminLocalAutosave({ scope, storage, fields: GOOD_LOCAL_DRAFT_FIELDS });
  reopened.restore();
  const draft = createGoodEditorDraft(null, withLocalRecoveryValues({}, null, reopened.getSnapshot().restoredValues), []);
  expect(draft.baseline).toEqual([optionId]);
  expect(JSON.parse(draft.values.variants)[0]).toMatchObject({ id: optionId, expectedStockQty: 7, stockQty: 4 });
  const preview = buildGoodEditorPreview({ values: draft.values, imageUrls: draft.imageUrls, selected: null, catalogIps: [], origins: [], shippingNoticeOptions: [] });
  expect(preview.detail.good).toMatchObject({ price: 1500, compareAtPrice: 2000, stockQty: 4, options: [{ id: optionId, name: '수정 옵션' }] });
  reopened.beginSubmission(); reopened.completeSubmission(true);
  expect(storage.getItem(reopened.key)).toBe(null);
});
it('keeps explicit empty or copied notice and uploaded paths on failure above new business defaults', () => {
  const defaults = { asManager: '회사', asContact: '02-1111' };
  expect(goodEditorValues(null, {}, 'ip1', defaults)).toMatchObject({ ipId: 'ip1', noticeAsManager: '회사', noticeAsContact: '02-1111' });
  expect(goodEditorValues(null, { values: { previousId: '', noticeAsManager: '', noticeAsContact: '프리셋 연락처', galleryPath0: 'uploaded.webp' } }, 'ip1', defaults)).toMatchObject({ noticeAsManager: '', noticeAsContact: '프리셋 연락처', galleryPath0: 'uploaded.webp' });
});
it('미저장 HTML 원문·형식·검증 업로드 경로를 다시 연 상품 폼에 복구한다', () => {
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => records.set(key, value), removeItem: (key: string) => records.delete(key) };
  const scope = { accountId: 'operator', formId: 'good', recordId: null };
  const values = { descriptionFormat: 'html', description: `<h2>미저장</h2><p>${'문'.repeat(5000)}</p>`, descriptionUploadPath: 'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp', descriptionImageAlt: '사진 설명' };
  const current = createAdminLocalAutosave({ scope, storage, fields: GOOD_LOCAL_DRAFT_FIELDS });
  current.capture(Object.entries(values));
  current.flush();
  const reopened = createAdminLocalAutosave({ scope, storage, fields: GOOD_LOCAL_DRAFT_FIELDS });
  reopened.restore();
  expect(goodEditorValues(null, withLocalRecoveryValues({}, null, reopened.getSnapshot().restoredValues))).toMatchObject(values);
});
