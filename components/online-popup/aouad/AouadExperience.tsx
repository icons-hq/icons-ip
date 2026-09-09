'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import styles from './AouadExperience.module.css';

const AouadSample = dynamic(
  () => import('@/components/online-popup/aouad/source/components/aouad/AouadSample.jsx'),
  {
    ssr: false,
    loading: () => (
      <div className={styles.loading}>
        <p className={styles.eyebrow}>ICONS · ONLINE POPUP</p>
        <h1>지금 우리 학교는</h1>
        <p role="status">효산고의 기억을 불러오고 있습니다.</p>
        <p className={styles.notice}>프레젠테이션 · 실제 주문·결제·리워드는 진행되지 않습니다.</p>
        <Link href="/ip">온라인 팝업으로 돌아가기</Link>
      </div>
    ),
  },
);

export function AouadExperience() {
  return <div className={styles.experience} data-aouad-experience><AouadSample /></div>;
}
