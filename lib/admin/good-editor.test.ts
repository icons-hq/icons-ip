import { expect, it } from 'vitest';
import { goodEditorValues, createGoodEditorDraft, buildGoodEditorPreview, GOOD_LOCAL_DRAFT_FIELDS, GOOD_LOCAL_DRAFT_LINKED_FIELDS } from './good-editor';
import { createAdminLocalAutosave, withLocalRecoveryValues } from './local-autosave';
/* 배송 안내 템플릿의 선택 칸 '도서산간 안내'(T19)를 미리보기 배송 정책에도 싣는다 — 공개 상세(GoodAdditionalInfo)와 같은 자리. */
it('고른 배송 안내 템플릿의 도서산간 안내를 미리보기 배송 정책에 싣고, 비어 있으면 싣지 않는다', () => {
  const origin = { id: 'origin-gimpo', name: '김포', defaultCarrier: null, baseFee: 3000, freeThreshold: 50000, returnAddress: '김포 반품지', active: true };
  const option = { version: 1, code: 'NOTICE', name: '기본 안내', shippingNotice: '배송 안내', returnExchangeNotice: '교환 안내', csName: 'CS', csPhone: '0212345678', csEmail: 'cs@example.test' };
  const values = goodEditorValues(null, { values: { previousId: '', originId: origin.id, shippingNoticeTemplate: 'NOTICE@1' } });
  const build = (remoteAreaNotice?: string) => buildGoodEditorPreview({ values, imageUrls: {}, selected: null, catalogIps: [], origins: [origin] as never,
    shippingNoticeOptions: [{ ...option, ...(remoteAreaNotice === undefined ? {} : { remoteAreaNotice }) }] }).shippingPolicy;
  expect(build('제주·도서산간은 2~3일 더 걸립니다.')?.remoteAreaNotice).toBe('제주·도서산간은 2~3일 더 걸립니다.');
  expect(build('')).not.toHaveProperty('remoteAreaNotice');
  expect(build()).not.toHaveProperty('remoteAreaNotice');
  expect(build()?.shippingNotice).toBe('배송 안내');
});
it('미저장 직접입력형 항목을 상품 미리보기에 전달하고 제출 리비전은 보존한다', () => {
  const customInputs=JSON.stringify({enabled:true,fields:[{id:'11111111-1111-4111-8111-111111111111',name:' 각인 문구 ',active:true}]});
  const values=goodEditorValues(null,{values:{previousId:'',customInputs,customInputsExpectedRevision:'0'}});
  const preview=buildGoodEditorPreview({values,imageUrls:{},selected:null,catalogIps:[],origins:[],shippingNoticeOptions:[]});
  expect(preview.detail.good.customInputs).toEqual({enabled:true,revision:1,fields:[{id:'11111111-1111-4111-8111-111111111111',name:'각인 문구',active:true}]});
  expect(values.customInputsExpectedRevision).toBe('0');
});
it('추가 분류는 저장 실패와 브라우저 복구에서도 보존한다', () => {
  const ids = '["00000000-0000-4000-8000-000000051121"]';
  expect(GOOD_LOCAL_DRAFT_FIELDS).toContain('additionalCategoryIds');
  expect(goodEditorValues(null, {})).toHaveProperty('additionalCategoryIds', '[]');
  expect(goodEditorValues(null, { values: { previousId: '', additionalCategoryIds: ids } })).toHaveProperty('additionalCategoryIds', ids);
});
it('세 번째 옵션 축을 브라우저 복구에서 다시 읽고 옵션 영역 오류로 연결한다', async () => {
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => records.set(key, value), removeItem: (key: string) => records.delete(key) };
  const scope = { accountId: 'operator', formId: 'good', recordId: null };
  const current = createAdminLocalAutosave({ scope, storage, fields: GOOD_LOCAL_DRAFT_FIELDS });
  current.capture([['optionAxisName2', '포장'], ['optionAxisValues2', '기본, 선물']]); current.flush();
  const reopened = createAdminLocalAutosave({ scope, storage, fields: GOOD_LOCAL_DRAFT_FIELDS }); reopened.restore();
  expect(goodEditorValues(null, withLocalRecoveryValues({}, null, reopened.getSnapshot().restoredValues))).toMatchObject({ optionAxisName2: '포장', optionAxisValues2: '기본, 선물' });
  const { goodFieldSection } = await import('./good-workspace');
  expect(goodFieldSection('optionAxisName2').key).toBe('variants'); expect(goodFieldSection('optionAxisValues2').key).toBe('variants');
});
function reopenedGoodDraft(saved: Record<string, string>, baseline: Record<string, string>) {
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => records.set(key, value), removeItem: (key: string) => records.delete(key) };
  const open = () => createAdminLocalAutosave({ scope: { accountId: 'operator', formId: 'good', recordId: null }, storage, fields: GOOD_LOCAL_DRAFT_FIELDS, linkedFields: GOOD_LOCAL_DRAFT_LINKED_FIELDS });
  const first = open(); first.capture(Object.entries(saved)); first.flush();
  const session = open(); session.setEditBaseline(Object.entries(baseline));
  return { open, session };
}
it('복구 안내를 두고 대표 카테고리를 고르면 새로고침 뒤 복구에서 이전 상품명과 함께 돌아온다', () => {
  const baseline = { name: '', categoryId: '', productAttributes: '' };
  const { open, session } = reopenedGoodDraft({ ...baseline, name: '이전 상품명' }, baseline);
  session.capture(Object.entries({ ...baseline, categoryId: 'category-1' })); session.flush();
  expect(session.getSnapshot().recovery).not.toBeNull();
  const reloaded = open(); reloaded.restore();
  expect(goodEditorValues(null, withLocalRecoveryValues({}, null, reloaded.getSnapshot().restoredValues))).toMatchObject({ name: '이전 상품명', categoryId: 'category-1' });
});
it('복구 안내를 두고 옵션 행을 고치면 축과 동시편집 기준도 화면 값을 쓰고, 사용 여부만 바꾸면 이전 옵션을 남긴다', () => {
  const baseline = { variants: '[기본 행]', variantBaseline: '[]', optionUsage: 'off', optionAxisName0: '', categoryId: 'a', productAttributes: 'a 속성' };
  const saved = { variants: '[빨강, 파랑]', variantBaseline: '[old]', optionUsage: 'on', optionAxisName0: '색상', categoryId: 'b', productAttributes: 'b 속성' };
  const rows = reopenedGoodDraft(saved, baseline);
  rows.session.capture(Object.entries({ ...baseline, variants: '[기본 행, 재고 5]' })); rows.session.flush();
  expect(rows.open().getSnapshot().recovery?.values).toMatchObject({ variants: '[기본 행, 재고 5]', variantBaseline: '[]', optionUsage: 'off', optionAxisName0: '', categoryId: 'b', productAttributes: 'b 속성' });
  const usage = reopenedGoodDraft(saved, baseline);
  usage.session.capture(Object.entries({ ...baseline, optionUsage: 'on' })); usage.session.flush();
  expect(usage.open().getSnapshot().recovery?.values).toMatchObject({ variants: '[빨강, 파랑]', variantBaseline: '[old]', optionUsage: 'on', optionAxisName0: '색상' });
  const category = reopenedGoodDraft(saved, baseline);
  category.session.capture(Object.entries({ ...baseline, categoryId: 'c' })); category.session.flush();
  expect(category.open().getSnapshot().recovery?.values).toMatchObject({ categoryId: 'c', productAttributes: 'a 속성', variants: '[빨강, 파랑]' });
});
it('복구 안내를 두고 직접입력형 항목·판매기간을 고치면 서버 버전 비교값도 화면 값을 써 저장이 거절되지 않는다', () => {
  const baseline = { customInputs: '{"enabled":false,"fields":[]}', customInputsExpectedRevision: '2', salePeriodEnabled: 'false', saleStartsAt: '', saleEndsAt: '', salePeriodRevision: '5', name: '' };
  const saved = { customInputs: '{"enabled":true,"fields":["이전"]}', customInputsExpectedRevision: '1', salePeriodEnabled: 'true', saleStartsAt: '2026-11-01T10:00', saleEndsAt: '2026-11-02T10:00', salePeriodRevision: '4', name: '이전 상품명' };
  const edited = reopenedGoodDraft(saved, baseline);
  edited.session.capture(Object.entries({ ...baseline, customInputs: '{"enabled":true,"fields":["새 항목"]}', saleStartsAt: '2026-11-20T10:00' })); edited.session.flush();
  expect(edited.open().getSnapshot().recovery?.values).toMatchObject({ customInputs: '{"enabled":true,"fields":["새 항목"]}', customInputsExpectedRevision: '2', saleStartsAt: '2026-11-20T10:00', salePeriodRevision: '5', salePeriodEnabled: 'true', saleEndsAt: '2026-11-02T10:00', name: '이전 상품명' });
  /* 고치지 않은 쪽은 이전 기록의 값과 버전을 그대로 남긴다. 그 사이 서버가 바뀌었으면 저장이 동시 수정으로 막는다. */
  const untouched = reopenedGoodDraft(saved, baseline);
  untouched.session.capture(Object.entries({ ...baseline, name: '새 상품명' })); untouched.session.flush();
  expect(untouched.open().getSnapshot().recovery?.values).toMatchObject({ customInputs: '{"enabled":true,"fields":["이전"]}', customInputsExpectedRevision: '1', salePeriodRevision: '4', name: '새 상품명' });
});
it('defaults discount display on and carries a recovered off setting into the public preview', () => {
  expect(goodEditorValues(null, {})).toHaveProperty('showDiscountRate', 'true');
  expect(GOOD_LOCAL_DRAFT_FIELDS).toContain('showDiscountRate');
  const values = goodEditorValues(null, { values: { previousId: '', showDiscountRate: 'false' } });
  const preview = buildGoodEditorPreview({ values, imageUrls: {}, selected: null, catalogIps: [], origins: [], shippingNoticeOptions: [] });
  expect(preview.detail.good.showDiscountRate).toBe(false);
});
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
  /* 옵션가 500원인 옵션의 정가는 소비자가 2,000원에 옵션가를 더한 2,500원이다. */
  expect(preview.detail.good).toMatchObject({ price: 1500, compareAtPrice: 2500, catalogPrice: 1000, catalogCompareAtPrice: 2000, stockQty: 4, options: [{ id: optionId, name: '수정 옵션' }] });
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
it('판매가·할인 화면 입력과 옵션 사용 여부를 복구 대상에 넣고 판매가 영역의 오류로 묶는다', async () => {
  const { GOODS_PRICE_DRAFT_FIELDS } = await import('./goods-price-editor');
  const { goodFieldSection } = await import('./good-workspace');
  for (const field of [...GOODS_PRICE_DRAFT_FIELDS, 'optionUsage']) expect(GOOD_LOCAL_DRAFT_FIELDS).toContain(field);
  for (const field of [...GOODS_PRICE_DRAFT_FIELDS, 'price', 'compareAtPrice']) expect(goodFieldSection(field).key).toBe('price');
  for (const field of ['optionUsage', 'optionAxisName0', 'optionAxisValues1', 'variants']) expect(goodFieldSection(field).key).toBe('variants');
  const values = goodEditorValues(null, { values: { previousId: '', regularPrice: '9900', discountEnabled: 'true', discountValue: '15', discountUnit: 'percent', optionUsage: 'on' } });
  expect(values).toMatchObject({ regularPrice: '9900', discountEnabled: 'true', discountValue: '15', discountUnit: 'percent', optionUsage: 'on' });
});
