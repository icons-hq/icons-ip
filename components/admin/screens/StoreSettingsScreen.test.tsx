import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
vi.mock('@/app/admin/store-settings-actions',()=>({saveStoreSettingsAction:vi.fn(),saveShippingCarrierAction:vi.fn(),saveShippingCarrierFormatAction:vi.fn(),saveInquiryAutoRepliesAction:vi.fn()}));
vi.mock('@/app/admin/store-branding-actions',()=>({saveStoreBrandingAction:vi.fn()}));
import { ShippingCarriersScreen, StoreSettingsScreen } from './StoreSettingsScreen';
import { DEFAULT_STORE_BRANDING } from '@/lib/store-branding';
import { carrierInUseMessage, carrierInactiveUseNote, carrierOffUseNote, CARRIER_TURN_OFF_UNKNOWN, type CarrierUsesByCode, type EditableCarrier } from '@/lib/admin/store-settings';
const props={settings:{business:{companyName:'연습회사',phone:'',email:'cs@example.test'},bankTransfer:null,inquiryAutoReplies:{order:{enabled:false,body:''},claim:{enabled:false,body:''},good:{enabled:false,body:''},account:{enabled:false,body:''},etc:{enabled:false,body:''}},updatedAt:'2026-09-08T01:00:00Z'},carriers:[{code:'demo',label:'연습택배',trackingUrlTemplate:'https://carrier.example.test/{trackingNumber}',active:false,updatedAt:'2026-09-08T01:00:00Z'}],history:[{id:'audit',actorName:'관리자',action:'admin.store_settings.updated',target:'store_settings:business',createdAt:'2026-09-08T01:00:00Z',diff:{before:{},after:{companyName:'연습회사'}}}],section:'business' as const};
describe('운영 설정 화면',()=>{
  it('staff에게 설정과 변경 이력을 보여주고 저장 버튼을 숨긴다',()=>{
    const html=renderToStaticMarkup(<StoreSettingsScreen {...props} canEdit={false}/>);
    expect(html).toContain('연습회사');expect(html).toContain('최근 변경 이력');expect(html).toContain('관리자');expect(html).toContain('readOnly');expect(html).not.toContain('>설정 저장<');
  });
  it('admin에게 택배사 편집·등록과 활성 상태를 보여준다',()=>{
    const html=renderToStaticMarkup(<StoreSettingsScreen {...props} canEdit carrierMode/>);
    expect(html).toContain('연습택배');expect(html).toMatch(/data-tone="neutral"[^>]*>사용 안 함</);expect(html).toContain('택배사 등록');expect(html).toContain('{trackingNumber}');expect(html).toContain('이미 발송한 주문의 배송조회 링크는 그대로입니다.');
  });
});

it('택배사는 한 줄씩 보고 펼쳐서 고치며 등록된 코드는 바꿀 수 없다고 말한다',()=>{
  const html=renderToStaticMarkup(<ShippingCarriersScreen carriers={props.carriers} history={[]} canEdit/>);
  expect(html).toContain('data-carrier-list');expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*><strong[^>]*>연습택배<\/strong>/);expect(html).toContain('등록 후 바꿀 수 없습니다.');expect(html).toContain('택배사 추가');
});

it('브랜드·SNS 설정과 기본값을 보여주고 staff의 업로드·저장을 차단한다',()=>{
  const settings={...props.settings,branding:{...DEFAULT_STORE_BRANDING,displayName:'합성 브랜드'}};
  const html=renderToStaticMarkup(<StoreSettingsScreen {...props} settings={settings} section="branding" canEdit={false}/>);
  expect(html).toContain('합성 브랜드');expect(html).toContain('PC 로고');expect(html).toContain('모바일 로고');expect(html).toContain('50자');expect(html).toContain('인스타그램 주소');
  expect(html.match(/<fieldset disabled=""/g)).toHaveLength(2);expect(html).not.toContain('>브랜드·SNS 저장<');
  expect(renderToStaticMarkup(<StoreSettingsScreen {...props} settings={settings} section="branding" canEdit brandingOperationId="operation"/>)).toContain('>브랜드·SNS 저장<');
});

it('문의 자동 안내는 다섯 유형을 제공하고 staff의 변경을 막는다', () => {
  const settings = {...props.settings, inquiryAutoReplies: {
    order:{enabled:true,body:'주문 FAQ https://iconsip.com/help'}, claim:{enabled:false,body:''},
    good:{enabled:false,body:''},account:{enabled:false,body:''},etc:{enabled:false,body:''},
  }};
  const html = renderToStaticMarkup(<StoreSettingsScreen {...props} settings={settings} section="inquiry_auto_replies" canEdit={false}/>);
  expect(html).toContain('문의 자동 안내');
  expect(html).toContain('주문 FAQ https://iconsip.com/help');
  expect(html.match(/type="checkbox"/g)).toHaveLength(5);
  expect(html.match(/disabled=""/g)).toHaveLength(5);
  expect(html.match(/readOnly=""/g)).toHaveLength(5);
  expect(html).not.toContain('>문의 자동 안내 저장<');
  const admin = renderToStaticMarkup(<StoreSettingsScreen {...props} settings={settings} section="inquiry_auto_replies" canEdit/>);
  expect(admin).toContain('>문의 자동 안내 저장<');
  /* kit 버튼의 기본 type은 button이다 — 폼 저장 버튼은 제출 버튼이어야 한다. */
  expect(admin).toMatch(/<button[^>]*type="submit"[^>]*>(?:(?!<\/button>)[\s\S])*문의 자동 안내 저장<\/button>/);
});

/* ---- 택배사 관리 정리 (S4: C-1~C-6) ---- */
const text = (html: string) => html.replace(/<[^>]+>/g, '');
const GIMPO = { name: '김포', active: true, href: '/admin/settings/origins?origin=gimpo' };
const NAMYANGJU = { name: '남양주', active: false, href: '/admin/settings/origins?origin=namyangju' };
const hanjin: EditableCarrier = { code: 'hanjin', label: '한진택배', trackingUrlTemplate: 'https://carrier.example.test/{trackingNumber}', active: true, updatedAt: '2026-09-08T01:00:00Z', trackingNumberPattern: '^[0-9]{10,14}$', trackingNumberRule: '숫자 10~14자리' };
const screen = (carriers: EditableCarrier[], uses?: CarrierUsesByCode, canEdit = true) => renderToStaticMarkup(<ShippingCarriersScreen carriers={carriers} history={[]} canEdit={canEdit} uses={uses} />);
/** 사용 칸(체크박스) 한 개의 태그. */
const activeBox = (html: string) => /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0] ?? '';

describe('택배사 관리의 이름 (C-3·C-5·C-6)', () => {
  it('사용 여부는 사용 / 사용 안 함이고, 옛 이름(사용 중·새 발송에서 사용·배송조회 URL)을 쓰지 않는다', () => {
    const html = screen([hanjin, { ...hanjin, code: 'epost', label: '우체국택배', active: false }]);
    expect(html).toMatch(/data-tone="success"[^>]*>사용</);
    expect(html).toMatch(/data-tone="neutral"[^>]*>사용 안 함</);
    expect(html).toContain('배송조회 주소');
    expect(html).not.toMatch(/사용 중|새 발송에서 사용|배송조회 URL/);
    expect(text(html)).toContain('운송장을 등록할 때 고를 택배사를 정합니다.');
  });
  it('코드는 창고 회신 엑셀에 적는 값이라고 말하고, 배송조회 주소는 예시로 안내한다', () => {
    const html = text(screen([hanjin]));
    expect(html).toContain('창고 회신 엑셀의 택배사 칸에 이 코드나 이름을 적습니다. 등록 후 바꿀 수 없습니다.');
    expect(html).toContain('운송장번호가 들어갈 자리에 {trackingNumber}를 적습니다. 예: https://example.com/?no={trackingNumber}');
    expect(html).toContain('사용 안 함이면 새 발송과 창고 회신 엑셀에서 쓸 수 없습니다. 이미 발송한 주문의 배송조회 링크는 그대로입니다.');
    /* 이름을 바꾸기 전에는 이름 알림을 보이지 않는다(바꾸는 중에만 한 줄로 보인다). */
    expect(html).not.toContain('옛 이름으로 적은 창고 회신 줄은 등록되지 않습니다');
  });
  it('변경 이력의 빈 값은 없음이라 쓴다', () => {
    const history = [{ id: 'a', actorName: '관리자', action: 'admin.shipping_carrier.saved', target: 'shipping_carriers:hanjin', createdAt: '2026-11-26T00:00:00Z',
      diff: { before: { label: '' }, after: { label: '한진택배' } } }];
    const html = renderToStaticMarkup(<ShippingCarriersScreen carriers={[hanjin]} history={history} canEdit />);
    expect(text(html)).toContain('이름: 없음 → 한진택배');
    expect(html).not.toContain('빈 값');
  });
});

describe('택배사 끄기 잠금 (C-1)', () => {
  it('새 주문을 받는 출고지가 기본으로 쓰는 택배사는 사용 칸을 잠그고 켠 채로 보내며, 출고지 이름과 바꾸는 곳(링크)을 보인다', () => {
    const html = screen([hanjin], { hanjin: [GIMPO, NAMYANGJU] });
    const box = activeBox(html);
    expect(box).toContain('disabled=""');
    expect(box).toContain('checked=""');
    expect(box).not.toContain('name="active"');
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="active"[^>]*value="true"|<input[^>]*name="active"[^>]*type="hidden"[^>]*value="true"/);
    expect(text(html)).toContain(carrierInUseMessage(['김포']));
    expect(html).toContain('href="/admin/settings/origins?origin=gimpo"');
    expect(html).toContain('href="/admin/settings/origins">배송정보 관리</a>');
    /* 막는 출고지만 말한다 — 사용 안 함인 남양주는 끄는 것을 막지 않는다. */
    expect(text(html)).not.toContain('남양주');
    expect(box).toContain('aria-describedby="carrier-hanjin-active-note"');
    expect(html).toContain('id="carrier-hanjin-active-note"');
  });
  it('출고지가 여럿이면 이름마다 그 출고지로 가는 링크를 보인다', () => {
    const html = screen([hanjin], { hanjin: [GIMPO, { name: '대구', active: true, href: '/admin/settings/origins?origin=daegu' }] });
    expect(text(html)).toContain(carrierInUseMessage(['김포', '대구']));
    expect(html).toContain('href="/admin/settings/origins?origin=daegu"');
  });
  it('쓰는 출고지를 읽지 못했으면(null) 끌 수 있다고 하지 않고 다시 해 달라고 말한다', () => {
    const html = screen([hanjin], null);
    expect(activeBox(html)).toContain('disabled=""');
    expect(html).toMatch(/name="active"[^>]*value="true"|value="true"[^>]*name="active"/);
    expect(text(html)).toContain(CARRIER_TURN_OFF_UNKNOWN);
  });
  it('쓰는 출고지가 없으면 잠그지 않는다 — 사용 칸이 켜져 있고 제출된다', () => {
    const html = screen([hanjin], { epost: [GIMPO] });
    const box = activeBox(html);
    expect(box).not.toContain('disabled');
    expect(box).toContain('name="active"');
    expect(html).not.toContain('끌 수 없습니다');
  });
  it('사용 안 함인 출고지만 쓰면 잠그지 않고 그 사실만 알린다', () => {
    const html = screen([hanjin], { hanjin: [NAMYANGJU] });
    expect(activeBox(html)).not.toContain('disabled');
    expect(text(html)).toContain(carrierInactiveUseNote(['남양주']));
    expect(html).toContain('href="/admin/settings/origins?origin=namyangju"');
  });
  it('이미 사용 안 함인 택배사를 출고지가 쓰고 있으면 그 출고지는 저장할 수 없다고 알리고, 켜는 것은 막지 않는다', () => {
    const off = { ...hanjin, active: false };
    const html = screen([off], { hanjin: [GIMPO] });
    expect(activeBox(html)).not.toContain('disabled');
    expect(text(html)).toContain(carrierOffUseNote(['김포']));
    /* 못 읽었어도 이미 꺼진 택배사는 켤 수 있다. */
    expect(activeBox(screen([off], null))).not.toContain('disabled');
  });
  it('저장할 수 없는 사람(조회 전용)에게는 잠금 안내도 저장 버튼도 보이지 않는다', () => {
    const html = screen([hanjin], { hanjin: [GIMPO] }, false);
    expect(text(html)).not.toContain('끌 수 없습니다');
    expect(html).not.toContain('택배사 저장');
    expect(activeBox(html)).toContain('disabled=""');
  });
  it('새 택배사를 등록하는 폼은 잠그지 않는다', () => {
    const html = screen([hanjin], { hanjin: [GIMPO] });
    const box = /<details class="group rounded-lg border">[\s\S]*<\/details>/.exec(html)?.[0] ?? '';
    expect(box).toContain('택배사 등록');
    expect(activeBox(box)).not.toContain('disabled');
  });
});

describe('택배사 운송장 형식 (C-2)', () => {
  const formatOf = (carrier: EditableCarrier, canEdit = true) => {
    const html = screen([carrier], undefined, canEdit);
    return /<form[^>]*data-carrier-format[\s\S]*?<\/form>|<div[^>]*data-carrier-format[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? '';
  };
  it('식(정규식)을 적는 칸이 없고 종류 세 카드와 자리 수·확인용 번호만 있다 — 저장된 값(숫자 10~14자리)은 그대로 읽어 채운다', () => {
    const html = formatOf(hanjin);
    expect(html).not.toMatch(/정규식|\^\[|trackingNumberPattern|trackingNumberRule/);
    expect(html).toContain('name="trackingNumberKind"');
    for (const title of ['정하지 않음', '숫자만', '영문과 숫자']) expect(html).toContain(title);
    expect(html).toMatch(/value="digits"[^>]*checked=""|checked=""[^>]*value="digits"/);
    expect(html).toContain('name="trackingNumberMin"');
    expect(html).toContain('value="10"');
    expect(html).toContain('value="14"');
    expect(html).toContain('name="trackingNumberSample"');
    expect(text(html)).toContain('한진택배 운송장번호는 숫자 10~14자리여야 등록됩니다.');
    expect(text(html)).toContain('실제 운송장번호 하나를 넣어 형식에 맞는지 확인합니다. 저장되지 않습니다.');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>(?:(?!<\/button>)[\s\S])*운송장 형식 저장<\/button>/);
  });
  it("형식이 없으면 '정하지 않음'이 골라져 있고 자리 수·확인용 번호 칸은 열리지 않는다", () => {
    const html = formatOf({ ...hanjin, trackingNumberPattern: '', trackingNumberRule: '' });
    expect(html).toMatch(/value="none"[^>]*checked=""|checked=""[^>]*value="none"/);
    expect(html).not.toContain('trackingNumberMin');
    expect(html).not.toContain('trackingNumberSample');
    expect(text(html)).toContain('공통 형식(8~30자 영문·숫자)만 확인합니다.');
  });
  it('예전에 식을 직접 적어 이 화면의 모양이 아닌 형식은 안내 문구만 보이고 [형식 새로 정하기]를 눌러야 바꾼다', () => {
    const html = formatOf({ ...hanjin, trackingNumberPattern: '^(1Z[A-Z0-9]{16}|[0-9]{12})$', trackingNumberRule: '숫자 12자리 또는 1Z로 시작하는 18자리' });
    expect(text(html)).toContain('숫자 12자리 또는 1Z로 시작하는 18자리');
    expect(html).toContain('형식 새로 정하기');
    expect(html).not.toMatch(/name="trackingNumber|<form|정규식|1Z\[A-Z0-9\]/);
  });
  it('저장할 수 없는 사람에게는 지금 형식만 글로 보인다', () => {
    const html = formatOf(hanjin, false);
    expect(text(html)).toContain('숫자 10~14자리');
    expect(html).not.toMatch(/<form|<input|형식 새로 정하기|운송장 형식 저장/);
  });
});
