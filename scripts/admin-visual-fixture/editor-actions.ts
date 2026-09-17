/** Explicit fixture substitutes. Upload and purchase side effects always fail closed. */
export const suggestGoodsIdentifiersAction = async () => null;
export const findGoodNoticePresets = async () => ({ presets: [], total: 0, filters: { page: 1 } });
export const loadLastSavedGoodNotice = async () => ({ name: '합성 프리셋', notice: {
  maker: '합성 제조사', origin: '한국', material: '종이', size: 'A5', madeOn: '2026-09', asManager: '합성 담당자', asContact: '합성 연락처',
} });
const blocked = async () => { throw new Error('fixture blocks server writes'); };
export const toggleWishlistAction = blocked;
export const requestRestockAlertAction = blocked;
export const cancelAdminArtworkUploadAction = blocked;
export const prepareAdminArtworkUploadAction = blocked;
export const verifyAdminArtworkUploadAction = blocked;
