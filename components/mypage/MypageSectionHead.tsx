import Link from 'next/link';

/*
 * 대시보드 블록 머리 (11 §5.1 콘텐츠 섹션 헤더) — 제목 17/700 + 건수, 오른쪽 '더보기 ›', 아래 2px 잉크 선.
 * '더보기'가 블록마다 하나씩이라 접근 이름에 블록 제목을 숨겨 붙인다 — 링크 목록에서 목적지가 갈린다(WCAG 2.4.4).
 */
export function MypageSectionHead({
  count,
  href,
  id,
  title,
}: {
  count?: number;
  href?: string;
  id: string;
  title: string;
}) {
  return (
    <div className="wc-mydash__head">
      <h2 className="wc-mydash__title" id={id}>
        {title}
        {typeof count === 'number' ? <span className="wc-mydash__count"> ({count.toLocaleString('ko-KR')})</span> : null}
      </h2>
      {href ? (
        <Link className="wc-mydash__more" href={href}>
          더보기<span className="wc-sr-only"> {title}</span>
          <span aria-hidden> ›</span>
        </Link>
      ) : null}
    </div>
  );
}
