'use client';
import { useState, useTransition } from 'react';
import { previewPurchaseConfirmationAutoAction, readPurchaseConfirmationPolicyAction, savePurchaseConfirmationPolicyAction } from '@/app/admin/purchase-confirmation-actions';
import type { PurchaseConfirmationPolicy } from '@/lib/purchase-confirmation';
import { adminConfirm } from '@/lib/admin/confirm';
import { RELOAD_SAVED_CONFIRM, SAVE_CHECK_LABEL } from '@/lib/admin/goods-template-save';
import {
  PURCHASE_CONFIRMATION_RELOAD_LABEL, purchaseConfirmationAutoEnableConfirm, purchaseConfirmationPolicyReadback,
  purchaseConfirmationPolicySavedMessage, validConfirmationDays,
} from '@/lib/admin/purchase-confirmation-preview';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { GoodChoiceCard, GoodChoiceCards, GoodReadback } from './GoodEditorParts';
import { useGoodsGroupSession } from './GoodsGroupOperation';
import { AdminField, AdminFormGrid } from './console/AdminKit';

/* 템플릿 룩(ADR-0028). 고객 화면과 같이 쓰는 purchase-confirmation.css는 싣지 않는다 — 그 요소 규칙이 kit 입력·버튼을 덮는다. */

const DAYS_LABEL = '배송완료 뒤 자동 확정까지 (일)';
const EXTENSION_LABEL = '구매자가 미룰 수 있는 기간 (일)';
const DAYS_ERROR = '1~36,500 사이 숫자로 적어주세요.';

type Draft = { autoEnabled: boolean; days: string; extension: string };
type PolicyValues = { autoEnabled: boolean; autoAfterDays: number | null; buyerExtensionDays: number | null };
/** 저장됐는지 모르는 저장. [저장됐는지 확인]이 같은 작업 번호로 그대로 다시 보낸다. */
type Attempt = { values: PolicyValues; revision: number; operationId: string; before: PurchaseConfirmationPolicy };
type Message = { text: string; error: boolean };

const draftOf = (p: PurchaseConfirmationPolicy): Draft => ({ autoEnabled: p.autoEnabled, days: p.autoAfterDays?.toString() ?? '', extension: p.buyerExtensionDays?.toString() ?? '' });

/**
 * 거래확정 정책: 자동 거래확정을 켤지, 배송완료 뒤 며칠째에 확정할지, 구매자가 그 날짜를 며칠 미룰 수 있는지.
 *
 * 켜서 저장하면 꺼져 있던 동안 배송완료된 주문에도 기한이 생겨, 기한이 지난 주문이 다음 자동 처리 때 거래확정되고 적립금이 지급된다.
 * 그래서 꺼져 있던 정책을 켜는 저장만, 지금 확정될 주문 수와 지급될 적립금 합계를 읽어 확인창으로 보인 뒤 저장한다.
 */
export function PurchaseConfirmationPolicyForm({ initial, actorId, sessionId }: { initial: PurchaseConfirmationPolicy; actorId: string; sessionId: string | null }) {
  const [policy, setPolicy] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [message, setMessage] = useState<Message | null>(null);
  const [errors, setErrors] = useState<{ days?: string; extension?: string }>({});
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  /* 다른 사람이 먼저 바꿨다 — 저장된 정책을 다시 읽기 전에는 저장할 수 없다. */
  const [stale, setStale] = useState(false);
  const [pending, start] = useTransition();
  const session = useGoodsGroupSession(actorId, sessionId);
  const busy = pending || session.blocked;
  const locked = busy || attempt !== null || stale;
  const saved = draftOf(policy);
  const dirty = draft.autoEnabled !== saved.autoEnabled || draft.autoEnabled && (draft.days !== saved.days || draft.extension !== saved.extension);
  const readback = purchaseConfirmationPolicyReadback(draft);

  function change(next: Partial<Draft>) { setDraft(current => ({ ...current, ...next })); setErrors({}); }
  function show(next: PurchaseConfirmationPolicy) { setPolicy(next); setDraft(draftOf(next)); setAttempt(null); setStale(false); setErrors({}); }

  async function send(sending: Attempt) {
    const result = await savePurchaseConfirmationPolicyAction(sending.values, sending.revision, sending.operationId, { actorId, sessionId });
    if (!session.current()) return;
    if ('policy' in result && result.policy) { show(result.policy); setMessage({ text: purchaseConfirmationPolicySavedMessage(sending.before, result.policy), error: false }); return; }
    setAttempt('uncertain' in result ? sending : null);
    if ('conflict' in result) setStale(true);
    setMessage({ text: result.error ?? '저장하지 못했습니다. 잠시 뒤 다시 저장해주세요.', error: true });
  }

  function save() {
    if (locked || !sessionId) return;
    /* 끌 때는 기간 칸이 닫혀 있다. 저장돼 있던 기간을 그대로 보내 끄는 일이 기간까지 바꾸지 않게 한다. */
    let values: PolicyValues = { autoEnabled: false, autoAfterDays: policy.autoAfterDays, buyerExtensionDays: policy.buyerExtensionDays };
    if (draft.autoEnabled) {
      const invalid = {
        ...(validConfirmationDays(draft.days) ? {} : { days: DAYS_ERROR }),
        ...(draft.extension === '' || validConfirmationDays(draft.extension) ? {} : { extension: DAYS_ERROR }),
      };
      if (invalid.days || invalid.extension) { setErrors(invalid); return; }
      values = { autoEnabled: true, autoAfterDays: Number(draft.days), buyerExtensionDays: draft.extension === '' ? null : Number(draft.extension) };
    }
    const sending: Attempt = { values, revision: policy.revision, operationId: crypto.randomUUID(), before: policy };
    start(async () => {
      if (values.autoEnabled && !policy.autoEnabled) {
        const read = await previewPurchaseConfirmationAutoAction(values.autoAfterDays);
        if (!session.current()) return;
        if (!('preview' in read) || !read.preview) { setMessage({ text: read.error ?? '저장하지 않았습니다. 잠시 뒤 다시 [저장]을 눌러주세요.', error: true }); return; }
        if (!await adminConfirm(purchaseConfirmationAutoEnableConfirm(read.preview)) || !session.current()) return;
      }
      await send(sending);
    });
  }

  function check() { if (!attempt || busy) return; const sending = attempt; start(() => send(sending)); }

  function reload() {
    if (busy) return;
    start(async () => {
      /* 저장 결과를 모르거나 다른 사람이 먼저 바꾼 뒤에는 다시 읽는 것이 다음 할 일이라 묻지 않는다. 그 밖에 고친 값이 있으면 사라진다고 먼저 묻는다. */
      if (!attempt && !stale && dirty && (!await adminConfirm(RELOAD_SAVED_CONFIRM) || !session.current())) return;
      const result = await readPurchaseConfirmationPolicyAction();
      if (!session.current()) return;
      if ('policy' in result && result.policy) { show(result.policy); setMessage({ text: '저장된 정책을 다시 불러왔습니다.', error: false }); }
      else setMessage({ text: result.error ?? '불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.', error: true });
    });
  }

  return <form className="flex min-w-0 flex-col gap-4 text-sm" data-purchase-confirmation-policy="" onSubmit={e => { e.preventDefault(); save(); }}>
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={locked}>
      <GoodChoiceCards legend="자동 거래확정">
        <GoodChoiceCard name="confirmation-auto" value="off" checked={!draft.autoEnabled} onChange={() => change({ autoEnabled: false })}
          title="자동 확정 안 함" description="구매자가 직접 확정한 주문만 거래확정됩니다." />
        <GoodChoiceCard name="confirmation-auto" value="on" checked={draft.autoEnabled} onChange={() => change({ autoEnabled: true })}
          title="배송완료 뒤 자동 확정" description="배송이 모두 끝나고, 진행 중인 취소·반품·교환이나 거래확정 보류가 없는 주문만 확정합니다." />
      </GoodChoiceCards>
      {draft.autoEnabled ? <AdminFormGrid>
        <AdminField label={DAYS_LABEL} inputId="confirmation-auto-days" error={errors.days}>
          <Input className="tabular-nums" id="confirmation-auto-days" type="number" min="1" max="36500" step="1" required placeholder="예: 8"
            aria-invalid={errors.days ? true : undefined} aria-describedby={errors.days ? 'confirmation-auto-days-error' : undefined}
            value={draft.days} onChange={e => change({ days: e.target.value })} />
        </AdminField>
        <AdminField label={EXTENSION_LABEL} inputId="confirmation-extension" error={errors.extension}>
          <Input className="tabular-nums" id="confirmation-extension" type="number" min="1" max="36500" step="1" placeholder="비우면 연장 없음"
            aria-invalid={errors.extension ? true : undefined} aria-describedby={errors.extension ? 'confirmation-extension-error' : undefined}
            value={draft.extension} onChange={e => change({ extension: e.target.value })} />
        </AdminField>
      </AdminFormGrid> : null}
      {readback ? <GoodReadback>{readback}</GoodReadback> : null}
    </fieldset>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={locked}>저장</Button>
      {attempt ? <Button type="button" variant="outline" disabled={busy} onClick={check}>{SAVE_CHECK_LABEL}</Button> : null}
      <Button type="button" variant="outline" disabled={busy} onClick={reload}>{attempt ? '그만두고 다시 하기' : PURCHASE_CONFIRMATION_RELOAD_LABEL}</Button>
    </div>
    {message ? <p className={message.error ? 'text-destructive' : 'text-success'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
    {session.blocked ? <p className="text-destructive" role="alert">로그인 상태가 바뀌었습니다. 다시 로그인한 뒤 이 화면을 다시 열어주세요.</p> : null}
  </form>;
}
