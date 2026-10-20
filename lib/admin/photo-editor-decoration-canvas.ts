import { layoutPhotoDecoratedText, photoStickerGeometry, photoTextGeometry, type PhotoGeometryPath, type PhotoSticker } from './photo-editor-decorations';
import type { PhotoText } from './photo-editor-layers';

export function drawPhotoGeometry(context: CanvasRenderingContext2D, paths: readonly PhotoGeometryPath[], ink: string, paper = '#ffffff'): void {
  for (const path of paths) {
    context.beginPath();
    for (const command of path.commands) {
      if (command[0] === 'M') context.moveTo(command[1], command[2]);
      else if (command[0] === 'L') context.lineTo(command[1], command[2]);
      else if (command[0] === 'C') context.bezierCurveTo(command[1], command[2], command[3], command[4], command[5], command[6]);
      else context.closePath();
    }
    if (path.fill) { context.fillStyle = path.fill === 'paper' ? paper : ink; context.fill(); }
    if (path.stroke) {
      context.strokeStyle = ink; context.lineWidth = path.strokeWidth ?? 1;
      context.lineCap = 'round'; context.lineJoin = 'round'; context.setLineDash(path.dash ?? []); context.stroke();
    }
  }
}

export function drawPhotoSticker(context: CanvasRenderingContext2D, sticker: PhotoSticker): void {
  if (!sticker.opacity) return;
  context.save();
  try {
    context.globalCompositeOperation = 'source-over'; context.globalAlpha = sticker.opacity / 100;
    context.translate(sticker.x + sticker.width / 2, sticker.y + sticker.width / 2);
    context.rotate(sticker.turns * Math.PI / 2); context.scale(sticker.width / 100, sticker.width / 100); context.translate(-50, -50);
    drawPhotoGeometry(context, photoStickerGeometry(sticker.asset), sticker.color);
  } finally { context.restore(); }
}

/** Plain text retains its existing drawing path and baseline exactly. */
export function drawPhotoText(context: CanvasRenderingContext2D, layer: PhotoText): void {
  if (!layer.text.trim()) return;
  context.font = `400 ${layer.fontSize}px "Pretendard"`;
  context.textAlign = 'left'; context.textBaseline = 'top'; context.fillStyle = layer.color;
  if (!layer.style || layer.style === 'plain') {
    layer.text.split('\n').forEach((line, index) => context.fillText(line, layer.x, layer.y + index * layer.fontSize * 1.3));
    return;
  }
  context.save();
  try {
    context.textBaseline = 'alphabetic';
    const lines = layoutPhotoDecoratedText(layer.text, layer.style, layer.decorationWidth!, layer.fontSize, line => context.measureText(line));
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    context.translate(layer.x, layer.y);
    context.save();
    try { context.scale(layer.decorationWidth! / 100, layer.decorationWidth! / 100); drawPhotoGeometry(context, photoTextGeometry(layer.style).paths, layer.color, layer.backgroundColor); }
    finally { context.restore(); }
    context.fillStyle = layer.color;
    for (const line of lines) context.fillText(line.text, line.x, line.y);
  } finally { context.restore(); }
}
