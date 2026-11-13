import { AdminNotFound } from '@/components/admin/AdminNotFound';

/* IP·콘텐츠 콘솔 안의 notFound()도 커머스 셸과 같은 어드민 문구로 답한다. 공개 404 문구는 app/not-found.tsx 그대로다. */
export default function AdminContentNotFound() {
  return <AdminNotFound />;
}
