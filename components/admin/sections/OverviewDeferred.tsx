import { Suspense, use, type ReactNode } from 'react';

/** 아직 오는 중일 수 있는 값. 홈 전체가 기다리지 않게 Promise째 넘긴다. */
export type OverviewLoadable<T> = T | Promise<T>;

function Resolved<T>({ value, children }: { value: Promise<T>; children: (ready: T) => ReactNode }) {
  return children(use(value));
}

/** 값이 오기 전에는 이 칸만 fallback을 보이고 나머지 홈은 먼저 그린다. 이미 있는 값은 바로 그린다. */
export function OverviewDeferred<T>({ value, fallback, children }: {
  value: OverviewLoadable<T>; fallback: ReactNode; children: (ready: T) => ReactNode;
}) {
  if (!(value instanceof Promise)) return children(value);
  return <Suspense fallback={fallback}><Resolved value={value}>{children}</Resolved></Suspense>;
}

/** 숫자 자리 표시(글자 줄 안에 들어간다). 없음·실패와 다르게 아직 집계 중임을 보인다. */
export function OverviewPendingValue({ className = 'h-6 w-14' }: { className?: string }) {
  return <span aria-label="집계 중" className={`inline-block animate-pulse rounded-md bg-muted align-middle ${className}`} role="img" />;
}
