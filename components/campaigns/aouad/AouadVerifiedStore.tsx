'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  LAST_BELL_VERIFIED_STORE_PATH,
  type AouadGameEntryContext,
} from '@/lib/campaigns/aouad/game-entry';
import { AOUAD_ZONES } from '@/lib/campaigns/aouad/content';
import { useAouadCampaign } from './AouadCampaignProvider';
import { AouadStoreZone } from './AouadCampaignPopup';
import styles from './aouad-campaign.module.css';

export function AouadVerifiedStore({ entry }: { entry: AouadGameEntryContext }) {
  const { hydrated } = useAouadCampaign();
  const store = AOUAD_ZONES.store;

  if (!hydrated) {
    return <main className={styles.loading} aria-live="polite">보급소 구매권을 확인하고 있습니다.</main>;
  }

  return (
    <main className={styles.campaignMain}>
      <header className={styles.zoneHeader}>
        <Link href={entry.gameHref} prefetch={false} className={styles.backLink}>← 마지막 종</Link>
        <div><span>{store.subtitle}</span><h1>{store.name}</h1></div>
        <Image src={store.image} alt="" fill sizes="100vw" preload />
        <i />
      </header>
      <AouadStoreZone entry={entry} storeHref={LAST_BELL_VERIFIED_STORE_PATH} />
      <nav className={styles.zoneNav} aria-label="마지막 종 이동">
        <Link href={entry.gameHref} prefetch={false}>마지막 종 다시 플레이</Link>
        <Link href="/shop">전체 굿즈 보기</Link>
      </nav>
    </main>
  );
}
