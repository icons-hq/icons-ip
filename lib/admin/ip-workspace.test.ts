import { describe, expect, it } from 'vitest';
import { ipWorkspaceHref, newGoodForIpHref, normalizeIpIndexFilters, normalizeIpWorkspaceTab } from './ip-workspace';

describe('IP workspace navigation', () => {
  it('preserves the parent IP when starting a new goods form and normalizes page inputs', () => {
    expect(newGoodForIpHref('hwasan')).toBe('/admin/catalog/goods?ipId=hwasan&create=1');
    expect(ipWorkspaceHref('hwasan', 'goods')).toBe('/admin/catalog/ips/hwasan?tab=goods');
    expect(normalizeIpWorkspaceTab('unknown')).toBe('basic');
    expect(normalizeIpIndexFilters({ q: ' 화산 ', vertical: 'webtoon', page: '-4', status: 'bad' }))
      .toEqual({ query: '화산', vertical: 'webtoon', page: 1, status: 'active' });
  });
});
