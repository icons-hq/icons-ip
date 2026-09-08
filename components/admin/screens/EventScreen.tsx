'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { useActionState, useMemo } from 'react';
import { upsertAdminEventAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { EventSection } from '@/components/admin/sections/EventSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import { toRecordOptions, useSelectedRecord } from './record-selection';

const emptyState: AdminCatalogActionState = {};

/* 이벤트 화면 래퍼. 선택 레코드와 저장 액션 상태만 화면 로컬로 들고 있는다. */
export function EventScreen({
  ips,
  records,
}: {
  ips: AdminCatalogRecords['ips'];
  records: AdminCatalogRecords['events'];
}) {
  const [state, action, pending] = useActionState(upsertAdminEventAction, emptyState);
  const ipOptions = useMemo(() => toRecordOptions(ips), [ips]);
  const { selected, select } = useSelectedRecord(records);

  return (
    <><AdminPageHeader title="이벤트·회차" description="이벤트 정보와 예매 회차를 관리합니다." />
    <EventSection
      action={action}
      ipOptions={ipOptions}
      onSelect={select}
      pending={pending}
      records={records}
      selected={selected}
      state={state}
    /></>
  );
}
