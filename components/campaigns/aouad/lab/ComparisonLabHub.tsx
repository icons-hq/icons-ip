import Image from 'next/image';
import Link from 'next/link';
import { AOUAD_IMAGES, AOUAD_POPUP_PATH } from '@/lib/campaigns/aouad/content';
import styles from './aouad-lab.module.css';

const candidates = [
  { id: 'last-bell', index: '01', title: 'Last Bell', description: '듣기·은신·환경 조작으로 탈출하는 1인칭 Chapter 1.', href: '/games/prototype-last-bell', image: AOUAD_IMAGES.hero },
  { id: 'infection-record', index: '02', title: '감염 기록', description: '세 번의 판단으로 감염 경로와 생존 기록을 만드는 2D 체험.', href: `${AOUAD_POPUP_PATH}/lab/infection-record`, image: AOUAD_IMAGES.classroom },
  { id: 'survival-arcade', index: '03', title: '3분 생존', description: '정확히 180초 동안 위험 신호를 읽고 피해 다니는 2D 아케이드.', href: `${AOUAD_POPUP_PATH}/lab/survival-arcade`, image: AOUAD_IMAGES.cafeteria },
] as const;

export function ComparisonLabHub() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <p className={styles.eyebrow}>G2 · INTERNAL COMPARISON LAB</p>
        <h1 className={styles.title}>같은 학교, 다른 생존 방식.</h1>
        <p className={styles.lead}>세 후보는 같은 시작·결과 계약으로만 비교합니다. 모든 결과는 이 브라우저의 로컬 평가 기록이며 보상, 순위, 굿즈 구매 권한을 만들지 않습니다.</p>
        <section className={styles.candidateGrid} aria-label="비교 후보">
          {candidates.map((candidate) => (
            <Link key={candidate.id} className={styles.candidateCard} href={candidate.href} prefetch={candidate.id === 'last-bell' ? false : undefined}>
              <div className={styles.candidateImage}><Image src={candidate.image} alt="" fill loading="eager" sizes="(max-width: 680px) 8.5rem, 33vw" /></div>
              <div className={styles.candidateBody}>
                <span className={styles.candidateIndex}>CANDIDATE {candidate.index}</span>
                <h2>{candidate.title}</h2>
                <p>{candidate.description}</p>
                <span className={styles.candidateAction}>평가 시작 →</span>
              </div>
            </Link>
          ))}
        </section>
        <p className={styles.labNotice}>내부 평가는 첫 행동, 첫 3분, 결과 CTA 발견 여부를 기록합니다. 상품 미리보기는 각 후보의 결과와 무관하게 언제든 열 수 있습니다.</p>
        <Link className={styles.backLink} href={AOUAD_POPUP_PATH}>← 효산고 온라인 팝업으로 돌아가기</Link>
      </div>
    </main>
  );
}
