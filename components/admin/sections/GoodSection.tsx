'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  adjustAdminStockAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  formatAdminCatalogRecordLabel,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import { Icon } from '@/components/ui/Icon';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { Field, FormShell, InlineNotice, RecordList, SelectField, TextArea } from '../fields';

const emptyStockState: AdminCatalogActionState = {};

function StockAdjustmentForm({
  adjustmentId,
  good,
}: {
  adjustmentId: string;
  good: AdminGoodRecord;
}) {
  const [state, action, pending] = useActionState(adjustAdminStockAction, emptyStockState);
  const formRef = useRef<HTMLFormElement>(null);
  const effectiveStock = good.stockQty <= 0 ? 'soldout' : good.stock;

  useEffect(() => {
    if (state.message) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <section aria-labelledby={`stock-adjustment-${good.id}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <span className="eyebrow">INVENTORY</span>
          <h2 id={`stock-adjustment-${good.id}`} style={{ fontSize: 18, margin: '6px 0 0' }}>실재고 조정</h2>
        </div>
        <strong className="mono" style={{ color: 'var(--cyan)', fontSize: 22 }}>{good.stockQty.toLocaleString('ko-KR')}개</strong>
      </div>
      <div
        className="admin-stock-summary"
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        }}
      >
        <span className="card mono" style={{ borderRadius: 8, color: 'var(--dim)', padding: 10 }}>현재 실재고 {good.stockQty.toLocaleString('ko-KR')}개</span>
        <span className="card mono" style={{ borderRadius: 8, color: 'var(--dim)', padding: 10 }}>운영 상태 {good.stock}</span>
        <span className="card mono" style={{ borderRadius: 8, color: 'var(--dim)', padding: 10 }}>유효 표시 상태 {effectiveStock}</span>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        수량이 0이면 공개 화면은 자동 품절로 표시됩니다. 운영 상태 soldout은 수량과 무관한 판매 중지로 유지됩니다.
      </p>
      <form action={action} className="col" ref={formRef} style={{ gap: 12 }}>
        <input name="adjustmentId" readOnly type="hidden" value={adjustmentId} />
        <input name="goodId" readOnly type="hidden" value={good.id} />
        <input name="ipId" readOnly type="hidden" value={good.ipId} />
        <input name="expectedStockQty" readOnly type="hidden" value={good.stockQty} />
        <div className="admin-form-grid">
          <Field
            error={state.errors?.delta}
            label="조정 수량 (+입고 / -보정)"
            name="delta"
            placeholder="10 또는 -3"
            required
            step={1}
            type="number"
          />
          <TextArea
            error={state.errors?.reason}
            label="조정 사유"
            maxLength={200}
            name="reason"
            placeholder="입고, 파손, 재고 조사 등"
            required
          />
        </div>
        <InlineNotice state={state} />
        <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="plus" size={15} /> {pending ? '조정 중' : '재고 조정'}
        </button>
      </form>
    </section>
  );
}

export function GoodSection({
  action,
  adjustmentId,
  ipOptions,
  onSelect,
  pending,
  records,
  selected,
  state,
}: {
  action: (payload: FormData) => void;
  adjustmentId: string;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  onSelect: (good: AdminGoodRecord | null) => void;
  pending: boolean;
  records: AdminGoodRecord[];
  selected: AdminGoodRecord | null;
  state: AdminCatalogActionState;
}) {
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const visibleRecords = filterAdminCatalogRecords(records, archiveFilter);

  return (
    <div className="admin-master-detail">
      <div className="col" style={{ gap: 12, minWidth: 0 }}>
        <CatalogArchiveFilter
          counts={adminCatalogArchiveCounts(records)}
          filter={archiveFilter}
          onChange={(filter) => {
            setArchiveFilter(filter);
            if (selected && !filterAdminCatalogRecords([selected], filter).length) onSelect(null);
          }}
        />
        <RecordList
          activeId={selected?.id ?? null}
          items={visibleRecords}
          labelFor={(good) => formatAdminCatalogRecordLabel(
            `${good.id} · ${good.name} · ${good.stockQty}개`,
            good.archivedAt,
          )}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
        />
      </div>
      <div className="col" style={{ gap: 16, minWidth: 0 }}>
        <form action={action} className="card col" key={selected ? JSON.stringify(selected) : 'new-good'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
          <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
          <div className="admin-form-grid">
            <Field defaultValue={selected?.id} error={state.errors?.id} label="ID" name="id" placeholder="g100" />
            <SelectField defaultValue={selected?.ipId} error={state.errors?.ipId} label="연결 IP" name="ipId">
              <option value="">선택</option>
              {ipOptions.map((ip) => (
                <option
                  disabled={Boolean(ip.archivedAt && ip.id !== selected?.ipId)}
                  key={ip.id}
                  value={ip.id}
                >
                  {ip.archivedAt ? `[보관] ${ip.title}` : ip.title}
                </option>
              ))}
            </SelectField>
            <Field defaultValue={selected?.name} error={state.errors?.name} label="굿즈 이름" name="name" />
            <Field defaultValue={selected?.type} error={state.errors?.type} label="유형" name="type" />
            <Field defaultValue={selected?.price ?? 0} error={state.errors?.price} label="가격" name="price" type="number" />
            <Field defaultValue={selected?.badge} label="배지" name="badge" />
            <SelectField defaultValue={selected?.stock ?? 'ok'} error={state.errors?.stock} label="운영 상태" name="stock">
              <option value="ok">ok</option>
              <option value="low">low</option>
              <option value="soldout">soldout</option>
            </SelectField>
          </div>
          <Field defaultValue={selected?.bg} label="배경 CSS" name="bg" />
          <ArtworkUploadField
            currentPath={selected?.imagePath ?? null}
            currentUrl={selected?.imageUrl ?? null}
            kind="good"
          />
          <FormShell pending={pending} state={state} />
        </form>
        {selected && !selected.archivedAt && (
          <StockAdjustmentForm adjustmentId={adjustmentId} good={selected} key={`stock-${selected.id}`} />
        )}
        {selected && (
          <CatalogArchiveControl
            archivedAt={selected.archivedAt}
            id={selected.id}
            key={`${selected.id}:${selected.archivedAt ?? 'active'}`}
            kind="good"
          />
        )}
      </div>
    </div>
  );
}
