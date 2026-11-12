'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importErpItemsAction, readErpItemFileAction, type ErpItemFileResult, type ErpItemImportResult } from '@/app/admin/erp-item-actions';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { FoldCard } from '@/components/admin/sections/SectionLayout';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import {
  ERP_COLUMN_TARGETS,
  ERP_COLUMN_TARGET_LABELS,
  ERP_ITEM_FILE_BYTES_LIMIT,
  ERP_ITEM_HEADER_SCAN_ROWS,
  ERP_ITEM_IMPORT_ROW_LIMIT,
  ERP_ITEM_PASTE_CHAR_LIMIT,
  ERP_ITEM_PREVIEW_ROWS,
  assignErpColumnTarget,
  buildErpImportPlan,
  chunkErpImportRows,
  erpImportIssueLabel,
  parseErpDelimitedTable,
  boundErpTable,
  normalizeErpText,
  type ErpColumnTarget,
  type ErpImportIssue,
  type ErpImportRow,
} from '@/lib/admin/erp-item-import';
import { formatErpSalePrice } from '@/lib/admin/erp-items';
import { erpImportFollowUp, unlinkedPastedCategories, type ErpImportFollowUp } from '@/lib/admin/erp-import-follow-up';
import { ERP_LINKED_GOODS_SECTION_ID } from '@/lib/admin/erp-linked-goods';
import { useErpItemsWorkspace } from './ErpItemsWorkspace';

type ErpImportSource = {
  label: string;
  table: string[][];
  numericColumns: number[];
  warnings: string[];
};

type ErpImportSummary = { inserted: number; updated: number; unchanged: number; rejected: ErpImportIssue[] };

const ISSUE_LIST_LIMIT = 100;
const FILE_KB = ERP_ITEM_FILE_BYTES_LIMIT / 1024;
const FILE_REQUEST_FAILED = `파일을 보내지 못했습니다. ${FILE_KB}KB 이하의 XLSX·CSV 파일인지 확인한 뒤 다시 올려주세요. 계속 안 되면 표를 복사해 붙여넣어 주세요.`;
const IMPORT_REQUEST_FAILED = 'ERP 품목 반입 요청이 끊겼습니다. 같은 내용으로 다시 반입하면 이어서 반영됩니다.';

/**
 * 파일을 서버로 보내기 전 확인. 서버 액션 요청 본문은 1MB에서 액션 실행 전에 끊기므로,
 * 크기·형식은 여기서 readErpItemFileAction과 같은 순서·문구로 먼저 막는다(서버도 다시 확인한다).
 */
export function erpItemFileError(file: Pick<File, 'name' | 'size'>): string | null {
  if (file.size === 0) return '반입할 파일을 선택해주세요.';
  if (/\.xls$/i.test(file.name)) return 'XLS 파일은 엑셀에서 XLSX로 다시 저장하거나, 표를 복사해 붙여넣어 주세요.';
  if (!/\.(xlsx|csv|tsv|txt)$/i.test(file.name)) return 'XLSX 또는 CSV 파일을 올려주세요.';
  if (file.size > ERP_ITEM_FILE_BYTES_LIMIT) return `파일은 ${FILE_KB}KB 이하로 올려주세요. 크면 필요한 열만 남겨 저장하거나 표를 복사해 붙여넣어 주세요.`;
  return null;
}

function keptValue(row: ErpImportRow, key: 'category' | 'salePrice' | 'barcode') {
  if (!Object.hasOwn(row, key)) return <span className="text-muted-foreground">기존 값 유지</span>;
  if (key === 'salePrice') return row.salePrice === null ? <span className="text-muted-foreground">비움</span> : formatErpSalePrice(row.salePrice ?? null);
  const value = row[key];
  return value ? value : <span className="text-muted-foreground">비움</span>;
}

/* kit 표 모양의 스크롤 영역: 최대 520px 높이, 머리 행 고정, 인쇄에서는 펼친다(옛 ERP 품목 표와 같다). */
const TABLE_REGION = 'relative max-h-[520px] min-w-0 overflow-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50 print:max-h-none print:overflow-visible [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted';
const TABLE = 'w-full caption-top text-sm';
const CAPTION = 'px-2 py-2 text-left text-sm text-muted-foreground';
const CODE = 'font-mono text-xs tabular-nums';
const HINT = 'text-sm text-muted-foreground';

function IssueTable({ caption, issues }: { caption: string; issues: ErpImportIssue[] }) {
  if (!issues.length) return null;
  return <div className={TABLE_REGION} role="region" aria-label={caption} tabIndex={0}>
    <table className={TABLE} data-slot="table">
      <caption className={CAPTION}>{caption}{issues.length > ISSUE_LIST_LIMIT ? ` · 앞 ${ISSUE_LIST_LIMIT}건만 표시` : ''}</caption>
      <TableHeader><TableRow><TableHead scope="col">행</TableHead><TableHead scope="col">ERP 코드</TableHead><TableHead scope="col">사유</TableHead></TableRow></TableHeader>
      <TableBody>{issues.slice(0, ISSUE_LIST_LIMIT).map((issue, index) => <TableRow key={`${issue.row}:${index}`}>
        <TableCell className="tabular-nums">{issue.row.toLocaleString('ko-KR')}</TableCell>
        <TableCell className={CODE}>{issue.code || '-'}</TableCell>
        <TableCell className="whitespace-normal">{erpImportIssueLabel(issue)}</TableCell>
      </TableRow>)}</TableBody>
    </table>
  </div>;
}

/**
 * ERP '품목 생성' 데이터 반입: 붙여넣기·파일 → 열 짝짓기 미리보기 → 반입 → 결과 요약.
 * 미리보기와 열 변경은 브라우저에서 하고, 반입 행은 서버 액션이 다시 검증한다.
 * 가끔 쓰는 도구라 접어 두어 매일 보는 품목 표가 첫 화면에 들어오게 한다(반입한 품목이 없으면 펼친다).
 */
export function ErpItemImportPanel({ defaultOpen = false, unlinkedErpCategories = [] }: {
  defaultOpen?: boolean;
  /** 연결 표에서 '연결 필요'인 ERP 분류(서버가 다시 그릴 때마다 최신). 반입 뒤 '미연결 분류 N건'을 고른다. */
  unlinkedErpCategories?: readonly string[];
} = {}) {
  const router = useRouter();
  const workspace = useErpItemsWorkspace();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [source, setSource] = useState<ErpImportSource | null>(null);
  const [headerIndex, setHeaderIndex] = useState<number | undefined>(undefined);
  const [mapping, setMapping] = useState<ErpColumnTarget[] | undefined>(undefined);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<ErpImportSummary | null>(null);
  /* 반입된 행의 ERP 코드·분류. 연결 상품 비교 범위와 '미연결 분류 N건'에 쓴다(1027T-016·1027T-X04). */
  const [followUp, setFollowUp] = useState<ErpImportFollowUp | null>(null);
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
    setFollowUp(null);
    setProgress(null);
    setError('');
  };

  const readPasted = () => {
    if (!normalizeErpText(pasted, true)) { setError('엑셀에서 복사한 표를 붙여넣어 주세요.'); return; }
    if (pasted.length > ERP_ITEM_PASTE_CHAR_LIMIT) { setError('붙여넣은 내용이 너무 깁니다. 나누어 반입해주세요.'); return; }
    const parsed = parseErpDelimitedTable(pasted);
    begin({ label: '붙여넣은 표', table: boundErpTable(parsed.rows), numericColumns: [], warnings: parsed.warnings });
  };

  /* 안내 뒤 같은 파일을 고쳐 다시 고를 수 있게 선택을 비운다(같은 파일은 change가 다시 나지 않는다). */
  const clearFile = () => { if (fileInput.current) fileInput.current.value = ''; };

  const readFile = (file: File) => {
    const invalid = erpItemFileError(file);
    if (invalid) { setError(invalid); clearFile(); return; }
    setError('');
    startReading(async () => {
      const form = new FormData();
      form.set('file', file);
      /* 요청 거부(본문 상한·연결 끊김)가 transition 밖으로 나가면 전역 오류 화면이 어드민을 덮는다. */
      let result: ErpItemFileResult;
      try { result = await readErpItemFileAction(form); } catch { result = { ok: false, error: FILE_REQUEST_FAILED }; }
      if (!result.ok) { setError(result.error); clearFile(); return; }
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
    setFollowUp(null);
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
    setFollowUp(null);
    setProgress({ done: 0, total });
    /* 미리보기에서 걸러진 행도 반입되지 않았으므로 결과의 거부에 함께 센다. */
    const previewIssues = [...plan.issues];
    startImporting(async () => {
      const merged: ErpImportSummary = { inserted: 0, updated: 0, unchanged: 0, rejected: previewIssues };
      /* 반입된 행만 이어 할 일(연결 상품 비교·미연결 분류)에 넘긴다. 실패한 묶음과 DB가 거부한 행은 뺀다. */
      const imported: ErpImportRow[] = [];
      const serverRejected: ErpImportIssue[] = [];
      const finish = () => {
        const next = erpImportFollowUp(imported, serverRejected);
        setFollowUp(next);
        /* 붙여넣은 값이 연결 상품과 다르면 미리보기로 보이게 비교를 시작한다(반영은 운영자가 고른 뒤 확정). */
        if (next.codes.length) workspace?.comparePasted(next.codes);
      };
      let done = 0;
      for (const chunk of chunks) {
        let result: ErpItemImportResult;
        try { result = await importErpItemsAction(chunk); } catch { result = { ok: false, error: IMPORT_REQUEST_FAILED }; }
        if (!result.ok) {
          setError(done
            ? `${done.toLocaleString('ko-KR')}건까지 반입했습니다. ${result.error}`
            : result.error);
          if (done) {
            setSummary({ ...merged, rejected: [...merged.rejected].sort((left, right) => left.row - right.row) });
            finish();
          }
          setProgress(null);
          router.refresh();
          return;
        }
        merged.inserted += result.inserted;
        merged.updated += result.updated;
        merged.unchanged += result.unchanged;
        merged.rejected.push(...result.rejected);
        imported.push(...chunk);
        serverRejected.push(...result.rejected);
        done += chunk.length;
        setProgress({ done, total });
      }
      merged.rejected.sort((left, right) => left.row - right.row);
      setSummary(merged);
      setProgress(null);
      finish();
      router.refresh();
    });
  };

  const unlinkedPasted = followUp ? unlinkedPastedCategories(followUp.categories, unlinkedErpCategories) : [];

  const previewRows = plan?.rows.slice(0, ERP_ITEM_PREVIEW_ROWS) ?? [];
  const headerOptions = source ? source.table.slice(0, ERP_ITEM_HEADER_SCAN_ROWS) : [];

  return <FoldCard
    id="erp-item-import"
    open={defaultOpen}
    summary={`엑셀 표 붙여넣기·파일 · 한 번에 ${ERP_ITEM_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}행까지 · ERP 코드(품번)가 같으면 새 값으로 바꿉니다.`}
    title="품목 반입"
  >
    <div className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))] print:hidden" data-erp-items="sources">
      <div className="flex min-w-0 flex-col gap-2">
        <label className="text-sm leading-snug font-medium" htmlFor="erp-item-paste">붙여넣기</label>
        <Textarea
          className="min-h-36 font-mono text-[13px] field-sizing-fixed"
          id="erp-item-paste"
          rows={6}
          value={pasted}
          disabled={busy}
          aria-describedby="erp-item-paste-hint"
          placeholder={'품번\t품명\t카테고리\t판매가\t바코드\n000123\t아크릴 키링\t문구 > 키링\t12,000\t8801234567890'}
          onChange={(event) => setPasted(event.target.value)}
        />
        <p className={HINT} id="erp-item-paste-hint">머리글 행까지 함께 복사하면 열을 자동으로 짝짓습니다. 선행 0이 있는 품번·바코드는 그대로 보존합니다.</p>
        {/* 미리보기가 열리면 주 행동은 아래 'N건 반입'이다 — 이 카드의 실선 버튼은 한 번에 하나다. */}
        <div><Button variant={source ? 'outline' : 'default'} type="button" disabled={busy} onClick={readPasted}>붙여넣은 표 확인</Button></div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label className="text-sm leading-snug font-medium" htmlFor="erp-item-file">또는 파일 선택</label>
        <Input
          ref={fileInput}
          id="erp-item-file"
          type="file"
          disabled={busy}
          aria-describedby="erp-item-file-hint"
          accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) readFile(file); }}
        />
        <p className={HINT} id="erp-item-file-hint">XLSX·CSV {FILE_KB}KB 이하. 제목 행이 있어도 처음 10행 안에서 머리글을 찾습니다. XLS는 XLSX로 다시 저장해 올려주세요.</p>
        {reading ? <p className={HINT} role="status">파일을 읽는 중입니다.</p> : null}
      </div>
    </div>

    <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {progress ? <p className="text-sm tabular-nums" role="status">반입 중 · {progress.done.toLocaleString('ko-KR')} / {progress.total.toLocaleString('ko-KR')}건</p> : null}
    </div>

    {summary ? <div className="flex min-w-0 flex-col gap-3 border-t pt-4" role="status">
      <p className="flex flex-wrap gap-2">
        <AdminStatusBadge tone="success">추가 {summary.inserted.toLocaleString('ko-KR')}</AdminStatusBadge>{' '}
        <AdminStatusBadge tone="success">변경 {summary.updated.toLocaleString('ko-KR')}</AdminStatusBadge>{' '}
        <AdminStatusBadge>같음 {summary.unchanged.toLocaleString('ko-KR')}</AdminStatusBadge>{' '}
        <AdminStatusBadge tone={summary.rejected.length ? 'danger' : 'neutral'}>거부 {summary.rejected.length.toLocaleString('ko-KR')}</AdminStatusBadge>
      </p>
      <p className={HINT}>같은 내용을 다시 반입해도 &lsquo;같음&rsquo;으로 처리됩니다. 거부된 행은 고친 뒤 다시 반입해주세요.</p>
      {/* 1027T-016: 붙여넣은 품목의 ERP 분류 중 고객 카테고리에 연결되지 않은 분류를 연결 표로 바로 안내한다. */}
      {unlinkedPasted.length ? <AdminNotice tone="warning" title={`미연결 분류 ${unlinkedPasted.length.toLocaleString('ko-KR')}건`}>
        <p>붙여넣은 품목의 ERP 분류 중 고객 카테고리에 연결되지 않은 분류가 있습니다. 연결해 두면 상품 옵션에서 ERP 품목을 고를 때 카테고리를 제안합니다.</p>
        <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">{unlinkedPasted.slice(0, 5).join(' · ')}{unlinkedPasted.length > 5 ? ` 외 ${(unlinkedPasted.length - 5).toLocaleString('ko-KR')}건` : ''}</p>
        <Button className="mt-2" size="sm" variant="outline" type="button" onClick={() => workspace?.showUnlinkedCategories()}>연결하기</Button>
      </AdminNotice> : null}
      {/* 1027T-X04: 반입이 끝나면 연결 상품 반영 패널이 방금 반입한 품목과 비교한다. 바꾸는 일은 그곳에서 확인한 뒤 한다. */}
      {followUp?.codes.length && workspace ? <p className={HINT}>
        방금 반입한 품목과 연결 상품의 판매가·바코드를 비교했습니다. 값이 다르면 아래 연결 상품 반영에서 확인하고 고른 행만 반영합니다.{' '}
        <a className="text-foreground underline underline-offset-4" href={`#${ERP_LINKED_GOODS_SECTION_ID}`}>비교 결과 보기</a>
      </p> : null}
      <IssueTable caption="반입하지 못한 행" issues={summary.rejected} />
    </div> : null}

    {source && plan ? <div className="flex min-w-0 flex-col gap-4 border-t pt-4" data-erp-items="preview">
      <header className="flex flex-col gap-1">
        <h3 className="text-base leading-snug font-medium wrap-anywhere">미리보기 · {source.label}</h3>
        <p className={`${HINT} tabular-nums`}>
          비어 있지 않은 {plan.dataRowCount.toLocaleString('ko-KR')}행 · 반입 가능 {plan.rows.length.toLocaleString('ko-KR')}건 · 오류 {plan.issues.length.toLocaleString('ko-KR')}건
          {plan.duplicateCount ? ` · 중복 ${plan.duplicateCount.toLocaleString('ko-KR')}건` : ''}
        </p>
      </header>

      <div className="flex max-w-[35rem] min-w-0 flex-col gap-2">
        <label className="text-sm leading-snug font-medium" htmlFor="erp-item-header-row">머리글 행</label>
        <AdminSelect id="erp-item-header-row" value={plan.headerIndex} disabled={busy} wrapperClassName="w-full"
          onChange={(event) => { setHeaderIndex(Number(event.target.value)); setMapping(undefined); }}>
          <option value={-1}>머리글 없음 · 첫 행부터 품목</option>
          {headerOptions.map((row, index) => <option key={index} value={index}>
            {index + 1}행 · {row.map((cell) => normalizeErpText(cell, true)).filter(Boolean).slice(0, 4).join(' / ').slice(0, 60) || '빈 행'}
          </option>)}
        </AdminSelect>
      </div>

      <div className={TABLE_REGION} role="region" aria-label="열 짝짓기" tabIndex={0}>
        <table className={TABLE} data-slot="table">
          <caption className={CAPTION}>열마다 가져올 항목을 고릅니다. ERP 분류는 여러 열을 고르면 왼쪽부터 &lsquo; &gt; &rsquo;로 이어 붙입니다.</caption>
          <TableHeader><TableRow><TableHead scope="col">파일의 열</TableHead><TableHead scope="col">첫 값</TableHead><TableHead scope="col">가져올 항목</TableHead></TableRow></TableHeader>
          <TableBody>{plan.columns.map((column) => <TableRow key={column.index}>
            <TableHead scope="row" className="font-medium whitespace-normal">{column.label}</TableHead>
            <TableCell className="max-w-64 whitespace-normal wrap-anywhere text-muted-foreground">{column.sample || '-'}</TableCell>
            <TableCell>
              <AdminSelect aria-label={`${column.label} 열의 항목`} value={column.target} disabled={busy} wrapperClassName="w-48"
                onChange={(event) => setMapping(assignErpColumnTarget(plan.columns.map((entry) => entry.target), column.index, event.target.value as ErpColumnTarget))}>
                {ERP_COLUMN_TARGETS.map((target) => <option key={target} value={target}>{ERP_COLUMN_TARGET_LABELS[target]}</option>)}
              </AdminSelect>
            </TableCell>
          </TableRow>)}</TableBody>
        </table>
      </div>

      {[...source.warnings, ...plan.warnings].length ? <AdminNotice tone="warning"><ul className="flex list-disc flex-col gap-1.5 pl-4">
        {[...source.warnings, ...plan.warnings].map((warning) => <li key={warning}>{warning}</li>)}
      </ul></AdminNotice> : null}
      {plan.blocking ? <p className="text-sm text-destructive" role="alert">{plan.blocking}</p> : null}

      {previewRows.length ? <div className={TABLE_REGION} role="region" aria-label="반입 미리보기" tabIndex={0}>
        <table className={`${TABLE} min-w-[640px]`} data-slot="table">
          <caption className={CAPTION}>반입할 품목 · 앞 {Math.min(ERP_ITEM_PREVIEW_ROWS, plan.rows.length).toLocaleString('ko-KR')}건</caption>
          <TableHeader><TableRow>
            <TableHead scope="col">행</TableHead><TableHead scope="col">ERP 코드</TableHead><TableHead scope="col">ERP 품명</TableHead>
            <TableHead scope="col">ERP 분류</TableHead><TableHead scope="col" className="text-right">판매가</TableHead><TableHead scope="col">바코드</TableHead>
          </TableRow></TableHeader>
          <TableBody>{previewRows.map((row) => <TableRow key={row.code}>
            <TableCell className="tabular-nums">{row.row.toLocaleString('ko-KR')}</TableCell>
            <TableCell className={CODE}>{row.code}</TableCell>
            <TableCell className="whitespace-normal">{row.name}</TableCell>
            <TableCell className="whitespace-normal">{keptValue(row, 'category')}</TableCell>
            <TableCell className="text-right tabular-nums">{keptValue(row, 'salePrice')}</TableCell>
            <TableCell className={CODE}>{keptValue(row, 'barcode')}</TableCell>
          </TableRow>)}</TableBody>
        </table>
      </div> : null}

      <IssueTable caption="반입할 수 없는 행" issues={plan.issues} />

      <p className={HINT}>열을 고르지 않은 항목은 이미 반입된 값을 그대로 둡니다. 열을 골랐는데 칸이 비어 있으면 그 값을 비웁니다.</p>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button type="button" disabled={busy || Boolean(plan.blocking) || !plan.rows.length} onClick={runImport}>
          {importing ? '반입 중' : `${plan.rows.length.toLocaleString('ko-KR')}건 반입`}
        </Button>
        <Button variant="ghost" type="button" disabled={busy} onClick={reset}>처음부터 다시</Button>
      </div>
    </div> : null}
  </FoldCard>;
}
