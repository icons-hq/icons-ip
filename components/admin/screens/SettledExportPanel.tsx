'use client';

import { useActionState } from 'react';
import { requestExportAction } from '@/app/admin/export-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { SeededForm } from '@/components/admin/form-seed';
import type { AdminExportTemplate } from '@/lib/admin/exports';

const emptyState: AdminCatalogActionState = {};

function stampClientKey(event: React.FormEvent<HTMLFormElement>) {
  const input = event.currentTarget.elements.namedItem('clientKey');
  if (input instanceof HTMLInputElement) input.value = crypto.randomUUID();
}

/** 거래확정 양식만 — 발주서 양식을 여기서 고르면 확정 조건과 어긋난 빈 파일이 나온다. */
export function settledExportTemplates(templates: readonly AdminExportTemplate[]) {
  return templates.filter((entry) => entry.target === 'order_items' && entry.defaultFilters?.status === 'done');
}

/*
 * 거래확정 내역 내보내기 (현업 3-3).
 *
 * 이 파일은 보고서가 아니라 **ERP 매출내역 업로드의 입력**이다 — 온라인 MD 넷이 지금 손으로
 * 만드는 표. 그래서 화면에서 바로 뽑는다: 설정 화면으로 갔다 오면 「어느 조건으로 뽑았는지」가
 * 흐려진다. 조건은 **이 화면이 보고 있는 주문일 범위**를 그대로 물려받고, 상태는 확정(done)으로
 * 고정한다 — 사람이 고를 수 없게 해야 결제만 된 주문이 정산 파일에 섞이지 않는다.
 */
export function SettledExportPanel({
  from,
  templates,
  to,
}: {
  from: string | null;
  templates: readonly AdminExportTemplate[];
  to: string | null;
}) {
  const [state, action, pending] = useActionState(requestExportAction, emptyState);
  const options = settledExportTemplates(templates);
  if (options.length === 0) return null;

  return (
    <SeededForm
      values={state.values}
      action={action}
      className="card admin-dispatch-export"
      onSubmit={stampClientKey}
      style={{ borderRadius: 10, gap: 10, padding: 14 }}
    >
      <input name="clientKey" type="hidden" value="" />
      {/* 확정된 주문만 — 정산 파일에 결제만 된 주문이 섞이면 매출이 앞당겨 잡힌다. */}
      <input name="status" type="hidden" value="done" />
      <span className="mono" style={{ fontSize: 12 }}>거래확정 내역 내보내기 (ERP 매출 업로드용)</span>
      <label className="admin-dispatch-export-field">
        <span className="mono">양식</span>
        <select className="admin-field-control" name="templateId">
          {options.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </label>
      <label className="admin-dispatch-export-field">
        <span className="mono">주문일 시작</span>
        <input className="admin-field-control" defaultValue={from ?? ''} name="from" type="date" />
      </label>
      <label className="admin-dispatch-export-field">
        <span className="mono">주문일 종료</span>
        <input className="admin-field-control" defaultValue={to ?? ''} name="to" type="date" />
      </label>
      <button className="btn btn-sm" disabled={pending} type="submit">
        {pending ? '요청 중' : '내보내기 요청'}
      </button>
      <div aria-live="polite" className="admin-order-action-feedback">
        {state.errors?.form ?? state.errors?.from ?? state.errors?.to ? (
          <span role="alert">{state.errors?.form ?? state.errors?.from ?? state.errors?.to}</span>
        ) : null}
        {state.message ? <span role="status">{state.message} · 파일은 설정 › 엑셀 양식에서 받습니다.</span> : null}
      </div>
    </SeededForm>
  );
}
