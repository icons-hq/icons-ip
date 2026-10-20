import type { AdminInquiryActionState } from '../../app/admin/inquiry-actions';
import type { AdminReviewActionState } from '../../app/admin/review-actions';
import type { AdminQnaActionState } from '../../app/admin/qna-actions';

const failure = '합성 저장 실패입니다. 입력 내용을 보존합니다. 실제 서버에는 요청하지 않았습니다.';
export async function replyToReviewAction(): Promise<AdminReviewActionState> { return { errors: { reply: failure } }; }
export async function setReviewStatusAction(): Promise<AdminReviewActionState> { return { errors: { form: failure } }; }
export async function answerProductQuestionAction(): Promise<AdminQnaActionState> { return { errors: { answer: failure } }; }
export async function setProductQuestionVisibilityAction(): Promise<AdminQnaActionState> { return { errors: { form: failure } }; }
export async function answerInquiryAction(): Promise<AdminInquiryActionState> { return { errors: { body: failure } }; }
export async function closeInquiryAction(): Promise<AdminInquiryActionState> { return { errors: { form: failure } }; }
export async function addInquiryInternalNoteAction(): Promise<AdminInquiryActionState> { return { errors: { body: failure } }; }
export async function reassignInquiryAction(): Promise<AdminInquiryActionState> { return { errors: { form: failure } }; }
export async function loadCustomerHistoryAction() { return { error: '합성 이력 조회입니다. 실제 고객 데이터는 조회하지 않습니다.' }; }
export async function issueShipmentReceiptConfirmationAction() { return { ok: false as const, error: '합성 수령 확인입니다. 실제 확인값은 발급하지 않습니다.' }; }

export async function listInquiryReplyTemplatesAction() { return { data: { rows: [], total: 0, page: 1 } }; }
export async function mutateInquiryReplyTemplateAction() { return { error: failure, uncertain: false }; }
export async function readInquiryReplyTemplateAction() { return { template: null }; }
export async function readInquiryTemplateOperationAction() { return { receipt: null }; }
