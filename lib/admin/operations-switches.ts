import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';

/** 지연 안내 메일·반품배송비 차감·재고 부족 부분 취소·부분 반품 운영 스위치 화면(통합·계정 주매니저, 권한 전환 전에는 admin). */
export const OPERATIONS_SWITCHES_PATH = '/admin/settings/switches';

export const DELAY_NOTICE_EVIDENCE_MAX = 500;
export const SWITCH_EVIDENCE_MAX = 1000;
export const SWITCH_EVIDENCE_MIN = 2;
export const RETURN_FEE_AMOUNT_MAX = 1_000_000;

interface SwitchStamp { revision: number; updatedBy: string | null }
export interface DelayNoticeSwitch extends SwitchStamp {
  enabled: boolean;
  /** 예약 일정 변경 SMS 스위치. 이 화면에서는 바꾸지 않고 상태만 보인다. */
  smsEnabled: boolean;
  evidence: string | null;
  changedAt: string;
}
export interface ReturnFeeSwitch extends SwitchStamp {
  enabled: boolean;
  oneWayAmount: number | null;
  evidence: string | null;
  enabledAt: string | null;
  updatedAt: string;
  /** 지금 진행 중인 단순 변심 반품 수. 켜기 전에 접수된 요청은 켠 뒤에도 차감하지 않는다. */
  inflightCount: number;
}
export interface PartialCancelSwitch extends SwitchStamp {
  enabled: boolean;
  evidence: string | null;
  enabledAt: string | null;
  updatedAt: string;
}
/** 부분 반품(ADR-0047). 반품배송비·부분 취소와 같은 행의 별도 칸이라 리비전을 함께 쓴다. */
export type PartialReturnSwitch = PartialCancelSwitch;
export interface OperationsSwitchesState {
  delayNotice: DelayNoticeSwitch;
  returnFee: ReturnFeeSwitch;
  partialCancel: PartialCancelSwitch;
  partialReturn: PartialReturnSwitch;
}
export type OperationsSwitchKind = 'delayNotice' | 'returnFee' | 'partialCancel' | 'partialReturn';

const nullableText = (value: unknown): value is string | null => value === null || (typeof value === 'string' && [...value].length <= SWITCH_EVIDENCE_MAX);
const nullableInstant = (value: unknown): value is string | null => value === null || transactionInstant(value);

function section(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, keys) || !transactionInteger(value.revision, 1)
    || typeof value.enabled !== 'boolean' || !(value.updatedBy === null || typeof value.updatedBy === 'string')) return null;
  return value;
}

/** DB 문서를 그대로 믿지 않고 화면이 쓰는 모양만 통과시킨다. */
export function parseOperationsSwitches(value: unknown): OperationsSwitchesState | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['delayNotice', 'returnFee', 'partialCancel', 'partialReturn'])) return null;
  const delay = section(value.delayNotice, ['revision', 'enabled', 'smsEnabled', 'evidence', 'changedAt', 'updatedBy']);
  const fee = section(value.returnFee, ['revision', 'enabled', 'oneWayAmount', 'evidence', 'enabledAt', 'updatedAt', 'updatedBy', 'inflightCount']);
  const partial = section(value.partialCancel, ['revision', 'enabled', 'evidence', 'enabledAt', 'updatedAt', 'updatedBy']);
  const returns = section(value.partialReturn, ['revision', 'enabled', 'evidence', 'enabledAt', 'updatedAt', 'updatedBy']);
  if (!delay || !fee || !partial || !returns || !nullableText(returns.evidence) || !nullableInstant(returns.enabledAt) || !transactionInstant(returns.updatedAt) || typeof delay.smsEnabled !== 'boolean' || !nullableText(delay.evidence) || !transactionInstant(delay.changedAt)
    || !(fee.oneWayAmount === null || transactionInteger(fee.oneWayAmount, 1, RETURN_FEE_AMOUNT_MAX)) || !nullableText(fee.evidence)
    || !nullableInstant(fee.enabledAt) || !transactionInstant(fee.updatedAt) || !transactionInteger(fee.inflightCount, 0)
    || !nullableText(partial.evidence) || !nullableInstant(partial.enabledAt) || !transactionInstant(partial.updatedAt)) return null;
  return {
    delayNotice: { revision: delay.revision as number, enabled: delay.enabled as boolean, smsEnabled: delay.smsEnabled, evidence: delay.evidence,
      changedAt: delay.changedAt, updatedBy: delay.updatedBy as string | null },
    returnFee: { revision: fee.revision as number, enabled: fee.enabled as boolean, oneWayAmount: fee.oneWayAmount as number | null, evidence: fee.evidence,
      enabledAt: fee.enabledAt, updatedAt: fee.updatedAt, updatedBy: fee.updatedBy as string | null, inflightCount: fee.inflightCount as number },
    partialCancel: { revision: partial.revision as number, enabled: partial.enabled as boolean, evidence: partial.evidence, enabledAt: partial.enabledAt,
      updatedAt: partial.updatedAt, updatedBy: partial.updatedBy as string | null },
    partialReturn: { revision: returns.revision as number, enabled: returns.enabled as boolean, evidence: returns.evidence, enabledAt: returns.enabledAt,
      updatedAt: returns.updatedAt, updatedBy: returns.updatedBy as string | null },
  };
}

/** 근거 문구 검증: 앞뒤 공백 없이 2자 이상, 최대 길이 이하, 제어문자 없음. null이면 통과. */
export function operationsSwitchEvidenceProblem(value: string, max: number): string | null {
  if (value !== value.trim() || value.length < SWITCH_EVIDENCE_MIN) return `근거는 앞뒤 공백 없이 ${SWITCH_EVIDENCE_MIN}자 이상 적어주세요.`;
  if ([...value].length > max) return `근거는 ${max.toLocaleString('ko-KR')}자 이하로 적어주세요.`;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return '근거에 줄바꿈 같은 제어 문자를 넣을 수 없습니다.';
  return null;
}

/** 켜기 전에 사람이 확인해야 하는 항목. 화면이 항목마다 체크를 받고, 모두 체크해야 켤 수 있다. */
export const OPERATIONS_SWITCH_CHECKLISTS: Record<OperationsSwitchKind, readonly string[]> = {
  delayNotice: [
    '발신 도메인·발신자와 Resend API 키가 승인된 값으로 운영 환경에 등록돼 있습니다.',
    '발송 결과 웹훅(/api/webhooks/resend) 서명 검증이 설정돼 있습니다.',
    '메일 본문·수신자 보존·접근·파기 절차를 확인했습니다.',
    'EMAIL_DISPATCH_HMAC_SECRET을 임의로 교체하지 않는 것을 확인했습니다(교체하면 기존 발송 기록의 멱등 확인이 끊깁니다).',
    '지연 안내 작업 cron(CRON_SECRET)이 운영 환경에서 매분 돌고 있습니다.',
  ],
  returnFee: [
    '배송·반품 정책 문서(약관)를 개정하고 7일 이상 공지했습니다.',
    '토스페이먼츠 상점의 부분 취소 사용을 확인했습니다. 나이스페이는 계약 전까지 전액 환불 후 별도 청구로 처리됩니다.',
    '반품배송비 편도 금액을 대표·영업팀과 확정했습니다.',
    '서원 착불·불량 반품 배송비 계약 내용을 확인했습니다.',
  ],
  partialCancel: [
    '토스페이먼츠 상점의 부분 취소 사용을 확인하고, 테스트 키로 한 결제에 부분 취소 두 번 뒤 남은 잔액 전액 취소까지 리허설했습니다(운영 주문과 같은 계산 버전 1 주문).',
    '나이스페이 부분 취소 계약을 확인했습니다. 계약 전에는 나이스페이 결제의 부분 취소가 막힙니다.',
    '배송·반품 정책 문서에 재고 부족 시 일부 취소·부분 환불을 고지하고 7일 공지했습니다.',
    '서원(물류)에서 품절을 통보받는 경로(고객 정보 전달 방식·시한)를 운영 합의했습니다.',
    '운영 주문 배분 점검 쿼리(런북 \'재고 부족 부분 취소\' 게이트 ⑤)를 돌려 막힐 주문(amount_mismatch 등)을 확인했습니다.',
    '결제사가 부분 취소를 받지 않는 결제(가상계좌·코페이 등)는 부분 취소가 막히고(전액 환불로 돌리지 않음), 그 주문은 운영자 전액 취소로 처리하는 것을 확인했습니다.',
  ],
  partialReturn: [
    '이용약관 제16조와 배송·반품 정책의 부분 반품 개정(일부 굿즈 반품 허용·반품배송비 차감 규칙)을 7일 이상 공지했고 시행일이 지났습니다.',
    '토스페이먼츠 상점의 부분 취소 사용을 확인하고, 테스트 키로 한 결제에 부분 반품 환불 두 번 뒤 남은 굿즈 주문 전체 반품까지 리허설했습니다.',
    '결제사가 부분 취소를 받지 않는 카드(부분 취소 불가·과세 제외 금액)의 부분 반품은 전액 환불로 돌리지 않고 확인 필요로 남는다는 것과, 그때 결제 담당이 고객과 처리 방법을 정하는 절차를 CS에 공지했습니다.',
    '나이스페이·코페이·토스 가상계좌·정기배송·선물 주문은 부분 반품을 열지 않고 주문 전체 반품만 받는다는 것을 CS에 공지했습니다.',
    '반품배송비 차감을 함께 켤 때의 금액(편도 3,000원, 최초 무료배송 주문은 첫 변심 반품에 한 번 왕복)과 상품 상세 반품비 표기를 대조했습니다.',
  ],
};

export function operationsSwitchesError(code?: string, message?: string): string {
  if (code === 'PT409' || message?.includes('operations_switch_changed')) return '다른 관리자가 먼저 설정을 바꿨습니다. 새로고침해 현재 설정을 확인해주세요.';
  if (['42501', '28000'].includes(code ?? '') || message?.includes('operator_capability_required') || message?.includes('auth_required')) {
    return '현재 로그인 계정과 관리자 권한을 확인해주세요.';
  }
  if (message?.includes('operations_switch_evidence_required')) return '켜려면 근거(반품배송비는 편도 금액도)가 필요합니다. 입력 내용을 확인해주세요.';
  if (code === '22023' || message?.includes('invalid_operations_switch')) return '저장할 값이 올바르지 않습니다. 근거 길이와 금액을 확인한 뒤 다시 시도해주세요.';
  return '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.';
}

export const EMAIL_NOT_CONFIGURED_MESSAGE =
  '이메일 공급자 또는 발송 서명 설정이 운영 환경에 준비되지 않아 켤 수 없습니다. 설정을 마친 뒤 다시 시도해주세요.';
