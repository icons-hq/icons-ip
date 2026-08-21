import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AouadCampaignPopup } from '@/components/campaigns/aouad/AouadCampaignPopup';
import { isLastBellPrototypeEnabled } from '@/lib/prototypes/last-bell/gate.server';

export default async function LastBellPopupPage() {
  await connection();
  if (!isLastBellPrototypeEnabled()) notFound();
  return <AouadCampaignPopup />;
}
