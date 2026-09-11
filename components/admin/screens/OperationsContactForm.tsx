'use client';

import { useActionState, useState } from 'react';
import { saveOperationsContactAction, type OperationsContactActionState } from '@/app/admin/operations-contact-actions';
import { AdminField, AdminFormGrid } from '@/components/admin/console/AdminKit';
import { OPERATIONS_CONTACT_FIELDS, operationsContactValues, type OperationsContact, type OperationsContactValues } from '@/lib/admin/operations-contacts';

export function OperationsContactForm({ contact, canEdit }: { contact: OperationsContact; canEdit: boolean }) {
  const [values, setValues] = useState(() => operationsContactValues(contact));
  // Keep the version tied to these inputs. A different form's revalidation must
  // not advance an unsaved draft to someone else's newer database version.
  const [initialVersion] = useState(contact.updatedAt);
  const [state, action, pending] = useActionState<OperationsContactActionState, FormData>(saveOperationsContactAction, {});
  const version = state.updatedAt === undefined ? initialVersion : state.updatedAt;
  const formId = `operations-contact-${contact.originId ?? 'general'}`;
  return <form action={action} className="admin-operations__form" aria-label={`${contact.scope === 'operations' ? '운영 총괄' : contact.originName} 담당자 정보`}>
    <input type="hidden" name="scope" value={contact.scope}/>
    <input type="hidden" name="originId" value={contact.originId ?? ''}/>
    <input type="hidden" name="updatedAt" value={version ?? ''}/>
    <AdminFormGrid>{Object.entries(OPERATIONS_CONTACT_FIELDS).map(([field, config]) => {
      const key = field as keyof OperationsContactValues;
      const inputId = `${formId}-${key}`;
      return <AdminField key={key} label={config.label} inputId={inputId} hint={config.hint} error={state.errors?.[key]}>
        <input id={inputId} name={key} value={values[key]} maxLength={config.maxLength} readOnly={!canEdit} disabled={pending}
          onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))}
          aria-invalid={Boolean(state.errors?.[key])} aria-describedby={`${inputId}-hint${state.errors?.[key] ? ` ${inputId}-error` : ''}`}/>
      </AdminField>;
    })}</AdminFormGrid>
    {state.errors?.form ? <p className="wc-admin-kit__error" role="alert">{state.errors.form}</p> : null}
    {state.message ? <p role="status">{state.message}</p> : null}
    {canEdit ? <button className="btn" type="submit" disabled={pending}>{pending ? '저장 중…' : '담당자 정보 저장'}</button> : null}
  </form>;
}
