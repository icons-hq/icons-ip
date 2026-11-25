'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { saveVirtualAccountRefundAccountAction } from '@/app/admin/virtual-account-refund-actions';
import { AdminField, AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
import { showsVirtualAccountRefundAccountEntry } from '@/lib/admin/virtual-account-refund-account';
import { TOSS_REFUND_BANKS } from '@/lib/payments/toss-bank-codes';

const BLANK = { bankName: '', accountNumber: '', accountHolder: '', reason: '' };

/**
 * 가상계좌 환급 계좌 대신 입력(ADR-0049 결정 5 보강, 2026-11-25). 입금된 가상계좌 주문의 취소·반품 환불이 계좌 때문에 결제확인필요
 * (provider_refund_account_required·provider_refund_account_invalid)로 멈췄을 때 주문 처리 패널·클레임 상세에 보인다. 구매자에게는 앱 알림·메일이
 * 이미 갔고, 구매자가 전화 등으로 알려준 계좌를 운영자가 넣는 칸이다. 저장하면 취소는 시스템이 이 계좌로 다시 환불하고, 반품은 [환불 완료 확정]·
 * [상태 다시 확인]을 누른다. 입력 가능 여부·계좌 판정은 서버가 다시 한다(구매자 입력과 같은 규칙).
 */
export function VirtualAccountRefundAccountEntry({ claimId, claimType, lastErrorCode, orderId }: {
  claimId: string;
  claimType: string;
  lastErrorCode: string | null | undefined;
  orderId: string;
}) {
  if (!showsVirtualAccountRefundAccountEntry(lastErrorCode) || (claimType !== 'cancel' && claimType !== 'return')) return null;
  return <EntryForm claimId={claimId} claimType={claimType} invalid={lastErrorCode === 'provider_refund_account_invalid'} orderId={orderId} />;
}

function EntryForm({ claimId, claimType, invalid, orderId }: { claimId: string; claimType: 'cancel' | 'return'; invalid: boolean; orderId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState(BLANK);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  useClaimPreviewBusy(pending);
  const dirty = Object.values(draft).some(Boolean);
  useAdminLeaveGuard({ dirty, blocked: pending, message: '저장하지 않은 환불 계좌 입력은 남지 않고 사라집니다. 화면을 나가시겠습니까?' });
  const idPrefix = `va-refund-account-${claimId}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    /* 같은 입력으로 다시 누르면 같은 작업 번호(서버가 같은 결과를 돌려준다). 입력을 바꾸면 새 번호다. */
    const id = operationId ?? crypto.randomUUID();
    setOperationId(id);
    startTransition(async () => {
      const outcome = await saveVirtualAccountRefundAccountAction({ claimId, orderId, claimType, operationId: id, ...draft });
      if (outcome.ok) {
        setDraft(BLANK);
        setOperationId(null);
        setResult({ ok: true, text: outcome.message });
        router.refresh();
      } else {
        setResult({ ok: false, text: outcome.error });
      }
    });
  }

  function change(key: keyof typeof BLANK, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setOperationId(null);
  }

  return <AdminNotice role="status" tone="warning" title={invalid ? '결제사가 환불 계좌를 받지 않았습니다' : '환불 계좌가 없어 환불이 멈춰 있습니다'}>
    <form className="flex min-w-0 flex-col gap-3" data-virtual-account-refund-account-entry={claimType} onSubmit={submit}>
      <p>고객에게 앱 알림과 메일로 주문 상세에서 계좌를 입력해 달라고 안내했습니다. 고객이 전화 등으로 계좌를 알려주면 여기에 입력합니다. 저장하면 {claimType === 'cancel'
        ? '시스템이 이 계좌로 환불을 다시 요청합니다.'
        : '클레임 상세의 [환불 완료 확정](주문 처리 패널은 [상태 다시 확인])을 눌러 이 계좌로 환불합니다.'} 결제한 분 명의의 계좌인지 확인하고, 입력 사유는 감사 기록에 남습니다.</p>
      <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-3" disabled={pending}>
        <AdminField inputId={`${idPrefix}-bank`} label="은행">
          {/* 결제대행사에 은행 코드를 보낸다 — 고객 화면과 같은 목록에서 고른다. */}
          <NativeSelect id={`${idPrefix}-bank`} onChange={(event) => change('bankName', event.target.value)} required value={draft.bankName}>
            <NativeSelectOption value="">은행 선택</NativeSelectOption>
            {TOSS_REFUND_BANKS.map((bank) => <NativeSelectOption key={bank.code} value={bank.name}>{bank.name}</NativeSelectOption>)}
          </NativeSelect>
        </AdminField>
        <AdminField hint="숫자 6~20자리(하이픈 제외)" inputId={`${idPrefix}-number`} label="계좌번호">
          <Input aria-describedby={`${idPrefix}-number-hint`} autoComplete="off" id={`${idPrefix}-number`} inputMode="numeric" maxLength={30}
            onChange={(event) => change('accountNumber', event.target.value)} placeholder="예: 110123456789" required value={draft.accountNumber} />
        </AdminField>
        <AdminField inputId={`${idPrefix}-holder`} label="예금주">
          <Input autoComplete="off" id={`${idPrefix}-holder`} maxLength={40} onChange={(event) => change('accountHolder', event.target.value)}
            placeholder="예: 김엑스" required value={draft.accountHolder} />
        </AdminField>
        <div className="sm:col-span-3">
          <AdminField hint="누가 어떤 경로로 알려줬는지 적습니다(2~200자)." inputId={`${idPrefix}-reason`} label="입력 사유">
            <Input aria-describedby={`${idPrefix}-reason-hint`} id={`${idPrefix}-reason`} maxLength={200} onChange={(event) => change('reason', event.target.value)}
              placeholder="예: 11/26 고객 전화로 계좌 확인" required value={draft.reason} />
          </AdminField>
        </div>
      </fieldset>
      <div>
        <Button disabled={pending} size="sm" type="submit">{pending ? '저장 중…' : '환불 계좌 저장'}</Button>
      </div>
      {result ? <p role={result.ok ? 'status' : 'alert'}>{result.text}</p> : null}
    </form>
  </AdminNotice>;
}
