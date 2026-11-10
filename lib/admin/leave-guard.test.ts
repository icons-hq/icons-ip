import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_LEAVE_CONFIRM_MESSAGE,
  adminFormFingerprint,
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
  let confirm: ReturnType<typeof vi.fn>;
  let clear: (() => void)[];
  /* "방금 허락"은 모듈에 남는다. 테스트마다 시계를 충분히 밀어 앞 테스트의 허락이 넘어오지 않게 한다. */
  let now = Date.now();

  function click(link: ReturnType<typeof anchor> | null, modifiers: Partial<MouseEvent> = {}) {
    (document as unknown as { closest: () => unknown }).closest = () => link;
    const event = Object.assign(new Event('click', { cancelable: true }), { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers });
    const stopPropagation = vi.spyOn(event, 'stopPropagation');
    document.dispatchEvent(event);
    return { blocked: event.defaultPrevented, stopped: stopPropagation.mock.calls.length > 0 };
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
    confirm = vi.fn(() => true);
    now += 60_000;
    vi.useFakeTimers({ now });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm, location: { href: CURRENT } }));
    vi.stubGlobal('document', new EventTarget());
  });
  afterEach(() => {
    for (const release of clear) release();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('경고가 없으면 링크와 브라우저 닫기를 건드리지 않는다', () => {
    expect(click(anchor('/admin/cs/faq'))).toEqual({ blocked: false, stopped: false });
    expect(unload()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('취소하면 이벤트가 React까지 가지 않아 Link가 움직이지 않는다', () => {
    confirm.mockReturnValue(false);
    guard({ message: '정말요?' });
    expect(click(anchor('/admin/cs/faq'))).toEqual({ blocked: true, stopped: true });
    expect(confirm).toHaveBeenCalledWith('정말요?');
  });

  it('확인하면 이동을 그대로 둔다', () => {
    guard();
    expect(click(anchor('/admin/cs/faq'))).toEqual({ blocked: false, stopped: false });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('입력 폼이 여럿이어도 한 번만 묻는다', () => {
    guard({ message: '첫 번째' }); guard({ message: '두 번째' });
    click(anchor('/admin/cs/faq'));
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith('첫 번째');
  });

  it('저장 중인 폼이 있으면 묻지 않고 막는다', () => {
    guard(); guard({ blocked: true });
    expect(click(anchor('/admin/cs/faq')).blocked).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('같은 화면 앵커·수정키 클릭·이미 막힌 클릭은 묻지 않는다', () => {
    guard();
    expect(click(anchor('/admin/settings/store?section=business#x')).blocked).toBe(false);
    expect(click(anchor('/admin/cs/faq'), { metaKey: true }).blocked).toBe(false);
    expect(click(anchor('/admin/cs/faq'), { button: 1 }).blocked).toBe(false);
    expect(click(null).blocked).toBe(false);
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

  it('일반 a 태그로 방금 허락한 이동은 beforeunload에서 다시 묻지 않고, 시간이 지나면 다시 지킨다', () => {
    const onUnload = vi.fn();
    guard({ onUnload });
    click(anchor('/admin/cs/faq'));
    expect(unload()).toBe(false);
    expect(onUnload).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2_001);
    expect(unload()).toBe(true);
  });

  it('해제하면 리스너가 사라지고 마지막 경고까지 해제해야 끝난다', () => {
    const first = guard(), second = guard();
    first();
    expect(unload()).toBe(true);
    second();
    expect(unload()).toBe(false);
  });

  it('confirmAdminLeave는 등록된 경고가 있을 때만 묻는다', () => {
    expect(confirmAdminLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    guard();
    confirm.mockReturnValue(false);
    expect(confirmAdminLeave()).toBe(false);
    guard({ blocked: true });
    confirm.mockClear();
    expect(confirmAdminLeave()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
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
