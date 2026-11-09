'use client';

import { AdminFormGrid, AdminNotice } from '@/components/admin/console/AdminKit';
import { useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminCardRecord } from '@/lib/admin/catalog.server';
import { adminFormRemountKey, resolveArtworkDefault, resolveFieldDefault } from '@/lib/admin/form-state';
import { publicMediaUrl } from '@/lib/media';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  formatAdminCatalogRecordLabel,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import { RARITY_META } from '@/lib/rarity';
import { statusTone } from '@/lib/admin/status-tone';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { Field, FormShell, RecordList, SelectField } from '../fields';
import { MasterDetail, ReadOnlyField, RecordFormHeading, SECTION_CARD } from './SectionLayout';
import { RecordStatusLabel } from './RecordStatusLabel';

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
  const formKey = adminFormRemountKey(state, selected);
  const field = (name: string) => resolveFieldDefault(state, selected, name);
  const artwork = resolveArtworkDefault(state, selected, publicMediaUrl);
  const [ipSelection, setIpSelection] = useState({
    formKey,
    value: field('ipId'),
  });
  const ipId = ipSelection.formKey === formKey
    ? ipSelection.value
    : field('ipId');
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const pooled = Boolean(selected?.poolId);
  const matchingPools = poolOptions.filter((pool) => pool.ipId === ipId);
  /* c1, c2, … c10 처럼 번호 순서로 보인다(서버 정렬은 c1, c10, c2…). */
  const visibleRecords = [...filterAdminCatalogRecords(records, archiveFilter)].sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true }));
  const poolName = (id: string | null) => poolOptions.find((pool) => pool.id === id)?.name ?? '풀 미지정';

  return (
    <MasterDetail
      list={(
        <>
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
            ariaLabel="카드 목록"
            items={visibleRecords}
            labelFor={(card) => <RecordStatusLabel detail={`${card.rarity} · ${poolName(card.poolId)}`} name={`${card.id} · ${card.name}`} status={card.archivedAt ? '보관' : card.poolId ? null : '풀 미지정'} tone={card.archivedAt ? statusTone('publication', 'archived') : 'warning'} title={formatAdminCatalogRecordLabel(`${card.id} · ${card.name}`, card.archivedAt)} />}
            onNew={() => onSelect(null)}
            onSelect={onSelect}
            thumbnailKind="card"
            thumbnailUrlFor={(card) => card.imageUrl}
          />
        </>
      )}
    >
      <form action={action} className={SECTION_CARD} key={formKey}>
        <input name="previousId" type="hidden" value={selected?.id ?? ''} />
        <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
        <RecordFormHeading editing={selected?.name ?? null} noun="카드" />
        <AdminFormGrid>
          <Field defaultValue={field('id')} error={state.errors?.id} label="ID" name="id" placeholder="c100" readOnly={Boolean(selected)} />
          {pooled && selected ? (
            <ReadOnlyField label="연결 IP" labelId="ipId-readonly-label" name="ipId" value={selected.ipId}>
              {ipOptions.find((ip) => ip.id === selected.ipId)?.title ?? selected.ipId}
            </ReadOnlyField>
          ) : (
            <SelectField
              error={state.errors?.ipId}
              label="연결 IP"
              name="ipId"
              onChange={(event) => setIpSelection({ formKey, value: event.target.value })}
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
          <Field defaultValue={field('name')} error={state.errors?.name} label="카드 이름" name="name" />
          <Field defaultValue={field('no')} label="번호" name="no" placeholder="001/120" />
          {pooled && selected ? (
            <ReadOnlyField label="등급" labelId="rarity-readonly-label" name="rarity" value={selected.rarity}>
              {selected.rarity}
            </ReadOnlyField>
          ) : (
            <SelectField defaultValue={field('rarity') || 'N'} error={state.errors?.rarity} label="등급" name="rarity">
              {Object.keys(RARITY_META).map((rarity) => (
                <option key={rarity} value={rarity}>{rarity}</option>
              ))}
            </SelectField>
          )}
          <SelectField defaultValue={field('poolId')} error={state.errors?.poolId} label="카드풀" name="poolId">
            <option value="">풀 미지정</option>
            {matchingPools.map((pool) => (
              <option key={pool.id} value={pool.id}>{pool.name}</option>
            ))}
          </SelectField>
        </AdminFormGrid>
        {pooled && <AdminNotice tone="info">풀에 연결된 카드는 먼저 풀을 해제한 뒤 IP·등급을 변경할 수 있습니다.</AdminNotice>}
        {/* 배경 CSS 자유입력을 운영자 폼에서 뺐다 (#183). 아트워크가 없는 레거시
            레코드는 이 값으로 렌더되므로 그대로 실어 보내 보존한다. */}
        <input name="bg" type="hidden" value={field('bg')} />
        <ArtworkUploadField
          currentPath={artwork.currentPath}
          currentUrl={artwork.currentUrl}
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
    </MasterDetail>
  );
}
