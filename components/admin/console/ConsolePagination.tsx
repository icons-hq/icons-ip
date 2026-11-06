import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buttonVariants } from '@/components/admin/kit/ui/button';

interface ConsolePaginationCommonProps {
  /** 1부터 시작하는 현재 페이지. 범위를 벗어나면 안쪽으로 보정한다. */
  page: number;
  /** 한 페이지 행 수. 서버 RPC의 `p_limit`과 같은 값이어야 한다. */
  pageSize: number;
  /** 필터 조건에 맞는 전체 건수. 서버 RPC가 돌려주는 `total`. */
  total: number;
  /** 범위 요약의 단위(건·개·장). 기본 `'건'`. */
  unit?: string;
  /** nav 접근성 이름. 기본 `'목록 페이지'`. */
  label?: string;
  className?: string;
}

/** 페이지가 URL에 실리는 목록 — 이전·다음이 링크다. */
interface ConsolePaginationLinkProps extends ConsolePaginationCommonProps {
  /** 페이지 번호로 이동할 href를 만든다. 다른 필터 조건은 호출자가 유지한다. */
  hrefForPage: (page: number) => string;
  /** next/link의 scroll. 목록이 제자리에서 바뀌는 화면(대화 목록 등)은 `false`로 스크롤을 유지한다. */
  scroll?: boolean;
  onPageChange?: never;
  disabled?: never;
}

/** 화면이 상태로 페이지를 읽는 목록(팝업·클라이언트 조회) — 이전·다음이 버튼이다. */
interface ConsolePaginationButtonProps extends ConsolePaginationCommonProps {
  hrefForPage?: never;
  scroll?: never;
  /** 이동할 페이지 번호를 받는다. 조회는 화면이 한다. */
  onPageChange: (page: number) => void;
  /** 조회 중처럼 이동을 막아야 할 때. */
  disabled?: boolean;
}

export type ConsolePaginationProps = ConsolePaginationLinkProps | ConsolePaginationButtonProps;

/**
 * 콘솔 목록 페이지네이션.
 *
 * 서버 페이지네이션(`p_limit`/`p_offset` + `total`) 전제다. 이전/다음과 함께
 * "n–m / 전체 k건"을 항상 보여준다 — 운영자가 지금 몇 번째 구간을 보고 있는지 모르면
 * 일괄 처리 범위를 잘못 판단한다. 페이지 URL 계약은 화면이 소유한다(`hrefForPage`), URL이 없는
 * 화면은 `onPageChange`로 같은 모양의 버튼을 쓴다.
 */
export function ConsolePagination(props: ConsolePaginationProps) {
  const { className, label = '목록 페이지', page, pageSize, total, unit = '건' } = props;
  const size = Math.max(1, Math.trunc(pageSize));
  const safeTotal = Math.max(0, Math.trunc(total));
  const totalPages = Math.max(1, Math.ceil(safeTotal / size));
  const current = Math.min(Math.max(1, Math.trunc(page)), totalPages);
  const first = safeTotal === 0 ? 0 : (current - 1) * size + 1;
  const last = Math.min(current * size, safeTotal);

  /* kit 표 페이지 이동(DataTablePagination)과 같은 배치: 왼쪽에 범위 요약, 오른쪽에 이전·다음. */
  const link = buttonVariants({ size: 'sm', variant: 'outline' });
  const step = (direction: 'previous' | 'next') => {
    const target = direction === 'previous' ? current - 1 : current + 1;
    const enabled = direction === 'previous' ? current > 1 : current < totalPages;
    const name = direction === 'previous' ? '이전 페이지' : '다음 페이지';
    const content = direction === 'previous'
      ? <><ChevronLeft aria-hidden="true" />이전</>
      : <>다음<ChevronRight aria-hidden="true" /></>;
    if (props.onPageChange) {
      const { onPageChange } = props;
      return <button
        aria-label={name}
        className={link}
        data-slot="button"
        disabled={props.disabled || !enabled}
        onClick={() => onPageChange(target)}
        type="button"
      >{content}</button>;
    }
    return enabled
      ? <Link aria-label={name} className={link} data-slot="button" href={props.hrefForPage(target)} scroll={props.scroll}>{content}</Link>
      : <span aria-disabled="true" className={`${link} pointer-events-none opacity-50`}>{content}</span>;
  };
  return (
    <nav
      aria-label={label}
      className={`${className ? `${className} ` : ''}flex flex-wrap items-center justify-between gap-2 px-1 text-sm`}
      data-console-pagination=""
    >
      <span aria-live="polite" className="text-muted-foreground tabular-nums">
        {first.toLocaleString('ko-KR')}–{last.toLocaleString('ko-KR')} / 전체 {safeTotal.toLocaleString('ko-KR')}{unit}
        {' · '}
        {current} / {totalPages} 페이지
      </span>
      <span className="flex items-center gap-1.5">
        {step('previous')}
        {step('next')}
      </span>
    </nav>
  );
}
