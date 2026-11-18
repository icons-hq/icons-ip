import { describe, expect, it } from 'vitest';
import { CRON_JOBS } from '@/lib/system-health/cron-jobs';
import {
  formatElapsed,
  formatJobInterval,
  parseSystemHealthReport,
  parseUnresolvedPaymentAttempts,
  paymentReconcileError,
  systemErrorCodeLabel,
  systemJobState,
} from './system-health';

const asOf = '2026-11-18T03:00:00.000Z';
const vercelJob = {
  jobKey: 'gifts', source: 'vercel_cron', label: '선물 만료·정리', schedule: null, expectedIntervalMinutes: 1,
  lastRunAt: '2026-11-18T02:59:00Z', lastSuccessAt: '2026-11-18T02:50:00Z', lastFailureAt: '2026-11-18T02:59:00Z',
  lastStatusCode: 503, lastErrorCode: 'unhealthy_result', consecutiveFailures: 9, failures24h: 9, failing: true, stalled: false, active: true,
};
const cronJob = {
  jobKey: 'expire-stale-checkouts', source: 'pg_cron', label: null, schedule: '* * * * *', expectedIntervalMinutes: 1,
  lastRunAt: '2026-11-18T02:59:00Z', lastSuccessAt: '2026-11-18T02:59:00Z', lastFailureAt: null, lastStatusCode: null, lastErrorCode: null,
  consecutiveFailures: 0, failures24h: 0, failing: false, stalled: false, active: true,
};
const report = {
  asOf, jobs: [cronJob, vercelJob],
  recentFailures: [{ jobKey: 'gifts', source: 'vercel_cron', occurredAt: '2026-11-18T02:59:00Z', statusCode: 503, errorCode: 'unhealthy_result' }],
  payments: { goods: 2, tickets: 0, other: 0, oldestAt: '2026-11-17T03:00:00Z' },
  emails: { failed24h: 1, bounced24h: 3 },
  counts: { failingJobs: 1, stalledJobs: 0, problemJobs: 1, unresolvedPayments: 2, emailFailures: 1, emailBounces: 3, issues: 4 },
};

describe('시스템 상태 읽기 모델', () => {
  it('판정을 검증하고, 기록이 없는 앱 자동 작업을 기록 없음으로 채워 문제 있는 작업부터 놓는다', () => {
    const parsed = parseSystemHealthReport(report)!;
    expect(parsed.jobs[0]).toMatchObject({ jobKey: 'gifts', label: '선물 만료·정리', failing: true });
    expect(systemJobState(parsed.jobs[0])).toBe('failing');
    expect(parsed.jobs.find(job => job.jobKey === 'expire-stale-checkouts')).toMatchObject({ label: '결제 기한 만료 정리', recorded: true });
    const unrecorded = parsed.jobs.filter(job => !job.recorded);
    expect(unrecorded).toHaveLength(Object.keys(CRON_JOBS).length - 1);
    expect(unrecorded.every(job => systemJobState(job) === 'unrecorded' && job.source === 'vercel_cron')).toBe(true);
    expect(parsed.recentFailures[0].label).toBe('선물 만료·정리');
    expect(parsed.counts.issues).toBe(4);
  });

  it('형식이 틀리면 null이다(정상처럼 보이지 않는다)', () => {
    expect(parseSystemHealthReport(null)).toBeNull();
    expect(parseSystemHealthReport({ ...report, counts: { ...report.counts, issues: -1 } })).toBeNull();
    expect(parseSystemHealthReport({ ...report, jobs: [{ ...vercelJob, failing: 'yes' }] })).toBeNull();
    expect(parseSystemHealthReport({ ...report, recentFailures: [{ ...report.recentFailures[0], errorCode: 'has space' }] })).toBeNull();
  });

  it('꺼진 잡은 꺼짐, 멈춤은 실패 중 다음이다', () => {
    expect(systemJobState({ failing: true, stalled: true, active: false, recorded: true })).toBe('inactive');
    expect(systemJobState({ failing: false, stalled: true, active: true, recorded: true })).toBe('stalled');
    expect(systemJobState({ failing: false, stalled: false, active: true, recorded: true })).toBe('ok');
  });

  it('오류 코드·경과·주기를 운영자 말로 바꾼다', () => {
    expect(systemErrorCodeLabel('unhealthy_result')).toBe('일부 건 처리 실패');
    expect(systemErrorCodeLabel('rows_skipped')).toBe('일부 건 건너뜀');
    expect(systemErrorCodeLabel('db:23505')).toBe('DB 오류(23505)');
    expect(systemErrorCodeLabel('sqlstate_P0001')).toBe('DB 오류(P0001)');
    expect(systemErrorCodeLabel('exception:TypeError')).toBe('처리 중 오류');
    expect(systemErrorCodeLabel('gift_expiry_failed')).toBe('gift_expiry_failed');
    expect(systemErrorCodeLabel(null)).toBeNull();
    expect(formatElapsed('2026-11-15T01:00:00Z', asOf)).toBe('3일 2시간');
    expect(formatElapsed('2026-11-18T00:48:00Z', asOf)).toBe('2시간 12분');
    expect(formatElapsed('2026-11-18T02:48:00Z', asOf)).toBe('12분');
    expect([1, 10, 60, 1440].map(formatJobInterval)).toEqual(['매분', '10분마다', '매시간', '매일']);
  });
});

describe('미종결 결제 목록', () => {
  const item = {
    attemptId: 'a7000000-0000-4003-8000-000000000001', purpose: 'order', provider: 'toss', state: 'unknown', reason: 'unknown',
    amount: 10001, currency: 'KRW', refId: 'a7000000-0000-4002-8000-000000000001', orderNumber: '2026111800000000001',
    createdAt: '2026-11-17T03:00:00Z', updatedAt: '2026-11-17T03:00:00Z', claimExpiresAt: null, lastCheckedAt: null, reconcilable: true,
  };
  it('목록을 검증한다', () => {
    expect(parseUnresolvedPaymentAttempts({ total: 3, asOf, items: [item] })?.items[0]).toMatchObject({ orderNumber: '2026111800000000001', reconcilable: true });
    expect(parseUnresolvedPaymentAttempts({ total: 0, asOf, items: [item] })).toBeNull();
    expect(parseUnresolvedPaymentAttempts({ total: 1, asOf, items: [{ ...item, reason: 'approved' }] })).toBeNull();
    expect(parseUnresolvedPaymentAttempts({ total: 1, asOf, items: [{ ...item, attemptId: 'x' }] })).toBeNull();
  });

  it('재확인 오류를 운영자 말로 바꾼다', () => {
    expect(paymentReconcileError('42501')).toContain('권한');
    expect(paymentReconcileError('55000', 'payment_reconciliation_cooldown')).toContain('1분 뒤');
    expect(paymentReconcileError('55000', 'payment_attempt_not_unresolved')).toContain('새로고침');
    expect(paymentReconcileError()).toContain('다시 시도');
  });
});
