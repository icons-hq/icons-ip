import { describe, expect, it } from 'vitest';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  formatAdminCatalogRecordLabel,
} from './catalog-archive';

const records = [
  { id: 'active-1', archivedAt: null },
  { id: 'archived-1', archivedAt: '2026-07-17T00:00:00.000Z' },
  { id: 'active-2', archivedAt: null },
];

describe('admin catalog archive presentation', () => {
  it('filters active, archived, and all records without mutating their order', () => {
    expect(filterAdminCatalogRecords(records, 'active').map((record) => record.id)).toEqual([
      'active-1',
      'active-2',
    ]);
    expect(filterAdminCatalogRecords(records, 'archived').map((record) => record.id)).toEqual([
      'archived-1',
    ]);
    expect(filterAdminCatalogRecords(records, 'all')).toEqual(records);
  });

  it('reports stable counts and marks archived list labels', () => {
    expect(adminCatalogArchiveCounts(records)).toEqual({ active: 2, archived: 1, all: 3 });
    expect(formatAdminCatalogRecordLabel('active-1 · 운영 항목', null)).toBe('active-1 · 운영 항목');
    expect(formatAdminCatalogRecordLabel('archived-1 · 보관 항목', records[1].archivedAt)).toBe(
      '[보관] archived-1 · 보관 항목',
    );
  });
});
