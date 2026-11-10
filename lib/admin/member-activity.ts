import { MEMBER_ACTIVITY_NOTICE_VERSION } from '@/lib/member-activity';
import { transactionExactKeys, transactionInteger, transactionRecord, transactionInstant } from '@/lib/goods-transaction-values';
export interface MemberActivitySettings { enabled: boolean; revision: number; enabledSince: string | null; updatedAt: string; noticeVersion: typeof MEMBER_ACTIVITY_NOTICE_VERSION; retentionDays: 90 }
export function parseMemberActivitySettings(value: unknown): MemberActivitySettings | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['enabled','revision','enabledSince','updatedAt','noticeVersion','retentionDays']) || typeof value.enabled !== 'boolean'
    || !transactionInteger(value.revision, 1) || !transactionInstant(value.updatedAt) || value.noticeVersion !== MEMBER_ACTIVITY_NOTICE_VERSION || value.retentionDays !== 90
    || (value.enabled ? !transactionInstant(value.enabledSince) : value.enabledSince !== null)) return null;
  return value as unknown as MemberActivitySettings;
}
