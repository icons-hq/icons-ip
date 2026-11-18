'use client';

import Link from 'next/link';
import { ADMIN_CONSOLE_HREF, ADMIN_CONSOLE_LABEL } from '@/lib/routes';
import { useAdminConsoleVisible } from './StaffPreviewAvailability';

/* 관리자 페이지 바로가기 — 유틸 메뉴(데스크톱)·전체 메뉴 시트(모바일)·푸터 스태프 블록이 같은 링크를 쓴다.
   노출 판정은 소비처가 useAdminConsoleVisible 로 하고(감싸는 마크업까지 함께 숨겨야 하므로), 링크 자체는 여기 하나다.
   어드민은 무거운 동적 작업대라 화면에 보일 때 미리 받지 않는다(prefetch={false} — hover 때만 받는다). */
export function AdminConsoleLink({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  return (
    <Link className={className} href={ADMIN_CONSOLE_HREF} onClick={onNavigate} prefetch={false}>
      {ADMIN_CONSOLE_LABEL}
    </Link>
  );
}

export { useAdminConsoleVisible };
