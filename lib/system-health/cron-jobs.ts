/**
 * 자동 작업 이름표(시스템 상태 화면·실행 기록).
 *
 * `CRON_JOBS`는 Vercel cron 라우트(`app/api/cron/<key>`) 목록이고 주기는 `vercel.json`의 일정과 같다 — 시험이 둘을 맞춰 본다.
 * 실행 기록(`service_record_system_job_run`)은 이 주기로 멈춤(주기의 두 배 + 10분 동안 기록 없음)을 판정한다.
 * `PG_CRON_JOB_LABELS`는 DB 안에서 도는 pg_cron 잡 이름의 운영자용 이름이다(모르는 잡은 잡 이름 그대로 보인다).
 */
export interface CronJobDefinition {
  readonly label: string;
  readonly intervalMinutes: number;
}

export const CRON_JOBS = {
  'admin-artwork': { label: '관리자 이미지 업로드 정리', intervalMinutes: 1440 },
  'bank-deposits': { label: '무통장 입금 내역 수집', intervalMinutes: 15 },
  'order-shipment-emails': { label: '배송 안내 메일 발송', intervalMinutes: 1 },
  'order-delay-notices': { label: '배송 지연 안내 메일 발송', intervalMinutes: 1 },
  'order-delay-sms': { label: '예약 일정 변경 문자 발송', intervalMinutes: 1 },
  'marketing-messages': { label: '마케팅 메시지 발송', intervalMinutes: 1 },
  'store-analytics': { label: '매장 분석·회원 활동 기록 보존 정리', intervalMinutes: 1 },
  'review-rating-history': { label: '리뷰 평점 일별 기록', intervalMinutes: 60 },
  'customer-rewards': { label: 'BEST 리뷰 적립금 지급', intervalMinutes: 1 },
  'goods-media': { label: '상품 이미지·디지털 파일 정리', intervalMinutes: 1440 },
  gifts: { label: '선물 만료·정리', intervalMinutes: 1 },
  subscriptions: { label: '정기구매 결제', intervalMinutes: 1 },
  'stock-safety-digest': { label: '안전재고 요약 메일', intervalMinutes: 1 },
  'delivery-tracking': { label: '택배 추적 자동 배송완료', intervalMinutes: 10 },
  'return-pickups': { label: '반품 자동 회수 접수', intervalMinutes: 5 },
  'payment-reconciliation': { label: '미종결 결제 자동 재확인', intervalMinutes: 10 },
} as const satisfies Record<string, CronJobDefinition>;

export type CronJobKey = keyof typeof CRON_JOBS;

export function isCronJobKey(value: string): value is CronJobKey {
  return Object.prototype.hasOwnProperty.call(CRON_JOBS, value);
}

export const PG_CRON_JOB_LABELS: Readonly<Record<string, string>> = {
  'expire-stale-checkouts': '결제 기한 만료 정리',
  'settle-delivered-orders': '배송완료 주문 자동 거래확정',
  'close-stale-answered-inquiries': '답변 완료 문의 자동 종료',
  'purge-expired-claim-refund-accounts': '환불 계좌 보관 기간 정리',
  'expire-store-credits': '적립금 만료',
  'admin-operation-alerts-retention': '운영 알림 보존 정리',
  'goods-transaction-quote-cleanup': '주문서 금액 계산 기록 정리',
  'sweep-restock-alerts': '재입고 알림 발송 준비',
  'auto-order-confirmation': '자동 발주확인',
  'adult-verification-session-expiry': '성인 인증 세션 만료',
  'erp-read-access-retention': 'ERP 조회 기록 보존 정리',
  'checkout-draft-cleanup': '주문서 임시 저장 정리',
  'member-phone-verification-retention': '휴대폰 인증 기록 정리',
  'monthly-grade-coupons': '등급 쿠폰 월 발급',
  'member-email-change-retention': '이메일 변경 인증 기록 정리',
  'goods-provider-cancellation-sweep': '결제사 취소 판정 대기 처리',
  'system-job-records-retention': '자동 작업 기록 보존 정리',
};

/** 운영자에게 보일 작업 이름. 모르는 잡은 잡 이름 그대로 보인다. */
export function systemJobLabel(jobKey: string, source: 'vercel_cron' | 'pg_cron', recordedLabel?: string | null): string {
  if (source === 'vercel_cron' && isCronJobKey(jobKey)) return CRON_JOBS[jobKey].label;
  if (source === 'pg_cron' && PG_CRON_JOB_LABELS[jobKey]) return PG_CRON_JOB_LABELS[jobKey];
  return recordedLabel || jobKey;
}
