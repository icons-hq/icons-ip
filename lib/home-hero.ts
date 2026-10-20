export const HOME_HERO_LIMIT = 10;
export const HOME_HERO_TITLE_LIMIT = 40;
export const HOME_HERO_CONTENT_LIMIT = 150;

export type HomeHeroImageDim = 'none' | 'white' | 'black';
export type HomeHeroTextColor = 'white' | 'black';

export function isHomeHeroImageDim(value: unknown): value is HomeHeroImageDim {
  return value === 'none' || value === 'white' || value === 'black';
}

export function isHomeHeroTextColor(value: unknown): value is HomeHeroTextColor {
  return value === 'white' || value === 'black';
}

/** Missing options are a legacy rendering contract, not the new "none" value. */
export function homeHeroStyle(payload: Record<string, unknown> | null) {
  return {
    imageDim: isHomeHeroImageDim(payload?.image_dim) ? payload.image_dim : undefined,
    textColor: isHomeHeroTextColor(payload?.text_color) ? payload.text_color : undefined,
  };
}

export function normalizeHeroNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/** Image descriptions are separate from the visible title and subtitle. */
export function homeHeroAltText(payload: Record<string, unknown> | null): string {
  if (payload?.alt_enabled !== true) return '';
  return [payload.alt_title, payload.alt_content]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim())
    .join(' · ');
}
