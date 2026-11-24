'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { upsertAdminCampaignAction, type AdminCampaignActionState } from '@/app/admin/campaign-actions';
import { CampaignPresentationPanel } from '@/components/admin/CampaignPresentationPanel';
import { CampaignSection } from '@/components/admin/sections/CampaignSection';
import { adminCampaignHref, type AdminCampaignRecord } from '@/lib/admin/campaigns';
import { useSelectedRecord } from './record-selection';

/* 캠페인 콘솔 화면 (S8 #330).
 * 카드팩 교환처는 2026-11-24 일반 쇼핑몰 전환으로 지웠다(ADR-0052).
 * 저장된 캠페인을 고르면 그 아래에 노출 설정(EVENT·POP-UP·바로가기) 패널이 붙는다 — 캠페인 본문과 따로 저장한다. */

const emptyState: AdminCampaignActionState = {};

export function CampaignScreen({
  records,
}: {
  records: AdminCampaignRecord[];
}) {
  const [state, action, pending] = useActionState(upsertAdminCampaignAction, emptyState);
  /* 편집 중인 캠페인은 주소(?campaign=)에도 남긴다. 할인 프로모션에서 돌아오거나 뒤로 가기·새로고침하면 같은 캠페인 편집이 열린다(QA1 MD).
     뒤로 가기는 서버가 앞서 그린 화면을 다시 쓰므로 처음 고를 캠페인은 지금 주소에서 읽는다. */
  const requested = useSearchParams()?.get('campaign') ?? null;
  const { selected, select: selectRecord } = useSelectedRecord(records, requested);
  function select(record: { id: string } | null) {
    selectRecord(record);
    window.history.replaceState(null, '', adminCampaignHref(record?.id ?? null));
  }

  return (
    <><AdminPageHeader title="캠페인 관리" description="캠페인 노출과 콘텐츠를 관리합니다." />
    <div className="flex min-w-0 flex-col gap-5">
      <CampaignSection
        action={action}
        onSelect={select}
        pending={pending}
        records={records}
        selected={selected}
        state={state}
      />
      {selected ? <CampaignPresentationPanel campaign={selected} key={selected.id} /> : null}
    </div></>
  );
}
