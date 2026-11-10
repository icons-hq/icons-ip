import { describe, expect, it } from 'vitest';
import { normalizeShoppingStoryInput, normalizeShoppingStoryFilters, storyDatePreset, storyKstToIso } from './shopping-stories';
import { shoppingStoryState } from '../shopping-stories';
const section = (index: number, count: number, offset = 0) => ({ id: `11111111-1111-4111-8111-${String(index).padStart(12,'0')}`, title: '관련상품', imageShape: 'square', goodIds: Array.from({length: count}, (_, i) => `good-${i + offset}`) });
const input = { title: '스토리', bodyHtml: '<p>본문</p>', startsAt: null, endsAt: null, sections: [] };
describe('shopping story input and period contract', () => {
  it('accepts no related goods and normalizes safe HTML and Unicode title length', () => {
    expect(normalizeShoppingStoryInput({...input,title:' 🐻 '.repeat(17).trim()} ).ok).toBe(true);
    expect(normalizeShoppingStoryInput({...input,title:'🐻'.repeat(51)}).ok).toBe(false);
    expect(normalizeShoppingStoryInput({...input,bodyHtml:'<script>bad()</script>'}).ok).toBe(false);
    expect(normalizeShoppingStoryInput({...input,unknown:true}).ok).toBe(false);
  });
  it('enforces independent section, title, per-section, total and duplicate limits', () => {
    expect(normalizeShoppingStoryInput({...input,sections:[section(1,200),section(2,100,200)]}).ok).toBe(true);
    for (const sections of [[section(1,201)], [section(1,200),section(2,101,200)], [section(1,1),section(2,1)], Array.from({length:11}, (_,i)=>section(i+1,1,i)), [{...section(1,1),title:'가'.repeat(14)}], [section(1,0)]]) expect(normalizeShoppingStoryInput({...input,sections}).ok).toBe(false);
  });
  it('rejects impossible calendar dates and respects inclusive start/exclusive end', () => {
    expect(storyKstToIso('2026-02-30T10:00')).toBeNull(); expect(storyKstToIso('2026-10-13T09:00')).toBe('2026-10-13T00:00:00.000Z');
    const start='2026-10-13T00:00:00Z', end='2026-10-14T00:00:00Z';
    expect(shoppingStoryState(start,end,Date.parse(start)-1)).toBe('scheduled'); expect(shoppingStoryState(start,end,Date.parse(start))).toBe('active'); expect(shoppingStoryState(start,end,Date.parse(end))).toBe('ended');
    expect(normalizeShoppingStoryInput({...input,startsAt:end,endsAt:start}).ok).toBe(false);
    expect(normalizeShoppingStoryInput({...input,startsAt:'2026-02-30T00:00:00Z'}).ok).toBe(false);
    expect(normalizeShoppingStoryInput({...input,startsAt:'1'}).ok).toBe(false);
  });
  it('defaults to three KST months and 100 rows, preserves all-period and clamps invalid query', () => {
    expect(storyDatePreset(1,new Date('2026-03-31T00:00:00Z'))).toEqual({from:'2026-02-28',to:'2026-03-31'});
    expect(normalizeShoppingStoryFilters({}, new Date('2026-10-12T18:00:00Z'))).toMatchObject({from:'2026-07-13',to:'2026-10-13',pageSize:100,state:'all'});
    expect(normalizeShoppingStoryFilters({from:'',to:'',page:'0',pageSize:'1000',state:'bad'})).toMatchObject({from:'',to:'',page:1,pageSize:100,state:'all'});
  });
});
