import { isTusinSurvivalPrototypeEnabled } from '@/lib/prototypes/tusin-survival/gate.server';
import { readTusinSurvivalAsset } from '@/lib/prototypes/tusin-survival/assets.server';

export const runtime = 'nodejs';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function errorResponse(status: 404 | 500, code: 'not_found' | 'asset_unavailable') {
  return Response.json(
    { error: { code } },
    {
      status,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'application/json',
      },
    },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  if (!isTusinSurvivalPrototypeEnabled()) return errorResponse(404, 'not_found');

  const { assetId } = await context.params;
  try {
    const asset = await readTusinSurvivalAsset(assetId);
    if (!asset) return errorResponse(404, 'not_found');

    return new Response(Uint8Array.from(asset.bytes), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': asset.contentType,
      },
    });
  } catch {
    console.error('[tusin-survival/assets] failed to read prototype asset');
    return errorResponse(500, 'asset_unavailable');
  }
}
