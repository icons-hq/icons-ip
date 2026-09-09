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

/*
 * 서버 왕복 없이 Storage 공개 URL을 만든다 — supabase-js `getPublicUrl`과 같은 모양
 * (`<url>/storage/v1/object/public/<bucket>/<path>`, encodeURI). 어드민 폼이 저장 실패
 * 뒤 업로드된 아트워크 미리보기를 되살릴 때처럼, 클라이언트에 경로만 남은 자리에서 쓴다.
 * `process.env.NEXT_PUBLIC_*` 참조는 그대로 두어야 클라이언트 번들에 인라인된다.
 */
export function publicMediaUrl(
  path: string,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  const base = supabaseUrl?.trim().replace(/\/+$/, '');
  if (!base) return null;
  return encodeURI(`${base}/storage/v1/object/public/${PUBLIC_MEDIA_BUCKET}/${normalizePublicMediaPath(path)}`);
}

/** 이미지 URL을 CSS background 축약값으로 바꾼다. */
export const imageBg = (path: string) => `url("${path}") center / cover no-repeat`;

/* CSS `url()` 안의 값. 따옴표는 있어도 없어도 되고, 뒤에 gradient 레이어가 붙는다. */
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/;

/*
 * `imageBg`의 역방향. 카탈로그 레코드의 `bg`는 두 종류가 섞여 있다 —
 * gradient만 담은 값과, 이미지 레이어를 앞세운 값. 후자에서 이미지 URL만 되돌린다.
 * 아트워크를 Storage에 올리기 전의 레코드는 이 값이 화면에 나가는 유일한 이미지다.
 */
export function imageUrlFromBg(bg: string | null | undefined): string | null {
  if (!bg) return null;
  const matched = CSS_URL_PATTERN.exec(bg);
  if (!matched) return null;
  const url = (matched[1] ?? matched[2] ?? matched[3] ?? '').trim();
  return url || null;
}
