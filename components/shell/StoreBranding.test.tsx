import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { StoreBrandFooterDetails, StoreBrandLogo, storefrontLogoName } from './StoreBranding';
import { DEFAULT_STOREFRONT_BRANDING } from '@/lib/store-branding';
it('기본 로고는 X SQUARE 이미지이고 숨겨진 소개/SNS는 이전 공개 화면을 유지한다',()=>{
  /* 2026-11-12 신사업팀이 보낸 로고(투명 PNG 800×127) — 업로드 로고가 없고 이름이 기본값일 때만 쓴다. */
  const html=renderToStaticMarkup(<StoreBrandLogo/>);
  expect(html).toBe('<picture class="wc-store-brand-logo wc-store-brand-logo--default"><img alt="X SQUARE" height="127" src="/brand/xsquare-logo.png" width="800"/></picture>');
  expect(renderToStaticMarkup(<StoreBrandFooterDetails/>)).toBe('');
});
it('이름을 바꾼 스토어는 글자 로고, 링크 이름은 기본 로고일 때만 X SQUARE다',()=>{
  const renamed={...DEFAULT_STOREFRONT_BRANDING,displayName:'검증 스토어'};
  expect(renderToStaticMarkup(<StoreBrandLogo branding={renamed}/>)).toBe('<span class="wc-store-brand-name" title="검증 스토어">검증 스토어</span>');
  expect(storefrontLogoName()).toBe('X SQUARE');
  expect(storefrontLogoName(renamed)).toBe('검증 스토어');
  expect(storefrontLogoName({...DEFAULT_STOREFRONT_BRANDING,logoUrl:'https://media.test/pc.png'})).toBe('엑스스퀘어');
});
it('서비스 이름 통일 전의 기본 이름(ICONS)이 남은 저장값도 글자로 새지 않고 기본 로고로 보인다',()=>{
  const legacy={...DEFAULT_STOREFRONT_BRANDING,displayName:'ICONS'};
  expect(renderToStaticMarkup(<StoreBrandLogo branding={legacy}/>)).toBe(renderToStaticMarkup(<StoreBrandLogo/>));
  expect(storefrontLogoName(legacy)).toBe('X SQUARE');
  /* 업로드 로고가 있으면 이름과 관계없이 업로드 로고가 먼저다. */
  expect(renderToStaticMarkup(<StoreBrandLogo branding={{...legacy,logoUrl:'https://media.test/pc.png'}}/>)).toContain('src="https://media.test/pc.png"');
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
  expect(html).toContain('class="wc-store-profile-image"');expect(html).toContain('alt="엑스스퀘어 대표 이미지"');
  expect(html).toContain('width="80"');expect(html).toContain('height="80"');
  expect(renderToStaticMarkup(<StoreBrandLogo branding={branding}/>)).toContain('src="/brand/xsquare-logo.png"');
});
