import { describe, expect, it } from 'vitest';
import { marketingSourceCapability, normalizeMarketingLinkFilters, parseMarketingLinkRows } from './marketing-links';
import { marketingDestination } from '@/lib/marketing-link-routing';
const row = { id: '80000000-0000-4000-8000-000000000001', token: 'a'.repeat(32), source: 'good', targetId: 'good-new', originalTargetId: 'good-old', title: '상품', available: true, createdAt: '2026-10-13T00:00:00Z' };
describe('marketing link contract', () => {
  it('limits paging and requires a known source', () => { expect(normalizeMarketingLinkFilters({ source: 'https://evil.test', page: '1.1', pageSize: '1000', status: 'other' })).toEqual({ source: 'home', query: '', status: 'all', page: 1, pageSize: 20 }); });
  it('separates original issuing capabilities from the marketing ledger', () => { expect(marketingSourceCapability('home')).toBe('store.manage'); expect(marketingSourceCapability('story')).toBe('store.manage'); expect(marketingSourceCapability('good')).toBe('catalog.manage'); expect(marketingSourceCapability('category')).toBe('catalog.manage'); });
  it('preserves renamed or deleted original targets but rejects malformed or duplicated output', () => {
    expect(parseMarketingLinkRows([row])).toEqual([row]); expect(parseMarketingLinkRows([{ ...row, targetId: null, available: false }])).not.toBeNull();
    expect(parseMarketingLinkRows([row, row])).toBeNull(); expect(parseMarketingLinkRows([{ ...row, token: '../login' }])).toBeNull(); expect(parseMarketingLinkRows([{ ...row, targetId: '//evil.test' }])).toBeNull();
  });
  it('builds only fixed destinations and filters all but single bounded UTM values', () => {
    expect(marketingDestination({ source: 'good', targetId: 'good-new' }, new URLSearchParams('utm_source=news&utm_medium=mail&nt=x&next=https://evil.test&token=secret'))).toBe('/shop/good-new?utm_source=news&utm_medium=mail');
    expect(marketingDestination({ source: 'home', targetId: 'home' }, new URLSearchParams(`utm_source=x&utm_source=y&utm_campaign=${'a'.repeat(201)}&utm_term=%0A&url=https://evil.test`))).toBe('/');
    expect(marketingDestination({ source: 'category', targetId: row.id }, new URLSearchParams('category=evil&utm_content=상세'))).toBe(`/shop?category=${row.id}&utm_content=%EC%83%81%EC%84%B8`);
    expect(marketingDestination({ source: 'story', targetId: row.id }, new URLSearchParams())).toBe(`/stories/${row.id}`);
    expect(marketingDestination({ source: 'home', targetId: 'home' }, new URLSearchParams('icm=untrusted'), 'a'.repeat(32))).toBe('/?icm=' + 'a'.repeat(32));
    expect(marketingDestination({ source: 'good', targetId: '//evil.test' }, new URLSearchParams())).toBeNull();
    expect(marketingDestination({ source: 'external', targetId: 'https://evil.test' }, new URLSearchParams())).toBeNull();
  });
});
