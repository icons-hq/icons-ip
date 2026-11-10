import type { PhotoSize } from './photo-editor';
import { ellipsePhotoPath, polygonPhotoPath, rectanglePhotoPath, type PhotoGeometryPath, type PhotoPathCommand } from './photo-editor-decorations';
import { drawPhotoGeometry } from './photo-editor-decoration-canvas';

export const PHOTO_MASKS = ['none', 'circle', 'rounded', 'triangle', 'pentagon', 'hexagon', 'star'] as const;
export type PhotoMask = typeof PHOTO_MASKS[number];
export const PHOTO_FRAME_STYLES = [{ value: 'solid', label: '단색 테두리' }, { value: 'double', label: '이중선 액자' }, { value: 'dashed', label: '점선 액자' }] as const;
export type PhotoFrameStyle = typeof PHOTO_FRAME_STYLES[number]['value'];
export type PhotoPresentation = { mask: PhotoMask; frameWidth: number; frameColor: string; frameStyle?: PhotoFrameStyle };

export function validatePhotoPresentation(value: PhotoPresentation): void {
  if (!PHOTO_MASKS.includes(value.mask) || !Number.isInteger(value.frameWidth) || value.frameWidth < 0 || value.frameWidth > 64
    || !PHOTO_FRAME_STYLES.some(style => style.value === (value.frameStyle ?? 'solid'))
    || typeof value.frameColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.frameColor))
    throw new Error('사진 테두리·도형 값을 확인해주세요.');
}

function decorationOutline(size: PhotoSize, mask: PhotoMask, inset: number): PhotoPathCommand[] {
  const outer = photoOutline(size, mask);
  if (outer?.kind === 'polygon') {
    // New double contours retain the exact polygon shape as nested radial copies.
    // The existing solid frame keeps its uniform-distance round-join contract.
    const scale = Math.max(0, 1 - inset * 2 / Math.min(size.width, size.height));
    return polygonPhotoPath(outer.points.map(point => ({ x: size.width / 2 + (point.x - size.width / 2) * scale, y: size.height / 2 + (point.y - size.height / 2) * scale })));
  }
  const outline = photoOutline(size, mask, inset);
  if (!outline) return [];
  return outline.kind === 'circle' ? ellipsePhotoPath(outline.x, outline.y, outline.radius, outline.radius)
    : outline.kind === 'rectangle' ? rectanglePhotoPath(outline.x, outline.y, outline.width, outline.height, outline.radius) : [];
}

/** Shared numeric paths for the new frame preview and full-resolution Canvas. */
export function photoDecoratedFrameGeometry(size: PhotoSize, presentation: PhotoPresentation): PhotoGeometryPath[] {
  const width = photoFrameWidth(size, presentation.frameWidth), style = presentation.frameStyle ?? 'solid';
  if (!width || style === 'solid') return [];
  if (style === 'double' && width >= 3) return [width / 6, width * 5 / 6].map(inset => ({
    commands: decorationOutline(size, presentation.mask, inset), stroke: 'ink', strokeWidth: width / 3,
  }));
  return [{ commands: decorationOutline(size, presentation.mask, width / 2), stroke: 'ink', strokeWidth: width,
    ...(style === 'dashed' ? { dash: [width * 3, width * 2] } : {}) }];
}

export function photoFrameMaximum(size: PhotoSize): number {
  return Math.min(64, Math.floor(Math.min(size.width, size.height) / 2));
}

export function photoFrameWidth(size: PhotoSize, requested: number): number {
  return Math.max(0, Math.min(photoFrameMaximum(size), requested));
}

export type PhotoOutline = { kind: 'circle'; x: number; y: number; radius: number }
  | { kind: 'rectangle'; x: number; y: number; width: number; height: number; radius: number }
  | { kind: 'polygon'; points: { x: number; y: number }[] };

/** Geometry is based on the final crop, never on the source size or reduced preview. */
export function photoOutline(size: PhotoSize, mask: PhotoMask, inset = 0): PhotoOutline | null {
  if (mask === 'triangle' || mask === 'pentagon' || mask === 'hexagon' || mask === 'star') {
    // Polygon borders use the distance to this path, not a smaller radial copy.
    if (inset !== 0) throw new Error('다각형 테두리는 바깥 윤곽의 안쪽 선으로 그립니다.');
    const count = mask === 'triangle' ? 3 : mask === 'pentagon' ? 5 : mask === 'hexagon' ? 6 : 10;
    const radius = Math.min(size.width, size.height) / 2;
    return { kind: 'polygon', points: Array.from({ length: count }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
      const distance = radius * (mask === 'star' && index % 2 ? .45 : 1);
      return { x: size.width / 2 + Math.cos(angle) * distance, y: size.height / 2 + Math.sin(angle) * distance };
    }) };
  }
  if (mask === 'circle') {
    const radius = Math.min(size.width, size.height) / 2 - inset;
    return radius > 0 ? { kind: 'circle', x: size.width / 2, y: size.height / 2, radius } : null;
  }
  const width = size.width - 2 * inset, height = size.height - 2 * inset;
  if (width <= 0 || height <= 0) return null;
  return { kind: 'rectangle', x: inset, y: inset, width, height,
    radius: mask === 'rounded' ? Math.max(0, Math.min(size.width, size.height) * .1 - inset) : 0 };
}

/** Each outline starts a separate closed subpath so evenodd makes a true inside ring. */
function appendOutline(context: CanvasRenderingContext2D, outline: PhotoOutline | null): void {
  if (!outline) return;
  if (outline.kind === 'circle') {
    context.moveTo(outline.x + outline.radius, outline.y);
    context.arc(outline.x, outline.y, outline.radius, 0, Math.PI * 2);
  } else if (outline.kind === 'polygon') {
    outline.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  } else if (!outline.radius) context.rect(outline.x, outline.y, outline.width, outline.height);
  else {
    const { x, y, width, height, radius: r } = outline, right = x + width, bottom = y + height;
    context.moveTo(x + r, y); context.lineTo(right - r, y); context.arcTo(right, y, right, y + r, r);
    context.lineTo(right, bottom - r); context.arcTo(right, bottom, right - r, bottom, r);
    context.lineTo(x + r, bottom); context.arcTo(x, bottom, x, bottom - r, r);
    context.lineTo(x, y + r); context.arcTo(x, y, x + r, y, r);
  }
  context.closePath();
}

/** Source-over the inside border, then apply one outer mask to the complete composition. */
export function drawPhotoPresentation(context: CanvasRenderingContext2D, size: PhotoSize, presentation: PhotoPresentation): void {
  validatePhotoPresentation(presentation);
  const width = photoFrameWidth(size, presentation.frameWidth);
  if (!width && presentation.mask === 'none') return;
  context.save();
  try {
    // The final crop canvas may still carry its source rotation/mirroring matrix.
    context.resetTransform(); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    const outer = photoOutline(size, presentation.mask);
    if (width && presentation.frameStyle && presentation.frameStyle !== 'solid') {
      drawPhotoGeometry(context, photoDecoratedFrameGeometry(size, presentation), presentation.frameColor);
    } else if (width) {
      context.beginPath(); appendOutline(context, outer);
      if (outer?.kind === 'polygon') {
        // Twice the requested width reaches exactly that far inside the outline.
        // The one final mask removes the outer half, including star concavities.
        context.strokeStyle = presentation.frameColor; context.lineWidth = width * 2;
        context.lineJoin = 'round'; context.stroke();
      } else {
        appendOutline(context, photoOutline(size, presentation.mask, width));
        context.fillStyle = presentation.frameColor; context.fill('evenodd');
      }
    }
    if (presentation.mask !== 'none') {
      context.globalCompositeOperation = 'destination-in'; context.fillStyle = '#000000';
      context.beginPath(); appendOutline(context, outer); context.fill();
    }
  } finally { context.restore(); }
}
