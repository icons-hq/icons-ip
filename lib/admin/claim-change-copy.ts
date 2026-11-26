import { CHANGED_BY_OTHER, SAVE_CHECK_LABEL, SAVE_MISMATCH_MESSAGE, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';

/*
 * 요청 보류·반품·교환 전환·사유 정정 창이 함께 쓰는 말.
 * 세 창은 같은 모양(적고 → 누르면 확인창 → 저장)이라, 저장 결과를 모를 때와 다른 사람이 먼저 바꿨을 때의
 * 버튼·문장도 같아야 한다(docs/admin-screen-rules.md 규칙 4). 결과를 모를 때의 말은 템플릿 화면과 같은 상수를 쓴다.
 */

/** 결과를 모를 때 먼저 누른다. 저장된 결과가 있는지 읽기만 한다. */
export const CLAIM_CHANGE_CHECK_LABEL = SAVE_CHECK_LABEL;
/** 확인했는데 저장된 것이 없을 때 누른다. 같은 내용을 같은 번호로 다시 보내서 두 번 저장되지 않는다. */
export const CLAIM_CHANGE_RESEND_LABEL = '같은 내용으로 다시 저장';
/** 다른 사람이 먼저 바꿨을 때 누른다. 적은 내용은 그대로 두고 지금 요청 상태만 다시 읽는다. */
export const CLAIM_CHANGE_RELOAD_LABEL = '최신 상태 불러오기';
/** 확인창에서 그만둘 때의 버튼(낱말 표: 취소는 [취소]가 아니라 [돌아가기]). */
export const CLAIM_CHANGE_BACK_LABEL = '돌아가기';

export const CLAIM_CHANGE_UNKNOWN_MESSAGE = SAVE_UNKNOWN_MESSAGE;
/** 같은 저장 번호로 다른 내용이 들어왔다. 앞서 보낸 내용을 먼저 확인하게 한다. */
export const CLAIM_CHANGE_REQUEST_MISMATCH_MESSAGE = SAVE_MISMATCH_MESSAGE;
export const CLAIM_CHANGE_CONFLICT_MESSAGE = `${CHANGED_BY_OTHER} [${CLAIM_CHANGE_RELOAD_LABEL}]를 누르면 적은 내용은 그대로 두고 지금 상태를 다시 불러옵니다.`;
export const CLAIM_CHANGE_NOT_SAVED_MESSAGE = `아직 저장된 내용이 없습니다. 적은 내용은 그대로 있으니 [${CLAIM_CHANGE_RESEND_LABEL}]을 누르면 됩니다. 같은 내용이 두 번 저장되지 않습니다.`;
/** 불러온 저장 결과가 방금 보낸 내용과 다를 때(다른 요청·다른 계정의 결과). */
export const CLAIM_CHANGE_RECEIPT_MISMATCH_MESSAGE = `불러온 저장 결과가 방금 적은 내용과 맞지 않습니다. [${CLAIM_CHANGE_CHECK_LABEL}]을 다시 누르고, 같은 안내가 반복되면 화면을 새로고침해 처리 이력을 확인해 주세요.`;
export const CLAIM_CHANGE_RECEIPT_READ_FAILED_MESSAGE = `저장된 결과를 불러오지 못했습니다. 잠시 뒤 [${CLAIM_CHANGE_CHECK_LABEL}]을 다시 눌러 주세요.`;
export const CLAIM_CHANGE_PERMISSION_MESSAGE = '판매관리 권한이 없거나 다른 계정으로 열어 둔 창입니다. 권한을 확인하고 창을 닫았다가 다시 열어 주세요.';
export const CLAIM_CHANGE_NOT_FOUND_MESSAGE = '요청을 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 열어 주세요.';
export const CLAIM_CHANGE_LOAD_FAILED_MESSAGE = '요청의 지금 상태를 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.';
export const CLAIM_CHANGE_LOAD_MISMATCH_MESSAGE = '요청의 지금 상태를 불러오지 못했습니다. 화면을 새로고침한 뒤 다시 열어 주세요.';
export const CLAIM_CHANGE_ID_MESSAGE = '저장된 결과를 찾을 수 없습니다. 화면을 새로고침해 처리 이력을 확인해 주세요.';

/** 칸 아래 글자 수 안내('10~200자 · 지금 12자'). 범위는 검증과 같은 값이라 저장 때 처음 알게 되는 제한이 없다. */
export function claimChangeCount(length: number, min: number, max: number): string {
  return `${min}~${max}자 · 지금 ${length}자`;
}
