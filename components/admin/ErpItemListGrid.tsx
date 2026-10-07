'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { deleteErpItemsAction } from '@/app/admin/erp-item-actions';
import { ConsoleBulkActionBar } from '@/components/admin/console/ConsoleBulkActionBar';
import { ConsoleGrid, type ConsoleGridColumn, type ConsoleGridRow } from '@/components/admin/console/ConsoleGrid';

function deleteConfirmation(count: number) {
  return `선택한 ERP 품목 ${count.toLocaleString('ko-KR')}건을 지울까요? 지운 품목은 옵션 ERP 품명 제안에 나오지 않습니다. 이미 상품 옵션에 넣은 ERP 코드·품명은 바뀌지 않습니다. 같은 품목을 다시 반입하면 되살릴 수 있습니다.`;
}

/**
 * 반입된 ERP 품목 목록. 잘못 반입했거나 단종된 품목을 골라 확인 후 지운다.
 * 선택은 지금 페이지의 행만 보낸다 — 다른 페이지에서 고른 품목이 보이지 않는 채로 지워지지 않게 한다.
 */
export function ErpItemListGrid({ columns, rows, emptyLabel }: {
  columns: ConsoleGridColumn[];
  rows: ConsoleGridRow[];
  emptyLabel: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const visible = new Set(rows.map((row) => row.id));
  const ids = selected.filter((id) => visible.has(id));

  const remove = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ids.length || pending) return;
    if (!window.confirm(deleteConfirmation(ids.length))) return;
    const codes = [...ids];
    setStatus(null);
    startTransition(async () => {
      const result = await deleteErpItemsAction(codes);
      if (!result.ok) { setStatus({ tone: 'error', text: result.error }); return; }
      setSelected([]);
      setStatus({ tone: 'ok', text: result.message });
      router.refresh();
    });
  };

  return <form className="admin-erp-items__list" onSubmit={remove}>
    <ConsoleGrid
      caption="반입된 ERP 품목"
      columns={columns}
      rows={rows}
      emptyLabel={emptyLabel}
      selectable={rows.length > 0}
      selectedIds={ids}
      onSelectionChange={setSelected}
    >
      <ConsoleBulkActionBar
        label="선택한 ERP 품목"
        selectedCount={ids.length}
        actions={[{ label: pending ? '지우는 중' : '선택 삭제', name: 'delete', variant: 'danger', disabled: pending }]}
      />
    </ConsoleGrid>
    <p aria-live="polite" className={status?.tone === 'error' ? 'wc-admin-kit__error' : 'wc-admin-kit__hint'}>{status?.text ?? ''}</p>
  </form>;
}
