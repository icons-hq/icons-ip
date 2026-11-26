'use client';

import {
  createContext, startTransition, useActionState, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useTransition,
  type ReactNode,
} from 'react';
import { Search } from 'lucide-react';
import {
  deleteGoodsNoticePresetAction, saveGoodsNoticePresetAction, type GoodsNoticePresetActionState,
} from '@/app/admin/goods-notice-preset-actions';
import { AdminField, AdminFormGrid, AdminNotice } from '@/components/admin/console/AdminKit';
import { useAdminCreateDialogBusy, useAdminCreateDialogClose } from '@/components/admin/console/AdminCreateDialogButton';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { CountryNamePicker } from '@/components/admin/CountryNameFinder';
import { GoodReadback } from '@/components/admin/GoodEditorParts';
import { noticePresetRowView } from '@/components/admin/GoodNoticePicker';
import { GoodsKcPresetFields } from '@/components/admin/GoodsKcPresetFields';
import { adminConfirm } from '@/lib/admin/confirm';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeKey } from '@/lib/goods-notice';
import {
  GOODS_NOTICE_PRESET_FIELD_MAX, GOODS_NOTICE_PRESET_NAME_MAX, type GoodsNoticePreset,
} from '@/lib/admin/goods-notice-presets';

const EMPTY_STATE: GoodsNoticePresetActionState = {};
/* 상품등록은 대표 카테고리 이름이 든 템플릿 가운데 이름순 첫 번째를 권한다(GoodNoticePicker). 관리 화면에서는 보이지 않는 결과라 이름 칸 아래에 적는다. */
const NAME_HINT = '이름에 카테고리 이름(예: 키링)을 넣으면 그 카테고리 상품을 등록할 때 먼저 권합니다. 여럿이면 이름순으로 첫 번째만 권합니다.';
/* 상품마다 다른 칸. 템플릿에서는 보통 비워 둔다 — 비운 칸은 상품에 가져올 때 건드리지 않는다. */
const PER_GOOD_KEYS: ReadonlySet<GoodsNoticeKey> = new Set(['size', 'madeOn']);
const PER_GOOD_PLACEHOLDER = '비워 두면 상품에 적은 값 그대로';
const ORIGIN_PICKER_LABEL = '원산지 고르기';

/** 적은 칸과 비운 칸이 상품에 가져올 때 어떻게 되는지 한 줄로 되읽는다. 설명 대신 지금 입력의 결과를 보인다. */
export function noticePresetReadback(filled: readonly GoodsNoticeKey[]): string {
  const blank = GOODS_NOTICE_FIELDS.filter((field) => !filled.includes(field.key)).map((field) => field.label);
  if (!blank.length) return `상품에 가져오면 ${GOODS_NOTICE_FIELDS.length}개 칸이 모두 이 내용으로 바뀝니다.`;
  if (blank.length === GOODS_NOTICE_FIELDS.length) return '적은 칸만 상품에 가져옵니다. 비운 칸은 상품에 적어 둔 값 그대로입니다.';
  return `상품에 가져오면 ${GOODS_NOTICE_FIELDS.length - blank.length}개 칸이 이 내용으로 바뀝니다. 비운 칸(${blank.join(', ')})은 상품에 적어 둔 값 그대로입니다.`;
}

/** 폼에 지금 글자가 적힌 고시 칸. 칸 이름(formName)으로 읽는다(공백만 있으면 빈 칸). */
export function filledNoticeKeys(form: { elements: { namedItem(name: string): unknown } }): GoodsNoticeKey[] {
  return GOODS_NOTICE_FIELDS.filter((field) => {
    const value = (form.elements.namedItem(field.formName) as { value?: unknown } | null)?.value;
    return typeof value === 'string' && value.trim() !== '';
  }).map((field) => field.key);
}

/*
 * 목록 위 결과 한 줄과 삭제. 등록 창은 저장되면 닫히고, 삭제한 줄은 목록에서 사라져 그 자리의 폼이 결과를 보여 줄 수 없다.
 * 그래서 결과는 목록 밖(이 부품)이 들고 있다가 목록 위에 보인다. 삭제도 여기서 실행한다 — 줄이 사라져도 결과가 남는다.
 */
interface NoticePresetFeedback {
  flash: { tone: 'success' | 'danger'; text: string } | null;
  announce: (text: string) => void;
  remove: (preset: GoodsNoticePreset) => void;
  removing: boolean;
}
const Feedback = createContext<NoticePresetFeedback | null>(null);

export function GoodsNoticePresetFeedback({ children }: { children: ReactNode }) {
  const [flash, setFlash] = useState<NoticePresetFeedback['flash']>(null);
  const [removing, startRemoval] = useTransition();
  const announce = useCallback((text: string) => setFlash({ tone: 'success', text }), []);
  const remove = useCallback((preset: GoodsNoticePreset) => {
    void adminConfirm({
      title: `‘${preset.name}’ 템플릿을 삭제할까요?`,
      message: '삭제하면 되돌릴 수 없습니다. 이 템플릿으로 채운 상품의 내용은 그대로 남습니다.',
      confirmLabel: '삭제', destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setFlash(null);
      startRemoval(async () => {
        const data = new FormData();
        data.set('id', preset.id);
        data.set('updatedAt', preset.updatedAt);
        /* 서버는 확인을 거친 삭제만 받는다. 위 확인창을 지난 뒤에만 싣는다. */
        data.set('confirmed', 'true');
        let result: GoodsNoticePresetActionState;
        try { result = await deleteGoodsNoticePresetAction(EMPTY_STATE, data); }
        catch { result = { errors: { form: '삭제됐는지 확인하지 못했습니다. 새로고침해 목록에서 확인해 주세요.' } }; }
        setFlash(result.errors?.form
          ? { tone: 'danger', text: result.errors.form }
          : { tone: 'success', text: `‘${preset.name}’ 템플릿을 삭제했습니다.` });
      });
    });
  }, []);
  const value = useMemo(() => ({ flash, announce, remove, removing }), [flash, announce, remove, removing]);
  return <Feedback.Provider value={value}>{children}</Feedback.Provider>;
}

/** 목록 위 결과 한 줄(등록·삭제). 자리는 늘 있어 결과가 생기면 화면 읽기 도구가 읽는다. */
export function GoodsNoticePresetFeedbackLine() {
  const flash = useContext(Feedback)?.flash;
  return <div aria-live="polite" className="contents" data-notice-presets="result">
    {flash ? <AdminNotice role={flash.tone === 'danger' ? 'alert' : undefined} tone={flash.tone}>{flash.text}</AdminNotice> : null}
  </div>;
}

/** 목록 한 줄의 요약. 상품등록의 템플릿 선택창과 같은 요약(제조사 · 소재 · KC 유형 틀)을 쓴다 — 같은 템플릿을 두 화면이 다르게 보이지 않는다. */
export function GoodsNoticePresetSummary({ preset }: { preset: GoodsNoticePreset }) {
  const row = noticePresetRowView(preset, true);
  return <span className="flex min-w-0 flex-col gap-0.5 wrap-anywhere sm:flex-row sm:items-baseline sm:gap-4">
    <strong className="font-medium">{row.title}</strong>
    {row.meta ? <span className="text-sm text-muted-foreground">{row.meta}</span> : null}
  </span>;
}

/** 삭제는 버튼 하나다. 누르면 확인창이 이름과 남는 것을 보여 준다(화면 규칙 7). */
function GoodsNoticePresetDeleteButton({ preset }: { preset: GoodsNoticePreset }) {
  const feedback = useContext(Feedback);
  if (!feedback) return null;
  return <Button disabled={feedback.removing} onClick={() => feedback.remove(preset)} type="button" variant="destructive">삭제</Button>;
}

/** 원산지 칸. 상품등록과 같은 선택창(CountryNamePicker)을 쓰고, 직접 적어도 된다. 칸이 한 화면에 여러 개라 id는 폼마다 다르다. */
export function NoticePresetOriginField({ defaultValue, error, inputProps, label, placeholder }: {
  defaultValue: string; error?: string; label: string; placeholder: string;
  inputProps: { id: string; name: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined };
}) {
  const root = useRef<HTMLDivElement>(null);
  /* 창을 연 순간 칸에 적혀 있던 값. null이면 창이 닫혀 있다. */
  const [current, setCurrent] = useState<string | null>(null);
  const input = () => root.current?.querySelector<HTMLInputElement>('input');
  return <AdminField label={label} inputId={inputProps.id} error={error}>
    <div className="flex min-w-0 items-center gap-1.5" ref={root}>
      <Input {...inputProps} className="flex-1" maxLength={GOODS_NOTICE_PRESET_FIELD_MAX} defaultValue={defaultValue} placeholder={placeholder} />
      <Button aria-haspopup="dialog" aria-label={ORIGIN_PICKER_LABEL} onClick={() => { const field = input(); if (field) setCurrent(field.value); }}
        size="icon" title={ORIGIN_PICKER_LABEL} type="button" variant="outline"><Search aria-hidden="true" /></Button>
    </div>
    {current !== null ? <CountryNamePicker mode="apply" currentValue={current} disabled={false} onClose={() => setCurrent(null)} onApply={(name) => {
      const field = input();
      /* 저장 중에는 칸 묶음(fieldset)이 잠긴다. 칸 자신의 disabled만 보면 놓친다. */
      if (!field || field.matches(':disabled')) return false;
      field.value = name;
      /* 폼이 입력을 따라 읽도록(되읽기 한 줄) 직접 적은 것과 같은 이벤트를 보낸다. */
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }} /> : null}
  </AdminField>;
}

/** `inset`: 접는 목록 안에서는 자기 여백을 두고, 등록 팝업 안에서는 팝업 본문 여백을 쓴다. */
export function GoodsNoticePresetForm({ preset, inset = true }: { preset?: GoodsNoticePreset; inset?: boolean }) {
  const [state, action, pending] = useActionState(saveGoodsNoticePresetAction, EMPTY_STATE);
  /* 등록 팝업 안에서 저장을 기다리는 동안 팝업을 닫지 못하게 한다(목록 안 수정 폼에서는 아무 일도 하지 않는다). */
  useAdminCreateDialogBusy(pending);
  const closeDialog = useAdminCreateDialogClose();
  const announce = useContext(Feedback)?.announce;
  /* 등록 팝업은 저장되면 닫고, 결과는 목록 위 한 줄로 알린다. 목록 안 수정 폼은 그 자리에 결과를 보인다. */
  useEffect(() => {
    if (!closeDialog || !state.message) return;
    announce?.(state.message);
    closeDialog();
  }, [announce, closeDialog, state]);
  const prefix = useId();
  // Keep the editing version until this form saves successfully. Another form's
  // revalidation must not advance our token while these inputs are still unsaved.
  const [editingPreset, setEditingPreset] = useState(preset);
  const [completedAttempt, setCompletedAttempt] = useState<number | undefined>();
  if (state.message && state.attempt !== completedAttempt) {
    setCompletedAttempt(state.attempt);
    setEditingPreset(preset);
  }
  const value = (name: string, fallback: string) => state.values?.[name] ?? fallback;
  const inputProps = (name: string) => ({
    id: `${prefix}-${name}`, name,
    'aria-invalid': Boolean(state.errors?.[name]),
    'aria-describedby': state.errors?.[name] ? `${prefix}-${name}-error` : undefined,
  });
  const fieldValue = (field: (typeof GOODS_NOTICE_FIELDS)[number]) => value(field.formName, editingPreset?.notice[field.key] ?? '');
  /* 되읽기 한 줄은 지금 적힌 칸을 따라간다. 저장 결과로 칸이 다시 그려지면(attempt) 그 값부터 다시 읽는다. */
  const [typed, setTyped] = useState<{ attempt: number | undefined; filled: readonly GoodsNoticeKey[] } | null>(null);
  const filled = typed && typed.attempt === state.attempt
    ? typed.filled
    : GOODS_NOTICE_FIELDS.filter((field) => fieldValue(field).trim()).map((field) => field.key);

  // Keep the form's controlled KC selects until the keyed fieldset restores the
  // action result. A handled failure must not invoke the native action reset.
  return <form action={action} className={`flex min-w-0 flex-col gap-4${inset ? ' p-4 sm:p-6' : ''}`} onInput={(event) => {
    const next = filledNoticeKeys(event.currentTarget);
    if (next.join() !== filled.join()) setTyped({ attempt: state.attempt, filled: next });
  }} onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }}>
    <fieldset className="flex min-w-0 flex-col gap-6 disabled:opacity-65" key={state.attempt ?? 0} disabled={pending}>
      <input name="id" type="hidden" value={preset?.id ?? ''} />
      <input name="updatedAt" type="hidden" value={value('updatedAt', editingPreset?.updatedAt ?? '')} />
      <AdminField label="템플릿 이름" inputId={`${prefix}-name`} error={state.errors?.name} hint={NAME_HINT}>
        <Input {...inputProps('name')} aria-describedby={state.errors?.name ? `${prefix}-name-hint ${prefix}-name-error` : `${prefix}-name-hint`}
          className="sm:max-w-md" required maxLength={GOODS_NOTICE_PRESET_NAME_MAX}
          defaultValue={value('name', editingPreset?.name ?? '')} placeholder="아크릴 키링" />
      </AdminField>
      <div className="flex min-w-0 flex-col gap-3">
        <AdminFormGrid>
          {GOODS_NOTICE_FIELDS.map((field) => {
            const placeholder = PER_GOOD_KEYS.has(field.key) ? PER_GOOD_PLACEHOLDER : field.placeholder;
            return field.key === 'origin'
              ? <NoticePresetOriginField key={field.key} defaultValue={fieldValue(field)} error={state.errors?.[field.formName]}
                  inputProps={inputProps(field.formName)} label={field.label} placeholder={placeholder} />
              : <AdminField key={field.key} label={field.label} inputId={`${prefix}-${field.formName}`} error={state.errors?.[field.formName]}>
                  <Input {...inputProps(field.formName)} maxLength={GOODS_NOTICE_PRESET_FIELD_MAX} defaultValue={fieldValue(field)} placeholder={placeholder} />
                </AdminField>;
          })}
        </AdminFormGrid>
        <GoodReadback>{noticePresetReadback(filled)}</GoodReadback>
      </div>
      <GoodsKcPresetFields template={editingPreset?.kcTemplate} raw={state.values?.kcTemplate} error={state.errors?.kcTemplate}/>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Button type="submit">{pending ? '저장 중…' : preset ? '템플릿 수정 저장' : '템플릿 등록'}</Button>
        {preset ? <GoodsNoticePresetDeleteButton preset={preset} /> : null}
      </div>
    </fieldset>
    {state.errors?.form ? <p className="text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
    {state.message && !closeDialog ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
  </form>;
}
