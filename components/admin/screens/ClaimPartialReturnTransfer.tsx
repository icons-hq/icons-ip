'use client';

import { useActionState, useState } from 'react';
import { convertPartialReturnToTransferAction } from '@/app/admin/claim-actions';
import { confirmAdminSubmit, type AdminConfirmRequest } from '@/lib/admin/confirm';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import { krwAmountWords } from '@/lib/format';
import { TOSS_REFUND_BANKS } from '@/lib/payments/toss-bank-codes';
import { useClaimPreviewBusy } from './ClaimPreviewDialog';

/* 결제사가 부분 취소를 받지 않아 닫힌 부분 반품의 출구(ADR-0047, 적대적 리뷰 2026-11-19).
 *
 * 카드사·결제 수단이 부분 취소를 받지 않으면 결제사로는 고른 굿즈 몫만 돌려줄 수 없다. 전액 환불로 돌리지 않고(ADR-0032 결정 4),
 * 결제 담당이 고객에게 받은 계좌로 같은 금액을 송금한다 — 사유와 계좌를 적으면 송금 대기로 적용되고(고른 굿즈 재고 복원 포함),
 * 송금 완료는 주문 상세의 부분 환불 기록에서 증빙으로 적는다. 계좌는 마스킹해 보관하고 원문 열람은 감사 기록이 남는다.
 * 입력은 화면 상태로만 들고 저장소에 보관하지 않는다(계좌 원문). 작업 번호는 처음 그릴 때 정해 재시도에도 같아 이중 전환이 없다.
 *
 * 화면 규칙 PR 3: '확인했습니다' 체크는 없앴다(서버 액션도 그 값을 받지 않는다). 체크가 하던 말은 저장 전 확인창이 금액·계좌·결과로 한다.
 * 은행은 환불 계좌를 받는 다른 칸(가상계좌 환불 계좌 입력)과 같은 목록에서 고른다 — 손으로 적지 않는다. */
export const PARTIAL_RETURN_TRANSFER_REASON_MIN = 5;
export const PARTIAL_RETURN_TRANSFER_REASON_MAX = 500;
/** 서버 액션이 받는 계좌번호 모양(숫자·하이픈 8~30자). */
const ACCOUNT_NUMBER = /^[0-9-]{8,30}$/u;

export interface PartialReturnTransferAccount { bankName: string; accountNumber: string; accountHolder: string }

/**
 * 계좌 송금 전환 확인창. 되돌릴 수 없는 처리(재고 복원·송금 대기 적용)라 셸 확인창에서 금액·적은 계좌·결과를 다시 확인받는다.
 * 계좌는 적은 그대로 되읽어 오타를 잡는다 — 계좌를 넘기지 않으면 금액과 결과만 말한다.
 */
export function partialReturnTransferConfirmRequest(refundAmount: number, account?: PartialReturnTransferAccount): AdminConfirmRequest {
  return {
    title: '계좌 송금 부분 환불로 바꿀까요?',
    message: [
      `결제사 대신 고객 계좌로 ${krwAmountWords(refundAmount)}을 송금하는 환불로 바꿉니다.`,
      ...(account ? [`은행: ${account.bankName.trim()}`, `계좌번호: ${account.accountNumber.trim()}`, `예금주: ${account.accountHolder.trim()}`] : []),
      '고른 상품의 재고를 지금 되돌리고 환불 송금 대기에 올립니다.',
      '송금한 금액은 결제사의 결제 잔액에서 빠지지 않아 결제사 기록과 달라집니다. 그래서 이 주문은 이후 일부 반품을 받지 않고, 남은 상품의 환불은 결제 담당이 개발팀에 요청해 금액을 맞춘 뒤 처리합니다.',
      '되돌릴 수 없습니다.',
    ].join('\n'),
    confirmLabel: '계좌 송금으로 전환',
    cancelLabel: '돌아가기',
    destructive: true,
  };
}

/** 전환 버튼을 누를 수 있는지. 서버 액션의 검사(사유 5~500자, 은행·예금주, 계좌번호 모양)와 같은 규칙이다. */
export function partialReturnTransferReady(input: { reason: string; bankName: string; accountNumber: string; accountHolder: string }): boolean {
  const reason = input.reason.trim();
  return reason.length >= PARTIAL_RETURN_TRANSFER_REASON_MIN && reason.length <= PARTIAL_RETURN_TRANSFER_REASON_MAX
    && input.bankName.trim().length > 0 && ACCOUNT_NUMBER.test(input.accountNumber.trim()) && input.accountHolder.trim().length > 0;
}

export function ClaimPartialReturnTransfer({ claimId, refundAmount, defaultOpen = false }: {
  claimId: string; refundAmount: number;
  /** 처음부터 양식을 펼친다(시험용). 기본은 [계좌 송금 부분 환불로 전환] 버튼만 보인다. */
  defaultOpen?: boolean;
}) {
  const [state, action, pending] = useActionState(convertPartialReturnToTransferAction, {});
  const [operationId] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState(defaultOpen);
  const [reason, setReason] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. */
  /* 적던 사유와 환불 계좌는 저장소에 두지 않는다 — 저장되기 전에 화면을 나가면 사라지므로 나가기 전에 묻는다. */
  useAdminLeaveGuard({
    dirty: !state.message && Boolean(reason || bankName || accountNumber || accountHolder),
    blocked: pending,
    message: '적던 전환 사유와 환불 계좌는 저장되지 않고 사라집니다. 화면을 나갈까요?',
  });
  const ids = { reason: `partial-return-transfer-reason-${claimId}`, bank: `partial-return-transfer-bank-${claimId}`,
    account: `partial-return-transfer-account-${claimId}`, holder: `partial-return-transfer-holder-${claimId}` };
  if (state.message) return <p className="text-muted-foreground" role="status">{state.message}</p>;
  if (!open) {
    return <div className="flex flex-col gap-1.5" data-partial-return-transfer-entry="">
      <Button className="w-fit" onClick={() => setOpen(true)} size="sm" type="button" variant="outline">계좌 송금 부분 환불로 전환</Button>
      <p className="text-xs text-muted-foreground">결제 담당만 씁니다. 고객과 통화해 환불계좌를 받은 뒤 환불 기한(입고 확인 뒤 3영업일) 안에 송금합니다.</p>
    </div>;
  }
  const ready = partialReturnTransferReady({ reason, bankName, accountNumber, accountHolder });
  return <form action={action} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-partial-return-transfer=""
    onSubmit={event => { confirmAdminSubmit(event, partialReturnTransferConfirmRequest(refundAmount, { bankName, accountNumber, accountHolder })); }}>
    <input type="hidden" name="claimId" value={claimId} />
    <input type="hidden" name="operationId" value={operationId} />
    <AdminNotice tone="warning" title={`계좌 송금 부분 환불 — ${krwAmountWords(refundAmount)}`}>
      결제사로 돌려줄 수 없는 고른 상품 몫을 고객 계좌로 송금합니다. 송금한 뒤 주문 상세의 부분 환불 기록에서 [송금 완료 기록]을 누르면 이 요청이 완료됩니다.
    </AdminNotice>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={ids.reason}>전환 사유 (필수)</Label>
      <Textarea id={ids.reason} name="reason" required maxLength={PARTIAL_RETURN_TRANSFER_REASON_MAX} rows={3} value={reason} disabled={pending}
        onChange={event => setReason(event.target.value)} placeholder="예: 11/19 토스 고객센터 확인 — 카드사 부분 취소 불가, 고객 통화로 계좌 송금 동의" />
      <p className="text-xs text-muted-foreground">{PARTIAL_RETURN_TRANSFER_REASON_MIN}~{PARTIAL_RETURN_TRANSFER_REASON_MAX}자. 고객에게는 보이지 않고 감사 기록에 남습니다.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.bank}>은행</Label>
        <NativeSelect className="w-full" disabled={pending} id={ids.bank} name="bankName" onChange={event => setBankName(event.target.value)} required value={bankName}>
          <NativeSelectOption value="">은행 선택</NativeSelectOption>
          {TOSS_REFUND_BANKS.map(bank => <NativeSelectOption key={bank.code} value={bank.name}>{bank.name}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.account}>계좌번호</Label>
        <Input autoComplete="off" disabled={pending} id={ids.account} inputMode="numeric" maxLength={30} name="accountNumber" required value={accountNumber}
          onChange={event => setAccountNumber(event.target.value)} placeholder="예: 000-000-000000" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.holder}>예금주</Label>
        <Input autoComplete="off" disabled={pending} id={ids.holder} maxLength={40} name="accountHolder" required value={accountHolder} onChange={event => setAccountHolder(event.target.value)} />
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button disabled={pending || !ready} size="sm" type="submit" variant="danger">계좌 송금으로 전환</Button>
      <Button disabled={pending} onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">닫기</Button>
    </div>
    {state.error ? <p className="text-destructive" role="alert">{state.error}</p> : null}
  </form>;
}
