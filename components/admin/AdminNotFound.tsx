import Link from 'next/link';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';

/*
 * 어드민 셸 안에서 notFound()가 난 화면(QA 라운드 1 m6). 화면 권한 판정(requireAdminScreenAccess)도 권한이 없으면
 * notFound()로 답하므로, 주소 문제와 권한 문제를 함께 알린다 — 물류출고관리 계정이 열 수 없는 주소에 들어오면
 * '주소가 바뀌었거나 삭제된 페이지'라고만 보여 권한 문제인 줄 알 수 없었다. 어느 쪽인지는 밝히지 않는다(화면 존재를 확인해 주지 않는다).
 * 스태프가 아닌 계정은 셸 레이아웃이 먼저 notFound()를 내 공개 404를 그대로 본다.
 */
export function AdminNotFound() {
  return (
    <AdminNotice role="status" title="이 화면을 열 수 없습니다" tone="warning">
      <p>주소가 바뀌었거나 없는 화면이거나, 지금 계정의 권한으로는 열 수 없는 화면입니다. 필요한 권한은 계정 주매니저에게 요청해 주세요.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin">어드민 홈으로</Link>
      </div>
    </AdminNotice>
  );
}
