import { Suspense, type ReactNode } from 'react';
import { AdminEntryFallback } from '@/components/admin/console/AdminScreenSkeleton';

/*
 * 새로고침·직접 진입에서 셸이 올 때까지 어드민용 빈 바탕을 보인다(공개 스토어의 카드 뼈대 대신).
 *
 * `loading.tsx`로 두지 않는다. loading.tsx의 경계는 자식 칸마다 key가 달려 `(shell)`↔`(content)` 콘솔 전환 때 새로 생기고,
 * 그 순간 사이드바까지 전부 fallback으로 바뀐다. 레이아웃의 경계는 소프트 이동에서 그대로 남아 전환 동안 이전 화면이 유지된다.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AdminEntryFallback />}>{children}</Suspense>;
}
