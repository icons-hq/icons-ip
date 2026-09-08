'use client';

import {useActionState} from 'react';
import { upsertAdminEventAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { EventSection } from '@/components/admin/sections/EventSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import { useSelectedRecord } from './record-selection';

const emptyState: AdminCatalogActionState = {};

/* 이벤트 화면 래퍼. 선택 레코드와 저장 액션 상태만 화면 로컬로 들고 있는다. */
export function EventScreen({
  ipOptions,
  records,
}: {
  /** IP 선택지 — 상위 N + 이벤트가 참조하는 IP(규모 후속). */
  ipOptions: AdminCurationTargetRecord[];
  records: AdminCatalogRecords['events'];
}) {
  const [state, action, pending] = useActionState(upsertAdminEventAction, emptyState);
  const { selected, select } = useSelectedRecord(records);

  return (
    <EventSection
      action={action}
      ipOptions={ipOptions}
      onSelect={select}
      pending={pending}
      records={records}
      selected={selected}
      state={state}
    />
  );
}
