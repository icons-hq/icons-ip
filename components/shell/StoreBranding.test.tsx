import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { StoreBrandFooterDetails, StoreBrandLogo } from './StoreBranding';
import { DEFAULT_STOREFRONT_BRANDING } from '@/lib/store-branding';
it('기본 로고와 숨겨진 소개/SNS는 이전 공개 화면을 유지한다',()=>{
  expect(renderToStaticMarkup(<StoreBrandLogo/>)).toBe('ICONS');
  expect(renderToStaticMarkup(<StoreBrandFooterDetails/>)).toBe('');
});
it('PC 로고를 기본으로 사용하고 모바일 원본은 선택적으로 제공한다',()=>{
  const base={...DEFAULT_STOREFRONT_BRANDING,displayName:'<브랜드>',logoUrl:'https://media.test/pc.png'};
  const html=renderToStaticMarkup(<StoreBrandLogo branding={base}/>);
  expect(html).toContain('alt="&lt;브랜드&gt;"');expect(html).toContain('src="https://media.test/pc.png"');expect(html).not.toContain('<source');
  expect(renderToStaticMarkup(<StoreBrandLogo branding={{...base,mobileLogoUrl:'https://media.test/mobile.png'}}/>)).toContain('srcSet="https://media.test/mobile.png"');
});
it('소개는 텍스트로 이스케이프하고 SNS 새 창에 안전한 rel을 붙인다',()=>{
  const html=renderToStaticMarkup(<StoreBrandFooterDetails branding={{...DEFAULT_STOREFRONT_BRANDING,introduction:'<script>hello</script>',socials:[{platform:'instagram',url:'https://instagram.com/shop/'}]}}/>);
  expect(html).toContain('&lt;script&gt;hello&lt;/script&gt;');expect(html).toContain('target="_blank"');expect(html).toContain('rel="noopener noreferrer"');expect(html).toContain('인스타그램');expect(html).toContain('새 창');
});

it('대표 이미지만 있어도 푸터 프로필은 표시하고 헤더 로고는 유지한다',()=>{
  const branding={...DEFAULT_STOREFRONT_BRANDING,profileImageUrl:'https://media.test/profile.png'};
  const html=renderToStaticMarkup(<StoreBrandFooterDetails branding={branding}/>);
  expect(html).toContain('class="wc-store-profile-image"');expect(html).toContain('alt="ICONS 대표 이미지"');
  expect(html).toContain('width="80"');expect(html).toContain('height="80"');
  expect(renderToStaticMarkup(<StoreBrandLogo branding={branding}/>)).toBe('ICONS');
});
