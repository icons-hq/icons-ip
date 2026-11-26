'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  applyShippingSettingsTemplateAction, readShippingSettingsOperationAction, saveShippingSettingsTemplateAction, sealShippingSettingsOperationAction,
  type ShippingSettingsActionResult,
} from '@/app/admin/shipping-settings-template-actions';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import {
  parseShippingSettingsApplyInput, parseShippingSettingsOperationContext, parseShippingSettingsOperationReceipt, parseShippingSettingsSaveRequest,
  shippingSettingsOperationContext, shippingSettingsReceiptMatches,
  type ShippingSettingsApplyInput, type ShippingSettingsIdentity, type ShippingSettingsOperationContext, type ShippingSettingsOperationReceipt, type ShippingSettingsSaveRequest,
} from '@/lib/admin/shipping-settings-templates';

const PREFIX = 'icons:shipping-settings-operation:v1:', EVENT = 'icons:shipping-settings-operation:changed';
export type ShippingSettingsScope = ReturnType<typeof createGoodsDescriptionToolScope>;
type Request = ShippingSettingsSaveRequest | ShippingSettingsApplyInput;
const sameIdentity = (context: ShippingSettingsOperationContext, identity: ShippingSettingsIdentity) => context.expectedActorId === identity.expectedActorId && context.expectedSessionId === identity.expectedSessionId;
function key(identity: ShippingSettingsIdentity, templateId: string, command: ShippingSettingsOperationContext['command']) {
  return `${PREFIX}${identity.expectedActorId}:${identity.expectedSessionId}:${templateId}:${command}`;
}
function stored(storageKey: string): ShippingSettingsOperationContext | null {
  try { return parseShippingSettingsOperationContext(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')); } catch { return null; }
}
function journals(identity: ShippingSettingsIdentity | null, removeOthers = false): ShippingSettingsOperationContext[] {
  const result: ShippingSettingsOperationContext[] = [];
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter((value): value is string => Boolean(value?.startsWith(PREFIX)));
    for (const storageKey of keys) {
      const context = stored(storageKey);
      if (context && identity && sameIdentity(context, identity) && storageKey === key(identity, context.templateId, context.command)) result.push(context);
      else if (removeOthers) sessionStorage.removeItem(storageKey);
    }
  } catch { /* A write requires a successful metadata checkpoint below. */ }
  return result;
}
const changed = () => window.dispatchEvent(new Event(EVENT));

export function useShippingSettingsSession(accountId: string) {
  const scope = useMemo(() => createGoodsDescriptionToolScope(accountId), [accountId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [session, setSession] = useState<{ owner: ShippingSettingsScope; id: string } | null>(null);
  useEffect(() => {
    scope.setEnabled(true); scope.activate();
    const signedOut = () => { journals(null, true); scope.authenticate(null, null); changed(); };
    const unsubscribe = scope.subscribe(() => { if (scope.getSnapshot().blocked) { journals(null, true); changed(); } });
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signedOut);
    const subscription = getSupabaseConfig().isConfigured ? createClient().auth.onAuthStateChange((_event, value) => {
      const id = value ? inquiryDraftSessionId(value.access_token) : null;
      scope.authenticate(value?.user.id ?? null, id);
      if (id && value?.user.id === accountId && !scope.getSnapshot().blocked) {
        journals({ expectedActorId: accountId, expectedSessionId: id }, true); setSession({ owner: scope, id }); changed();
      }
    }).data.subscription : null;
    return () => { scope.dispose(); unsubscribe(); subscription?.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signedOut); };
  }, [accountId, scope]);
  const identity: ShippingSettingsIdentity | null = auth.ready && !auth.blocked && session?.owner === scope
    ? { expectedActorId: accountId, expectedSessionId: session.id } : null;
  return { identity, scope, blocked: auth.blocked };
}
export function useShippingSettingsPending(identity: ShippingSettingsIdentity | null) {
  const snapshot = useSyncExternalStore(listener => { window.addEventListener(EVENT, listener); return () => window.removeEventListener(EVENT, listener); },
    () => JSON.stringify(journals(identity)), () => '[]');
  return JSON.parse(snapshot) as ShippingSettingsOperationContext[];
}

/** 결과를 모를 때 그만두는 버튼. 누르면 앞서 누른 저장·적용이 뒤늦게 처리되지 않게 막고 입력을 다시 받는다. */
export const SHIPPING_SETTINGS_STOP_LABEL = '그만두고 다시 하기';
const NOT_SAVED_YET = `아직 저장된 것이 없습니다. [${SHIPPING_SETTINGS_STOP_LABEL}]를 누른 뒤 처음부터 다시 해 주세요.`;
/** 저장·적용되지 않은 것이 확실한 실패. `changed`는 다른 사람이 템플릿을 먼저 바꾼 경우다. */
export interface ShippingSettingsFailure { error: string; changed: boolean }

/**
 * 템플릿 저장·상품 적용을 한 번만 처리되게 보낸다. 보낸 일의 번호만 이 탭에 남겨, 결과를 모른 채 새로고침해도 [저장됐는지 확인]으로 이어 볼 수 있다.
 *   - 결과를 모르면(연결이 끊긴 경우 등) 화면이 [저장됐는지 확인]·[그만두고 다시 하기]를 보인다.
 *   - 저장·적용되지 않은 것이 확실하면(DB가 이유를 들어 거절) 그 일을 바로 끝내고 이유를 `error`와 `onFailure`로 알린다.
 *     운영자가 [그만두고 다시 하기]를 따로 누르지 않아도 고쳐서 다시 저장할 수 있다. 끝내지 못했으면 버튼이 남는다.
 */
export function useShippingSettingsOperation({ identity, scope, templateId, command, onReceipt, onFailure }: {
  identity: ShippingSettingsIdentity; scope: ShippingSettingsScope; templateId: string; command: ShippingSettingsOperationContext['command'];
  onReceipt: (receipt: ShippingSettingsOperationReceipt) => void; onFailure?: (failure: ShippingSettingsFailure) => void;
}) {
  const storageKey = key(identity, templateId, command);
  const [context, setContext] = useState<ShippingSettingsOperationContext | null>(() => {
    const value = stored(storageKey); return value && sameIdentity(value, identity) && value.templateId === templateId && value.command === command ? value : null;
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [retryAllowed, setRetryAllowed] = useState(false);
  const request = useRef<Request | null>(null), active = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current = null; }; }, []);
  useEffect(() => {
    if (!context) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [context]);
  /**
   * 서버에 보내고 답을 화면 상태로 옮긴다. 저장·적용되지 않은 것이 확실한 실패만 돌려준다(부른 쪽이 그 일을 끝낸다).
   * `ended`는 그렇게 끝내는 중인 실패다 — 끝났으면 완료가 아니라 그 실패를 알린다.
   */
  async function run(operation: ShippingSettingsOperationContext, call: () => Promise<ShippingSettingsActionResult<ShippingSettingsOperationReceipt | null>>,
    mutation = false, ended?: ShippingSettingsFailure): Promise<ShippingSettingsFailure | null> {
    const ticket = scope.capture(); if (!ticket || active.current) return null;
    active.current = true; setBusy(true); setError(ended?.error ?? ''); setMessage('');
    try {
      const result = await call(); if (!alive.current || !scope.canApply(ticket)) return null;
      if ('error' in result) {
        if (result.authChanged) { setError(result.error); request.current = null; setRetryAllowed(false); scope.authenticate(null, null); return null; }
        if (mutation && !result.uncertain) { setRetryAllowed(false); return { error: result.error, changed: Boolean(result.changed) }; }
        setError(ended?.error ?? result.error); if (mutation) setRetryAllowed(true);
        return null;
      }
      if (result.data === null) { setMessage(NOT_SAVED_YET); return null; }
      const receipt = parseShippingSettingsOperationReceipt(result.data);
      if (!receipt || !shippingSettingsReceiptMatches(receipt, operation)) { setError(`다른 작업의 결과가 돌아왔습니다. [${SAVE_CHECK_LABEL}]을 다시 눌러 주세요.`); return null; }
      try { if (stored(storageKey)?.operationId === operation.operationId) sessionStorage.removeItem(storageKey); } catch { /* A retained receipt can be checked again. */ }
      request.current = null; setRetryAllowed(false); setContext(null); changed();
      if (ended && receipt.state === 'sealed') onFailure?.(ended); else { setError(''); onReceipt(receipt); }
      return null;
    } catch {
      if (alive.current && scope.canApply(ticket)) { setError(ended?.error ?? SAVE_UNKNOWN_MESSAGE); if (mutation) setRetryAllowed(true); }
      return null;
    } finally { active.current = false; if (alive.current) setBusy(false); }
  }
  /** 저장·적용을 보내고, 되지 않은 것이 확실하면 그 일을 끝낸다(뒤늦게 처리되지 않게 막는다). 그사이 처리돼 있었으면 그 결과로 끝난다. */
  async function submit(operation: ShippingSettingsOperationContext, original: Request) {
    const failed = await run(operation, () => original.command === 'save' ? saveShippingSettingsTemplateAction(original) : applyShippingSettingsTemplateAction(original), true);
    if (failed) await run(operation, () => sealShippingSettingsOperationAction(operation), false, failed);
  }
  async function send(raw: Request) {
    if (active.current || context || !scope.capture()) return;
    const input = raw.command === 'save' ? parseShippingSettingsSaveRequest(raw) : parseShippingSettingsApplyInput(raw);
    if (!input || !sameIdentity(input, identity) || input.templateId !== templateId || input.command !== command) { setError('로그인한 계정이나 템플릿이 달라 보내지 않았습니다. 화면을 새로고침한 뒤 다시 해 주세요.'); return; }
    const operation = shippingSettingsOperationContext(input);
    try {
      const serialized = JSON.stringify(operation); sessionStorage.setItem(storageKey, serialized);
      if (sessionStorage.getItem(storageKey) !== serialized) throw new Error('checkpoint unavailable');
    } catch { setError('이 브라우저에 진행 기록을 남길 수 없어 보내지 않았습니다. 시크릿 창이 아닌 일반 창에서 열거나, 브라우저 설정에서 사이트 데이터 저장을 허용해 주세요.'); return; }
    request.current = structuredClone(input); setContext(operation); changed();
    await submit(operation, input);
  }
  async function retry() {
    const original = request.current; if (!original || !context || !retryAllowed) return;
    await submit(context, original);
  }
  async function recover(seal = false) {
    if (!context) return;
    await run(context, () => seal ? sealShippingSettingsOperationAction(context) : readShippingSettingsOperationAction(context));
  }
  /** [저장됐는지 확인]: 보낸 내용이 화면에 남아 있으면 같은 내용을 다시 보내 결과를 받고(두 번 처리되지 않는다), 없으면 결과만 읽는다. */
  async function check() { if (context && retryAllowed && request.current) await retry(); else await recover(); }
  /** 지난 실패 이유를 지운다. 화면이 그 이유대로 다시 시작할 때(미리보기를 다시 만들 때) 부른다. 처리 중이거나 결과를 모르는 동안에는 지우지 않는다. */
  function reset() { if (!active.current && !context) { setError(''); setMessage(''); } }
  return { context, busy, error, message, canRetry: Boolean(context && retryAllowed), send, retry, recover, check, reset };
}
