/*
 * 상품 기본 칸 동시 수정 보호(CAT-027·CAT-028, migration 20261118151000).
 * 편집 화면은 연 시점의 goods.base_revision을 숨은 칸으로 보내고, 상품 저장 RPC가 저장 직전 지금 버전과 비교한다.
 * 다르면 저장 전체를 거절한다(goods_base_changed). 칸이 없거나 비어 있으면(새 상품·배포 순간 열려 있던 옛 화면) 비교하지 않는다.
 */

export const GOOD_BASE_REVISION_FIELD = 'baseRevision';

export const GOODS_BASE_CHANGED_MESSAGE = '다른 작업에서 상품 정보가 바뀌었습니다. 입력은 유지됩니다. 새로고침해 최신 내용을 확인한 뒤 다시 저장해주세요.';
export const GOODS_BASE_REVISION_INVALID_MESSAGE = '저장 요청을 확인하지 못했습니다. 새로고침 후 다시 시도해주세요. 입력은 유지됩니다.';

/** 숨은 칸의 기준 버전. 없으면 null(비교하지 않음), 형식이 틀리면 'invalid'. */
export function readGoodBaseRevision(form: FormData): number | null | 'invalid' {
  const raw = form.get(GOOD_BASE_REVISION_FIELD);
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(raw)) return 'invalid';
  const revision = Number(raw);
  return Number.isSafeInteger(revision) ? revision : 'invalid';
}

/** 상품 저장 RPC가 낸 기본 칸 버전 거절을 운영자 문구로 바꾼다. 해당 없으면 null. */
export function goodBaseRevisionFailure(message: string): string | null {
  if (message.includes('goods_base_changed')) return GOODS_BASE_CHANGED_MESSAGE;
  if (message.includes('invalid_goods_base_revision')) return GOODS_BASE_REVISION_INVALID_MESSAGE;
  return null;
}
