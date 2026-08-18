'use client';

import { useActionState } from 'react';
import { upsertAdminIpAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { IpSection } from '@/components/admin/sections/IpSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { CatalogSnapshot } from '@/lib/catalog';
import { useSelectedRecord } from './record-selection';

const emptyState: AdminCatalogActionState = {};

/*
 * 화면별 클라이언트 래퍼.
 *
 * 서버 컴포넌트 라우트가 데이터를 로드하고, 선택 레코드와 useActionState 같은
 * 화면 로컬 상태는 여기가 갖는다. 예전에는 Admin.tsx 하나가 17개 섹션의 상태를
 * 전부 들고 있어서 어느 화면을 열든 모든 상태가 살아 있었다.
 */
export function IpScreen({
  records,
  verticals,
}: {
  records: AdminCatalogRecords['ips'];
  verticals: CatalogSnapshot['verticals'];
}) {
  const [state, action, pending] = useActionState(upsertAdminIpAction, emptyState);
  const { selected, select } = useSelectedRecord(records);

  return (
    <IpSection
      action={action}
      onSelect={select}
      pending={pending}
      records={records}
      selected={selected}
      state={state}
      verticals={verticals}
    />
  );
}
