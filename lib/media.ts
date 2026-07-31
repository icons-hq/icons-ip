/* Supabase Storage의 공개 미디어 버킷 규약. 저장된 경로가 버킷 이름을 포함할 수도,
   포함하지 않을 수도 있어서 getPublicUrl에 넘기기 전에 항상 정규화해야 한다.
   이 규칙이 갈리면 같은 이미지가 화면마다 뜨거나 깨진다. */

export const PUBLIC_MEDIA_BUCKET = 'public-media';
export const PUBLIC_MEDIA_PREFIX = `${PUBLIC_MEDIA_BUCKET}/`;

/** 앞쪽 슬래시와 버킷 접두를 떼어 getPublicUrl이 받는 object 경로로 만든다. */
export function normalizePublicMediaPath(path: string): string {
  const withoutLeadingSlash = path.replace(/^\/+/, '');
  return withoutLeadingSlash.startsWith(PUBLIC_MEDIA_PREFIX)
    ? withoutLeadingSlash.slice(PUBLIC_MEDIA_PREFIX.length)
    : withoutLeadingSlash;
}

/** 이미지 URL을 CSS background 축약값으로 바꾼다. */
export const imageBg = (path: string) => `url("${path}") center / cover no-repeat`;
