import type { Metadata } from 'next';
import { PopupHub } from '@/components/screens/PopupHub';
import { loadPopupItems } from '@/lib/popups.server';

/* POP-UP 목록 (스펙 C §2.6).
   지금 열려 있거나 곧 열리는 오프라인 팝업(예매)과 POP-UP 캠페인을 한 목록으로 모은다. 없으면 빈 상태. */

export const metadata: Metadata = {
  title: 'POP-UP — ICONS',
  description: 'ICONS에서 지금 열려 있거나 곧 열리는 POP-UP을 모아 봅니다.',
};

export default async function Page() {
  const items = await loadPopupItems();
  return <PopupHub items={items} />;
}
