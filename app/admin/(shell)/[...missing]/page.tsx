import { notFound } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

/*
 * 어드민에 없는 주소(ADM-016 #12). 이 catch-all이 없으면 매칭되는 라우트가 없어 앱 전체의 공개 404가 셸 없이 뜬다.
 * 여기서 notFound()를 던지면 같은 route group의 `not-found.tsx`가 사이드바·상단 막대를 남긴 채 어드민 문구로 답한다.
 * 미로그인은 다른 화면처럼 로그인으로 보내고, 스태프가 아닌 계정은 게이트·레이아웃이 공개 404를 그대로 준다.
 * 정적 라우트가 항상 먼저 매칭되므로 실제 화면에는 영향이 없다.
 */
export default async function AdminUnknownPathPage({ params }: { params: Promise<{ missing: string[] }> }) {
  const { missing } = await params;
  await requireAdminScreenAccess(`/admin/${missing.map(encodeURIComponent).join('/')}`);
  notFound();
}
