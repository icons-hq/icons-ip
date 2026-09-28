import 'server-only';

import { extname, join } from 'node:path';
import assetIndex from '@/components/online-popup/aouad/asset-index.json';
import { canViewAouadPopup } from '@/lib/aouad-popup.server';
import { createPopupAssetResponse, type PopupAsset } from '@/lib/popup-assets.server';

const ASSET_ROOT = join(process.cwd(), 'private/ip-popups/aouad');
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.json': 'application/json',
};
const FILES: Readonly<Record<string, PopupAsset>> = Object.fromEntries(
  Object.entries(assetIndex).map(([path, entry]) => [path, {
    ...entry, path, contentType: CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
  }]),
);

export async function createAouadAssetResponse(request: Request, parts: string[]): Promise<Response> {
  return createPopupAssetResponse(request, parts, { root: ASSET_ROOT, files: FILES, canView: canViewAouadPopup });
}
