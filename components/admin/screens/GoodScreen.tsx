'use client';

import { useActionState, useMemo, useState } from 'react';
import { upsertAdminGoodAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { GoodSection } from '@/components/admin/sections/GoodSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { CatalogSnapshot } from '@/lib/catalog';

const emptyState: AdminCatalogActionState = {};

/*
 * 굿즈 화면 래퍼.
 *
 * `adjustmentId`는 실재고 조정의 멱등 키다. 여기서 만들면 리렌더마다 값이 바뀌어
 * 같은 조정이 두 번 먹힐 수 있어서, 서버 컴포넌트인 page가 만들어 내려준다.
 */
export function GoodScreen({
  adjustmentId,
  catalogIps,
  ips,
  records,
}: {
  adjustmentId: string;
  catalogIps: CatalogSnapshot['ips'];
  ips: AdminCatalogRecords['ips'];
  records: AdminCatalogRecords['goods'];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, action, pending] = useActionState(upsertAdminGoodAction, emptyState);
  const ipOptions = useMemo(
    () => ips.map((ip) => ({ id: ip.id, title: ip.title, archivedAt: ip.archivedAt })),
    [ips],
  );
  const selected = records.find((good) => good.id === selectedId) ?? null;

  return (
    <GoodSection
      action={action}
      adjustmentId={adjustmentId}
      catalogIps={catalogIps}
      ipOptions={ipOptions}
      onSelect={(good) => setSelectedId(good?.id ?? null)}
      pending={pending}
      records={records}
      selected={selected}
      state={state}
    />
  );
}
