/** Explicit fixture substitutes. Upload and purchase side effects always fail closed. */
export const suggestGoodsIdentifiersAction = async () => null;
export const fixtureNoticePreset = { id: 'fixture-preset', name: '합성 KC 프리셋', updatedAt: '2026-09-28T00:00:00Z',
  kcTemplate: { family: 'living' as const, scheme: 'not_applicable' as const, publicNote: '합성 프리셋 안내' },
  notice: { maker: '합성 제조사', origin: '한국', material: '종이', size: 'A5', madeOn: '2026-09', asManager: '합성 담당자', asContact: '합성 연락처' },
};
export const findGoodNoticePresets = async () => ({ presets: [fixtureNoticePreset, { ...fixtureNoticePreset, id: 'fixture-no-kc', name: 'KC 없는 합성 프리셋', kcTemplate: null }], total: 2, filters: { page: 1, query: '' } });
export const loadLastSavedGoodNotice = async () => ({ name: '합성 프리셋', notice: {
  maker: '합성 제조사', origin: '한국', material: '종이', size: 'A5', madeOn: '2026-09', asManager: '합성 담당자', asContact: '합성 연락처',
} });
const blocked = async () => { throw new Error('fixture blocks server writes'); };
export const toggleWishlistAction = blocked;
export const requestRestockAlertAction = blocked;
export const cancelAdminArtworkUploadAction = blocked;
export const prepareAdminArtworkUploadAction = blocked;
export const verifyAdminArtworkUploadAction = blocked;
