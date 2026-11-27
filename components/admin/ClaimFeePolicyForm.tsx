'use client';
import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { cn } from 'cn';
import { readClaimFeePolicyAction, saveClaimFeePolicyAction } from '@/app/admin/claim-fee-policy-actions';
import type { ClaimFeePolicy } from '@/lib/orders/claim-fees';
import {
 CLAIM_FEE_BANK_ACCOUNT_LINK_LABEL, CLAIM_FEE_BANK_ACCOUNT_PATH, CLAIM_FEE_ISSUE_LABEL, CLAIM_FEE_MODE_LABELS, CLAIM_FEE_POLICY_AMOUNT_ERROR, CLAIM_FEE_POLICY_NOT_SAVED_MESSAGE,
 CLAIM_FEE_POLICY_READ_FAILED_MESSAGE, CLAIM_FEE_POLICY_SAVED_MESSAGE, CLAIM_FEE_POLICY_UNCHANGED_MESSAGE, CLAIM_FEE_SETTINGS_LABEL, CLAIM_FEE_SETTINGS_SAVE_LABEL,
 claimFeePolicyChangedMessage, claimFeePolicyConfirmMessage, claimFeePolicyReadback, claimFeePolicyValues, parseClaimFeePolicyAmount, sameClaimFeePolicyValues, type ClaimFeePolicyValues,
} from '@/lib/admin/claim-fees';
import { adminConfirm } from '@/lib/admin/confirm';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { GoodChoiceCard, GoodChoiceCards, GoodReadback } from '@/components/admin/GoodEditorParts';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { useGoodsGroupSession } from './GoodsGroupOperation';

/*
 * 배송비 청구 설정 — 템플릿 룩(ADR-0028). 고객 화면과 같이 쓰는 claim-fees.css 클래스는 쓰지 않는다(그 요소 규칙이 kit 입력을 덮는다).
 * 쓸지 말지를 카드 둘로 고르고, 쓸 때만 기본 청구 금액 칸이 열린다. 저장하면 바로 적용되므로 저장 전에 바뀌는 값과 적용 범위를 확인창으로 한 번 보인다.
 * 설정 근거 칸과 확인 체크는 없다(DB 20261127101000) — 누가 언제 바꿨는지는 감사 기록에 남는다.
 */
type Draft = { enabled: boolean; returnAmount: string; exchangeAmount: string };
type Notice = { tone: 'success' | 'info' | 'warning' | 'danger'; text: string };
const draftOf = (policy: ClaimFeePolicyValues): Draft => ({ enabled: policy.enabled, returnAmount: policy.returnAmount?.toString() ?? '', exchangeAmount: policy.exchangeAmount?.toString() ?? '' });
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const AMOUNT_PLACEHOLDER = '비우면 청구할 때 직접 적음';

export function ClaimFeePolicyForm({ initial, actorId, sessionId }: { initial: ClaimFeePolicy; actorId: string; sessionId: string | null }) {
 const [policy, setPolicy] = useState(initial), [draft, setDraft] = useState(() => draftOf(initial)), [notice, setNotice] = useState<Notice | null>(null), [uncertain, setUncertain] = useState(false);
 const [pending, start] = useTransition(), session = useGoodsGroupSession(actorId, sessionId), busy = useRef(false);
 /* 저장됐는지 모를 때 [저장됐는지 확인]이 견줄 값: 방금 보낸 내용과 그때의 저장 번호. */
 const attempted = useRef<{ values: ClaimFeePolicyValues; revision: number } | null>(null);
 const locked = pending || session.blocked || uncertain, accountMissing = !policy.accountReady;
 const returnAmount = parseClaimFeePolicyAmount(draft.returnAmount), exchangeAmount = parseClaimFeePolicyAmount(draft.exchangeAmount);
 /* 쓰지 않을 때는 금액 칸이 닫혀 있다 — 보이지 않는 칸의 값은 바꾸지 않고 저장된 금액을 그대로 둔다. */
 const next: ClaimFeePolicyValues | null = !draft.enabled ? { enabled: false, returnAmount: policy.returnAmount, exchangeAmount: policy.exchangeAmount }
  : returnAmount === undefined || exchangeAmount === undefined ? null : { enabled: true, returnAmount, exchangeAmount };
 function change(patch: Partial<Draft>) { setDraft({ ...draft, ...patch }); setNotice(null); }
 async function save() {
  if (locked || busy.current || !sessionId || !next || draft.enabled && accountMissing) return;
  const before = claimFeePolicyValues(policy), revision = policy.revision;
  if (sameClaimFeePolicyValues(before, next)) { setNotice({ tone: 'info', text: CLAIM_FEE_POLICY_UNCHANGED_MESSAGE }); return; }
  busy.current = true; setNotice(null);
  /* 확인창은 전환 밖에서 받는다 — 전환 안에서 띄우면 호스트의 상태 갱신이 전환이 끝날 때까지 미뤄져 확인창이 뜨지 않는다. */
  let confirmed = false;
  try { confirmed = await adminConfirm({ title: `${CLAIM_FEE_SETTINGS_LABEL} 저장`, message: claimFeePolicyConfirmMessage(before, next), confirmLabel: CLAIM_FEE_SETTINGS_SAVE_LABEL, cancelLabel: '돌아가기' }); }
  catch { confirmed = false; }
  if (!confirmed || !session.current()) { busy.current = false; return; }
  attempted.current = { values: next, revision };
  start(async () => {
   try {
    const result = await saveClaimFeePolicyAction(next, revision, crypto.randomUUID(), { actorId, sessionId });
    if (!session.current()) return;
    if ('policy' in result) { setPolicy(result.policy); setDraft(draftOf(result.policy)); setNotice({ tone: 'success', text: CLAIM_FEE_POLICY_SAVED_MESSAGE }); }
    else if (result.saved === 'unknown') { setUncertain(true); setNotice({ tone: 'danger', text: result.error }); }
    /* 다른 사람이 먼저 바꿨다: 적은 내용은 두고 지금 저장된 설정을 기준으로 삼는다 — 다시 저장하면 확인창이 그 설정에서 무엇이 바뀌는지 보인다. */
    else if (result.latest) { setPolicy(result.latest); setNotice({ tone: 'warning', text: claimFeePolicyChangedMessage(result.latest) }); }
    else setNotice({ tone: 'danger', text: result.error });
   } catch { if (session.current()) { setUncertain(true); setNotice({ tone: 'danger', text: SAVE_UNKNOWN_MESSAGE }); } }
   finally { busy.current = false; }
  });
 }
 /* 다시 보내지 않고 지금 저장된 설정을 읽어, 방금 보낸 내용이 들어갔는지 알려 준다. */
 function check() {
  if (pending || session.blocked || busy.current) return;
  busy.current = true;
  start(async () => {
   try {
    const result = await readClaimFeePolicyAction();
    if (!session.current()) return;
    if (!('policy' in result)) { setNotice({ tone: 'danger', text: result.error }); return; }
    const latest = result.policy, tried = attempted.current, moved = Boolean(tried && latest.revision > tried.revision);
    setPolicy(latest); setUncertain(false);
    if (tried && moved && sameClaimFeePolicyValues(latest, tried.values)) { setDraft(draftOf(latest)); setNotice({ tone: 'success', text: CLAIM_FEE_POLICY_SAVED_MESSAGE }); }
    else setNotice(moved ? { tone: 'warning', text: claimFeePolicyChangedMessage(latest) } : { tone: 'danger', text: CLAIM_FEE_POLICY_NOT_SAVED_MESSAGE });
   } catch { if (session.current()) setNotice({ tone: 'danger', text: CLAIM_FEE_POLICY_READ_FAILED_MESSAGE }); }
   finally { busy.current = false; }
  });
 }
 return <form className="flex min-w-0 flex-col gap-4 text-sm" data-claim-fee-policy="" onSubmit={event => { event.preventDefault(); void save(); }}>
  <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={locked}>
   <GoodChoiceCards legend="청구 방식">
    <GoodChoiceCard name="claim-fee-mode" value="off" checked={!draft.enabled} onChange={() => change({ enabled: false })} title={CLAIM_FEE_MODE_LABELS.off}
     description={`요청 상세에 [${CLAIM_FEE_ISSUE_LABEL}] 버튼이 나오지 않습니다.`} />
    <GoodChoiceCard name="claim-fee-mode" value="on" checked={draft.enabled} disabled={accountMissing} onChange={() => change({ enabled: true })} title={CLAIM_FEE_MODE_LABELS.on}
     description={`반품·교환 요청 상세에서 담당자가 [${CLAIM_FEE_ISSUE_LABEL}]로 청구하고, 고객은 무통장 계좌로 따로 입금합니다.`}
     blockedReason="입금 받을 계좌를 등록해야 고를 수 있습니다." />
   </GoodChoiceCards>
   {accountMissing ? <Link className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'self-start')} data-slot="button" href={CLAIM_FEE_BANK_ACCOUNT_PATH}>{CLAIM_FEE_BANK_ACCOUNT_LINK_LABEL}</Link> : null}
   {draft.enabled ? <>
    <div className="grid gap-4 sm:grid-cols-2">
     <div className={FIELD}><Label htmlFor="claim-fee-policy-return">반품 기본 청구 금액 (원)</Label><Input className="tabular-nums" id="claim-fee-policy-return" inputMode="numeric" maxLength={7} placeholder={AMOUNT_PLACEHOLDER}
      aria-invalid={returnAmount === undefined || undefined} value={draft.returnAmount} onChange={event => change({ returnAmount: event.target.value })} /></div>
     <div className={FIELD}><Label htmlFor="claim-fee-policy-exchange">교환 기본 청구 금액 (원)</Label><Input className="tabular-nums" id="claim-fee-policy-exchange" inputMode="numeric" maxLength={7} placeholder={AMOUNT_PLACEHOLDER}
      aria-invalid={exchangeAmount === undefined || undefined} value={draft.exchangeAmount} onChange={event => change({ exchangeAmount: event.target.value })} /></div>
    </div>
    {next ? <GoodReadback>{claimFeePolicyReadback(next)}</GoodReadback> : <p className="text-destructive" role="alert">{CLAIM_FEE_POLICY_AMOUNT_ERROR}</p>}
    <p className="text-xs text-muted-foreground">고객이 배송비를 입금하지 않아도 반품·환불은 그대로 진행됩니다.</p>
   </> : null}
  </fieldset>
  <div className="flex flex-wrap items-center gap-2">
   <Button type="submit" disabled={locked || draft.enabled && accountMissing}>{pending ? '저장 중…' : CLAIM_FEE_SETTINGS_SAVE_LABEL}</Button>
   {uncertain ? <Button type="button" variant="outline" disabled={pending || session.blocked} onClick={check}>{SAVE_CHECK_LABEL}</Button> : null}
  </div>
  {notice ? <AdminNotice role={notice.tone === 'danger' ? 'alert' : 'status'} tone={notice.tone}>{notice.text}</AdminNotice> : null}
  {session.blocked ? <p className="text-destructive" role="alert">로그인 상태가 바뀌었습니다. 새로고침해 이 화면을 다시 열어주세요.</p> : null}
 </form>;
}
