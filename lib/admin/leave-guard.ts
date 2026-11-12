import { adminConfirm } from './confirm';

/*
 * 어드민 입력 화면의 이탈 경고.
 *
 * App Router에는 이동을 막는 공식 API가 없어 두 갈래로 묻는다.
 * - 링크 이동(사이드바·상단 막대·화면 안의 Next Link): document 캡처 단계에서 클릭을 먼저 받는다.
 *   취소하면 이벤트가 React까지 가지 않아 Link가 이동을 시작하지 않는다.
 * - 페이지가 통째로 내려가는 이동(브라우저 닫기·새로고침·주소 입력·다른 사이트): beforeunload.
 *
 * 브라우저 뒤로 가기는 막지 못한다. App Router가 주소를 바꾼 뒤에야 알 수 있어서다. 대신 비제어 입력 폼의 값을
 * sessionStorage에 보관했다가 돌아오면 되살린다(`saveAdminFormRecovery`·`restoreAdminFormRecovery`).
 * 비밀번호·계좌·카드·인증 코드 같은 민감 입력은 보관하지 않고, 탭을 닫으면 보관한 값도 사라진다.
 *
 * 확인창은 어드민 공용 AlertDialog(`adminConfirm`)다. 클릭을 먼저 멈춘 뒤 확인하면 같은 링크를 다시 눌러 이동을 잇는다.
 *
 * 화면에는 입력 폼이 여럿일 수 있다(FAQ 목록은 줄마다 폼이다). 한 번의 클릭에 확인창이 폼 수만큼
 * 뜨지 않도록 리스너는 모듈에 하나만 두고, 화면은 미저장 상태일 때만 경고를 등록한다.
 */

export const ADMIN_LEAVE_CONFIRM_MESSAGE = '저장하지 않은 변경이 있습니다. 이 화면을 떠나면 입력이 사라집니다. 이동할까요?';
/** 브라우저에 복구 기록을 남기는 폼(상품·IP). 입력이 사라진다고 단정하지 않는다. */
export const ADMIN_LEAVE_RECOVERABLE_MESSAGE = '저장하지 않은 변경사항이 있습니다. 이 화면을 떠나시겠습니까?';

/** 일반 a 태그는 확인을 받은 뒤 페이지가 내려가며 beforeunload가 이어진다. 방금 허락한 이동을 다시 묻지 않는 시간. */
const CONFIRMED_LEAVE_GRACE_MS = 2_000;

export interface AdminLeaveGuard {
  message: string;
  /** 저장 요청이 끝나지 않아 지금 떠나면 결과를 잃는 상태. 묻지 않고 이동을 막는다. */
  blocked: boolean;
  /** 페이지가 내려가기 직전에 브라우저 복구 기록을 바로 쓴다. */
  onUnload?: () => void;
  /** 같은 경로에서 쿼리만 바뀌어도 입력이 남는 화면이다. 그런 링크(페이지 넘김·검색)에는 묻지 않는다. */
  survivesQueryChange?: boolean;
}

type LeaveAnchor = Pick<HTMLAnchorElement, 'href' | 'target' | 'hasAttribute'>;

/** 이 링크를 따라가면 지금 화면의 입력을 잃는가. 새 창·다운로드·같은 화면의 앵커는 입력을 잃지 않는다. */
export function leavesAdminPage(anchor: LeaveAnchor, currentHref: string): boolean {
  if (anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return false;
  const current = new URL(currentHref);
  const destination = new URL(anchor.href, current);
  /* 다른 사이트로 가면 페이지가 통째로 내려가 beforeunload가 묻는다. 여기서 또 묻지 않는다. */
  if (destination.origin !== current.origin) return false;
  return destination.pathname !== current.pathname || destination.search !== current.search;
}

/** 같은 사이트·같은 경로에서 쿼리만 바뀌는 링크인가. */
export function changesOnlyAdminQuery(anchor: Pick<LeaveAnchor, 'href'>, currentHref: string): boolean {
  const current = new URL(currentHref);
  const destination = new URL(anchor.href, current);
  return destination.origin === current.origin && destination.pathname === current.pathname && destination.search !== current.search;
}

const guards = new Set<AdminLeaveGuard>();
let bound: { win: Window; doc: Document } | null = null;
let leaveConfirmedAt = Number.NEGATIVE_INFINITY;

/** 확인창이 떠 있는 동안 같은 확인을 또 띄우지 않는다. */
let asking: Promise<boolean> | null = null;
/** 확인을 받은 뒤 다시 보내는 클릭은 묻지 않고 통과시킨다. */
let replayingAnchor: unknown = null;

function askLeave(message: string): Promise<boolean> {
  asking ??= adminConfirm({ message, title: '화면 이동', confirmLabel: '이동', cancelLabel: '머무르기', destructive: true })
    .then((ok) => { if (ok) leaveConfirmedAt = Date.now(); return ok; })
    .finally(() => { asking = null; });
  return asking;
}

/** 방금 운영자가 '이동'을 눌렀는가. 이때 떠나는 폼은 입력이 사라지는 것에 동의한 것이라 복구용으로 보관하지 않는다. */
export function adminLeaveWasJustConfirmed(): boolean {
  return Date.now() - leaveConfirmedAt < CONFIRMED_LEAVE_GRACE_MS;
}

/**
 * 링크가 아닌 이탈(로그아웃·router.push 등)에도 같은 확인을 쓴다. 등록된 경고가 없으면 묻지 않고 true.
 * 저장 요청이 끝나지 않은(blocked) 화면이 있으면 묻지 않고 false.
 */
export function confirmAdminLeave(): Promise<boolean> {
  const active = [...guards];
  if (!active.length) return Promise.resolve(true);
  if (active.some((guard) => guard.blocked)) return Promise.resolve(false);
  return askLeave(active[0].message);
}

function handleClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Partial<Element> | null)?.closest?.('a[href]') as LeaveAnchor | null | undefined;
  if (!anchor || anchor === replayingAnchor || !leavesAdminPage(anchor, window.location.href)) return;
  const queryOnly = changesOnlyAdminQuery(anchor, window.location.href);
  const active = [...guards].filter((guard) => !(queryOnly && guard.survivesQueryChange));
  if (!active.length) return;
  /* 확인을 받기 전에는 이동이 시작되지 않게 클릭을 먼저 멈춘다. */
  event.preventDefault();
  event.stopPropagation();
  /* 확인창이 이미 떠 있으면 이 클릭은 버린다. 같은 이동이 두 번 이어지지 않는다. */
  if (active.some((guard) => guard.blocked) || asking) return;
  void askLeave(active[0].message).then((ok) => {
    if (!ok) return;
    replayingAnchor = anchor;
    try { (anchor as unknown as HTMLElement).click(); } finally { replayingAnchor = null; }
  });
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  for (const guard of guards) guard.onUnload?.();
  if (Date.now() - leaveConfirmedAt < CONFIRMED_LEAVE_GRACE_MS) return;
  event.preventDefault();
  event.returnValue = '';
}

/** 미저장 상태인 동안만 등록한다. 돌려준 함수로 해제한다. */
export function registerAdminLeaveGuard(guard: AdminLeaveGuard): () => void {
  guards.add(guard);
  if (!bound) {
    bound = { win: window, doc: document };
    bound.win.addEventListener('beforeunload', handleBeforeUnload);
    bound.doc.addEventListener('click', handleClick, true);
  }
  return () => {
    guards.delete(guard);
    if (guards.size || !bound) return;
    bound.win.removeEventListener('beforeunload', handleBeforeUnload);
    bound.doc.removeEventListener('click', handleClick, true);
    bound = null;
  };
}

/** 같은 입력인데 저장 시점만 바뀌는 숨은 값. 다른 저장·재조회로 바뀌어도 운영자의 입력이 아니다. */
const VERSION_FIELDS: ReadonlySet<string> = new Set(['updatedAt']);
const NON_VALUE_CONTROLS: ReadonlySet<string> = new Set(['button', 'submit', 'reset', 'image', 'fieldset', 'object', 'output']);

interface FormControl {
  name?: string;
  type?: string;
  value?: string;
  checked?: boolean;
  files?: ArrayLike<{ name: string; size: number; lastModified: number }> | null;
  options?: ArrayLike<{ value: string; selected: boolean }>;
  getAttribute?: (name: string) => string | null;
}

/** 조회 조건(검색 칸·날짜 범위·필터)은 저장할 입력이 아니다. 같은 폼 안에 있어도 '변경 있음'으로 세지 않는다. */
function isQueryControl(control: FormControl): boolean {
  return control.type === 'search' || control.getAttribute?.('data-admin-query') !== undefined && control.getAttribute?.('data-admin-query') !== null;
}

/**
 * 운영자가 보는 입력값의 지문.
 * FormData를 쓰지 않는다 — 저장 중에 fieldset이 잠기면 FormData에서 값이 통째로 빠져 입력이 바뀐 것처럼 보인다.
 */
export function adminFormFingerprint(form: { elements: ArrayLike<unknown> }): string {
  const entries: [string, string][] = [];
  for (const control of Array.from(form.elements) as FormControl[]) {
    const { name = '', type = '' } = control;
    /* $ACTION_*은 Next가 서버 액션 폼에 심는 내부 필드다. */
    if (!name || name.startsWith('$ACTION') || VERSION_FIELDS.has(name) || NON_VALUE_CONTROLS.has(type) || isQueryControl(control)) continue;
    if ((type === 'checkbox' || type === 'radio') && !control.checked) continue;
    if (type === 'file') entries.push([name, Array.from(control.files ?? [], (file) => `${file.name}:${file.size}:${file.lastModified}`).join('|')]);
    else if (type === 'select-multiple') entries.push([name, Array.from(control.options ?? []).filter((option) => option.selected).map((option) => option.value).join('|')]);
    else entries.push([name, control.value ?? '']);
  }
  return JSON.stringify(entries);
}

/* ---- 뒤로 가기 복구(sessionStorage) ---- */

const RECOVERY_PREFIX = 'admin-form-recovery:';
const RECOVERY_TTL_MS = 60 * 60 * 1000;
/** 이 이름·자동완성 힌트의 입력은 보관하지 않는다. 지나치게 넓게 잡는 쪽이 안전하다. */
const SENSITIVE_NAME = /password|passwd|passcode|pwd|secret|token|otp|cvc|cvv|card|account|bank|iban|swift|ssn|jumin|resident|passport|증빙|계좌|카드|비밀|인증|주민|여권/i;
const SENSITIVE_AUTOCOMPLETE = /password|cc-|one-time-code|bank/i;
const NEVER_RECOVERED_TYPES: ReadonlySet<string> = new Set(['password', 'file', 'hidden', 'button', 'submit', 'reset', 'image']);

interface RecoverableControl extends FormControl {
  disabled?: boolean;
  readOnly?: boolean;
  autocomplete?: string;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
  dispatchEvent?: (event: Event) => boolean;
  click?: () => void;
}

/** 복구용으로 보관해도 되는 입력인가. 민감 입력·파일·숨은 값은 보관하지 않는다. */
export function isAdminRecoverableControl(control: RecoverableControl): boolean {
  const { name = '', type = '' } = control;
  if (!name || name.startsWith('$ACTION') || VERSION_FIELDS.has(name) || isQueryControl(control)) return false;
  if (NEVER_RECOVERED_TYPES.has(type) || NON_VALUE_CONTROLS.has(type) || control.disabled || control.readOnly) return false;
  if (SENSITIVE_NAME.test(name)) return false;
  const autocomplete = control.autocomplete ?? control.getAttribute?.('autocomplete') ?? '';
  if (SENSITIVE_AUTOCOMPLETE.test(autocomplete)) return false;
  if (control.getAttribute?.('data-admin-recover') === 'off' || control.closest?.('[data-admin-recover="off"]')) return false;
  return true;
}

interface RecoveredValue { i: number; name: string; type: string; value?: string; checked?: boolean }

function recoveryStorage(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/** 같은 화면의 같은 폼을 가리키는 키. 주소(경로+쿼리)와 폼 자리로 정한다. */
export function adminFormRecoveryKey(location: { pathname: string; search: string }, form: { id?: unknown; getAttribute?: (name: string) => string | null }, slot: number): string {
  /* 폼 안에 name="id" 입력이 있으면 form.id는 그 입력 요소를 돌려준다. 문자열일 때만 쓰고 아니면 속성을 읽는다. */
  const id = (typeof form.id === 'string' ? form.id : form.getAttribute?.('id')) || form.getAttribute?.('name') || `#${slot}`;
  return `${RECOVERY_PREFIX}${location.pathname}${location.search}|${id}`;
}

/** 입력 폼의 값을 sessionStorage에 보관한다. 보관할 값이 하나도 없으면 기록을 지운다. */
export function saveAdminFormRecovery(key: string, form: { elements: ArrayLike<unknown> }, baseline: string | null, now = Date.now()) {
  const storage = recoveryStorage();
  if (!storage) return;
  if (adminFormFingerprint(form) === baseline) { try { storage.removeItem(key); } catch { /* 보관 실패는 복구 기능만 잃는다. */ } return; }
  const values: RecoveredValue[] = [];
  (Array.from(form.elements) as RecoverableControl[]).forEach((control, i) => {
    if (!isAdminRecoverableControl(control)) return;
    const type = control.type ?? '';
    if (type === 'checkbox' || type === 'radio') values.push({ i, name: control.name ?? '', type, checked: Boolean(control.checked) });
    else if (type === 'select-multiple') values.push({ i, name: control.name ?? '', type, value: Array.from(control.options ?? []).filter((option) => option.selected).map((option) => option.value).join('\u0000') });
    else values.push({ i, name: control.name ?? '', type, value: control.value ?? '' });
  });
  try { storage.setItem(key, JSON.stringify({ at: now, values })); } catch { /* 용량 초과·차단: 복구만 못 한다. */ }
}

const nativeValueSetters = new Map<unknown, ((this: unknown, value: string) => void) | undefined>();
function setNativeValue(control: RecoverableControl, value: string) {
  const proto = Object.getPrototypeOf(control) as object | null;
  if (!nativeValueSetters.has(proto)) nativeValueSetters.set(proto, proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : undefined);
  const setter = nativeValueSetters.get(proto);
  if (setter) setter.call(control, value); else control.value = value;
}

/** 보관한 값을 같은 자리의 입력에 되돌린다. 값이 바뀌면 React가 알도록 입력 이벤트를 보낸다. 돌려주는 값은 복구한 입력 수. */
export function restoreAdminFormRecovery(key: string, form: { elements: ArrayLike<unknown> }, now = Date.now()): number {
  const storage = recoveryStorage();
  if (!storage) return 0;
  let raw: string | null = null;
  try { raw = storage.getItem(key); storage.removeItem(key); } catch { return 0; }
  if (!raw) return 0;
  let saved: { at?: number; values?: RecoveredValue[] };
  try { saved = JSON.parse(raw) as typeof saved; } catch { return 0; }
  if (typeof saved.at !== 'number' || now - saved.at > RECOVERY_TTL_MS || !Array.isArray(saved.values)) return 0;
  const controls = Array.from(form.elements) as RecoverableControl[];
  let restored = 0;
  for (const entry of saved.values) {
    const control = controls[entry.i];
    /* 폼 구성이 달라졌거나(이름·종류 불일치) 민감 입력이면 건드리지 않는다. */
    if (!control || control.name !== entry.name || control.type !== entry.type || !isAdminRecoverableControl(control)) continue;
    if (entry.type === 'checkbox' || entry.type === 'radio') {
      /* click()이 체크 상태와 React의 onChange를 함께 바꾼다. 라디오는 같은 이름의 다른 칸이 알아서 풀린다. */
      if (Boolean(control.checked) !== Boolean(entry.checked)) { control.click?.(); restored += 1; }
    } else if (entry.type === 'select-multiple') {
      const wanted = new Set((entry.value ?? '').split('\u0000'));
      for (const option of Array.from(control.options ?? [])) option.selected = wanted.has(option.value);
      control.dispatchEvent?.(new Event('change', { bubbles: true }));
      restored += 1;
    } else if (control.value !== entry.value) {
      setNativeValue(control, entry.value ?? '');
      control.dispatchEvent?.(new Event('input', { bubbles: true }));
      control.dispatchEvent?.(new Event('change', { bubbles: true }));
      restored += 1;
    }
  }
  return restored;
}

/** `useActionState` 결과 중 저장 성공 판정에 쓰는 부분. */
export interface AdminSaveResult {
  message?: string;
  errors?: unknown;
}

/** 저장이 끝난 입력을 새 기준으로 삼아야 하는가. */
function isSavedResult(result: AdminSaveResult | null | undefined): boolean {
  return Boolean(result?.message) && !result?.errors;
}

/** 비제어 폼의 현재 값을 마운트 시점(또는 마지막 저장)과 비교한다. 화면이 값을 들고 있지 않은 서버 액션 폼에 쓴다. */
export function createAdminFormTracker(onDirtyChange: (dirty: boolean) => void, options: { recover?: boolean } = {}) {
  const recover = options.recover !== false;
  let form: HTMLFormElement | null = null;
  let baseline: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let serverResult: AdminSaveResult | null | undefined;
  let submittedAfter: { result: AdminSaveResult | null | undefined } | null = null;

  const read = () => (form ? adminFormFingerprint(form) : null);
  function run(job: () => void) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; job(); }, 0);
  }
  /* 네이티브 이벤트가 React 커밋보다 먼저 닿는다. 숨은 값까지 반영된 뒤에 읽도록 이벤트가 끝나고 한 번만 읽는다. */
  function compareSoon() {
    if (timer === undefined) run(() => { const current = read(); if (current !== null) onDirtyChange(current !== baseline); });
  }

  return {
    /** form의 ref에 그대로 넘긴다. 폼이 key로 다시 만들어지면 새 폼을 기준으로 다시 잡는다. */
    attach(node: HTMLFormElement | null) {
      if (!node) return undefined;
      form = node;
      baseline = read();
      onDirtyChange(false);
      /* 뒤로 가기로 돌아온 화면이면 보관해 둔 입력을 되살린다. 되살린 값은 기준과 달라 미저장으로 잡힌다. */
      const attachedAt = recover && typeof window !== 'undefined' && typeof document !== 'undefined'
        ? { pathname: window.location.pathname, search: window.location.search } : null;
      const slot = attachedAt ? Array.from(document.forms ?? []).indexOf(node) : -1;
      const recoveryKey = attachedAt ? adminFormRecoveryKey(attachedAt, node, slot) : null;
      let restoreTimer: ReturnType<typeof setTimeout> | undefined;
      if (recoveryKey) {
        restoreTimer = setTimeout(() => { if (restoreAdminFormRecovery(recoveryKey, node) > 0) compareSoon(); }, 0);
      }
      const noteSubmit = () => { submittedAfter = { result: serverResult }; };
      node.addEventListener('input', compareSoon);
      node.addEventListener('change', compareSoon);
      /* 액션이 끝나면 React가 비제어 입력을 초기화한다. 실패 뒤 값이 되돌아간 폼을 계속 미저장으로 두지 않는다. */
      node.addEventListener('reset', compareSoon);
      node.addEventListener('submit', noteSubmit);
      /* 사진 선택·상품 고르기는 숨은 값만 바꾸고, 행 추가·삭제는 입력 칸 자체를 바꾼다. */
      const observer = new MutationObserver(compareSoon);
      observer.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['value'] });
      return () => {
        clearTimeout(restoreTimer);
        /* 다른 화면으로 떠나며 사라지는 폼만 보관한다(같은 화면 안에서 접히는 폼은 아니다). 운영자가 '이동'으로 입력을 버린 경우도 제외. */
        if (recoveryKey && attachedAt && form === node && baseline !== null
          && (window.location.pathname !== attachedAt.pathname || window.location.search !== attachedAt.search)
          && !adminLeaveWasJustConfirmed()) saveAdminFormRecovery(recoveryKey, node, baseline);
        observer.disconnect();
        node.removeEventListener('input', compareSoon);
        node.removeEventListener('change', compareSoon);
        node.removeEventListener('reset', compareSoon);
        node.removeEventListener('submit', noteSubmit);
        clearTimeout(timer);
        timer = undefined;
        if (form === node) { form = null; baseline = null; }
      };
    },
    /** 이 폼의 제출이 저장에 성공했으면 지금 값을 새 기준으로 삼는다. 실패하면 입력이 남아 있으므로 그대로 둔다. */
    noteServerResult(result: AdminSaveResult | null | undefined) {
      serverResult = result;
      if (!submittedAfter || submittedAfter.result === result) return;
      submittedAfter = null;
      /* React가 폼을 초기화하고 저장값으로 다시 그린 뒤에 읽는다. */
      if (isSavedResult(result)) run(() => { baseline = read(); onDirtyChange(false); });
    },
  };
}
