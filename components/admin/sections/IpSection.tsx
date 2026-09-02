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
  /* 저장이 실패하면 액션이 제출값을 돌려준다 — 그 값이 레코드보다 우선한다. */
  const seed: Record<string, string> = state.values ?? {};

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
          thumbnailKind="ip"
          thumbnailUrlFor={(ip) => ip.imageUrl}
        />
      </div>
      <div className="col" style={{ gap: 16, minWidth: 0 }}>
        <form action={action} className="card col" key={selected ? JSON.stringify(selected) : 'new-ip'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
          <input name="previousId" type="hidden" value={selected?.id ?? ''} />
          <div className="admin-form-grid">
            <Field defaultValue={seed.id ?? selected?.id} error={state.errors?.id} label="ID" name="id" placeholder="rilakkuma" readOnly={Boolean(selected)} />
            <Field defaultValue={seed.title ?? selected?.title} error={state.errors?.title} label="IP 이름" name="title" placeholder="리락쿠마" />
            <Field defaultValue={seed.sub ?? selected?.sub} label="보조 설명" name="sub" placeholder="San-X · 캐릭터 IP" />
            {/* select 는 defaultValue 갱신을 무시하므로 시드값을 key 로 삼아 다시 마운트한다. */}
            <SelectField defaultValue={seed.verticalKey ?? selected?.verticalKey} error={state.errors?.verticalKey} key={`verticalKey:${seed.verticalKey ?? ''}`} label="버티컬" name="verticalKey">
              <option value="">선택</option>
              {verticals.map((vertical) => (
                <option key={vertical.key} value={vertical.key}>{vertical.label}</option>
              ))}
            </SelectField>
            <Field defaultValue={seed.tagline ?? selected?.tagline} label="태그라인" name="tagline" />
            <TextArea
              defaultValue={seed.glyph ?? selected?.glyph}
              label="글리프 (줄바꿈 가능)"
              name="glyph"
              placeholder={'홍실\n퀘스트'}
            />
            <input name="featured" type="hidden" value={selected?.featured ? 'on' : ''} />
          </div>
          <TextArea defaultValue={seed.synopsis ?? selected?.synopsis} label="시놉시스" name="synopsis" />
          {/* 배경 CSS 자유입력을 운영자 폼에서 뺐다 (#183). 아트워크가 없는 레거시
              레코드는 이 값으로 렌더되므로 그대로 실어 보내 보존한다. */}
          <input name="bg" type="hidden" value={selected?.bg ?? ''} />
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
