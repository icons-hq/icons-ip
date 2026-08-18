'use client';

import { useMemo, useState } from 'react';
import { RewardPolicySection } from '@/components/admin/sections/RewardPolicySection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';

/*
 * 뽑기권 발급 정책 화면 래퍼.
 *
 * 정책 저장이 멱등 키를 쓰므로 `draftId`·`operationId`는 page가 만들어 내려준다.
 */
export function RewardPolicyScreen({
  draftActiveFrom,
  draftId,
  goods,
  ips,
  operationId,
  pools,
  records,
}: {
  draftActiveFrom: string;
  draftId: string;
  goods: AdminCatalogRecords['goods'];
  ips: AdminCatalogRecords['ips'];
  operationId: string;
  pools: AdminCatalogRecords['cardPools'];
  records: AdminCatalogRecords['rewardPolicies'];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ipOptions = useMemo(
    () => ips.map((ip) => ({ id: ip.id, title: ip.title, archivedAt: ip.archivedAt })),
    [ips],
  );
  const selected = records.find((policy) => policy.id === selectedId) ?? null;

  return (
    <RewardPolicySection
      draftActiveFrom={draftActiveFrom}
      draftId={draftId}
      goods={goods}
      ipOptions={ipOptions}
      onSelect={(policy) => setSelectedId(policy?.id ?? null)}
      operationId={operationId}
      pools={pools}
      records={records}
      selected={selected}
    />
  );
}
