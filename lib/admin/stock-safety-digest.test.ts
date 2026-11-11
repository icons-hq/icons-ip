import { describe, expect, it } from 'vitest';
import {
  isDigestSendTime,
  parseRecipientList,
  parseStockSafetyDigestSettings,
  stockDigestErrorMessage,
} from './stock-safety-digest';

const settings = {
  revision: 2, enabled: true, sendTime: '09:00', operatorRecipients: ['ops@example.test'], enabledAt: '2031-05-01T00:00:00Z',
  updatedAt: '2031-05-01T00:00:00Z', updatedByName: '운영자', nextSendAt: '2031-05-02T00:00:00Z', lowStockCount: 3,
  origins: [{ originId: 'o1', originCode: 'namyangju', originName: '남양주', active: true, revision: 1, recipients: ['seowon@example.test'] }],
  runs: [{ digestDate: '2031-05-01', createdAt: '2031-05-01T00:00:10Z', itemCount: 3, deliveries: [
    { audience: 'operator', originName: null, recipient: 'ops@example.test', itemCount: 3, status: 'sent', errorCode: null, attempts: 1, updatedAt: '2031-05-01T00:00:20Z' },
    { audience: 'origin', originName: '남양주', recipient: 'seowon@example.test', itemCount: 1, status: 'queued', errorCode: 'provider_retryable', attempts: 1, updatedAt: '2031-05-01T00:00:20Z' },
  ] }],
};

describe('안전재고 요약 메일 설정', () => {
  it('주소 목록은 쉼표·줄바꿈으로 나누고 소문자·중복 제거한다', () => {
    expect(parseRecipientList(' Ops@Example.test,\nmd@example.test; ops@example.test ', 10)).toEqual({ ok: true, recipients: ['ops@example.test', 'md@example.test'] });
    expect(parseRecipientList('', 10)).toEqual({ ok: true, recipients: [] });
    expect(parseRecipientList('not-an-email', 10)).toMatchObject({ ok: false });
    expect(parseRecipientList('a@b', 10)).toMatchObject({ ok: false });
    expect(parseRecipientList('a@example.test,b@example.test', 1)).toEqual({ ok: false, error: '받는 주소는 1개까지 넣을 수 있습니다.' });
  });

  it('발송 시각은 HH:MM(00:00~23:59)이다', () => {
    expect(isDigestSendTime('09:00')).toBe(true);
    expect(isDigestSendTime('23:59')).toBe(true);
    expect(isDigestSendTime('24:00')).toBe(false);
    expect(isDigestSendTime('9:00')).toBe(false);
  });

  it('설정 문서를 읽고 모르는 상태는 막는다', () => {
    expect(parseStockSafetyDigestSettings(settings)?.runs[0].deliveries[1]).toMatchObject({ status: 'queued', errorCode: 'provider_retryable' });
    expect(parseStockSafetyDigestSettings({ ...settings, sendTime: '9시' })).toBeNull();
    expect(parseStockSafetyDigestSettings({ ...settings, runs: [{ ...settings.runs[0], deliveries: [{ ...settings.runs[0].deliveries[0], status: 'bounced' }] }] })).toBeNull();
    expect(parseStockSafetyDigestSettings({ ...settings, enabled: false, enabledAt: null, nextSendAt: null })?.nextSendAt).toBeNull();
  });

  it('DB 오류를 운영 문구로 바꾼다', () => {
    expect(stockDigestErrorMessage({ code: '42501', message: 'operator_capability_required' })).toContain('계정 주매니저');
    expect(stockDigestErrorMessage({ code: 'PT409', message: 'stock_safety_digest_changed' })).toContain('먼저 설정을 바꿨습니다');
    expect(stockDigestErrorMessage({ code: '22023', message: 'invalid_stock_digest_recipient' })).toContain('메일 주소');
  });
});
