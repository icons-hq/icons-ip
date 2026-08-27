import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /* 404·에러처럼 이 블록이 페이지 본문 전부인 표면에서는 h1 을 넘긴다.
     목록 속 빈 상태처럼 문서 구조가 이미 있는 곳은 기본 h2 로 충분하다. */
  titleAs?: 'h1' | 'h2' | 'p';
  className?: string;
}

export function EmptyState({ action, className, description, title, titleAs: TitleTag = 'h2' }: EmptyStateProps) {
  return (
    <div className={`wc-empty${className ? ` ${className}` : ''}`}>
      <TitleTag className="wc-empty__title">{title}</TitleTag>
      {description ? <p className="wc-empty__desc">{description}</p> : null}
      {action ? <div className="wc-empty__action">{action}</div> : null}
    </div>
  );
}
