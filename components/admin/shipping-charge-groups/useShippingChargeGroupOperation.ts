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
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import {
  SHIPPING_CHARGE_GROUP_STOP_LABEL, parseShippingChargeGroupAssignRequest, parseShippingChargeGroupOperationContext, parseShippingChargeGroupOperationReceipt, parseShippingChargeGroupSaveRequest,
  shippingChargeGroupOperationContext, shippingChargeGroupReceiptMatches,
  type ShippingChargeGroupIdentity, type ShippingChargeGroupOperationContext,
  type ShippingChargeGroupOperationReceipt, type ShippingChargeGroupOperationRequest,
} from '@/lib/admin/shipping-charge-groups';

const PREFIX = 'icons:shipping-charge-group-operation:v1:';
const EVENT = 'icons:shipping-charge-group-operation:changed';
export type ShippingChargeGroupScope = ReturnType<typeof createGoodsDescriptionToolScope>;
type Result = { data: ShippingChargeGroupOperationReceipt | null } | { error: string; uncertain?: boolean; changed?: boolean; authChanged?: boolean };
/** 저장·배정되지 않은 것이 확실한 실패. `changed`는 다른 사람이 먼저 바꾼 경우다. */
export interface ShippingChargeGroupFailure { error: string; changed: boolean }
const NOT_SAVED_YET = `아직 저장된 것이 없습니다. [${SHIPPING_CHARGE_GROUP_STOP_LABEL}]를 누른 뒤 처음부터 다시 해 주세요.`;
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

/**
 * 묶음그룹 저장·상품 넣기/빼기를 한 번만 처리되게 보낸다. 보낸 일의 번호만 이 탭에 남기고(적은 내용은 남기지 않는다),
 * 결과를 모른 채 새로고침해도 [저장됐는지 확인]으로 이어 볼 수 있다.
 *   - 결과를 모르면(연결이 끊긴 경우 등) 화면이 [저장됐는지 확인]·[그만두고 다시 하기]를 보인다. 같은 내용을 다시 보내지 않고 결과만 읽는다.
 *   - 저장되지 않은 것이 확실하면(DB가 이유를 들어 거절) 그 일을 바로 끝내고 이유를 `error`와 `onFailure`로 알린다.
 *     운영자가 [그만두고 다시 하기]를 따로 누르지 않아도 고쳐서 다시 저장할 수 있다. 끝내지 못했으면 버튼이 남는다.
 */
export function useShippingChargeGroupOperation({ identity, scope, groupId, command, onReceipt, onFailure }: {
  identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope; groupId: string | null;
  command: ShippingChargeGroupOperationContext['command']; onReceipt: (receipt: ShippingChargeGroupOperationReceipt) => void;
  onFailure?: (failure: ShippingChargeGroupFailure) => void;
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
  /**
   * 서버에 보내고 답을 화면 상태로 옮긴다. 저장되지 않은 것이 확실한 실패만 돌려준다(부른 쪽이 그 일을 끝낸다).
   * `ended`는 그렇게 끝내는 중인 실패다 — 끝났으면 완료가 아니라 그 실패를 알린다.
   */
  async function run(operation: ShippingChargeGroupOperationContext, action: () => Promise<Result>, mutation = false,
    ended?: ShippingChargeGroupFailure): Promise<ShippingChargeGroupFailure | null> {
    const ticket = scope.capture();
    if (!ticket || !lane.available()) return null;
    lane.start(); update({ busy: true, error: ended?.error ?? '', message: '' });
    let error = ended?.error ?? '', message = '';
    try {
      const result = await action();
      if (!lane.isActive() || !scope.canApply(ticket)) return null;
      if ('error' in result) {
        if (result.authChanged) { error = result.error; scope.authenticate(null, null); return null; }
        if (mutation && !result.uncertain) { error = result.error; return { error: result.error, changed: Boolean(result.changed) }; }
        error = ended?.error ?? result.error;
        return null;
      }
      if (result.data === null) { message = NOT_SAVED_YET; return null; }
      const receipt = parseShippingChargeGroupOperationReceipt(result.data);
      if (!receipt || !shippingChargeGroupReceiptMatches(receipt, operation)) {
        error = `다른 작업의 결과가 돌아왔습니다. [${SAVE_CHECK_LABEL}]을 다시 눌러 주세요.`;
        return null;
      }
      try { if (readJournal(key)?.operationId === operation.operationId) sessionStorage.removeItem(key); } catch { /* A retained receipt can be read again. */ }
      notify();
      if (ended && receipt.state === 'sealed') onFailure?.(ended); else { error = ''; onReceipt(receipt); }
      return null;
    } catch {
      if (lane.isActive() && scope.canApply(ticket)) error = ended?.error ?? SAVE_UNKNOWN_MESSAGE;
      return null;
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
      update({ busy: false, error: '로그인한 계정이나 묶음그룹이 달라 보내지 않았습니다. 화면을 새로고침한 뒤 다시 해 주세요.', message: '' });
      return;
    }
    try {
      const serialized = JSON.stringify(operation);
      sessionStorage.setItem(key, serialized);
      if (sessionStorage.getItem(key) !== serialized) throw new Error('checkpoint unavailable');
    } catch {
      update({ busy: false, error: '이 브라우저에 진행 기록을 남길 수 없어 보내지 않았습니다. 시크릿 창이 아닌 일반 창에서 열거나, 브라우저 설정에서 사이트 데이터 저장을 허용해 주세요.', message: '' });
      return;
    }
    notify();
    const failed = await run(operation, () => request.command === 'save' ? saveShippingChargeGroupAction(request) : assignShippingChargeGroupAction(request), true);
    /* 저장되지 않은 것이 확실하면 그 일을 끝낸다(뒤늦게 처리되지 않게 막는다). 그사이 처리돼 있었으면 그 결과로 끝난다. */
    if (failed) await run(operation, () => sealShippingChargeGroupOperationAction(operation), false, failed);
  }
  /** [저장됐는지 확인](seal=false)은 결과만 읽고, [그만두고 다시 하기](seal=true)는 앞서 누른 저장이 뒤늦게 처리되지 않게 막는다. */
  async function recover(seal = false) {
    const operation = readJournal(key);
    if (!operation || !sameIdentity(operation, identity)) return;
    await run(operation, () => seal ? sealShippingChargeGroupOperationAction(operation) : readShippingChargeGroupOperationAction(operation));
  }
  /** 지난 실패 이유를 지운다. 화면이 그 이유대로 다시 시작할 때(미리보기를 다시 만들 때) 부른다. 처리 중이거나 결과를 모르는 동안에는 지우지 않는다. */
  function reset() { if (lane.available() && !readJournal(key)) update({ busy: false, error: '', message: '' }); }
  return { context, busy: state.busy, error: state.error, message: state.message, send, recover, reset };
}
