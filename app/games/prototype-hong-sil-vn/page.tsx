import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PrototypeRoot } from '@/components/prototype/hong-sil-vn/PrototypeRoot';

/* ═══════════════════════════════════════════════════════════════════════
 * PROTOTYPE — 홍실 퀘스트 온라인 팝업 · 서사형 행동 체험 게임 + 엔딩 카드
 * 버릴 라우트다. main으로 승격하지 말고, 검증이 끝나면 폐기 브랜치로 보낸다.
 *
 * "서사형 게임 → 엔딩 → 엔딩 카드(봉인) → 팝업 종료 후 공개"를
 * 세 가지 구조로 놓고 고른다: ?variant=A(극장) | B(홍실) | C(기록).
 *
 * 성인 트랙: ?track=adult 로 들어오면 연령 게이트를 먼저 띄운다. 게이트를 통과해야
 * story-adult 청크를 동적 import 한다 — 전연령 플레이는 그 청크를 받지 않는다.
 * 이 게이트는 실제 연령 확인이 아니다(본인인증 미배선). adult-track.md §2 참조.
 *
 * /games 아래 정적 세그먼트라 [gameId] 동적 라우트보다 우선하며,
 * games 카탈로그·play_game RPC를 전혀 건드리지 않는다(프로덕션 계약 무손상).
 *
 * 노출 가드: ICONS_PROTOTYPE=1 일 때만 렌더된다. 배포 환경에는 이 값이 없으므로
 * 실수로 머지돼도 사용자에게 도달하지 않는다.
 *   ICONS_PROTOTYPE=1 npm run start
 * ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = 'force-dynamic';

/* 정적 metadata는 notFound() 전에 평가돼 404에서도 제목이 남는다 —
 * 가드가 꺼진 환경에서 라우트 존재가 새지 않게 제목까지 함께 가린다. */
export async function generateMetadata(): Promise<Metadata> {
  if (process.env.ICONS_PROTOTYPE !== '1') return {};
  return {
    title: '홍실 퀘스트 — 서사형 체험 게임 (프로토타입)',
    robots: { index: false, follow: false },
  };
}

export default async function HongSilVnPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string; track?: string }>;
}) {
  if (process.env.ICONS_PROTOTYPE !== '1') notFound();
  const { variant, track } = await searchParams;
  return (
    <PrototypeRoot
      initialVariant={(variant ?? 'A').toUpperCase()}
      /* 링크로 성인 트랙을 요청할 수는 있지만, 진입은 게이트를 통과해야 한다. */
      requestAdult={track === 'adult'}
    />
  );
}
