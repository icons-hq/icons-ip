'use client';

import { useActionState, useState, type FormEvent } from 'react';
import {
  saveAdminOrderDispatchDelayAction,
  type AdminOrderActionState,
} from '@/app/admin/order-actions';
import {
  ADMIN_DISPATCH_DELAY_REASON_MAX,
  type AdminDispatchDelayNote,
} from '@/lib/admin/dispatch';
import { confirmAdminSubmit } from '@/lib/admin/confirm';
import { templateExcerpt } from '@/lib/admin/goods-template-save';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';

const EMPTY_ACTION_STATE: AdminOrderActionState = {};

/**
 * 발송지연 메모 (#251).
 *
 * v1의 지연은 상태가 아니라 메모다. 자사몰이라 지연에 붙는 페널티가 없고,
 * 사다리에 칸을 만들면 발송처리 때 되돌려야 하는 전이가 생긴다.
 *
 * 메모를 없애는 길은 [메모 지우기] 하나다. 예전에는 사유를 비우고 [메모 저장]을 누르면 메모가 말없이 지워졌다 —
 * 이제 비운 채 저장하면 저장하지 않고 이유를 말하고, 지울 때는 무엇이 사라지는지 먼저 묻는다(화면 규칙 7).
 * 서버 계약은 그대로다: 사유를 비워 보내면 메모가 지워진다.
 *
 * 이 메모는 **운영 기록**이며 구매자에게 보이지 않는다. 지연 고지는 문구·기한·
 * 법적 함의가 따로 있는 별개 결정이다.
 */
export function DispatchDelayNoteForm({
  note,
  orderId,
  reference,
}: {
  note: AdminDispatchDelayNote | null;
  orderId: string;
  reference: string;
}) {
  const [state, action, pending] = useActionState(
    async (previous: AdminOrderActionState, data: FormData) => {
      if (data.get('intent') === 'clear') {
        data.set('reason', '');
        data.set('expectedShipDate', '');
      }
      data.delete('intent');
      return saveAdminOrderDispatchDelayAction(previous, data);
    },
    EMPTY_ACTION_STATE,
  );
  /* 사유를 비운 채 [메모 저장]을 눌렀는가. 서버에 보내지 않고 이 자리에서 알린다(입력한 발송 예정일이 지워지지 않게). */
  const [emptyReason, setEmptyReason] = useState(false);
  const fieldError = emptyReason
    ? note ? '지연 사유를 적어주세요. 메모를 없애려면 [메모 지우기]를 누릅니다.' : '지연 사유를 적어주세요.'
    : state.errors?.reason ?? state.errors?.expectedShipDate ?? state.errors?.form;
  /* 저장된 메모가 바뀌면(저장·지우기) 입력칸을 그 값으로 다시 그린다. */
  const savedKey = `${note?.reason ?? ''}|${note?.expectedShipDate ?? ''}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent | undefined)?.submitter as HTMLButtonElement | null | undefined;
    if (submitter?.value === 'clear' && note) {
      setEmptyReason(false);
      confirmAdminSubmit(event, {
        title: `주문 ${reference}의 지연 메모를 지울까요?`,
        message: `'${templateExcerpt(note.reason, 40)}'${note.expectedShipDate ? ` · 발송 예정일 ${note.expectedShipDate}` : ''} 메모가 사라집니다. 고객에게는 보이지 않는 메모입니다.`,
        confirmLabel: '메모 지우기',
        cancelLabel: '돌아가기',
        destructive: true,
      });
      return;
    }
    if (!String(new FormData(event.currentTarget).get('reason') ?? '').trim()) {
      event.preventDefault();
      setEmptyReason(true);
      return;
    }
    setEmptyReason(false);
  }

  return (
    <form action={action} className="flex min-w-0 flex-wrap items-center gap-1.5" onSubmit={submit}>
      <input name="orderId" type="hidden" value={orderId} />
      <Input
        aria-label={`주문 ${reference} 지연 사유`}
        className="h-7 min-w-36 flex-1 text-xs md:text-xs"
        defaultValue={note?.reason ?? ''}
        disabled={pending}
        key={`reason:${savedKey}`}
        maxLength={ADMIN_DISPATCH_DELAY_REASON_MAX}
        name="reason"
        placeholder="지연 사유"
        type="text"
      />
      <Input
        aria-label={`주문 ${reference} 발송 예정일`}
        className="h-7 w-36 text-xs md:text-xs"
        defaultValue={note?.expectedShipDate ?? ''}
        disabled={pending}
        key={`date:${savedKey}`}
        name="expectedShipDate"
        type="date"
      />
      <Button disabled={pending} size="xs" type="submit" variant="outline">
        {pending ? '저장 중' : '메모 저장'}
      </Button>
      {note ? (
        <Button aria-label={`주문 ${reference} 지연 메모 지우기`} disabled={pending} name="intent" size="xs" type="submit" value="clear" variant="ghost">
          메모 지우기
        </Button>
      ) : null}
      <div aria-live="polite" className="basis-full text-xs empty:hidden [&_[role=alert]]:text-destructive [&_[role=status]]:text-success">
        {fieldError ? <span role="alert">{fieldError}</span> : null}
        {!emptyReason && state.message ? <span role="status">{state.message}</span> : null}
      </div>
    </form>
  );
}
