'use client';

import { useActionState } from 'react';
import {
  bulkNoteDispatchDelayAction,
  type AdminOrderActionState,
} from '@/app/admin/order-actions';
import { SeededForm } from '@/components/admin/form-seed';

const EMPTY_ACTION_STATE: AdminOrderActionState = {};

export interface DispatchDelayCandidate {
  orderId: string;
  reference: string;
  recipientName: string;
  confirmedDays: number | null;
}

/*
 * 발송지연 일괄 안내 (현업 슬라이스 3).
 *
 * 지연은 대개 한 원인으로 여러 주문에 온다 — 하나씩 적으면 열 건에 열 번 같은 문장을 친다.
 *
 * **안내 보내기는 기본으로 꺼 둔다.** 켜는 것은 한 번 더 생각하게 하고, 끄는 것은 잊게 한다 —
 * 알림은 되돌릴 수 없다.
 */
export function DispatchDelayBulkForm({ candidates }: { candidates: DispatchDelayCandidate[] }) {
  const [state, action, pending] = useActionState(bulkNoteDispatchDelayAction, EMPTY_ACTION_STATE);

  if (candidates.length === 0) return null;

  return (
    <SeededForm
      values={state.values}
      action={action}
      className="card col admin-dispatch-bulk"
      style={{ borderRadius: 10, gap: 12, padding: 16 }}
    >
      <div>
        <span className="eyebrow">BULK</span>
        <h3 style={{ fontSize: 15, margin: '4px 0 0' }}>발송지연 일괄 안내</h3>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '4px 0 0' }}>
          고른 주문에 같은 사유를 한 번에 적습니다. 사유 없이는 보낼 수 없습니다.
        </p>
      </div>

      <fieldset className="col admin-dispatch-bulk-list" style={{ border: 0, gap: 4, margin: 0, padding: 0 }}>
        <legend className="mono" style={{ fontSize: 12, padding: 0 }}>안내할 주문</legend>
        {candidates.map((candidate) => (
          <label className="row" key={candidate.orderId} style={{ alignItems: 'center', gap: 8 }}>
            <input name="orderIds" type="checkbox" value={candidate.orderId} />
            <span style={{ fontSize: 13 }}>
              {candidate.reference} · {candidate.recipientName}
              {candidate.confirmedDays === null ? '' : ` · 발주확인 ${candidate.confirmedDays}일째`}
            </span>
          </label>
        ))}
      </fieldset>

      <label className="col" style={{ gap: 6 }}>
        <span className="mono" style={{ fontSize: 12 }}>지연 사유 (그대로 안내에 실립니다)</span>
        <textarea
          className="admin-field-control"
          maxLength={500}
          name="reason"
          placeholder="공급사 입고 지연으로 발송이 늦어지고 있습니다"
          rows={2}
        />
        {state.errors?.reason ? <span role="alert" style={{ color: 'var(--pink)', fontSize: 12 }}>{state.errors.reason}</span> : null}
      </label>

      <label className="col" style={{ gap: 6 }}>
        <span className="mono" style={{ fontSize: 12 }}>발송 예정일 (모르면 비웁니다)</span>
        <input className="admin-field-control" name="expectedShipDate" type="date" />
        {state.errors?.expectedShipDate ? <span role="alert" style={{ color: 'var(--pink)', fontSize: 12 }}>{state.errors.expectedShipDate}</span> : null}
      </label>

      <label className="row" style={{ gap: 8 }}>
        <input name="notify" type="checkbox" />
        <span style={{ fontSize: 13 }}>주문자에게 알림 보내기 — 되돌릴 수 없습니다</span>
      </label>

      <div aria-live="polite" className="admin-order-action-feedback">
        {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
        {state.message ? <span role="status">{state.message}</span> : null}
      </div>

      <button className="btn btn-sm" disabled={pending} style={{ justifySelf: 'start' }} type="submit">
        {pending ? '기록 중' : '지연 사유 기록'}
      </button>
    </SeededForm>
  );
}
