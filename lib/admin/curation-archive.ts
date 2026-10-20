import { isUuid } from '@/lib/uuid';

export const ARCHIVED_HERO_PAGE_SIZE = 20;

export interface ArchivedHeroBanner {
  id: string;
  title: string;
  imageUrl: string | null;
  archivedAt: string;
  updatedAt: string;
}

export interface ArchivedHeroPage {
  rows: ArchivedHeroBanner[];
  total: number;
  page: number;
}

export interface CurationArchiveRequest {
  operationId: string;
  id: string;
  expectedUpdatedAt: string;
  archive: boolean;
}

export function parseCurationArchiveRequest(form: FormData): CurationArchiveRequest | null {
  const operationId = form.get('operationId');
  const id = form.get('id');
  const expectedUpdatedAt = form.get('expectedUpdatedAt');
  const archive = form.get('archive');
  if (!isUuid(operationId) || !isUuid(id) || typeof expectedUpdatedAt !== 'string'
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(expectedUpdatedAt)
    || Number.isNaN(Date.parse(expectedUpdatedAt)) || (archive !== 'true' && archive !== 'false')) return null;
  return { operationId, id, expectedUpdatedAt, archive: archive === 'true' };
}

export function curationArchiveForm(request: CurationArchiveRequest): FormData {
  const form = new FormData();
  form.set('operationId', request.operationId);
  form.set('id', request.id);
  form.set('expectedUpdatedAt', request.expectedUpdatedAt);
  form.set('archive', String(request.archive));
  return form;
}
