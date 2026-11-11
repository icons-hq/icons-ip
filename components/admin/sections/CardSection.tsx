'use client';

import { AdminFormGrid, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
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
import { Field, FormShell, SelectField } from '../fields';
import { FormGroup, MasterDetail, ReadOnlyField, RecordDetailPane, RecordFormHeading, SECTION_CARD } from './SectionLayout';
import { RecordMasterList } from './RecordMasterList';
import { RecordStatusLabel } from './RecordStatusLabel';

export function CardSection({
  action,
  creating = false,
  ipOptions,
  onClose,
  onSelect,
  pending,
  poolOptions,
  records,
  selected,
  state,
}: {
  action: (payload: FormData) => void;
  /** 새 카드 입력 칸을 연 상태. 고른 카드도 없고 이 값도 꺼져 있으면 오른쪽은 안내만 보인다. */
  creating?: boolean;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  onClose?: () => void;
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
  const [unboundOnly, setUnboundOnly] = useState(false);
  const inArchiveFilter = filterAdminCatalogRecords(records, archiveFilter);
  const isUnbound = (card: AdminCardRecord) => !card.archivedAt && !card.poolId;
  const unboundCount = inArchiveFilter.filter(isUnbound).length;
  /* 풀을 다 지정해 칩이 사라지면 조건도 풀어 빈 목록에 갇히지 않게 한다. */
  const showUnboundOnly = unboundOnly && unboundCount > 0;
  /* c1, c2, … c10 처럼 번호 순서로 보인다(서버 정렬은 c1, c10, c2…). */
  const visibleRecords = (showUnboundOnly ? inArchiveFilter.filter(isUnbound) : [...inArchiveFilter]).sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true }));
  const poolName = (id: string | null) => poolOptions.find((pool) => pool.id === id)?.name ?? '풀 미지정';

  return (
    <MasterDetail
      list={(
        <RecordMasterList
          activeId={selected?.id ?? null}
          ariaLabel="카드 목록"
          filters={(
            <CatalogArchiveFilter
              compact
              counts={adminCatalogArchiveCounts(records)}
              filter={archiveFilter}
              onChange={(filter) => {
                setArchiveFilter(filter);
                if (selected && !filterAdminCatalogRecords([selected], filter).length) onSelect(null);
              }}
            />
          )}
          headerAction={unboundCount ? (
            /* 처리할 건수. 누르면 그 카드만 본다(어느 줄인지는 줄의 같은 배지가 말한다). */
            <button aria-pressed={showUnboundOnly} className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:ring-1 aria-pressed:ring-warning" onClick={() => setUnboundOnly(!showUnboundOnly)} title="누르면 카드풀을 지정하지 않은 카드만 봅니다." type="button">
              <AdminStatusBadge tone="warning">풀 미지정 {unboundCount}장</AdminStatusBadge>
            </button>
          ) : undefined}
          items={visibleRecords}
          /* 위 건수와 같은 말·같은 색의 배지를 줄에도 달아 어느 카드인지 훑어 찾는다. 카드풀이 지정된 카드는 표시 없이 조용하다. */
          labelFor={(card) => <RecordStatusLabel detail={isUnbound(card) ? card.rarity : `${card.rarity} · ${poolName(card.poolId)}`} name={`${card.id} · ${card.name}`} singleLine status={card.archivedAt ? '보관' : isUnbound(card) ? '풀 미지정' : null} tone={card.archivedAt ? statusTone('publication', 'archived') : 'warning'} title={formatAdminCatalogRecordLabel(`${card.id} · ${card.name}`, card.archivedAt)} />}
          onSelect={onSelect}
          searchTextFor={(card) => `${card.id} ${card.name}`}
          thumbnailKind="card"
          thumbnailUrlFor={(card) => card.imageUrl}
        />
      )}
    >
      <RecordDetailPane hint="새 카드는 오른쪽 위 카드 등록 버튼으로 만듭니다." open={Boolean(selected) || creating} prompt="목록에서 카드를 고르면 여기에서 수정합니다.">
      <form action={action} className={SECTION_CARD} key={formKey}>
        <input name="previousId" type="hidden" value={selected?.id ?? ''} />
        <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
        <RecordFormHeading editing={selected?.name ?? null} noun="카드" onClose={onClose} />
        <FormGroup title="기본 정보">
        <AdminFormGrid>
          <Field defaultValue={field('id')} error={state.errors?.id} label="카드 코드 · ID" name="id" placeholder="c100" readOnly={Boolean(selected)} />
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
        </FormGroup>
        {/* 배경 CSS 자유입력을 운영자 폼에서 뺐다 (#183). 아트워크가 없는 레거시
            레코드는 이 값으로 렌더되므로 그대로 실어 보내 보존한다. */}
        <input name="bg" type="hidden" value={field('bg')} />
        <FormGroup title="카드 이미지">
          <ArtworkUploadField
            autoUpload
            currentPath={artwork.currentPath}
            currentUrl={artwork.currentUrl}
            kind="card"
            label="이미지 파일"
            showPath={Boolean(artwork.currentPath)}
          />
        </FormGroup>
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
      </RecordDetailPane>
    </MasterDetail>
  );
}
