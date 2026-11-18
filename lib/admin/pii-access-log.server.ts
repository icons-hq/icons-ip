import 'server-only';
import { isIP } from 'node:net';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';
import {
  PII_ACCESS_SUBJECT_ID_LIMIT,
  parsePiiAccessLog,
  parsePiiAccessLogExport,
  piiAccessPath,
  type PiiAccessLogData,
  type PiiAccessLogExport,
  type PiiAccessLogFilters,
  type PiiAccessRecord,
} from './pii-access-log';

/*
 * 개인정보 접속기록 남기기(CUS-084·OPS-014). 서버만 서비스 키로 `service_record_operator_pii_access`를 부른다.
 *
 * 실패 정책(설계 판단):
 *  - 내려받기·원문 확인(파일·계좌·회수지 원문을 한 번에 내보내는 동작)은 기록이 남아야 응답한다(fail-closed, `recordPiiAccess`).
 *    운영자가 다시 누르면 되는 동작이고, 기록 없이 나간 파일은 되돌릴 수 없다.
 *  - 화면 열람·검색은 기록 실패를 서버 로그에 남기고 화면은 연다(fail-open, `notePiiAccess`). 상세 화면이 막히면 출고·CS가 멈추고,
 *    열람한 데이터는 이미 권한 판정을 통과한 RPC가 돌려준 것이다. 실패 로그에는 개인정보를 싣지 않는다.
 *  - 접속기록 점검 화면 자체는 기록이 남아야 연다(fail-closed) — 운영자 IP와 열람 대상을 모아 보여 주는 화면이라서다.
 */

export type { PiiAccessRecord };

export class PiiAccessLogError extends Error {
  constructor() { super('개인정보 접속기록을 남기지 못해 요청을 처리하지 않았습니다. 잠시 후 다시 시도해주세요.'); this.name = 'PiiAccessLogError'; }
}

/**
 * 접속지 IP. Vercel은 `x-real-ip`·`x-forwarded-for`를 들어온 요청 값으로 덮어쓰므로 운영에서는 클라이언트가 바꿀 수 없다
 * (휴대폰 인증 IP 한도와 같은 읽기). Vercel 밖(로컬)에서는 클라이언트가 보낸 값일 수 있어 참고값이다. IP 형식이 아니면 비운다.
 */
export function piiAccessClientIp(list: Pick<Headers, 'get'>): string | null {
  const value = (list.get('x-real-ip') ?? list.get('x-forwarded-for')?.split(',')[0] ?? '').trim();
  return value && value.length <= 64 && isIP(value) ? value : null;
}

function rpcArgs(record: PiiAccessRecord, ip: string | null) {
  const ids = [...new Set((record.subjectIds ?? []).filter((id): id is string => typeof id === 'string' && isUuid(id)).map(id => id.toLowerCase()))]
    .slice(0, PII_ACCESS_SUBJECT_ID_LIMIT);
  const subjectCount = record.subjectKind === 'none' ? 0 : Math.max(ids.length, Math.trunc(record.subjectCount ?? ids.length));
  const detail = Object.fromEntries(Object.entries(record.detail ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 120) : value]));
  return {
    p_actor_id: record.actorId, p_action: record.action, p_surface: record.surface, p_path: piiAccessPath(record.path),
    p_client_ip: ip, p_subject_kind: record.subjectKind, p_subject_ids: record.subjectKind === 'none' ? [] : ids,
    p_subject_count: subjectCount, p_detail: detail,
  };
}

async function send(record: PiiAccessRecord, ip: string | null): Promise<string> {
  const { data, error } = await createServiceClient().rpc('service_record_operator_pii_access', rpcArgs(record, ip));
  if (error || !(typeof data === 'number' || (typeof data === 'string' && /^\d+$/.test(data)))) throw new PiiAccessLogError();
  return String(data);
}

/** 기록을 남기고 기록 번호를 돌려준다. 실패하면 `PiiAccessLogError`(호출자는 응답하지 않는다). */
export async function recordPiiAccess(record: PiiAccessRecord): Promise<string> {
  try {
    return await send(record, piiAccessClientIp(await headers()));
  } catch (error) {
    if (error instanceof PiiAccessLogError) throw error;
    throw new PiiAccessLogError();
  }
}

/**
 * 화면 열람·검색 기록. 응답을 늦추지 않게 접속지만 지금 읽고 기록은 응답 뒤(`after`)에 남긴다 — 서버 컴포넌트는 `after` 안에서
 * 요청 헤더를 읽을 수 없다. 실패해도 던지지 않는다(서버 로그만, 개인정보 없이).
 */
export async function notePiiAccess(record: PiiAccessRecord): Promise<void> {
  let ip: string | null = null;
  try { ip = piiAccessClientIp(await headers()); } catch { /* 요청 밖(시험·빌드)에서는 접속지 없이 남긴다. */ }
  const run = async () => {
    try { await send(record, ip); }
    catch { console.error('[pii-access-log] 접속기록을 남기지 못했습니다.', { surface: record.surface, action: record.action }); }
  };
  try { after(run); } catch { await run(); }
}

/** 점검 화면 목록. DB가 매니저 관리 권한을 다시 판정한다. */
export async function loadPiiAccessLog(filters: PiiAccessLogFilters): Promise<PiiAccessLogData> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_pii_access_log', {
    p_from: filters.from, p_to: filters.to, p_actor: filters.actor, p_action: filters.action, p_surface: filters.surface,
    p_subject: filters.subject, p_flag: filters.flag, p_page: filters.page,
  });
  const parsed = !error && parsePiiAccessLog(data);
  if (!parsed || parsed.from !== filters.from || parsed.to !== filters.to) {
    throw new Error('개인정보 접속기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
  return parsed;
}

export class PiiAccessLogExportLimitError extends Error {
  constructor() { super('한 번에 내려받을 수 있는 기록은 10,000건입니다. 기간이나 조건을 좁혀주세요.'); }
}

export async function loadPiiAccessLogExport(filters: PiiAccessLogFilters): Promise<PiiAccessLogExport> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_export_pii_access_log', {
    p_from: filters.from, p_to: filters.to, p_actor: filters.actor, p_action: filters.action, p_surface: filters.surface,
    p_subject: filters.subject, p_flag: filters.flag,
  });
  if (error?.code === '54000') throw new PiiAccessLogExportLimitError();
  const parsed = !error && parsePiiAccessLogExport(data);
  if (!parsed || parsed.from !== filters.from || parsed.to !== filters.to) throw new Error('pii_access_log_export_unavailable');
  return parsed;
}
