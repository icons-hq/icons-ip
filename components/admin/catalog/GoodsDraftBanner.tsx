import { describeGoodsDraft, formatGoodsDraftSavedAt, type GoodsDraft } from '@/lib/admin/goods-draft';

/**
 * 임시 저장본 배너. 되살릴지 버릴지를 운영자가 정하기 전에는 새 입력을 그 자리에
 * 덮어쓰지 않는다 — 배너가 떠 있는 동안 자동 저장이 멈추는 이유다.
 */
export function GoodsDraftBanner({
  draft,
  onDiscard,
  onRestore,
}: {
  draft: GoodsDraft;
  onDiscard: () => void;
  onRestore: () => void;
}) {
  return (
    <div aria-label="임시 저장본" className="admin-draft-banner card" role="region">
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <strong style={{ fontSize: 14 }}>임시 저장본이 있습니다</strong>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {formatGoodsDraftSavedAt(draft.savedAt)} · {describeGoodsDraft(draft)} · 이미지는 저장되지 않아 다시 올려야 합니다.
          되살리거나 버리기 전에는 새 입력이 임시 저장되지 않습니다.
        </span>
      </div>
      <div className="admin-draft-banner-actions">
        <button className="btn btn-sm" onClick={onRestore} type="button">불러오기</button>
        <button className="btn btn-sm btn-ghost" onClick={onDiscard} type="button">버리기</button>
      </div>
    </div>
  );
}
