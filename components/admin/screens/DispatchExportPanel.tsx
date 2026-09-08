'use client';

import { useActionState } from 'react';
import { requestExportAction } from '@/app/admin/export-actions';
import { SeededForm } from '@/components/admin/form-seed';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminExportTemplate } from '@/lib/admin/exports';
import type { AdminStockLocation } from '@/lib/admin/variants';

const emptyState: AdminCatalogActionState = {};

function stampClientKey(event: React.FormEvent<HTMLFormElement>) {
  const input = event.currentTarget.elements.namedItem('clientKey');
  if (input instanceof HTMLInputElement) input.value = crypto.randomUUID();
}

/*
 * 발주서 내보내기 (현업 슬라이스 3 · 3-2 #2).
 *
 * **양식을 여기서 고른다.** 김포와 서원은 운송장 출력 양식이 다른데, 지금까지 양식은
 * 설정 화면에만 있었다 — 발주를 확인하던 사람이 화면을 옮겼다 돌아와야 했다.
 *
 * 액션은 설정 화면과 **같은 것**을 쓴다. 발주서 전용 경로를 새로 만들면 권한·사유·멱등
 * 규칙이 두 벌이 된다.
 */
export function DispatchExportPanel({
  locations,
  templates,
}: {
  locations: readonly AdminStockLocation[];
  templates: readonly AdminExportTemplate[];
}) {
  const [state, action, pending] = useActionState(requestExportAction, emptyState);
  const orderTemplates = templates.filter((entry) => entry.target !== 'goods');

  if (orderTemplates.length === 0) return null;

  return (
    <SeededForm
      values={state.values}
      action={action}
      className="card admin-dispatch-export"
      onSubmit={stampClientKey}
      style={{ borderRadius: 10, gap: 10, padding: 14 }}
    >
      <input name="clientKey" type="hidden" value="" />
      {/* 발주서는 아직 안 보낸 주문만 뽑는다 — 이미 나간 건까지 담으면 창고가 두 번 싼다. */}
      <input name="unshippedOnly" type="hidden" value="on" />
      <span className="mono" style={{ fontSize: 11 }}>발주서 내보내기</span>
      <label className="admin-dispatch-export-field">
        <span className="mono">양식</span>
        <select className="admin-field-control" name="templateId">
          {orderTemplates.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}{entry.securityLevel === 'pii' ? ' (개인정보 포함)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="admin-dispatch-export-field">
        <span className="mono">출고지</span>
        <select className="admin-field-control" name="locationId">
          <option value="">전체</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>{location.name}</option>
          ))}
        </select>
      </label>
      <label className="admin-dispatch-export-field">
        <span className="mono">사유 (개인정보 양식만)</span>
        <input className="admin-field-control" maxLength={200} name="reason" placeholder="발주서 출력" />
      </label>
      <button className="btn btn-sm" disabled={pending} type="submit">
        {pending ? '요청 중' : '내보내기 요청'}
      </button>
      <div aria-live="polite" className="admin-order-action-feedback">
        {state.errors?.form ?? state.errors?.reason ? (
          <span role="alert">{state.errors?.form ?? state.errors?.reason}</span>
        ) : null}
        {state.message ? <span role="status">{state.message} · 파일은 설정 › 엑셀 양식에서 받습니다.</span> : null}
      </div>
    </SeededForm>
  );
}
