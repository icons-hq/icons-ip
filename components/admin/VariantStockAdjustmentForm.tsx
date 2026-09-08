'use client';

import { useActionState, useState } from 'react';
import { adjustAdminStockAction, type AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { AdminField, AdminFormGrid, AdminSectionCard } from './console/AdminKit';
import { InlineNotice } from './fields';

function AdjustmentFields({ adjustmentId, ipId, variant }: { adjustmentId: string; ipId: string; variant: AdminGoodsVariant }) {
  const [state, action, pending] = useActionState(adjustAdminStockAction, {} as AdminCatalogActionState);
  const [delta, setDelta] = useState(''); const [reason, setReason] = useState('');
  const [completed, setCompleted] = useState<string>();
  const saved = state.stockAdjustment;
  if (saved && saved.adjustmentId !== completed) { setCompleted(saved.adjustmentId); setDelta(''); setReason(''); }
  const prefix = `stock-${variant.id}`;
  return <form action={action}>
    <input name="adjustmentId" readOnly type="hidden" value={saved?.adjustmentId ?? adjustmentId} />
    <input name="goodId" readOnly type="hidden" value={variant.goodId} />
    <input name="ipId" readOnly type="hidden" value={ipId} />
    <input name="variantId" readOnly type="hidden" value={variant.id} />
    <input name="expectedStockQty" readOnly type="hidden" value={saved?.stockQty ?? variant.stockQty} />
    <p>선택 옵션 재고 · {(saved?.stockQty ?? variant.stockQty).toLocaleString('ko-KR')}개</p>
    <AdminFormGrid>
      <AdminField inputId={`${prefix}-delta`} label="조정 수량 (+입고 / -보정)" error={state.errors?.delta}>
        <input id={`${prefix}-delta`} name="delta" type="number" step={1} required value={delta} disabled={pending}
          aria-describedby={state.errors?.delta ? `${prefix}-delta-error` : undefined} onChange={(event) => setDelta(event.target.value)} />
      </AdminField>
      <AdminField inputId={`${prefix}-reason`} label="조정 사유" error={state.errors?.reason}>
        <textarea id={`${prefix}-reason`} name="reason" maxLength={200} required value={reason} disabled={pending}
          aria-describedby={state.errors?.reason ? `${prefix}-reason-error` : undefined} onChange={(event) => setReason(event.target.value)} />
      </AdminField>
    </AdminFormGrid>
    <InlineNotice state={state} />
    <button className="btn btn-holo" disabled={pending} type="submit">{pending ? '조정 중' : '옵션 재고 조정'}</button>
  </form>;
}

export function VariantStockAdjustmentForm({ adjustmentId, good, variants }: {
  adjustmentId: string; good: { id: string; ipId: string; stockQty: number }; variants: AdminGoodsVariant[];
}) {
  const active = variants.filter((variant) => variant.goodId === good.id && !variant.archivedAt);
  const [selectedId, setSelectedId] = useState(active.find((variant) => variant.isDefault)?.id ?? active[0]?.id);
  const selected = active.find((variant) => variant.id === selectedId) ?? active[0];
  return <AdminSectionCard title="실재고 조정">
    <p>ICONS 할당 재고를 옵션별로 조정합니다. 상품 합계 {good.stockQty.toLocaleString('ko-KR')}개는 옵션 재고에서 계산합니다.</p>
    {!selected ? <p>조정할 수 있는 옵션이 없습니다.</p> : <>
      {active.length > 1 ? <AdminField inputId={`stock-option-${good.id}`} label="재고를 조정할 옵션">
        <select id={`stock-option-${good.id}`} value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
          {active.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {variant.code} · {variant.stockQty}개</option>)}
        </select>
      </AdminField> : <p>{selected.name} · {selected.code}</p>}
      <AdjustmentFields adjustmentId={adjustmentId} ipId={good.ipId} variant={selected} key={`${selected.id}:${selected.stockQty}`} />
    </>}
  </AdminSectionCard>;
}
