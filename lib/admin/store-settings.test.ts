import { describe, expect, it } from 'vitest';
import {
  carrierFormatLengthProblem, carrierFormatSpec, carrierInUseMessage, carrierInactiveUseNote, carrierOffUseNote, carrierRenamed, carrierSampleVerdict, carrierTrackingUrlError, carrierTurnOff,
  mergeBusinessInfo, originNamesLabel, parseCarrierFormatChoice, parseCarrierFormatInput, parseCarrierInput, parseStoreSettingsInput, readCarrierFormat, readCarrierFormatLength, storeSettingsHistoryRows,
  CARRIER_FORMAT_LENGTH_ERROR, CARRIER_FORMAT_STALE, CARRIER_RENAME_NOTE, CARRIER_SAMPLE_REQUIRED, CARRIER_TURN_OFF_UNKNOWN,
} from './store-settings';
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
    {key:'instagram.enabled',label:'인스타그램 · 노출',before:'사용 안 함',after:'사용'},
    {key:'instagram.url',label:'인스타그램 · 주소',before:'',after:'https://instagram.com/shop/'},
  ]);
});

it('공개 메뉴 이력은 순서·이름·노출 변경을 구분한다',()=>{
  const before=DEFAULT_STORE_NAVIGATION;
  const after=[...before].reverse().map(item=>item.id==='new'?{...item,label:'신상품',visible:false}:item);
  const rows=storeSettingsHistoryRows({id:'audit',actorName:'관리자',action:'saved',target:'store_settings:navigation',createdAt:'now',diff:{before,after}});
  expect(rows).toContainEqual({key:'new.order',label:'NEW · 순서',before:'1',after:'9'});
  expect(rows).toContainEqual({key:'new.label',label:'NEW · 메뉴명',before:'NEW',after:'신상품'});
  expect(rows).toContainEqual({key:'new.visible',label:'NEW · 노출',before:'사용',after:'사용 안 함'});
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
  it('변경 이력은 운송장 형식을 사람이 읽는 안내 문구로 보여 주고, 식(정규식) 줄은 보이지 않는다', () => {
    const entry = (before: Record<string, unknown>, after: Record<string, unknown>) => ({ id: 'a', actorName: '관리자', action: 'admin.shipping_carrier.saved', target: 'shipping_carriers:hanjin', createdAt: '2026-11-18T00:00:00Z', diff: { before, after } });
    expect(storeSettingsHistoryRows(entry(
      { tracking_number_pattern: '^[0-9]{10,14}$', tracking_number_rule: '숫자 10~14자리' }, { tracking_number_pattern: null, tracking_number_rule: null })))
      .toEqual([{ key: 'tracking_number_rule', label: '운송장 형식', before: '숫자 10~14자리', after: '없음' }]);
    /* 안내 문구가 그대로인데 식만 바뀐 드문 경우에는 식 줄을 남긴다(바뀐 것을 가리지 않는다). */
    expect(storeSettingsHistoryRows(entry(
      { tracking_number_pattern: '^[0-9]{10,14}$', tracking_number_rule: '숫자' }, { tracking_number_pattern: '^[0-9]{12}$', tracking_number_rule: '숫자' })))
      .toEqual([{ key: 'tracking_number_pattern', label: '운송장 형식', before: '^[0-9]{10,14}$', after: '^[0-9]{12}$' }]);
  });
  it('택배사 변경 이력의 이름은 화면의 이름과 같다 — 배송조회 주소·사용 여부(사용 / 사용 안 함)', () => {
    expect(storeSettingsHistoryRows({ id: 'a', actorName: '관리자', action: 'admin.shipping_carrier.saved', target: 'shipping_carriers:hanjin', createdAt: '2026-11-26T00:00:00Z',
      diff: { before: { is_active: true, tracking_url_template: 'https://a.example/{trackingNumber}' }, after: { is_active: false, tracking_url_template: 'https://b.example/{trackingNumber}' } } }))
      .toEqual([
        { key: 'tracking_url_template', label: '배송조회 주소', before: 'https://a.example/{trackingNumber}', after: 'https://b.example/{trackingNumber}' },
        { key: 'is_active', label: '사용 여부', before: '사용', after: '사용 안 함' },
      ]);
  });
});

describe('택배사 배송조회 주소 입력 (C-3)', () => {
  const carrier = { code: 'demo', label: '연습택배', trackingUrlTemplate: 'https://carrier.example.test/{trackingNumber}', active: true };
  const GENERIC = 'https://로 시작하는 주소에 {trackingNumber}를 넣어 주세요. 그 자리에 운송장번호가 들어갑니다.';
  it('쓸 수 없는 주소는 까닭과 고칠 방법을 말하고, 개발 용어(HTTPS 조회 URL)를 쓰지 않는다', () => {
    const error = (url: string) => (parseCarrierInput({ ...carrier, trackingUrlTemplate: url }) as { ok: false; errors: Record<string, string> }).errors.trackingUrlTemplate;
    expect(error('')).toBe(GENERIC);
    expect(error('javascript:alert(1)')).toBe(GENERIC);
    expect(error('http://carrier.example.test/{trackingNumber}')).toBe(GENERIC);
    expect(error('https://carrier.example.test/')).toBe(GENERIC);
    expect(error('https://carrier.example.test/ track/{trackingNumber}')).toBe(GENERIC);
    expect(error('https://user:pass@carrier.example.test/{trackingNumber}')).toBe('주소에 아이디나 비밀번호는 넣을 수 없습니다.');
    expect(error(`https://carrier.example.test/${'a'.repeat(500)}{trackingNumber}`)).toBe('배송조회 주소는 500자 이내로 적어 주세요.');
    for (const text of [GENERIC, '주소에 아이디나 비밀번호는 넣을 수 없습니다.']) expect(text).not.toMatch(/HTTPS 조회|URL|정규식/);
  });
  it('쓸 수 있는 주소는 오류가 없다 — 받아들이는 기준은 전과 같다', () => {
    expect(carrierTrackingUrlError('https://carrier.example.test/{trackingNumber}')).toBeNull();
    expect(carrierTrackingUrlError('https://carrier.example.test:8443/track?no={trackingNumber}&x=1')).toBeNull();
    expect(carrierTrackingUrlError('https://carrier.example.test/{trackingNumber}/{trackingNumber}')).toBeNull();
  });
});

describe('택배사 운송장 형식 고르기 (C-2) — 저장되는 값은 식을 직접 적던 때와 같다', () => {
  it('종류와 자리 수가 같은 모양의 식·안내 문구를 만든다(자리 수가 같으면 {13}, 다르면 {10,14})', () => {
    expect(carrierFormatSpec('digits', 10, 14)).toEqual({ pattern: '^[0-9]{10,14}$', rule: '숫자 10~14자리' });
    expect(carrierFormatSpec('digits', 13, 13)).toEqual({ pattern: '^[0-9]{13}$', rule: '숫자 13자리' });
    expect(carrierFormatSpec('alnum', 12, 12)).toEqual({ pattern: '^[A-Z0-9]{12}$', rule: '영문·숫자 12자리' });
    expect(carrierFormatSpec('alnum', 9, 20)).toEqual({ pattern: '^[A-Z0-9]{9,20}$', rule: '영문·숫자 9~20자리' });
  });
  it('운영 DB에 들어 있는 두 형식(한진·우체국)을 종류와 자리 수로 읽는다', () => {
    expect(readCarrierFormat('^[0-9]{10,14}$')).toEqual({ kind: 'digits', min: 10, max: 14 });
    expect(readCarrierFormat('^[0-9]{13}$')).toEqual({ kind: 'digits', min: 13, max: 13 });
    expect(readCarrierFormat('^[A-Z0-9]{9,20}$')).toEqual({ kind: 'alnum', min: 9, max: 20 });
    expect(readCarrierFormat('')).toEqual({ kind: 'none', min: 0, max: 0 });
    expect(readCarrierFormat(null)).toEqual({ kind: 'none', min: 0, max: 0 });
  });
  it('이 화면이 만드는 모양이 아닌 식은 null이다 — 화면은 안내 문구만 보이고 [형식 새로 정하기]를 눌러야 바꾼다', () => {
    for (const custom of ['^(1Z[A-Z0-9]{16}|[0-9]{12})$', '^[A-Za-z0-9]{10}$', '^\\d{12}$', '^[0-9]{5,12}$', '^[0-9]{10,40}$', '^[0-9]{14,10}$', '^[0-9]+$']) expect(readCarrierFormat(custom), custom).toBeNull();
  });
  it('저장했다가 읽어도 같은 값이다(만든 식은 늘 다시 읽힌다)', () => {
    for (const kind of ['digits', 'alnum'] as const) for (const [min, max] of [[8, 8], [8, 30], [10, 14], [13, 13], [30, 30]]) {
      expect(readCarrierFormat(carrierFormatSpec(kind, min, max).pattern)).toEqual({ kind, min, max });
    }
  });
  it('자리 수는 공통 형식(8~30자) 안의 정수여야 하고 최소가 최대보다 크면 안 된다', () => {
    expect(readCarrierFormatLength('10', '14')).toEqual({ min: 10, max: 14 });
    expect(readCarrierFormatLength(' 8 ', '30')).toEqual({ min: 8, max: 30 });
    for (const [min, max] of [['7', '14'], ['10', '31'], ['14', '10'], ['', '14'], ['10', ''], ['1.5', '14'], ['-10', '14'], ['abc', '14'], ['1e1', '14']]) expect(readCarrierFormatLength(min, max), `${min}~${max}`).toBeNull();
  });
  it('자리 수를 읽을 수 없을 때의 까닭: 다 적었을 때만 말하고, 읽을 수 있으면 말하지 않는다', () => {
    for (const [min, max] of [['10', '14'], ['8', '8'], ['30', '30'], ['', ''], ['12', ''], ['', '10'], [' ', '10']]) expect(carrierFormatLengthProblem(min, max), `${min}~${max}`).toBeNull();
    expect(carrierFormatLengthProblem('12', '10')).toBe('최소 자리 수가 최대보다 큽니다. 최소를 최대보다 작거나 같게 적어 주세요.');
    expect(carrierFormatLengthProblem('7', '14')).toBe('자리 수는 8~30 사이로 적어 주세요.');
    expect(carrierFormatLengthProblem('10', '31')).toBe('자리 수는 8~30 사이로 적어 주세요.');
    expect(carrierFormatLengthProblem('40', '10')).toBe('자리 수는 8~30 사이로 적어 주세요.');
    for (const [min, max] of [['1.5', '14'], ['-10', '14'], ['abc', '14'], ['10', '1e1']]) expect(carrierFormatLengthProblem(min, max), `${min}~${max}`).toBe('자리 수는 숫자로 적어 주세요.');
    /* 칸 아래 문구는 서버가 저장 때 하는 검사와 같은 기준이다 — 읽을 수 없는 값은 서버도 같은 이유로 거절한다. */
    for (const [min, max] of [['12', '10'], ['7', '14'], ['abc', '14']]) {
      expect(carrierFormatLengthProblem(min, max)).not.toBeNull();
      expect(parseCarrierFormatChoice({ kind: 'digits', min, max, sample: '1234567890' })).toEqual({ ok: false, errors: { trackingNumberLength: CARRIER_FORMAT_LENGTH_ERROR } });
    }
    expect(`${carrierFormatLengthProblem('12', '10')}${carrierFormatLengthProblem('7', '14')}`).not.toMatch(/정규식|\^|\$/);
  });
  it('확인용 번호는 하이픈·공백을 빼고 대문자로 맞춰 새 형식과 공통 형식으로 가린다', () => {
    const digits = { kind: 'digits', min: 10, max: 14 } as const;
    expect(carrierSampleVerdict(digits, '')).toBe('empty');
    expect(carrierSampleVerdict(digits, '1234-5678-9012')).toBe('match');
    expect(carrierSampleVerdict(digits, '123456789')).toBe('mismatch');
    expect(carrierSampleVerdict(digits, 'ABCDEFGHIJ')).toBe('mismatch');
    expect(carrierSampleVerdict({ kind: 'alnum', min: 10, max: 10 }, 'ab12cd34ef')).toBe('match');
    expect(carrierSampleVerdict({ kind: 'none', min: 0, max: 0 }, 'AB123456')).toBe('match');
    expect(carrierSampleVerdict({ kind: 'none', min: 0, max: 0 }, '12345')).toBe('mismatch');
  });
  it('폼이 보낸 종류·자리 수·확인용 번호로 저장할 식과 안내 문구를 만들고 같은 검사를 다시 한다', () => {
    expect(parseCarrierFormatChoice({ kind: 'digits', min: '10', max: '14', sample: '1234-5678-9012' }))
      .toEqual({ ok: true, value: { pattern: '^[0-9]{10,14}$', rule: '숫자 10~14자리', sample: '123456789012' } });
    expect(parseCarrierFormatChoice({ kind: 'digits', min: '13', max: '13', sample: '1234567890123' }))
      .toEqual({ ok: true, value: { pattern: '^[0-9]{13}$', rule: '숫자 13자리', sample: '1234567890123' } });
    /* 같은 값을 식으로 직접 적어도 같은 결과다. */
    expect(parseCarrierFormatChoice({ kind: 'alnum', min: '12', max: '12', sample: 'ab12cd34ef56' }))
      .toEqual(parseCarrierFormatInput({ pattern: '^[A-Z0-9]{12}$', rule: '영문·숫자 12자리', sample: 'ab12cd34ef56' }));
    /* 정하지 않음은 형식과 안내 문구를 함께 비운다(확인용 번호도 받지 않는다). */
    expect(parseCarrierFormatChoice({ kind: 'none', min: '10', max: '14', sample: 'anything' })).toEqual({ ok: true, value: { pattern: '', rule: '', sample: '' } });
  });
  it('자리 수가 틀리면 자리 수 칸의 오류로, 확인용 번호가 없거나 맞지 않으면 그 칸의 오류로 돌려준다', () => {
    expect(parseCarrierFormatChoice({ kind: 'digits', min: '14', max: '10', sample: '1234567890' })).toEqual({ ok: false, errors: { trackingNumberLength: CARRIER_FORMAT_LENGTH_ERROR } });
    expect(parseCarrierFormatChoice({ kind: 'digits', min: '', max: '', sample: '1234567890' })).toEqual({ ok: false, errors: { trackingNumberLength: CARRIER_FORMAT_LENGTH_ERROR } });
    const sample = (value: string) => (parseCarrierFormatChoice({ kind: 'digits', min: '10', max: '14', sample: value }) as { ok: false; errors: Record<string, string> }).errors;
    expect(sample('')).toEqual({ trackingNumberSample: CARRIER_SAMPLE_REQUIRED });
    /* 자리 수도 틀리고 확인용 번호도 비었으면 한 번에 둘 다 말한다 — 하나 고친 뒤에야 다음 오류가 나오지 않게. */
    expect(parseCarrierFormatChoice({ kind: 'digits', min: '14', max: '10', sample: '' })).toEqual({ ok: false, errors: { trackingNumberLength: CARRIER_FORMAT_LENGTH_ERROR, trackingNumberSample: CARRIER_SAMPLE_REQUIRED } });
    expect(parseCarrierFormatChoice({ kind: 'digits', min: '14', max: '10', sample: ' - ' })).toEqual({ ok: false, errors: { trackingNumberLength: CARRIER_FORMAT_LENGTH_ERROR, trackingNumberSample: CARRIER_SAMPLE_REQUIRED } });
    expect(sample('12345')).toEqual({ trackingNumberSample: '확인용 운송장번호는 영문·숫자 8~30자로 넣어 주세요.' });
    expect(sample('ABCDEFGHIJ')).toEqual({ trackingNumberSample: '확인용 운송장번호가 새 형식에 맞지 않습니다. 번호나 형식을 확인해 주세요.' });
  });
  it('모르는 종류나 종류가 없는 요청(낡은 화면)은 낡은 화면 안내로 거절하고, 형식을 지우지 않는다', () => {
    for (const kind of ['', 'regex', 'DIGITS']) expect(parseCarrierFormatChoice({ kind, min: '10', max: '14', sample: '1234567890' })).toEqual({ ok: false, errors: { form: CARRIER_FORMAT_STALE } });
  });
  it('자리 수 오류 문구는 개발 용어(정규식)를 쓰지 않는다', () => {
    expect(CARRIER_FORMAT_LENGTH_ERROR).toBe('자리 수는 8~30 사이의 숫자로, 최소가 최대보다 크지 않게 적어 주세요.');
    expect(CARRIER_FORMAT_LENGTH_ERROR + CARRIER_FORMAT_STALE).not.toMatch(/정규식|\^|\$/);
  });
});

describe('택배사를 끌 수 있는지 (C-1)', () => {
  it('새 주문을 받는 출고지가 기본 택배사로 쓰면 끌 수 없고, 그 출고지 이름을 돌려준다', () => {
    expect(carrierTurnOff([{ name: '김포', active: true }, { name: '남양주', active: false }])).toEqual({ ok: false, reason: 'in_use', active: [{ name: '김포', active: true }] });
  });
  it('쓰는 출고지가 없거나 사용 안 함인 출고지만 쓰면 끌 수 있다 — 사용 안 함인 출고지는 알리기만 한다', () => {
    expect(carrierTurnOff([])).toEqual({ ok: true, inactive: [] });
    expect(carrierTurnOff([{ name: '남양주', active: false }])).toEqual({ ok: true, inactive: [{ name: '남양주', active: false }] });
  });
  it('쓰는 출고지를 읽지 못했으면(null) 끌 수 있다고 하지 않는다', () => {
    expect(carrierTurnOff(null)).toEqual({ ok: false, reason: 'unknown' });
  });
  it('출고지 이름 끝에 출고지를 붙이되 이미 출고지로 끝나면 또 붙이지 않는다', () => {
    expect(originNamesLabel(['김포'])).toBe('김포 출고지');
    expect(originNamesLabel(['김포', '남양주'])).toBe('김포, 남양주 출고지');
    expect(originNamesLabel(['합성 출고지'])).toBe('합성 출고지');
  });
  it('문구: 막는 까닭·바꾸는 곳·못 읽었을 때·사용 안 함인 출고지·이미 꺼진 택배사', () => {
    expect(carrierInUseMessage(['김포'])).toBe('김포 출고지가 이 택배사를 기본 택배사로 쓰고 있어 끌 수 없습니다. 배송정보 관리에서 그 출고지의 택배사를 먼저 바꿔 주세요.');
    expect(carrierInUseMessage(['김포', '남양주'])).toContain('김포, 남양주 출고지가 이 택배사를');
    expect(CARRIER_TURN_OFF_UNKNOWN).toBe('이 택배사를 기본으로 쓰는 출고지를 확인하지 못해 지금은 끌 수 없습니다. 잠시 뒤 다시 해 주세요.');
    expect(carrierInactiveUseNote(['남양주'])).toBe('사용 안 함인 남양주 출고지도 이 택배사를 기본 택배사로 쓰고 있습니다. 끄면 그 출고지는 택배사를 바꾸기 전에는 저장할 수 없습니다.');
    expect(carrierOffUseNote(['김포'])).toBe('김포 출고지가 이 택배사를 기본 택배사로 쓰고 있습니다. 사용 안 함인 동안 그 출고지는 저장할 수 없습니다. 켜거나, 배송정보 관리에서 그 출고지의 택배사를 바꿔 주세요.');
  });
});

describe('택배사 이름을 바꿀 때의 알림 (C-4)', () => {
  it('저장돼 있던 이름과 달라졌을 때만 알린다(비어 있던 새 택배사는 알리지 않는다)', () => {
    expect(carrierRenamed('한진택배', '한진택배')).toBe(false);
    expect(carrierRenamed('한진택배', ' 한진택배 ')).toBe(false);
    expect(carrierRenamed('한진택배', '한진 택배')).toBe(true);
    expect(carrierRenamed('', '새 택배')).toBe(false);
    expect(CARRIER_RENAME_NOTE).toBe('이름을 바꾸면 옛 이름으로 적은 창고 회신 줄은 등록되지 않습니다. 코드로 적은 줄은 그대로 등록됩니다.');
  });
});
