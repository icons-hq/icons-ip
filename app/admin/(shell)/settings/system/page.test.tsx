import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), health: vi.fn(), payments: vi.fn(), digest: vi.fn(), reconcile: vi.fn(), refresh: vi.fn(), saveDigest: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/system-health.server', () => ({ loadSystemHealth: mocks.health, loadUnresolvedPaymentAttempts: mocks.payments }));
vi.mock('@/lib/admin/ops-alert-digest.server', () => ({ loadOpsAlertDigest: mocks.digest }));
vi.mock('@/app/admin/ops-alert-digest-actions', () => ({ saveOpsAlertDigestAction: mocks.saveDigest }));
vi.mock('@/app/admin/system-health-actions', () => ({ reconcilePaymentAttemptAction: mocks.reconcile }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import Page from './page';
import { parseOpsAlertDigestSettings } from '@/lib/admin/ops-alert-digest';
import { parseSystemHealthReport, parseUnresolvedPaymentAttempts } from '@/lib/admin/system-health';

const asOf = '2026-11-18T03:00:00.000Z';
const access = (capabilities: string[]) => ({
  user: { id: 'operator-1' }, isStaff: true, role: 'staff',
  operatorAccess: { mode: 'configured', managerRole: 'primary', capabilities, revision: 1, setupRequired: false },
});
const health = parseSystemHealthReport({
  asOf,
  jobs: [{
    jobKey: 'gifts', source: 'vercel_cron', label: '선물 만료·정리', schedule: null, expectedIntervalMinutes: 1,
    lastRunAt: '2026-11-18T02:59:00Z', lastSuccessAt: '2026-11-18T02:40:00Z', lastFailureAt: '2026-11-18T02:59:00Z',
    lastStatusCode: 503, lastErrorCode: 'unhealthy_result', consecutiveFailures: 19, failures24h: 19, failing: true, stalled: false, active: true,
  }, {
    jobKey: 'expire-stale-checkouts', source: 'pg_cron', label: null, schedule: '* * * * *', expectedIntervalMinutes: 1,
    lastRunAt: '2026-11-18T02:59:00Z', lastSuccessAt: '2026-11-18T02:59:00Z', lastFailureAt: null, lastStatusCode: null, lastErrorCode: null,
    consecutiveFailures: 0, failures24h: 0, failing: false, stalled: false, active: true,
  }],
  recentFailures: [{ jobKey: 'gifts', source: 'vercel_cron', occurredAt: '2026-11-18T02:59:00Z', statusCode: 503, errorCode: 'unhealthy_result' }],
  payments: { goods: 2, tickets: 0, other: 0, oldestAt: '2026-11-17T03:00:00Z' },
  emails: { failed24h: 1, bounced24h: 3 },
  counts: { failingJobs: 1, stalledJobs: 0, problemJobs: 1, unresolvedPayments: 2, emailFailures: 1, emailBounces: 3, issues: 4 },
});
const payments = parseUnresolvedPaymentAttempts({
  total: 2, asOf, items: [{
    attemptId: 'a7000000-0000-4003-8000-000000000001', purpose: 'order', provider: 'toss', state: 'unknown', reason: 'unknown',
    amount: 31000, currency: 'KRW', refId: 'a7000000-0000-4002-8000-000000000001', orderNumber: '2026111800000000001',
    createdAt: '2026-11-17T03:00:00Z', updatedAt: '2026-11-17T03:00:00Z', claimExpiresAt: null, lastCheckedAt: null, reconcilable: true,
  }, {
    attemptId: 'a7000000-0000-4003-8000-000000000006', purpose: 'order', provider: 'korpay', state: 'needs_review', reason: 'needs_review',
    amount: 12000, currency: 'KRW', refId: 'a7000000-0000-4002-8000-000000000006', orderNumber: '2026111800000000006',
    createdAt: '2026-11-15T03:00:00Z', updatedAt: '2026-11-15T03:00:00Z', claimExpiresAt: null, lastCheckedAt: '2026-11-17T03:00:00Z', reconcilable: false,
  }],
});

const digest = parseOpsAlertDigestSettings({
  revision: 2, enabled: true, recipients: ['cs@example.test'], categories: ['inquiries', 'delay', 'system'], delayHours: 4,
  enabledAt: asOf, updatedAt: asOf, updatedByName: '운영자',
  runs: [{ runId: 'run-1', createdAt: asOf, counts: { inquiries: 2, questions: 0, delayedInquiries: 1, delayedQuestions: 0, system: 1 },
    deliveries: [{ recipient: 'cs@example.test', status: 'sent', errorCode: null, attempts: 1, updatedAt: asOf }] }],
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.digest.mockResolvedValue(digest);
  mocks.guard.mockResolvedValue(access(['home', 'platform.manage', 'sales.read', 'sales.manage']));
  mocks.health.mockResolvedValue(health);
  mocks.payments.mockResolvedValue(payments);
});

it('운영 관리자 권한을 확인한 뒤에만 상태를 읽는다', async () => {
  mocks.guard.mockRejectedValue(new Error('denied'));
  await expect(Page()).rejects.toThrow('denied');
  expect(mocks.health).not.toHaveBeenCalled();
  expect(mocks.payments).not.toHaveBeenCalled();
  mocks.guard.mockResolvedValue(access(['home', 'platform.manage', 'sales.manage']));
  await Page();
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/system');
  expect(mocks.payments).toHaveBeenCalledWith(50);
});

it('문제 있는 작업·미종결 결제·메일 실패 건수와 작업 표·실패 표·결제 목록을 kit 부품으로 그린다', async () => {
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('시스템 상태');
  for (const label of ['문제 있는 자동 작업 1개', '미종결 결제 2건', '메일 발송 실패(24시간) 1건', '메일 반송(24시간) 3건']) expect(html).toContain(`aria-label="${label}"`);
  expect(html).toMatch(/data-system-job="gifts" data-system-job-state="failing"/);
  expect(html).toContain('>실패 중<');
  expect(html).toContain('결제 기한 만료 정리');
  expect(html).toContain('일부 건 처리 실패');
  expect(html.match(/data-slot="table"/g)?.length).toBe(3);
  expect(html).toContain('href="/admin/sales/orders/a7000000-0000-4002-8000-000000000001"');
  expect(html).toContain('31,000원');
  expect(html).toContain('>결제 결과 불명<');
  expect(html).toContain('>결제사·주문 불일치<');
  expect(html).toContain('1일');
  // 조회 API가 있는 시도만 다시 확인 버튼이 있다(코페이는 수동 처리).
  expect(html.match(/결제 상태 다시 확인<\/button>/g)).toHaveLength(1);
  expect(html).toContain('aria-label="2026111800000000001 결제 상태 다시 확인"');
  expect(html).toContain('결제사 조회 불가 · 수동 처리');
  expect(html).not.toContain('지금 확인할 문제가 없습니다');
});

it('주문 관리 권한이 없으면 결제 목록을 읽지 않고 안내만 보인다', async () => {
  mocks.guard.mockResolvedValue(access(['home', 'platform.manage']));
  const html = renderToStaticMarkup(await Page());
  expect(mocks.payments).not.toHaveBeenCalled();
  expect(html).toContain('주문 관리 권한이 있는 매니저에게 보입니다');
  expect(html).not.toContain('결제 상태 다시 확인</button>');
});

it('문제가 없으면 정상 안내를, 읽지 못하면 정상처럼 보이지 않는 오류를 보인다', async () => {
  mocks.health.mockResolvedValue({ ...health!, jobs: health!.jobs.slice(1), recentFailures: [],
    counts: { failingJobs: 0, stalledJobs: 0, problemJobs: 0, unresolvedPayments: 0, emailFailures: 0, emailBounces: 0, issues: 0 } });
  mocks.payments.mockResolvedValue({ total: 0, asOf, items: [] });
  let html = renderToStaticMarkup(await Page());
  expect(html).toContain('지금 확인할 문제가 없습니다');
  expect(html).toContain('미종결 결제가 없습니다');
  mocks.health.mockResolvedValue(null);
  html = renderToStaticMarkup(await Page());
  expect(html).toContain('시스템 상태를 불러오지 못했습니다');
  expect(html).not.toContain('지금 확인할 문제가 없습니다');
});

it('운영 알림 메일 설정과 최근 발송 기록을 같은 화면에 보이고, 읽지 못하면 안내한다', async () => {
  let html = renderToStaticMarkup(await Page());
  expect(html).toContain('id="ops-alert-digest"');
  expect(html).toContain('운영 알림 메일 보내기');
  expect(html).toContain('새 1:1 문의');
  expect(html).toContain('시스템 장애');
  expect(html).toContain('cs@example.test');
  expect(html).toContain('>보냄<');
  expect(html).not.toContain('운영 알림 메일 설정을 불러오지 못했습니다');
  mocks.digest.mockResolvedValue(null);
  html = renderToStaticMarkup(await Page());
  expect(html).toContain('운영 알림 메일 설정을 불러오지 못했습니다');
});
