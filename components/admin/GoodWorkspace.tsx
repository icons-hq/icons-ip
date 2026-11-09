'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type ReactNode, type SetStateAction, type SyntheticEvent } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { GOOD_EDITOR_CARDS, GOOD_EDITOR_SECTIONS, goodFieldSection, orderedGoodErrors, type GoodEditorCardKey } from '@/lib/admin/good-workspace';
import { EMPTY_GOOD_WORKSPACE_SECTIONS, GOOD_WORKSPACE_ERROR_SECTIONS, type GoodWorkspaceErrorField, type GoodWorkspaceSectionsDraft } from '@/lib/admin/good-workspace-sections';
import { initialGoodsOptionRows, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import type { AdminGoodsKc, GoodsKcModelInput } from '@/lib/admin/goods-kc';
import { AdminStatusBadge } from './console/AdminKit';

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
  /** 고시 카드 안의 KC 패널은 기본 폼과 함께 다시 마운트된다. 입력 중인 KC가 기본 저장으로 사라지지 않게 키 밖에 맡긴다. */
  readKcPanelStash: (goodId: string) => GoodsKcPanelStash | null;
  rememberKcPanel: (goodId: string, changes: Partial<Omit<GoodsKcPanelStash, 'goodId'>>) => void;
}
/** 저장된 상품의 KC 패널이 다시 마운트돼도 이어 쓸 값(불러온 설정과 입력 중인 모델). */
export interface GoodsKcPanelStash {
  goodId: string;
  configuration: AdminGoodsKc | null;
  draft: { models: GoodsKcModelInput[]; attested: boolean } | null;
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
  const kcPanelStash = useRef<GoodsKcPanelStash | null>(null);
  const readKcPanelStash = useCallback((goodId: string) => kcPanelStash.current?.goodId === goodId ? kcPanelStash.current : null, []);
  const rememberKcPanel = useCallback((goodId: string, changes: Partial<Omit<GoodsKcPanelStash, 'goodId'>>) => {
    const current = kcPanelStash.current?.goodId === goodId ? kcPanelStash.current : { goodId, configuration: null, draft: null };
    kcPanelStash.current = { ...current, ...changes };
  }, []);
  const publishOptionRows = useCallback((rows: GoodsOptionRow[]) => {
    setOptionRows((current) => JSON.stringify(current) === JSON.stringify(rows) ? current : rows);
  }, []);
  const openValue = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  const sectionsValue = useMemo(() => ({ sections, setSections, optionRows, publishOptionRows, sectionErrors, setSectionErrors, operationId, readKcPanelStash, rememberKcPanel }),
    [sections, optionRows, publishOptionRows, sectionErrors, operationId, readKcPanelStash, rememberKcPanel]);
  return <OpenState.Provider value={openValue}><Sections.Provider value={sectionsValue}>{children}</Sections.Provider></OpenState.Provider>;
}

/** 등록 화면 섹션 상태. provider 밖(다른 화면·테스트)에서는 null이다. */
export function useGoodWorkspaceSections() { return useContext(Sections); }

/**
 * 펼침 상태를 키 밖 상태에 맞추고, 사용자가 바꾼 것만 기록한다(10/27 회의 R14).
 *
 * React가 open 값을 바꿔 그린 변화(마운트, 오류로 강제로 열림·오류 해소)는 기록하지 않는다. 구분은 details에 그린
 * `data-known-open`으로 한다: React는 open prop이 바뀐 커밋에서만 open과 이 값을 함께 고치고, 사용자가 접거나 펼치면
 * toggle 핸들러가 고친다. 그래서 오류로 강제로 열린 섹션을 접었다 다시 펼쳐도(prop은 계속 열림) 다시 펼친 것이 기록된다.
 */
function useSectionOpen(id: string | undefined, fallback: boolean, forced: boolean) {
  const context = useContext(OpenState);
  const stored = id ? context?.open[id] : undefined;
  const open = forced || (stored ?? fallback);
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const details = event.currentTarget, next = details.open;
    if (details.dataset.knownOpen === String(next)) return;
    details.dataset.knownOpen = String(next);
    if (id) context?.setOpen(id, next);
  };
  return { open, onToggle, 'data-known-open': String(open) };
}

/**
 * 편집기 안 접이식 영역(공개 화면 미리보기·옵션 상세 정보·저장 안내 등). 저장 시도마다 폼이 다시 마운트돼도
 * `stateId`로 키 밖 펼침 상태를 이어 쓴다(R14). provider 밖에서는 `defaultOpen`으로 그린다.
 */
export function GoodWorkspaceDetails({ stateId, defaultOpen = false, forceOpen = false, children, ...props }: Omit<ComponentProps<'details'>, 'open' | 'onToggle'> & {
  stateId: string; defaultOpen?: boolean; forceOpen?: boolean;
}) {
  const openProps = useSectionOpen(stateId, defaultOpen, forceOpen);
  return <details {...props} {...openProps}>{children}</details>;
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
    const artwork = named[0]?.closest('[data-artwork-upload-field]');
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
    else document.querySelector<HTMLElement>('[data-good-workspace-errors]')?.focus();
  }, [attempt, errors]);
}

/*
 * 편집기 섹션 카드(kit Card 모양 · AdminSectionCard와 같은 머리 구성). 접힘은 네이티브 details라 접어도 입력이 그대로 제출되고,
 * 펼침 상태는 키 밖에 남는다(R14). 셸 상단바(48px)는 html scroll-padding이, 그 아래 고정 섹션 내비는 scroll-mt가 비켜 준다.
 */
const SECTION_CLASS = 'group/section min-w-0 scroll-mt-24 rounded-xl border bg-card text-sm text-card-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
const SECTION_SUMMARY_CLASS = 'flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 outline-none select-none group-open/section:rounded-b-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5 [&::-webkit-details-marker]:hidden';
const SECTION_BODY_CLASS = 'flex min-w-0 flex-col gap-5 border-t px-4 py-4 sm:px-5 sm:py-5';
const SECTION_CHEVRON = <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/section:rotate-180 motion-reduce:transition-none" />;

/** 카드별 남은 필수 입력: 남았으면 숫자(위험색), 끝났으면 체크. 서버 판정을 대신하지 않는 안내다. */
function GoodCardProgressMark({ remaining }: { remaining: number }) {
  if (remaining > 0) return <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-danger-soft px-1 text-xs font-medium text-destructive tabular-nums"><span className="sr-only">필수 입력 남음 </span>{remaining}</span>;
  return <span className="ml-1 inline-flex items-center text-success"><Check aria-hidden="true" className="size-3.5" /><span className="sr-only">필수 입력 완료</span></span>;
}

export function GoodWorkspaceNavigation({ remaining }: { remaining?: Partial<Record<GoodEditorCardKey, number>> } = {}) {
  useEffect(() => {
    const openHash = () => {
      const id = window.location.hash.slice(1);
      /* R15: 목록의 상품번호(공개 전 상품)는 #good-preview로 온다 — 접힌 공개 화면 미리보기를 연다. */
      if (id.startsWith('good-section-') || id.startsWith('good-operation-') || id === 'good-preview') focusGoodWorkspaceTarget(id);
    };
    openHash();
    window.addEventListener('hashchange', openHash);
    return () => window.removeEventListener('hashchange', openHash);
  }, []);
  /* 셸 상단바(h-12) 바로 아래에 붙는 띠(콘텐츠 여백 p-4·md:p-6만큼 양옆으로 넓힌다). 좁은 화면에서는 한 줄로 가로 이동하고, 넓은 화면에서는 줄을 바꾼다. */
  return <nav aria-label="상품 작성 섹션" className="sticky top-12 z-20 -mx-4 flex min-w-0 gap-1 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6 xl:flex-wrap xl:overflow-visible print:hidden" data-good-workspace-nav="">
    {GOOD_EDITOR_CARDS.map((card, index) => { const left = remaining?.[card.key]; return <a className="inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50" key={card.key} href={`#${card.anchor}`} onClick={(event) => {
      event.preventDefault(); focusGoodWorkspaceTarget(card.anchor, 'field' in card ? card.field : undefined);
    }}>{index + 1}. {card.label}{left === undefined ? null : <GoodCardProgressMark remaining={left} />}</a>; })}
  </nav>;
}

export function GoodWorkspaceErrors({ errors }: { errors?: Record<string, string | undefined> }) {
  const entries = orderedGoodErrors(errors);
  if (!entries.length) return null;
  return <section aria-label="저장 오류 요약" className="flex min-w-0 flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive outline-none focus-visible:ring-3 focus-visible:ring-destructive/20" data-good-workspace-errors="" role="alert" tabIndex={-1}>
    <h3 className="font-medium">저장하지 못했습니다 · {entries.length}개 확인</h3>
    <ul className="flex list-disc flex-col gap-1 pl-5">{entries.map(([field, message]) => { const target = errorTarget(field); return <li key={field}><a className="underline underline-offset-4 wrap-anywhere hover:text-destructive/80" href={`#${target.id}`} onClick={(event) => {
      event.preventDefault(); focusGoodWorkspaceTarget(target.id, target.field);
    }}>{message}</a></li>; })}</ul>
    <p className="text-muted-foreground">입력값과 업로드한 이미지가 유지됩니다. 해당 항목을 수정하고 다시 저장해주세요.</p>
  </section>;
}

/** 섹션 안의 선택 입력 묶음. `id`로 펼침 상태를 키 밖에 기억해 저장 시도 뒤에도 유지한다(R14). */
export function GoodOptionalFields({ id, title, summary, children, hasErrors = false }: { id: string; title: string; summary: string; children: ReactNode; hasErrors?: boolean }) {
  return <GoodWorkspaceDetails stateId={id} className="group/optional min-w-0 rounded-lg border" data-good-optional="" forceOpen={hasErrors}>
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2.5 outline-none select-none group-open/optional:rounded-b-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/optional:rotate-90 motion-reduce:transition-none" />
      <span className="text-sm font-medium text-foreground" data-good-optional-title="">{title}</span>
      <span className="min-w-0 text-xs text-muted-foreground wrap-anywhere">{summary}</span>
      {hasErrors ? <strong className="text-xs font-medium text-destructive">오류 확인</strong> : null}
    </summary>
    <div className="flex min-w-0 flex-col gap-4 border-t px-3 py-4">{children}</div>
  </GoodWorkspaceDetails>;
}

/** 저장 전 이어서 설정 카드의 이유 문구. 카드에 한 번만 보인다. */
export const GOOD_OPERATION_PLACEHOLDER_COPY = '상품을 저장하면 이 자리에서 바로 입력할 수 있습니다.';
export const GOOD_UNSAVED_BASE_COPY = '위 기본 정보에 저장하지 않은 변경이 있습니다. 먼저 저장하세요.';

/** 고정 저장 영역의 저장하기 버튼으로 포커스를 옮긴다(Enter로 바로 저장할 수 있게). */
export function focusGoodWorkspaceSave() {
  const button = document.querySelector<HTMLButtonElement>('[data-good-workspace-save] button[name="intent"][value="save"]');
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
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm" data-good-operation-notice="" role="status">
    <p className="min-w-0 flex-1 text-foreground">{unsaved ? GOOD_UNSAVED_BASE_COPY : reason}</p>
    {unsaved ? <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={focusGoodWorkspaceSave}>저장 위치로 이동</button> : null}
  </div>;
}

/**
 * 운영 섹션. 'separate'는 저장된 상품의 독립 패널이고, 'inline'은 기본 입력과 함께 원자 저장되는 등록 화면 섹션(KC·예약판매)이다.
 * 저장 전에는 나머지 패널을 카드로 늘어놓지 않고 이어서 설정 카드(GoodSection)에 이름만 보인다(D6·R13).
 */
export function GoodOperationSection({ id, title, description, children, mode = 'separate', defaultOpen = false, notice, separateLabel = false }: {
  id: string; title: string; description?: string; children?: ReactNode; mode?: 'separate' | 'inline'; defaultOpen?: boolean;
  /** 패널 맨 위에 보일 잠금 이유(GoodOperationDisabledNotice). */
  notice?: ReactNode;
  /** 이어서 설정 카드 밖에 놓인 패널에 "별도 저장"을 표시한다. 카드 안에서는 머리의 한 문장이 대신한다. */
  separateLabel?: boolean;
}) {
  const openProps = useSectionOpen(`good-operation-${id}`, defaultOpen, false);
  const setOpen = useContext(OpenState)?.setOpen;
  const rememberOpen = mode === 'inline' && defaultOpen;
  /* 등록 화면에서 펼쳐 두고 입력한 KC·예약판매는 저장 뒤 같은 자리의 독립 패널도 펼친 채로 이어 보인다. */
  useEffect(() => { if (rememberOpen) setOpen?.(`good-operation-${id}`, true); }, [rememberOpen, setOpen, id]);
  const modeLabel = mode === 'inline' ? '상품과 함께 저장' : separateLabel ? '별도 저장' : null;
  return <details id={`good-operation-${id}`} className={SECTION_CLASS} data-good-operation={mode} tabIndex={-1} {...openProps}>
    <summary className={SECTION_SUMMARY_CLASS}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base leading-snug font-medium text-foreground" data-good-operation-title="">{title}</span>
        {modeLabel ? <span className="text-sm text-muted-foreground" data-good-operation-mode="">{modeLabel}</span> : null}
      </span>
      {SECTION_CHEVRON}
    </summary>
    <div className={SECTION_BODY_CLASS}>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {notice}
      {children}
    </div>
  </details>;
}

/** 저장 뒤 이어서 설정 카드의 접이식 묶음. 기본은 접힘이고, `#good-operation-*` 링크는 조상 details를 열어 들어온다. */
export function GoodOperationGroup({ id, title, names, children }: { id: string; title: string; names: string; children: ReactNode }) {
  return <GoodWorkspaceDetails stateId={`good-operation-group-${id}`} className="group/operation-group min-w-0 rounded-lg border" data-good-operation-group={id}>
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-2 outline-none select-none group-open/operation-group:rounded-b-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
      <span className="shrink-0 text-sm font-medium text-foreground">{title}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{names}</span>
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/operation-group:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="flex min-w-0 flex-col gap-3 border-t p-3">{children}</div>
  </GoodWorkspaceDetails>;
}

/**
 * 카드 안의 접힌 줄(현재 값 한 줄 요약 + 변경). 네이티브 details라 접어도 입력이 DOM에 남아 저장·임시저장·자동복구가 같은 값을 읽는다.
 * `id`는 오류·판매 준비 링크의 대상이자 펼침 상태 열쇠다.
 */
export function GoodFoldedRow({ id, title, summary, errorCount = 0, isDefault = false, defaultOpen = false, children }: {
  id: string; title: string; summary: ReactNode; errorCount?: number;
  /** 기본값 그대로면 건드릴 것 없음을 표시한다. */
  isDefault?: boolean; defaultOpen?: boolean; children: ReactNode;
}) {
  return <GoodWorkspaceDetails stateId={id} id={id} aria-label={title} className="group/row min-w-0 scroll-mt-24 rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50" data-good-folded-row="" defaultOpen={defaultOpen} forceOpen={errorCount > 0} tabIndex={-1}>
    <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 outline-none select-none group-open/row:rounded-b-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
      <span className="shrink-0 text-sm font-medium text-foreground" data-good-section-title="">{title}</span>
      <span className="min-w-0 flex-1 text-xs text-muted-foreground wrap-anywhere sm:text-sm" data-good-section-summary="">{errorCount ? <strong className="font-medium text-destructive">{errorCount}개 확인 필요</strong> : summary}</span>
      {isDefault && !errorCount ? <AdminStatusBadge className="shrink-0">기본값</AdminStatusBadge> : null}
      <span aria-hidden="true" className="shrink-0 text-xs font-medium text-primary group-open/row:hidden">변경</span>
      <span aria-hidden="true" className="hidden shrink-0 text-xs font-medium text-muted-foreground group-open/row:inline">접기</span>
    </summary>
    <div className="flex min-w-0 flex-col gap-4 border-t px-3 py-4">{children}</div>
  </GoodWorkspaceDetails>;
}

/** Native details keep every named input mounted when a section is folded. */
export function GoodEditorSection({ id, title, requirement, required = false, remaining, summary, errorCount = 0, children, defaultOpen = true }: {
  id?: string; title: string; requirement?: string; required?: boolean;
  /** 이 카드의 남은 필수 입력 수. undefined면 필수 항목이 없는 카드다. */
  remaining?: number;
  summary?: ReactNode; errorCount?: number; children: ReactNode; defaultOpen?: boolean;
}) {
  const openProps = useSectionOpen(id, defaultOpen, errorCount > 0);
  return <details id={id} className={SECTION_CLASS} aria-label={title} data-good-section="" tabIndex={-1} {...openProps}>
    <summary className={SECTION_SUMMARY_CLASS}>
      <span className="shrink-0 text-base leading-snug font-medium text-foreground" data-good-section-title="">{title}{required ? <span className="ml-0.5 text-destructive" aria-label="필수">*</span> : null}</span>
      {remaining === undefined ? null : remaining > 0
        ? <AdminStatusBadge className="shrink-0 tabular-nums" data-good-card-remaining={remaining} tone="danger">필수 {remaining}개 남음</AdminStatusBadge>
        : <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success" data-good-card-remaining="0"><Check aria-hidden="true" className="size-3.5" />필수 입력 완료</span>}
      <span className="ml-auto max-w-[55%] min-w-0 text-right text-xs text-muted-foreground wrap-anywhere sm:max-w-[60%] sm:text-sm" data-good-section-summary="">{errorCount ? <strong className="font-medium text-destructive">{errorCount}개 확인 필요</strong> : summary}</span>
      {SECTION_CHEVRON}
    </summary>
    <div className={SECTION_BODY_CLASS}>{requirement ? <p className="text-sm text-muted-foreground" data-good-section-requirement="">{requirement}</p> : null}{children}</div>
  </details>;
}
