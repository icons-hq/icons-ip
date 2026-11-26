'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { COUNTRY_NAME_SOURCE } from '@/lib/admin/country-names';
import { KOREAN_REGION_SOURCE } from '@/lib/admin/korean-regions';
import { ORIGIN_CHOICE_FILTERS, originChoiceLoader, type OriginChoice } from '@/lib/admin/origin-choices';
import { AdminField } from './console/AdminKit';
import { GOOD_INPUT_CLASS } from './GoodEditorParts';

type CountryNameFinderProps = {
  onClose: () => void;
} & ({ mode: 'copy' } | {
  mode: 'apply'; currentValue: string; disabled: boolean; onApply: (name: string) => boolean;
  /** 지금 원산지를 바꿀 수 없는 이유. `disabled`이거나 `onApply`가 값을 받지 않았을 때 창에 보인다. */
  blockedReason?: string;
});

/* 직접 복사할 값은 결과물이라 읽기 전용이어도 흐리게 두지 않는다(점선 테두리만 읽기 전용 표시). */
const COPY_VALUE_CLASS = `${GOOD_INPUT_CLASS} read-only:text-foreground`;
/* 원산지 입력칸은 다른 고시 칸(fields.tsx Field)과 같은 모양이다 — 고르기 아이콘 버튼과 한 줄에 놓으려고 입력만 직접 그린다. */
const ORIGIN_INPUT_CLASS = 'h-8 w-full min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-secondary-foreground disabled:opacity-100 read-only:border-dashed read-only:bg-muted/50 read-only:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';
const SOURCE_LINK_CLASS = 'underline underline-offset-4 hover:text-foreground';

const PICKER_TITLE = '원산지 고르기';
/* 엑셀 일괄등록 양식의 열 이름은 '제조국'이다(lib/admin/goods-workbook.ts). 화면 이름 '원산지'와 다르므로 열 이름을 그대로 적는다. */
const COPY_GUIDE = "원산지를 찾아 [복사]를 누른 뒤 엑셀의 '제조국' 열에 붙여 넣으세요.";
const ORIGIN_PUBLISHED_LOCK = '공개 중인 상품은 원산지를 바꿀 수 없습니다. [초안으로 전환 후 수정]을 누른 뒤 바꿔 주세요.';
const ORIGIN_BLOCKED = '지금은 원산지를 바꿀 수 없습니다. 저장 중이면 끝난 뒤 다시 골라 주세요.';

const originRowKey = (row: OriginChoice) => row.value;
/* 줄의 이름이 곧 원산지 칸에 들어가는 글자다. 국가 코드는 검색에만 쓰고 보이지 않는다(화면 규칙 8). */
const originRowView = (row: OriginChoice): AdminPickerRowView => ({ title: row.value, meta: row.english || undefined });

/**
 * 원산지 고르기 창. 공용 선택창(화면 규칙 1)에 국가·지역과 국내 지역(시·도, 시·군·구)을 한 목록으로 보인다.
 * - apply: 줄의 [선택]이 원산지 칸에 그 글자를 넣고 창을 닫는다. 칸이 값을 받지 않으면(그 사이 잠김) 창을 닫지 않고 이유를 보인다.
 * - copy: 엑셀 일괄등록용. 줄의 [복사]가 그 글자를 클립보드에 넣는다. 여러 줄을 이어서 복사할 수 있게 창은 닫지 않는다.
 * 창은 공용 선택창이 body로 포털해 상품 폼의 제출·자동저장 이벤트와 섞이지 않는다.
 */
export function CountryNamePicker(props: CountryNameFinderProps) {
  const [copied, setCopied] = useState<{ value: string; failed: boolean } | null>(null);
  const [refused, setRefused] = useState(false);
  const alive = useRef(true), copying = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const apply = props.mode === 'apply' ? props : null;
  const current = apply?.currentValue.trim() ?? '';
  const choose = (row: OriginChoice) => {
    if (apply?.onApply(row.value)) return true;
    setRefused(true);
    return false;
  };
  async function copy(value: string) {
    if (copying.current) return;
    copying.current = true;
    let failed = false;
    try { await navigator.clipboard.writeText(value); } catch { failed = true; }
    copying.current = false;
    /* 복사가 끝나기 전에 창을 닫았으면 아무것도 바꾸지 않는다. */
    if (alive.current) setCopied({ value, failed });
  }
  return <AdminPickerDialog<OriginChoice>
    title={PICKER_TITLE}
    description={!apply ? COPY_GUIDE : current ? <>고르면 원산지 칸에 지금 적힌 <strong className="font-medium text-foreground wrap-anywhere">{`'${current}'`}</strong> 대신 들어갑니다.</> : '고르면 원산지 칸에 들어갑니다.'}
    blockedReason={apply && (apply.disabled || refused) ? apply.blockedReason ?? ORIGIN_BLOCKED : null}
    load={originChoiceLoader}
    rowKey={originRowKey}
    rowView={originRowView}
    filterLabel="범위"
    filterOptions={ORIGIN_CHOICE_FILTERS}
    searchPlaceholder="예: 중국, Vietnam, 수원"
    emptyText={apply ? '찾는 이름이 없습니다. 원산지 칸에 직접 적어도 됩니다.' : '찾는 이름이 없습니다. 엑셀에 직접 적어도 됩니다.'}
    selectedKeys={current ? [current] : undefined}
    onSelect={choose}
    rowAction={apply ? undefined : (row, { busy }) => <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={busy} onClick={() => void copy(row.value)}>
      {copied && !copied.failed && copied.value === row.value ? '복사됨' : '복사'}
    </button>}
    footer={<>
      {copied ? copied.failed ? <div className="flex min-w-0 flex-col gap-2" data-origin-copy="failed">
        <p className="text-destructive" role="alert">자동으로 복사하지 못했습니다. 아래 글자를 직접 복사해 주세요.</p>
        <input aria-label="복사할 원산지" className={COPY_VALUE_CLASS} data-slot="input" readOnly value={copied.value} onFocus={event => event.target.select()} />
      </div> : <p className="text-muted-foreground wrap-anywhere" data-origin-copy="done" role="status">복사한 원산지: <strong className="font-medium text-foreground">{copied.value}</strong></p> : null}
      {/* 이름 자료의 출처와 라이선스. Unicode 라이선스(저작권·허가문을 사본이나 관련 문서에 함께 둘 것)는 원문을 /licenses 아래에 두고 이 창에서 잇는 방식으로 지킨다
          (vendor/unicode-cldr/48.2.0/README.md, docs/research/smartstore-admin/origin-country-finder-proposal.md). 링크를 지우기 전에 그 조건을 다시 확인한다. */}
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" data-origin-sources="">
        <a className={SOURCE_LINK_CLASS} href={COUNTRY_NAME_SOURCE.url} target="_blank" rel="noreferrer">국가·지역 이름: Unicode CLDR</a>
        <a className={SOURCE_LINK_CLASS} href={COUNTRY_NAME_SOURCE.licenseUrl} target="_blank" rel="noreferrer">라이선스</a>
        <a className={SOURCE_LINK_CLASS} href={KOREAN_REGION_SOURCE.url} target="_blank" rel="noreferrer">국내 지역 이름: 국토교통부</a>
      </p>
    </>}
    onClose={props.onClose}
  />;
}

/**
 * Keep the existing editable text field and write only its selected Korean name.
 * ADM-004(복잡도 표 209행): 고르기는 입력칸 바로 옆 아이콘 버튼이다(입력칸 아래 글자 버튼이던 것을 줄였다). 이름은 aria-label·title로 남긴다.
 * 고른 값은 칸에 바로 보이므로 따로 알리는 글을 두지 않는다.
 */
export function GoodsOriginField({ defaultValue, error, label, readOnly, required, disabled }: {
  defaultValue: string; error?: string; label: string; readOnly: boolean; required: boolean; disabled: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  /* 원산지 칸은 상품 편집기·그룹 공통정보 편집 화면에 하나뿐이다. */
  const inputId = 'goods-notice-origin';
  /* 창을 연 순간 칸에 적혀 있던 값. null이면 창이 닫혀 있다. */
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  const blocked = disabled || readOnly;
  function input() { return root.current?.querySelector<HTMLInputElement>('input[name="noticeOrigin"]'); }
  return <div className="flex min-w-0 flex-col gap-2" data-country-origin-field="" ref={root}>
    <AdminField inputId={inputId} label={label} error={error}>
      <div className="flex min-w-0 items-center gap-1.5">
        <input className={ORIGIN_INPUT_CLASS} data-slot="input" id={inputId} name="noticeOrigin" defaultValue={defaultValue} placeholder="대한민국" readOnly={readOnly} required={required}
          aria-describedby={error ? `${inputId}-error` : undefined} aria-invalid={Boolean(error)} />
        <button type="button" className={buttonVariants({ variant: 'outline', size: 'icon' })} data-slot="button" data-country-finder-open="" aria-haspopup="dialog" aria-label={PICKER_TITLE} title={PICKER_TITLE} disabled={blocked}
          onClick={() => { const field = input(); if (!blocked && field) setCurrentValue(field.value); }}><Search aria-hidden="true" /></button>
      </div>
    </AdminField>
    {/* 읽기 전용(readOnly)은 공개 중 잠금이다(GoodEditor). 그 밖의 잠금(disabled)은 저장 중·보관처럼 화면마다 달라 창이 공통 문구를 쓴다. */}
    {currentValue !== null && <CountryNamePicker mode="apply" currentValue={currentValue} disabled={blocked} blockedReason={readOnly ? ORIGIN_PUBLISHED_LOCK : undefined} onClose={() => setCurrentValue(null)} onApply={name => {
      const field = input();
      if (blocked || !field || field.readOnly || field.disabled) return false;
      field.value = name;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }} />}
  </div>;
}
