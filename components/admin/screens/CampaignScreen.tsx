'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { upsertAdminCampaignAction, type AdminCampaignActionState } from '@/app/admin/campaign-actions';
import { CampaignSection } from '@/components/admin/sections/CampaignSection';
import { CoinExchangeOfferPanel } from '@/components/admin/sections/CoinExchangeOfferPanel';
import { adminCampaignHref, type AdminCampaignRecord, type AdminCoinExchangeOfferRecord } from '@/lib/admin/campaigns';
import type { AdminCardPoolRecord } from '@/lib/admin/catalog.server';
import { useSelectedRecord } from './record-selection';

/* 캠페인 콘솔 화면 (S8 #330).
 * 캠페인 편성과 카드팩 교환처를 한 화면에 둔다 — exchange 블록이 교환처 id 를
 * 그대로 받으므로, 두 화면으로 나누면 운영자가 id 를 들고 화면을 오가야 한다. */

const emptyState: AdminCampaignActionState = {};

export function CampaignScreen({
  offers,
  pools,
  records,
  canManageOffers = true,
}: {
  offers: AdminCoinExchangeOfferRecord[];
  pools: AdminCardPoolRecord[];
  records: AdminCampaignRecord[];
  canManageOffers?: boolean;
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
    <><AdminPageHeader title="캠페인 관리" description={canManageOffers ? '캠페인 노출과 무상 카드팩 교환처를 관리합니다.' : '캠페인 노출과 콘텐츠를 관리합니다.'} />
    <div className="flex min-w-0 flex-col gap-5">
      <CampaignSection
        action={action}
        onSelect={select}
        pending={pending}
        records={records}
        selected={selected}
        state={state}
      />
      {canManageOffers ? <CoinExchangeOfferPanel offers={offers} pools={pools} /> : null}
    </div></>
  );
}
