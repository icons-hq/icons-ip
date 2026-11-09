'use client';

import { useActionState } from 'react';
import {
  archiveAdminCatalogRecordAction,
  unarchiveAdminCatalogRecordAction,
  type AdminCatalogArchiveActionState,
  type AdminCatalogArchiveKind,
} from '../../app/admin/archive-actions';
import type { AdminCatalogArchiveFilter as ArchiveFilter } from '../../lib/admin/catalog-archive';
import { AdminNotice } from './console/AdminKit';
import { AdminSelect } from './console/AdminSelect';
import { Button } from './kit/ui/button';

const initialState: AdminCatalogArchiveActionState = {};

const ARCHIVE_WARNINGS: Record<AdminCatalogArchiveKind, string> = {
  ip: '운영 중인 하위 카탈로그나 카드풀·정책·게임이 남아 있으면 보관할 수 없습니다.',
  good: '판매 재고나 활성 발급 정책이 남아 있으면 보관할 수 없습니다.',
  card: '예정·운영 중인 카드풀이나 미개봉 카드팩이 남아 있으면 보관할 수 없습니다.',
  event: '예정·운영 중인 티켓 회차나 게임이 남아 있으면 보관할 수 없습니다.',
};

export function CatalogArchiveFilter({
  counts,
  filter,
  onChange,
}: {
  counts: Record<ArchiveFilter, number>;
  filter: ArchiveFilter;
  onChange: (filter: ArchiveFilter) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">보관 상태</span>
      <AdminSelect
        aria-label="보관 상태"
        onChange={(event) => onChange(event.target.value as ArchiveFilter)}
        value={filter}
        wrapperClassName="w-full"
      >
        <option value="active">운영 중 {counts.active}</option>
        <option value="archived">보관됨 {counts.archived}</option>
        <option value="all">전체 {counts.all}</option>
      </AdminSelect>
    </label>
  );
}

export function CatalogArchiveControl({
  archivedAt,
  id,
  kind,
}: {
  archivedAt: string | null;
  id: string;
  kind: AdminCatalogArchiveKind;
}) {
  const archived = Boolean(archivedAt);
  const action = archived
    ? unarchiveAdminCatalogRecordAction
    : archiveAdminCatalogRecordAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" data-catalog-archive="">
      <h2 className="text-base leading-snug font-medium">{archived ? '보관 복원' : '카탈로그 보관'}</h2>
      <p className="text-sm text-muted-foreground">
        {archived
          ? (kind === 'ip' || kind === 'good' ? '초안으로 복원합니다. 다시 노출하려면 내용을 확인한 뒤 공개로 전환해주세요.' : '보관된 항목을 공개 카탈로그로 복원합니다.')
          : ARCHIVE_WARNINGS[kind]}
      </p>
      {state.errors?.form && <AdminNotice role="alert" tone="danger">{state.errors.form}</AdminNotice>}
      {state.message && <AdminNotice role="status" tone="success">{state.message}</AdminNotice>}
      <form action={formAction}>
        <input name="kind" readOnly type="hidden" value={kind} />
        <input name="id" readOnly type="hidden" value={id} />
        <Button disabled={pending} type="submit" variant={archived ? 'default' : 'outline'}>
          {pending ? '처리 중' : archived ? '복원' : '보관'}
        </Button>
      </form>
    </section>
  );
}
