import { isUuid } from './uuid';

/* 리뷰 등록 = 구매확정(1014-079, ADR-0035).
 *
 * 아직 구매확정하지 않은(배송완료) 주문에 리뷰를 등록하면 확정 안내를 확인받아 같은 처리로
 * 구매확정한다. 구매확정할 수 없는 주문은 같은 이유로 리뷰도 막는다. 확정 여부·막힌 이유는
 * DB(create_good_review_v3 · my_review_targets_v3)가 판정하고, 여기에는 고객에게 보일 문구만 둔다. */

/** [구매확정] 패널(components/orders/PurchaseConfirmationPanel.tsx)과 같은 안내 문장 — 패널 문장이 바뀌면 테스트가 알린다. */
export const PURCHASE_CONFIRMATION_NOTICE = '구매확정 시 주문 당시 정책에 따라 적립금을 지급합니다. 구매확정 이후에도 반품·교환은 별도 신청 자격과 기한을 적용합니다.';
export const REVIEW_CONFIRMATION_HEADING = '리뷰를 등록하면 구매확정됩니다';
/** 어떤 적립금인지 한정한다. 리뷰이벤트 선정 적립금(배너)과 섞이지 않게 '구매확정 적립금'으로만 말한다. */
export const REVIEW_CONFIRMATION_CREDIT_NOTE = '구매확정 적립금은 리뷰 등록 여부·내용과 관계없이 같은 기준으로 지급됩니다.';
/** 리뷰 등록이 구매확정을 겸할 때의 혜택 고지. 리뷰 작성 자체의 혜택은 없고, 구매확정 적립금은 리뷰 없이도 같다. */
export const REVIEW_BENEFIT_NOTE = '리뷰 작성 자체에 대한 혜택은 없습니다. 구매확정 적립금은 리뷰 없이 [구매확정]이나 자동 구매확정으로도 똑같이 지급됩니다.';
export const REVIEW_CONFIRMATION_ACK_LABEL = '받은 굿즈와 구매확정 내용을 확인했습니다.';
export const REVIEW_CONFIRMATION_SUBMIT_LABEL = '리뷰 등록하고 구매확정';
/** 리뷰 목록의 작성 가능 카드에 붙는 한 줄. */
export const REVIEW_CONFIRMATION_LIST_HINT = '리뷰를 등록하면 이 주문이 함께 구매확정됩니다.';
/** 확인 체크는 이 이름으로 서버 액션에 실려 간다. */
export const REVIEW_CONFIRMATION_FIELD = 'confirmPurchase';

export const REVIEW_CONFIRMATION_BLOCKS = [
  'claim_in_progress', 'held', 'not_all_delivered', 'account_restricted', 'not_delivered', 'order_missing', 'unavailable',
] as const;
export type ReviewConfirmationBlock = typeof REVIEW_CONFIRMATION_BLOCKS[number];

export interface ReviewPurchaseConfirmation {
  /** 리뷰를 등록하면 함께 구매확정되는 주문(배송완료·미확정)인지. */
  required: boolean;
  /** 구매확정할 수 없는 이유. null이면 막히지 않았거나 이미 확정된 주문이다. */
  block: ReviewConfirmationBlock | null;
  /** 관리자가 고객에게 보이려고 남긴 보류 사유(보류일 때만). */
  holdReason: string | null;
}

/** DB가 돌려준 막힌 이유. 모르는 새 값은 일반 사유로 접고, 문자열이 아닌 값만 형식 오류(undefined)로 본다. */
export function parseReviewConfirmationBlock(value: unknown): ReviewConfirmationBlock | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return (REVIEW_CONFIRMATION_BLOCKS as readonly string[]).includes(value) ? value as ReviewConfirmationBlock : 'unavailable';
}

export function reviewConfirmationBlockMessage(block: ReviewConfirmationBlock, holdReason?: string | null): string {
  switch (block) {
    case 'claim_in_progress':
      return '취소·반품·교환 신청이 진행 중인 주문은 구매확정할 수 없어 리뷰도 남길 수 없습니다. 신청 처리가 끝난 뒤 다시 확인해주세요.';
    case 'held':
      return holdReason?.trim()
        ? `이 주문의 구매확정이 보류되어 있습니다(사유: ${holdReason.trim()}). 보류가 해제되면 리뷰를 남길 수 있습니다.`
        : '이 주문의 구매확정이 보류되어 있습니다. 보류가 해제되면 리뷰를 남길 수 있습니다.';
    case 'not_all_delivered':
      return '아직 배송이 끝나지 않은 굿즈가 있어 구매확정할 수 없습니다. 모든 굿즈를 받은 뒤 리뷰를 남길 수 있습니다.';
    case 'account_restricted':
      return '현재 계정 상태로는 구매확정과 리뷰 작성을 할 수 없습니다. 1:1 문의로 알려주세요.';
    default:
      return '현재 주문 상태로는 구매확정할 수 없어 리뷰를 남길 수 없습니다. 주문 상세에서 상태를 확인해주세요.';
  }
}

export interface ReviewConfirmationErrors { confirmation?: string; form?: string }

/** create_good_review_v3의 구매확정 관련 오류를 문구로. 리뷰 자체의 오류(기간·중복 등)는 null을 돌려 기존 변환에 맡긴다. */
export function reviewConfirmationError(message?: string | null, details?: string | null): ReviewConfirmationErrors | null {
  const value = (message ?? '').toLowerCase();
  if (value.includes('review_purchase_confirmation_ack_required')) {
    return { confirmation: '리뷰를 등록하면 구매확정됩니다. 안내를 확인하고 체크해주세요.' };
  }
  if (value.includes('review_purchase_confirmation_blocked')) {
    return { form: reviewConfirmationBlockMessage(parseReviewConfirmationBlock(details ?? null) ?? 'unavailable') };
  }
  if (value.includes('review_purchase_confirmation_required')) {
    return { form: '구매확정 안내를 확인해야 하는 주문입니다. 화면을 새로 고친 뒤 다시 등록해주세요.' };
  }
  if (value.includes('purchase_confirmation_auth_changed')) {
    return { form: '로그인 상태가 바뀌었습니다. 화면을 새로 고친 뒤 다시 등록해주세요.' };
  }
  if (value.includes('account_write_fenced')) {
    return { form: reviewConfirmationBlockMessage('account_restricted') };
  }
  if (value.includes('purchase_confirmation_unavailable') || value.includes('purchase_confirmation_held') || value.includes('purchase_confirmation_changed')) {
    return { form: '주문 상태가 바뀌어 구매확정하지 못했습니다. 화면을 새로 고친 뒤 다시 확인해주세요.' };
  }
  return null;
}

export interface ReviewCreateResult { reviewId: string; purchaseConfirmed: boolean }

export function parseReviewCreateResult(value: unknown): ReviewCreateResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return isUuid(record.reviewId) && typeof record.purchaseConfirmed === 'boolean'
    ? { reviewId: record.reviewId, purchaseConfirmed: record.purchaseConfirmed }
    : null;
}
