export function decodeUtf8Strict(bytes, field) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error(`${field} must be valid UTF-8`, { cause });
  }
}
