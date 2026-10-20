import { DEFAULT_STOREFRONT_BRANDING, STORE_SOCIAL_LABELS, type StorefrontBranding } from '@/lib/store-branding';

/** Fits the existing header/footer logo link; callers retain its home destination. */
export function StoreBrandLogo({ branding = DEFAULT_STOREFRONT_BRANDING }: { branding?: StorefrontBranding }) {
  if (!branding.logoUrl) return branding.displayName === 'ICONS' ? <>ICONS</> : <span className="wc-store-brand-name" title={branding.displayName}>{branding.displayName}</span>;
  return <picture className="wc-store-brand-logo">
    {branding.mobileLogoUrl ? <source media="(max-width: 749px)" srcSet={branding.mobileLogoUrl} /> : null}
    {/* Uploaded and verified public-media assets do not need remote image optimization. */}
    <img alt={branding.displayName} src={branding.logoUrl} />
  </picture>;
}

export function StoreBrandFooterDetails({ branding = DEFAULT_STOREFRONT_BRANDING }: { branding?: StorefrontBranding }) {
  if (!branding.profileImageUrl && !branding.introduction && !branding.socials.length) return null;
  return <div className="wc-store-brand-details">
    {/* Verified public-media assets retain their normalized bytes and fixed display size. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {branding.profileImageUrl ? <img className="wc-store-profile-image" src={branding.profileImageUrl} alt={`${branding.displayName} 대표 이미지`} width={80} height={80} loading="lazy" /> : null}
    {branding.introduction ? <p>{branding.introduction}</p> : null}
    {branding.socials.length ? <nav aria-label="스토어 SNS"><ul>{branding.socials.map(({ platform, url }) => <li key={platform}>
      <a href={url} rel="noopener noreferrer" target="_blank">{STORE_SOCIAL_LABELS[platform]}<span className="wc-sr-only"> 새 창</span></a>
    </li>)}</ul></nav> : null}
  </div>;
}
