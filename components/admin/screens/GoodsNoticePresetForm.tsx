'use client';

import { useActionState, useId, useState } from 'react';
import {
  deleteGoodsNoticePresetAction, saveGoodsNoticePresetAction, type GoodsNoticePresetActionState,
} from '@/app/admin/goods-notice-preset-actions';
import { AdminField, AdminFormGrid } from '@/components/admin/console/AdminKit';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import {
  GOODS_NOTICE_PRESET_FIELD_MAX, GOODS_NOTICE_PRESET_NAME_MAX, type GoodsNoticePreset,
} from '@/lib/admin/goods-notice-presets';

const EMPTY_STATE: GoodsNoticePresetActionState = {};

export function GoodsNoticePresetForm({ preset }: { preset?: GoodsNoticePreset }) {
  const [state, action, pending] = useActionState(saveGoodsNoticePresetAction, EMPTY_STATE);
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

  return <form action={action} className="admin-notice-presets__form">
    <fieldset key={state.attempt ?? 0} disabled={pending}>
      <input name="id" type="hidden" value={preset?.id ?? ''} />
      <input name="updatedAt" type="hidden" value={value('updatedAt', editingPreset?.updatedAt ?? '')} />
      <AdminField label="프리셋 이름" inputId={`${prefix}-name`} error={state.errors?.name}>
        <input {...inputProps('name')} required maxLength={GOODS_NOTICE_PRESET_NAME_MAX}
          defaultValue={value('name', editingPreset?.name ?? '')} placeholder="아크릴 기본" />
      </AdminField>
      <AdminFormGrid>
        {GOODS_NOTICE_FIELDS.map((field) => <AdminField key={field.key} label={field.label}
          inputId={`${prefix}-${field.formName}`} error={state.errors?.[field.formName]}>
          <input {...inputProps(field.formName)} required maxLength={GOODS_NOTICE_PRESET_FIELD_MAX}
            defaultValue={value(field.formName, editingPreset?.notice[field.key] ?? '')} placeholder={field.placeholder} />
        </AdminField>)}
      </AdminFormGrid>
      <button className="wc-admin-kit__button" type="submit">{pending ? '저장 중…' : preset ? '프리셋 수정 저장' : '프리셋 등록'}</button>
    </fieldset>
    {state.errors?.form ? <p className="admin-notice-presets__error" role="alert">{state.errors.form}</p> : null}
    {state.message ? <p role="status">{state.message}</p> : null}
  </form>;
}

export function GoodsNoticePresetDeleteForm({ preset }: { preset: GoodsNoticePreset }) {
  const [state, action, pending] = useActionState(deleteGoodsNoticePresetAction, EMPTY_STATE);
  return <details className="admin-notice-presets__delete">
    <summary>프리셋 삭제</summary>
    <form action={action}>
      <input name="id" type="hidden" value={preset.id} />
      <input name="updatedAt" type="hidden" value={preset.updatedAt} />
      <p>프리셋을 삭제해도 기존 상품에 입력된 값은 바뀌지 않습니다.</p>
      <label><input name="confirmed" type="checkbox" required value="true" disabled={pending} /> 이 프리셋을 삭제하겠습니다.</label>
      <button className="wc-admin-kit__button" disabled={pending} type="submit">{pending ? '삭제 중…' : '삭제 확정'}</button>
      {state.errors?.form ? <p className="admin-notice-presets__error" role="alert">{state.errors.form}</p> : null}
      {state.message ? <p role="status">{state.message}</p> : null}
    </form>
  </details>;
}
