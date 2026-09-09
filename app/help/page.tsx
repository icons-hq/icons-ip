import type { Metadata } from 'next';
import { HelpScreen } from '@/components/screens/HelpScreen';
import { normalizeFaqFilters } from '@/lib/faq';
import { loadPublishedFaq, type FaqPageData } from '@/lib/faq.server';

export const metadata: Metadata = {
  title: '자주 묻는 질문 — ICONS',
  description: '주문·배송, 취소·반품·교환, 상품과 계정에 대한 도움말을 찾아보세요.',
};
export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = normalizeFaqFilters(await searchParams);
  let data: FaqPageData;
  let failed = false;
  try {
    data = await loadPublishedFaq(filters);
  } catch {
    data = { entries: [], total: 0, filters };
    failed = true;
  }
  return <HelpScreen data={data} failed={failed} />;
}
