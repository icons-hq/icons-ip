'use client';

import dynamic from 'next/dynamic';
import styles from './tusin-survival.module.css';

const SurvivalCanvas = dynamic(() => import('./SurvivalCanvas'), {
  ssr: false,
  loading: () => (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.loadingMark} aria-hidden="true" />
      전장을 불러오는 중…
    </div>
  ),
});

export function TusinSurvivalClient() {
  return (
    <main className={styles.prototypeShell}>
      <SurvivalCanvas />
    </main>
  );
}
