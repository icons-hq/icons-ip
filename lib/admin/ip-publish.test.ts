import { describe, expect, it } from 'vitest';
import {
  adminIpPublishState,
  adminIpPublishStateLabel,
  formatAdminIpRecordLabel,
} from './ip-publish';

const at = '2026-09-07T04:00:00.000Z';

describe('adminIpPublishState', () => {
  it.each([
    [{ archivedAt: null, publishedAt: null }, 'draft', '초안'],
    [{ archivedAt: null, publishedAt: at }, 'published', '공개'],
    [{ archivedAt: at, publishedAt: null }, 'archived', '보관'],
    /* 보관이 게시보다 우선한다 — 보관된 IP 는 게시 이력이 있어도 노출되지 않는다. */
    [{ archivedAt: at, publishedAt: at }, 'archived', '보관'],
  ] as const)('derives %j as %s (%s)', (record, state, label) => {
    expect(adminIpPublishState(record)).toBe(state);
    expect(adminIpPublishStateLabel(record)).toBe(label);
  });
});

describe('formatAdminIpRecordLabel', () => {
  it('marks drafts and archived records and leaves published labels alone', () => {
    expect(formatAdminIpRecordLabel('hwasan · 화산강림', { archivedAt: null, publishedAt: null }))
      .toBe('[초안] hwasan · 화산강림');
    expect(formatAdminIpRecordLabel('hwasan · 화산강림', { archivedAt: null, publishedAt: at }))
      .toBe('hwasan · 화산강림');
    expect(formatAdminIpRecordLabel('hwasan · 화산강림', { archivedAt: at, publishedAt: at }))
      .toBe('[보관] hwasan · 화산강림');
  });
});
