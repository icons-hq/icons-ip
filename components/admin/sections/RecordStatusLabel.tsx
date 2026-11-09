import { AdminStatusBadge } from '../console/AdminKit';
import type { AdminTone } from '@/lib/admin/status-tone';

/**
 * 목록 열 한 줄(RecordList의 labelFor): 이름 옆에 상태 배지를 붙인다. 이름은 두 줄까지 보여 비슷한 항목을 가려낼 수 있고 배지는 항상 보인다.
 * `detail`은 이름 아래 보조 줄(등급·연결 대상 등), `title`은 이름과 상태를 함께 읽는 전체 문구다(잘린 줄의 말풍선).
 */
export function RecordStatusLabel({ detail, name, status, tone, title }: { detail?: string | null; name: string; status?: string | null; tone?: AdminTone; title: string }) {
  return <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
    <span className="flex min-w-0 flex-col gap-0.5" title={title}>
      <span className="line-clamp-2 leading-snug">{name}</span>
      {detail ? <span className="truncate text-xs font-normal text-muted-foreground">{detail}</span> : null}
    </span>
    {status ? <AdminStatusBadge className="shrink-0" tone={tone}>{status}</AdminStatusBadge> : null}
  </span>;
}
