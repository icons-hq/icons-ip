'use client';

import { useRef, useState } from 'react';
import { saveAdminOrderDispatchDelayAction } from '@/app/admin/order-actions';
import { closeAdminDialog } from '@/lib/admin/dialog-close';
import { ADMIN_DISPATCH_DELAY_REASON_MAX } from '@/lib/admin/dispatch';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import type { ShipmentConsoleNotice } from './ShipmentConsoleContext';

/*
 * 발송 지연 탭에서 고른 주문에 같은 지연 메모를 한 번에 넣는다(화면 규칙 6 — 여러 대상에 같은 값은 한 번에).
 * 같은 상품의 입고가 늦어지면 수십 줄에 같은 글을 줄마다 적어야 했다.
 * 새 저장 경로는 없다: 줄의 [메모 저장]과 같은 저장을 주문마다 차례로 부르고, 넣지 못한 주문은 건너뛰어 번호로 알린다.
 * 메모는 운영 기록이며 고객에게 보이지 않는다(DispatchDelayNoteForm과 같다).
 */
const FIELD = 'flex min-w-0 flex-col gap-1.5 [&>span]:font-medium';
/** 넣지 못한 주문번호를 결과 문구에 몇 개까지 적는가. */
const FAILED_SHOWN = 10;

export interface DispatchDelayBulkTarget { orderId: string; reference: string }

export function DispatchDelayBulkNote({ targets, onClose, onDone }: {
  /** 고른 배송 건의 주문(주문마다 한 번). reference는 화면에 보이는 주문번호다. */
  targets: readonly DispatchDelayBulkTarget[];
  onClose: () => void;
  /** 결과를 표 위 알림으로 올린다. */
  onDone: (notice: ShipmentConsoleNotice) => void;
}) {
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  /* null이면 아직 누르지 않았다. 숫자면 그만큼 처리했다(넣는 중). */
  const [progress, setProgress] = useState<number | null>(null);
  const running = useRef(false);
  const busy = progress !== null;
  const trimmed = reason.trim();

  async function save() {
    if (running.current || !trimmed || !targets.length) return;
    running.current = true;
    setProgress(0);
    const failed: string[] = [];
    let saved = 0;
    for (const target of targets) {
      const data = new FormData();
      data.set('orderId', target.orderId);
      data.set('reason', trimmed);
      data.set('expectedShipDate', date);
      try {
        const result = await saveAdminOrderDispatchDelayAction({}, data);
        if (result.errors) failed.push(target.reference); else saved += 1;
      } catch {
        failed.push(target.reference);
      }
      setProgress(saved + failed.length);
    }
    running.current = false;
    const count = (value: number) => value.toLocaleString('ko-KR');
    const skipped = failed.length
      ? ` 넣지 못한 ${count(failed.length)}건은 건너뛰었습니다: ${failed.slice(0, FAILED_SHOWN).join(', ')}${failed.length > FAILED_SHOWN ? ` 외 ${count(failed.length - FAILED_SHOWN)}건` : ''}. 이미 발송했거나 취소된 주문일 수 있으니 목록을 새로고침해 확인해주세요.`
      : '';
    onDone(saved
      ? { tone: failed.length ? 'warning' : 'success', message: `주문 ${count(saved)}건에 지연 메모를 넣었습니다.${skipped}` }
      : { tone: 'danger', message: `지연 메모를 넣지 못했습니다.${skipped}` });
    onClose();
  }

  /* 적은 사유·예정일이 있으면 닫기 전에 묻는다(화면 규칙 7). 넣는 중에는 닫지 못한다. */
  const close = () => { if (!busy) closeAdminDialog(trimmed !== '' || date !== '', onClose, () => document.querySelector('[data-dispatch-delay-bulk]')); };

  return <CustomerServiceDialog busy={busy} onClose={close} title="지연 메모 한 번에 넣기">
    <form className="flex flex-col gap-3 text-sm leading-relaxed" data-dispatch-delay-bulk="" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p>고른 주문 {targets.length.toLocaleString('ko-KR')}건에 같은 메모를 넣습니다. 이미 메모가 있는 주문은 이 내용으로 바뀝니다. 고객에게는 보이지 않습니다.</p>
      <label className={FIELD}><span>지연 사유 (필수)</span>
        <Input autoFocus data-dialog-autofocus="" disabled={busy} maxLength={ADMIN_DISPATCH_DELAY_REASON_MAX} name="reason" onChange={(event) => setReason(event.target.value)} placeholder="예: 제조사 입고 지연" required value={reason} /></label>
      <label className={FIELD}><span>발송 예정일 (선택)</span>
        <Input className="w-44" disabled={busy} name="expectedShipDate" onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {busy ? <span className="mr-auto text-muted-foreground tabular-nums" role="status">넣는 중… {progress} / {targets.length}</span>
          : !trimmed ? <span className="mr-auto text-xs text-muted-foreground">지연 사유를 적으면 누를 수 있습니다.</span> : null}
        <Button disabled={busy} onClick={close} type="button" variant="outline">닫기</Button>
        <Button disabled={busy || !trimmed || !targets.length} type="submit">{busy ? '넣는 중…' : `${targets.length.toLocaleString('ko-KR')}건에 메모 넣기`}</Button>
      </div>
    </form>
  </CustomerServiceDialog>;
}
