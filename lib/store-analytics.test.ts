import { describe, expect, it } from 'vitest';
import { analyticsAcquisition, analyticsChoice, analyticsPage, parseAnalyticsEvent } from './store-analytics';
const id='11111111-1111-4111-8111-111111111111';
const event={eventId:id,pageKind:'good',targetId:'test-good',linkToken:null,channel:'direct',source:'none',medium:'none'};
describe('optional store analytics privacy boundary',()=>{
 it('requires versioned opt-in and excludes every private surface',()=>{
  expect(analyticsChoice('analytics-v1:yes')).toBe('accepted');expect(analyticsChoice('true')).toBe('unset');expect(analyticsChoice('old:yes')).toBe('unset');
  for(const path of ['/admin','/my','/checkout','/orders/secret','/login','/search','/m/'+ 'a'.repeat(32)])expect(analyticsPage(path,new URLSearchParams())).toBeNull();
 });
 it('projects only finite public identifiers and a verified-shape reserved link parameter',()=>{
  expect(analyticsPage('/shop',new URLSearchParams(`category=${id}&q=email%40example.test&icm=${'a'.repeat(32)}`))).toEqual({kind:'shop',target:id,linkToken:'a'.repeat(32)});
  expect(analyticsPage('/shop',new URLSearchParams('category=personal-data&icm=raw-token'))).toEqual({kind:'shop',target:'all',linkToken:null});
  expect(analyticsPage('/shop/email@example.test',new URLSearchParams())).toBeNull();
  expect(analyticsPage('/stories/'+id,new URLSearchParams())?.kind).toBe('story');
 });
 it('never sends unknown UTM or referrer path/query and rejects lookalike hosts',()=>{
  expect(analyticsAcquisition(new URLSearchParams('utm_source=person%40example.test&utm_campaign=secret&utm_term=phone'), 'https://naver.com/search?email=private','https://iconsip.com')).toEqual({channel:'search',source:'naver',medium:'organic'});
  expect(analyticsAcquisition(new URLSearchParams(), 'https://naver.com.evil.test/secret','https://iconsip.com')).toEqual({channel:'referral',source:'other',medium:'referral'});
  expect(analyticsAcquisition(new URLSearchParams('utm_source=instagram&utm_medium=paid_social&utm_content=private'),'','https://iconsip.com')).toEqual({channel:'paid',source:'instagram',medium:'paid_social'});
  expect(analyticsAcquisition(new URLSearchParams(),'https://google.com/path?q=secret','https://iconsip.com',true)).toEqual({channel:'internal',source:'icons',medium:'internal'});
 });
 it('rejects extra fields, raw source strings, invalid targets, and identifier override payloads',()=>{
  expect(parseAnalyticsEvent(event)).toEqual(event);
  for(const patch of [{userId:id},{token:'session-secret'},{referrer:'https://example.test'},{source:'email@example.test'},{pageKind:'checkout'},{targetId:'secret@example.test'},{eventId:'invalid'}])expect(parseAnalyticsEvent({...event,...patch})).toBeNull();
 });
});
