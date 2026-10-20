import { describe, expect, it } from 'vitest';
import { DEFAULT_STORE_BRANDING, parseStoreBranding, parseStorefrontBranding, storefrontBranding, storeSocialUrl } from './store-branding';
const logo='public-media/catalog/curation/00000000-0000-4000-8000-000000016001.png';
describe('스토어 브랜드 공개 계약',()=>{
  it('기본 ICONS를 유지하고 숨긴 이미지·소개·SNS는 공개하지 않는다',()=>{
    const config={...DEFAULT_STORE_BRANDING,logoPath:logo,introduction:'비공개 소개',socials:{...DEFAULT_STORE_BRANDING.socials,instagram:{enabled:false,url:'https://instagram.com/hidden/'}}};
    expect(storefrontBranding(config,path=>`https://media.test/${path}`)).toEqual({displayName:'ICONS',logoUrl:null,mobileLogoUrl:null,introduction:null,socials:[]});
  });
  it('켜진 SNS만 고정 순서로 표시하고 이미지 모드에서는 두 로고를 제공한다',()=>{
    const config={...DEFAULT_STORE_BRANDING,logoMode:'image' as const,logoPath:logo,mobileLogoPath:logo,introduction:'브랜드 소개',showIntroduction:true,socials:{blog:{enabled:true,url:'https://blog.naver.com/shop'},facebook:{enabled:false,url:''},instagram:{enabled:true,url:'https://instagram.com/shop/'}}};
    expect(storefrontBranding(config,path=>path)).toEqual({displayName:'ICONS',logoUrl:logo,mobileLogoUrl:logo,introduction:'브랜드 소개',socials:[{platform:'blog',url:'https://blog.naver.com/shop'},{platform:'instagram',url:'https://instagram.com/shop/'}]});
  });
  it('문자 개수·필수 설정·알 수 없는 필드를 엄격히 확인한다',()=>{
    expect(parseStoreBranding({...DEFAULT_STORE_BRANDING,displayName:'😀'.repeat(30)})).not.toBeNull();
    for(const patch of [{displayName:'a'.repeat(31)},{displayName:' '},{introduction:'가'.repeat(51)},{introduction:'a\nb'},{showIntroduction:true},{logoMode:'image'},{unknown:'x'},{socials:{}}]) expect(parseStoreBranding({...DEFAULT_STORE_BRANDING,...patch})).toBeNull();
  });
  it('SNS 서비스 HTTPS 호스트만 허용한다',()=>{
    expect(storeSocialUrl('instagram','https://WWW.INSTAGRAM.COM/shop')).toBe('https://www.instagram.com/shop');
    for(const url of ['javascript:alert(1)','http://instagram.com/','https://instagram.com.evil.test/','https://instagram.com@evil.test/','https://user@instagram.com/','https://instagram.com:9999/','https://facebook.com/x','https://instagram.com\\evil.test/','https://instagram.com/ a']) expect(storeSocialUrl('instagram',url)).toBeNull();
  });
  it('익명 응답은 최소 필드만 파싱하고 잘못된 응답·중복 SNS를 거부한다',()=>{
    const data={displayName:'브랜드',logoPath:logo,mobileLogoPath:null,introduction:null,socials:[{platform:'blog',url:'https://blog.naver.com/shop'}]};
    expect(parseStorefrontBranding(data,path=>`asset:${path}`)).toMatchObject({displayName:'브랜드',logoUrl:`asset:${logo}`,mobileLogoUrl:null});
    expect(parseStorefrontBranding({...data,hiddenSetting:true},path=>path)).toBeNull();
    expect(parseStorefrontBranding({...data,socials:[...data.socials,...data.socials]},path=>path)).toBeNull();
    expect(parseStorefrontBranding({...data,logoPath:null,mobileLogoPath:logo},path=>path)).toBeNull();
  });
});

it('대표 이미지는 로고 모드와 별개이며 이전 입력의 누락과 명시적 삭제를 구분한다',()=>{
  expect(parseStoreBranding(DEFAULT_STORE_BRANDING)).not.toHaveProperty('profileImagePath');
  expect(parseStoreBranding({...DEFAULT_STORE_BRANDING,profileImagePath:null})).toHaveProperty('profileImagePath',null);
  expect(parseStoreBranding({...DEFAULT_STORE_BRANDING,profileImagePath:logo})).toHaveProperty('profileImagePath',logo);
  for(const profileImagePath of [undefined,1,'https://media.test/profile.png','public-media/catalog/good/00000000-0000-4000-8000-000000016001.png']) expect(parseStoreBranding({...DEFAULT_STORE_BRANDING,profileImagePath})).toBeNull();
  const publicProfile=storefrontBranding({...DEFAULT_STORE_BRANDING,profileImagePath:logo},path=>path);
  expect(publicProfile).toMatchObject({logoUrl:null,profileImageUrl:logo});
  expect(parseStorefrontBranding({displayName:'ICONS',logoPath:null,mobileLogoPath:null,introduction:null,socials:[],profileImagePath:logo},path=>path)).toEqual(publicProfile);
  expect(parseStorefrontBranding({displayName:'ICONS',logoPath:null,mobileLogoPath:null,introduction:null,socials:[],profileImagePath:'https://invalid.test/x'},path=>path)).toBeNull();
});
