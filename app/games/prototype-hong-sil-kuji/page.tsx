import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HongSilKujiPrototype } from '@/components/prototype/hong-sil-kuji/HongSilKujiPrototype';

export const dynamic = 'force-dynamic';

const PROTOTYPE_ENABLED = process.env.ICONS_PROTOTYPE === '1';

export async function generateMetadata(): Promise<Metadata> {
  if (!PROTOTYPE_ENABLED) return {};

  return {
    title: '홍실 행운상점 — 프로토타입',
    description: '고정 수량 굿즈 박스와 마지막 상 흐름을 검증하는 로컬 전용 프로토타입',
    robots: { index: false, follow: false },
  };
}

export default async function HongSilKujiPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  if (!PROTOTYPE_ENABLED) notFound();

  const { variant } = await searchParams;

  return <HongSilKujiPrototype initialVariant={variant} />;
}
