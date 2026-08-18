'use client';

import { useActionState, useState } from 'react';
import {
  bulkConfirmAdminOrdersAction,
  type AdminOrderActionState,
} from '@/app/admin/order-actions';
import {
  ConsoleBulkActionBar,
  ConsoleGrid,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';

const EMPTY_ACTION_STATE: AdminOrderActionState = {};

const BULK_CONFIRM_CONFIRMATION = '선택한 주문을 발주확인 처리할까요? 발송 대기 단계로 넘어갑니다.';

/**
 * 발주·발송 그리드의 선택 상태만 쥔 얇은 클라이언트 래퍼.
 *
 * `ConsoleGrid`의 JSDoc이 권하는 구조 그대로다 — 셀은 서버에서 만들어 넘기고, 여기서는
 * 선택 배열만 잡아 일괄 액션 바의 건수를 채운다. 선택 목록 자체는 그리드가 hidden
 * input(`selectionName`)으로 내보내므로 폼 제출 배선은 따로 하지 않는다.
 */
export function DispatchOrderGrid({
  caption,
  columns,
  emptyLabel,
  rows,
}: {
  caption: string;
  columns: ConsoleGridColumn[];
  emptyLabel: string;
  rows: ConsoleGridRow[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [state, action, pending] = useActionState(bulkConfirmAdminOrdersAction, EMPTY_ACTION_STATE);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        /* 되돌릴 수 없는 일괄 전이다. 이 저장소의 확인 관용구를 그대로 따른다. */
        if (!window.confirm(BULK_CONFIRM_CONFIRMATION)) event.preventDefault();
      }}
    >
      <ConsoleGrid
        caption={caption}
        columns={columns}
        emptyLabel={emptyLabel}
        onSelectionChange={setSelected}
        rows={rows}
        selectable
        selectedIds={selected}
        selectionName="orderIds"
      >
        <ConsoleBulkActionBar
          actions={[{
            label: pending ? '처리 중' : '발주확인',
            name: 'bulkConfirm',
            confirmLabel: BULK_CONFIRM_CONFIRMATION,
            disabled: pending,
          }]}
          label="선택한 주문"
          selectedCount={selected.length}
        />
      </ConsoleGrid>
      <div aria-live="polite" className="admin-order-action-feedback">
        {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
        {state.message ? <span role="status">{state.message}</span> : null}
      </div>
    </form>
  );
}
