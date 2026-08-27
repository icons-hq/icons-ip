'use client';

import dynamic from 'next/dynamic';
import styles from './HyosanMemories.module.css';

const HyosanMemoriesGame = dynamic(() => import('./HyosanMemoriesGame.client'), {
  ssr: false,
  loading: () => (
    <main className={styles.loading} aria-label="효산의 기억 게임 로딩 중">
      <span className={styles.loadingEyebrow}>MEMORY ECHO / G1</span>
      <strong>급식실 기억을 복원하는 중</strong>
    </main>
  ),
});

export function HyosanMemoriesEntry() {
  return <HyosanMemoriesGame />;
}
