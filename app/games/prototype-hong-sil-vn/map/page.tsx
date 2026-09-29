import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StoryMap } from '@/components/prototype/hong-sil-vn/StoryMap';

/* ═══════════════════════════════════════════════════════════════════════
 * PROTOTYPE — 홍실 퀘스트 서사형 게임 구조 브리핑 (내부 보고용)
 * 버릴 라우트다. 플레이어용 화면이 아니라 "이게 어떤 시스템이고 어디서 매출이 나는가"를
 * 한 장으로 설명하는 자료다. 그래서 결말 20종을 전부 공개한다.
 *
 * 게임 본체는 ../ (같은 프로토타입, ?variant=A|B|C).
 * 노출 가드는 동일하다 — ICONS_PROTOTYPE=1 일 때만 렌더된다.
 * ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  if (process.env.ICONS_PROTOTYPE !== '1') return {};
  return {
    title: '홍실 퀘스트 — 게임 구조 브리핑 (프로토타입)',
    robots: { index: false, follow: false },
  };
}

export default function HongSilVnMapPage() {
  if (process.env.ICONS_PROTOTYPE !== '1') notFound();
  return <StoryMap />;
}
