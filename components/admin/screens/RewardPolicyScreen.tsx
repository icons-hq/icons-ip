'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { useMemo } from 'react';
import { RewardPolicySection } from '@/components/admin/sections/RewardPolicySection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import { toRecordOptions, useSelectedRecord } from './record-selection';

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
  const ipOptions = useMemo(() => toRecordOptions(ips), [ips]);
  const { selected, select } = useSelectedRecord(records);

  return (
    <><AdminPageHeader title="카드팩 발급 정책" description="발급 조건과 연결 카드풀을 확인하고 저장합니다." />
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
    /></>
  );
}
