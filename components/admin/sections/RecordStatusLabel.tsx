import { AdminStatusBadge } from '../console/AdminKit';
import type { AdminTone } from '@/lib/admin/status-tone';

/**
 * 목록 열 한 줄(RecordList의 labelFor): 이름 옆에 상태 배지를 붙인다. 이름만 줄임표로 잘리고 배지는 항상 보인다.
 * `title`은 이름과 상태를 함께 읽는 전체 문구다(줄임표로 잘린 줄의 말풍선).
 */
export function RecordStatusLabel({ name, status, tone, title }: { name: string; status?: string | null; tone?: AdminTone; title: string }) {
  return <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
    <span className="min-w-0 truncate" title={title}>{name}</span>
    {status ? <AdminStatusBadge tone={tone}>{status}</AdminStatusBadge> : null}
  </span>;
}
