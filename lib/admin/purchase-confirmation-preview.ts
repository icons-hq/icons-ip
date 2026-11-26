import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import type { PurchaseConfirmationPolicy } from '@/lib/purchase-confirmation';
import type { AdminConfirmRequest } from './confirm';

/*
 * 자동 거래확정 정책 화면의 말(확인창·한 줄 요약·저장 결과).
 *
 * 켜서 저장하면 꺼져 있던 동안 배송완료된 주문도 기한을 받고, 기한이 지난 주문은 다음 자동 처리 때 거래확정되며 적립금이 지급된다.
 * 그 건수와 금액은 DB의 읽기 전용 조회 `admin_preview_purchase_confirmation_auto`가 실제 자동 처리와 같은 조건으로 센다
 * (supabase/migrations/20261127100000_purchase_confirmation_preview.sql). 여기서는 그 값을 운영자가 읽을 문장으로만 바꾼다.
 */

/** 자동 처리가 매일 도는 시각. cron `settle-delivered-orders`(UTC 18:00)와 같다. */
export const PURCHASE_CONFIRMATION_AUTO_RUN_TIME = '03:00 (KST)';
/** 저장된 정책을 다시 읽는 버튼. 오류 문장이 이 이름을 그대로 쓴다. */
export const PURCHASE_CONFIRMATION_RELOAD_LABEL = '저장된 정책 다시 불러오기';

/** 지금 켜면 다음 자동 처리에서 확정될 주문 수와 지급될 적립금 합계. 조회 시점 값이다. */
export interface PurchaseConfirmationAutoPreview {
  autoAfterDays: number;
  orderCount: number;
  storeCreditTotal: number;
  /** 자동 처리가 한 번에 확정하는 최대 건수. 넘는 주문은 다음 날로 넘어간다. */
  perRunLimit: number;
  asOf: string;
}

export function parsePurchaseConfirmationAutoPreview(value: unknown): PurchaseConfirmationAutoPreview | null {
  return transactionRecord(value) && transactionExactKeys(value, ['autoAfterDays', 'orderCount', 'storeCreditTotal', 'perRunLimit', 'asOf'])
    && transactionInteger(value.autoAfterDays, 1, 36500) && transactionInteger(value.orderCount) && transactionInteger(value.storeCreditTotal)
    && transactionInteger(value.perRunLimit, 1) && transactionInstant(value.asOf) ? value as unknown as PurchaseConfirmationAutoPreview : null;
}

const count = (value: number) => value.toLocaleString('ko-KR');

/** 자동 거래확정을 켜기 전 확인창. 수치는 `preview`(조회 시점)에서만 가져온다. */
export function purchaseConfirmationAutoEnableConfirm(preview: PurchaseConfirmationAutoPreview): AdminConfirmRequest {
  const target = `배송완료 뒤 ${count(preview.autoAfterDays)}일이 지난 주문`;
  if (preview.orderCount === 0) {
    return {
      title: '자동 거래확정을 켤까요?',
      message: [
        '지금 기준으로 바로 거래확정되는 주문은 없습니다.',
        `켜 두면 ${target}이 매일 ${PURCHASE_CONFIRMATION_AUTO_RUN_TIME}에 거래확정되고, 주문할 때의 적립 조건대로 적립금이 지급됩니다.`,
      ].join('\n'),
      confirmLabel: '자동 거래확정 켜기',
      cancelLabel: '돌아가기',
    };
  }
  const credit = preview.storeCreditTotal > 0 ? `적립금 ${count(preview.storeCreditTotal)}원이 지급됩니다` : '지급할 적립금은 없습니다';
  return {
    title: '자동 거래확정을 켤까요?',
    message: [
      `지금 켜면 주문 ${count(preview.orderCount)}건이 다음 ${PURCHASE_CONFIRMATION_AUTO_RUN_TIME} 자동 처리 때 거래확정되고, ${credit}. 되돌릴 수 없습니다.`,
      ...(preview.orderCount > preview.perRunLimit
        ? [`한 번에 ${count(preview.perRunLimit)}건까지 거래확정합니다. 나머지는 다음 날 자동 처리로 넘어갑니다.`] : []),
      `대상은 ${target}입니다. 전에 자동 확정 기한을 받은 주문은 그 기한을 따릅니다.`,
      '지금 기준 수치입니다. 자동 처리 때까지 기한이 되는 주문이 더 있거나 취소·반품·교환이 접수되면 달라집니다.',
    ].join('\n'),
    confirmLabel: '자동 거래확정 켜기',
    cancelLabel: '돌아가기',
    destructive: true,
  };
}

const DAYS = /^[1-9][0-9]*$/;
/** 기간 칸에 적은 글이 1~36,500일인지. */
export function validConfirmationDays(value: string) {
  return DAYS.test(value) && Number(value) <= 36500;
}

/**
 * 적은 기간이 무슨 뜻인지 한 줄로 되읽는다. 기간을 아직 적지 않았으면 null.
 * '자동 확정 안 함'은 고른 카드가 이미 같은 말을 하므로 되읽지 않는다.
 */
export function purchaseConfirmationPolicyReadback(draft: { autoEnabled: boolean; days: string; extension: string }): string | null {
  if (!draft.autoEnabled || !validConfirmationDays(draft.days)) return null;
  const extension = draft.extension === '' ? '구매자는 자동 확정을 미룰 수 없습니다.'
    : validConfirmationDays(draft.extension) ? `구매자는 자동 확정을 한 번, ${count(Number(draft.extension))}일 미룰 수 있습니다.` : '';
  return `배송완료 뒤 ${count(Number(draft.days))}일이 지난 주문을 매일 ${PURCHASE_CONFIRMATION_AUTO_RUN_TIME}에 거래확정하고 적립금을 지급합니다. ${extension}`.trim();
}

type PolicySwitch = Pick<PurchaseConfirmationPolicy, 'autoEnabled'>;
/** 저장한 뒤 무엇이 달라졌는지 한 줄로 말한다. */
export function purchaseConfirmationPolicySavedMessage(before: PolicySwitch, after: PolicySwitch) {
  if (after.autoEnabled && !before.autoEnabled) return `자동 거래확정을 켰습니다. 기한이 지난 주문은 다음 ${PURCHASE_CONFIRMATION_AUTO_RUN_TIME} 자동 처리 때 거래확정됩니다.`;
  if (!after.autoEnabled && before.autoEnabled) return '자동 거래확정을 껐습니다. 앞으로는 자동으로 거래확정하지 않습니다. 이미 거래확정된 주문은 그대로입니다.';
  if (after.autoEnabled) return '저장했습니다. 지금부터 배송완료되는 주문에 적용합니다. 이미 기한을 받은 주문은 그 기한 그대로입니다.';
  return '저장했습니다. 자동 거래확정은 꺼져 있습니다.';
}
