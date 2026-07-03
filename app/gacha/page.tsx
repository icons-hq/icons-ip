import type { Metadata } from 'next';
import { Gacha } from '@/components/screens/Gacha';
import { getCatalogSnapshot } from '@/lib/catalog';

export const metadata: Metadata = {
  title: '뽑기 — ICONS',
  description: '충전금으로 돌리는 가챠. 확률은 전부 공시하고, 최고 등급은 천장으로 보장합니다.',
};

export default async function Page({ searchParams }: { searchParams: Promise<{ ip?: string | string[] }> }) {
  const catalog = await getCatalogSnapshot();
  const ipParam = (await searchParams).ip;
  const requestedIp = Array.isArray(ipParam) ? ipParam[0] : ipParam;
  const initialIpId = catalog.ips.some((ip) => ip.id === requestedIp) ? requestedIp : undefined;
  return <Gacha catalog={catalog} initialIpId={initialIpId} />;
}
