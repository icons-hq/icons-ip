import { createAouadAssetResponse } from '@/lib/aouad-assets.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ asset: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return createAouadAssetResponse(request, (await params).asset);
}

export async function HEAD(request: Request, { params }: Context) {
  return createAouadAssetResponse(request, (await params).asset);
}
