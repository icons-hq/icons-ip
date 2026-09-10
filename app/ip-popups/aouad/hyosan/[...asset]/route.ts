import { createAouadHyosanAssetResponse } from '@/lib/aouad-hyosan-assets.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ asset: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return createAouadHyosanAssetResponse(request, (await params).asset);
}

export async function HEAD(request: Request, { params }: Context) {
  return createAouadHyosanAssetResponse(request, (await params).asset);
}
