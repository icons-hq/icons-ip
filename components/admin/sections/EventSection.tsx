'use client';

import { AdminFormGrid } from '@/components/admin/console/AdminKit';
import { useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminEventRecord } from '@/lib/admin/catalog.server';
import { adminFormRemountKey, resolveArtworkDefault, resolveFieldDefault } from '@/lib/admin/form-state';
import { publicMediaUrl } from '@/lib/media';
import { statusTone } from '@/lib/admin/status-tone';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  formatAdminCatalogRecordLabel,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { ColorField, Field, FormShell, SelectField } from '../fields';
import { FormGroup, MasterDetail, RecordDetailPane, RecordFormHeading, SECTION_CARD } from './SectionLayout';
import { RecordMasterList } from './RecordMasterList';
import { RecordStatusLabel } from './RecordStatusLabel';

function dateTimeInput(value: string | null | undefined) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function EventSection({
  action,
  creating = false,
  ipOptions,
  onClose,
  onSelect,
  pending,
  records,
  selected,
  state,
}: {
  action: (payload: FormData) => void;
  /** 새 이벤트 입력 칸을 연 상태. 고른 이벤트도 없고 이 값도 꺼져 있으면 오른쪽은 안내만 보인다. */
  creating?: boolean;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  onClose?: () => void;
  onSelect: (event: AdminEventRecord | null) => void;
  pending: boolean;
  records: AdminEventRecord[];
  selected: AdminEventRecord | null;
  state: AdminCatalogActionState;
}) {
  const defaults = selected ? {
    ...selected,
    startsAt: dateTimeInput(selected.startsAt),
    endsAt: dateTimeInput(selected.endsAt),
  } : null;
  const field = (name: string) => resolveFieldDefault(state, defaults, name);
  const artwork = resolveArtworkDefault(state, selected, publicMediaUrl);
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const visibleRecords = filterAdminCatalogRecords(records, archiveFilter);

  return (
    <MasterDetail
      list={(
        <RecordMasterList
          activeId={selected?.id ?? null}
          ariaLabel="이벤트 목록"
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
          items={visibleRecords}
          labelFor={(event) => <RecordStatusLabel name={`${event.id} · ${event.title}`} status={event.archivedAt ? '보관' : event.status} tone={event.archivedAt ? statusTone('publication', 'archived') : statusTone('event', event.status)} title={formatAdminCatalogRecordLabel(`${event.id} · ${event.title}`, event.archivedAt)} />}
          onSelect={onSelect}
          searchTextFor={(event) => `${event.id} ${event.title}`}
          thumbnailKind="event"
          thumbnailUrlFor={(event) => event.imageUrl}
        />
      )}
    >
      <RecordDetailPane hint="새 이벤트는 오른쪽 위 이벤트 등록 버튼으로 만듭니다." open={Boolean(selected) || creating} prompt="목록에서 이벤트를 고르면 여기에서 수정합니다.">
      <form action={action} className={SECTION_CARD} key={adminFormRemountKey(state, selected)}>
        <input name="previousId" type="hidden" value={selected?.id ?? ''} />
        <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
        <RecordFormHeading editing={selected?.title ?? null} noun="이벤트" onClose={onClose} />
        <FormGroup title="기본 정보">
          <AdminFormGrid>
            <Field defaultValue={field('id')} error={state.errors?.id} label="이벤트 코드 · ID" name="id" placeholder="e100" readOnly={Boolean(selected)} />
            <SelectField defaultValue={field('ipId')} error={state.errors?.ipId} label="연결 IP" name="ipId">
              <option value="">플랫폼/합동 이벤트</option>
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
            <Field defaultValue={field('title')} error={state.errors?.title} label="이벤트 이름" name="title" />
            <SelectField defaultValue={field('mode') || '오프라인'} error={state.errors?.mode} label="진행 방식" name="mode">
              <option value="오프라인">오프라인</option>
              <option value="온라인">온라인</option>
            </SelectField>
          </AdminFormGrid>
        </FormGroup>
        <FormGroup title="일정·장소">
          <AdminFormGrid>
            <SelectField defaultValue={field('status') || '예정'} error={state.errors?.status} label="상태" name="status">
              <option value="예정">예정</option>
              <option value="예매중">예매중</option>
              <option value="진행중">진행중</option>
              <option value="종료">종료</option>
            </SelectField>
            <Field defaultValue={field('location')} label="장소" name="location" />
            <Field defaultValue={field('startsAt')} label="시작" name="startsAt" type="datetime-local" />
            <Field defaultValue={field('endsAt')} label="종료" name="endsAt" type="datetime-local" />
          </AdminFormGrid>
        </FormGroup>
        {/* 배경 CSS 자유입력을 운영자 폼에서 뺐다 (#183). 아트워크가 없는 레거시
            레코드는 이 값으로 렌더되므로 그대로 실어 보내 보존한다. */}
        <input name="bg" type="hidden" value={field('bg')} />
        <FormGroup hint="고객 화면의 이벤트 상세에 쓰입니다." title="공개 화면 표시">
          <ColorField defaultValue={field('accent')} fallback="#8B5CFF" label="강조 색상" name="accent" />
          <ArtworkUploadField
            autoUpload
            currentPath={artwork.currentPath}
            currentUrl={artwork.currentUrl}
            helpText="이미지는 잘리지 않게 전체가 표시되며, 비율에 따라 여백이 생길 수 있습니다."
            kind="event"
            label="이미지 파일"
          />
        </FormGroup>
        <FormShell pending={pending} state={state} />
      </form>
      {selected && (
        <CatalogArchiveControl
          archivedAt={selected.archivedAt}
          id={selected.id}
          key={`${selected.id}:${selected.archivedAt ?? 'active'}`}
          kind="event"
        />
      )}
      </RecordDetailPane>
    </MasterDetail>
  );
}
