import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_LOCAL_DRAFT_TTL_MS, createAdminLocalAutosave, localDraftKey, overlayLocalEdits, rebaseLocalEditBaseline, withLocalRecoveryValues } from './local-autosave';

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
  it('설정 조회만 하고 나가면 복구할 입력을 만들지 않고 실제 편집·명시 복구는 보존한다', () => {
    const storage = memoryStorage();
    const opened = createAdminLocalAutosave({ scope, fields, storage });
    opened.capture(data({ title: '저장된 상품', synopsis: '조회로 채워진 값' }), { preserveRecovery: true }); opened.flush();
    expect(createAdminLocalAutosave({ scope, fields, storage }).getSnapshot().recovery).toBeNull();
    opened.capture(data({ title: '실제 수정한 상품' })); opened.flush();
    const reopened = createAdminLocalAutosave({ scope, fields, storage }); reopened.restore();
    reopened.capture(data({ title: '실제 수정한 상품', imagePath: 'verified.webp' }), { preserveRecovery: true }); reopened.flush();
    expect(createAdminLocalAutosave({ scope, fields, storage }).getSnapshot().recovery?.values).toEqual({ title: '실제 수정한 상품', imagePath: 'verified.webp' });
    reopened.discard(); reopened.capture(data({ title: '서버 초기값' }), { preserveRecovery: true }); reopened.flush();
    expect(createAdminLocalAutosave({ scope, fields, storage }).getSnapshot().recovery).toBeNull();
  });
  it('비동기 hidden 초기화는 복구 후보를 덮지 않으며 명시 입력·적용 뒤에는 최신 전체 값을 보관한다', () => {
    const storage = memoryStorage();
    const original = createAdminLocalAutosave({ scope, fields, storage });
    original.capture(data({ title: '복구할 상품', synopsis: '적용한 옵션 초안에 대응하는 입력' })); original.flush();
    const reopened = createAdminLocalAutosave({ scope, fields, storage });
    reopened.capture(data({ title: '서버 초기값', synopsis: '비동기 속성 초기화' }), { preserveRecovery: true }); reopened.flush();
    expect(reopened.getSnapshot().recovery?.values.title).toBe('복구할 상품');
    reopened.restore(); expect(reopened.getSnapshot().restoredValues?.title).toBe('복구할 상품');
    reopened.capture(data({ title: '사용자가 적용한 최신 초안' })); reopened.flush();
    reopened.capture(data({ title: '사용자가 적용한 최신 초안', imagePath: 'verified.webp' }), { preserveRecovery: true }); reopened.flush();
    expect(createAdminLocalAutosave({ scope, fields, storage }).getSnapshot().recovery?.values).toEqual({ title: '사용자가 적용한 최신 초안', imagePath: 'verified.webp' });
    const pending = createAdminLocalAutosave({ scope, fields, storage });
    pending.capture(data({ title: '복구 대신 직접 편집' })); pending.flush();
    expect(pending.getSnapshot().recovery).toBeNull();
    expect(createAdminLocalAutosave({ scope, fields, storage }).getSnapshot().recovery?.values.title).toBe('복구 대신 직접 편집');
  });
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

describe('복구 안내가 떠 있는 동안의 새 입력', () => {
  const blank = { title: '', synopsis: '', imagePath: '' };
  const open = (storage: ReturnType<typeof memoryStorage>, linkedFields?: Record<string, string[]>) => createAdminLocalAutosave({ scope, fields, storage, linkedFields });
  /** 이전 입력을 남기고 나갔다가, 빈 폼으로 돌아와 복구 안내를 본 상태. */
  function returning(saved: Record<string, string> = { ...blank, title: '이전 제목' }, linkedFields?: Record<string, string[]>) {
    const storage = memoryStorage();
    const first = open(storage, linkedFields);
    first.capture(data(saved)); first.flush();
    const session = open(storage, linkedFields);
    session.setEditBaseline(data(blank));
    return { storage, session };
  }

  it('새 입력이 안내를 닫지 않고 이전 기록도 덮지 않아, 새로고침 뒤 복구하면 둘 다 돌아온다', () => {
    vi.useFakeTimers();
    const { storage, session } = returning();
    session.capture(data({ ...blank, synopsis: '새로 입력한 줄거리' }));
    expect(session.getSnapshot().recovery?.values.title).toBe('이전 제목');
    vi.advanceTimersByTime(500);
    const reloaded = open(storage);
    expect(reloaded.getSnapshot().recovery?.values).toEqual({ title: '이전 제목', synopsis: '새로 입력한 줄거리', imagePath: '' });
    reloaded.restore();
    expect(reloaded.getSnapshot().restoredValues).toEqual({ title: '이전 제목', synopsis: '새로 입력한 줄거리', imagePath: '' });
  });

  it('입력 직후 복구를 눌러도 아직 쓰지 않은 새 입력까지 함께 돌아오고 뒤늦은 쓰기가 없다', () => {
    vi.useFakeTimers();
    const { storage, session } = returning();
    session.capture(data({ ...blank, synopsis: '방금 입력' }));
    session.restore();
    expect(session.getSnapshot().recovery).toBeNull();
    expect(session.getSnapshot().restoredValues).toEqual({ title: '이전 제목', synopsis: '방금 입력', imagePath: '' });
    const written = storage.getItem(session.key);
    vi.runAllTimers();
    expect(storage.getItem(session.key)).toBe(written);
  });

  it('같은 칸은 방금 입력한 값이 남고, 고쳤다가 되돌리면 이전 값이 그대로 남는다', () => {
    const { storage, session } = returning();
    session.capture(data({ ...blank, title: '새 제목' })); session.flush();
    expect(open(storage).getSnapshot().recovery?.values.title).toBe('새 제목');
    session.capture(data(blank)); session.flush();
    expect(open(storage).getSnapshot().recovery?.values.title).toBe('이전 제목');
  });

  it('버리기는 이전 기록만 버리고 화면에서 고친 입력은 계속 보관하며 폼을 다시 그리지 않는다', () => {
    vi.useFakeTimers();
    const { storage, session } = returning();
    session.capture(data({ ...blank, synopsis: '새로 입력한 줄거리' }));
    session.discardRecovery();
    expect(session.getSnapshot()).toMatchObject({ recovery: null, restoredValues: null, revision: 0 });
    expect(open(storage).getSnapshot().recovery?.values).toEqual({ ...blank, synopsis: '새로 입력한 줄거리' });
    session.capture(data({ ...blank, synopsis: '이어서 입력' })); session.flush();
    expect(open(storage).getSnapshot().recovery?.values).toEqual({ ...blank, synopsis: '이어서 입력' });
  });

  it('고친 칸 없이 버리면 기록을 지우고, 이후 비동기 초기화로 유령 기록을 만들지 않는다', () => {
    const { storage, session } = returning();
    session.capture(data({ ...blank, synopsis: '잠깐 입력' })); session.capture(data(blank));
    session.discardRecovery();
    expect(storage.data.size).toBe(0);
    session.capture(data({ ...blank, imagePath: '조회로 채운 값' }), { preserveRecovery: true }); session.flush();
    expect(storage.data.size).toBe(0);
  });

  it('비동기 초기화로 바뀐 칸은 입력으로 세지 않아 이전 기록을 가리지 않는다', () => {
    const { storage, session } = returning({ ...blank, title: '이전 제목', imagePath: '이전 이미지' });
    session.capture(data({ ...blank, imagePath: '조회로 채운 값' }), { preserveRecovery: true });
    session.capture(data({ ...blank, imagePath: '조회로 채운 값', synopsis: '새 입력' })); session.flush();
    expect(open(storage).getSnapshot().recovery?.values).toEqual({ title: '이전 제목', synopsis: '새 입력', imagePath: '이전 이미지' });
  });

  it('잠겨서 읽지 못한 폼은 잠금 해제 때 읽은 값을 입력 전 기준으로 삼는다', () => {
    const storage = memoryStorage();
    const first = open(storage);
    first.capture(data({ ...blank, title: '이전 제목' })); first.flush();
    const session = open(storage);
    session.capture(data(blank), { preserveRecovery: true });
    session.capture(data({ ...blank, synopsis: '새 입력' })); session.flush();
    expect(open(storage).getSnapshot().recovery?.values).toEqual({ title: '이전 제목', synopsis: '새 입력', imagePath: '' });
  });

  it('입력을 지워 폼에서 빠진 칸은 이전 기록에서도 뺀다', () => {
    const { storage, session } = returning({ ...blank, title: '이전 제목', imagePath: 'a.webp' });
    session.capture(data({ title: '', synopsis: '' })); session.flush();
    expect(open(storage).getSnapshot().recovery?.values).toEqual({ title: '이전 제목', synopsis: '' });
  });

  it('저장 실패로 폼이 다시 그려져도 처음 기준을 유지해 앞선 입력이 이전 기록에 남는다', () => {
    const { storage, session } = returning();
    session.capture(data({ ...blank, synopsis: '첫 입력' }));
    session.beginSubmission(); session.completeSubmission(false);
    session.setEditBaseline(data({ ...blank, synopsis: '첫 입력' }));
    session.capture(data({ ...blank, synopsis: '첫 입력', imagePath: '이어서 입력' })); session.flush();
    expect(open(storage).getSnapshot().recovery?.values).toEqual({ title: '이전 제목', synopsis: '첫 입력', imagePath: '이어서 입력' });
  });

  it('저장에 성공하면 안내와 이전 기록을 함께 지운다', () => {
    const { storage, session } = returning();
    session.capture(data({ ...blank, synopsis: '저장한 입력' }));
    session.beginSubmission(); session.completeSubmission(true);
    expect(session.getSnapshot().recovery).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('보관 기한을 넘긴 채 열어 둔 안내에는 합치지 않아 만료된 입력을 되살리지 않는다', () => {
    vi.useFakeTimers();
    const { storage, session } = returning();
    vi.advanceTimersByTime(ADMIN_LOCAL_DRAFT_TTL_MS);
    session.capture(data({ ...blank, synopsis: '만료 뒤 입력' })); session.flush();
    expect(session.getSnapshot().recovery).toBeNull();
    expect(open(storage).getSnapshot().recovery?.values).toEqual({ ...blank, synopsis: '만료 뒤 입력' });
  });

  it('기준 칸을 고치면 딸린 칸도 화면 값을 쓰고, 딸린 칸만 고치면 이전 기준 칸을 남긴다', () => {
    const linked = { title: ['synopsis'] };
    const saved = { ...blank, title: '이전 제목', synopsis: '이전 줄거리' };
    const leader = returning(saved, linked);
    leader.session.capture(data({ ...blank, title: '새 제목' })); leader.session.flush();
    expect(open(leader.storage).getSnapshot().recovery?.values).toEqual({ title: '새 제목', synopsis: '', imagePath: '' });
    const follower = returning(saved, linked);
    follower.session.capture(data({ ...blank, synopsis: '새 줄거리' })); follower.session.flush();
    expect(open(follower.storage).getSnapshot().recovery?.values).toEqual({ title: '이전 제목', synopsis: '새 줄거리', imagePath: '' });
  });

  it('고친 칸만 이전 기록에 얹고 기준값을 건드리지 않는다', () => {
    const recovered = { a: '이전', b: '이전', c: '이전' };
    const baseline = { a: '', b: '', d: '기본' };
    expect(overlayLocalEdits(recovered, baseline, { a: '', b: '새 값', d: '기본' })).toEqual({ a: '이전', b: '새 값', c: '이전' });
    expect(overlayLocalEdits(recovered, baseline, { a: '', b: '' })).toEqual({ a: '이전', b: '이전', c: '이전' });
    expect(overlayLocalEdits(recovered, baseline, { a: '새 값', b: '', d: '기본' }, { a: ['b'], z: ['c'] })).toEqual({ a: '새 값', b: '', c: '이전' });
    expect(recovered).toEqual({ a: '이전', b: '이전', c: '이전' });
  });

  it('사람이 고치지 않은 변경만 기준값으로 옮기고 앞선 입력은 고친 칸으로 남긴다', () => {
    const baseline = { name: '', attributes: '', removed: '값' };
    const previous = { name: '입력', attributes: '', removed: '값' };
    expect(rebaseLocalEditBaseline(baseline, previous, { name: '입력', attributes: '초기화', removed: '값' })).toEqual({ name: '', attributes: '초기화', removed: '값' });
    expect(rebaseLocalEditBaseline(baseline, previous, { name: '입력', attributes: '' })).toEqual({ name: '', attributes: '' });
  });
});
