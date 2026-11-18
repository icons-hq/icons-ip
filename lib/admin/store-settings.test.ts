import { describe, expect, it } from 'vitest';
import { mergeBusinessInfo, parseStoreSettingsInput, parseCarrierFormatInput, parseCarrierInput,storeSettingsHistoryRows } from './store-settings';
import type { BusinessInfo } from '@/lib/legal/business-info';
import { DEFAULT_STORE_BRANDING } from '@/lib/store-branding';
import { DEFAULT_STORE_NAVIGATION } from '@/lib/store-navigation';

const business: BusinessInfo = { companyName:'회사',representative:'대표',registrationNumber:'123',mailOrderNumber:'신고',address:'주소',phone:'02-000-0000',email:'cs@example.test',hostingProvider:'호스팅' };
describe('운영 설정 입력 계약', () => {
  it('미설정 키만 기존 사업자값으로 채우고 명시적으로 비운 연락처는 숨긴다', () => {
    expect(mergeBusinessInfo({ phone:'',email:'new@example.test',unknown:'ignored' },business))
      .toEqual({ ...business,phone:'',email:'new@example.test' });
  });
  it('은행 세 값이 전부 비었으면 비활성, 일부 입력은 오류다', () => {
    expect(parseStoreSettingsInput('bank_transfer',{bank:'',accountNumber:'',holder:''})).toEqual({ok:true,value:{bank:'',accountNumber:'',holder:''}});
    expect(parseStoreSettingsInput('bank_transfer',{bank:'은행',accountNumber:'',holder:''})).toMatchObject({ok:false});
    expect(parseStoreSettingsInput('bank_transfer',{bank:'은행',accountNumber:'123-456',holder:'회사'})).toMatchObject({ok:true});
  });
  it('설정은 알려진 키와 문자열만 수용한다', () => {
    expect(parseStoreSettingsInput('business',{email:'bad-address'})).toMatchObject({ok:false});
    expect(parseStoreSettingsInput('business',{phone:100})).toMatchObject({ok:false});
    expect(parseStoreSettingsInput('business',{unknown:'value'})).toMatchObject({ok:false});
  });
  it('조회 URL은 HTTPS와 운송장 자리표시자를 요구한다', () => {
    const carrier={code:'demo',label:'연습택배',trackingUrlTemplate:'https://carrier.example.test/{trackingNumber}',active:true};
    expect(parseCarrierInput(carrier)).toMatchObject({ok:true});
    for (const url of ['javascript:alert(1)','https://carrier.example.test/','https://user:pass@carrier.example.test/{trackingNumber}','https:///{trackingNumber}']) {
      expect(parseCarrierInput({...carrier,trackingUrlTemplate:url})).toMatchObject({ok:false});
    }
  });
});

it('설정 이력은 변경된 항목만 운영 라벨로 보여준다',()=>{
  expect(storeSettingsHistoryRows({id:'audit',actorName:'관리자',action:'saved',target:'store',createdAt:'now',diff:{before:{phone:'old',email:'same',updated_at:'old'},after:{phone:'new',email:'same',updated_at:'new'}}}))
    .toEqual([{key:'phone',label:'전화',before:'old',after:'new'}]);
});

it('브랜드 이력은 로고 방식과 SNS 변경을 개별 항목으로 표시한다',()=>{
  const before=DEFAULT_STORE_BRANDING;
  const after={...before,logoMode:'image',socials:{...before.socials,instagram:{enabled:true,url:'https://instagram.com/shop/'}}};
  expect(storeSettingsHistoryRows({id:'audit',actorName:'관리자',action:'saved',target:'store_settings:branding',createdAt:'now',diff:{before,after}})).toEqual([
    {key:'logoMode',label:'로고 표시 방식',before:'텍스트',after:'이미지'},
    {key:'instagram.enabled',label:'인스타그램 · 노출',before:'비활성',after:'사용'},
    {key:'instagram.url',label:'인스타그램 · 주소',before:'',after:'https://instagram.com/shop/'},
  ]);
});

it('공개 메뉴 이력은 순서·이름·노출 변경을 구분한다',()=>{
  const before=DEFAULT_STORE_NAVIGATION;
  const after=[...before].reverse().map(item=>item.id==='new'?{...item,label:'신상품',visible:false}:item);
  const rows=storeSettingsHistoryRows({id:'audit',actorName:'관리자',action:'saved',target:'store_settings:navigation',createdAt:'now',diff:{before,after}});
  expect(rows).toContainEqual({key:'new.order',label:'NEW · 순서',before:'1',after:'9'});
  expect(rows).toContainEqual({key:'new.label',label:'NEW · 메뉴명',before:'NEW',after:'신상품'});
  expect(rows).toContainEqual({key:'new.visible',label:'NEW · 노출',before:'사용',after:'비활성'});
});

describe('택배사 운송장 형식 입력 (SHP-032)', () => {
  it('형식·안내 문구·확인용 번호를 함께 받고, 둘 다 비우면 형식을 지운다', () => {
    expect(parseCarrierFormatInput({ pattern: ' ^[0-9]{10,14}$ ', rule: ' 숫자 10~14자리 ', sample: '1234-5678-9012-34' }))
      .toEqual({ ok: true, value: { pattern: '^[0-9]{10,14}$', rule: '숫자 10~14자리', sample: '12345678901234' } });
    expect(parseCarrierFormatInput({ pattern: '', rule: '', sample: 'anything' })).toEqual({ ok: true, value: { pattern: '', rule: '', sample: '' } });
  });
  it('전체 일치가 아니거나 읽을 수 없는 식, 한쪽만 있는 입력, 확인용 번호가 맞지 않는 입력을 거절한다', () => {
    expect(parseCarrierFormatInput({ pattern: '[0-9]{12}', rule: '숫자 12자리', sample: '123456789012' })).toMatchObject({ ok: false, errors: { trackingNumberPattern: expect.any(String) } });
    expect(parseCarrierFormatInput({ pattern: '^([0-9]$', rule: '깨진 식', sample: '123456789012' })).toMatchObject({ ok: false, errors: { trackingNumberPattern: expect.stringContaining('정규식') } });
    expect(parseCarrierFormatInput({ pattern: '^[0-9]{12}$', rule: '', sample: '123456789012' })).toMatchObject({ ok: false, errors: { trackingNumberRule: expect.any(String) } });
    expect(parseCarrierFormatInput({ pattern: '', rule: '숫자 12자리', sample: '' })).toMatchObject({ ok: false, errors: { trackingNumberPattern: expect.any(String) } });
    expect(parseCarrierFormatInput({ pattern: '^[0-9]{12}$', rule: '숫자 12자리', sample: '1234567890' })).toMatchObject({ ok: false, errors: { trackingNumberSample: expect.any(String) } });
  });
  it('변경 이력은 운송장 형식과 안내 문구의 전후를 보여 준다', () => {
    expect(storeSettingsHistoryRows({ id: 'a', actorName: '관리자', action: 'admin.shipping_carrier.saved', target: 'shipping_carriers:hanjin', createdAt: '2026-11-18T00:00:00Z',
      diff: { before: { tracking_number_pattern: '^[0-9]{10,14}$', tracking_number_rule: '숫자 10~14자리' }, after: { tracking_number_pattern: null, tracking_number_rule: null } } }))
      .toEqual([
        { key: 'tracking_number_pattern', label: '운송장 형식', before: '^[0-9]{10,14}$', after: '미설정' },
        { key: 'tracking_number_rule', label: '운송장 형식 안내', before: '숫자 10~14자리', after: '미설정' },
      ]);
  });
});
