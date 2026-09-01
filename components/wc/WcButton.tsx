import Link from 'next/link';
import type { ReactNode } from 'react';

export interface WcButtonProps {
  variant?: 'outline' | 'primary' | 'accent';
  href?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export function WcButton({
  children,
  className,
  disabled,
  href,
  onClick,
  type = 'button',
  variant = 'outline',
}: WcButtonProps) {
  const classes = `wc-btn${variant !== 'outline' ? ` ${variant}` : ''}${href && disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`;

  /* 링크에는 disabled 속성이 없다. <a>로 남기면 회색으로 보여도 키보드와 스크린리더는
     그대로 따라갈 수 있어, 비활성 링크는 span으로 강등하고 상태는 aria-disabled로만 알린다. */
  if (href && disabled) {
    return <span aria-disabled="true" className={classes}>{children}</span>;
  }

  if (href) {
    return <Link className={classes} href={href} onClick={onClick}>{children}</Link>;
  }

  return (
    <button className={classes} disabled={disabled} onClick={onClick} type={type}>
      {children}
    </button>
  );
}
