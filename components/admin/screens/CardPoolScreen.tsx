'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { useMemo } from 'react';
import { CardPoolSection } from '@/components/admin/sections/CardPoolSection';
import { RecordNewButton, useRecordDetail } from '@/components/admin/sections/RecordMasterList';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import { toRecordOptions } from './record-selection';

/*
 * 카드풀 화면 래퍼.
 *
 * 카드풀 저장·확률 저장은 멱등 키를 쓴다. 그래서 `draftId`·`operationId`·`oddsOperationId`는
 * 서버 컴포넌트인 page가 요청당 한 번 만들어 내려준다.
 */
export function CardPoolScreen({
  cards,
  draftActiveFrom,
  draftId,
  ips,
  oddsOperationId,
  operationId,
  records,
}: {
  cards: AdminCatalogRecords['cards'];
  draftActiveFrom: string;
  draftId: string;
  ips: AdminCatalogRecords['ips'];
  oddsOperationId: string;
  operationId: string;
  records: AdminCatalogRecords['cardPools'];
}) {
  const ipOptions = useMemo(() => toRecordOptions(ips), [ips]);
  const detail = useRecordDetail(records);

  return (
    <div className="flex min-w-0 flex-col gap-6"><AdminPageHeader title="카드풀" description="카드 구성과 개봉 준비 상태를 확인합니다." actions={<RecordNewButton label="카드풀 등록" onClick={detail.startNew} open={detail.open} />} />
    <CardPoolSection
      cards={cards}
      creating={detail.creating}
      draftActiveFrom={draftActiveFrom}
      draftId={draftId}
      ipOptions={ipOptions}
      oddsOperationId={oddsOperationId}
      onClose={detail.close}
      onSelect={detail.select}
      operationId={operationId}
      records={records}
      selected={detail.selected}
    /></div>
  );
}
