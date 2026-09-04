import { timingSafeEqual } from 'node:crypto';
import { runCashReceiptJob } from '@/lib/payments/cash-receipts.server';

/* D-3 현금영수증 워커. Vercel 크론은 GET 만 보낸다. */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json',
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  if (!secret || !authorization?.startsWith('Bearer ')) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(authorization.slice('Bearer '.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function work(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false }, { headers: NO_STORE_HEADERS, status: 401 });
  }
  try {
    const result = await runCashReceiptJob();
    return Response.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS, status: 200 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'unknown_error' },
      { headers: NO_STORE_HEADERS, status: 503 },
    );
  }
}

export async function GET(request: Request) {
  return work(request);
}

export async function POST(request: Request) {
  return work(request);
}
