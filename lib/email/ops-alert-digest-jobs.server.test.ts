import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailDispatcher, type EmailDispatcherRepository, type EmailProvider } from './dispatcher';
import {
  OPS_ALERT_DIGEST_CONTENT_REVISION,
  parseOpsAlertDigestJob,
  processOpsAlertDigests,
  type OpsAlertDigestJob,
  type OpsAlertDigestRepository,
} from './ops-alert-digest-jobs.server';
import { parseOpsAlertDigestContent, renderOpsAlertDigestEmail } from './ops-alert-digest';

const job: OpsAlertDigestJob = {
  id: '60000000-0000-4000-8000-000000000001', claimToken: '60000000-0000-4000-8000-000000000002', recipient: 'ops@example.test',
  createdAt: '2031-05-01T03:00:00.000Z',
  counts: { inquiries: 2, questions: 1, delayedInquiries: 1, delayedQuestions: 1, system: 1 },
  systemTitles: ['자동 작업이 실패했습니다 · 배송 추적'],
  delayed: [{ kind: 'inquiry', href: '/admin/cs/inquiries/60000000-0000-4000-8000-0000000000a1', waitedHours: 6 },
    { kind: 'question', href: '/admin/cs/qna?status=unanswered', waitedHours: 5 }],
};

function setup(jobs: OpsAlertDigestJob[] = [job]) {
  const finishes: unknown[] = [];
  const binds: string[] = [];
  const repository: OpsAlertDigestRepository = {
    claim: async () => jobs,
    bindIntent: async (id) => { binds.push(id); return true; },
    finish: async (_id, _claim, result) => { finishes.push(result); return true; },
  };
  let state = 'queued';
  const repo: EmailDispatcherRepository = {
    enqueue: vi.fn(async () => ({ kind: 'enqueued' as const, intentId: '60000000-0000-4000-8000-000000000005', idempotencyKey: 'email/ops', state: state as 'queued' })),
    enqueueAll: vi.fn(),
    claimDispatch: vi.fn(async () => ({ kind: 'claimed' as const, intentId: '60000000-0000-4000-8000-000000000005', claimId: '60000000-0000-4000-8000-000000000006', idempotencyKey: 'email/ops' })),
    recordAccepted: vi.fn(async () => { state = 'accepted'; return { state: 'accepted' as const }; }),
    recoverAcceptedPersistence: vi.fn(async () => ({ kind: 'preserved' as const, state: 'accepted' as const })),
    recordDispatchFailure: vi.fn(async () => ({ state: 'queued' as const, retryable: true })),
    reduceProviderEvent: vi.fn(),
  };
  const provider: EmailProvider = { send: vi.fn(async () => ({ kind: 'accepted' as const, providerReference: 'synthetic-provider-id' })) };
  return { repository, repo, provider, finishes, binds, dispatcher: createEmailDispatcher({ repository: repo, provider }) };
}
afterEach(() => vi.unstubAllEnvs());

describe('운영 알림 요약 메일 작업', () => {
  it('전용 출처·고정 내용으로 dispatcher에 맡기고 공급사 접수를 발송 완료로 남긴다', async () => {
    vi.stubEnv('SITE_URL', 'https://iconsip.com/');
    const s = setup();
    const result = await processOpsAlertDigests({ repository: s.repository, dispatcher: s.dispatcher });
    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0, unknown: 0, stale: 0 });
    expect(s.repo.enqueue).toHaveBeenCalledWith({ source: 'ops_alert_digest', sourceReference: job.id, recipient: 'ops@example.test',
      messageKind: 'ops_alert_digest', contentRevision: OPS_ALERT_DIGEST_CONTENT_REVISION });
    expect(s.binds).toEqual([job.id]);
    expect(s.provider.send).toHaveBeenCalledWith(expect.objectContaining({ recipient: 'ops@example.test',
      message: expect.objectContaining({ subject: '[엑스스퀘어] 운영 알림 — 새 문의 2건 · 새 굿즈 Q&A 1건 · 답변 지연 2건 · 시스템 장애 1건' }) }));
    expect(s.finishes).toEqual([{ status: 'sent', errorCode: null, retryable: false }]);
  });

  it('고정 SITE_URL 없는 Preview는 작업 선점 전에 중단한다', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('SITE_URL', '');
    const s = setup(); s.repository.claim = vi.fn(s.repository.claim);
    await expect(processOpsAlertDigests({ repository: s.repository, dispatcher: s.dispatcher })).rejects.toThrow('email_site_url_required');
    expect(s.repository.claim).not.toHaveBeenCalled();
  });

  it('발송 설정이 없으면 보내지 않고 다시 시도할 실패로 남긴다', async () => {
    const s = setup();
    expect(await processOpsAlertDigests({ repository: s.repository, dispatcher: null })).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    expect(s.finishes).toEqual([{ status: 'failed', errorCode: 'provider_not_configured', retryable: true }]);
  });

  it('dispatcher gate가 닫혀 있으면 다시 시도할 실패다', async () => {
    const s = setup();
    s.repo.claimDispatch = vi.fn(async () => ({ kind: 'disabled' as const, state: 'queued' as const }));
    await processOpsAlertDigests({ repository: s.repository, dispatcher: createEmailDispatcher({ repository: s.repo, provider: s.provider }) });
    expect(s.finishes).toEqual([{ status: 'failed', errorCode: 'delivery_disabled', retryable: true }]);
    expect(s.provider.send).not.toHaveBeenCalled();
  });

  it('결속이 거절되면(선점 만료) 보내지 않는다', async () => {
    const s = setup();
    s.repository.bindIntent = async () => false;
    expect(await processOpsAlertDigests({ repository: s.repository, dispatcher: s.dispatcher })).toMatchObject({ stale: 1, sent: 0 });
    expect(s.provider.send).not.toHaveBeenCalled();
    expect(s.finishes).toEqual([]);
  });

  it('공급사 호출 중 예외는 결과 불명으로 남긴다(중복 발송 대신 검토)', async () => {
    const s = setup();
    s.provider.send = vi.fn(async () => { throw new Error('network'); });
    await processOpsAlertDigests({ repository: s.repository, dispatcher: createEmailDispatcher({ repository: s.repo, provider: s.provider }) });
    expect(s.finishes).toEqual([{ status: 'unknown', errorCode: 'delivery_outcome_unknown', retryable: false }]);
  });

  it('모양이 틀린 선점 결과는 보내지 않고 결과 불명으로 닫는다', async () => {
    const s = setup([]);
    const finish = vi.fn(async () => true);
    const repository = { ...s.repository, finish, malformed: [{ id: '60000000-0000-4000-8000-000000000009', claimToken: '60000000-0000-4000-8000-00000000000a' }] };
    expect(await processOpsAlertDigests({ repository, dispatcher: s.dispatcher })).toMatchObject({ claimed: 1, unknown: 1 });
    expect(finish).toHaveBeenCalledWith('60000000-0000-4000-8000-000000000009', '60000000-0000-4000-8000-00000000000a',
      { status: 'unknown', errorCode: 'delivery_needs_review', retryable: false });
    expect(s.provider.send).not.toHaveBeenCalled();
  });

  it('선점 결과의 모양을 엄격히 읽는다', () => {
    expect(parseOpsAlertDigestJob({ ...job })).toEqual(job);
    expect(parseOpsAlertDigestJob({ ...job, recipient: 'no-at-sign' })).toBeNull();
    expect(parseOpsAlertDigestJob({ ...job, counts: { ...job.counts, system: -1 } })).toBeNull();
    expect(parseOpsAlertDigestJob({ ...job, counts: { inquiries: 0, questions: 0, delayedInquiries: 0, delayedQuestions: 0, system: 0 } })).toBeNull();
    expect(parseOpsAlertDigestJob({ ...job, systemTitles: [1] })).toBeNull();
    expect(parseOpsAlertDigestJob({ ...job, createdAt: 'nope' })).toBeNull();
    // 어드민 밖 주소는 메일 링크가 되지 못한다.
    expect(parseOpsAlertDigestContent({ ...job, delayed: [{ kind: 'inquiry', href: 'https://evil.example/x', waitedHours: 5 }] })).toBeNull();
    expect(parseOpsAlertDigestContent({ ...job, delayed: [{ kind: 'order', href: '/admin/x', waitedHours: 5 }] })).toBeNull();
  });
});

describe('운영 알림 요약 메일 본문', () => {
  it('건수·링크·자동 작업 이름만 싣고 개인정보 칸이 없다', () => {
    const email = renderOpsAlertDigestEmail(job, 'https://iconsip.com');
    expect(email.text).toContain('■ 시스템 장애 1건');
    expect(email.text).toContain('- 자동 작업이 실패했습니다 · 배송 추적');
    expect(email.text).toContain('시스템 상태 열기: https://iconsip.com/admin/settings/system');
    expect(email.text).toContain('1:1 문의 1건, 굿즈 Q&A 1건');
    expect(email.text).toContain('가장 오래 기다린 건 6시간');
    expect(email.text).toContain('- https://iconsip.com/admin/cs/inquiries/60000000-0000-4000-8000-0000000000a1');
    expect(email.text).toContain('■ 새 굿즈 Q&A 1건');
    expect(email.text).toContain('https://iconsip.com/admin/settings/system#ops-alert-digest');
    expect(email.html).toContain('<a href="https://iconsip.com/admin/cs/qna?status=unanswered">');
  });

  it('범주가 하나뿐이면 그 범주만 제목·본문에 나온다', () => {
    const email = renderOpsAlertDigestEmail({ ...job, counts: { inquiries: 3, questions: 0, delayedInquiries: 0, delayedQuestions: 0, system: 0 }, systemTitles: [], delayed: [] }, 'https://iconsip.com');
    expect(email.subject).toBe('[엑스스퀘어] 운영 알림 — 새 문의 3건');
    expect(email.text).not.toContain('시스템 장애');
    expect(email.text).not.toContain('답변 지연');
    expect(email.text).not.toContain('기다리는 문의 바로가기');
  });

  it('작업 이름을 HTML로 이스케이프한다', () => {
    const email = renderOpsAlertDigestEmail({ ...job, systemTitles: ['<b>작업</b>'] }, 'https://iconsip.com');
    expect(email.html).toContain('&lt;b&gt;작업&lt;/b&gt;');
    expect(email.html).not.toContain('<b>작업</b>');
  });
});
