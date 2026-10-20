/** External workflow locks omit every control from FormData without clearing
 * its DOM value. A locked form has no readable snapshot, not an empty draft.
 * Disabled fieldsets inside the form retain their normal submission semantics.
 */
export function readAdminFormData(form: HTMLFormElement): FormData | null {
  return form.closest('fieldset:disabled') ? null : new FormData(form);
}
