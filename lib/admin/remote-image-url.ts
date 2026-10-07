/**
 * Returns the https URL the server will request, or null when the reference cannot be
 * fetched safely. http is upgraded to https on the default port; credentials, other
 * ports and other schemes are refused. Spaces and non-ASCII path characters are
 * percent-encoded by the URL parser (hosted file names such as "상세 01.jpg");
 * control characters and backslashes are refused. DNS and network checks live in
 * remote-image-fetch.server.ts.
 */
export function normalizeRemoteImageUrl(source: string): URL | null {
  const text = source.trim();
  if (!text || /[\u0000-\u001f\u007f\\]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text.startsWith('//') ? `https:${text}` : text);
  } catch {
    return null;
  }
  if (url.protocol === 'http:') {
    if (url.port && url.port !== '80') return null;
    url.protocol = 'https:';
    url.port = '';
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    return null;
  return url;
}
