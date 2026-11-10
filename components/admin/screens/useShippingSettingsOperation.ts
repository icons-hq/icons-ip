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

export function useShippingSettingsOperation({ identity, scope, templateId, command, onReceipt }: {
  identity: ShippingSettingsIdentity; scope: ShippingSettingsScope; templateId: string; command: ShippingSettingsOperationContext['command'];
  onReceipt: (receipt: ShippingSettingsOperationReceipt) => void;
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
  async function run(operation: ShippingSettingsOperationContext, call: () => Promise<ShippingSettingsActionResult<ShippingSettingsOperationReceipt | null>>, mutation = false) {
    const ticket = scope.capture(); if (!ticket || active.current) return;
    active.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await call(); if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) {
        setError(result.error); if (mutation) setRetryAllowed(Boolean(result.uncertain));
        if (result.authChanged) { request.current = null; setRetryAllowed(false); scope.authenticate(null, null); }
        return;
      }
      if (result.data === null) { setMessage('아직 저장 결과가 없습니다. 원래 입력으로 재시도하거나 미처리 요청을 종료해주세요. 새 요청은 만들지 않습니다.'); return; }
      const receipt = parseShippingSettingsOperationReceipt(result.data);
      if (!receipt || !shippingSettingsReceiptMatches(receipt, operation)) { setError('현재 요청과 다른 결과입니다. 같은 요청의 저장 결과를 다시 확인해주세요.'); return; }
      try { if (stored(storageKey)?.operationId === operation.operationId) sessionStorage.removeItem(storageKey); } catch { /* A retained receipt can be checked again. */ }
      request.current = null; setRetryAllowed(false); setContext(null); changed(); onReceipt(receipt);
    } catch {
      if (alive.current && scope.canApply(ticket)) { setError('처리 결과가 불확실합니다. 같은 요청의 저장 결과를 확인해주세요.'); if (mutation) setRetryAllowed(true); }
    } finally { active.current = false; if (alive.current) setBusy(false); }
  }
  async function send(raw: Request) {
    if (active.current || context || !scope.capture()) return;
    const input = raw.command === 'save' ? parseShippingSettingsSaveRequest(raw) : parseShippingSettingsApplyInput(raw);
    if (!input || !sameIdentity(input, identity) || input.templateId !== templateId || input.command !== command) { setError('현재 로그인과 템플릿의 저장 기준을 확인해주세요.'); return; }
    const operation = shippingSettingsOperationContext(input);
    try {
      const serialized = JSON.stringify(operation); sessionStorage.setItem(storageKey, serialized);
      if (sessionStorage.getItem(storageKey) !== serialized) throw new Error('checkpoint unavailable');
    } catch { setError('이 탭에 요청번호를 보관할 수 없어 전송하지 않았습니다. 브라우저 저장 설정을 확인해주세요.'); return; }
    request.current = structuredClone(input); setContext(operation); changed();
    await run(operation, () => input.command === 'save' ? saveShippingSettingsTemplateAction(input) : applyShippingSettingsTemplateAction(input), true);
  }
  async function retry() {
    const original = request.current; if (!original || !context || !retryAllowed) return;
    await run(context, () => original.command === 'save' ? saveShippingSettingsTemplateAction(original) : applyShippingSettingsTemplateAction(original), true);
  }
  async function recover(seal = false) {
    if (!context) return;
    await run(context, () => seal ? sealShippingSettingsOperationAction(context) : readShippingSettingsOperationAction(context));
  }
  return { context, busy, error, message, canRetry: Boolean(context && retryAllowed), send, retry, recover };
}
