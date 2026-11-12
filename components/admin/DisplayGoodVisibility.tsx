import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { DISPLAY_GOOD_VISIBILITY_LABELS, DISPLAY_GOOD_VISIBILITY_NOTES, type DisplayGoodVisibility } from '@/lib/admin/good-visibility';
import { statusTone } from '@/lib/admin/status-tone';

/** 고객 화면에 보이지 않는 이유 배지(초안·IP 초안·성인(19금)·보관됨…). 선택 창의 노출 상태 칸도 같은 배지를 쓴다 — 한 창에 같은 상태를 두 말로 부르지 않는다. */
export function DisplayGoodVisibilityBadge({ visibility }: { visibility: Exclude<DisplayGoodVisibility, 'public'> }) {
  return <AdminStatusBadge data-good-visibility={visibility} tone={statusTone('goodReference', 'notVisible')}>{DISPLAY_GOOD_VISIBILITY_LABELS[visibility]}</AdminStatusBadge>;
}

/**
 * 전시 목록(홈 전시·카테고리 전시·쇼핑스토리·캠페인 상품 묶음)에 담긴 상품이 고객 화면에 보이지 않는 이유(QA1 MD).
 * 담기는 막지 않으므로 목록에서 늘 같은 배지·문장으로 알린다. 고객 화면에 보이는 상품은 아무것도 그리지 않는다.
 */
export function DisplayGoodVisibilityNote({ visibility, compact = false }: { visibility: DisplayGoodVisibility; compact?: boolean }) {
  if (visibility === 'public') return null;
  /* 칩처럼 좁은 자리는 배지만 붙이고(문장은 그 목록 아래 한 줄로), 목록 줄에서는 배지와 이유 문장을 함께 둔다. */
  if (compact) return <span className="ml-1.5 inline-flex align-middle" title={DISPLAY_GOOD_VISIBILITY_NOTES[visibility]}><DisplayGoodVisibilityBadge visibility={visibility} /></span>;
  return <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-snug text-muted-foreground" data-good-visibility-note={visibility}>
    <DisplayGoodVisibilityBadge visibility={visibility} />{DISPLAY_GOOD_VISIBILITY_NOTES[visibility]}
  </span>;
}
