import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_CANDIDATE_PATH = join(
  process.cwd(),
  'outputs/last-bell-character-sources/experiments/hybrid-cinematic-impostor-v1/delivery/hybrid-namra-impostor-v1.ktx2.meshopt.glb',
);

/**
 * The hybrid candidate is intentionally served only from a local development
 * process. It never has a public generated-asset path or a manifest entry, so
 * Preview/production cannot accidentally ship this unapproved image-based
 * experiment.
 */
export async function GET() {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 });

  try {
    const binary = await readFile(PRIVATE_CANDIDATE_PATH);
    return new Response(binary, {
      headers: {
        'Content-Type': 'model/gltf-binary',
        'Cache-Control': 'no-store, private',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
