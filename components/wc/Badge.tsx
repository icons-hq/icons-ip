import type { ReactNode } from 'react';

export interface BadgeProps {
  variant?: 'tint' | 'outline';
  children: ReactNode;
  className?: string;
}

export function Badge({ children, className, variant = 'tint' }: BadgeProps) {
  const classes = `wc-badge${variant !== 'tint' ? ` ${variant}` : ''}${className ? ` ${className}` : ''}`;

  return <span className={classes}>{children}</span>;
}
