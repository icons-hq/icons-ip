const error = '합성 화면 검수에서는 서버 작업을 실행하지 않습니다. 실제 저장·조회 검증은 격리 앱에서 진행해주세요.';

export async function updateAdminOperationAlertsAction() { return { error }; }
export async function setAdminOperationAlertBadgeAction() { return { error }; }
export async function previewPurchaseRestrictionBatchAction() { return { error }; }
export async function executePurchaseRestrictionBatchAction() { return { error }; }
export async function readPurchaseRestrictionBatchAction() { return { error }; }
export async function listCsReplyTemplatesAction() { return { ok: false as const, error }; }
export async function readCsReplyTemplateAction() { return { ok: false as const, error }; }
export async function saveCsReplyTemplateAction() { return { ok: false as const, error }; }
export async function archiveCsReplyTemplateAction() { return { ok: false as const, error }; }
export async function replyReviewsBatchAction() { return { ok: false as const, error }; }
export async function readReviewReplyBatchAction() { return { ok: false as const, error }; }
export async function findGoodsPhotosAction() { return { error }; }
export async function saveGoodsPhotoAction() { return { error }; }
export async function finishGoodsPhotoUploadsAction() {}

export async function findGoodsDraftsAction() { return { error }; }
export async function getGoodsDraftAction() { return { error }; }
export async function saveGoodsDraftAction() { return { error }; }
export async function setGoodsDraftArchivedAction() { return { error }; }

// New client surfaces must fail locally instead of importing their server graph.
async function unavailableAction() { return { ok: false as const, error, errors: { form: error }, uncertain: false }; }
/** 공용 상품 선택창(고시 복사·복사등록·옵션 불러오기)의 합성 목록. 검색어가 상품명·상품 자동코드에 든 줄만 돌려준다. */
const fixturePickerGoods = [
  { id: 'fixture-picker-keyring', code: 'FIX-0001', name: '합성 키링', categoryName: '문구', imageUrl: null, published: true },
  { id: 'fixture-picker-sticker', code: 'FIX-0002', name: '합성 스티커', categoryName: '선물', imageUrl: null, published: false },
];
export async function searchGoodsOptionImportAction(input: unknown) {
  const query = input && typeof input === 'object' && typeof (input as { query?: unknown }).query === 'string' ? (input as { query: string }).query.trim() : '';
  const rows = fixturePickerGoods.filter((good) => !query || good.name.includes(query) || good.code.includes(query));
  /* 편집기 fixture의 accountId('fixture-operator')와 같아야 선택창이 응답을 받는다. */
  return { ok: true as const, accountId: 'fixture-operator', data: { rows, total: rows.length, page: 1, pageSize: 20 as const } };
}
export const readGoodsOptionImportAction = unavailableAction;
export async function readGoodsAttributesAction(categoryId: string | null, goodId: string | null = null) {
  if (categoryId !== null && !/^00000000-0000-4000-8000-00000005112[0-2]$/.test(categoryId)
    || goodId !== null && !goodId.startsWith('fixture-')) return { error };
  // These fixture categories deliberately have no attribute definitions or saved values.
  return { data: { schema: categoryId === null ? null : { categoryId, revision: 0, fields: [] }, document: { revision: 0, entries: [] } } };
}
export const saveGoodsAttributeSchemaAction = unavailableAction;
export const readRestrictionReleaseAction = unavailableAction;
export const releaseRestrictionsAction = unavailableAction;
export const readCsReplySourceAction = unavailableAction;
export const readCsReplyOperationAction = unavailableAction;
export const saveStoreBrandingAction = unavailableAction;
export const saveStoreNavigationAction = unavailableAction;
export const issueMarketingLinksAction = unavailableAction;
export const listCategoryTemplatesAction = unavailableAction;
export const saveCategoryTemplatesAction = unavailableAction;
export const listBodyTemplatesAction = unavailableAction;
export const readBodyTemplateAction = unavailableAction;
export const saveBodyTemplateAction = unavailableAction;
export const archiveBodyTemplateAction = unavailableAction;
export const setBestReviewAction = unavailableAction;
export const saveBestReviewSettingsAction = unavailableAction;
export const readArchivedHeroBannersAction = unavailableAction;
export const setHeroBannerArchivedAction = unavailableAction;
export const bulkConfirmAdminOrdersAction = unavailableAction;
export const readCustomerRewardPolicyAction = unavailableAction;
export const saveCustomerRewardPolicyAction = unavailableAction;
export const readBestReviewRewardAction = unavailableAction;
export const searchMarketingCouponsAction = unavailableAction;
export const sendMarketingTestAction = unavailableAction;

export const readPurchaseConfirmationAction = unavailableAction;
export const changePurchaseConfirmationAction = unavailableAction;
export const readPurchaseConfirmationPolicyAction = unavailableAction;
export const savePurchaseConfirmationPolicyAction = unavailableAction;

export const readClaimCollectionAction = unavailableAction;
export const saveClaimCollectionAction = unavailableAction;
export const readClaimFeesAction = unavailableAction;
export const readOrderClaimFeesAction = unavailableAction;
export const changeClaimFeeAction = unavailableAction;
export const readClaimFeePolicyAction = unavailableAction;
export const saveClaimFeePolicyAction = unavailableAction;

export async function readShipmentPacksAction() {return {error:'실제 합포장 검증은 격리 환경에서 진행합니다.'};}
export async function changeShipmentPackAction() {return {error:'실제 합포장 검증은 격리 환경에서 진행합니다.'};}

export const readReviewTypePolicyAction = async () => ({ error: "시각 검증에서는 설정을 변경하지 않습니다." });
export const saveReviewTypePolicyAction = readReviewTypePolicyAction;

export const readGoodsProductionAction = async () => ({ error: "시각 검증에서는 제작 설정을 변경하지 않습니다." });
export const saveGoodsProductionAction = readGoodsProductionAction;
export const readOrderProductionAction = readGoodsProductionAction;
export const changeOrderProductionAction = readGoodsProductionAction;

export const previewGoodsBulkAction = unavailableAction;
export const commitGoodsBulkAction = unavailableAction;
export const readGoodsBulkAction = unavailableAction;
export const readGoodsGroupOperationAction = unavailableAction;
export const readGoodsGroupSourceAction = unavailableAction;
export const searchGoodsGroupProductsAction = unavailableAction;
