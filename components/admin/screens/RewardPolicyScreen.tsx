'use client';

import { RewardPolicySection } from '@/components/admin/sections/RewardPolicySection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import { useSelectedRecord } from './record-selection';

/*
 * 뽑기권 발급 정책 화면 래퍼.
 *
 * 정책 저장이 멱등 키를 쓰므로 `draftId`·`operationId`는 page가 만들어 내려준다.
 */
export function RewardPolicyScreen({
  draftActiveFrom,
  draftId,
  goods,
  ipOptions,
  operationId,
  pools,
  records,
}: {
  draftActiveFrom: string;
  draftId: string;
  /** 정책이 참조하는 굿즈만(규모 후속). 이름 표시용이고, 고르는 것은 선택기가 한다. */
  goods: AdminCatalogRecords['goods'];
  /** IP 선택지 — 상위 N + 정책·풀이 참조하는 IP. */
  ipOptions: AdminCurationTargetRecord[];
  operationId: string;
  pools: AdminCatalogRecords['cardPools'];
  records: AdminCatalogRecords['rewardPolicies'];
}) {
  const { selected, select } = useSelectedRecord(records);

  return (
    <RewardPolicySection
      draftActiveFrom={draftActiveFrom}
      draftId={draftId}
      goods={goods}
      ipOptions={ipOptions}
      onSelect={select}
      operationId={operationId}
      pools={pools}
      records={records}
      selected={selected}
    />
  );
}
