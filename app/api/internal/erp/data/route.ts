import { timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';

const OPAQUE_SECRET = /^[A-Za-z0-9_-]{16,128}$/;
const TABLE = /^(public|private|auth)\.[a-z_][a-z0-9_]{0,62}$/;
const COLUMN = /^[a-z_][a-z0-9_]{0,62}$/;
const DENIED_NOTE_INTERVAL_MS = 10_000;

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
  p_settled: boolean | null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readRequest(input: Record<string, unknown>): Read | null {
  const { table = null, columns = null, after = null, where = null, limit = 500, settled = null } = input;
  if (table !== null && (typeof table !== 'string' || !TABLE.test(table))) return null;
  if (columns !== null && (!Array.isArray(columns) || !columns.every((c) => typeof c === 'string' && COLUMN.test(c)))) return null;
  if (after !== null && !isObject(after)) return null;
  if (where !== null && (!isObject(where) || !Object.values(where).every(Array.isArray))) return null;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1000) return null;
  if (settled !== null && typeof settled !== 'boolean') return null;
  return {
    p_table: table,
    p_columns: columns as string[] | null,
    p_after: after,
    p_where: where as Record<string, unknown[]> | null,
    p_limit: limit,
    p_settled: settled,
  };
}

function fromQuery(url: URL): Record<string, unknown> | null {
  // GET 쿼리는 Vercel 접근 로그에 그대로 남는다. 값이 실리는 `where`·`after` 는 POST 본문으로만 받는다.
  if (url.searchParams.has('where') || url.searchParams.has('after')) return null;
  const limit = url.searchParams.get('limit');
  return {
    table: url.searchParams.get('table'),
    columns: url.searchParams.get('columns')?.split(',').filter(Boolean) ?? null,
    limit: limit === null ? 500 : Number(limit),
  };
}

// 읽기 성공은 `service_erp_read` 가 같은 트랜잭션에서 기록한다(기록 실패 = 읽기 실패). 아래는 줄이 나가지 않은 경우의 기록이라,
// 실패해도 응답을 바꾸지 않는다. 값은 넘기지 않고 이름만 넘긴다(식별자 모양 검사는 DB 함수가 다시 한다).
async function note(outcome: 'rejected' | 'failed', input: Record<string, unknown> | null) {
  const columns = Array.isArray(input?.columns) ? input.columns.filter((c): c is string => typeof c === 'string') : null;
  const where = isObject(input?.where) ? input.where : null;
  try {
    await createServiceClient().rpc('service_erp_note_access', {
      p_outcome: outcome,
      p_table: typeof input?.table === 'string' ? input.table : null,
      p_columns: columns,
      p_filters: where ? Object.keys(where) : null,
    });
  } catch {
    // 기록 경로의 장애가 거절·실패 응답을 바꾸지 않는다.
  }
}

async function run(read: Read | null, input: Record<string, unknown> | null) {
  if (!read) {
    await note('rejected', input);
    return response({ error: 'invalid_request' }, 400);
  }
  try {
    const { data, error } = await createServiceClient().rpc('service_erp_read', read);
    if (error?.code === '22023') {
      await note('rejected', input);
      return response({ error: 'invalid_request' }, 400);
    }
    if (error || !isObject(data)) {
      await note('failed', input);
      return response({ error: 'read_failed' }, 502);
    }
    return response(data, 200);
  } catch {
    await note('failed', input);
    return response({ error: 'read_failed' }, 502);
  }
}

let deniedPending = 0;
let deniedNotedAt = 0;

/**
 * 인증 실패 기록 — 미인증 요청이 DB 쓰기를 부를 수 있는 유일한 길이라 인스턴스마다 10초에 한 번만 쓰고
 * 그 사이 건수는 다음 기록에 더한다. 비밀 값이 없어 라우트가 닫혀 있으면 기록하지 않는다.
 */
async function noteDenied() {
  if (!OPAQUE_SECRET.test(process.env.ERP_SYNC_SECRET ?? '')) return;
  deniedPending += 1;
  const now = Date.now();
  if (now - deniedNotedAt < DENIED_NOTE_INTERVAL_MS) return;
  const count = deniedPending;
  deniedPending = 0;
  deniedNotedAt = now;
  try {
    await createServiceClient().rpc('service_erp_note_access', { p_outcome: 'denied', p_count: count });
  } catch {
    // 기록 경로의 장애가 401 을 바꾸지 않는다.
  }
}

/**
 * ERP 데이터 읽기 — AX 서버(ERPNext 연동)가 몰 업무 표를 이 길 하나로 읽는다(읽기 전용).
 * 문은 분리된 Bearer `ERP_SYNC_SECRET` 상수 시간 비교 하나이고, 값이 없으면 라우트가 닫힌다.
 * 표를 안 주면 읽을 수 있는 표·칸 목록, 주면 그 표의 줄 — `columns` 로 칸을 고르고 `where`({칸: [값]})로 거르고
 * 응답의 `next` 를 `after` 로 넘겨 이어 읽는다. 비밀 표·칸은 `service_erp_read` 가 막는다.
 * GET 은 표·칸·한도만, 값이 실리는 `after`·`where` 는 POST 본문으로만 — 쿼리는 접근 로그에 남기 때문이다.
 * 이어 읽기는 진행 중 트랜잭션 뒤의 줄을 잠시 숨기는 안전 경계(`settled_before`)를 쓴다. `settled: false` 는 전수 대사용이다.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    await noteDenied();
    return response({ error: 'unauthorized' }, 401);
  }
  const query = fromQuery(new URL(request.url));
  return run(query ? readRequest(query) : null, query);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    await noteDenied();
    return response({ error: 'unauthorized' }, 401);
  }
  const body: unknown = await request.json().catch(() => null);
  const input = isObject(body) ? body : null;
  return run(input ? readRequest(input) : null, input);
}
