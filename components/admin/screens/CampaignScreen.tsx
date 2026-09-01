'use client';

import { useActionState } from 'react';
import { upsertAdminCampaignAction, type AdminCampaignActionState } from '@/app/admin/campaign-actions';
import { CampaignSection } from '@/components/admin/sections/CampaignSection';
import { CoinExchangeOfferPanel } from '@/components/admin/sections/CoinExchangeOfferPanel';
import type { AdminCampaignRecord, AdminCoinExchangeOfferRecord } from '@/lib/admin/campaigns';
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
}: {
  offers: AdminCoinExchangeOfferRecord[];
  pools: AdminCardPoolRecord[];
  records: AdminCampaignRecord[];
}) {
  const [state, action, pending] = useActionState(upsertAdminCampaignAction, emptyState);
  const { selected, select } = useSelectedRecord(records);

  return (
    <div className="col" style={{ gap: 18 }}>
      <CampaignSection
        action={action}
        onSelect={select}
        pending={pending}
        records={records}
        selected={selected}
        state={state}
      />
      <CoinExchangeOfferPanel offers={offers} pools={pools} />
    </div>
  );
}
