import 'server-only';

import type { AdminCatalogContext } from '@/lib/admin/catalog';
import { createClient } from '@/lib/supabase/server';

/*
 * 어드민 폼 검증 컨텍스트 (규모 후속).
 *
 * 전에는 「고른 IP 가 등록된 것인가」를 확인하려고 **카탈로그 전량**(IP·굿즈·카드·이벤트)과
 * 어드민 레코드 8종 전량을 읽었다. 저장 한 번에 카탈로그 전부를 나르는 셈이고, 1,000개를
 * 넘는 순간 그 뒤의 IP 는 「등록되지 않은 IP」가 됐다 — 있는데 없다고 답한다.
 *
 * 여기서는 **폼이 실제로 제출한 id** 만 확인한다. 조회량은 폼 하나당 몇 건이고, 카탈로그가
 * 커져도 그대로다. 보관된 레코드가 지금 참조하는 IP·이벤트는 살려 둔다(메타데이터 수정이
 * 막히면 안 된다) — 그건 「현재 레코드」 조회가 맡는다.
 */

export type AdminValidationRecordKind =
  | 'ip' | 'good' | 'card' | 'cardPool' | 'rewardPolicy' | 'event' | 'ticketType';

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function activeIds(supabase: Client, table: 'ips' | 'events', ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const { data, error } = await supabase.from(table).select('id').is('archived_at', null).in('id', ids);
  if (error) throw new Error(`Failed to check ${table}: ${error.message}`);
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}

/** 지금 편집 중인 레코드가 참조하는 IP·이벤트. 보관됐어도 그 관계는 유지돼야 한다. */
async function currentRelations(
  supabase: Client,
  kind: AdminValidationRecordKind,
  id: string,
): Promise<{ ipIds: string[]; eventIds: string[]; goodIp: [string, string] | null }> {
  const none = { ipIds: [], eventIds: [], goodIp: null };
  if (!id) return none;

  const single = async <Row>(table: string, columns: string) => {
    const { data, error } = await supabase.from(table).select(columns).eq('id', id).maybeSingle();
    if (error) throw new Error(`Failed to load current ${table}: ${error.message}`);
    return (data ?? null) as Row | null;
  };

  if (kind === 'good' || kind === 'card' || kind === 'cardPool') {
    const table = kind === 'good' ? 'goods' : kind === 'card' ? 'cards' : 'card_pools';
    const row = await single<{ ip_id: string | null }>(table, 'ip_id');
    return { ...none, ipIds: row?.ip_id ? [row.ip_id] : [] };
  }
  if (kind === 'rewardPolicy') {
    const row = await single<{ target_ip_id: string | null; target_good_id: string | null }>(
      'reward_policies', 'target_ip_id,target_good_id',
    );
    return {
      ipIds: row?.target_ip_id ? [row.target_ip_id] : [],
      eventIds: [],
      goodIp: row?.target_ip_id && row.target_good_id ? [row.target_good_id, row.target_ip_id] : null,
    };
  }
  if (kind === 'event') {
    const row = await single<{ ip_id: string | null }>('events', 'ip_id');
    return { ...none, ipIds: row?.ip_id ? [row.ip_id] : [] };
  }
  if (kind === 'ticketType') {
    const row = await single<{ event_id: string | null }>('ticket_types', 'event_id');
    return { ...none, eventIds: row?.event_id ? [row.event_id] : [] };
  }
  return none;
}

export async function loadAdminValidationContext(
  formData: FormData,
  kind: AdminValidationRecordKind,
): Promise<AdminCatalogContext> {
  const supabase = await createClient();
  const id = formString(formData, 'id');
  const submittedIpIds = unique([formString(formData, 'ipId'), formString(formData, 'targetIpId')]);
  const submittedEventId = formString(formData, 'eventId');
  const submittedGoodId = formString(formData, 'targetGoodId');

  const [current, verticalsResult] = await Promise.all([
    currentRelations(supabase, kind, id),
    supabase.from('verticals').select('key'),
  ]);
  if (verticalsResult.error) throw new Error(`Failed to load verticals: ${verticalsResult.error.message}`);

  const [ipIds, eventIds, goodResult] = await Promise.all([
    activeIds(supabase, 'ips', submittedIpIds),
    activeIds(supabase, 'events', unique([submittedEventId])),
    submittedGoodId
      ? supabase.from('goods').select('id,ip_id').eq('id', submittedGoodId).is('archived_at', null).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (goodResult.error) throw new Error(`Failed to check goods: ${goodResult.error.message}`);

  for (const ipId of current.ipIds) ipIds.add(ipId);
  for (const eventId of current.eventIds) eventIds.add(eventId);
  const goodIpById = new Map<string, string>();
  const good = goodResult.data as { id: string; ip_id: string } | null;
  if (good) goodIpById.set(good.id, good.ip_id);
  if (current.goodIp) goodIpById.set(current.goodIp[0], current.goodIp[1]);

  return {
    eventIds,
    goodIpById,
    ipIds,
    verticalKeys: new Set(((verticalsResult.data ?? []) as { key: string }[]).map((row) => row.key)),
  };
}
