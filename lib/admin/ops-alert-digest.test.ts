import { describe, expect, it } from 'vitest';
import { isOpsAlertDigestDelayHours, opsAlertDigestErrorMessage, parseOpsAlertDigestSettings } from './ops-alert-digest';

const settings = {
  revision: 2, enabled: true, recipients: ['cs@example.test'], categories: ['inquiries', 'system'], delayHours: 4,
  enabledAt: '2031-05-01T00:00:00Z', updatedAt: '2031-05-01T00:00:00Z', updatedByName: '운영자',
  runs: [{ runId: 'r1', createdAt: '2031-05-01T00:10:00Z', counts: { inquiries: 1, questions: 0, delayedInquiries: 0, delayedQuestions: 0, system: 1 },
    deliveries: [{ recipient: 'cs@example.test', status: 'queued', errorCode: 'provider_retryable', attempts: 1, updatedAt: '2031-05-01T00:10:20Z' }] }],
};

describe('운영 알림 요약 메일 설정', () => {
  it('설정 문서를 엄격히 읽는다', () => {
    expect(parseOpsAlertDigestSettings(settings)).toMatchObject({ revision: 2, delayHours: 4, categories: ['inquiries', 'system'] });
    expect(parseOpsAlertDigestSettings({ ...settings, categories: ['inquiries', 'orders'] })).toBeNull();
    expect(parseOpsAlertDigestSettings({ ...settings, revision: 0 })).toBeNull();
    expect(parseOpsAlertDigestSettings({ ...settings, runs: [{ ...settings.runs[0], deliveries: [{ ...settings.runs[0].deliveries[0], status: 'weird' }] }] })).toBeNull();
    expect(parseOpsAlertDigestSettings({ ...settings, runs: [{ ...settings.runs[0], counts: { inquiries: -1 } }] })).toBeNull();
    expect(parseOpsAlertDigestSettings(null)).toBeNull();
  });

  it('지연 기준은 1~72시간 정수다', () => {
    for (const ok of [1, 4, 72]) expect(isOpsAlertDigestDelayHours(ok)).toBe(true);
    for (const bad of [0, 73, 1.5, NaN, '4']) expect(isOpsAlertDigestDelayHours(bad)).toBe(false);
  });

  it('오류 문구는 원인을 말하고 내부 값을 싣지 않는다', () => {
    expect(opsAlertDigestErrorMessage({ code: '42501' })).toContain('계정 주매니저');
    expect(opsAlertDigestErrorMessage({ code: 'PT409' })).toContain('다른 운영자가 먼저');
    expect(opsAlertDigestErrorMessage({ message: 'invalid_ops_alert_category' })).toContain('범주');
    expect(opsAlertDigestErrorMessage({ message: 'invalid_ops_alert_recipient' })).toContain('형식');
    expect(opsAlertDigestErrorMessage({ message: 'boom secret' })).not.toContain('secret');
  });
});

describe('설정 화면 이탈 보호', () => {
  it('고친 입력과 결과 불명 저장은 묻고, 저장 중에는 막는다', async () => {
    const { opsAlertDigestLeaveGuard } = await import('./ops-alert-digest');
    expect(opsAlertDigestLeaveGuard({ changed: false, uncertain: false, pending: false })).toEqual({ dirty: false, blocked: false });
    expect(opsAlertDigestLeaveGuard({ changed: true, uncertain: false, pending: false })).toEqual({ dirty: true, blocked: false });
    expect(opsAlertDigestLeaveGuard({ changed: false, uncertain: true, pending: false })).toEqual({ dirty: true, blocked: false });
    expect(opsAlertDigestLeaveGuard({ changed: true, uncertain: false, pending: true })).toEqual({ dirty: true, blocked: true });
  });
});
