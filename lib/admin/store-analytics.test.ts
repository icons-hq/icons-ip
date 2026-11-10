import { describe,expect,it } from 'vitest';
import { NOTICE_PLACEMENT_LABELS,noticeTrafficTitle,trafficDifference,trafficFilters,trafficHref,trafficLabel,trafficNumber } from './store-analytics';
const now=new Date('2026-10-13T02:00:00Z');
describe('visit report filters and unknown measurements',()=>{
 it('uses KST date and bounded days, rejects invalid/custom future ranges',()=>{
  expect(trafficFilters({},false,now)).toMatchObject({from:'2026-10-07',to:'2026-10-13',dimension:'channel',compare:'previous'});
  expect(trafficFilters({from:'2026-08-15',to:'2026-10-13'},false,now).error).toBeUndefined();
  for(const query of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-08-14',to:'2026-10-13'},{from:'2026-10-14',to:'2026-10-14'}])expect(trafficFilters(query,false,now).error).toBeTruthy();
  expect(trafficFilters({dimension:'good',page:'1.2'},true,now)).toMatchObject({dimension:'link',page:1});
 });
 it('preserves selected period in drilldown and never turns missing data into zero',()=>{
  const href=trafficHref('/admin/stats/traffic',trafficFilters({},false,now),{key:'social/instagram/social',page:2});
  expect(href).toContain('from=2026-10-07');expect(href).toContain('key=social%2Finstagram%2Fsocial');
  expect(trafficNumber(null)).toBe('미측정');expect(trafficNumber(0)).toBe('0');expect(trafficDifference(5,null)).toBe('비교 불가');expect(trafficDifference(3,2,true)).toBe('+1%p');
  expect(trafficLabel('channel','social/instagram/social','')).toContain('Instagram');
 });
 it('labels shell notice rows and keeps a deleted notice visible as such',()=>{
  expect(NOTICE_PLACEMENT_LABELS).toEqual({notice_bar:'텍스트 공지 바',notice_strip:'상단 띠배너'});
  expect(noticeTrafficTitle({title:'  배송 안내 '})).toBe('배송 안내');expect(noticeTrafficTitle({title:null})).toBe('삭제된 공지');
 });
});
