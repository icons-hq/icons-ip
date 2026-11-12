/*
 * 미사용 IP 초안 삭제(S36-004 · ADR-0039).
 *
 * DB(`admin_ip_delete_readiness`)가 게시 상태·공개 이력·참조 수를 한 번에 돌려주고, 같은 판정을
 * `admin_delete_draft_ip`가 행 잠금 아래에서 다시 한다. 화면은 그 결과를 읽어 "왜 지울 수 있는지(참조 0건 근거)"와
 * "왜 막혔는지"를 운영자 말로 보여 줄 뿐 판정을 따로 하지 않는다.
 */

export const IP_DELETE_REFERENCE_KEYS = [
  'goods', 'cards', 'card_pools', 'reward_policies', 'events', 'home_curations',
  'coupons', 'order_items', 'ip_follows', 'posts', 'other',
] as const;
export type IpDeleteReferenceKey = typeof IP_DELETE_REFERENCE_KEYS[number];

export const IP_DELETE_REFERENCE_LABELS: Record<IpDeleteReferenceKey, string> = {
  goods: '상품',
  cards: '카드',
  card_pools: '카드풀',
  reward_policies: '뽑기권 발급 정책',
  events: '이벤트',
  home_curations: '홈 전시',
  coupons: '쿠폰',
  order_items: '주문 품목',
  ip_follows: '팔로우',
  posts: '커뮤니티 포스트',
  other: '기타 연결',
};

export type AdminIpDeleteState = 'draft' | 'published' | 'archived';

export interface AdminIpDeleteReadiness {
  id: string;
  title: string;
  publicSlug: string;
  state: AdminIpDeleteState;
  /** 한 번이라도 공개된 적이 있다(게시 상태 seam 전에 만든 IP 포함). */
  publicHistory: boolean;
  /** 공개된 적 없는 초안의 이전 공개 URL. 삭제할 때 함께 지운다. */
  aliases: string[];
  references: Record<IpDeleteReferenceKey, number>;
  referenceTotal: number;
  deletable: boolean;
}

const STATES = new Set<AdminIpDeleteState>(['draft', 'published', 'archived']);

function count(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/** RPC 응답을 엄격히 읽는다. 모양이 다르면 null — 화면은 삭제를 열지 않는다. */
export function parseIpDeleteReadiness(value: unknown): AdminIpDeleteReadiness | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const references = row.references;
  if (!references || typeof references !== 'object' || Array.isArray(references)) return null;
  const counts = {} as Record<IpDeleteReferenceKey, number>;
  for (const key of IP_DELETE_REFERENCE_KEYS) {
    const parsed = count((references as Record<string, unknown>)[key]);
    if (parsed === null) return null;
    counts[key] = parsed;
  }
  const referenceTotal = count(row.referenceTotal);
  if (typeof row.id !== 'string' || !row.id || typeof row.title !== 'string' || typeof row.publicSlug !== 'string'
    || !STATES.has(row.state as AdminIpDeleteState) || typeof row.publicHistory !== 'boolean'
    || !Array.isArray(row.aliases) || row.aliases.some((alias) => typeof alias !== 'string')
    || referenceTotal === null || typeof row.deletable !== 'boolean') return null;
  return {
    id: row.id,
    title: row.title,
    publicSlug: row.publicSlug,
    state: row.state as AdminIpDeleteState,
    publicHistory: row.publicHistory,
    aliases: row.aliases as string[],
    references: counts,
    referenceTotal,
    deletable: row.deletable,
  };
}

/** 삭제를 막는 이유. 비어 있으면 지울 수 있다(판정은 DB의 `deletable`을 따른다). */
export function ipDeleteBlockers(readiness: AdminIpDeleteReadiness): string[] {
  const blockers: string[] = [];
  if (readiness.state === 'published') blockers.push('공개 중인 IP입니다. 초안만 삭제할 수 있습니다.');
  if (readiness.state === 'archived') blockers.push('보관된 IP입니다. 공개된 적이 없다면 먼저 복원해 초안으로 되돌린 뒤 삭제할 수 있습니다.');
  if (readiness.publicHistory) blockers.push('공개된 적이 있는 IP는 삭제할 수 없습니다. 더 쓰지 않으면 보관해주세요.');
  const linked = IP_DELETE_REFERENCE_KEYS.filter((key) => readiness.references[key] > 0)
    .map((key) => `${IP_DELETE_REFERENCE_LABELS[key]} ${readiness.references[key].toLocaleString('ko-KR')}건`);
  if (linked.length) blockers.push(`연결된 항목이 있어 삭제할 수 없습니다: ${linked.join(' · ')}. 연결을 먼저 정리하거나 보관해주세요.`);
  return blockers;
}

/** 삭제 RPC 오류를 운영자 말로 옮긴다. 화면을 연 뒤 상태가 바뀐 경우가 대부분이다. */
export function ipDraftDeleteErrorMessage(error: { code?: unknown; message?: unknown }): string {
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  const descriptor = `${code} ${message}`;
  if (descriptor.includes('ip_has_references')) return '그사이 연결된 항목이 생겨 삭제하지 않았습니다. 새로고침해 연결을 확인해주세요.';
  if (descriptor.includes('ip_has_public_history')) return '공개된 적이 있는 IP는 삭제할 수 없습니다. 더 쓰지 않으면 보관해주세요.';
  if (descriptor.includes('ip_not_draft')) return '초안 상태의 IP만 삭제할 수 있습니다. 새로고침해 게시 상태를 확인해주세요.';
  if (descriptor.includes('catalog_not_found')) return 'IP를 찾을 수 없습니다. IP 목록을 새로고침해주세요.';
  if (code === '42501' || code === '28000' || descriptor.includes('operator_capability_required') || descriptor.includes('auth_required')) {
    return '미사용 IP 삭제는 관리자(admin)만 할 수 있습니다.';
  }
  return 'IP를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.';
}
