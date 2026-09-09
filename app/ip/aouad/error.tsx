'use client';

import Link from 'next/link';
import styles from '@/components/online-popup/aouad/AouadExperience.module.css';

export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className={styles.experience}>
      <div className={styles.loading} role="alert">
        <p className={styles.eyebrow}>ICONS · ONLINE POPUP</p>
        <h1>잠시 연결이 끊겼습니다.</h1>
        <p>화면을 다시 불러와 효산고 탐험을 이어가세요.</p>
        <button className={styles.retry} onClick={reset} type="button">다시 불러오기</button>
        <Link href="/ip">온라인 팝업으로 돌아가기</Link>
      </div>
    </div>
  );
}
