import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ action, className, description, title }: EmptyStateProps) {
  return (
    <div className={`wc-empty${className ? ` ${className}` : ''}`}>
      <p className="wc-empty__title">{title}</p>
      {description ? <p className="wc-empty__desc">{description}</p> : null}
      {action ? <div className="wc-empty__action">{action}</div> : null}
    </div>
  );
}
