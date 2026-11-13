import type { ReactNode } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { Button, buttonVariants } from '../kit/ui/button';

/*
 * IP·콘텐츠 운영 화면이 함께 쓰는 배치·카드 모양(템플릿 룩, ADR-0028).
 *
 * 카드는 AdminSectionCard와 같은 모양이고 form·section·article·li 어디에나 붙인다(폼 자체가 카드인 화면이 많다).
 * 목록-상세(master-detail)는 넓은 화면(lg)에서 목록 열 + 편집 열 두 열, 좁은 화면에서는 목록 → 편집 순서의 한 열이다.
 * 목록 열은 셸 머리(h-12) 아래에 붙어 따라온다.
 */

export const SECTION_CARD = 'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-5';
/** 중립 안내 상자. */
export const SECTION_NOTE = 'rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground';
/** 경고·차단 안내 상자. */
export const SECTION_WARNING = 'rounded-lg border border-danger-border bg-danger-soft px-3 py-2.5 text-sm text-destructive';
/** 현황 수치 묶음(발급·플레이 현황). 항목 하나가 "이름 값" 한 줄이다. */
export const SECTION_STATS = 'grid grid-cols-1 gap-2 text-sm tabular-nums sm:grid-cols-2 xl:grid-cols-3';
export const SECTION_STAT = 'min-w-0 rounded-lg border bg-muted/40 px-3 py-2';
/** 입력 세 칸을 한 줄에 두는 격자(운영 기간처럼 짧은 칸이 셋일 때 혼자 남는 칸이 없게). */
export const SECTION_FIELDS_3 = 'grid gap-x-6 gap-y-5 sm:grid-cols-3';

export function MasterDetail({ children, list }: { children: ReactNode; list: ReactNode }) {
  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(17rem,0.45fr)_minmax(0,1fr)]" data-admin-layout="master-detail">
      <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-16">{list}</div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
  );
}

/** 카드 머리(제목·설명·오른쪽 동작). 화면 머리(h2) 아래의 h3다. */
export function SectionHeading({ action, description, id, title }: {
  action?: ReactNode;
  description?: ReactNode;
  id?: string;
  title: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-base leading-snug font-semibold text-foreground" id={id}>{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

/**
 * 목록-상세의 입력 묶음 맨 위 제목. 지금 새로 등록하는지, 왼쪽 목록의 어떤 항목을 고치는지 말한다 —
 * 아무것도 안 고른 채 저장 버튼부터 보이면 등록인지 수정인지 알 수 없다.
 */
export function RecordFormHeading({ description, editing, noun, onClose }: {
  description?: ReactNode;
  /** 고치는 항목의 이름. 새 등록이면 `null`. */
  editing: string | null;
  /** 항목 종류(카드·이벤트…). 새 등록 제목에 쓴다. */
  noun: string;
  /** 주면 오른쪽에 닫기가 서서 목록만 보는 상태로 돌아간다. */
  onClose?: () => void;
}) {
  return <SectionHeading action={onClose ? <Button onClick={onClose} size="sm" type="button" variant="ghost">닫기</Button> : undefined} description={description} title={editing === null ? `새 ${noun} 등록` : `${editing} 수정`} />;
}

/**
 * 목록-상세의 오른쪽 열. 고른 항목도 새 등록도 없으면 안내만 보인다 — 빈 입력 칸이 첫 화면을 차지하면 목록과 눈이 갈리고
 * 등록 중인지 수정 중인지 모른다. 폼은 숨겨도 DOM에 남아 저장 실패 복원·리마운트 키 동작이 그대로다.
 */
export function RecordDetailPane({ children, hint, open, prompt }: {
  children: ReactNode;
  /** 안내 둘째 줄(새로 만드는 방법). */
  hint: string;
  open: boolean;
  /** 안내 첫째 줄(목록에서 고르면 무슨 일이 일어나는지). */
  prompt: string;
}) {
  return <>
    {open ? null : <div className="flex min-h-64 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed bg-card p-6 text-center" data-record-detail="prompt">
      <ArrowLeft aria-hidden="true" className="mb-1 size-5 text-muted-foreground max-lg:hidden" />
      <p className="text-base leading-snug font-semibold text-foreground">{prompt}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>}
    <div className={open ? 'contents' : 'hidden'} data-record-detail="form">{children}</div>
  </>;
}

/**
 * 폼 안의 입력 묶음(기본 정보·소개 글·이미지…). 첫 묶음 위에는 선을 긋지 않는다 — 카드 머리나 카드 테두리가 이미 경계다.
 * `bare`는 두 묶음을 나란히 둘 때 쓴다(구분선은 감싼 줄이 긋는다).
 */
export function FormGroup({ bare = false, children, hint, title }: { bare?: boolean; children: ReactNode; hint?: string; title: string }) {
  return <section aria-label={title} className={`flex min-w-0 flex-col gap-3${bare ? '' : ' border-t pt-4 first-of-type:border-t-0 first-of-type:pt-0'}`} data-record-form="group">
    <header className="flex flex-col gap-0.5">
      <h3 className="text-sm leading-snug font-semibold text-foreground">{title}</h3>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </header>
    {children}
  </section>;
}

/** 자주 쓰지 않는 입력·도구를 접어 두는 카드. 접혀도 안의 폼은 DOM에 있고 저장 동작은 그대로다. */
export function FoldCard({ badge, children, cue, id, open, summary, title }: {
  badge?: ReactNode;
  children: ReactNode;
  /** 접힌 줄 오른쪽에 버튼 모양으로 보이는 글자. 이 줄을 펼쳐야 할 일을 할 수 있을 때 그 일을 말한다. 펼치면 사라진다. */
  cue?: string;
  id?: string;
  open?: boolean;
  /** 접혔을 때 제목 옆에 보이는 한 줄. */
  summary?: ReactNode;
  title: string;
}) {
  return <details className="group/fold min-w-0 scroll-mt-16 rounded-xl border bg-card text-sm text-card-foreground" data-fold-card="" id={id} open={open}>
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5 [&::-webkit-details-marker]:hidden">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-base leading-snug font-semibold text-foreground">{title}</span>
        {badge}
        {summary ? <span className="text-sm text-muted-foreground">{summary}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {cue ? <span className={`${buttonVariants({ variant: 'outline', size: 'sm' })} group-open/fold:hidden`} data-slot="button">{cue}</span> : null}
        <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open/fold:rotate-180" />
      </span>
    </summary>
    <div className="flex min-w-0 flex-col gap-4 border-t p-4 sm:p-5">{children}</div>
  </details>;
}

/**
 * 잠긴 선택 칸. 값은 hidden input으로 그대로 제출하고, 화면에는 읽기 전용 입력 모양(kit Input의 read-only)으로 보인다.
 */
export function ReadOnlyField({ children, describedBy, label, labelId, name, value }: {
  children: ReactNode;
  describedBy?: string;
  label: string;
  labelId: string;
  name: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-sm leading-snug font-medium text-foreground" id={labelId}>{label}</span>
      <input name={name} type="hidden" value={value} />
      <div
        aria-describedby={describedBy}
        aria-labelledby={labelId}
        aria-readonly="true"
        className="flex min-h-8 min-w-0 items-center rounded-lg border border-dashed border-input bg-muted/50 px-2.5 py-1 text-sm break-words text-muted-foreground"
        role="textbox"
      >
        {children}
      </div>
    </div>
  );
}
