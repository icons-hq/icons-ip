'use client';

import Link from 'next/link';
import { useActionState, useState, type FormEvent } from 'react';
import {
  applyImportAction,
  cancelExportAction,
  issueExportDownloadAction,
  registerImportAction,
  requestExportAction,
  upsertExportTemplateAction,
  type AdminImportActionState,
} from '@/app/admin/export-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { ConsolePagination } from '@/components/admin/console';
import {
  ADMIN_EXPORTS_PATH,
  EXPORT_STATUSES,
  EXPORT_STATUS_LABELS,
  adminExportsHref,
  describeExportFilters,
  type AdminExportJob,
  type AdminExportTemplate,
  type AdminExportsFilters,
} from '@/lib/admin/exports';
import type { AdminExportJobList } from '@/lib/admin/exports.server';
import { IMPORT_KINDS } from '@/lib/admin/imports';
import type { AdminStockLocation } from '@/lib/admin/variants';
import { Icon } from '@/components/ui/Icon';
import { Field, FormShell, InlineNotice, SelectField, TextArea } from '../fields';

/*
 * 엑셀 양식 · 내보내기 (설계서 v2 §1-7).
 *
 * 화면은 파일을 만들지 않는다 — 조건을 담아 요청하면 워커가 만들고, 목록에서 받는다.
 * 개인정보가 든 양식은 권한과 사유가 있어야 요청·다운로드가 열리고, 받아 간 사건은 전부 기록된다.
 */

const emptyState: AdminCatalogActionState = {};
const emptyDownloadState: AdminCatalogActionState & { url?: string } = {};
const emptyImportState: AdminImportActionState = {};

function formatBytes(bytes: number | null) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatDate(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

/** 제출 직전에 새 요청 키를 만든다 — 같은 폼을 두 번 눌러도 잡이 하나만 생긴다. */
function stampClientKey(event: FormEvent<HTMLFormElement>) {
  const input = event.currentTarget.elements.namedItem('clientKey');
  if (input instanceof HTMLInputElement) input.value = crypto.randomUUID();
}

function RequestPanel({
  canSecureExport,
  ipOptions,
  locations,
  templates,
}: {
  canSecureExport: boolean;
  ipOptions: readonly { id: string; title: string }[];
  locations: readonly AdminStockLocation[];
  templates: readonly AdminExportTemplate[];
}) {
  const [state, action, pending] = useActionState(requestExportAction, emptyState);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const template = templates.find((entry) => entry.id === templateId) ?? null;
  const needsReason = template?.securityLevel === 'pii';
  /* 양식이 무엇을 뽑는지에 따라 물어볼 것이 다르다 — 상품 양식에 「주문 상태」를 묻지 않는다. */
  const isGoodsTarget = template?.target === 'goods';

  return (
    <form action={action} className="card col" onSubmit={stampClientKey} style={{ borderRadius: 10, gap: 12, padding: 18 }}>
      <div>
        <span className="eyebrow">EXPORT</span>
        <h2 style={{ fontSize: 16, margin: '6px 0 0' }}>내보내기 요청</h2>
      </div>
      <input name="clientKey" type="hidden" value="" />
      <div className="admin-form-grid">
        <SelectField
          error={state.errors?.templateId}
          label="양식"
          name="templateId"
          onChange={(event) => setTemplateId(event.target.value)}
          value={templateId}
        >
          {templates.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}{entry.securityLevel === 'pii' ? ' (개인정보 포함)' : ''}
            </option>
          ))}
        </SelectField>
        {isGoodsTarget ? (
          <SelectField label="IP" name="ipId">
            <option value="">전체</option>
            {ipOptions.map((ip) => <option key={ip.id} value={ip.id}>{ip.title}</option>)}
          </SelectField>
        ) : (
          <>
            <Field error={state.errors?.from} label="주문일 시작" name="from" type="date" />
            <Field error={state.errors?.to} label="주문일 종료" name="to" type="date" />
            <SelectField error={state.errors?.status} label="주문 상태" name="status">
              <option value="">전체</option>
              <option value="paid">결제 완료</option>
              <option value="confirmed">발주 확인</option>
              <option value="shipping">배송중</option>
              <option value="delivered">배송 완료</option>
              <option value="done">구매 확정</option>
            </SelectField>
            <SelectField label="출고지" name="locationId">
              <option value="">전체</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </SelectField>
          </>
        )}
      </div>
      <label className="admin-variant-value">
        {isGoodsTarget ? (
          <><input name="includeArchived" type="checkbox" /> 보관한 상품도 포함</>
        ) : (
          <><input name="unshippedOnly" type="checkbox" /> 아직 안 보낸 주문만 (발주서용)</>
        )}
      </label>
      {template?.description ? (
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>{template.description}</p>
      ) : null}
      {needsReason ? (
        <TextArea
          error={state.errors?.reason}
          label="사유 (개인정보 양식은 필수 · 기록에 남습니다)"
          maxLength={200}
          name="reason"
          placeholder="창고 발주 · ERP 연동 등"
          required
        />
      ) : null}
      {needsReason && !canSecureExport ? (
        <p role="alert" style={{ color: 'var(--pink)', fontSize: 12, margin: 0 }}>
          이 양식에는 개인정보가 들어 있습니다. 관리자에게 「개인정보 내보내기」 권한을 받아야 요청할 수 있습니다.
        </p>
      ) : null}
      <InlineNotice state={state} />
      <button className="btn btn-holo" disabled={pending || templates.length === 0} style={{ justifySelf: 'start', minWidth: 150 }}>
        <Icon name="check" size={15} /> {pending ? '요청 중' : '내보내기 요청'}
      </button>
    </form>
  );
}

function JobRow({ canSecureExport, job, now }: { canSecureExport: boolean; job: AdminExportJob; now: string }) {
  const [downloadState, downloadAction, downloadPending] = useActionState(issueExportDownloadAction, emptyDownloadState);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelExportAction, emptyState);
  const pii = job.securityLevel === 'pii';
  /* 만료 판정 시각은 서버 컴포넌트가 요청당 한 번 만든다 — 렌더 중 시계를 읽으면 순수하지 않다. */
  const expired = job.expiresAt !== null && Date.parse(job.expiresAt) <= Date.parse(now);

  return (
    <tr>
      <td>
        <span className="col" style={{ gap: 2 }}>
          <span>
            {job.templateName}
            {pii ? <span className="admin-badge" style={{ marginLeft: 6 }}>개인정보</span> : null}
          </span>
          <span className="muted" style={{ fontSize: 11 }}>{describeExportFilters(job.filters)}</span>
        </span>
      </td>
      <td>
        <span className="admin-badge" data-export-status={job.status}>{EXPORT_STATUS_LABELS[job.status] ?? job.status}</span>
        {job.error ? <span className="muted" style={{ display: 'block', fontSize: 11 }}>{job.error}</span> : null}
      </td>
      <td className="mono" data-align="end">{job.rowCount?.toLocaleString('ko-KR') ?? '-'}</td>
      <td className="mono" data-align="end">{formatBytes(job.fileBytes)}</td>
      <td className="muted" style={{ fontSize: 11 }}>
        {job.requesterNickname ?? '-'}<br />{formatDate(job.createdAt)}
      </td>
      <td>
        {job.status === 'done' && !expired ? (
          <form action={downloadAction} className="col" style={{ gap: 6 }}>
            <input name="jobId" type="hidden" value={job.id} />
            {pii ? (
              <input aria-label="다운로드 사유" className="admin-field-control" name="reason" placeholder="다운로드 사유" required style={{ minWidth: 160 }} />
            ) : null}
            <button className="btn btn-sm btn-holo" disabled={downloadPending || (pii && !canSecureExport)}>
              {downloadPending ? '만드는 중' : '받기'}
            </button>
            {downloadState.url ? (
              <a className="btn btn-sm btn-ghost" href={downloadState.url} rel="noreferrer" target="_blank">파일 열기</a>
            ) : null}
            <InlineNotice state={downloadState} />
          </form>
        ) : job.status === 'queued' || job.status === 'running' ? (
          <form action={cancelAction}>
            <input name="jobId" type="hidden" value={job.id} />
            <button className="btn btn-sm btn-ghost" disabled={cancelPending}>취소</button>
            <InlineNotice state={cancelState} />
          </form>
        ) : (
          <span className="muted">{expired ? '보관 기간 지남' : '-'}</span>
        )}
      </td>
    </tr>
  );
}

function TemplatePanel({ templates }: { templates: readonly AdminExportTemplate[] }) {
  const [state, action, pending] = useActionState(upsertExportTemplateAction, emptyState);
  const [sourceId, setSourceId] = useState(templates[0]?.id ?? '');
  const source = templates.find((entry) => entry.id === sourceId) ?? null;

  return (
    <form action={action} className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
      <div>
        <span className="eyebrow">TEMPLATE</span>
        <h2 style={{ fontSize: 16, margin: '6px 0 0' }}>양식 복제해서 만들기</h2>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        시스템 양식은 고칠 수 없습니다 — 창고와 ERP 가 그 열 순서를 기대하기 때문입니다. 열을 빼거나 줄이려면 복제해서 쓰세요.
      </p>
      <input name="columnCatalog" type="hidden" value={JSON.stringify(source?.columns ?? [])} />
      <div className="admin-form-grid">
        <SelectField label="복제할 양식" name="sourceId" onChange={(event) => setSourceId(event.target.value)} value={sourceId}>
          {templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </SelectField>
        <Field error={state.errors?.name} label="새 양식 이름" name="name" placeholder="김포 발주서(간단)" required />
        <SelectField
          defaultValue={source?.securityLevel ?? 'normal'}
          error={state.errors?.securityLevel}
          key={`security:${sourceId}`}
          label="보안 등급"
          name="securityLevel"
        >
          <option value="normal">일반</option>
          <option value="pii">개인정보 포함</option>
        </SelectField>
      </div>
      <fieldset className="admin-variant-options">
        <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>담을 열</legend>
        <div className="admin-variant-values">
          {(source?.columns ?? []).map((column, index) => (
            <label className="admin-variant-value" key={`${column.key}:${index}`}>
              <input defaultChecked name="columnKeys" type="checkbox" value={column.key} />
              {column.header}{column.mask ? ' (개인정보)' : ''}
            </label>
          ))}
        </div>
      </fieldset>
      {state.errors?.columnKeys ? <span role="alert" style={{ color: 'var(--pink)', fontSize: 12 }}>{state.errors.columnKeys}</span> : null}
      <FormShell pending={pending} state={state} />
    </form>
  );
}

/**
 * 업로드 — 검증하고, 리포트를 보고, 적용한다.
 *
 * 발주서를 그대로 되돌려 올릴 수 있다. 송장 칸이 빈 줄은 아직 안 보낸 줄이라 건너뛰고,
 * 오류가 있는 줄만 빼고 나머지를 적용한다(「전부 아니면 전무」를 고르면 하나라도 틀리면 아무것도 적용하지 않는다).
 */
function ImportPanel() {
  const [state, action, pending] = useActionState(registerImportAction, emptyImportState);
  const [applyState, applyAction, applyPending] = useActionState(applyImportAction, emptyImportState);
  const applied = Boolean(applyState.message);

  return (
    <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
      <div>
        <span className="eyebrow">IMPORT</span>
        <h2 style={{ fontSize: 16, margin: '6px 0 0' }}>파일 올리기</h2>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        내려받은 발주서에 송장번호만 채워 그대로 올리면 됩니다. 열 위치가 아니라 열 이름으로 읽으므로 다른 열이 섞여 있어도 괜찮습니다.
        올리면 먼저 확인만 하고, 리포트를 본 뒤 적용을 누릅니다.
      </p>
      <form action={action} className="col" style={{ gap: 10 }}>
        <div className="admin-form-grid">
          <SelectField error={state.errors?.kind} label="종류" name="kind">
            {IMPORT_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
          </SelectField>
          <label className="admin-field">
            <span className="admin-field-label">파일 (CSV · 엑셀)</span>
            <input accept=".csv,.tsv,.xlsx,.xls" className="admin-field-control" name="file" required type="file" />
          </label>
        </div>
        <label className="admin-variant-value">
          <input name="atomic" type="checkbox" /> 전부 아니면 전무 (오류가 하나라도 있으면 적용하지 않음)
        </label>
        {state.errors?.file ? <span role="alert" style={{ color: 'var(--pink)', fontSize: 12 }}>{state.errors.file}</span> : null}
        <InlineNotice state={state} />
        <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="check" size={15} /> {pending ? '확인 중' : '파일 확인'}
        </button>
      </form>

      {state.issues && state.issues.length > 0 ? (
        <div className="admin-console-grid-scroll">
          <table className="admin-console-grid-table">
            <thead>
              <tr><th scope="col">줄</th><th scope="col">문제</th></tr>
            </thead>
            <tbody>
              {state.issues.slice(0, 50).map((issue) => (
                <tr key={`${issue.line}:${issue.code}`}>
                  <td className="mono">{issue.line}</td>
                  <td>{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {state.jobId && state.rows && !applied ? (
        <form action={applyAction} className="col" style={{ gap: 10 }}>
          <input name="jobId" type="hidden" value={state.jobId} />
          <input name="rows" type="hidden" value={JSON.stringify(state.rows)} />
          <InlineNotice state={applyState} />
          <button className="btn btn-holo" disabled={applyPending} style={{ justifySelf: 'start', minWidth: 150 }}>
            <Icon name="check" size={15} /> {applyPending ? '적용 중' : '적용하기'}
          </button>
        </form>
      ) : null}
      {applied ? <InlineNotice state={applyState} /> : null}
    </section>
  );
}

export function ExportConsole({
  canSecureExport,
  filters,
  jobs,
  ipOptions,
  locations,
  now,
  templates,
}: {
  canSecureExport: boolean;
  filters: AdminExportsFilters;
  ipOptions: { id: string; title: string }[];
  jobs: AdminExportJobList;
  locations: AdminStockLocation[];
  /** 만료 판정 기준 시각(서버가 만든 ISO 문자열). 렌더 중에 시계를 읽지 않는다. */
  now: string;
  templates: AdminExportTemplate[];
}) {
  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <span className="eyebrow">EXPORTS</span>
          <h1 style={{ fontSize: 22, margin: '6px 0 0' }}>엑셀 양식 · 내보내기</h1>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {canSecureExport ? '개인정보 내보내기 권한 있음' : '개인정보 양식은 권한이 필요합니다'}
        </span>
      </div>

      <RequestPanel canSecureExport={canSecureExport} ipOptions={ipOptions} locations={locations} templates={templates} />

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>요청 이력</h2>
          <span className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <Link className={filters.status ? 'btn btn-sm btn-ghost' : 'btn btn-sm btn-holo'} href={adminExportsHref(filters, { status: null, page: 1 })}>전체</Link>
            {EXPORT_STATUSES.map((status) => (
              <Link
                className={filters.status === status.value ? 'btn btn-sm btn-holo' : 'btn btn-sm btn-ghost'}
                href={adminExportsHref(filters, { status: status.value, page: 1 })}
                key={status.value}
              >
                {status.label}
              </Link>
            ))}
          </span>
        </div>
        <div className="admin-console-grid-scroll">
          <table className="admin-console-grid-table">
            <thead>
              <tr>
                <th scope="col">양식 · 조건</th>
                <th scope="col">상태</th>
                <th data-align="end" scope="col">행</th>
                <th data-align="end" scope="col">크기</th>
                <th scope="col">요청</th>
                <th scope="col">파일</th>
              </tr>
            </thead>
            <tbody>
              {jobs.jobs.map((job) => <JobRow canSecureExport={canSecureExport} job={job} key={job.id} now={now} />)}
              {jobs.jobs.length === 0 ? <tr><td className="muted" colSpan={6}>요청 이력이 없습니다.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <ConsolePagination
          hrefForPage={(page) => adminExportsHref(filters, { page })}
          page={jobs.page}
          pageSize={jobs.size}
          total={jobs.total}
        />
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          파일은 7일 뒤 사라집니다. 다운로드 링크는 10분만 살아 있고, 누가 언제 무엇을 왜 받아 갔는지 기록에 남습니다.
        </p>
      </section>

      <ImportPanel />
      <TemplatePanel templates={templates} />
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        지금은 CSV 로 내보냅니다(엑셀에서 바로 열립니다). 파일 열기 암호가 붙는 보안 엑셀과 상품·재고 일괄 업로드는 다음 단계입니다.
        경로: <span className="mono">{ADMIN_EXPORTS_PATH}</span>
      </p>
    </div>
  );
}
