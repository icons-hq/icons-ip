'use client';

import { useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminIpRecord } from '@/lib/admin/catalog.server';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  formatAdminCatalogRecordLabel,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import type { CatalogSnapshot } from '@/lib/catalog';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { Field, FormShell, RecordList, SelectField, TextArea } from '../fields';

export function IpSection({
  action,
  onSelect,
  pending,
  records,
  selected,
  state,
  verticals,
}: {
  action: (payload: FormData) => void;
  onSelect: (ip: AdminIpRecord | null) => void;
  pending: boolean;
  records: AdminIpRecord[];
  selected: AdminIpRecord | null;
  state: AdminCatalogActionState;
  verticals: CatalogSnapshot['verticals'];
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
          labelFor={(ip) => formatAdminCatalogRecordLabel(`${ip.id} · ${ip.title}`, ip.archivedAt)}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
        />
      </div>
      <div className="col" style={{ gap: 16, minWidth: 0 }}>
        <form action={action} className="card col" key={selected ? JSON.stringify(selected) : 'new-ip'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
          <div className="admin-form-grid">
            <Field defaultValue={selected?.id} error={state.errors?.id} label="ID" name="id" placeholder="rilakkuma" />
            <Field defaultValue={selected?.title} error={state.errors?.title} label="IP 이름" name="title" placeholder="리락쿠마" />
            <Field defaultValue={selected?.sub} label="보조 설명" name="sub" placeholder="San-X · 캐릭터 IP" />
            <SelectField defaultValue={selected?.verticalKey} error={state.errors?.verticalKey} label="버티컬" name="verticalKey">
              <option value="">선택</option>
              {verticals.map((vertical) => (
                <option key={vertical.key} value={vertical.key}>{vertical.label}</option>
              ))}
            </SelectField>
            <Field defaultValue={selected?.tagline} label="태그라인" name="tagline" />
            <Field defaultValue={selected?.glyph} label="글리프" name="glyph" />
            <input name="featured" type="hidden" value={selected?.featured ? 'on' : ''} />
          </div>
          <TextArea defaultValue={selected?.synopsis} label="시놉시스" name="synopsis" />
          <Field defaultValue={selected?.bg} label="배경 CSS" name="bg" />
          <ArtworkUploadField
            currentPath={selected?.imagePath ?? null}
            currentUrl={selected?.imageUrl ?? null}
            helpText="IP 키아트는 가로형 이미지를 사용해주세요."
            kind="ip"
          />
          <FormShell pending={pending} state={state} />
        </form>
        {selected && (
          <CatalogArchiveControl
            archivedAt={selected.archivedAt}
            id={selected.id}
            key={`${selected.id}:${selected.archivedAt ?? 'active'}`}
            kind="ip"
          />
        )}
      </div>
    </div>
  );
}
