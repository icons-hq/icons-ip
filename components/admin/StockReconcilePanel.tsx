'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  applyStockReconcileAction,
  previewStockReconcileAction,
  readStockReconcileFileAction,
  type StockReconcileFileResult,
} from '@/app/admin/stock-reconcile-actions';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { DefectiveStockReference } from '@/components/admin/DefectiveStockReference';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ERP_ITEM_FILE_BYTES_LIMIT, normalizeErpText } from '@/lib/admin/erp-item-import';
import { statusTone } from '@/lib/admin/status-tone';
import {
  STOCK_CLIENT_ISSUE_LABELS,
  STOCK_COLUMN_TARGETS,
  STOCK_COLUMN_TARGET_LABELS,
  STOCK_MATCH_KIND_LABELS,
  STOCK_RECONCILE_CONFLICT_REASON_LABELS,
  STOCK_RECONCILE_HEADER_SCAN_ROWS,
  STOCK_RECONCILE_ISSUE_LABELS,
  STOCK_RECONCILE_PATH,
  STOCK_RECONCILE_REASON_LIMIT,
  STOCK_RECONCILE_ROW_LIMIT,
  STOCK_RECONCILE_ROW_STATE_LABELS,
  assignStockColumnTarget,
  boundStockTable,
  buildStockReconcilePlan,
  defaultStockReconcileReason,
  kstDateTimeLocalToIso,
  kstDateTimeLocalValue,
  parseStockDelimitedTable,
  stockAsOfError,
  stockReconcileDisplayItem,
  stockReconcileRowPayload,
  stockReconcileRowState,
  stockReconcileShortage,
  type StockColumnTarget,
  type StockReconcileConflict,
  type StockReconcileDocument,
  type StockReconcileItem,
  type StockReconcilePlan,
} from '@/lib/admin/stock-reconcile';
import { formatOrderDateTime } from '@/lib/orders';

type Source = { label: string; table: string[][]; numericColumns: number[]; warnings: string[] };
export interface StockReconcileOrigin { id: string; name: string; active: boolean }

const FILE_KB = ERP_ITEM_FILE_BYTES_LIMIT / 1024;
const PASTE_CHAR_LIMIT = 2_000_000;
const ISSUE_LIST_LIMIT = 200;
const TABLE_REGION = 'relative max-h-[520px] min-w-0 overflow-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50 print:max-h-none print:overflow-visible [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted';
const TABLE = 'w-full caption-top text-sm';
const CAPTION = 'px-2 py-2 text-left text-sm text-muted-foreground';
const CODE = 'font-mono text-xs tabular-nums';
const HINT = 'text-sm text-muted-foreground';
const NUM = 'text-right tabular-nums';
const count = (value: number) => value.toLocaleString('ko-KR');
const signed = (value: number) => (value > 0 ? `+${count(value)}` : count(value));

/** 파일을 서버로 보내기 전 확인(서버도 다시 확인한다). ERP 품목 반입과 같은 상한·문구다. */
export function stockReconcileFileError(file: Pick<File, 'name' | 'size'>): string | null {
  if (file.size === 0) return '대조할 재고 파일을 선택해주세요.';
  if (/\.xls$/i.test(file.name)) return 'XLS 파일은 엑셀에서 XLSX로 다시 저장하거나, 표를 복사해 붙여넣어 주세요.';
  if (!/\.(xlsx|csv|tsv|txt)$/i.test(file.name)) return 'XLSX 또는 CSV 파일을 올려주세요.';
  if (file.size > ERP_ITEM_FILE_BYTES_LIMIT) return `파일은 ${FILE_KB}KB 이하로 올려주세요. 크면 코드·수량 열만 남겨 저장하거나 표를 복사해 붙여넣어 주세요.`;
  return null;
}

function itemName(item: Pick<StockReconcileItem, 'goodsName' | 'optionName'>) {
  return item.optionName && item.optionName !== '기본 옵션' ? `${item.goodsName} / ${item.optionName}` : item.goodsName;
}

function RowState({ item, applied }: { item: StockReconcileItem; applied: boolean }) {
  const state = stockReconcileRowState(item);
  const delta = item.targetQty - item.stockQty;
  const label = state === 'shortage' ? `부족 ${count(stockReconcileShortage(item))}` : state === 'same' ? '같음' : `${STOCK_RECONCILE_ROW_STATE_LABELS[state]} ${signed(delta)}`;
  return <span className="flex flex-wrap gap-1">
    <AdminStatusBadge tone={statusTone('stockReconcile', state)}>{label}</AdminStatusBadge>
    {item.adjustedSinceCount > 0 && !applied ? <AdminStatusBadge tone={statusTone('stockReconcile', 'adjusted')}>
      기준 시각 뒤 직접 변경 {count(item.adjustedSinceCount)}건 ({signed(item.adjustedSinceQty)})
    </AdminStatusBadge> : null}
  </span>;
}

/**
 * 미리보기·기록 한 건. 반영 전에는 '맞춘 뒤 재고수량', 반영 뒤에는 실제 반영 결과를 보인다. 반영한 기록의 재고수량·출고 대기 등은
 * 반영할 때 다시 잰 값이다(QA1 S-T07-01) — 미리보기 뒤 출고·주문이 끼어도 표의 칸끼리 계산이 맞는다.
 */
export function StockReconcileResult({ snapshot, showSame, onToggleSame }: { snapshot: StockReconcileDocument; showSame: boolean; onToggleSame?: () => void }) {
  const applied = Boolean(snapshot.appliedAt);
  const items = snapshot.items.map((item) => stockReconcileDisplayItem(item, applied));
  const changed = items.filter((item) => item.targetQty !== item.stockQty);
  const shortages = items.filter((item) => stockReconcileRowState(item) === 'shortage');
  const increases = changed.filter((item) => stockReconcileRowState(item) === 'increase').length;
  const decreases = changed.filter((item) => stockReconcileRowState(item) === 'decrease').length;
  const visible = showSame ? items : changed;
  const adjusted = items.filter((item) => item.adjustedSinceCount > 0);
  return <div className="flex min-w-0 flex-col gap-3" data-stock-reconcile="result">
    <p className="flex flex-wrap items-center gap-2">
      <AdminStatusBadge tone={statusTone('stockReconcile', 'increase')}>늘림 {count(increases)}</AdminStatusBadge>
      <AdminStatusBadge tone={statusTone('stockReconcile', 'decrease')}>줄임 {count(decreases)}</AdminStatusBadge>
      <AdminStatusBadge tone={statusTone('stockReconcile', 'shortage')}>부족 {count(shortages.length)}</AdminStatusBadge>
      <AdminStatusBadge tone="neutral">같음 {count(items.length - changed.length)}</AdminStatusBadge>
      <AdminStatusBadge tone={snapshot.issueCount ? 'warning' : 'neutral'}>반영 안 함 {count(snapshot.issueCount)}</AdminStatusBadge>
    </p>
    <p className={HINT}>
      {snapshot.sourceLabel} · 재고 기준 {formatOrderDateTime(snapshot.asOf)}{snapshot.originName ? ` · ${snapshot.originName} 상품만` : ' · 모든 출고지'}
      {' '}· 미리보기 {formatOrderDateTime(snapshot.createdAt)}{snapshot.createdByName ? ` (${snapshot.createdByName})` : ''}
    </p>
    {shortages.length ? <AdminNotice tone="danger" title={`창고 재고보다 출고할 주문이 많은 옵션 ${count(shortages.length)}개`}>
      지금 창고에 있어야 할 실물에서 아직 출고하지 않은 주문을 빼면 0보다 작습니다. 반영하면 재고수량을 0으로 두고 더 팔지 않지만, 이미 받은 주문은 창고가 보낼 수 없습니다.
      실재고를 확인한 뒤 고객 안내나 취소를 검토해주세요.
    </AdminNotice> : null}
    {adjusted.length > 0 && !applied ? <AdminNotice tone="warning" title={`기준 시각 뒤 재고를 직접 바꾼 옵션 ${count(adjusted.length)}개`}>
      재고 조정이나 다른 대조 반영이 파일의 재고 기준 시각 뒤에 있었습니다. 이 변경은 계산에 넣지 않으므로, 파일 뒤에 들어온 입고였다면 반영할 때 그 수량이 사라집니다.
      그 뒤에 받은 재고 파일로 다시 대조하거나, 반영한 뒤 재고 조정으로 다시 더해주세요.
    </AdminNotice> : null}
    {visible.length ? <div className={TABLE_REGION} role="region" aria-label="옵션별 대조 결과" tabIndex={0}>
      <table className={`${TABLE} min-w-[1180px]`} data-slot="table">
        <caption className={CAPTION}>
          {applied ? '반영 결과(출고·회수·출고 대기·재고수량은 반영할 때 다시 잰 값)' : '반영 전 미리보기'} · 맞춘 뒤 재고수량 = 파일 수량 − 기준 시각 뒤 출고 + 기준 시각 뒤 회수 − 출고 대기 − 회수 뒤 미반영
          {onToggleSame ? <> · <button className="underline underline-offset-4" type="button" onClick={onToggleSame}>{showSame ? '바뀌는 옵션만 보기' : `같은 옵션 ${count(items.length - changed.length)}개도 보기`}</button></> : null}
        </caption>
        <TableHeader><TableRow>
          <TableHead scope="col">상품 · 옵션</TableHead><TableHead scope="col">관리코드</TableHead><TableHead scope="col">찾은 코드</TableHead>
          <TableHead scope="col" className="text-right">파일 수량</TableHead>
          <TableHead scope="col" className="text-right">기준 시각 뒤 출고</TableHead><TableHead scope="col" className="text-right">기준 시각 뒤 회수</TableHead>
          <TableHead scope="col" className="text-right">출고 대기</TableHead><TableHead scope="col" className="text-right">회수 뒤 미반영</TableHead>
          <TableHead scope="col" className="text-right">{applied ? '반영 전' : '지금'} 재고수량</TableHead>
          <TableHead scope="col" className="text-right">{applied ? '반영 뒤' : '맞춘 뒤'} 재고수량</TableHead><TableHead scope="col">상태</TableHead>
        </TableRow></TableHeader>
        <TableBody>{visible.map((item) => <TableRow key={item.variantId}>
          <TableCell className="max-w-72 whitespace-normal">{itemName(item)}{item.preorder ? <span className="ml-1 text-xs text-muted-foreground">(예약판매)</span> : null}</TableCell>
          <TableCell className={CODE}>{item.optionCode}</TableCell>
          <TableCell className="whitespace-nowrap text-muted-foreground">{STOCK_MATCH_KIND_LABELS[item.matchKind]} · {count(item.sourceRow)}행</TableCell>
          <TableCell className={NUM}>{count(item.fileQty)}</TableCell>
          <TableCell className={NUM}>{count(item.shippedSinceQty)}</TableCell>
          <TableCell className={NUM}>{count(item.returnedSinceQty)}</TableCell>
          <TableCell className={NUM}>{count(item.pendingQty)}</TableCell>
          <TableCell className={NUM}>{count(item.awaitingReturnQty)}</TableCell>
          <TableCell className={NUM}>{count(item.stockQty)}</TableCell>
          <TableCell className={`${NUM} font-medium`}>{count(applied && item.stockAfter !== null ? item.stockAfter : item.targetQty)}</TableCell>
          <TableCell><RowState item={item} applied={applied} /></TableCell>
        </TableRow>)}</TableBody>
      </table>
    </div> : <p className={HINT}>{items.length ? '재고수량이 바뀌는 옵션이 없습니다. 사이트 재고가 파일과 맞습니다.' : '찾은 옵션이 없습니다.'}</p>}
    {snapshot.issues.length ? <div className={TABLE_REGION} role="region" aria-label="반영하지 않는 행" tabIndex={0}>
      <table className={TABLE} data-slot="table">
        <caption className={CAPTION}>반영하지 않는 행{snapshot.issues.length > ISSUE_LIST_LIMIT ? ` · 앞 ${count(ISSUE_LIST_LIMIT)}건만 표시` : ''}</caption>
        <TableHeader><TableRow><TableHead scope="col">행</TableHead><TableHead scope="col">코드</TableHead><TableHead scope="col" className="text-right">파일 수량</TableHead><TableHead scope="col">사유</TableHead></TableRow></TableHeader>
        <TableBody>{snapshot.issues.slice(0, ISSUE_LIST_LIMIT).map((issue) => <TableRow key={issue.row}>
          <TableCell className="tabular-nums">{count(issue.row)}</TableCell>
          <TableCell className={CODE}>{issue.key || '-'}</TableCell>
          <TableCell className={NUM}>{issue.fileQty === null ? '-' : count(issue.fileQty)}</TableCell>
          <TableCell className="whitespace-normal">{STOCK_RECONCILE_ISSUE_LABELS[issue.reason]}</TableCell>
        </TableRow>)}</TableBody>
      </table>
    </div> : null}
  </div>;
}

/**
 * 반영을 거절한 옵션(QA1 S-T07-01). 잠금 뒤 다시 잰 맞춘 뒤 재고수량이 미리보기와 다르거나 재고수량을 직접 바꾼 옵션이 있으면
 * 아무것도 반영하지 않는다. 미리보기 값과 지금 값을 나란히 보이고 다시 미리보기로 잇는다(같은 파일이 화면에 있을 때).
 */
export function StockReconcileConflictNotice({ conflicts, onRepreview, onRestart, busy }: {
  conflicts: StockReconcileConflict[];
  /** 같은 파일·기준 시각으로 다시 미리보기. 파일이 화면에 없으면(기록에서 연 미리보기) 비우고 onRestart로 안내한다. */
  onRepreview?: () => void;
  onRestart: () => void;
  busy: boolean;
}) {
  return <AdminNotice tone="warning" role="alert" title={`미리보기 뒤 재고가 바뀐 옵션 ${count(conflicts.length)}개가 있어 반영하지 않았습니다`}>
    <div className="flex min-w-0 flex-col gap-2" data-stock-reconcile="conflicts">
      <p>재고수량은 하나도 바꾸지 않았습니다. 지금 값으로 다시 미리보기한 뒤 확인하고 반영해주세요.</p>
      <div className="min-w-0 overflow-x-auto rounded-md border bg-card" role="region" aria-label="미리보기 뒤 바뀐 옵션" tabIndex={0}>
        <table className="w-full min-w-[760px] text-sm" data-slot="table">
          <caption className="sr-only">미리보기 뒤 바뀐 옵션{conflicts.length > 20 ? ` · 앞 20개만 표시` : ''}</caption>
          <TableHeader><TableRow>
            <TableHead scope="col">상품 · 옵션</TableHead><TableHead scope="col">관리코드</TableHead>
            <TableHead scope="col" className="text-right">미리보기 재고수량 → 맞춘 뒤</TableHead>
            <TableHead scope="col" className="text-right">지금 재고수량 → 맞춘 뒤</TableHead>
            <TableHead scope="col" className="text-right">출고 대기 미리보기 → 지금</TableHead>
            <TableHead scope="col">이유</TableHead>
          </TableRow></TableHeader>
          <TableBody>{conflicts.slice(0, 20).map((conflict) => <TableRow key={conflict.variantId}>
            <TableCell className="max-w-64 whitespace-normal">{itemName(conflict)}</TableCell>
            <TableCell className={CODE}>{conflict.optionCode}</TableCell>
            <TableCell className={NUM}>{count(conflict.previewStockQty)} → {count(conflict.previewTargetQty)}</TableCell>
            <TableCell className={`${NUM} font-medium`}>{count(conflict.currentStockQty)} → {count(conflict.currentTargetQty)}</TableCell>
            <TableCell className={NUM}>{count(conflict.previewPendingQty)} → {count(conflict.currentPendingQty)}</TableCell>
            <TableCell className="min-w-56 whitespace-normal">{STOCK_RECONCILE_CONFLICT_REASON_LABELS[conflict.reason]}</TableCell>
          </TableRow>)}</TableBody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {onRepreview ? <Button type="button" disabled={busy} onClick={onRepreview}>다시 미리보기</Button>
          : <>
            <span>이 미리보기의 파일이 화면에 없습니다. 같은 파일을 다시 올려 미리보기 해주세요.</span>
            <Button type="button" variant="outline" disabled={busy} onClick={onRestart}>새 파일 대조</Button>
          </>}
      </div>
    </div>
  </AdminNotice>;
}

/**
 * 재고 파일 대조: 붙여넣기·파일 → 열 짝짓기 → 미리보기(서버가 매칭·계산·기록) → 사유와 함께 반영.
 * 반영은 미리보기에서 바뀌는 옵션 전부를 한 번에 한다. DB가 잠금 뒤 다시 잰 맞춘 뒤 재고수량이 미리보기와 다르거나(미리보기 뒤 주문·출고 등)
 * 재고수량을 직접 바꾼 옵션이 있으면 아무것도 바꾸지 않고, 바뀐 옵션을 보여 다시 미리보기로 잇는다(QA1 S-T07-01).
 */
export function StockReconcilePanel({ origins, initialSnapshot, now }: {
  origins: StockReconcileOrigin[]; initialSnapshot: StockReconcileDocument | null;
  /** 서버가 그린 시각(ISO). 기준 시각 기본값과 미리보기 만료 표시가 서버·브라우저에서 같게 그려진다. */
  now: string;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [source, setSource] = useState<Source | null>(null);
  const [headerIndex, setHeaderIndex] = useState<number | undefined>(undefined);
  const [mapping, setMapping] = useState<StockColumnTarget[] | undefined>(undefined);
  const [originId, setOriginId] = useState('');
  const [asOf, setAsOf] = useState(() => kstDateTimeLocalValue(new Date(now)));
  const [snapshot, setSnapshot] = useState<StockReconcileDocument | null>(initialSnapshot);
  const [reason, setReason] = useState(initialSnapshot ? defaultStockReconcileReason(initialSnapshot.sourceLabel) : '');
  const [showSame, setShowSame] = useState(false);
  const [conflicts, setConflicts] = useState<StockReconcileConflict[]>([]);
  /* 지금 미리보기를 만든 화면의 파일·열 짝짓기. 반영이 거절됐을 때 같은 파일로만 다시 미리보기한다(기록에서 연 미리보기·다른 파일은 다시 올린다). */
  const [previewedPlan, setPreviewedPlan] = useState<StockReconcilePlan | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reading, startReading] = useTransition();
  const [working, startWorking] = useTransition();
  const busy = reading || working;
  /* 기록 표에서 다른 미리보기(?snapshot=)를 열면 그 미리보기로 바꾼다. 이 패널이 미리보기를 만든 뒤 주소만 바꾼 경우는 그대로 둔다. */
  const incomingId = initialSnapshot?.id ?? null;
  const [syncedId, setSyncedId] = useState(incomingId);
  if (incomingId !== syncedId) {
    setSyncedId(incomingId);
    if (initialSnapshot && initialSnapshot.id !== snapshot?.id) {
      setSnapshot(initialSnapshot); setReason(defaultStockReconcileReason(initialSnapshot.sourceLabel)); setShowSame(false);
      setSource(null); setHeaderIndex(undefined); setMapping(undefined); setConflicts([]); setError(''); setMessage(''); setPreviewedPlan(null);
    }
  }

  const plan = useMemo(() => source ? buildStockReconcilePlan(source.table, { headerIndex, mapping, numericColumns: source.numericColumns }) : null,
    [source, headerIndex, mapping]);

  const begin = (next: Source) => {
    setSource(next); setHeaderIndex(undefined); setMapping(undefined); setError(''); setMessage(''); setConflicts([]);
  };
  const clearFile = () => { if (fileInput.current) fileInput.current.value = ''; };
  const readPasted = () => {
    if (!normalizeErpText(pasted, true)) { setError('창고·ERP 재고 표를 머리글 행까지 복사해 붙여넣어 주세요.'); return; }
    if (pasted.length > PASTE_CHAR_LIMIT) { setError('붙여넣은 내용이 너무 깁니다. 코드·수량 열만 남겨 붙여넣어 주세요.'); return; }
    const parsed = parseStockDelimitedTable(pasted);
    begin({ label: '붙여넣은 표', table: boundStockTable(parsed.rows), numericColumns: [], warnings: parsed.warnings });
  };
  const readFile = (file: File) => {
    const invalid = stockReconcileFileError(file);
    if (invalid) { setError(invalid); clearFile(); return; }
    setError('');
    startReading(async () => {
      const form = new FormData();
      form.set('file', file);
      let result: StockReconcileFileResult;
      try { result = await readStockReconcileFileAction(form); } catch { result = { ok: false, error: `파일을 보내지 못했습니다. ${FILE_KB}KB 이하의 XLSX·CSV인지 확인해주세요.` }; }
      if (!result.ok) { setError(result.error); clearFile(); return; }
      begin({ label: result.sheetName ? `${result.fileName} · ${result.sheetName} 시트` : result.fileName, table: result.table,
        numericColumns: result.numericColumns, warnings: result.warnings });
    });
  };
  const reset = () => {
    setSource(null); setHeaderIndex(undefined); setMapping(undefined); setPasted(''); setError(''); setMessage(''); setConflicts([]);
    setSnapshot(null); setReason(''); setPreviewedPlan(null); clearFile();
    router.replace(STOCK_RECONCILE_PATH, { scroll: false });
  };

  /**
   * 미리보기. 반영이 거절된 뒤의 다시 미리보기(again)는 거절된 미리보기와 같은 출고지·기준 시각과 화면의 같은 파일로 지금 값을 다시 재고,
   * 입력한 반영 사유를 그대로 둔다.
   */
  const preview = (again = false) => {
    if (!source || !plan || plan.blocking) return;
    const iso = again && snapshot ? snapshot.asOf : kstDateTimeLocalToIso(asOf);
    const origin = again && snapshot ? snapshot.originId : originId || null;
    const asOfError = stockAsOfError(iso);
    if (asOfError) { setError(asOfError); return; }
    setError(''); setMessage(''); setConflicts([]);
    startWorking(async () => {
      let result: Awaited<ReturnType<typeof previewStockReconcileAction>>;
      try {
        result = await previewStockReconcileAction({ originId: origin, asOf: iso!, sourceLabel: source.label,
          rows: plan.rows.map(stockReconcileRowPayload) });
      } catch { result = { ok: false, error: '미리보기 요청이 끊겼습니다. 다시 미리보기 해주세요.' }; }
      if (!result.ok) { setError(result.error); return; }
      setSnapshot(result.snapshot); setShowSame(false); setPreviewedPlan(plan);
      if (again) setMessage('지금 재고수량·출고 대기로 다시 미리보기했습니다. 바뀐 값을 확인한 뒤 반영해주세요.');
      else setReason(defaultStockReconcileReason(result.snapshot.sourceLabel));
      router.replace(`${STOCK_RECONCILE_PATH}?snapshot=${result.snapshot.id}`, { scroll: false });
    });
  };

  const changedCount = snapshot ? snapshot.items.filter((item) => item.targetQty !== item.stockQty).length : 0;
  /* 서버가 그린 시각 기준이다. 화면을 오래 열어 둔 사이 만료되면 DB가 거절하고 같은 안내를 보인다. */
  const expired = snapshot ? Date.parse(now) - Date.parse(snapshot.createdAt) > 24 * 60 * 60 * 1000 : false;
  const apply = () => {
    if (!snapshot || snapshot.appliedAt) return;
    const trimmed = reason.trim();
    if (!trimmed || trimmed.length > STOCK_RECONCILE_REASON_LIMIT) { setError('반영 사유를 200자 이내로 입력해주세요.'); return; }
    const shortages = snapshot.items.filter((item) => stockReconcileRowState(item) === 'shortage').length;
    const confirmText = changedCount
      ? `옵션 ${count(changedCount)}개의 재고수량을 파일에 맞춰 바꿉니다${shortages ? `(부족 ${count(shortages)}개는 0으로)` : ''}. 반영할까요?`
      : '바뀌는 옵션이 없습니다. 이 파일로 대조했다는 기록만 남길까요?';
    if (!window.confirm(confirmText)) return;
    setError(''); setMessage(''); setConflicts([]);
    startWorking(async () => {
      let result: Awaited<ReturnType<typeof applyStockReconcileAction>>;
      try { result = await applyStockReconcileAction({ snapshotId: snapshot.id, expectedChanges: changedCount, reason: trimmed }); }
      catch { result = { ok: false, error: '반영 요청이 끊겼습니다. 같은 사유로 다시 누르면 처음 결과를 확인합니다.' }; }
      if (!result.ok) { setError(result.error); return; }
      if (result.outcome.status === 'conflict') { setConflicts(result.outcome.conflicts); return; }
      const applied = result.outcome.snapshot;
      setSnapshot(applied);
      const outcome = applied.applyResult;
      setMessage(outcome ? `반영했습니다. 늘림 ${count(outcome.increased)} · 줄임 ${count(outcome.decreased)}${outcome.shortages ? ` · 부족 ${count(outcome.shortages)}(0으로)` : ''} · 합계 ${signed(outcome.totalDelta)}개.` : '반영했습니다.');
      router.refresh();
    });
  };

  const headerOptions = source ? source.table.slice(0, STOCK_RECONCILE_HEADER_SCAN_ROWS) : [];

  return <div className="flex min-w-0 flex-col gap-5" data-stock-reconcile="panel">
    <div className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))] print:hidden">
      <div className="flex min-w-0 flex-col gap-2">
        <label className="text-sm leading-snug font-medium" htmlFor="stock-reconcile-origin">어느 창고(출고지) 파일인가요</label>
        <AdminSelect id="stock-reconcile-origin" value={originId} disabled={busy} wrapperClassName="w-full" aria-describedby="stock-reconcile-origin-hint"
          onChange={(event) => setOriginId(event.target.value)}>
          <option value="">출고지 구분 없이 대조</option>
          {origins.map((origin) => <option key={origin.id} value={origin.id}>{origin.name}{origin.active ? '' : ' (비활성)'}</option>)}
        </AdminSelect>
        <p className={HINT} id="stock-reconcile-origin-hint">고르면 다른 출고지 상품의 행은 반영하지 않습니다. 창고 한 곳의 재고 파일이면 그 출고지를 고르세요.</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label className="text-sm leading-snug font-medium" htmlFor="stock-reconcile-as-of">파일의 재고 기준 시각 (한국 시간)</label>
        <Input id="stock-reconcile-as-of" type="datetime-local" step={60} value={asOf} disabled={busy} className="w-60" aria-describedby="stock-reconcile-as-of-hint"
          onChange={(event) => setAsOf(event.target.value)} />
        <p className={HINT} id="stock-reconcile-as-of-hint">ERP·창고에서 재고를 내려받은 시각입니다(7일 안). 그 뒤에 출고한 주문은 파일에 아직 들어 있고, 그 뒤에 회수한 반품·교환은 아직 없다고 보고 계산합니다.</p>
      </div>
    </div>
    <div className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))] print:hidden">
      <div className="flex min-w-0 flex-col gap-2">
        <label className="text-sm leading-snug font-medium" htmlFor="stock-reconcile-paste">붙여넣기</label>
        <Textarea className="min-h-32 font-mono text-[13px] field-sizing-fixed" id="stock-reconcile-paste" rows={5} value={pasted} disabled={busy}
          aria-describedby="stock-reconcile-paste-hint" placeholder={'품번\t품명\t바코드\t재고수량\n000123\t아크릴 키링\t8801234567890\t42'}
          onChange={(event) => setPasted(event.target.value)} />
        <p className={HINT} id="stock-reconcile-paste-hint">관리코드·ERP 코드(품번)·바코드·판매자상품코드 중 하나와 재고 수량 열이 있어야 합니다. 머리글 행까지 복사하면 열을 자동으로 짝짓습니다.</p>
        <div><Button variant={source ? 'outline' : 'default'} type="button" disabled={busy} onClick={readPasted}>붙여넣은 표 확인</Button></div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {/* 섹션 카드가 stock-reconcile-file id를 쓰므로 파일 입력은 다른 id로 라벨에 잇는다(QA1 S-T07-01 접근성). */}
        <label className="text-sm leading-snug font-medium" htmlFor="stock-reconcile-file-input">또는 파일 선택</label>
        <Input ref={fileInput} id="stock-reconcile-file-input" type="file" disabled={busy} aria-describedby="stock-reconcile-file-hint"
          accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) readFile(file); }} />
        <p className={HINT} id="stock-reconcile-file-hint">XLSX·CSV {FILE_KB}KB 이하, 한 번에 {count(STOCK_RECONCILE_ROW_LIMIT)}행까지. XLS는 XLSX로 다시 저장해 올려주세요.</p>
        {reading ? <p className={HINT} role="status">파일을 읽는 중입니다.</p> : null}
      </div>
    </div>

    <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {message ? <p className="text-sm text-success" role="status">{message}</p> : null}
      {working ? <p className={HINT} role="status">처리 중입니다.</p> : null}
    </div>

    {source && plan ? <div className="flex min-w-0 flex-col gap-4 border-t pt-4" data-stock-reconcile="plan">
      <header className="flex flex-col gap-1">
        <h4 className="text-base leading-snug font-medium wrap-anywhere">파일 확인 · {source.label}</h4>
        <p className={`${HINT} tabular-nums`}>비어 있지 않은 {count(plan.dataRowCount)}행 · 대조할 행 {count(plan.rows.length)} · 대조하지 않는 행 {count(plan.issues.length)}</p>
      </header>
      <div className="flex max-w-[35rem] min-w-0 flex-col gap-2">
        <label className="text-sm leading-snug font-medium" htmlFor="stock-reconcile-header-row">머리글 행</label>
        <AdminSelect id="stock-reconcile-header-row" value={plan.headerIndex} disabled={busy} wrapperClassName="w-full"
          onChange={(event) => { setHeaderIndex(Number(event.target.value)); setMapping(undefined); }}>
          <option value={-1}>머리글 없음 · 첫 행부터 재고</option>
          {headerOptions.map((row, index) => <option key={index} value={index}>
            {index + 1}행 · {row.map((cell) => normalizeErpText(cell, true)).filter(Boolean).slice(0, 4).join(' / ').slice(0, 60) || '빈 행'}
          </option>)}
        </AdminSelect>
      </div>
      <div className={TABLE_REGION} role="region" aria-label="열 짝짓기" tabIndex={0}>
        <table className={TABLE} data-slot="table">
          <caption className={CAPTION}>열마다 가져올 항목을 고릅니다. 코드 열은 여러 개 골라도 됩니다(먼저 맞는 코드로 옵션을 찾습니다).</caption>
          <TableHeader><TableRow><TableHead scope="col">파일의 열</TableHead><TableHead scope="col">첫 값</TableHead><TableHead scope="col">가져올 항목</TableHead></TableRow></TableHeader>
          <TableBody>{plan.columns.map((column) => <TableRow key={column.index}>
            <TableHead scope="row" className="font-medium whitespace-normal">{column.label}</TableHead>
            <TableCell className="max-w-64 whitespace-normal wrap-anywhere text-muted-foreground">{column.sample || '-'}</TableCell>
            <TableCell>
              <AdminSelect aria-label={`${column.label} 열의 항목`} value={column.target} disabled={busy} wrapperClassName="w-48"
                onChange={(event) => setMapping(assignStockColumnTarget(plan.columns.map((entry) => entry.target), column.index, event.target.value as StockColumnTarget))}>
                {STOCK_COLUMN_TARGETS.map((target) => <option key={target} value={target}>{STOCK_COLUMN_TARGET_LABELS[target]}</option>)}
              </AdminSelect>
            </TableCell>
          </TableRow>)}</TableBody>
        </table>
      </div>
      {[...source.warnings, ...plan.warnings].length ? <AdminNotice tone="warning"><ul className="flex list-disc flex-col gap-1.5 pl-4">
        {[...source.warnings, ...plan.warnings].map((warning) => <li key={warning}>{warning}</li>)}
      </ul></AdminNotice> : null}
      {plan.issues.length ? <div className={TABLE_REGION} role="region" aria-label="대조하지 않는 행" tabIndex={0}>
        <table className={TABLE} data-slot="table">
          <caption className={CAPTION}>대조하지 않는 행(파일에서 고쳐 다시 올려주세요){plan.issues.length > ISSUE_LIST_LIMIT ? ` · 앞 ${count(ISSUE_LIST_LIMIT)}건만 표시` : ''}</caption>
          <TableHeader><TableRow><TableHead scope="col">행</TableHead><TableHead scope="col">코드</TableHead><TableHead scope="col">사유</TableHead></TableRow></TableHeader>
          <TableBody>{plan.issues.slice(0, ISSUE_LIST_LIMIT).map((issue) => <TableRow key={issue.row}>
            <TableCell className="tabular-nums">{count(issue.row)}</TableCell>
            <TableCell className={CODE}>{issue.key || '-'}</TableCell>
            <TableCell className="whitespace-normal">{STOCK_CLIENT_ISSUE_LABELS[issue.reason]}</TableCell>
          </TableRow>)}</TableBody>
        </table>
      </div> : null}
      {plan.blocking ? <p className="text-sm text-destructive" role="alert">{plan.blocking}</p> : null}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button type="button" variant={snapshot ? 'outline' : 'default'} disabled={busy || Boolean(plan.blocking)} onClick={() => preview()}>{count(plan.rows.length)}행 미리보기</Button>
        <Button variant="ghost" type="button" disabled={busy} onClick={reset}>처음부터 다시</Button>
      </div>
    </div> : null}

    {snapshot ? <div className="flex min-w-0 flex-col gap-4 border-t pt-4" data-stock-reconcile="preview">
      <header className="flex flex-wrap items-center gap-2">
        <h4 className="text-base leading-snug font-medium">{snapshot.appliedAt ? '반영한 대조' : '미리보기'}</h4>
        {snapshot.appliedAt ? <AdminStatusBadge tone="success">반영 {formatOrderDateTime(snapshot.appliedAt)}{snapshot.appliedByName ? ` · ${snapshot.appliedByName}` : ''}</AdminStatusBadge>
          : <AdminStatusBadge tone="warning">아직 반영 안 함</AdminStatusBadge>}
      </header>
      <StockReconcileResult snapshot={snapshot} showSame={showSame} onToggleSame={() => setShowSame((value) => !value)} />
      <DefectiveStockReference items={snapshot.items.map((item) => ({ variantId: item.variantId, label: itemName(item) }))} />
      {conflicts.length ? <StockReconcileConflictNotice conflicts={conflicts} busy={busy} onRestart={reset}
        onRepreview={source && plan && !plan.blocking && plan === previewedPlan ? () => preview(true) : undefined} /> : null}
      {!snapshot.appliedAt ? expired ? <AdminNotice tone="warning">24시간이 지난 미리보기는 반영할 수 없습니다. 파일을 다시 올려 미리보기 해주세요.</AdminNotice>
        : <div className="flex flex-col gap-3 print:hidden">
          <div className="flex max-w-[35rem] min-w-0 flex-col gap-2">
            <label className="text-sm leading-snug font-medium" htmlFor="stock-reconcile-reason">반영 사유</label>
            <Input id="stock-reconcile-reason" value={reason} maxLength={STOCK_RECONCILE_REASON_LIMIT} disabled={busy} aria-describedby="stock-reconcile-reason-hint"
              onChange={(event) => setReason(event.target.value)} />
            <p className={HINT} id="stock-reconcile-reason-hint">옵션마다 감사 기록에 남습니다. 예: 서원 11/12 09시 재고 대조.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 거절된 미리보기는 값이 낡았다. 다시 미리보기한 뒤에 반영한다. */}
            <Button type="button" disabled={busy || !reason.trim() || conflicts.length > 0} onClick={apply}>{changedCount ? `옵션 ${count(changedCount)}개 재고 반영` : '대조 기록만 남기기'}</Button>
            {!source ? <Button variant="ghost" type="button" disabled={busy} onClick={reset}>새 파일 대조</Button> : null}
          </div>
        </div> : !source ? <div><Button variant="outline" type="button" disabled={busy} onClick={reset}>새 파일 대조</Button></div> : null}
    </div> : null}
  </div>;
}
