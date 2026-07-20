export type AdminCatalogArchiveFilter = 'active' | 'archived' | 'all';

export interface AdminCatalogArchivableRecord {
  archivedAt: string | null;
}

export function filterAdminCatalogRecords<T extends AdminCatalogArchivableRecord>(
  records: readonly T[],
  filter: AdminCatalogArchiveFilter,
): T[] {
  if (filter === 'all') return [...records];
  const archived = filter === 'archived';
  return records.filter((record) => Boolean(record.archivedAt) === archived);
}

export function adminCatalogArchiveCounts(records: readonly AdminCatalogArchivableRecord[]) {
  const archived = records.filter((record) => Boolean(record.archivedAt)).length;
  return {
    active: records.length - archived,
    archived,
    all: records.length,
  };
}

export function formatAdminCatalogRecordLabel(label: string, archivedAt: string | null) {
  return archivedAt ? `[보관] ${label}` : label;
}
