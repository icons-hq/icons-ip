import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
vi.mock('@/app/admin/store-settings-actions',()=>({saveStoreSettingsAction:vi.fn(),saveShippingCarrierAction:vi.fn()}));
import { StoreSettingsScreen } from './StoreSettingsScreen';
const props={settings:{business:{companyName:'연습회사',phone:'',email:'cs@example.test'},bankTransfer:null,updatedAt:'2026-09-08T01:00:00Z'},carriers:[{code:'demo',label:'연습택배',trackingUrlTemplate:'https://carrier.example.test/{trackingNumber}',active:false,updatedAt:'2026-09-08T01:00:00Z'}],history:[{id:'audit',actorName:'관리자',action:'admin.store_settings.updated',target:'store_settings:business',createdAt:'2026-09-08T01:00:00Z',diff:{before:{},after:{companyName:'연습회사'}}}],section:'business' as const};
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
