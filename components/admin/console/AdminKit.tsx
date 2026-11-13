import type { ComponentProps, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/admin/kit/ui/badge';
import type { AdminTone } from '@/lib/admin/status-tone';
import { AdminPageHeading } from './admin-shell-title';

/*
 * 운영 화면의 골격 부품 — 색·위계(ADR-0029). API는 그대로이고 모양은 kit Card·Badge·Field와 같은 클래스다.
 * 옛 클래스 이름(wc-admin-kit__*)은 화면 고유 CSS가 닿지 않도록 쓰지 않는다.
 */

/** 화면 머리(제목·설명·동작). 셸의 h1 아래에서 h2로 선다 — 셸 제목과 같으면 h2는 화면에서 감춘다. */
export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-3" data-admin-kit="page-header">
    <div className="flex min-w-0 flex-col gap-1">
      <AdminPageHeading title={title} />
      {description ? <p className="max-w-3xl text-sm text-pretty text-muted-foreground">{description}</p> : null}
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
        <h2 className="text-base leading-snug font-semibold text-foreground">{title}</h2>
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

/* 같은 상태는 모든 화면에서 같은 색이다 — 상태→tone은 lib/admin/status-tone 한 곳에서 정하고, 여기서 색으로 바꾼다. */
const BADGE_VARIANT = { neutral: 'secondary', info: 'info', success: 'success', warning: 'warning', danger: 'destructive' } as const;
/* 점은 ::before로 그려 배지 글자가 첫 텍스트로 남는다(스크린리더·테스트의 글자 읽기 순서). */
const BADGE_DOT = {
  neutral: 'before:bg-muted-foreground',
  info: 'before:bg-info',
  success: 'before:bg-success',
  warning: 'before:bg-warning',
  danger: 'before:bg-destructive',
} as const;

/** 상태 배지. 색만으로 뜻을 전하지 않도록 글자(children)가 항상 상태 이름을 말한다. */
export function AdminStatusBadge({ tone = 'neutral', children, className, ...props }: { tone?: AdminTone; children: ReactNode } & Omit<ComponentProps<typeof Badge>, 'variant' | 'children'>) {
  return <Badge className={`before:size-1.5 before:shrink-0 before:rounded-full before:content-[''] ${BADGE_DOT[tone]}${className ? ` ${className}` : ''}`} data-tone={tone} variant={BADGE_VARIANT[tone]} {...props}>
    {children}
  </Badge>;
}

const NOTICE_TONE: Record<AdminTone, { box: string; icon: LucideIcon }> = {
  neutral: { box: 'border-border bg-muted text-secondary-foreground', icon: Info },
  info: { box: 'border-info-border bg-info-soft text-info', icon: Info },
  success: { box: 'border-success-border bg-success-soft text-success', icon: CheckCircle2 },
  warning: { box: 'border-warning-border bg-warning-soft text-warning', icon: AlertTriangle },
  danger: { box: 'border-danger-border bg-danger-soft text-destructive', icon: OctagonAlert },
};

/** 안내·주의·위험 상자. 색 + 아이콘 + 글자로 말한다(ADR-0029). 화면 전용 색 클래스 대신 이 상자를 쓴다. */
export function AdminNotice({ tone = 'info', title, children, className, role, icon }: {
  tone?: AdminTone; title?: ReactNode; children?: ReactNode; className?: string;
  role?: ComponentProps<'div'>['role']; icon?: LucideIcon;
}) {
  const { box, icon: ToneIcon } = NOTICE_TONE[tone];
  const Icon = icon ?? ToneIcon;
  return <div className={`flex min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${box}${className ? ` ${className}` : ''}`} data-admin-notice={tone} role={role}>
    <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    <div className="flex min-w-0 flex-col gap-1">
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className="text-foreground">{children}</div> : null}
    </div>
  </div>;
}

/** An in-flow, non-modal context panel; the owning screen supplies its close link. */
export function AdminSidePanel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return <aside aria-label={title} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground" data-admin-kit="side-panel">
    <header className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-foreground">{title}</h2>{actions}</header>{children}
  </aside>;
}
