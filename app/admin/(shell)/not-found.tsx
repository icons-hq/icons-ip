import { AdminNotFound } from '@/components/admin/AdminNotFound';

/* 커머스 셸 안의 notFound()(없는 주문·권한 없는 화면)는 셸(메뉴·상단 막대)을 남긴 채 어드민 문구로 답한다. 공개 404 문구는 app/not-found.tsx 그대로다. */
export default function AdminShellNotFound() {
  return <AdminNotFound />;
}
