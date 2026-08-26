'use client';

import Link from 'next/link';
import { useCallback, useState, type Ref } from 'react';
import type { AouadComparisonResult } from '@/lib/campaigns/aouad/lab/comparison';
import {
  comparisonSharePhotoFromSession,
  shareAouadComparisonResult,
} from '@/lib/campaigns/aouad/lab/share';
import { AOUAD_POPUP_PATH } from '@/lib/campaigns/aouad/content';
import { getAouadStudentPhotoSession } from '@/lib/campaigns/aouad/student-photo-session';
import styles from './aouad-lab.module.css';

type ComparisonResultActionsProps = {
  result: AouadComparisonResult;
  candidateName: string;
  onRetry: () => void;
  primaryActionRef?: Ref<HTMLButtonElement>;
};

export function ComparisonResultActions({ result, candidateName, onRetry, primaryActionRef }: ComparisonResultActionsProps) {
  const [shareStatus, setShareStatus] = useState('');
  const share = useCallback(async () => {
    const photo = comparisonSharePhotoFromSession(getAouadStudentPhotoSession());
    const method = await shareAouadComparisonResult(result, candidateName, window.location.href, { photo });
    setShareStatus(
      method === 'web-share' ? '공유 시트를 열었습니다.'
        : method === 'download' ? '비교 기록 카드를 저장했습니다.'
          : method === 'clipboard' ? '결과 텍스트를 복사했습니다.'
            : method === 'cancelled' ? '공유를 취소했습니다.'
              : '이 브라우저에서는 공유를 사용할 수 없습니다.',
    );
  }, [candidateName, result]);

  return (
    <div className={styles.resultActions}>
      <button ref={primaryActionRef} type="button" className={styles.primaryButton} onClick={onRetry}>다시 하기</button>
      <button type="button" className={styles.secondaryButton} onClick={share}>결과 공유</button>
      <Link className={styles.secondaryButton} href={AOUAD_POPUP_PATH}>팝업으로 돌아가기</Link>
      <Link className={styles.secondaryButton} href={`${AOUAD_POPUP_PATH}/store`}>매점 미리보기</Link>
      <p className={styles.shareStatus} role="status" aria-live="polite">{shareStatus}</p>
    </div>
  );
}
