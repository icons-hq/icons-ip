import { formatAdminCatalogRecordLabel } from './catalog-archive';

/*
 * IP 게시 상태 (20260907130000).
 *
 *   보관: archived_at 이 있다. 보관할 때 published_at 을 비우므로 복원하면 초안이다.
 *   초안: 보관되지 않았고 published_at 이 없다. 등록 중·비공개 — 온라인 팝업 디렉토리,
 *        IP관, 홈 특집, 검색 어디에도 나오지 않는다.
 *   공개: 보관되지 않았고 published_at 이 있다.
 *
 * 화면은 두 컬럼을 따로 해석하지 않고 이 함수로 상태를 받는다.
 */
export type AdminIpPublishState = 'draft' | 'published' | 'archived';

export interface AdminIpPublishableRecord {
  archivedAt: string | null;
  publishedAt: string | null;
}

export const ADMIN_IP_PUBLISH_STATE_LABELS: Record<AdminIpPublishState, string> = {
  draft: '초안',
  published: '공개',
  archived: '보관',
};

export function adminIpPublishState(record: AdminIpPublishableRecord): AdminIpPublishState {
  if (record.archivedAt) return 'archived';
  return record.publishedAt ? 'published' : 'draft';
}

export function adminIpPublishStateLabel(record: AdminIpPublishableRecord): string {
  return ADMIN_IP_PUBLISH_STATE_LABELS[adminIpPublishState(record)];
}

/** 목록 라벨. 보관은 기존 `[보관]` 표기를 그대로 쓰고, 초안은 `[초안]` 을 앞에 붙인다. 공개는 그대로다. */
export function formatAdminIpRecordLabel(label: string, record: AdminIpPublishableRecord): string {
  const state = adminIpPublishState(record);
  if (state === 'archived') return formatAdminCatalogRecordLabel(label, record.archivedAt);
  return state === 'draft' ? `[초안] ${label}` : label;
}
