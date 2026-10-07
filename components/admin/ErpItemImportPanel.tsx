'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importErpItemsAction, readErpItemFileAction } from '@/app/admin/erp-item-actions';
import { AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import {
  ERP_COLUMN_TARGETS,
  ERP_COLUMN_TARGET_LABELS,
  ERP_ITEM_HEADER_SCAN_ROWS,
  ERP_ITEM_IMPORT_ROW_LIMIT,
  ERP_ITEM_PASTE_CHAR_LIMIT,
  ERP_ITEM_PREVIEW_ROWS,
  assignErpColumnTarget,
  buildErpImportPlan,
  chunkErpImportRows,
  erpImportIssueLabel,
  parseErpDelimitedText,
  boundErpTable,
  normalizeErpText,
  type ErpColumnTarget,
  type ErpImportIssue,
  type ErpImportRow,
} from '@/lib/admin/erp-item-import';
import { formatErpSalePrice } from '@/lib/admin/erp-items';

type ErpImportSource = {
  label: string;
  table: string[][];
  numericColumns: number[];
  warnings: string[];
};

type ErpImportSummary = { inserted: number; updated: number; unchanged: number; rejected: ErpImportIssue[] };

const ISSUE_LIST_LIMIT = 100;

function keptValue(row: ErpImportRow, key: 'category' | 'salePrice' | 'barcode') {
  if (!Object.hasOwn(row, key)) return <span className="admin-erp-items__muted">기존 값 유지</span>;
  if (key === 'salePrice') return row.salePrice === null ? <span className="admin-erp-items__muted">비움</span> : formatErpSalePrice(row.salePrice ?? null);
  const value = row[key];
  return value ? value : <span className="admin-erp-items__muted">비움</span>;
}

function IssueTable({ caption, issues }: { caption: string; issues: ErpImportIssue[] }) {
  if (!issues.length) return null;
  return <div className="admin-erp-items__table-scroll" role="region" aria-label={caption} tabIndex={0}>
    <table className="admin-erp-items__table">
      <caption>{caption}{issues.length > ISSUE_LIST_LIMIT ? ` · 앞 ${ISSUE_LIST_LIMIT}건만 표시` : ''}</caption>
      <thead><tr><th scope="col">행</th><th scope="col">ERP 코드</th><th scope="col">사유</th></tr></thead>
      <tbody>{issues.slice(0, ISSUE_LIST_LIMIT).map((issue, index) => <tr key={`${issue.row}:${index}`}>
        <td>{issue.row.toLocaleString('ko-KR')}</td>
        <td className="admin-erp-items__code">{issue.code || '-'}</td>
        <td>{erpImportIssueLabel(issue)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

/**
 * ERP '품목 생성' 데이터 반입: 붙여넣기·파일 → 열 짝짓기 미리보기 → 반입 → 결과 요약.
 * 미리보기와 열 변경은 브라우저에서 하고, 반입 행은 서버 액션이 다시 검증한다.
 */
export function ErpItemImportPanel() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [source, setSource] = useState<ErpImportSource | null>(null);
  const [headerIndex, setHeaderIndex] = useState<number | undefined>(undefined);
  const [mapping, setMapping] = useState<ErpColumnTarget[] | undefined>(undefined);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<ErpImportSummary | null>(null);
  const [reading, startReading] = useTransition();
  const [importing, startImporting] = useTransition();
  const busy = reading || importing;

  const plan = useMemo(() => source ? buildErpImportPlan(source.table, {
    headerIndex,
    mapping,
    numericColumns: source.numericColumns,
  }) : null, [source, headerIndex, mapping]);

  const begin = (next: ErpImportSource) => {
    setSource(next);
    setHeaderIndex(undefined);
    setMapping(undefined);
    setSummary(null);
    setProgress(null);
    setError('');
  };

  const readPasted = () => {
    if (!normalizeErpText(pasted, true)) { setError('엑셀에서 복사한 표를 붙여넣어 주세요.'); return; }
    if (pasted.length > ERP_ITEM_PASTE_CHAR_LIMIT) { setError('붙여넣은 내용이 너무 깁니다. 나누어 반입해주세요.'); return; }
    begin({ label: '붙여넣은 표', table: boundErpTable(parseErpDelimitedText(pasted)), numericColumns: [], warnings: [] });
  };

  const readFile = (file: File) => {
    setError('');
    startReading(async () => {
      const form = new FormData();
      form.set('file', file);
      const result = await readErpItemFileAction(form);
      if (!result.ok) { setError(result.error); return; }
      begin({
        label: result.sheetName ? `${result.fileName} · ${result.sheetName} 시트` : result.fileName,
        table: result.table,
        numericColumns: result.numericColumns,
        warnings: result.warnings,
      });
    });
  };

  const reset = () => {
    setSource(null);
    setHeaderIndex(undefined);
    setMapping(undefined);
    setSummary(null);
    setProgress(null);
    setError('');
    setPasted('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const runImport = () => {
    if (!plan || plan.blocking || !plan.rows.length) return;
    const chunks = chunkErpImportRows(plan.rows);
    const total = plan.rows.length;
    setError('');
    setSummary(null);
    setProgress({ done: 0, total });
    startImporting(async () => {
      const merged: ErpImportSummary = { inserted: 0, updated: 0, unchanged: 0, rejected: [] };
      let done = 0;
      for (const chunk of chunks) {
        const result = await importErpItemsAction(chunk);
        if (!result.ok) {
          setError(done
            ? `${done.toLocaleString('ko-KR')}건까지 반입했습니다. ${result.error}`
            : result.error);
          if (done) setSummary(merged);
          setProgress(null);
          router.refresh();
          return;
        }
        merged.inserted += result.inserted;
        merged.updated += result.updated;
        merged.unchanged += result.unchanged;
        merged.rejected.push(...result.rejected);
        done += chunk.length;
        setProgress({ done, total });
      }
      merged.rejected.sort((left, right) => left.row - right.row);
      setSummary(merged);
      setProgress(null);
      router.refresh();
    });
  };

  const previewRows = plan?.rows.slice(0, ERP_ITEM_PREVIEW_ROWS) ?? [];
  const headerOptions = source ? source.table.slice(0, ERP_ITEM_HEADER_SCAN_ROWS) : [];

  return <AdminSectionCard
    title="품목 반입"
    id="erp-item-import"
    summary={`ERP '품목 생성' 화면의 표를 엑셀에서 복사해 붙여넣거나 XLSX·CSV 파일로 올립니다. 한 번에 ${ERP_ITEM_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}행까지, ERP 코드(품번)가 같으면 새 값으로 바꿉니다.`}
  >
    <div className="admin-erp-items__sources">
      <div className="wc-admin-kit__field">
        <label className="wc-admin-kit__field-label" htmlFor="erp-item-paste">붙여넣기</label>
        <textarea
          id="erp-item-paste"
          rows={6}
          value={pasted}
          disabled={busy}
          aria-describedby="erp-item-paste-hint"
          placeholder={'품번\t품명\t카테고리\t판매가\t바코드\n000123\t아크릴 키링\t문구 > 키링\t12,000\t8801234567890'}
          onChange={(event) => setPasted(event.target.value)}
        />
        <p className="wc-admin-kit__hint" id="erp-item-paste-hint">머리글 행까지 함께 복사하면 열을 자동으로 짝짓습니다. 선행 0이 있는 품번·바코드는 그대로 보존합니다.</p>
        <div><button className="wc-admin-kit__button" type="button" disabled={busy} onClick={readPasted}>붙여넣은 표 확인</button></div>
      </div>
      <div className="wc-admin-kit__field">
        <label className="wc-admin-kit__field-label" htmlFor="erp-item-file">또는 파일 선택</label>
        <input
          ref={fileInput}
          id="erp-item-file"
          type="file"
          disabled={busy}
          aria-describedby="erp-item-file-hint"
          accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) readFile(file); }}
        />
        <p className="wc-admin-kit__hint" id="erp-item-file-hint">XLSX·CSV 900KB 이하. 제목 행이 있어도 처음 10행 안에서 머리글을 찾습니다. XLS는 XLSX로 다시 저장해 올려주세요.</p>
        {reading ? <p className="wc-admin-kit__hint" role="status">파일을 읽는 중입니다.</p> : null}
      </div>
    </div>

    <div aria-live="polite" className="admin-erp-items__feedback">
      {error ? <p className="wc-admin-kit__error" role="alert">{error}</p> : null}
      {progress ? <p role="status">반입 중 · {progress.done.toLocaleString('ko-KR')} / {progress.total.toLocaleString('ko-KR')}건</p> : null}
    </div>

    {summary ? <div className="admin-erp-items__result" role="status">
      <p>
        <AdminStatusBadge tone="success">추가 {summary.inserted.toLocaleString('ko-KR')}</AdminStatusBadge>{' '}
        <AdminStatusBadge tone="success">변경 {summary.updated.toLocaleString('ko-KR')}</AdminStatusBadge>{' '}
        <AdminStatusBadge>같음 {summary.unchanged.toLocaleString('ko-KR')}</AdminStatusBadge>{' '}
        <AdminStatusBadge tone={summary.rejected.length ? 'danger' : 'neutral'}>거부 {summary.rejected.length.toLocaleString('ko-KR')}</AdminStatusBadge>
      </p>
      <p className="wc-admin-kit__hint">같은 내용을 다시 반입해도 &lsquo;같음&rsquo;으로 처리됩니다. 거부된 행은 고친 뒤 다시 반입해주세요.</p>
      <IssueTable caption="반입하지 못한 행" issues={summary.rejected} />
    </div> : null}

    {source && plan ? <div className="admin-erp-items__preview">
      <header className="admin-erp-items__preview-header">
        <h4>미리보기 · {source.label}</h4>
        <p className="wc-admin-kit__hint">
          비어 있지 않은 {plan.dataRowCount.toLocaleString('ko-KR')}행 · 반입 가능 {plan.rows.length.toLocaleString('ko-KR')}건 · 오류 {plan.issues.length.toLocaleString('ko-KR')}건
          {plan.duplicateCount ? ` · 중복 ${plan.duplicateCount.toLocaleString('ko-KR')}건` : ''}
        </p>
      </header>

      <div className="wc-admin-kit__field admin-erp-items__header-row">
        <label className="wc-admin-kit__field-label" htmlFor="erp-item-header-row">머리글 행</label>
        <select id="erp-item-header-row" value={plan.headerIndex} disabled={busy}
          onChange={(event) => { setHeaderIndex(Number(event.target.value)); setMapping(undefined); }}>
          <option value={-1}>머리글 없음 · 첫 행부터 품목</option>
          {headerOptions.map((row, index) => <option key={index} value={index}>
            {index + 1}행 · {row.map((cell) => normalizeErpText(cell, true)).filter(Boolean).slice(0, 4).join(' / ').slice(0, 60) || '빈 행'}
          </option>)}
        </select>
      </div>

      <div className="admin-erp-items__table-scroll" role="region" aria-label="열 짝짓기" tabIndex={0}>
        <table className="admin-erp-items__table">
          <caption>열마다 가져올 항목을 고릅니다. ERP 분류는 여러 열을 고르면 왼쪽부터 &lsquo; &gt; &rsquo;로 이어 붙입니다.</caption>
          <thead><tr><th scope="col">파일의 열</th><th scope="col">첫 값</th><th scope="col">가져올 항목</th></tr></thead>
          <tbody>{plan.columns.map((column) => <tr key={column.index}>
            <th scope="row">{column.label}</th>
            <td>{column.sample || '-'}</td>
            <td>
              <select aria-label={`${column.label} 열의 항목`} value={column.target} disabled={busy}
                onChange={(event) => setMapping(assignErpColumnTarget(plan.columns.map((entry) => entry.target), column.index, event.target.value as ErpColumnTarget))}>
                {ERP_COLUMN_TARGETS.map((target) => <option key={target} value={target}>{ERP_COLUMN_TARGET_LABELS[target]}</option>)}
              </select>
            </td>
          </tr>)}</tbody>
        </table>
      </div>

      {[...source.warnings, ...plan.warnings].length ? <ul className="admin-erp-items__warnings">
        {[...source.warnings, ...plan.warnings].map((warning) => <li key={warning}>{warning}</li>)}
      </ul> : null}
      {plan.blocking ? <p className="wc-admin-kit__error" role="alert">{plan.blocking}</p> : null}

      {previewRows.length ? <div className="admin-erp-items__table-scroll" role="region" aria-label="반입 미리보기" tabIndex={0}>
        <table className="admin-erp-items__table">
          <caption>반입할 품목 · 앞 {Math.min(ERP_ITEM_PREVIEW_ROWS, plan.rows.length).toLocaleString('ko-KR')}건</caption>
          <thead><tr>
            <th scope="col">행</th><th scope="col">ERP 코드</th><th scope="col">ERP 품명</th>
            <th scope="col">ERP 분류</th><th scope="col">판매가</th><th scope="col">바코드</th>
          </tr></thead>
          <tbody>{previewRows.map((row) => <tr key={row.code}>
            <td>{row.row.toLocaleString('ko-KR')}</td>
            <td className="admin-erp-items__code">{row.code}</td>
            <td>{row.name}</td>
            <td>{keptValue(row, 'category')}</td>
            <td>{keptValue(row, 'salePrice')}</td>
            <td className="admin-erp-items__code">{keptValue(row, 'barcode')}</td>
          </tr>)}</tbody>
        </table>
      </div> : null}

      <IssueTable caption="반입할 수 없는 행" issues={plan.issues} />

      <p className="wc-admin-kit__hint">열을 고르지 않은 항목은 이미 반입된 값을 그대로 둡니다. 열을 골랐는데 칸이 비어 있으면 그 값을 비웁니다.</p>
      <div className="wc-admin-kit__actions">
        <button className="wc-admin-kit__button" type="button" disabled={busy || Boolean(plan.blocking) || !plan.rows.length} onClick={runImport}>
          {importing ? '반입 중' : `${plan.rows.length.toLocaleString('ko-KR')}건 반입`}
        </button>
        <button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={reset}>처음부터 다시</button>
      </div>
    </div> : null}
  </AdminSectionCard>;
}
