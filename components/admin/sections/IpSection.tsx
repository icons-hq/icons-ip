'use client';

import { useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminIpRecord } from '@/lib/admin/catalog.server';
import { resolveArtworkDefault, resolveFieldDefault } from '@/lib/admin/form-state';
import { publicMediaUrl } from '@/lib/media';
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

  /*
   * 모든 입력은 비제어 defaultValue 다. 저장이 실패하면 액션이 제출값을 `state.values` 로
   * 되돌려주고, 폼 key 에 섞인 `state.attempt` 가 바뀌어 리마운트되면서 그 값이 다시
   * 심긴다 — 타이핑한 값도, 업로드해 둔 아트워크 경로도 사라지지 않는다.
   */
  const field = (key: string) => resolveFieldDefault(state, selected, key);
  const artwork = resolveArtworkDefault(state, selected, publicMediaUrl);
  const formKey = `${selected ? JSON.stringify(selected) : 'new-ip'}:${state.attempt ?? 0}`;

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
        <form action={action} className="card col" key={formKey} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
          <input name="previousId" type="hidden" value={selected?.id ?? ''} />
          <div className="admin-form-grid">
            <Field defaultValue={field('id')} error={state.errors?.id} label="ID" name="id" placeholder="rilakkuma" readOnly={Boolean(selected)} />
            <Field defaultValue={field('title')} error={state.errors?.title} label="IP 이름" name="title" placeholder="리락쿠마" />
            <Field defaultValue={field('sub')} label="보조 설명" name="sub" placeholder="San-X · 캐릭터 IP" />
            <SelectField defaultValue={field('verticalKey')} error={state.errors?.verticalKey} label="버티컬" name="verticalKey">
              <option value="">선택</option>
              {verticals.map((vertical) => (
                <option key={vertical.key} value={vertical.key}>{vertical.label}</option>
              ))}
            </SelectField>
            <Field defaultValue={field('tagline')} label="태그라인" name="tagline" />
            <TextArea
              defaultValue={field('glyph')}
              label="글리프 (줄바꿈 가능)"
              name="glyph"
              placeholder={'홍실\n퀘스트'}
            />
            <input name="featured" type="hidden" value={field('featured')} />
          </div>
          <TextArea defaultValue={field('synopsis')} label="시놉시스" name="synopsis" />
          {/* 배경 CSS 자유입력을 운영자 폼에서 뺐다 (#183). 아트워크가 없는 레거시
              레코드는 이 값으로 렌더되므로 그대로 실어 보내 보존한다. */}
          <input name="bg" type="hidden" value={field('bg')} />
          <ArtworkUploadField
            currentPath={artwork.currentPath}
            currentUrl={artwork.currentUrl}
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
