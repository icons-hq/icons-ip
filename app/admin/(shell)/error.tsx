'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';

/* 화면 오류가 나도 셸(메뉴·상단 막대)은 남는다. 서버 컴포넌트 오류는 메시지가 지워지므로 콘솔에 digest를 남긴다. */
export default function AdminShellError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <AdminNotice role="alert" title="화면을 불러오지 못했습니다" tone="danger">
      <p>일시적인 오류일 수 있습니다. 다시 시도해도 같으면 잠시 뒤에 다시 열어 주세요.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={() => retry()} type="button">다시 시도</Button>
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin">홈으로 가기</Link>
      </div>
    </AdminNotice>
  );
}
