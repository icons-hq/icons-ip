import type { ReactNode } from 'react';
import { Badge } from '@/components/admin/kit/ui/badge';

/*
 * 운영 화면의 골격 부품 — 템플릿 룩(ADR-0028). API는 그대로이고 모양은 kit Card·Badge·Field와 같은 클래스다.
 * 옛 클래스 이름(wc-admin-kit__*)은 화면 고유 CSS가 닿지 않도록 쓰지 않는다.
 */

/** 화면 머리(제목·설명·동작). 셸의 h1 아래에서 h2로 선다. */
export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-3" data-admin-kit="page-header">
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="text-lg leading-tight font-semibold tracking-tight text-foreground">{title}</h2>
      {description ? <p className="max-w-prose text-sm text-muted-foreground">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </header>;
}

/** 입력 묶음 카드(kit Card). 상태 배지는 오류 수를 우선한다. */
export function AdminSectionCard({ title, children, id, summary, requirement, status, errorCount = 0 }: {
  title: string; children: ReactNode; id?: string; summary?: ReactNode;
  requirement?: string; status?: string; errorCount?: number;
}) {
  return <section
    aria-label={title}
    className="flex min-w-0 scroll-mt-16 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
    data-admin-kit="section"
    id={id}
    tabIndex={id ? -1 : undefined}
  >
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base leading-snug font-medium text-foreground">{title}</h3>
        {requirement ? <span className="text-xs text-muted-foreground">{requirement}</span> : null}
        {status ? <AdminStatusBadge tone={errorCount ? 'danger' : 'neutral'}>{errorCount ? `오류 ${errorCount}개` : status}</AdminStatusBadge> : null}
      </div>
      {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
    </header>
    {children}
  </section>;
}

export function AdminFormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(16rem,calc((100%-1.5rem)/2))),1fr))]" data-admin-kit="form-grid">{children}</div>;
}

/** Inputs use `${inputId}-hint` / `${inputId}-error` for aria-describedby. */
export function AdminField({ label, inputId, hint, error, children }: { label: string; inputId: string; hint?: string; error?: string; children: ReactNode }) {
  return <div className="group/field flex min-w-0 flex-col gap-2 data-[invalid=true]:text-destructive" data-admin-kit="field" data-invalid={error ? 'true' : undefined}>
    <label className="text-sm leading-snug font-medium text-foreground" htmlFor={inputId}>{label}</label>
    {children}
    {hint ? <p className="text-sm leading-normal text-muted-foreground" id={`${inputId}-hint`}>{hint}</p> : null}
    {error ? <p className="text-sm text-destructive" id={`${inputId}-error`} role="alert">{error}</p> : null}
  </div>;
}

const BADGE_TONE_CLASS = {
  neutral: '',
  success: 'border-transparent bg-[color-mix(in_oklab,var(--wc-success)_12%,transparent)] text-[var(--wc-success)]',
  warning: 'border-transparent bg-[color-mix(in_oklab,var(--wc-warning)_12%,transparent)] text-[var(--wc-warning)]',
  danger: '',
} as const;

export function AdminStatusBadge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return <Badge className={BADGE_TONE_CLASS[tone]} data-tone={tone} variant={tone === 'danger' ? 'destructive' : 'secondary'}>{children}</Badge>;
}

/** An in-flow, non-modal context panel; the owning screen supplies its close link. */
export function AdminSidePanel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return <aside aria-label={title} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground" data-admin-kit="side-panel">
    <header className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-foreground">{title}</h2>{actions}</header>{children}
  </aside>;
}
