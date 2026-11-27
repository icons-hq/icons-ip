'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { saveVirtualAccountRefundAccountAction, type VirtualAccountRefundAccountSaveResult } from '@/app/admin/virtual-account-refund-actions';
import { AdminField, AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
import { adminConfirm } from '@/lib/admin/confirm';
import { SAVE_CHECK_LABEL } from '@/lib/admin/goods-template-save';
import {
  ADMIN_REFUND_ACCOUNT_NUMBER_RULE, ADMIN_REFUND_ACCOUNT_REASON_EXAMPLE, adminRefundAccountEntryProblem, showsVirtualAccountRefundAccountEntry,
  VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS, VIRTUAL_ACCOUNT_REFUND_ACCOUNT_SAVE_LABELS, virtualAccountRefundAccountEntryConfirm,
} from '@/lib/admin/virtual-account-refund-account';
import { TOSS_REFUND_BANKS } from '@/lib/payments/toss-bank-codes';

const BLANK = { bankName: '', accountNumber: '', accountHolder: '', reason: '' };

/**
 * 가상계좌 환급 계좌 대신 입력(ADR-0049 결정 5 보강, 2026-11-25). 입금된 가상계좌 주문의 취소·반품 환불이 계좌 때문에 결제확인필요
 * (provider_refund_account_required·provider_refund_account_invalid)로 멈췄을 때 주문 처리 패널·클레임 상세에 보인다. 구매자에게는 앱 알림·메일이
 * 이미 갔고, 구매자가 전화 등으로 알려준 계좌를 운영자가 넣는 칸이다. 저장하면 취소는 시스템이 이 계좌로 다시 환불하고, 반품은 [환불 완료 확정]·
 * [상태 다시 확인]을 누른다. 입력 가능 여부·계좌 판정은 서버가 다시 한다(구매자 입력과 같은 규칙).
 *
 * 저장 전에는 적은 계좌를 가리지 않고 되읽는 확인창을 한 번 띄운다(화면 규칙 PR 3 D-34) — 취소는 저장이 곧 그 계좌로 가는 환불 요청이라
 * 계좌 오타가 다른 계좌로의 송금이 된다.
 */
export function VirtualAccountRefundAccountEntry({ claimId, claimType, lastErrorCode, orderId, refundAmount }: {
  claimId: string;
  claimType: string;
  lastErrorCode: string | null | undefined;
  orderId: string;
  /** 확인창에 함께 되읽을 환불 금액(선택). 처리 칸에 보이는 환불 금액과 같은 값을 넘긴다. 없으면 확인창은 계좌만 되읽는다. */
  refundAmount?: number | null;
}) {
  if (!showsVirtualAccountRefundAccountEntry(lastErrorCode) || (claimType !== 'cancel' && claimType !== 'return')) return null;
  return <EntryForm claimId={claimId} claimType={claimType} invalid={lastErrorCode === 'provider_refund_account_invalid'} orderId={orderId} refundAmount={refundAmount ?? null} />;
}

function EntryForm({ claimId, claimType, invalid, orderId, refundAmount }: {
  claimId: string; claimType: 'cancel' | 'return'; invalid: boolean; orderId: string; refundAmount: number | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(BLANK);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  /* 저장됐는지 모르는 상태. 입력을 잠가 같은 내용·같은 작업 번호로만 다시 확인하게 한다(서버가 같은 결과를 돌려준다). */
  const [uncertain, setUncertain] = useState(false);
  const [pending, startTransition] = useTransition();
  const asking = useRef(false);
  useClaimPreviewBusy(pending);
  const dirty = Object.values(draft).some(Boolean);
  useAdminLeaveGuard({ dirty, blocked: pending, message: '적던 환불 계좌는 저장되지 않고 사라집니다. 화면을 나갈까요?' });
  const idPrefix = `va-refund-account-${claimId}`;

  function send(id: string) {
    startTransition(async () => {
      let outcome: VirtualAccountRefundAccountSaveResult;
      try { outcome = await saveVirtualAccountRefundAccountAction({ claimId, orderId, claimType, operationId: id, ...draft }); }
      catch { outcome = { ok: false, error: VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS.unknown, uncertain: true }; }
      if (outcome.ok) {
        setDraft(BLANK);
        setOperationId(null);
        setUncertain(false);
        setResult({ ok: true, text: outcome.message });
        router.refresh();
      } else {
        setUncertain(Boolean(outcome.uncertain));
        setResult({ ok: false, text: outcome.error });
      }
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || asking.current) return;
    /* 저장됐는지 다시 확인할 때는 이미 확인한 같은 내용이라 다시 묻지 않는다. */
    if (uncertain && operationId) { send(operationId); return; }
    const problem = adminRefundAccountEntryProblem(draft);
    if (problem) { setResult({ ok: false, text: problem }); return; }
    asking.current = true;
    let confirmed = false;
    try { confirmed = await adminConfirm(virtualAccountRefundAccountEntryConfirm({ claimType, ...draft, refundAmount })); }
    catch { confirmed = false; }
    finally { asking.current = false; }
    if (!confirmed) return;
    /* 같은 입력으로 다시 누르면 같은 작업 번호(서버가 같은 결과를 돌려준다). 입력을 바꾸면 새 번호다. */
    const id = operationId ?? crypto.randomUUID();
    setOperationId(id);
    send(id);
  }

  function change(key: keyof typeof BLANK, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setOperationId(null);
  }

  return <AdminNotice role="status" tone="warning" title={invalid ? '결제사가 환불 계좌를 받지 않았습니다' : '환불 계좌가 없어 환불이 멈춰 있습니다'}>
    <form className="flex min-w-0 flex-col gap-3" data-virtual-account-refund-account-entry={claimType} onSubmit={(event) => { void submit(event); }}>
      <p>{invalid
        ? '고객에게 계좌를 다시 적어 달라는 알림과 메일을 보냈습니다. 고객이 전화나 문의로 알려 주면 은행·계좌번호·예금주가 통장과 같은지 확인해 아래에 대신 적습니다.'
        : '고객에게 주문 상세에서 계좌를 적어 달라는 알림과 메일을 보냈습니다. 고객이 전화나 문의로 계좌를 알려 주면 아래에 대신 적습니다.'}</p>
      <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-3" disabled={pending || uncertain}>
        <AdminField inputId={`${idPrefix}-bank`} label="은행">
          {/* 결제대행사에 은행 코드를 보낸다 — 고객 화면과 같은 목록에서 고른다. */}
          <NativeSelect id={`${idPrefix}-bank`} onChange={(event) => change('bankName', event.target.value)} required value={draft.bankName}>
            <NativeSelectOption value="">은행 선택</NativeSelectOption>
            {TOSS_REFUND_BANKS.map((bank) => <NativeSelectOption key={bank.code} value={bank.name}>{bank.name}</NativeSelectOption>)}
          </NativeSelect>
        </AdminField>
        <AdminField hint={ADMIN_REFUND_ACCOUNT_NUMBER_RULE} inputId={`${idPrefix}-number`} label="계좌번호">
          <Input aria-describedby={`${idPrefix}-number-hint`} autoComplete="off" id={`${idPrefix}-number`} inputMode="numeric" maxLength={30}
            onChange={(event) => change('accountNumber', event.target.value)} placeholder="예: 000-000-000000" required value={draft.accountNumber} />
        </AdminField>
        <AdminField inputId={`${idPrefix}-holder`} label="예금주">
          <Input autoComplete="off" id={`${idPrefix}-holder`} maxLength={40} onChange={(event) => change('accountHolder', event.target.value)}
            placeholder="예: 김엑스" required value={draft.accountHolder} />
        </AdminField>
        <div className="sm:col-span-3">
          <AdminField hint="누가 어떻게 알려 줬는지 적습니다. 감사 기록에 남습니다." inputId={`${idPrefix}-reason`} label="입력 사유 (필수)">
            <Input aria-describedby={`${idPrefix}-reason-hint`} id={`${idPrefix}-reason`} maxLength={200} minLength={2} onChange={(event) => change('reason', event.target.value)}
              placeholder={ADMIN_REFUND_ACCOUNT_REASON_EXAMPLE} required value={draft.reason} />
          </AdminField>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} size="sm" type="submit">{pending ? '저장 중…' : uncertain ? SAVE_CHECK_LABEL : VIRTUAL_ACCOUNT_REFUND_ACCOUNT_SAVE_LABELS[claimType]}</Button>
        {/* 확인이 계속 안 되면 입력을 다시 연다. 앞서 누른 저장이 됐더라도 새로 적은 계좌가 그 자리를 바꾸거나, 이미 환불을 시작했으면 DB가 막는다. */}
        {uncertain ? <Button disabled={pending} onClick={() => { setUncertain(false); setOperationId(null); setResult(null); }} size="sm" variant="outline">그만두고 다시 하기</Button> : null}
      </div>
      {result ? <p role={result.ok ? 'status' : 'alert'}>{result.text}</p> : null}
    </form>
  </AdminNotice>;
}
