import type { ReactNode } from 'react';

/** Shared operational screen kit; console primitives keep their behavior. */
export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="wc-admin-kit wc-admin-kit__page-header">
    <div><h2 className="wc-admin-kit__heading">{title}</h2>{description ? <p className="wc-admin-kit__description">{description}</p> : null}</div>
    {actions ? <div className="wc-admin-kit__actions">{actions}</div> : null}
  </header>;
}

export function AdminSectionCard({ title, children, id, summary, requirement, status, errorCount = 0 }: {
  title: string; children: ReactNode; id?: string; summary?: ReactNode;
  requirement?: string; status?: string; errorCount?: number;
}) {
  return <section aria-label={title} id={id} tabIndex={id ? -1 : undefined} className="wc-admin-kit wc-admin-kit__card wc-admin-kit__section">
    <header><h3>{title}</h3>{requirement ? <span className="wc-admin-kit__hint">{requirement}</span> : null}
      {status ? <AdminStatusBadge tone={errorCount ? 'danger' : 'neutral'}>{errorCount ? `오류 ${errorCount}개` : status}</AdminStatusBadge> : null}
      {summary ? <p className="wc-admin-kit__hint">{summary}</p> : null}
    </header>{children}
  </section>;
}

export function AdminFormGrid({ children }: { children: ReactNode }) {
  return <div className="wc-admin-kit wc-admin-kit__form-grid">{children}</div>;
}

/** Inputs use `${inputId}-hint` / `${inputId}-error` for aria-describedby. */
export function AdminField({ label, inputId, hint, error, children }: { label: string; inputId: string; hint?: string; error?: string; children: ReactNode }) {
  return <div className="wc-admin-kit wc-admin-kit__field">
    <label className="wc-admin-kit__field-label" htmlFor={inputId}>{label}</label>
    {children}
    {hint ? <p className="wc-admin-kit__hint" id={`${inputId}-hint`}>{hint}</p> : null}
    {error ? <p className="wc-admin-kit__error" id={`${inputId}-error`} role="alert">{error}</p> : null}
  </div>;
}

export function AdminStatusBadge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return <span className="wc-admin-kit wc-admin-kit__badge" data-tone={tone}>{children}</span>;
}

/** An in-flow, non-modal context panel; the owning screen supplies its close link. */
export function AdminSidePanel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return <aside aria-label={title} className="wc-admin-kit wc-admin-kit__panel">
    <header><h2 className="wc-admin-kit__heading">{title}</h2>{actions}</header>{children}
  </aside>;
}
