'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

/**
 * 표 머리글 고정(ADM-009).
 *
 * 표는 가로 스크롤 영역(overflow-x-auto) 안에 있어서 `thead`에 `position: sticky`를 줘도 페이지 스크롤에는
 * 붙지 않는다(가로 스크롤 영역이 세로 스크롤 기준이 된다). 그래서 머리글을 한 벌 더 그린다.
 * 복제 머리글은 `position: fixed`로 상단 막대(48px) 바로 아래에 얹고, 진짜 머리글이 막대 밑으로 지나갔고
 * 표가 아직 끝나지 않았을 때만 보인다. 가로 스크롤은 진짜 스크롤 영역과 맞추고, 열 너비는 진짜 머리글 칸의
 * 실측 너비를 그대로 쓴다. 고정 열(`data-frozen` sticky left)은 복제 영역 안에서도 같은 자리에 남는다.
 */
export const ADMIN_TOP_BAR_OFFSET = 48;

interface StickyHeadMetrics {
  stuck: boolean;
  left: number;
  width: number;
  /** 스크롤 영역 테두리 두께(0이면 테두리 없는 표). */
  border: number;
  /** 진짜 머리글 칸의 실측 너비(복제 colgroup용). */
  columns: number[];
  tableWidth: number;
}

const INITIAL: StickyHeadMetrics = { stuck: false, left: 0, width: 0, border: 0, columns: [], tableWidth: 0 };

function sameMetrics(a: StickyHeadMetrics, b: StickyHeadMetrics) {
  return a.stuck === b.stuck && a.left === b.left && a.width === b.width && a.border === b.border && a.tableWidth === b.tableWidth
    && a.columns.length === b.columns.length && a.columns.every((value, index) => value === b.columns[index]);
}

export function useStickyTableHead(scrollRef: RefObject<HTMLElement | null>, tableRef: RefObject<HTMLTableElement | null>, enabled = true) {
  const [metrics, setMetrics] = useState<StickyHeadMetrics>(INITIAL);
  const cloneScrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const region = scrollRef.current;
    const table = tableRef.current;
    if (!enabled || !region || !table) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const head = table.tHead;
      if (!head) return;
      const headRect = head.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const regionRect = region.getBoundingClientRect();
      const stuck = headRect.height > 0 && headRect.top < ADMIN_TOP_BAR_OFFSET - 0.5 && tableRect.bottom > ADMIN_TOP_BAR_OFFSET + headRect.height;
      const next: StickyHeadMetrics = {
        stuck,
        left: Math.round(regionRect.left * 100) / 100,
        width: Math.round(regionRect.width * 100) / 100,
        border: region.clientLeft,
        columns: Array.from(head.rows[0]?.cells ?? []).map((cell) => cell.getBoundingClientRect().width),
        tableWidth: tableRect.width,
      };
      setMetrics((previous) => (sameMetrics(previous, next) ? previous : next));
      if (cloneScrollRef.current) cloneScrollRef.current.scrollLeft = region.scrollLeft;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const onRegionScroll = () => { if (cloneScrollRef.current) cloneScrollRef.current.scrollLeft = region.scrollLeft; };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    region.addEventListener('scroll', onRegionScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(region);
    observer?.observe(table);
    for (const cell of Array.from(table.tHead?.rows[0]?.cells ?? [])) observer?.observe(cell);
    /* 머리글 칸이 늘거나 줄면(조회항목 설정) 관찰 대상을 다시 잡는다. */
    const mutations = typeof MutationObserver === 'undefined' || !table.tHead ? null : new MutationObserver(() => {
      observer?.disconnect();
      observer?.observe(region);
      observer?.observe(table);
      for (const cell of Array.from(table.tHead?.rows[0]?.cells ?? [])) observer?.observe(cell);
      schedule();
    });
    if (table.tHead) mutations?.observe(table.tHead, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      region.removeEventListener('scroll', onRegionScroll);
      observer?.disconnect();
      mutations?.disconnect();
    };
  }, [enabled, scrollRef, tableRef]);

  return { cloneScrollRef, metrics };
}

/** 가로 스크롤 영역 오른쪽 끝 휠을 복제 머리글 위에서도 받는다(트랙패드 가로 스와이프). */
function forwardWheel(region: HTMLElement | null, event: { deltaX: number }) {
  if (region && event.deltaX) region.scrollLeft += event.deltaX;
}

/**
 * 복제 머리글 한 벌. `children`은 `<thead>` 안에 들어갈 행이다(진짜 머리글과 같은 마크업을 한 번 더 그린다).
 * 보조기기에는 진짜 머리글만 보이게 `aria-hidden`이고, 복제 안의 입력·링크는 Tab 순서에서 빠진다.
 */
export function StickyTableHead({
  children,
  className,
  headHtml,
  metrics,
  cloneScrollRef,
  scrollRef,
  tableClassName,
  tableStyle,
}: {
  children?: ReactNode;
  className?: string;
  /** 진짜 `thead`의 HTML 복사본(`useClonedHeadHtml`). 주면 `children` 대신 쓴다. */
  headHtml?: string;
  metrics: StickyHeadMetrics;
  cloneScrollRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  tableClassName?: string;
  tableStyle?: CSSProperties;
}) {
  const headRef = useRef<HTMLTableSectionElement>(null);

  /* 복제가 보이는 동안 안의 포커스 가능한 요소는 Tab 순서에서 뺀다(진짜 머리글이 순서를 가진다). */
  useEffect(() => {
    const head = headRef.current;
    if (!head?.querySelectorAll || typeof MutationObserver === 'undefined') return;
    const strip = () => {
      for (const element of Array.from(head.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'))) {
        if (element.getAttribute('tabindex') !== '-1') element.setAttribute('tabindex', '-1');
      }
    };
    strip();
    const observer = new MutationObserver(strip);
    observer.observe(head, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [metrics.stuck]);

  /* 고정될 때만 마운트한다(SSR·평소에는 DOM에 없다). 나타나는 순간 진짜 스크롤 위치에 맞춘다. */
  useLayoutEffect(() => {
    if (metrics.stuck && cloneScrollRef.current && scrollRef.current) cloneScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
  }, [metrics.stuck, cloneScrollRef, scrollRef]);

  if (!metrics.stuck) return null;
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed z-20 print:hidden${className ? ` ${className}` : ''}`}
      data-sticky-head=""
      style={{ top: ADMIN_TOP_BAR_OFFSET, left: metrics.left, width: metrics.width }}
    >
      <div
        className={`pointer-events-auto overflow-hidden bg-muted shadow-sm${metrics.border ? ' rounded-t-lg' : ''}`}
        onWheel={(event) => forwardWheel(scrollRef.current, event)}
        ref={cloneScrollRef}
        style={metrics.border ? { borderInline: `${metrics.border}px solid var(--border)`, borderTop: `${metrics.border}px solid var(--border)` } : undefined}
      >
        <table
          className={tableClassName ?? 'w-full caption-bottom text-sm'}
          data-slot="table"
          style={{ ...tableStyle, tableLayout: 'fixed', width: metrics.tableWidth || undefined }}
        >
          {metrics.columns.length ? (
            <colgroup>
              {metrics.columns.map((width, index) => <col key={index} style={{ width }} />)}
            </colgroup>
          ) : null}
          {headHtml !== undefined
            ? <thead dangerouslySetInnerHTML={{ __html: headHtml }} data-slot="table-header" ref={headRef} />
            : <thead data-slot="table-header" ref={headRef}>{children}</thead>}
        </table>
      </div>
    </div>
  );
}

/**
 * 머리글 마크업을 React로 다시 그리기 어려운 표(kit `Table`을 그대로 쓰는 화면)용. 진짜 `thead`의 HTML을 복사해 쓴다.
 * 머리글이 글자뿐인 표에만 쓴다 — 복사본은 이벤트가 없다.
 */
export function useClonedHeadHtml(tableRef: RefObject<HTMLTableElement | null>, enabled = true) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    const table = tableRef.current;
    if (!enabled || !table?.tHead) return;
    const read = () => setHtml((previous) => (previous === table.tHead?.innerHTML ? previous : table.tHead?.innerHTML ?? ''));
    read();
    const observer = new MutationObserver(read);
    observer.observe(table.tHead, { childList: true, subtree: true, characterData: true, attributes: true });
    return () => observer.disconnect();
  }, [enabled, tableRef]);
  return html;
}
