'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { unstable_rethrow, useRouter } from 'next/navigation';
import {
  commitErpLinkedGoodsAction,
  previewErpLinkedGoodsAction,
  type ErpLinkedGoodsCommitResult,
  type ErpLinkedGoodsPreviewResult,
} from '@/app/admin/erp-item-actions';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import {
  ERP_LINKED_GOODS_BARCODE_WARNING,
  ERP_LINKED_GOODS_FIELD_LABELS,
  ERP_LINKED_GOODS_PREVIEW_LIMIT,
  ERP_LINKED_GOODS_SKIP_LABELS,
  ERP_LINKED_GOODS_SKIP_SHORT_LABELS,
  erpLinkedGoodsConfirmation,
  erpLinkedGoodsCounts,
  erpLinkedGoodsFailureLabel,
  formatErpLinkedGoodsValue,
  type ErpLinkedGoodsFailure,
  type ErpLinkedGoodsPreview,
  type ErpLinkedGoodsRow,
} from '@/lib/admin/erp-linked-goods';
import { GOODS_LIST_PATH } from '@/lib/admin/goods-list';
import { statusTone } from '@/lib/admin/status-tone';
import { useErpItemsWorkspace } from './ErpItemsWorkspace';

const PREVIEW_REQUEST_FAILED = '연결 상품과 비교하지 못했습니다. 다시 비교해주세요.';
const COMMIT_REQUEST_FAILED = '반영 결과를 받지 못했습니다. 같은 미리보기에서 다시 반영하면 이미 반영한 행은 다시 바꾸지 않습니다.';
const TABLE_REGION = 'relative max-h-[520px] min-w-0 overflow-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50 print:max-h-none print:overflow-visible [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted';
const HINT = 'text-sm text-muted-foreground';

type Loaded = { preview: ErpLinkedGoodsPreview; pasted: boolean };
/** 마지막으로 비교한 범위. null은 전체 품목, 배열은 방금 반입한 ERP 코드. */
type Scope = { codes: readonly string[] | null };
type Status = { tone: 'success' | 'warning' | 'danger'; text: string };

const count = (value: number) => value.toLocaleString('ko-KR');
const editorHref = (goodId: string) => `${GOODS_LIST_PATH}?${new URLSearchParams({ goodId })}`;

function RowState({ row }: { row: ErpLinkedGoodsRow }) {
  if (row.status === 'skip' && row.reason) {
    return <div className="flex min-w-0 flex-col items-start gap-1">
      <AdminStatusBadge tone={statusTone('erpLinkedGoods', 'skip')}>건너뜀 · {ERP_LINKED_GOODS_SKIP_SHORT_LABELS[row.reason]}</AdminStatusBadge>
      <span className="text-xs whitespace-normal text-muted-foreground">{ERP_LINKED_GOODS_SKIP_LABELS[row.reason]}</span>
    </div>;
  }
  if (row.warning === 'barcode_changed') {
    return <div className="flex min-w-0 flex-col items-start gap-1">
      <AdminStatusBadge tone={statusTone('erpLinkedGoods', 'barcode_changed')}>바코드 바뀜</AdminStatusBadge>
      <span className="text-xs whitespace-normal text-warning">{ERP_LINKED_GOODS_BARCODE_WARNING}</span>
    </div>;
  }
  return <AdminStatusBadge tone={statusTone('erpLinkedGoods', 'apply')}>{row.current === null ? '빈 칸 채움' : '반영'}</AdminStatusBadge>;
}

/**
 * 연결 상품 반영(1027T-X04): 같은 ERP 코드를 넣은 상품 옵션의 판매가·바코드가 반입한 ERP 값과 다르면 미리보기로 보이고,
 * 운영자가 고른 행만 확정해 반영한다. 미리보기는 DB가 15분 동안 고정하고, 확정은 그 사이 값이 바뀌었으면 아무것도 바꾸지 않는다.
 * 반입을 마치면 반입 패널이 방금 반입한 품목으로 비교를 시작한다(ErpItemsWorkspace).
 */
export function ErpLinkedGoodsPanel() {
  const router = useRouter();
  const workspace = useErpItemsWorkspace();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<Status | null>(null);
  const [failures, setFailures] = useState<ErpLinkedGoodsFailure[]>([]);
  const [scope, setScope] = useState<Scope | null>(null);
  const [pending, startTransition] = useTransition();

  const compare = useCallback((codes: readonly string[] | null) => {
    setStatus(null);
    setFailures([]);
    setScope({ codes });
    startTransition(async () => {
      let result: ErpLinkedGoodsPreviewResult;
      /* 응답을 못 받아도 오류 화면으로 넘어가지 않게 한다. 로그인 이동은 그대로 흘려보낸다. */
      try { result = await previewErpLinkedGoodsAction(codes ? [...codes] : null); }
      catch (error) { unstable_rethrow(error); result = { ok: false, error: PREVIEW_REQUEST_FAILED }; }
      if (!result.ok) { setLoaded(null); setStatus({ tone: 'danger', text: result.error }); return; }
      setLoaded({ preview: result.preview, pasted: codes !== null });
      setSelected(new Set(result.preview.rows.filter((row) => row.status === 'apply').map((row) => row.key)));
    });
  }, []);

  useEffect(() => {
    if (!workspace) return undefined;
    workspace.registerCompare((codes) => compare(codes));
    return () => workspace.registerCompare(null);
  }, [workspace, compare]);

  const rows = loaded?.preview.rows ?? [];
  const applicable = rows.filter((row) => row.status === 'apply');
  const chosen = applicable.filter((row) => selected.has(row.key));
  const counts = erpLinkedGoodsCounts(rows);
  const allChosen = applicable.length > 0 && chosen.length === applicable.length;
  const someChosen = chosen.length > 0 && !allChosen;

  const toggle = (key: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(key);
    else next.delete(key);
    return next;
  });

  const commit = () => {
    if (!loaded || pending || !chosen.length) return;
    if (!window.confirm(erpLinkedGoodsConfirmation(chosen))) return;
    const request = { operationId: loaded.preview.operationId, keys: chosen.map((row) => row.key) };
    setStatus(null);
    startTransition(async () => {
      let result: ErpLinkedGoodsCommitResult;
      try { result = await commitErpLinkedGoodsAction(request); }
      catch (error) { unstable_rethrow(error); result = { ok: false, error: COMMIT_REQUEST_FAILED }; }
      /* 요청 오류(고른 행·다른 작업 중)는 미리보기를 남겨 고쳐서 다시 반영하게 한다. */
      if (!result.ok) { setStatus({ tone: 'danger', text: result.error }); return; }
      setLoaded(null);
      if (result.receipt.state === 'rejected') { setStatus({ tone: 'danger', text: result.message }); return; }
      setFailures(result.receipt.failed);
      setStatus({ tone: result.receipt.failed.length ? 'warning' : 'success', text: result.message });
      router.refresh();
    });
  };

  const summary = loaded ? (() => {
    const { preview } = loaded;
    const compared = loaded.pasted
      ? `방금 반입한 품목 ${count(preview.scopeCount ?? 0)}개와 비교했습니다.`
      : '반입한 전체 ERP 품목과 비교했습니다.';
    if (!preview.linked) return `${compared} 같은 ERP 코드를 넣은 상품 옵션이 없습니다. 상품 옵션의 ERP 품명에서 ERP 품목을 고르면 연결됩니다.`;
    if (!preview.total) return `${compared} 연결 옵션 ${count(preview.linked)}개의 판매가·바코드가 반입한 값과 모두 같습니다.`;
    return `${compared} 연결 옵션 ${count(preview.linked)}개 중 값이 다른 행 ${count(preview.total)}건 · 반영할 수 있는 판매가 ${count(counts.price)}건·바코드 ${count(counts.barcode)}건 · 건너뜀 ${count(counts.skipped)}건.`;
  })() : null;

  return <div className="flex min-w-0 flex-col gap-3" data-erp-items="linked-goods">
    <p className={HINT}>
      옵션에 같은 ERP 코드를 넣은 상품(연결 상품)의 판매가·바코드가 반입한 ERP 값과 다르면 미리보기로 보여 주고, 고른 행만 반영합니다.
      판매가는 그 옵션의 할인 전 판매 금액으로 맞춥니다(기본 옵션이면 상품 판매가, 다른 옵션이면 옵션가). 할인 중인 상품(기간 할인 진행·예정, 상품 할인가 설정)은 건너뜁니다.
      ERP에 바코드가 없으면 상품 바코드를 지우지 않습니다. 붙여넣어 반입하면 방금 반입한 품목과 자동으로 비교합니다.
    </p>
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button variant="outline" type="button" disabled={pending} onClick={() => compare(null)}>{pending && !loaded ? '비교 중' : '전체 품목과 비교'}</Button>
      {/* 반영한 뒤에도 같은 범위로 다시 볼 수 있게 한다(방금 반입한 품목이면 그 품목만). */}
      {scope?.codes && !loaded ? <Button variant="outline" type="button" disabled={pending} onClick={() => compare(scope.codes)}>방금 반입한 품목과 다시 비교</Button> : null}
      {loaded ? <Button variant="ghost" type="button" disabled={pending} onClick={() => { setLoaded(null); setStatus(null); }}>미리보기 닫기</Button> : null}
    </div>

    <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
      {status ? <p className={`text-sm ${status.tone === 'danger' ? 'text-destructive' : status.tone === 'warning' ? 'text-warning' : 'text-success'}`} role={status.tone === 'danger' ? 'alert' : 'status'}>{status.text}</p> : null}
      {summary ? <p className="text-sm tabular-nums" role="status">{summary}</p> : null}
    </div>

    {failures.length ? <div className={TABLE_REGION} role="region" aria-label="반영하지 못한 행" tabIndex={0}>
      <table className="w-full min-w-[640px] caption-top text-sm" data-slot="table">
        <caption className="px-2 py-2 text-left text-sm text-muted-foreground">반영하지 못한 행 · 상품 화면에서 저장해 보고 사유를 확인한 뒤 다시 비교해주세요.</caption>
        <TableHeader><TableRow><TableHead scope="col">상품 · 옵션</TableHead><TableHead scope="col">항목</TableHead><TableHead scope="col">사유</TableHead></TableRow></TableHeader>
        <TableBody>{failures.map((failure) => <TableRow key={failure.key}>
          <TableCell className="whitespace-normal"><Link className="underline underline-offset-4" href={editorHref(failure.goodId)} target="_blank" rel="noreferrer">{failure.goodName}</Link> · {failure.optionName}</TableCell>
          <TableCell>{ERP_LINKED_GOODS_FIELD_LABELS[failure.field]}</TableCell>
          <TableCell className="whitespace-normal">
            <AdminStatusBadge tone={statusTone('erpLinkedGoods', 'failed')}>반영 못 함</AdminStatusBadge>{' '}
            <span className="text-xs text-muted-foreground">{erpLinkedGoodsFailureLabel(failure.error)}</span>
          </TableCell>
        </TableRow>)}</TableBody>
      </table>
    </div> : null}

    {loaded && rows.length ? <>
      {loaded.preview.truncated ? <AdminNotice tone="info">값이 다른 행이 많아 앞 {count(ERP_LINKED_GOODS_PREVIEW_LIMIT)}건만 보입니다. 반영한 뒤 다시 비교하면 나머지 행이 나옵니다.</AdminNotice> : null}
      {counts.barcodeChanges ? <AdminNotice tone="warning" title={`바코드가 바뀌는 행 ${count(counts.barcodeChanges)}건`}>{ERP_LINKED_GOODS_BARCODE_WARNING}</AdminNotice> : null}
      <div className={TABLE_REGION} role="region" aria-label="연결 상품 반영 미리보기" tabIndex={0}>
        <table className="w-full min-w-[880px] caption-top text-sm" data-slot="table">
          <caption className="px-2 py-2 text-left text-sm text-muted-foreground">값이 다른 연결 옵션 · 체크한 행만 반영합니다. 미리보기는 15분 동안 반영할 수 있습니다.</caption>
          <TableHeader><TableRow>
            <TableHead className="w-10 p-0" scope="col"><label className="flex h-10 cursor-pointer items-center justify-center">
              <input aria-label="반영할 수 있는 행 전체 선택" type="checkbox" checked={allChosen} disabled={!applicable.length || pending}
                ref={(element) => { if (element) element.indeterminate = someChosen; }}
                onChange={(event) => setSelected(event.target.checked ? new Set(applicable.map((row) => row.key)) : new Set())} />
            </label></TableHead>
            <TableHead scope="col">상품 · 옵션</TableHead>
            <TableHead scope="col">ERP 코드</TableHead>
            <TableHead scope="col">항목</TableHead>
            <TableHead scope="col" className="text-right">지금 값</TableHead>
            <TableHead scope="col" className="text-right">ERP 값</TableHead>
            <TableHead scope="col">상태</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map((row) => <TableRow key={row.key} data-state={row.status === 'apply' && selected.has(row.key) ? 'selected' : undefined}>
            <TableCell className="p-0 align-top">
              {row.status === 'apply' ? <label className="flex cursor-pointer justify-center pt-3 pb-2">
                <input aria-label={`${row.goodName} ${row.optionName} ${ERP_LINKED_GOODS_FIELD_LABELS[row.field]} 반영`} type="checkbox" checked={selected.has(row.key)} disabled={pending}
                  onChange={(event) => toggle(row.key, event.target.checked)} />
              </label> : null}
            </TableCell>
            <TableHead scope="row" className="h-auto py-2 align-top font-normal whitespace-normal text-foreground">
              <Link className="underline underline-offset-4" href={editorHref(row.goodId)} target="_blank" rel="noreferrer">{row.goodName}</Link>
              <span className="block text-xs text-muted-foreground">{row.isDefault ? `${row.optionName} · 기본 옵션` : row.optionName}{row.published ? '' : ' · 비공개'}</span>
            </TableHead>
            <TableCell className="align-top"><span className="font-mono text-xs tabular-nums">{row.erpCode}</span></TableCell>
            <TableCell className="align-top">{ERP_LINKED_GOODS_FIELD_LABELS[row.field]}</TableCell>
            <TableCell className={`text-right align-top ${row.field === 'barcode' ? 'font-mono text-xs' : ''} tabular-nums`}>{formatErpLinkedGoodsValue(row.field, row.current)}</TableCell>
            <TableCell className={`text-right align-top font-medium ${row.field === 'barcode' ? 'font-mono text-xs' : ''} tabular-nums`}>{formatErpLinkedGoodsValue(row.field, row.next)}</TableCell>
            <TableCell className="max-w-72 align-top whitespace-normal"><RowState row={row} /></TableCell>
          </TableRow>)}</TableBody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button type="button" disabled={pending || !chosen.length} onClick={commit}>{pending ? '처리 중' : `선택한 ${count(chosen.length)}건 반영`}</Button>
        <Button variant="outline" type="button" disabled={pending} onClick={() => compare(scope?.codes ?? null)}>다시 비교</Button>
      </div>
    </> : null}
  </div>;
}
