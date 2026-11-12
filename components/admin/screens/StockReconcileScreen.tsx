import Link from 'next/link';
import { AdminNotice, AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { StockReconcilePanel, type StockReconcileOrigin } from '@/components/admin/StockReconcilePanel';
import { StockSafetyDigestPanel } from '@/components/admin/StockSafetyDigestPanel';
import { STOCK_RECONCILE_PATH, type StockReconcileDocument, type StockReconcileSummary } from '@/lib/admin/stock-reconcile';
import type { StockSafetyDigestSettings } from '@/lib/admin/stock-safety-digest';
import { formatOrderDateTime } from '@/lib/orders';

const count = (value: number) => value.toLocaleString('ko-KR');

function HistoryTable({ history }: { history: StockReconcileSummary[] }) {
  if (!history.length) return <p className="text-muted-foreground">아직 대조한 파일이 없습니다.</p>;
  return <div className="min-w-0 rounded-lg border">
    <Table className="min-w-[760px]" stickyHeader>
      <caption className="sr-only">최근 재고 파일 대조 20건</caption>
      <TableHeader><TableRow>
        <TableHead scope="col">미리보기</TableHead><TableHead scope="col">파일</TableHead><TableHead scope="col">출고지</TableHead>
        <TableHead scope="col">재고 기준</TableHead><TableHead scope="col" className="text-right">찾은 옵션</TableHead>
        <TableHead scope="col" className="text-right">바뀌는 옵션</TableHead><TableHead scope="col">반영</TableHead>
      </TableRow></TableHeader>
      <TableBody>{history.map((row) => <TableRow key={row.id}>
        <TableCell className="whitespace-nowrap tabular-nums"><Link className="underline underline-offset-4" href={`${STOCK_RECONCILE_PATH}?snapshot=${row.id}`}>{formatOrderDateTime(row.createdAt)}</Link>
          {row.createdByName ? <span className="block text-xs text-muted-foreground">{row.createdByName}</span> : null}</TableCell>
        <TableCell className="max-w-64 whitespace-normal wrap-anywhere">{row.sourceLabel}</TableCell>
        <TableCell>{row.originName ?? '구분 없음'}</TableCell>
        <TableCell className="whitespace-nowrap tabular-nums">{formatOrderDateTime(row.asOf)}</TableCell>
        <TableCell className="text-right tabular-nums">{count(row.matchedCount)}{row.issueCount ? <span className="block text-xs text-muted-foreground">반영 안 함 {count(row.issueCount)}</span> : null}</TableCell>
        <TableCell className="text-right tabular-nums">{count(row.changedCount)}</TableCell>
        <TableCell>{row.appliedAt
          ? <><AdminStatusBadge tone="success">반영함</AdminStatusBadge><span className="block text-xs text-muted-foreground tabular-nums">{formatOrderDateTime(row.appliedAt)}{row.appliedByName ? ` · ${row.appliedByName}` : ''}</span></>
          : <AdminStatusBadge tone="neutral">미리보기만</AdminStatusBadge>}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </div>;
}

/**
 * 재고 대조(1007-009·1007-011·QNA-014). ERP·창고 재고 파일을 올려 사이트 할당 재고와 맞추고(ADR-0005 — 파일은 ICONS 몫 수량),
 * 안전재고 이하 옵션 요약 메일을 설정한다. ERP·창고와 자동으로 연동되지는 않는다.
 */
export function StockReconcileScreen({ origins, history, snapshot, digest, canManageDigest, now }: {
  origins: StockReconcileOrigin[]; history: StockReconcileSummary[]; snapshot: StockReconcileDocument | null;
  digest: StockSafetyDigestSettings | null; canManageDigest: boolean; now: string;
}) {
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="stock-reconcile">
    <AdminPageHeader title="재고 대조" description="ERP·창고 재고 파일(ICONS 몫 수량)을 올려 사이트 재고수량과의 차이를 미리 보고, 확인한 뒤 한 번에 반영합니다. ERP·창고와 자동으로 연동되지는 않습니다." />
    <AdminSectionCard id="stock-reconcile-file" title="재고 파일 대조"
      summary="파일 수량에서 아직 출고하지 않은 주문을 빼서 맞춥니다. 주문을 받으면 사이트 재고수량은 바로 줄지만 창고 실물은 출고할 때 줄기 때문입니다.">
      <StockReconcilePanel origins={origins} initialSnapshot={snapshot} now={now} />
    </AdminSectionCard>
    <AdminSectionCard id="stock-reconcile-history" title="최근 대조 기록" summary="미리보기만 한 파일도 남습니다. 출고지시 전 경고는 옵션마다 가장 최근 파일을 기준으로 합니다.">
      <HistoryTable history={history} />
    </AdminSectionCard>
    <AdminSectionCard id="stock-safety-digest" title="안전재고 요약 메일" summary="하루 한 번 안전재고 기준 이하 옵션을 운영자와 출고지 담당자에게 메일로 보냅니다.">
      {canManageDigest && digest ? <StockSafetyDigestPanel initial={digest} />
        : canManageDigest ? <AdminNotice tone="danger" role="alert">요약 메일 설정을 불러오지 못했습니다. 새로고침한 뒤 다시 확인해주세요.</AdminNotice>
          : <AdminNotice tone="neutral">요약 메일 설정은 계정 주매니저 이상만 볼 수 있습니다. 재고 정보를 창고 담당자에게 보내는 설정이기 때문입니다.</AdminNotice>}
    </AdminSectionCard>
  </div>;
}
