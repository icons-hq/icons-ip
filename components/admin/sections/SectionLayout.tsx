import type { ReactNode } from 'react';

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
        <h3 className="text-base leading-snug font-semibold text-foreground" id={id}>{title}</h3>
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
export function RecordFormHeading({ description, editing, noun }: {
  description?: ReactNode;
  /** 고치는 항목의 이름. 새 등록이면 `null`. */
  editing: string | null;
  /** 항목 종류(카드·이벤트…). 새 등록 제목에 쓴다. */
  noun: string;
}) {
  return <SectionHeading description={description} title={editing === null ? `새 ${noun} 등록` : `${editing} 수정`} />;
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
