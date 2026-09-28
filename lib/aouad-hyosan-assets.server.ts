import 'server-only';

import { join } from 'node:path';
import manifest from '@/components/online-popup/aouad/hyosan/package-manifest.json';
import { canViewAouadPopup } from '@/lib/aouad-popup.server';
import { createPopupAssetResponse } from '@/lib/popup-assets.server';

export { selectAssetEncoding as selectHyosanEncoding } from '@/lib/popup-assets.server';

const ASSET_ROOT = join(process.cwd(), 'private/ip-popups/aouad-hyosan');

export async function createAouadHyosanAssetResponse(request: Request, parts: string[]): Promise<Response> {
  return createPopupAssetResponse(request, parts, { root: ASSET_ROOT, files: manifest.files, canView: canViewAouadPopup });
}
