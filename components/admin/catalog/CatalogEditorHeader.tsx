import Link from 'next/link';

/**
 * 목록 → 편집으로 들어온 화면의 머리. 목록으로 돌아가는 링크는 검색·필터·페이지를
 * 그대로 품은 URL이라 편집을 마치고 돌아가면 보던 자리가 그대로다.
 */
export function CatalogEditorHeader({
  eyebrow,
  listHref,
  title,
}: {
  eyebrow: string;
  listHref: string;
  title: string;
}) {
  return (
    <div className="admin-catalog-editor-head card">
      <Link className="btn btn-sm btn-ghost" href={listHref}>
        ← 목록으로
      </Link>
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <span className="eyebrow">{eyebrow}</span>
        <strong className="admin-catalog-editor-title">{title}</strong>
      </div>
    </div>
  );
}
