'use client';

import { useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminIpRecord } from '@/lib/admin/catalog.server';
import { resolveArtworkDefault, resolveFieldDefault } from '@/lib/admin/form-state';
import { adminIpPublishState, formatAdminIpRecordLabel } from '@/lib/admin/ip-publish';
import { publicMediaUrl } from '@/lib/media';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import type { CatalogSnapshot } from '@/lib/catalog';
import { Icon } from '@/components/ui/Icon';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { IpPublishControl, IpPublishStateBadge } from '../IpPublishControls';
import { ActionNotice, Field, RecordList, SelectField, TextArea } from '../fields';

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

  /*
   * 게시 상태 (20260907130000). 새 IP 와 초안은 "초안으로 저장"·"저장 후 공개" 두 동선을,
   * 공개·보관된 IP 는 상태를 건드리지 않는 "저장" 하나를 갖는다 — 폼 저장이 조용히
   * 비공개로 바꾸는 일이 없게, 초안으로 되돌리기는 옆의 전환 컨트롤에만 둔다.
   */
  const publishState = selected ? adminIpPublishState(selected) : 'draft';
  const offersPublish = publishState === 'draft';

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
          labelFor={(ip) => formatAdminIpRecordLabel(`${ip.id} · ${ip.title}`, ip)}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
          thumbnailKind="ip"
          thumbnailUrlFor={(ip) => ip.imageUrl}
        />
      </div>
      <div className="col" style={{ gap: 16, minWidth: 0 }}>
        <form action={action} className="card col" key={formKey} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>게시 상태</span>
            <IpPublishStateBadge state={publishState} />
            {!selected && (
              <span className="muted" style={{ fontSize: 12 }}>새 IP는 초안으로 시작합니다. 공개 전까지는 어디에도 노출되지 않습니다.</span>
            )}
          </div>
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
          <ActionNotice state={state} />
          <div className="row" style={{ flexWrap: 'wrap', gap: 10, justifyContent: 'flex-start' }}>
            {offersPublish ? (
              <>
                <button className="btn btn-ghost" disabled={pending} name="intent" style={{ minWidth: 150 }} value="draft">
                  <Icon name="check" size={15} /> {pending ? '저장 중' : '초안으로 저장'}
                </button>
                <button className="btn btn-holo" disabled={pending} name="intent" style={{ minWidth: 150 }} value="publish">
                  <Icon name="check" size={15} /> {pending ? '저장 중' : '저장 후 공개'}
                </button>
              </>
            ) : (
              <button className="btn btn-holo" disabled={pending} name="intent" style={{ minWidth: 150 }} value="save">
                <Icon name="check" size={15} /> {pending ? '저장 중' : '저장'}
              </button>
            )}
          </div>
        </form>
        {selected && (
          <IpPublishControl
            id={selected.id}
            key={`${selected.id}:${publishState}`}
            record={selected}
          />
        )}
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
