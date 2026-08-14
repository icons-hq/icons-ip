import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { TusinSurvivalClient } from '@/components/prototype/tusin-survival/TusinSurvivalClient';
import { isTusinSurvivalPrototypeEnabled } from '@/lib/prototypes/tusin-survival/gate.server';

export const metadata: Metadata = {
  title: '투신전생기 서바이벌 — 내부 프로토타입',
  description: '투신전생기 기반 bullet-heaven 게임의 내부 first playable입니다.',
  robots: { index: false, follow: false },
};

export default async function TusinSurvivalPrototypePage() {
  // 빌드 시점에 플래그를 고정하지 않고 deployment runtime의 서버 환경값을 읽는다.
  await connection();
  if (!isTusinSurvivalPrototypeEnabled()) notFound();

  return <TusinSurvivalClient />;
}
