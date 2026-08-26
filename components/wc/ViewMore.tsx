'use client';

export interface ViewMoreProps {
  onClick: () => void;
  loading?: boolean;
  label?: string;
  className?: string;
}

export function ViewMore({ className, label = '더 보기', loading, onClick }: ViewMoreProps) {
  return (
    <button
      aria-busy={loading || undefined}
      className={`wc-view-more${className ? ` ${className}` : ''}`}
      disabled={loading}
      onClick={onClick}
      type="button"
    >
      {loading ? '불러오는 중…' : label}
    </button>
  );
}
