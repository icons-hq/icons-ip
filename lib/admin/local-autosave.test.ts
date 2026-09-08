import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_LOCAL_DRAFT_TTL_MS, createAdminLocalAutosave, localDraftKey, withLocalRecoveryValues } from './local-autosave';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

const scope = { accountId: 'operator-a', formId: 'ip', recordId: 'hwasan' };
const fields = ['title', 'synopsis', 'imagePath'] as const;
const data = (values: Record<string, string>) => Object.entries(values);

afterEach(() => vi.useRealTimers());

describe('admin local autosave', () => {
  it('recovers public goods notice contact and a full option list while still excluding account contacts', () => {
    const storage = memoryStorage();
    const goodsScope = { ...scope, formId: 'good' };
    const allowed = ['noticeAsContact', 'customerContact', 'variants'];
    const session = createAdminLocalAutosave({ scope: goodsScope, fields: allowed, storage });
    const variants = 'v'.repeat(70000);
    session.capture(data({ noticeAsContact: '공개 A/S 연락처', customerContact: '개인 연락처', variants })); session.flush();
    expect(createAdminLocalAutosave({ scope: goodsScope, fields: allowed, storage }).getSnapshot().recovery?.values).toEqual({ noticeAsContact: '공개 A/S 연락처', variants });
    expect(createAdminLocalAutosave({ scope, fields: allowed, storage }).getSnapshot().recovery).toBeNull();
  });
  it('gives returned server validation values priority over a locally restored draft', () => {
    const server = { attempt: 2, values: { previousId: 'hwasan', title: '검증에 실패한 실제 제출값' } };
    expect(withLocalRecoveryValues(server, 'hwasan', { title: '오래된 로컬 입력' })).toBe(server);
    expect(withLocalRecoveryValues(server, 'another-ip', { title: '다른 IP 로컬 입력' }).values)
      .toEqual({ previousId: 'another-ip', title: '다른 IP 로컬 입력' });
    expect(withLocalRecoveryValues({}, null, { title: '신규 IP 로컬 입력' }).values)
      .toEqual({ previousId: '', title: '신규 IP 로컬 입력' });
  });
  it('debounces changes and offers explicit recovery after reopening', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const session = createAdminLocalAutosave({ scope, fields, storage });
    session.capture(data({ title: '첫 입력' }));
    vi.advanceTimersByTime(400);
    session.capture(data({ title: '다음 입력', imagePath: 'ip/artwork.webp' }));
    vi.advanceTimersByTime(400);
    expect(storage.data.size).toBe(0);
    vi.advanceTimersByTime(100);
    const reopened = createAdminLocalAutosave({ scope, fields, storage });
    expect(reopened.getSnapshot().recovery?.values).toEqual({ title: '다음 입력', imagePath: 'ip/artwork.webp' });
    expect(reopened.getSnapshot().restoredValues).toBeNull();
    reopened.restore();
    expect(reopened.getSnapshot().recovery).toBeNull();
    expect(reopened.getSnapshot().restoredValues).toEqual({ title: '다음 입력', imagePath: 'ip/artwork.webp' });
  });

  it('flushes before a tab or form closes and isolates account, form and record keys', () => {
    const storage = memoryStorage();
    const session = createAdminLocalAutosave({ scope, fields, storage });
    session.capture(data({ title: '보존할 입력' }));
    session.flush();
    for (const other of [
      { ...scope, accountId: 'operator-b' },
      { ...scope, formId: 'goods' },
      { ...scope, recordId: 'another-ip' },
      { ...scope, recordId: null },
    ]) {
      expect(createAdminLocalAutosave({ scope: other, fields, storage }).getSnapshot().recovery).toBeNull();
    }
    expect(localDraftKey({ ...scope, recordId: 'new' })).not.toBe(localDraftKey({ ...scope, recordId: null }));
    expect(createAdminLocalAutosave({ scope, fields, storage }).getSnapshot().recovery?.values.title).toBe('보존할 입력');
  });

  it('excludes files, transient image URLs, sensitive and non-allowlisted fields', () => {
    const storage = memoryStorage();
    const session = createAdminLocalAutosave({
      scope, storage, fields: [...fields, 'password', 'customerEmail', 'shippingAddress', 'accessToken', 'preview', 'file'],
    });
    session.capture([
      ['title', '일반 카탈로그 설명'], ['imagePath', 'ip/verified.webp'], ['unlisted', '금지'],
      ['file', new Blob(['not a persisted upload'])], ['password', 'secret'],
      ['customerEmail', 'buyer@example.com'], ['shippingAddress', '개인 주소'],
      ['accessToken', 'secret-token'], ['preview', 'blob:http://localhost/transient'],
    ]);
    session.flush();
    const reopened = createAdminLocalAutosave({ scope, fields, storage });
    expect(reopened.getSnapshot().recovery?.values).toEqual({ title: '일반 카탈로그 설명', imagePath: 'ip/verified.webp' });
    expect([...storage.data.values()].join('')).not.toMatch(/secret|buyer@|개인 주소|transient|금지/);
  });

  it('expires drafts after seven days, including a banner left open across expiry', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const session = createAdminLocalAutosave({ scope, fields, storage });
    session.capture(data({ title: '이전 입력' }));
    session.flush();
    const opened = createAdminLocalAutosave({ scope, fields, storage });
    vi.advanceTimersByTime(ADMIN_LOCAL_DRAFT_TTL_MS);
    opened.restore();
    expect(opened.getSnapshot().restoredValues).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('removes expired entries from earlier records when any catalog form is reopened', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const old = createAdminLocalAutosave({ scope, fields, storage });
    old.capture(data({ title: '만료된 카탈로그 입력' }));
    old.flush();
    storage.setItem('unrelated-setting', 'preserved');
    vi.advanceTimersByTime(ADMIN_LOCAL_DRAFT_TTL_MS);
    createAdminLocalAutosave({ scope: { ...scope, recordId: 'new-record' }, fields, storage });
    expect(storage.data.has(old.key)).toBe(false);
    expect(storage.getItem('unrelated-setting')).toBe('preserved');
  });

  it.each(['{broken', 'null', '{"savedAt":"invalid","values":{"title":"invalid"}}'])('removes malformed stored drafts: %s', (raw) => {
    const storage = memoryStorage();
    storage.setItem(localDraftKey(scope), raw);
    expect(() => createAdminLocalAutosave({ scope, fields, storage })).not.toThrow();
    expect(storage.data.size).toBe(0);
  });

  it('handles blocked storage without interrupting form editing', () => {
    const broken = () => { throw new Error('SecurityError'); };
    const session = createAdminLocalAutosave({ scope, fields, storage: { getItem: broken, setItem: broken, removeItem: broken } });
    expect(session.getSnapshot().unavailable).toBe(true);
    expect(() => {
      session.capture(data({ title: '메모리에서 편집 가능' }));
      session.flush();
      session.discard();
    }).not.toThrow();
  });

  it('discards recovery and clears pending writes so closing cannot recreate it', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const session = createAdminLocalAutosave({ scope, fields, storage });
    session.capture(data({ title: '버릴 입력' }));
    session.discard();
    session.flush();
    vi.runAllTimers();
    expect(storage.data.size).toBe(0);
    expect(session.getSnapshot().restoredValues).toBeNull();
  });

  it('retains a failed submission and clears only the submitted scope on success', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const submitted = createAdminLocalAutosave({ scope, fields, storage });
    submitted.capture(data({ title: '다시 제출할 입력' }));
    submitted.beginSubmission();
    submitted.completeSubmission(false);
    expect(createAdminLocalAutosave({ scope, fields, storage }).getSnapshot().recovery?.values.title).toBe('다시 제출할 입력');
    const other = createAdminLocalAutosave({ scope: { ...scope, recordId: 'other' }, fields, storage });
    other.capture(data({ title: '다른 화면의 입력' }));
    other.flush();
    submitted.beginSubmission();
    submitted.completeSubmission(true);
    submitted.flush();
    vi.runAllTimers();
    expect(storage.data.has(submitted.key)).toBe(false);
    expect(storage.data.has(other.key)).toBe(true);
    submitted.capture(data({ title: '저장 후 새 편집' }));
    submitted.flush();
    expect(storage.data.has(submitted.key)).toBe(true);
  });
});
