'use client';

import Link from 'next/link';
import { useStaffPreviewVisible } from '@/components/shell/StaffPreviewAvailability';
import { AOUAD_POPUP_ENABLED, AOUAD_POPUP_PUBLIC } from '@/lib/aouad-popup';
import { AOUAD_POPUP_PATH } from '@/lib/routes';
import styles from './AouadShowcaseCard.module.css';

export function AouadShowcaseCard({ localPreview = false }: { localPreview?: boolean }) {
  const isStaff = useStaffPreviewVisible();
  if (!AOUAD_POPUP_ENABLED || (!AOUAD_POPUP_PUBLIC && !isStaff && !localPreview)) return null;

  return (
    <section aria-labelledby="aouad-showcase-title" className={styles.showcase}>
      <Link className={styles.card} href={AOUAD_POPUP_PATH} prefetch={false}>
        <div className={styles.art} aria-hidden="true" />
        <div className={styles.content}>
          <p className={styles.eyebrow}>ICONS ORIGINAL EXPERIENCE <span>프레젠테이션</span></p>
          <h2 id="aouad-showcase-title">지금 우리 학교는</h2>
          <p className={styles.description}>문이 닫힌 뒤에도,<br />우리의 이야기는 계속된다.</p>
          <span className={styles.cta}>효산고 들어가기 <span aria-hidden="true">↗</span></span>
        </div>
      </Link>
      <p className={styles.note}>시연 전용 경험입니다. 실제 주문·결제·예약·리워드는 진행되지 않습니다.</p>
    </section>
  );
}
