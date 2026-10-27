'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { GOOD_EDITOR_SECTIONS, goodFieldSection, orderedGoodErrors } from '@/lib/admin/good-workspace';

export function focusGoodWorkspaceTarget(id: string, field?: string) {
  const section = document.getElementById(id);
  if (!section) return;
  let target: HTMLElement = section;
  if (field) {
    const named = Array.from((section.closest('form') ?? section).querySelectorAll<HTMLElement>('[name]')).filter((element) => element.getAttribute('name') === field);
    const input = named.find((element) => element.getAttribute('type') !== 'hidden' && !element.hasAttribute('disabled') && !element.closest('[hidden]'));
    const artwork = named[0]?.closest('.wc-admin-artwork-upload-field');
    const upload = artwork?.querySelector<HTMLInputElement>('input[type="file"]');
    const invalid = (artwork ?? section).querySelector<HTMLElement>('input:invalid, select:invalid, textarea:invalid');
    target = input ?? invalid ?? upload
      ?? section.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]):not([hidden]), textarea:not([disabled])')
      ?? section.querySelector<HTMLElement>('button:not([disabled])') ?? section;
  }
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    if (element instanceof HTMLDetailsElement) element.open = true;
  }
  // 입력칸은 가운데로, 영역 자체(긴 KC 패널 등)는 머리(상태·주요 버튼)가 보이게 위쪽에 맞춘다.
  target.scrollIntoView({ block: target === section ? 'start' : 'center', behavior: 'instant' });
  target.focus({ preventScroll: true });
}

/**
 * 서버 검증에 실패한 저장 시도마다 한 번, 첫 오류 필드로 스크롤·포커스한다(10/14 회의 A12).
 * 상단 오류 요약의 링크는 그대로 두고, 어느 섹션에도 속하지 않는 오류(form 등)만 있으면 요약으로 간다.
 */
export function useFocusFirstGoodError(attempt: number | undefined, errors?: Record<string, string | undefined>) {
  const handled = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (attempt === undefined || handled.current === attempt) return;
    handled.current = attempt;
    const entries = orderedGoodErrors(errors);
    if (!entries.length) return;
    const field = entries.find(([name]) => GOOD_EDITOR_SECTIONS.some(section => (section.fields as readonly string[]).includes(name)))?.[0];
    if (field) focusGoodWorkspaceTarget(`good-section-${goodFieldSection(field).key}`, field);
    else document.querySelector<HTMLElement>('.admin-good-workspace__errors')?.focus();
  }, [attempt, errors]);
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

/** Native details keep every named input mounted when a section is folded. */
export function GoodEditorSection({ id, title, requirement, status, summary, errorCount = 0, children, defaultOpen = true }: {
  id?: string; title: string; requirement?: string; status?: string; summary?: string; errorCount?: number; children: ReactNode; defaultOpen?: boolean;
}) {
  return <details id={id} className="admin-good-section" aria-label={title} open={defaultOpen || errorCount > 0}>
    <summary><span className="admin-good-section__title">{title}{requirement?.includes('필수') ? <span className="admin-good-section__required" aria-label="필수">*</span> : null}</span>
      <span className="admin-good-section__summary">{errorCount ? <strong>{errorCount}개 확인 필요</strong> : summary || status}</span><span className="admin-good-section__chevron" aria-hidden="true"><Icon name="chevronRight" size={17} /></span></summary>
    <div className="admin-good-section__body">{requirement ? <p className="admin-good-section__requirement">{requirement}</p> : null}{children}</div>
  </details>;
}
