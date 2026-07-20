'use client';

import { useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminCardRecord } from '@/lib/admin/catalog.server';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  formatAdminCatalogRecordLabel,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import { RARITY_META } from '@/lib/rarity';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { Field, FormShell, RecordList, SelectField } from '../fields';

export function CardSection({
  action,
  ipOptions,
  onSelect,
  pending,
  poolOptions,
  records,
  selected,
  state,
}: {
  action: (payload: FormData) => void;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  onSelect: (card: AdminCardRecord | null) => void;
  pending: boolean;
  poolOptions: { id: string; ipId: string; name: string }[];
  records: AdminCardRecord[];
  selected: AdminCardRecord | null;
  state: AdminCatalogActionState;
}) {
  const selectedId = selected?.id ?? null;
  const [ipSelection, setIpSelection] = useState({
    recordId: selectedId,
    value: selected?.ipId ?? '',
  });
  const ipId = ipSelection.recordId === selectedId
    ? ipSelection.value
    : (selected?.ipId ?? '');
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const pooled = Boolean(selected?.poolId);
  const matchingPools = poolOptions.filter((pool) => pool.ipId === ipId);
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
          labelFor={(card) => formatAdminCatalogRecordLabel(`${card.id} · ${card.name}`, card.archivedAt)}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
        />
      </div>
      <div className="col" style={{ gap: 16, minWidth: 0 }}>
        <form action={action} className="card col" key={selected ? JSON.stringify(selected) : 'new-card'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
        <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
        <div className="admin-form-grid">
          <Field defaultValue={selected?.id} error={state.errors?.id} label="ID" name="id" placeholder="c100" />
          {pooled && selected ? (
            <ReadOnlyCatalogField label="연결 IP" name="ipId" value={selected.ipId}>
              {ipOptions.find((ip) => ip.id === selected.ipId)?.title ?? selected.ipId}
            </ReadOnlyCatalogField>
          ) : (
            <SelectField
              error={state.errors?.ipId}
              label="연결 IP"
              name="ipId"
              onChange={(event) => setIpSelection({ recordId: selectedId, value: event.target.value })}
              value={ipId}
            >
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
          )}
          <Field defaultValue={selected?.name} error={state.errors?.name} label="카드 이름" name="name" />
          <Field defaultValue={selected?.no} label="번호" name="no" placeholder="001/120" />
          {pooled && selected ? (
            <ReadOnlyCatalogField label="등급" name="rarity" value={selected.rarity}>
              {selected.rarity}
            </ReadOnlyCatalogField>
          ) : (
            <SelectField defaultValue={selected?.rarity ?? 'N'} error={state.errors?.rarity} label="등급" name="rarity">
              {Object.keys(RARITY_META).map((rarity) => (
                <option key={rarity} value={rarity}>{rarity}</option>
              ))}
            </SelectField>
          )}
          <SelectField defaultValue={selected?.poolId} error={state.errors?.poolId} label="카드풀" name="poolId">
            <option value="">풀 미지정</option>
            {matchingPools.map((pool) => (
              <option key={pool.id} value={pool.id}>{pool.name}</option>
            ))}
          </SelectField>
        </div>
        {pooled && (
          <p style={{ color: 'var(--dim)', fontSize: 12, margin: 0 }}>
            풀에 연결된 카드는 먼저 풀을 해제한 뒤 IP·등급을 변경할 수 있습니다.
          </p>
        )}
        <Field defaultValue={selected?.bg} label="배경 CSS" name="bg" />
        <ArtworkUploadField
          currentPath={selected?.imagePath ?? null}
          currentUrl={selected?.imageUrl ?? null}
          kind="card"
        />
        <FormShell pending={pending} state={state} />
        </form>
        {selected && (
          <CatalogArchiveControl
            archivedAt={selected.archivedAt}
            id={selected.id}
            key={`${selected.id}:${selected.archivedAt ?? 'active'}`}
            kind="card"
          />
        )}
      </div>
    </div>
  );
}

function ReadOnlyCatalogField({
  children,
  label,
  name,
  value,
}: {
  children: React.ReactNode;
  label: string;
  name: string;
  value: string;
}) {
  const labelId = `${name}-readonly-label`;
  return (
    <div className="col" style={{ gap: 7 }}>
      <span className="mono" id={labelId} style={{ color: 'var(--dim)', fontSize: 11 }}>{label}</span>
      <input name={name} type="hidden" value={value} />
      <div
        aria-labelledby={labelId}
        aria-readonly="true"
        className="admin-field-control"
        role="textbox"
        style={{ alignItems: 'center', display: 'flex', minHeight: 42, padding: '0 12px' }}
      >
        {children}
      </div>
    </div>
  );
}
