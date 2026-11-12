import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from './confirm.test-support';
import { setAdminConfirmHandler } from './confirm';
import {
  ADMIN_LEAVE_CONFIRM_MESSAGE,
  adminFormFingerprint,
  adminFormRecoveryKey,
  adminLeaveWasJustConfirmed,
  isAdminRecoverableControl,
  restoreAdminFormRecovery,
  saveAdminFormRecovery,
  changesOnlyAdminQuery,
  confirmAdminLeave,
  createAdminFormTracker,
  leavesAdminPage,
  registerAdminLeaveGuard,
} from './leave-guard';

const CURRENT = 'https://iconsip.com/admin/settings/store?section=business';
type Attrs = { target?: string; download?: boolean };
const anchor = (href: string, { target = '', download = false }: Attrs = {}) => ({
  href: new URL(href, CURRENT).href,
  target,
  hasAttribute: (name: string) => name === 'download' && download,
});

describe('leavesAdminPage', () => {
  it.each([
    ['다른 메뉴', '/admin/cs/faq'],
    ['같은 화면의 다른 탭', '/admin/settings/store?section=branding'],
    ['쿼리를 지우는 링크', '/admin/settings/store'],
  ])('%s는 입력을 잃으므로 묻는다', (_label, href) => {
    expect(leavesAdminPage(anchor(href), CURRENT)).toBe(true);
  });

  it.each([
    ['같은 화면의 앵커', '/admin/settings/store?section=business#save', {}],
    ['새 창 링크', '/admin/cs/faq', { target: '_blank' }],
    ['파일 내려받기', '/api/admin/export', { download: true }],
    ['다른 사이트(beforeunload가 묻는다)', 'https://example.com/', {}],
  ] as const)('%s는 묻지 않는다', (_label, href, attrs) => {
    expect(leavesAdminPage(anchor(href, attrs), CURRENT)).toBe(false);
  });

  it('target=_self는 같은 창 이동이다', () => {
    expect(leavesAdminPage(anchor('/admin/cs/faq', { target: '_self' }), CURRENT)).toBe(true);
  });
});

describe('changesOnlyAdminQuery', () => {
  it.each([
    ['페이지 넘김', '/admin/settings/store?section=business&page=2'],
    ['쿼리를 지우는 링크', '/admin/settings/store'],
    ['검색어를 바꾸는 링크', '/admin/settings/store?q=a'],
  ])('%s는 쿼리만 바뀐다', (_label, href) => {
    expect(changesOnlyAdminQuery(anchor(href), CURRENT)).toBe(true);
  });

  it.each([
    ['다른 메뉴', '/admin/cs/faq'],
    ['다른 경로의 같은 쿼리', '/admin/cs/faq?section=business'],
    ['다른 사이트', 'https://example.com/admin/settings/store?page=2'],
    ['주소가 같은 링크', '/admin/settings/store?section=business'],
  ])('%s는 쿼리만 바뀌는 이동이 아니다', (_label, href) => {
    expect(changesOnlyAdminQuery(anchor(href), CURRENT)).toBe(false);
  });
});

describe('adminFormFingerprint', () => {
  const text = (name: string, value: string, type = 'text') => ({ name, value, type });
  const fingerprint = (elements: unknown[]) => adminFormFingerprint({ elements });

  it('값이 바뀌면 달라지고 되돌리면 같아진다', () => {
    const before = fingerprint([text('title', 'A')]);
    expect(fingerprint([text('title', 'B')])).not.toBe(before);
    expect(fingerprint([text('title', 'A')])).toBe(before);
  });

  it('체크박스·라디오는 켜진 값만 센다', () => {
    const off = { name: 'active', type: 'checkbox', value: 'true', checked: false };
    expect(fingerprint([off])).toBe('[]');
    expect(fingerprint([{ ...off, checked: true }])).toBe('[["active","true"]]');
    const left = { name: 'mode', type: 'radio', value: 'a', checked: true }, right = { name: 'mode', type: 'radio', value: 'b', checked: false };
    expect(fingerprint([left, right])).toBe('[["mode","a"]]');
  });

  it('행 순서가 바뀌면 다른 입력이다', () => {
    expect(fingerprint([text('row', 'a'), text('row', 'b')])).not.toBe(fingerprint([text('row', 'b'), text('row', 'a')]));
  });

  it('버튼·이름 없는 칸·fieldset·서버 액션 내부 필드·저장 시점 값은 입력이 아니다', () => {
    const noise = [
      { name: 'intent', type: 'submit', value: 'publish' },
      text('', 'unnamed'),
      { name: '', type: 'fieldset', value: '' },
      text('$ACTION_ID_abc', 'x', 'hidden'),
    ];
    expect(fingerprint([...noise, text('updatedAt', '2026-11-10T00:00:00Z', 'hidden')])).toBe('[]');
    expect(fingerprint([text('updatedAt', '2026-11-11T00:00:00Z', 'hidden')])).toBe('[]');
  });

  it('여러 값 선택과 파일 선택도 비교한다', () => {
    const select = (selected: boolean) => ({ name: 'grades', type: 'select-multiple', options: [{ value: 'a', selected: true }, { value: 'b', selected }] });
    expect(fingerprint([select(false)])).not.toBe(fingerprint([select(true)]));
    const file = { name: 'photo', type: 'file', files: [] as { name: string; size: number; lastModified: number }[] };
    expect(fingerprint([{ ...file, files: [{ name: 'a.png', size: 1, lastModified: 1 }] }])).not.toBe(fingerprint([file]));
  });

  it('값이 비어 있는 칸은 빈 문자열로 센다', () => {
    expect(fingerprint([{ name: 'memo', type: 'textarea' }])).toBe('[["memo",""]]');
  });
});

describe('registerAdminLeaveGuard', () => {
  let confirm: ReturnType<typeof stubAdminConfirm>;
  let clear: (() => void)[];
  /* "방금 허락"은 모듈에 남는다. 테스트마다 시계를 충분히 밀어 앞 테스트의 허락이 넘어오지 않게 한다. */
  let now = Date.now();
  const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

  /** 클릭을 보내고, 확인창 응답이 이어지도록 마이크로태스크를 비운 뒤 결과를 돌려준다. */
  async function click(link: (ReturnType<typeof anchor> & { click?: () => void }) | null, modifiers: Partial<MouseEvent> = {}) {
    const replay = vi.fn();
    const target = link && Object.assign(link, { click: replay });
    (document as unknown as { closest: () => unknown }).closest = () => target;
    const event = Object.assign(new Event('click', { cancelable: true }), { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers });
    const stopPropagation = vi.spyOn(event, 'stopPropagation');
    document.dispatchEvent(event);
    await flush();
    return { blocked: event.defaultPrevented, stopped: stopPropagation.mock.calls.length > 0, replayed: replay.mock.calls.length };
  }
  function unload() {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  const guard = (over: Partial<Parameters<typeof registerAdminLeaveGuard>[0]> = {}) => {
    const release = registerAdminLeaveGuard({ message: ADMIN_LEAVE_CONFIRM_MESSAGE, blocked: false, ...over });
    clear.push(release);
    return release;
  };

  beforeEach(() => {
    clear = [];
    confirm = stubAdminConfirm(true);
    now += 60_000;
    vi.useFakeTimers({ now });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { href: CURRENT } }));
    vi.stubGlobal('document', new EventTarget());
  });
  afterEach(() => {
    for (const release of clear) release();
    confirm.restore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('경고가 없으면 링크와 브라우저 닫기를 건드리지 않는다', async () => {
    expect(await click(anchor('/admin/cs/faq'))).toEqual({ blocked: false, stopped: false, replayed: 0 });
    expect(unload()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('취소하면 이벤트가 React까지 가지 않아 Link가 움직이지 않는다', async () => {
    confirm.mockReturnValue(false);
    guard({ message: '정말요?' });
    expect(await click(anchor('/admin/cs/faq'))).toEqual({ blocked: true, stopped: true, replayed: 0 });
    expect(confirm).toHaveBeenCalledWith('정말요?');
  });

  it('확인하기 전에는 이동이 시작되지 않고, 확인하면 같은 링크를 다시 눌러 이동을 잇는다', async () => {
    guard();
    const link = anchor('/admin/cs/faq');
    const replay = vi.fn();
    Object.assign(link, { click: replay });
    (document as unknown as { closest: () => unknown }).closest = () => link;
    const event = Object.assign(new Event('click', { cancelable: true }), { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
    let answer!: (ok: boolean) => void;
    confirm.restore();
    const gate = vi.fn<(request: unknown) => Promise<boolean>>(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    const restoreGate = setAdminConfirmHandler(async (request) => gate(request));
    document.dispatchEvent(event);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(replay).not.toHaveBeenCalled();
    answer(true);
    await flush();
    expect(replay).toHaveBeenCalledOnce();
    restoreGate();
  });

  it('다시 보낸 클릭은 묻지 않고 지나간다(확인창이 반복되지 않는다)', async () => {
    guard();
    const link = anchor('/admin/cs/faq');
    const second = Object.assign(new Event('click', { cancelable: true }), { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
    Object.assign(link, { click: () => document.dispatchEvent(second) });
    (document as unknown as { closest: () => unknown }).closest = () => link;
    const first = Object.assign(new Event('click', { cancelable: true }), { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
    document.dispatchEvent(first);
    await flush();
    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('같은 링크를 연달아 눌러도 확인창은 하나이고 이동도 한 번이다', async () => {
    guard();
    const link = anchor('/admin/cs/faq');
    const replay = vi.fn();
    Object.assign(link, { click: replay });
    (document as unknown as { closest: () => unknown }).closest = () => link;
    const press = () => document.dispatchEvent(Object.assign(new Event('click', { cancelable: true }), { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }));
    press(); press(); press();
    await flush();
    expect(confirm).toHaveBeenCalledOnce();
    expect(replay).toHaveBeenCalledOnce();
  });

  it('입력 폼이 여럿이어도 한 번만 묻는다', async () => {
    guard({ message: '첫 번째' }); guard({ message: '두 번째' });
    await click(anchor('/admin/cs/faq'));
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith('첫 번째');
  });

  it('저장 중인 폼이 있으면 묻지 않고 막는다', async () => {
    guard(); guard({ blocked: true });
    expect((await click(anchor('/admin/cs/faq'))).blocked).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('같은 화면 앵커·수정키 클릭·이미 막힌 클릭은 묻지 않는다', async () => {
    guard();
    expect((await click(anchor('/admin/settings/store?section=business#x'))).blocked).toBe(false);
    expect((await click(anchor('/admin/cs/faq'), { metaKey: true })).blocked).toBe(false);
    expect((await click(anchor('/admin/cs/faq'), { button: 1 })).blocked).toBe(false);
    expect((await click(null)).blocked).toBe(false);
    const already = Object.assign(new Event('click', { cancelable: true }), { button: 0 });
    already.preventDefault();
    (document as unknown as { closest: () => unknown }).closest = () => anchor('/admin/cs/faq');
    document.dispatchEvent(already);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('브라우저 닫기에는 경고를 띄우고 복구 기록을 먼저 쓴다', () => {
    const onUnload = vi.fn();
    guard({ onUnload });
    expect(unload()).toBe(true);
    expect(onUnload).toHaveBeenCalledOnce();
  });

  it('일반 a 태그로 방금 허락한 이동은 beforeunload에서 다시 묻지 않고, 시간이 지나면 다시 지킨다', async () => {
    const onUnload = vi.fn();
    guard({ onUnload });
    await click(anchor('/admin/cs/faq'));
    expect(unload()).toBe(false);
    expect(adminLeaveWasJustConfirmed()).toBe(true);
    expect(onUnload).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2_001);
    expect(unload()).toBe(true);
    expect(adminLeaveWasJustConfirmed()).toBe(false);
  });

  it('해제하면 리스너가 사라지고 마지막 경고까지 해제해야 끝난다', () => {
    const first = guard(), second = guard();
    first();
    expect(unload()).toBe(true);
    second();
    expect(unload()).toBe(false);
  });

  /* 2차 사람 눈 시험(2026-11-10): ERP 품목의 페이지 넘김에 "고른 연결이 사라집니다"가 떴지만 값은 그대로 남았다. */
  describe('쿼리만 바뀌어도 입력이 남는 화면', () => {
    const NEXT_PAGE = '/admin/settings/store?section=business&page=2';

    it('쿼리만 바뀌는 링크에는 묻지 않는다', async () => {
      guard({ survivesQueryChange: true });
      expect((await click(anchor(NEXT_PAGE))).blocked).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('다른 화면으로 가는 링크에는 그대로 묻는다', async () => {
      guard({ survivesQueryChange: true });
      confirm.mockReturnValue(false);
      expect((await click(anchor('/admin/cs/faq'))).blocked).toBe(true);
      expect(confirm).toHaveBeenCalledOnce();
    });

    it('옵션을 켜지 않은 화면은 쿼리만 바뀌어도 그대로 묻는다', async () => {
      guard();
      confirm.mockReturnValue(false);
      expect((await click(anchor(NEXT_PAGE))).blocked).toBe(true);
      expect(confirm).toHaveBeenCalledOnce();
    });

    it('한 화면에 옵션 없는 경고가 함께 있으면 그 경고로 묻는다', async () => {
      guard({ survivesQueryChange: true, message: '남는 입력' });
      guard({ message: '사라지는 입력' });
      confirm.mockReturnValue(false);
      expect((await click(anchor(NEXT_PAGE))).blocked).toBe(true);
      expect(confirm).toHaveBeenCalledExactlyOnceWith('사라지는 입력');
    });

    it('페이지가 통째로 내려가는 이동(beforeunload)과 링크 아닌 이탈은 그대로 지킨다', async () => {
      guard({ survivesQueryChange: true });
      expect(unload()).toBe(true);
      confirm.mockReturnValue(false);
      expect(await confirmAdminLeave()).toBe(false);
      expect(confirm).toHaveBeenCalledOnce();
    });
  });

  it('confirmAdminLeave는 등록된 경고가 있을 때만 묻는다', async () => {
    expect(await confirmAdminLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    guard();
    confirm.mockReturnValue(false);
    expect(await confirmAdminLeave()).toBe(false);
    guard({ blocked: true });
    confirm.mockClear();
    expect(await confirmAdminLeave()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('확인창 호스트가 없으면 이동을 허락하지 않는다', async () => {
    guard();
    confirm.restore();
    expect((await click(anchor('/admin/cs/faq'))).replayed).toBe(0);
    expect(await confirmAdminLeave()).toBe(false);
  });
});

describe('createAdminFormTracker', () => {
  class FakeForm extends EventTarget {
    elements: { name: string; type: string; value: string }[];
    constructor(value: string) { super(); this.elements = [{ name: 'title', type: 'text', value }]; }
    get value() { return this.elements[0].value; }
    set value(next: string) { this.elements[0].value = next; }
    type(next: string) { this.value = next; this.dispatchEvent(new Event('input')); vi.runAllTimers(); }
    submit() { this.dispatchEvent(new Event('submit')); }
  }
  const asForm = (form: FakeForm) => form as unknown as HTMLFormElement;
  let mutate: () => void;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    disconnect = vi.fn();
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { mutate = callback; }
      observe() {}
      disconnect = disconnect;
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  function tracked(value = 'A') {
    const onDirty = vi.fn();
    const tracker = createAdminFormTracker(onDirty);
    const form = new FakeForm(value);
    const detach = tracker.attach(asForm(form));
    return { onDirty, tracker, form, detach, last: () => onDirty.mock.lastCall?.[0] as boolean };
  }

  it('처음 값과 다르면 미저장이고 되돌리면 깨끗하다', () => {
    const { form, last } = tracked();
    expect(last()).toBe(false);
    form.type('B');
    expect(last()).toBe(true);
    form.type('A');
    expect(last()).toBe(false);
  });

  it('입력·숨은 값 변경이 몰려도 이벤트가 끝난 뒤 한 번만 읽는다', () => {
    const { form, onDirty } = tracked();
    onDirty.mockClear();
    form.value = 'B';
    form.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('change'));
    mutate();
    expect(onDirty).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onDirty.mock.calls).toEqual([[true]]);
  });

  it('숨은 값·입력 칸이 바뀌면(사진 선택·행 추가) 미저장이다', () => {
    const { form, last } = tracked();
    form.elements.push({ name: 'imagePath', type: 'hidden', value: 'a.png' });
    mutate();
    vi.runAllTimers();
    expect(last()).toBe(true);
  });

  it('저장에 성공하면 지금 값이 새 기준이다', () => {
    const { form, tracker, last } = tracked();
    tracker.noteServerResult({});
    form.type('B');
    form.submit();
    tracker.noteServerResult({ message: '저장했습니다.' });
    vi.runAllTimers();
    expect(last()).toBe(false);
    form.type('A');
    expect(last()).toBe(true);
  });

  it('저장에 실패하면 입력이 그대로 미저장이다', () => {
    const { form, tracker, last } = tracked();
    tracker.noteServerResult({});
    form.type('B');
    form.submit();
    tracker.noteServerResult({ errors: { form: '실패' }, message: '실패' });
    vi.runAllTimers();
    expect(last()).toBe(true);
  });

  it('폼이 초기화돼 처음 값으로 돌아가면 깨끗하다', () => {
    const { form, last } = tracked();
    form.type('B');
    expect(last()).toBe(true);
    form.value = 'A';
    form.dispatchEvent(new Event('reset'));
    vi.runAllTimers();
    expect(last()).toBe(false);
  });

  it('제출한 적 없는 서버 상태 변화로는 기준을 옮기지 않는다', () => {
    const { form, tracker, last } = tracked();
    tracker.noteServerResult({});
    form.type('B');
    tracker.noteServerResult({ message: '다른 레코드의 성공' });
    vi.runAllTimers();
    expect(last()).toBe(true);
  });

  it('폼이 새로 만들어지면 새 폼을 기준으로 다시 잡고 옛 폼을 놓는다', () => {
    const { form, tracker, detach, last } = tracked();
    form.type('B');
    expect(last()).toBe(true);
    detach?.();
    expect(disconnect).toHaveBeenCalledOnce();
    tracker.attach(asForm(new FakeForm('다른 레코드')));
    expect(last()).toBe(false);
    /* 옛 폼의 이벤트는 더 이상 읽지 않는다. */
    form.dispatchEvent(new Event('input'));
    vi.runAllTimers();
    expect(last()).toBe(false);
  });

  it('null은 무시한다', () => {
    const { tracker } = tracked();
    expect(tracker.attach(null)).toBeUndefined();
  });
});

describe('뒤로 가기 복구(sessionStorage)', () => {
  const store = new Map<string, string>();
  const text = (name: string, value: string, extra: Record<string, unknown> = {}) => ({ name, type: 'text', value, ...extra });
  const form = (elements: unknown[]) => ({ elements, id: 'faq' });
  const LOC = { pathname: '/admin/cs/faq', search: '?page=1' };
  const key = () => adminFormRecoveryKey(LOC, { id: 'faq' }, 0);

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('sessionStorage', {
      getItem: (name: string) => store.get(name) ?? null,
      setItem: (name: string, value: string) => { store.set(name, value); },
      removeItem: (name: string) => { store.delete(name); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('민감 입력(비밀번호·계좌·카드·인증 코드·파일·숨은 값)은 보관 대상이 아니다', () => {
    for (const control of [
      { name: 'pw', type: 'password', value: 'x' },
      { name: 'refundAccountNumber', type: 'text', value: '110' },
      { name: 'bankAccount', type: 'text', value: '110' },
      { name: 'cardNumber', type: 'text', value: '4000' },
      { name: 'otpCode', type: 'text', value: '123456' },
      { name: 'verificationCode', type: 'text', value: '123456', autocomplete: 'one-time-code' },
      { name: 'payer', type: 'text', value: 'a', autocomplete: 'cc-name' },
      { name: 'excelPassword', type: 'text', value: 'x' },
      { name: 'photo', type: 'file' },
      { name: 'updatedAt', type: 'hidden', value: 'x' },
      { name: 'goodId', type: 'hidden', value: 'x' },
      { name: 'locked', type: 'text', value: 'x', readOnly: true },
      { name: 'off', type: 'text', value: 'x', getAttribute: (attr: string) => (attr === 'data-admin-recover' ? 'off' : null) },
    ]) expect(isAdminRecoverableControl(control), String(control.name)).toBe(false);
    for (const control of [text('title', 'A'), text('sellerGoodsCode', 'SKU-1'), { name: 'body', type: 'textarea', value: '' }]) {
      expect(isAdminRecoverableControl(control), control.name).toBe(true);
    }
  });

  it('입력을 바꾼 폼만 보관하고, 같은 값이면 기록을 지운다', () => {
    const base = adminFormFingerprint(form([text('title', 'A')]));
    saveAdminFormRecovery(key(), form([text('title', 'A')]), base);
    expect(store.size).toBe(0);
    saveAdminFormRecovery(key(), form([text('title', '고친 제목')]), base);
    expect(store.size).toBe(1);
    saveAdminFormRecovery(key(), form([text('title', 'A')]), base);
    expect(store.size).toBe(0);
  });

  it('보관한 값에는 민감 입력이 들어가지 않는다', () => {
    const elements = [text('title', '고친 제목'), { name: 'refundAccountNumber', type: 'text', value: '110-123-456789' }, { name: 'pw', type: 'password', value: 'secret-pw' }];
    saveAdminFormRecovery(key(), form(elements), adminFormFingerprint(form([text('title', 'A')])));
    const raw = [...store.values()][0];
    expect(raw).toContain('고친 제목');
    expect(raw).not.toContain('110-123-456789');
    expect(raw).not.toContain('secret-pw');
    expect(raw).not.toContain('refundAccountNumber');
  });

  it('돌아오면 같은 자리의 입력에 값을 되살리고 입력 이벤트를 보낸다(한 번만)', () => {
    const base = adminFormFingerprint(form([text('title', 'A'), { name: 'refundAccountNumber', type: 'text', value: '' }]));
    saveAdminFormRecovery(key(), form([text('title', '고친 제목'), { name: 'refundAccountNumber', type: 'text', value: '110-123' }]), base);
    const dispatched: string[] = [];
    const title = text('title', 'A', { dispatchEvent: (event: Event) => { dispatched.push(event.type); return true; } });
    const account = { name: 'refundAccountNumber', type: 'text', value: '', dispatchEvent: () => true };
    expect(restoreAdminFormRecovery(key(), form([title, account]))).toBe(1);
    expect(title.value).toBe('고친 제목');
    expect(account.value).toBe('');
    expect(dispatched).toEqual(['input', 'change']);
    expect(store.size).toBe(0);
    expect(restoreAdminFormRecovery(key(), form([title, account]))).toBe(0);
  });

  it('체크박스는 click으로 되돌려 React가 알게 한다', () => {
    const base = adminFormFingerprint(form([{ name: 'on', type: 'checkbox', value: 'y', checked: false }]));
    saveAdminFormRecovery(key(), form([{ name: 'on', type: 'checkbox', value: 'y', checked: true }]), base);
    const click = vi.fn();
    expect(restoreAdminFormRecovery(key(), form([{ name: 'on', type: 'checkbox', value: 'y', checked: false, click }]))).toBe(1);
    expect(click).toHaveBeenCalledOnce();
  });

  it('1시간이 지났거나 폼 구성이 달라졌으면 되살리지 않는다', () => {
    const base = adminFormFingerprint(form([text('title', 'A')]));
    saveAdminFormRecovery(key(), form([text('title', 'B')]), base, 1_000);
    expect(restoreAdminFormRecovery(key(), form([text('title', 'A')]), 1_000 + 61 * 60 * 1000)).toBe(0);
    saveAdminFormRecovery(key(), form([text('title', 'B')]), base);
    expect(restoreAdminFormRecovery(key(), form([text('other', 'A')]))).toBe(0);
  });

  it('저장소를 못 쓰는 환경에서도 던지지 않는다', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    expect(() => saveAdminFormRecovery(key(), form([text('title', 'B')]), '[]')).not.toThrow();
    expect(restoreAdminFormRecovery(key(), form([text('title', 'B')]))).toBe(0);
  });

  it('폼 안에 name="id" 입력이 있어도(form.id가 요소를 돌려줘도) 키는 문자열이다', () => {
    const element = { tagName: 'INPUT' };
    const key = adminFormRecoveryKey(LOC, { id: element, getAttribute: (attr: string) => (attr === 'id' ? null : null) }, 2);
    expect(key).toBe('admin-form-recovery:/admin/cs/faq?page=1|#2');
    expect(adminFormRecoveryKey(LOC, { id: element, getAttribute: (attr: string) => (attr === 'id' ? 'faq-form' : null) }, 2)).toBe('admin-form-recovery:/admin/cs/faq?page=1|faq-form');
  });

  it('주소(경로+쿼리)와 폼 자리가 다르면 다른 키다', () => {
    expect(adminFormRecoveryKey(LOC, { id: 'faq' }, 0)).not.toBe(adminFormRecoveryKey({ ...LOC, search: '?page=2' }, { id: 'faq' }, 0));
    expect(adminFormRecoveryKey(LOC, {}, 0)).not.toBe(adminFormRecoveryKey(LOC, {}, 1));
  });
});

describe('조회 조건은 변경 있음으로 세지 않는다', () => {
  it('검색 칸·data-admin-query 칸이 바뀌어도 지문이 같다', () => {
    const save = [{ name: 'title', type: 'text', value: 'A' }];
    const withQuery = (q: string, from: string) => [...save, { name: 'q', type: 'search', value: q }, { name: 'from', type: 'date', value: from, getAttribute: (attr: string) => (attr === 'data-admin-query' ? '' : null) }];
    expect(adminFormFingerprint({ elements: withQuery('a', '2026-01-01') })).toBe(adminFormFingerprint({ elements: withQuery('b', '2026-02-01') }));
    expect(adminFormFingerprint({ elements: withQuery('a', '2026-01-01') })).toBe(adminFormFingerprint({ elements: save }));
  });
});

describe('createAdminFormTracker — 뒤로 가기 복구', () => {
  class FakeForm extends EventTarget {
    id = 'faq';
    isConnected = true;
    elements: { name: string; type: string; value: string; dispatchEvent?: (event: Event) => boolean }[];
    constructor(...values: [string, string, string?][]) {
      super();
      this.elements = values.map(([name, value, type = 'text']) => ({ name, type, value, dispatchEvent: () => true }));
    }
  }
  const asForm = (form: FakeForm) => form as unknown as HTMLFormElement;
  const store = new Map<string, string>();
  let location: { pathname: string; search: string };

  beforeEach(() => {
    store.clear();
    location = { pathname: '/admin/cs/faq', search: '' };
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    vi.stubGlobal('window', { get location() { return location; } });
    vi.stubGlobal('document', { forms: [] as unknown[] });
    vi.stubGlobal('sessionStorage', {
      getItem: (name: string) => store.get(name) ?? null,
      setItem: (name: string, value: string) => { store.set(name, value); },
      removeItem: (name: string) => { store.delete(name); },
    });
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('다른 화면으로 떠난 미저장 폼은 보관하고, 돌아오면 입력을 되살려 미저장으로 잡는다', () => {
    const away = new FakeForm(['title', 'A'], ['refundAccountNumber', '']);
    const detachAway = createAdminFormTracker(vi.fn()).attach(asForm(away))!;
    away.elements[0].value = '고친 제목';
    away.elements[1].value = '110-123-456789';
    location = { pathname: '/admin/cs/reviews', search: '' };
    detachAway();
    expect(store.size).toBe(1);
    expect([...store.values()][0]).not.toContain('110-123-456789');

    location = { pathname: '/admin/cs/faq', search: '' };
    const onDirty = vi.fn();
    const back = new FakeForm(['title', 'A'], ['refundAccountNumber', '']);
    createAdminFormTracker(onDirty).attach(asForm(back));
    vi.runAllTimers();
    expect(back.elements[0].value).toBe('고친 제목');
    expect(back.elements[1].value).toBe('');
    expect(onDirty).toHaveBeenLastCalledWith(true);
  });

  it('같은 화면 안에서 접히며 사라지는 폼은 보관하지 않는다', () => {
    const form = new FakeForm(['title', 'A']);
    const detach = createAdminFormTracker(vi.fn()).attach(asForm(form))!;
    form.elements[0].value = '고친 제목';
    detach();
    expect(store.size).toBe(0);
  });

  it('운영자가 확인창에서 이동을 눌러 입력을 버린 경우에는 보관하지 않는다', async () => {
    const { registerAdminLeaveGuard } = await import('./leave-guard');
    const { stubAdminConfirm } = await import('./confirm.test-support');
    const confirm = stubAdminConfirm(true);
    vi.stubGlobal('window', Object.assign(new EventTarget(), { get location() { return location; } }));
    vi.stubGlobal('document', Object.assign(new EventTarget(), { forms: [] as unknown[] }));
    const release = registerAdminLeaveGuard({ message: '이동할까요?', blocked: false });
    const { confirmAdminLeave } = await import('./leave-guard');
    expect(await confirmAdminLeave()).toBe(true);
    const form = new FakeForm(['title', 'A']);
    const detach = createAdminFormTracker(vi.fn()).attach(asForm(form))!;
    form.elements[0].value = '버릴 입력';
    location = { pathname: '/admin/cs/reviews', search: '' };
    detach();
    expect(store.size).toBe(0);
    release();
    confirm.restore();
  });

  it('recover=false인 화면은 보관도 복구도 하지 않는다', () => {
    const form = new FakeForm(['title', 'A']);
    const detach = createAdminFormTracker(vi.fn(), { recover: false }).attach(asForm(form))!;
    form.elements[0].value = '고친 제목';
    location = { pathname: '/admin/cs/reviews', search: '' };
    detach();
    expect(store.size).toBe(0);
  });
});
