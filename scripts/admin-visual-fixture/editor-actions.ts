/** Explicit fixture substitutes. Upload and purchase side effects always fail closed. */
export const suggestGoodsIdentifiersAction = async () => null;
export const fixtureNoticePreset = { id: 'fixture-preset', name: '합성 KC 프리셋', updatedAt: '2026-09-28T00:00:00Z',
  kcTemplate: { family: 'living' as const, scheme: 'not_applicable' as const, publicNote: '합성 프리셋 안내' },
  notice: { maker: '합성 제조사', origin: '한국', material: '종이', size: 'A5', madeOn: '2026-09', asManager: '합성 담당자', asContact: '합성 연락처' },
};
export const findGoodNoticePresets = async () => ({ presets: [fixtureNoticePreset, { ...fixtureNoticePreset, id: 'fixture-no-kc', name: 'KC 없는 합성 프리셋', kcTemplate: null }], total: 2, filters: { page: 1, query: '' } });
const fixtureNotice = {
  maker: '합성 제조사', origin: '한국', material: '종이', size: 'A5', madeOn: '2026-09', asManager: '합성 담당자', asContact: '합성 연락처',
};
/** [다른 상품에서 복사]: 선택창에서 어느 상품을 골라도 같은 합성 고시정보를 준다. */
export const loadGoodNoticeOf = async () => ({ name: '합성 상품', notice: fixtureNotice });
export const loadLastSavedGoodNotice = async () => ({ name: '합성 프리셋', notice: fixtureNotice });
/** 진열 순서: [지금 순서 보기] 목록과 번호 중복 확인의 합성 응답(읽기만 한다). */
const fixtureOrderRows = [
  { id: 'fixture-order-1', name: '합성 진열 상품 1', imageUrl: null, order: 1, previousOrder: null, published: true },
  { id: 'fixture-order-2', name: '합성 진열 상품 2', imageUrl: null, order: 2, previousOrder: 1, published: true },
  { id: 'fixture-order-3', name: '합성 진열 상품 3', imageUrl: null, order: 5, previousOrder: 2, published: false },
];
export const listGoodsDisplayOrderAction = async () => ({
  ok: true as const, data: { rows: fixtureOrderRows, total: fixtureOrderRows.length, page: 1, pageSize: 20 as const },
});
export const readGoodsDisplayOrderSlotAction = async (input?: unknown) => {
  const order = typeof input === 'object' && input !== null ? Number((input as { order?: unknown }).order) : Number.NaN;
  const names = fixtureOrderRows.filter((row) => row.order === order).map((row) => row.name);
  return { ok: true as const, slot: { order, names, total: names.length } };
};
const blocked = async () => { throw new Error('fixture blocks server writes'); };
export const toggleWishlistAction = blocked;
export const requestRestockAlertAction = blocked;
export const requestVariantRestockAlertAction = blocked;
export const cancelAdminArtworkUploadAction = blocked;
export const prepareAdminArtworkUploadAction = blocked;
export const verifyAdminArtworkUploadAction = blocked;
