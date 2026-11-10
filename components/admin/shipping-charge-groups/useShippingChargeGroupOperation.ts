'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  assignShippingChargeGroupAction, readShippingChargeGroupOperationAction, saveShippingChargeGroupAction,
  sealShippingChargeGroupOperationAction,
} from '@/app/admin/shipping-charge-group-actions';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import {
  parseShippingChargeGroupAssignRequest, parseShippingChargeGroupOperationContext, parseShippingChargeGroupOperationReceipt, parseShippingChargeGroupSaveRequest,
  shippingChargeGroupOperationContext, shippingChargeGroupReceiptMatches,
  type ShippingChargeGroupIdentity, type ShippingChargeGroupOperationContext,
  type ShippingChargeGroupOperationReceipt, type ShippingChargeGroupOperationRequest,
} from '@/lib/admin/shipping-charge-groups';

const PREFIX = 'icons:shipping-charge-group-operation:v1:';
const EVENT = 'icons:shipping-charge-group-operation:changed';
export type ShippingChargeGroupScope = ReturnType<typeof createGoodsDescriptionToolScope>;
type Result = { data: ShippingChargeGroupOperationReceipt | null } | { error: string; authChanged?: boolean };
const sameIdentity = (left: ShippingChargeGroupIdentity, right: ShippingChargeGroupIdentity) =>
  left.expectedActorId === right.expectedActorId && left.expectedSessionId === right.expectedSessionId;

function journalKey(identity: ShippingChargeGroupIdentity, groupId: string | null, command: ShippingChargeGroupOperationContext['command']) {
  return `${PREFIX}${identity.expectedActorId}:${identity.expectedSessionId}:${groupId ?? 'clear'}:${command}`;
}
function readJournal(key: string): ShippingChargeGroupOperationContext | null {
  try {
    const value = parseShippingChargeGroupOperationContext(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    return value && key === journalKey(value, value.groupId, value.command) ? value : null;
  } catch { return null; }
}
function pendingJournals(identity: ShippingChargeGroupIdentity | null, prune = false): ShippingChargeGroupOperationContext[] {
  const result: ShippingChargeGroupOperationContext[] = [];
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(PREFIX)));
    for (const key of keys) {
      const value = readJournal(key);
      if (value && identity && sameIdentity(value, identity) && key === journalKey(identity, value.groupId, value.command)) result.push(value);
      else if (prune) sessionStorage.removeItem(key);
    }
  } catch { /* Sending still requires a successful verified checkpoint. */ }
  return result;
}
function notify() { window.dispatchEvent(new Event(EVENT)); }
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
function createOperationLane(key: string, scope: ShippingChargeGroupScope) {
  let active = true, busy = false;
  return { key, scope, activate: () => { active = true; }, dispose: () => { active = false; },
    available: () => active && !busy, isActive: () => active, start: () => { busy = true; }, finish: () => { busy = false; } };
}

export function useShippingChargeGroupSession(accountId: string) {
  const scope = useMemo(() => createGoodsDescriptionToolScope(accountId), [accountId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [session, setSession] = useState<{ owner: ShippingChargeGroupScope; id: string } | null>(null);
  useEffect(() => {
    scope.setEnabled(true); scope.activate();
    const signedOut = () => { pendingJournals(null, true); scope.authenticate(null, null); notify(); };
    const unsubscribe = scope.subscribe(() => {
      if (scope.getSnapshot().blocked) { pendingJournals(null, true); notify(); }
    });
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signedOut);
    const subscription = getSupabaseConfig().isConfigured ? createClient().auth.onAuthStateChange((_event, value) => {
      const id = value ? inquiryDraftSessionId(value.access_token) : null;
      scope.authenticate(value?.user.id ?? null, id);
      if (id && value?.user.id === accountId && !scope.getSnapshot().blocked) {
        pendingJournals({ expectedActorId: accountId, expectedSessionId: id }, true);
        setSession({ owner: scope, id }); notify();
      }
    }).data.subscription : null;
    return () => { scope.dispose(); unsubscribe(); subscription?.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signedOut); };
  }, [accountId, scope]);
  const identity: ShippingChargeGroupIdentity | null = auth.ready && !auth.blocked && session?.owner === scope
    ? { expectedActorId: accountId, expectedSessionId: session.id } : null;
  return { identity, scope, blocked: auth.blocked };
}

export function useShippingChargeGroupPending(identity: ShippingChargeGroupIdentity | null) {
  const snapshot = useSyncExternalStore(subscribe, () => JSON.stringify(pendingJournals(identity)), () => '[]');
  return JSON.parse(snapshot) as ShippingChargeGroupOperationContext[];
}

/** A pending write is resolved by read/seal only; raw policy input is never journaled. */
export function useShippingChargeGroupOperation({ identity, scope, groupId, command, onReceipt }: {
  identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope; groupId: string | null;
  command: ShippingChargeGroupOperationContext['command']; onReceipt: (receipt: ShippingChargeGroupOperationReceipt) => void;
}) {
  const key = journalKey(identity, groupId, command);
  const lane = useMemo(() => createOperationLane(key, scope), [key, scope]);
  const snapshot = useSyncExternalStore(subscribe, () => JSON.stringify(readJournal(key)), () => 'null');
  const context = parseShippingChargeGroupOperationContext(JSON.parse(snapshot));
  const [stored, setStored] = useState<{ owner: typeof lane; busy: boolean; error: string; message: string } | null>(null);
  const state = stored?.owner === lane ? stored : { busy: false, error: '', message: '' };
  const update = (value: { busy: boolean; error: string; message: string }) => setStored({ owner: lane, ...value });
  useEffect(() => { lane.activate(); return () => lane.dispose(); }, [lane]);
  useEffect(() => {
    if (!context) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [context]);
  async function run(operation: ShippingChargeGroupOperationContext, action: () => Promise<Result>) {
    const ticket = scope.capture();
    if (!ticket || !lane.available()) return;
    lane.start(); update({ busy: true, error: '', message: '' });
    let error = '', message = '';
    try {
      const result = await action();
      if (!lane.isActive() || !scope.canApply(ticket)) return;
      if ('error' in result) {
        error = result.error;
        if (result.authChanged) scope.authenticate(null, null);
        return;
      }
      if (result.data === null) {
        message = '아직 원래 요청의 저장 결과가 없습니다. 새 요청을 만들지 않고 결과를 다시 확인하거나 미처리 요청을 종료해주세요.';
        return;
      }
      const receipt = parseShippingChargeGroupOperationReceipt(result.data);
      if (!receipt || !shippingChargeGroupReceiptMatches(receipt, operation)) {
        error = '현재 계정·세션·요청과 다른 결과입니다. 같은 요청의 결과를 다시 확인해주세요.';
        return;
      }
      try { if (readJournal(key)?.operationId === operation.operationId) sessionStorage.removeItem(key); } catch { /* A retained receipt can be read again. */ }
      notify(); onReceipt(receipt);
    } catch {
      if (lane.isActive() && scope.canApply(ticket)) error = '처리 결과가 불확실합니다. 같은 요청의 결과를 확인하거나 미처리 요청을 종료해주세요.';
    } finally {
      lane.finish();
      if (lane.isActive() && scope.canApply(ticket)) update({ busy: false, error, message });
    }
  }
  async function send(raw: ShippingChargeGroupOperationRequest) {
    if (!lane.available() || readJournal(key) || !scope.capture()) return;
    const request = raw.command === 'save' ? parseShippingChargeGroupSaveRequest(raw) : parseShippingChargeGroupAssignRequest(raw);
    const operation = request ? parseShippingChargeGroupOperationContext(shippingChargeGroupOperationContext(request)) : null;
    if (!request || !operation || !sameIdentity(operation, identity) || operation.groupId !== groupId || operation.command !== command) {
      update({ busy: false, error: '현재 로그인과 그룹의 저장 기준을 확인해주세요.', message: '' });
      return;
    }
    try {
      const serialized = JSON.stringify(operation);
      sessionStorage.setItem(key, serialized);
      if (sessionStorage.getItem(key) !== serialized) throw new Error('checkpoint unavailable');
    } catch {
      update({ busy: false, error: '이 탭에 요청번호를 보관할 수 없어 전송하지 않았습니다. 브라우저 저장 설정을 확인해주세요.', message: '' });
      return;
    }
    notify();
    await run(operation, () => request.command === 'save' ? saveShippingChargeGroupAction(request) : assignShippingChargeGroupAction(request));
  }
  async function recover(seal = false) {
    const operation = readJournal(key);
    if (!operation || !sameIdentity(operation, identity)) return;
    await run(operation, () => seal ? sealShippingChargeGroupOperationAction(operation) : readShippingChargeGroupOperationAction(operation));
  }
  return { context, busy: state.busy, error: state.error, message: state.message, send, recover };
}
