/*
 * 어드민 확인창의 공용 통로.
 *
 * 브라우저 기본 confirm()은 동기라 스타일·접근성·시험이 모두 막힌다. 어드민은 kit AlertDialog로 그린
 * 하나의 호스트(`AdminConfirmHost`, 셸에 한 번 마운트)를 쓰고, 호출부는 `adminConfirm()`의 약속을 기다린다.
 * 호스트가 없으면(마운트 전·시험) 확인되지 않은 것으로 돌려준다. 돈·재고를 건드리는 동작이 확인 없이 실행되는 일은 없다.
 */

export interface AdminConfirmRequest {
  /** 확인창 본문. 기존 확인 문구를 그대로 쓴다. */
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 되돌릴 수 없는 작업이면 확인 버튼을 위험색으로 그린다. */
  destructive?: boolean;
  /** 사유 같은 글을 받는 확인창이면 입력칸 설명. `adminPrompt`가 이 요청을 쓰고, 호스트가 확인 때 `value`에 입력을 적는다. */
  input?: AdminConfirmInput_;
  /** 입력이 있는 확인에서 호스트가 확인 직전에 입력값(앞뒤 공백 제거)을 넘기는 통로. `adminPrompt`가 채운다. */
  receive?: (value: string) => void;
}

export interface AdminConfirmInput_ {
  label: string;
  placeholder?: string;
  /** 글자 수(공백 제외 앞뒤 trim 기준, 코드포인트). 범위를 벗어나면 확인 버튼이 눌리지 않는다. */
  minLength?: number;
  maxLength?: number;
}

export type AdminConfirmInput = string | AdminConfirmRequest;
export type AdminConfirmHandler = (request: AdminConfirmRequest) => Promise<boolean>;

let handler: AdminConfirmHandler | null = null;

export function normalizeAdminConfirm(input: AdminConfirmInput): AdminConfirmRequest {
  return typeof input === 'string' ? { message: input } : input;
}

/** 호스트(또는 시험)가 확인창을 넘겨받는다. 돌려준 함수로 해제한다. */
export function setAdminConfirmHandler(next: AdminConfirmHandler | null): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

/** 지금 떠 있거나 줄 선 확인(같은 문구). 같은 버튼을 연달아 눌러도 확인창이 하나만 뜨고 실행도 한 번이다. */
const inflight = new Set<string>();

/**
 * 확인창을 띄우고 운영자의 선택을 기다린다. 취소·닫기·호스트 없음은 false.
 * 같은 확인이 이미 떠 있는 동안의 거듭 호출(이중 클릭)은 기다리지 않고 false — 먼저 받은 호출만 이어서 실행한다.
 */
export function adminConfirm(input: AdminConfirmInput): Promise<boolean> {
  const request = normalizeAdminConfirm(input);
  if (!handler) return Promise.resolve(false);
  const key = `${request.title ?? ''}\u0000${request.message}`;
  if (inflight.has(key)) return Promise.resolve(false);
  inflight.add(key);
  return handler(request).finally(() => { inflight.delete(key); });
}

/**
 * 사유 같은 글을 받는 확인창. 브라우저 기본 `prompt()` 대신 쓴다. 취소·닫기·호스트 없음은 null,
 * 확인하면 입력한 글(앞뒤 공백 제거)을 돌려준다.
 */
export async function adminPrompt(request: AdminConfirmRequest & { input: AdminConfirmInput_ }): Promise<string | null> {
  let value = '';
  const ok = await adminConfirm({ ...request, receive: (next) => { value = next; } });
  return ok ? value : null;
}

type SubmitEventLike = {
  currentTarget: HTMLFormElement;
  preventDefault(): void;
  nativeEvent?: Event;
};

const waiting = new WeakSet<HTMLFormElement>();
const confirmed = new WeakSet<HTMLFormElement>();

/**
 * form의 onSubmit에서 부른다. true면 그대로 제출을 이어 가고, false면 제출을 멈추고 확인창을 띄운 뒤
 * 확인하면 같은 제출자(버튼)로 폼을 다시 제출한다. 확인창이 떠 있는 동안의 거듭 제출은 무시한다.
 * 확인할 문구가 없으면 항상 true.
 */
export function confirmAdminSubmit(event: SubmitEventLike, input: AdminConfirmInput | null | undefined): boolean {
  const form = event.currentTarget;
  if (confirmed.has(form)) return true;
  if (!input) return true;
  event.preventDefault();
  if (waiting.has(form)) return false;
  waiting.add(form);
  const submitter = (event.nativeEvent as { submitter?: HTMLElement | null } | undefined)?.submitter ?? undefined;
  void adminConfirm(input).then((ok) => {
    waiting.delete(form);
    if (!ok || !form.isConnected) return;
    /* requestSubmit은 submit 이벤트를 동기로 보낸다. 검증에 걸려 이벤트가 없어도 표식이 남지 않게 바로 지운다. */
    confirmed.add(form);
    try { form.requestSubmit(submitter); } finally { confirmed.delete(form); }
  });
  return false;
}
