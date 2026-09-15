'use client';

import { useEffect, type ReactNode } from 'react';
import { GOOD_EDITOR_SECTIONS, goodFieldSection, orderedGoodErrors } from '@/lib/admin/good-workspace';

export function focusGoodWorkspaceTarget(id: string, field?: string) {
  const section = document.getElementById(id);
  if (!section) return;
  let target: HTMLElement = section;
  if (field) {
    const named = Array.from((section.closest('form') ?? section).querySelectorAll<HTMLElement>('[name]')).filter((element) => element.getAttribute('name') === field);
    const input = named.find((element) => element.getAttribute('type') !== 'hidden' && !element.hasAttribute('disabled'));
    const artwork = named[0]?.closest('.wc-admin-artwork-upload-field');
    const upload = artwork?.querySelector<HTMLInputElement>('input[type="file"]');
    const invalid = (artwork ?? section).querySelector<HTMLElement>('input:invalid, select:invalid, textarea:invalid');
    target = input ?? invalid ?? upload ?? section.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea, button') ?? section;
  }
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    if (element instanceof HTMLDetailsElement) element.open = true;
  }
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  target.focus({ preventScroll: true });
}

export function GoodWorkspaceNavigation() {
  useEffect(() => {
    const openHash = () => {
      const id = window.location.hash.slice(1);
      if (id.startsWith('good-section-') || id.startsWith('good-operation-')) focusGoodWorkspaceTarget(id);
    };
    openHash();
    window.addEventListener('hashchange', openHash);
    return () => window.removeEventListener('hashchange', openHash);
  }, []);
  return <nav aria-label="상품 작성 섹션" className="admin-good-workspace__nav">
    {GOOD_EDITOR_SECTIONS.map((section, index) => <a key={section.key} href={`#good-section-${section.key}`} onClick={(event) => {
      event.preventDefault(); focusGoodWorkspaceTarget(`good-section-${section.key}`, section.fields[0]);
    }}>{index + 1}. {section.label}</a>)}
  </nav>;
}

export function GoodWorkspaceErrors({ errors }: { errors?: Record<string, string | undefined> }) {
  const entries = orderedGoodErrors(errors);
  if (!entries.length) return null;
  return <section aria-label="저장 오류 요약" className="admin-good-workspace__errors" role="alert" tabIndex={-1}>
    <h3>저장하지 못했습니다 · {entries.length}개 확인</h3>
    <ul>{entries.map(([field, message]) => <li key={field}><a href={`#good-section-${goodFieldSection(field).key}`} onClick={(event) => {
      event.preventDefault(); focusGoodWorkspaceTarget(`good-section-${goodFieldSection(field).key}`, field);
    }}>{message}</a></li>)}</ul>
    <p>입력값과 업로드한 이미지가 유지됩니다. 해당 항목을 수정하고 다시 저장해주세요.</p>
  </section>;
}

export function GoodOptionalFields({ title, summary, children, hasErrors = false }: { title: string; summary: string; children: ReactNode; hasErrors?: boolean }) {
  return <details className="admin-good-workspace__optional" open={hasErrors || undefined}>
    <summary>{title}<span>{summary}</span>{hasErrors ? <strong>오류 확인</strong> : null}</summary>
    <div className="col">{children}</div>
  </details>;
}

export function GoodOperationSection({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return <details id={`good-operation-${id}`} className="admin-good-workspace__operation" tabIndex={-1}>
    <summary>{title}<span>별도 저장</span></summary>
    <p>{description} 기본 상품 입력은 함께 저장되지 않습니다.</p>
    {children}
  </details>;
}
