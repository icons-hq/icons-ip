export const STORE_DISPLAY_NAME_LIMIT = 30;
export const STORE_INTRODUCTION_LIMIT = 50;
export const STORE_SOCIAL_PLATFORMS = ['blog', 'facebook', 'instagram'] as const;
export type StoreSocialPlatform = typeof STORE_SOCIAL_PLATFORMS[number];
export const STORE_SOCIAL_LABELS: Record<StoreSocialPlatform, string> = {
  blog: '네이버 블로그', facebook: '페이스북', instagram: '인스타그램',
};
const SOCIAL_HOSTS: Record<StoreSocialPlatform, readonly string[]> = {
  blog: ['blog.naver.com', 'm.blog.naver.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
};
const LOGO_PATH = /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export interface StoreSocialSetting { enabled: boolean; url: string }
export interface StoreBranding {
  displayName: string;
  logoMode: 'text' | 'image';
  logoPath: string | null;
  mobileLogoPath: string | null;
  /** Omitted only by older settings callers; absence preserves the stored value. */
  profileImagePath?: string | null;
  introduction: string;
  showIntroduction: boolean;
  socials: Record<StoreSocialPlatform, StoreSocialSetting>;
}
export interface StorefrontBranding {
  displayName: string;
  logoUrl: string | null;
  mobileLogoUrl: string | null;
  profileImageUrl?: string | null;
  introduction: string | null;
  socials: { platform: StoreSocialPlatform; url: string }[];
}
export const DEFAULT_STORE_BRANDING: StoreBranding = {
  displayName: 'ICONS', logoMode: 'text', logoPath: null, mobileLogoPath: null,
  introduction: '', showIntroduction: false,
  socials: { blog: { enabled: false, url: '' }, facebook: { enabled: false, url: '' }, instagram: { enabled: false, url: '' } },
};
export const DEFAULT_STOREFRONT_BRANDING: StorefrontBranding = {
  displayName: 'ICONS', logoUrl: null, mobileLogoUrl: null, introduction: null, socials: [],
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function cleanLine(value: unknown, max: number, required = false): value is string {
  return typeof value === 'string' && value === value.trim() && [...value].length <= max
    && (!required || value.length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
}
export function storeSocialUrl(platform: StoreSocialPlatform, value: string): string | null {
  if (!value || value.length > 2048 || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !SOCIAL_HOSTS[platform].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
export function isStoreLogoPath(value: unknown): value is string {
  return typeof value === 'string' && LOGO_PATH.test(value);
}

/** Stored settings remain strict. An invalid row is not silently rewritten into defaults. */
export function parseStoreBranding(value: unknown): StoreBranding | null {
  if (!object(value) || !exactKeys(value, ['displayName', 'logoMode', 'logoPath', 'mobileLogoPath', 'introduction', 'showIntroduction', 'socials', ...(Object.hasOwn(value, 'profileImagePath') ? ['profileImagePath'] : [])])
    || !cleanLine(value.displayName, STORE_DISPLAY_NAME_LIMIT, true)
    || (value.logoMode !== 'text' && value.logoMode !== 'image')
    || (value.logoPath !== null && !isStoreLogoPath(value.logoPath))
    || (value.mobileLogoPath !== null && !isStoreLogoPath(value.mobileLogoPath))
    || (Object.hasOwn(value, 'profileImagePath') && value.profileImagePath !== null && !isStoreLogoPath(value.profileImagePath))
    || (value.logoMode === 'image' && value.logoPath === null)
    || !cleanLine(value.introduction, STORE_INTRODUCTION_LIMIT)
    || typeof value.showIntroduction !== 'boolean' || (value.showIntroduction && !value.introduction)
    || !object(value.socials) || !exactKeys(value.socials, STORE_SOCIAL_PLATFORMS)) return null;
  const socials = {} as StoreBranding['socials'];
  for (const platform of STORE_SOCIAL_PLATFORMS) {
    const setting = value.socials[platform];
    if (!object(setting) || !exactKeys(setting, ['enabled', 'url']) || typeof setting.enabled !== 'boolean'
      || typeof setting.url !== 'string' || (setting.enabled && !setting.url)
      || (setting.url && !storeSocialUrl(platform, setting.url))) return null;
    socials[platform] = { enabled: setting.enabled, url: setting.url ? storeSocialUrl(platform, setting.url)! : '' };
  }
  return { displayName: value.displayName, logoMode: value.logoMode, logoPath: value.logoPath,
    mobileLogoPath: value.mobileLogoPath,
    ...(Object.hasOwn(value, 'profileImagePath') ? { profileImagePath: value.profileImagePath as string | null } : {}), introduction: value.introduction, showIntroduction: value.showIntroduction, socials };
}

export function storefrontBranding(settings: StoreBranding, publicUrl: (path: string) => string): StorefrontBranding {
  return {
    displayName: settings.displayName,
    logoUrl: settings.logoMode === 'image' && settings.logoPath ? publicUrl(settings.logoPath) : null,
    mobileLogoUrl: settings.logoMode === 'image' && settings.mobileLogoPath ? publicUrl(settings.mobileLogoPath) : null,
    ...(Object.hasOwn(settings, 'profileImagePath') ? { profileImageUrl: settings.profileImagePath ? publicUrl(settings.profileImagePath) : null } : {}),
    introduction: settings.showIntroduction ? settings.introduction : null,
    socials: STORE_SOCIAL_PLATFORMS.flatMap(platform => settings.socials[platform].enabled
      ? [{ platform, url: settings.socials[platform].url }] : []),
  };
}

/** Anonymous RPC projection contains only the values selected for public display. */
export function parseStorefrontBranding(value: unknown, publicUrl: (path: string) => string): StorefrontBranding | null {
  if (!object(value) || !exactKeys(value, ['displayName', 'logoPath', 'mobileLogoPath', 'introduction', 'socials', ...(Object.hasOwn(value, 'profileImagePath') ? ['profileImagePath'] : [])])
    || !cleanLine(value.displayName, STORE_DISPLAY_NAME_LIMIT, true)
    || (value.logoPath !== null && !isStoreLogoPath(value.logoPath))
    || (value.mobileLogoPath !== null && (!isStoreLogoPath(value.mobileLogoPath) || value.logoPath === null))
    || (Object.hasOwn(value, 'profileImagePath') && value.profileImagePath !== null && !isStoreLogoPath(value.profileImagePath))
    || (value.introduction !== null && !cleanLine(value.introduction, STORE_INTRODUCTION_LIMIT, true))
    || !Array.isArray(value.socials) || value.socials.length > STORE_SOCIAL_PLATFORMS.length) return null;
  const seen = new Set<string>();
  const socials: StorefrontBranding['socials'] = [];
  for (const setting of value.socials) {
    if (!object(setting) || !exactKeys(setting, ['platform', 'url'])
      || !STORE_SOCIAL_PLATFORMS.includes(setting.platform as StoreSocialPlatform)
      || typeof setting.url !== 'string' || seen.has(String(setting.platform))) return null;
    const platform = setting.platform as StoreSocialPlatform;
    const url = storeSocialUrl(platform, setting.url);
    if (!url) return null;
    seen.add(platform); socials.push({ platform, url });
  }
  return { displayName: value.displayName,
    logoUrl: value.logoPath ? publicUrl(value.logoPath) : null,
    mobileLogoUrl: value.mobileLogoPath ? publicUrl(value.mobileLogoPath) : null,
    ...(Object.hasOwn(value, 'profileImagePath') ? { profileImageUrl: value.profileImagePath ? publicUrl(value.profileImagePath as string) : null } : {}),
    introduction: value.introduction, socials };
}
