import type { ComponentProps, ReactNode } from 'react';
import { TableCell, TableHeader, TableRow } from '@/components/admin/kit/ui/table';

type SectionProps = Omit<ComponentProps<'section'>, 'title' | 'children'>;

/**
 * 목록 카드(템플릿 룩, ADR-0028). 주문 목록과 같은 모양 — 흰 카드 안에 머리(제목 · (총 N건) · 동작),
 * 안내, 표·항목, 페이지 이동을 담는다. 목록을 셸 위에 바로 놓거나 점선 빈 상자로 그리지 않고 이 카드에 둔다.
 * 빈 목록은 카드 안 `CONSOLE_LIST_EMPTY_CLASS` 문구로 보인다.
 */
export function ConsoleListCard({
  actions,
  children,
  className,
  description,
  headingLevel = 2,
  title,
  total,
  unit = '건',
  ...props
}: SectionProps & {
  /** 머리 제목. 비우면 머리 줄 없이 카드만 그린다. */
  title?: ReactNode;
  /** 총 건수. 주면 제목 옆에 "(총 N건)"으로 붙는다. */
  total?: number | null;
  /** 총 건수 단위. 기본 `'건'`. */
  unit?: string;
  /** 머리 오른쪽 동작(정렬·내보내기·새로고침 등). */
  actions?: ReactNode;
  /** 머리 아래 보조 안내. */
  description?: ReactNode;
  /** 화면 머리(h2) 아래 덩어리면 3. 기본 2. */
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const head = title !== undefined || actions !== undefined;
  return (
    <section
      {...props}
      className={`${className ? `${className} ` : ''}flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground`}
      data-console-list=""
    >
      {head ? (
        <div className="flex flex-wrap items-center gap-2" data-console-list-head="">
          {title !== undefined ? (
            <Heading className="mr-auto flex flex-wrap items-baseline gap-x-1.5 text-base font-medium text-foreground">
              {title}
              {typeof total === 'number' ? (
                <span className="text-sm font-normal text-muted-foreground">
                  (총 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>{unit})
                </span>
              ) : null}
            </Heading>
          ) : null}
          {actions !== undefined ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      {children}
    </section>
  );
}

/** 목록 카드 안 빈 상태 문구(카드 안 가운데, 점선 상자 없이). */
export const CONSOLE_LIST_EMPTY_CLASS = 'py-10 text-center text-sm text-muted-foreground';

/**
 * kit 표 바깥 상자(ConsoleGrid와 같은 테두리·가로 스크롤·포커스). `role="region"`·tabIndex 0과 함께 쓴다.
 * 크기 질의 컨테이너라 빈 행(ConsoleTableEmptyRow)의 문구가 보이는 폭 가운데에 선다.
 */
export const CONSOLE_TABLE_FRAME_CLASS = '@container relative min-w-0 overflow-x-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * kit 표의 빈 행. 표가 보이는 폭보다 넓어도(좁은 화면) 문구는 보이는 폭 가운데에 남는다 — ConsoleGrid와 같다.
 * 스크롤하는 표 상자가 `@container`(CONSOLE_TABLE_FRAME_CLASS)여야 한다.
 */
export function ConsoleTableEmptyRow({ children, colSpan }: { children: ReactNode; colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="h-24 p-0 text-center align-middle whitespace-normal text-muted-foreground" colSpan={colSpan}>
        <div className="sticky left-0 flex h-24 w-[100cqw] items-center justify-center px-4">{children}</div>
      </TableCell>
    </TableRow>
  );
}

/**
 * kit 표를 직접 그리는 목록의 머리 — ConsoleGrid와 같은 회색 바탕·작은 흐린 글자다. 머리 칸(th)의 바탕·글자만
 * 맞추고 칸 여백은 화면의 본문 칸과 짝을 유지한다.
 */
export function ConsoleTableHeader({ className, ...props }: ComponentProps<typeof TableHeader>) {
  return (
    <TableHeader
      className={`[&_th]:bg-muted [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground${className ? ` ${className}` : ''}`}
      {...props}
    />
  );
}
