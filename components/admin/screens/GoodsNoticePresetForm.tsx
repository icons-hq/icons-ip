'use client';

import { startTransition, useActionState, useId, useState } from 'react';
import {
  deleteGoodsNoticePresetAction, saveGoodsNoticePresetAction, type GoodsNoticePresetActionState,
} from '@/app/admin/goods-notice-preset-actions';
import { AdminField, AdminFormGrid } from '@/components/admin/console/AdminKit';
import { useAdminCreateDialogBusy } from '@/components/admin/console/AdminCreateDialogButton';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { GoodsKcPresetFields } from '@/components/admin/GoodsKcPresetFields';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import {
  GOODS_NOTICE_PRESET_FIELD_MAX, GOODS_NOTICE_PRESET_NAME_MAX, type GoodsNoticePreset,
} from '@/lib/admin/goods-notice-presets';

const EMPTY_STATE: GoodsNoticePresetActionState = {};

/** `inset`: 접는 목록 안에서는 자기 여백을 두고, 등록 팝업 안에서는 팝업 본문 여백을 쓴다. */
export function GoodsNoticePresetForm({ preset, inset = true }: { preset?: GoodsNoticePreset; inset?: boolean }) {
  const [state, action, pending] = useActionState(saveGoodsNoticePresetAction, EMPTY_STATE);
  /* 등록 팝업 안에서 저장을 기다리는 동안 팝업을 닫지 못하게 한다(목록 안 수정 폼에서는 아무 일도 하지 않는다). */
  useAdminCreateDialogBusy(pending);
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

  // Keep the form's controlled KC selects until the keyed fieldset restores the
  // action result. A handled failure must not invoke the native action reset.
  return <form action={action} className={`flex min-w-0 flex-col gap-4${inset ? ' p-4 sm:p-6' : ''}`} onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }}>
    <fieldset className="flex min-w-0 flex-col gap-6 disabled:opacity-65" key={state.attempt ?? 0} disabled={pending}>
      <input name="id" type="hidden" value={preset?.id ?? ''} />
      <input name="updatedAt" type="hidden" value={value('updatedAt', editingPreset?.updatedAt ?? '')} />
      <AdminField label="프리셋 이름" inputId={`${prefix}-name`} error={state.errors?.name}>
        <Input {...inputProps('name')} className="sm:max-w-md" required maxLength={GOODS_NOTICE_PRESET_NAME_MAX}
          defaultValue={value('name', editingPreset?.name ?? '')} placeholder="아크릴 기본" />
      </AdminField>
      <AdminFormGrid>
        {GOODS_NOTICE_FIELDS.map((field) => <AdminField key={field.key} label={field.label}
          inputId={`${prefix}-${field.formName}`} error={state.errors?.[field.formName]}>
          <Input {...inputProps(field.formName)} required maxLength={GOODS_NOTICE_PRESET_FIELD_MAX}
            defaultValue={value(field.formName, editingPreset?.notice[field.key] ?? '')} placeholder={field.placeholder} />
        </AdminField>)}
      </AdminFormGrid>
      <GoodsKcPresetFields template={editingPreset?.kcTemplate} raw={state.values?.kcTemplate} error={state.errors?.kcTemplate}/>
      <Button className="self-start" type="submit">{pending ? '저장 중…' : preset ? '프리셋 수정 저장' : '프리셋 등록'}</Button>
    </fieldset>
    {state.errors?.form ? <p className="text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
    {state.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
  </form>;
}

export function GoodsNoticePresetDeleteForm({ preset }: { preset: GoodsNoticePreset }) {
  const [state, action, pending] = useActionState(deleteGoodsNoticePresetAction, EMPTY_STATE);
  return <details className="px-4 pb-4 sm:px-6 sm:pb-6" data-notice-presets="delete">
    <summary className="flex min-h-9 w-fit cursor-pointer items-center text-sm font-medium text-destructive underline-offset-4 hover:underline">프리셋 삭제</summary>
    <form action={action} className="mt-2 flex flex-col gap-3 rounded-lg border border-danger-border bg-danger-soft p-4">
      <input name="id" type="hidden" value={preset.id} />
      <input name="updatedAt" type="hidden" value={preset.updatedAt} />
      <p className="text-sm">프리셋을 삭제해도 기존 상품에 입력된 값은 바뀌지 않습니다.</p>
      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm"><input name="confirmed" type="checkbox" required value="true" disabled={pending} /> 이 프리셋을 삭제하겠습니다.</label>
      <Button className="self-start" variant="destructive" disabled={pending} type="submit">{pending ? '삭제 중…' : '삭제 확정'}</Button>
      {state.errors?.form ? <p className="text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
      {state.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
    </form>
  </details>;
}
