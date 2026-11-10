'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { useActionState, useMemo } from 'react';
import { upsertAdminEventAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { EventSection } from '@/components/admin/sections/EventSection';
import { RecordNewButton, useRecordDetail } from '@/components/admin/sections/RecordMasterList';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import { toRecordOptions } from './record-selection';

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
  const detail = useRecordDetail(records);

  return (
    <div className="flex min-w-0 flex-col gap-6"><AdminPageHeader title="이벤트" description="이벤트 정보와 예매 회차를 관리합니다." actions={<RecordNewButton label="이벤트 등록" onClick={detail.startNew} open={detail.open} />} />
    <EventSection
      action={action}
      creating={detail.creating}
      ipOptions={ipOptions}
      onClose={detail.close}
      onSelect={detail.select}
      pending={pending}
      records={records}
      selected={detail.selected}
      state={state}
    /></div>
  );
}
