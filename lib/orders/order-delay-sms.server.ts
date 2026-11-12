import 'server-only';

import { emailSiteUrl } from '@/lib/email/site-url';
import { orderReferenceLabel } from '@/lib/orders';
import { sendMemberSms, smsNotificationConfig, type MemberSmsResult, type SmsNotificationConfig } from '@/lib/sms/notifications.server';
import { createServiceClient } from '@/lib/supabase/service';

/*
 * 예약 일정 변경 안내(QNA-040)의 SMS 생산자 — 회원 SMS 알림 seam(sendMemberSms)의 첫 호출부다.
 *
 * · 켜는 조건은 둘 다다: DB 설정 order_delay_notice_delivery_control.sms_enabled(확정 때 대기열을 만들지 정한다)와
 *   앱의 SMS 알림 스위치(smsNotificationConfig — ICONS_SMS_NOTIFICATIONS_ENABLED·발송사·처리방침 시행일). 둘 다 기본 꺼짐이다.
 * · 받는 사람: 대기열을 꺼낼 때 DB가 대상 변경(배송 건 출고·일정 재변경)과 SMS 수신 동의를 다시 보고, 보낼 때 seam이 인증된 번호를
 *   확인한다. 거래 안내라 '(광고)'를 붙이지 않는다(transactional).
 * · 발송 기록(누구에게·언제·결과)은 order_delay_notice_sms_jobs에 남고 본문·번호는 남기지 않는다(본문은 안내 대상 행의 고객 문구).
 * · SMS 발송사 seam에는 멱등 키가 없다. 그래서 한 대상에 한 번만 시도하고, 처리 중 결과를 잃은 작업은 다시 보내지 않고
 *   결과 불명으로 둔다(claim_order_delay_sms_jobs).
 */

export interface OrderDelaySmsJob {
  id: string;
  claimToken: string;
  userId: string;
  orderId: string;
  orderNumber?: string | null;
  audience?: 'payer' | 'recipient';
  title: string;
  body: string;
}
export type OrderDelaySmsOutcome =
  | { status: 'sent'; reason: null }
  | { status: 'failed'; reason: 'provider_unavailable' | 'invalid_body' }
  | { status: 'skipped'; reason: 'sms_disabled' | 'consent_required' | 'no_verified_phone' | 'account_unavailable' };
export interface OrderDelaySmsRepository {
  claim(): Promise<OrderDelaySmsJob[]>;
  finish(id: string, claimToken: string, outcome: OrderDelaySmsOutcome): Promise<boolean>;
}
type SendMemberSms = typeof sendMemberSms;

/** 고객 안내 제목·주문번호·안내 문구·주문 링크. seam이 앞에 '[ICONS] '를 붙인다. 선물 받는 분은 선물함으로 간다. */
export function orderDelaySmsText(job: Pick<OrderDelaySmsJob, 'title' | 'body' | 'orderId' | 'orderNumber' | 'audience'>, siteUrl: string): string {
  const link = job.audience === 'recipient' ? `${siteUrl}/gifts` : `${siteUrl}/orders/${job.orderId}`;
  return `${job.title}\n주문 ${orderReferenceLabel(job.orderId, job.orderNumber)}\n${job.body}\n${link}`;
}

export function orderDelaySmsOutcome(result: MemberSmsResult): OrderDelaySmsOutcome {
  if (result.sent) return { status: 'sent', reason: null };
  switch (result.reason) {
    case 'disabled': return { status: 'skipped', reason: 'sms_disabled' };
    case 'consent_required': return { status: 'skipped', reason: 'consent_required' };
    case 'no_verified_phone': return { status: 'skipped', reason: 'no_verified_phone' };
    case 'account_unavailable': return { status: 'skipped', reason: 'account_unavailable' };
    case 'invalid_body': return { status: 'failed', reason: 'invalid_body' };
    /* 거래 안내에는 광고 전용 거절(opt_out_missing·quiet_hours)이 오지 않는다. 와도 다시 보내지 않는다. */
    default: return { status: 'failed', reason: 'provider_unavailable' };
  }
}

function repositoryFromEnvironment(): OrderDelaySmsRepository {
  const service = createServiceClient();
  return {
    async claim() {
      const { data, error } = await service.rpc('claim_order_delay_sms_jobs', { batch_limit: 25 });
      if (error || !Array.isArray(data) || data.length > 25) throw new Error('delay_sms_claim_failed');
      return data as OrderDelaySmsJob[];
    },
    async finish(id, claimToken, outcome) {
      const { data, error } = await service.rpc('finish_order_delay_sms_job', {
        p_target_id: id, p_claim: claimToken, p_status: outcome.status, p_reason: outcome.reason,
      });
      if (error || typeof data !== 'boolean') throw new Error('delay_sms_finish_failed');
      return data;
    },
  };
}

export async function processOrderDelaySms(dependencies: {
  config?: SmsNotificationConfig | null;
  repository?: OrderDelaySmsRepository;
  send?: SendMemberSms;
  siteUrl?: string;
} = {}) {
  const config = dependencies.config === undefined ? smsNotificationConfig() : dependencies.config;
  const result = { enabled: Boolean(config), claimed: 0, sent: 0, failed: 0, skipped: 0, stale: 0 };
  /* 앱 스위치가 꺼져 있으면 DB도 건드리지 않는다(대기열은 다음에 켜졌을 때 하루 기한·설정을 다시 보고 처리된다). */
  if (!config) return result;
  const siteUrl = dependencies.siteUrl ?? emailSiteUrl();
  const repository = dependencies.repository ?? repositoryFromEnvironment();
  const send = dependencies.send ?? sendMemberSms;
  const jobs = await repository.claim();
  result.claimed = jobs.length;
  for (let offset = 0; offset < jobs.length; offset += 5) {
    await Promise.all(jobs.slice(offset, offset + 5).map(async (job) => {
      let outcome: OrderDelaySmsOutcome;
      try {
        outcome = orderDelaySmsOutcome(await send({ userId: job.userId, kind: 'transactional', body: orderDelaySmsText(job, siteUrl) }, { config }));
      } catch {
        outcome = { status: 'failed', reason: 'provider_unavailable' };
      }
      try {
        if (await repository.finish(job.id, job.claimToken, outcome)) result[outcome.status]++;
        else result.stale++;
      } catch {
        result.stale++;
      }
    }));
  }
  return result;
}
