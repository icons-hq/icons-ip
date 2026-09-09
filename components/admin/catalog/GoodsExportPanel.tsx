'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { requestExportAction } from '@/app/admin/export-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { SeededForm } from '@/components/admin/form-seed';
import { ADMIN_EXPORTS_PATH, goodsExportTemplates, type AdminExportTemplate } from '@/lib/admin/exports';

const emptyState: AdminCatalogActionState = {};

function stampClientKey(event: React.FormEvent<HTMLFormElement>) {
  const input = event.currentTarget.elements.namedItem('clientKey');
  if (input instanceof HTMLInputElement) input.value = crypto.randomUUID();
}

/*
 * 굿즈 목록에서 ERP 등록용으로 내려받기 (PM 2026-09-09).
 *
 * 여기 등록한 굿즈를 ERP 에 옮겨 적는 사람의 입력 파일이다. 기본 양식은 ERP 품목정보 열 순서(46열)
 * 그대로이고, 열을 넣고 빼려면 설정 › 엑셀 양식에서 복제한다 — 그 문을 여기서 바로 연다.
 * 조건은 목록이 보고 있는 IP 를 물려받는다(전체면 전체).
 */
export function GoodsExportPanel({
  ipId,
  templates,
}: {
  ipId: string | null;
  templates: readonly AdminExportTemplate[];
}) {
  const options = goodsExportTemplates(templates);
  const [state, action, pending] = useActionState(requestExportAction, emptyState);
  const [templateId, setTemplateId] = useState(options[0]?.id ?? '');
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
      {ipId ? <input name="ipId" type="hidden" value={ipId} /> : null}
      <span className="mono" style={{ fontSize: 12 }}>ERP 등록용 내려받기</span>
      <label className="admin-dispatch-export-field">
        <span className="mono">양식</span>
        <select
          className="admin-field-control"
          name="templateId"
          onChange={(event) => setTemplateId(event.target.value)}
          value={templateId}
        >
          {options.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </label>
      <label className="admin-dispatch-export-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <input name="includeArchived" type="checkbox" />
        <span>보관 굿즈 포함</span>
      </label>
      <button className="btn btn-sm" disabled={pending} type="submit">
        {pending ? '요청 중' : '내보내기 요청'}
      </button>
      <Link className="btn btn-sm btn-ghost" href={`${ADMIN_EXPORTS_PATH}?source=${encodeURIComponent(templateId)}`}>
        열 넣고 빼기
      </Link>
      <div aria-live="polite" className="admin-order-action-feedback">
        {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
        {state.message ? <span role="status">{state.message} · 파일은 설정 › 엑셀 양식에서 받습니다.</span> : null}
      </div>
    </SeededForm>
  );
}
