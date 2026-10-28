'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction, type SyntheticEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { GOOD_EDITOR_SECTIONS, goodFieldSection, orderedGoodErrors } from '@/lib/admin/good-workspace';
import { EMPTY_GOOD_WORKSPACE_SECTIONS, GOOD_WORKSPACE_ERROR_SECTIONS, type GoodWorkspaceErrorField, type GoodWorkspaceSectionsDraft } from '@/lib/admin/good-workspace-sections';
import { initialGoodsOptionRows, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';

/*
 * 상품 작성 화면의 키 밖 상태(10/27 회의 R13·R14).
 *
 * 기본 상품 폼은 저장 시도마다 다시 마운트된다(lib/admin/form-state.ts). 섹션 펼침 상태, 등록 화면의
 * KC·예약판매 입력, 원자 저장 작업 ID는 그 폼 바깥의 이 provider가 지켜 저장 실패·성공 뒤에도 남긴다.
 * 펼침 상태와 입력 상태를 다른 context로 나눠, 옵션 입력이 바뀔 때 모든 섹션이 다시 그려지지 않게 한다.
 */
interface OpenStateContext { open: Record<string, boolean>; setOpen: (id: string, open: boolean) => void }
interface SectionsContext {
  sections: GoodWorkspaceSectionsDraft;
  setSections: Dispatch<SetStateAction<GoodWorkspaceSectionsDraft>>;
  /** 기본 폼의 현재 옵션 행. KC 적용 옵션·예약 대상 옵션을 고르는 데 쓴다. */
  optionRows: GoodsOptionRow[];
  publishOptionRows: (rows: GoodsOptionRow[]) => void;
  /** 저장 시도의 클라이언트 검증 오류(서버 오류는 액션 상태가 싣는다). */
  sectionErrors: Partial<Record<GoodWorkspaceErrorField, string>>;
  setSectionErrors: (errors: Partial<Record<GoodWorkspaceErrorField, string>>) => void;
  /** 등록 화면 원자 저장의 작업 ID. 성공할 때까지 같은 값을 써 재시도가 상품을 두 번 만들지 않는다. */
  operationId: () => string;
}
const OpenState = createContext<OpenStateContext | null>(null);
const Sections = createContext<SectionsContext | null>(null);

export function GoodWorkspaceProvider({ completedKey = null, children }: { completedKey?: string | null; children: ReactNode }) {
  const [open, setOpenState] = useState<Record<string, boolean>>({});
  const setOpen = useCallback((id: string, value: boolean) => {
    setOpenState((current) => current[id] === value ? current : { ...current, [id]: value });
  }, []);
  const [sections, setSections] = useState<GoodWorkspaceSectionsDraft>(EMPTY_GOOD_WORKSPACE_SECTIONS);
  const [optionRows, setOptionRows] = useState<GoodsOptionRow[]>(() => initialGoodsOptionRows([], 0));
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<GoodWorkspaceErrorField, string>>>({});
  const [seenCompleted, setSeenCompleted] = useState(completedKey);
  if (seenCompleted !== completedKey) {
    /* 저장에 성공하면 섹션 입력은 서버에 들어갔다. 같은 자리의 독립 패널이 저장값을 다시 읽는다. */
    setSeenCompleted(completedKey);
    if (completedKey) { setSections(EMPTY_GOOD_WORKSPACE_SECTIONS); setSectionErrors({}); }
  }
  const operation = useRef<string | null>(null);
  useEffect(() => { if (completedKey) operation.current = null; }, [completedKey]);
  const operationId = useCallback(() => (operation.current ??= crypto.randomUUID()), []);
  const publishOptionRows = useCallback((rows: GoodsOptionRow[]) => {
    setOptionRows((current) => JSON.stringify(current) === JSON.stringify(rows) ? current : rows);
  }, []);
  const openValue = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  const sectionsValue = useMemo(() => ({ sections, setSections, optionRows, publishOptionRows, sectionErrors, setSectionErrors, operationId }),
    [sections, optionRows, publishOptionRows, sectionErrors, operationId]);
  return <OpenState.Provider value={openValue}><Sections.Provider value={sectionsValue}>{children}</Sections.Provider></OpenState.Provider>;
}

/** 등록 화면 섹션 상태. provider 밖(다른 화면·테스트)에서는 null이다. */
export function useGoodWorkspaceSections() { return useContext(Sections); }

/** 펼침 상태를 키 밖 상태에 맞추고, 사용자가 바꾼 것만 기록한다(마운트 때 React가 여는 것은 기록하지 않는다). */
function useSectionOpen(id: string | undefined, fallback: boolean, forced: boolean) {
  const context = useContext(OpenState);
  const stored = id ? context?.open[id] : undefined;
  const open = forced || (stored ?? fallback);
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const next = event.currentTarget.open;
    if (id && next !== open) context?.setOpen(id, next);
  };
  return { open, onToggle };
}

const operationTarget = (field: string) => (GOOD_WORKSPACE_ERROR_SECTIONS as Record<string, string>)[field];
function errorTarget(field: string) {
  const operation = operationTarget(field);
  return operation ? { id: `good-operation-${operation}`, field: undefined } : { id: `good-section-${goodFieldSection(field).key}`, field };
}

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
    const field = entries.find(([name]) => operationTarget(name) || GOOD_EDITOR_SECTIONS.some(section => (section.fields as readonly string[]).includes(name)))?.[0];
    if (field) { const target = errorTarget(field); focusGoodWorkspaceTarget(target.id, target.field); }
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
    <ul>{entries.map(([field, message]) => { const target = errorTarget(field); return <li key={field}><a href={`#${target.id}`} onClick={(event) => {
      event.preventDefault(); focusGoodWorkspaceTarget(target.id, target.field);
    }}>{message}</a></li>; })}</ul>
    <p>입력값과 업로드한 이미지가 유지됩니다. 해당 항목을 수정하고 다시 저장해주세요.</p>
  </section>;
}

export function GoodOptionalFields({ title, summary, children, hasErrors = false }: { title: string; summary: string; children: ReactNode; hasErrors?: boolean }) {
  return <details className="admin-good-workspace__optional" open={hasErrors || undefined}>
    <summary>{title}<span>{summary}</span>{hasErrors ? <strong>오류 확인</strong> : null}</summary>
    <div className="col">{children}</div>
  </details>;
}

export const GOOD_OPERATION_PLACEHOLDER_COPY = '상품을 저장하면 이 자리에서 바로 입력할 수 있습니다.';
export const GOOD_UNSAVED_BASE_COPY = '위 기본 정보에 저장하지 않은 변경이 있습니다. 먼저 저장하세요.';

/** 고정 저장 영역의 저장하기 버튼으로 포커스를 옮긴다(Enter로 바로 저장할 수 있게). */
export function focusGoodWorkspaceSave() {
  const button = document.querySelector<HTMLButtonElement>('.admin-good-workspace__save button[name="intent"][value="save"]');
  if (!button) return;
  button.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  button.focus({ preventScroll: true });
}

/**
 * 운영 패널이 기본 입력 상태 때문에 잠겼을 때 패널 맨 위에 이유를 보인다(R14).
 * 미저장 변경 때문이면 저장 위치로 가는 바로가기를 붙인다.
 */
export function GoodOperationDisabledNotice({ reason, unsaved = false }: { reason: string; unsaved?: boolean }) {
  if (!reason) return null;
  return <div className="admin-good-workspace__disabled" role="status">
    <p>{unsaved ? GOOD_UNSAVED_BASE_COPY : reason}</p>
    {unsaved ? <button type="button" className="wc-admin-kit__button" onClick={focusGoodWorkspaceSave}>저장 위치로 이동</button> : null}
  </div>;
}

/**
 * 운영 섹션. `mode`가 'placeholder'면 저장 전 등록 화면의 비활성 자리표시 카드(같은 id·같은 순서)이고,
 * 'inline'이면 기본 입력과 함께 원자 저장되는 등록 화면 섹션(KC·예약판매)이다.
 */
export function GoodOperationSection({ id, title, description, children, mode = 'separate', defaultOpen = false, notice }: {
  id: string; title: string; description: string; children?: ReactNode; mode?: 'separate' | 'placeholder' | 'inline'; defaultOpen?: boolean;
  /** 패널 맨 위에 보일 잠금 이유(GoodOperationDisabledNotice). */
  notice?: ReactNode;
}) {
  const { open, onToggle } = useSectionOpen(`good-operation-${id}`, defaultOpen, false);
  const setOpen = useContext(OpenState)?.setOpen;
  const rememberOpen = mode === 'inline' && defaultOpen;
  /* 등록 화면에서 펼쳐 두고 입력한 KC·예약판매는 저장 뒤 같은 자리의 독립 패널도 펼친 채로 이어 보인다. */
  useEffect(() => { if (rememberOpen) setOpen?.(`good-operation-${id}`, true); }, [rememberOpen, setOpen, id]);
  const placeholder = mode === 'placeholder';
  return <details id={`good-operation-${id}`} className={`admin-good-workspace__operation${placeholder ? ' admin-good-workspace__operation--placeholder' : ''}`}
    tabIndex={-1} open={open} onToggle={onToggle} aria-disabled={placeholder || undefined}>
    <summary>{title}<span>{placeholder ? GOOD_OPERATION_PLACEHOLDER_COPY : mode === 'inline' ? '상품과 함께 저장' : '별도 저장'}</span></summary>
    {placeholder ? <p className="admin-good-workspace__placeholder" role="note">{GOOD_OPERATION_PLACEHOLDER_COPY} {description}</p>
      : <p>{description} {mode === 'inline' ? '저장하기를 누르면 기본 상품 입력과 함께 한 번에 저장됩니다. 하나라도 실패하면 아무것도 저장되지 않고 입력은 유지됩니다.' : '기본 상품 입력은 함께 저장되지 않습니다.'}</p>}
    {placeholder ? null : notice}
    {placeholder ? null : children}
  </details>;
}

/** Native details keep every named input mounted when a section is folded. */
export function GoodEditorSection({ id, title, requirement, status, summary, errorCount = 0, children, defaultOpen = true }: {
  id?: string; title: string; requirement?: string; status?: string; summary?: string; errorCount?: number; children: ReactNode; defaultOpen?: boolean;
}) {
  const { open, onToggle } = useSectionOpen(id, defaultOpen, errorCount > 0);
  return <details id={id} className="admin-good-section" aria-label={title} open={open} onToggle={onToggle}>
    <summary><span className="admin-good-section__title">{title}{requirement?.includes('필수') ? <span className="admin-good-section__required" aria-label="필수">*</span> : null}</span>
      <span className="admin-good-section__summary">{errorCount ? <strong>{errorCount}개 확인 필요</strong> : summary || status}</span><span className="admin-good-section__chevron" aria-hidden="true"><Icon name="chevronRight" size={17} /></span></summary>
    <div className="admin-good-section__body">{requirement ? <p className="admin-good-section__requirement">{requirement}</p> : null}{children}</div>
  </details>;
}
