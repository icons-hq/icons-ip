export const GOOD_CLONE_PATH = '/admin/catalog/goods';
export const GOOD_CLONE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const GOOD_CLONE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,99}$/;
export const GOOD_CLONE_NAME_MAX_LENGTH = 200;

export interface GoodCloneFormValues {
  sourceGoodId: string;
  newId: string;
  newCode: string;
  newName: string;
}

export type GoodCloneValidationError = 'sourceGoodId' | 'newId' | 'newCode' | 'newName';

export interface GoodCloneResult {
  id: string;
  code: string;
  sourceGoodId: string;
  operationId?: string;
}

export function normalizeGoodCloneForm(input: {
  sourceGoodId?: unknown;
  newId?: unknown;
  newCode?: unknown;
  newName?: unknown;
}): { ok: true; value: GoodCloneFormValues } | { ok: false; errors: Partial<Record<GoodCloneValidationError, string>> } {
  const sourceGoodId = typeof input.sourceGoodId === 'string' ? input.sourceGoodId.trim().toLowerCase() : '';
  const newId = typeof input.newId === 'string' ? input.newId.trim().toLowerCase() : '';
  const newCode = typeof input.newCode === 'string' ? input.newCode.trim().toUpperCase() : '';
  const newName = typeof input.newName === 'string' ? input.newName.trim() : '';
  const errors: Partial<Record<GoodCloneValidationError, string>> = {};
  if (!GOOD_CLONE_ID_PATTERN.test(sourceGoodId)) errors.sourceGoodId = '복사할 굿즈 ID가 올바르지 않습니다.';
  if (newId && !GOOD_CLONE_ID_PATTERN.test(newId)) errors.newId = '새 상품 URL은 영문 소문자·숫자·하이픈으로 입력해주세요.';
  if (newCode && !GOOD_CLONE_CODE_PATTERN.test(newCode)) errors.newCode = '새 상품코드는 영문 대문자·숫자·하이픈으로 입력해주세요.';
  if (newName.length > GOOD_CLONE_NAME_MAX_LENGTH) errors.newName = `상품 이름은 ${GOOD_CLONE_NAME_MAX_LENGTH}자 이내로 입력해주세요.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { sourceGoodId, newId, newCode, newName } };
}

export function goodCloneMatrixRows() {
  return [
    { label: '복사', value: '설명·이미지 참조·사용 중지 상태를 포함한 옵션 구성·고시·배송 안내·활성 말단 카테고리' },
    { label: '새로 생성', value: '상품 URL·자체 상품코드·옵션코드·초안 정체성' },
    { label: '초기화', value: '할당 재고 0·KC 검토 상태·상품의 보관/게시 상태' },
    { label: '복사하지 않음', value: 'ERP·바코드·매입단가·기간 할인·예약·추가구성·쿠폰·판매 실적' },
  ] as const;
}

export function goodCloneResult(value: unknown): GoodCloneResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : row.good_id;
  const code = typeof row.code === 'string' ? row.code : row.good_code;
  const sourceGoodId = typeof row.sourceGoodId === 'string' ? row.sourceGoodId : row.source_good_id;
  const operationId = typeof row.operationId === 'string' ? row.operationId : row.operation_id;
  if (typeof id !== 'string' || !GOOD_CLONE_ID_PATTERN.test(id)) return null;
  if (typeof code !== 'string' || !GOOD_CLONE_CODE_PATTERN.test(code)) return null;
  if (typeof sourceGoodId !== 'string' || !GOOD_CLONE_ID_PATTERN.test(sourceGoodId)) return null;
  return {
    id,
    code,
    sourceGoodId,
    ...(typeof operationId === 'string' ? { operationId } : {}),
  };
}
