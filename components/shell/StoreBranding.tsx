import { DEFAULT_STOREFRONT_BRANDING, STORE_SOCIAL_LABELS, type StorefrontBranding } from '@/lib/store-branding';

/* X SQUARE 기본 로고(ADR-0043, 2026-11-12 신사업팀 전달). 운영자가 업로드한 로고가 있으면 그게 먼저다 —
   기본 이미지는 업로드 로고가 없고 이름이 기본값('엑스스퀘어')일 때만 쓴다. 법인 상호((주)아이콘스)는 사업자 정보에서 따로 온다. */
export const DEFAULT_STORE_LOGO = { src: '/brand/xsquare-logo.png', name: 'X SQUARE', width: 800, height: 127 } as const;
/* 2026-11-24 서비스 이름을 엑스스퀘어로 통일하기 전의 기본 이름. 저장값은 migration이 바꾸지만, 아직 그 migration이 닿지 않은 DB(로컬·
   이전 스냅숏)에서도 옛 이름이 글자 로고로 새지 않고 기본 로고가 보이도록 기본값으로 함께 본다. */
const LEGACY_DEFAULT_STORE_NAME = 'ICONS';

function usesDefaultLogo(branding: StorefrontBranding): boolean {
  return !branding.logoUrl
    && (branding.displayName === DEFAULT_STOREFRONT_BRANDING.displayName || branding.displayName === LEGACY_DEFAULT_STORE_NAME);
}

/** 로고 링크의 접근 이름 기반 — 기본 로고일 때는 로고 이미지가 말하는 이름('X SQUARE'), 아니면 운영 설정 이름이다. */
export function storefrontLogoName(branding: StorefrontBranding = DEFAULT_STOREFRONT_BRANDING): string {
  return usesDefaultLogo(branding) ? DEFAULT_STORE_LOGO.name : branding.displayName;
}

/** Fits the existing header/footer logo link; callers retain its home destination. */
export function StoreBrandLogo({ branding = DEFAULT_STOREFRONT_BRANDING }: { branding?: StorefrontBranding }) {
  if (!branding.logoUrl) {
    if (usesDefaultLogo(branding)) {
      return <picture className="wc-store-brand-logo wc-store-brand-logo--default">
        {/* Bundled brand asset served as-is: 투명 PNG 한 장이라 원격 이미지 최적화가 필요 없다. */}
        <img alt={DEFAULT_STORE_LOGO.name} height={DEFAULT_STORE_LOGO.height} src={DEFAULT_STORE_LOGO.src} width={DEFAULT_STORE_LOGO.width} />
      </picture>;
    }
    return <span className="wc-store-brand-name" title={branding.displayName}>{branding.displayName}</span>;
  }
  return <picture className="wc-store-brand-logo">
    {branding.mobileLogoUrl ? <source media="(max-width: 749px)" srcSet={branding.mobileLogoUrl} /> : null}
    {/* Uploaded and verified public-media assets do not need remote image optimization. */}
    <img alt={branding.displayName} src={branding.logoUrl} />
  </picture>;
}

export function StoreBrandFooterDetails({ branding = DEFAULT_STOREFRONT_BRANDING, className }: { branding?: StorefrontBranding; className?: string }) {
  if (!branding.profileImageUrl && !branding.introduction && !branding.socials.length) return null;
  return <div className={`wc-store-brand-details${className ? ` ${className}` : ''}`}>
    {/* Verified public-media assets retain their normalized bytes and fixed display size. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {branding.profileImageUrl ? <img className="wc-store-profile-image" src={branding.profileImageUrl} alt={`${branding.displayName} 대표 이미지`} width={80} height={80} loading="lazy" /> : null}
    {branding.introduction ? <p>{branding.introduction}</p> : null}
    {branding.socials.length ? <nav aria-label="스토어 SNS"><ul>{branding.socials.map(({ platform, url }) => <li key={platform}>
      <a href={url} rel="noopener noreferrer" target="_blank">{STORE_SOCIAL_LABELS[platform]}<span className="wc-sr-only"> 새 창</span></a>
    </li>)}</ul></nav> : null}
  </div>;
}
