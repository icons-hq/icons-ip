'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readDefectiveQtyForVariantsAction } from '@/app/admin/defective-stock-actions';
import { DEFECTIVE_STOCK_PATH } from '@/lib/admin/defective-stock';

/**
 * 재고 대조의 참고 칸(QNA-035). 대조하는 옵션 가운데 반품 불량으로 기록된 수량이 있으면 알린다.
 * 불량 수량은 판매 재고(재고수량)에 들어 있지 않고 대조 계산에도 쓰지 않는다 — 창고 파일에 불량품이 섞여 있을 때 차이를
 * 읽는 참고다. 읽지 못하거나 불량이 없으면 아무것도 그리지 않는다.
 */
export function DefectiveStockReference({ items }: { items: { variantId: string; label: string }[] }) {
  const key = items.map((item) => item.variantId).join(',');
  const [found, setFound] = useState<{ key: string; qty: Record<string, number> } | null>(null);
  useEffect(() => {
    let alive = true;
    readDefectiveQtyForVariantsAction(key ? key.split(',') : []).then(
      (qty) => { if (alive) setFound({ key, qty }); },
      () => { if (alive) setFound({ key, qty: {} }); },
    );
    return () => { alive = false; };
  }, [key]);
  if (!found || found.key !== key) return null;
  const rows = items.filter((item) => (found.qty[item.variantId] ?? 0) > 0);
  if (rows.length === 0) return null;
  return <section aria-label="불량 재고 참고" className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-muted/30 p-3 text-sm" data-stock-reconcile="defective-reference">
    <h5 className="font-medium">참고 · 반품 불량 재고</h5>
    <p className="text-xs text-muted-foreground">
      아래 옵션에는 반품 불량으로 따로 기록한 수량이 있습니다. 판매 재고에는 들어 있지 않고 위 계산에도 쓰지 않았습니다. 창고 파일에 불량품이 포함돼 있으면 그만큼 차이가 날 수 있습니다.{' '}
      <Link className="underline underline-offset-4" href={DEFECTIVE_STOCK_PATH}>불량 재고 보기</Link>
    </p>
    <ul className="flex list-disc flex-col gap-0.5 pl-4">
      {rows.map((item) => <li key={item.variantId}>{item.label} · 불량 <span className="tabular-nums">{(found.qty[item.variantId] ?? 0).toLocaleString('ko-KR')}</span>개</li>)}
    </ul>
  </section>;
}
