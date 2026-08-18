import Link from 'next/link';

export interface ConsolePaginationProps {
  /** 1부터 시작하는 현재 페이지. 범위를 벗어나면 안쪽으로 보정한다. */
  page: number;
  /** 한 페이지 행 수. 서버 RPC의 `p_limit`과 같은 값이어야 한다. */
  pageSize: number;
  /** 필터 조건에 맞는 전체 건수. 서버 RPC가 돌려주는 `total`. */
  total: number;
  /** 페이지 번호로 이동할 href를 만든다. 다른 필터 조건은 호출자가 유지한다. */
  hrefForPage: (page: number) => string;
  /** nav 접근성 이름. 기본 `'목록 페이지'`. */
  label?: string;
  className?: string;
}

/**
 * 콘솔 목록 페이지네이션.
 *
 * 서버 페이지네이션(`p_limit`/`p_offset` + `total`) 전제다. 이전/다음 링크와 함께
 * "n–m / 전체 k건"을 항상 보여준다 — 운영자가 지금 몇 번째 구간을 보고 있는지 모르면
 * 일괄 처리 범위를 잘못 판단한다.
 */
export function ConsolePagination({
  className,
  hrefForPage,
  label = '목록 페이지',
  page,
  pageSize,
  total,
}: ConsolePaginationProps) {
  const size = Math.max(1, Math.trunc(pageSize));
  const safeTotal = Math.max(0, Math.trunc(total));
  const totalPages = Math.max(1, Math.ceil(safeTotal / size));
  const current = Math.min(Math.max(1, Math.trunc(page)), totalPages);
  const first = safeTotal === 0 ? 0 : (current - 1) * size + 1;
  const last = Math.min(current * size, safeTotal);

  return (
    <nav
      aria-label={label}
      className={`${className ? `${className} ` : ''}admin-console-pagination`}
    >
      {current > 1 ? (
        <Link
          aria-label="이전 페이지"
          className="btn btn-sm btn-ghost"
          href={hrefForPage(current - 1)}
        >
          이전
        </Link>
      ) : <span />}
      <span aria-live="polite" className="admin-console-pagination-summary">
        {first.toLocaleString('ko-KR')}–{last.toLocaleString('ko-KR')} / 전체 {safeTotal.toLocaleString('ko-KR')}건
        {' · '}
        {current} / {totalPages} 페이지
      </span>
      {current < totalPages ? (
        <Link
          aria-label="다음 페이지"
          className="btn btn-sm btn-ghost"
          href={hrefForPage(current + 1)}
        >
          다음
        </Link>
      ) : <span />}
    </nav>
  );
}
