import { timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';

const OPAQUE_SECRET = /^[A-Za-z0-9_-]{16,128}$/;
const TABLE = /^(public|private|auth)\.[a-z_][a-z0-9_]{0,62}$/;
const COLUMN = /^[a-z_][a-z0-9_]{0,62}$/;

function authorized(request: Request) {
  const secret = process.env.ERP_SYNC_SECRET;
  const authorization = request.headers.get('authorization');
  if (!secret || !OPAQUE_SECRET.test(secret) || !authorization?.startsWith('Bearer ')) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(authorization.slice('Bearer '.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

type Read = {
  p_table: string | null;
  p_columns: string[] | null;
  p_after: Record<string, unknown> | null;
  p_where: Record<string, unknown[]> | null;
  p_limit: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readRequest(input: Record<string, unknown>): Read | null {
  const { table = null, columns = null, after = null, where = null, limit = 500 } = input;
  if (table !== null && (typeof table !== 'string' || !TABLE.test(table))) return null;
  if (columns !== null && (!Array.isArray(columns) || !columns.every((c) => typeof c === 'string' && COLUMN.test(c)))) return null;
  if (after !== null && !isObject(after)) return null;
  if (where !== null && (!isObject(where) || !Object.values(where).every(Array.isArray))) return null;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1000) return null;
  return {
    p_table: table,
    p_columns: columns as string[] | null,
    p_after: after,
    p_where: where as Record<string, unknown[]> | null,
    p_limit: limit,
  };
}

function fromQuery(url: URL): Record<string, unknown> | null {
  const json = (key: string) => {
    const text = url.searchParams.get(key);
    return text === null ? null : JSON.parse(text);
  };
  try {
    const limit = url.searchParams.get('limit');
    return {
      table: url.searchParams.get('table'),
      columns: url.searchParams.get('columns')?.split(',').filter(Boolean) ?? null,
      after: json('after'),
      where: json('where'),
      limit: limit === null ? 500 : Number(limit),
    };
  } catch {
    return null;
  }
}

async function run(read: Read | null) {
  if (!read) return response({ error: 'invalid_request' }, 400);
  try {
    const { data, error } = await createServiceClient().rpc('service_erp_read', read);
    if (error?.code === '22023') return response({ error: 'invalid_request' }, 400);
    if (error || !isObject(data)) return response({ error: 'read_failed' }, 502);
    return response(data, 200);
  } catch {
    return response({ error: 'read_failed' }, 502);
  }
}

/**
 * ERP 데이터 읽기 — AX 서버(ERPNext 연동)가 몰 업무 표를 이 길 하나로 읽는다(읽기 전용).
 * 문은 분리된 Bearer `ERP_SYNC_SECRET` 상수 시간 비교 하나이고, 값이 없으면 라우트가 닫힌다.
 * 표를 안 주면 읽을 수 있는 표·칸 목록, 주면 그 표의 줄 — `columns` 로 칸을 고르고 `where`({칸: [값]})로 거르고
 * 응답의 `next` 를 `after` 로 넘겨 이어 읽는다. 비밀 표·칸은 `service_erp_read` 가 막는다.
 * GET 은 같은 값을 쿼리로(`after`·`where` 는 JSON), POST 는 JSON 본문으로 — 긴 `where` 는 POST.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return response({ error: 'unauthorized' }, 401);
  const query = fromQuery(new URL(request.url));
  return run(query ? readRequest(query) : null);
}

export async function POST(request: Request) {
  if (!authorized(request)) return response({ error: 'unauthorized' }, 401);
  const body: unknown = await request.json().catch(() => null);
  return run(isObject(body) ? readRequest(body) : null);
}
