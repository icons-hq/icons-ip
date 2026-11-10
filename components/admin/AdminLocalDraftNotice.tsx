import { buttonVariants } from '@/components/admin/kit/ui/button';
import { AdminSectionCard } from './console/AdminKit';

/** 로컬 자동저장 복구 안내(템플릿 룩, ADR-0028). 복구·버리기 동작과 문구는 그대로다. */
export function AdminLocalDraftNotice({ recovery, unavailable = false, pending, onRestore, onDiscard }: {
  recovery: boolean;
  unavailable?: boolean;
  pending: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (unavailable) return <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm" role="status">
    이 브라우저에서 입력을 자동 저장할 수 없습니다. 이동하기 전에 저장해 주세요.
  </div>;
  if (!recovery) return null;
  return <AdminSectionCard title="저장되지 않은 입력 복구">
    <p className="text-sm text-muted-foreground" role="status">이 브라우저에 최대 7일 동안 보관된 입력이 있습니다. 복구한 뒤 저장해 주세요.</p>
    <div className="flex flex-wrap gap-2">
      <button className={buttonVariants({ size: 'sm' })} data-slot="button" disabled={pending} onClick={onRestore} type="button">복구</button>
      <button className={buttonVariants({ size: 'sm', variant: 'outline' })} data-slot="button" disabled={pending} onClick={onDiscard} type="button">버리기</button>
    </div>
  </AdminSectionCard>;
}
