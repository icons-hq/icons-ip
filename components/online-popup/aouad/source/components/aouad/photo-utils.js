const PHOTO_MAX_EDGE = 240;

export function scaledPhotoSize(width, height, maxEdge = PHOTO_MAX_EDGE) {
  const ratio = Math.min(maxEdge / width, maxEdge / height, 1);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
