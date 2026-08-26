import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AouadCampaignPopup } from '@/components/campaigns/aouad/AouadCampaignPopup';
import { isAouadZoneId } from '@/lib/campaigns/aouad/content';
import { getAouadGameEntryContext } from '@/lib/campaigns/aouad/game-entry.server';
import { isLastBellPrototypeEnabled } from '@/lib/prototypes/last-bell/gate.server';

type LastBellPopupZonePageProps = { params: Promise<{ zone: string }> };

export default async function LastBellPopupZonePage({ params }: LastBellPopupZonePageProps) {
  const { zone } = await params;
  if (!isAouadZoneId(zone)) notFound();
  await connection();
  if (!isLastBellPrototypeEnabled()) notFound();
  const entry = await getAouadGameEntryContext();
  return <AouadCampaignPopup zone={zone} entry={entry} />;
}
