import { describe, expect, it } from 'vitest';
import { mergeBusinessInfo, parseStoreSettingsInput, parseCarrierInput,storeSettingsHistoryRows } from './store-settings';
import type { BusinessInfo } from '@/lib/legal/business-info';

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
