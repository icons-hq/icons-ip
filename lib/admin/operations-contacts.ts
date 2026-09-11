export const OPERATIONS_SETTINGS_PATH = '/admin/settings/operations';

export const OPERATIONS_CONTACT_FIELDS = {
  ownerName: { label: '담당자 이름', maxLength: 100, hint: '운영 총괄 또는 해당 출고지의 담당자를 입력합니다.' },
  contact: { label: '업무 연락처', maxLength: 200, hint: '업무용 이메일이나 전화번호를 입력합니다.' },
  sourceReference: { label: '운영 자료 위치', maxLength: 500, hint: '계약서·요율표·ERP·KC 자료를 보관한 사내 문서 주소나 폴더 경로입니다.' },
  handoffReference: { label: '인수 기록 위치', maxLength: 500, hint: '확인 회신이나 인수 기록의 문서 주소·경로를 입력합니다.' },
} as const;

export type OperationsContactScope = 'operations' | 'origin';
export type OperationsContactValues = Record<keyof typeof OPERATIONS_CONTACT_FIELDS, string>;
export type OperationsContact = OperationsContactValues & {
  scope: OperationsContactScope;
  originId: string | null;
  originName: string | null;
  originActive: boolean | null;
  updatedAt: string | null;
  updatedByName: string | null;
};
export type OperationsContactHistory = {
  id: string;
  actorName: string;
  scope: OperationsContactScope;
  originName: string | null;
  changedFields: string[];
  createdAt: string;
};

export function operationsContactValues(contact: OperationsContactValues): OperationsContactValues {
  return { ownerName: contact.ownerName, contact: contact.contact, sourceReference: contact.sourceReference, handoffReference: contact.handoffReference };
}

export function parseOperationsContactValues(input: unknown):
  { ok: true; value: OperationsContactValues } | { ok: false; errors: Record<string, string> } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: { form: '담당자 정보를 다시 확인해주세요.' } };
  }
  const entries = Object.entries(input);
  if (entries.length !== 4 || entries.some(([key, value]) => !Object.hasOwn(OPERATIONS_CONTACT_FIELDS, key) || typeof value !== 'string')) {
    return { ok: false, errors: { form: '담당자 정보의 네 항목을 모두 보내주세요.' } };
  }
  const errors: Record<string, string> = {};
  const value = Object.fromEntries(entries.map(([key, raw]) => {
    const field = OPERATIONS_CONTACT_FIELDS[key as keyof OperationsContactValues];
    const text = (raw as string).trim();
    if ([...text].length > field.maxLength || /[\u0000-\u001f\u007f]/.test(raw as string)) {
      errors[key] = `${field.maxLength}자 이내의 한 줄로 입력해주세요.`;
    }
    return [key, text];
  })) as OperationsContactValues;
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

export function validOperationsContactTarget(scope: string, originId: string): scope is OperationsContactScope {
  return scope === 'operations' ? originId === ''
    : scope === 'origin' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(originId);
}

export function validOperationsContactVersion(value: string): boolean {
  return value === '' || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
}
