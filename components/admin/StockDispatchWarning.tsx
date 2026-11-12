import Link from 'next/link';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { STOCK_RECONCILE_PATH, type StockDispatchWarnings } from '@/lib/admin/stock-reconcile';
import { formatOrderDateTime } from '@/lib/orders';

const LIST_LIMIT = 8;
const count = (value: number) => value.toLocaleString('ko-KR');
const signed = (value: number) => (value > 0 ? `+${count(value)}` : count(value));
const name = (row: { goodsName: string; optionName: string }) =>
  row.optionName && row.optionName !== '기본 옵션' ? `${row.goodsName} / ${row.optionName}` : row.goodsName;

/**
 * 출고지시 전 재고 경고(1007-011). 지금 출고를 기다리는 옵션마다 가장 최근 재고 파일 대조와 비교해
 * 창고가 다 보낼 수 없는 옵션(부족)과 사이트·창고 수량이 어긋난 옵션(차이)을 출고지시 내려받기 전에 보인다.
 * 창고 예상 수량은 파일에서 기준 시각 뒤 출고를 빼고 회수를 더한 뒤 회수 뒤 재고 미반영분을 뺀 값이고,
 * 그룹상품 전환 전 옵션의 주문은 지금 재고를 가진 승계 옵션으로 묶어 센다.
 * 데이터는 `loadStockDispatchWarnings(originId)`가 준다. 경고만 하고 출고를 막지 않는다 — 판단은 운영자가 한다.
 * 불러오지 못했거나(null) 경고할 것이 없으면 아무것도 그리지 않는다.
 */
export function StockDispatchWarning({ data }: { data: StockDispatchWarnings | null }) {
  if (!data || (!data.warnings.length && !data.unreconciledCount)) return null;
  const shortages = data.warnings.filter((warning) => warning.kind === 'shortage');
  const mismatches = data.warnings.filter((warning) => warning.kind === 'mismatch');
  const tone = shortages.length ? 'danger' : mismatches.length ? 'warning' : 'info';
  const title = shortages.length
    ? `창고 재고보다 출고할 주문이 많은 옵션 ${count(shortages.length)}개`
    : mismatches.length ? `재고 파일과 수량이 다른 옵션 ${count(mismatches.length)}개` : `재고 파일로 대조한 적 없는 출고 대기 옵션 ${count(data.unreconciledCount)}개`;
  return <AdminNotice tone={tone} title={title} role={shortages.length ? 'alert' : undefined}>
    <div className="flex flex-col gap-2" data-stock-dispatch-warning={tone}>
      {data.warnings.length ? <ul className="flex list-disc flex-col gap-1 pl-4">
        {data.warnings.slice(0, LIST_LIMIT).map((warning) => <li key={warning.variantId}>
          <span className="font-medium">{name(warning)}</span> <span className="font-mono text-xs">{warning.optionCode}</span>{' — '}
          {warning.kind === 'shortage'
            ? `출고 대기 ${count(warning.pendingQty)}개 · 창고 예상 ${count(warning.expectedQty)}개(부족 ${count(warning.shortageQty)})`
            : `재고 파일과 차이 ${signed(warning.difference)}개`}
          <span className="text-muted-foreground"> · 파일 기준 {formatOrderDateTime(warning.asOf)}</span>
        </li>)}
        {data.warnings.length > LIST_LIMIT ? <li className="list-none text-muted-foreground">외 {count(data.warnings.length - LIST_LIMIT)}개</li> : null}
      </ul> : null}
      {data.unreconciledCount && data.warnings.length ? <p className="text-muted-foreground">재고 파일로 대조한 적 없는 출고 대기 옵션도 {count(data.unreconciledCount)}개 있습니다.</p> : null}
      {!data.warnings.length && data.unreconciled.length ? <p className="text-muted-foreground">{data.unreconciled.slice(0, 3).map(name).join(', ')}{data.unreconciledCount > Math.min(3, data.unreconciled.length) ? ` 외 ${count(data.unreconciledCount - Math.min(3, data.unreconciled.length))}개` : ''}</p> : null}
      <p>창고 실재고를 확인한 뒤 출고지시를 내려받아 주세요. <Link className="underline underline-offset-4" href={STOCK_RECONCILE_PATH}>재고 대조</Link>에서 최신 창고·ERP 재고 파일을 올리면 다시 계산합니다.</p>
    </div>
  </AdminNotice>;
}
