'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { useMemo } from 'react';
import { RecordNewButton, useRecordDetail } from '@/components/admin/sections/RecordMasterList';
import { RewardPolicySection } from '@/components/admin/sections/RewardPolicySection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import { toRecordOptions } from './record-selection';

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
  const detail = useRecordDetail(records);

  return (
    <div className="flex min-w-0 flex-col gap-6"><AdminPageHeader title="뽑기권 발급 정책" description="발급 조건과 연결 카드풀을 확인하고 저장합니다." actions={<RecordNewButton label="발급 정책 등록" onClick={detail.startNew} open={detail.open} />} />
    <RewardPolicySection
      creating={detail.creating}
      draftActiveFrom={draftActiveFrom}
      draftId={draftId}
      goods={goods}
      ipOptions={ipOptions}
      onClose={detail.close}
      onSelect={detail.select}
      operationId={operationId}
      pools={pools}
      records={records}
      selected={detail.selected}
    /></div>
  );
}
