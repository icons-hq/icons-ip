import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
vi.mock('@/app/admin/store-settings-actions',()=>({saveStoreSettingsAction:vi.fn(),saveShippingCarrierAction:vi.fn(),saveInquiryAutoRepliesAction:vi.fn()}));
import { StoreSettingsScreen } from './StoreSettingsScreen';
const props={settings:{business:{companyName:'연습회사',phone:'',email:'cs@example.test'},bankTransfer:null,inquiryAutoReplies:{order:{enabled:false,body:''},claim:{enabled:false,body:''},good:{enabled:false,body:''},account:{enabled:false,body:''},etc:{enabled:false,body:''}},updatedAt:'2026-09-08T01:00:00Z'},carriers:[{code:'demo',label:'연습택배',trackingUrlTemplate:'https://carrier.example.test/{trackingNumber}',active:false,updatedAt:'2026-09-08T01:00:00Z'}],history:[{id:'audit',actorName:'관리자',action:'admin.store_settings.updated',target:'store_settings:business',createdAt:'2026-09-08T01:00:00Z',diff:{before:{},after:{companyName:'연습회사'}}}],section:'business' as const};
describe('운영 설정 화면',()=>{
  it('staff에게 설정과 변경 이력을 보여주고 저장 버튼을 숨긴다',()=>{
    const html=renderToStaticMarkup(<StoreSettingsScreen {...props} canEdit={false}/>);
    expect(html).toContain('연습회사');expect(html).toContain('최근 변경 이력');expect(html).toContain('관리자');expect(html).toContain('readOnly');expect(html).not.toContain('>설정 저장<');
  });
  it('admin에게 택배사 편집·등록과 활성 상태를 보여준다',()=>{
    const html=renderToStaticMarkup(<StoreSettingsScreen {...props} canEdit carrierMode/>);
    expect(html).toContain('연습택배 · 비활성');expect(html).toContain('택배사 등록');expect(html).toContain('{trackingNumber}');expect(html).toContain('기존 주문의 배송조회');
  });
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
});
